# Importing into GitHub

This ZIP contains the complete prepared source tree. It includes hidden GitHub configuration, the lockfile, project licenses, original game assets, and documentation. Dependencies, build output, local databases, credentials, and Git history are excluded.

## Create the repository

Create a public repository named `neko-blitz` under `clintecker`. Leave GitHub's automatic README, license, and gitignore initialization disabled because this package includes those files.

From the extracted `neko-blitz` directory, initialize and push the source using your normal local GitHub authentication.

```sh
git init -b main
git add .
git commit -m "Initial BLITZ source release"
git remote add origin https://github.com/clintecker/neko-blitz.git
git push -u origin main
```

Use your own configured Git author name and email. GitHub's CLI, SSH, or credential manager can provide authentication. Keep credentials out of the remote URL and source files.

If the repository already contains a commit, clone that repository first, copy this package's contents into the clone, and commit normally. Include the `.github` directory and other hidden source files. Review existing files before replacing them.

## Repository settings

Set the website to the live demo URL in the README. A suggested description is “A neon Thirty-One card club with table-reading bots, online friends, and an evolving synth soundtrack.” Suitable topics include `card-game`, `thirty-one`, `react`, `web-audio`, and `cloudflare-workers`.

After the first push, check the Actions tab for the included CI workflow. It installs from the lockfile, runs the tests and TypeScript checks, builds the Worker, and exercises it with local D1 with read-only repository permissions. Its hosted result can only be verified after the repository exists and Actions runs.

The included Dependabot configuration proposes npm and GitHub Actions updates weekly. CODEOWNERS requests review from `clintecker`. Add branch rules requiring pull-request review and a passing **Test and build** check once that check has run, if that fits your workflow.

Enable private vulnerability reporting under Security settings so SECURITY.md's preferred reporting route is available. The source package does not enable settings on a GitHub account or automatically deploy the live game.

## Local verification

Follow the [development guide](DEVELOPMENT.md) before making changes. The package was checked with a clean locked dependency install, the complete test suite, TypeScript checks, a production build, versioned local D1 migrations, and a built-Worker smoke test.

[The deployment guide](DEPLOYMENT.md) covers publishing a separate Worker or creating a new Site. The runtime configuration is in `wrangler.jsonc`.
