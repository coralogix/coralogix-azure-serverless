module.exports = {
    branches: ['master'],
    tagFormat: 'BlobToOtel-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/exec', {
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
