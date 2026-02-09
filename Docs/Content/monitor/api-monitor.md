# API Monitor

API monitoring allows you to monitor the availability, performance, and correctness of your HTTP/REST APIs. OneUptime periodically sends HTTP requests to your API endpoints and evaluates the responses based on your configured criteria.

## Overview

API monitors make HTTP requests to your endpoints and check the responses. This enables you to:

- Monitor API uptime and availability
- Track response times and performance
- Verify HTTP status codes and response bodies
- Validate response headers
- Test different HTTP methods (GET, POST, PUT, DELETE, etc.)
- Send custom request headers and bodies

## Creating an API Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **API** as the monitor type
4. Enter the API URL and configure the request settings
5. Configure monitoring criteria as needed

## Configuration Options

### API URL

Enter the full URL of the API endpoint you want to monitor (e.g., `https://api.example.com/v1/health`).

### Dynamic URL Placeholders

When monitoring APIs behind CDNs or caching proxies, the monitor may receive a cached response instead of hitting the origin server. To bust the cache on each check, you can use dynamic URL placeholders that get replaced with a unique value on every monitoring request.

#### Supported Placeholders

| Placeholder | Description | Example Value |
|-------------|-------------|---------------|
| `{{timestamp}}` | Replaced with the current Unix timestamp (seconds) | `1719500000` |
| `{{random}}` | Replaced with a random unique string | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Example

Configure your monitor URL with a placeholder:

```
https://api.example.com/health?cb={{timestamp}}
```

On each monitoring check, the URL becomes:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

You can also use `{{random}}` for a unique string on every request:

```
https://api.example.com/health?nocache={{random}}
```

### API Request Type

Select the HTTP method for the request:

- **GET** (default)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Advanced Options

#### Request Headers

Add custom HTTP headers to the request. This is useful for authentication tokens, content type specifications, and other API-specific headers.

You can use [Monitor Secrets](/docs/monitor/monitor-secrets) in header values to securely store sensitive data like API keys.

#### Request Body (JSON)

For POST, PUT, and PATCH requests, you can specify a JSON request body. You can use [Monitor Secrets](/docs/monitor/monitor-secrets) in the request body as well.

#### Do Not Follow Redirects

By default, OneUptime follows HTTP redirects (301, 302, etc.). Enable this option if you want to monitor the redirect response itself rather than the final destination.

## Monitoring Criteria

You can configure criteria to determine when your API is considered online, degraded, or offline based on:

- **Response Status Code** - Check if the HTTP status code matches expected values (e.g., 200, 201)
- **Response Time** - Monitor if response time exceeds a threshold
- **Response Body** - Check if the response body contains or matches specific content
- **Response Headers** - Verify specific response headers are present or match expected values
- **JavaScript Expression** - Write custom expressions to evaluate the response. See [JavaScript Expressions](/docs/monitor/javascript-expression) for details.
