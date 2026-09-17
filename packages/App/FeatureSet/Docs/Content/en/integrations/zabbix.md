# Zabbix Integration

[Zabbix](https://www.zabbix.com) watches your servers and network; OneUptime runs your incident response, on-call, and status pages. Connect the two and every Zabbix problem becomes a OneUptime incident automatically — so the right people get paged and your status page stays honest.

This integration is **inbound**: Zabbix sends problems to OneUptime. It uses a Zabbix **webhook media type** on one side and a OneUptime **[Workflow](/docs/workflows/index)** on the other. No plugins, no extra services.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## How it works

1. A Zabbix trigger changes to **PROBLEM**.
2. A Zabbix **action** tells the **OneUptime** media type to send the event.
3. The media type's script POSTs a small JSON payload to a OneUptime workflow URL.
4. The workflow reads the payload and creates an incident (and, optionally, resolves it when Zabbix recovers).

## Prerequisites

- A Zabbix server you administer (this guide is written for **Zabbix 6.0 LTS / 7.0 LTS**; the webhook media type works the same on 5.0+).
- Your Zabbix server must be able to reach your OneUptime instance over HTTPS.
- A OneUptime project where you can create workflows.

## Part 1 — Build the OneUptime workflow

Do this first, because you'll need the webhook URL it generates.

1. Open **Workflows → Create Workflow**. Name it `Zabbix → Incidents` and open the **Builder** tab.
2. Drag a **Webhook** trigger onto the canvas. Click it and **copy the unique URL** it shows. Keep this safe — anyone with it can start the workflow. Rename the block to `Zabbix` so variables read nicely.
3. Drag a **Conditions** block onto the canvas and connect the trigger's output to it. Configure:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1` _(Zabbix sends `1` for a problem, `0` for recovery)_
4. Drag a **Create Incident** block and connect it to the Conditions block's **Yes** output. Fill in:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: pick the OneUptime incident severity you want (you can refine this later with more Conditions branches that map Zabbix severities).
5. Save. Leave **Enabled** _off_ for now — you'll turn it on after a test.

> **Tip:** Putting the Zabbix `event_id` in the description (or an incident label) lets you find this incident again later if you want to auto-resolve on recovery. See [Resolving automatically](#resolving-automatically-optional).

## Part 2 — Configure Zabbix

### Step 1: Create the OneUptime media type

1. In Zabbix, go to **Alerts → Media types** (on older versions: **Administration → Media types**).
2. Click **Create media type** and set **Type** to **Webhook**.
3. **Name**: `OneUptime`.
4. Add these **Parameters** (click _Add_ for each). These map Zabbix [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) into a clean payload:

   | Name             | Value              |
   | ---------------- | ------------------ |
   | `url`            | `{ALERT.SENDTO}`   |
   | `event_id`       | `{EVENT.ID}`       |
   | `event_name`     | `{EVENT.NAME}`     |
   | `event_value`    | `{EVENT.VALUE}`    |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host`           | `{HOST.NAME}`      |
   | `event_date`     | `{EVENT.DATE}`     |
   | `event_time`     | `{EVENT.TIME}`     |

5. Paste this into the **Script** field:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. Click the **Message templates** tab and add a template for **Problem** and **Problem recovery** (the body can be empty — the payload is built in the script). This is required for Zabbix to use the media type for those event types.
7. **Add** to save the media type.

### Step 2: Create a user to carry the webhook

Zabbix sends notifications _to a user_. Create a dedicated one so the integration is easy to find and disable.

1. Go to **Users → Users → Create user**. Name it `OneUptime Webhook`, give it a role that can receive notifications (e.g. **User role**), and add it to a user group.
2. On the **Media** tab, click **Add**:
   - **Type**: `OneUptime`
   - **Send to**: paste the **workflow webhook URL** you copied in Part 1.
   - **When active** / severities: leave the defaults (or restrict to the severities you care about).
3. **Add** and **Update**.

### Step 3: Send problems to OneUptime with an action

1. Go to **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (optional): narrow it down — for example, _Trigger severity >= Warning_. Leave empty to send everything.
4. On the **Operations** tab, add an operation that sends to **User: OneUptime Webhook** via the **OneUptime** media type.
5. To resolve incidents on recovery later, also fill in the **Recovery operations** with the same user/media.
6. **Add** to save and make sure the action is **Enabled**.

## Part 3 — Test it

1. Back in the OneUptime workflow, turn **Enabled** on.
2. In Zabbix, trigger a test problem — for example, temporarily lower a trigger threshold, or use a test item that flips to a problem state.
3. Open your workflow's **Logs** tab. You should see a run with the Zabbix payload, the Conditions block taking the **Yes** path, and the incident being created.
4. Check **Incidents** in OneUptime — your Zabbix problem is now an incident.

If nothing arrives, see [Troubleshooting](#troubleshooting).

## Resolving automatically (optional)

The core workflow above _opens_ incidents. To also _close_ them when Zabbix recovers:

1. Make sure your Zabbix action has **Recovery operations** configured (Step 3 above) so recovery events are sent too. On recovery, `status` arrives as `0`.
2. In the workflow, add a second **Conditions** branch: left `{{Zabbix.Request Body.status}}`, operator `==`, right `0`.
3. From its **Yes** output, add a **Find Incident** block that looks up the open incident you created earlier — match on the Zabbix `event_id` you stored in the description or a label.
4. Connect that to an **Update Incident** block and move the incident to your _resolved_ state.

Because resolution depends on how you model incident states in your project, keep the **create** path as the reliable core and layer the resolve path on once you've confirmed events flow correctly. See [Components → OneUptime data components](/docs/workflows/components#oneuptime-data-components).

## Mapping Zabbix severities (optional)

Zabbix severities (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) arrive as `{{Zabbix.Request Body.severity}}`. To map them to OneUptime incident severities, add **Conditions** branches before **Create Incident** — for example, route `Disaster` and `High` to a "Critical" incident and everything else to "Major". Build one **Create Incident** block per branch.

## Troubleshooting

**The workflow never runs.**

- Confirm the workflow's **Enabled** switch is on.
- From the Zabbix server, confirm it can reach the URL: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. You should get a quick acknowledgement.
- Check **Reports → Action log** in Zabbix for delivery errors.

**Zabbix reports a script error.**

- Open the media type and use **Test** to send a sample payload. Zabbix shows the script's output or the thrown error.
- A non-2xx response from OneUptime is surfaced by the `throw` in the script — check the workflow URL is exactly right.

**The incident is created but fields are empty.**

- Open the workflow's **Logs** tab and inspect the trigger output. Confirm the field names under **Request Body** match what you reference (`name`, `host`, `severity`, `status`, `event_id`).
- A missing field resolves to an empty string rather than an error — see [Variables → Gotchas](/docs/workflows/variables#gotchas).

**Everything fires twice.**

- You probably have both a problem operation and an escalation step sending to the same media. Check the action's **Operations** steps.

## Security notes

- Treat the workflow webhook URL like a password. If it leaks, delete the trigger and create a new one to rotate the URL.
- Restrict the Zabbix action's conditions so you only forward the severities that warrant an incident.
- If you run OneUptime self-hosted behind a firewall, allow your Zabbix server's egress IP to reach it over HTTPS.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound/outbound patterns.
- [Webhook trigger](/docs/workflows/triggers#webhook) — how the receiving URL works.
- [Components](/docs/workflows/components) — Conditions, Create Incident, and more.
- [Variables](/docs/workflows/variables) — reading the Zabbix payload in later blocks.
