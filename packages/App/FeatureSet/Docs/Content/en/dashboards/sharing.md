# Sharing & Public Dashboards

By default, a dashboard is private to your project: only people who sign in to your project can see it. You can also share it through a public link, protect that link with a password, limit it to certain IP addresses, and host it on your own domain. This page covers all four.

## Who can view a dashboard

Open the dashboard and pick **⋯ → Share**, or open **Sharing** in the dashboard's side menu. The **Who can view this dashboard** card is one choice:

- **Only people in this project** (the default): members see the dashboard when they sign in to OneUptime. It has no public link.
- **Anyone with the link**: the dashboard is public. Anyone who has its link can see it, without signing in.
- **Anyone with the link and a password**: visitors open the link, then enter one password that you share with them. Nobody needs an account.

Picking a choice asks you to confirm, saying what changes for visitors, then applies at once. Picking **Anyone with the link and a password** asks for the password in the same dialog when the dashboard has none; while it is the choice, **Change Password** replaces it. While the dashboard is public, its **Public link** sits under the choice, with a button that copies it.

Within the project, owners and labels control who sees what — see [Configuration & Permissions](/docs/dashboards/configuration). Someone who can see the dashboard but not edit it sees the choice, and can copy the public link, but can't change it.

On OneUptime Cloud, sharing a dashboard, or making it private again, needs the **Growth** plan: on a lower plan those choices show the plan they need. Moving between **Anyone with the link** and **Anyone with the link and a password**, and changing the password, works on every plan.

The choice is stored in three columns, which the API and Terraform read and write as before: `isPublicDashboard`, `enableMasterPassword` and `masterPassword`. Only a public dashboard has a public link, and its visitors are asked for the password whenever `enableMasterPassword` is on. A public dashboard with `enableMasterPassword` on but no password set lets nobody in through its public link: the **Sharing** page shows it as **Anyone with the link and a password**, says that nobody can open the link yet, and offers **Set Password**. Picking **Only people in this project** also turns `enableMasterPassword` off, and keeps the password, so sharing with a password again can reuse it.

## Public dashboards

A public dashboard:

- Always opens in **View** mode. Public visitors can't edit or see the widget palette.
- Includes the variables you've added. Visitors pick from the same dropdowns your team uses.
- Uses the **branding** you set on the dashboard's **Branding** page — page title, description, logo, favicon.

Treat sharing a dashboard like publishing a webpage. Every widget on it becomes readable by anyone with the link. Look at what's on the canvas before you share it.

Each widget publishes only what it draws, and only for the resources it was pointed at. An SLO widget, for instance, publishes that SLO's headline numbers but never its definition — see [SLO](/docs/dashboards/widgets#slo). External **Data Source** widgets are the exception: they are dropped from a public dashboard entirely rather than rendered, because their configuration is the query itself.

## Sharing with a password

Pick **Anyone with the link and a password** and enter the password in the dialog. Visitors see a password prompt before the dashboard appears. The password is stored as a hash — nobody can read it back. A new password works at once; people who entered the old one can keep viewing the dashboard for up to 7 days.

Use a password when:

- You want to share with a partner or customer but don't want the URL to be useful if it leaks.
- The dashboard is "semi-public" — open enough that you don't want to invite every viewer as a team member, but not open enough to put on the open internet.

For stronger gating (separate accounts per viewer, an audit trail of who viewed what), keep the dashboard to **Only people in this project** and invite viewers as read-only team members instead.

## IP allowlist

Under **Advanced** on the **Sharing** page, the **IP Allowlist** card (the `ipWhitelist` column) limits the public link to the IP addresses or IPv4 ranges you list, one per line, for example `203.0.113.7` or `10.0.0.0/8`. It applies with or without the password; project members who sign in are not affected. Leave it empty to allow every address. It saves on its own, apart from the choice, and changing it needs the **Scale** plan on OneUptime Cloud. While a list is in force, the folded **Advanced** section says **Configured**.

Use this when:

- The dashboard should only be reachable from your office or VPN.
- A vendor portal should only be reachable from their known IPs.
- You want extra protection on top of a password.

Requests from any other IP are rejected. A line that is not an IP address or an IPv4 range is refused when you save, because the server would skip it.

## Custom domains

Out of the box, a public dashboard is served on `oneuptime.com`. To host it on your own subdomain like `dashboard.acme.com`:

1. Open **Custom Domains** in the dashboard's side menu and add the domain. Its parent domain must already be verified under **Project Settings → Domains**.
2. Add a CNAME record at your DNS provider pointing the domain to OneUptime's target. The **Add CNAME** action on the domain's row shows exactly what to enter.
3. That's all. OneUptime checks for the record every 15 minutes and verifies the domain once it is live. It then orders a free Let's Encrypt certificate, usually within 15 minutes, serves it within 15 minutes of the order, and renews it automatically well before it expires.
4. Once verified, the dashboard is reachable on both your custom domain and the original URL.

The row's **Status** column shows how far along a domain is. You never have to wait for the 15-minute checks: **Verify CNAME** in the **Add CNAME** dialog checks the record right away, and **Order Free SSL** orders the certificate right away. **Reissue SSL** asks Let's Encrypt for a brand new certificate when you want one before the automatic renewal; each domain can be reissued once every 24 hours.

To use your own certificate instead, switch on **Upload Custom Certificate** when you add the domain and paste the certificate and its private key. OneUptime serves it within 15 minutes instead of ordering a Let's Encrypt certificate, and it takes the place of any Let's Encrypt certificate the domain had before. Renewing an uploaded certificate is up to you: edit the domain and paste the new one. If the domain had a free certificate before, OneUptime keeps renewing it while yours is in use, so switching back is instant.

On a self-hosted installation, dashboard custom domains are switched on by the `DASHBOARD_CNAME_RECORD` environment variable (`dashboard.cnameRecord` in the Helm chart), which is the target your CNAME records point to. Without it, OneUptime does not verify domains or order certificates for dashboards.

Custom domains are useful for:

- Customer-facing dashboards on your own brand.
- Co-branded partner dashboards.
- Public health pages with their own URL.

You can attach more than one custom domain to a single dashboard if you serve the same content to multiple audiences.

## Branding

On the dashboard's **Branding** page, you can configure:

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

If the dashboard is shared with a password, visitors will see the password prompt inside the iframe.

## Shareable URLs

The dashboard URL includes the current variable selections and time range as query parameters. Adjust the dropdowns, copy the URL, paste it in chat — the person opening the link sees the dashboard with the exact same view.

This is the fastest way to point a teammate at "the dashboard at the time the incident started." Pin the time range, copy, paste.

## Where to read next

- [Configuration & Permissions](/docs/dashboards/configuration) — private-mode access control.
- [Variables & Filters](/docs/dashboards/variables) — variables that visitors can interact with.
- [Authoring a Dashboard](/docs/dashboards/authoring) — what goes on the canvas.
