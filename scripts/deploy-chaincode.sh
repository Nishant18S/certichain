#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES="${FABRIC_SAMPLES:-$HOME/workspace/fabric-samples}"
cd "$SAMPLES/test-network"
./network.sh deployCC -ccn certichain -ccp "$ROOT/chaincode" -ccl javascript -ccv 1.1 -ccs 2
