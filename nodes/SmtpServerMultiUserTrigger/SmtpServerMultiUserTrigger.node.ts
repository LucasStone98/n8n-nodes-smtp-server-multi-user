import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import type { SMTPServerDataStream, SMTPServerOptions, SMTPServerSession } from 'smtp-server';
import type { ParsedMail } from 'mailparser';
import { createPrivateKey, createPublicKey, X509Certificate } from 'crypto';
import { createSecureContext } from 'tls';

interface AuthAccount {
	username?: unknown;
	password?: unknown;
}

interface SmtpServerTlsCredential {
	certificate?: unknown;
	privateKey?: unknown;
	passphrase?: unknown;
}

export type TlsMode = 'starttls' | 'implicit' | 'off';
export type TlsMinVersion = 'TLSv1.2' | 'TLSv1.3';

export interface TlsSettings {
	mode: TlsMode;
	allowInsecure: boolean;
	minVersion: TlsMinVersion;
	certificate?: unknown;
	privateKey?: unknown;
	passphrase?: unknown;
}

export interface TlsOptionsResult {
	options: Partial<SMTPServerOptions>;
	warnings: string[];
}

interface UserAccountsCollection {
	account?: AuthAccount | AuthAccount[];
}

/**
 * Normalize the fixed-collection value into a list of account entries.
 *
 * Accepts the usual `{ account: [...] }` shape, a single `{ account: {...} }`,
 * a bare array of accounts, or a single account object.
 */
function normalizeUserAccounts(value: unknown): AuthAccount[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (Array.isArray(value)) {
		return value as AuthAccount[];
	}

	if (typeof value === 'object') {
		const collection = value as UserAccountsCollection & AuthAccount;

		if (collection.account !== undefined) {
			return Array.isArray(collection.account) ? collection.account : [collection.account];
		}

		if ('username' in collection || 'password' in collection) {
			return [collection];
		}

		return [];
	}

	throw new ApplicationError(
		'SMTP user accounts must be a list of accounts with a username and password',
	);
}

/**
 * Validate the configured accounts and turn them into a username -> password map.
 */
export function parseUserAccounts(value: unknown): Map<string, string> {
	const accounts = new Map<string, string>();

	for (const entry of normalizeUserAccounts(value)) {
		if (typeof entry.username !== 'string' || entry.username.trim() === '') {
			throw new ApplicationError('Every SMTP account must have a username');
		}

		if (typeof entry.password !== 'string' || entry.password === '') {
			throw new ApplicationError(`SMTP account "${entry.username}" must have a password`);
		}

		if (accounts.has(entry.username)) {
			throw new ApplicationError(`Duplicate SMTP account username "${entry.username}"`);
		}

		accounts.set(entry.username, entry.password);
	}

	return accounts;
}

/**
 * Check a username/password combination against the configured accounts.
 */
export function verifyCredentials(
	accounts: Map<string, string>,
	username: unknown,
	password: unknown,
): boolean {
	if (typeof username !== 'string' || typeof password !== 'string') {
		return false;
	}

	const expectedPassword = accounts.get(username);

	return expectedPassword !== undefined && expectedPassword === password;
}

function requireTlsString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ApplicationError(`TLS ${label} is required when TLS is enabled`);
	}

	const trimmed = value.trim();

	if (!trimmed.includes('-----BEGIN ')) {
		throw new ApplicationError(`TLS ${label} must be PEM-encoded`);
	}

	return trimmed;
}

function optionalTlsString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	if (typeof value !== 'string') {
		throw new ApplicationError(`TLS ${label} must be a string`);
	}

	return value.trim() === '' ? undefined : value;
}

function validateTlsMaterial(
	certificate: string,
	privateKey: string,
	passphrase: string | undefined,
	minVersion: TlsMinVersion,
): string[] {
	let certificateDetails: X509Certificate;
	let privateKeyObject: ReturnType<typeof createPrivateKey>;

	try {
		certificateDetails = new X509Certificate(certificate);
		privateKeyObject = createPrivateKey({
			key: privateKey,
			...(passphrase ? { passphrase } : {}),
		});
	} catch (error) {
		throw new ApplicationError(
			`TLS certificate or private key is invalid: ${(error as Error).message}`,
		);
	}

	const certificatePublicKey = certificateDetails.publicKey.export({
		type: 'spki',
		format: 'der',
	});
	const privateKeyPublicKey = createPublicKey(privateKeyObject).export({
		type: 'spki',
		format: 'der',
	});

	if (!certificatePublicKey.equals(privateKeyPublicKey)) {
		throw new ApplicationError('TLS certificate does not match the private key');
	}

	try {
		createSecureContext({
			cert: certificate,
			key: privateKey,
			...(passphrase ? { passphrase } : {}),
			minVersion,
		});
	} catch (error) {
		throw new ApplicationError(
			`TLS certificate or private key is invalid: ${(error as Error).message}`,
		);
	}

	const warnings: string[] = [];
	const now = Date.now();
	const validFrom = Date.parse(certificateDetails.validFrom);
	const validTo = Date.parse(certificateDetails.validTo);

	if (!Number.isNaN(validFrom) && now < validFrom) {
		warnings.push(`TLS certificate is not valid until ${certificateDetails.validFrom}`);
	}

	if (!Number.isNaN(validTo) && now > validTo) {
		warnings.push(`TLS certificate expired on ${certificateDetails.validTo}`);
	}

	return warnings;
}

