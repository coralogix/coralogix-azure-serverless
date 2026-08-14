#!/usr/bin/env bash
#
# Commit the stamped ARM template back to master -- AFTER the release exists.
#
# This deliberately runs from semantic-release's `success` step rather than via
# @semantic-release/git, which runs in `prepare`. Ordering matters more than
# usual here because the README "Deploy to Azure" buttons deploy master's
# template directly:
#
#   prepare (git plugin)  -> master points at the new release
#   publish (github)      -> the release is actually created
#
# If publish failed, that order leaves master permanently naming a release that
# does not exist, and every new customer deployment comes up with no function
# package. Committing from `success` inverts the risk: the worst case becomes a
# published release that master has not caught up to yet, which is visible,
# harmless, and fixed by the next release.
#
# Usage: commit-package-uri.sh <package> <template-path> <version>

set -euo pipefail

pkg="${1:?package required}"
template="${2:?template path required}"
version="${3:?version required}"

if git diff --quiet -- "$template"; then
  echo "$template is unchanged; nothing to commit."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add "$template"
# [skip ci] so this commit cannot re-trigger the workflow that produced it.
git commit -m "chore(release): ${pkg} ${version} [skip ci]"

# Releases are serialised, so contention should not happen -- but a retry is
# cheap and the alternative is master silently lagging the published release.
if ! git push origin HEAD:master; then
  echo "push rejected; rebasing onto master and retrying once" >&2
  git pull --rebase origin master
  git push origin HEAD:master
fi

echo "${template}: committed packageUri for ${pkg}-v${version}"
