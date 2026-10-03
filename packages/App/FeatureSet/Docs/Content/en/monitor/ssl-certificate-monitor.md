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

### Available Filter Types

| Filter Type                | Description                                                     |
| -------------------------- | --------------------------------------------------------------- |
| Is Valid Certificate       | Whether the certificate is valid (not expired, not self-signed) |
| Is Self-Signed Certificate | Whether the certificate is self-signed                          |
| Is Expired Certificate     | Whether the certificate has expired                             |
| Is Not A Valid Certificate | Whether the certificate is invalid                              |
| Expires In Hours           | Number of hours until the certificate expires                   |
| Expires In Days            | Number of days until the certificate expires                    |

### Filter Conditions

For **Is Valid Certificate**, **Is Self-Signed Certificate**, **Is Expired Certificate**, and **Is Not A Valid Certificate**:

- **True** — Condition is true
- **False** — Condition is false

For **Expires In Hours** and **Expires In Days**:

- **Greater Than** — Expiry is more than the specified value away
- **Less Than** — Expiry is less than the specified value away
- **Greater Than or Equal To** — Expiry is at or more than the specified value away
- **Less Than or Equal To** — Expiry is at or less than the specified value away

**Expires In Days** counts whole days: a certificate that expires in 14 days and 20 hours has 14 days left.

### Default Criteria

A new SSL certificate monitor starts with three criteria, so it warns you before a certificate expires without any setup:

1. **Certificate is not valid** — the certificate has expired, is self-signed, was issued for another host name or by an untrusted authority, or could not be checked because the endpoint did not answer. The monitor is marked **Offline** and an incident called "_monitor name_ certificate is not valid" is created. Its root cause says which of these it was. The incident resolves itself once the certificate is valid again.
2. **Certificate expires soon** — the certificate is valid but expires in 14 days or less. An **alert** called "_monitor name_ certificate expires soon" is created.
3. **Certificate is valid** — the monitor is marked **Operational**.

The "expires soon" warning is an alert, not an incident: it does not show on your status pages, it pages nobody unless you add an on-call policy to it, and it does not change the monitor's status. It uses your project's second alert severity, **Low** on a new project. When the renewed certificate is picked up, the monitor is back on "Certificate is valid" and the alert resolves itself.

Criteria are checked from top to bottom, and the first one that matches decides what happens. That is why "expires soon" sits above "is valid": an expiring certificate is still valid, so it would match both.

To be warned earlier, change the value of the **Expires In Days** filter in the "expires soon" criteria, for example to `30`. To open an incident instead, turn on **Create incident** in that criteria.

Monitors created before OneUptime added this warning have no "expires soon" criteria. To add it, create a criteria with **Is Valid Certificate** / **True** and **Expires In Days** / **Less Than or Equal To** / `14`, filter condition **All**, that creates an alert and does not change the monitor status, and move it above the criteria that marks the monitor as online.

### Example Criteria

#### Mark as degraded if certificate expires within 30 days

- **Filter Type**: Expires In Days
- **Filter Condition**: Less Than
- **Value**: 30

#### Mark as offline if certificate is expired

- **Filter Type**: Is Expired Certificate
- **Filter Condition**: True

#### Alert if certificate is self-signed

- **Filter Type**: Is Self-Signed Certificate
- **Filter Condition**: True

#### Mark as offline if certificate is invalid

- **Filter Type**: Is Not A Valid Certificate
- **Filter Condition**: True

## Best Practices

1. **Give yourself time to renew** — The default warning comes 14 days before expiry, which suits certificates that renew themselves. If renewing takes you longer (a certificate you buy, or a change process), raise it to 30 days
2. **Monitor all endpoints** — If you have multiple domains or subdomains, create a monitor for each
3. **Include non-standard ports** — Don't forget services running HTTPS on non-standard ports
4. **Monitor after renewal** — After renewing a certificate, verify the monitor confirms it is valid
