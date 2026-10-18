#!/usr/bin/env bash
# Publishes a COPY of the app/ folder to the public test-site repository (shown by GitHub Pages).
# Nothing else from this private repo is published: no docs, firmware, history or names.
#
# Usage (from anywhere):  tools/publish-test-site.sh <public-repo-url>
#
# Privacy check: if a file named .private-names exists at the root of this repo (one word per
# line, never committed: it is in .gitignore), publishing stops when any of those words appears.
set -euo pipefail

REPO="${1:?Usage: tools/publish-test-site.sh <public-repo-url>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet "$REPO" "$TMP/site" 2>/dev/null

# Replace the site's content with the current app/ folder.
find "$TMP/site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$ROOT/app/." "$TMP/site/"
touch "$TMP/site/.nojekyll"   # serve files as they are

if [ -f "$ROOT/.private-names" ]; then
  while IFS= read -r word; do
    [ -z "$word" ] && continue
    if grep -rqiI --exclude-dir=.git -- "$word" "$TMP/site"; then
      echo "A private name was found in app/ (see .private-names). Nothing was published."
      exit 1
    fi
  done < "$ROOT/.private-names"
fi

VERSION="$(grep -o "APP_VERSION = '[^']*'" "$ROOT/app/js/config.js" | cut -d"'" -f2)"
cd "$TMP/site"
git add -A
if git diff --cached --quiet; then
  echo "The test site is already up to date (app $VERSION)."
  exit 0
fi
git -c user.name="PWR team" -c user.email="$(git -C "$ROOT" config user.email)" commit -q -m "Publish app $VERSION"
git push -q origin HEAD:main
echo "Published app $VERSION to $REPO"
