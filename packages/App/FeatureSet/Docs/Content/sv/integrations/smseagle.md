# SMSEagle-integration

Skicka larm som sms eller samtal via [SMSEagle](https://www.smseagle.eu), en hårdvaru-sms-gateway som står lokalt i ditt eget nätverk. OneUptime har inbyggda **SMSEagle**-arbetsflödeskomponenter, så det går snabbt att komma igång.

Den här integrationen är **utgående**: OneUptime skickar meddelanden via [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime-larm → On Create  ──►  SMSEagle-komponent  ──►  sms eller samtal till en telefon
```

## Steg 1: Skapa en API-nyckel

1. Gå till **Settings → API → API v2** i SMSEagles webb-GUI och klicka på **Create API key**.
2. Under **Permissions** tillåter du **Send SMS** och, om du vill ha samtal, **Make a TTS Advanced Call**.
3. Kopiera nyckeln. OneUptime kallar den **SMSEagle Access Token**.

## Steg 2: Låt OneUptime nå enheten

1. Tillåt anslutningen från din OneUptime-server till enhetens adress, till exempel `https://192.168.0.100`, i brandväggar och VPN:er mellan dem.
2. En SMSEagle-enhet har oftast en privat adress, som arbetsflöden blockerar som standard. På en egen installation lägger du till enhetens IP-adress eller värdnamn i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` på API-servern, till exempel `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, och startar om den. Se [Åtkomst till privata nätverk](/docs/self-hosted/private-network-access).

## Steg 3: Spara hemligheterna

1. Gå till **Arbetsflöden → Globala variabler → Skapa** i OneUptime.
2. Skapa `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (hemlig) och `ONCALL_PHONE`.

## Steg 4: Bygg arbetsflödet

1. Öppna **Arbetsflöden → Skapa arbetsflöde**, döp det till `Alerts → SMSEagle` och öppna **Byggare**.
2. Lägg till en **Alert**-utlösare inställd på **On Create**. Byt namn på den till `Alert`.
3. Lägg till en **Send SMS via SMSEagle**-komponent kopplad till utlösaren:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Klicka på **Spara**, slå på arbetsflödet och skapa ett testlarm. Sms:et kommer fram till telefonen.

Mallen **Text a phone via SMSEagle when an alert fires** bygger samma arbetsflöde.

## Samtal i stället för sms

Använd **Make a Call via SMSEagle** i stället. Den har samma inställningar plus ett **Voice ID**, text-till-tal-rösten på enheten, och läser upp **Text to Read Out**. API-nyckeln behöver behörigheten **Make a TTS Advanced Call**.

Mallen **Call a phone via SMSEagle when an alert fires** bygger samma arbetsflöde med ett samtal.

## Alternativ: API-komponenten

Ett **API**-block fungerar också:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tips

- Om enheten avvisar meddelandet finns orsaken i komponentens **Error**-värde. Logga det på utgången **Fel**.
- Använd **Villkor** för att filtrera på allvarlighetsgrad innan något skickas.
- För att nå flera personer kopplar du flera SMSEagle-komponenter, en per nummer.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index): mönstret för utgående integrationer.
- [Komponenter → SMSEagle](/docs/workflows/components#smseagle): referensen för komponenten.
