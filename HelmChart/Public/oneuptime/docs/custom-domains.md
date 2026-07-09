# Custom Domains for Status Pages

Serve a status page from your own domain (e.g. `status.yourcompany.com`).

## Enable Let's Encrypt

To provision certificates for custom status page domains, add these values:

| Parameter                | Description                                                        | Default | Change |
|--------------------------|--------------------------------------------------------------------|---------|:------:|
| `letsEncrypt.accountKey` | A private key generated via `openssl`, then base64-encoded.        | `` | 🚨 |
| `letsEncrypt.email`      | Email address registered with Let's Encrypt for notifications.     | `` | 🚨 |

> OneUptime must be hosted on a server that is publicly accessible for
> certificate provisioning and custom domains to work.

## Add a custom domain

### Step 1 — Add a CNAME record

Point your subdomain at your OneUptime host in your DNS provider:

```
DNS Record Type: CNAME
Host: status.yourcompany.com
Value: <your-oneuptime-host>
```

### Step 2 — Add the domain to your project

In the OneUptime dashboard, click **More** in the nav bar, then **Project
Settings**, then **Custom Domain**. Add your custom domain and verify it — the
verification code is shown on that page.

### Step 3 — Add the domain to your status page

Open **Status Pages**, click **View Status Page**, go to the status page
settings, then **Custom Domain**, and add your domain there.

Once added, your status page is reachable at your custom domain.
