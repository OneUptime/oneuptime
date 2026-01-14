# Incoming Email Monitor

Incoming Email Monitor allows you to create and resolve alerts based on emails sent to unique monitor-specific email addresses. This is useful for integrating with legacy systems, third-party alerting tools, or any service that can send email notifications.

## How It Works

1. When you create an Incoming Email Monitor, OneUptime generates a unique email address for that monitor
2. Any email sent to that address is received and evaluated against your configured criteria
3. Based on the criteria, OneUptime can create new alerts or resolve existing ones

This is a powerful way to integrate email-based alerting systems with OneUptime's incident management workflow.

## Creating an Incoming Email Monitor

1. Navigate to **Monitors** in your OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Incoming Email** as the monitor type
4. Configure the monitor settings:
   - **Name:** A descriptive name for your monitor
   - **Description:** What this monitor is for
5. Set up your **Alert Creation Criteria** (conditions that create alerts)
6. Set up your **Alert Resolution Criteria** (conditions that resolve alerts)
7. Click **Create**

After creation, you'll see the unique email address for this monitor displayed on the monitor details page.

## Email Address Format

Each Incoming Email Monitor gets a unique email address in the format:

```
monitor-{secret-key}@{inbound-domain}
```

For example: `monitor-abc123def456@inbound.yourdomain.com`

You can copy this address from the monitor details page and configure your external systems to send emails to it.

## Available Criteria Fields

You can create criteria based on the following email fields:

| Field | Description |
|-------|-------------|
| **Email Subject** | The subject line of the incoming email |
| **Email From** | The sender's email address |
| **Email Body** | The plain text content of the email body |
| **Email To** | The recipient email address |
| **Email Received** | Time-based criteria for when emails are received |

## Available Filter Types

### String Filters (Subject, From, Body, To)

| Filter | Description | Example |
|--------|-------------|---------|
| **Contains** | Field contains the specified text | Subject contains "CRITICAL" |
| **Not Contains** | Field does not contain the specified text | Subject not contains "TEST" |
| **Equals** | Field exactly matches the specified text | From equals "alerts@service.com" |
| **Not Equals** | Field does not match the specified text | Subject not equals "OK" |
| **Starts With** | Field starts with the specified text | Subject starts with "[ALERT]" |
| **Ends With** | Field ends with the specified text | Subject ends with "- Production" |
| **Is Empty** | Field is empty or blank | Body is empty |
| **Is Not Empty** | Field has content | Subject is not empty |

### Time-Based Filters (Email Received)

| Filter | Description | Example |
|--------|-------------|---------|
| **Received In Minutes** | Email was received within X minutes | Email received in 30 minutes |
| **Not Received In Minutes** | No email received in X minutes | Email not received in 60 minutes |

## Example Configurations

### Example 1: Create Alert on Critical Emails

**Alert Creation Criteria:**
- Email Subject **Contains** "CRITICAL"
- OR Email Subject **Contains** "ALERT"
- OR Email Subject **Contains** "ERROR"

**Alert Resolution Criteria:**
- Email Subject **Contains** "RESOLVED"
- OR Email Subject **Contains** "OK"
- OR Email Subject **Contains** "RECOVERED"

### Example 2: Monitor Specific Sender

**Alert Creation Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Failed"

**Alert Resolution Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Success"

### Example 3: Heartbeat Monitor (No Email = Alert)

**Alert Creation Criteria:**
- Email Received **Not Received In Minutes** with value `60`

This creates an alert if no email is received for 60 minutes - useful for monitoring scheduled jobs or batch processes that should send completion emails.

**Alert Resolution Criteria:**
- Email Received **Received In Minutes** with value `5`

This resolves the alert when an email is received.

## Use Cases

### Legacy System Integration

Many older systems only support email-based alerting. Use Incoming Email Monitor to:
- Convert email alerts into OneUptime incidents
- Automatically resolve incidents when recovery emails arrive
- Centralize alerting from multiple legacy systems

### Third-Party Service Monitoring

Integrate with services that send email notifications:
- Cloud provider alerts (AWS, GCP, Azure)
- Security scanning tools
- Backup completion notifications
- SSL certificate expiration warnings

### Scheduled Job Monitoring

Monitor batch jobs and scheduled tasks:
- Create alerts if completion emails aren't received on time
- Track job failures through error notification emails
- Monitor data pipeline completions

### Multi-Vendor Alert Aggregation

Consolidate alerts from multiple monitoring tools:
- Receive alerts from Nagios, Zabbix, or other tools via email
- Unify incident management in OneUptime
- Maintain a single source of truth for all alerts

## Template Variables

When configuring incident templates, you can use these variables from incoming emails:

| Variable | Description |
|----------|-------------|
| `{{emailSubject}}` | The subject of the received email |
| `{{emailFrom}}` | The sender's email address |
| `{{emailTo}}` | The recipient email address |
| `{{emailBody}}` | The plain text body of the email |
| `{{emailReceivedAt}}` | When the email was received |

## Monitor Summary View

The monitor summary shows:
- **Last Email Received At:** When the most recent email was received
- **From:** The sender of the last email
- **Subject:** The subject line of the last email
- **Email Headers:** Full headers of the last email (expandable)
- **Email Body:** Content of the last email (expandable)

## Self-Hosted Setup

If you're self-hosting OneUptime, you need to configure an inbound email provider. Currently supported:

- **SendGrid Inbound Parse** - See [SendGrid Inbound Email Integration](/docs/self-hosted/sendgrid-inbound-email) for setup instructions

## Things to Consider

- **Email Address Security:** The monitor email address contains a secret key. Treat it like a password and don't share it publicly.
- **Email Size:** Very large emails (with large attachments) may be truncated or rejected by the email provider.
- **Processing Time:** Emails are processed asynchronously. There may be a few seconds delay between sending an email and alert creation.
- **Case Insensitivity:** All string comparisons (Contains, Equals, etc.) are case-insensitive.
- **Plain Text:** Email body criteria use the plain text version of the email. HTML formatting is stripped.

## Troubleshooting

### Emails Not Being Received

1. Verify the email address is correct (check for typos)
2. Check if the email is being blocked by spam filters
3. Verify your inbound email provider is configured correctly
4. Check the OneUptime logs for any error messages

### Alerts Not Being Created

1. Verify your criteria match the email content
2. Check the monitor is not disabled
3. Review the evaluation logs in the monitor details
4. Test with exact string matches before using pattern matching

### Alerts Not Being Resolved

1. Verify your resolution criteria match the recovery email
2. Ensure there's an active alert to resolve
3. Check that the resolution email is sent to the same monitor address
