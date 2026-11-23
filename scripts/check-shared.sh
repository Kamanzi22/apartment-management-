#!/usr/bin/env bash
# Checks that the src/lib files shared with the tenant app are byte-identical in both repos.
# Usage: scripts/check-shared.sh [path-to-tenant-repo]   (default: ../apartment-manager-tenant)
# Exits 1 and lists the files that differ or are missing.

set -u

landlord="$(cd "$(dirname "$0")/.." && pwd)"
tenant="${1:-$landlord/../apartment-manager-tenant}"

if [ ! -d "$tenant/src/lib" ]; then
  echo "Tenant repo not found at: $tenant" >&2
  exit 1
fi

# Keep this list in step with "Code shared by both apps" in CLAUDE.md.
shared=(
  rent-ledger
  rent-alerts
  rent-utils
  currency
  categories
  public-origin
  storage-url
  email
  push
  notify
  maintenance
  landlord
  supabase/database.types
)

bad=0
for name in "${shared[@]}"; do
  for file in "src/lib/$name.ts" "src/lib/$name.test.ts"; do
    a="$landlord/$file"
    b="$tenant/$file"
    # A test file is optional, but if one repo has it the other must too.
    if [ "$file" = "src/lib/$name.test.ts" ] && [ ! -f "$a" ] && [ ! -f "$b" ]; then
      continue
    fi
    if [ ! -f "$a" ]; then
      echo "MISSING in landlord: $file"; bad=1
    elif [ ! -f "$b" ]; then
      echo "MISSING in tenant:   $file"; bad=1
    elif ! cmp -s "$a" "$b"; then
      echo "DIFFERS: $file"; bad=1
    fi
  done
done

if [ "$bad" -ne 0 ]; then
  echo "Shared files are out of sync. Copy the change to both repos (see CLAUDE.md)." >&2
  exit 1
fi
echo "Shared src/lib files are identical in both repos."
