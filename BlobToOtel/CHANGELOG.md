# 1.0.0 (2025-10-28)


### Bug Fixes

* add minor improvements to BlobToOtel ([#50](https://github.com/coralogix/coralogix-azure-serverless/issues/50)) ([4907c40](https://github.com/coralogix/coralogix-azure-serverless/commit/4907c40d608b2f0203e7dd37cecb6fa327f62289))
* Improve batch and flush mechanisms to avoid missing log records on BlobViaEventGrid ([#58](https://github.com/coralogix/coralogix-azure-serverless/issues/58)) ([c29e7a6](https://github.com/coralogix/coralogix-azure-serverless/commit/c29e7a624181bb6ed954ae9808360f752abc0be2))


### Features

* add github release for eventhub ([54df535](https://github.com/coralogix/coralogix-azure-serverless/commit/54df535f5e7c31e15de2500f2415b850da388330))
* add github release for eventhub abd blob to otel ([c387d3d](https://github.com/coralogix/coralogix-azure-serverless/commit/c387d3d64a510c4e8552be5b56bc63936f146fd6))
* add github release for eventhub abd blob to otel ([11f2eba](https://github.com/coralogix/coralogix-azure-serverless/commit/11f2eba0ff89ae5eb44e6cd3fb65199747ad5da5))
* add github release for eventhub abd blob to otel ([ce75f03](https://github.com/coralogix/coralogix-azure-serverless/commit/ce75f03e85587707c4469835ef9ea16452c8eaf2))
* add github release for eventhub abd blob to otel ([3f2d5ef](https://github.com/coralogix/coralogix-azure-serverless/commit/3f2d5effefaf06f45a44ac37a6d6b84453fc6ace))
* add github release for eventhub abd blob to otel ([958bbd2](https://github.com/coralogix/coralogix-azure-serverless/commit/958bbd22c4d632345a18a3fe2b5916b10c343d0d))
* CDS-1933 implement blob-to-otel workflow ([#49](https://github.com/coralogix/coralogix-azure-serverless/issues/49)) ([1bb87ec](https://github.com/coralogix/coralogix-azure-serverless/commit/1bb87ecccb67d4903b224bf3f87ae1ccb56b91fe))

# Changelog

## BlobToOtel
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.1.0 / 08 Apr 2025
[Fix] Use `@opentelemetry/exporter-logs-otlp-grpc` lib instead of `@opentelemetry/exporter-logs-otlp-http`
[Fix] Wait for batch accumulation
[Fix] Improve BlobCreated event validation

### 2.0.1 / 08 Apr 2025
[Fix] Add validation to ensure the processed event is a BlobCreated event.
[Fix] Reserve Elastic Worker for the function app.

### 2.0.0 / 26 Mar 2025
[Feature] Add BlobToOtel function app.
