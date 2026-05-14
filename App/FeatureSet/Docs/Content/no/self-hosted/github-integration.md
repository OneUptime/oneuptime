# GitHub-integrasjon

For å integrere GitHub med din selvhostede OneUptime-instans må du opprette en GitHub App og konfigurere de nødvendige miljøvariablene. Dette lar OneUptime koble til GitHub-repositoriene dine for administrasjon av kodelagre.

## Forutsetninger

- GitHub-konto med organisasjons-admin-tilgang (for organisasjonsrepositorier) eller personlig kontotilgang
- Tilgang til OneUptime-serverkonfigurasjonen din

## Installasjonsinstruksjoner

### Trinn 1: Opprett en GitHub App

1. Gå til GitHub og naviger til organisasjons- eller personlige innstillinger:
   - **For organisasjoner:** Gå til `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **For personlig konto:** Gå til `https://github.com/settings/apps`

2. Klikk **"New GitHub App"**

3. Fyll ut registreringsskjemaet:
   - **GitHub App name:** OneUptime (eller et unikt navn) – **Lagre dette navnet, du trenger det for `GITHUB_APP_NAME`-miljøvariabelen**
   - **Homepage URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` – **Viktig: Dette er URL-en GitHub omdirigerer brukere til etter at de har installert appen. Den må settes for at omdirigeringen skal fungere.**
   - **Redirect on update:** Merk av dette alternativet for å omdirigere brukere etter at de oppdaterer appinstallasjonen
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** Generer en sikker tilfeldig streng (lagre denne til senere)

### Trinn 2: Konfigurer apptillatelser

I seksjonen "Permissions & events", konfigurer følgende tillatelser:

**Repository-tillatelser:**

| Tillatelse | Tilgangsnivå | Formål |
|------------|--------------|--------|
| Contents | Read & Write | Les repository-filer, push grener (påkrevd for AI-agent) |
| Pull requests | Read & Write | Opprett og administrer pull requests |
| Issues | Read & Write | Les og kommenter på saker |
| Commit statuses | Read | Sjekk bygg/CI-status |
| Actions | Read | Les GitHub Actions-arbeidsflytkjøringer og logger |
| Metadata | Read | Grunnleggende repository-metadata (påkrevd) |

**Organisasjonstillatelser (hvis brukt med organisasjoner):**

| Tillatelse | Tilgangsnivå | Formål |
|------------|--------------|--------|
| Members | Read | List opp organisasjonsmedlemmer |

**Kontotillatelser:**

| Tillatelse | Tilgangsnivå | Formål |
|------------|--------------|--------|
| Email addresses | Read | Les bruker-e-post for varsler |

### Trinn 3: Abonner på webhook-hendelser

Hendelser for OneUptime å motta sanntidsoppdateringer – abonner på disse webhook-hendelsene:

- **Pull request** – Motta varsler når PR-er åpnes, lukkes eller slås sammen
- **Push** – Motta varsler når kode pushes
- **Workflow run** – Motta CI/CD-statusoppdateringer

### Trinn 4: Angi installasjonstilgang

Under "Where can this GitHub App be installed?", velg:
- **Only on this account** – For privat/intern bruk
- **Any account** – Hvis du vil at andre skal kunne installere appen

### Trinn 5: Opprett GitHub App

1. Klikk **"Create GitHub App"**
2. Du omdirigeres til appens innstillingsside
3. Noter ned følgende verdier:
   - **App ID** – Finnes øverst på appens innstillingsside
   - **Client ID** – Finnes i "About"-seksjonen

### Trinn 6: Generer klienthemmelighet

1. I GitHub App-innstillingene, bla til "Client secrets"
2. Klikk **"Generate a new client secret"**
3. Kopier hemmeligheten umiddelbart – du vil ikke kunne se den igjen

### Trinn 7: Generer privat nøkkel

1. Bla ned til seksjonen "Private keys"
2. Klikk **"Generate a private key"**
3. En `.pem`-fil lastes ned automatisk
4. Behold denne filen sikkert – den brukes til autentisering som GitHub App

### Trinn 8: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Hvis du bruker Docker Compose, legg til disse miljøvariablene i `config.env`-filen din:

```bash
# GitHub App-konfigurasjon
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # Det nøyaktige navnet på GitHub App-en din (f.eks. "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Merk:** For den private nøkkelen, kode den som base64 og lim den inn uten linjeskift hvis miljøet ditt ikke støtter flerlinjestrenger.

#### Kubernetes med Helm

Hvis du bruker Kubernetes med Helm, legg til disse i `values.yaml`-filen din:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # Det nøyaktige navnet på GitHub App-en din
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Viktig:** Start OneUptime-serveren på nytt etter å ha lagt til disse miljøvariablene slik at de trer i kraft.

