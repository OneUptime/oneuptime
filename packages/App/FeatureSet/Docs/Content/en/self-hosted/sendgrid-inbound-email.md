# SendGrid Inbound Email Integration

OneUptime's **Incoming Email Monitor** allows you to create and resolve alerts based on emails sent to unique monitor-specific email addresses. This is useful for integrating with legacy systems, alerting tools, or any service that can send emails.

This guide explains how to set up SendGrid Inbound Parse to forward incoming emails to your self-hosted OneUptime instance.

## Prerequisites

- A SendGrid account with Inbound Parse access
- A domain you control with access to DNS settings
- A public HTTPS endpoint that forwards SendGrid webhooks to your OneUptime instance

## Network Access

Inbound Parse requires SendGrid to initiate a connection to OneUptime. Allowing only outbound internet access from OneUptime is insufficient.

| Direction | Destination | Protocol / port | Purpose |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Deliver parsed email as a multipart POST. |
| Sending mail servers → SendGrid | `mx.sendgrid.net`, selected by your inbound domain's public MX record | SMTP / TCP 25 | Receive email at SendGrid; this connection does not go to your OneUptime server. |
| OneUptime → SendGrid, only when separately configured to send email using the SendGrid provider | `api.sendgrid.com` | HTTPS / TCP 443 | Send notification emails through the Mail Send API. |

