### 3.2.0 / 04 Dec 2024
[FEATURE] Dynamic application and subsystem name resolution:
* Added template-based name resolution with `{{ $.field }}` syntax for JSON logs
* Added regex-based name resolution with `/pattern/` syntax for plain text logs
* Added support for multiple fallback expressions with `||` operator (e.g., `{{ $.appName || $.location }}`)
* Added support for regex extraction within templates (e.g., `{{ $.resourceId | r'/resourceGroups/([^/]+)/i' }}`)
* Added `attributes.azure.*` access in templates for enriched Azure metadata
* Graceful fallback to default values when patterns don't match
* Added unit tests for name resolution logic
* Reorganized tests into dedicated `tests/` folder

### 3.1.0 / 02 Dec 2024
[FEATURE] Multi-format log support and testing improvements:
* Added automatic log format detection (plain text, JSON string, JSON object, JSON array)
* Added support for JSON array payloads - automatically splits arrays into individual log records
* Added Azure metadata enrichment (subscription ID, resource group, provider extraction from resourceId)
* Added logger caching for improved performance with multiple app/subsystem combinations
* Added Prettier code formatting support
* Updated GitHub Actions workflow to include test execution
* Updated consumer group configuration to use environment variable (`%EVENTHUB_CONSUMER_GROUP%`)

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
