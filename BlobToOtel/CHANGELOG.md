# Changelog

## BlobToOtel
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.6.0 / 02 Feb 2026
* [Fix] Implement double-flush pattern to ensure queue fully drains
  - Wait up to 60 seconds for large batches to complete export
* [Update] Increase `maxQueueSize` to 100,000 to prevent log drops under heavy load
* [Update] Optimize retry configuration for better reliability
  - Increased `maxRetryCount` from 0 to 5
  - Reduced `minimumInterval` to 5 seconds
  - Reduced `maximumInterval` to 5 minutes

### 2.5.0 / 29 Jan 2026 
* [Feature] Add configurable `NodeHeapSize` parameter in ARM template (default: 2048 MB)

### 2.4.0 / 28 Jan 2026
* [Fix] Optimize concurrency settings to prevent OOM errors
  - Reduced `maxBatchSize` from 64 to 4 to limit concurrent event load
  - Reduced `prefetchCount` from 256 to 8 to minimize memory overhead
  - Reduced `maxDegreeOfParallelism` from 5 to 2 for controlled parallel processing
* [Update] Flush every 2 batches instead of every batch for better throughput
* [Update] Upgrade to Node.js 22 (from Node.js 20)
* [Fix] Fix Application Insights configuration in ARM template
  - Added `APPINSIGHTS_INSTRUMENTATIONKEY` app setting
  - Added `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting
* [Update] Upgrade extension bundle to v4 ([4.*, 5.0.0) from v3)

### 2.3.0 / 26 Jan 2026 
* [Fix] Handle undefined event.topic when extracting storage account name

### 2.2.0 / 05 Jan 2026
[Fix] Improve batching logic
[Update] Use `@opentelemetry/exporter-logs-otlp-http` instead of `@opentelemetry/exporter-logs-otlp-grpc`

### 2.1.0 / 08 Apr 2025
[Fix] Use `@opentelemetry/exporter-logs-otlp-grpc` lib instead of `@opentelemetry/exporter-logs-otlp-http`
[Fix] Wait for batch accumulation
[Fix] Improve BlobCreated event validation

### 2.0.1 / 08 Apr 2025
[Fix] Add validation to ensure the processed event is a BlobCreated event.
[Fix] Reserve Elastic Worker for the function app.

### 2.0.0 / 26 Mar 2025
[Feature] Add BlobToOtel function app.