Publish DNS for the webhook hostname and serve a certificate trusted by public clients. A private OneUptime deployment can expose just the webhook path through a public reverse proxy or gateway that can reach OneUptime internally. Preserve the path, secret, content type and multipart request body, and allow the POST through without an interactive login or browser challenge. The OneUptime server does not need an inbound SMTP listener. See [SendGrid's Inbound Parse setup](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook).

Set `INBOUND_EMAIL_WEBHOOK_SECRET` to a strong random value and replace `YOUR_SECRET` in the URL with that value. The route requires the final path segment. OneUptime checks its value when the secret is configured; leaving the variable empty disables that check. Keep the full URL and monitor email addresses private, including in proxy logs. OneUptime does not currently validate SendGrid's signed Inbound Parse headers or OAuth tokens. If you require those mechanisms, configure a gateway that validates them before forwarding to OneUptime, following [SendGrid's webhook security documentation](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

SendGrid does not provide a reliable static source IP list for Inbound Parse. Its outbound email sending IPs and the addresses resolved for `mx.sendgrid.net` are not a webhook allowlist. Follow [SendGrid's firewall guidance](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs) instead of pinning a current DNS result.

Inbound Parse is separate from outbound email delivery. Receiving monitor emails does not require OneUptime to call the SendGrid API. If you also select SendGrid for sending notifications, permit DNS resolution and outbound HTTPS to `api.sendgrid.com`; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) needs no inbound callback for submission. If you use SMTP instead, allow the SMTP server and port configured in OneUptime.

To verify delivery, check the public MX record, send an email to a test monitor, and confirm the webhook reaches OneUptime and the matching alert is created or resolved. An empty POST or a successful test of outbound email does not verify the Inbound Parse flow.

## How It Works

1. You create an **Incoming Email Monitor** in OneUptime
2. OneUptime generates a unique email address for that monitor (e.g., `monitor-abc123@inbound.yourdomain.com`)
3. When an email is sent to that address, SendGrid receives it and forwards it to OneUptime via webhook
4. OneUptime evaluates the email against your configured criteria to create or resolve alerts

## Setup Instructions

### Step 1: Choose Your Inbound Email Domain

You'll need a subdomain dedicated to receiving inbound emails. We recommend using a subdomain like:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

This subdomain will be used exclusively for OneUptime monitor emails.

### Step 2: Configure DNS MX Record

Add an MX record to your DNS configuration to route emails for your inbound subdomain to SendGrid.

| Type | Host/Name | Priority | Value           |
| ---- | --------- | -------- | --------------- |
| MX   | inbound   | 10       | mx.sendgrid.net |

**Example:** If your domain is `example.com` and you're using `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Note:** DNS changes can take up to 48 hours to propagate, but typically complete within a few hours.

### Step 3: Authenticate Your Domain in SendGrid

The receiving domain must belong to one of your [authenticated domains in SendGrid](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse):

1. Log into your [SendGrid Dashboard](https://app.sendgrid.com)
2. Go to **Settings** > **Sender Authentication**
3. Click **Authenticate Your Domain**
4. Follow the prompts to add the required DNS records (CNAME records for DKIM)

### Step 4: Configure SendGrid Inbound Parse

1. Log into your [SendGrid Dashboard](https://app.sendgrid.com)
2. Navigate to **Settings** > **Inbound Parse**
3. Click **Add Host & URL**
4. Configure the following:

| Field                               | Value                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**                | Your inbound subdomain (e.g., `inbound.yourdomain.com`)                 |
| **Destination URL**                 | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam**  | Optional - enable if desired                                            |
| **Send raw, full MIME message**     | Leave unchecked (not required)                                          |
| **POST the raw, full MIME message** | Leave unchecked (not required)                                          |

5. Click **Add**

### Step 5: Configure OneUptime Environment Variables

#### Docker Compose

Add these environment variables to your `config.env` file:

```bash
# Inbound Email Configuration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes with Helm

Add these to your `values.yaml` file:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

Use the same secret in the Destination URL from Step 4. Restart your OneUptime server after adding these environment variables.

### Step 6: Create an Incoming Email Monitor

1. Log into your OneUptime Dashboard
2. Navigate to **Monitors** > **Create Monitor**
3. Select **Incoming Email** as the monitor type
4. Configure your monitor:
   - **Name:** Give your monitor a descriptive name
   - **Description:** Describe what this monitor is for
5. Configure **Alert Creation Criteria** (when to create an alert):
   - Example: Email Subject contains "ALERT" or "CRITICAL"
6. Configure **Alert Resolution Criteria** (when to resolve an alert):
   - Example: Email Subject contains "RESOLVED" or "OK"
7. Click **Create**

After creation, you'll see the unique email address for this monitor (e.g., `monitor-abc123def456@inbound.yourdomain.com`).

### Step 7: Test the Integration

1. Copy the monitor's email address from the OneUptime Dashboard
2. Send a test email to that address with a subject that matches your alert criteria
3. Check the OneUptime Dashboard to verify:
   - The email was received (visible in Monitor Summary)
   - An alert was created (if criteria matched)

## Environment Variables Reference

| Variable                       | Description                                                                                                                     | Required | Default |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `INBOUND_EMAIL_PROVIDER`       | The inbound email provider to use                                                                                               | Yes      | -       |
| `INBOUND_EMAIL_DOMAIN`         | The subdomain configured for inbound emails                                                                                     | Yes      | -       |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Secret compared with the final webhook URL segment: `/incoming-email/sendgrid/YOUR_SECRET`. Configure it for public endpoints; an empty value disables validation. | Recommended | -       |

## Supported Email Criteria

When configuring your Incoming Email Monitor, you can create criteria based on:

| Field              | Description                        | Available Filters                                                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **Email Subject**  | The subject line of the email      | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email From**     | The sender's email address         | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Body**     | The plain text body of the email   | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email To**       | The recipient email address        | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Received** | Time since last email was received | Received In Minutes, Not Received In Minutes                                               |

## Example Use Cases

### Legacy System Alerts

Many legacy systems can only send email alerts. Create an Incoming Email Monitor to:

- Create OneUptime alerts when the legacy system sends `[CRITICAL]` emails
- Resolve alerts when `[RESOLVED]` emails are received

### Third-Party Service Integration

Integrate with services that send email notifications:

- Monitoring tools that don't have API integrations
- Cloud provider notifications
- Security scanning tools

### Heartbeat via Email

Use "Email Received" criteria to ensure you receive periodic emails:

- Create alert if no email received in 60 minutes
- Useful for monitoring batch jobs or scheduled tasks that send completion emails

## Troubleshooting

### Emails Not Being Received

1. **Check DNS propagation:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Should return `mx.sendgrid.net`

2. **Verify SendGrid Inbound Parse settings:**

   - Log into SendGrid Dashboard
   - Go to Settings > Inbound Parse
   - Verify your domain and webhook URL are correct

3. **Check OneUptime logs:**
   - Look for incoming email webhook requests in the OneUptime application logs (Telemetry / ProbeIngest)
   - Check for any error messages

### Webhooks Failing

1. **Check the public webhook route:**

   - The full URL, including its secret, must reach OneUptime from the internet
   - Follow the test in the Network Access section; the URL without its final secret segment does not match the route

2. **Check firewall rules:**

   - Allow HTTPS POST requests to the webhook path without login redirects or browser challenges
   - Do not use SendGrid's email sending IPs as a webhook source allowlist

3. **Verify SSL certificate:**
   - Use a valid, publicly trusted certificate for the webhook hostname and include its certificate chain

### Monitor Not Creating Alerts

1. **Verify criteria configuration:**

   - Check that your alert creation criteria match the email content
   - Test with exact strings first before using pattern matching

2. **Check monitor status:**

   - Ensure the monitor is not disabled
   - Verify the monitor type is "Incoming Email"

3. **Review the Monitor Summary:**
   - Check if the email was received and processed
   - Review the evaluation logs for criteria matching details

### SendGrid Webhook Delivery Logs

To check if SendGrid is successfully sending webhooks:

1. Unfortunately, SendGrid doesn't provide detailed logs for Inbound Parse
2. Check your OneUptime server logs for incoming webhook requests
3. Use a tool like [RequestBin](https://requestbin.com) to test webhook delivery temporarily

## Security Best Practices

1. **Use HTTPS:** Always use HTTPS for your webhook endpoint
2. **Webhook Secret:** Configure `INBOUND_EMAIL_WEBHOOK_SECRET` and include it in your webhook URL (e.g., `/incoming-email/sendgrid/your-secret`) for additional validation
3. **Domain Verification:** Verify your domain in SendGrid for better email security
4. **Restrict Access:** Only create monitors for trusted email sources
5. **Monitor Logs:** Regularly review incoming email logs for suspicious activity

## Alternative Providers

OneUptime is designed to support multiple inbound email providers. Currently supported:

| Provider             | Status    |
| -------------------- | --------- |
| SendGrid             | Supported |
| Haraka (Self-hosted) | Planned   |

If you need support for a different provider, please contact us or submit a feature request.

## Support

If you encounter issues with the SendGrid Inbound Email integration:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)

We welcome feedback to improve this integration!
