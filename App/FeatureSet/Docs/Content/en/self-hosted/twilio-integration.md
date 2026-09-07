# Twilio SMS and Voice Integration

Self-hosted OneUptime uses your Twilio account to send SMS and voice alerts. You pay Twilio directly. Configure credentials in OneUptime's dashboard: notification delivery reads saved configuration, and the Helm chart has no Twilio credential values. A legacy migration imported `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`; changing those variables is not the way to update an existing installation's credentials.

## 1. Prepare your Twilio account

1. Open the [Twilio Console](https://console.twilio.com/) and obtain your **Account SID** and **Auth Token**.
2. Obtain a Twilio phone number with the SMS and/or Voice capabilities you need. Use E.164 format, including the country code, for sender and recipient numbers.
3. Check the account balance, destination-country permissions, and applicable sender registration requirements. Trial accounts have recipient, geographic, and other restrictions that can prevent real OneUptime alerts from working; review [Twilio's account and trial documentation](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) before testing. Use an upgraded account for production.

## 2. Save the credentials in OneUptime

For a project:

1. Go to **Project Settings > Notifications > Notification Settings**.
2. In **Twilio Config**, select **Create Twilio Config**.
3. Enter a name, **Twilio Account SID**, **Twilio Auth Token**, and **Twilio Primary Phone Number**. Optionally enter comma-separated **Twilio Secondary Phone Numbers** for other countries.
4. Enable **Set as Project Default** to use this configuration for the project's member SMS and calls, including on-call notifications. Creating a configuration without setting this switch does not select it for those notifications.
5. Save. Only one configuration can be the project default. Status pages use the configuration explicitly assigned to each status page.

For an installation-wide default, an administrator can instead open **Admin Dashboard > Settings > Call and SMS**, edit the Twilio credentials and phone numbers, and save. Member notifications use this global configuration when their project has no default. Keep the Auth Token confidential.

## 3. Configure network access

A private deployment needs outbound HTTPS access to Twilio to submit SMS and calls. Twilio recommends allowing outbound HTTPS to `*.twilio.com` because its API addresses are dynamic; see [Twilio IP addresses](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Apply this to the OneUptime application workload's egress, including Kubernetes NetworkPolicies and external firewalls.

Inbound access depends on the feature:

| Feature | Does Twilio need to reach OneUptime? |
| --- | --- |
| SMS submission | No. Delivery status updates do need a callback. |
| A plain test voice call | No. OneUptime supplies the spoken instructions with the outbound API request. |
| Pressing 1 to acknowledge an on-call alert | Yes. Twilio submits the keypad input to OneUptime. |
| Incoming Call Policies | Yes. Twilio requests call instructions and reports dial results. |

For callbacks, follow [network access for Twilio and Microsoft Teams](/docs/self-hosted/integration-network-access) to publish the required HTTPS routes through an ingress or reverse proxy while keeping the dashboard private. A VPN on an administrator's laptop does not provide Twilio connectivity.

Set `HOST=oneuptime.example.com` and `HTTP_PROTOCOL=https` in Docker Compose's `config.env`, or `host: oneuptime.example.com` and `httpProtocol: https` in Helm values, then apply the deployment change. Replace the example with your domain. These settings determine the generated URLs; they do not create DNS records, certificates, or firewall rules. OneUptime has no separate Twilio callback hostname setting.

The following are external paths through OneUptime's Nginx gateway; placeholders vary per notification:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS delivery status |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Keypad acknowledgement |
| POST | `/notification/incoming-call/voice` | Optional incoming-call instructions |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Optional incoming-call routing results |

OneUptime generates the SMS and acknowledgement URLs automatically. Do not replace their tokens with a static webhook URL. For incoming calls, follow [Incoming Call Policies](/docs/on-call/incoming-call-policy), which configures the number's webhook when you attach a number.

Twilio requires [publicly reachable webhook URLs](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Use a publicly trusted TLS certificate and preserve the original host, protocol, path, query parameters, body, and `X-Twilio-Signature` header through proxies. Incoming-call handlers validate Twilio signatures; SMS delivery uses a per-message URL token, and keypad acknowledgement uses a signed query token. Do not expose tokens in shared logs or screenshots. See [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Test delivery and callbacks separately

1. Use **Send Test SMS** and **Send Test Call** on the project's Twilio configuration. Confirm receipt on the destination phone.
2. Configure the user's verified SMS/call contact and notification rules, then trigger a controlled on-call alert. Press 1 and confirm acknowledgement in OneUptime.
3. Confirm SMS delivery status in OneUptime and Twilio's message logs. An accepted send is not proof of delivery; [Twilio reports later status changes through callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

If sending fails, check credentials, number capabilities, account restrictions, and outbound connectivity. If a message or call arrives but status or acknowledgement does not update, inspect the callback URL and public ingress logs. Twilio's [HTTP retrieval failure guidance](https://www.twilio.com/docs/api/errors/11200) helps diagnose unreachable callbacks, TLS problems, and HTTP errors. A successful test call alone does not verify callback access.
