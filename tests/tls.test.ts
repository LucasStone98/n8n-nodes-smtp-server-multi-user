import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import nodemailer from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer';
import type { INodeExecutionData, ITriggerFunctions } from 'n8n-workflow';
import { SmtpServerTlsApi } from '../credentials/SmtpServerTlsApi.credentials';
import {
	SmtpServerMultiUserTrigger,
	buildTlsOptions,
} from '../nodes/SmtpServerMultiUserTrigger/SmtpServerMultiUserTrigger.node';
import type {
	TlsMinVersion,
	TlsMode,
} from '../nodes/SmtpServerMultiUserTrigger/SmtpServerMultiUserTrigger.node';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TlsCredential {
	certificate?: unknown;
	privateKey?: unknown;
	passphrase?: unknown;
}

interface TriggerParams {
	port: number;
	host: string;
	tlsMode: TlsMode;
	tlsMinVersion: TlsMinVersion;
	allowInsecure: boolean;
	enableAuth: boolean;
	userAccounts?: unknown;
}

interface SmtpSendOptions {
	secure: boolean;
	auth?: { user: string; pass: string };
	tls?: SMTPTransportOptions['tls'];
	ignoreTLS?: boolean;
	requireTLS?: boolean;
}

let tempDir: string;
let certificate: string;
let privateKey: string;
let otherCertificate: string;
let otherPrivateKey: string;
let encryptedCertificate: string;
let encryptedPrivateKey: string;
let expiredCertificate: string;
let expiredPrivateKey: string;

function runOpenSSL(args: string[]): void {
	execFileSync('openssl', args, { stdio: 'ignore' });
}

function createCertificate(keyPath: string, certPath: string, passphrase?: string): void {
	const args = [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-keyout',
		keyPath,
		'-out',
		certPath,
		'-days',
		'2',
		'-subj',
		'/CN=localhost',
		'-addext',
		'subjectAltName=DNS:localhost,IP:127.0.0.1',
	];

	if (passphrase) {
		args.push('-passout', `pass:${passphrase}`);
	} else {
		args.push('-nodes');
	}

	runOpenSSL(args);
}

function createExpiredCertificate(keyPath: string, certPath: string): void {
	runOpenSSL([
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-keyout',
		keyPath,
		'-out',
		certPath,
		'-subj',
		'/CN=localhost',
		'-addext',
		'subjectAltName=DNS:localhost,IP:127.0.0.1',
		'-not_before',
		'20200101000000Z',
		'-not_after',
		'20210101000000Z',
	]);
}

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			server.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

async function waitForPort(port: number, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const connected = await new Promise<boolean>((resolve) => {
			const socket = net.connect(port, '127.0.0.1');
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => {
				socket.destroy();
				resolve(false);
			});
		});

		if (connected) {
			return;
		}

		await delay(25);
	}

	throw new Error(`Timed out waiting for SMTP server on port ${port}`);
}

function createContext(
	params: TriggerParams,
	emitted: INodeExecutionData[],
	getCredentialsImpl: () => Promise<TlsCredential> = async () => ({ certificate, privateKey }),
): { context: ITriggerFunctions; getCredentials: jest.Mock } {
	const getCredentials = jest.fn(getCredentialsImpl);

	const context = {
		getNodeParameter: (name: string) => params[name as keyof TriggerParams],
		getNode: () => ({
			name: 'SMTP Server Multi-User Trigger',
			type: 'smtpServerMultiUserTrigger',
			typeVersion: 1,
			parameters: {},
			position: [0, 0],
		}),
		getCredentials,
		emit: (data: INodeExecutionData[][]) => {
			emitted.push(...data.flat());
		},
	} as unknown as ITriggerFunctions;

	return { context, getCredentials };
}

