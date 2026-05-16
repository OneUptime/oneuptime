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

| Placeholder | Description | Example Value |
|-------------|-------------|---------------|
| `{{timestamp}}` | Replaced with the current Unix timestamp (seconds) | `1719500000` |
| `{{random}}` | Replaced with a random unique string | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

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

## Monitoring Criteria

You can configure criteria to determine when your website is considered online, degraded, or offline based on:

- **Response Status Code** - Check if the HTTP status code matches expected values (e.g., 200, 301)
- **Response Time** - Monitor if response time exceeds a threshold
- **Response Body** - Check if the response body contains or matches specific content
- **Response Headers** - Verify specific response headers are present or match expected values
