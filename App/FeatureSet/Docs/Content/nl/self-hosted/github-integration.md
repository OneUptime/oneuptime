# GitHub-integratie

Om GitHub te integreren met uw zelf-gehoste OneUptime-instantie, moet u een GitHub App aanmaken en de vereiste omgevingsvariabelen configureren. Dit stelt OneUptime in staat verbinding te maken met uw GitHub-repositories voor beheer van code-repositories.

## Vereisten

- GitHub-account met organisatiebeheerdertoestemming (voor organisatierepositories) of persoonlijke accounttoegang
- Toegang tot uw OneUptime-serverconfiguratie

## Installatie-instructies

### Stap 1: Een GitHub App aanmaken

1. Ga naar GitHub en navigeer naar uw organisatie- of persoonlijke instellingen:
   - **Voor organisaties:** Ga naar `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **Voor persoonlijk account:** Ga naar `https://github.com/settings/apps`

2. Klik op **"Nieuwe GitHub App"**

3. Vul het registratieformulier in:
   - **GitHub App-naam:** OneUptime (of een unieke naam) - **Sla deze naam op, u heeft hem nodig voor de omgevingsvariabele `GITHUB_APP_NAME`**
   - **Homepage-URL:** `https://your-oneuptime-domain.com`
   - **Callback-URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Installatie-URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **Belangrijk: Dit is de URL waarnaar GitHub gebruikers omleidt nadat ze de app hebben geïnstalleerd. Deze moet worden ingesteld voor de omleiding om te werken.**
   - **Omleiden bij update:** Vink deze optie aan om gebruikers om te leiden nadat ze de app-installatie hebben bijgewerkt
   - **Webhook-URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhookgeheim:** Genereer een veilige willekeurige tekenreeks (sla dit op voor later)

### Stap 2: App-machtigingen configureren

Configureer in de sectie "Machtigingen en gebeurtenissen" de volgende machtigingen:

**Repositorymachtigingen:**

| Machtiging | Toegangsniveau | Doel |
|------------|--------------|---------|
| Inhoud | Lezen & Schrijven | Repositorybestanden lezen, branches pushen (vereist voor AI Agent) |
| Pull requests | Lezen & Schrijven | Pull requests aanmaken en beheren |
| Issues | Lezen & Schrijven | Issues lezen en becommentariëren |
| Commit-statussen | Lezen | Build/CI-status controleren |
| Actions | Lezen | GitHub Actions workflow-uitvoeringen en logboeken lezen |
| Metadata | Lezen | Basisrepository-metadata (vereist) |

**Organisatiemachtigingen (indien gebruikt met organisaties):**

| Machtiging | Toegangsniveau | Doel |
|------------|--------------|---------|
| Leden | Lezen | Organisatieleden weergeven |

**Accountmachtigingen:**

| Machtiging | Toegangsniveau | Doel |
|------------|--------------|---------|
| E-mailadressen | Lezen | Gebruikers-e-mail lezen voor meldingen |

### Stap 3: Abonneren op webhookgebeurtenissen

Abonneer u op deze webhookgebeurtenissen om realtime updates te ontvangen:

- **Pull request** - Meldingen ontvangen wanneer PR's worden geopend, gesloten of samengevoegd
- **Push** - Meldingen ontvangen wanneer code wordt gepusht
- **Workflow run** - CI/CD-statusupdates ontvangen

### Stap 4: Installatietoegang instellen

Kies onder "Waar kan deze GitHub App worden geïnstalleerd?":
- **Alleen op dit account** - Voor privé/intern gebruik
- **Elk account** - Als u wilt dat anderen uw app installeren

### Stap 5: De GitHub App aanmaken

1. Klik op **"GitHub App aanmaken"**
2. U wordt doorgestuurd naar de instellingenpagina van uw app
3. Noteer de volgende waarden:
   - **App-ID** - Gevonden bovenaan de app-instellingenpagina
   - **Client-ID** - Gevonden in de sectie "Over"

### Stap 6: Clientgeheim genereren

1. Scrol in uw GitHub App-instellingen naar "Clientgeheimen"
2. Klik op **"Een nieuw clientgeheim genereren"**
3. Kopieer het geheim onmiddellijk — u kunt het later niet meer zien

### Stap 7: Privésleutel genereren

1. Scrol omlaag naar de sectie "Privésleutels"
2. Klik op **"Een privésleutel genereren"**
3. Een `.pem`-bestand wordt automatisch gedownload
4. Houd dit bestand veilig — het wordt gebruikt voor authenticatie als de GitHub App

### Stap 8: OneUptime omgevingsvariabelen configureren

#### Docker Compose

Als u Docker Compose gebruikt, voeg dan deze omgevingsvariabelen toe aan uw `config.env`-bestand:

