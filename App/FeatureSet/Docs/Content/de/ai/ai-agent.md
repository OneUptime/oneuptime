# KI-Agenten

KI-Agenten in OneUptime beheben automatisch Fehler, Leistungsprobleme und Datenbankabfragen in Ihrem Code. Auf Basis von OpenTelemetry-Observability-Daten erstellen KI-Agenten Pull Requests mit Korrekturen – nicht nur Benachrichtigungen.

## Was können KI-Agenten tun?

KI-Agenten analysieren Ihre Observability-Daten (Traces, Logs und Metriken), um Probleme in Ihrer Codebasis zu erkennen und automatisch zu beheben:

- **Fehler automatisch beheben**: Wenn der KI-Agent Ausnahmen in Ihren Traces oder Logs erkennt, behebt er das Problem automatisch und erstellt einen Pull Request.
- **Leistungsprobleme beheben**: Analysiert Traces mit der längsten Ausführungszeit und erstellt Pull Requests mit Leistungsoptimierungen.
- **Datenbankabfragen optimieren**: Identifiziert langsame oder ineffiziente Datenbankabfragen und optimiert diese durch geeignete Indizierung und Umschreibung.
- **Frontend-Probleme beheben**: Behebt frontend-spezifische Leistungsprobleme, Rendering-Fehler und JavaScript-Fehler automatisch.
- **Telemetrie automatisch hinzufügen**: Fügt Ihrer Codebasis mit einem Klick Tracing, Metriken und Logs hinzu. Keine manuelle Instrumentierung erforderlich.
- **GitHub & GitLab-Integration**: Nahtlose Integration mit Ihren bestehenden Repositories. Pull Requests werden direkt in Ihrem Workflow erstellt.
- **CI/CD-Integration**: Integriert sich in Ihre bestehenden CI/CD-Pipelines. Korrekturen werden vor der PR-Erstellung getestet und validiert.
- **Terraform-Unterstützung**: Behebt Infrastrukturprobleme automatisch. Unterstützt Terraform und OpenTofu für Infrastructure-as-Code.
- **Issue-Tracker-Integration**: Verbindet sich mit Jira, Linear und anderen Issue-Trackern. Verknüpft Korrekturen automatisch mit relevanten Issues.

## Funktionsweise

1. **Daten erfassen**: OpenTelemetry sammelt Traces, Logs und Metriken aus Ihrer Anwendung
2. **Probleme erkennen**: KI identifiziert Fehler, Leistungsengpässe und langsame Abfragen
3. **Korrektur generieren**: KI analysiert Ihre Codebasis und erstellt die Korrektur automatisch
4. **PR erstellen**: Pull Request mit Korrektur und detailliertem Bericht steht zur Überprüfung bereit

## LLM-Anbieter-Flexibilität

OneUptime funktioniert mit jedem LLM-Anbieter. Sie können verwenden:

- **OpenAI GPT**-Modelle
- **Anthropic Claude**-Modelle
- **Meta Llama** (über Ollama oder andere Anbieter)
- **Benutzerdefinierte selbst gehostete** Modelle

Hosten Sie Ihr KI-Modell selbst und halten Sie Ihren Code vollständig privat.

## Datenschutz

Unabhängig von Ihrem Plan sieht, speichert oder trainiert OneUptime niemals mit Ihrem Code:

- **Kein Code-Zugriff**: Ihr Code verbleibt in Ihrer Infrastruktur
- **Keine Datenspeicherung**: Null-Datenspeicherungsrichtlinie
- **Kein Training**: Ihr Code wird niemals für KI-Training verwendet

## Globale KI-Agenten vs. selbst gehostete KI-Agenten

### Globale KI-Agenten

Wenn Sie **OneUptime SaaS** (cloud-gehostete Version) verwenden, werden globale KI-Agenten von OneUptime bereitgestellt und sind vorkonfiguriert und einsatzbereit. Diese Agenten werden von OneUptime verwaltet und erfordern keine zusätzliche Einrichtung.

Globale KI-Agenten sind automatisch für alle Projekte verfügbar, sofern sie nicht in Ihren Projekteinstellungen deaktiviert wurden.

### Selbst gehostete KI-Agenten

Für Organisationen, die KI-Agenten innerhalb ihrer eigenen Infrastruktur betreiben müssen (z. B. aus Sicherheits-, Compliance- oder Netzwerkzugangsanforderungen), unterstützt OneUptime selbst gehostete KI-Agenten.

