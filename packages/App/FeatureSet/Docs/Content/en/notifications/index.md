# How OneUptime Reaches You

OneUptime reaches you in two ways. It pages you when an incident or alert fires while you are on call, and it keeps you up to date on what you own: a note on your incident, a monitor that changed status, your next shift. Both arrive at the addresses you keep in **User Settings**, project by project. This page explains how the pieces fit together, where they are, and what you start with.

:::cards
- [Three pages, three questions](#three-pages-three-questions): Methods, on-call rules and notification settings, and what each one decides.
- [Where to find them](#where-to-find-them): The pages of User Settings, section by section.
- [What you start with](#what-you-start-with): The methods, rules and settings a new member gets.
- [When no rule matches](#when-no-rule-matches): How a page still reaches you, and who is told.
:::

## How it works

```mermaid title="Two ways OneUptime reaches you, through one set of methods"
flowchart TB
    page["An incident or alert<br/>pages you on call"] --> rules["Your on-call rules"]
    owned["Something happens to<br/>a record you own"] --> settings["Your notification<br/>settings"]
    rules --> methods["Your verified methods:<br/>email, phone, push, chat"]
    settings --> methods
```

- An on-call policy pages you when one of its escalation rules names you, a team you are in, or a schedule you are on call in. Your on-call rules then decide which of your methods OneUptime tries, and after how long.
- When something happens to a record you own, or to your shifts, your notification settings decide which channels the update goes to.
- Either way, OneUptime only uses methods you have verified, in the project the page or update comes from.

## Three pages, three questions

| Page | What it holds | The question it answers |
| --- | --- | --- |
| **Notification Methods** | Your email addresses, phone numbers, WhatsApp numbers, Telegram, Slack and Microsoft Teams accounts, push devices and webhooks | Where can OneUptime reach me? |
| **On-Call Rules** | For each kind of page and each severity, which method to try and after how long | How am I paged while I am on call? |
| **Notification Settings** | For each event about a record you own or about your shifts, which channels to use | What else do I hear about, and where? |

They are separate on purpose. Switching every channel on in **Notification Settings** never pages you, and a method you have not verified is never used, whatever your rules say.

> [!IMPORTANT]
> Methods, rules and settings belong to one project. Set them up in every project you work in: **User Settings** always shows the project you are in.

## Where to find them

Open **User Settings**, on the right of the bar under the top bar. Its side menu holds everything about how OneUptime reaches you:

| Section | Pages |
| --- | --- |
| **Get Started** | **Setup Checklist**: what is left to set up, in the order it matters |
| **Alerts & Notifications** | **Notification Methods**, **On-Call Rules**, **Notification Settings** and **Email Preferences**, which sets how many emails your updates add up to |
| **On-Call Logs** | **On-Call Logs**: every time you were paged in this project, and what was sent |
| **Incoming Call Policy** | **Incoming Phone Numbers**: the number an incoming call policy rings you on |
| **Calendar** | **Calendar Feed**: your shifts in your calendar app, and reminders before they start |
| **Profile** | **Custom Fields**: details your project asks its members for |
| **Workspace** | **Slack** and **Microsoft Teams**: your own account, in each workspace the project has connected |

**Get Started** and **Alerts & Notifications** are open; the other sections start folded, and a section opens by itself when you are on one of its pages. **Workspace** shows only when the project has connected Slack or Microsoft Teams.

Project owners and admins can look at your setup too: under **Users**, they open your row and its **On-Call** section, with **Readiness**, **Notification Methods** and **On-Call Rules**. They can add a method for you there, but the code goes to the method itself, so only you can verify it.

## What you start with

When you join a project with a verified sign-in email, OneUptime sets you up so that a page can always reach you:

1. Your sign-in email is added as a verified email method.
2. For every severity, on each of the four tabs of **On-Call Rules**, a rule emails you as soon as you are paged.
3. A set of updates about what you own, and about your shifts, is switched on by email. See [Notification Settings](/docs/notifications/notification-settings#what-is-on-for-a-new-member).

Every method you verify later gets the same rules: a rule for every severity, sent as soon as you are paged. So verifying a phone number for SMS means every page also texts you. To keep texts for critical pages only, delete the other severities' SMS rules. See [Personal On-Call Rules](/docs/notifications/on-call-rules#the-rules-you-start-with).

## The setup checklist

**User Settings → Setup Checklist** opens **Your setup checklist**: everything OneUptime needs to reach you, in the order it matters. A step links to the page that does it, and **Recheck** reads it all again.

| Section | What it checks |
| --- | --- |
| **So we can reach you** | You have a method, every method you added is verified, and at least one of them is on a channel the project has turned on |
| **How you want to be paged** | Every severity has a rule, on each of the four tabs of **On-Call Rules** |
| **Staying informed** | You hear when a shift starts, and every channel you switched on in **Notification Settings** has a verified method behind it |
| **Nice to have** | A number for incoming calls, your Slack and Microsoft Teams accounts, a calendar link and your profile fields |

Push is left out of **Staying informed**: it needs only the mobile app, and every update a new member gets by push goes by email as well.

**Nice to have** is not counted in the progress bar, and neither is a step only someone else can fix. The line at the top sums it up:

| Headline | What it means |
| --- | --- |
| **You are all set** | Pages reach you, and nothing is left to do |
| **A few things still need setting up** | A severity has no rule, or a step is not done yet |
| **Nothing can reach you yet** | None of your methods can be used: none is verified, or each verified one is on a channel this project has turned off |
| **You are set up, and not on call right now** | Everything is ready for the day a policy names you |

## When no rule matches

A page can reach you for a kind and severity you have no rule for: a severity added after you joined, say. OneUptime still pages you, on what you have verified:

1. Every free method you have: push devices, email addresses, Slack and Microsoft Teams.
2. If you have none of those, one paid method, in this order: SMS, a phone call, WhatsApp, Telegram. It is the first one you have verified, on a channel the project has turned on.
3. If you have none of those either, a webhook.

You get an email saying so, and so do the on-call policy's owners, or the project's owners when the policy has none. With nothing verified at all, the page cannot be delivered, and the email says that instead. These emails are held back while pages keep coming, so a storm of pages is not a storm of mail. To add the missing rule, see [Personal On-Call Rules](/docs/notifications/on-call-rules#when-a-severity-has-no-rule).

## Troubleshooting

:::details I was on call, but nothing reached me
Open **User Settings → On-Call Logs**. No row for the incident means its on-call policy never paged you: check its escalation rules and who was on call. For a row whose status is **Error**, **View Status Message** says why, such as a channel the project turned off. Then check that your methods are verified, and that **Your setup checklist** has nothing left under **So we can reach you**.
:::

:::details I get emails about records I never asked about
You are an owner of the record, directly or through a team, or the record has no owners and you are a project owner. Switch the event off under **User Settings → Notification Settings**, or cut the volume under **User Settings → Email Preferences**.
:::

:::details I added a phone number, but it is not in my rules
A number joins your rules once it is verified. Click **Verify** on its row and enter the code. If its card has no add button, the project has that channel turned off. See [Notification Methods](/docs/notifications/notification-methods#turn-a-channel-on-for-your-project).
:::

## Next steps

:::cards
- [Notification Methods](/docs/notifications/notification-methods): Add and verify the addresses OneUptime may reach you at.
- [Personal On-Call Rules](/docs/notifications/on-call-rules): Decide which method each page tries, and when.
- [Notification Settings](/docs/notifications/notification-settings): Choose the updates you hear about, and on which channels.
- [Escalation Rules](/docs/on-call/escalation-rules): How an on-call policy decides who is paged, level by level.
:::
