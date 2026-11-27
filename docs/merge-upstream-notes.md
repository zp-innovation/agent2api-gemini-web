# Merging upstream into this fork

This repository is a fork of `BUKOWSKIREAL/magpie-gemini-web` that also serves Agent2API
(`zp-innovation/Agent2API`). Upstream and the fork both fix the same host bugs, so a plain
fast-forward is never possible. This file is the hand-over note for whoever merges the next
upstream release: it lists what the fork changes on purpose, how the last merge was resolved, and
what to run before pushing.

## Remotes and the merge base

| Remote | URL | Role |
| :--- | :--- | :--- |
| `origin` | https://github.com/BUKOWSKIREAL/magpie-gemini-web.git | upstream, read-only for us |
| `fork` | https://github.com/zp-innovation/agent2api-gemini-web.git | ours, the one gk installs from |

The last merge is commit `f77e62f` — "merge: upstream v0.18.0 (873194a) into the fork", parents
`b402ebb` (ours) and `873194a` (upstream v0.18.0). Start the next merge from `873194a`, not from
the older `6fdc899` base the fork originally branched at.

## Use `git merge`, never `git rebase` or `git cherry-pick`

`git rebase origin/main` stops at the very first fork commit and, once that commit is skipped,
deletes `test/login-methods.test.mjs` that the same commit added (modify/delete conflict).
Cherry-picking the fork commits one by one collides in exactly the same place. `git merge
origin/main` instead conflicts in five files only, and every conflict is a local decision:

```
git fetch origin
git switch -c merge/upstream main
git merge origin/main
```

## What the fork changes on purpose

These are the fork-only commits on top of upstream v0.17.0 (`6fdc899`). Keep their behaviour when
resolving a conflict; drop one only when upstream has grown an equivalent.

| Commit | Change | Overlaps upstream? |
| :--- | :--- | :--- |
| `80aef61` | Ask for the Google account in `ask()` instead of declaring an empty `select` | yes — upstream `68b4f99` solves it with `dynamicAskPrompts`; upstream wins |
| `627b6bb` | Package renamed `agent2api-plugin-gemini-web` | no (only `package.json` `name`) |
| `d077a7e` | Provider label `Gemini-web-all · zp` | no |
| `d54d6cc` | Accept a Cookie-Editor JSON export pasted onto one line (`salvageCookiePairs`) | no |
| `8a49d04` | A "paste the cookie" login method | yes — upstream `2e7c3ef`/`28d00fc` add `parseSignInPaste`; both are kept |
| `ace1ecf` | Follow the 302 GitHub answers for a release asset | no |
| `7a0c246` | Retry the binary download through `curl` when the host fetch stalls on that 302 | no |
| `57e9271` | Pin backend `v4.33.0` | no |
| `850a40c`, `f11c471` | `usage` falls back to the account left when the saved backend id is gone, by email | no |
| `324a0ae`, `264231b` | Usage card reports the windows as a percentage of what is left | no |
| `c9a55ab` | Keep the cookie inside the credential so a rebuild can put the account back | no |
| `b402ebb` | Backend data under the mounted volume (`lib/datadir.mjs`), pool matched by email | no |

## The five conflicted files, and how they were resolved

1. `package.json` — keep `"name": "agent2api-plugin-gemini-web"` (the host derives the pack id and
   the provider ids from it; a rename silently creates a second pack and splits the account pool)
   and take upstream's `"version"`.
2. `index.mjs` — the account-index prompt becomes upstream's
   `prompts: dynamicAskPrompts(_input, '选择 Google 账号')`. Do not go back to `prompts: []`: that
   only satisfies Agent2API, while Magpie needs a non-empty list to forward the inputs at all.
3. `lib/studio.mjs` — same replacement, twice.
4. `lib/setup.mjs` — both sides stay: the fork's `looksLikeCookieMaterial` next to upstream's
   `dynamicAskPrompts` / `apiKeyPrompt` / `extractApiKey`. The merge drops the closing brace of the
   first function when both sides append to the same block; re-add it and run `node --check`.
