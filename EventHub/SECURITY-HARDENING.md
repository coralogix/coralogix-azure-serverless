# Security Hardening

How to respond to CIS Azure Foundations scans against the resources this
integration deploys. Counts are from a representative scan (4 Function Apps,
4 storage accounts): 76 findings, 8 High / 68 Medium.

| | Findings |
|---|---|
| Addressable now | 44 (all 8 High) |
| Not implementable on Consumption | 24 |
| Not applicable | 4 |
| Partially applicable | 4 |

## 1. Addressable now — 44

Apply in the portal on existing deployments. No redeploy, no interruption to
log delivery. Set by the ARM templates as of 3.8.5.

| CIS | Setting | # |
|---|---|---|
| 2.3.7 | HTTPS Only | 4 (High) |
| 2.1.4 | Disable FTP + SCM basic publishing credentials | 4 (High) |
| 9.3.6 | Storage minimum TLS 1.2 | 4 |
| 9.2.1 | Blob soft delete | 4 |
| 9.2.2 | Container soft delete — needs GPv2, free in-place upgrade | 4 |
| 6.1.4 | Diagnostic settings to the workspace the template already deploys | 24 |

2.3.7 and 2.1.4 are safe to apply live: there are no HTTP-triggered functions,
and deployment is via `WEBSITE_RUN_FROM_PACKAGE`, not FTP or SCM.

```bash
az webapp update -g <rg> -n <app> --set httpsOnly=true
az resource update -g <rg> --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies --name scm \
  --parent sites/<app> --set properties.allow=false      # repeat for ftp
az storage account update -g <rg> -n <sa> --min-tls-version TLS1_2 --set kind=StorageV2
az storage account blob-service-properties update -g <rg> -n <sa> \
  --enable-delete-retention true --delete-retention-days 7 \
  --enable-container-delete-retention true --container-delete-retention-days 7
az monitor diagnostic-settings create --name cis-diagnostics \
  --resource <resource-id> --workspace <existing-workspace-id> \
  --logs '[{"categoryGroup":"allLogs","enabled":true}]'
```

## 2. Not implementable on Consumption — 24

`9.3.2.3` storage default-deny · `9.3.5` allow trusted services · `2.1.9` E2E TLS ·
`2.1.14` disable public network access · `2.1.19` / `2.1.20` VNet routing — 4 each.

Not declined — impossible on this plan. On `Y1` the platform keeps the content
share on Azure Files and needs unrestricted access to it, so default-deny stops
the function starting (9.3.5 is moot without it). VNet integration is not
available on Y1 at all.

Mitigating: the apps expose no application endpoint, and the storage accounts
hold Functions runtime state only — logs go Event Hub to function to Coralogix
in memory, never to disk.

**Treatment: accepted risk, plan-limited.** Possible on Elastic Premium, or on
Flex Consumption without Premium pricing — not supported by these templates
today.

## 3. Not applicable — 4

`2.1.11` require incoming client certificates. No HTTP-triggered functions, so
there is no inbound application traffic to authenticate. The only inbound calls
are Azure platform management, which do not present certificates — `Required`
breaks portal management and deployment and protects nothing. For
management-endpoint exposure the relevant control is `2.1.14`.

## 4. Partially applicable — 4

`2.1.13` managed identities. A system-assigned identity satisfies the control,
but cannot replace the storage account keys — identity-based storage
connections are not supported on Consumption.

## Note

If the section 2 controls are later applied on Premium, the function needs
outbound access to the Event Hub and the Coralogix ingress endpoint. Blocking
either stops delivery **silently** — there is no inbound endpoint to alert on.
