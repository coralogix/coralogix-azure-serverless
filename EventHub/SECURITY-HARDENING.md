# Security Hardening — EventHub Integration

Reference for responding to CIS Azure Foundations benchmark scans against the
resources this integration deploys (Function App, storage account, Log Analytics
workspace, Application Insights).

Counts below are from a representative customer scan across 8 resource groups
(4 Function Apps, 4 storage accounts) — 76 findings, 8 High and 68 Medium. Your
totals will scale with the number of deployments.

## Summary

| | Findings | Severity |
|---|---|---|
| Addressable now | 44 | includes all 8 High |
| Not implementable on Consumption | 24 | Medium |
| Not applicable | 4 | Medium |
| Partially applicable | 4 | Medium |

After applying section 1: **High 8 → 0, Medium 68 → 32.**

## 1. Addressable now — 44

Apply directly in the Azure portal on existing deployments. No redeploy, no
interruption to log delivery.

| Setting | Findings | Resource |
|---|---|---|
| Enable HTTPS Only | 4 (High) | Function App |
| Disable FTP + SCM basic publishing credentials | 4 (High) | Function App |
| Storage minimum TLS 1.2 | 4 | Storage account |
| Blob + container soft delete | 8 | Storage account |
| Diagnostic settings → existing Log Analytics workspace | 24 | All |

Notes:

- The first two are safe because the integration has **no HTTP-triggered
  functions** and is not deployed over FTP or SCM. They remove a credential and
  a plaintext path that nothing uses.
- Container soft delete requires general-purpose v2. Templates before 3.8.5
  created v1 accounts; the upgrade is free, in-place and non-disruptive.
- The diagnostic-settings group is the largest and the cheapest to close — the
  template already deploys a Log Analytics workspace alongside each Function
  App, so no new resource is needed.

```bash
az webapp update -g <rg> -n <app> --set httpsOnly=true

az resource update -g <rg> --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies --name scm \
  --parent sites/<app> --set properties.allow=false      # repeat for ftp

az storage account update -g <rg> -n <sa> --min-tls-version TLS1_2 \
  --set kind=StorageV2

az storage account blob-service-properties update -g <rg> -n <sa> \
  --enable-delete-retention true --delete-retention-days 7 \
  --enable-container-delete-retention true \
  --container-delete-retention-days 7

az monitor diagnostic-settings create --name cis-diagnostics \
  --resource <resource-id> --workspace <existing-workspace-id> \
  --logs '[{"categoryGroup":"allLogs","enabled":true}]' \
  --metrics '[{"category":"AllMetrics","enabled":true}]'
```

As of 3.8.5 these are set by the ARM templates, so new deployments are hardened
by default.

## 2. Not implementable on the Consumption plan — 24

| Control | Findings |
|---|---|
| Storage default network access: Deny | 4 |
| Storage: allow trusted Azure services access | 4 |
| End-to-end TLS encryption | 4 |
| Disable public network access | 4 |
| Route configuration through the virtual network | 4 |
| Route all traffic through the virtual network | 4 |

**Not declined — cannot be applied on this plan.**

On Consumption (`Y1`), the Functions platform stores the function's content
share on Azure Files via `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` and requires
unrestricted access to it. Setting the storage account to default-deny prevents
the function from starting. "Allow trusted services" has no effect without a
default-deny rule, so it is moot on the same grounds. VNet integration is not
available on Consumption at all, which covers the remaining four.

Mitigating factors for a risk assessment:

- The Function Apps expose **no application endpoint** — no HTTP-triggered
  functions, invoked solely by Event Hub messages.
- The storage accounts hold **Azure Functions runtime state only**. No log data
  is written to them; logs move from Event Hub through the function to Coralogix
  in memory.

Recommended treatment: **accepted risk, documented as plan-limited.**

These become implementable on Elastic Premium. Flex Consumption would also cover
them without Premium pricing — it replaces the Azure Files content share with a
blob deployment container and supports VNet integration natively. Not currently
supported by these templates.

## 3. Not applicable — 4

**Enable and require incoming client certificates.**

No HTTP-triggered functions means no inbound application traffic for a client
certificate to authenticate. The only inbound requests are Azure platform
management calls, which do not present client certificates — setting this to
`Required` breaks portal management and deployment without protecting any data
path.

Where the concern is exposure of the management endpoint, the relevant control
is restricting inbound network access (section 2).

Recommended treatment: **not applicable.**

## 4. Partially applicable — 4

**Configure managed identities.**

A system-assigned managed identity can be enabled and satisfies the control as
written. It cannot replace the storage account keys in use — identity-based
storage connections are not supported on Consumption.

Recommended treatment: enable the identity; record the storage connection as a
plan limitation.

## Operational note

If the section 2 controls are later implemented on Premium, the function makes
outbound connections to the Event Hub and to the Coralogix ingress endpoint.
Both must remain permitted or log delivery stops **silently** — there is no
inbound endpoint to alert on. Validate delivery in Coralogix after any
networking change.
