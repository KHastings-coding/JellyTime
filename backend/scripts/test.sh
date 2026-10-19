#!/bin/sh
# Runs backend tests in node:20-alpine (the production runtime); the host's Node is too old.
# Usage: backend/scripts/test.sh [test/file.test.js ...]
set -e
cd "$(dirname "$0")/.."
docker build -q -t jellytime-backend-test -f Dockerfile.test . >/dev/null
if [ $# -eq 0 ]; then set -- test/; fi
docker run --rm -v "$PWD/src:/app/src:ro" -v "$PWD/test:/app/test:ro" jellytime-backend-test node --test "$@"
