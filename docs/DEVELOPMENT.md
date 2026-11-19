# Development

## Requirements

Use Node.js 24, npm, and Git. The `.node-version` file records the supported Node major. The game runtime has no Python requirement. Regenerating the original audio samples additionally requires Python, the packages in `requirements-audio.txt`, and ffmpeg.

## Clean setup

From the repository root, install the exact locked dependencies, build the Worker, create the local room table, and start development.

```sh
npm run install:ci
npm run build
npm run db:migrate:local
npm run dev
```

Open the loopback URL printed by the server, normally port 5173 in the portable profile. The migration command creates `blitz_rooms` in the local D1 emulator. Run it once for a new local database. Keep `.wrangler/state` intact to preserve local rooms between restarts.

Solo games work independently of the room database. Their saved hands and audio preferences use browser storage. Clearing that storage resets your local progress and the first-run tutorial flag.

## Commands

| Command | Effect |
| --- | --- |
| `npm run install:ci` | Install from the lockfile with development dependencies |
| `npm run dev` | Run Vite/Vinext with hot reload |
| `npm test` | Run the Node test suite |
| `npm run build` | Generate `dist/client` and the production Worker in `dist/server` |
| `npm start` | Preview the built Worker on loopback |
| `npm run db:migrate:local` | Apply the initial migration to a new local D1 database |
| `npm run db:generate` | Generate a migration after an intentional schema change |
| `npm run lint` | Run the inherited ESLint configuration separately |

The checked CI contract is tests and build. The inherited starter includes supporting UI components and tool integrations that the game does not currently use. Avoid sweeping rewrites of that scaffolding when making a game fix.

## Checks

The suite covers card conservation, payout and tie behavior, bot matches, defensive discards, score variation, pending audio resumes, authenticated room exits, and waiting-seat reuse. Room tests use an in-memory D1 adapter with the real route handler. Browser behavior and real Cloudflare deployment require additional manual verification.

For a visual change, test the lobby, a running hand, the turn animation, and a dialog. Useful viewport sizes are 320 × 568, 390 × 844, 430 × 932, 844 × 390, 820 × 1180, and a desktop viewport. Confirm button centers actually hit their controls, content stays within the viewport, and reduced motion suppresses ambient animation.

## Audio

A browser gesture is required before Web Audio can start. The overall sound switch and the **Arcade music** switch are separate saved preferences. Use **Turn on music** in the lobby or **Game menu → Sound settings**. A silent score can be a disabled saved music switch even when card effects still play.

The mixer exposes playback status, a current chord, and a restart button. After returning from a background tab or a phone interruption, verify the audio itself in addition to the displayed state.

The live score and synth are in `public/game/night-score.mjs` and `night-synth.mjs`. Legacy WAV and loop assets remain in `public/audio/`. To regenerate those optional samples, create a Python virtual environment, install `requirements-audio.txt`, and run `python scripts/render_blitz_audio.py`. That script does not export the current live procedural arrangement.

## Execution profiles

A clean clone defaults to the portable profile. It uses the existing host environment and does not require an installed Sites plugin. The original managed Linux workflow records its profile in ignored `.sites-runtime/execution-profile.json`. That local selection should not be committed.

`npm start` runs the built Worker locally and uses the same `.wrangler/state` directory as the development configuration. It does not publish the game.

## Troubleshooting

If an online request fails because `blitz_rooms` does not exist, build and apply the local migration. If local data is disposable, deleting `.wrangler/state` creates a fresh database, after which the migration must be applied again.

If port 5173 is occupied, pass `npm run dev -- --port 5174`. Use the URL the server prints.

If dependencies change, update `package.json` and `package-lock.json` together and reinstall before checking the build. Optional native packages must be installed for the host platform.
