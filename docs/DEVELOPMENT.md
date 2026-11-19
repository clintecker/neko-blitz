# Development

## Requirements and setup

Use Node.js 24, npm, and Git. The `.node-version` file records the supported Node major. All music and sound effects are synthesized in the browser, so there are no Python or audio-rendering dependencies.

From the extracted source directory, install the locked dependencies, apply the room database migration, and start development.

```sh
npm run install:ci
npm run db:migrate:local
npm run dev
```

Open the loopback URL printed by Vite, normally port 5173. The migration creates `blitz_rooms` in the local Cloudflare D1 emulator. Local development requires no Cloudflare login or API credentials.

Keep `.wrangler/state` to preserve local rooms between restarts. Solo hands and audio preferences live in browser storage. Clearing that storage resets local progress and the first-run tutorial flag.

## Commands

| Command | Effect |
| --- | --- |
| `npm run install:ci` | Install from the lockfile, including development and optional dependencies |
| `npm run dev` | Run Vite/Vinext with hot reload |
| `npm test` | Run the Node test suite |
| `npm run test:worker` | Exercise a built Worker and a temporary real D1 database |
| `npm run deploy` | Build and publish the full app to your authenticated Cloudflare account |
| `npm run typecheck` | Check TypeScript entry points and configuration |
| `npm run build` | Build `dist/client` and the Worker in `dist/server` |
| `npm start` | Preview the built Worker on loopback |
| `npm run db:migrate:local` | Apply outstanding SQL migrations to local D1 |
| `npm run db:migrate:remote` | Apply outstanding SQL migrations to the configured remote D1 |

The remote migration command requires a real database ID and Cloudflare authentication. The placeholder database ID in `wrangler.jsonc` supports local emulation.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run test:worker
```

CI runs these checks after a clean install. The test suite covers card conservation, payout and tie behavior, bot matches, defensive discards, score variation, pending audio resumes, authenticated room exits, and waiting-seat reuse. Unit-level room tests use an in-memory D1 adapter with the real route handler. The separate Worker smoke test starts the built application with a temporary local D1 database and verifies its HTTP routes. Type checking covers TypeScript files. The JavaScript game engine is verified by the tests.

For a visual change, test the lobby, a running hand, turn animations, and a dialog. Useful viewport sizes are 320 × 568, 390 × 844, 430 × 932, 844 × 390, 820 × 1180, and a desktop viewport. Check tap targets, keyboard focus, text enlargement, and reduced motion.

## Database changes

The application uses D1's SQL interface directly. Versioned SQL files in `migrations/` are applied by Wrangler, which records their application in the local or remote database. Add a new numbered migration for a schema change. Preserve existing data and apply migrations in order.

The first migration uses `CREATE TABLE IF NOT EXISTS` so an existing room table from the earlier source package can be adopted. Running the migration command again skips already-applied migrations.

## Audio

A browser gesture is required before Web Audio can start. Overall sound and **Arcade music** are separate saved preferences. Use **Turn on music** in the lobby or **Game menu → Sound settings**. A disabled music switch can leave the score silent while card effects still play.

The mixer exposes playback status, the current chord, and a restart button. After backgrounding or a phone interruption, verify the audio itself in addition to its displayed state.

The score and instruments are implemented in `public/game/night-score.mjs` and `night-synth.mjs`. Update those sources to change the soundtrack. No pre-rendered music files are required.

## Built preview

```sh
npm run build
npm start
```

The built Worker uses the same `.wrangler/state` directory and D1 binding as development. This command runs locally and does not publish the game.

If the default port is occupied, pass `npm run dev -- --port 5174`. If a room request reports a missing `blitz_rooms` table, apply the local migration. After intentionally resetting disposable `.wrangler/state`, apply the migrations again.

Update `package.json` and `package-lock.json` together when changing dependencies, then reinstall before checking the build. Optional native packages must match the host platform.
