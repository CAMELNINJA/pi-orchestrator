#!/usr/bin/env bash
set -euo pipefail

echo "Checking git tree hygiene..."

# Check 1: package-lock.json anywhere not ignored
lockfile_found=false
if command -v git &> /dev/null; then
    # Check tracked files
    if git ls-files 2>/dev/null | grep -q 'package-lock\.json'; then
        echo "FAIL: package-lock.json found in tracked files"
        git ls-files | grep 'package-lock\.json'
        lockfile_found=true
    fi
    
    # Check working tree (untracked/modified)
    if git status --porcelain 2>/dev/null | grep -q 'package-lock\.json'; then
        echo "FAIL: package-lock.json found in working tree"
        git status --porcelain | grep 'package-lock\.json'
        lockfile_found=true
    fi
fi

if [ "$lockfile_found" = true ]; then
    echo ""
    echo "Remove stray package-lock.json and run 'git add' to commit."
    exit 1
fi

echo "✓ No package-lock.json found"

# Check 2: git status summary (unless --strict)
if [ "${1:-}" = "--strict" ]; then
    echo ""
    echo "Running strict check..."
    status_output=$(git status --porcelain 2>/dev/null || true)
    if [ -n "$status_output" ]; then
        echo "FAIL: Uncommitted changes detected:"
        echo "$status_output"
        exit 1
    fi
    echo "✓ Working tree is clean"
else
    echo ""
    echo "Git status (non-strict):"
    git status --porcelain 2>/dev/null || true
fi

echo ""
echo "Tree hygiene checks passed."
exit 0
