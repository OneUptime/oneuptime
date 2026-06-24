# AI Agenter

AI Agenter i OneUptime retter automatisk fejl, ydeevneproblemer og databaseforespørgsler i din kode. Drevet af OpenTelemetry-observabilitetsdata opretter AI Agenter pull requests med rettelser – ikke kun advarsler.

## Hvad kan AI Agenter gøre?

AI Agenter analyserer dine observabilitetsdata (traces, logs og metrikker) for at opdage og automatisk rette problemer i din kodebase:

- **Ret fejl automatisk**: Når AI Agenten registrerer undtagelser i dine traces eller logs, retter den automatisk problemet og opretter en pull request.
- **Ret ydeevneproblemer**: Analyserer traces, der tager længst tid at eksekvere, og opretter pull requests med ydeevneoptimeringer.
- **Ret databaseforespørgsler**: Identificerer langsomme eller ineffektive databaseforespørgsler og optimerer dem med korrekt indeksering og omskrivning af forespørgsler.
- **Ret frontend-problemer**: Adresserer frontend-specifikke ydeevneproblemer, gengivelsesproblemer og JavaScript-fejl automatisk.
- **Tilføj telemetri automatisk**: Tilføj tracing, metrikker og logs til din kodebase med et enkelt klik. Ingen manuel instrumentering er nødvendig.
- **GitHub & GitLab-integration**: Integrerer problemfrit med dine eksisterende repositories. PR'er oprettes direkte i din arbejdsgang.
- **CI/CD-integration**: Integreres med dine eksisterende CI/CD-pipelines. Rettelser testes og valideres inden oprettelse af PR.
- **Terraform-understøttelse**: Ret infrastrukturproblemer automatisk. Understøtter Terraform og OpenTofu til infrastruktur-som-kode.
- **Integration med issue-tracker**: Forbindes med Jira, Linear og andre issue-trackere. Forbinder automatisk rettelser med relevante issues.

## Sådan fungerer det

1. **Indsaml data**: OpenTelemetry indsamler traces, logs og metrikker fra din applikation
2. **Registrer problemer**: AI identificerer fejl, ydeevneflaskehalse og langsomme forespørgsler
3. **Generer rettelse**: AI analyserer din kodebase og opretter rettelsen automatisk
4. **Opret PR**: Pull request med rettelse og detaljeret rapport klar til gennemgang

## Fleksibilitet med LLM-udbyder

OneUptime fungerer med enhver LLM-udbyder. Du kan bruge:

- **OpenAI GPT**-modeller
- **Anthropic Claude**-modeller
- **Meta Llama** (via Ollama eller andre udbydere)
- **Egne selvhostede** modeller

Selvhost din AI-model og hold din kode fuldstændig privat.

## Privatliv

Uanset din plan ser, gemmer eller træner OneUptime aldrig på din kode:

- **Ingen kodeadgang**: Din kode forbliver på din infrastruktur
- **Ingen datalagring**: Politik om nul dataopbevaring
- **Ingen træning**: Din kode bruges aldrig til AI-træning

## Globale AI Agenter vs. selvhostede AI Agenter

### Globale AI Agenter

Hvis du bruger **OneUptime SaaS** (skyhosted version), leveres Globale AI Agenter af OneUptime og er forudkonfigureret og klar til brug. Disse agenter administreres af OneUptime og kræver ingen yderligere opsætning.

Globale AI Agenter er automatisk tilgængelige for alle projekter, medmindre de er deaktiveret i dine projektindstillinger.

### Selvhostede AI Agenter

For organisationer, der har behov for at køre AI-agenter inden for deres egen infrastruktur (f.eks. af sikkerhedsmæssige, compliancemæssige eller netværksrelaterede årsager), understøtter OneUptime selvhostede AI-agenter.

Selvhostede AI-agenter:

- Kører inden for dit private netværk
- Kan få adgang til interne ressourcer og systemer
- Giver dig fuld kontrol over agentens miljø
- Kan tilpasses til dine specifikke behov

## Opsætning af en selvhostet AI Agent

### Trin 1: Opret en AI Agent i OneUptime

1. Log ind på dit OneUptime-dashboard
2. Gå til **Projektindstillinger** > **AI Agenter**
3. Klik på **Opret AI Agent** for at tilføje en ny agent
4. Udfyld de påkrævede felter:
   - **Navn**: Et brugervenligt navn til din AI-agent
   - **Beskrivelse** (valgfrit): En beskrivelse af agentens formål
5. Når den er oprettet, modtager du en `AI_AGENT_ID` og `AI_AGENT_KEY`

**Vigtigt**: Gem din `AI_AGENT_KEY` sikkert. Den vises kun én gang og kan ikke hentes igen.

### Trin 2: Deploy AI Agenten

#### Docker

For at køre en AI-agent skal du sørge for, at Docker er installeret. Kør agenten med:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Hvis du selvhoster OneUptime, skal du ændre `ONEUPTIME_URL` til din brugerdefinerede selvhostede instans-URL.

#### Docker Compose

Du kan også køre AI-agenten ved hjælp af docker-compose. Opret en `docker-compose.yml`-fil:

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

Kør derefter:

```bash
docker compose up -d
```

#### Kubernetes

Opret en `oneuptime-ai-agent.yaml`-fil:

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

Anvend konfigurationen:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Miljøvariabler

AI-agenten understøtter følgende miljøvariabler:

#### Påkrævede variabler

| Variabel        | Beskrivelse                                                        |
| --------------- | ------------------------------------------------------------------ |
| `AI_AGENT_KEY`  | AI-agentens nøgle fra dit OneUptime-dashboard                      |
| `AI_AGENT_ID`   | AI-agentens ID fra dit OneUptime-dashboard                         |
| `ONEUPTIME_URL` | URL'en til din OneUptime-instans (standard: https://oneuptime.com) |

## Bekræftelse af din AI Agent

Efter deployment af din AI-agent:

1. Gå til **Projektindstillinger** > **AI Agenter** i dit OneUptime-dashboard
2. Din agent bør vise som **Tilsluttet** inden for få minutter
3. Hvis status viser **Afbrudt**, skal du kontrollere containerloggene for fejl

For at se containerlogs:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Fejlfinding

### Agent opretter ikke forbindelse

1. **Bekræft legitimationsoplysninger**: Sørg for, at `AI_AGENT_KEY` og `AI_AGENT_ID` er korrekte
2. **Kontroller netværk**: Sørg for, at agenten kan nå din OneUptime-instans
3. **Gennemgå logs**: Kontroller containerlogs for fejlmeddelelser
4. **Firewall-regler**: Sørg for, at udgående HTTPS (port 443) er tilladt

### Agent afbryder løbende forbindelsen

1. **Kontroller ressourcegrænser**: Sørg for, at containeren har tilstrækkelig hukommelse og CPU
2. **Netværksstabilitet**: Bekræft, at netværksforbindelsen er stabil
3. **Gennemgå logs**: Se efter timeout eller forbindelsesfejl i loggene

## Har du brug for hjælp?

Hvis du støder på problemer med din AI-agent:

1. Tjek [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kendte problemer
2. Opret et nyt issue, hvis dit problem ikke allerede er rapporteret
3. Kontakt [support](https://oneuptime.com/support) hvis du er på en enterprise-plan
