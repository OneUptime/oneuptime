# GitHub-integration

For at integrere GitHub med din selvhostede OneUptime-instans skal du oprette en GitHub App og konfigurere de nødvendige miljøvariabler. Dette giver OneUptime mulighed for at oprette forbindelse til dine GitHub-repositories til koderepository-administration.

## Forudsætninger

- GitHub-konto med organisations-admin-adgang (til organisations-repositories) eller personlig kontoadgang
- Adgang til din OneUptime-serverkonfiguration

## Opsætningsinstruktioner

### Trin 1: Opret en GitHub App

1. Gå til GitHub og naviger til dine organisations- eller personlige indstillinger:

   - **Til organisationer:** Gå til `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **Til personlig konto:** Gå til `https://github.com/settings/apps`

2. Klik på **"New GitHub App"**

3. Udfyld registreringsformularen:
   - **GitHub App-navn:** OneUptime (eller et unikt navn) – **Gem dette navn, du skal bruge det til `GITHUB_APP_NAME`-miljøvariablen**
   - **Hjemmeside-URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Opsætnings-URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` – **Vigtigt: Denne URL er der, GitHub omdirigerer brugere til, efter de installerer appen. Den skal indstilles for at omdirigeringen fungerer.**
   - **Omdiriger ved opdatering:** Marker denne mulighed for at omdirigere brugere, efter de opdaterer app-installationen
   - **Request user authorization (OAuth) during installation:** **Marker denne obligatoriske mulighed.** OneUptime bruger OAuth til at kontrollere ejerskabet af installationen og afviser forbindelsen uden denne indstilling.
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook-hemmelighed:** Generer en sikker tilfældig streng (gem denne til senere)

### Trin 2: Konfigurer app-tilladelser

I afsnittet "Tilladelser og hændelser" skal du konfigurere følgende tilladelser:

**Repository-tilladelser:**

| Tilladelse       | Adgangsniveau | Formål                                                 |
| ---------------- | ------------- | ------------------------------------------------------ |
| Indhold          | Læs og skriv  | Læs repository-filer, push grene (kræves til AI Agent) |
| Pull requests    | Læs og skriv  | Opret og administrer pull requests                     |
| Issues           | Læs og skriv  | Læs og kommenter på issues                             |
| Commit-statusser | Læs           | Kontroller build/CI-status                             |
| Actions          | Læs           | Læs GitHub Actions-workflow-kørsler og logs            |
| Metadata         | Læs           | Grundlæggende repository-metadata (påkrævet)           |

**Organisations-tilladelser (hvis du bruger med organisationer):**

| Tilladelse | Adgangsniveau | Formål                      |
| ---------- | ------------- | --------------------------- |
| Medlemmer  | Læs           | List organisationsmedlemmer |

**Kontotilladelser:**

| Tilladelse     | Adgangsniveau | Formål                               |
| -------------- | ------------- | ------------------------------------ |
| E-mailadresser | Læs           | Læs bruger-e-mail til notifikationer |

### Trin 3: Abonnér på webhook-hændelser

OneUptime synkroniserer installation og repository-adgang via `installation` og `installation_repositories`, som GitHub Apps automatisk modtager. Andre hændelser, herunder **Pull request**, **Push** og **Workflow run**, kvitteres kun; abonnement aktiverer ikke notifikationer eller CI/CD-automatisering.

### Trin 4: Angiv installationsadgang

Under "Hvor kan denne GitHub App installeres?", vælg:

- **Kun på denne konto** – Til privat/intern brug
- **Enhver konto** – Hvis du vil have andre til at installere din app

### Trin 5: Opret GitHub App

1. Klik på **"Opret GitHub App"**
2. Du omdirigeres til din apps indstillingsside
3. Notér følgende værdier:
   - **App-ID** – Findes øverst på app-indstillingssiden
   - **Klient-ID** – Findes i afsnittet "Om"

### Trin 6: Generer klienthemmelighed

1. I dine GitHub App-indstillinger skal du rulle ned til "Klienthemmeligheder"
2. Klik på **"Generer en ny klienthemmelighed"**
3. Kopiér hemmeligheden med det samme – du vil ikke kunne se den igen

### Trin 7: Generer privat nøgle

1. Rul ned til afsnittet "Private nøgler"
2. Klik på **"Generer en privat nøgle"**
3. En `.pem`-fil downloades automatisk
4. Hold denne fil sikker – den bruges til at autentificere som GitHub App

### Trin 8: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Hvis du bruger Docker Compose, skal du tilføje disse miljøvariabler til din `config.env`-fil:

```bash
# GitHub App-konfiguration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # Det nøjagtige navn på din GitHub App (f.eks. "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Bemærk:** Til den private nøgle skal du kode den som base64 og indsætte den uden nye linjer, hvis dit miljø ikke understøtter flerlinjestrenge.

