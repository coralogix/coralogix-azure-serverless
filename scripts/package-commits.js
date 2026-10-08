//
// Shared helper: read the conventional commits that belong to one package.
//
// semantic-release is single-package by design. Pointed at a monorepo it
// analyses every commit since the package's own last tag, whatever that commit
// touched -- so an EventHub CVE fix cut BlobToOtel-v3.1.1 and appears verbatim
// in its release notes, describing a change BlobToOtel never received.
//
// semantic-release-monorepo is the usual answer, but it silently no-ops on
// semantic-release 25 (identical commit counts with and without it) and has not
// been published since February 2024. So the scoping happens here instead:
// git does the path filtering, and analyze/generate read from this.

'use strict';

const { execFileSync } = require('child_process');

// Field and record separators that cannot occur in a commit message. git emits
// them from %x1f/%x1e placeholders, rather than us putting the raw bytes in the
// argument itself -- Node rejects arguments containing them.
const FIELD = '\u001f';
const RECORD = '\u001e';
const FORMAT = '--format=%H%x1f%B%x1f%s%x1e';

// Angular convention, matching the preset the packages used before.
const RELEASE_TYPE_BY_TYPE = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  revert: 'patch',
};

const HEADER = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<subject>.+)$/;

// `git revert` writes `Revert "<original subject>"`, which is not a
// conventional header and would otherwise parse as no type and request no
// release. This repo already has two of them (54b4335, 810f15b). Rolling back a
// published bad release must ship a patched artifact, not leave users on the
// bad version until some unrelated commit happens to trigger one.
const REVERT_HEADER = /^Revert\s+"/;

// A commit belongs to a package if it touches that package's directory. Tests
// and markdown are excluded to match the workflow's trigger filters: a
// test-only or docs-only change must not cut a release.
function commitsForPackage(pkg, sinceTag) {
  const range = sinceTag ? `${sinceTag}..HEAD` : 'HEAD';

  const raw = execFileSync(
    'git',
    [
      'log',
      range,
      FORMAT,
      '--',
      // :(top) anchors the pathspec to the repository root. semantic-release
      // runs each package from its own directory, so a bare "EventHub/" would
      // resolve against EventHub/ and silently match nothing -- reporting zero
      // commits and skipping every release.
      `:(top)${pkg}/`,
      `:(top,exclude)${pkg}/tests/`,
      `:(top,exclude)${pkg}/**/*.md`,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );

  return raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, body, subject] = record.split(FIELD);
      const match = HEADER.exec((subject || '').trim());

      // A commit whose header is not conventional cannot request a release.
      // Keep it so notes can still mention it if we ever want to, but give it
      // no release type -- guessing would be worse than ignoring.
      const groups = match ? match.groups : null;
      const isPlainRevert = !groups && REVERT_HEADER.test((subject || '').trim());
      const breaking =
        Boolean(groups && groups.breaking) ||
        /^BREAKING[ -]CHANGE:/m.test(body || '');

      return {
        hash: (hash || '').trim(),
        short: (hash || '').trim().slice(0, 7),
        type: groups ? groups.type : isPlainRevert ? 'revert' : null,
        scope: groups ? groups.scope || null : null,
        subject: groups ? groups.subject : (subject || '').trim(),
        body: body || '',
        breaking,
      };
    });
}

function releaseTypeFor(commits) {
  let type = null;
  for (const commit of commits) {
    if (commit.breaking) return 'major';
    const candidate = RELEASE_TYPE_BY_TYPE[commit.type];
    if (candidate === 'minor') type = 'minor';
    else if (candidate === 'patch' && type !== 'minor') type = 'patch';
  }
  return type;
}

module.exports = { commitsForPackage, releaseTypeFor };
