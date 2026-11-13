# Selv-hosting-guide

Følg denne side fra top til bund for at komme fra en tom server til din egen OneUptime, der kører over HTTPS, har sendt dig en test-e-mail og kan sende dig alarmer. Hvert trin slutter med, hvordan du ser, at det virkede, og henviser til de længere sider for detaljerne.

:::cards
- [Installér OneUptime](#installér-oneuptime): Docker Compose på én server eller Helm-chartet på Kubernetes.
- [Gør opsætningen af serveren færdig](#gør-opsætningen-af-serveren-færdig): E-mail, derefter sms og opkald, hver med en test.
- [Tjek din installation](#tjek-din-installation): Én kommando, der siger, hvad der er galt.
- [Hurtigstart](/docs/introduction/quickstart): Din første monitor, din første vagtpolitik og din første statusside.
:::

## Det skal du bruge

- **En server.** Til Docker Compose en Linux-server med 8 GB hukommelse, 4 kerner og 20 GB disk for at prøve OneUptime, eller 16 GB, 8 kerner og 400 GB til et team: se [Dimensionering og kapacitetsplanlægning](/docs/installation/sizing). Til Helm-chartet en Kubernetes-klynge.
- **Et domænenavn**, folk skal bruge for at åbne OneUptime, som `oneuptime.example.com`, med en DNS-`A`-post, der peger på serveren. Du kan starte med serverens IP-adresse, men et certifikat fra Let's Encrypt kræver et domænenavn.
- **Portene 80 og 443**, som kan nås fra internettet, til HTTPS.
- **En måde at sende e-mail på**: en mailserver, som din virksomheds, Microsoft 365 eller Google Workspace, eller en konto hos Amazon SES, SendGrid, Mailgun, Postmark eller Resend.
- **En Twilio-konto**, for at få alarmer via sms og telefonopkald. E-mail og push-notifikationer kræver ingen.

**Det virkede, når** `dig +short oneuptime.example.com` udskriver serverens IP-adresse.

## Installér OneUptime

:::tabs
@tab Docker Compose
På en ny Ubuntu-, Debian- eller RHEL-baseret server installerer én kommando Docker, Git og Node.js, hvor de mangler, kloner OneUptime til en mappe `oneuptime`, spørger efter den adresse, folk skal bruge, og starter det:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

For at gøre det samme i hånden, med Docker, Git og Node.js installeret:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Åbn `config.env`, og sæt `HOST`, dens første indstilling, til dit domænenavn eller din IP-adresse, uden `http://`. Det er den eneste indstilling, du skal ændre: e-mail, sms og opkald sættes op i Admin Dashboard, og alt under `ADVANCED` virker, som det er. Start derefter OneUptime:

```bash
npm start
```

**Det virkede, når** `npm start` slutter med **OneUptime is up!** og adressen, der skal åbnes. Den første start tager flere minutter, mens Docker henter images. Hvis `npm start` stopper før, siger den, hvad der skal ændres. [Docker Compose](/docs/installation/docker-compose) har alle detaljer.
@tab Kubernetes
Opret en `values.yaml` med dit domænenavn eller din IP-adresse, uden `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Chartet gemmer sine data på klyngens standard-storage class. Hvis `kubectl get storageclass` ikke markerer nogen som `(default)`, så tilføj `global.storageClass` med navnet på en af dem. Installér derefter chartet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det virkede, når** `kubectl get pods` viser hver pod som `Running`, og adressen, som `helm install` udskrev, åbner OneUptime. [Chartets installationsvejledning](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) har alle detaljer.
:::

## Slå HTTPS til

Når dit domænenavn peger på serveren, så lad OneUptime hente et gratis certifikat fra Let's Encrypt. Det fornyer selv certifikatet.

:::tabs
@tab Docker Compose
Sæt disse værdier i `config.env`, og kør derefter `npm start` igen:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Kører du allerede en reverse proxy, som Caddy, Nginx eller en load balancer? Behold `PROVISION_SSL=false`, sæt `HTTP_PROTOCOL=https` og `TRUSTED_PROXY_HOPS=2`, og se [Brug din egen reverse proxy](/docs/installation/docker-compose#brug-din-egen-reverse-proxy).
@tab Kubernetes
Sæt disse værdier i `values.yaml`, og anvend dem derefter:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

For i stedet at afslutte TLS i din egen ingress controller skal du lade `ssl.provision` være slået fra og kun sætte `httpProtocol: https`.
:::

**Det virkede, når** `https://oneuptime.example.com` åbner uden certifikatadvarsel. Det første certifikat kommer som regel inden for få minutter. Prøver du OneUptime på `localhost`? Spring dette trin over: et certifikat kræver et domænenavn.

## Opret administratorkontoen

Åbn din adresse, som `https://oneuptime.example.com`, og tilmeld dig. Den første konto på en ny server bliver dens masteradministrator, som kan åbne Admin Dashboard på `/admin`.

**Det virkede, når** `/admin` åbner Admin Dashboard. Så længe e-mail, HTTPS eller valget om tilmelding stadig står åbent, åbner det på **Gør opsætningen af denne server færdig**.

## Gør opsætningen af serveren færdig

Siden **Serveropsætning** i Admin Dashboard, på `/admin/setup`, viser, hvad en ny server har brug for, det vigtigste først. E-mail, HTTPS og hvem der kan tilmelde sig, er påkrævet. Sms og opkald, en global probe, backup og opdateringstjek anbefales. Hvert punkt har en knap, der åbner stedet, hvor det indstilles, og `npm start` slutter med at udskrive sidens adresse.

:::steps
### Opsæt e-mail

Klik på **Opsæt e-mail**. Det åbner **Indstillinger > Notifikationer > E-mails**, hvor du angiver din mailserver (de fleste bruger port `587`) eller din e-mailudbyder og adressen, e-mails kommer fra. Gem, klik derefter på **Send test-e-mail**, og send en til dig selv.

**Det virkede, når** e-mailen kommer frem, og tjeklisten markerer E-mail som færdig. Når testen fejler, viser den, hvad mailserveren svarede: se [SMTP](/docs/emails/smtp#fejlfinding).

### Vælg, hvem der kan tilmelde sig

Alle, der kan åbne din adresse, kan tilmelde sig. Når dit team har sine konti, så slå **Tillad tilmelding** fra under **Indstillinger > Godkendelse**: folk, du inviterer til et projekt, kan stadig komme med. Klik på **Hold tilmelding åben** for at lade tilmeldingen stå åben.

**Det virkede, når** tjeklisten markerer Tilmelding som færdig.

### Opsæt sms og opkald, eller brug kun e-mail og push

For at få alarmer via sms og telefonopkald skal du klikke på **Opsæt sms og opkald** og tilføje din Twilio-konto under **Indstillinger > Notifikationer > Opkald og SMS**: [Twilio-integration](/docs/self-hosted/twilio-integration) viser, hvor du finder hver værdi. Klik derefter på **Send test-sms** og **Foretag testopkald**. For i stedet at sende dem gennem din egen gateway, se [SMS- og opkaldsgateway](/docs/self-hosted/sms-and-call-gateway). Hvis e-mail og push-notifikationer er nok, så klik på **Brug kun e-mail og push**.

**Det virkede, når** sms'en kommer frem, og din telefon ringer, eller tjeklisten viser dit valg.
:::

HTTPS-punktet er færdigt, så snart [Slå HTTPS til](#slå-https-til) virker, og hvert anbefalet punkt siger, hvad du skal gøre.

## Tjek din installation

:::tabs
@tab Docker Compose
Kør doctor i mappen `oneuptime`:

```bash
npm run doctor
```

Den tjekker hver container, `config.env`, at `HOST` når denne server, certifikatet og ledig diskplads, og spørger OneUptime, hvad det ser af sig selv, som e-mail og probes. Hvert problem kommer med sin løsning: se [Tjek din installation](/docs/installation/docker-compose#tjek-din-installation).
@tab Kubernetes
Kør chartets diagnosescript mod din klynge, som [chartets fejlfindingsvejledning](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) viser. Det læser kun og slutter med et resumé af, hvad det fandt, det værste først.
:::

**Det virkede, når** doctor slutter med **Everything looks right.** og afslutter med `0`. Den afslutter med `1`, når noget skal rettes, og med `2`, når den ikke kunne køre sine tjek. På Kubernetes har resuméet intet fund `CRITICAL`.

## Overvåg noget, og få alarmer

Din server kan nu sende e-mails og alarmere folk. [Hurtigstart](/docs/introduction/quickstart) fortsætter i produktet: en monitor til dit websted, en vagtpolitik, der alarmerer dig, når det går ned, og en statusside, på omkring et kvarter. Dens sidste del erklærer en testhændelse, så du ser alarmen komme frem.

## Fejlfinding

:::details npm start stopper og siger, at HOST endnu ikke er en adresse
`HOST` i `config.env` indeholder stadig en pladsholder, som `<your-address>`. Sæt den til dit domænenavn eller din IP-adresse, uden `http://`, og kør `npm start` igen.
:::

:::details Test-e-mailen fejler
Beskeden under knappen er det, mailserveren svarede. Tjek værtsnavnet, porten, brugernavnet og adgangskoden, og at mailserveren lader dig sende fra adressen, e-mails kommer fra. Se [SMTP](/docs/emails/smtp#fejlfinding).
:::

:::details Browseren advarer om certifikatet
Let's Encrypt kræver, at portene 80 og 443 kan nås fra internettet, og at dit domænenavn peger på denne server. Vent et par minutter, og kør derefter `npm run doctor`: den tjekker certifikatet og siger, hvad der er galt.
:::

## Næste skridt

:::cards
- [Hurtigstart](/docs/introduction/quickstart): En monitor, en vagtpolitik og en statusside på et kvarter.
- [Docker Compose](/docs/installation/docker-compose): Din egen proxy, backup, opdateringer og tjeklisten til produktion.
- [Opgradering](/docs/installation/upgrading): Skift til en ny udgivelse, én hovedversion ad gangen.
- [Arkitektur](/docs/self-hosted/architecture): Hvordan OneUptimes dele hænger sammen.
:::
