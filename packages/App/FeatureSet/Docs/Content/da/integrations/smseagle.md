# SMSEagle-integration

Send advarsler som SMS eller opkald gennem [SMSEagle](https://www.smseagle.eu), en hardware-SMS-gateway, der står lokalt i dit eget netværk. OneUptime har indbyggede **SMSEagle**-workflowkomponenter, så opsætningen går hurtigt.

Denne integration er **udgående**: OneUptime sender beskeder gennem [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime-advarsel → On Create  ──►  SMSEagle-komponent  ──►  SMS eller opkald til en telefon
```

## Trin 1: Opret en API-nøgle

1. Gå i SMSEagles web-GUI til **Settings → API → API v2**, og klik på **Create API key**.
2. Tillad **Send SMS** under **Permissions**, og **Make a TTS Advanced Call**, hvis du vil have opkald.
3. Kopiér nøglen. OneUptime kalder den **SMSEagle Access Token**.

## Trin 2: Lad OneUptime nå enheden

1. Tillad forbindelsen fra din OneUptime-server til enhedens adresse, for eksempel `https://192.168.0.100`, i firewalls og VPN'er mellem de to.
2. En SMSEagle-enhed har som regel en privat adresse, og den blokerer workflows som standard. På en selvhostet instans skal du tilføje enhedens IP-adresse eller værtsnavn til `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` på API-serveren, for eksempel `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, og genstarte den. Se [Adgang til private netværk](/docs/self-hosted/private-network-access).

## Trin 3: Gem hemmelighederne

1. Gå i OneUptime til **Arbejdsgange → Globale variabler → Opret**.
2. Opret `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (hemmelig) og `ONCALL_PHONE`.

## Trin 4: Byg workflowet

1. Åbn **Arbejdsgange → Opret arbejdsgang**, kald den `Alerts → SMSEagle`, og åbn **Bygger**.
2. Tilføj en **Alert**-udløser sat til **On Create**. Omdøb den til `Alert`.
3. Tilføj en **Send SMS via SMSEagle**-komponent forbundet til udløseren:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Klik på **Gem**, slå workflowet til, og opret en testadvarsel. SMS'en kommer frem på telefonen.

Skabelonen **Text a phone via SMSEagle when an alert fires** bygger det samme workflow.

## Opkald i stedet for SMS

Brug **Make a Call via SMSEagle** i stedet. Den har de samme indstillinger plus et **Voice ID**, tekst-til-tale-stemmen på enheden, og læser **Text to Read Out** op. API-nøglen skal have tilladelsen **Make a TTS Advanced Call**.

Skabelonen **Call a phone via SMSEagle when an alert fires** bygger det samme workflow med et opkald.

## Alternativ: API-komponenten

En **API**-blok virker også:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tips

- Hvis enheden afviser beskeden, står årsagen i komponentens **Error**-værdi. Log den på **Fejl**-udgangen.
- Brug **Betingelser** til at filtrere på alvorlighed, før der sendes.
- For at nå flere personer skal du forbinde flere SMSEagle-komponenter, én pr. nummer.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index): mønsteret for udgående integrationer.
- [Komponenter → SMSEagle](/docs/workflows/components#smseagle): referencen for komponenten.
