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

1. Add a CNAME record on your DNS pointing the subdomain to OneUptime's target.
2. Under **Dashboard → Settings → Custom Domains**, add the domain.
3. Verify it. OneUptime checks the DNS record for you.
4. Once verified, the dashboard is reachable on both your custom domain and the original URL.

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
