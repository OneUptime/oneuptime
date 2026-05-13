# Ekstern statussidemonitor

Ekstern statussideovervågning giver dig mulighed for at overvåge tredjepartstatussider og blive advaret, når tjenester, du er afhængig af, oplever afbrydelser eller forringet ydeevne. OneUptime kontrollerer periodisk eksterne statussider (som AWS, GCP, Azure, GitHub og mere) og evaluerer deres status.

## Oversigt

Eksterne statussidemonitorer kontrollerer sundheden af tjenester, du er afhængig af, ved at forespørge deres offentlige statussider. Dette giver dig mulighed for at:

- Overvåge tilgængelighed af tredjepartstjenester, din applikation er afhængig af
- Blive advaret, når opstrøms-udbydere oplever afbrydelser
- Spore individuelle komponentstatus (f.eks. "AWS EC2 us-east-1")
- Opdage forringet ydeevne, inden det påvirker dine brugere
- Korrelere dine egne incidents med problemer hos opstrøms-udbydere

## Understøttede udbydere

OneUptime understøtter overvågning af statussider via følgende metoder:

| Udbydertype | Beskrivelse |
|---|---|
| **Auto** (standard) | Registrerer automatisk statussideformatet |
| **Atlassian Statuspage** | Statussider drevet af Atlassian Statuspage (JSON API) |
| **RSS** | Statussider, der leverer et RSS-feed |
| **Atom** | Statussider, der leverer et Atom-feed |

### Auto-detektion

Når indstillet til **Auto**, forsøger OneUptime automatisk at registrere statussideformatet:

1. Først forsøger den Atlassian Statuspage JSON API (`/api/v2/status.json` og `/api/v2/components.json`)
2. Hvis det mislykkes, forsøger den at parse siden som et RSS- eller Atom-feed
3. Som en endelig reserveløsning udfører den en grundlæggende HTTP-tilgængelighedskontrol

## Oprettelse af en Ekstern Statussidemonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Ekstern statusside** som monitortype
4. Indtast statussideURL'en, du vil overvåge
5. Vælg valgfrit en specifik udbydertype (eller lad Auto stå)
6. Angiv valgfrit et komponentnavn for at begrænse overvågning til en specifik komponent
7. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Statusside URL

Indtast URL'en til den eksterne statusside, du vil overvåge. For Atlassian Statuspage-drevne websteder er dette typisk rod-URL'en (f.eks. `https://status.example.com`). For RSS/Atom-feeds skal du indtaste feed-URL'en direkte.

### Udbydertype

Vælg udbydertypen for statussiden. Brug **Auto** (standard) for at lade OneUptime registrere formatet automatisk, eller angiv en specifik udbydertype, hvis du kender den.

### Komponentnavnefilter

Hvis statussiden rapporterer om flere komponenter, kan du valgfrit angive et komponentnavn for kun at overvåge den specifikke komponent. For eksempel, for kun at overvåge AWS EC2 i us-east-1, skal du indtaste `EC2 us-east-1` (det nøjagtige komponentnavn som vist på statussiden).

Når intet komponentnavn er angivet, overvåges statussidenes overordnede status.

### Avancerede indstillinger

#### Timeout

Den maksimale tid (i millisekunder) at vente på et svar fra statussiden. Standard er 10000 ms (10 sekunder).

#### Genforsøg

Antallet af gange der skal genforsøges, hvis anmodningen mislykkes. Standard er 3 genforsøg.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår den eksterne tjeneste betragtes som online, forringet eller offline baseret på:

- **Er online** – Om statussiden er tilgængelig og returnerer statusdata
- **Overordnet status** – Den overordnede statusindikator for statussiden (f.eks. "operational", "major_outage")
- **Komponentstatus** – Status for en specifik komponent (når du bruger komponentnavnefilter)
- **Aktive incidents** – Antallet af aktuelt aktive incidents rapporteret på statussiden
- **Svartid** – Hvor lang tid det tager at hente statussidedata

## Populære statusside-URL'er

Her er en kurateret liste over populære tjenestestatussider, du kan overvåge:

| Tjeneste | Statusside URL |
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

> **Bemærk:** Mange af disse bruger Atlassian Statuspage, så **Auto**-udbydertypen vil registrere dem automatisk.

## Incident- og advarselsskabeloner

Når du opretter incidents eller advarsler fra Eksterne Statussidemonitorer, kan du bruge følgende skabelonvariabler:

| Variabel | Beskrivelse |
|---|---|
| `{{isOnline}}` | Om statussiden er online (sand/falsk) |
| `{{responseTimeInMs}}` | Svartid i millisekunder |
| `{{failureCause}}` | Årsag til fejl, hvis nogen |
| `{{overallStatus}}` | Den overordnede statusindikatorværdi |
| `{{activeIncidentCount}}` | Antal aktive incidents |
| `{{componentStatuses}}` | JSON-array af komponentstatus |

## Bedste praksis

- **Brug Auto-udbydertype**, medmindre du kender det nøjagtige format – Auto-detektion fungerer godt til de fleste statussider
- **Overvåg specifikke komponenter**, hvis du kun er afhængig af visse tjenester (f.eks. en specifik AWS-region)
- **Opsæt incidentkorrelation** – Når dine monitorer opdager problemer, og den opstrøms statusside også viser problemer, hjælper det med at identificere årsager hurtigere
- **Kombinér med andre monitorer** – Par Eksterne Statussidemonitorer med dine egne API/Website-monitorer for omfattende synlighed
