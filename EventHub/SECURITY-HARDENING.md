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

---

## Customer response template

Copy from here. Counts are from a representative scan — replace with the
customer's own before sending.

> Hi,
>
> We've completed our review of the scan findings. Summary of our position,
> with a line-by-line breakdown below.
>
> Our recommendation is to address these directly on your existing deployments
> rather than wait on a change to the integration. The reason is practical: the
> Coralogix templates are deployment-time artefacts, so any change we make only
> affects newly deployed resources. It would not alter the resources already
> running in your subscription, and therefore would not clear your current
> scan. Applying the settings to the existing resources is both the faster
> route and the only one that actually closes the findings.
>
> Most of this is straightforward. 44 of the 76 findings — including all 8
> High-severity items — can be applied in the Azure portal today, with no
> redeploy and no interruption to log delivery. That clears the High category
> entirely.
>
> Of the remainder, 24 cannot be implemented on the Consumption plan at all
> (not a matter of effort — the platform does not support them), 4 do not apply
> to this workload, and 4 are partially applicable. We've set out the
> justification for each so it can go straight into your audit documentation.
>
> We are separately hardening the templates so that future deployments ship
> with these defaults, but that is a forward-looking change and not something
> your audit depends on.
>
> **1. Addressable now — 44 findings, including all 8 High.** Apply in the
> Azure portal; safe to apply live. `2.3.7` HTTPS Only (4, High) · `2.1.4`
> disable FTP/SCM basic publishing credentials (4, High) · `9.3.6` storage
> minimum TLS 1.2 (4) · `9.2.1` blob soft delete (4) · `9.2.2` container soft
> delete (4) · `6.1.4` diagnostic settings to Log Analytics (24).
>
> 2.3.7 and 2.1.4 are safe on the running integration — the Function Apps
> contain no HTTP-triggered functions and are not deployed over FTP or SCM, so
> these remove a credential and a plaintext path that nothing uses. 9.2.2
> requires the storage accounts on general-purpose v2; they were created as v1
> and the upgrade is free, in-place and non-disruptive. 6.1.4 is the largest
> group and the cheapest to close — the Coralogix template already deploys a
> Log Analytics workspace alongside each Function App, so the diagnostic
> settings point at a workspace you already have.
>
> **2. Not implementable on the Consumption plan — 24 findings, Medium.**
> `9.3.2.3` storage default-deny · `9.3.5` allow trusted services · `2.1.9`
> end-to-end TLS · `2.1.14` disable public network access · `2.1.19` / `2.1.20`
> VNet routing — 4 each.
>
> These are not being declined; they cannot be applied on this plan. On
> Consumption, the Azure Functions platform stores the function's content share
> on Azure Files and requires unrestricted access to it, so setting the storage
> account to default-deny prevents the function from starting. "Allow trusted
> services" has no effect without a default-deny rule and is moot on the same
> grounds. Virtual network integration is not available on Consumption at all,
> which covers the remaining four.
>
> Mitigating factors for your risk assessment: the Function Apps expose no
> application endpoint, and the flagged storage accounts hold Azure Functions
> runtime state only — no log data is written to them, as logs move from Event
> Hub through the function to Coralogix in memory.
>
> Recommended treatment: accepted risk, documented as plan-limited. These
> become implementable on Elastic Premium; Flex Consumption would also cover
> them without Premium pricing, and is not supported by the current templates.
>
> **3. Not applicable — 4 findings, Medium.** `2.1.11` require incoming client
> certificates. The integration contains no HTTP-triggered functions, so there
> is no inbound application traffic for a client certificate to authenticate.
> The only inbound requests are Azure platform management calls, which do not
> present client certificates — setting this to Required would break portal
> management and deployment without protecting any data path. Where the
> underlying concern is exposure of the management endpoint, the relevant
> control is 2.1.14 in section 2.
>
> **4. Partially applicable — 4 findings, Medium.** `2.1.13` managed
> identities. A system-assigned identity can be enabled and satisfies the
> control as written, but cannot replace the storage account keys in use, as
> identity-based storage connections are not supported on Consumption.
> Recommended treatment: enable the identity; record the storage connection as
> a plan limitation.
>
> **Outcome after section 1:** High 8 → 0, Medium 68 → 32.
>
> One operational note: if the section 2 controls are implemented later on a
> Premium plan, the function makes outbound connections to your Event Hub and
> to the Coralogix ingress endpoint. Both must remain permitted, or log
> delivery will stop silently — there is no inbound endpoint to alert on. We
> recommend validating delivery in Coralogix after any networking change.
>
> Happy to walk through any of this on a call.
