# Backend releases

The plugin's default backend is the official upstream build recorded in `lib/backend-release.json` (`zexadev/gemini-web2api-go` tag `v4.33.0`, commit `928cace`). Six binaries are pinned by SHA-256 in the same JSON file and downloaded from that upstream release; the default build carries no local patch and no version override. The previous optimized channel stopped at `4.31.0`, which predates upstream `4.31.1`: `gemini.google.com` started requiring `OSID` in the cookie, so every account imported into a `4.31.0` backend was answered with a login redirect, counted as an auth failure and auto-disabled after three tries. `scripts/backend-release.mjs` still rebuilds a patched tree (upstream commit + `patches/argon.patch`, version overridden) for the local Argon channel, so a rebuilt binary is not expected to match these upstream pins. The build does not include the developer's uncommitted backend sources, local data or credentials.

For a new backend release:

1. Choose a new backend version and tag in `lib/backend-release.json`. Never replace files under an already published backend tag: older plugins pin those hashes. Update the upstream commit or patch when needed.
2. Run `node scripts/backend-release.mjs --write-pins`. It extracts a clean upstream tree, applies the patch, runs Go tests, cross-compiles all six targets and writes the resulting pins. It uses a local `backend-source` Git object database if available; otherwise it fetches the pinned public commit in a temporary directory.
3. Run `npm test` and `node scripts/backend-smoke.mjs`. The smoke test uses a temporary data directory, checks the actual executable's version and hash, starts it on a spare loopback port, checks authentication and model discovery, and verifies reuse. It uses no Google account and takes the tokenizer's offline fallback.
4. Commit the release metadata, installer changes, tests and documentation. Run the **Verify backend release** GitHub Actions workflow at that commit. It rebuilds on native macOS, Linux and Windows runners for both architectures, compares the pinned hashes, and runs the installation/startup smoke test. Wait for all jobs to pass.
5. Create a private draft under the pinned backend tag. Attach all six binaries, `SHA256SUMS.txt`, `build.json`, the patched source archive and `LICENSE-UPSTREAM` from `backend-build/release`. If local binary uploads are unreliable, run **Upload verified backend release** with the successful verification run ID: it downloads the six CI artifacts, checks every committed hash, and uploads missing executables to the draft. Existing assets must match exactly; published releases cannot be modified by this workflow. Include the upstream commit and patch SHA-256 in the release notes, then publish the complete draft. Keep backend-only releases from replacing the plugin release as GitHub's latest release.
6. Verify public asset downloads against the committed pins. Run `node scripts/backend-smoke.mjs --download` to test the actual default download URL on the host platform.
7. Bump and publish the plugin package only after the backend assets are publicly available. Inspect `npm pack --dry-run`; the npm package contains release metadata and patch/build scripts, but no executables, local databases or credentials. Attach the exact published npm tarball to the plugin's GitHub release as well.

Reproduce a release without changing its pins:

```bash
npm run backend:release:build
```

Build just the host target and compare its hash:

```bash
node scripts/backend-release.mjs --target=host --verify
```

The metadata records `CGO_ENABLED=0`, the exact Go toolchain, upstream commit, patch hash and build flags. The binary hashes are reproducible; the source archive is supplied for inspection and is not promised to have a reproducible gzip timestamp. The source archive includes upstream's license, and `LICENSE-UPSTREAM` is also supplied as a separate asset.

Existing running processes are left alone to avoid interrupting requests. Once an old official backend is stopped, automatic startup installs the pinned build while preserving configuration, secrets and the database. A binary whose hash is not in the pin list is replaced, including a previously installed `4.31.0-magpie.2`; a trusted local build (recorded in `argon-build.json`) is left alone. A download or checksum failure keeps the old file and never starts an unverified replacement.

New cookie imports require the running backend to advertise `capabilities.account_proxy_binding: true` at `/`. The plugin checks this before changing the proxy pool and again before submitting a cookie, so a reused older or upstream backend cannot silently ignore `proxy_id`. Unsupported builds receive instructions to stop the old process and run the installed plugin's CLI with `install --data-dir=<path>`. This explicitly selects the optimized channel, including for previous upstream or custom-build installations. The check does not interrupt existing conversations. Release smoke verifies the capability and actual proxy selection; version strings alone do not establish support.

`npm run backend:install:upstream` and `npm run backend:install` now install the same pinned upstream v4.33.0 assets and persist `upstream` / `optimized` in `backend-channel.json`; the two channel names are kept so existing installs keep working, but both resolve to the official build. Accounts auto-disabled by a `4.31.0` backend come back after the upgrade: `POST /admin/api/cookies/sync` (upstream 4.33) clears the failure counter and re-enables them, and a fresh cookie import does the same. Stop a running backend before replacing it, particularly on Windows. Explicit local Argon builds remain trusted through their existing build manifest.
