# GitHub-integration

För att integrera GitHub med din egeninstallerade OneUptime-instans behöver du skapa en GitHub App och konfigurera de obligatoriska miljövariablerna. Detta gör det möjligt för OneUptime att ansluta till dina GitHub-repositorier för hantering av kodrepositorie.

## Förutsättningar

- GitHub-konto med organisationsadministratörsåtkomst (för organisationsrepositorier) eller personlig kontoåtkomst
- Åtkomst till din OneUptime-serverkonfiguration

## Konfigurationsinstruktioner

### Steg 1: Skapa en GitHub App

1. Gå till GitHub och navigera till dina organisations- eller personliga inställningar:

   - **För organisationer:** Gå till `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **För personligt konto:** Gå till `https://github.com/settings/apps`

2. Klicka på **"New GitHub App"**

3. Fyll i registreringsformuläret:
   - **GitHub App-namn:** OneUptime (eller valfritt unikt namn) – **Spara detta namn, du behöver det för miljövariabeln `GITHUB_APP_NAME`**
   - **Startsida-URL:** `https://your-oneuptime-domain.com`
   - **Callback-URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup-URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` – **Viktigt: Det är dit GitHub dirigerar användare efter att de installerat appen.**
   - **Redirect on update:** Markera det här alternativet för att dirigera användare efter att de uppdaterar appinstallationen
   - **Webhook-URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook-hemlighet:** Generera en säker slumpmässig sträng (spara denna för senare)

### Steg 2: Konfigurera appbehörigheter

I avsnittet "Permissions & events", konfigurera följande behörigheter:

**Repositoriebehörigheter:**

| Behörighet      | Åtkomstnivå   | Syfte                                                  |
| --------------- | ------------- | ------------------------------------------------------ |
| Contents        | Läs och skriv | Läs repositoriefiler, push-grenar (krävs för AI-agent) |
| Pull requests   | Läs och skriv | Skapa och hantera pull requests                        |
| Issues          | Läs och skriv | Läs och kommentera ärenden                             |
| Commit statuses | Läs           | Kontrollera bygge/CI-status                            |
| Actions         | Läs           | Läs GitHub Actions-arbetsflödeskörningar och loggar    |
| Metadata        | Läs           | Grundläggande repositoriemetadata (obligatorisk)       |

**Organisationsbehörigheter (om du använder med organisationer):**

| Behörighet | Åtkomstnivå | Syfte                        |
| ---------- | ----------- | ---------------------------- |
| Members    | Läs         | Lista organisationsmedlemmar |

**Kontobehörigheter:**

| Behörighet      | Åtkomstnivå | Syfte                                 |
| --------------- | ----------- | ------------------------------------- |
| Email addresses | Läs         | Läs användares e-post för aviseringar |

### Steg 3: Prenumerera på webhook-händelser

Händelser för OneUptime för att ta emot realtidsuppdateringar, prenumerera på dessa webhook-händelser:

- **Pull request** – Ta emot aviseringar när PRs öppnas, stängs eller slås samman
- **Push** – Ta emot aviseringar när kod pushas
- **Workflow run** – Ta emot CI/CD-statusuppdateringar

### Steg 4: Ange installationsåtkomst

Under "Where can this GitHub App be installed?", välj:

- **Only on this account** – För privat/intern användning
- **Any account** – Om du vill att andra ska kunna installera din app

### Steg 5: Skapa GitHub App

1. Klicka på **"Create GitHub App"**
2. Du omdirigeras till appens inställningssida
3. Anteckna följande värden:
   - **App ID** – Finns högst upp på appinställningssidan
   - **Client ID** – Finns i avsnittet "About"

### Steg 6: Generera klienthemlighet

1. I dina GitHub App-inställningar, scrolla till "Client secrets"
2. Klicka på **"Generate a new client secret"**
3. Kopiera hemligheten omedelbart – du kan inte se den igen

### Steg 7: Generera privat nyckel

1. Scrolla ned till avsnittet "Private keys"
2. Klicka på **"Generate a private key"**
3. En `.pem`-fil laddas ned automatiskt
4. Håll den här filen säker – den används för autentisering som GitHub App

### Steg 8: Konfigurera OneUptime-miljövariabler

#### Docker Compose

Om du använder Docker Compose, lägg till dessa miljövariabler i din `config.env`-fil:

```bash
# GitHub App-konfiguration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # Det exakta namnet på din GitHub App (t.ex. "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Observera:** För den privata nyckeln, koda den som base64 och klistra in den utan radbrytningar om din miljö inte stöder flerlinjssträngar.

