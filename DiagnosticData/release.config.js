module.exports = {
    branches: ['master'],
    tagFormat: 'DiagnosticData-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/exec', {
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js DiagnosticData ARM/DiagnosticData.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/git', {
        // Commit the stamped template back. The README "Deploy to Azure" button
        // deploys master's copy directly, so it has to name a release that
        // exists. [skip ci] keeps this from re-triggering the workflow that
        // produced it.
        assets: ['ARM/DiagnosticData.json'],
        message: 'chore(release): DiagnosticData ${nextRelease.version} [skip ci]'
      }],
      ['@semantic-release/github', {
        assets: [
          { path: 'DiagnosticData-FunctionApp.zip', label: 'DiagnosticData-FunctionApp.zip' },
          { path: 'ARM/DiagnosticData.json', label: 'DiagnosticData.json' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };
