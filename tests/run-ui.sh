#!/bin/sh
# Fresh stand-in server, then the phone walkthrough.
cd "$(dirname "$0")/.."
pkill -f fake/server.mjs 2>/dev/null
node --import ./tests/fake/register.mjs tests/fake/server.mjs > /tmp/fake.log 2>&1 &
sleep 2
node tests/ui.mjs; code=$?
pkill -f fake/server.mjs
exit $code
