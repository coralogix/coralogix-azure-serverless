module.exports = {
    branches: ['master'],
    tagFormat: 'BlobToOtel-v${version}',
    // No @semantic-release/commit-analyzer or release-notes-generator here.
    // Neither can filter by path, so in this monorepo they read every commit
    // since the tag whatever it touched -- which is how an EventHub CVE fix cut
    // BlobToOtel-v3.1.1 and appeared in its notes. semantic-release takes the
    // highest release type any analyzer returns, so leaving them configured
    // alongside the scoped commands below would defeat the purpose entirely.
    plugins: [
      ['@semantic-release/exec', {
        // Version and notes from the commits that actually touched BlobToOtel.
        analyzeCommitsCmd: 'node ../scripts/analyze-package-commits.js BlobToOtel "${lastRelease.gitTag}"',
        generateNotesCmd: 'node ../scripts/generate-package-notes.js BlobToOtel "${nextRelease.version}" "${lastRelease.gitTag}"',
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js BlobToOtel ARM/BlobToOtel.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/github', {
        assets: [
          { path: 'BlobToOtel-FunctionApp.zip', label: 'BlobToOtel-FunctionApp.zip' },
          { path: 'ARM/BlobToOtel.json', label: 'BlobToOtel.json' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };
