# GitHub-integration

Anslut din egenvärdade OneUptime till GitHub med en GitHub App som du själv äger. När appen har installerats från OneUptime importeras installationens repositories till ditt projekt och hålls synkroniserade, AI-korrigeringsuppgifter öppnar pull requests, och ditt team kan ge appen uppgifter från GitHub genom att nämna den.

Den här sidan är till för den som driver OneUptime-servern: du skapar appen en gång, och sedan ansluter varje projekt den från **Kodrepositorier**.

:::cards
- [Skapa GitHub-appen](#skapa-github-appen): Registrera appen med rätt URL:er, behörigheter och händelser.
- [Konfigurera OneUptime](#konfigurera-oneuptime): Ge servern appens sex värden.
- [Anslut repositories](#anslut-repositories): Installera appen från OneUptime.
- [Felsökning](#felsökning): Vad meddelandena under Kodrepositorier betyder.
:::

## Så fungerar det

Installationen börjar i OneUptime, inte på GitHub: länken som OneUptime skickar dig till GitHub med är det som knyter installationen till ditt projekt.

```mermaid title="Ansluta en installation av GitHub-appen till ett projekt"
sequenceDiagram
    participant B as Din webbläsare
    participant O as OneUptime
    participant G as GitHub
    B->>O: Connect with GitHub App
    O-->>B: Omdirigering till appens installationssida
    B->>G: Installera och auktorisera appen
    G-->>B: Omdirigering till /api/github/auth/callback
    B->>O: installation_id och en engångskod
    O->>G: Byt koden, kontrollera installationen
    O->>G: Importera installationens repositories
    G->>O: Webhooks till /api/github/webhook
```

- Omdirigeringen i webbläsaren bär installationen och en OAuth-engångskod. OneUptime byter koden för att bekräfta att GitHub-kontot som installerade appen administrerar installationen och importerar sedan dess repositories.
- Webhooks håller listan över repositories synkroniserad och ger appen uppgifter: omnämnanden, tilldelningar, utlösaretiketter och granskningsbegäranden. GitHub signerar var och en med webhook-hemligheten, och OneUptime avvisar dem som den inte kan verifiera.

## Innan du börjar

- Ett GitHub-konto som kan skapa GitHub Apps för organisationen eller användaren som appen ska installeras på. För att installera den i en organisation måste du vara ägare till den eller få en ägare att godkänna begäran.
- Ett offentligt HTTPS-värdnamn för OneUptime som GitHub kan nå för webhooks. Se [Nätverksåtkomst](#nätverksåtkomst-för-egenvärdade-installationer).
- Åtkomst till serverns konfiguration: `config.env` för Docker Compose, eller dina Helm-values för Kubernetes.

## Skapa GitHub-appen

:::steps
### Öppna inställningarna för GitHub Apps

- **För en organisation:** `https://github.com/organizations/YOUR_ORG/settings/apps`
- **För ett personligt konto:** `https://github.com/settings/apps`

Välj **New GitHub App**.

### Fyll i registreringsformuläret

| Fält | Värde |
| --- | --- |
| **GitHub App name** | Valfritt unikt namn, till exempel `OneUptime`. Anteckna det exakt: det är `GITHUB_APP_NAME`. |
| **Homepage URL** | `https://your-oneuptime-domain.com` |
| **Callback URL** | `https://your-oneuptime-domain.com/api/github/auth/callback` |
| **Request user authorization (OAuth) during installation** | På. **Den är obligatorisk**: se anmärkningen nedan. |
| **Setup URL** | `https://your-oneuptime-domain.com/api/github/auth/callback`, om GitHub låter dig ange en (se nedan). |
| **Redirect on update** | Valfritt. När någon har ändrat en installation på GitHub tar OneUptime dem till **Kodrepositorier**. |
| **Webhook URL** | `https://your-oneuptime-domain.com/api/github/webhook`, med webhooken satt till **Active**. |
| **Webhook secret** | En lång slumpmässig sträng. Anteckna den: den är `GITHUB_APP_WEBHOOK_SECRET`. **Obligatorisk**: OneUptime avvisar osignerade webhooks, så om `GITHUB_APP_WEBHOOK_SECRET` inte är satt stoppas synkroniseringen av repositories i stället för att overifierade nyttolaster godtas. |

Enligt GitHubs dokumentation kan du med **Request user authorization (OAuth) during installation** påslagen [inte ange en Setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url): användare skickas i stället till Callback URL efter att de har installerat appen. Båda pekar på samma OneUptime-adress, så omdirigeringen hamnar rätt i båda fallen.

> [!IMPORTANT]
> **Varför "Request user authorization (OAuth) during installation" är obligatorisk.** Efter en installation omdirigerar GitHub tillbaka med ett `installation_id` i URL:en. Det numret ensamt bevisar ingenting om vem som äger installationen — vem som helst kan skriva in ett annat. Med det här alternativet påslaget returnerar GitHub också en OAuth-`code` för engångsbruk, kopplad till GitHub-kontot som utförde installationen, som OneUptime byter för att bekräfta att kontot verkligen administrerar installationen innan den ansluts till ditt projekt.
>
> Utan det vägrar OneUptime att ansluta installationen, och dashboarden visar ett fel som ber dig slå på inställningen. Det är avsiktligt: att godta installations-ID:t overifierat skulle låta ett OneUptime-projekt göra anspråk på en annan organisations repositories.

### Ange behörigheterna

Ange de här **Repository permissions** under **Permissions & events**:

| Behörighet | Åtkomst | Vad OneUptime använder den till |
| --- | --- | --- |
| Contents | Read and write | Läsa filer i repositoryt och pusha grenarna för AI-korrigeringarnas pull requests |
| Pull requests | Read and write | Öppna och uppdatera pull requests och publicera granskningar |
| Issues | Read and write | Publicera appens kommentarer — **även på pull requests**, vars konversation GitHub skickar via issues-API:t |
| Checks | Read-only | Valfritt. Läsa CI-resultatet för korrigeringarnas pull requests. Utan den förblir deras CI-status overifierad |
| Metadata | Read-only | Grundläggande metadata för repositoryt (krävs av GitHub) |

**Det är Issues: Read and write som gör appen interaktiv.** Utan den tas omnämnanden emot men misslyckas sedan tyst när appen försöker svara — GitHub levererar kommentarer i pull request-konversationer från issues-API:t, så den här enda behörigheten avgör varje svar som appen skriver. Se [Arbeta med OneUptime från GitHub](/docs/ai/github-app).

OneUptime behöver inga behörigheter på organisations- eller kontonivå.

### Prenumerera på webhook-händelser

OneUptime använder två uppsättningar händelser, och de gör olika jobb.

**Synkronisering av repositories** — `installation` och `installation_repositories`. GitHub Apps tar emot dessa automatiskt; de håller uppsättningen anslutna repositories i takt med var appen är installerad.

**Den interaktiva appen** — dessa måste du prenumerera på uttryckligen, och var och en möjliggör ett visst sätt att ge appen uppgifter:

| Händelse | Vad den möjliggör |
| --- | --- |
| **Issue comment** | `@mention`-kommandon i issues **och** i pull requests |
| **Issues** | att tilldela appen en issue, och repositoryts utlösaretikett |
| **Pull request** | att be appen om en granskning |
| **Pull request review** | ett omnämnande i texten till en inskickad granskning |
| **Pull request review comment** | ett omnämnande i en inbäddad kommentar i diffen |

Om du inte prenumererar på någon av dessa ansluter GitHub-appen fortfarande repositories och öppnar fortfarande korrigeringarnas pull requests från OneUptime — den svarar bara aldrig på något som skrivs i GitHub. Det är den vanligaste orsaken till ”boten ignorerar mig”. Se [Arbeta med OneUptime från GitHub](/docs/ai/github-app) för vilka kommandona är och vem som får ge dem.

Andra händelser (**Push**, **Workflow run**) kvitteras och ignoreras; att prenumerera på dem slår inte på aviseringar eller CI/CD-automatisering.

### Välj var appen kan installeras

Välj under **Where can this GitHub App be installed?**:

- **Only on this account** - För privat/intern användning
- **Any account** - Om du vill att andra ska kunna installera din app

### Skapa appen och anteckna dess ID:n

Välj **Create GitHub App**. GitHub öppnar appens inställningssida. Anteckna **App ID** högst upp på sidan och **Client ID** i avsnittet **About**.

### Generera en client secret

Välj **Generate a new client secret** under **Client secrets**. Kopiera den direkt: GitHub visar den bara en gång.

### Generera en privat nyckel

Välj **Generate a private key** under **Private keys**. GitHub laddar ned en `.pem`-fil. Förvara den säkert: den låter OneUptime autentisera sig som appen.
:::

## Konfigurera OneUptime

:::tabs
@tab Docker Compose
`config.env` har ett värde per rad, så ange den privata nyckeln base64-kodad på en enda rad. OneUptime avkodar den:

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

Tillämpa ändringen med `npm run start`, som återskapar containrarna. `docker compose restart` läser inte in `config.env` igen.
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

`privateKey` tar också själva PEM-filen, som ett block över flera rader (`privateKey: |`). Tillämpa ändringen med `helm upgrade`.
:::

När OneUptime är igång igen visar **Kodrepositorier** knappen **Connect with GitHub App** i stället för **GitHub App is not configured on this server**.

### Referens för miljövariabler

| Docker Compose (`config.env`) | Helm (`values.yaml`) | Värde |
| --- | --- | --- |
| `GITHUB_APP_ID` | `gitHubApp.id` | **App ID**. Används för att autentisera som appen. |
| `GITHUB_APP_NAME` | `gitHubApp.name` | Appens exakta namn. Installationslänken och appens `@mention`-handtag (med gemener, bindestreck i stället för mellanslag) byggs från det. Utan det kan **Kodrepositorier** inte ansluta. |
| `GITHUB_APP_CLIENT_ID` | `gitHubApp.clientId` | **Client ID**. Behövs för att kontrollera vem som installerade appen. |
| `GITHUB_APP_CLIENT_SECRET` | `gitHubApp.clientSecret` | Den client secret du genererade. Behövs tillsammans med client ID. |
| `GITHUB_APP_PRIVATE_KEY` | `gitHubApp.privateKey` | Den privata nyckeln: PEM-filen, eller PEM-filen base64-kodad. |
| `GITHUB_APP_WEBHOOK_SECRET` | `gitHubApp.webhookSecret` | Webhook-hemligheten. Varje webhook verifieras med den, och ingen godtas utan den. |

Alla sex är obligatoriska.

## Anslut repositories

Starta anslutningen från OneUptime, inte från appens sida på GitHub: länken som OneUptime skickar dig till GitHub med är det som knyter installationen till ditt projekt.

:::steps
1. Logga in på din OneUptime-dashboard
2. Gå till **Produkter** > **Uppgifter** > **Kodrepositorier**
3. Klicka på **Connect with GitHub App**. OneUptime tar dig till GitHub
4. Välj organisationen eller kontot som appen ska installeras på, och välj vilka repositories den får komma åt: **All repositories** (alla nuvarande och framtida repositories) eller **Only select repositories**
5. Klicka på **Install** (eller **Save**, om appen redan är installerad där)
6. GitHub skickar tillbaka dig till **Kodrepositorier**, och varje repository i installationen importeras. Repositories som senare läggs till i eller tas bort från installationen hålls synkroniserade automatiskt.
:::

**Vem som kan ansluta.** Anslutningen importerar installationens repositories till projektet och kräver därför behörighet att lägga till kodrepositorier: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, eller ett team med **Create Code Repository**. Ett team som blockerar behörigheten tar bort den. På OneUptime Cloud kräver kodrepositorier Growth-abonnemanget eller högre. För alla andra är kortet låst och säger vad som krävs.

**Slutför inom 15 minuter, i samma webbläsare.** Länken fungerar en gång, i 15 minuter, i webbläsaren som startade den. När GitHub skickar tillbaka dig kontrollerar OneUptime behörigheten igen innan den importerar något.

## Nätverksåtkomst för egenvärdade installationer

### Trafikriktning och slutpunkter

| Trafik | Nödvändig åtkomst |
| --- | --- |
| OneUptime till GitHub | DNS och utgående HTTPS på TCP 443 till `api.github.com` för token till GitHub-appen och API-anrop mot repositories, och till `github.com` för utbyte av OAuth-token och Git-åtgärder över HTTPS |
| GitHub till OneUptime | Offentlig HTTPS på TCP 443 till `POST /api/github/webhook` för synkronisering av installationer och repository-åtkomst, och för den interaktiva appen |
| Användarens webbläsare till OneUptime | Åtkomst till dashboarden och `GET /api/github/auth/callback` för omdirigeringar vid installation och auktorisering; de kan fortsatt nås via användarens VPN |

Callbacken är en [omdirigering i webbläsaren](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url), medan webhooken är en begäran från GitHubs servrar. En användares VPN-anslutning ger inte GitHub åtkomst till webhooken. Domänerna ovan täcker integrationens kärnbegäranden; ytterligare verktyg för repositories, nedladdningar, LFS eller paket kan kräva andra mål. De här inställningarna beskriver GitHub.com; att ändra brandväggen konfigurerar inte stöd för värdnamnet till en GitHub Enterprise Server.

### Privata installationer och säkerhet för callbacks

Exponera `/api/github/webhook` via en offentlig gateway med offentlig DNS, ett offentligt betrott HTTPS-certifikat med fullständig kedja och en privat rutt till OneUptimes ingress. Tillåt inkommande TCP 443 till gatewayen och begränsa den offentliga vidarebefordringen till den här POST-rutten. Behåll dashboarden och webbläsarens callback på den privata ingressen om användarna når dem över VPN; med delad DNS kan samma värdnamn levereras internt och externt.

Ange `HOST=oneuptime.example.com` och `HTTP_PROTOCOL=https` i `config.env`, eller `host: oneuptime.example.com` och `httpProtocol: https` i Helm. Tillämpa konfigurationen och vänta tills OneUptime har startat om. De här värdena genererar URL:er; de skapar inte DNS, TLS eller nätverksåtkomst. Om värdnamnet ändras uppdaterar du GitHub-appens URL:er för webhook, callback, setup och startsida.

Bevara metoden, den ursprungliga sökvägen, frågesträngen, bodyn, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` och `X-GitHub-Delivery`. Bevara den offentliga värden och HTTPS-schemat via betrodda proxyhuvuden. Undanta webhooken från webbläsar-SSO, CAPTCHA och proxyns inloggningssidor. Låt GitHubs SSL-verifiering vara påslagen och konfigurera samma `GITHUB_APP_WEBHOOK_SECRET` i båda systemen: OneUptime avvisar osignerade begäranden och kan inte validera webhooks utan den här hemligheten. Se [GitHubs vägledning om validering av webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Om du också begränsar webhooks käll-IP:er använder du de aktuella `hooks`-intervallen från GitHubs Meta API och uppdaterar dem regelbundet; ersätt dem inte med intervallen för GitHub Actions-runners, och hoppa inte över signaturverifieringen. GitHub varnar för att [deras adresser ändras och att den publicerade listan inte är fullständig](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Kontrollera åtkomsten och förstå begränsningarna

:::steps
1. Anslut en installation från **Kodrepositorier**.
2. Öppna **Advanced** i GitHub-appens inställningar och titta på **Recent Deliveries**. Leverera om en leverans och bekräfta att gatewayen vidarebefordrar den och att OneUptime godtar den.
3. Lägg till eller ta bort ett testrepository i installationen och kontrollera att listan över repositories i OneUptime följer med.
:::

GitHub dokumenterar [felsökning av leveranser](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) och kräver [en 2xx-kvittering inom tio sekunder](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). En GET från webbläsaren mot webhooken testar inte en signerad POST.

> [!WARNING]
> Utan inkommande åtkomst kan auktorisering i webbläsaren och utgående API- och Git-åtgärder fungera, men webhooks kan inte nå OneUptime: borttagna installationer och ändringar i repository-åtkomst synkroniseras inte, och appen svarar aldrig på omnämnanden, tilldelningar eller granskningsbegäranden.

[Inställningen för åtkomst till privata nätverk](/docs/self-hosted/private-network-access) styr utgående begäranden till privata mål och gör inte webhooken nåbar för GitHub.

## Felsökning

### Anslutningen slutfördes inte

När GitHub skickar tillbaka dig och installationen inte anslöts visar **Kodrepositorier** meddelandet **GitHub anslöts inte**, med en mening på ditt språk som säger varför. Resten av sidan laddas som vanligt, så du kan ansluta igen direkt där. Den visar aldrig vad GitHub själv svarade: det står i OneUptime-serverns logg, tillsammans med orsaken.

| Sidan säger | Vad du gör |
| --- | --- |
| **"Den här anslutningslänken är ogiltig, har gått ut eller har redan använts. Börja om."** | Länken fungerar en gång, i 15 minuter, i webbläsaren som startade den. Börja om från **Kodrepositorier** och slutför på GitHub inom 15 minuter, i samma webbläsare. Att installera appen från dess sida på GitHub ansluter den inte till något projekt. |
| **"Du har inte behörighet att lägga till kodrepositories i det här projektet."** | Anslutningen kräver behörighet att lägga till kodrepositorier (se [Anslut repositories](#anslut-repositories)). Be en projektadministratör att ge den. Den kontrolleras igen när GitHub skickar tillbaka dig, så en behörighet som tagits bort under tiden avslutar också anslutningen här. |
| **"Att ansluta GitHub kräver ...-abonnemanget."** | På OneUptime Cloud kräver kodrepositorier det abonnemang som meningen nämner. Uppgradera projektets abonnemang och anslut igen. |
| **"GitHub bekräftade inte vem som installerade appen, så installationen kunde inte kontrolleras."** | Slå på **Request user authorization (OAuth) during installation** i GitHub-appens inställningar (se [Skapa GitHub-appen](#skapa-github-appen)) och anslut igen. |
| **"OneUptime kunde inte bekräfta att ditt GitHub-konto kan hantera den här installationen."** | GitHub-kontot som slutförde installationen administrerar den inte. Installera appen med ett konto som äger organisationen eller användaren den installeras på, eller be en ägare göra det. |
| **"GitHub skickade inte tillbaka någon installation."** | När en medlem i organisationen begär appen i stället för att installera den måste en ägare av organisationen godkänna begäran först. Anslut igen när det är gjort. |
| **"GitHub App är inte konfigurerad på den här OneUptime-servern."** | Ange både `GITHUB_APP_CLIENT_ID` och `GITHUB_APP_CLIENT_SECRET` (se [Konfigurera OneUptime](#konfigurera-oneuptime)) och starta om OneUptime. |
| **"OneUptime kunde inte slutföra anslutningen. Försök igen."** | GitHub svarade med ett fel, eller så misslyckades en begäran eller en skrivning under slutförandet. OneUptime-serverns logg säger vilken. Försök igen; om det fortsätter, kontrollera loggen och GitHub-appens inställningar. |

### Andra problem

:::details Kodrepositorier säger "GitHub App is not configured on this server"
`GITHUB_APP_NAME` är inte angiven. Ange appens exakta namn tillsammans med de fem andra värdena och starta om OneUptime.
:::

:::details Jag skickas inte tillbaka till OneUptime efter att jag har installerat appen
Kontrollera att appens **Callback URL** är `https://your-oneuptime-domain.com/api/github/auth/callback`, och likaså **Setup URL** om en sådan är angiven. Båda måste peka på samma slutpunkt `/api/github/auth/callback`, på värdnamnet i `HOST`.
:::

:::details GitHubs Recent Deliveries visar "Invalid webhook signature"
Webhook-hemligheten i GitHub-appen och `GITHUB_APP_WEBHOOK_SECRET` skiljer sig åt, `GITHUB_APP_WEBHOOK_SECRET` är inte angiven, eller så har en proxy ändrat begärandens body. Ange samma hemlighet på båda ställena, starta om OneUptime och se till att gatewayen vidarebefordrar bodyn oförändrad.
:::

:::details Webhook-händelser tas inte emot
Kontrollera att webhook-URL:en kan nås offentligt över HTTPS, och titta sedan på **Advanced > Recent Deliveries** i GitHub-appens inställningar för varje försök och dess svar. Webhooks avvisas så länge `GITHUB_APP_WEBHOOK_SECRET` inte är angiven.
:::

:::details Repositories eller korrigeringsuppgifter misslyckas med ett autentiseringsfel
OneUptime autentiserar sig som appen med `GITHUB_APP_ID` och `GITHUB_APP_PRIVATE_KEY`. Kontrollera att App ID är rätt och att nyckeln är den fullständiga PEM-filen, inklusive raderna `BEGIN` och `END`, eller den PEM-filen base64-kodad. Om appen har avinstallerats från GitHub ansluter du den igen från **Kodrepositorier**.
:::

:::details Repositories saknas efter installationen
Kontrollera i installationens inställningar på GitHub vilka repositories den har åtkomst till. Repositories som du lägger till där importeras automatiskt, så länge webhooks når OneUptime.
:::

:::details Appen ignorerar omnämnanden i GitHub
Ge appen **Issues: Read and write** och prenumerera den på de interaktiva händelserna i [Prenumerera på webhook-händelser](#prenumerera-på-webhook-händelser). Omnämnanden matchar dessutom bara handtaget som byggs från `GITHUB_APP_NAME`, så ange appens riktiga namn där.
:::

## Bästa praxis för säkerhet

- **Rotera hemligheter regelbundet.** Generera nya client secrets och privata nycklar med jämna mellanrum.
- **Låt webhook-hemligheten vara angiven.** OneUptime avvisar webhooks som den inte kan verifiera.
- **Begränsa åtkomsten till repositories.** Ge installationen bara de repositories som behöver anslutas.
- **Bevaka webhook-leveranser.** Kontrollera regelbundet om det finns misslyckade leveranser eller misstänkt aktivitet.
- **Håll privata nycklar utanför versionshanteringen.**

## Nästa steg

:::cards
- [Arbeta med OneUptime från GitHub](/docs/ai/github-app): Kommandona som man kan ge appen, och vem som får ge dem.
- [Korrigeringsuppgifter](/docs/ai/ai-agent): Hur AI-agenten öppnar korrigeringarnas pull requests.
- [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access): Låt arbetsflöden och webhooks nå interna verktyg.
:::
