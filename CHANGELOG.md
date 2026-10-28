# Changelog

All notable changes to this project are documented in this file.

## 0.3.0

- Added multi-account SMTP authentication with the **User Accounts** collection.
- Added STARTTLS, implicit TLS (SMTPS), and plaintext TLS modes.
- Added the **SMTP Server TLS API** credential for PEM certificates, private keys, and optional key passphrases.
- Added activation-time validation for missing credentials, invalid PEM data, certificate/key mismatches, encrypted keys, and certificate expiry.
- Renamed the node type to `smtpServerMultiUserTrigger` and the package to `n8n-nodes-smtp-server-multi-user`.
- Added `authenticatedUser` to the emitted email data.
- Added TLS and authentication integration tests.
- Updated documentation with TLS setup, OpenSSL examples, client configuration, and troubleshooting.
