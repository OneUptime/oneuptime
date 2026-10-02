# Sharing & Security

A form is open to anyone who has its link, and each submission can page your on-call team or put a maintenance window on your calendar. This page covers the form's **Share** page — the link, turning the form off, the message after submitting and the IP allowlist — and every other check a request passes on the way.

## The Share page

| Card                | What it holds                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Status**          | **Accepting Submissions** — whether the form's link works.                                                        |
| **Share Link**      | The link, with **Copy Link**, **Open Form** and **Reset Link**.                                                   |
| **After Submitting** | The **Thank-You Message** people see once they submit, under the number of what the form created.               |
| **Access**          | The **IP Allowlist**.                                                                                             |

## Sharing the link

The **Share Link** card shows the form's link, such as `https://oneuptime.com/accounts/form/<share-key>`:

- **Copy Link** copies it.
- **Open Form** opens the form in a new tab, the way people see it.
- **Reset Link** gives the form a new link, after you confirm. The old link stops working at once and shows the not-available message, so everybody you shared it with needs the new one. Use it when a link has spread further than it should.

Anyone with the link can open the form and submit it, without a OneUptime account and without signing in. Being signed in changes nothing: OneUptime knows who submitted only from the name and email typed into the form. So treat the link like a phone number for your on-call team. Share it where the people who should use it will find it — an intranet page, a support runbook, a pinned chat message — and not on a public website, unless you want submissions from anyone.

The link carries a random key of its own, not the form's ID. On a self-hosted installation it is served from your own OneUptime host, and works only at the address `HTTP_PROTOCOL` and `HOST` configure: opened at another name for the server, or at its IP address, the form's requests are refused as coming from another website.

Links to the old incident forms, `/accounts/incident-form/<share-key>`, open the same form at its new address.

### Turning a form off

To stop taking submissions without deleting the form, turn **Accepting Submissions** off. The link then shows "This form is not available. It may have been turned off, or the link may be out of date.", and the **Share Link** card reminds you that the form is turned off. Turn it back on and the same link works again.

### The thank-you message

After a submission, the page says "Thank you — your response was submitted." and gives the number of what was created, then your **Thank-You Message**, in Markdown. Use it to say what happens next, and where to go when something is urgent. Without one, the page shows only the standard message.

## What protects a form

Every request passes these checks, in this order:

