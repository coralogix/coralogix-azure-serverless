# Azure EventHub Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

The Azure EventHub integration allows parsing of queue messages in JSON format. Other format messages will not be processed and submitted to the Coralogix platform.

## Prerequisites

* An Azure account with an active subscription.

* A configured EventHub Instance to monitor.

* A Coralogix account with a Send Your Data API Key.

## Azure Resource Manager Template Deployment

### Deploy via Azure Portal

Deploy the EventHub integration by clicking the button below and signing into your Azure account:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Fmaster%2FEventHub%2FARM%2FEventHubV2.json)

## Fields

**Subscription** - The Azure Subscription into which you wish to deploy the integration (Must be the same as the monitored Event Hub Namespace).

**Resource Group** - The Resource Group into which you wish to deploy the integration.

**Coralogix Region** - The region of the Coralogix account (EU1, EU2, US1, US2, AP1, AP2, AP3, or Custom). For more details see [Account Settings / Coralogix Domains](https://coralogix.com/docs/user-guides/account-management/account-settings/coralogix-domain/).

**Custom URL** - Your Custom URL for the Coralogix account. Only required if you selected 'Custom' as the Coralogix Region.

**Coralogix Private Key** – Can be found in your Coralogix account under Settings -> Send your logs. It is located in the upper left corner.

**Coralogix Application** – A mandatory metadata field that is sent with each log and helps to classify it.

**Coralogix Subsystem** – A mandatory metadata field that is sent with each log and helps to classify it.

**Coralogix Application Selector** (Optional) - Dynamic application name selector. Supports template syntax `{{$.field}}` for JSON logs or regex syntax `/pattern/` for plain text. Supports fallback expressions with `||` (e.g., `{{$.category || $.metricName}}`). Falls back to static `CoralogixApplication` when selector doesn't match.

**Coralogix Subsystem Selector** (Optional) - Dynamic subsystem name selector. Supports template syntax `{{$.field}}` for JSON logs or regex syntax `/pattern/` for plain text. Supports fallback expressions with `||` (e.g., `{{$.operationName || $.ApiName}}`). Falls back to static `CoralogixSubsystem` when selector doesn't match.

**Eventhub Resource Group** - The name of the Resource Group that contains the EventHub.

**EventHub Namespace** - The name of the EventHub Namespace.

**EventHub Instance Name** - The name of the EventHub Instance to be monitored.

**EventHub Shared Access Key Name** - The name of the EventHub Shared Access Key (e.g., RootManageSharedAccessKey).

**EventHub Consumer Group** - The name of the EventHub Consumer Group (defaults to $Default if not specified).

**Function App Service Plan Type** - The type of the Function App Service Plan. Choose Premium if you need vNet Support.

**Function App Name** (Optional) - Custom name for the Azure Function to be used in Coralogix logs. Defaults to 'coralogix-eventhub-func-{uniqueId}' if not specified.

**Newline Pattern** (Optional) - Regex pattern to split multi-line text logs into separate entries. Example: `\n` to split on newlines. Leave empty to treat text as a single log entry.

**Blocking Pattern** (Optional) - Regex pattern to filter/block logs. Logs matching this pattern will not be sent to Coralogix. Example: `healthcheck|heartbeat` to filter health check logs, or `secret` to block logs containing sensitive data.

## Configuration Examples for Application and Subsystem names

### JSON Logs (Template Syntax)

For JSON-formatted logs, use the template syntax with `{{ }}`:

```bash
# Static values
CORALOGIX_APPLICATION="Azure"
CORALOGIX_SUBSYSTEM="Production"

# Simple field extraction from JSON body
CORALOGIX_APPLICATION="{{ $.category }}"
CORALOGIX_SUBSYSTEM="{{ $.properties.appName }}"

# Use enriched Azure metadata from attributes
CORALOGIX_SUBSYSTEM="{{ attributes.azure.resource_group }}"

# Extract with regex (case-insensitive)
CORALOGIX_SUBSYSTEM="{{ $.resourceId | r'/resourcegroups/([^/]+)/i' }}"

# Multiple fallbacks
CORALOGIX_SUBSYSTEM="{{ $.properties.appName || $.properties.roleInstance || $.location }}"

# Combine fallbacks with regex
CORALOGIX_SUBSYSTEM="{{ $.properties.appName || $.resourceId | r'/resourcegroups/([^/]+)/i' }}"
```

### Plain Text Logs (Regex Syntax)

For plain text logs, use the regex-only syntax with `/pattern/`:

```bash
# Extract from plain text like: "APP=payment-service ENV=production STATUS=ok"
CORALOGIX_APPLICATION="/APP=([^\s]+)/"
CORALOGIX_SUBSYSTEM="/ENV=([^\s]+)/"

# Extract hostname from syslog-style logs
CORALOGIX_SUBSYSTEM="/^[A-Za-z]{3}\s+\d+\s+[\d:]+\s+([^\s]+)/"
```

### Fallback Behavior for dynamic Application and Subsystem name

When a selector template or regex pattern doesn't match, the function follows this fallback chain:

1. **Selector** (`CoralogixApplicationSelector` / `CoralogixSubsystemSelector`) - Dynamic extraction from log body
2. **Static value** (`CoralogixApplication` / `CoralogixSubsystem`) - ARM template parameters
3. **Default** (`coralogix-azure-eventhub` / `azure`) - Built-in defaults

| Scenario | Result |
|----------|--------|
| Selector matches | Extracted value is used |
| Selector doesn't match | Falls back to static `CoralogixApplication`/`CoralogixSubsystem` |
| Field doesn't exist | Falls back to static `CoralogixApplication`/`CoralogixSubsystem` |
| No selector configured | Uses static `CoralogixApplication`/`CoralogixSubsystem` |
| No static value configured | Falls back to built-in defaults |

## Blocking Pattern

Use the `BLOCKING_PATTERN` environment variable to filter out logs that match a regex pattern. Blocked logs are not sent to Coralogix.

```bash
# Block logs containing sensitive data
BLOCKING_PATTERN="password|secret|token"

# Block specific log levels
BLOCKING_PATTERN="\\[DEBUG\\]|\\[TRACE\\]"
```