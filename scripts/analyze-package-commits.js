#!/usr/bin/env node
//
// semantic-release analyzeCommitsCmd: decide the release type from the commits
// that actually touched this package.
//
// Prints "major", "minor", "patch", or nothing at all -- which is how
// @semantic-release/exec signals "no release". Replaces
// @semantic-release/commit-analyzer, which cannot filter by path; leaving that
// plugin configured alongside this one would defeat the purpose, since
// semantic-release takes the highest release type any analyzer returns.
//
// Usage: analyze-package-commits.js <package> [last-release-git-tag]

'use strict';

const { commitsForPackage, releaseTypeFor } = require('./package-commits');

const [, , pkg, lastTag] = process.argv;

if (!pkg) {
  console.error('usage: analyze-package-commits.js <package> [last-release-git-tag]');
  process.exit(1);
}

const commits = commitsForPackage(pkg, lastTag || null);
const type = releaseTypeFor(commits);

// Diagnostics go to stderr: stdout is the plugin's contract and must contain
// the release type and nothing else.
console.error(
  `[${pkg}] ${commits.length} commit(s) touching the package since ${lastTag || 'the beginning'} -> ${type || 'no release'}`
);
for (const c of commits) {
  console.error(`  ${c.short} ${c.type || '(non-conventional)'}${c.breaking ? '!' : ''}: ${c.subject}`);
}

if (type) process.stdout.write(type);
