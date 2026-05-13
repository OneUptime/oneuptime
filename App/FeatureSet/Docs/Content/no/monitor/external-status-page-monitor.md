# Ekstern statussidemonitor

Overvåking av eksterne statussider lar deg overvåke tredjeparts statussider og bli varslet når tjenester du er avhengig av opplever nedetid eller degradert ytelse. OneUptime sjekker periodisk eksterne statussider (som AWS, GCP, Azure, GitHub og mer) og evaluerer statusen deres.

## Oversikt

Monitorer for eksterne statussider sjekker helsen til tjenester du er avhengig av ved å spørre deres offentlige statussider. Dette gjør det mulig å:

- Overvåke tilgjengeligheten til tredjeparts tjenester applikasjonen din er avhengig av
- Bli varslet når oppstrømleverandører opplever nedetid
- Spore individuelle komponentstatuser (f.eks. "AWS EC2 us-east-1")
- Oppdage degradert ytelse før det påvirker brukerne dine
- Korrelere egne hendelser med problemer hos oppstrømleverandøren

## Støttede leverandører

OneUptime støtter overvåking av statussider via følgende metoder:

| Leverandørtype | Beskrivelse |
|---|---|
| **Auto** (standard) | Oppdager automatisk formatet til statussiden |
| **Atlassian Statuspage** | Statussider drevet av Atlassian Statuspage (JSON API) |
| **RSS** | Statussider som tilbyr en RSS-strøm |
| **Atom** | Statussider som tilbyr en Atom-strøm |

### Automatisk oppdagelse

Når det er satt til **Auto**, vil OneUptime forsøke å oppdage formatet til statussiden automatisk:

1. Først prøver den Atlassian Statuspage JSON API (`/api/v2/status.json` og `/api/v2/components.json`)
2. Hvis det mislykkes, forsøker den å analysere siden som en RSS- eller Atom-strøm
3. Som siste utvei utfører den en grunnleggende HTTP-tilgjengelighetssjekk

## Opprette en ekstern statussidemonitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **External Status Page** som monitortype
4. Skriv inn URL-en til statussiden du ønsker å overvåke
5. Velg eventuelt en spesifikk leverandørtype (eller la den stå som Auto)
6. Skriv eventuelt inn et komponentnavn for å begrense overvåkingen til en spesifikk komponent
7. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### URL til statussiden

Skriv inn URL-en til den eksterne statussiden du ønsker å overvåke. For Atlassian Statuspage-drevne nettsteder er dette vanligvis rot-URL-en (f.eks. `https://status.example.com`). For RSS/Atom-strømmer skriver du inn strøm-URL-en direkte.

### Leverandørtype

Velg leverandørtype for statussiden. Bruk **Auto** (standard) for å la OneUptime oppdage formatet automatisk, eller spesifiser en bestemt leverandørtype hvis du kjenner den.

### Komponentnavnfilter

Hvis statussiden rapporterer om flere komponenter, kan du eventuelt angi et komponentnavn for bare å overvåke den spesifikke komponenten. For eksempel, for å overvåke bare AWS EC2 i us-east-1, skriver du inn `EC2 us-east-1` (det nøyaktige komponentnavnet som vises på statussiden).

Når intet komponentnavn er angitt, overvåkes den overordnede statusen til statussiden.

### Avanserte alternativer

#### Tidsavbrudd

Maksimal tid (i millisekunder) det ventes på svar fra statussiden. Standard er 10000 ms (10 sekunder).

#### Nye forsøk

Antall ganger forespørselen forsøkes på nytt hvis den mislykkes. Standard er 3 nye forsøk.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når den eksterne tjenesten anses som tilgjengelig, degradert eller utilgjengelig basert på:

- **Is Online** – Om statussiden er tilgjengelig og returnerer statusdata
- **Overall Status** – Den overordnede statusindikatoren for statussiden (f.eks. "operational", "major_outage")
- **Component Status** – Status for en spesifikk komponent (når komponentnavnfilter brukes)
- **Active Incidents** – Antallet aktive hendelser rapportert på statussiden
- **Response Time** – Hvor lang tid det tar å hente statussidedataene

## Populære statussider-URL-er

Her er en kurert liste over populære tjeneste-statussider du kan overvåke:

| Tjeneste | URL til statussiden |
|---|---|
| AWS | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform | `https://status.cloud.google.com` |
| Microsoft Azure | `https://status.azure.com` |
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Datadog | `https://status.datadoghq.com` |
| PagerDuty | `https://status.pagerduty.com` |
| Twilio | `https://status.twilio.com` |
| Stripe | `https://status.stripe.com` |
| Slack | `https://status.slack.com` |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com` |
| Vercel | `https://www.vercel-status.com` |
| Netlify | `https://www.netlifystatus.com` |
| DigitalOcean | `https://status.digitalocean.com` |
| Heroku | `https://status.heroku.com` |
| MongoDB Atlas | `https://status.cloud.mongodb.com` |
| Fastly | `https://status.fastly.com` |
| New Relic | `https://status.newrelic.com` |
| Sentry | `https://status.sentry.io` |
| CircleCI | `https://status.circleci.com` |

> **Merk:** Mange av disse bruker Atlassian Statuspage, så leverandørtypen **Auto** vil oppdage dem automatisk.

## Maler for hendelser og varsler

Når du oppretter hendelser eller varsler fra monitorer for eksterne statussider, kan du bruke følgende malvariabler:

| Variabel | Beskrivelse |
|---|---|
| `{{isOnline}}` | Om statussiden er tilgjengelig (true/false) |
| `{{responseTimeInMs}}` | Svartid i millisekunder |
| `{{failureCause}}` | Årsak til feil, hvis noen |
| `{{overallStatus}}` | Den overordnede statusindikatorverdien |
| `{{activeIncidentCount}}` | Antall aktive hendelser |
| `{{componentStatuses}}` | JSON-array med komponentstatuser |

## Beste praksis

- **Bruk leverandørtypen Auto** med mindre du kjenner det nøyaktige formatet – automatisk oppdagelse fungerer godt for de fleste statussider
- **Overvåk spesifikke komponenter** hvis du bare er avhengig av visse tjenester (f.eks. en bestemt AWS-region)
- **Sett opp hendelseskorrelasjon** – når monitorene dine oppdager problemer og oppstrømsstatussiden også viser problemer, hjelper det med å identifisere rotårsaker raskere
- **Kombiner med andre monitorer** – par monitorer for eksterne statussider med egne API/nettstedmonitorer for fullstendig synlighet