/**
 * Build the smtp-server TLS options and validate the certificate/key pair.
 */
export function buildTlsOptions(settings: TlsSettings): TlsOptionsResult {
	if (settings.mode === 'off') {
		return {
			options: {
				secure: false,
				hideSTARTTLS: true,
				allowInsecureAuth: true,
			},
			warnings: [],
		};
	}

	const certificate = requireTlsString(settings.certificate, 'certificate');
	const privateKey = requireTlsString(settings.privateKey, 'private key');
	const passphrase = optionalTlsString(settings.passphrase, 'passphrase');
	const warnings = validateTlsMaterial(certificate, privateKey, passphrase, settings.minVersion);

	const tlsMaterial = {
		cert: certificate,
		key: privateKey,
		...(passphrase ? { passphrase } : {}),
		minVersion: settings.minVersion,
	};

	if (settings.mode === 'implicit') {
		return {
			options: {
				secure: true,
				hideSTARTTLS: true,
				allowInsecureAuth: false,
				...tlsMaterial,
			},
			warnings,
		};
	}

	return {
		options: {
			secure: false,
			hideSTARTTLS: false,
			allowInsecureAuth: settings.allowInsecure,
			...tlsMaterial,
		},
		warnings,
	};
}

export class SmtpServerMultiUserTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SMTP Server Multi-User Trigger',
		name: 'smtpServerMultiUserTrigger',
		icon: 'file:icons/smtp-server.svg',
		group: ['trigger'],
		version: 1,
		description:
			'Exposes an SMTP server endpoint and triggers on sending email, with multi-user authentication',
		defaults: {
			name: 'SMTP Server Multi-User Trigger',
		},
		credentials: [
			{
				name: 'smtpServerTlsApi',
				required: true,
				displayOptions: {
					show: {
						tlsMode: ['starttls', 'implicit'],
					},
				},
			},
		],
		inputs: [],
		outputs: [NodeConnectionType.Main],
		properties: [
			{
				displayName: 'Port',
				name: 'port',
				type: 'number',
				default: 2525,
				description: 'Port to listen on for SMTP connections',
				required: true,
			},
			{
				displayName: 'Host',
				name: 'host',
				type: 'string',
				default: '0.0.0.0',
				description: 'Host to bind the SMTP server to',
				required: true,
			},
			{
				displayName: 'TLS Mode',
				name: 'tlsMode',
				type: 'options',
				options: [
					{
						name: 'STARTTLS',
						value: 'starttls',
					},
					{
						name: 'Implicit TLS (SMTPS)',
						value: 'implicit',
					},
					{
						name: 'Off (Plaintext)',
						value: 'off',
					},
				],
				default: 'starttls',
				description: 'How the SMTP server handles TLS connections',
			},
			{
				displayName:
					'TLS requires an SMTP Server TLS API credential. To create a test certificate, see the <a href="https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user#generating-a-test-certificate" target="_blank">test certificate guide</a>.',
				name: 'tlsCredentialNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						tlsMode: ['starttls', 'implicit'],
					},
				},
			},
			{
				displayName: 'Minimum TLS Version',
				name: 'tlsMinVersion',
				type: 'options',
				options: [
					{
						name: 'TLS 1.2',
						value: 'TLSv1.2',
					},
					{
						name: 'TLS 1.3',
						value: 'TLSv1.3',
					},
				],
				default: 'TLSv1.2',
				displayOptions: {
					show: {
						tlsMode: ['starttls', 'implicit'],
					},
				},
				description: 'Minimum TLS version accepted for encrypted connections',
			},
			{
				displayName: 'Allow Authentication Without TLS',
				name: 'allowInsecure',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						tlsMode: ['starttls'],
					},
				},
				description:
					'Whether to allow SMTP authentication before the connection is upgraded with STARTTLS',
			},
			{
				displayName: 'TLS Is Off. SMTP traffic and credentials will be sent in plaintext.',
				name: 'tlsOffNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						tlsMode: ['off'],
					},
				},
			},
			{
				displayName: 'Enable Authentication',
				name: 'enableAuth',
				type: 'boolean',
				default: false,
				description: 'Whether to enable SMTP authentication',
			},
			{
				displayName: 'User Accounts',
				name: 'userAccounts',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'SMTP accounts allowed to authenticate',
				displayOptions: {
					show: {
						enableAuth: [true],
					},
				},
				options: [
					{
						displayName: 'Account',
						name: 'account',
						values: [
							{
								displayName: 'Username',
								name: 'username',
								type: 'string',
								default: '',
								description: 'Username for SMTP authentication',
							},
							{
								displayName: 'Password',
								name: 'password',
								type: 'string',
								typeOptions: {
									password: true,
								},
								default: '',
								description: 'Password for SMTP authentication',
							},
						],
					},
				],
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const port = this.getNodeParameter('port', 0) as number;
		const host = this.getNodeParameter('host', 0) as string;
		const tlsMode = this.getNodeParameter('tlsMode', 0) as TlsMode;
		const tlsMinVersion = this.getNodeParameter('tlsMinVersion', 0) as TlsMinVersion;
		const allowInsecure = this.getNodeParameter('allowInsecure', 0) as boolean;
		const enableAuth = this.getNodeParameter('enableAuth', 0) as boolean;

		let userAccounts = new Map<string, string>();

		if (enableAuth) {
			try {
				userAccounts = parseUserAccounts(this.getNodeParameter('userAccounts', 0));
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message);
			}

			if (userAccounts.size === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'Enable Authentication is on, but no user accounts are configured',
				);
			}
		}

		let tlsCredential: SmtpServerTlsCredential = {};

		if (tlsMode !== 'off') {
			try {
				tlsCredential = await this.getCredentials<SmtpServerTlsCredential>('smtpServerTlsApi');
			} catch (error) {
				const errorMessage = (error as Error).message;
				const description =
					errorMessage === 'Node does not require credentials' ||
					errorMessage === 'Node does not have any credentials set' ||
					errorMessage.startsWith('Node does not have any credentials set for')
						? 'Select an SMTP Server TLS API credential, or set TLS Mode to Off.'
						: errorMessage;

				throw new NodeOperationError(
					this.getNode(),
					'TLS is enabled, but no SMTP Server TLS API credential is selected',
					{ description },
				);
			}
		}

		let tlsOptions: Partial<SMTPServerOptions> = {};

		try {
			const tlsResult = buildTlsOptions({
				mode: tlsMode,
				allowInsecure,
				minVersion: tlsMinVersion,
				...tlsCredential,
			});

			tlsOptions = tlsResult.options;

			for (const warning of tlsResult.warnings) {
				console.warn(warning);
			}
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message);
		}

		// Store the trigger context for use in callbacks
		const triggerContext = this;

		const server = new SMTPServer({
			...tlsOptions,
			authOptional: !enableAuth,
			onAuth(auth, session, callback) {
				if (!enableAuth) {
					callback(null, { user: 'anonymous' });
					return;
				}

				if (verifyCredentials(userAccounts, auth.username, auth.password)) {
					callback(null, { user: auth.username });
				} else {
					callback(new Error('Invalid username or password'));
				}
			},
			onData(stream: SMTPServerDataStream, session: SMTPServerSession, callback) {
				let mailData = '';

				stream.on('data', (chunk) => {
					mailData += chunk.toString();
				});

				stream.on('end', async () => {
					try {
						// Parse the email using mailparser
						const parsed: ParsedMail = await simpleParser(mailData);

						// Extract the required properties
						const emailData = {
							authenticatedUser: session.user ?? '',
							subject: parsed.subject || '',
							to: Array.isArray(parsed.to)
								? parsed.to.map((addr) => addr.text).join(', ')
								: parsed.to?.text || '',
							from: Array.isArray(parsed.from)
								? parsed.from.map((addr) => addr.text).join(', ')
								: parsed.from?.text || '',
							body: parsed.text || parsed.html || '',
							html: parsed.html || '',
							text: parsed.text || '',
							date: parsed.date,
							messageId: parsed.messageId,
							attachments:
								parsed.attachments?.map((attachment) => ({
									filename: attachment.filename,
									contentType: attachment.contentType,
									size: attachment.size,
									content: attachment.content,
								})) || [],
							headers: parsed.headers,
						};

						// Trigger the workflow with the email data
						triggerContext.emit([[{ json: emailData } as INodeExecutionData]]);
					} catch (error) {
						console.error('Error parsing email:', error);
					}

					callback();
				});

				stream.on('error', (error) => {
					console.error('Stream error:', error);
					callback(error);
				});
			},
		});

		// Start the server
		server.listen(port, host, () => {
			console.log(`SMTP Server listening on ${host}:${port}`);
		});

		// Handle server errors
		server.on('error', (error) => {
			console.error('SMTP Server error:', error);
		});

		// Store server reference for cleanup (unused but kept for potential future use)
		// const serverData: ISmtpServerData = {
		// 	server,
		// 	port,
		// 	host,
		// };

		// Return cleanup function
		const closeServer = async () => {
			return new Promise<void>((resolve) => {
				server.close(() => {
					console.log(`SMTP Server on ${host}:${port} stopped`);
					resolve();
				});
			});
		};

		return {
			closeFunction: closeServer,
		};
	}
}