async function startTrigger(
	params: TriggerParams,
	emitted: INodeExecutionData[] = [],
	getCredentialsImpl?: () => Promise<TlsCredential>,
): Promise<{
	close: () => Promise<void>;
	emitted: INodeExecutionData[];
	getCredentials: jest.Mock;
}> {
	const { context, getCredentials } = createContext(params, emitted, getCredentialsImpl);
	const node = new SmtpServerMultiUserTrigger();
	const response = await node.trigger.call(context);

	if (params.tlsMode === 'implicit') {
		await delay(200);
	} else {
		await waitForPort(params.port);
	}

	return {
		close: async () => {
			await response.closeFunction?.();
		},
		emitted,
		getCredentials,
	};
}

async function sendMail(port: number, options: SmtpSendOptions): Promise<void> {
	const transport = nodemailer.createTransport({
		host: '127.0.0.1',
		port,
		secure: options.secure,
		auth: options.auth,
		tls: options.tls,
		ignoreTLS: options.ignoreTLS,
		requireTLS: options.requireTLS,
	});

	try {
		await transport.sendMail({
			from: 'sender@example.com',
			to: 'recipient@example.com',
			subject: 'TLS test',
			text: 'hello',
		});
	} finally {
		transport.close();
	}
}

async function waitForEmitted(emitted: INodeExecutionData[], count = 1): Promise<void> {
	const deadline = Date.now() + 3000;

	while (emitted.length < count && Date.now() < deadline) {
		await delay(25);
	}

	expect(emitted.length).toBeGreaterThanOrEqual(count);
}

function triggerParams(port: number, tlsMode: TlsMode, allowInsecure = false): TriggerParams {
	return {
		port,
		host: '127.0.0.1',
		tlsMode,
		tlsMinVersion: 'TLSv1.2',
		allowInsecure,
		enableAuth: true,
		userAccounts: {
			account: [{ username: 'alice', password: 'secret' }],
		},
	};
}

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'smtp-server-tls-'));

	const keyPath = join(tempDir, 'key.pem');
	const certPath = join(tempDir, 'cert.pem');
	createCertificate(keyPath, certPath);
	certificate = readFileSync(certPath, 'utf8').trim();
	privateKey = readFileSync(keyPath, 'utf8').trim();

	const otherKeyPath = join(tempDir, 'other-key.pem');
	const otherCertPath = join(tempDir, 'other-cert.pem');
	createCertificate(otherKeyPath, otherCertPath);
	otherCertificate = readFileSync(otherCertPath, 'utf8').trim();
	otherPrivateKey = readFileSync(otherKeyPath, 'utf8').trim();

	const encryptedKeyPath = join(tempDir, 'encrypted-key.pem');
	const encryptedCertPath = join(tempDir, 'encrypted-cert.pem');
	createCertificate(encryptedKeyPath, encryptedCertPath, 'secret');
	encryptedCertificate = readFileSync(encryptedCertPath, 'utf8').trim();
	encryptedPrivateKey = readFileSync(encryptedKeyPath, 'utf8').trim();

	const expiredKeyPath = join(tempDir, 'expired-key.pem');
	const expiredCertPath = join(tempDir, 'expired-cert.pem');
	createExpiredCertificate(expiredKeyPath, expiredCertPath);
	expiredCertificate = readFileSync(expiredCertPath, 'utf8').trim();
	expiredPrivateKey = readFileSync(expiredKeyPath, 'utf8').trim();
});

