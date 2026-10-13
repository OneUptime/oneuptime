# SMSEagle-integrasjon

Send varsler som SMS eller telefonsamtale gjennom [SMSEagle](https://www.smseagle.eu), en maskinvare-SMS-gateway som står lokalt i ditt eget nettverk. OneUptime har innebygde **SMSEagle**-arbeidsflytkomponenter, så oppsettet går raskt.

Denne integrasjonen er **utgående**: OneUptime sender meldinger gjennom [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime-varsel → On Create  ──►  SMSEagle-komponent  ──►  SMS eller anrop til en telefon
```

## Trinn 1: Opprett en API-nøkkel

1. Gå til **Settings → API → API v2** i SMSEagles web-GUI, og klikk på **Create API key**.
2. Under **Permissions** tillater du **Send SMS** og, hvis du vil ha anrop, **Make a TTS Advanced Call**.
3. Kopier nøkkelen. OneUptime kaller den **SMSEagle Access Token**.

## Trinn 2: La OneUptime nå enheten

1. Tillat tilkoblingen fra OneUptime-serveren din til enhetens adresse, for eksempel `https://192.168.0.100`, i brannmurer og VPN-er mellom de to.
2. En SMSEagle-enhet har vanligvis en privat adresse, og den blokkerer arbeidsflyter som standard. På en selvhostet instans legger du enhetens IP-adresse eller vertsnavn til i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` på API-serveren, for eksempel `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, og starter den på nytt. Se [Tilgang til private nettverk](/docs/self-hosted/private-network-access).

## Trinn 3: Lagre hemmelighetene

1. Gå til **Arbeidsflyter → Globale variabler → Opprett** i OneUptime.
2. Opprett `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (hemmelig) og `ONCALL_PHONE`.

## Trinn 4: Bygg arbeidsflyten

1. Åpne **Arbeidsflyter → Opprett arbeidsflyt**, kall den `Alerts → SMSEagle`, og åpne **Bygger**.
2. Legg til en **Alert**-utløser satt til **On Create**. Gi den nytt navn, `Alert`.
3. Legg til en **Send SMS via SMSEagle**-komponent koblet til utløseren:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Klikk på **Lagre**, slå på arbeidsflyten, og opprett et testvarsel. SMS-en kommer fram på telefonen.

Malen **Text a phone via SMSEagle when an alert fires** bygger den samme arbeidsflyten.

## Anrop i stedet for SMS

Bruk **Make a Call via SMSEagle** i stedet. Den har de samme innstillingene pluss en **Voice ID**, tekst-til-tale-stemmen på enheten, og leser opp **Text to Read Out**. API-nøkkelen trenger tillatelsen **Make a TTS Advanced Call**.

Malen **Call a phone via SMSEagle when an alert fires** bygger den samme arbeidsflyten med et anrop.

## Alternativ: API-komponenten

En **API**-blokk fungerer også:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tips

- Hvis enheten avviser meldingen, står årsaken i komponentens **Error**-verdi. Logg den på **Feil**-utgangen.
- Bruk **Betingelser** for å filtrere på alvorlighetsgrad før sending.
- For å nå flere personer kobler du flere SMSEagle-komponenter, én per nummer.

## Les videre

- [Oversikt over integrasjoner](/docs/integrations/index): mønsteret for utgående integrasjoner.
- [Komponenter → SMSEagle](/docs/workflows/components#smseagle): referansen for komponenten.
