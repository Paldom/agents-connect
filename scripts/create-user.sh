#!/usr/bin/env bash
# Create (or reset the password of) a hub user without the Firebase console.
# Usage: scripts/create-user.sh <email> [--project <id>]   (password is prompted)
# Uses bcrypt via htpasswd (macOS/Apache) + `firebase auth:import`. Sign-up is disabled in the apps;
# this is how owners get accounts.
set -euo pipefail
EMAIL=${1:?usage: create-user.sh <email> [--project <id>]}; shift || true
read -rs -p "Password for $EMAIL: " PASSWORD; echo
[ ${#PASSWORD} -ge 8 ] || { echo "password must be at least 8 chars"; exit 1; }
HASH=$(htpasswd -nbBC 10 "" "$PASSWORD" | cut -d: -f2)
UID_=$(echo -n "$EMAIL" | shasum -a 256 | cut -c1-28)
TMP=$(mktemp)
printf '{"users":[{"localId":"%s","email":"%s","emailVerified":true,"passwordHash":"%s"}]}\n' "$UID_" "$EMAIL" "$(printf %s "$HASH" | base64)" > "$TMP"
firebase auth:import "$TMP" --hash-algo=BCRYPT "$@"
rm -f "$TMP"
echo "user $EMAIL ready (uid $UID_)"
