# Branding & Custom Domains

A status page is the one OneUptime surface your customers actually look at, so it should look like it belongs to you and live on your own domain. Both of those are configured from the **Branding** section of a status page's side menu.

This page walks the **Branding** page card by card, then takes you through the full CNAME-then-SSL sequence for putting the page on `status.yourcompany.com`.

## Where each branding control lives

Open a status page, and the side menu's **Branding** section has three items:

| Page                       | What you set there                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branding**               | Logo and cover image, page title and description, favicon, header links, the overview page description, the copyright line and footer links. Folded under **Advanced**: history chart colors, languages and search engine indexing. |
| **Custom Domains**         | Your own domain, CNAME verification, and SSL.                                                                                                                                                                                       |
| **HTML, CSS & JavaScript** | Header HTML, footer HTML, custom CSS, custom JavaScript.                                                                                                                                                                            |

Three things that look like branding are on **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`) instead, because they decide what the page shows rather than how it looks: the **Overall Uptime Percent**, which **Downtime Monitor Statuses** count against uptime, and the "Powered by OneUptime" line.

Branding used to be split across separate **Essential Branding**, **Header**, **Footer**, **Overview Page** and **Languages** screens. Their old addresses (`{id}/header-style`, `{id}/footer-style`, `{id}/overview-page-branding` and `{id}/languages`) now open the **Branding** page, so old bookmarks and links still work.

## The Branding page

**Status Pages → your page → Branding → Branding** (`{id}/branding`). Each card saves on its own. After the logo, the title and the favicon, the cards follow your status page from top to bottom: the header's links, the text at the top of the overview, then the footer. What few people change is folded under **Advanced**, at the bottom of the page.

### Logo and cover image

The first card, **Logo and Cover Image**, has an **Edit Images** button that opens two steps:

- **Logo** — image upload, placeholder `Upload logo`, and **Logo Alt Text**, placeholder `Logo of My Company`. If you leave the alt text blank, the status page title is used instead.
- **Cover Image** — **Cover**, an image upload (placeholder `Upload cover image`) for the wide banner behind the header, and **Cover Image Alt Text**. Leave the alt text blank if the cover is purely decorative.

### Title, description and favicon

- **Title and Description** — the card notes this is also used for SEO. **Edit** opens **Page Title** (placeholder `Please enter page title here.`) and **Page Description**. This is what search engines and link previews show, so write it for a customer, not for your team.
- **Favicon** — **Edit Favicon** opens the **Favicon** image upload. This is the little icon in the browser tab.

### Header links

The **Header Links** table ("Header Links for your status page") holds the links in the status page's header. Each link has a **Title** and a **Link** (a URL, placeholder `https://link.com`), and rows are reordered by dragging. With none configured the table says **No status header link for this status page**, with **Create Status Page Header Link** under it.

Good for: pointing visitors back to your marketing site, your docs, or a support portal without making them guess the URL.

### Overview page description

**Overview Page Description** is the first thing on the status page's overview, above the announcements, the overall status and your resources. **Edit Description** opens a markdown field. Use it for a sentence of context: what this page covers, and where to go for support.

### Footer

- **Copyright Info** — **Edit Copyright** opens a single field, **Copyright Info**, with the placeholder `Acme, Inc.`.
- **Footer Links** — the same **Title** plus **Link** pair as the header links, drag-ordered, empty message "No status footer link for this status page."

Legal, privacy and terms links belong here. Header links are for navigation; footer links are for the fine print.

### Advanced

The last section of the page is folded, because few people ever change what is in it. Its header says what it holds ("History chart colors, languages, and whether search engines may list this page."), and it reads **Configured** while anything in it differs from what a new status page starts with: a default bar color other than the green every page starts with, any bar color rule, a default language other than English, a shorter list of languages, or search engine indexing turned off. Click it to open it.

**History chart colors.** These are the only built-in color controls on a status page.

- **Default Bar Color of the History Chart** — **Edit Default Bar Color** opens the **Default Bar Color** picker. Every new status page starts with green.
- **Rules for Bar Colors of History Chart** — an ordered, drag-sortable table of rules. Each rule has **When uptime % is greater than or equal to** and **Then, use this bar color**; the table columns read `When Uptime Percent >=` and `Then, Bar Color is`. Order matters, so arrange them the way you want them evaluated. With no rules, each day's bar takes the color of the lowest monitor status of that day.

How many days the chart covers is not set here. That is **Uptime History** in the **What your status page shows** card on **Advanced → Advanced Settings**, from 1 to 90 days. Which monitor statuses count as down is the **Downtime Monitor Statuses** card on the same screen.

**Languages.** The **Languages** card is about the language switcher visitors get in the page footer. **Edit Languages** opens two fields:

- **Default Language** — a dropdown listing each supported language by native name and English name (`Deutsch (German)`): the language first-time visitors see. Visitors can always switch from the footer. It defaults to English.
- **Enabled Languages** — a multi-select, placeholder `All languages`. Leave it empty and every supported language is offered. Choose a few and the footer switcher lists only those.

