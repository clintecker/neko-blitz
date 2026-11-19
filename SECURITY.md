# Security

## Reporting

Use GitHub's **Security → Advisories → Report a vulnerability** for a private report when private vulnerability reporting is enabled. If that option is unavailable, contact the maintainer through the contact method on the [clintecker profile](https://github.com/clintecker). A public issue may request a private reporting channel without disclosing exploit details.

Include the affected commit, impact, a minimal reproduction, and whether the problem involves client state, room authorization, hidden-card disclosure, or concurrent updates. Redact real tokens and personal information. The project has no guaranteed response or patch timeline.

## Supported source

Security fixes target the default branch. Older deployments and forks should update to a patched commit or carry the relevant fix.

## Current boundaries

Solo games and mixer preferences live in browser storage. Online rooms store game state in D1. Seat tokens are randomly generated, their hashes are stored server-side, and a token is required to retrieve a player's private view. The room code alone grants no existing seat's private hand. Keep invite links and tokens out of logs and screenshots.

The server validates turns and writes using a revision comparison. Hidden cards stay in the server-owned table and are filtered by `projectTable()` before sending a view to a player. Clients and bots must use the appropriate public view for inference.

This implementation has no account-based identity system or built-in request rate limiting. Operators of an internet-facing fork should provide transport security, abuse controls, and a retention policy appropriate to their deployment. Rooms expire after 48 hours, and cleanup is opportunistic when rooms are created.

Dependency updates and automated checks help maintain the project. They do not constitute a security audit.
