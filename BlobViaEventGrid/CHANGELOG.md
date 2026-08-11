# Changelog

## BlobViaEventGrid
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.2.0 / 11 Aug 2026
* [Update] Migrate legacy Coralogix domains to the regional domains
  - `CoralogixRegion` now accepts the region codes `EU1`, `EU2`, `US1`, `US2`, `US3`, `AP1`, `AP2`, `AP3`
  - The legacy region names (`Europe(eu-west-1)`, `US(us-east-2)`, `US2(us-west-2)`, `Europe2(eu-north-1)`, `India(ap-south-1)`, `Singapore(ap-southeast-1)`) are still accepted and map to the same endpoints
  - Endpoints now use `ingress.<region>.coralogix.com`; default region is `EU1`

### 2.1.3 / 06 Jul 2026
* [Update] fix(deps): Override @grpc/grpc-js and protobufjs versions to resolve HIGH severity CVEs

### 2.1.2 / 05 Jan 2026
[Bug] fix: replace `context.error` by `context.log` to avoid runtime errors.

### 2.1.1 / 01 Dec 2025
[Bug] fix: replace `context.warn` by `context.log` to avoid runtime errors.

### 2.1.0 / 09 Sep 2025
[Update] Rewrite the logic from `coralogix-logger` to `@opentelemetry/exporter-logs-otlp-http` in order to solve the problem with a last batch getting dissappeared

### 2.0.6 / 08 Sep 2025
[UPDATE] add missing parameter to BlobViaEventGrid template

### 2.0.5 / 01 Sep 2025
[BUG] Improve batch and flush mechanisms to avoid missing log records

### 2.0.4 / 01 Sep 2025
[Update] Add blob name and blob path metadata to log entries when enabled via ENABLE_BLOB_METADATA env variable

### 2.0.3 / 25 Jun 2025
[Update] Add debug mode to the function app
[Update] Add checks for character encoding

### 2.0.2 / 25 Apr 2025
[Update] Bump Node.js runtime to version 20

### 2.0.1 / 22 Feb 2023
[BUG] Update ARM template for incorrect variable name.
[BUG] Update ARM template for incorrect "default value"

### 2.0.0 / 21 Feb 2023
[Update/Breaking] Replacing "Classic" Application Insights with Workspace-Based Application Insights.
