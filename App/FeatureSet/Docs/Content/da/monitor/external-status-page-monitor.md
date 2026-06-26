# Ekstern statussidemonitor

Ekstern statussideovervågning giver dig mulighed for at overvåge tredjepartstatussider og blive advaret, når tjenester, du er afhængig af, oplever afbrydelser eller forringet ydeevne. OneUptime kontrollerer periodisk eksterne statussider (som AWS, GCP, Azure, GitHub, OpenAI, Anthropic og mere) og evaluerer deres status.

## Oversigt

Eksterne statussidemonitorer kontrollerer sundheden af tjenester, du er afhængig af, ved at forespørge deres offentlige statussider. Dette giver dig mulighed for at:

- Overvåge tilgængelighed af tredjepartstjenester, din applikation er afhængig af
- Blive advaret, når opstrøms-udbydere oplever afbrydelser
- Spore individuelle komponentstatus (f.eks. "AWS EC2 us-east-1")
- Begrænse overvågning til en enkelt komponentgruppe (f.eks. kun OpenAIs "APIs"), så urelaterede incidents andre steder på siden ikke udløser din monitor
- Opdage forringet ydeevne, inden det påvirker dine brugere
- Korrelere dine egne incidents med problemer hos opstrøms-udbydere

## Understøttede udbydere

OneUptime understøtter overvågning af statussider via følgende metoder:

| Udbydertype              | Beskrivelse                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto** (standard)      | Registrerer automatisk statussideformatet                         |
| **Atlassian Statuspage** | Statussider drevet af Atlassian Statuspage (JSON API)             |
| **incident.io**          | Statussider drevet af incident.io (f.eks. `https://status.openai.com`) |
| **RSS**                  | Statussider, der leverer et RSS-feed                              |
| **Atom**                 | Statussider, der leverer et Atom-feed                            |

### Auto-detektion

Når indstillet til **Auto**, forsøger OneUptime automatisk at registrere statussideformatet, i denne rækkefølge:

1. Først forsøger den incident.io-statussidens API (`/proxy/<host>`)
2. Dernæst forsøger den Atlassian Statuspage JSON API (`/api/v2/status.json`, `/api/v2/components.json` og `/api/v2/incidents/unresolved.json`)
3. Hvis disse mislykkes, forsøger den at parse siden som et RSS- eller Atom-feed
4. Som en endelig reserveløsning udfører den en grundlæggende HTTP-tilgængelighedskontrol

> **Bemærk:** incident.io kontrolleres først, fordi nogle incident.io-statussider (såsom `https://status.openai.com`) også eksponerer et begrænset Atlassian-kompatibelt endpoint, der udelader komponentgrupper og aktive incidents. At kontrollere incident.io først sikrer, at de mere righoldige, gruppe-bevidste data anvendes.

## Oprettelse af en Ekstern Statussidemonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Ekstern statusside** som monitortype
4. Indtast statussideURL'en, du vil overvåge
5. Vælg valgfrit en specifik udbydertype (eller lad **Auto** stå)
6. Angiv valgfrit en **komponentgruppe** for at begrænse til en gruppe som "APIs"
7. Angiv valgfrit et **komponentnavn** for at filtrere til en enkelt komponent (inden for gruppen, hvis en gruppe er angivet)
8. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Statusside URL

Indtast URL'en til den eksterne statusside, du vil overvåge. For Atlassian Statuspage- og incident.io-drevne websteder er dette typisk rod-URL'en (f.eks. `https://status.example.com`). For RSS/Atom-feeds skal du indtaste feed-URL'en direkte.

### Udbydertype

Vælg udbydertypen for statussiden. Brug **Auto** (standard) for at lade OneUptime registrere formatet automatisk, eller angiv **Atlassian Statuspage**, **incident.io**, **RSS** eller **Atom**, hvis du kender det.

### Komponentgruppefilter

Hvis statussiden organiserer sine komponenter i grupper, kan du begrænse monitoren til en enkelt gruppe. For eksempel, på `https://status.openai.com`, begrænser indtastning af `APIs` monitoren til OpenAIs API-tjenester.

Når en komponentgruppe er angivet, beregnes **antallet af aktive incidents** og **den overordnede status** kun ud fra komponenterne i den gruppe — en incident, der påvirker en urelateret gruppe (for eksempel ChatGPT), vil ikke udløse en monitor, der er begrænset til "APIs"-gruppen.

