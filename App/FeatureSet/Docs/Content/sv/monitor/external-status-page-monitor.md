# Monitor för extern statussida

Övervakning av externa statussidor gör det möjligt att övervaka tredjepartsstatussidor och bli varnad när tjänster du är beroende av upplever avbrott eller försämrad prestanda. OneUptime kontrollerar periodiskt externa statussidor (som AWS, GCP, Azure, GitHub, OpenAI, Anthropic och mer) och utvärderar deras status.

## Översikt

Monitorer för externa statussidor kontrollerar hälsan hos tjänster du förlitar dig på genom att fråga deras offentliga statussidor. Detta gör det möjligt att:

- Övervaka tillgängligheten för tredjepartstjänster din applikation är beroende av
- Bli varnad när uppströmsleverantörer upplever avbrott
- Spåra enskilda komponentstatusar (t.ex. "AWS EC2 us-east-1")
- Avgränsa övervakningen till en enskild komponentgrupp (t.ex. endast OpenAI:s "APIs"), så att orelaterade incidenter på andra ställen på sidan inte utlöser din monitor
- Identifiera försämrad prestanda innan det påverkar dina användare
- Korrelera dina egna incidenter med uppströmsleverantörsproblem

## Leverantörer som stöds

OneUptime stöder övervakning av statussidor via följande metoder:

| Leverantörstyp           | Beskrivning                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto** (standard)      | Identifierar automatiskt statussidans format                      |
| **Atlassian Statuspage** | Statussidor drivna av Atlassian Statuspage (JSON API)             |
| **incident.io**          | Statussidor drivna av incident.io (t.ex. `https://status.openai.com`) |
| **RSS**                  | Statussidor som tillhandahåller en RSS-feed                       |
| **Atom**                 | Statussidor som tillhandahåller en Atom-feed                     |

### Automatisk identifiering

När den är inställd på **Auto** försöker OneUptime automatiskt identifiera statussidans format, i denna ordning:

1. Först provar det incident.io-statussidans API (`/proxy/<host>`)
2. Därefter provar det Atlassian Statuspage JSON API (`/api/v2/status.json`, `/api/v2/components.json` och `/api/v2/incidents/unresolved.json`)
3. Om dessa misslyckas försöker det tolka sidan som en RSS- eller Atom-feed
4. Som sista utväg utför det en grundläggande HTTP-nåbarhetscheck

> **Observera:** incident.io kontrolleras först eftersom vissa incident.io-statussidor (såsom `https://status.openai.com`) också exponerar en begränsad Atlassian-kompatibel slutpunkt som utelämnar komponentgrupper och aktiva incidenter. Att kontrollera incident.io först säkerställer att de rikare, gruppmedvetna data används.

## Skapa en monitor för extern statussida

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Extern statussida** som monitortyp
4. Ange URL:en till statussidan du vill övervaka
5. Välj valfritt en specifik leverantörstyp (eller lämna som **Auto**)
6. Ange valfritt en **komponentgrupp** för att avgränsa till en grupp såsom "APIs"
7. Ange valfritt ett **komponentnamn** för att filtrera till en enskild komponent (inom gruppen, om en grupp är angiven)
8. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Statussidans URL

Ange URL:en till den externa statussidan du vill övervaka. För Atlassian Statuspage- och incident.io-drivna webbplatser är detta vanligtvis rot-URL:en (t.ex. `https://status.example.com`). För RSS/Atom-feeds anger du feed-URL:en direkt.

### Leverantörstyp

Välj leverantörstyp för statussidan. Använd **Auto** (standard) för att låta OneUptime identifiera formatet automatiskt, eller ange **Atlassian Statuspage**, **incident.io**, **RSS** eller **Atom** om du vet vilken det är.

### Komponentgruppsfilter

Om statussidan organiserar sina komponenter i grupper kan du avgränsa monitorn till en enskild grupp. Till exempel, på `https://status.openai.com`, avgränsar `APIs` monitorn till OpenAI:s API-tjänster.

När en komponentgrupp är angiven beräknas **antalet aktiva incidenter** och den **övergripande statusen** med hjälp av endast komponenterna i den gruppen — en incident som påverkar en orelaterad grupp (till exempel ChatGPT) utlöser inte en monitor som är avgränsad till gruppen "APIs".

