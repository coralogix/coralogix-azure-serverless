module.exports = {
    branches: ['master'],
    tagFormat: 'BlobViaEventGrid-v${version}',
    // No @semantic-release/commit-analyzer or release-notes-generator here.
    // Neither can filter by path, so in this monorepo they read every commit
    // since the tag whatever it touched -- which is how an EventHub CVE fix cut
    // BlobToOtel-v3.1.1 and appeared in its notes. semantic-release takes the
    // highest release type any analyzer returns, so leaving them configured
    // alongside the scoped commands below would defeat the purpose entirely.
    plugins: [
      ['@semantic-release/exec', {
        // Version and notes from the commits that actually touched BlobViaEventGrid.
        analyzeCommitsCmd: 'node ../scripts/analyze-package-commits.js BlobViaEventGrid "${lastRelease.gitTag}"',
        generateNotesCmd: 'node ../scripts/generate-package-notes.js BlobViaEventGrid "${nextRelease.version}" "${lastRelease.gitTag}"',
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js BlobViaEventGrid ARM/BlobViaEventGrid.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/github', {
        assets: [
          { path: 'BlobViaEventGrid-FunctionApp.zip', label: 'BlobViaEventGrid-FunctionApp.zip' },
          { path: 'ARM/BlobViaEventGrid.json', label: 'BlobViaEventGrid.json' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };
