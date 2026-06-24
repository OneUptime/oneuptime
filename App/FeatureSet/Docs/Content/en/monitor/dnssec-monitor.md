# DNSSEC Monitor

DNSSEC monitoring lets you validate the cryptographic integrity of DNS responses for your zones. OneUptime periodically performs full DNSSEC validation — checking DNSKEY records, DS delegation at the parent zone, RRSIG signature validity, resolver consensus on the AD flag, and consistency between authoritative nameservers.

## Overview

DNSSEC monitors validate the entire chain of trust from the root zone down to your domain. This enables you to:

- Detect broken DNSSEC chains before resolvers start returning SERVFAIL to your users
- Get warned before zone-signing keys expire
- Verify your DS records are correctly published at the parent zone
- Catch divergence between authoritative nameservers (primary/secondary out of sync)
- Confirm validating resolvers actually set the AD flag for your zone

## Creating a DNSSEC Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **DNSSEC** as the monitor type
4. Enter the zone (domain) you want to validate
5. Configure resolvers and monitoring criteria as needed

## Configuration Options

### Basic Settings

| Field                        | Description                                                                              | Required |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Zone (Domain Name)           | The zone to validate via DNSSEC (e.g. `example.com`)                                     | Yes      |
| Resolvers                    | Comma-separated list of validating resolvers to query (e.g. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Yes      |
| Check Nameserver Consistency | Query each authoritative nameserver directly and verify they return the same SOA serial  | No       |

### Advanced Settings

| Field                           | Description                                   | Default |
| ------------------------------- | --------------------------------------------- | ------- |
| Signature Expiry Warning (days) | Default threshold for the RRSIG expiry filter | 7       |
| Timeout (ms)                    | How long to wait for each DNS query           | 10000   |
| Retries                         | Number of retry attempts on failure           | 3       |

## Monitoring Criteria

You can configure criteria to determine when your zone is considered online, degraded, or offline based on:

### Available Check Types

| Check Type                          | Description                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| DNSSEC Chain Is Valid               | The entire validation chain (root → TLD → zone) resolves correctly |
| DNSSEC DNSKEY Record Exists         | The zone publishes at least one DNSKEY record                      |
| DNSSEC DS Record Exists At Parent   | The parent zone publishes a DS record matching the zone's KSK      |
| DNSSEC Signature Expires In Days    | Days until the soonest RRSIG signature expires                     |
| DNSSEC Resolver Consensus (AD Flag) | Every queried resolver returns the AD (Authenticated Data) flag    |
| DNSSEC Nameservers Are Consistent   | All authoritative nameservers return the same SOA serial           |
| DNSSEC Is Valid                     | Aggregate pass/fail across all validation checks                   |

### Filter Types

For **DNSSEC Chain Is Valid**, **DNSSEC DNSKEY Record Exists**, **DNSSEC DS Record Exists At Parent**, **DNSSEC Resolver Consensus (AD Flag)**, **DNSSEC Nameservers Are Consistent**, and **DNSSEC Is Valid**:

- **True** — Condition is true
- **False** — Condition is false

For **DNSSEC Signature Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

### Example Criteria

#### Alert if the DNSSEC chain is broken

- **Check On**: DNSSEC Chain Is Valid
- **Filter Type**: False

#### Warn before signatures expire

- **Check On**: DNSSEC Signature Expires In Days
- **Filter Type**: Less Than
- **Value**: 7

#### Catch missing DS at parent (delegation broken)

- **Check On**: DNSSEC DS Record Exists At Parent
- **Filter Type**: False

#### Detect resolver disagreement

- **Check On**: DNSSEC Resolver Consensus (AD Flag)
- **Filter Type**: False

#### Catch nameserver split-brain

- **Check On**: DNSSEC Nameservers Are Consistent
- **Filter Type**: False

## Best Practices

1. **Use multiple public resolvers** — Default to `1.1.1.1`, `8.8.8.8`, and `9.9.9.9` so a single resolver's outage doesn't cause false positives
2. **Warn well before expiry** — Configure degraded alerts at 7 days and offline alerts at 2 days before signature expiry; key rollovers can fail silently
3. **Monitor every signed zone** — Include apex domains, signed subdomains, and any zone delegated to a different operator
4. **Enable nameserver consistency checks** — Catches primary/secondary sync issues that DNSSEC validation alone would miss, unless your network blocks outbound DNS to arbitrary IPs
