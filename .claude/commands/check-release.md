Check this PR is complete and ready to ship: commits, CHANGELOG, package.json, and ARM templates all aligned.

## Run these checks for every changed package

**1. Find changed packages and their last tag**
```bash
git diff master...HEAD --name-only | grep -oE '^[^/]+' | sort -u
find . -name "release.config.js" -not -path "*/node_modules/*" | sed 's|/release.config.js||;s|^\./||'
git tag | grep "^<Package>-v" | sort -V | tail -1
```

**2. List commits since last tag** (covers both branch commits and missed releases on master)
```bash
git log <last-tag>..HEAD --oneline -- <Package>/
```

**3. Classify each commit** — `type(scope): description` is valid; `type(scope) - description` (dash not colon) is silently ignored by semantic-release. Compute expected next version: `feat` → minor, `fix/perf/revert` → patch, `BREAKING CHANGE:` in body → major, anything else → no release.

**4. Check CHANGELOG** — CI blocks merge without a CHANGELOG update (unless `skip changelog` label).
```bash
git diff master...HEAD -- <Package>/CHANGELOG.md
```
Must have a `### X.Y.Z / DD Mon YYYY` entry matching the expected version.

**5. Check package.json version**
```bash
node -p "require('./<Package>/package.json').version"
```
Must match the expected next version.

**6. Check ARM template URL** (EventHub and BlobToOtel only)
```bash
grep -r "releases/download" <Package>/ARM/
```
URL must reference the expected next version: `.../releases/download/<Package>-v<X.Y.Z>/<Package>-FunctionApp.zip`

**7. If a release-triggering commit is already on master with an invalid format**, it will never fire. Fix with an empty commit:
```bash
git commit --allow-empty -m "fix(<Package>): <description>"
```

## Output

Per-package checklist:
- [ ] Valid release-triggering commit (or no release is intentional)
- [ ] CHANGELOG has `### X.Y.Z / <date>` entry
- [ ] `package.json` version is `X.Y.Z`
- [ ] ARM `packageUri` points to `<Package>-vX.Y.Z` (if applicable)

For any gap, provide the exact fix.