5. `test/setup.test.mjs` — the import line is the union of both sides, the method assertions take
   upstream's `dynamic_prompt` shape while keeping the fork's
   `assert.rejects(method.authorize({}), /还没有选择 Google 账号/)`, and every lookup by position
   (`auth.methods[2]`) becomes a lookup by label — the fork has four login methods, upstream three.

### The merge that looked like a semantic break

Four tests in suite 29 failed right after the merge, and none of them was a real behaviour change:
the resolved `index.mjs` had lost `parseCookieInput` from its import list. `healManaged` calls it,
the `ReferenceError` was swallowed by `.catch(() => null)`, so the pool was never refilled and the
card stayed red. **After resolving any conflict in `index.mjs`, diff its import list against
`git show origin/main:index.mjs` and against every name the file calls.**

## Upstream contracts to keep

- `dynamicAskPrompts(input, message)` returns `[]` when `input?.project?.id === 'agent2api'` and one
  lazy `{ type: 'text', key: 'dynamic_prompt', optional: true, condition: () => false }` otherwise.
  Magpie only forwards the inputs of a method whose `prompts` is non-empty, which is why the lazy
  field exists at all.
- `apiKeyPrompt` uses `type: 'password'`; `test/login-methods.test.mjs` allows `password` in its
  prompt-type list.
- `test/helpers/host-login-contract.mjs` (`emptyStaticSelects`, `resolvePrompts`, `retainAnswered`,
  `magpiePassesInputs`) is the shared guard that a login method works on both hosts — new methods
  should go through it rather than asserting the shape by hand.

## Before pushing

```
node --test test/setup.test.mjs      # must be fully green (44 tests as of f77e62f)
node --test test/*.test.mjs          # 384 tests: two known Windows-only failures in
                                     # test/cleanup.test.mjs ('isPluginInMagpie distinguishes…',
                                     # 'registerMagpieCleanup exposes handle.pid…'), green on CI
npm run check                        # guardrails: layering, no raw kill(pid, 0), LF endings
npm run interrogate -- --run         # mapped checks + pack dry-run
```

Then `git push fork main`, and roll gk (see below).

## Rolling gk

gk is the Agent2API host at `http://192.168.10.10:3065`; the plugin is pack
`script-50e8f8a77a0cf678daa0961e` installed from `github:zp-innovation/agent2api-gemini-web#main`.

1. Log in: `GET /api/panel/captcha` returns `{algorithm, challenge, maxnumber, salt, signature}`;
   brute-force `n` with `sha256(salt + n) === challenge`, then `POST /api/panel/login?auth-mode=body`
   with `{username, password, captcha: base64(JSON.stringify(captcha))}`; send `x-panel-token`
   afterwards.
2. codeload caches `ref=main`, so install the commit first and `#main` second:
   `POST /api/plugins/scripts/install {"source":"github:zp-innovation/agent2api-gemini-web#<sha>","trusted":true}`,
   wait for `startup.phase === "ready"`, then the same call with `#main` so `source.ref` goes back to
   `main` and the update channel keeps working.
3. `POST /api/models/refresh`, then `GET /v1/models` must list `gemini-4-hydrogen` and
   `gemini-4-neon`, and a `POST /v1/chat/completions` to each must answer 200.
4. Watch the backend pool for a few minutes (`GET /admin/api/cookies` inside the container, header
   `Authorization: Bearer <adminToken>` from
   `/data/plugin-data/magpie-gemini-web/secrets.json`): a growing pool means a heal loop, not a
   sign-in.

## Commit hygiene

`git add -A` will commit a stray `.commit-msg.txt`; write the message to a file and pass
`git commit -F` instead of a PowerShell heredoc, which eats the newlines.
