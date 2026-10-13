# SMSEagle-integratie

Stuur meldingen van waarschuwingen als sms of telefoongesprek via [SMSEagle](https://www.smseagle.eu), een hardware-sms-gateway die op locatie in je eigen netwerk staat. OneUptime heeft ingebouwde **SMSEagle**-workflowcomponenten, dus het instellen gaat snel.

Deze integratie is **uitgaand**: OneUptime verstuurt berichten via de [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime-waarschuwing → On Create  ──►  SMSEagle-component  ──►  sms of oproep naar een telefoon
```

## Stap 1: Maak een API-sleutel

1. Ga in de web-GUI van SMSEagle naar **Settings → API → API v2** en klik op **Create API key**.
2. Sta onder **Permissions** **Send SMS** toe en, als je oproepen wilt, **Make a TTS Advanced Call**.
3. Kopieer de sleutel. OneUptime noemt hem **SMSEagle Access Token**.

## Stap 2: Laat OneUptime het apparaat bereiken

1. Sta de verbinding van je OneUptime-server naar het adres van het apparaat toe, bijvoorbeeld `https://192.168.0.100`, in de firewalls en VPN's daartussen.
2. Een SMSEagle-apparaat heeft meestal een privéadres, en workflows blokkeren dat standaard. Voeg op een zelf gehoste instantie het IP-adres of de hostnaam van het apparaat toe aan `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` op de API-server, bijvoorbeeld `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, en herstart hem. Zie [Toegang tot privénetwerken](/docs/self-hosted/private-network-access).

## Stap 3: Sla de geheimen op

1. Ga in OneUptime naar **Workflows → Globale variabelen → Aanmaken**.
2. Maak `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (geheim) en `ONCALL_PHONE` aan.

## Stap 4: Bouw de workflow

1. Open **Workflows → Workflow maken**, noem hem `Alerts → SMSEagle` en open de **Bouwer**.
2. Voeg een **Alert**-trigger toe, ingesteld op **On Create**. Hernoem hem naar `Alert`.
3. Voeg een **Send SMS via SMSEagle**-component toe, verbonden met de trigger:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Klik op **Opslaan**, zet de workflow aan en maak een testwaarschuwing. De sms komt aan op de telefoon.

De sjabloon **Text a phone via SMSEagle when an alert fires** bouwt dezelfde workflow.

## Oproepen in plaats van sms

Gebruik in plaats daarvan **Make a Call via SMSEagle**. Die heeft dezelfde instellingen plus een **Voice ID**, de tekst-naar-spraakstem op het apparaat, en leest de **Text to Read Out** voor. De API-sleutel heeft de machtiging **Make a TTS Advanced Call** nodig.

De sjabloon **Call a phone via SMSEagle when an alert fires** bouwt dezelfde workflow met een oproep.

## Alternatief: de API-component

Een **API**-blok werkt ook:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tips

- Weigert het apparaat het bericht, dan staat de reden in de **Error**-waarde van de component. Log die op de uitgang **Fout**.
- Gebruik **Voorwaarden** om vóór het versturen op ernst te filteren.
- Om meerdere mensen te bereiken, verbind je meerdere SMSEagle-componenten, één per nummer.

## Verder lezen

- [Integraties – Overzicht](/docs/integrations/index): het uitgaande patroon.
- [Componenten → SMSEagle](/docs/workflows/components#smseagle): de referentie van de component.
