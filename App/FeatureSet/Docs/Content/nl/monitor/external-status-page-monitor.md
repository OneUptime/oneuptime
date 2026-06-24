# Externe statuspagina-monitor

Externe statuspagina-monitoring stelt u in staat statuspagina's van derden te bewaken en gewaarschuwd te worden wanneer diensten waarvan u afhankelijk bent uitval of verminderde prestaties ervaren. OneUptime controleert periodiek externe statuspagina's (zoals AWS, GCP, Azure, GitHub, OpenAI, Anthropic en meer) en evalueert hun status.

## Overzicht

Externe statuspagina-monitors controleren de gezondheid van diensten waarop u vertrouwt door hun publieke statuspagina's te bevragen. Hiermee kunt u:

- De beschikbaarheid bewaken van externe diensten waarvan uw applicatie afhankelijk is
- Gewaarschuwd worden wanneer upstream-providers uitval ervaren
- Statussen van individuele componenten bijhouden (bijv. "AWS EC2 us-east-1")
- Monitoring beperken tot één enkele componentgroep (bijv. alleen OpenAI's "APIs"), zodat niet-gerelateerde incidenten elders op de pagina uw monitor niet laten afgaan
- Verminderde prestaties detecteren voordat dit uw gebruikers beïnvloedt
- Uw eigen incidenten correleren met problemen bij upstream-providers

## Ondersteunde providers

OneUptime ondersteunt het bewaken van statuspagina's via de volgende methoden:

| Providertype                | Beschrijving                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| **Automatisch** (standaard) | Detecteert automatisch het formaat van de statuspagina                   |
| **Atlassian Statuspage**    | Statuspagina's aangedreven door Atlassian Statuspage (JSON API)          |
| **incident.io**             | Statuspagina's aangedreven door incident.io (bijv. `https://status.openai.com`) |
| **RSS**                     | Statuspagina's die een RSS-feed bieden                                   |
| **Atom**                    | Statuspagina's die een Atom-feed bieden                                  |

### Automatische detectie

Bij instelling op **Automatisch** probeert OneUptime het formaat van de statuspagina automatisch te detecteren, in deze volgorde:

1. Vervolgens probeert het de incident.io-statuspagina-API (`/proxy/<host>`)
2. Eerst probeert het de Atlassian Statuspage JSON API (`/api/v2/status.json`, `/api/v2/components.json` en `/api/v2/incidents/unresolved.json`)
3. Als die mislukken, probeert het de pagina te verwerken als een RSS- of Atom-feed
4. Als laatste terugvaloptie voert het een eenvoudige HTTP-bereikbaarheidscontrole uit

> **Opmerking:** incident.io wordt als eerste gecontroleerd omdat sommige incident.io-statuspagina's (zoals `https://status.openai.com`) ook een beperkt Atlassian-compatibel eindpunt beschikbaar stellen dat componentgroepen en actieve incidenten weglaat. Door incident.io als eerste te controleren wordt verzekerd dat de rijkere, groepsbewuste gegevens worden gebruikt.

## Een Externe statuspagina-monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Externe statuspagina** als het monitortype
4. Voer de URL in van de statuspagina die u wilt bewaken
5. Selecteer optioneel een specifiek providertype (of laat op **Automatisch**)
6. Voer optioneel een **componentgroep** in om te beperken tot een groep zoals "APIs"
7. Voer optioneel een **componentnaam** in om te filteren op één enkel component (binnen de groep, als er een groep is ingesteld)
8. Configureer monitoringcriteria naar wens

## Configuratie-opties

### URL van statuspagina

Voer de URL in van de externe statuspagina die u wilt bewaken. Voor sites aangedreven door Atlassian Statuspage en incident.io is dit doorgaans de basis-URL (bijv. `https://status.example.com`). Voor RSS/Atom-feeds voert u de feed-URL rechtstreeks in.

### Providertype

Selecteer het providertype voor de statuspagina. Gebruik **Automatisch** (standaard) om OneUptime het formaat automatisch te laten detecteren, of specificeer **Atlassian Statuspage**, **incident.io**, **RSS** of **Atom** als u het kent.

### Filter op componentgroep

Als de statuspagina haar componenten in groepen organiseert, kunt u de monitor beperken tot één enkele groep. Op `https://status.openai.com` beperkt het invoeren van `APIs` de monitor bijvoorbeeld tot OpenAI's API-diensten.

Wanneer een componentgroep is ingesteld, worden het **aantal actieve incidenten** en de **algehele status** uitsluitend berekend op basis van de componenten in die groep — een incident dat een niet-gerelateerde groep treft (bijvoorbeeld ChatGPT) laat een monitor die beperkt is tot de "APIs"-groep niet afgaan.

Filteren op componentgroep wordt ondersteund voor de providers **Atlassian Statuspage** en **incident.io**. (RSS/Atom-feeds maken componentgroepen niet beschikbaar.)

### Filter op componentnaam

Als de statuspagina over meerdere componenten rapporteert, kunt u optioneel een componentnaam opgeven om alleen dat specifieke component te bewaken. Om bijvoorbeeld alleen AWS EC2 in us-east-1 te bewaken, voert u `EC2 us-east-1` in (de exacte componentnaam zoals weergegeven op de statuspagina).

Wanneer ook een componentgroep is ingesteld, wordt het filter op componentnaam **binnen** die groep toegepast, waardoor u één enkel component binnen een grotere groep kunt targeten. Wanneer geen van beide filters is opgegeven, worden alle componenten binnen het bereik bewaakt.

### Geavanceerde opties

#### Time-out

De maximale tijd (in milliseconden) om te wachten op een antwoord van de statuspagina. Standaard is 10000 ms (10 seconden).

#### Nieuwe pogingen

Het aantal keren dat het verzoek opnieuw wordt geprobeerd bij mislukking. Standaard is 3 nieuwe pogingen.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer de externe dienst als operationeel of offline wordt beschouwd op basis van:

- **Is online** – Of de statuspagina bereikbaar is en statusgegevens retourneert
- **Algehele status** – De algehele statusindicator van de statuspagina (bijv. `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Componentstatus** – De status van de componenten binnen het bereik (met inachtneming van de filters op componentgroep / componentnaam)
- **Actieve incidenten** – Het aantal momenteel actieve incidenten gerapporteerd op de statuspagina (beperkt tot de componentgroep / het component wanneer een filter is ingesteld)
- **Responstijd** – Hoe lang het duurt om de statuspagina-gegevens op te halen

### Standaardcriteria

Standaard stelt OneUptime criteria in op basis van wat er werkelijk toe doet voor een statuspagina — de actieve incidenten en componentgezondheid, in plaats van louter bereikbaarheid:

- De monitor wordt gemarkeerd als **Operationeel** wanneer er geen actieve incidenten binnen het bereik zijn.
- De monitor wordt gemarkeerd als **Offline** (en er wordt een incident aangemaakt) wanneer er ten minste één actief incident binnen het bereik is, of wanneer een component binnen het bereik `degraded_performance`, `partial_outage`, `major_outage` of `full_outage` rapporteert.

Omdat het aantal actieve incidenten en de componentstatussen de filters op componentgroep / componentnaam respecteren, targeten deze standaardcriteria automatisch alleen de componenten die voor u van belang zijn.

## Populaire statuspagina-URL's

Hier is een samengestelde lijst van populaire statuspagina-URL's die u kunt bewaken:

| Dienst                       | URL van statuspagina                          |
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

> **Opmerking:** Veel van deze gebruiken Atlassian Statuspage of incident.io, zodat het **Automatisch** providertype ze automatisch detecteert.

## Incident- en meldingssjablonen

Bij het aanmaken van incidenten of meldingen vanuit Externe statuspagina-monitors kunt u de volgende sjabloonvariabelen gebruiken:

| Variabele                 | Beschrijving                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `{{isOnline}}`            | Of de statuspagina online is (true/false)                                      |
| `{{responseTimeInMs}}`    | Responstijd in milliseconden                                                   |
| `{{failureCause}}`        | Reden voor mislukking, indien aanwezig                                         |
| `{{overallStatus}}`       | De algehele statusindicatorwaarde                                              |
| `{{activeIncidentCount}}` | Aantal actieve incidenten (beperkt tot het filter, indien aanwezig)            |
| `{{componentStatuses}}`   | JSON-array van componentstatussen (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Gedetecteerde provider (Atlassian Statuspage, incident.io, RSS, Atom)          |
| `{{componentGroup}}`      | Componentgroep waartoe de monitor beperkt is, indien aanwezig                  |
| `{{componentName}}`       | Component waartoe de monitor beperkt is, indien aanwezig                       |

## Best practices

- **Gebruik het Automatisch providertype** tenzij u het exacte formaat kent — automatische detectie werkt goed voor de meeste statuspagina's
- **Beperk tot een componentgroep** als u slechts afhankelijk bent van een deel van een provider (bijv. alleen OpenAI's "APIs"), zodat niet-gerelateerde incidenten geen ruis veroorzaken
- **Bewaak specifieke componenten** als u slechts afhankelijk bent van bepaalde diensten (bijv. een specifieke AWS-regio)
- **Incidentcorrelatie instellen** — wanneer uw monitors problemen detecteren en de upstream-statuspagina ook problemen toont, helpt dit bij het sneller identificeren van oorzaken
- **Combineer met andere monitors** — koppel Externe statuspagina-monitors aan uw eigen API/Website-monitors voor uitgebreid inzicht
