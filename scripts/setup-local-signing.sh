#!/usr/bin/env bash
# Creates (or reuses) a self-signed code-signing certificate for local macOS
# builds, so Input Monitoring permission survives rebuilds during development.
#
# Why this is needed:
#   An ad-hoc signed app (the default with no `signingIdentity` configured)
#   gets a designated requirement pinned to the *hash of the binary itself*
#   (`cdhash H"..."`, check with `codesign -d -r- Sonatina.app`). Every
#   rebuild changes that hash, so macOS silently treats the new build as a
#   never-authorized app even though the row in System Settings still shows
#   "Sonatina" toggled on from a previous build.
#
#   A self-signed certificate (not ad-hoc, not a paid Apple Developer ID)
#   anchors the designated requirement to the certificate + bundle
#   identifier instead, which stays stable across rebuilds. Real releases
#   should still use a proper Developer ID (see .github/workflows/release.yml).
#
# Usage:
#   ./scripts/setup-local-signing.sh
#   export APPLE_SIGNING_IDENTITY="Sonatina Local Dev"
#   npm run app:build   # or app:dev

set -euo pipefail

CERT_NAME="Sonatina Local Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script only makes sense on macOS." >&2
  exit 1
fi

if security find-certificate -c "$CERT_NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Certificate \"$CERT_NAME\" already exists in your login keychain."
else
  echo "Creating self-signed code-signing certificate \"$CERT_NAME\"..."
  WORKDIR="$(mktemp -d)"
  trap 'rm -rf "$WORKDIR"' EXIT

  openssl req -x509 -newkey rsa:2048 -keyout "$WORKDIR/key.pem" -out "$WORKDIR/cert.pem" \
    -days 3650 -nodes -subj "/CN=$CERT_NAME" \
    -addext "extendedKeyUsage=codeSigning" \
    -addext "basicConstraints=critical,CA:false"

  openssl pkcs12 -export -out "$WORKDIR/cert.p12" \
    -inkey "$WORKDIR/key.pem" -in "$WORKDIR/cert.pem" -passout pass:

  security import "$WORKDIR/cert.p12" -k "$KEYCHAIN" -P "" -T /usr/bin/codesign -A

  # Let codesign use it without a per-invocation keychain prompt.
  security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

  echo "Trusting \"$CERT_NAME\" for code signing (you'll be prompted for your password)..."
  security add-trusted-cert -r trustAsRoot -p codeSign -k "$KEYCHAIN" "$WORKDIR/cert.pem"

  echo "Created and trusted \"$CERT_NAME\"."
fi

cat <<EOF

Done. Before building, run:

  export APPLE_SIGNING_IDENTITY="$CERT_NAME"
  npm run app:build   # or: npm run app:dev

Grant Input Monitoring to Sonatina once with this identity in place, and it
will keep working across rebuilds — no more "switched on but still not
working" after every \`tauri build\`.
EOF
