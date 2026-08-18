# Branding & Custom Domains

A status page is the one OneUptime surface your customers actually look at, so it should look like it belongs to you and live on your own domain. Both of those are configured from the **Branding** section of a status page's side menu, plus one setting that hides in **Advanced Settings**.

The thing to know before you start: branding is split across seven separate screens, and the split is not always where you would guess. The logo and cover image are not on **Essential Branding** — they are on **Header**. The favicon is on **Essential Branding**. Colors are on **Overview Page**. Everything else you might think of as "theming" is Custom CSS.

This page walks each screen in turn, then takes you through the full CNAME-then-SSL sequence for putting the page on `status.yourcompany.com`.

## Where each branding control lives

Open a status page, and the side menu's **Branding** section has seven items. Here is the map, so you stop hunting.

| Page                       | What you set there                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Essential Branding**     | Page title, page description, search engine indexing, favicon.                             |
| **Header**                 | Logo, cover image, their alt text, and the header link bar.                                |
| **Footer**                 | Copyright line and the footer link bar.                                                    |
| **Overview Page**          | Overview description, history chart bar colors, downtime statuses, overall uptime percent. |
| **HTML, CSS & JavaScript** | Header HTML, footer HTML, custom CSS, custom JavaScript.                                   |
| **Custom Domains**         | Your own domain, CNAME verification, and SSL.                                              |
| **Languages**              | Default language and the languages offered in the footer switcher.                         |

## Essential branding

**Status Pages → your page → Branding → Essential Branding** (`{id}/branding`) holds three cards.

- **Title and Description** — the card notes this is also used for SEO. **Edit** opens **Page Title** (placeholder `Please enter page title here.`) and **Page Description**. This is what search engines and link previews show, so write it for a customer, not for your team.
- **Search Engine Indexing** — a single toggle, **Allow Search Engines to Index this Status Page**, described in the product as controlling whether Google and Bing may list the page in their results. It is on by default. Switch it off and the page is served with `noindex, nofollow` instead.
- **Favicon** — **Edit Favicon** opens the **Favicon** image upload. This is the little icon in the browser tab.

Use it when: the page is internal-only or still being set up. Turn **Allow Search Engines to Index this Status Page** off so a half-finished page does not start ranking for your brand name.

## The header screen

**Status Pages → your page → Branding → Header** (`{id}/header-style`). Despite the side-menu name, this is where your two biggest brand assets live.

The first card is titled **Logo, Cover and Favicon**, with an **Edit Images** button:

- **Logo** — image upload, placeholder `Upload logo`.
- **Logo Alt Text** — placeholder `Logo of My Company`. If you leave it blank, the status page title is used instead.
- **Cover** — image upload, placeholder `Upload cover image`. This is the wide banner behind the header.
- **Cover Image Alt Text** — the same idea for the cover.

Below it is a **Header Links** table ("Header Links for your status page"). Each link has a **Title** and a **Link** (a URL, placeholder `https://link.com`), and rows are reordered by dragging. With none configured the table reads "No status header link for this status page."

Good for: pointing visitors back to your marketing site, your docs, or a support portal without making them guess the URL.

## The footer screen

**Status Pages → your page → Branding → Footer** (`{id}/footer-style`) is the same shape as **Header**, one card and one table.

- **Copyright Info** — **Edit Copyright** opens a single field, **Copyright Info**, with the placeholder `Acme, Inc.`.
- **Footer Links** — the same **Title** plus **Link** pair, drag-ordered, empty message "No status footer link for this status page."

Legal, privacy and terms links belong here. Header links are for navigation; footer links are for the fine print.

## Overview page branding

**Status Pages → your page → Branding → Overview Page** (`{id}/overview-page-branding`) is the one screen where colors are configurable, and it also decides what "down" means on the chart.

- **Overview Page** — **Edit Branding** opens a markdown field, **Overview Page Description.**, that renders above the resource list. Use it for a sentence of context: what this page covers, and where to go for support.
- **Rules for Bar Colors of History Chart** — an ordered, drag-sortable table of rules. Each rule has **When uptime % is greater than or equal to** and **Then, use this bar color**; the table columns read `When Uptime Percent >=` and `Then, Bar Color is`. Order matters, so arrange them the way you want them evaluated.
- **Downtime Monitor Statuses** — **Edit Statuses** opens a multi-select described as "These monitor statuses are considered as down". This is how you decide whether, say, a degraded status counts against uptime on this page.
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** opens the **Default Bar Color** picker, the color used when no rule matches.
- **Overall Uptime Percent** — **Edit Settings** opens the **Show Overall Uptime Percent** toggle and a **Select Uptime Precision** dropdown, which defaults to two decimals (`99.99% (Two Decimal)`).

**How many days the chart covers is not set here.** That is **Show Uptime History (in days)** on **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), valid from 1 to 90.

## Custom HTML, CSS and JavaScript

**Status Pages → your page → Branding → HTML, CSS & JavaScript** (`{id}/custom-code`) has four independently editable cards, backed by the `headerHTML`, `footerHTML`, `customCSS` and `customJavaScript` columns on the status page:

- **Header HTML** — placeholder `Insert Custom HTML here.`, injected into the page header.
- **Footer HTML** — the same, for the footer.
- **Custom CSS** — placeholder `Insert Custom CSS here.`
- **Custom JavaScript** — placeholder `Insert Custom JavaScript here.`