#### Kubernetes med Helm

Hvis du bruger Kubernetes med Helm, skal du tilføje disse til din `values.yaml`-fil:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # Det nøjagtige navn på din GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Vigtigt:** Genstart din OneUptime-server efter tilføjelse af disse miljøvariabler, så de træder i kraft.

### Trin 9: Installer GitHub App

1. Gå til din GitHub Apps offentlige side: `https://github.com/apps/YOUR_APP_NAME`
2. Klik på **"Installer"** eller **"Konfigurer"**
3. Vælg den organisation eller konto, hvor du vil installere appen
4. Vælg, hvilke repositories appen kan tilgå:
   - **Alle repositories** – Adgang til alle aktuelle og fremtidige repositories
   - **Kun udvalgte repositories** – Vælg specifikke repositories
5. Klik på **"Installer"**

### Trin 10: Forbind repositories i OneUptime

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Produkter** > **Kode-repositorier**
3. Klik på **"Opret repository"** eller brug GitHub App-installationsflowet
4. Hvis du omdirigeres fra GitHub, fanges installations-ID'et automatisk
5. Vælg de repositories, du vil forbinde, fra listen
6. Klik på **"Forbind"** for at tilknytte repositoryet til dit OneUptime-projekt

## Miljøvariabelreference

| Variabel                    | Beskrivelse                                                            | Påkrævet            |
| --------------------------- | ---------------------------------------------------------------------- | ------------------- |
| `GITHUB_APP_ID`             | App-ID'et fra dine GitHub App-indstillinger                            | Ja                  |
| `GITHUB_APP_NAME`           | Det nøjagtige navn på din GitHub App (bruges til installations-URL'er) | Ja                  |
| `GITHUB_APP_CLIENT_ID`      | Klient-ID'et fra dine GitHub App-indstillinger                         | Ja                  |
| `GITHUB_APP_CLIENT_SECRET`  | Den klienthemmelighed, du genererede                                   | Ja                  |
| `GITHUB_APP_PRIVATE_KEY`    | Indholdet af den private nøglefil (.pem-fil)                           | Ja                  |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook-hemmelighed til verifikation af webhook-nyttelaster            | Ja, for webhooks |

## Netværksadgang for selvhostede installationer

### Trafikretning og endpoints

| Trafik | Påkrævet adgang |
| --- | --- |
| OneUptime → GitHub | DNS og udgående HTTPS på TCP 443 til `api.github.com` for app-tokens og repository-API’er samt `github.com` for OAuth-udveksling og HTTPS-Git-operationer |
| GitHub → OneUptime | Offentlig HTTPS på TCP 443 til `POST /api/github/webhook` for synkronisering af installation og repository-adgang |
| Brugerens browser → OneUptime | Dashboard og `GET /api/github/auth/callback` for installations-/godkendelsesomdirigeringer; kan forblive tilgængelige via brugerens VPN |

Callback-/setup-URL’er bruges til en [browseromdirigering](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url); GitHubs servere kalder webhooken. Brugerens VPN giver ikke GitHub adgang til webhooken. Domænerne dækker kerneforespørgsler; værktøjer, downloads, LFS eller pakker kan kræve flere destinationer. Dette gælder GitHub.com; firewallændringer konfigurerer ikke understøttelse af et GitHub Enterprise Server-værtsnavn.

### Private installationer og callback-sikkerhed

Brug offentlig DNS og en gateway med offentligt betroet HTTPS-certifikat, komplet certifikatkæde og privat rute til OneUptime-ingress. Tillad indgående TCP 443, og offentliggør kun udbyderens POST-callbacks ovenfor. Privat `ClusterIP`, intern DNS eller en medarbejders VPN giver ikke udbyderen adgang. Opdelt DNS kan holde dashboard og browserens OAuth-ruter private under samme værtsnavn.

Indstil `HOST=oneuptime.example.com` og `HTTP_PROTOCOL=https` i `config.env`, eller `host: oneuptime.example.com` og `httpProtocol: https` i Helm. Anvend konfigurationen, og vent på genstart. Værdierne genererer URL’er; de etablerer ikke DNS, TLS eller firewallregler. Opdatér GitHub Appens webhook-, callback-, setup- og homepage-URL’er efter ændring af værtsnavn.

Bevar metode, original sti, querystreng, body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` og `X-GitHub-Delivery`. Bevar offentlig host og HTTPS via betroede proxy-headere. Undtag webhooken fra browser-SSO, CAPTCHA og proxy-login. Behold GitHubs SSL-verifikation, og indstil samme `GITHUB_APP_WEBHOOK_SECRET` i begge systemer: OneUptime afviser usignerede forespørgsler og kan ikke validere webhooks uden hemmeligheden. Se [GitHubs validering](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Hvis du også begrænser kilde-IP’er, brug og opdatér jævnligt `hooks`-områderne fra GitHubs Meta API. Brug ikke GitHub Actions-runnerområder, og behold signaturkontrollen. GitHub advarer om, at [adresser ændres, og listen ikke er komplet](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Kontrollér adgang og forstå begrænsninger

Fuldfør installationen fra OneUptime, og se **Advanced > Recent Deliveries** i GitHub Appen. Send eller gentag en testlevering, og kontrollér videresendelse og accept. Tilføj eller fjern et test-repository fra installationen, og kontrollér den tilknyttede liste. GitHub beskriver [leveringsdiagnostik](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) og kræver [en 2xx-kvittering inden ti sekunder](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Et browser-GET tester ikke et signeret POST.

Uden indgående adgang kan browsergodkendelse og udgående API-/Git-operationer virke, men installationssletninger og ændringer i repository-adgang synkroniseres ikke via webhooks. OneUptime behandler aktuelt `installation` og `installation_repositories`; accept af andre hændelser betyder ikke yderligere automatisering. [Indstillingen for privat netværksadgang](/docs/self-hosted/private-network-access) styrer udgående forespørgsler til private destinationer og gør ikke webhooken tilgængelig.

## Fejlfinding

### Almindelige problemer

**Omdirigeres ikke tilbage til OneUptime efter installation af GitHub App:**

- Sørg for, at **Opsætnings-URL** er konfigureret i dine GitHub App-indstillinger til: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Gå til dine GitHub App-indstillinger > afsnittet "Post-installation" og bekræft, at Opsætnings-URL er korrekt indstillet
- Muligheden "Omdirigér ved opdatering" bør også være markeret
- Bemærk: Opsætnings-URL'en er forskellig fra Callback URL'en – begge skal pege på det samme `/api/github/auth/callback`-endpoint

**Fejlen "GitHub App er ikke konfigureret":**

- Sørg for, at `GITHUB_APP_CLIENT_ID`-miljøvariablen er indstillet
- Genstart din OneUptime-server efter indstilling af miljøvariabler

**Fejlen "Ugyldig webhook-signatur":**

- Bekræft, at din `GITHUB_APP_WEBHOOK_SECRET` matcher hemmeligheden konfigureret i GitHub
- Sørg for, at webhook-URL'en er korrekt og tilgængelig fra internettet

**Fejlen "Kunne ikke hente installations-adgangstoken":**

- Bekræft, at din `GITHUB_APP_PRIVATE_KEY` er korrekt formateret
- Kontroller, at den private nøgle inkluderer BEGIN/END-markererne
- Sørg for, at App-ID'et er korrekt

**Kan ikke se repositories efter installation:**

- Bekræft, at GitHub App har adgang til de repositories, du vil forbinde
- Kontroller installationstilladelserne i GitHub (Indstillinger > Applikationer > Installerede GitHub Apps)

**Webhook-hændelser modtages ikke:**

- Sørg for, at din webhook-URL er offentligt tilgængeligt
- Kontroller GitHub App-webhook-leveringslogge i dine app-indstillinger
- Bekræft, at webhook-hemmeligheden er korrekt konfigureret

### Kontrol af webhook-leverancer

1. Gå til dine GitHub App-indstillinger
2. Klik på "Avanceret" i sidebjælken
3. Se "Seneste leverancer" for at se webhook-forsøg og svar

## Bedste sikkerhedspraksis

1. **Roter hemmeligheder regelmæssigt** – Generer nye klienthemmeligheder og private nøgler periodisk
2. **Brug webhook-hemmeligheder** – Konfigurer altid en webhook-hemmelighed for at verificere nytteinlastautenticitet
3. **Begræns repository-adgang** – Giv kun adgang til repositories, der skal forbindes
4. **Overvåg webhook-leverancer** – Kontroller regelmæssigt for mislykkede leverancer eller mistænkelig aktivitet
5. **Hold private nøgler sikre** – Commit aldrig private nøgler til versionskontrol

## Support

Hvis du støder på problemer med GitHub-integrationen:

1. Kontroller fejlfindingsafsnittet ovenfor
2. Gennemgå OneUptime-logs for detaljerede fejlmeddelelser
3. Kontakt os på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi byder feedback til forbedring af denne integration velkommen!
