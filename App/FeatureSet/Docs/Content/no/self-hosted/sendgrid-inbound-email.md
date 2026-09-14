# SendGrid innkommende e-postintegrasjon

OneUptime sin **innkommende e-postmonitor** lar deg opprette og løse varsler basert på e-poster sendt til unike monitor-spesifikke e-postadresser. Dette er nyttig for integrering med eldre systemer, varslingsverktøy eller enhver tjeneste som kan sende e-poster.

Denne guiden forklarer hvordan du setter opp SendGrid Inbound Parse for å videresende innkommende e-poster til den selvhostede OneUptime-instansen din.

## Forutsetninger

- En SendGrid-konto med tilgang til Inbound Parse
- Et domene du kontrollerer med tilgang til DNS-innstillinger
- Et offentlig HTTPS-endepunkt som videresender SendGrid-webhooks til OneUptime

## Nettverkstilgang

Inbound Parse krever at SendGrid oppretter en forbindelse til OneUptime. Bare utgående internettilgang er ikke tilstrekkelig.

| Retning | Destinasjon | Protokoll / port | Formål |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Levere analyserte e-poster som multipart POST. |
| Avsendende e-postservere → SendGrid | `mx.sendgrid.net`, via mottakerdomenets offentlige MX-post | SMTP / TCP 25 | Motta e-post hos SendGrid, ikke på OneUptime. |
| OneUptime → SendGrid, bare ved separat konfigurert e-postsending | `api.sendgrid.com` | HTTPS / TCP 443 | Sende varsler med Mail Send API. |

Publiser DNS for webhookens vertsnavn og bruk et offentlig betrodd sertifikat. En privat installasjon kan eksponere bare webhook-stien gjennom en offentlig omvendt proxy eller gateway som når OneUptime internt. Bevar sti, hemmelighet, innholdstype og multipart-innhold, og tillat POST uten interaktiv innlogging eller nettleserkontroll. OneUptime trenger ingen innkommende SMTP-tjeneste. Se [SendGrid-oppsett](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook).

Sett `INBOUND_EMAIL_WEBHOOK_SECRET` til en sterk tilfeldig verdi og erstatt `YOUR_SECRET` med den. Det siste stisegmentet er obligatorisk. OneUptime sammenligner det med den konfigurerte hemmeligheten; en tom variabel deaktiverer kontrollen. Hold hele URL-en og monitorenes e-postadresser private, også i proxylogger. OneUptime validerer foreløpig ikke signerte Inbound Parse-headere eller SendGrid OAuth-tokener. Om dette kreves, må en gateway validere før videresending etter [SendGrids sikkerhetsdokumentasjon](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

SendGrid tilbyr ingen pålitelig statisk liste over Inbound Parse-kilde-IP-er. E-postsendings-IP-er og DNS-svar for `mx.sendgrid.net` er ikke en tillatelsesliste for webhooks. Følg [SendGrids brannmurveiledning](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs).

Inbound Parse er atskilt fra e-postsending. Mottak krever ingen SendGrid-API-kall fra OneUptime. For varsling via SendGrid må DNS og utgående HTTPS til `api.sendgrid.com` tillates; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) krever ingen innkommende callback for innsending. Bruker du SMTP, tillat serveren og porten konfigurert i OneUptime.

Kontroller offentlig MX, send e-post til en testmonitor og bekreft webhook-mottak samt opprettelse eller løsning av varselet. En tom POST eller en utgående sendingstest validerer ikke Inbound Parse.

## Slik fungerer det

1. Du oppretter en **innkommende e-postmonitor** i OneUptime
2. OneUptime genererer en unik e-postadresse for den monitoren (f.eks. `monitor-abc123@inbound.yourdomain.com`)
3. Når en e-post sendes til den adressen, mottar SendGrid den og videresender den til OneUptime via webhook
4. OneUptime evaluerer e-posten mot dine konfigurerte kriterier for å opprette eller løse varsler

## Installasjonsinstruksjoner

### Trinn 1: Velg innkommende e-postdomene

Du trenger et underdomene dedikert til å motta innkommende e-poster. Vi anbefaler å bruke et underdomene som:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

Dette underdomenet vil brukes eksklusivt for OneUptime-monitor-e-poster.

### Trinn 2: Konfigurer DNS MX-post

Legg til en MX-post i DNS-konfigurasjonen din for å rute e-poster for innkommende underdomene til SendGrid.

