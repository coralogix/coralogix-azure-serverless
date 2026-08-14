# Working in this repository

Five independent Azure Functions that ship logs to Coralogix. Each is its own
deployable, with its own ARM template, version and release. They share a repo,
not a lifecycle: a change to one should neither release nor break another.

| Package | Source | ARM template |
|---|---|---|
| `EventHub` | Event Hub trigger | `ARM/EventHubV2.json` |
| `BlobToOtel` | Event Hub → blob, OTLP out | `ARM/BlobToOtel.json` |
| `BlobViaEventGrid` | Event Grid → blob | `ARM/BlobViaEventGrid.json` |
| `DiagnosticData` | Event Hub, diagnostic settings | `ARM/DiagnosticData.json` |
| `StorageQueue` | Storage queue trigger | `ARM/StorageQueue.json` |

Each package directory holds its TypeScript source, `ARM/` template, `tests/`,
`package.json`, `release.config.js` and `CHANGELOG.md`.

## How a package reaches a customer

A customer clicks **Deploy to Azure** in a package README. That button opens the
Azure portal against the ARM template on **master**, and the template's
`packageUri` names a zip attached to a GitHub release. So master's template is
the live deployment path, and it must always name a release that exists —
Azure will happily deploy a template whose `packageUri` 404s, reporting success
and leaving the function app with no code.

`packageUri` is generated, not written by hand. At release time
`scripts/set-package-uri.js` stamps the version being released into the
template, and that copy is published as the release asset. If it looks wrong,
fix the stamping rather than editing the template.

The checked-in copy on master is a separate matter: master is protected with
`enforce_admins`, so no job can push to it, and nothing updates it
automatically. It keeps naming the previous release — which exists and serves
the package — until someone opens a PR to move it forward. Release assets are
always correct; master's copy lags by design.

Older deployments pull from an S3 bucket, `coralogix-public/azure-functions-repo/`.
It is frozen — still serving existing deployments, no longer published to. Leave
its contents alone.

## Build and release

`.github/workflows/release.yaml` handles all five packages in two jobs:
**detect-changes** works out which packages a change touches, and **build**
runs them in parallel — `npm install`, `npm run test`, `npm run build:production`,
zip, then `semantic-release`.

Whether a package is *built* depends on the files a change touches. Whether it
*releases* is decided separately, by `scripts/analyze-package-commits.js`, so a
change to tests or markdown is still built and tested but publishes nothing.

Versions and notes come from `analyze-package-commits.js` and
`generate-package-notes.js`, which read only the commits touching that package.
`@semantic-release/commit-analyzer` and `release-notes-generator` are
intentionally absent — neither filters by path, and adding either back silently
restores cross-package version bumps, since semantic-release takes the highest
release type any analyzer returns.

## Commits

Conventional commits. The type determines the release:

| Type | Effect |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `revert:`, `Revert "…"` | patch |
| `ci:`, `chore:`, `docs:`, `test:`, `refactor:`, `style:` | none |
| any with `!` or a `BREAKING CHANGE:` footer | major |

A commit releases a package only if it **touches that package's directory**,
excluding `tests/` and markdown. Scope text is documentation, not routing:
`fix(EventHub):` on a change under `.github/` releases nothing, and one commit
touching three packages releases all three. Choose the type for what the change
does — it is an instruction to the release pipeline.

Keep dependency ranges bounded. Prefer `^`; avoid `>=` on anything that can
major-bump, since CI only rebuilds packages that changed and a resolved-in
breaking version can sit unnoticed for months.

## Pull requests

Follow `.github/pull_request_template.md` and keep the description to a few
sentences — what changed, and why. A reviewer should be able to read it in under
a minute.

- Lead with the change and the reason.
- Do not restate the diff.
- Use a table or log excerpt only when it carries something prose cannot: a
  before/after, a failure message, a version matrix.
- Explain reasoning that is not visible in the diff — an ordering constraint, an
  alternative you rejected.
- State what you did not verify.

Under *How Has This Been Tested*, give the command and its output, trimmed to
the lines that matter.

Also:

- Open as **draft** unless it is ready to merge.
- Add a `CHANGELOG.md` entry, or the `skip changelog` label. The gate only
  watches `<Package>/*` — direct children — so changes under `ARM/` or the
  function source pass without one. A green check does not mean no entry is
  needed.
- Branch names are usually `feat/` or `fix/`; some carry a `CDS-####` ticket id,
  which is what `ticket-id-validator` looks for.

## Testing

`npm run test` per package. Only EventHub has real unit tests; the others are
placeholders.

Each package also has `tests/e2e.sh`, which provisions Azure resources with
Terraform, deploys the ARM template, sends data through the function, and polls
Coralogix until it arrives. 

CI runs e2e on `master` only. 