Selbst gehostete KI-Agenten:

- Laufen innerhalb Ihres privaten Netzwerks
- Können auf interne Ressourcen und Systeme zugreifen
- Geben Ihnen vollständige Kontrolle über die Umgebung des Agenten
- Können für Ihre spezifischen Anforderungen angepasst werden

## Einrichten eines selbst gehosteten KI-Agenten

### Schritt 1: KI-Agenten in OneUptime erstellen

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Projekteinstellungen** > **KI-Agenten**
3. Klicken Sie auf **KI-Agent erstellen**, um einen neuen Agenten hinzuzufügen
4. Füllen Sie die erforderlichen Felder aus:
   - **Name**: Ein verständlicher Name für Ihren KI-Agenten
   - **Beschreibung** (optional): Eine Beschreibung des Zwecks des Agenten
5. Nach der Erstellung erhalten Sie eine `AI_AGENT_ID` und einen `AI_AGENT_KEY`

**Wichtig**: Speichern Sie Ihren `AI_AGENT_KEY` sicher. Er wird nur einmal angezeigt und kann später nicht mehr abgerufen werden.

### Schritt 2: KI-Agenten bereitstellen

#### Docker

Um einen KI-Agenten auszuführen, stellen Sie sicher, dass Docker installiert ist. Führen Sie den Agenten aus mit:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Wenn Sie OneUptime selbst hosten, ändern Sie `ONEUPTIME_URL` auf die URL Ihrer benutzerdefinierten selbst gehosteten Instanz.

#### Docker Compose

Sie können den KI-Agenten auch mit docker-compose ausführen. Erstellen Sie eine `docker-compose.yml`-Datei:

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

Dann ausführen:

```bash
docker compose up -d
```

#### Kubernetes

Erstellen Sie eine `oneuptime-ai-agent.yaml`-Datei:

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

Konfiguration anwenden:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Umgebungsvariablen

Der KI-Agent unterstützt die folgenden Umgebungsvariablen:

#### Erforderliche Variablen

| Variable        | Beschreibung                                                      |
| --------------- | ----------------------------------------------------------------- |
| `AI_AGENT_KEY`  | Der KI-Agentenschlüssel aus Ihrem OneUptime-Dashboard             |
| `AI_AGENT_ID`   | Die KI-Agenten-ID aus Ihrem OneUptime-Dashboard                   |
| `ONEUPTIME_URL` | Die URL Ihrer OneUptime-Instanz (Standard: https://oneuptime.com) |

## Ihren KI-Agenten verifizieren

Nach der Bereitstellung Ihres KI-Agenten:

1. Gehen Sie zu **Projekteinstellungen** > **KI-Agenten** in Ihrem OneUptime-Dashboard
2. Ihr Agent sollte innerhalb weniger Minuten als **Verbunden** angezeigt werden
3. Wenn der Status **Getrennt** anzeigt, prüfen Sie die Container-Logs auf Fehler

Zum Anzeigen der Container-Logs:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Fehlerbehebung

### Agent stellt keine Verbindung her

1. **Anmeldedaten überprüfen**: Stellen Sie sicher, dass `AI_AGENT_KEY` und `AI_AGENT_ID` korrekt sind
2. **Netzwerk prüfen**: Stellen Sie sicher, dass der Agent Ihre OneUptime-Instanz erreichen kann
3. **Logs überprüfen**: Prüfen Sie Container-Logs auf Fehlermeldungen
4. **Firewall-Regeln**: Stellen Sie sicher, dass ausgehende HTTPS-Verbindungen (Port 443) erlaubt sind

### Agent trennt ständig die Verbindung

1. **Ressourcenlimits prüfen**: Stellen Sie sicher, dass der Container ausreichend Arbeitsspeicher und CPU hat
2. **Netzwerkstabilität**: Überprüfen Sie, ob die Netzwerkverbindung stabil ist
3. **Logs überprüfen**: Suchen Sie in den Logs nach Timeout- oder Verbindungsfehlern

## Hilfe benötigt?

Wenn Sie Probleme mit Ihrem KI-Agenten haben:

1. Prüfen Sie die [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) auf bekannte Probleme
2. Erstellen Sie ein neues Issue, wenn Ihr Problem noch nicht gemeldet wurde
3. Wenden Sie sich an den [Support](https://oneuptime.com/support), wenn Sie einen Enterprise-Plan haben
