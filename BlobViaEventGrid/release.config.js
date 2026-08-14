module.exports = {
    branches: ['master'],
    tagFormat: 'BlobViaEventGrid-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/exec', {
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js BlobViaEventGrid ARM/BlobViaEventGrid.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/git', {
        // Commit the stamped template back. The README "Deploy to Azure" button
        // deploys master's copy directly, so it has to name a release that
        // exists. [skip ci] keeps this from re-triggering the workflow that
        // produced it.
        assets: ['ARM/BlobViaEventGrid.json'],
        message: 'chore(release): BlobViaEventGrid ${nextRelease.version} [skip ci]'
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
