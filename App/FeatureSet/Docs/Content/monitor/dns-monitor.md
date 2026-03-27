# DNS Monitor

DNS monitoring allows you to monitor the health and correctness of DNS resolution for your domains. OneUptime periodically queries DNS records and validates the responses against your configured criteria.

## Overview

DNS monitors query DNS servers for specific record types and evaluate the results. This enables you to:

- Monitor DNS service availability
- Verify DNS records are returning correct values
- Track DNS resolution response times
- Validate DNSSEC configuration
- Detect DNS propagation issues or hijacking

## Creating a DNS Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **DNS** as the monitor type
4. Enter the domain name and record type to query
5. Configure monitoring criteria as needed

## Configuration Options

### Basic Settings

| Field | Description | Required |
|-------|-------------|----------|
| Domain Name | The domain to query (e.g., `example.com`) | Yes |
| Record Type | The DNS record type to query | Yes |
| DNS Server | Custom DNS server to use (e.g., `8.8.8.8`). Leave empty for system default | No |

### Supported Record Types

| Record Type | Description |
|-------------|-------------|
| A | IPv4 address records |
| AAAA | IPv6 address records |
| CNAME | Canonical name (alias) records |
| MX | Mail exchange records |
| NS | Nameserver records |
| TXT | Text records (SPF, DKIM, etc.) |
| SOA | Start of Authority records |
| PTR | Pointer records (reverse DNS) |
| SRV | Service locator records |
| CAA | Certificate Authority Authorization records |

### Advanced Settings

| Field | Description | Default |
|-------|-------------|---------|
| Port | DNS port number | 53 |
| Timeout (ms) | How long to wait for a response | 5000 |
| Retries | Number of retry attempts on failure | 3 |

## Monitoring Criteria

You can configure criteria to determine when your DNS is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| DNS Is Online | Whether the DNS server responds to queries |
| DNS Response Time (in ms) | Query response time in milliseconds |
| DNS Record Exists | Whether DNS records exist for the query |
| DNS Record Value | The value returned by a DNS record |
| DNSSEC Is Valid | Whether DNSSEC validation passes |

### Filter Types

For **DNS Is Online**, **DNS Record Exists**, and **DNSSEC Is Valid**:

- **True** — Condition is true
- **False** — Condition is false

For **DNS Response Time**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

For **DNS Record Value**:

- **Contains** — Record value contains the specified text
- **Not Contains** — Record value does not contain the specified text
- **Starts With** — Record value starts with the specified text
- **Ends With** — Record value ends with the specified text
- **Equal To** — Record value matches exactly
- **Not Equal To** — Record value does not match

### Example Criteria

#### Check if DNS is resolving

- **Check On**: DNS Is Online
- **Filter Type**: True

#### Verify A record points to correct IP

- **Check On**: DNS Record Value
- **Filter Type**: Equal To
- **Value**: `93.184.216.34`

#### Alert if DNS response is slow

- **Check On**: DNS Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Verify DNSSEC is valid

- **Check On**: DNSSEC Is Valid
- **Filter Type**: True
