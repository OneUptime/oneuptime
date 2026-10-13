# SMSEagle Integration

Send alert notifications as SMS or phone calls through [SMSEagle](https://www.smseagle.eu), a hardware SMS gateway installed on-premise in your own network. OneUptime has built-in **SMSEagle** workflow components, so setup is quick.

This integration is **outbound**: OneUptime sends messages through the [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime Alert → On Create  ──►  SMSEagle component  ──►  SMS or call to a phone
```

## Step 1 — Create an API key

1. In the SMSEagle web GUI, go to **Settings → API → API v2** and click **Create API key**.
2. Under **Permissions**, allow **Send SMS** and, if you want calls, **Make a TTS Advanced Call**.
3. Copy the key. OneUptime calls it the **SMSEagle Access Token**.

## Step 2 — Let OneUptime reach the device

1. Allow the connection from your OneUptime server to the device's address, for example `https://192.168.0.100`, in firewalls and VPNs between the two.
2. An SMSEagle device usually has a private address, which workflows block by default. On a self-hosted instance, add the device's IP address or hostname to `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` on the API server, for example `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, and restart it — see [Private Network Access](/docs/self-hosted/private-network-access).

## Step 3 — Store the secrets

1. In OneUptime, go to **Workflows → Global Variables → Create**.
2. Create `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (secret) and `ONCALL_PHONE`.

## Step 4 — Build the workflow

1. Open **Workflows → Create Workflow**, name it `Alerts → SMSEagle`, and open the **Builder**.
2. Add an **Alert** trigger set to **On Create**. Rename it `Alert`.
3. Add a **Send SMS via SMSEagle** component connected to the trigger:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. **Save**, enable, and create a test alert. The SMS arrives on the phone.

The template **Text a phone via SMSEagle when an alert fires** builds the same workflow.

## Calls instead of SMS

Use **Make a Call via SMSEagle** instead. It takes the same settings plus a **Voice ID**, the text-to-speech voice on the device, and reads out the **Text to Read Out**. The API key needs the **Make a TTS Advanced Call** permission.

The template **Call a phone via SMSEagle when an alert fires** builds the same workflow with a call.

## Alternative: the API component

An **API** block works too:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tips

- If the device refuses the message, the reason is in the component's **Error** value — log it on the **Error** branch.
- Use **Conditions** to filter by severity before sending.
- To reach several people, connect several SMSEagle components, one per number.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the outbound pattern.
- [Components → SMSEagle](/docs/workflows/components#smseagle) — the component reference.
