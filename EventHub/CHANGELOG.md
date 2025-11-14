# [2.2.0](https://github.com/coralogix/coralogix-azure-serverless/compare/EventHub-v2.1.0...EventHub-v2.2.0) (2025-11-14)


### Features

* add github release for eventhub ([54df535](https://github.com/coralogix/coralogix-azure-serverless/commit/54df535f5e7c31e15de2500f2415b850da388330))
* add github release for eventhub abd blob to otel ([c387d3d](https://github.com/coralogix/coralogix-azure-serverless/commit/c387d3d64a510c4e8552be5b56bc63936f146fd6))
* add github release for eventhub abd blob to otel ([11f2eba](https://github.com/coralogix/coralogix-azure-serverless/commit/11f2eba0ff89ae5eb44e6cd3fb65199747ad5da5))
* add github release for eventhub abd blob to otel ([ce75f03](https://github.com/coralogix/coralogix-azure-serverless/commit/ce75f03e85587707c4469835ef9ea16452c8eaf2))
* add github release for eventhub abd blob to otel ([3f2d5ef](https://github.com/coralogix/coralogix-azure-serverless/commit/3f2d5effefaf06f45a44ac37a6d6b84453fc6ace))
* add github release for eventhub abd blob to otel ([958bbd2](https://github.com/coralogix/coralogix-azure-serverless/commit/958bbd22c4d632345a18a3fe2b5916b10c343d0d))

# [2.2.0](https://github.com/coralogix/coralogix-azure-serverless/compare/EventHub-v2.1.0...EventHub-v2.2.0) (2025-11-14)


### Features

* add github release for eventhub ([54df535](https://github.com/coralogix/coralogix-azure-serverless/commit/54df535f5e7c31e15de2500f2415b850da388330))
* add github release for eventhub abd blob to otel ([c387d3d](https://github.com/coralogix/coralogix-azure-serverless/commit/c387d3d64a510c4e8552be5b56bc63936f146fd6))
* add github release for eventhub abd blob to otel ([11f2eba](https://github.com/coralogix/coralogix-azure-serverless/commit/11f2eba0ff89ae5eb44e6cd3fb65199747ad5da5))
* add github release for eventhub abd blob to otel ([ce75f03](https://github.com/coralogix/coralogix-azure-serverless/commit/ce75f03e85587707c4469835ef9ea16452c8eaf2))
* add github release for eventhub abd blob to otel ([3f2d5ef](https://github.com/coralogix/coralogix-azure-serverless/commit/3f2d5effefaf06f45a44ac37a6d6b84453fc6ace))
* add github release for eventhub abd blob to otel ([958bbd2](https://github.com/coralogix/coralogix-azure-serverless/commit/958bbd22c4d632345a18a3fe2b5916b10c343d0d))

# Changelog

## EventHub
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.1.0 / 20 Oct 2025
* [Update] Rewrite function to use OpenTelemetry SDK with OTLP gRPC exporter for sending logs to Coralogix
* [Update] Updated deprecated Coralogix endpoints to latest ingress URLs
* [Update] Added support for custom EventHub consumer groups via `EventhubConsumerGroup` ARM template parameter (defaults to `$Default`)
* [Update] Bump Node.js runtime to version 22 

### 2.0.2 / 08 Sep 2025
[UPDATE] Modify threadID to use thread parameter instead of text

### 2.0.1 / 25 Apr 2025
[Update] Bump Node.js runtime to version 20

### 2.0.0 / 21 Feb 2023
[Update/Breaking] Replacing "Classic" Application Insights with Workspace-Based Application Insights.