**There is no theme picker.** OneUptime status pages have no theme or brand-color setting: the only built-in color controls anywhere are **Default Bar Color** and the history chart bar color rules on the **Overview Page** screen. Fonts, background colors, accent colors and layout tweaks all go through **Custom CSS** here. If you have been looking for a "brand color" field, this is the answer — there isn't one, and this box is the escape hatch.

> Custom JavaScript runs in your visitors' browsers on a page people load precisely when they are worried something is broken. Keep it small, keep it self-hosted where you can, and test it before you rely on it.

## Language settings

**Status Pages → your page → Branding → Languages** (`{id}/languages`) has two cards, and both are about the language switcher visitors get in the page footer.

- **Default Language** — **Edit Default Language** opens a dropdown listing each supported language by native name and English name (`Deutsch (German)`). The card describes it as the language first-time visitors see; visitors can always switch from the footer. It defaults to English.
- **Enabled Languages** — **Edit Enabled Languages** opens a multi-select, placeholder `All languages`. Leave it empty and every supported language is offered. Choose a few and the footer switcher lists only those.

Sixteen languages ship with OneUptime: English, German, French, Spanish, Italian, Portuguese, Dutch, Danish, Norwegian, Swedish, Russian, Japanese, Korean, Chinese (Simplified), Chinese (Traditional) and Hindi.

## Custom domains

By default a status page is reachable at the preview URL shown on its **Overview** screen. To put it on your own hostname, go to **Status Pages → your page → Branding → Custom Domains** (`{id}/domains`).

The card is titled **Custom Domains** and its description spells out the requirement directly: add your installation's status page CNAME record as the CNAME for these domains for this to work. With nothing configured the table reads "No custom domains found." The table has two columns, **Domain** and **Status**, and filters for **Domain**, **CNAME Valid** and **SSL Provisioned**.

### Before you start

Two prerequisites, and skipping either one is the usual reason this does not work:

- **The parent domain must already be verified.** The **Domain** dropdown only lists verified domains from project settings — the field's own help text points you to **More → Project Settings → Custom Domains** to add one first.
- **The installation must have a status page CNAME record configured.** On self-hosted deployments that is the `STATUS_PAGE_CNAME_RECORD` environment variable in Docker Compose, or `statusPage.cnameRecord` in the Helm `values.yaml`. Without it, both the **Add CNAME** and **Order Free SSL** modals show a "Custom Domains not enabled for this OneUptime installation" message instead of instructions.

### Adding the domain

Click **Create Status Page Domain**. The modal (**Create New Status Page Domain**) has two steps:

**Basic**

- **Subdomain** — the label only, placeholder `status (leave blank for root)`. Enter just `status`, not the whole hostname. Leave it blank or enter `@` to use the root/apex domain.
- **Domain** — a dropdown of verified domains, placeholder `Select domain`.

**More**

- **Upload Custom Certificate** — a toggle, off by default. Leave it off and OneUptime orders a free certificate for you. Switch it on and you get **Certificate** and **Certificate Private Key** fields for your own PEM material.

## Verifying the CNAME

While the domain is unverified, the row shows an **Add CNAME** action. It opens a modal titled **Add CNAME** that gives you exactly what to paste into your DNS provider:

- **Record Type** — `CNAME`
- **Name** — the full domain you just created, for example `status.yourcompany.com`
- **Content** — your installation's status page CNAME record

The modal notes that once the record is in place, automatic verification can take up to 24 hours. You do not have to wait for that: the modal's submit button is **Verify CNAME**, which checks the record on demand.

Create the DNS record first, then click **Verify CNAME**. Clicking it before the record exists just fails.

## Ordering an SSL certificate

Once the CNAME is verified — and only if you did not upload your own certificate — an **Order Free SSL** action appears on the row. Its modal, **Order Free SSL Certificate for this Status Page**, explains that OneUptime uses LetsEncrypt, that the process is secure and free, and that provisioning takes a few hours after the order is placed. The submit button is **Order Free SSL**.

**The stated timings disagree between screens**, so do not read too much into any single number: the order modal says three hours, the **Status** column says one hour, and a custom certificate says thirty minutes. Treat them all as "come back later today," and contact support if nothing has happened by then.

Once provisioned, renewal is automatic. There is nothing recurring for you to do.

## Reading the domain Status column

The **Status** column is the whole setup state machine in one cell. Each message tells you either what to do next or that you are done.

| What the Status column says                           | What it means                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | The CNAME is not verified yet. Add the record, then **Verify CNAME**.             |
| Action Required: Please order SSL certificate.        | CNAME is verified but no certificate is on order. Click **Order Free SSL**.       |
| No action is required, allow 30 minutes to provision. | You uploaded a custom certificate and it is being installed.                      |
| No action is required, this will be provisioned soon. | The free certificate is ordered and in flight. Contact support if it never lands. |
| Certificate Provisioned. No action required.          | Done. OneUptime renews the certificate automatically.                             |

If a row sits on "Action Required: Please add your CNAME record." long after you created the DNS entry, check that the record's name is the full domain and that its content matches your installation's CNAME record exactly.

## Powered by OneUptime

The "Powered by OneUptime" line is not a branding-section setting. It lives on **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), in the **Powered By OneUptime Branding** card, as a single toggle: **Hide Powered By OneUptime Branding**. **Edit Settings** opens it, like every other card on that page.

## Where to read next

- [Status Pages Overview](/docs/status-pages/index) — what a status page is and how the pieces fit together.
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — choosing what visitors actually see on the page.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — email, SMS, Slack and webhook subscribers, plus announcements.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what makes an incident appear on and disappear from the page.