### Trinn 9: Installer GitHub App

1. Gå til GitHub App-ens offentlige side: `https://github.com/apps/YOUR_APP_NAME`
2. Klikk **"Install"** eller **"Configure"**
3. Velg organisasjonen eller kontoen der du vil installere appen
4. Velg hvilke repositorier appen kan få tilgang til:
   - **All repositories** – Tilgang til alle nåværende og fremtidige repositorier
   - **Only select repositories** – Velg spesifikke repositorier
5. Klikk **"Install"**

### Trinn 10: Koble repositorier i OneUptime

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **More** > **Code Repositories**
3. Klikk **"Create Repository"** eller bruk GitHub App-installasjonsflyten
4. Hvis omdirigert fra GitHub, fanges installasjons-ID-en automatisk opp
5. Velg repositoriene du ønsker å koble fra listen
6. Klikk **"Connect"** for å koble repositoriet til OneUptime-prosjektet ditt

## Referanse for miljøvariabler

| Variabel | Beskrivelse | Påkrevd |
|----------|-------------|---------|
| `GITHUB_APP_ID` | App-ID-en fra GitHub App-innstillingene dine | Ja |
| `GITHUB_APP_NAME` | Det nøyaktige navnet på GitHub App-en din (brukes for installasjons-URL-er) | Ja |
| `GITHUB_APP_CLIENT_ID` | Klient-ID-en fra GitHub App-innstillingene dine | Ja |
| `GITHUB_APP_CLIENT_SECRET` | Klienthemmeligheten du genererte | Ja |
| `GITHUB_APP_PRIVATE_KEY` | Innholdet i den private nøkkelen (.pem-fil) | Ja |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook-hemmeligheten for verifisering av webhook-nyttelaster | Nei (men anbefalt) |

## Feilsøking

### Vanlige problemer

**Ikke omdirigert tilbake til OneUptime etter installasjon av GitHub App:**
- Sørg for at **Setup URL** er konfigurert i GitHub App-innstillingene til: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Gå til GitHub App-innstillinger > "Post installation"-seksjonen og verifiser at Setup URL er satt korrekt
- Alternativet "Redirect on update" bør også være avkrysset
- Merk: Setup URL er forskjellig fra Callback URL – begge bør peke til det samme `/api/github/auth/callback`-endepunktet

**Feil "GitHub App is not configured":**
- Sørg for at `GITHUB_APP_CLIENT_ID`-miljøvariabelen er satt
- Start OneUptime-serveren på nytt etter at miljøvariabler er satt

**Feil "Invalid webhook signature":**
- Verifiser at `GITHUB_APP_WEBHOOK_SECRET` samsvarer med hemmeligheten konfigurert i GitHub
- Sørg for at webhook-URL-en er korrekt og tilgjengelig fra internett

**Feil "Failed to get installation access token":**
- Verifiser at `GITHUB_APP_PRIVATE_KEY` er korrekt formatert
- Sjekk at den private nøkkelen inkluderer BEGIN/END-markørene
- Sørg for at App-ID-en er korrekt

**Kan ikke se repositorier etter installasjon:**
- Verifiser at GitHub App har tilgang til repositoriene du ønsker å koble til
- Sjekk installasjonstillatelsene i GitHub (Innstillinger > Applikasjoner > Installerte GitHub Apps)

**Webhook-hendelser mottas ikke:**
- Sørg for at webhook-URL-en er offentlig tilgjengelig
- Sjekk GitHub App webhook-leveringslogger i appinnstillingene
- Verifiser at webhook-hemmeligheten er korrekt konfigurert

### Sjekke webhook-leveringer

1. Gå til GitHub App-innstillingene
2. Klikk på "Advanced" i sidefeltet
3. Se "Recent Deliveries" for å se webhook-forsøk og svar

## Beste sikkerhetspraksis

1. **Roter hemmeligheter regelmessig** – Generer nye klienthemmeligheter og private nøkler periodisk
2. **Bruk webhook-hemmeligheter** – Konfigurer alltid en webhook-hemmelighet for å verifisere nyttelastautentisitet
3. **Begrens repositorietilgang** – Gi bare tilgang til repositorier som trenger å kobles til
4. **Overvåk webhook-leveringer** – Sjekk regelmessig for mislykkede leveringer eller mistenkelig aktivitet
5. **Hold private nøkler sikre** – Commit aldri private nøkler til versjonskontroll

## Støtte

Hvis du støter på problemer med GitHub-integrasjonen, vennligst:

1. Sjekk feilsøkingsseksjonen ovenfor
2. Se gjennom OneUptime-loggene for detaljerte feilmeldinger
3. Kontakt oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi setter pris på tilbakemeldinger for å forbedre denne integrasjonen!
