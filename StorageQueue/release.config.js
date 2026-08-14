module.exports = {
    branches: ['master'],
    tagFormat: 'StorageQueue-v${version}',
    // No @semantic-release/commit-analyzer or release-notes-generator here.
    // Neither can filter by path, so in this monorepo they read every commit
    // since the tag whatever it touched -- which is how an EventHub CVE fix cut
    // BlobToOtel-v3.1.1 and appeared in its notes. semantic-release takes the
    // highest release type any analyzer returns, so leaving them configured
    // alongside the scoped commands below would defeat the purpose entirely.
    plugins: [
      ['@semantic-release/exec', {
        // Version and notes from the commits that actually touched StorageQueue.
        analyzeCommitsCmd: 'node ../scripts/analyze-package-commits.js StorageQueue "${lastRelease.gitTag}"',
        generateNotesCmd: 'node ../scripts/generate-package-notes.js StorageQueue "${nextRelease.version}" "${lastRelease.gitTag}"',
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js StorageQueue ARM/StorageQueue.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/git', {
        // Commit the stamped template back. The README "Deploy to Azure" button
        // deploys master's copy directly, so it has to name a release that
        // exists. [skip ci] keeps this from re-triggering the workflow that
        // produced it.
        assets: ['ARM/StorageQueue.json'],
        message: 'chore(release): StorageQueue ${nextRelease.version} [skip ci]'
      }],
      ['@semantic-release/github', {
        assets: [
          { path: 'StorageQueue-FunctionApp.zip', label: 'StorageQueue-FunctionApp.zip' },
          { path: 'ARM/StorageQueue.json', label: 'StorageQueue.json' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };
