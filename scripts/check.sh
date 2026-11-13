#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/backend/server.js"
node --check "$ROOT/backend/scripts/create-admin.js"
node --check "$ROOT/chaincode/index.js"
node --check "$ROOT/chaincode/lib/certificate-contract.js"
echo 'All JavaScript syntax checks passed.'
