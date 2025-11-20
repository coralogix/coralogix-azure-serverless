### 3.0.0 / 20 Nov 2024
[BREAKING CHANGE] Major update with the following changes:
* Updated Node.js runtime to 22
* Migrated from REST API to OpenTelemetry (OTLP) protocol for log ingestion
* Updated Coralogix region endpoints to new OTLP format with port 443
* Updated region naming convention (Europe → EU1, Europe2 → EU2, India → AP1, Singapore → AP2, US → US1)
* Added new regions: US2 (Oregon) and AP3 (Jakarta)
* Added EventHub Consumer Group support via `EventhubConsumerGroup` ARM template parameter (defaults to `$Default`)
* Added Function App Name customization via `FunctionAppName` ARM template parameter
* Changed default function name pattern to `coralogix-eventhub-func-{uniqueId}`
* Updated environment variables to use OTEL format (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS)

**BREAKING CHANGES:** This is a MAJOR version update. Existing deployments will need to update their region parameters to use the new naming convention (e.g., "Europe" - "EU1"). The function now uses OpenTelemetry endpoints instead of REST API endpoints. 

### 2.0.2 / 08 Sep 2025
[UPDATE] Modify threadID to use thread parameter instead of text

### 2.0.1 / 25 Apr 2025
[Update] Bump Node.js runtime to version 20

### 2.0.0 / 21 Feb 2023
[Update/Breaking] Replacing "Classic" Application Insights with Workspace-Based Application Insights.