#### Kubernetes med Helm

Om du använder Kubernetes med Helm, lägg till dessa i din `values.yaml`-fil:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # Det exakta namnet på din GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Viktigt:** Starta om din OneUptime-server efter att du har lagt till dessa miljövariabler för att de ska träda i kraft.

### Steg 9: Installera GitHub App

1. Gå till din GitHub Apps offentliga sida: `https://github.com/apps/YOUR_APP_NAME`
2. Klicka på **"Install"** eller **"Configure"**
3. Välj den organisation eller det konto där du vill installera appen
4. Välj vilka repositorier appen kan komma åt:
   - **All repositories** – Åtkomst till alla nuvarande och framtida repositorier
   - **Only select repositories** – Välj specifika repositorier
5. Klicka på **"Install"**

### Steg 10: Anslut repositorier i OneUptime

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Mer** > **Kodrepositorie**
3. Klicka på **"Skapa repositorie"** eller använd GitHub App-installationsflödet
4. Om du omdirigerades från GitHub registreras installations-ID:t automatiskt
5. Välj de repositorier du vill ansluta från listan
6. Klicka på **"Anslut"** för att länka repositoriet till ditt OneUptime-projekt

## Referens för miljövariabler

| Variabel                    | Beskrivning                                                            | Obligatorisk            |
| --------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `GITHUB_APP_ID`             | App ID från dina GitHub App-inställningar                              | Ja                      |
| `GITHUB_APP_NAME`           | Det exakta namnet på din GitHub App (används för installations-URL:er) | Ja                      |
| `GITHUB_APP_CLIENT_ID`      | Klient-ID:t från dina GitHub App-inställningar                         | Ja                      |
| `GITHUB_APP_CLIENT_SECRET`  | Klienthemligheten du genererade                                        | Ja                      |
| `GITHUB_APP_PRIVATE_KEY`    | Innehållet i den privata nyckeln (.pem-filen)                          | Ja                      |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook-hemligheten för att verifiera webhook-nyttolaster              | Nej (men rekommenderas) |

## Felsökning

### Omdirigeras inte tillbaka till OneUptime efter installation av GitHub App

- Se till att **Setup-URL** är konfigurerad i dina GitHub App-inställningar till: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Gå till dina GitHub App-inställningar > avsnittet "Post installation" och verifiera att Setup-URL:en är korrekt angiven
- Alternativet "Redirect on update" bör också vara markerat

**"GitHub App is not configured"-fel:**

- Se till att miljövariabeln `GITHUB_APP_CLIENT_ID` är angiven
- Starta om din OneUptime-server efter att ha angett miljövariabler

**"Invalid webhook signature"-fel:**

- Verifiera att din `GITHUB_APP_WEBHOOK_SECRET` matchar hemligheten som konfigurerats i GitHub
- Se till att webhook-URL:en är korrekt och tillgänglig från internet

## Säkerhetsbästa praxis

1. **Rotera hemligheter regelbundet** – Generera nya klienthemligheter och privata nycklar periodiskt
2. **Använd webhook-hemligheter** – Konfigurera alltid en webhook-hemlighet för att verifiera nyttolastens äkthet
3. **Begränsa repositorieåtkomst** – Bevilja bara åtkomst till repositorier som behöver anslutas
4. **Övervaka webhook-leveranser** – Kontrollera regelbundet om det finns misslyckade leveranser eller misstänkt aktivitet
5. **Håll privata nycklar säkra** – Spara aldrig privata nycklar i versionskontroll

## Support

Om du stöter på problem med GitHub-integrationen:

1. Kontrollera felsökningsavsnittet ovan
2. Granska OneUptime-loggarna för detaljerade felmeddelanden
3. Kontakta oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi välkomnar feedback för att förbättra denna integration!
