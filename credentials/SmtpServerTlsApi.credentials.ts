import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SmtpServerTlsApi implements ICredentialType {
	name = 'smtpServerTlsApi';
	displayName = 'SMTP Server TLS API';
	documentationUrl =
		'https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user#tls-configuration';

	properties: INodeProperties[] = [
		{
			displayName: 'Certificate (PEM)',
			name: 'certificate',
			type: 'string',
			typeOptions: {
				rows: 8,
			},
			default: '',
			required: true,
			description: 'PEM-encoded certificate, including any intermediate certificates',
		},
		{
			displayName: 'Private Key (PEM)',
			name: 'privateKey',
			type: 'string',
			typeOptions: {
				rows: 8,
				password: true,
			},
			default: '',
			required: true,
			description: 'PEM-encoded private key for the certificate',
		},
		{
			displayName: 'Passphrase',
			name: 'passphrase',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'Passphrase for an encrypted private key',
		},
	];
}
