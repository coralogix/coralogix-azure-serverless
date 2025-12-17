module.exports = {
    branches: ['master'],
    tagFormat: 'EventHub-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/exec', {
        successCmd: 'echo ${nextRelease.version} > .release_version'
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