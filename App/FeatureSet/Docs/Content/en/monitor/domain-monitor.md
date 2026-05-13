# Domain Monitor

Domain monitoring allows you to monitor the registration status and expiration of your domain names. OneUptime periodically performs WHOIS lookups to track your domain's health and alert you before it expires.

## Overview

Domain monitors query WHOIS data for your domains to track registration details. This enables you to:

- Monitor domain expiration dates
- Detect expired or soon-to-expire domains
- Track domain registrar information
- Verify nameserver configuration
- Monitor domain status codes

## Creating a Domain Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Domain** as the monitor type
4. Enter the domain name you want to monitor
5. Configure monitoring criteria as needed

## Configuration Options

### Basic Settings

| Field | Description | Required |
|-------|-------------|----------|
| Domain Name | The domain to monitor (e.g., `example.com`) | Yes |

### Advanced Settings

| Field | Description | Default |
|-------|-------------|---------|
| Timeout (ms) | How long to wait for a WHOIS response | 10000 |
| Retries | Number of retry attempts on failure | 3 |

## Monitoring Criteria

You can configure criteria to determine when your domain is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Domain Expires In Days | Number of days until the domain registration expires |
| Domain Registrar | The domain registrar name |
| Domain Name Server | Nameserver hostnames for the domain |
| Domain Status Code | WHOIS domain status codes |
| Domain Is Expired | Whether the domain has expired |

### Filter Types

For **Domain Is Expired**:

- **True** — Domain has expired
- **False** — Domain has not expired

For **Domain Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

For **Domain Registrar**, **Domain Name Server**, and **Domain Status Code**:

- **Contains** — Value contains the specified text
- **Not Contains** — Value does not contain the specified text
- **Starts With** — Value starts with the specified text
- **Ends With** — Value ends with the specified text
- **Equal To** — Value matches exactly
- **Not Equal To** — Value does not match

### Example Criteria

#### Alert if domain expires within 30 days

- **Check On**: Domain Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Mark as offline if domain is expired

- **Check On**: Domain Is Expired
- **Filter Type**: True

#### Verify nameservers are correct

- **Check On**: Domain Name Server
- **Filter Type**: Contains
- **Value**: `ns1.example.com`

## Best Practices

1. **Set early warnings** — Configure degraded alerts at 60 days and offline alerts at 14 days before expiry
2. **Monitor all critical domains** — Include primary domains, subdomains registered separately, and any domains used for email or APIs
3. **Track registrar changes** — Monitor the registrar field to detect unauthorized domain transfers
