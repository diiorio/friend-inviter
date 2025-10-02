#!/usr/bin/env zsh
set -e

if [ -n "$(git status --porcelain)" ]; then
    echo "Commit all changes before releasing."
    exit 1
fi

MANIFEST='src/manifest.json'
NEXT="$(jq '.version = (.version|tonumber|.+1|tostring)' "$MANIFEST")"
echo "$NEXT" > "$MANIFEST"
VERSION = "$(jq -r .version "$MANIFEST")"

npm run clean
npm run lint
npm run build
npm run pack

git add "$MANIFEST"
git commit -m "chore: bump version to v$VERSION"
git push
gh release create "v$VERSION" --generate-notes "dist/friend-inviter_$VERSION.zip"
