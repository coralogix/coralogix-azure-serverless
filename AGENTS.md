# AGENTS.md

## What this repo contains

Five independent Azure Function apps that ship telemetry from Azure to Coralogix. Each lives in
its own top-level directory with its own `package.json`, tests, and ARM deployment template —
treat them as separate projects, not a shared workspace:

- `EventHub` — streams Event Hub messages (e.g. Azure Diagnostic Settings) to Coralogix via OTLP.
- `BlobToOtel` — reads blobs (e.g. exported logs) and forwards them via OTLP.
- `BlobViaEventGrid` — triggered by Event Grid on blob creation, forwards blob contents.
- `StorageQueue` — triggered by Azure Storage Queue messages, forwards them via the legacy
  `coralogix-logger` SDK.
- `DiagnosticData` — processes Azure Diagnostic Data events.

Each package directory has this shape:
- `<Package>/` — TypeScript source (the function code).
- `<Package>/tests/` — unit tests (Jest) and, for some packages, an `e2e.sh` used by CI's
  `e2e.yaml` workflow to deploy and exercise the real ARM template against Azure.
- `<Package>/ARM/` — the ARM template used for customer deployment.

Root `README.md` is just an index into each package's own README — package-specific setup,
config, and deployment docs live there, not at the root.

## Working in a package

Always `cd` into the package you're changing before running scripts — there is no root
`package.json`. Standard scripts per package (see that package's `package.json` for the exact
set):

```
npm install
npm run lint     # eslint
npm run build    # lint + tsc
npm test         # jest, where tests exist
npm run start    # func start, for local execution
```

Only touch the one package relevant to your change unless the task explicitly spans several —
CI (`build.yaml`, `release.yaml`) builds/tests/releases each package independently based on
which directory changed, and cross-package edits make that harder to review and bisect.

## Testing

- Add or update Jest unit tests under `<Package>/tests/` for any behavior change. `EventHub`
  is the reference for a full unit-test setup (`ts-jest`, `testMatch: **/*.test.ts`) — follow
  its conventions if a package doesn't have tests yet rather than inventing a new pattern.
  `BlobViaEventGrid`, `StorageQueue`, `DiagnosticData`, and `BlobToOtel` currently have no unit
  tests wired into `npm test` — if you add meaningful logic there, add real tests and wire up
  `npm test` (don't leave the `echo "No tests yet..."` placeholder once there's something to test).
- Run `npm run build` and `npm test` in the package before considering a change done.
- End-to-end tests (`tests/e2e.sh`) deploy real Azure resources and only run in CI against
  secrets that aren't available locally in most environments — don't attempt to run them
  unless you have Azure credentials configured for this repo. If unsure, say so rather than
  claiming e2e coverage you didn't actually verify.

## Code style

- TypeScript, linted with ESLint (`eslint.config.mjs` per package) and formatted with Prettier
  where configured (`EventHub` has an explicit `format` script). Run `npm run lint` before
  finishing.
- Match the existing style of the package you're editing rather than introducing new patterns.

## Commits & PRs

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix:`, `feat:`, `ci:`, `chore:`, etc.), matching the existing history — this repo uses
  `semantic-release` for `EventHub` and `BlobToOtel`, so the commit type/scope drives the
  version bump and changelog for those packages.
- Scope each PR to one package where possible. If a PR touches multiple packages, call that
  out explicitly and explain why.
- **Every PR description must include:**
  1. **What changed** — a short summary of the change, referencing the affected package(s).
  2. **Why** — the motivation (bug being fixed, CVE being patched, feature being added).
  3. **How it was tested** — which commands were run (`npm test`, `npm run build`, manual
     `func start` check, etc.) and, if applicable, whether e2e tests were run and where.
  4. **Any follow-up or known limitations**, if applicable.
- Don't claim a test type ran (unit, build, e2e) unless you actually ran it and saw it pass.
