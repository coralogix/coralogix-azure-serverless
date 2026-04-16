Check whether this PR is complete and ready to ship — commits, CHANGELOG, package.json, and ARM templates all consistent and correct before merging.

## Step 0 — Identify changed packages

Find every package touched on this branch:
```bash
git diff master...HEAD --name-only | grep -oE '^[^/]+' | sort -u
```

Also auto-discover which packages use semantic-release vs manual versioning:
```bash
# semantic-release packages
find . -name "release.config.js" -not -path "*/node_modules/*" | sed 's|/release.config.js||;s|^\./||' | sort

# all packages (any directory with a package.json at depth 1)
find . -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" | sed 's|/package.json||;s|^\./||' | sort
```

Intersect the two lists: focus only on packages that are both changed on this branch AND have a package.json.

---

## Step 1 — Find the last released tag for each changed package

### Semantic-release packages (have release.config.js)

Read the `tagFormat` from the package's `release.config.js` to know the tag prefix:
```bash
grep tagFormat <package>/release.config.js
# e.g. tagFormat: 'EventHub-v${version}' → prefix is 'EventHub-v'
```

Then find the last tag:
```bash
git tag | grep "^<tag-prefix>" | sort -V | tail -1
# e.g. git tag | grep "^EventHub-v" | sort -V | tail -1
```

### Manual packages (no release.config.js)

Use the current package.json version as the baseline:
```bash
node -p "require('./<package>/package.json').version"
```

---

## Step 2 — List commits since last tag

```bash
# commits on this branch (not yet on master)
git log master...HEAD --oneline -- <package>/

# commits already on master since last tag (may include missed releases)
git log <last-tag>..master --oneline -- <package>/
```

If `git log master...HEAD` is empty, the branch has no new commits. Check Step 2b for missed releases already on master.

---

## Step 3 — Classify commits and compute expected next version

### Conventional commit spec (colon required, not a dash)

| Commit message | Valid? | Version bump |
|----------------|--------|--------------|
| `feat(scope): description` | yes | **minor** (X.Y.0) |
| `fix(scope): description` | yes | **patch** (X.Y.Z+1) |
| `perf(scope): description` | yes | **patch** |
| `revert(scope): description` | yes | **patch** |
| `chore/docs/ci/test/refactor/build(scope): description` | yes | **none** |
| Any commit body with `BREAKING CHANGE: description` | yes | **major** (X+1.0.0) |
| `fix(scope) - description` (dash not colon) | **INVALID** | none — silently ignored |
| `Foo Bar: description` (space in type) | **INVALID** | none — silently ignored |
| Free-form message | **INVALID** | none |

### Compute expected next version

Starting from the last tag version:
- Any `BREAKING CHANGE:` in any commit body → major bump
- Otherwise, any `feat:` → minor bump
- Otherwise, any `fix:/perf:/revert:` → patch bump
- Only `chore/docs/ci/test` → no release

For **manual packages**: the developer controls the version — check that package.json is bumped relative to the baseline and follows semver.

---

## Step 4 — Check CHANGELOG.md

The CI `Changelog.yaml` workflow **will block the PR** if no CHANGELOG entry is present (unless the PR has the `skip changelog` label).

Check what changed:
```bash
git diff master...HEAD -- <package>/CHANGELOG.md
```

Verify:
- There is a new `### X.Y.Z / DD Mon YYYY` entry matching the expected version
- The date is correct (today's date)
- The entry describes the actual changes in this PR
- The format matches existing entries (`[FEATURE]`, `[FIX]`, `[UPDATE]`, `[CI]` tags)

If no CHANGELOG update exists, the PR cannot merge. Draft the required entry.

---

## Step 5 — Check package.json version

```bash
node -p "require('./<package>/package.json').version"
```

- **Semantic-release package**: should match the expected next version computed in Step 3. Even though semantic-release does not auto-commit this file, the version field should be kept in sync manually so it reflects the current state.
- **Manual package**: should be bumped vs the previous release following semver rules.

If the version is wrong, show the exact change needed in `package.json`.

---

## Step 6 — Check ARM template version URLs (EventHub and BlobToOtel only)

These packages embed a hardcoded GitHub Releases download URL in their ARM templates. If not updated, users deploying fresh will get the **old version** even after a new release is cut.

```bash
grep -r "releases/download" <package>/ARM/
```

The URL pattern is:
```
https://github.com/coralogix/coralogix-azure-serverless/releases/download/<Package>-v<VERSION>/<Package>-FunctionApp.zip
```

Verify the version in the URL matches the **expected next version** from Step 3. If it does not match, show the exact line that needs updating and the corrected URL.

---

## Step 7 — Handle missed releases already on master

If any commit is already on master since the last tag but has an invalid format (e.g. dash instead of colon), it will never trigger a release. To fix:

```bash
# Add an empty trigger commit with the corrected message
git commit --allow-empty -m "fix(EventHub): fix boolean for include metadata"
```

This new commit, once merged, will cause semantic-release to compute the correct version bump and cut the missed release. The CHANGELOG, package.json, and ARM template URL should also be updated in the same PR.

---

## Step 8 — Final readiness checklist

Report a per-package checklist. Example for a patch release:

**EventHub** → expected release: `v3.8.1`
- [ ] Valid release-triggering commit exists: `fix(EventHub): <description>`
- [ ] CHANGELOG.md contains `### 3.8.1 / <date>` with accurate release notes
- [ ] `EventHub/package.json` version is `"3.8.1"`
- [ ] `EventHub/ARM/EventHubV2.json` `packageUri` points to `EventHub-v3.8.1`

If any item is missing, explain exactly what to add/change and provide the corrected content or command.

If **no release will be triggered** (only `chore/ci/docs` commits), confirm whether this is intentional. If not, identify which commits need to be reworded.
