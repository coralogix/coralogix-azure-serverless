module.exports = {
    branches: ['azure-github-release*'],
    tagFormat: 'EventHub-v${version}',
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
      ['@semantic-release/exec', {
        successCmd: 'echo ${nextRelease.version} > .release_version'
      }],
      ['@semantic-release/git', {
        assets: ['CHANGELOG.md', '.release_version'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
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