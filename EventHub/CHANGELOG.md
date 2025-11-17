## [2.1.1](https://github.com/coralogix/coralogix-azure-serverless/compare/EventHub-v2.1.0...EventHub-v2.1.1) (2025-11-17)


### Bug Fixes

* temp release ([27eb5ee](https://github.com/coralogix/coralogix-azure-serverless/commit/27eb5eebd4638221093f07b2494f3a68dfb5a783))

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
