# AI Agenten

AI Agenten in OneUptime lossen automatisch fouten, prestatieproblemen en databasequery's in uw code op. Aangedreven door OpenTelemetry-observatiegegevens maken AI Agenten pull requests aan met oplossingen — niet alleen meldingen.

## Wat kunnen AI Agenten doen?

AI Agenten analyseren uw observatiegegevens (traces, logs en metrics) om problemen in uw codebase te detecteren en automatisch op te lossen:

- **Fouten automatisch oplossen**: Wanneer de AI Agent uitzonderingen in uw traces of logs constateert, lost hij het probleem automatisch op en maakt hij een pull request aan.
- **Prestatieproblemen oplossen**: Analyseert traces die het langst duren en maakt pull requests aan met prestatieoptimalisaties.
- **Databasequery's oplossen**: Identificeert trage of inefficiënte databasequery's en optimaliseert deze met juiste indexering en herschreven query's.
- **Frontend-problemen oplossen**: Pakt frontend-specifieke prestatieproblemen, renderingproblemen en JavaScript-fouten automatisch aan.
- **Telemetrie automatisch toevoegen**: Voeg tracing, metrics en logs toe aan uw codebase met één klik. Geen handmatige instrumentatie nodig.
- **GitHub & GitLab-integratie**: Integreert naadloos met uw bestaande repositories. PR's worden rechtstreeks in uw workflow aangemaakt.
- **CI/CD-integratie**: Integreert met uw bestaande CI/CD-pipelines. Oplossingen worden getest en gevalideerd voordat de PR wordt aangemaakt.
- **Terraform-ondersteuning**: Los infrastructuurproblemen automatisch op. Ondersteunt Terraform en OpenTofu voor infrastructure-as-code.
- **Integratie met issue-trackers**: Koppelt met Jira, Linear en andere issue-trackers. Koppelt oplossingen automatisch aan relevante issues.

## Hoe het werkt

1. **Gegevens verzamelen**: OpenTelemetry verzamelt traces, logs en metrics van uw applicatie
2. **Problemen detecteren**: AI identificeert fouten, prestatieknelpunten en trage query's
3. **Oplossing genereren**: AI analyseert uw codebase en maakt de oplossing automatisch
4. **PR aanmaken**: Pull request met oplossing en gedetailleerd rapport klaar voor beoordeling

## Flexibiliteit van LLM Providers

OneUptime werkt met elke LLM-provider. U kunt gebruiken:

- **OpenAI GPT**-modellen
- **Anthropic Claude**-modellen
- **Meta Llama** (via Ollama of andere providers)
- **Aangepaste zelf-gehoste** modellen

Host uw AI-model zelf en houd uw code volledig privé.

## Privacy

Ongeacht uw abonnement ziet, bewaart of traint OneUptime nooit met uw code:

- **Geen toegang tot code**: Uw code blijft op uw infrastructuur
- **Geen gegevensopslag**: Nul-bewaarbeleid voor gegevens
- **Geen training**: Uw code wordt nooit gebruikt voor AI-training

## Globale AI Agenten vs. Zelf-gehoste AI Agenten

### Globale AI Agenten

Als u **OneUptime SaaS** (cloud-gehoste versie) gebruikt, worden Globale AI Agenten door OneUptime geleverd en zijn ze vooraf geconfigureerd en klaar voor gebruik. Deze agenten worden beheerd door OneUptime en vereisen geen aanvullende instelling.

Globale AI Agenten zijn automatisch beschikbaar voor alle projecten, tenzij uitgeschakeld in uw projectinstellingen.

### Zelf-gehoste AI Agenten

Voor organisaties die AI-agenten binnen hun eigen infrastructuur moeten uitvoeren (bijv. voor beveiligings-, compliance- of netwerktoegansvereisten), ondersteunt OneUptime zelf-gehoste AI-agenten.

Zelf-gehoste AI-agenten:
- Draaien binnen uw privénetwerk
- Hebben toegang tot interne bronnen en systemen
- Geven u volledige controle over de omgeving van de agent
- Kunnen worden aangepast aan uw specifieke behoeften

## Een zelf-gehoste AI Agent instellen

### Stap 1: Een AI Agent aanmaken in OneUptime

1. Log in op uw OneUptime-dashboard
2. Ga naar **Projectinstellingen** > **AI Agenten**
3. Klik op **AI Agent aanmaken** om een nieuwe agent toe te voegen
4. Vul de vereiste velden in:
   - **Naam**: Een beschrijvende naam voor uw AI-agent
   - **Beschrijving** (optioneel): Een omschrijving van het doel van de agent
5. Na het aanmaken ontvangt u een `AI_AGENT_ID` en `AI_AGENT_KEY`

**Belangrijk**: Sla uw `AI_AGENT_KEY` veilig op. Deze wordt slechts eenmaal getoond en kan later niet worden opgehaald.

### Stap 2: De AI Agent implementeren

#### Docker

Om een AI-agent uit te voeren, zorg ervoor dat Docker is geïnstalleerd. Voer de agent uit met:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Als u OneUptime zelf host, wijzig `ONEUPTIME_URL` naar de URL van uw eigen zelf-gehoste instantie.

#### Docker Compose

U kunt de AI-agent ook uitvoeren via docker-compose. Maak een `docker-compose.yml`-bestand aan:

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Voer daarna uit:

```bash
docker compose up -d
```

#### Kubernetes

Maak een `oneuptime-ai-agent.yaml`-bestand aan:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

Pas de configuratie toe:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Omgevingsvariabelen

De AI-agent ondersteunt de volgende omgevingsvariabelen:

#### Verplichte variabelen

| Variabele | Beschrijving |
|----------|-------------|
| `AI_AGENT_KEY` | De AI-agentsleutel van uw OneUptime-dashboard |
| `AI_AGENT_ID` | Het AI-agent-ID van uw OneUptime-dashboard |
| `ONEUPTIME_URL` | De URL van uw OneUptime-instantie (standaard: https://oneuptime.com) |


## Uw AI Agent verifiëren

Na het implementeren van uw AI-agent:

1. Ga naar **Projectinstellingen** > **AI Agenten** in uw OneUptime-dashboard
2. Uw agent dient binnen enkele minuten de status **Verbonden** te tonen
3. Als de status **Verbroken** weergeeft, controleer dan de containerlogboeken op fouten

Containerlogboeken bekijken:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Probleemoplossing

### Agent maakt geen verbinding

1. **Controleer de inloggegevens**: Zorg dat `AI_AGENT_KEY` en `AI_AGENT_ID` correct zijn
2. **Controleer het netwerk**: Zorg dat de agent uw OneUptime-instantie kan bereiken
3. **Bekijk de logboeken**: Controleer containerlogboeken op foutmeldingen
4. **Firewallregels**: Zorg dat uitgaand HTTPS (poort 443) is toegestaan

### Agent blijft de verbinding verbreken

1. **Controleer resourcelimieten**: Zorg dat de container voldoende geheugen en CPU heeft
2. **Netwerkstabiliteit**: Controleer of de netwerkverbinding stabiel is
3. **Bekijk de logboeken**: Zoek naar time-out- of verbindingsfouten in de logboeken

## Hulp nodig?

Als u problemen ondervindt met uw AI-agent:

1. Controleer de [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) voor bekende problemen
2. Maak een nieuw issue aan als uw probleem nog niet is gemeld
3. Neem contact op met [ondersteuning](https://oneuptime.com/support) als u een enterprise-abonnement heeft
