# Security Hardening

| | Findings |
|---|---|
| Addressable now | 48 (all 8 High) |
| Not implementable on Consumption | 24 |
| Not applicable | 4 |

## 1. Addressable now - 48

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
| 2.1.13 | Managed identity - satisfies the control; can't replace storage keys on Y1 | 4 |

2.3.7 and 2.1.4 are safe to apply live: there are no HTTP-triggered functions,
and deployment is via `WEBSITE_RUN_FROM_PACKAGE`, not FTP or SCM.

## 2. Not implementable on Consumption — 24

`9.3.2.3` storage default-deny · `9.3.5` allow trusted services · `2.1.9` E2E TLS ·
`2.1.14` disable public network access · `2.1.19` / `2.1.20` VNet routing — 4 each.

## 3. Not applicable — 4

`2.1.11` require incoming client certificates. No HTTP-triggered functions, so
there is no inbound application traffic to authenticate. The only inbound calls
are Azure platform management, which do not present certificates — `Required`
breaks portal management and deployment and protects nothing. For
management-endpoint exposure the relevant control is `2.1.14`.
