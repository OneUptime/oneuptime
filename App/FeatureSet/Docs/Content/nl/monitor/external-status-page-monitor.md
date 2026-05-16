# Externe statuspagina-monitor

Externe statuspagina-monitoring stelt u in staat statuspagina's van derden te bewaken en gewaarschuwd te worden wanneer diensten waarvan u afhankelijk bent uitval of verminderde prestaties ervaren. OneUptime controleert periodiek externe statuspagina's (zoals AWS, GCP, Azure, GitHub en meer) en evalueert hun status.

## Overzicht

Externe statuspagina-monitors controleren de gezondheid van diensten waarop u vertrouwt door hun publieke statuspagina's te bevragen. Hiermee kunt u:

- De beschikbaarheid bewaken van externe diensten waarvan uw applicatie afhankelijk is
- Gewaarschuwd worden wanneer upstream-providers uitval ervaren
- Statussen van individuele componenten bijhouden (bijv. "AWS EC2 us-east-1")
- Verminderde prestaties detecteren voordat dit uw gebruikers beïnvloedt
- Uw eigen incidenten correleren met problemen bij upstream-providers

## Ondersteunde providers

OneUptime ondersteunt het bewaken van statuspagina's via de volgende methoden:

| Providertype | Beschrijving |
|---|---|
| **Automatisch** (standaard) | Detecteert automatisch het formaat van de statuspagina |
| **Atlassian Statuspage** | Statuspagina's aangedreven door Atlassian Statuspage (JSON API) |
| **RSS** | Statuspagina's die een RSS-feed bieden |
| **Atom** | Statuspagina's die een Atom-feed bieden |

### Automatische detectie

Bij instelling op **Automatisch** probeert OneUptime het formaat van de statuspagina automatisch te detecteren:

1. Eerst probeert het de Atlassian Statuspage JSON API (`/api/v2/status.json` en `/api/v2/components.json`)
2. Als dat mislukt, probeert het de pagina te verwerken als een RSS- of Atom-feed
3. Als laatste terugvaloptie voert het een eenvoudige HTTP-bereikbaarheidscontrole uit

## Een Externe statuspagina-monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Externe statuspagina** als het monitortype
4. Voer de URL in van de statuspagina die u wilt bewaken
5. Selecteer optioneel een specifiek providertype (of laat op Automatisch)
6. Voer optioneel een componentnaam in om monitoring te beperken tot een specifiek component
7. Configureer monitoringcriteria naar wens

## Configuratie-opties

### URL van statuspagina

Voer de URL in van de externe statuspagina die u wilt bewaken. Voor sites aangedreven door Atlassian Statuspage is dit doorgaans de basis-URL (bijv. `https://status.example.com`). Voor RSS/Atom-feeds voert u de feed-URL rechtstreeks in.

### Providertype

Selecteer het providertype voor de statuspagina. Gebruik **Automatisch** (standaard) om OneUptime het formaat automatisch te laten detecteren, of specificeer een specifiek providertype als u het kent.

### Filter op componentnaam

Als de statuspagina over meerdere componenten rapporteert, kunt u optioneel een componentnaam opgeven om alleen dat specifieke component te bewaken. Om bijvoorbeeld alleen AWS EC2 in us-east-1 te bewaken, voert u `EC2 us-east-1` in (de exacte componentnaam zoals weergegeven op de statuspagina).

Als er geen componentnaam is opgegeven, wordt de algehele status van de statuspagina bewaakt.

### Geavanceerde opties

#### Time-out

De maximale tijd (in milliseconden) om te wachten op een antwoord van de statuspagina. Standaard is 10000 ms (10 seconden).

#### Nieuwe pogingen

Het aantal keren dat het verzoek opnieuw wordt geprobeerd bij mislukking. Standaard is 3 nieuwe pogingen.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer de externe dienst als online, gedegradeerd of offline wordt beschouwd op basis van:

- **Is online** – Of de statuspagina bereikbaar is en statusgegevens retourneert
- **Algehele status** – De algehele statusindicator van de statuspagina (bijv. "operational", "major_outage")
- **Componentstatus** – De status van een specifiek component (bij gebruik van componentnaamfilter)
- **Actieve incidenten** – Het aantal momenteel actieve incidenten gerapporteerd op de statuspagina
- **Responstijd** – Hoe lang het duurt om de statuspagina-gegevens op te halen

## Populaire statuspagina-URL's

Hier is een samengestelde lijst van populaire statuspagina-URL's die u kunt bewaken:

| Dienst | URL van statuspagina |
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

> **Opmerking:** Veel van deze gebruiken Atlassian Statuspage, zodat het **Automatisch** providertype ze automatisch detecteert.

## Incident- en meldingssjablonen

Bij het aanmaken van incidenten of meldingen vanuit Externe statuspagina-monitors kunt u de volgende sjabloonvariabelen gebruiken:

| Variabele | Beschrijving |
|---|---|
| `{{isOnline}}` | Of de statuspagina online is (true/false) |
| `{{responseTimeInMs}}` | Responstijd in milliseconden |
| `{{failureCause}}` | Reden voor mislukking, indien aanwezig |
| `{{overallStatus}}` | De algehele statusindicatorwaarde |
| `{{activeIncidentCount}}` | Aantal actieve incidenten |
| `{{componentStatuses}}` | JSON-array van componentstatussen |

## Best practices

- **Gebruik het Automatisch providertype** tenzij u het exacte formaat kent — automatische detectie werkt goed voor de meeste statuspagina's
- **Bewaken specifieke componenten** als u slechts afhankelijk bent van bepaalde diensten (bijv. een specifieke AWS-regio)
- **Incidentcorrelatie instellen** — wanneer uw monitors problemen detecteren en de upstream-statuspagina ook problemen toont, helpt dit bij het sneller identificeren van oorzaken
- **Combineer met andere monitors** — koppel Externe statuspagina-monitors aan uw eigen API/Website-monitors voor uitgebreid inzicht
