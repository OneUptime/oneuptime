# LLM-Anbieter

OneUptime unterstützt die Integration verschiedener Large Language Model (LLM)-Anbieter, um KI-gestützte Funktionen in der gesamten Plattform zu ermöglichen. Diese Anleitung hilft Ihnen, Ihren eigenen LLM-Anbieter zu konfigurieren.

## Was können LLM-Anbieter tun?

LLM-Anbieter in OneUptime helfen Ihnen, Ihren Incident-Management-Workflow zu automatisieren und zu verbessern:

- **Incident-Notizen**: Automatisch detaillierte Incident-Notizen und Updates generieren
- **Benachrichtigungs-Notizen**: Aussagekräftige Benachrichtigungsbeschreibungen und Kontext erstellen
- **Wartungsnotizen für geplante Wartungen**: Automatisch Notizen zu Wartungsereignissen generieren
- **Incident-Postmortems**: Automatisch umfassende Incident-Postmortem-Berichte entwerfen
- **Code-Verbesserungen**: Wenn Sie Ihr Code-Repository mit OneUptime verbinden, verwenden wir Ihren LLM-Anbieter, um Telemetriedaten (Logs, Traces, Metriken, Ausnahmen) zu analysieren und Code-Verbesserungen vorzuschlagen

## OneUptime SaaS-Benutzer

Wenn Sie **OneUptime SaaS** (cloud-gehostete Version) verwenden, können Sie standardmäßig den **globalen LLM-Anbieter** ohne zusätzliche Konfiguration nutzen. Der globale LLM-Anbieter ist für alle KI-Funktionen vorkonfiguriert und einsatzbereit.

Wenn Sie bevorzugen, Ihre eigenen API-Schlüssel oder einen bestimmten Anbieter zu verwenden, können Sie trotzdem einen benutzerdefinierten LLM-Anbieter gemäß den nachfolgenden Anweisungen konfigurieren.

## Unterstützte Anbieter

OneUptime unterstützt derzeit die folgenden LLM-Anbieter:

| Anbieter      | Beschreibung                                                              | API-Schlüssel erforderlich | Basis-URL erforderlich    |
| ------------- | ------------------------------------------------------------------------- | -------------------------- | ------------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo und andere OpenAI-Modelle                    | Ja                         | Nein (verwendet Standard) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku und andere Claude-Modelle  | Ja                         | Nein (verwendet Standard) |
| **Ollama**    | Selbst gehostete Open-Source-Modelle wie Llama 2, Mistral, CodeLlama usw. | Nein                       | Ja                        |

## Einrichten eines LLM-Anbieters

### Schritt 1: Zu den LLM-Anbieter-Einstellungen navigieren

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Projekteinstellungen** > **KI** > **LLM-Anbieter**
3. Klicken Sie auf **LLM-Anbieter erstellen**, um einen neuen Anbieter hinzuzufügen

### Schritt 2: Ihren Anbieter konfigurieren

Füllen Sie die folgenden Felder aus:

