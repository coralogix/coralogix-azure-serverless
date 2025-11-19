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
          { path: 'EventHub-FunctionApp.zip', label: 'EventHub FunctionApp Artifact' }
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false
      }]
    ]
  };