| Type | Vert/Navn | Prioritet | Verdi           |
| ---- | --------- | --------- | --------------- |
| MX   | inbound   | 10        | mx.sendgrid.net |

**Eksempel:** Hvis domenet ditt er `example.com` og du bruker `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Merk:** DNS-endringer kan ta opptil 48 timer å propagere, men fullfører vanligvis innen noen timer.

### Trinn 3: Autentiser domenet i SendGrid

Mottakerdomenet må tilhøre et av dine [autentiserte domener i SendGrid](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse):

1. Logg inn på [SendGrid-dashbordet](https://app.sendgrid.com)
2. Gå til **Settings** > **Sender Authentication**
3. Klikk **Authenticate Your Domain**
4. Følg instruksjonene for å legge til de nødvendige DNS-postene (CNAME-poster for DKIM)

### Trinn 4: Konfigurer SendGrid Inbound Parse

1. Logg inn på [SendGrid-dashbordet](https://app.sendgrid.com)
2. Naviger til **Settings** > **Inbound Parse**
3. Klikk **Add Host & URL**
4. Konfigurer følgende:

| Felt                                | Verdi                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**                | Innkommende underdomenet ditt (f.eks. `inbound.yourdomain.com`)         |
| **Destination URL**                 | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam**  | Valgfritt – aktiver hvis ønskelig                                       |
| **Send raw, full MIME message**     | La stå avkrysset (ikke nødvendig)                                       |
| **POST the raw, full MIME message** | La stå avkrysset (ikke nødvendig)                                       |

5. Klikk **Add**

### Trinn 5: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Legg til disse miljøvariablene i `config.env`-filen din:

```bash
# Konfigurasjon for innkommende e-post
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes med Helm

Legg til disse i `values.yaml`-filen din:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

Bruk samme hemmelighet i destinasjons-URL-en fra trinn 4, og start OneUptime på nytt etter endringen.

### Trinn 6: Opprett en innkommende e-postmonitor

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Overvåkere** > **Opprett monitor**
3. Velg **Incoming Email** som monitortype
4. Konfigurer monitoren:
   - **Navn:** Gi monitoren et beskrivende navn
   - **Beskrivelse:** Beskriv hva monitoren er til for
5. Konfigurer **Alert Creation Criteria** (når du skal opprette et varsel):
   - Eksempel: E-postemne inneholder "ALERT" eller "CRITICAL"
6. Konfigurer **Alert Resolution Criteria** (når du skal løse et varsel):
   - Eksempel: E-postemne inneholder "RESOLVED" eller "OK"
7. Klikk **Opprett**

Etter opprettelse vil du se den unike e-postadressen for denne monitoren (f.eks. `monitor-abc123def456@inbound.yourdomain.com`).

### Trinn 7: Test integrasjonen

1. Kopier monitorens e-postadresse fra OneUptime-dashbordet
2. Send en test-e-post til den adressen med et emne som samsvarer med varselkriteriene
3. Sjekk OneUptime-dashbordet for å verifisere:
   - E-posten ble mottatt (synlig i Monitor Summary)
   - Et varsel ble opprettet (hvis kriterier matchet)

## Referanse for miljøvariabler

| Variabel                       | Beskrivelse                                                                                                                                         | Påkrevd | Standard |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- |
| `INBOUND_EMAIL_PROVIDER`       | Innkommende e-postleverandøren som skal brukes                                                                                                      | Ja      | -        |
| `INBOUND_EMAIL_DOMAIN`         | Underdomenet konfigurert for innkommende e-poster                                                                                                   | Ja      | -        |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Sammenlignes med siste segment i `/incoming-email/sendgrid/YOUR_SECRET`. Konfigurer for offentlige endepunkter; tom verdi deaktiverer kontrollen. | Anbefalt | - |

## Støttede e-postkriterier

Når du konfigurerer innkommende e-postmonitoren, kan du opprette kriterier basert på:

| Felt               | Beskrivelse                        | Tilgjengelige filtre                                                                       |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **E-postemne**     | Emnelinjen i e-posten              | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **E-post fra**     | Avsenderens e-postadresse          | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Body**     | Den rene tekstkroppen i e-posten   | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email To**       | Mottakerens e-postadresse          | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Received** | Tid siden siste e-post ble mottatt | Received In Minutes, Not Received In Minutes                                               |