- **Name**: Ein verständlicher Name für diese LLM-Konfiguration (z. B. "Production OpenAI", "Local Ollama")
- **Beschreibung** (optional): Eine Beschreibung, die den Zweck dieses Anbieters identifiziert
- **LLM-Typ**: Wählen Sie den Anbietertyp (OpenAI, Anthropic oder Ollama)
- **API-Schlüssel**: Ihr API-Schlüssel (erforderlich für OpenAI und Anthropic)
- **Modellname**: Das spezifische zu verwendende Modell (z. B. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Basis-URL** (optional): Benutzerdefinierte API-Endpunkt-URL (erforderlich für Ollama, optional für andere)

## Anbieterspezifische Konfiguration

### OpenAI

1. Holen Sie Ihren API-Schlüssel von der [OpenAI Platform](https://platform.openai.com/api-keys)
2. Wählen Sie **OpenAI** als LLM-Typ
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `gpt-4o` - Leistungsfähigstes Modell, am besten für komplexe Aufgaben
   - `gpt-4o-mini` - Schneller und kosteneffizienter
   - `gpt-4-turbo` - Gute Balance zwischen Leistung und Geschwindigkeit
   - `gpt-3.5-turbo` - Schnell und wirtschaftlich

**Beispielkonfiguration:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Holen Sie Ihren API-Schlüssel von der [Anthropic Console](https://console.anthropic.com/)
2. Wählen Sie **Anthropic** als LLM-Typ
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `claude-3-opus-20240229` - Leistungsfähigstes Modell
   - `claude-3-sonnet-20240229` - Gute Balance zwischen Intelligenz und Geschwindigkeit
   - `claude-3-haiku-20240307` - Schnellstes und kompaktestes Modell
   - `claude-3-5-sonnet-20241022` - Neuestes Sonnet-Modell

**Beispielkonfiguration:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (selbst gehostet)

Ollama ermöglicht Ihnen, Open-Source-LLMs lokal oder in Ihrer eigenen Infrastruktur zu betreiben.

1. Installieren Sie Ollama von [ollama.ai](https://ollama.ai)
2. Laden Sie Ihr gewünschtes Modell herunter: `ollama pull llama2`
3. Stellen Sie sicher, dass Ollama läuft und erreichbar ist
4. Wählen Sie **Ollama** als LLM-Typ
5. Geben Sie die Basis-URL ein (z. B. `http://localhost:11434`)
6. Geben Sie den heruntergeladenen Modellnamen ein

**Beispielkonfiguration:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Beliebte Ollama-Modelle:**

- `llama2` - Metas Llama 2-Modell
- `llama3` - Metas Llama 3-Modell
- `mistral` - Mistral AIs Modell
- `codellama` - Codespezifisches Llama-Modell
- `mixtral` - Mistrals Mixture-of-Experts-Modell

## Benutzerdefinierte Basis-URLs verwenden

Für Enterprise-Deployments oder bei der Verwendung von Proxy-Diensten können Sie eine benutzerdefinierte Basis-URL angeben:

- **Azure OpenAI**: Verwenden Sie Ihre Azure-Endpunkt-URL
- **OpenAI-kompatible APIs**: Jede API, die der OpenAI-API-Spezifikation folgt
- **Private Ollama-Instanzen**: Die URL Ihres internen Ollama-Servers

## Best Practices

1. **Beschreibende Namen verwenden**: Benennen Sie Ihre Anbieter klar (z. B. "Production GPT-4", "Development Ollama")
2. **API-Schlüssel sichern**: API-Schlüssel werden verschlüsselt gespeichert, aber teilen Sie sie nicht weiter
3. **Konfiguration testen**: Überprüfen Sie nach der Einrichtung, ob der Anbieter mit KI-Funktionen funktioniert
4. **Nutzung überwachen**: Verfolgen Sie die API-Nutzung, um Kosten zu verwalten

## Fehlerbehebung

### Verbindungsprobleme

- **OpenAI/Anthropic**: Überprüfen Sie, ob Ihr API-Schlüssel gültig ist und ausreichende Credits hat
- **Ollama**: Stellen Sie sicher, dass der Ollama-Server läuft und die Basis-URL korrekt ist
- **Firewall**: Prüfen Sie, ob Ihr Netzwerk ausgehende Verbindungen zur API des Anbieters erlaubt

### Modell nicht gefunden

- Überprüfen Sie, ob der Modellname korrekt geschrieben ist
- Für Ollama: Stellen Sie sicher, dass Sie das Modell mit `ollama pull <model-name>` heruntergeladen haben
- Prüfen Sie, ob das Modell in Ihrer Region verfügbar ist (einige Modelle haben regionale Einschränkungen)

## Hilfe benötigt?

Wenn Sie Probleme beim Einrichten Ihres LLM-Anbieters haben:

1. Prüfen Sie die [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) auf bekannte Probleme
2. Kontaktieren Sie den Support, wenn Sie einen Enterprise-Plan haben