```bash
# GitHub App-configuratie
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # De exacte naam van uw GitHub App (bijv. "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Opmerking:** Codeer de privésleutel als base64 en plak hem zonder nieuwe regels als uw omgeving geen meerlijnige tekenreeksen ondersteunt.

#### Kubernetes met Helm

Als u Kubernetes met Helm gebruikt, voeg dan deze toe aan uw `values.yaml`-bestand:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # De exacte naam van uw GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Belangrijk:** Herstart uw OneUptime-server na het toevoegen van deze omgevingsvariabelen zodat ze van kracht worden.

### Stap 9: De GitHub App installeren

1. Ga naar de openbare pagina van uw GitHub App: `https://github.com/apps/YOUR_APP_NAME`
2. Klik op **"Installeren"** of **"Configureren"**
3. Selecteer de organisatie of het account waar u de app wilt installeren
4. Kies welke repositories de app mag benaderen:
   - **Alle repositories** - Toegang tot alle huidige en toekomstige repositories
   - **Alleen geselecteerde repositories** - Kies specifieke repositories
5. Klik op **"Installeren"**

### Stap 10: Repositories verbinden in OneUptime

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Meer** > **Code-repositories**
3. Klik op **"Repository aanmaken"** of gebruik de GitHub App-installatiestroom
4. Als u wordt doorgestuurd vanuit GitHub, wordt de installatie-ID automatisch vastgelegd
5. Selecteer de repositories die u wilt verbinden uit de lijst
6. Klik op **"Verbinden"** om de repository te koppelen aan uw OneUptime-project

## Omgevingsvariabelen referentie

| Variabele | Beschrijving | Vereist |
|----------|-------------|----------|
| `GITHUB_APP_ID` | Het App-ID van uw GitHub App-instellingen | Ja |
| `GITHUB_APP_NAME` | De exacte naam van uw GitHub App (gebruikt voor installatie-URL's) | Ja |
| `GITHUB_APP_CLIENT_ID` | Het Client-ID van uw GitHub App-instellingen | Ja |
| `GITHUB_APP_CLIENT_SECRET` | Het clientgeheim dat u hebt gegenereerd | Ja |
| `GITHUB_APP_PRIVATE_KEY` | De inhoud van het privésleutelbestand (.pem) | Ja |
| `GITHUB_APP_WEBHOOK_SECRET` | Het webhookgeheim voor het verifiëren van webhook-payloads | Nee (maar aanbevolen) |

## Probleemoplossing

### Veelgebruikte problemen

**Niet omgeleid terug naar OneUptime na installatie van de GitHub App:**
- Zorg dat de **Installatie-URL** is geconfigureerd in uw GitHub App-instellingen op: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Ga naar uw GitHub App-instellingen > sectie "Na installatie" en verifieer dat de Installatie-URL correct is ingesteld
- De optie "Omleiden bij update" moet ook zijn aangevinkt
- Opmerking: De Installatie-URL verschilt van de Callback-URL — beide moeten verwijzen naar hetzelfde `/api/github/auth/callback`-eindpunt

**Fout "GitHub App is not configured":**
- Zorg dat de omgevingsvariabele `GITHUB_APP_CLIENT_ID` is ingesteld
- Herstart uw OneUptime-server na het instellen van omgevingsvariabelen

**Fout "Invalid webhook signature":**
- Controleer of uw `GITHUB_APP_WEBHOOK_SECRET` overeenkomt met het geheim dat is geconfigureerd in GitHub
- Zorg dat de webhook-URL correct en bereikbaar is vanaf het internet

**Fout "Failed to get installation access token":**
- Verifieer dat uw `GITHUB_APP_PRIVATE_KEY` correct is opgemaakt
- Controleer of de privésleutel de BEGIN/END-markeringen bevat
- Zorg dat het App-ID correct is

**Kan repositories niet zien na installatie:**
- Verifieer dat de GitHub App toegang heeft tot de repositories die u wilt verbinden
- Controleer de installatiemachtigingen in GitHub (Instellingen > Applicaties > Geïnstalleerde GitHub Apps)

**Webhookgebeurtenissen worden niet ontvangen:**
- Zorg dat uw webhook-URL openbaar bereikbaar is
- Controleer de webhook-bezorglogboeken van de GitHub App in uw app-instellingen
- Verifieer dat het webhookgeheim correct is geconfigureerd

### Webhook-bezorgingen controleren

1. Ga naar uw GitHub App-instellingen
2. Klik op "Geavanceerd" in de zijbalk
3. Bekijk "Recente bezorgingen" om webhookattempts en responses te zien

## Beveiligingsbest practices

1. **Roteer geheimen regelmatig** — Genereer periodiek nieuwe clientgeheimen en privésleutels
2. **Gebruik webhookgeheimen** — Configureer altijd een webhookgeheim om de authenticiteit van payloads te verifiëren
3. **Beperk repositorytoegang** — Verleen alleen toegang tot repositories die verbonden moeten worden
4. **Bewaken webhook-bezorgingen** — Controleer regelmatig op mislukte bezorgingen of verdachte activiteit
5. **Houd privésleutels veilig** — Leg privésleutels nooit vast in versiebeheer

## Ondersteuning

Als u problemen ondervindt met de GitHub-integratie:

1. Controleer de bovenstaande sectie voor probleemoplossing
2. Bekijk de OneUptime-logboeken voor gedetailleerde foutmeldingen
3. Neem contact op via [hello@oneuptime.com](mailto:hello@oneuptime.com)

Feedback om deze integratie te verbeteren is van harte welkom!
