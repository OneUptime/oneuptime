# LLM-Anbieter

Ein LLM-Anbieter ist das Modell hinter jeder KI-Funktion in OneUptime: Untersuchungen, KI fragen, Entwürfe und Korrektur-Pull-Requests. Diese Seite zeigt, welchen Anbieter eine Funktion verwendet, wie Sie einen eigenen hinzufügen (OpenAI, Azure OpenAI und Microsoft Foundry, Anthropic, Groq, Mistral, Ollama oder einen beliebigen OpenAI-kompatiblen Server) und wie Sie OneUptime auf ein Modell richten, das Sie selbst betreiben.

:::cards
- [Welchen Anbieter die KI verwendet](#welchen-anbieter-die-ki-verwendet): Den Standardanbieter des Projekts, sonst den globalen.
- [Selbst gehostet: ohne Konfiguration über Umgebungsvariablen](#selbst-gehostet-ohne-konfiguration-über-umgebungsvariablen): Ein Anbieter für jedes Projekt, aus den Einstellungen des Servers.
- [Einen LLM-Anbieter einrichten](#einen-llm-anbieter-einrichten): Einem Projekt einen Anbieter hinzufügen und ihn testen.
- [Eine Basis-URL für ein selbst gehostetes Modell wählen](#eine-basis-url-für-ein-selbst-gehostetes-modell-wählen): Eine Adresse, die der OneUptime-Server erreicht.
:::

## Was ein Anbieter antreibt

- **Untersuchungen**: OneUptime AI untersucht neue Vorfälle und Warnungen und veröffentlicht eine belegte Ursachenanalyse in der Zeitleiste. Siehe [AI SRE](/docs/ai/ai-sre).
- **Fragen**: **KI fragen** antwortet aus den Daten Ihres Projekts, mit einem Beleg für jede Aussage. Siehe [KI fragen](/docs/ai/ask-ai).
- **Entwürfe**: **Mit KI entwerfen** in den Notizen von Vorfällen, Warnungen und geplanten Wartungen sowie Postmortems, auf Anfrage entworfen oder wenn ein Vorfall gelöst wird.
- **Code**: Pull Requests, die Ausnahmen, langsame Traces und die von Untersuchungen gefundenen Ursachen beheben, aus OneUptime oder aus GitHub. Siehe [Code](/docs/ai/ai-agent).
- **Alles andere**: die Triage von AI Insights, die KI-Schritte von Workflows und Runbooks und Antworten in Slack und Microsoft Teams.

## Welchen Anbieter die KI verwendet

KI-Funktionen verwenden den Standardanbieter des Projekts. Ein Projekt ohne Standardanbieter verwendet den globalen Anbieter, wenn es einen gibt. KI fragen kann eine Unterhaltung außerdem auf einen anderen Anbieter des Projekts oder auf einen globalen umstellen.

```mermaid title="Welchen Anbieter eine KI-Funktion verwendet"
flowchart TB
    F["Eine KI-Funktion<br/>braucht<br/>ein Modell"] --> D{"Hat das Projekt<br/>einen Standard-<br/>anbieter?"}
    D -->|"ja"| P["Der Standardanbieter<br/>des Projekts"]
    D -->|"nein"| G{"Gibt es einen<br/>globalen<br/>Anbieter?"}
    G -->|"ja"| GP["Der globale<br/>Anbieter:<br/>KI-Guthaben in<br/>OneUptime Cloud"]
    G -->|"nein"| N["Nichts läuft,<br/>und die<br/>KI-Seiten<br/>melden einen<br/>fehlenden<br/>Anbieter"]
```

Ein Anbieter ist der Standard eines Projekts, wenn **Als Standard festlegen** eingeschaltet ist, was bei jedem neuen Anbieter der Fall ist. Ein Projekt, bei dessen Anbietern der Standard überall ausgeschaltet ist, weicht auf den globalen Anbieter aus, als hätte es keinen.

Jede OneUptime-AI-Regel – KI-Regeln und Postmortem-Regeln – kann stattdessen unter **Weitere Felder** einen eigenen Anbieter wählen: einen der Anbieter des Projekts oder einen globalen, der für alles genutzt wird, was die Regel startet. Eine Regel, die keinen wählt, nutzt den Standardanbieter, und ein gewählter Anbieter, der nicht mehr genutzt werden kann, fällt auf ihn zurück. Siehe [Welchen LLM-Anbieter eine Regel nutzt](/docs/ai/ai-sre#welchen-llm-anbieter-eine-regel-nutzt).

## OneUptime Cloud

In **OneUptime Cloud** kann jedes Projekt den globalen Anbieter ohne Einrichtung verwenden. Er ist für jede KI-Funktion bereit und wird aus dem KI-Guthaben des Projekts bezahlt.

Um stattdessen Ihre eigenen API-Schlüssel oder ein bestimmtes Modell zu verwenden, fügen Sie wie unten beschrieben einen eigenen Anbieter hinzu: Für KI, die auf Ihrem eigenen Anbieter läuft, wird Ihnen nichts berechnet.

Der globale LLM-Anbieter wird aus dem KI-Guthaben des Projekts bezahlt. Um zu begrenzen, was KI pro Tag ausgeben darf, setzen Sie ein **Tägliches KI-Ausgabenlimit (USD)** unter **Projekteinstellungen → KI → KI-Funktionen → Weitere Einstellungen**; ein **Tägliches KI-Token-Limit** dort begrenzt die Tokens bei jedem Anbieter, auch bei Ihrem eigenen. Siehe [die eigenen täglichen Limits des Projekts](/docs/ai/ai-sre#die-eigenen-täglichen-limits-des-projekts).

OneUptime Cloud kann nur LLM-Endpunkte im öffentlichen Internet erreichen. Es kann sich nicht mit einem Modell in Ihrem privaten Netzwerk verbinden, etwa einem selbst gehosteten Ollama- oder vLLM-Server. Um ein Modell zu verwenden, das Sie selbst betreiben, hosten Sie OneUptime selbst in einem Netzwerk, das es erreicht, oder stellen Sie das Modell unter einem öffentlichen Endpunkt bereit: siehe [Eine Basis-URL für ein selbst gehostetes Modell wählen](#eine-basis-url-für-ein-selbst-gehostetes-modell-wählen).

## Selbst gehostet: ohne Konfiguration über Umgebungsvariablen

Auf einer selbst gehosteten Instanz schalten Sie KI am schnellsten **für alle Projekte auf einmal** ein, indem Sie die Umgebungsvariablen `GLOBAL_LLM_PROVIDER_*` auf Ihrem OneUptime-Server setzen: in `config.env` bei Docker Compose oder über Helm-Werte. Beim Start registriert OneUptime daraus einen globalen LLM-Anbieter und hält ihn aktuell; kein Projekt muss etwas einrichten, und KI-Korrekturaufgaben verwenden ihn ebenfalls, wenn ein Projekt keinen eigenen Anbieter hat.

| Variable | Beschreibung |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Nötig, um ihn einzuschalten. Einer von `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | Der API-Schlüssel: nötig für OpenAI, Azure OpenAI, Anthropic, Groq und Mistral; nicht nötig für Ollama oder einen OpenAI-kompatiblen Server ohne Schlüssel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Der Endpunkt: nötig für Azure OpenAI, Ollama und OpenAI-kompatible Server |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Das zu verwendende Modell: nötig für OpenAI-kompatible Server, empfohlen für die anderen |
| `GLOBAL_LLM_PROVIDER_NAME` | Ein optionaler Anzeigename, der im Dashboard erscheint |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

Die Synchronisierung ist deklarativ: Ändern Sie eine Variable, und der Anbieter folgt beim nächsten Neustart; entfernen Sie `GLOBAL_LLM_PROVIDER_TYPE`, und der Anbieter wird entfernt. Von Hand im Admin Dashboard angelegte globale Anbieter werden nie angerührt. Ein Projekt kann trotzdem unter **Projekteinstellungen → KI → LLM-Anbieter** einen eigenen Anbieter hinzufügen, und ein Anbieter, der dem Projekt gehört, hat immer Vorrang.

## Unterstützte Anbieter

| Anbieter | Wofür er ist | API-Schlüssel nötig | Basis-URL nötig |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 und die anderen OpenAI-Modelle | Ja | Nein (verwendet den Standard) |
| **Azure OpenAI / Microsoft Foundry** | Modelle, die Sie in Microsoft Foundry oder Azure OpenAI bereitstellen: OpenAI-Modelle, Foundry Models und Claude | Ja | Ja |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 und die anderen Claude-Modelle | Ja | Nein (verwendet den Standard) |
| **Groq** | Schnelle Inferenz für Llama, Mixtral und andere offene Modelle | Ja | Nein (verwendet den Standard) |
| **Mistral** | Die gehosteten Modelle von Mistral | Ja | Nein (verwendet den Standard) |
| **Ollama** | Open-Source-Modelle, die Sie selbst betreiben, etwa Llama 3.1, Mistral oder Qwen | Nein | Ja |
| **OpenAI Compatible** | Jeder OpenAI-kompatible Server: vLLM, LocalAI, LM Studio und andere | Nein (optional) | Ja |

## Einen LLM-Anbieter einrichten

:::steps
### LLM-Anbieter öffnen

Gehen Sie zu **Projekteinstellungen → KI → LLM-Anbieter** (der Abschnitt **KI** des Seitenmenüs ist anfangs zugeklappt) und klicken Sie auf **LLM-Anbieter erstellen**.

### Den Anbieter auswählen

Wählen Sie unter **Anbieter** Ihren **LLM-Anbieter**: je eine Karte für OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama und jeden OpenAI-kompatiblen Server, jede mit einer Zeile dazu, was er ist.

### Ihn verbinden

Unter **Verbindung** fragt das Formular nur nach dem, was dieser Anbieter verwendet, mit eigener Hilfe unter jedem Feld:

- **API-Schlüssel**: Ihr API-Schlüssel, nötig für OpenAI, Azure OpenAI, Anthropic, Groq und Mistral und optional für einen OpenAI-kompatiblen Server; für Ollama wird keiner abgefragt
- **Basis-URL**: der Endpunkt, nötig für Azure OpenAI, Ollama und OpenAI Compatible; bei den anderen nur, um über einen Proxy oder ein Gateway zu gehen
- **Modellname**: das zu verwendende Modell, etwa `gpt-5.1`, `claude-sonnet-5-5` oder `llama3.1`. Leer gelassen verwendet OneUptime das Standardmodell des Anbieters, außer bei einem OpenAI-kompatiblen Server, der eines braucht
- **Name**: der Name des Anbieters, bis Sie einen eigenen eingeben, etwa "Production OpenAI" oder "Local Ollama"
- **Weitere Felder**, unter den Feldern oben zugeklappt: eine **Beschreibung**, **Als Standard festlegen**, das bei einem neuen Anbieter eingeschaltet ist, weil KI-Funktionen nur den Standardanbieter des Projekts verwenden, und **Zusätzliche Parameter**, ein optionales JSON-Objekt mit zusätzlichen Parametern, das bei jeder Anfrage an den Anbieter gesendet wird (zum Beispiel `{"temperature": 0.2}`)

**Wer einen Anbieter sehen kann.** Die LLM-Anbieter eines Projekts lesen nur dessen Mitglieder, die die Einstellungen des Projekts lesen dürfen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Betrachter**, **Einstellungs-Administrator**, **Einstellungs-Mitglied**, **Einstellungs-Betrachter** und **Read LLM**. Den **API-Schlüssel** eines Anbieters und seine Angaben unter **Zusätzliche Parameter** lesen nur die Owner und Admins des Projekts, weil die Parameter bei jeder Anfrage an den Anbieter gesendet werden und wie der Schlüssel ein Token oder einen Header enthalten können. Die anderen Mitglieder sehen, ob Parameter gespeichert sind, nicht aber welche. Mitglieder, die einen Anbieter bearbeiten dürfen, können seinen API-Schlüssel oder seine Parameter trotzdem ersetzen, ohne sie zu lesen: Im Bearbeitungsformular sind diese Felder anfangs leer, und ein leer gelassenes Feld behält den gespeicherten Wert. Um die Parameter zu entfernen, speichern Sie `{}`. Nur Owner und Admins des Projekts können die **Basis-URL** eines Anbieters ändern, weil sein API-Schlüssel und seine zusätzlichen Parameter an diese Adresse gesendet werden; die anderen Mitglieder, die einen Anbieter bearbeiten dürfen, können alles andere ändern. Jeder, der einen Anbieter lesen kann, kann seine **Basis-URL** lesen, setzen Sie also nie einen Schlüssel, ein Token oder ein Passwort hinein: Verwenden Sie den **API-Schlüssel**. Die Liste **Globale LLM-Anbieter** auf derselben Seite, die gemeinsamen Anbieter, auf die ein Projekt ausweicht, zeigt jedem angemeldeten Benutzer deren Namen, Beschreibung und Preis und sonst nichts darüber.

### Den Anbieter testen

**Einen Anbieter testen.** **Testen**, auf der Seite des Anbieters oder im Menü seiner Zeile, sendet dem Anbieter einen kurzen Prompt mit seinem **API-Schlüssel**, **Modellname**, **Basis-URL** und **Zusätzliche Parameter** und sagt, ob er geantwortet und ein Tool aufgerufen hat, was die KI-Funktionen von OneUptime brauchen. Ein fehlgeschlagener Test sagt zuerst, was zu prüfen ist, und dann, was der Anbieter geantwortet hat. Wer einen Anbieter ändern darf, kann ihn testen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Einstellungs-Administrator**, **Einstellungs-Mitglied** und **Edit LLM**. Alle anderen, die den Anbieter sehen können, finden **Testen** gesperrt. Einen globalen LLM-Anbieter testet ein Serveradministrator im Admin Dashboard unter **Einstellungen → Globale LLM-Anbieter**.
:::

## Anbieterspezifische Konfiguration

### OpenAI

1. Holen Sie Ihren API-Schlüssel auf der [OpenAI Platform](https://platform.openai.com/api-keys)
2. Wählen Sie **OpenAI** als LLM-Anbieter
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `gpt-5.1` - Empfohlener Standard, stark beim Tool-Calling und bei komplexen Untersuchungen
   - `gpt-5.1-mini` - Schneller und kostengünstiger

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Holen Sie Ihren API-Schlüssel in der [Anthropic Console](https://console.anthropic.com/)
2. Wählen Sie **Anthropic** als LLM-Anbieter
3. Geben Sie Ihren API-Schlüssel ein
4. Wählen Sie einen Modellnamen:
   - `claude-sonnet-5-5` - Empfohlener Standard, das beste Gleichgewicht aus Intelligenz, Geschwindigkeit und Kosten
   - `claude-opus-5-5` - Leistungsfähiger, für die schwierigsten Untersuchungen
   - `claude-haiku-5-5` - Am schnellsten und kostengünstigsten

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 und alle späteren Claude-Modelle wählen ihr Sampling selbst und lehnen eine Anfrage ab, die `temperature`, `top_p` oder `top_k` setzt. OneUptime lässt diese Einstellungen bei diesen Modellen weg. Lehnt ein Modell trotzdem eine davon ab, sendet OneUptime die Anfrage ohne sie erneut und merkt sich das für den Anbieter.

Claude-5-Modelle denken nach, bevor sie antworten, und das Nachdenken zählt zum Token-Limit der Antwort, daher lässt OneUptime Platz dafür. Damit sie weniger nachdenken und schneller und günstiger antworten, setzen Sie `{"output_config": {"effort": "low"}}` im Feld **Zusätzliche Parameter** des Anbieters. OneUptime sendet die Einstellungen, die Sie dort hinzufügen, mit jeder Anfrage an Anthropic, außer `model`, `messages`, `system`, `tools`, `tool_choice` und `stream`, die es selbst setzt.

OneUptime nutzt das Prompt-Caching von Anthropic. Jeder Aufruf einer Untersuchung oder einer Antwort von KI fragen sendet den Systemprompt, die Tools und die bisherige Unterhaltung erneut, und OneUptime markiert sie für den Cache: Ein Aufruf zahlt für das, was die Aufrufe vor ihm gesendet haben, ein Zehntel des Preises oder weniger, und für das Neue, das er in den Cache schreibt, ein Viertel mehr als den Preis. Lehnt ein Gateway vor Claude die Cache-Markierungen ab, sendet OneUptime die Anfrage ohne sie erneut und merkt sich das für den Anbieter. [Wie Token gezählt werden](/docs/ai/ai-sre#wie-token-gezählt-werden) erklärt, wie Token aus dem Cache auf Ihre Limits angerechnet werden.

### Azure OpenAI und Microsoft Foundry

Verwenden Sie **Azure OpenAI / Microsoft Foundry** für die Modelle, die Sie in Microsoft Foundry oder Azure OpenAI bereitstellen: OpenAI-Modelle, andere Foundry Models und Claude. Geben Sie einen der Schlüssel der Ressource als **API-Schlüssel** ein, den Namen der Bereitstellung als **Modellname** und den Endpunkt der Ressource als **Basis-URL**, etwa `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry und Azure OpenAI](/docs/ai/microsoft-foundry) führt durch die Azure-Seite: die Ressource, Berechtigungen, die Modellbereitstellung, Netzwerkanforderungen und Fehlerbehebung.

### Ollama (selbst gehostet)

Ollama betreibt Open-Source-Modelle auf Ihren eigenen Rechnern.

1. Installieren Sie Ollama von [ollama.ai](https://ollama.ai)
2. Laden Sie ein Modell: `ollama pull llama3.1`
3. Stellen Sie sicher, dass Ollama läuft und der OneUptime-Server es erreicht. Eine native Installation lauscht nur auf `127.0.0.1`, starten Sie sie also mit `OLLAMA_HOST=0.0.0.0:11434`, damit sie Verbindungen von anderen Rechnern und Containern annimmt (das offizielle Docker-Image `ollama/ollama` tut das bereits)
4. Wählen Sie **Ollama** als LLM-Anbieter
5. Geben Sie die Basis-URL ein: die Adresse des Ollama-Servers, wie der OneUptime-Server sie erreicht, etwa `http://ollama:11434` (OneUptime hängt `/api/chat` selbst an). `localhost` funktioniert nicht: siehe [Eine Basis-URL für ein selbst gehostetes Modell wählen](#eine-basis-url-für-ein-selbst-gehostetes-modell-wählen)
6. Geben Sie den Modellnamen ein, den Sie geladen haben

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Das Kontextfenster vergrößern.** Wenn nichts anderes angegeben ist, bemisst Ollama das Kontextfenster eines Modells nach dem GPU-Speicher, den es vorfindet: 4k Tokens unter 24 GiB, 32k bis 48 GiB und 256k darüber (ältere Versionen verwenden 2.048 oder 4.096 Tokens). Die KI-Funktionen von OneUptime sind Agenten. Jede Anfrage trägt ihren System-Prompt und ihre Tool-Definitionen, mehr als 10.000 Tokens vor jeder Frage, und eine KI-Untersuchung fügt jedes Abfrageergebnis der Unterhaltung hinzu, während sie voranschreitet. Passt eine Anfrage nicht mehr hinein, verwirft Ollama die ältesten Nachrichten, und die Frage geht mit ihnen verloren. Je nach Modell und Ollama-Version antwortet das Modell dann ohne die Frage oder ohne seine Tools, oder die Anfrage schlägt mit "no user query found in messages" (Qwen 3.8 und später) oder "the prompt is longer than the context length currently available to the model" fehl. OneUptime meldet diese Fehler als "…the request is larger than the model's context window" und führt die Untersuchung nicht erneut aus. Setzen Sie ein größeres `num_ctx` im Feld **Zusätzliche Parameter** des Anbieters:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime führt dieses `options`-Objekt mit den Optionen zusammen, die es an Ollama sendet, führen Sie also nur die Einstellungen auf, die Sie ändern möchten. 65.536 Tokens empfiehlt Ollama für Agenten, und das deckt die meisten Untersuchungen ab. Eine lange Untersuchung kann mehr brauchen, weil OneUptime alte Abfrageergebnisse erst kürzt, wenn die Unterhaltung etwa 75.000 Tokens überschreitet: Verwenden Sie 131.072, wenn das Modell es unterstützt und Ihre GPU es halten kann. Ein größeres Kontextfenster braucht mehr Speicher, und `ollama ps` zeigt das Kontextfenster, das jedes geladene Modell bekommen hat. Um stattdessen den Standard für jeden Client anzuheben, setzen Sie `OLLAMA_CONTEXT_LENGTH` auf dem Ollama-Server. Das ist der einzige Weg, wenn OneUptime Ollama über seine OpenAI-kompatible `/v1`-API erreicht (der Anbieter **OpenAI Compatible**), die `num_ctx` ignoriert. Für einen globalen Anbieter, der aus den Variablen `GLOBAL_LLM_PROVIDER_*` registriert wurde, setzen Sie **Zusätzliche Parameter** im Admin Dashboard unter **Einstellungen → Globale LLM-Anbieter**; die Synchronisierung beim Start lässt dieses Feld in Ruhe.

**Beliebte Ollama-Modelle:**

- `llama3.1` - Llama 3.1 von Meta, das älteste Llama mit Tool-Calling-Unterstützung
- `llama3.3` - Llama 3.3 von Meta
- `qwen2.5` - Qwen 2.5 von Alibaba
- `mistral-nemo` - Das Nemo-Modell von Mistral AI

> [!NOTE]
> Die KI-Funktionen von OneUptime sind Agenten: Sie stützen sich stark auf Tool-Calling. Verwenden Sie `llama3.1` oder neuer oder ein anderes Modell, das Tools aufruft. Ein kleines Modell oder eines ohne Tool-Calling (etwa `llama2` oder das ursprüngliche `llama3`) antwortet schlecht: Es kann Ihre Monitore, Vorfälle oder Telemetrie nicht abfragen, sodass Untersuchungen leer oder erfunden zurückkommen.

### Eine Basis-URL für ein selbst gehostetes Modell wählen

Die Basis-URL eines selbst gehosteten Modells, ob Ollama, vLLM, LM Studio oder ein anderer OpenAI-kompatibler Server, muss eine Adresse sein, die der **OneUptime-Server** erreicht. Ihr Browser verbindet sich nie damit.

**Loopback-Adressen werden immer abgelehnt.** Vor dem Verbinden prüft OneUptime jede Adresse, in die der Hostname der Basis-URL aufgelöst wird. `localhost`, `127.0.0.1`, `[::1]` und `0.0.0.0` sowie Link-Local- und Cloud-Metadaten-Adressen wie `169.254.169.254` werden in jeder Bereitstellung abgelehnt, selbst gehostete eingeschlossen. Das ist Absicht: Die Basis-URL eines Anbieters darf nicht nutzbar sein, um Dienste auf dem OneUptime-Server selbst zu erreichen. Innerhalb von Docker Compose oder Kubernetes wäre `localhost` ohnehin der OneUptime-Container, nicht der Rechner, auf dem Ihr Modell läuft.

Verwenden Sie stattdessen eine private Adresse oder einen internen Hostnamen:

| Wo der Modellserver läuft | Basis-URL |
| --- | --- |
| Ein Dienst im Docker-Compose-Netzwerk von OneUptime (`oneuptime`) | Der Dienstname, z. B. `http://ollama:11434` |
| Derselbe Kubernetes-Cluster wie OneUptime | Der DNS-Name des Service, z. B. `http://ollama.<namespace>.svc.cluster.local:11434`, dasselbe Muster wie beim [mitgelieferten vLLM](#selbst-gehostetes-vllm-auf-kubernetes-helm) |
| Der Host-Rechner selbst, außerhalb jedes Containers | Die LAN-IP des Hosts, z. B. `http://192.168.1.20:11434`, oder `http://host.docker.internal:11434` unter Docker Desktop |
| Ein anderer Rechner in Ihrem Netzwerk | Seine private IP oder sein interner Hostname, z. B. `http://10.0.0.12:11434` |

OpenAI-kompatible Server folgen denselben Regeln mit ihrem eigenen Port und `/v1`-Pfad, z. B. `http://vllm:8000/v1` oder `http://192.168.1.20:1234/v1` für LM Studio. Wie eine native Ollama-Installation lauscht LM Studio nur auf `127.0.0.1`, bis Sie in seinen Servereinstellungen **Serve on Local Network** einschalten.

**Private Adressen funktionieren bei selbst gehosteten Installationen.** Ein selbst gehostetes OneUptime kann private Netzwerkadressen erreichen, etwa `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` und IPv6 `fc00::/7`, sofern Sie nicht `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` setzen, was sie so ablehnt, wie OneUptime Cloud es tut. Diese Einstellung gilt nicht für einen globalen LLM-Anbieter, den ein Administrator (mit den Variablen `GLOBAL_LLM_PROVIDER_*` oder im Admin Dashboard) statt eines Projekts konfiguriert: Er kann weiterhin private Adressen erreichen. Loopback- und Link-Local-Adressen bleiben für jeden Anbieter abgelehnt.

**OneUptime Cloud (SaaS) kann keine privaten Netzwerke erreichen.** Es lehnt private Netzwerkadressen und Hostnamen, die in solche aufgelöst werden, für jeden LLM-Anbieter ab. Um ein Modell zu verwenden, das auf Ihrer eigenen Infrastruktur läuft, hosten Sie OneUptime entweder selbst in einem Netzwerk, das es erreicht, oder stellen Sie das Modell unter einem öffentlich erreichbaren Endpunkt bereit. Schützen Sie einen öffentlichen Endpunkt mit einem API-Schlüssel: Der Anbieter **Ollama** sendet keine Zugangsdaten, während **OpenAI Compatible** den API-Schlüssel als Bearer-Token sendet (Ollama stellt unter `/v1` auch eine OpenAI-kompatible API bereit, sodass es hinter einem Reverse Proxy stehen kann, der den Schlüssel prüft).

### OpenAI Compatible (vLLM, LocalAI, LM Studio usw.)

Verwenden Sie den Anbieter **OpenAI Compatible** für jeden Server, der die OpenAI-API `/chat/completions` implementiert, aber nicht OpenAI selbst ist, zum Beispiel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) oder text-generation-webui. Diese laufen meist unter Ihrer eigenen Adresse, oft ohne Authentifizierung.

1. Starten Sie Ihren OpenAI-kompatiblen Server und notieren Sie seine Basis-URL (sie endet meist auf `/v1`)
2. Wählen Sie **OpenAI Compatible** als LLM-Anbieter
3. Geben Sie die **Basis-URL** ein (Pflicht), z. B. `http://your-server:8000/v1`. Der OneUptime-Server muss sie erreichen, also nicht `localhost`: siehe [Eine Basis-URL für ein selbst gehostetes Modell wählen](#eine-basis-url-für-ein-selbst-gehostetes-modell-wählen)
4. Füllen Sie **Modellname** aus (Pflicht): Er muss einem Modell entsprechen, das Ihr Server bereitstellt
5. Geben Sie den **API-Schlüssel** nur ein, wenn Ihr Server einen verlangt; lassen Sie ihn bei einem Server ohne Schlüssel leer

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Verwenden Sie nach dem Speichern **Testen** beim Anbieter, um die Verbindung, den Modellnamen und die Basis-URL zu prüfen.

### Selbst gehostetes vLLM auf Kubernetes (Helm)

Wenn Sie OneUptime mit dem Helm-Chart selbst hosten, können Sie [vLLM](https://docs.vllm.ai), einen OpenAI-kompatiblen Inferenzserver, in Ihrem Cluster betreiben und lokale Modelle auf Ihren eigenen GPUs bereitstellen. Keine Daten verlassen Ihre Infrastruktur.

1. Schalten Sie es in Ihren Helm-Werten ein (es braucht NVIDIA-GPU-Knoten):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Führen Sie `helm upgrade` aus und warten Sie, bis der vLLM-Pod bereit ist (beim ersten Start wird das Modell heruntergeladen)
3. Das war's: vLLM wird beim Start automatisch als globaler LLM-Anbieter registriert (`vllm.globalProvider.enabled`, Standard `true`), sodass KI-Funktionen für alle Projekte funktionieren, auch KI-Korrekturaufgaben. (Überall, in der Cloud und selbst gehostet, verwenden Agent-Korrekturaufgaben den globalen Anbieter, wenn das Projekt keinen eigenen Anbieter besitzt; in der Cloud wird diese Nutzung als gemessene KI-Tokens abgerechnet. Ein Anbieter, der dem Projekt gehört, hat immer Vorrang.)

Wenn Sie die automatische Registrierung ausgeschaltet haben (`vllm.globalProvider.enabled: false`), legen Sie den Anbieter von Hand an:

1. Wählen Sie **OpenAI Compatible** als LLM-Anbieter (vLLM spricht die OpenAI-API)
2. Geben Sie die clusterinterne Basis-URL ein: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (ersetzen Sie `cluster.local`, wenn Sie `global.clusterDomain` geändert haben)
3. Geben Sie den Modellnamen ein: die vollständige Hugging-Face-Modell-ID (oder `vllm.servedModelName`, wenn Sie einen gesetzt haben)
4. Geben Sie den API-Schlüssel nur ein, wenn Sie `vllm.apiKey` gesetzt haben; lassen Sie ihn bei einem vLLM ohne Schlüssel leer

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Mit eingeschalteter Abrechnung oder mit `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in den Helm-Werten) kann der eigene Anbieter eines Projekts diese clusterinterne Adresse nicht erreichen, die in eine private Cluster-IP aufgelöst wird. Legen Sie den Anbieter stattdessen im Admin Dashboard unter **Einstellungen → Globale LLM-Anbieter** an, mit denselben Feldern: Ein globaler LLM-Anbieter kann diese Adresse erreichen.

Siehe die [vLLM-Anleitung des Helm-Charts](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) zu GPU-Scheduling, zugangsbeschränkten Modellen und Tuning-Optionen.

## Bewährte Praxis

- **Benennen Sie Anbieter eindeutig**, etwa "Production OpenAI" oder "Development Ollama", damit Teammitglieder wissen, welcher welcher ist.
- **Bewahren Sie Schlüssel im Feld API-Schlüssel auf.** API-Schlüssel werden im Ruhezustand verschlüsselt, und nur Owner und Admins des Projekts lesen sie.
- **Testen Sie nach jeder Änderung**, mit **Testen** beim Anbieter.
- **Behalten Sie die KI-Kosten im Blick.** Jeder Aufruf wird mit seinen Tokens und Kosten unter **Projekteinstellungen → KI → KI-Protokolle** aufgeführt.

## Fehlerbehebung

:::details Der Anbieter ist nicht erreichbar
- **OpenAI oder Anthropic**: Prüfen Sie, ob Ihr API-Schlüssel gültig ist und Guthaben hat
- **Azure OpenAI / Microsoft Foundry**: Der Fehler beginnt damit, was zu ändern ist. [Microsoft Foundry und Azure OpenAI](/docs/ai/microsoft-foundry) erklärt jeden Fehler, mit dem Azure antwortet
- **Ollama**: Prüfen Sie, ob der Ollama-Server läuft, auf einer Adresse lauscht, die der OneUptime-Server erreicht (`OLLAMA_HOST=0.0.0.0:11434` bei einer nativen Installation), und ob die Basis-URL auf diese Adresse zeigt
- **OpenAI Compatible**: Prüfen Sie, ob die Basis-URL auf `/v1` endet (oder zu Ihrem Server passt), ob der Modellname einem Modell entspricht, das Ihr Server bereitstellt, und ob Sie einen API-Schlüssel nur gesetzt haben, wenn Ihr Server einen verlangt
- **"…points to an address OneUptime is not allowed to connect to"**: Die Basis-URL wird in eine abgelehnte Adresse aufgelöst: `localhost` oder eine andere Loopback-Adresse oder, in OneUptime Cloud, eine private Netzwerkadresse. (OneUptime Cloud meldet einen abgelehnten Hostnamen stattdessen als "…could not be reached".) Siehe [Eine Basis-URL für ein selbst gehostetes Modell wählen](#eine-basis-url-für-ein-selbst-gehostetes-modell-wählen)
- **Eine Firewall**: Prüfen Sie, ob Ihr Netzwerk ausgehende Verbindungen zur API des Anbieters erlaubt
:::

:::details Das Modell wird nicht gefunden
Prüfen Sie die Schreibweise des Modellnamens. Laden Sie bei Ollama das Modell zuerst mit `ollama pull <model-name>`. Manche Modelle sind nur in manchen Regionen verfügbar.
:::

:::details Das Kontextfenster ist zu klein
- **"…the request is larger than the model's context window"**: Die Anfrage passte nicht in das Kontextfenster des Modells, meist weil eine KI-Untersuchung viele Belege gesammelt hat. Erhöhen Sie `num_ctx` im Feld **Zusätzliche Parameter** des Anbieters oder `OLLAMA_CONTEXT_LENGTH` auf dem Ollama-Server; siehe [Ollama (selbst gehostet)](#ollama-selbst-gehostet)
- **"no user query found in messages"**: Dasselbe Problem, wie Qwen es meldet. OneUptime sendet die Frage immer; Ollama hat sie verworfen, damit der Rest der Anfrage hineinpasst
:::

Kommen Sie nicht weiter? Suchen Sie Ihren Fehler in den [GitHub-Issues von OneUptime](https://github.com/OneUptime/oneuptime/issues), oder wenden Sie sich an den Support, wenn Ihr Tarif ihn umfasst.

## Nächste Schritte

:::cards
- [Code](/docs/ai/ai-agent): Pull Requests, die Ihr Anbieter schreibt, und wo sie starten.
- [AI SRE](/docs/ai/ai-sre): Was OneUptime AI mit dem Anbieter tut, sobald es einen hat.
- [KI fragen](/docs/ai/ask-ai): Stellen Sie Ihrem Projekt eine Frage, und wechseln Sie den Anbieter einer Unterhaltung.
:::
