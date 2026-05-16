# Monitor för extern statussida

Övervakning av externa statussidor gör det möjligt att övervaka tredjepartsstatussidor och bli varnad när tjänster du är beroende av upplever avbrott eller försämrad prestanda. OneUptime kontrollerar periodiskt externa statussidor (som AWS, GCP, Azure, GitHub och mer) och utvärderar deras status.

## Översikt

Monitorer för externa statussidor kontrollerar hälsan hos tjänster du förlitar dig på genom att fråga deras offentliga statussidor. Detta gör det möjligt att:

- Övervaka tillgängligheten för tredjepartstjänster din applikation är beroende av
- Bli varnad när uppströmsleaverantörer upplever avbrott
- Spåra enskilda komponentstatusar (t.ex. "AWS EC2 us-east-1")
- Identifiera försämrad prestanda innan det påverkar dina användare
- Korrelera dina egna incidenter med uppströmsleverantörsproblem

## Leverantörer som stöds

OneUptime stöder övervakning av statussidor via följande metoder:

| Leverantörstyp | Beskrivning |
|---|---|
| **Auto** (standard) | Identifierar automatiskt statussidans format |
| **Atlassian Statuspage** | Statussidor drivna av Atlassian Statuspage (JSON API) |
| **RSS** | Statussidor som tillhandahåller en RSS-feed |
| **Atom** | Statussidor som tillhandahåller en Atom-feed |

### Automatisk identifiering

När den är inställd på **Auto** försöker OneUptime automatiskt identifiera statussidans format:

1. Först provar det Atlassian Statuspage JSON API (`/api/v2/status.json` och `/api/v2/components.json`)
2. Om det misslyckas försöker det tolka sidan som en RSS- eller Atom-feed
3. Som sista utväg utför det en grundläggande HTTP-nåbarhetscheck

## Skapa en monitor för extern statussida

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Extern statussida** som monitortyp
4. Ange URL:en till statussidan du vill övervaka
5. Välj valfritt en specifik leverantörstyp (eller lämna som Auto)
6. Ange valfritt ett komponentnamn för att filtrera övervakning till en specifik komponent
7. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Statussidans URL

Ange URL:en till den externa statussidan du vill övervaka. För Atlassian Statuspage-drivna webbplatser är detta vanligtvis rot-URL:en (t.ex. `https://status.example.com`). För RSS/Atom-feeds anger du feed-URL:en direkt.

### Leverantörstyp

Välj leverantörstyp för statussidan. Använd **Auto** (standard) för att låta OneUptime identifiera formatet automatiskt, eller ange en specifik leverantörstyp om du vet vilken det är.

### Komponentnamnsfilter

Om statussidan rapporterar om flera komponenter kan du valfritt ange ett komponentnamn för att bara övervaka den specifika komponenten. Till exempel, för att bara övervaka AWS EC2 i us-east-1, anger du `EC2 us-east-1` (det exakta komponentnamnet som visas på statussidan).

När inget komponentnamn anges övervakas statussidans övergripande status.

### Avancerade alternativ

#### Timeout

Maximal tid (i millisekunder) att vänta på svar från statussidan. Standard är 10000 ms (10 sekunder).

#### Återförsök

Antal gånger att försöka igen om förfrågan misslyckas. Standard är 3 försök.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när den externa tjänsten anses vara online, degraderad eller offline baserat på:

- **Är online** – Om statussidan är tillgänglig och returnerar statusdata
- **Övergripande status** – Den övergripande statusindikatorn för statussidan (t.ex. "operational", "major_outage")
- **Komponentstatus** – Status för en specifik komponent (när komponentnamnsfilter används)
- **Aktiva incidenter** – Antalet för närvarande aktiva incidenter som rapporteras på statussidan
- **Svarstid** – Hur lång tid det tar att hämta statussidans data

## Populära statussid-URL:er

Här är en utvald lista med populära tjänststatussid-URL:er du kan övervaka:

| Tjänst | Statussid-URL |
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

> **Observera:** Många av dessa använder Atlassian Statuspage, så leverantörstypen **Auto** identifierar dem automatiskt.

## Mall för incident och varning

När du skapar incidenter eller varningar från monitorer för externa statussidor kan du använda följande mallvariabler:

| Variabel | Beskrivning |
|---|---|
| `{{isOnline}}` | Om statussidan är online (sant/falskt) |
| `{{responseTimeInMs}}` | Svarstid i millisekunder |
| `{{failureCause}}` | Orsak till fel, om någon |
| `{{overallStatus}}` | Värdet av den övergripande statusindikatorn |
| `{{activeIncidentCount}}` | Antal aktiva incidenter |
| `{{componentStatuses}}` | JSON-array med komponentstatusar |

## Bästa praxis

- **Använd Auto-leverantörstyp** om du inte känner till det exakta formatet – automatisk identifiering fungerar bra för de flesta statussidor
- **Övervaka specifika komponenter** om du bara är beroende av vissa tjänster (t.ex. en specifik AWS-region)
- **Konfigurera incidentkorrelation** – när dina monitorer identifierar problem och uppströmstatussidan också visar problem hjälper det att identifiera grundorsaker snabbare
- **Kombinera med andra monitorer** – para ihop monitorer för externa statussidor med dina egna API/webbplatsmonitorer för heltäckande synlighet
