# Selv-hosting-veiledning

Følg denne siden fra topp til bunn for å gå fra en tom server til din egen OneUptime, som kjører over HTTPS, har sendt deg en test-e-post og kan varsle deg. Hvert trinn slutter med hvordan du ser at det virket, og viser til de lengre sidene for detaljene.

:::cards
- [Installer OneUptime](#installer-oneuptime): Docker Compose på én server, eller Helm-chartet på Kubernetes.
- [Gjør ferdig oppsettet av serveren](#gjør-ferdig-oppsettet-av-serveren): E-post, deretter SMS og anrop, hver med en test.
- [Sjekk installasjonen din](#sjekk-installasjonen-din): Én kommando som sier hva som er galt.
- [Hurtigstart](/docs/introduction/quickstart): Din første monitor, din første vaktpolicy og din første statusside.
:::

## Dette trenger du

- **En server.** For Docker Compose en Linux-server med 8 GB minne, 4 kjerner og 20 GB disk for å prøve OneUptime, eller 16 GB, 8 kjerner og 400 GB for et team: se [Dimensjonering og kapasitetsplanlegging](/docs/installation/sizing). For Helm-chartet en Kubernetes-klynge.
- **Et domenenavn** folk skal bruke for å åpne OneUptime, som `oneuptime.example.com`, med en DNS-`A`-post som peker på serveren. Du kan begynne med serverens IP-adresse, men et sertifikat fra Let's Encrypt krever et domenenavn.
- **Portene 80 og 443**, som kan nås fra internett, for HTTPS.
- **En måte å sende e-post på**: en e-postserver, som bedriftens, Microsoft 365 eller Google Workspace, eller en konto hos Amazon SES, SendGrid, Mailgun, Postmark eller Resend.
- **En Twilio-konto**, for å bli varslet med SMS og telefonanrop. E-post og push-varsler trenger ingen.

**Det virket når** `dig +short oneuptime.example.com` skriver ut serverens IP-adresse.

## Installer OneUptime

:::tabs
@tab Docker Compose
På en ny Ubuntu-, Debian- eller RHEL-basert server installerer én kommando Docker, Git og Node.js der de mangler, kloner OneUptime til en mappe `oneuptime`, spør etter adressen folk skal bruke, og starter det:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

For å gjøre det samme for hånd, med Docker, Git og Node.js installert:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Åpne `config.env` og sett `HOST`, den første innstillingen der, til domenenavnet eller IP-adressen din, uten `http://`. Det er den eneste innstillingen du må endre: e-post, SMS og anrop settes opp i Admin Dashboard, og alt under `ADVANCED` virker som det er. Start deretter OneUptime:

```bash
npm start
```

**Det virket når** `npm start` slutter med **OneUptime is up!** og adressen som skal åpnes. Den første starten tar flere minutter, mens Docker laster ned imagene. Hvis `npm start` stopper før det, sier den hva som må endres. [Docker Compose](/docs/installation/docker-compose) har alle detaljene.
@tab Kubernetes
Lag en `values.yaml` med domenenavnet eller IP-adressen din, uten `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Chartet lagrer dataene sine på klyngens standard storage class. Hvis `kubectl get storageclass` ikke merker noen som `(default)`, legger du til `global.storageClass` med navnet på en av dem. Installer deretter chartet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det virket når** `kubectl get pods` viser hver pod som `Running` og adressen `helm install` skrev ut, åpner OneUptime. [Chartets installasjonsveiledning](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) har alle detaljene.
:::

## Slå på HTTPS

Når domenenavnet ditt peker på serveren, lar du OneUptime hente et gratis sertifikat fra Let's Encrypt. Det fornyer sertifikatet selv.

:::tabs
@tab Docker Compose
Sett disse verdiene i `config.env`, og kjør deretter `npm start` igjen:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Kjører du allerede en reverse proxy, som Caddy, Nginx eller en lastbalanserer? Behold `PROVISION_SSL=false`, sett `HTTP_PROTOCOL=https` og `TRUSTED_PROXY_HOPS=2`, og se [Bruk din egen reverse proxy](/docs/installation/docker-compose#bruk-din-egen-reverse-proxy).
@tab Kubernetes
Sett disse verdiene i `values.yaml`, og bruk dem deretter:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

For å avslutte TLS i en egen ingress controller i stedet, lar du `ssl.provision` være av og setter bare `httpProtocol: https`.
:::

**Det virket når** `https://oneuptime.example.com` åpner uten sertifikatadvarsel. Det første sertifikatet kommer som regel i løpet av noen minutter. Prøver du OneUptime på `localhost`? Hopp over dette trinnet: et sertifikat krever et domenenavn.

## Opprett administratorkontoen

Åpne adressen din, som `https://oneuptime.example.com`, og registrer deg. Den første kontoen på en ny server blir hovedadministratoren, som kan åpne Admin Dashboard på `/admin`.

**Det virket når** `/admin` åpner Admin Dashboard. Så lenge e-post, HTTPS eller valget om registrering fortsatt står åpent, åpner det på **Gjør ferdig oppsettet av denne serveren**.

## Gjør ferdig oppsettet av serveren

Siden **Serveroppsett** i Admin Dashboard, på `/admin/setup`, viser hva en ny server trenger, det viktigste først. E-post, HTTPS og hvem som kan registrere seg, er påkrevd. SMS og anrop, en global probe, sikkerhetskopier og oppdateringssjekker anbefales. Hvert punkt har en knapp som åpner stedet der det stilles inn, og `npm start` slutter med å skrive ut adressen til denne siden.

:::steps
### Sett opp e-post

Klikk på **Sett opp e-post**. Den åpner **Innstillinger > Varsler > E-poster**, der du fyller inn e-postserveren din (de fleste bruker port `587`) eller e-postleverandøren din, og adressen e-postene kommer fra. Lagre, klikk deretter på **Send test-e-post** og send en til deg selv.

**Det virket når** e-posten kommer frem og sjekklisten merker E-post som ferdig. Når testen mislykkes, viser den hva e-postserveren svarte: se [SMTP](/docs/emails/smtp#feilsøking).

### Velg hvem som kan registrere seg

Alle som kan åpne adressen din, kan registrere seg. Når teamet ditt har kontoene sine, slår du av **Tillat registrering** under **Innstillinger > Autentisering**: folk du inviterer til et prosjekt, kan fortsatt bli med. For å la registreringen være åpen klikker du på **La registrering være åpen**.

**Det virket når** sjekklisten merker Registrering som ferdig.

### Sett opp SMS og anrop, eller bruk bare e-post og push

For å bli varslet med SMS og telefonanrop klikker du på **Sett opp SMS og anrop** og legger til Twilio-kontoen din under **Innstillinger > Varsler > Anrop og SMS**: [Twilio-integrasjon](/docs/self-hosted/twilio-integration) viser hvor du finner hver verdi. Klikk deretter på **Send test-SMS** og **Ring testsamtale**. For å sende dem gjennom en egen gateway i stedet, se [SMS- og anropsgateway](/docs/self-hosted/sms-and-call-gateway). Hvis e-post og push-varsler er nok, klikker du på **Bruk bare e-post og push**.

**Det virket når** SMS-en kommer frem og telefonen ringer, eller sjekklisten viser valget ditt.
:::

HTTPS-punktet er ferdig så snart [Slå på HTTPS](#slå-på-https) virker, og hvert anbefalte punkt sier hva du skal gjøre.

## Sjekk installasjonen din

:::tabs
@tab Docker Compose
Kjør doctor i mappen `oneuptime`:

```bash
npm run doctor
```

Den sjekker hver container, `config.env`, at `HOST` når denne serveren, sertifikatet og ledig diskplass, og spør OneUptime hva det ser av seg selv, som e-post og prober. Hvert problem kommer med løsningen: se [Sjekk installasjonen din](/docs/installation/docker-compose#sjekk-installasjonen-din).
@tab Kubernetes
Kjør chartets diagnoseskript mot klyngen din, slik [chartets feilsøkingsveiledning](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) viser. Det bare leser, og slutter med et sammendrag av det det fant, det verste først.
:::

**Det virket når** doctor slutter med **Everything looks right.** og avslutter med `0`. Den avslutter med `1` når noe må rettes, og med `2` når den ikke kunne kjøre sjekkene sine. På Kubernetes har sammendraget ingen funn `CRITICAL`.

## Overvåk noe og bli varslet

Serveren din kan nå sende e-post og varsle folk. [Hurtigstart](/docs/introduction/quickstart) fortsetter i produktet: en monitor for nettstedet ditt, en vaktpolicy som varsler deg når det går ned, og en statusside, på omtrent et kvarter. Den siste delen erklærer en testhendelse, så du ser varselet komme frem.

## Feilsøking

:::details npm start stopper og sier at HOST ikke er en adresse ennå
`HOST` i `config.env` inneholder fortsatt en plassholder, som `<your-address>`. Sett den til domenenavnet eller IP-adressen din, uten `http://`, og kjør `npm start` igjen.
:::

:::details Test-e-posten mislykkes
Meldingen under knappen er det e-postserveren svarte. Sjekk vertsnavnet, porten, brukernavnet og passordet, og at e-postserveren lar deg sende fra adressen e-postene kommer fra. Se [SMTP](/docs/emails/smtp#feilsøking).
:::

:::details Nettleseren advarer om sertifikatet
Let's Encrypt trenger portene 80 og 443, som kan nås fra internett, og domenenavnet ditt pekende på denne serveren. Vent noen minutter, og kjør deretter `npm run doctor`: den sjekker sertifikatet og sier hva som er galt.
:::

## Neste trinn

:::cards
- [Hurtigstart](/docs/introduction/quickstart): En monitor, en vaktpolicy og en statusside på et kvarter.
- [Docker Compose](/docs/installation/docker-compose): Din egen proxy, sikkerhetskopier, oppdateringer og sjekklisten for produksjon.
- [Oppgradering](/docs/installation/upgrading): Gå over til en ny utgivelse, én hovedversjon om gangen.
- [Arkitektur](/docs/self-hosted/architecture): Hvordan delene av OneUptime henger sammen.
:::
