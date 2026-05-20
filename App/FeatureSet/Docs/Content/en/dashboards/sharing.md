# Sharing & Public Dashboards

Most dashboards are private to your project — only logged-in members of the project can see them. But OneUptime also lets you publish a dashboard on a public URL, optionally protect it with a password, restrict it by IP, and host it on a custom domain. This page covers all four.

## Private dashboards (the default)

By default, a dashboard is reachable only to logged-in users who are project members. The URL looks like `https://oneuptime.com/dashboards/<id>/view`. Direct access requires authentication and the appropriate read permission on the dashboard.

Within the project, ownership and labels control who sees what — see [Configuration & Permissions](/docs/dashboards/configuration).

## Public dashboards

Under **Dashboard → Settings**, flip **Public Dashboard** on. The dashboard now has a second URL that does not require login. Share it with vendors, partners, customers, or paste it in a public README.

A public dashboard:

- Renders in **View** mode only. Public visitors cannot edit, change time range URLs aside, or see the widget palette.
- Includes the variables you've defined — visitors can pick from drop-downs just like internal users.
- Carries the **branding** you configure under Settings: page title, page description, logo file, favicon. These are what shows up in the browser tab and on social previews.

Treat enabling **Public Dashboard** like publishing a webpage. Every widget on the dashboard is now world-readable. Audit what's on the canvas before flipping the switch.

## Master password

To gate a public dashboard with a password instead of making it fully open:

1. Enable **Public Dashboard**.
2. Enable **Master Password**.
3. Set the password.

Visitors hit a password prompt before the dashboard renders. The password is hashed at rest; only the hash is stored.

Use a master password when:

- You want to share with a partner or customer but don't want the URL to be valid if it leaks.
- The dashboard is "semi-public" — open enough that you don't want OneUptime accounts for every viewer, but not open enough to put on the open internet.

For higher-value gating (per-viewer accounts, audit trail of who saw what), keep the dashboard private and invite viewers to the project as read-only members.

## IP allowlist

On the **Scale** plan, you can restrict a public dashboard to a list of source IPs or CIDR ranges. Configure the list under **Dashboard → Settings → IP Whitelist**.

Use an IP allowlist when:

- The dashboard should only be reachable from your office or VPN.
- A vendor portal should only be reachable from their published egress IPs.
- You want defense-in-depth on top of a master password.

Requests from any other IP receive a 403.

## Custom domains

Out of the box, a public dashboard is served on `oneuptime.com`. To host it on your own subdomain (e.g., `dashboard.acme.com`):

1. Add a CNAME record on your DNS pointing the subdomain to OneUptime's published target.
2. Under **Dashboard → Settings → Custom Domains**, add the domain.
3. Verify the DNS record (OneUptime checks it for you).
4. Once verified, the dashboard is reachable on both the OneUptime URL and your custom domain.

Custom domains are useful for:

- Customer-facing dashboards on your brand.
- Co-branded partner dashboards.
- SEO on a public health page.

You can attach multiple custom domains to one dashboard if you serve the same content to multiple audiences.

## Branding for public dashboards

Under **Dashboard → Settings**, configure:

- **Page title** — the `<title>` tag and the heading visitors see.
- **Page description** — the meta description used by search engines and social previews.
- **Logo file** — upload a PNG/SVG; shown in the dashboard header.
- **Favicon** — uploaded; shown in the browser tab.

Branding only applies to public-mode rendering. Internal viewers always see the OneUptime branding.

## Embedding

You can embed a public dashboard in an `<iframe>` on your own site:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

If you embed a dashboard protected by a master password, the visitor still sees the password prompt inside the iframe.

## Shareable URLs with variable state

The dashboard URL encodes the current variable selections and time range as query parameters. Adjust the drop-downs, copy the URL, and paste it in chat — the recipient sees the dashboard with the exact same view, including the time range you were looking at.

This is the fastest way to point a teammate at "the dashboard at the time the incident started" — pin the time range, copy, paste.

## Where to read next

- [Configuration & Permissions](/docs/dashboards/configuration) — private-mode access control.
- [Variables & Filters](/docs/dashboards/variables) — variables that public visitors can interact with.
- [Authoring a Dashboard](/docs/dashboards/authoring) — what goes on the canvas in the first place.