afterAll(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe('TLS configuration', () => {
	test('builds plaintext options when TLS is off', () => {
		const result = buildTlsOptions({
			mode: 'off',
			allowInsecure: false,
			minVersion: 'TLSv1.2',
		});

		expect(result.warnings).toEqual([]);
		expect(result.options).toEqual({
			secure: false,
			hideSTARTTLS: true,
			allowInsecureAuth: true,
		});
	});

	test('builds STARTTLS options with the configured certificate', () => {
		const result = buildTlsOptions({
			mode: 'starttls',
			allowInsecure: false,
			minVersion: 'TLSv1.2',
			certificate,
			privateKey,
		});

		expect(result.warnings).toEqual([]);
		expect(result.options).toMatchObject({
			secure: false,
			hideSTARTTLS: false,
			allowInsecureAuth: false,
			cert: certificate,
			key: privateKey,
			minVersion: 'TLSv1.2',
		});
	});

	test('maps allowInsecure to allowInsecureAuth in STARTTLS mode', () => {
		const result = buildTlsOptions({
			mode: 'starttls',
			allowInsecure: true,
			minVersion: 'TLSv1.3',
			certificate,
			privateKey,
		});

		expect(result.options.allowInsecureAuth).toBe(true);
		expect(result.options.minVersion).toBe('TLSv1.3');
	});

	test('builds implicit TLS options', () => {
		const result = buildTlsOptions({
			mode: 'implicit',
			allowInsecure: true,
			minVersion: 'TLSv1.2',
			certificate,
			privateKey,
		});

		expect(result.options).toMatchObject({
			secure: true,
			hideSTARTTLS: true,
			allowInsecureAuth: false,
			cert: certificate,
			key: privateKey,
		});
	});

	test('requires a certificate when TLS is enabled', () => {
		expect(() =>
			buildTlsOptions({
				mode: 'starttls',
				allowInsecure: false,
				minVersion: 'TLSv1.2',
				privateKey,
			}),
		).toThrow('TLS certificate is required when TLS is enabled');
	});

	test('requires a private key when TLS is enabled', () => {
		expect(() =>
			buildTlsOptions({
				mode: 'starttls',
				allowInsecure: false,
				minVersion: 'TLSv1.2',
				certificate,
			}),
		).toThrow('TLS private key is required when TLS is enabled');
	});

	test('rejects invalid PEM data', () => {
		expect(() =>
			buildTlsOptions({
				mode: 'starttls',
				allowInsecure: false,
				minVersion: 'TLSv1.2',
				certificate: 'not a certificate',
				privateKey,
			}),
		).toThrow('TLS certificate must be PEM-encoded');
	});

	test('rejects a certificate that does not match the private key', () => {
		expect(() =>
			buildTlsOptions({
				mode: 'starttls',
				allowInsecure: false,
				minVersion: 'TLSv1.2',
				certificate,
				privateKey: otherPrivateKey,
			}),
		).toThrow('TLS certificate does not match the private key');
	});

	test('supports encrypted private keys with a passphrase', () => {
		expect(() =>
			buildTlsOptions({
				mode: 'starttls',
				allowInsecure: false,
				minVersion: 'TLSv1.2',
				certificate: encryptedCertificate,
				privateKey: encryptedPrivateKey,
			}),
		).toThrow('TLS certificate or private key is invalid');

		const result = buildTlsOptions({
			mode: 'starttls',
			allowInsecure: false,
			minVersion: 'TLSv1.2',
			certificate: encryptedCertificate,
			privateKey: encryptedPrivateKey,
			passphrase: 'secret',
		});

		expect(result.options.passphrase).toBe('secret');
	});

	test('warns about an expired certificate', () => {
		const result = buildTlsOptions({
			mode: 'starttls',
			allowInsecure: false,
			minVersion: 'TLSv1.2',
			certificate: expiredCertificate,
			privateKey: expiredPrivateKey,
		});

		expect(result.warnings.some((warning) => warning.includes('expired'))).toBe(true);
	});
});

describe('TLS credential', () => {
	test('has the expected credential fields', () => {
		const credential = new SmtpServerTlsApi();

		expect(credential.name).toBe('smtpServerTlsApi');
		expect(credential.displayName).toBe('SMTP Server TLS API');
		expect(credential.properties.map((property) => property.name)).toEqual([
			'certificate',
			'privateKey',
			'passphrase',
		]);

		const privateKeyProperty = credential.properties.find(
			(property) => property.name === 'privateKey',
		);
		const passphraseProperty = credential.properties.find(
			(property) => property.name === 'passphrase',
		);

		expect(privateKeyProperty?.typeOptions).toMatchObject({ password: true });
		expect(passphraseProperty?.typeOptions).toMatchObject({ password: true });
	});
});

describe('SMTP TLS integration', () => {
	test('accepts STARTTLS with a valid certificate and exposes the authenticated user', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'starttls'));

		try {
			await sendMail(port, {
				secure: false,
				auth: { user: 'alice', pass: 'secret' },
				requireTLS: true,
				tls: { ca: certificate },
			});

			await waitForEmitted(server.emitted);
			expect(server.emitted[0].json.authenticatedUser).toBe('alice');
		} finally {
			await server.close();
		}
	});

	test('rejects plaintext authentication when insecure auth is disabled', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'starttls', false));

		try {
			await expect(
				sendMail(port, {
					secure: false,
					auth: { user: 'alice', pass: 'secret' },
					ignoreTLS: true,
				}),
			).rejects.toThrow(/STARTTLS|538|authentication/i);
		} finally {
			await server.close();
		}
	});

	test('allows plaintext authentication when insecure auth is enabled', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'starttls', true));

		try {
			await sendMail(port, {
				secure: false,
				auth: { user: 'alice', pass: 'secret' },
				ignoreTLS: true,
			});

			await waitForEmitted(server.emitted);
			expect(server.emitted[0].json.authenticatedUser).toBe('alice');
		} finally {
			await server.close();
		}
	});

	test('accepts implicit TLS connections', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'implicit'));

		try {
			await sendMail(port, {
				secure: true,
				auth: { user: 'alice', pass: 'secret' },
				tls: { ca: certificate },
			});

			await waitForEmitted(server.emitted);
			expect(server.emitted[0].json.authenticatedUser).toBe('alice');
		} finally {
			await server.close();
		}
	});

	test('accepts plaintext mail when TLS is off', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'off'));

		try {
			await sendMail(port, {
				secure: false,
				auth: { user: 'alice', pass: 'secret' },
				ignoreTLS: true,
			});

			await waitForEmitted(server.emitted);
			expect(server.emitted[0].json.authenticatedUser).toBe('alice');
		} finally {
			await server.close();
		}
	});

	test('rejects a client that does not trust the server certificate', async () => {
		const port = await getFreePort();
		const server = await startTrigger(triggerParams(port, 'starttls'));

		try {
			await expect(
				sendMail(port, {
					secure: false,
					auth: { user: 'alice', pass: 'secret' },
					requireTLS: true,
					tls: { ca: otherCertificate },
				}),
			).rejects.toThrow();
		} finally {
			await server.close();
		}
	});

	test('fails activation when no TLS credential is selected', async () => {
		const port = await getFreePort();
		const params = triggerParams(port, 'starttls');
		const { context } = createContext(params, [], async () => {
			throw new Error('Credentials not found');
		});

		await expect(new SmtpServerMultiUserTrigger().trigger.call(context)).rejects.toThrow(
			'no SMTP Server TLS API credential is selected',
		);
	});

	test('replaces the optional-credential error with an actionable message', async () => {
		const port = await getFreePort();
		const params = triggerParams(port, 'starttls');
		const { context } = createContext(params, [], async () => {
			throw new Error('Node does not require credentials');
		});

		await expect(new SmtpServerMultiUserTrigger().trigger.call(context)).rejects.toMatchObject({
			message: 'TLS is enabled, but no SMTP Server TLS API credential is selected',
			description: 'Select an SMTP Server TLS API credential, or set TLS Mode to Off.',
		});
	});

	test('fails activation when the certificate does not match the key', async () => {
		const port = await getFreePort();
		const params = triggerParams(port, 'starttls');
		const { context } = createContext(params, [], async () => ({
			certificate,
			privateKey: otherPrivateKey,
		}));

		await expect(new SmtpServerMultiUserTrigger().trigger.call(context)).rejects.toThrow(
			'TLS certificate does not match the private key',
		);
	});

	test('does not request TLS credentials when TLS is off', async () => {
		const port = await getFreePort();
		const params = triggerParams(port, 'off');
		const { context, getCredentials } = createContext(params, [], async () => {
			throw new Error('Should not be called');
		});
		const node = new SmtpServerMultiUserTrigger();
		const response = await node.trigger.call(context);

		try {
			expect(getCredentials).not.toHaveBeenCalled();
		} finally {
			await response.closeFunction?.();
		}
	});
});
