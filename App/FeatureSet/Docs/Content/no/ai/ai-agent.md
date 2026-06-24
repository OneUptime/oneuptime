# AI-agenter

AI-agenter i OneUptime retter automatisk feil, ytelsesproblemer og databasespørringer i koden din. Drevet av OpenTelemetry-observabilitetsdata oppretter AI-agenter pull-forespørsler med rettelser – ikke bare varsler.

## Hva kan AI-agenter gjøre?

AI-agenter analyserer observabilitetsdata (spor, logger og metrikker) for å oppdage og automatisk rette problemer i kodebasen din:

- **Rette feil automatisk**: Når AI-agenten oppdager unntak i spor eller logger, retter den problemet automatisk og oppretter en pull-forespørsel.
- **Rette ytelsesproblemer**: Analyserer spor som tar lengst tid å kjøre, og oppretter pull-forespørsler med ytelsesoptimalisering.
- **Rette databasespørringer**: Identifiserer trege eller ineffektive databasespørringer og optimaliserer dem med riktig indeksering og omskriving av spørringer.
- **Rette frontend-problemer**: Håndterer frontend-spesifikke ytelsesproblemer, gjengivelsesproblemer og JavaScript-feil automatisk.
- **Legge til telemetri automatisk**: Legg til sporing, metrikker og logger i kodebasen med ett klikk. Ingen manuell instrumentering nødvendig.
- **GitHub og GitLab-integrasjon**: Integreres sømløst med eksisterende repositorier. PR-er opprettes direkte i arbeidsflyten din.
- **CI/CD-integrasjon**: Integreres med eksisterende CI/CD-pipelines. Rettelsene testes og valideres før PR-opprettelse.
- **Terraform-støtte**: Rett infrastrukturproblemer automatisk. Støtter Terraform og OpenTofu for infrastruktur-som-kode.
- **Problemsporingsintegrasjon**: Kobles til Jira, Linear og andre problemsporere. Knytter automatisk rettelser til relevante problemer.

## Slik fungerer det

1. **Samle data**: OpenTelemetry samler inn spor, logger og metrikker fra applikasjonen din
2. **Oppdage problemer**: AI identifiserer feil, ytelsesflaskehalser og trege spørringer
3. **Generere rettelse**: AI analyserer kodebasen og oppretter rettelsen automatisk
4. **Opprette PR**: Pull-forespørsel med rettelse og detaljert rapport klar til gjennomgang

## Fleksibilitet med LLM-leverandør

OneUptime fungerer med alle LLM-leverandører. Du kan bruke:

- **OpenAI GPT**-modeller
- **Anthropic Claude**-modeller
- **Meta Llama** (via Ollama eller andre leverandører)
- **Egendefinerte selvhostede** modeller

Selvhost AI-modellen og hold koden din helt privat.

## Personvern

Uavhengig av plan ser, lagrer eller trener ikke OneUptime på koden din:

- **Ingen kodetilgang**: Koden din forblir på din infrastruktur
- **Ingen datalagring**: Nulldataoppbevaringspolicy
- **Ingen opplæring**: Koden din brukes aldri til AI-opplæring

## Globale AI-agenter kontra selvhostede AI-agenter

### Globale AI-agenter

Hvis du bruker **OneUptime SaaS** (skybasert versjon), leveres globale AI-agenter av OneUptime og er forhåndskonfigurert og klare til bruk. Disse agentene administreres av OneUptime og krever ingen ytterligere oppsett.

Globale AI-agenter er automatisk tilgjengelige for alle prosjekter med mindre de er deaktivert i prosjektinnstillingene dine.

### Selvhostede AI-agenter

For organisasjoner som trenger å kjøre AI-agenter innenfor sin egen infrastruktur (f.eks. av sikkerhets-, samsvar- eller nettverkstilgangskrav), støtter OneUptime selvhostede AI-agenter.

Selvhostede AI-agenter:

- Kjører innenfor ditt private nettverk
- Kan få tilgang til interne ressurser og systemer
- Gir deg full kontroll over agentens miljø
- Kan tilpasses for dine spesifikke behov

## Konfigurere en selvhostet AI-agent

### Trinn 1: Opprett en AI-agent i OneUptime

1. Logg inn på OneUptime-dashbordet ditt
2. Gå til **Prosjektinnstillinger** > **AI-agenter**
3. Klikk **Opprett AI-agent** for å legge til en ny agent
4. Fyll inn de påkrevde feltene:
   - **Navn**: Et vennlig navn for AI-agenten din
   - **Beskrivelse** (valgfritt): En beskrivelse av agentens formål
5. Når den er opprettet, mottar du en `AI_AGENT_ID` og `AI_AGENT_KEY`

**Viktig**: Lagre `AI_AGENT_KEY` på et sikkert sted. Den vises kun én gang og kan ikke hentes igjen.

### Trinn 2: Distribuer AI-agenten

#### Docker

For å kjøre en AI-agent, sørg for at Docker er installert. Kjør agenten med:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Hvis du selvhoster OneUptime, endre `ONEUPTIME_URL` til din egendefinerte selvhostede instans-URL.

#### Docker Compose

Du kan også kjøre AI-agenten ved hjelp av docker-compose. Opprett en `docker-compose.yml`-fil:

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

Kjør deretter:

```bash
docker compose up -d
```

#### Kubernetes

Opprett en `oneuptime-ai-agent.yaml`-fil:

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

Bruk konfigurasjonen:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Miljøvariabler

AI-agenten støtter følgende miljøvariabler:

#### Påkrevde variabler

| Variabel        | Beskrivelse                                                          |
| --------------- | -------------------------------------------------------------------- |
| `AI_AGENT_KEY`  | AI-agentnøkkelen fra OneUptime-dashbordet ditt                       |
| `AI_AGENT_ID`   | AI-agent-ID-en fra OneUptime-dashbordet ditt                         |
| `ONEUPTIME_URL` | URL-en til OneUptime-instansen din (standard: https://oneuptime.com) |

## Bekreft AI-agenten din

Etter distribusjon av AI-agenten:

1. Gå til **Prosjektinnstillinger** > **AI-agenter** i OneUptime-dashbordet ditt
2. Agenten din skal vises som **Tilkoblet** innen noen minutter
3. Hvis statusen viser **Frakoblet**, kontroller containerloggene for feil

For å se containerlogger:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Feilsøking

### Agenten kobler seg ikke til

1. **Verifiser legitimasjon**: Sørg for at `AI_AGENT_KEY` og `AI_AGENT_ID` er riktige
2. **Sjekk nettverket**: Sørg for at agenten kan nå OneUptime-instansen din
3. **Gjennomgå logger**: Sjekk containerlogger for feilmeldinger
4. **Brannmurregler**: Sørg for at utgående HTTPS (port 443) er tillatt

### Agenten kobler seg fra gjentatte ganger

1. **Sjekk ressursgrenser**: Sørg for at containeren har tilstrekkelig minne og CPU
2. **Nettverksstabilitet**: Bekreft at nettverkstilkoblingen er stabil
3. **Gjennomgå logger**: Se etter tidsavbrudd eller tilkoblingsfeil i loggene

## Trenger du hjelp?

Hvis du støter på problemer med AI-agenten din:

1. Sjekk [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kjente problemer
2. Opprett en ny sak hvis problemet ditt ikke allerede er rapportert
3. Kontakt [support](https://oneuptime.com/support) hvis du har en enterprise-plan
