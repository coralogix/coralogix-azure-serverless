# Changelog

## BlobViaEventGrid
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

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
