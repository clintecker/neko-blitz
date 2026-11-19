# Deployment

The app builds a Cloudflare Worker and client assets. Online rooms require a D1 database bound as `DB`. The hosted demo uses OpenAI Sites. A fork can use its own Cloudflare Worker deployment or register a new Site.

## Cloudflare Worker

Use your own Cloudflare account and review the generated configuration before publishing. From a configured checkout, build and create the database.

```sh
npm run build
npx wrangler login
npx wrangler d1 create neko-blitz
```

Copy `wrangler.example.jsonc` to `wrangler.deploy.jsonc`. Replace its placeholder database ID with the returned ID and choose a unique Worker name if necessary. The local deployment file is ignored by Git.

Apply the initial schema to the new remote database and deploy the already-built Worker.

```sh
npx wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file drizzle/0000_broad_energizer.sql
npx wrangler deploy --config wrangler.deploy.jsonc
```

Use the production URL returned by Wrangler. Confirm solo play, creating a room, joining in a separate browser session, starting a match, and ending a room. Initial schema creation runs once for a new database. Manage subsequent migrations in order.

The Worker entry point and module rules in the example match this project's build output. `dist/client` contains the static assets. GitHub Pages alone cannot run the D1 room API.

## OpenAI Sites

Register a new Site using the Sites workflow and add its returned project identifier to `.openai/hosting.json`. Keep the `d1` binding as `DB` and retain the database migration. Build and publish using that Site's source workflow and permissions.

The public export deliberately omits the original game's project identifier. A cloned checkout has no authority to publish over the demo. Refer to the Sites tooling's current instructions for registration, source synchronization, migrations, and deployment.

## Operations

The room code is an invitation identifier. Seat bearer tokens are private capabilities. Use HTTPS, avoid logging request authorization headers or full room bodies, and configure request limiting at your deployment's edge.

Room expiry is 48 hours. Old-room cleanup is opportunistic on new-room creation. A deployment requiring a strict deletion schedule should add an explicit cleanup job. The bundled code has no account recovery or administrative room console.

The CI workflow tests and builds source. It contains no deployment credentials and does not automatically publish a Worker.
