#!/usr/bin/env bash
# Runs every browser check. Needs: backend with
#   WP_TRANSLATOR=mock WP_QUIZ_SECONDS=4 WP_STRETCH_SECONDS=3 uv run uvicorn app.main:app --port 8000
# and the frontend dev server on :5173 (pnpm dev).
set -u
fail=0
for t in youtube sync chat break polls movie study wellbeing sports hangout network companion extension; do
  if timeout 120 node "e2e/$t.mjs" >/tmp/e2e-$t.log 2>&1; then echo "PASS $t"; else echo "FAIL $t (see /tmp/e2e-$t.log)"; fail=1; fi
done
exit $fail
