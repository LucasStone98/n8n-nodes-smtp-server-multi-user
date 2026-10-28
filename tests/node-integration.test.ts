import {
	SmtpServerMultiUserTrigger,
	parseUserAccounts,
	verifyCredentials,
} from '../nodes/SmtpServerMultiUserTrigger/SmtpServerMultiUserTrigger.node';
import { INodeTypeDescription } from 'n8n-workflow';

describe('SMTP Server Multi-User Node Integration', () => {
	let node: SmtpServerMultiUserTrigger;

	beforeEach(() => {
		node = new SmtpServerMultiUserTrigger();
	});

	describe('Node Description', () => {
		test('should have correct node description', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.displayName).toBe('SMTP Server Multi-User Trigger');
			expect(description.name).toBe('smtpServerMultiUserTrigger');
			expect(description.group).toEqual(['trigger']);
			expect(description.version).toBe(1);
			expect(description.description).toBe(
				'Exposes an SMTP server endpoint and triggers on sending email, with multi-user authentication',
			);
		});

		test('should have correct defaults', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.defaults).toEqual({
				name: 'SMTP Server Multi-User Trigger',
			});
		});

		test('should have correct inputs and outputs', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.inputs).toEqual([]);
			expect(description.outputs).toHaveLength(1);
		});

		test('should have required properties', () => {
			const description: INodeTypeDescription = node.description;
			const properties = description.properties;

			expect(properties).toHaveLength(9);

			// Check port property
			const portProperty = properties.find((p) => p.name === 'port');
			expect(portProperty).toBeDefined();
			expect(portProperty!.type).toBe('number');
			expect(portProperty!.default).toBe(2525);
			expect(portProperty!.required).toBe(true);

			// Check host property
			const hostProperty = properties.find((p) => p.name === 'host');
			expect(hostProperty).toBeDefined();
			expect(hostProperty!.type).toBe('string');
			expect(hostProperty!.default).toBe('0.0.0.0');
			expect(hostProperty!.required).toBe(true);

			// Check TLS mode property
			const tlsModeProperty = properties.find((p) => p.name === 'tlsMode') as any;
			expect(tlsModeProperty).toBeDefined();
			expect(tlsModeProperty!.type).toBe('options');
			expect(tlsModeProperty!.default).toBe('starttls');
			expect(tlsModeProperty!.options.map((option: any) => option.value)).toEqual([
				'starttls',
				'implicit',
				'off',
			]);

			// Check minimum TLS version property
			const tlsMinVersionProperty = properties.find((p) => p.name === 'tlsMinVersion') as any;
			expect(tlsMinVersionProperty).toBeDefined();
			expect(tlsMinVersionProperty!.type).toBe('options');
			expect(tlsMinVersionProperty!.default).toBe('TLSv1.2');
			expect(tlsMinVersionProperty!.displayOptions).toEqual({
				show: {
					tlsMode: ['starttls', 'implicit'],
				},
			});

			// Check enableAuth property
			const authProperty = properties.find((p) => p.name === 'enableAuth');
			expect(authProperty).toBeDefined();
			expect(authProperty!.type).toBe('boolean');
			expect(authProperty!.default).toBe(false);

			// Check userAccounts property
			const accountsProperty = properties.find((p) => p.name === 'userAccounts') as any;
			expect(accountsProperty).toBeDefined();
			expect(accountsProperty!.type).toBe('fixedCollection');
			expect(accountsProperty!.typeOptions).toEqual({ multipleValues: true });
			expect(accountsProperty!.default).toEqual({});
			expect(accountsProperty!.options).toHaveLength(1);

			const accountValues = (accountsProperty as any)!.options[0].values;
			const usernameProperty = accountValues.find((p: any) => p.name === 'username');
			const passwordProperty = accountValues.find((p: any) => p.name === 'password');

			expect(usernameProperty).toBeDefined();
			expect(usernameProperty!.type).toBe('string');
			expect(usernameProperty!.default).toBe('');

			expect(passwordProperty).toBeDefined();
			expect(passwordProperty!.type).toBe('string');
			expect(passwordProperty!.typeOptions).toEqual({ password: true });
			expect(passwordProperty!.default).toBe('');

			// Check allowInsecure property
			const insecureProperty = properties.find((p) => p.name === 'allowInsecure');
			expect(insecureProperty).toBeDefined();
			expect(insecureProperty!.type).toBe('boolean');
			expect(insecureProperty!.default).toBe(false);
			expect(insecureProperty!.displayOptions).toEqual({
				show: {
					tlsMode: ['starttls'],
				},
			});

			// Check the plaintext warning
			const offNoticeProperty = properties.find((p) => p.name === 'tlsOffNotice');
			expect(offNoticeProperty).toBeDefined();
			expect(offNoticeProperty!.type).toBe('notice');
			expect(offNoticeProperty!.displayOptions).toEqual({
				show: {
					tlsMode: ['off'],
				},
			});

			// Check the TLS credential/test certificate guidance
			const credentialNoticeProperty = properties.find((p) => p.name === 'tlsCredentialNotice');
			expect(credentialNoticeProperty).toBeDefined();
			expect(credentialNoticeProperty!.type).toBe('notice');
			expect(credentialNoticeProperty!.displayOptions).toEqual({
				show: {
					tlsMode: ['starttls', 'implicit'],
				},
			});
			expect(credentialNoticeProperty!.displayName).toContain(
				'https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user#generating-a-test-certificate',
			);
		});

		test('should reference the TLS credential only when TLS is enabled', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.credentials).toEqual([
				{
					name: 'smtpServerTlsApi',
					required: true,
					displayOptions: {
						show: {
							tlsMode: ['starttls', 'implicit'],
						},
					},
				},
			]);
		});

		test('should only show user accounts when authentication is enabled', () => {
			const description: INodeTypeDescription = node.description;
			const properties = description.properties;
			const accountsProperty = properties.find((p: any) => p.name === 'userAccounts');

			expect(accountsProperty!.displayOptions).toEqual({
				show: {
					enableAuth: [true],
				},
			});
		});
	});

	describe('User Account Parsing', () => {
		test('should parse multiple accounts from a fixed collection', () => {
			const accounts = parseUserAccounts({
				account: [
					{ username: 'alice', password: 'secret1' },
					{ username: 'bob', password: 'secret2' },
				],
			});

			expect(accounts.size).toBe(2);
			expect(accounts.get('alice')).toBe('secret1');
			expect(accounts.get('bob')).toBe('secret2');
		});

		test('should accept a single account in a fixed collection', () => {
			const accounts = parseUserAccounts({
				account: { username: 'alice', password: 'secret' },
			});

			expect(accounts.size).toBe(1);
			expect(accounts.get('alice')).toBe('secret');
		});

		test('should accept a bare array of accounts', () => {
			const accounts = parseUserAccounts([
				{ username: 'alice', password: 'secret1' },
				{ username: 'bob', password: 'secret2' },
			]);

			expect(accounts.size).toBe(2);
			expect(accounts.get('bob')).toBe('secret2');
		});

		test('should accept a bare account object', () => {
			const accounts = parseUserAccounts({ username: 'alice', password: 'secret' });

			expect(accounts.get('alice')).toBe('secret');
		});

		test('should return an empty map for empty input', () => {
			expect(parseUserAccounts(undefined).size).toBe(0);
			expect(parseUserAccounts({}).size).toBe(0);
			expect(parseUserAccounts({ account: [] }).size).toBe(0);
		});

		test('should throw when an account has no username', () => {
			expect(() => parseUserAccounts({ account: [{ password: 'secret' }] })).toThrow(
				'Every SMTP account must have a username',
			);
		});

		test('should throw when an account has no password', () => {
			expect(() => parseUserAccounts({ account: [{ username: 'alice' }] })).toThrow(
				'SMTP account "alice" must have a password',
			);
		});

		test('should throw on duplicate usernames', () => {
			expect(() =>
				parseUserAccounts({
					account: [
						{ username: 'alice', password: 'secret1' },
						{ username: 'alice', password: 'secret2' },
					],
				}),
			).toThrow('Duplicate SMTP account username "alice"');
		});

		test('should throw on non-object input', () => {
			expect(() => parseUserAccounts('alice:secret')).toThrow(
				'SMTP user accounts must be a list of accounts with a username and password',
			);
		});

		test('should treat prototype keys as regular usernames', () => {
			const accounts = parseUserAccounts({
				account: [{ username: '__proto__', password: 'secret' }],
			});

			expect(accounts.get('__proto__')).toBe('secret');
			expect(accounts.get('constructor')).toBeUndefined();
		});
	});

	describe('Credential Verification', () => {
		const accounts = parseUserAccounts({
			account: [{ username: 'alice', password: 'secret' }],
		});

		test('should accept valid credentials', () => {
			expect(verifyCredentials(accounts, 'alice', 'secret')).toBe(true);
		});

		test('should reject an invalid password', () => {
			expect(verifyCredentials(accounts, 'alice', 'wrong')).toBe(false);
		});

		test('should reject an unknown username', () => {
			expect(verifyCredentials(accounts, 'bob', 'secret')).toBe(false);
		});

		test('should reject missing credentials', () => {
			expect(verifyCredentials(accounts, undefined, 'secret')).toBe(false);
			expect(verifyCredentials(accounts, 'alice', undefined)).toBe(false);
			expect(verifyCredentials(accounts, 'alice', '')).toBe(false);
		});
	});

	describe('Node Instantiation', () => {
		test('should create node instance', () => {
			expect(node).toBeInstanceOf(SmtpServerMultiUserTrigger);
			expect(node.description).toBeDefined();
		});

		test('should have trigger method', () => {
			expect(typeof node.trigger).toBe('function');
		});
	});

	describe('Parameter Validation', () => {
		test('should validate port parameter', () => {
			const description: INodeTypeDescription = node.description;
			const properties = description.properties;
			const portProperty = properties.find((p: any) => p.name === 'port');

			expect(portProperty!.required).toBe(true);
			expect(portProperty!.type).toBe('number');
		});

		test('should validate host parameter', () => {
			const description: INodeTypeDescription = node.description;
			const properties = description.properties;
			const hostProperty = properties.find((p: any) => p.name === 'host');

			expect(hostProperty!.required).toBe(true);
			expect(hostProperty!.type).toBe('string');
		});

		test('should have optional authentication parameters', () => {
			const description: INodeTypeDescription = node.description;
			const properties = description.properties;
			const authProperty = properties.find((p: any) => p.name === 'enableAuth');
			const accountsProperty = properties.find((p: any) => p.name === 'userAccounts');
			const accountValues = (accountsProperty as any)!.options[0].values;

			expect(authProperty!.required).toBeUndefined();
			expect(accountsProperty!.required).toBeUndefined();
			expect(accountValues.find((p: any) => p.name === 'username').required).toBeUndefined();
			expect(accountValues.find((p: any) => p.name === 'password').required).toBeUndefined();
		});
	});

	describe('Icon and Visual Elements', () => {
		test('should have icon defined', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.icon).toBe('file:icons/smtp-server.svg');
		});
	});

	describe('Node Type Compliance', () => {
		test('should implement INodeType interface', () => {
			expect(node).toHaveProperty('description');
			expect(node).toHaveProperty('trigger');
		});

		test('should be a trigger node', () => {
			const description: INodeTypeDescription = node.description;

			expect(description.group).toContain('trigger');
			expect(description.inputs).toHaveLength(0);
			expect(description.outputs).toHaveLength(1);
		});
	});
});
