#!/usr/bin/env bash
# Fails if secrets or credential files are (about to be) committed. Used by CI and by the local pre-commit hook.
#   scripts/check-secrets.sh            tracked files (CI)
#   scripts/check-secrets.sh --staged   files staged for commit (pre-commit hook)
#   scripts/check-secrets.sh --history  every commit on every branch (CI, once)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mode="${1:-tracked}"

# 1) files that must never be tracked (the .env.example template and the credentials/ README are the only allowed ones)
FORBIDDEN_PATHS='(^|/)\.env($|\.)|(^|/)credentials/|-sa\.json$|service-account.*\.json$|firebase-adminsdk.*\.json$|application_default_credentials\.json$|gha-creds-.*\.json$|\.(pem|p12|pfx|jks)$|(^|/)id_(rsa|ed25519)$|\.osm\.pbf$|(^|/)\.local_storage/'
ALLOWED_PATHS='(^|/)\.env\.example$|(^|/)credentials/(README\.md|\.gitkeep)$'

# 2) secret-looking content (Google API keys, service-account JSON, private keys, OAuth client secrets, access tokens, cloud/GitHub keys)
PATTERNS='"type" *: *"service_account"|BEGIN ([A-Z]+ )?PRIVATE KEY|"private_key" *:|AIza[0-9A-Za-z_-]{35}|GOCSPX-[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{32,}'
SKIP_CONTENT=':!*.lock :!pnpm-lock.yaml :!scripts/check-secrets.sh'

fail=0
if [ "$mode" = "--history" ]; then
  names=$(git log --all --pretty=format: --name-only --diff-filter=A | sort -u | grep -E "$FORBIDDEN_PATHS" | grep -vE "$ALLOWED_PATHS" || true)
  if [ -n "$names" ]; then echo "FORBIDDEN files exist in history:"; echo "$names"; fail=1; fi
  hits=$(git log --all -p --no-color -- . ':!*.lock' ':!pnpm-lock.yaml' ':!scripts/check-secrets.sh' | grep -E "^\+" | grep -vE "^\+\+\+" | grep -E "$PATTERNS" | sed -E 's/(.{80}).*/\1.../' | head -5 || true)
  if [ -n "$hits" ]; then echo "SECRET-LIKE content in history (first matches, truncated):"; echo "$hits"; fail=1; fi
else
  if [ "$mode" = "--staged" ]; then files=$(git diff --cached --name-only --diff-filter=ACM); else files=$(git ls-files); fi
  bad=$(printf '%s\n' "$files" | grep -E "$FORBIDDEN_PATHS" | grep -vE "$ALLOWED_PATHS" || true)
  if [ -n "$bad" ]; then echo "FORBIDDEN files would be committed:"; echo "$bad"; fail=1; fi
  if [ "$mode" = "--staged" ]; then
    content=$(git diff --cached -U0 --no-color -- . ':!*.lock' ':!pnpm-lock.yaml' ':!scripts/check-secrets.sh' | grep -E "^\+" | grep -vE "^\+\+\+" | grep -E "$PATTERNS" | sed -E 's/(.{80}).*/\1.../' | head -5 || true)
  else
    content=$(git grep -nIE "$PATTERNS" -- . ':!*.lock' ':!pnpm-lock.yaml' ':!scripts/check-secrets.sh' | sed -E 's/(.{100}).*/\1.../' | head -5 || true)
  fi
  if [ -n "$content" ]; then echo "SECRET-LIKE content found (first matches, truncated):"; echo "$content"; fail=1; fi
fi
if [ "$fail" -ne 0 ]; then
  echo; echo "Blocked. Keep secrets in .env / credentials/ (gitignored) or Secret Manager. If a real secret was exposed, REVOKE it, do not just delete the file."; exit 1
fi
echo "check-secrets ($mode): OK"
