# Behind a VPN or Firewall

A self-hosted OneUptime can stay off the public internet: it sends every alert over outbound connections. A few things come back in, though. A responder taps **Acknowledge** in a message, Twilio reports a key pressed on a call, Slack reports a button click. This page lists each of them, who connects to your server for it and on which path, so you can publish only what you use, or nothing at all.

:::cards
- [Who connects to your server](#who-connects-to-your-server): Responders' phones, and the providers that call back.
- [Keep everything private](#keep-everything-private): Put responders' phones on your VPN.
- [Publish only the acknowledgement pages](#publish-only-the-acknowledgement-pages): A narrow entrance for acknowledgement links.
- [Provider callbacks](#provider-callbacks): Telegram, Twilio, WhatsApp, Slack and Microsoft Teams.
:::

## Who connects to your server

Sending never needs inbound access: OneUptime connects out to your mail server, Twilio, Telegram, Meta, Slack, Microsoft and the push relay. What comes back in is one of these:

| What happens | Who connects to your server | Can a source address allowlist cover it? |
| --- | --- | --- |
| A responder taps **Acknowledge** in an email, SMS, WhatsApp or Telegram message | The responder's phone or computer | No: it connects from wherever the responder is |
| A responder acknowledges in the OneUptime On-Call app | The responder's phone | No: the same |
| A responder presses 1 on an on-call phone call | Twilio | Only with Twilio's Static Proxy for Webhooks |
| Someone links their Telegram account | Telegram | Yes, or poll Telegram and allow nothing |
| Someone clicks a button on a Slack or Microsoft Teams message | Slack or Microsoft | No: neither publishes fixed addresses |
| WhatsApp reports that a message was delivered or read | Meta | No: Meta publishes no fixed addresses |

A self-hosted server talks to these providers directly, never through OneUptime's own servers, so there is no list of OneUptime addresses to allow.

## Keep everything private

Put the responders' phones on your VPN: always on, or on demand for your OneUptime hostname, so nobody has to connect it before acknowledging a page at 3 a.m. With nothing published:

- The acknowledgement links in emails, SMS, WhatsApp and Telegram messages open, because the phone reaches your server.
- The OneUptime On-Call app works: point it at your server's address. Push notifications need no inbound access, because the server sends them through the push relay.
- People link their Telegram accounts once you turn on polling (see [Telegram](#telegram)).

A link in a messaging app opens in that app's own browser or in the phone's default browser, never in the OneUptime app. A per-app VPN therefore has to cover the messaging apps and the browser, not only the OneUptime app.

Pressing 1 on a phone call, buttons on Slack and Microsoft Teams messages, and WhatsApp's delivery receipts still need their provider to reach your server.

## Publish only the acknowledgement pages

If the responders' phones can't use your VPN, publish the pages an acknowledgement link opens, and nothing else. Put a reverse proxy in front of OneUptime, or an outbound tunnel such as Cloudflare Tunnel, which needs no inbound firewall rule, and let only these paths through:

| Method | Path | What it serves |
| --- | --- | --- |
| GET | `/l/*` | The short links in SMS, WhatsApp and Telegram messages |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | The page with what was paged and its **Acknowledge** button |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | The **Acknowledge** button |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Optional: the page that passes the page on to the next person |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Optional: its button |
| GET | `/oneuptime-assets/*` | The fonts, styles and logo of those pages |

:::steps
### Point a public name at the proxy
The links in messages are built from your `HOST` setting, so that name has to resolve publicly to the proxy, with a publicly trusted certificate. With split DNS, people on your network keep resolving it to the private address and use everything else as before.

### Forward the paths unchanged
Send these paths to OneUptime's ingress with their method, path and query string, and answer everything else with 404.

### Rate-limit them
Every link carries a random ID, and a short link is eight letters long. Limit the requests each address may make, so nobody can try IDs at speed.
:::

After a responder acknowledges, the page opens the alert in the dashboard, which loads only on your network. The acknowledgement is saved by then.

## Provider callbacks

### Telegram

Sending alerts needs only outbound HTTPS to `api.telegram.org`. Linking an account means your server receiving the `/start` message a person sends your bot, in one of two ways:

- **Polling**: turn on **Poll Telegram for Messages** in **Admin Dashboard > Settings > Telegram**. OneUptime fetches the bot's messages from Telegram every few seconds over outbound HTTPS, so nothing has to reach your server.
- **Webhook**: Telegram posts each message to `POST /api/notification/telegram/webhook`. Telegram [sends webhooks](https://core.telegram.org/bots/webhooks) from `149.154.160.0/20` and `91.108.4.0/22`, so you can allow only those addresses.

### Twilio

When a responder presses 1 to acknowledge a call, Twilio posts the key to `POST /api/user-notification-log-timeline/call/gather-input/*`. Twilio's webhook addresses change, unless your Twilio edition includes [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). SMS delivery updates and incoming calls are described in [Twilio Integration](/docs/self-hosted/twilio-integration).

### WhatsApp

Alerts and acknowledgements need nothing inbound. Meta posts delivery and read receipts to `/api/notification/whatsapp/webhook`; without them, OneUptime's WhatsApp log cannot show whether a message was delivered, read or failed after Meta accepted it. Meta signs every request, and publishes no fixed addresses.

### Slack and Microsoft Teams

Buttons, menus and commands on their messages call your server, from addresses neither publishes. The paths, and how to publish them, are in [Slack Integration](/docs/self-hosted/slack-integration) and [Microsoft Teams Integration](/docs/self-hosted/microsoft-teams-integration).

## Next steps

:::cards
- [Twilio Integration](/docs/self-hosted/twilio-integration): SMS and calls through your own Twilio account.
- [Push Notifications](/docs/self-hosted/push-notifications): The push relay, and what your server and phones reach.
- [Apps Overview](/docs/mobile-desktop-apps/index): Connect the OneUptime On-Call app to your server.
- [Private Network Access](/docs/self-hosted/private-network-access): The other way round: let OneUptime reach your internal tools.
:::
