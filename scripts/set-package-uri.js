#!/usr/bin/env node
//
// Rewrite an ARM template's packageUri to the release currently being cut.
//
// packageUri names a GitHub release tag, but that tag is computed by
// semantic-release from the commit history -- so hand-editing the template can
// only ever be a guess at what the next release will be called. It has been
// wrong twice: BlobToOtel-v3.0.2 was written into the template but never
// published (every deployment since silently had no fetchable package), and its
// replacement v3.1.0 went stale the moment merging that fix cut v3.1.1.
//
// Run from semantic-release's prepare step, this closes the loop: the template
// is stamped with the version being released, published as that release's asset,
// and committed back to master so the checked-in copy stays truthful too.
//
// Usage: set-package-uri.js <package> <template-path> <version>

'use strict';

const fs = require('fs');

const [, , pkg, templatePath, version] = process.argv;

if (!pkg || !templatePath || !version) {
  console.error('usage: set-package-uri.js <package> <template-path> <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`refusing to stamp a version that is not semver: "${version}"`);
  process.exit(1);
}

// Matches any package's release-download URL. The package name is captured and
// compared as a string rather than interpolated into the pattern: building a
// regex from an argument is an injection risk, and a name carrying regex
// metacharacters would match the wrong URLs instead of failing.
const RELEASE_URL = /(releases\/download\/)([A-Za-z][A-Za-z0-9]*)(-v)(\d+\.\d+\.\d+[^/]*)(\/)/g;

const template = fs.readFileSync(templatePath, 'utf8');

let rewritten = 0;
const updated = template.replace(
  RELEASE_URL,
  (whole, prefix, name, sep, _oldVersion, suffix) => {
    if (name !== pkg) return whole;
    rewritten += 1;
    return `${prefix}${name}${sep}${version}${suffix}`;
  }
);

// A rename, a refactor, or a template that never adopted the release URL would
// otherwise leave the old value in place and publish a template pointing at the
// previous version -- exactly the failure this script exists to prevent. Fail
// the release instead.
if (rewritten !== 1) {
  console.error(
    `expected exactly one ${pkg} release URL in ${templatePath}, found ${rewritten}.`
  );
  console.error('packageUri was not rewritten; failing rather than publishing a stale template.');
  process.exit(1);
}

fs.writeFileSync(templatePath, updated);
console.log(`${templatePath}: packageUri -> ${pkg}-v${version}`);
