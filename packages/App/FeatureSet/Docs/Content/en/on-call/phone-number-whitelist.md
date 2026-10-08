# Phone Number Whitelist for On-Call Notifications

On OneUptime Cloud, on-call SMS messages and phone calls come from the numbers below. Add them to your phone's allow list so that a page is never blocked, silenced or filed as spam.

## OneUptime Cloud numbers

| Number | Country |
| --- | --- |
| +13022917020 | United States (US) |
| +447427817020 | United Kingdom (UK) |

## Allow the numbers on your phone

:::steps
1. Save both numbers in your phone's contacts as one contact, for example "OneUptime".
2. If you use Do Not Disturb, Focus or another quiet mode, allow calls and messages from that contact.
3. If a call-screening or spam-filtering app, or your carrier's spam protection, is on, mark both numbers as trusted there too.
:::

> [!TIP]
> Adding or verifying your phone number in **User Settings** > **Notification Methods** sends you a code from these numbers, so it is a quick way to check that they get through.

## When pages come from other numbers

Your pages come from other numbers than the ones above when:

- **Your project uses its own Twilio account.** When a project has a Twilio config set as its project default (**Project Settings** > **Notifications** > **Notification Settings** > **Twilio Config**), SMS messages and calls to the project's members go through that account, from its phone numbers. Whitelist those numbers instead.
- **You use a self-hosted installation.** SMS messages and calls come from the Twilio numbers your administrator configured: the project's default Twilio config, or the installation-wide one under **Admin Dashboard** > **Settings** > **Call and SMS**. Ask your administrator which numbers to whitelist.

## Next steps

:::cards
- [Escalation Rules](/docs/on-call/escalation-rules): How each person a level pages is reached, and in which order.
- [On-Call Schedules](/docs/on-call/schedules): Decide who is on call, and when.
- [Twilio SMS and Voice Integration](/docs/self-hosted/twilio-integration): Use your own Twilio account and numbers on a self-hosted installation.
:::
