# Security Policy

We take the security of OneUptime seriously. Thank you for helping us keep OneUptime and its users safe.

## Reporting a Vulnerability

**Please report security vulnerabilities privately through GitHub Security Advisories:**

👉 **[Report a vulnerability](https://github.com/OneUptime/oneuptime/security/advisories/new)**

You can also get there from the [Security tab](https://github.com/OneUptime/oneuptime/security) of the repository → "Report a vulnerability".

This creates a private advisory that only you and the OneUptime maintainers can see, so the issue can be fixed before it becomes public.

**Please do not:**

- Open a public GitHub issue, discussion, or pull request describing the vulnerability.
- Post details on social media, forums, or a blog before a fix has been released.
- Access, modify, or exfiltrate data belonging to anyone other than yourself while testing.

If you are unable to use GitHub Security Advisories for any reason, email the [core maintainers](MAINTAINERS) directly and we will open an advisory on your behalf.

## What to Include in Your Report

The more detail you give us, the faster we can confirm and fix the issue. Where possible, please include:

- **Type of issue** — e.g. authentication bypass, privilege escalation, SQL injection, XSS, SSRF, RCE, exposed secret.
- **Affected component** — which service or package (`App`, `Probe`, `Common`, `Nginx`, `Runner`, an agent, the Helm chart, etc.), and file paths or URLs if you have them.
- **Version** — the OneUptime release, Docker image tag, or commit SHA you tested against.
- **Deployment type** — OneUptime Cloud, self-hosted Docker Compose, or self-hosted Kubernetes/Helm.
- **Steps to reproduce** — a minimal proof of concept, request/response pairs, or a short script.
- **Impact** — what an attacker can actually do with this, and what access they need to start.
- **Suggested remediation**, if you have one.

## Our Process

1. **Acknowledgement** — we aim to acknowledge new reports within 3 business days.
2. **Triage** — we confirm the issue, determine severity, and identify affected versions. We will let you know if we need more information.
3. **Fix** — we develop and test a fix privately in the advisory. We will keep you updated on progress.
4. **Release** — we ship the fix in a new release and publish the advisory with a CVE where applicable.
5. **Credit** — we will credit you in the advisory by name or handle unless you ask us not to.

We ask that you give us a reasonable opportunity to fix the issue before any public disclosure, and we will work with you on disclosure timing.

## Scope

**In scope:**

- The code in this repository, including all services, agents, the CLI, the Helm chart, and Docker images published by OneUptime.
- OneUptime Cloud (`oneuptime.com` and its subdomains).

**Out of scope:**

- Vulnerabilities in third-party dependencies that have not been exploited through OneUptime — please report those upstream. If OneUptime's use of the dependency makes it exploitable, we do want to hear about it.
- Findings that require a misconfigured or intentionally insecure self-hosted deployment (for example, running with the `please-change-this-to-random-value` placeholder secrets from `config.example.env`, or exposing internal services to the public internet).
- Denial of service, volumetric, or brute-force testing against OneUptime Cloud or any infrastructure you do not own.
- Social engineering, phishing, or physical attacks against OneUptime staff or users.
- Reports that consist solely of automated scanner output with no demonstrated impact.
- Missing security headers, cookie flags, or TLS configuration issues with no demonstrated exploit.

Please only test against your own self-hosted instance or your own OneUptime Cloud account.

## Supported Versions

We provide security fixes for the **latest release only**. Fixes ship in a new release rather than as patches to older versions, so please keep your deployment up to date with the [latest release](https://github.com/OneUptime/oneuptime/releases).

## Security Advisories

Published advisories are available on the [advisories page](https://github.com/OneUptime/oneuptime/security/advisories). Watch the repository (Watch → Custom → Security alerts) to be notified when a new one is published.

## Hardening Your Deployment

If you self-host OneUptime, a few things matter more than anything else:

- **Change every placeholder secret** in `config.env` before your first production start. Anything still set to `please-change-this-to-random-value` — `ONEUPTIME_SECRET`, `ENCRYPTION_SECRET`, `DATABASE_PASSWORD`, `CLICKHOUSE_PASSWORD`, `REDIS_PASSWORD` — must be replaced with a long random value.
- **Terminate TLS** in front of OneUptime and keep the public surface limited to the ingress; Postgres, ClickHouse, and Redis should never be reachable from the internet.
- **Keep up to date** — subscribe to releases so you pick up security fixes promptly.
- **Back up your data** and test that you can restore it.
