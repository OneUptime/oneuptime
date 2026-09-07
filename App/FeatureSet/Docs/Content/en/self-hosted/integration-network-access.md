# Integration Access from Private Networks

A self-hosted OneUptime instance can send requests to Twilio and Microsoft while remaining unreachable from their cloud services. An employee's VPN connection does not give either provider access to the private network. Use the [Twilio setup guide](/docs/self-hosted/twilio-integration) and [Teams setup guide](/docs/self-hosted/microsoft-teams-integration) with the networking steps below.

## Which direction needs access?

| Feature | OneUptime to provider | Provider to OneUptime |
| --- | --- | --- |
| Send an SMS or play a simple outbound voice alert | HTTPS | Not needed to submit the SMS or play inline voice instructions |
| SMS delivery updates, voice keypad actions, incoming call routing | HTTPS | Required callbacks; see the Twilio guide for routes |
| Teams notifications | HTTPS to Microsoft APIs | Required for the complete bot integration, including conversation discovery |
| Teams commands, card buttons, chat installation events | HTTPS | `POST /api/microsoft-bot/messages` |

The [Private Network Access settings](/docs/self-hosted/private-network-access) control OneUptime's outbound requests to internal services. Enabling `ALLOW_PRIVATE_NETWORK_WEBHOOKS` does not make OneUptime reachable by Twilio or Teams.

## Production: publish a gateway to the private deployment

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Public gateway (reverse proxy or load balancer)
          | Private connection; only callback routes
          v
Private OneUptime ingress -> OneUptime application
```

1. **Choose a hostname**, for example `oneuptime.example.com`. Publish public DNS records pointing to an internet-facing gateway. Private IP addresses and internal-only DNS names are not reachable by the providers. With split DNS, employees can resolve the same hostname to the private ingress and continue using the dashboard over the VPN. The private ingress must also serve HTTPS with a certificate valid for that hostname.
2. **Connect the gateway to OneUptime.** Place it in a DMZ with a route to the private ingress, or use a public gateway connected through your own site-to-site VPN/private link. Permit gateway-to-ingress traffic on the upstream service port. For Kubernetes/Portainer, a private `ClusterIP` service alone is insufficient: the gateway needs an ingress/controller or other reachable upstream. Keep databases and other internal services private.
3. **Terminate HTTPS on port 443** with a publicly trusted certificate and complete intermediate chain. Allow inbound TCP 443 to the gateway. Installing a certificate or changing DNS alone does not create the private upstream route.
4. **Forward only the required callback paths** from the table in the Twilio guide and `/api/microsoft-bot/messages` for Teams. Route them through OneUptime's ingress, which already maps `/notification` to the application. Preserve the method, original path, query string, body, `Authorization`, and `X-Twilio-Signature`. Preserve the public `Host` and set trusted `X-Forwarded-Host` and `X-Forwarded-Proto: https` at the gateway. Do not strip `/api` or add redirects. Deny other paths on the public gateway; employees can use the private ingress for the dashboard and browser sign-in callbacks.
5. **Keep callback authentication intact.** Exempt these routes from browser SSO, CAPTCHA, and proxy login pages because providers cannot complete them. OneUptime still validates its callback tokens, Twilio signatures on incoming-call routes, and Bot Framework authentication. Do not remove those checks. Allow origin access only from your gateway and authorized internal clients, and redact callback tokens from logs. Twilio describes this [DMZ proxy architecture and webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Set OneUptime's canonical URL** before configuring either integration:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer values:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   These settings control generated URLs; they do not provision DNS, TLS, or firewall access. Apply the Compose configuration or Helm release update and wait for the application to restart. OneUptime does not provide a separate Twilio callback hostname setting. If the hostname changes, update existing Twilio phone-number webhooks, the Azure Bot messaging endpoint and app registration redirect URIs, and download/upload the Teams manifest again.

## Outbound access and IP restrictions

Allow DNS resolution and outbound HTTPS from the OneUptime application. Twilio recommends access to `*.twilio.com` because its API addresses change; see [Twilio's IP address guidance](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams uses `graph.microsoft.com`, `login.microsoftonline.com`, Bot Framework authentication/channel endpoints, and the connector service URL for the conversation. Use [Microsoft's firewall guidance](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) and inspect blocked traffic when testing; these examples are not an exhaustive domain list.

Do not use Twilio SIP/media ranges or Teams client media ranges as webhook source allowlists. Ordinary Twilio webhook addresses are dynamic; eligible Twilio editions offer [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), which requires separate setup with Twilio. Microsoft's firewall guidance warns that fixed inbound Bot Framework IP allowlists are unsupported. Authenticate callbacks at the application instead of assuming a fixed source IP establishes identity.

## Testing and deployments with no inbound access

From a network outside your VPN, verify public DNS and TLS, then check the Teams route:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

On current OneUptime versions, expect `405 Method Not Allowed` with `Allow: POST`. This confirms that the GET reached the route, not that an authenticated bot POST will work. Older versions can return OneUptime's JSON 404; inspect the response body and proxy logs. TLS errors, timeouts, or a proxy's HTML error page indicate certificate or routing problems.

A browser GET does not exercise a Twilio POST callback. Send a real test SMS, check its delivery update, answer a test incident call and use its keypad action, then send the Teams bot a message and press a card button. Correlate provider delivery diagnostics with gateway and application logs, redacting tokens. Successful outbound delivery alone does not prove callbacks work.

For development, Twilio documents [testing through a tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview), and Microsoft documents [local Teams debugging](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Forward a public HTTPS tunnel to a proxy that permits only the required routes, configure the resulting hostname as above, and stop the tunnel after testing. A tunnel still exposes an inbound endpoint; it does not make a deployment air-gapped.

If policy forbids all inbound connectivity, SMS submission and simple inline voice playback can still work with outbound HTTPS, but delivery callbacks, keypad actions, incoming call routing, and the full Teams bot integration cannot. Azure Bot private endpoints for Direct Line do not solve Teams connectivity: Microsoft's [network isolation guide](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) states that disabling public access removes other channels, including Teams. A fully disconnected deployment cannot use these cloud integrations.
