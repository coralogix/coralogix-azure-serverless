# Changelog

## BlobToOtel
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.1.1 / 29 Apr 2025
[Feat] Decode AVRO files

### 2.1.0 / 08 Apr 2025
[Fix] Use `@opentelemetry/exporter-logs-otlp-grpc` lib instead of `@opentelemetry/exporter-logs-otlp-http`
[Fix] Wait for batch accumulation
[Fix] Improve BlobCreated event validation

### 2.0.1 / 08 Apr 2025
[Fix] Add validation to ensure the processed event is a BlobCreated event.
[Fix] Reserve Elastic Worker for the function app.

### 2.0.0 / 26 Mar 2025
[Feature] Add BlobToOtel function app.
