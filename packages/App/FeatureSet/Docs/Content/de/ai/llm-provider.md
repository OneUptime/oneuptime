# LLM-Anbieter

OneUptime unterstützt die Integration verschiedener Large Language Model (LLM)-Anbieter, um KI-gestützte Funktionen in der gesamten Plattform zu ermöglichen. Diese Anleitung hilft Ihnen, Ihren eigenen LLM-Anbieter zu konfigurieren.

## Was können LLM-Anbieter tun?

LLM-Anbieter in OneUptime helfen Ihnen, Ihren Incident-Management-Workflow zu automatisieren und zu verbessern:

- **Autonome Untersuchungen**: Neue Incidents und Benachrichtigungen automatisch untersuchen und eine belegte Ursachenanalyse in der Zeitleiste veröffentlichen — siehe [AI SRE](/docs/ai/ai-sre)
- **Incident-Notizen**: Automatisch detaillierte Incident-Notizen und Updates generieren
- **Benachrichtigungs-Notizen**: Aussagekräftige Benachrichtigungsbeschreibungen und Kontext erstellen
- **Wartungsnotizen für geplante Wartungen**: Automatisch Notizen zu Wartungsereignissen generieren
- **Incident-Postmortems**: Automatisch umfassende Incident-Postmortem-Berichte entwerfen
- **Code-Verbesserungen**: Wenn Sie Ihr Code-Repository mit OneUptime verbinden, verwenden wir Ihren LLM-Anbieter, um Telemetriedaten (Logs, Traces, Metriken, Ausnahmen) zu analysieren und Code-Verbesserungen vorzuschlagen

## OneUptime SaaS-Benutzer

Wenn Sie **OneUptime SaaS** (cloud-gehostete Version) verwenden, können Sie standardmäßig den **globalen LLM-Anbieter** ohne zusätzliche Konfiguration nutzen. Der globale LLM-Anbieter ist für alle KI-Funktionen vorkonfiguriert und einsatzbereit.

Wenn Sie bevorzugen, Ihre eigenen API-Schlüssel oder einen bestimmten Anbieter zu verwenden, können Sie trotzdem einen benutzerdefinierten LLM-Anbieter gemäß den nachfolgenden Anweisungen konfigurieren.

