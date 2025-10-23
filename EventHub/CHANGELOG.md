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