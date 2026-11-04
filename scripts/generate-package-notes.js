#!/usr/bin/env node
//
// semantic-release generateNotesCmd: write release notes from the commits that
// actually touched this package.
//
// Replaces @semantic-release/release-notes-generator for the same reason
// analyze-package-commits.js replaces the commit analyzer -- it lists every
// commit since the tag regardless of what it touched, so packages advertised
// fixes they never received.
//
// Usage: generate-package-notes.js <package> <next-version> [last-release-git-tag]

'use strict';

const { commitsForPackage } = require('./package-commits');

const REPO = 'https://github.com/coralogix/coralogix-azure-serverless';

const SECTIONS = [
  { heading: 'Features', types: ['feat'] },
  { heading: 'Bug Fixes', types: ['fix'] },
  { heading: 'Performance Improvements', types: ['perf'] },
  { heading: 'Reverts', types: ['revert'] },
];

const [, , pkg, nextVersion, lastTag] = process.argv;

if (!pkg || !nextVersion) {
  console.error('usage: generate-package-notes.js <package> <next-version> [last-release-git-tag]');
  process.exit(1);
}

const commits = commitsForPackage(pkg, lastTag || null);

const nextTag = `${pkg}-v${nextVersion}`;
const heading = lastTag
  ? `## [${nextVersion}](${REPO}/compare/${lastTag}...${nextTag})`
  : `## ${nextVersion}`;

const lines = [`${heading} (${new Date().toISOString().slice(0, 10)})`, ''];

// A PR merge subject ends with "(#123)"; turn that into a link the way the
// conventional-changelog preset did, so notes read the same as the old ones.
const linkify = (commit) => {
  const subject = commit.subject.replace(
    /\(#(\d+)\)$/,
    (_m, n) => `([#${n}](${REPO}/issues/${n}))`
  );
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  return `* ${scope}${subject} ([${commit.short}](${REPO}/commit/${commit.hash}))`;
};

for (const section of SECTIONS) {
  const matching = commits.filter((c) => section.types.includes(c.type));
  if (!matching.length) continue;
  lines.push(`### ${section.heading}`, '');
  matching.forEach((c) => lines.push(linkify(c)));
  lines.push('');
}

const breaking = commits.filter((c) => c.breaking);
if (breaking.length) {
  lines.push('### BREAKING CHANGES', '');
  breaking.forEach((c) => lines.push(linkify(c)));
  lines.push('');
}

process.stdout.write(lines.join('\n').trimEnd() + '\n');
