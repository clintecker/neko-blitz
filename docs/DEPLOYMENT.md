# Deployment

Cloudflare Workers + D1 is the primary deployment target for the complete application. The game builds a Worker and static client assets. Online rooms require a D1 database bound as `DB`. The public source has one runtime configuration in `wrangler.jsonc` and versioned room migrations in `migrations/`.

## Cloudflare Worker

Authenticate your own account and create the room database.

```sh
npx wrangler login
npx wrangler d1 create neko-blitz
```

In `wrangler.jsonc`, replace the placeholder `database_id` with the returned ID. Choose a unique Worker name and update `database_name` if necessary. Database IDs identify resources and are not API credentials. Keep authentication credentials in Wrangler's credential store or your deployment environment.

Apply the schema, build, and publish the generated Worker.

```sh
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` builds the application and publishes `dist/server` together with `dist/client`. It requires Cloudflare authentication.

Wrangler tracks applied SQL migrations. For later schema changes, add a migration file and apply the outstanding migrations in order. The generated deployment configuration carries the database binding from `wrangler.jsonc`. Rebuild after changing that configuration.

Use the URL returned by deployment. Confirm solo play, room creation, joining from a separate browser session, starting a match, guest departure, and host termination. `dist/client` contains the static assets. GitHub Pages alone cannot run the room API.

## Custom domain and canonical URL

For a hostname in a Cloudflare-managed zone, add a Custom Domain route to `wrangler.jsonc`. Replace this example with your own hostname.

```jsonc
"routes": [
  { "pattern": "blitz.example.com", "custom_domain": true }
]
```

Run `npm run deploy` after changing the configuration. The Worker becomes the origin for that hostname. Keep database bindings and schema migrations consistent across releases. Custom Domain routing is described in the [Cloudflare documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Use the deployed custom domain as the canonical game URL in your repository's website setting and `package.json` homepage. Update the README's hosted-game link to match. Room links use `location.origin`, so invitations created on the new site automatically point there.

The default `workers.dev` address is useful during initial verification. Once the custom domain is working, you can choose whether to retain that additional address through Wrangler's `workers_dev` setting.

## Release verification

Before publishing a change, run the unit suite, TypeScript checks, build, and local production-Worker smoke test.

```sh
npm test
npm run typecheck
npm run build
npm run test:worker
```

The smoke test applies migrations to a temporary D1 database, starts the actual built Worker, and exercises page and asset serving, room creation, joining, private-hand projections, and room termination. It needs no account credentials and cleans up its local state.

After deployment, check the production URL with two browser sessions. Verify that both players see public moves and that a host can end the game for everyone. Apply schema changes compatibly with the currently deployed Worker so database migrations and code releases can be rolled out safely.

## Relationship to the demo

The linked demo is the original OpenAI Sites deployment. This source package is a standalone Worker project. It contains the actual game and its runtime assets, with a portable build configuration and no original hosted-project identity.

A deployment through a different platform must provide the Worker runtime and the `DB` binding used by the room API.

## Operations

The room code is an invitation identifier. Seat bearer tokens are private capabilities. Use HTTPS, avoid logging authorization headers or room bodies, and configure request limiting at the edge of an internet-facing deployment.

Rooms expire after 48 hours. Old-room cleanup is opportunistic on new-room creation. A deployment needing a strict deletion schedule should add an explicit cleanup job. The game has no account-recovery or administrative-room console.

CI verifies source with tests, type checking, and a build. It contains no deployment credentials and does not automatically publish the Worker.