Seventeen languages ship with OneUptime: English, German, French, Spanish, Italian, Portuguese, Dutch, Danish, Norwegian, Swedish, Russian, Japanese, Korean, Chinese (Simplified), Chinese (Traditional), Hindi and Persian.

**Search Engine Indexing.** A single switch, **Allow Search Engines to Index this Status Page**, controls whether Google, Bing and other search engines may list the page in their results. It is on by default. There is no **Edit** button: the switch saves the moment you flip it. Switch it off and the page is served with `noindex, nofollow` instead (a robots meta tag and an `X-Robots-Tag` header). The page stays reachable by anyone with its link. Search engines can take a few weeks to drop a page they have already indexed.

Use it when: the page is internal-only or still being set up. Turn **Allow Search Engines to Index this Status Page** off so a half-finished page does not start ranking for your brand name.

## Uptime percent and downtime statuses

The **Overall Uptime Percent** and **Downtime Monitor Statuses** cards are on **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), under the **What your status page shows** card:

- **Overall Uptime Percent** — **Edit Settings** opens the **Show Overall Uptime Percent** toggle and a **Select Uptime Precision** dropdown, which defaults to two decimals (`99.99% (Two Decimal)`). On OneUptime Cloud, showing the overall uptime percent needs the **Scale** plan.
- **Downtime Monitor Statuses** — **Edit Statuses** opens a multi-select described as "These monitor statuses are considered as down". This is how you decide whether, say, a degraded status counts against uptime on this page.

## Custom HTML, CSS and JavaScript

**Status Pages → your page → Branding → HTML, CSS & JavaScript** (`{id}/custom-code`) has four independently editable cards, backed by the `headerHTML`, `footerHTML`, `customCSS` and `customJavaScript` columns on the status page:

> Active custom HTML, CSS and JavaScript is served only on a verified custom domain. It is disabled on the default `/status-page/:id` URL because that URL shares OneUptime's authenticated origin.

- **Header HTML** — placeholder `Insert Custom HTML here.`, injected into the page header.
- **Footer HTML** — the same, for the footer.
- **Custom CSS** — placeholder `Insert Custom CSS here.`
- **Custom JavaScript** — placeholder `Insert Custom JavaScript here.`

**There is no theme picker.** OneUptime status pages have no theme or brand-color setting: the only built-in color controls anywhere are **Default Bar Color** and the history chart bar color rules, under **Advanced** on the **Branding** page. Fonts, background colors, accent colors and layout tweaks all go through **Custom CSS** here. If you have been looking for a "brand color" field, this is the answer — there isn't one, and this box is the escape hatch.

> Custom JavaScript runs in your visitors' browsers on a page people load precisely when they are worried something is broken. Keep it small, keep it self-hosted where you can, and test it before you rely on it.

## Custom domains

By default a status page is reachable at the preview URL shown on its **Overview** screen. To put it on your own hostname, go to **Status Pages → your page → Branding → Custom Domains** (`{id}/domains`).

The card is titled **Custom Domains** and its description spells out the requirement directly: add your installation's status page CNAME record as the CNAME for these domains for this to work. With nothing configured the table says **No custom domains found**, with **Create Status Page Domain** under it. The table has two columns, **Domain** and **Status**, and filters for **Domain**, **CNAME Valid** and **SSL Provisioned**.

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

## Reissuing a certificate

Renewal being automatic covers the ordinary case, but sometimes you want a brand new certificate right now — a private key you would rather not keep, a certificate your own scanner is unhappy with, or a domain that changed upstream. Once a free certificate has been ordered for a domain, the row shows a **Reissue SSL** action.

Its modal, **Reissue SSL Certificate for this Status Page**, asks LetsEncrypt for a fresh certificate for the domain and replaces the one we serve with it. Your status page stays online on the existing certificate while that happens, and the new certificate is served within 15 minutes.

**A domain can only be reissued once every 24 hours.** LetsEncrypt rate limits how often the same domain can be issued, and every OneUptime certificate is ordered against one shared account — including the automatic renewals keeping everybody else's pages online. If you press the button inside that window the modal tells you how long is left instead of ordering.

The action does not appear on a domain using a certificate you uploaded yourself; there is no LetsEncrypt certificate there for us to reissue, so upload a new one by editing the domain instead. It also does not appear before you have ordered a certificate at all — **Order Free SSL** is the action for that.

The same button, with the same 24 hour limit, is on dashboard custom domains under **Dashboards → your dashboard → Custom Domains**.

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

The "Powered by OneUptime" line is not a branding-section setting. It is the last switch of the **What your status page shows** card on **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`): **Show Powered By OneUptime Branding**, on by default. Turn it off to hide the line; it saves at once. On OneUptime Cloud, hiding it needs the **Scale** plan.

## Where to read next

- [Status Pages Overview](/docs/status-pages/index) — what a status page is and how the pieces fit together.
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — choosing what visitors actually see on the page.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — email, SMS, Slack and webhook subscribers, plus announcements.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what makes an incident appear on and disappear from the page.
