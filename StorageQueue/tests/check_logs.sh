#!/usr/bin/env bash
# Poll Coralogix Get Logs Count API for app=azure, subsystem=storage-queue-e2e (same as e2e.sh verification).
# Requires: CORALOGIX_QUERY_API_KEY (or CORALOGIX_API_KEY) and optionally CX_LOGS_COUNT_URL or OTEL_ENDPOINT to derive API host.

if [[ -n "${CX_LOGS_COUNT_URL:-}" ]]; then
  :
elif [[ -n "${OTEL_ENDPOINT:-}" ]]; then
  CX_API_HOST="${OTEL_ENDPOINT#*://}"
  CX_API_HOST="${CX_API_HOST%%:*}"
  CX_API_HOST="${CX_API_HOST/#ingress./api.}"
  CX_LOGS_COUNT_URL="https://${CX_API_HOST}/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count"
else
  CX_LOGS_COUNT_URL="https://api.eu2.coralogix.com/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count"
fi
CORALOGIX_QUERY_API_KEY="${CORALOGIX_QUERY_API_KEY:-${CORALOGIX_API_KEY}}"
CX_SUBSYSTEM="${CORALOGIX_SUBSYSTEM:-storage-queue-e2e}"

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
    --data-urlencode "filters.subsystem=$CX_SUBSYSTEM" \
    --data-urlencode "subsystem_aggregation=true" \
    -H "Authorization: Bearer $CORALOGIX_QUERY_API_KEY" | head -1 | jq -r '(.result.logsCount // []) | map(.logsCount | tonumber) | add // 0'
}

echo "Waiting 30s, then verifying logs in Coralogix (app=azure, subsystem=$CX_SUBSYSTEM)..."
# sleep 30

attempt=0
while true; do
  attempt=$((attempt + 1))
  count=$(fetch_logs_count)
  if [[ -n "$count" && "$count" -gt 0 ]]; then
    echo "Logs verified in Coralogix (count=$count)."
    break
  fi
  if [[ $attempt -ge 10 ]]; then
    echo "No logs received in Coralogix after 10 attempts (last count=${count:-unknown})."
    exit 1
  fi
  echo "No logs yet (attempt $attempt/10), retrying in 30s..."
  sleep 30
done
