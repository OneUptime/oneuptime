# Handleiding zelf hosten

Volg deze pagina van boven naar beneden om van een lege server naar uw eigen OneUptime te gaan, dat via HTTPS draait, u een testmail heeft gestuurd en u kan alarmeren. Elke stap eindigt met hoe u ziet dat het gelukt is, en verwijst voor de details naar de langere pagina's.

:::cards
- [OneUptime installeren](#oneuptime-installeren): Docker Compose op één server, of de Helm-chart op Kubernetes.
- [De server afmaken](#de-server-afmaken): E-mail, dan sms en oproepen, elk met een test.
- [Uw installatie controleren](#uw-installatie-controleren): Eén opdracht die zegt wat er mis is.
- [Snelstart](/docs/introduction/quickstart): Uw eerste monitor, uw eerste dienstbeleid en uw eerste statuspagina.
:::

## Wat u nodig hebt

- **Een server.** Voor Docker Compose een Linux-server met 8 GB geheugen, 4 cores en 20 GB schijf om OneUptime uit te proberen, of 16 GB, 8 cores en 400 GB voor een team: zie [Sizing en capaciteitsplanning](/docs/installation/sizing). Voor de Helm-chart een Kubernetes-cluster.
- **Een domeinnaam** waarmee mensen OneUptime openen, zoals `oneuptime.example.com`, met een DNS-`A`-record dat naar de server wijst. U kunt beginnen met het IP-adres van de server, maar een certificaat van Let's Encrypt vraagt een domeinnaam.
- **De poorten 80 en 443**, bereikbaar vanaf internet, voor HTTPS.
- **Een manier om e-mail te versturen**: een mailserver, zoals die van uw bedrijf, Microsoft 365 of Google Workspace, of een account bij Amazon SES, SendGrid, Mailgun, Postmark of Resend.
- **Een Twilio-account**, om per sms en telefoonoproep gealarmeerd te worden. E-mail en pushmeldingen hebben er geen nodig.

**Het is gelukt als** `dig +short oneuptime.example.com` het IP-adres van de server toont.

## OneUptime installeren

:::tabs
@tab Docker Compose
Op een nieuwe Ubuntu-, Debian- of RHEL-server installeert één opdracht Docker, Git en Node.js waar ze ontbreken, kloont OneUptime in een map `oneuptime`, vraagt naar het adres waarmee mensen OneUptime openen en start het:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Om hetzelfde met de hand te doen, met Docker, Git en Node.js geïnstalleerd:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Open `config.env` en zet `HOST`, de eerste instelling erin, op uw domeinnaam of IP-adres, zonder `http://`. Het is de enige instelling die u moet wijzigen: e-mail, sms en oproepen stelt u in het Admin Dashboard in, en alles onder `ADVANCED` werkt zoals het is. Start daarna OneUptime:

```bash
npm start
```

**Het is gelukt als** `npm start` eindigt met **OneUptime is up!** en het adres om te openen. De eerste start duurt enkele minuten, terwijl Docker de images downloadt. Stopt `npm start` eerder, dan zegt het wat u moet wijzigen. [Docker Compose](/docs/installation/docker-compose) heeft alle details.
@tab Kubernetes
Maak een `values.yaml` met uw domeinnaam of IP-adres, zonder `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

De chart bewaart zijn gegevens op de standaard storage class van uw cluster. Markeert `kubectl get storageclass` er geen als `(default)`, voeg dan `global.storageClass` toe met de naam van een ervan. Installeer daarna de chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Het is gelukt als** `kubectl get pods` elke pod als `Running` toont en het adres dat `helm install` toonde OneUptime opent. De [installatiehandleiding van de chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) heeft alle details.
:::

## HTTPS inschakelen

Zodra uw domeinnaam naar de server wijst, laat u OneUptime een gratis certificaat van Let's Encrypt halen. Het vernieuwt het certificaat zelf.

:::tabs
@tab Docker Compose
Zet deze waarden in `config.env` en voer daarna `npm start` opnieuw uit:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Draait u al een reverse proxy, zoals Caddy, Nginx of een load balancer? Houd `PROVISION_SSL=false`, zet `HTTP_PROTOCOL=https` en `TRUSTED_PROXY_HOPS=2`, en lees [Uw eigen reverse proxy gebruiken](/docs/installation/docker-compose#uw-eigen-reverse-proxy-gebruiken).
@tab Kubernetes
Zet deze waarden in `values.yaml` en pas ze daarna toe:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Om TLS in plaats daarvan bij een eigen ingress controller te laten eindigen, laat u `ssl.provision` uit en zet u alleen `httpProtocol: https`.
:::

**Het is gelukt als** `https://oneuptime.example.com` opent zonder certificaatwaarschuwing. Het eerste certificaat komt meestal binnen een paar minuten. Probeert u OneUptime op `localhost`? Sla deze stap over: een certificaat vraagt een domeinnaam.

## Het beheerdersaccount aanmaken

Open uw adres, zoals `https://oneuptime.example.com`, en registreer u. Het eerste account op een nieuwe server wordt de hoofdbeheerder ervan, die het Admin Dashboard op `/admin` kan openen.

**Het is gelukt als** `/admin` het Admin Dashboard opent. Zolang e-mail, HTTPS of de keuze over registraties nog openstaan, opent het op **Rond de inrichting van deze server af**.

## De server afmaken

De pagina **Serverinstelling** van het Admin Dashboard, op `/admin/setup`, somt op wat een nieuwe server nodig heeft, het belangrijkste eerst. E-mail, HTTPS en wie zich mag registreren zijn verplicht. Sms en oproepen, een globale probe, back-ups en updatecontroles worden aanbevolen. Elk punt heeft een knop die de plek opent waar het wordt ingesteld, en `npm start` eindigt met het adres van deze pagina.

:::steps
### E-mail instellen

Klik op **E-mail instellen**. Het opent **Instellingen > Meldingen > E-mails**, waar u uw mailserver (de meeste gebruiken poort `587`) of uw e-mailprovider invult, en het adres waar e-mails vandaan komen. Sla op, klik dan op **Testmail versturen** en stuur er een naar uzelf.

**Het is gelukt als** de e-mail aankomt en de checklist E-mail als klaar markeert. Mislukt de test, dan toont hij wat de mailserver antwoordde: zie [SMTP](/docs/emails/smtp#problemen-oplossen).

### Kiezen wie zich kan registreren

Iedereen die uw adres kan openen, kan zich registreren. Zodra uw team zijn accounts heeft, zet u **Registratie toestaan** uit onder **Instellingen > Authenticatie**: wie u in een project uitnodigt, kan toch meedoen. Om registraties open te laten, klikt u op **Aanmelden open laten**.

**Het is gelukt als** de checklist Registraties als klaar markeert.

### Sms en oproepen instellen, of alleen e-mail en push gebruiken

Om per sms en telefoonoproep gealarmeerd te worden, klikt u op **Sms en oproepen instellen** en voegt u uw Twilio-account toe onder **Instellingen > Meldingen > Bellen en SMS**: [Twilio-integratie](/docs/self-hosted/twilio-integration) laat zien waar u elke waarde vindt. Klik daarna op **Test-sms versturen** en **Testoproep doen**. Om ze in plaats daarvan via een eigen gateway te sturen, zie [Sms- en belgateway](/docs/self-hosted/sms-and-call-gateway). Zijn e-mail en pushmeldingen genoeg, klik dan op **Alleen e-mail en push gebruiken**.

**Het is gelukt als** de sms aankomt en uw telefoon overgaat, of de checklist uw keuze toont.
:::

Het HTTPS-punt is klaar zodra [HTTPS inschakelen](#https-inschakelen) werkt, en elk aanbevolen punt zegt wat u moet doen.

## Uw installatie controleren

:::tabs
@tab Docker Compose
Voer in de map `oneuptime` de doctor uit:

```bash
npm run doctor
```

Hij controleert elke container, `config.env`, of `HOST` deze server bereikt, het certificaat en de vrije schijfruimte, en vraagt OneUptime wat het van zichzelf ziet, zoals e-mail en probes. Bij elk probleem hoort de oplossing: zie [Uw installatie controleren](/docs/installation/docker-compose#uw-installatie-controleren).
@tab Kubernetes
Voer het diagnosescript van de chart uit tegen uw cluster, zoals de [probleemoplossingsgids van de chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) laat zien. Het leest alleen, en eindigt met een samenvatting van wat het vond, het ergste eerst.
:::

**Het is gelukt als** de doctor eindigt met **Everything looks right.** en stopt met `0`. Hij stopt met `1` als er iets te verhelpen is, en met `2` als hij zijn controles niet kon uitvoeren. Op Kubernetes heeft de samenvatting geen enkele bevinding `CRITICAL`.

## Iets bewaken en gealarmeerd worden

Uw server kan nu e-mails versturen en mensen alarmeren. De [Snelstart](/docs/introduction/quickstart) gaat verder in het product: een monitor voor uw website, een dienstbeleid dat u alarmeert als die uitvalt, en een statuspagina, in ongeveer vijftien minuten. Het laatste deel meldt een testincident, zodat u de alarmering ziet aankomen.

## Problemen oplossen

:::details npm start stopt en zegt dat HOST nog geen adres is
`HOST` in `config.env` bevat nog een tijdelijke waarde, zoals `<your-address>`. Zet het op uw domeinnaam of IP-adres, zonder `http://`, en voer `npm start` opnieuw uit.
:::

:::details De testmail mislukt
De melding onder de knop is wat de mailserver antwoordde. Controleer de hostnaam, de poort, de gebruikersnaam en het wachtwoord, en of de mailserver u laat versturen vanaf het adres waar e-mails vandaan komen. Zie [SMTP](/docs/emails/smtp#problemen-oplossen).
:::

:::details De browser waarschuwt voor het certificaat
Let's Encrypt heeft de poorten 80 en 443 nodig, bereikbaar vanaf internet, en uw domeinnaam die naar deze server wijst. Wacht een paar minuten en voer dan `npm run doctor` uit: hij controleert het certificaat en zegt wat er mis is.
:::

## Volgende stappen

:::cards
- [Snelstart](/docs/introduction/quickstart): Een monitor, een dienstbeleid en een statuspagina in vijftien minuten.
- [Docker Compose](/docs/installation/docker-compose): Uw eigen proxy, back-ups, updates en de checklist voor productie.
- [Upgraden](/docs/installation/upgrading): Naar een nieuwe release overstappen, één hoofdversie tegelijk.
- [Architectuur](/docs/self-hosted/architecture): Hoe de onderdelen van OneUptime samenwerken.
:::
