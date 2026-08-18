# Domain Monitor

Domain monitoring allows you to monitor the registration status and expiration of your domain names. OneUptime periodically looks up your domain's registration record to track its health and alert you before it expires.

## Overview

Domain monitors read the registration record for your domains. This enables you to:

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
5. Choose a lookup method (leave it on **Auto** unless you have a reason not to)
6. Configure monitoring criteria as needed

## Lookup Methods

Registration data can be read over two protocols, and which one works depends on the TLD.

| Method    | Behaviour                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------- |
| **Auto**  | Default. Uses RDAP when the TLD publishes an RDAP service, and falls back to WHOIS when it does not. |
| **RDAP**  | RDAP only. Fails with a clear error if the TLD publishes no RDAP service.                            |
| **WHOIS** | WHOIS only.                                                                                          |

**RDAP** ([RFC 9083](https://www.rfc-editor.org/rfc/rfc9083)) is the ICANN-mandated replacement for WHOIS. The authoritative server for each TLD is discovered from [IANA's bootstrap registry](https://www.rfc-editor.org/rfc/rfc9224), so it stays correct as registries move. Every gTLD publishes one.

**WHOIS** has no equivalent discovery mechanism — clients ship a static map of TLD to WHOIS host, and those maps go stale. Every Identity Digital TLD (`.digital`, `.email`, `.life`, `.today`, `.zone` and around 290 others) is still mapped to a retired host that now answers every query with the literal text `TLD is not supported.` instead of a record. WHOIS remains the only option for the many ccTLDs that publish no RDAP service at all, such as `.io`, `.co`, `.de`, `.ch` and `.jp`.

If a lookup cannot produce registration data — because the TLD's service is retired, or the domain is not registered — the monitor is reported **offline** with the reason shown on the monitor's probe response, rather than being reported as healthy with a blank expiry date. A registry that answers "this domain is available" (for example DENIC's `Status: free`) is treated as **not registered**, not as a healthy record.

Internationalized domain names are accepted in either form: `münchen.de` is converted to its A-label (`xn--mnchen-3ya.de`) before the lookup.

## Configuration Options

### Basic Settings

| Field         | Description                                         | Required |
| ------------- | --------------------------------------------------- | -------- |
| Domain Name   | The domain to monitor (e.g., `example.com`)         | Yes      |
| Lookup Method | `Auto`, `RDAP`, or `WHOIS` — see **Lookup Methods** | Yes      |

### Advanced Settings

| Field        | Description                                  | Default |
| ------------ | -------------------------------------------- | ------- |
| Timeout (ms) | How long to wait for the registration lookup | 10000   |
| Retries      | Number of retry attempts on failure          | 3       |

Failures that cannot change on a retry — the domain is not registered, or the TLD publishes no RDAP service when you have asked for RDAP only — are reported immediately rather than retried. Everything else, including a WHOIS server that answers with no record (a rate-limited registrar looks the same as a retired one), is retried first.

The timeout applies to each lookup, so an **Auto** check that tries RDAP and then falls back to WHOIS can take up to twice this long in the worst case.

## Monitoring Criteria

You can configure criteria to determine when your domain is considered online, degraded, or offline based on:

### Available Filter Types

| Filter Type            | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| Is Online              | Whether the registration lookup itself succeeded     |
| Is Request Timeout     | Whether the registration lookup timed out            |
| Domain Expires In Days | Number of days until the domain registration expires |
| Domain Registrar       | The domain registrar name                            |
| Domain Name Server     | Nameserver hostnames for the domain                  |
| Domain Status Code     | Domain status codes (EPP status names)               |
| Domain Is Expired      | Whether the domain has expired                       |

Status codes are normalized to their EPP names (`clientTransferProhibited`) regardless of which protocol answered, so a criterion keeps matching when **Auto** switches between RDAP and WHOIS. Registrar _names_ are whatever the answering service publishes and can differ slightly between the two protocols, so prefer **Contains** over **Equal To** for a **Domain Registrar** criterion.

Dates are normalized to ISO 8601. A date a registry publishes in a form that cannot be parsed is omitted rather than stored, so an expiry criterion reports "cannot decide" instead of silently answering "not expired" forever.

### Filter Conditions

For **Is Online**, **Is Request Timeout** and **Domain Is Expired**:

- **True** / **False**

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

- **Filter Type**: Domain Expires In Days
- **Filter Condition**: Less Than
- **Value**: 30

#### Mark as offline if domain is expired

- **Filter Type**: Domain Is Expired
- **Filter Condition**: True

#### Mark as offline if the registration cannot be read

- **Filter Type**: Is Online
- **Filter Condition**: False

#### Verify nameservers are correct

- **Filter Type**: Domain Name Server
- **Filter Condition**: Contains
- **Value**: `ns1.example.com`

## Best Practices

1. **Set early warnings** — Configure degraded alerts at 60 days and offline alerts at 14 days before expiry
2. **Cover failed lookups** — Include an **Is Online / False** filter in your offline criteria so an unreadable registration is not mistaken for a healthy one. Monitors created from now on get this by default; monitors created earlier need it added by hand
3. **Monitor all critical domains** — Include primary domains, subdomains registered separately, and any domains used for email or APIs
4. **Track registrar changes** — Monitor the registrar field to detect unauthorized domain transfers

## Network Requirements

Probes need outbound access to:

- `https://data.iana.org/rdap/dns.json` — the IANA RDAP bootstrap registry, fetched once and cached for 24 hours
- The registries' RDAP endpoints over HTTPS (port 443)
- WHOIS servers over TCP port 43

RDAP requests honour the probe's `HTTP_PROXY_URL` / `HTTPS_PROXY_URL` / `NO_PROXY` settings. WHOIS runs over a raw socket and does not. If a probe cannot reach `data.iana.org`, **Auto** degrades to WHOIS and retries the registry periodically.
