#!/usr/bin/env bash
# Poll Coralogix Get Logs Count API for DiagnosticData E2E app/subsystem (azure / diagnosticdata-e2e).
# Set CORALOGIX_QUERY_API_KEY (or CORALOGIX_API_KEY) and optionally OTEL_ENDPOINT for API host.

: "${OTEL_ENDPOINT:=https://ingress.eu1.coralogix.com}"
CX_API_HOST="${OTEL_ENDPOINT#*://}"
CX_API_HOST="${CX_API_HOST%%:*}"
CX_API_HOST="${CX_API_HOST/#ingress./api.}"
CX_LOGS_COUNT_URL="https://${CX_API_HOST}/mgmt/openapi/latest/dataplans/data-usage/v2"

now_minus_60m() {
  date -u -v-60M +%Y-%m-%dT%H:%M:%S.000Z
}

# Subsystem to filter: genericDimension key=subsystem_name, value=$SUBSYSTEM
SUBSYSTEM="${SUBSYSTEM:-diagnosticdata-e2e}"

fetch_data_usage() {
  local from to
  from=$(now_minus_60m)
  to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -s -G "$CX_LOGS_COUNT_URL" \
    --data-urlencode "date_range.fromDate=$from" \
    --data-urlencode "date_range.toDate=$to" \
    --data-urlencode "resolution=1h" \
    --data-urlencode "aggregate=AGGREGATE_BY_SUBSYSTEM" \
    -H "Authorization: Bearer ${CORALOGIX_QUERY_API_KEY:-$CORALOGIX_API_KEY}" 2>/dev/null | head -1 | \
    jq -r --arg sub "$SUBSYSTEM" '(.result.entries // []) | map(select(any(.dimensions[]?; .genericDimension? | select(.key == "subsystem_name" and .value == $sub)))) | map(.units) | add // 0'
}

echo "Verifying logs in Coralogix (app=azure, subsystem=diagnosticdata-e2e)..."
attempt=0
while true; do
  attempt=$((attempt + 1))
  count=$(fetch_data_usage)
  echo "Data units: $count"
  if [[ -n "$count" ]] && awk -v n="$count" 'BEGIN{exit (n+0>0)?0:1}'; then
    echo "Metrics verified in Coralogix (data units count=$count)."
    break
  fi
  if [[ $attempt -ge 10 ]]; then
    echo "No data units received in Coralogix after 10 attempts (last count=${count:-unknown})."
    exit 1
  fi
  echo "No data units yet (attempt $attempt/10), retrying in 30s..."
  sleep 30
done
