module.exports = {
    branches: ['master'],
    tagFormat: 'EventHub-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/exec', {
        // Stamp the version being released into the ARM template before the
        // GitHub plugin uploads it, so the published template's packageUri
        // points at its own release rather than at a hand-guessed tag.
        prepareCmd: 'node ../scripts/set-package-uri.js EventHub ARM/EventHubV2.json ${nextRelease.version}',
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/git', {
        // Commit the stamped template back, so the checked-in copy names the
        // release that actually exists. [skip ci] keeps this from re-triggering
        // the workflow that created it.
        assets: ['ARM/EventHubV2.json'],
        message: 'chore(release): EventHub ${nextRelease.version} [skip ci]'
      }],
      ['@semantic-release/github', {
        assets: [
          { path: 'EventHub-FunctionApp.zip', label: 'EventHub-FunctionApp.zip' },
          { path: 'ARM/EventHubV2.json', label: 'EventHubV2.json' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };
