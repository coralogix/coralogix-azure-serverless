# Changelog

## DiagnosticData
<!-- To add a new entry write: -->
<!-- ### version / full date -->
<!-- * [Update/Bug fix] message that describes the changes that you apply -->

### 2.1.0 / 11 Aug 2026
[Update] Migrate legacy Coralogix domains to the regional domains
* `CoralogixRegion` now accepts the region codes `EU1`, `EU2`, `US1`, `US2`, `US3`, `AP1`, `AP2`, `AP3`
* The legacy region names (`Europe(eu-west-1)`, `US(us-east-2)`, `US2(us-west-2)`, `Europe2(eu-north-1)`, `India(ap-south-1)`, `Singapore(ap-southeast-1)`) are still accepted and map to the same endpoints
* Endpoints now use `ingress.<region>.coralogix.com`; default region is `EU1`
* The hardcoded `CORALOGIX_URL` fallback now points at `ingress.eu1.coralogix.com` (same cluster as before)

### 2.0.3 / 6 Aug 2025
[Update] Fix module compatibility

### 2.0.2 / 25 Apr 2025
[Update] Bump Node.js runtime to version 20

### 2.0.1 / 22 Feb 2023
[BUG] Update ARM template for incorrect "default value"

### 2.0.0 / 21 Feb 2023
[Update/Breaking] Replacing "Classic" Application Insights with Workspace-Based Application Insights.
