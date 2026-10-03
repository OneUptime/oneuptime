# Sharing & Public Dashboards

By default, dashboards are private to your project — only logged-in team members can see them. But OneUptime also lets you share a dashboard publicly, protect it with a password, restrict it to certain IPs, and host it on your own domain. This page covers all four.

## Private dashboards (the default)

A dashboard is reachable only to logged-in members of your project. The URL looks like `https://oneuptime.com/dashboards/<id>/view` and requires a login.

Within the project, owners and labels control who sees what — see [Configuration & Permissions](/docs/dashboards/configuration).

## Public dashboards

Under **Dashboard → Settings**, flip **Public Dashboard** on. The dashboard now has a second URL that doesn't need a login. Share it with vendors, partners, customers, or paste it in a public README.

A public dashboard:

- Always opens in **View** mode. Public visitors can't edit or see the widget palette.
- Includes the variables you've added. Visitors pick from the same dropdowns your team uses.
- Uses the **branding** you set in Settings — page title, description, logo, favicon.

Treat enabling a public dashboard like publishing a webpage. Every widget on it becomes world-readable. Look at what's on the canvas before you flip the switch.

Each widget publishes only what it draws, and only for the resources it was pointed at. An SLO widget, for instance, publishes that SLO's headline numbers but never its definition — see [SLO](/docs/dashboards/widgets#slo). External **Data Source** widgets are the exception: they are dropped from a public dashboard entirely rather than rendered, because their configuration is the query itself.

## Master password

To put a password on a public dashboard:

1. Turn on **Public Dashboard**.
2. Turn on **Master Password**.
3. Set the password.

Visitors see a password prompt before the dashboard appears. The password is stored as a hash — we never see the actual password.

Use a master password when:

- You want to share with a partner or customer but don't want the URL to be useful if it leaks.
- The dashboard is "semi-public" — open enough that you don't want to invite every viewer as a team member, but not open enough to put on the open internet.

For stronger gating (separate accounts per viewer, an audit trail of who viewed what), keep the dashboard private and invite viewers as read-only team members instead.

## IP allowlist

On the **Scale** plan, you can restrict a public dashboard to a list of IP addresses or ranges. Configure it under **Dashboard → Settings → IP Whitelist**.

Use this when:

- The dashboard should only be reachable from your office or VPN.
- A vendor portal should only be reachable from their known IPs.
- You want extra protection on top of a master password.

Requests from any other IP are rejected.

## Custom domains

Out of the box, a public dashboard is served on `oneuptime.com`. To host it on your own subdomain like `dashboard.acme.com`:

1. Open **Custom Domains** in the dashboard's side menu and add the domain. Its parent domain must already be verified under **Project Settings → Domains**.
2. Add a CNAME record at your DNS provider pointing the domain to OneUptime's target. The **Add CNAME** action on the domain's row shows exactly what to enter.
3. That's all. OneUptime checks for the record every 15 minutes and verifies the domain once it is live. It then orders a free Let's Encrypt certificate within 15 minutes, serves it within 15 minutes of the order, and renews it automatically well before it expires.
4. Once verified, the dashboard is reachable on both your custom domain and the original URL.

The row's **Status** column shows how far along a domain is. You never have to wait for the 15-minute checks: **Verify CNAME** in the **Add CNAME** dialog checks the record right away, and **Order Free SSL** orders the certificate right away. **Reissue SSL** asks Let's Encrypt for a brand new certificate when you want one before the automatic renewal; each domain can be reissued once every 24 hours.

To use your own certificate instead, switch on **Upload Custom Certificate** when you add the domain and paste the certificate and its private key. OneUptime serves it within 15 minutes instead of ordering a Let's Encrypt certificate. Renewing an uploaded certificate is up to you: edit the domain and paste the new one.

On a self-hosted installation, dashboard custom domains are switched on by the `DASHBOARD_CNAME_RECORD` environment variable (`dashboard.cnameRecord` in the Helm chart), which is the target your CNAME records point to. Without it, OneUptime does not verify domains or order certificates for dashboards.

Custom domains are useful for:

- Customer-facing dashboards on your own brand.
- Co-branded partner dashboards.
- Public health pages with their own URL.

You can attach more than one custom domain to a single dashboard if you serve the same content to multiple audiences.

## Branding

Under **Dashboard → Settings**, you can configure:

- **Page title** — what shows in the browser tab and at the top of the page.
- **Page description** — the description used by search engines and social previews.
- **Logo** — upload a PNG or SVG to show in the header.
- **Favicon** — the small icon in the browser tab.

Branding applies only when the dashboard is viewed publicly. Internal viewers always see OneUptime's branding.

## Embedding

You can embed a public dashboard in your own site with an iframe:

```html
<iframe
  src="https://dashboard.acme.com/view"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

If the dashboard has a master password, visitors will see the password prompt inside the iframe.

## Shareable URLs

The dashboard URL includes the current variable selections and time range as query parameters. Adjust the dropdowns, copy the URL, paste it in chat — the person opening the link sees the dashboard with the exact same view.

This is the fastest way to point a teammate at "the dashboard at the time the incident started." Pin the time range, copy, paste.

## Where to read next

- [Configuration & Permissions](/docs/dashboards/configuration) — private-mode access control.
- [Variables & Filters](/docs/dashboards/variables) — variables that visitors can interact with.
- [Authoring a Dashboard](/docs/dashboards/authoring) — what goes on the canvas.
