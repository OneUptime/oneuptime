# GitHub-integratie

Verbind uw zelf gehoste OneUptime met GitHub via een eigen GitHub App. Zodra de app vanuit OneUptime is geïnstalleerd, worden de repositories van de installatie in uw project geïmporteerd en gesynchroniseerd gehouden, openen AI-fixtaken pull requests, en kan uw team de app vanuit GitHub werk geven door hem te vermelden.

Deze pagina is bedoeld voor wie de OneUptime-server beheert: u maakt de app één keer aan, en daarna verbindt elk project hem vanuit **Code-repositories**.

:::cards
- [De GitHub App aanmaken](#de-github-app-aanmaken): Registreer de app met de juiste URL's, rechten en events.
- [OneUptime configureren](#oneuptime-configureren): Geef de server de zes waarden van de app.
- [Repositories verbinden](#repositories-verbinden): Installeer de app vanuit OneUptime.
- [Probleemoplossing](#probleemoplossing): Wat de meldingen van Code-repositories betekenen.
:::

## Hoe het werkt

Installeren begint in OneUptime, niet op GitHub: de link waarmee OneUptime u naar GitHub stuurt, koppelt de installatie aan uw project.

```mermaid title="Een installatie van de GitHub App met een project verbinden"
sequenceDiagram
    participant B as Uw browser
    participant O as OneUptime
    participant G as GitHub
    B->>O: Connect with GitHub App
    O-->>B: Doorsturen naar de installatiepagina van de app
    B->>G: De app installeren en autoriseren
    G-->>B: Doorsturen naar /api/github/auth/callback
    B->>O: installation_id en een eenmalige code
    O->>G: Code inwisselen, installatie controleren
    O->>G: De repositories van de installatie importeren
    G->>O: Webhooks naar /api/github/webhook
```

- De omleiding in de browser draagt de installatie en een eenmalige OAuth-code mee. OneUptime wisselt de code in om te bevestigen dat het GitHub-account dat de app installeerde die installatie beheert, en importeert daarna de repositories ervan.
- Webhooks houden de lijst met repositories gesynchroniseerd en geven de app werk: vermeldingen, toewijzingen, triggerlabels en reviewverzoeken. GitHub ondertekent elke webhook met het webhook secret, en OneUptime weigert elke webhook die het niet kan verifiëren.

## Voordat u begint

- Een GitHub-account dat GitHub Apps kan aanmaken voor de organisatie of gebruiker waarop de app wordt geïnstalleerd. Om hem in een organisatie te installeren, moet u eigenaar ervan zijn of het verzoek door een eigenaar laten goedkeuren.
- Een openbare HTTPS-hostnaam voor OneUptime die GitHub voor webhooks kan bereiken. Zie [Netwerktoegang](#netwerktoegang-voor-zelf-gehoste-installaties).
- Toegang tot de configuratie van de server: `config.env` bij Docker Compose, of uw Helm-values bij Kubernetes.

## De GitHub App aanmaken

:::steps
### Open de instellingen voor GitHub Apps

- **Voor een organisatie:** `https://github.com/organizations/YOUR_ORG/settings/apps`
- **Voor een persoonlijk account:** `https://github.com/settings/apps`

Kies **New GitHub App**.

### Vul het registratieformulier in

| Veld | Waarde |
| --- | --- |
| **GitHub App name** | Een willekeurige unieke naam, bijvoorbeeld `OneUptime`. Noteer hem precies: dit is `GITHUB_APP_NAME`. |
| **Homepage URL** | `https://your-oneuptime-domain.com` |
| **Callback URL** | `https://your-oneuptime-domain.com/api/github/auth/callback` |
| **Request user authorization (OAuth) during installation** | Aan. **Dit is verplicht**: zie de opmerking hieronder. |
| **Setup URL** | `https://your-oneuptime-domain.com/api/github/auth/callback`, als GitHub u er een laat invullen (zie hieronder). |
| **Redirect on update** | Optioneel. Nadat iemand een installatie op GitHub heeft gewijzigd, brengt OneUptime die persoon naar **Code-repositories**. |
| **Webhook URL** | `https://your-oneuptime-domain.com/api/github/webhook`, met de webhook op **Active**. |
| **Webhook secret** | Een lange willekeurige tekenreeks. Noteer hem: dit is `GITHUB_APP_WEBHOOK_SECRET`. **Verplicht**: OneUptime weigert niet-ondertekende webhooks, dus `GITHUB_APP_WEBHOOK_SECRET` leeg laten stopt de synchronisatie van repositories in plaats van niet-geverifieerde payloads te accepteren. |

Volgens de documentatie van GitHub kunt u met **Request user authorization (OAuth) during installation** ingeschakeld [geen Setup URL invullen](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url): gebruikers worden na het installeren van de app in plaats daarvan naar de Callback URL gestuurd. Beide wijzen naar hetzelfde OneUptime-adres, dus de omleiding komt hoe dan ook op de juiste plek terecht.

> [!IMPORTANT]
> **Waarom "Request user authorization (OAuth) during installation" verplicht is.** Na een installatie stuurt GitHub terug met een `installation_id` in de URL. Dat getal alleen bewijst niets over wie eigenaar van de installatie is — iedereen kan een ander getal intypen. Met deze optie aan geeft GitHub ook een eenmalige OAuth-`code` terug, gekoppeld aan het GitHub-account dat de installatie uitvoerde. OneUptime wisselt die in om te bevestigen dat dat account de installatie echt beheert, voordat het de installatie met uw project verbindt.
>
> Zonder deze optie weigert OneUptime de installatie te verbinden en toont het dashboard een fout die u vraagt deze instelling in te schakelen. Dat is bewust: de installatie-ID ongeverifieerd accepteren zou een OneUptime-project de repositories van een andere organisatie laten claimen.

### Stel de rechten in

Stel onder **Permissions & events** deze **Repository permissions** in:

| Recht | Toegang | Waarvoor OneUptime het gebruikt |
| --- | --- | --- |
| Contents | Read and write | Bestanden in de repository lezen en de branches van AI-fix-pull-requests pushen |
| Pull requests | Read and write | Pull requests openen en bijwerken, en reviews plaatsen |
| Issues | Read and write | De reacties van de app plaatsen — **ook op pull requests**, waarvan GitHub het gesprek via de issues-API laat lopen |
| Checks | Read-only | Optioneel. Het CI-resultaat van fix-pull-requests lezen. Zonder dit recht blijft hun CI-status ongeverifieerd |
| Metadata | Read-only | Basismetadata van de repository (door GitHub vereist) |

**Pas met Issues: Read and write wordt de app interactief.** Zonder dit recht worden vermeldingen ontvangen en mislukken ze daarna stil zodra de app probeert te antwoorden — GitHub levert reacties in pull-requestgesprekken via de issues-API, dus dit ene recht bepaalt elk antwoord van de app. Zie [Werken met OneUptime vanuit GitHub](/docs/ai/github-app).

OneUptime heeft geen rechten op organisatie- of accountniveau nodig.

### Abonneer op webhook-events

OneUptime gebruikt twee groepen events, en die doen verschillend werk.

**Synchronisatie van repositories** — `installation` en `installation_repositories`. GitHub Apps ontvangen deze automatisch; ze houden de verbonden repositories gelijk met waar de app is geïnstalleerd.

**De interactieve app** — hierop moet u zich uitdrukkelijk abonneren, en elk event maakt een bepaalde manier mogelijk om de app werk te geven:

| Event | Wat het mogelijk maakt |
| --- | --- |
| **Issue comment** | `@mention`-opdrachten in issues **en** in pull requests |
| **Issues** | een issue aan de app toewijzen, en het triggerlabel van de repository |
| **Pull request** | een review van de app vragen |
| **Pull request review** | een vermelding in de tekst van een ingediende review |
| **Pull request review comment** | een vermelding in een inline reactie in de diff |

Is geen van deze geabonneerd, dan verbindt de GitHub App nog steeds repositories en opent hij nog steeds fix-pull-requests vanuit OneUptime — hij reageert alleen nooit op iets wat in GitHub wordt geschreven. Dat is de meest voorkomende oorzaak van "de bot negeert me". Zie [Werken met OneUptime vanuit GitHub](/docs/ai/github-app) voor welke opdrachten er zijn en wie ze mag geven.

Andere events (**Push**, **Workflow run**) worden bevestigd en genegeerd; erop abonneren schakelt geen meldingen of CI/CD-automatisering in.

### Kies waar de app kan worden geïnstalleerd

Kies onder **Where can this GitHub App be installed?**:

- **Only on this account** - Voor privé/intern gebruik
- **Any account** - Als u wilt dat anderen uw app installeren

### Maak de app aan en noteer de ID's

Kies **Create GitHub App**. GitHub opent de instellingenpagina van de app. Noteer de **App ID**, bovenaan de pagina, en de **Client ID**, in de sectie **About**.

### Genereer een client secret

Kies onder **Client secrets** de optie **Generate a new client secret**. Kopieer het meteen: GitHub toont het maar één keer.

### Genereer een privésleutel

Kies onder **Private keys** de optie **Generate a private key**. GitHub downloadt een `.pem`-bestand. Bewaar het veilig: hiermee authenticeert OneUptime zich als de app.
:::

## OneUptime configureren

:::tabs
@tab Docker Compose
`config.env` bevat één waarde per regel, dus geef de privésleutel base64-gecodeerd op één regel op. OneUptime decodeert hem:

```bash
base64 < private-key.pem | tr -d '\n'
```

```bash title="config.env"
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY=YOUR_BASE64_ENCODED_PRIVATE_KEY
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

Pas de wijziging toe met `npm run start`, dat de containers opnieuw aanmaakt. `docker compose restart` leest `config.env` niet opnieuw in.
@tab Kubernetes
```yaml title="values.yaml"
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

`privateKey` accepteert ook de PEM zelf, als blok van meerdere regels (`privateKey: |`). Pas de wijziging toe met `helm upgrade`.
:::

Zodra OneUptime weer draait, toont de pagina **Code-repositories** de knop **Connect with GitHub App** in plaats van **GitHub App is not configured on this server**.

### Overzicht van omgevingsvariabelen

| Docker Compose (`config.env`) | Helm (`values.yaml`) | Waarde |
| --- | --- | --- |
| `GITHUB_APP_ID` | `gitHubApp.id` | De **App ID**. Wordt gebruikt om als de app te authenticeren. |
| `GITHUB_APP_NAME` | `gitHubApp.name` | De exacte naam van de app. De installatielink en de `@mention`-handle van de app (in kleine letters, met koppeltekens in plaats van spaties) worden ervan afgeleid. Zonder deze kan **Code-repositories** niet verbinden. |
| `GITHUB_APP_CLIENT_ID` | `gitHubApp.clientId` | De **Client ID**. Nodig om te controleren wie de app heeft geïnstalleerd. |
| `GITHUB_APP_CLIENT_SECRET` | `gitHubApp.clientSecret` | Het client secret dat u hebt gegenereerd. Nodig samen met de client ID. |
| `GITHUB_APP_PRIVATE_KEY` | `gitHubApp.privateKey` | De privésleutel: de PEM, of de PEM base64-gecodeerd. |
| `GITHUB_APP_WEBHOOK_SECRET` | `gitHubApp.webhookSecret` | Het webhook secret. Elke webhook wordt ermee geverifieerd, en zonder dit secret wordt er geen geaccepteerd. |

Alle zes zijn verplicht.

## Repositories verbinden

Start de verbinding vanuit OneUptime, niet vanaf de pagina van de app op GitHub: de link waarmee OneUptime u naar GitHub stuurt, koppelt de installatie aan uw project.

:::steps
1. Meld u aan bij uw OneUptime-dashboard
2. Ga naar **Producten** > **Taken** > **Code-repositories**
3. Klik op **Connect with GitHub App**. OneUptime brengt u naar GitHub
4. Kies de organisatie of het account waarop u de app installeert, en kies tot welke repositories hij toegang heeft: **All repositories** (alle huidige en toekomstige repositories) of **Only select repositories**
5. Klik op **Install** (of **Save**, als de app daar al is geïnstalleerd)
6. GitHub stuurt u terug naar **Code-repositories**, en elke repository in de installatie wordt geïmporteerd. Repositories die later aan de installatie worden toegevoegd of eruit worden verwijderd, worden automatisch gesynchroniseerd.
:::

**Wie kan verbinden.** Verbinden importeert de repositories van de installatie in het project en vereist dus het recht om coderepositories toe te voegen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, of een team met **Create Code Repository**. Een team dat het recht blokkeert, neemt het af. Op OneUptime Cloud vereisen coderepositories het Growth-abonnement of hoger. Voor ieder ander is de kaart vergrendeld en staat erop wat er nodig is.

**Rond het af binnen 15 minuten, in dezelfde browser.** De link werkt één keer, 15 minuten lang, in de browser die hem startte. Wanneer GitHub u terugstuurt, controleert OneUptime het recht opnieuw voordat het iets importeert.

## Netwerktoegang voor zelf gehoste installaties

### Verkeersrichting en endpoints

| Verkeer | Benodigde toegang |
| --- | --- |
| OneUptime naar GitHub | DNS en uitgaand HTTPS via TCP 443 naar `api.github.com` voor tokens van de GitHub App en API-aanroepen voor repositories, en naar `github.com` voor de uitwisseling van het OAuth-token en Git-bewerkingen via HTTPS |
| GitHub naar OneUptime | Openbaar HTTPS via TCP 443 naar `POST /api/github/webhook` voor de synchronisatie van installaties en repositorytoegang, en voor de interactieve app |
| Browser van de gebruiker naar OneUptime | Toegang tot het dashboard en `GET /api/github/auth/callback` voor omleidingen bij installatie en autorisatie; deze kunnen via de VPN van de gebruiker bereikbaar blijven |

De callback is een [omleiding in de browser](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url), terwijl de webhook een verzoek van de servers van GitHub is. De VPN-verbinding van een gebruiker geeft GitHub geen toegang tot de webhook. De domeinen hierboven dekken de kernverzoeken van de integratie; extra repositorytools, downloads, LFS of pakketten kunnen andere bestemmingen vereisen. Deze instellingen beschrijven GitHub.com; de firewall wijzigen stelt geen ondersteuning in voor de hostnaam van een GitHub Enterprise Server.

### Privé-installaties en beveiliging van callbacks

Stel `/api/github/webhook` beschikbaar via een openbare gateway met openbare DNS, een publiek vertrouwd HTTPS-certificaat met volledige keten en een privéroute naar de ingress van OneUptime. Sta inkomend TCP 443 naar de gateway toe en beperk het openbare doorsturen tot deze POST-route. Houd het dashboard en de browsercallback op de privé-ingress als gebruikers ze via VPN bereiken; met split-DNS kan dezelfde hostnaam intern en extern worden bediend.

Stel `HOST=oneuptime.example.com` en `HTTP_PROTOCOL=https` in `config.env` in, of `host: oneuptime.example.com` en `httpProtocol: https` in Helm. Pas de configuratie toe en wacht tot OneUptime opnieuw is opgestart. Deze waarden genereren URL's; ze regelen geen DNS, TLS of netwerktoegang. Als de hostnaam verandert, werk dan de webhook-, callback-, setup- en homepage-URL's van de GitHub App bij.

Behoud de methode, het oorspronkelijke pad, de querystring, de body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` en `X-GitHub-Delivery`. Behoud de openbare host en het HTTPS-schema via vertrouwde proxyheaders. Zonder de webhook uit van browser-SSO, CAPTCHA en aanmeldpagina's van de proxy. Laat de SSL-verificatie van GitHub aan en stel in beide systemen hetzelfde `GITHUB_APP_WEBHOOK_SECRET` in: OneUptime weigert niet-ondertekende verzoeken en kan webhooks zonder dit secret niet valideren. Zie de [richtlijnen van GitHub voor het valideren van webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Als u ook de bron-IP's van webhooks beperkt, gebruik dan de actuele `hooks`-bereiken uit de Meta API van GitHub en vernieuw ze regelmatig; vervang ze niet door de bereiken van GitHub Actions-runners en sla de controle van de handtekening niet over. GitHub waarschuwt dat [zijn adressen veranderen en de gepubliceerde lijst niet volledig is](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Toegang controleren en de beperkingen begrijpen

:::steps
1. Verbind een installatie vanuit **Code-repositories**.
2. Open in de instellingen van de GitHub App **Advanced** en bekijk **Recent Deliveries**. Bezorg een levering opnieuw en bevestig dat de gateway hem doorstuurt en OneUptime hem accepteert.
3. Voeg een testrepository toe aan de installatie of verwijder er een, en controleer of de lijst met repositories in OneUptime meegaat.
:::

GitHub documenteert de [diagnose van leveringen](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) en vereist [een 2xx-bevestiging binnen tien seconden](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Een GET in de browser naar de webhook test geen ondertekende POST.

> [!WARNING]
> Zonder inkomende toegang kunnen autorisatie in de browser en uitgaande API- en Git-bewerkingen werken, maar webhooks bereiken OneUptime niet: verwijderde installaties en wijzigingen in repositorytoegang worden niet gesynchroniseerd, en de app reageert nooit op vermeldingen, toewijzingen of reviewverzoeken.

De [instelling voor toegang tot privénetwerken](/docs/self-hosted/private-network-access) regelt uitgaande verzoeken naar privébestemmingen en maakt de webhook niet bereikbaar voor GitHub.

## Probleemoplossing

### Het verbinden is niet voltooid

Als GitHub u terugstuurt en de installatie niet is verbonden, toont de pagina **Code-repositories** de melding **GitHub is niet verbonden**, met één zin in uw taal die zegt waarom. De rest van de pagina laadt zoals gewoonlijk, zodat u daar meteen opnieuw kunt verbinden. Wat GitHub zelf antwoordde, toont ze nooit: dat staat met de reden in het log van de OneUptime-server.

| De pagina zegt | Wat u doet |
| --- | --- |
| **"Deze verbindingslink is ongeldig, verlopen of al gebruikt. Begin opnieuw."** | De link werkt één keer, 15 minuten lang, in de browser die hem startte. Begin opnieuw vanuit **Code-repositories** en rond het op GitHub binnen 15 minuten af, in dezelfde browser. De app installeren vanaf zijn pagina op GitHub verbindt hem met geen enkel project. |
| **"Je hebt geen toestemming om coderepositories aan dit project toe te voegen."** | Verbinden vereist het recht om coderepositories toe te voegen (zie [Repositories verbinden](#repositories-verbinden)). Vraag een projectbeheerder om het toe te kennen. Het wordt opnieuw gecontroleerd wanneer GitHub u terugstuurt, dus een recht dat u intussen is afgenomen, beëindigt de verbinding ook hier. |
| **"Voor het verbinden met GitHub heb je het ...-abonnement nodig."** | Op OneUptime Cloud vereisen coderepositories het abonnement dat de zin noemt. Zet het project op dat abonnement en verbind daarna opnieuw. |
| **"GitHub heeft niet bevestigd wie de app heeft geïnstalleerd, dus de installatie kon niet worden gecontroleerd."** | Schakel **Request user authorization (OAuth) during installation** in de instellingen van de GitHub App in (zie [De GitHub App aanmaken](#de-github-app-aanmaken)) en verbind daarna opnieuw. |
| **"OneUptime kon niet bevestigen dat je GitHub-account deze installatie kan beheren."** | Het GitHub-account dat de installatie voltooide, beheert haar niet. Installeer de app met een account dat eigenaar is van de organisatie of gebruiker waarop hij wordt geïnstalleerd, of vraag een eigenaar dat te doen. |
| **"GitHub heeft geen installatie teruggestuurd."** | Als een lid van de organisatie de app aanvraagt in plaats van hem te installeren, moet een eigenaar van de organisatie het verzoek eerst goedkeuren. Verbind opnieuw zodra dat is gebeurd. |
| **"De GitHub App is niet ingesteld op deze OneUptime-server."** | Stel zowel `GITHUB_APP_CLIENT_ID` als `GITHUB_APP_CLIENT_SECRET` in (zie [OneUptime configureren](#oneuptime-configureren)) en start OneUptime opnieuw. |
| **"OneUptime kon het verbinden niet afronden. Probeer het opnieuw."** | GitHub antwoordde met een fout, of een verzoek of een schrijfactie mislukte bij het afronden. Het log van de OneUptime-server zegt welke. Probeer het opnieuw; blijft het gebeuren, controleer dan het log en de instellingen van de GitHub App. |

### Andere problemen

:::details Code-repositories meldt "GitHub App is not configured on this server"
`GITHUB_APP_NAME` is niet ingesteld. Stel het in op de exacte naam van de app, samen met de andere vijf waarden, en start OneUptime opnieuw.
:::

:::details Na het installeren van de app word ik niet teruggestuurd naar OneUptime
Controleer of de **Callback URL** van de app `https://your-oneuptime-domain.com/api/github/auth/callback` is, en ook de **Setup URL** als die is ingesteld. Beide moeten naar hetzelfde endpoint `/api/github/auth/callback` wijzen, op de hostnaam uit `HOST`.
:::

:::details De Recent Deliveries van GitHub tonen "Invalid webhook signature"
Het webhook secret in de GitHub App en `GITHUB_APP_WEBHOOK_SECRET` verschillen, `GITHUB_APP_WEBHOOK_SECRET` is niet ingesteld, of een proxy heeft de body van het verzoek gewijzigd. Stel in beide hetzelfde secret in, start OneUptime opnieuw en zorg dat de gateway de body ongewijzigd doorstuurt.
:::

:::details Webhook-events komen niet aan
Controleer of de webhook-URL openbaar via HTTPS bereikbaar is, en bekijk daarna in de instellingen van de GitHub App onder **Advanced > Recent Deliveries** elke poging en het antwoord erop. Webhooks worden geweigerd zolang `GITHUB_APP_WEBHOOK_SECRET` niet is ingesteld.
:::

:::details Repositories of fixtaken mislukken met een authenticatiefout
OneUptime authenticeert zich als de app met `GITHUB_APP_ID` en `GITHUB_APP_PRIVATE_KEY`. Controleer of de App ID klopt en of de sleutel de volledige PEM is, inclusief de regels `BEGIN` en `END`, of die PEM base64-gecodeerd. Is de app van GitHub verwijderd, verbind hem dan opnieuw vanuit **Code-repositories**.
:::

:::details Na de installatie ontbreken repositories
Controleer in de instellingen van de installatie op GitHub tot welke repositories ze toegang heeft. Repositories die u daar toevoegt, worden automatisch geïmporteerd, zolang webhooks OneUptime bereiken.
:::

:::details De app negeert vermeldingen in GitHub
Geef de app **Issues: Read and write** en abonneer hem op de interactieve events uit [Abonneer op webhook-events](#abonneer-op-webhook-events). Vermeldingen komen bovendien alleen overeen met de handle die van `GITHUB_APP_NAME` is afgeleid, dus stel die in op de echte naam van de app.
:::

## Aanbevolen beveiligingspraktijken

- **Roteer geheimen regelmatig.** Genereer periodiek nieuwe client secrets en privésleutels.
- **Houd het webhook secret ingesteld.** OneUptime weigert webhooks die het niet kan verifiëren.
- **Beperk de toegang tot repositories.** Geef de installatie alleen de repositories die moeten worden verbonden.
- **Houd de webhookleveringen in de gaten.** Controleer regelmatig op mislukte leveringen of verdachte activiteit.
- **Houd privésleutels buiten versiebeheer.**

## Volgende stappen

:::cards
- [Werken met OneUptime vanuit GitHub](/docs/ai/github-app): De opdrachten die men de app kan geven, en wie dat mag.
- [Fixtaken](/docs/ai/ai-agent): Hoe de AI-agent fix-pull-requests opent.
- [Toegang tot privénetwerk](/docs/self-hosted/private-network-access): Laat workflows en webhooks interne tools bereiken.
:::