OneUptime SaaS kann nur LLM-Endpunkte im öffentlichen Internet erreichen. Mit einem Modell in Ihrem privaten Netzwerk, etwa einem selbst gehosteten Ollama- oder vLLM-Server, kann es sich nicht verbinden. Um ein Modell zu nutzen, das Sie selbst betreiben, hosten Sie OneUptime selbst in einem Netzwerk, das dieses Modell erreicht, oder stellen Sie das Modell unter einem öffentlichen Endpunkt bereit — siehe [Basis-URL für ein selbst gehostetes Modell wählen](#basis-url-für-ein-selbst-gehostetes-modell-wählen).

## Selbst gehostet: Einrichtung nur über Umgebungsvariablen

Auf einer selbst gehosteten Instanz aktivieren Sie KI-Funktionen am schnellsten für **alle Projekte auf einmal**, indem Sie die Umgebungsvariablen `GLOBAL_LLM_PROVIDER_*` auf Ihrem OneUptime-Server setzen — in `config.env` bei Docker Compose oder über die Helm-Values. Beim Start registriert OneUptime daraus einen globalen LLM-Anbieter (und hält ihn synchron); eine Einrichtung im Dashboard für jedes einzelne Projekt ist nicht nötig, und KI-Korrekturaufgaben verwenden ihn ebenfalls, wenn ein Projekt keinen eigenen Anbieter hat.

| Variable | Beschreibung |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Zum Aktivieren erforderlich. Einer dieser Werte: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-Schlüssel — erforderlich für OpenAI, Azure OpenAI, Anthropic, Groq und Mistral; nicht nötig für Ollama oder OpenAI-kompatible Server ohne Schlüssel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API-Endpunkt — erforderlich für Azure OpenAI, Ollama und OpenAI-kompatible Server |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Zu verwendendes Modell (erforderlich für OpenAI-kompatible Server, sonst empfohlen) |
| `GLOBAL_LLM_PROVIDER_NAME` | Optionaler Anzeigename, der im Dashboard erscheint |

**Beispiel: selbst gehostetes Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# Eine Adresse, die der OneUptime-Server erreicht. Nie localhost: siehe
# "Basis-URL für ein selbst gehostetes Modell wählen" weiter unten.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Kein API-Schlüssel nötig — Ollama arbeitet ohne Schlüssel.
```

**Beispiel: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

Die Synchronisierung ist deklarativ: Wenn Sie die Variablen ändern, wird der Anbieter beim nächsten Neustart aktualisiert, und wenn Sie `GLOBAL_LLM_PROVIDER_TYPE` entfernen, wird er gelöscht. Globale Anbieter, die manuell im Admin-Dashboard angelegt wurden, bleiben unberührt. Projekte können weiterhin unter **Projekteinstellungen** > **KI** > **LLM-Anbieter** einen eigenen Anbieter hinzufügen — ein projekteigener Anbieter hat immer Vorrang vor dem globalen.

## Unterstützte Anbieter

OneUptime unterstützt derzeit die folgenden LLM-Anbieter:

| Anbieter              | Beschreibung                                                               | API-Schlüssel erforderlich | Basis-URL erforderlich    |
| --------------------- | -------------------------------------------------------------------------- | -------------------------- | ------------------------- |
| **OpenAI**            | GPT-5.1 und andere OpenAI-Modelle                                          | Ja                         | Nein (verwendet Standard) |
| **Azure OpenAI**      | OpenAI-Modelle, gehostet auf Ihrem Azure-Deployment                        | Ja                         | Ja                        |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5 und andere Claude-Modelle | Ja                         | Nein (verwendet Standard) |
| **Groq**              | Schnelle Inferenz für Llama, Mixtral und andere offene Modelle             | Ja                         | Nein (verwendet Standard) |
| **Mistral**           | Von Mistral gehostete Modelle                                              | Ja                         | Nein (verwendet Standard) |
| **Ollama**            | Selbst gehostete Open-Source-Modelle wie Llama 3.1, Mistral, Qwen usw.     | Nein                       | Ja                        |
| **OpenAI Compatible** | Jeder OpenAI-kompatible Server (vLLM, LocalAI, LM Studio usw.)             | Nein (optional)            | Ja                        |

## Einrichten eines LLM-Anbieters

### Schritt 1: Zu den LLM-Anbieter-Einstellungen navigieren

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Projekteinstellungen** > **KI** > **LLM-Anbieter**
3. Klicken Sie auf **LLM-Anbieter erstellen**, um einen neuen Anbieter hinzuzufügen

### Schritt 2: Ihren Anbieter konfigurieren

Füllen Sie die folgenden Felder aus:

- **Name**: Ein verständlicher Name für diese LLM-Konfiguration (z. B. "Production OpenAI", "Local Ollama")
- **Beschreibung** (optional): Eine Beschreibung, die den Zweck dieses Anbieters identifiziert
- **LLM-Anbieter**: Wählen Sie den Anbietertyp (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama oder OpenAI Compatible)
- **API-Schlüssel**: Ihr API-Schlüssel (erforderlich für OpenAI, Azure OpenAI, Anthropic, Groq und Mistral; optional für Ollama und OpenAI-kompatible Server)
- **Modellname**: Das spezifische zu verwendende Modell (z. B. `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **Basis-URL** (optional): Benutzerdefinierte API-Endpunkt-URL (erforderlich für Azure OpenAI, Ollama und OpenAI Compatible; optional für andere)
- **Weitere Felder**, unter den Feldern oben eingeklappt: **Als Standard festlegen**, bei einem neuen Anbieter eingeschaltet, weil KI-Funktionen nur den Standardanbieter des Projekts verwenden, und **Zusätzliche Parameter**, ein optionales JSON-Objekt mit weiteren Parametern, das bei jeder Anfrage an den Anbieter gesendet wird (zum Beispiel `{"temperature": 0.2}`)

## Anbieterspezifische Konfiguration

### OpenAI

1. Holen Sie Ihren API-Schlüssel von der [OpenAI Platform](https://platform.openai.com/api-keys)
2. Wählen Sie **OpenAI** als LLM-Anbieter
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `gpt-5.1` - Empfohlener Standard, stark bei Tool-Calling und komplexen Untersuchungen
   - `gpt-5.1-mini` - Schneller und kosteneffizienter

**Beispielkonfiguration:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Holen Sie Ihren API-Schlüssel von der [Anthropic Console](https://console.anthropic.com/)
2. Wählen Sie **Anthropic** als LLM-Anbieter
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `claude-sonnet-5` - Empfohlener Standard, beste Balance aus Intelligenz, Geschwindigkeit und Kosten
   - `claude-opus-5` - Leistungsfähigstes Modell, für die schwierigsten Untersuchungen
   - `claude-haiku-4-5` - Schnellstes und kosteneffizientestes Modell

**Beispielkonfiguration:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5
```

### Ollama (selbst gehostet)

Ollama ermöglicht Ihnen, Open-Source-LLMs lokal oder in Ihrer eigenen Infrastruktur zu betreiben.

1. Installieren Sie Ollama von [ollama.ai](https://ollama.ai)
2. Laden Sie Ihr gewünschtes Modell herunter: `ollama pull llama3.1`
3. Stellen Sie sicher, dass Ollama läuft und vom OneUptime-Server aus erreichbar ist. Eine native Installation lauscht nur auf `127.0.0.1`; starten Sie sie daher mit `OLLAMA_HOST=0.0.0.0:11434`, damit sie Verbindungen von anderen Rechnern und Containern annimmt (das offizielle Docker-Image `ollama/ollama` tut das bereits)
4. Wählen Sie **Ollama** als LLM-Anbieter
5. Geben Sie die Basis-URL ein: die Adresse des Ollama-Servers, wie der OneUptime-Server sie erreicht, z. B. `http://ollama:11434` (OneUptime hängt `/api/chat` selbst an). `localhost` funktioniert nicht — siehe [Basis-URL für ein selbst gehostetes Modell wählen](#basis-url-für-ein-selbst-gehostetes-modell-wählen)
6. Geben Sie den heruntergeladenen Modellnamen ein

**Beispielkonfiguration (Ollama als Dienst namens `ollama` im Docker-Compose-Netzwerk von OneUptime):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Kontextfenster vergrößern.** Ohne weitere Angabe betreibt Ollama ein Modell mit einem kleinen Kontextfenster (4096 Token in aktuellen Versionen, 2048 in älteren) und schneidet stillschweigend ab, was nicht hineinpasst. Die KI-Funktionen von OneUptime senden mit jeder Anfrage ihre Tool-Definitionen, und allein diese können mehrere tausend Token umfassen. Werden sie abgeschnitten, gibt es keinen Fehler: Das Modell antwortet einfach, es habe kein Tool für die Frage. Setzen Sie im Feld **Zusätzliche Parameter** des Anbieters einen größeren Wert für `num_ctx`:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime führt dieses `options`-Objekt mit den Optionen zusammen, die es an Ollama sendet; geben Sie also nur die Einstellungen an, die Sie ändern möchten. Ein größeres Kontextfenster braucht mehr Speicher; wählen Sie deshalb eine Größe, die Ihr Modell unterstützt und Ihre Hardware verkraftet. Um stattdessen den Standardwert für alle Clients anzuheben, setzen Sie `OLLAMA_CONTEXT_LENGTH` auf dem Ollama-Server. Bei einem globalen Anbieter, der aus `GLOBAL_LLM_PROVIDER_*`-Variablen registriert wird, setzen Sie das Feld im Admin-Dashboard unter **Einstellungen** > **Globale LLM-Anbieter**; die Synchronisierung beim Start lässt dieses Feld unverändert.

**Beliebte Ollama-Modelle:**

- `llama3.1` - Metas Llama-3.1-Modell, das älteste Llama mit Unterstützung für Tool-Calling
- `llama3.3` - Metas Llama-3.3-Modell
- `qwen2.5` - Alibabas Qwen-2.5-Modell
- `mistral-nemo` - Mistral AIs Nemo-Modell

> Hinweis: Die KI-Funktionen von OneUptime sind agentisch — sie stützen sich stark auf Tool-Calling. Verwenden Sie `llama3.1` oder neuer (oder ein anderes Modell mit Tool-Calling-Unterstützung). Kleine Modelle oder Modelle ohne Tool-Calling (z. B. `llama2` oder das ursprüngliche `llama3`) liefern schlechte Ergebnisse: Sie können Ihre Monitore, Vorfälle oder Telemetriedaten nicht abfragen, sodass Untersuchungen leer oder halluziniert zurückkommen.

### Basis-URL für ein selbst gehostetes Modell wählen

Die Basis-URL eines selbst gehosteten Modells — Ollama, vLLM, LM Studio oder ein anderer OpenAI-kompatibler Server — muss eine Adresse sein, die der **OneUptime-Server** erreichen kann. Ihr Browser verbindet sich nie mit ihr.

**Loopback-Adressen werden immer abgelehnt.** Vor dem Verbindungsaufbau prüft OneUptime jede Adresse, in die der Hostname der Basis-URL aufgelöst wird. `localhost`, `127.0.0.1`, `[::1]` und `0.0.0.0` sowie Link-Local-Adressen und Cloud-Metadaten-Adressen wie `169.254.169.254` werden in jeder Installation abgelehnt, auch bei Selbsthosting. Das ist Absicht: Über die Basis-URL eines Anbieters dürfen keine Dienste auf dem OneUptime-Server selbst erreichbar sein. Innerhalb von Docker Compose oder Kubernetes wäre `localhost` ohnehin der OneUptime-Container, nicht der Rechner, auf dem Ihr Modell läuft.

Verwenden Sie stattdessen eine private Adresse oder einen internen Hostnamen:

| Wo der Modellserver läuft | Basis-URL |
| --- | --- |
| Als Dienst im Docker-Compose-Netzwerk von OneUptime (`oneuptime`) | Der Dienstname, z. B. `http://ollama:11434` |
| Im selben Kubernetes-Cluster wie OneUptime | Der DNS-Name des Service, z. B. `http://ollama.<namespace>.svc.cluster.local:11434` — dasselbe Muster wie beim [mitgelieferten vLLM](#selbst-gehostetes-vllm-auf-kubernetes-helm) |
| Direkt auf dem Host, außerhalb von Containern | Die LAN-IP des Hosts, z. B. `http://192.168.1.20:11434`, oder `http://host.docker.internal:11434` unter Docker Desktop |
| Auf einem anderen Rechner in Ihrem Netzwerk | Dessen private IP oder interner Hostname, z. B. `http://10.0.0.12:11434` |

OpenAI-kompatible Server folgen denselben Regeln mit eigenem Port und `/v1`-Pfad, z. B. `http://vllm:8000/v1` oder `http://192.168.1.20:1234/v1` für LM Studio. Wie eine native Ollama-Installation lauscht LM Studio nur auf `127.0.0.1`, bis Sie in seinen Servereinstellungen **Serve on Local Network** aktivieren.

**Private Adressen funktionieren bei selbst gehosteten Installationen.** Ein selbst gehostetes OneUptime kann private Netzwerkadressen erreichen, etwa `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` und IPv6 `fc00::/7` — es sei denn, Sie setzen `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`; dann werden sie wie in OneUptime Cloud abgelehnt. Diese Einstellung gilt nicht für einen globalen LLM-Anbieter, den ein Administrator statt eines Projekts einrichtet (über die `GLOBAL_LLM_PROVIDER_*`-Variablen oder im Admin-Dashboard): Er kann private Adressen weiterhin erreichen. Loopback- und Link-Local-Adressen bleiben für jeden Anbieter abgelehnt.

**OneUptime Cloud (SaaS) kann keine privaten Netzwerke erreichen.** Es lehnt private Netzwerkadressen und Hostnamen, die in solche aufgelöst werden, für jeden LLM-Anbieter ab. Um ein Modell zu nutzen, das auf Ihrer eigenen Infrastruktur läuft, hosten Sie OneUptime entweder selbst in einem Netzwerk, das es erreicht, oder stellen Sie das Modell unter einem öffentlich erreichbaren Endpunkt bereit. Schützen Sie einen öffentlichen Endpunkt mit einem API-Schlüssel: Der Anbieter **Ollama** sendet keine Zugangsdaten, **OpenAI Compatible** dagegen sendet den API-Schlüssel als Bearer-Token (Ollama stellt unter `/v1` auch eine OpenAI-kompatible API bereit und kann daher hinter einem Reverse Proxy stehen, der den Schlüssel prüft).

### OpenAI Compatible (vLLM, LocalAI, LM Studio usw.)

Verwenden Sie den Anbieter **OpenAI Compatible** für jeden Server, der die OpenAI-API `/chat/completions` implementiert, aber nicht OpenAI selbst ist — zum Beispiel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) oder text-generation-webui. Diese werden in der Regel unter Ihrer eigenen URL selbst gehostet und laufen häufig ohne Authentifizierung.

1. Starten Sie Ihren OpenAI-kompatiblen Server und notieren Sie sich dessen Basis-URL (sie endet in der Regel auf `/v1`)
2. Wählen Sie **OpenAI Compatible** als LLM-Anbieter
3. Geben Sie die **Basis-URL** ein (erforderlich), z. B. `http://your-server:8000/v1`. Sie muss vom OneUptime-Server aus erreichbar sein, also nicht `localhost` — siehe [Basis-URL für ein selbst gehostetes Modell wählen](#basis-url-für-ein-selbst-gehostetes-modell-wählen)
4. Geben Sie den **Modellnamen** ein (erforderlich) — er muss mit einem von Ihrem Server bereitgestellten Modell übereinstimmen
5. Geben Sie den **API-Schlüssel** nur ein, wenn Ihr Server einen benötigt; lassen Sie ihn bei schlüssellosen Servern leer

**Beispielkonfiguration (schlüsselloses vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tipp: Verwenden Sie nach dem Speichern die Schaltfläche **Testen** beim Anbieter, um zu prüfen, ob Verbindung, Modellname und Basis-URL korrekt sind.

### Selbst gehostetes vLLM auf Kubernetes (Helm)

Wenn Sie OneUptime selbst mit dem Helm-Chart hosten, können Sie [vLLM](https://docs.vllm.ai) — einen OpenAI-kompatiblen Inferenzserver — in Ihrem Cluster betreiben und lokale Modelle auf Ihren eigenen GPUs bereitstellen. Dabei verlassen keine Daten Ihre Infrastruktur.

1. Aktivieren Sie es in Ihren Helm-Values (erfordert NVIDIA-GPU-Nodes):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Führen Sie `helm upgrade` aus und warten Sie, bis der vLLM-Pod bereit (Ready) ist (beim ersten Start wird das Modell heruntergeladen)
3. Das war's — vLLM wird beim Start automatisch als globaler LLM-Anbieter registriert (`vllm.globalProvider.enabled`, Standard `true`), sodass KI-Funktionen für alle Projekte funktionieren, auch KI-Korrekturaufgaben. (Überall — in der Cloud wie bei Selbsthosting — verwenden die Korrekturaufgaben des Agenten den globalen Anbieter, wenn das Projekt keinen eigenen Anbieter hat; in der Cloud wird diese Nutzung als gemessene KI-Token abgerechnet. Ein projekteigener Anbieter hat immer Vorrang.)

Wenn Sie die automatische Registrierung deaktiviert haben (`vllm.globalProvider.enabled: false`), erstellen Sie den Anbieter manuell:

1. Wählen Sie **OpenAI Compatible** als LLM-Anbieter (vLLM spricht die OpenAI-API)
2. Geben Sie die clusterinterne Basis-URL ein: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (ersetzen Sie `cluster.local`, wenn Sie `global.clusterDomain` geändert haben)
3. Geben Sie den Modellnamen ein: die vollständige HuggingFace-Modell-ID (oder `vllm.servedModelName`, falls gesetzt)
4. Geben Sie den API-Schlüssel nur ein, wenn Sie `vllm.apiKey` gesetzt haben; lassen Sie ihn bei einem schlüssellosen vLLM leer

**Beispielkonfiguration:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Bei aktivierter Abrechnung oder mit `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in den Helm-Values) kann ein projekteigener Anbieter diese clusterinterne Adresse nicht erreichen, denn sie wird in eine private Cluster-IP aufgelöst. Legen Sie den Anbieter stattdessen im Admin-Dashboard unter **Einstellungen** > **Globale LLM-Anbieter** mit denselben Feldern an: Ein globaler LLM-Anbieter kann diese Adresse erreichen.

Weitere Informationen zu GPU-Scheduling, geschützten (gated) Modellen und Tuning-Optionen finden Sie im [vLLM-Leitfaden des Helm-Charts](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md).

## Benutzerdefinierte Basis-URLs verwenden

Für Enterprise-Deployments oder bei der Verwendung von Proxy-Diensten können Sie eine benutzerdefinierte Basis-URL angeben:

- **Azure OpenAI**: Verwenden Sie Ihre Azure-Endpunkt-URL
- **OpenAI-kompatible APIs**: Jede API, die der OpenAI-API-Spezifikation folgt
- **Private Ollama-Instanzen**: Die URL Ihres internen Ollama-Servers

## Best Practices

1. **Beschreibende Namen verwenden**: Benennen Sie Ihre Anbieter klar (z. B. "Production OpenAI", "Development Ollama")
2. **API-Schlüssel sichern**: API-Schlüssel werden verschlüsselt gespeichert, aber teilen Sie sie nicht weiter
3. **Konfiguration testen**: Überprüfen Sie nach der Einrichtung, ob der Anbieter mit KI-Funktionen funktioniert
4. **Nutzung überwachen**: Verfolgen Sie die API-Nutzung, um Kosten zu verwalten

## Fehlerbehebung

### Verbindungsprobleme

- **OpenAI/Anthropic**: Überprüfen Sie, ob Ihr API-Schlüssel gültig ist und ausreichende Credits hat
- **Ollama**: Stellen Sie sicher, dass der Ollama-Server läuft, auf einer Adresse lauscht, die der OneUptime-Server erreichen kann (`OLLAMA_HOST=0.0.0.0:11434` bei einer nativen Installation), und dass die Basis-URL auf diese Adresse zeigt
- **OpenAI Compatible**: Stellen Sie sicher, dass die Basis-URL auf `/v1` endet (oder Ihrem Server entspricht), der Modellname mit einem von Ihrem Server bereitgestellten Modell übereinstimmt und ein API-Schlüssel nur gesetzt ist, wenn Ihr Server einen benötigt
- **"…points to an address OneUptime is not allowed to connect to"**: Die Basis-URL wird in eine abgelehnte Adresse aufgelöst — `localhost` oder eine andere Loopback-Adresse oder, in OneUptime Cloud, eine private Netzwerkadresse. (OneUptime Cloud meldet einen abgelehnten Hostnamen stattdessen als "…could not be reached".) Siehe [Basis-URL für ein selbst gehostetes Modell wählen](#basis-url-für-ein-selbst-gehostetes-modell-wählen)
- **Firewall**: Prüfen Sie, ob Ihr Netzwerk ausgehende Verbindungen zur API des Anbieters erlaubt

### Modell nicht gefunden

- Überprüfen Sie, ob der Modellname korrekt geschrieben ist
- Für Ollama: Stellen Sie sicher, dass Sie das Modell mit `ollama pull <model-name>` heruntergeladen haben
- Prüfen Sie, ob das Modell in Ihrer Region verfügbar ist (einige Modelle haben regionale Einschränkungen)

## Hilfe benötigt?

Wenn Sie Probleme beim Einrichten Ihres LLM-Anbieters haben:

1. Prüfen Sie die [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) auf bekannte Probleme
2. Kontaktieren Sie den Support, wenn Sie einen Enterprise-Plan haben
