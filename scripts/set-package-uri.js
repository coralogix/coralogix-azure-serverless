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

// Both patterns match *any* package's URL and capture the name, which is then
// compared as a string. Interpolating the name into the pattern would be a
// regex-injection risk, and a name carrying metacharacters would match the
// wrong URLs rather than failing.
const RELEASE_URL = /(releases\/download\/)([A-Za-z][A-Za-z0-9]*)(-v)(\d+\.\d+\.\d+[^/]*)(\/)/g;
const LEGACY_S3_URL = /(https:\/\/coralogix-public\.s3\.[^"]*?\/)([A-Za-z][A-Za-z0-9]*)(\.zip)/g;

const releaseUrlFor = (name, v) =>
  'https://github.com/coralogix/coralogix-azure-serverless/releases/download/' +
  `${name}-v${v}/${name}-FunctionApp.zip`;

const template = fs.readFileSync(templatePath, 'utf8');

let rewritten = 0;
let updated = template.replace(
  RELEASE_URL,
  (whole, prefix, name, sep, _oldVersion, suffix) => {
    if (name !== pkg) return whole;
    rewritten += 1;
    return `${prefix}${name}${sep}${version}${suffix}`;
  }
);

// Transitional: a package moving off the frozen S3 bucket still carries an S3
// packageUri, so on its first release there is no release URL to bump. Rewrite
// the S3 URL into a release URL instead. Ordering it this way keeps the
// checked-in template pointing at something that actually serves the package at
// every moment -- the README "Deploy to Azure" buttons deploy master's template
// directly, so a window where it names a release that does not exist yet is a
// window where new customer deployments come up with no function package.
let migrated = 0;
if (rewritten === 0) {
  updated = updated.replace(LEGACY_S3_URL, (whole, _prefix, name) => {
    if (name !== pkg) return whole;
    migrated += 1;
    return releaseUrlFor(name, version);
  });
}

// A rename, a refactor, or a template that never adopted either URL would
// otherwise leave the old value in place and publish a template pointing at the
// previous version -- exactly the failure this script exists to prevent. Fail
// the release instead.
if (rewritten + migrated !== 1) {
  console.error(
    `expected exactly one ${pkg} package URL in ${templatePath}, ` +
      `found ${rewritten} release and ${migrated} legacy S3.`
  );
  console.error('packageUri was not rewritten; failing rather than publishing a stale template.');
  process.exit(1);
}

fs.writeFileSync(templatePath, updated);
console.log(
  migrated
    ? `${templatePath}: packageUri migrated from S3 -> ${pkg}-v${version}`
    : `${templatePath}: packageUri -> ${pkg}-v${version}`
);
