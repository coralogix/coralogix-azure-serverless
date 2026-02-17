#!/usr/bin/env bash

CX_LOGS_COUNT_URL="https://api.eu2.coralogix.com/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count"

now_minus_10m() {
  if date -u -d '10 min ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null; then
    return
  fi
  date -u -v-10M +%Y-%m-%dT%H:%M:%S.000Z
}

fetch_logs_count() {
  local from to
  from=$(now_minus_10m)
  to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -s -G "$CX_LOGS_COUNT_URL" \
    --data-urlencode "date_range.fromDate=$from" \
    --data-urlencode "date_range.toDate=$to" \
    --data-urlencode "resolution=10m" \
    --data-urlencode "filters.application=azure" \
    --data-urlencode "filters.subsystem=blob-storage-logs" \
    --data-urlencode "subsystem_aggregation=true" \
    -H "Authorization: Bearer $CORALOGIX_OPEN_API_KEY" | head -1 | jq -r '(.result.logsCount // []) | map(.logsCount | tonumber) | add // 0'
}

echo "Step 4: Waiting 30s, then verifying logs in Coralogix (app=azure, subsystem=blob-storage-logs)..."
# sleep 30

attempt=0
while true; do
  attempt=$((attempt + 1))
  count=$(fetch_logs_count)
  if [[ -n "$count" && "$count" -gt 0 ]]; then
    echo "Step 4: Logs verified in Coralogix (count=$count)."
    break
  fi
  if [[ $attempt -ge 10 ]]; then
    echo "Step 4: No logs received in Coralogix after 10 attempts (last count=${count:-unknown})."
    exit 1
  fi
  echo "Step 4: No logs yet (attempt $attempt/10), retrying in 30s..."
  sleep 30
done