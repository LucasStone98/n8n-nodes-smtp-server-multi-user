# n8n SMTP Server Multi-User Node

> **Unmaintained fork:** This project is a fork of [alexrster/n8n-nodes-smtp-server](https://github.com/alexrster/n8n-nodes-smtp-server), made using **DeepSeek V4.1 Flash**. It has no real plans to be kept updated. For the original project, see its [GitHub repository](https://github.com/alexrster/n8n-nodes-smtp-server) and [npm package](https://www.npmjs.com/package/n8n-nodes-smtp-server).

[![CI](https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/n8n-nodes-smtp-server-multi-user.svg)](https://www.npmjs.com/package/n8n-nodes-smtp-server-multi-user)

A custom n8n node that starts an SMTP server and triggers workflows when emails are received. This node allows you to receive emails directly into your n8n workflows, enabling powerful email automation scenarios. Authentication supports multiple SMTP accounts, each with its own username and password. STARTTLS and implicit TLS (SMTPS) are supported with a server certificate stored in an n8n credential.

## Features

- 🚀 **SMTP Server**: Starts a lightweight SMTP server to receive emails
- 📧 **Email Parsing**: Automatically parses incoming emails with full metadata
- 🔐 **Multi-User Authentication**: Configure any number of SMTP accounts, each with its own username and password
- 🔒 **TLS**: STARTTLS or implicit TLS (SMTPS) with a certificate and private key credential
- 📎 **Attachment Support**: Handles email attachments with metadata
- 🔄 **Workflow Triggers**: Triggers n8n workflows with parsed email data
- 🛡️ **Security**: Configurable security options for production use

## Installation

### From npm (Recommended)

```bash
npm install n8n-nodes-smtp-server-multi-user
```

### From Source

```bash
git clone https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user.git
cd n8n-nodes-smtp-server-multi-user
npm install
npm run build
```

## Usage

### Basic Setup

1. **Add the node to your n8n instance:**
   - If installed via npm: The node will appear automatically in the trigger nodes list
   - If built from source: Copy the `dist` folder to your n8n custom nodes directory

2. **Configure the SMTP Server:**
   - Set the port (default: 2525)
   - Set the host (default: 0.0.0.0)
   - Choose a TLS mode and select an **SMTP Server TLS API** credential when TLS is enabled
   - Enable authentication and add one or more user accounts if needed
   - Set security options

3. **Connect to your workflow:**
   - The node will trigger your workflow whenever an email is received
   - Email data is available in the workflow execution

### Configuration Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **Port** | Number | 2525 | Port to listen on for SMTP connections |
| **Host** | String | 0.0.0.0 | Host to bind the SMTP server to |
| **TLS Mode** | Options | STARTTLS | STARTTLS, Implicit TLS (SMTPS), or Off (plaintext) |
| **Minimum TLS Version** | Options | TLS 1.2 | Minimum TLS version accepted for encrypted connections |
| **Allow Authentication Without TLS** | Boolean | false | Whether to allow authentication before STARTTLS is established |
| **Enable Authentication** | Boolean | false | Whether to enable SMTP authentication |
| **User Accounts** | Fixed Collection | - | SMTP accounts allowed to authenticate; each entry has a username and a password |

The **SMTP Server TLS API** credential is separate from the node parameters and holds the certificate, private key, and optional key passphrase. The credential field is shown and required whenever **TLS Mode** is **STARTTLS** or **Implicit TLS**; it is hidden when **TLS Mode** is **Off**.

#### User Accounts

When **Enable Authentication** is on, add one **User Accounts** entry per SMTP client. Each entry has:

- **Username**: the username the client authenticates with
- **Password**: the matching password (masked in the editor)

All configured accounts can connect, and each account's password is checked independently. At least one account is required when authentication is enabled; activation fails with an error if the list is empty, an entry is incomplete, or a username is duplicated.

Internally the accounts are stored in the node parameters as:

```json
{
  "account": [
    { "username": "alice", "password": "secret1" },
    { "username": "bob", "password": "secret2" }
  ]
}
```

### TLS Configuration

TLS is configured with the **SMTP Server TLS API** credential. Add the credential in n8n and provide:

- **Certificate (PEM)**: the server certificate, including intermediate certificates if needed
- **Private Key (PEM)**: the matching private key (masked)
- **Passphrase**: only for an encrypted private key

PEM certificate/key pairs are supported; PFX/PKCS#12 files should be converted to PEM first.

The credential keeps the private key out of the workflow JSON. n8n encrypts credentials with its encryption key.

#### TLS Modes

| Mode | Typical port | Behavior |
|------|--------------|----------|
| **STARTTLS** | 2525 or 587 | Client connects in plaintext and upgrades with STARTTLS before authenticating |
| **Implicit TLS (SMTPS)** | 465 | TLS starts immediately when the client connects |
| **Off (Plaintext)** | 2525 | No TLS. SMTP traffic and credentials are sent unencrypted |

When **TLS Mode** is **STARTTLS**, **Allow Authentication Without TLS** controls whether AUTH is accepted before the client upgrades:

- **Off** (recommended): plaintext AUTH is rejected with `538 Must issue a STARTTLS command first`
- **On**: AUTH is accepted before STARTTLS

When **TLS Mode** is **Implicit TLS**, authentication is always encrypted. When **TLS Mode** is **Off**, authentication is always plaintext and the node shows a warning.

#### Generating a Test Certificate

n8n does not include a built-in certificate generator. Create the certificate outside n8n with OpenSSL (or obtain one from a trusted CA), then paste the generated PEM files into the **SMTP Server TLS API** credential.

For local testing, create a self-signed certificate with a subject alternative name that matches the hostname your client uses:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout smtp-key.pem -out smtp-cert.pem -days 365 \
  -subj "/CN=mail.example.com" \
  -addext "subjectAltName=DNS:mail.example.com,IP=192.0.2.10"
```

Paste `smtp-cert.pem` and `smtp-key.pem` into the credential. For production, use a certificate issued by a trusted CA such as Let's Encrypt.

#### Client Examples

STARTTLS with Nodemailer:

```js
const nodemailer = require('nodemailer');
const fs = require('fs');

const transport = nodemailer.createTransport({
  host: 'mail.example.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: 'alice', pass: 'secret1' },
  tls: { ca: fs.readFileSync('smtp-cert.pem') },
});
```

Implicit TLS with Nodemailer:

```js
const transport = nodemailer.createTransport({
  host: 'mail.example.com',
  port: 465,
  secure: true,
  auth: { user: 'alice', pass: 'secret1' },
  tls: { ca: fs.readFileSync('smtp-cert.pem') },
});
```

Test STARTTLS with OpenSSL:

```bash
openssl s_client -starttls smtp -connect mail.example.com:587 -CAfile smtp-cert.pem
```

If the certificate is trusted by the operating system, clients do not need the `ca` option. In containers, `NODE_EXTRA_CA_CERTS=/path/to/smtp-cert.pem` can add a private CA to Node.js. Do not use `rejectUnauthorized: false` in production.

### Breaking Changes in 0.3.0

Version 0.3.0 replaces the single **Username**/**Password** fields with the **User Accounts** collection, renames the node type to `smtpServerMultiUserTrigger`, and adds TLS support. **TLS Mode** defaults to **STARTTLS**, so an **SMTP Server TLS API** credential is required by default. Select **Off** if you need plaintext SMTP. The old **Allow Insecure** option is now **Allow Authentication Without TLS** and defaults to off. Workflows built against `n8n-nodes-smtp-server` 0.2.x need to be recreated or have their node replaced after installing this package.

### Email Data Structure

When an email is received, the workflow is triggered with the following data structure. `authenticatedUser` holds the SMTP account used to submit the message, or an empty string if the client did not authenticate.

```json
{
  "authenticatedUser": "alice@example.com",
  "subject": "Email Subject",
  "to": "recipient@example.com",
  "from": "sender@example.com",
  "body": "Email body text",
  "html": "<html>Email HTML content</html>",
  "text": "Plain text email content",
  "date": "2024-01-15T10:30:00.000Z",
  "messageId": "<message-id@example.com>",
  "attachments": [
    {
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "size": 1024
    }
  ],
  "headers": {
    "received": "...",
    "date": "...",
    "from": "...",
    "to": "...",
    "subject": "..."
  },
  "raw": "Raw email content"
}
```

## Use Cases

### 1. Email Support Automation
- Receive support emails and automatically create tickets
- Route emails to different teams based on content
- Auto-respond with confirmation messages

### 2. Form Submissions
- Receive form submissions via email
- Process and store form data
- Send confirmation emails

### 3. Email Monitoring
- Monitor specific email addresses for keywords
- Trigger alerts based on email content
- Archive important emails automatically

### 4. Integration Workflows
- Bridge email systems with other services
- Convert emails to tasks, events, or notifications
- Sync email data with databases or CRMs

## Example Workflows

### Basic Email Processing
```
SMTP Server → Email Parser → Database → Notification
```

### Support Ticket Creation
```
SMTP Server → Extract Email Data → Create Ticket → Send Confirmation
```

### Email Filtering
```
SMTP Server → Filter by Subject → Route to Different Teams → Archive
```

## Security Considerations

### Production Deployment

1. **Use Authentication**: Enable SMTP authentication in production and create one account per client
2. **Configure Firewall**: Only allow connections from trusted sources
3. **Use TLS**: Use STARTTLS or implicit TLS with a trusted certificate. Keep **TLS Mode** set to **Off** only for isolated local testing
4. **Monitor Logs**: Keep an eye on server logs for suspicious activity
5. **Regular Updates**: Keep the node and dependencies updated

Passwords are masked in the editor, but they are stored as part of the node parameters in the workflow JSON. Restrict access to workflow exports, the n8n API, and the n8n UI accordingly. TLS private keys are stored in the **SMTP Server TLS API** credential, which n8n encrypts.

### Network Configuration

- **Internal Use**: Bind to localhost (127.0.0.1) for internal use only
- **External Access**: Use proper firewall rules when exposing to the internet
- **Port Selection**: Choose non-standard ports to avoid conflicts

## Development

### Prerequisites

- Node.js 20.x or higher
- npm or yarn
- n8n instance for testing
- OpenSSL for the TLS test suite

### Local Development

```bash
# Clone the repository
git clone https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user.git
cd n8n-nodes-smtp-server-multi-user

# Install dependencies
npm install

# Build the project
npm run build

# Run linting
npm run lint

# Format code
npm run format
```

### Testing

```bash
# Run linting, tests, and build
npm run lint
npm test
npm run build

# Test with n8n (requires n8n to be installed)
npm install -g n8n
npx n8n --help
```

### CI/CD

See [.github/CI-CD.md](.github/CI-CD.md) for the GitHub Actions pipeline documentation.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and build
6. Submit a pull request

## Troubleshooting

### Common Issues

**Node not appearing in n8n:**
- Ensure the node is properly built (`npm run build`)
- Check that the `dist` folder is in the correct location
- Restart n8n after adding the node

**SMTP Server not starting:**
- Check if the port is already in use
- Verify firewall settings
- Ensure proper permissions

**Authentication issues:**
- Verify the account's username and password are correct
- Ensure the account is listed under **User Accounts**
- Check that authentication is enabled and the workflow activated successfully

**TLS errors at activation:**
- Select an **SMTP Server TLS API** credential, or set **TLS Mode** to **Off** for plaintext testing
- Make sure the certificate and private key are PEM-encoded and belong together
- If the private key is encrypted, provide its passphrase

**Client reports a certificate error:**
- Use a certificate issued by a CA the client trusts
- For a self-signed certificate, give the client the certificate as its CA (`tls.ca` in Nodemailer) or set `NODE_EXTRA_CA_CERTS`
- Make sure the certificate subject alternative name matches the hostname used by the client

**Client receives `538 Must issue a STARTTLS command first`:**
- Enable STARTTLS on the client, or turn on **Allow Authentication Without TLS** for trusted networks

**Email parsing errors:**
- Check the email format
- Verify the email content is valid
- Review server logs for details

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

## Dependencies

This node uses external dependencies (`smtp-server` and `mailparser`) that are essential for its core functionality. These dependencies are:

- **Well-maintained** by the Nodemailer team
- **Widely used** in production environments
- **Security audited** with no known critical vulnerabilities
- **Industry standard** for SMTP and email parsing

For detailed information about these dependencies and why they are necessary, see [DEPENDENCIES.md](DEPENDENCIES.md).

## Support

- **Issues**: [GitHub Issues](https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user/issues)
- **Discussions**: [GitHub Discussions](https://github.com/LucasStone98/n8n-nodes-smtp-server-multi-user/discussions)
- **Maintainer**: [LucasStone98](https://github.com/LucasStone98)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes and version history.

## Acknowledgments

- Original project: [alexrster/n8n-nodes-smtp-server](https://github.com/alexrster/n8n-nodes-smtp-server) ([npm](https://www.npmjs.com/package/n8n-nodes-smtp-server))
- Forked and extended by LucasStone98 with DeepSeek V4.1 Flash
- This fork has no real plans to be kept updated
- Uses [smtp-server](https://github.com/nodemailer/smtp-server) for SMTP functionality
- Uses [mailparser](https://github.com/nodemailer/mailparser) for email parsing