1. The request must come from the form's own page, not from another website — see [Requests from other websites](#requests-from-other-websites).
2. It must be within the rate limits.
3. The form must exist, be **Accepting Submissions**, and belong to a project on a plan that includes forms.
4. It must come from an address on the **IP Allowlist**, when the form has one.
5. A submission must pass the captcha, when the instance has captcha turned on.
6. Every answer must be within the size limits and fit its question — see [Building a Form](/docs/forms/building#size-limits).
7. What the answers and the settings make must be creatable: an incident needs a severity, an event an end after its start.
8. A submission must fit within the form's hourly allowance — see [Rate limits](#rate-limits).

### IP allowlist

To limit a form to your own networks, fill in **IP Allowlist** on the **Access** card, one entry per line: an IPv4 address such as `203.0.113.7`, an IPv6 address such as `2001:db8::7`, or an IPv4 range in CIDR notation such as `10.0.0.0/8`. IPv6 ranges are not supported — list each IPv6 address on a line of its own. An IPv6 address matches however it is written, in capitals or with its zeros spelled out. An IPv4 address must be written as one: written the IPv6 way, such as `::ffff:203.0.113.7`, it is refused.

The list is checked whenever it is saved — from the dashboard, the API, Terraform or a workflow — and a line that could never match is refused with a message that names it. Leave the list empty to allow every network. Once it has an entry, a request whose address cannot be established is refused.

On OneUptime Cloud, editing the IP allowlist needs the **Scale** plan, like the IP allowlist of a [public dashboard](/docs/dashboards/sharing).

### Requests from other websites

A browser tells a server which page sent a request. When another website's page makes a visitor's browser open or submit a form, the request is refused with "This form can only be used from its own page." — before any rate limit counts it, and whatever the link, so the answer says nothing about which forms exist.

A request is refused when its `Sec-Fetch-Site` header is there and says anything but `same-origin` or `none`, or when its `Origin` header is there and is not your OneUptime address — `HTTP_PROTOCOL` and `HOST`, with the port when `HOST` has one. A submission must also be sent as JSON (`application/json`); one sent as a web page's form fields, or as plain text, is refused with "The request must be a JSON object holding the form's answers in "data".". Reading a form also needs the header the form's page adds to every request it makes, `X-OneUptime-Form: 1`: a page cannot have a browser add a header without a script, and another website's script that adds one gives itself away with its `Origin`.

### Rate limits

Opening a form and submitting it are limited per network address, and submitting is limited per form as well:

- **Opening a form** — per form from one address, and per address across every form, with room for a whole office opening the link at once. Past either, the page shows "Too many requests. Please try again later." If the rate limiter cannot be reached, forms still open.
- **Submitting, per address** — per form from one address, and per address across every form. Past either, the submitter sees "Too many submissions from your network. Please wait a few minutes and try again." Everybody behind one address — an office network, a VPN gateway — shares these limits, and every submission counts, even one that is then refused for a wrong answer.
- **Submitting, per form** — how many records one form may create in an hour, from every address together, so even submissions from many addresses at once can only page you a limited number of times an hour. Only a submission that passed every other check counts, right before its record is created. Past it, everybody sees "This form is receiving too many submissions right now. Please try again later." until the window is over. **Reset Link** starts the new link with a fresh allowance.

Every limit answers `429` with a `Retry-After` header, in seconds, and the page tells the submitter when to try again. The windows are fixed, not rolling. If the rate limiter cannot be reached, submissions are refused rather than let through uncounted: the API answers `503`, and the submitter sees "Submissions cannot be accepted right now. Please try again in a few minutes."

On a self-hosted installation, these environment variables of the OneUptime app change the limits:

| Variable                                            | Default | What it sets                                                            |
| --------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `FORM_RATE_LIMIT_WINDOW_SECONDS`                    | `60`    | The window for opening forms, in seconds.                               |
| `FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW`        | `120`   | How often one address may open one form per window.                     |
| `FORM_RATE_LIMIT_PER_IP_PER_WINDOW`                 | `600`   | How often one address may open forms per window, across every form.     |
| `FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS`             | `900`   | The window for the per-address submission limits, in seconds.           |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW` | `10`    | Submissions to one form from one address per window.                    |
| `FORM_SUBMIT_RATE_LIMIT_PER_IP_PER_WINDOW`          | `30`    | Submissions from one address per window, across every form.             |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_WINDOW_SECONDS`    | `3600`  | The window for the per-form limit, in seconds.                          |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW`        | `60`    | Records one form may create per window, from every address together.   |

Each variable also reads its old name, with `INCIDENT_FORM_` in front instead of `FORM_` — such as `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW` — so an installation that tuned incident forms keeps its limits; the new name wins when both are set. Neither `config.env` nor the Helm chart's values pass them on: add them to the environment of the `app` container yourself — with `app.extraEnv`, or the chart-wide `extraEnv`, in the Helm chart, or in a `docker-compose.override.yml` for Docker Compose. `TRUSTED_PROXY_HOPS` decides which address the per-address limits count.

### Captcha

When your OneUptime instance has hCaptcha turned on, the form shows a captcha, and a submission that has not passed it is refused. There is no per-form setting. A self-hosted installation turns captcha on with `CAPTCHA_ENABLED`, `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` — the same settings that protect sign-up. Without it, the rate limits and the IP allowlist carry the load.

## Troubleshooting

### The link says the form is not available

"This form is not available. It may have been turned off, or the link may be out of date." The page gives the same answer whatever the reason, so it never tells a stranger whether a form exists:

- **Accepting Submissions** is off on the **Share** page.
- The link was replaced with **Reset Link**. Share the new one.
- The form was deleted.
- On OneUptime Cloud, the project is below the **Growth** plan, or its subscription is unpaid.
- The link was cut short when it was copied.

### The form can only be opened from an allowed network

"This form can only be opened from an allowed network." The submitter's address is not on the form's **IP Allowlist**: add their network, or empty the list. On a self-hosted installation behind a proxy or load balancer, check `TRUSTED_PROXY_HOPS` — when it is too low, OneUptime sees your proxy's address instead of the submitter's. The page says the same when the form was opened at another address than your OneUptime's own: open the link exactly as the **Share Link** card shows it.

### Too many submissions

"Too many submissions from your network. Please wait a few minutes and try again." Everybody behind one address shares the per-address limits, which matters during a large outage, when many people report at once. The page says when to try again. "This form is receiving too many submissions right now. Please try again later." is the per-form allowance instead: it is not about the submitter's network, and reports are taken again when the window is over. If the submissions are not genuine because the link spread further than it should, **Reset Link** stops the old link at once.

### Submissions cannot be accepted right now

"Submissions cannot be accepted right now. Please try again in a few minutes." The rate limiter could not be reached, so submissions are refused rather than let through uncounted. Opening the form still works. On a self-hosted installation, check that Valkey, the cache the rate limiter counts in, is up and reachable from the OneUptime app.

### This form cannot create an incident because it has no severity

The form does not ask for a severity, its settings name none — or the one they named was deleted — and its incident template sets none either. Choose a severity on the form's **On Submit** page. See [No severity, no incident](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

### A submission is refused

The message says what is wrong: a required answer is missing or only spaces, an answer is too long or does not fit its question, the email address is not one ordinary address, or a maintenance window ends before it starts. "Captcha verification failed. Please try again." means the captcha was not passed, or has expired: solve it again. On a self-hosted installation where every submission fails the captcha, check that `CAPTCHA_SITE_KEY` and `CAPTCHA_SECRET_KEY` are both set.

### A question is not on the form

The builder flags questions it leaves off the public form — a custom field that was deleted, for example — and **Preview** says when it leaves one out. See [When the builder flags a question](/docs/forms/building#when-the-builder-flags-a-question).

### The incident or event is not on the status page

That is by design: incidents from a form are declared hidden, and maintenance events stay hidden unless the form's **Publishing** settings say otherwise. See [What a Submission Creates](/docs/forms/on-submit).

### Nobody was paged

A form's incident executes the on-call policies its settings and its template name, and whatever your on-call rules add, like any other incident. With none of them, nobody is paged. Add an on-call policy on the form's **On Submit** page, or write an on-call rule that matches its incidents — by a label the form always adds, for example.

## Where to read next

- [Forms Overview](/docs/forms/index) — what forms are for, permissions and the API.
- [Building a Form](/docs/forms/building) — the questions.
- [What a Submission Creates](/docs/forms/on-submit) — the incident or event each submission creates.
