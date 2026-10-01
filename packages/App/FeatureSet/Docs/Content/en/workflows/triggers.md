# Triggers

A trigger is the first block in a workflow — it decides when the workflow runs. Every workflow has exactly one trigger. You pick from five kinds.

## Manual

Run the workflow on demand by clicking **Run Workflow** on the **Builder** page, filling in the trigger's fields, and confirming with **Run Workflow Manually**. The Manual trigger takes a JSON payload that the rest of the workflow can read.

Good for: one-click automations you want a button for, like "rotate this key" or "send a test alert."

**Output**: the JSON you pasted in, or an empty object if you didn't.

## Schedule

Run the workflow on a repeating schedule using a cron expression.

Good for: nightly cleanup, hourly sync, weekly reports.

**Setting**: a cron expression. A few common ones:

- `0 * * * *` — every hour, on the hour.
- `*/5 * * * *` — every 5 minutes.
- `0 9 * * 1` — every Monday at 9:00 AM.

If the system is briefly unavailable, the run is picked up as soon as it recovers — you don't need to worry about missed ticks for short outages.

## Webhook

OneUptime creates a unique URL. Anything that hits that URL starts the workflow. The headers, query parameters, and body of the request are passed in.

To get the URL, click the Webhook trigger on the canvas. The URL is at the top of its settings, with a **Copy URL** button, the methods it accepts, and a `curl` command you can paste into a terminal to try it.

The last part of the URL is the workflow's secret key, and anyone who has the URL can start the workflow. So the key is masked until you click **Show**, and **Copy URL** copies the whole URL without showing it. If the URL leaks, click **Reset URL** in the same place: the workflow gets a new URL, and the old one stops working at once, so update anything that calls it. Only people who can edit the workflow can see or reset its URL — see [Webhook security](/docs/workflows/configuration#webhook-security).

Good for: receiving data into OneUptime from another tool — CI/CD callbacks, alerts from other monitoring, signups in your CRM.

**Output**:

- **Request Headers** — all the headers from the incoming request.
- **Request Query Params** — the parsed query string.
- **Request Body** — the parsed body (or the raw text if it's not JSON).

Once a request has arrived, the value picker in every block after the trigger knows what was in it: it lists the fields of the body, the headers and the query parameters, each with what it held, so you can pick `incident.title` instead of typing a path. Until then it says that no request has arrived, and offers **Copy test request**, a `curl` command for the URL; the fields show up once the run that request starts has finished. See [Using values from earlier blocks](/docs/workflows/authoring#using-values-from-earlier-blocks).

The URL accepts both `GET` and `POST`. The caller gets a quick acknowledgement — the workflow itself runs in the background.

Treat the URL like a password. Anyone who has it can start your workflow.

## Incoming Email

OneUptime gives the workflow an email address of its own. Every email sent to that address starts the workflow, with the email passed in: who sent it, who it was for, the subject, the text and HTML, the headers, and the names of any attachments.

To get the address, click the Incoming Email trigger on the canvas. The address is at the top of its settings, with a **Copy address** button. Give it to whatever should start the workflow: a tool that can only send email, a vendor's notification settings, or a forwarding rule in your own mailbox. Email reaches the workflow whether the address is in To or CC, is a blind copy, or is reached through a forwarding rule. An email that names the address twice starts one run.

The part of the address before the `@` holds the workflow's secret key, and anyone who has the address can start the workflow. So the key is masked until you click **Show**, and **Copy address** copies the whole address without showing it. If the address leaks, click **Reset address** in the same place: the workflow gets a new address, and email to the old one is ignored from then on, so give the new one to everything that emails the workflow. Only people who can edit the workflow can see or reset its address — see [Incoming email security](/docs/workflows/configuration#incoming-email-security).

Good for: acting on email from systems that can't call a webhook — alerts from older monitoring tools, a vendor's status notices, the report a nightly job mails out.

**Output**:

- **From** — the sender's address.
- **To** and **CC** — everyone the email was addressed or copied to, as one line, such as `ops@example.com, oncall@example.com`.
- **Subject** — the subject line.
- **Body** — the plain text of the email. **HTML Body** — its HTML, when it has some. Each is cut at 1 MB.
- **Headers** — every header of the email, by its name in lower case, such as `message-id`.
- **Attachments** — the name, type and size of each attached file. The files themselves are not kept.
- **Received At** — when OneUptime received the email.

To try the workflow without sending an email, click **Run Workflow** on the **Builder** page and fill in a sender, a subject and a body. The values you leave out arrive empty.

Email starts the workflow only while it is on. Email to a workflow that is off is ignored, and so is email to a workflow whose trigger is no longer Incoming Email.

Self-hosted: OneUptime receives email through an inbound email provider that your administrator sets up — see [SendGrid Inbound Email](/docs/self-hosted/sendgrid-inbound-email). Until then the trigger has no address, and its settings say so.

## OneUptime event triggers

Almost every thing in OneUptime — monitors, incidents, alerts, scheduled maintenance, status pages, on-call policies, teams — can trigger a workflow. Each one offers three events:

- **On Create** — fires when a new one is added.
- **On Update** — fires when one is changed.
- **On Delete** — fires when one is deleted.

This is how you build "when X happens in OneUptime, do Y" without needing to check things in a loop.

**On Create** and **On Update** pass the record to the next block, with the fields you pick in the trigger's **Select Fields**. For example, the **Incident → On Create** trigger passes the new incident, so the next block can read its title, description, severity, or any other field you selected. A field you didn't select comes through empty.

**On Delete** passes only the deleted record's ID: the record is gone by the time the workflow runs, so its other fields can't be read.

### Events teams use most

- **Incident** — react when an incident is opened, updated (acknowledged, resolved), or deleted.
- **Alert** — same three for alerts.
- **Monitor** — react when a monitor is added, edited, or removed.
- **Scheduled Maintenance** — announce a maintenance window automatically when it's scheduled.
- **Status Page Subscriber** — welcome someone who subscribes to a status page.
- **On-Call Duty Policy** — sync schedule changes to another roster system.

Search the **Add Trigger** panel by name to find the one you want.

## Which trigger should I use?

| If you want to…                     | Pick                |
| ----------------------------------- | ------------------- |
| Click a button to run the workflow  | **Manual**          |
| Run on a repeating schedule         | **Schedule**        |
| Have another system push data in    | **Webhook**         |
| Start from an email                 | **Incoming Email**  |
| React to something inside OneUptime | **OneUptime event** |

A workflow can only have one trigger. If you need two ways to start the same automation, build the shared logic in one workflow and call it from two thin "wrapper" workflows using the **Execute Workflow** component.

## Where to read next

- [Components](/docs/workflows/components) — the actions you add after the trigger.
- [Variables](/docs/workflows/variables) — reading trigger output from later blocks.
- [Runs](/docs/workflows/runs-and-logs) — confirming your trigger fired.
