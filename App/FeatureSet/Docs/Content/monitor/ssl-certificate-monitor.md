# SSL Certificate Monitor

SSL Certificate monitoring allows you to monitor the validity and expiration of SSL/TLS certificates on your websites and services. OneUptime periodically checks your certificates and alerts you before they expire or if any issues are detected.

## Overview

SSL Certificate monitors connect to your HTTPS endpoints and inspect the SSL/TLS certificate. This enables you to:

- Monitor certificate expiration dates
- Detect expired or soon-to-expire certificates
- Identify self-signed certificates
- Verify certificate validity
- Prevent service outages caused by expired certificates

## Creating an SSL Certificate Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **SSL Certificate** as the monitor type
4. Enter the URL of the HTTPS endpoint to check
5. Configure monitoring criteria as needed

## Configuration Options

### URL

Enter the full HTTPS URL of the endpoint whose SSL certificate you want to monitor (e.g., `https://example.com` or `https://example.com:8443`).

## Monitoring Criteria

You can configure criteria to determine when your certificate status is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Is Online | Whether the server is reachable |
| Is Valid Certificate | Whether the certificate is valid (not expired, not self-signed) |
| Is Self-Signed Certificate | Whether the certificate is self-signed |
| Is Expired Certificate | Whether the certificate has expired |
| Is Not A Valid Certificate | Whether the certificate is invalid |
| Expires In Hours | Number of hours until the certificate expires |
| Expires In Days | Number of days until the certificate expires |
| Is Request Timeout | Whether the connection timed out |

### Filter Types

For **Is Online**, **Is Valid Certificate**, **Is Self-Signed Certificate**, **Is Expired Certificate**, **Is Not A Valid Certificate**, and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Expires In Hours** and **Expires In Days**:

- **Greater Than** — Expiry is more than the specified value away
- **Less Than** — Expiry is less than the specified value away
- **Greater Than or Equal To** — Expiry is at or more than the specified value away
- **Less Than or Equal To** — Expiry is at or less than the specified value away
- **Equal To** — Expiry matches exactly
- **Not Equal To** — Expiry does not match

### Example Criteria

#### Mark as degraded if certificate expires within 30 days

- **Check On**: Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Mark as offline if certificate is expired

- **Check On**: Is Expired Certificate
- **Filter Type**: True

#### Alert if certificate is self-signed

- **Check On**: Is Self-Signed Certificate
- **Filter Type**: True

#### Mark as offline if certificate is invalid

- **Check On**: Is Not A Valid Certificate
- **Filter Type**: True

## Best Practices

1. **Set multiple thresholds** — Use degraded status at 30 days and offline at 7 days before expiry to give yourself time to renew
2. **Monitor all endpoints** — If you have multiple domains or subdomains, create a monitor for each
3. **Include non-standard ports** — Don't forget services running HTTPS on non-standard ports
4. **Monitor after renewal** — After renewing a certificate, verify the monitor confirms it is valid
