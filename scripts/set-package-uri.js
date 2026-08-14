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

const template = fs.readFileSync(templatePath, 'utf8');

// Match this package's release-download URL whatever version it currently
// carries. Anchored on the package name so a template referencing several
// artifacts cannot have the wrong one rewritten.
const pattern = new RegExp(
  `(releases/download/${pkg}-v)\\d+\\.\\d+\\.\\d+[^/]*(/)`,
  'g'
);

const matches = template.match(pattern) || [];

// Transitional: a package moving off the frozen S3 bucket still carries an S3
// packageUri, so there is no release URL to bump on its first release. Rewrite
// the S3 URL into a release URL instead. This keeps the checked-in template
// pointing at something that actually serves the package at every moment --
// the README "Deploy to Azure" buttons deploy master's template directly, so a
// window where it names a release that does not exist yet is a window where
// new customer deployments come up with no function package.
const legacyPattern = new RegExp(
  `https://coralogix-public\\.s3\\.[^"]*?/${pkg}\\.zip`,
  'g'
);
const legacyMatches = template.match(legacyPattern) || [];

if (matches.length === 0 && legacyMatches.length === 1) {
  const releaseUrl =
    'https://github.com/coralogix/coralogix-azure-serverless/releases/download/' +
    `${pkg}-v${version}/${pkg}-FunctionApp.zip`;
  fs.writeFileSync(templatePath, template.replace(legacyPattern, releaseUrl));
  console.log(`${templatePath}: packageUri migrated from S3 -> ${pkg}-v${version}`);
  process.exit(0);
}

// A rename, a refactor, or a template that never adopted the release URL would
// otherwise leave the old value in place and publish a template pointing at the
// previous version -- exactly the failure this script exists to prevent. Fail
// the release instead.
if (matches.length !== 1) {
  console.error(
    `expected exactly one ${pkg} release URL in ${templatePath}, found ${matches.length}.`
  );
  console.error('packageUri was not rewritten; failing rather than publishing a stale template.');
  process.exit(1);
}

const updated = template.replace(pattern, `$1${version}$2`);

fs.writeFileSync(templatePath, updated);
console.log(`${templatePath}: packageUri -> ${pkg}-v${version}`);
