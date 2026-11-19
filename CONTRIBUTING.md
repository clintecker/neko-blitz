# Contributing

Bug reports, focused fixes, accessibility improvements, and strategy-model improvements are welcome.

## Before changing code

Read the [rules](docs/RULES.md) and [architecture](docs/ARCHITECTURE.md). Rule changes affect the UI, bots, coach, research fixtures, and server. Discuss substantial changes in an issue before implementing them.

Follow the setup in the [development guide](docs/DEVELOPMENT.md). Make one focused change per pull request and explain its visible effect and validation.

## Validation

Run these commands before submitting a pull request.

```sh
npm test
npm run build
```

For UI changes, check a 320-pixel-wide phone, a larger portrait phone, landscape, and tablet-sized viewports. Test the actual tap targets, keyboard focus, text enlargement, and reduced-motion preference. Include screenshots for visible changes. For audio changes, verify mute, music enablement, interrupted playback, and an actual audible output after a gesture.

Add a regression test when fixing a rules, privacy, concurrency, or persistence bug. Reuse the existing engine and state projections. A room retry must preserve card conservation and avoid advancing a turn twice.

## Source and assets

Commit authored source, lockfile updates when dependencies change, required migrations, and relevant docs. Generated builds, credentials, room tokens, local databases, logs, and runtime directories are ignored. Keep source changes readable and avoid unrelated formatting.

Record the creator, source, and license of new artwork, fonts, sounds, and copied code in the asset guide or third-party notices. For AI-assisted work, describe the contribution and review it for correctness and provenance before submitting it.

## Reports and reviews

Use the bug report or feature request templates. Include the browser, operating system, screen size, steps to reproduce, and expected behavior. Redact room links, room codes, tokens, and private screenshots.

Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Contributions are accepted under the project's MIT license unless a file carries a different license. Retain existing notices. No contributor license agreement is required.