Komponentgruppefiltrering understøttes for **Atlassian Statuspage**- og **incident.io**-udbydere. (RSS/Atom-feeds eksponerer ikke komponentgrupper.)

### Komponentnavnefilter

Hvis statussiden rapporterer om flere komponenter, kan du valgfrit angive et komponentnavn for kun at overvåge den specifikke komponent. For eksempel, for kun at overvåge AWS EC2 i us-east-1, skal du indtaste `EC2 us-east-1` (det nøjagtige komponentnavn som vist på statussiden).

Når en komponentgruppe også er angivet, anvendes komponentnavnefilteret **inden for** den gruppe, så du kan målrette en enkelt komponent inde i en større gruppe. Når ingen af filtrene er angivet, overvåges alle komponenter inden for rækkevidde.

### Avancerede indstillinger

#### Timeout

Den maksimale tid (i millisekunder) at vente på et svar fra statussiden. Standard er 10000 ms (10 sekunder).

#### Genforsøg

Antallet af gange der skal genforsøges, hvis anmodningen mislykkes. Standard er 3 genforsøg.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår den eksterne tjeneste betragtes som online eller offline baseret på:

- **Er online** – Om statussiden er tilgængelig og returnerer statusdata
- **Overordnet status** – Den overordnede statusindikator for statussiden (f.eks. `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Komponentstatus** – Status for komponenterne inden for rækkevidde (under hensyntagen til komponentgruppe-/komponentnavnefiltrene)
- **Aktive incidents** – Antallet af aktuelt aktive incidents rapporteret på statussiden (begrænset til komponentgruppen/komponenten, når et filter er angivet)
- **Svartid** – Hvor lang tid det tager at hente statussidedata

### Standardkriterier

Som standard opretter OneUptime kriterier baseret på, hvad der faktisk betyder noget for en statusside — dens aktive incidents og komponentsundhed, snarere end blot tilgængelighed:

- Monitoren markeres som **Operational**, når der ikke er nogen aktive incidents inden for rækkevidde.
- Monitoren markeres som **Down** (og der oprettes en incident), når der er mindst én aktiv incident inden for rækkevidde, eller når en komponent inden for rækkevidde rapporterer `degraded_performance`, `partial_outage`, `major_outage` eller `full_outage`.

Fordi antallet af aktive incidents og komponentstatus respekterer komponentgruppe-/komponentnavnefiltrene, målretter disse standardkriterier automatisk kun de komponenter, du bekymrer dig om.

## Populære statusside-URL'er

Her er en kurateret liste over populære tjenestestatussider, du kan overvåge:

| Tjeneste                     | Statusside URL                                |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **Bemærk:** Mange af disse bruger Atlassian Statuspage eller incident.io, så **Auto**-udbydertypen vil registrere dem automatisk.

## Incident- og advarselsskabeloner

Når du opretter incidents eller advarsler fra Eksterne Statussidemonitorer, kan du bruge følgende skabelonvariabler:

| Variabel                  | Beskrivelse                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Om statussiden er online (sand/falsk)                        |
| `{{responseTimeInMs}}`    | Svartid i millisekunder                                      |
| `{{failureCause}}`        | Årsag til fejl, hvis nogen                                   |
| `{{overallStatus}}`       | Den overordnede statusindikatorværdi                        |
| `{{activeIncidentCount}}` | Antal aktive incidents (begrænset til filteret, hvis nogen) |
| `{{componentStatuses}}`   | JSON-array af komponentstatus (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Registreret udbyder (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Komponentgruppe, monitoren er begrænset til, hvis nogen     |
| `{{componentName}}`       | Komponent, monitoren er begrænset til, hvis nogen           |

## Bedste praksis

- **Brug Auto-udbydertype**, medmindre du kender det nøjagtige format – Auto-detektion fungerer godt til de fleste statussider
- **Begræns til en komponentgruppe**, hvis du kun er afhængig af en del af en udbyder (f.eks. kun OpenAIs "APIs"), så urelaterede incidents ikke skaber støj
- **Overvåg specifikke komponenter**, hvis du kun er afhængig af visse tjenester (f.eks. en specifik AWS-region)
- **Opsæt incidentkorrelation** – Når dine monitorer opdager problemer, og den opstrøms statusside også viser problemer, hjælper det med at identificere årsager hurtigere
- **Kombinér med andre monitorer** – Par Eksterne Statussidemonitorer med dine egne API/Website-monitorer for omfattende synlighed