Komponentgruppsfiltrering stöds för leverantörerna **Atlassian Statuspage** och **incident.io**. (RSS/Atom-feeds exponerar inte komponentgrupper.)

### Komponentnamnsfilter

Om statussidan rapporterar om flera komponenter kan du valfritt ange ett komponentnamn för att bara övervaka den specifika komponenten. Till exempel, för att bara övervaka AWS EC2 i us-east-1, anger du `EC2 us-east-1` (det exakta komponentnamnet som visas på statussidan).

När en komponentgrupp också är angiven tillämpas komponentnamnsfiltret **inom** den gruppen, vilket låter dig rikta in dig på en enskild komponent inuti en större grupp. När inget filter anges övervakas alla komponenter inom omfattningen.

### Avancerade alternativ

#### Timeout

Maximal tid (i millisekunder) att vänta på svar från statussidan. Standard är 10000 ms (10 sekunder).

#### Återförsök

Antal gånger att försöka igen om förfrågan misslyckas. Standard är 3 försök.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när den externa tjänsten anses vara online eller offline baserat på:

- **Är online** – Om statussidan är tillgänglig och returnerar statusdata
- **Övergripande status** – Den övergripande statusindikatorn för statussidan (t.ex. `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Komponentstatus** – Status för komponenterna inom omfattningen (med hänsyn till komponentgrupps-/komponentnamnsfiltren)
- **Aktiva incidenter** – Antalet för närvarande aktiva incidenter som rapporteras på statussidan (avgränsat till komponentgruppen/komponenten när ett filter är angivet)
- **Svarstid** – Hur lång tid det tar att hämta statussidans data

### Standardkriterier

Som standard förinställer OneUptime kriterier baserat på vad som faktiskt har betydelse för en statussida — dess aktiva incidenter och komponenthälsa, snarare än enbart nåbarhet:

- Monitorn markeras som **Operational** när det inte finns några aktiva incidenter inom omfattningen.
- Monitorn markeras som **Down** (och en incident skapas) när det finns minst en aktiv incident inom omfattningen, eller när en komponent inom omfattningen rapporterar `degraded_performance`, `partial_outage`, `major_outage` eller `full_outage`.

Eftersom antalet aktiva incidenter och komponentstatusarna respekterar komponentgrupps-/komponentnamnsfiltren riktar dessa standardkriterier automatiskt in sig på endast de komponenter du bryr dig om.

## Populära statussid-URL:er

Här är en utvald lista med populära tjänststatussid-URL:er du kan övervaka:

| Tjänst                       | Statussid-URL                                 |
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

> **Observera:** Många av dessa använder Atlassian Statuspage eller incident.io, så leverantörstypen **Auto** identifierar dem automatiskt.

## Mall för incident och varning

När du skapar incidenter eller varningar från monitorer för externa statussidor kan du använda följande mallvariabler:

| Variabel                  | Beskrivning                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Om statussidan är online (sant/falskt)                       |
| `{{responseTimeInMs}}`    | Svarstid i millisekunder                                    |
| `{{failureCause}}`        | Orsak till fel, om någon                                    |
| `{{overallStatus}}`       | Värdet av den övergripande statusindikatorn                 |
| `{{activeIncidentCount}}` | Antal aktiva incidenter (avgränsat till filtret, om något)  |
| `{{componentStatuses}}`   | JSON-array med komponentstatusar (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Identifierad leverantör (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Komponentgrupp som monitorn är avgränsad till, om någon     |
| `{{componentName}}`       | Komponent som monitorn är avgränsad till, om någon          |

## Bästa praxis

- **Använd Auto-leverantörstyp** om du inte känner till det exakta formatet – automatisk identifiering fungerar bra för de flesta statussidor
- **Avgränsa till en komponentgrupp** om du bara är beroende av en del av en leverantör (t.ex. endast OpenAI:s "APIs"), så att orelaterade incidenter inte skapar brus
- **Övervaka specifika komponenter** om du bara är beroende av vissa tjänster (t.ex. en specifik AWS-region)
- **Konfigurera incidentkorrelation** – när dina monitorer identifierar problem och uppströmsstatussidan också visar problem hjälper det att identifiera grundorsaker snabbare
- **Kombinera med andra monitorer** – para ihop monitorer för externa statussidor med dina egna API/webbplatsmonitorer för heltäckande synlighet