## Eksempler på brukstilfeller

### Varsler fra eldre systemer

Mange eldre systemer kan bare sende e-postvarsler. Opprett en innkommende e-postmonitor for å:

- Opprette OneUptime-varsler når det eldre systemet sender `[CRITICAL]`-e-poster
- Løse varsler når `[RESOLVED]`-e-poster mottas

### Tredjeparts tjeneste-integrasjon

Integrer med tjenester som sender e-postvarsler:

- Overvåkingsverktøy som ikke har API-integrasjoner
- Varsler fra skyleverandører
- Sikkerhetsscanneverktøy

### Hjerteslag via e-post

Bruk "Email Received"-kriterier for å sikre at du mottar periodiske e-poster:

- Opprett varsel hvis ingen e-post mottas på 60 minutter
- Nyttig for overvåking av batchjobber eller planlagte oppgaver som sender fullføringse-poster

## Feilsøking

### E-poster mottas ikke

1. **Sjekk DNS-propagering:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Skal returnere `mx.sendgrid.net`

2. **Verifiser SendGrid Inbound Parse-innstillinger:**

   - Logg inn på SendGrid-dashbordet
   - Gå til Settings > Inbound Parse
   - Verifiser at domene og webhook-URL er korrekte

3. **Sjekk OneUptime-logger:**
   - Se etter innkommende e-post-webhooks i OneUptimes applikasjonslogger (Telemetry / ProbeIngest).
   - Sjekk for eventuelle feilmeldinger

### Webhooks feiler

- Hele HTTPS-URL-en inkludert hemmeligheten må være tilgjengelig fra internett. Uten siste segment samsvarer den ikke med ruten.
- Tillat POST uten innloggingsomdirigering eller nettleserkontroll. SendGrids IP-adresser for e-postsending er ikke en liste over webhook-kilder.
- Bruk et offentlig betrodd sertifikat med full sertifikatkjede. Kontroller levering som beskrevet under Nettverkstilgang.

### Monitor oppretter ikke varsler

1. **Verifiser kriterie-konfigurasjon:**

   - Sjekk at varselopprettelseskriteriene samsvarer med e-postinnholdet
   - Test med nøyaktige strenger først før du bruker mønstermatching

2. **Sjekk monitorstatus:**

   - Sørg for at monitoren ikke er deaktivert
   - Verifiser at monitortypen er "Incoming Email"

3. **Se gjennom Monitor Summary:**
   - Sjekk om e-posten ble mottatt og behandlet
   - Se gjennom evalueringsloggene for detaljer om kriteriematching

### SendGrid webhook-leveringslogger

For å sjekke om SendGrid sender webhooks vellykket:

1. Dessverre tilbyr ikke SendGrid detaljerte logger for Inbound Parse
2. Sjekk OneUptime-serverloggene for innkommende webhook-forespørsler
3. Bruk et verktøy som [RequestBin](https://requestbin.com) for midlertidig testing av webhook-levering

## Beste sikkerhetspraksis

1. **Bruk HTTPS:** Bruk alltid HTTPS for webhook-endepunktet
2. **Webhook-hemmelighet:** Konfigurer `INBOUND_EMAIL_WEBHOOK_SECRET` og inkluder det i webhook-URL-en (f.eks. `/incoming-email/sendgrid/your-secret`) for ekstra validering
3. **Domeneverifisering:** Verifiser domenet i SendGrid for bedre e-postsikkerhet
4. **Begrens tilgang:** Opprett bare monitorer for pålitelige e-postkilder
5. **Overvåk logger:** Se regelmessig gjennom innkommende e-postlogger for mistenkelig aktivitet

## Alternative leverandører

OneUptime er designet for å støtte flere innkommende e-postleverandører. For øyeblikket støttes:

| Leverandør          | Status   |
| ------------------- | -------- |
| SendGrid            | Støttet  |
| Haraka (selvhostet) | Planlagt |

Hvis du trenger støtte for en annen leverandør, vennligst kontakt oss eller send inn en funksjonsforespørsel.

## Støtte

Hvis du støter på problemer med SendGrid innkommende e-postintegrasjonen:

1. Sjekk feilsøkingsseksjonen ovenfor
2. Se gjennom OneUptime-loggene for detaljerte feilmeldinger
3. Kontakt oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi setter pris på tilbakemeldinger for å forbedre denne integrasjonen!
