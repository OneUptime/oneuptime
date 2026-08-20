# Website Monitor

Website monitoring allows you to monitor the availability, performance, and response of any website or web page. OneUptime periodically sends HTTP requests to your website URL and checks whether it responds correctly.

## Overview

Website monitors check your web pages by making HTTP requests and evaluating the responses. This enables you to:

- Monitor website uptime and availability
- Track response times and performance
- Verify HTTP status codes
- Check response headers
- Detect downtime before your users do

## Creating a Website Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Website** as the monitor type
4. Enter the website URL you want to monitor
5. Configure monitoring criteria as needed

## Configuration Options

### Website URL

Enter the full URL of the website you want to monitor, including the protocol (e.g., `https://example.com`).

### Dynamic URL Placeholders

When monitoring URLs behind CDNs or caching proxies, the monitor may receive a cached response instead of hitting the origin server. To bust the cache on each check, you can use dynamic URL placeholders that get replaced with a unique value on every monitoring request.

#### Supported Placeholders

| Placeholder     | Description                                        | Example Value                      |
| --------------- | -------------------------------------------------- | ---------------------------------- |
| `{{timestamp}}` | Replaced with the current Unix timestamp (seconds) | `1719500000`                       |
| `{{random}}`    | Replaced with a random unique string               | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Example

Configure your monitor URL with a placeholder:

```
https://example.com/health?cb={{timestamp}}
```

On each monitoring check, the URL becomes:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

You can also use `{{random}}` for a unique string on every request:

```
https://example.com/health?nocache={{random}}
```

### Advanced Options

#### Do Not Follow Redirects

By default, OneUptime follows HTTP redirects (301, 302, etc.). Enable this option if you want to monitor the redirect response itself rather than the final destination.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Monitoring Criteria

You can configure criteria to determine when your website is considered online, degraded, or offline based on:

- **Response Status Code** - Check if the HTTP status code matches expected values (e.g., 200, 301)
- **Response Time** - Monitor if response time exceeds a threshold
- **Response Body** - Check if the response body contains or matches specific content
- **Response Headers** - Verify specific response headers are present or match expected values

### Evaluating over a period of time

**Evaluate this criteria over a period of time** is a separate checkbox on the criteria form rather than a filter condition. Turn it on to compare a window of past checks — the aggregate chosen under **Evaluate** (Average, Sum, Maximum Value, Minimum Value, All Values, Any Value) over the window set by **For the last (in minutes)** — instead of the value from the latest check.

**All Values** only matches once the window is genuinely covered by data. A monitor that has just been created, or one whose checks stopped being recorded, does not have enough history to say anything about the last N minutes, so the criteria waits rather than matching on the one reading it does have. **Any Value** is the setting for "tell me the moment a single check breaches" and still fires immediately.

**If No Data** controls what happens while the window cannot back the criteria:

- **Ignore** (default) — the criteria does not match. Use this for ordinary threshold alerting.
- **Trigger** — treat the missing data as the problem. Use this for heartbeat-style checks where silence is itself a failure.
- **Treat As Zero** — compare the window as a single zero. Use this for counters where "no events" genuinely means zero.
