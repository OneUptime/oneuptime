# KI- / LLM-Observability mit OneUptime

Lesen Sie jede Unterhaltung, die Ihre KI geführt hat, spielen Sie sie so ab, wie sie geschehen ist, und erfahren Sie, wenn sie schlecht antwortet. Alles läuft auf Standard-OpenTelemetry, ohne proprietäres SDK: Wenn Ihre App Spans mit den OpenTelemetry-**GenAI-Semantikkonventionen** (`gen_ai.*`) sendet, macht OneUptime daraus Unterhaltungen, Warnungen, Nutzung und Kosten.

## Was Sie bekommen

Öffnen Sie **KI / LLM** in der Navigationsleiste unter Observability:

- **Unterhaltungen** — jede Unterhaltung, die Ihre KI geführt hat: was Menschen gefragt haben, was die KI geantwortet hat, welche Tools sie genutzt hat und was schiefgelaufen ist. Über der Liste stehen fünf Zahlen: Unterhaltungen, KI-Antworten, wie viele Aufmerksamkeit brauchen, Kosten und wie lange eine Antwort typischerweise dauert. Öffnen Sie eine Unterhaltung, um sie zu lesen oder erneut abzuspielen.
- **Aufrufe** — jeder LLM-, Embedding-, Agenten- und Tool-Aufruf, filterbar nach Dienst, Anbieter, Modell, Operation, Person und Team. Klicken Sie auf einen Aufruf, um ihn im Trace-Viewer zu öffnen.
- **Nutzung** — die Aufrufe, Tokens und Kosten eines Zeitraums und wer was ausgibt: Mitarbeiter, Teams, Modelle, Anbieter und Apps, nach Ausgaben sortiert.
- **Warnungen** — fertige Warnungen für den Fall, dass die KI schlecht antwortet, und Ihre KI- / LLM-Monitore.
- **Budgets** — tägliche Kostenlimits, als Metriken veröffentlicht, auf die Sie Warnungen setzen können.
- **Preise** — Ihre eigenen Preise pro Modell, für Modelle, die der integrierte Katalog nicht kennt.
- **Einrichtung** — die fünf Schritte unten, mit dem Endpunkt Ihres Projekts.

Im Trace-Viewer hat der Span jedes KI-Aufrufs außerdem ein **KI / LLM**-Panel mit Modell, Token-Zahlen, Kosten, Anfrageparametern sowie Prompt und Completion.

## Schritt 1 — Ihre KI-Aufrufe senden

Erstellen Sie einen Telemetrie-Ingestion-Schlüssel: Öffnen Sie **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel** und klicken Sie auf **Aufnahmeschlüssel erstellen**. Ihre App übergibt den Schlüssel als OTLP-Header. (Screenshots finden Sie in der [OpenTelemetry-Anleitung](/docs/telemetry/open-telemetry).)

Instrumentieren Sie Ihre App dann mit einer beliebigen OpenTelemetry-GenAI-Bibliothek:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI und mehr.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy und mehr.
- Das **Vercel AI SDK** oder die **OpenTelemetry-Instrumentierungen** für OpenAI, Anthropic und Gemini.

Leiten Sie Ihren LLM-Verkehr über ein Gateway wie **LiteLLM** oder **Portkey**? Exportieren Sie Traces aus dem Gateway, statt jede App zu instrumentieren — siehe [KI-Gateways beobachten](/docs/telemetry/ai-gateways). Sie suchen die Coding-Assistenten, die Ihre Entwickler nutzen — Claude Code, Cursor, Codex, Gemini CLI, Copilot? Sie exportieren ihr eigenes OpenTelemetry und brauchen nichts von Ihnen: siehe [Observability für KI-Coding-Assistenten](/docs/telemetry/ai-coding-assistants).

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### Reine OpenTelemetry-Umgebungsvariablen

Wenn Sie mit einem nativen OpenTelemetry-SDK instrumentieren, richten Sie den OTLP-Exporter auf OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Sie hosten OneUptime selbst? Ersetzen Sie `https://oneuptime.com/otlp` durch `https://YOUR-ONEUPTIME-HOST/otlp`.

## Schritt 2 — Aufzeichnen, was gesagt wurde

Eine Unterhaltung zeigt, was Menschen gefragt und was die KI geantwortet hat, wenn Ihre Instrumentierung es aufzeichnet. OpenLLMetry zeichnet Prompts und Completions auf, solange Sie es nicht abschalten (`TRACELOOP_TRACE_CONTENT=false`). Die OpenTelemetry-Instrumentierungen zeichnen sie nur auf, wenn Sie es verlangen:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Ohne sie zeigt eine Unterhaltung trotzdem ihr Timing, ihre Kosten und ihre Probleme und sagt, dass ihr Inhalt nicht aufgezeichnet wurde. Prompts können sensible Daten enthalten: Unter [Datenschutz und Schwärzung](#datenschutz-und-schwärzung) erfahren Sie, wie Sie sie maskieren, bevor sie gespeichert werden.

## Schritt 3 — Aufrufe zu Unterhaltungen gruppieren

Eine Chat-App macht pro Runde einen Modellaufruf. Setzen Sie `gen_ai.conversation.id` — oder `session.id` — bei jedem KI-Aufruf auf die ID Ihres Chats, und jeder Chat erscheint als eine Unterhaltung, egal wie viele Aufrufe und Traces er gebraucht hat. Mit OpenLLMetry setzen Sie sie einmal pro Anfrage als Association Property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Aufrufe ohne Unterhaltungs-ID erscheinen trotzdem, jeweils eine Anfrage (ein Trace) auf einmal.

## Schritt 4 — Sagen, wer gefragt hat

Setzen Sie `user.id` oder `user.email` — die Association Property oben setzt die E-Mail —, um zu sehen, mit wem jede Unterhaltung geführt wurde, die Liste nach Person zu durchsuchen und die Ausgaben im Tab Nutzung nach Mitarbeiter zu sortieren. [Zuordnung zu Mitarbeitern und Teams](#zuordnung-zu-mitarbeitern-und-teams) listet jeden Schlüssel auf, den OneUptime liest.

## Schritt 5 — Schlechte Antworten markieren

OneUptime prüft jede Antwort beim Eintreffen und markiert, was mit ihr schiefgelaufen ist:

| Problem         | Was es bedeutet                                                         | Erkannt an                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fehlgeschlagen  | Der Aufruf endete mit einem Fehler, daher kam keine Antwort an          | Span-Status Error, `error.type` oder ein Finish Reason `error`                                                                                                                                |
| Verweigert      | Die KI hat abgelehnt, oder ein Sicherheitsfilter hat blockiert          | Ein Ablehnungs- oder Sicherheits-Finish-Reason (`content_filter`, `refusal`, `SAFETY` und ähnliche), eine Ablehnung in der Antwort oder eine Antwort, die mit einer englischen Standardablehnung beginnt |
| Abgeschnitten   | Die Antwort endete am Token-Limit                                       | Ein Finish Reason `length`, `max_tokens` oder `MAX_TOKENS`                                                                                                                                    |
| Leer            | Die KI antwortete ohne Text und ohne Tool-Aufruf                        | Aufgezeichneter Inhalt, der nichts enthält, oder 0 Ausgabe-Tokens                                                                                                                             |
| Markiert        | Eine Bewertung, die Ihre App gesendet hat, nannte die Antwort schlecht  | Ein `gen_ai.evaluation.result`-Event                                                                                                                                                          |

Die ersten vier brauchen nichts von Ihnen. Um den Rest zu markieren — eine Antwort, die Ihr Guardrail, Ihr Eval oder Ihr eigener LLM-Judge ablehnt —, fügen Sie dem Span der Antwort ein `gen_ai.evaluation.result`-Event hinzu, mit `gen_ai.evaluation.score.label` auf `fail` gesetzt:

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

Labels wie `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` und `hallucination` gelten ebenfalls als nicht bestanden. Das Event muss auf dem Span der Antwort liegen, die es bewertet, solange dieser Span offen ist.

OneUptime schickt Ihre Unterhaltungen nie an eine andere KI, um sie bewerten zu lassen: Jede Prüfung liest nur, was der Aufruf selbst mitbringt.

## Eine Unterhaltung lesen und erneut abspielen

Eine Unterhaltung öffnet sich vollständig, so wie eine Chat-App ihren Verlauf zeigt: was die Person gesagt hat, rechts; die Antworten der KI links, mit Modell, Zeit, Tokens und Kosten; Tool-Aufrufe dazwischen; und was schiefging, markiert an der Stelle, an der es passiert ist. **Details** unter einer Antwort zeigt ihren Finish Reason und ihre Bewertungen, mit einem Link zum Aufruf in Traces.

Die Leiste unten spielt die Unterhaltung so ab, wie die Person sie erlebt hat:

- **Erneut abspielen** spielt sie ab der ersten Nachricht im ursprünglichen Tempo ab, wobei „KI antwortet …“ hochzählt, solange eine Antwort unterwegs ist. Klicken Sie auf die Zeit einer beliebigen Nachricht, um ab dort abzuspielen.
- **Wartezeiten überspringen**, standardmäßig an, kürzt Pausen, die länger als 3 Sekunden sind. Die Geschwindigkeitstaste spielt mit 1×, 2×, 4× oder 8× ab.
- **K** spielt ab oder pausiert, **J** oder **←** geht eine Nachricht zurück, und **L** oder **→** geht eine vor.
- Die Adresse merkt sich die Nachricht, bei der eine Wiedergabe angehalten hat (`?step=`), sodass ein Link genau diesen Moment öffnet.

## Erfahren, wenn die KI schlecht antwortet

Der Tab **Warnungen** bietet die Warnungen an, die die meisten KI-Apps brauchen. Wenn Sie eine auswählen, öffnet sich Monitor erstellen bereits ausgefüllt, und Sie können vor dem Speichern alles ändern:

| Warnung                        | Wann sie Sie benachrichtigt                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Antworten gehen schief         | Mehr als 5 % der Antworten in 15 Minuten schlagen fehl, werden verweigert, abgeschnitten, sind leer oder markiert |
| KI-Aufrufe schlagen fehl       | Mehr als 10 % der Aufrufe an das Modell in 5 Minuten enden mit einem Fehler                         |
| Die KI verweigert Antworten    | Mehr als 5 % der Antworten in 30 Minuten sind Ablehnungen                                           |
| Antworten werden abgeschnitten | 3 oder mehr Antworten in 30 Minuten enden am Token-Limit                                            |
| Antworten werden markiert      | Eine Bewertung markiert eine Antwort als schlecht                                                   |
| Antworten sind langsam         | Mehr als 10 % der Antworten in 15 Minuten dauern länger als 30 Sekunden                             |
| Die KI antwortet nicht mehr    | Die KI gibt 30 Minuten lang keine Antworten                                                         |

Die Warnungen auf einen Anteil warten außerdem auf mindestens 3 schlechte Antworten, sodass eine schlechte Antwort von zweien niemanden weckt.

Jede Warnung ist ein **KI / LLM**-Monitor. Seine Einstellungen legen fest, was als schlechte Antwort gilt — die Probleme oben, eine Antwort, die langsamer ist als ein von Ihnen gesetztes Limit, oder beides —, welche Apps und welches Modell er beobachtet und wie weit jede Prüfung zurückblickt. Darunter zeigt eine Vorschau, was der Monitor gerade jetzt zählen würde. Seine Kriterien vergleichen drei Zahlen: den **Anteil schlechter Antworten** (in %), die **Zahl schlechter Antworten** und die **Zahl der Antworten**. Eine fertige Warnung löst eine Warnung aus, die sich selbst auflöst, und zeigt den Monitor als Beeinträchtigt, solange die Antworten schlecht sind; schalten Sie stattdessen ihren Vorfall ein, um jemanden zu alarmieren.

Ausgaben überwachen die [täglichen Kostenbudgets](#tägliche-kostenbudgets).

## Attribute, die OneUptime erkennt

OneUptime liest zuerst die OpenTelemetry-GenAI-Konventionen und greift auf die OpenLLMetry- und OpenInference-Varianten zurück, damit beliebte Bibliotheken sofort funktionieren.

| Was                                | Primäres Attribut            | Ebenfalls akzeptiert                                                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anbieter / System                  | `gen_ai.provider.name`       | `gen_ai.system` (in den Konventionen veraltet, aber weiterhin verbreitet), `llm.system`, `llm.provider`                                                                                                                                                                  |
| Operation                          | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Angefragtes Modell                 | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Antwortmodell                      | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Eingabe-Tokens                     | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Ausgabe-Tokens                     | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Tokens gesamt                      | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; aus Eingabe + Ausgabe abgeleitet, wenn keines gemeldet wird                                                                                                                                                           |
| Kosten (USD)                       | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Agentenname                        | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Tool-Name                          | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Unterhaltungs- / Sitzungs-ID       | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Mitarbeiter (der den Aufruf machte) | `user.id`                   | `enduser.id`, `litellm.metadata.user_api_key_user_id` und `metadata.user_api_key_user_id` (Schreibweisen von LiteLLM OTel v2 und v1 — beide werden gelesen), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| E-Mail des Mitarbeiters            | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / Kostenstelle                | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` und `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                 |

Die Unterschlüssel von `traceloop.association.properties.*` werden **vom Aufrufer geliefert**: Traceloop definiert das Präfix, und Ihr Code liefert, was darunter steht. `gen_ai.usage.total_tokens` und `gen_ai.usage.cost` sind **De-facto**-Schlüssel, keine GenAI-Semantikkonventionen — die Konventionen definieren weder ein Attribut für die Gesamt-Tokens noch eines für Kosten —, und OneUptime liest sie, weil die gängigen Instrumentierungen sie senden. `gen_ai.system` ist der eigene, veraltete Vorgänger von `gen_ai.provider.name` in den Konventionen; beide werden gelesen.

**Die drei Identitätszeilen werden auch mit einem `resource.`-Präfix abgeglichen.** Die OTLP-Aufnahme legt jedes _Ressourcen_-Attribut unter einem `resource.`-Präfix flach in die Attributmap des Spans, sodass `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` als `resource.team.id` ankommt. OneUptime sucht zuerst die ganze Liste ohne Präfix ab, dann die ganze `resource.`-Liste, sodass ein Span-Attribut (das einen Aufruf beschreibt) ein Ressourcen-Attribut (das den ganzen Prozess beschreibt) schlägt. Die übrigen Zeilen werden nur über den Schlüssel ohne Präfix abgeglichen: Es sind Werte pro Aufruf.

**Prompt- und Completion-Inhalte** werden gelesen aus dem Event `gen_ai.client.inference.operation.details`; aus den Span-Attributen `gen_ai.input.messages`, `gen_ai.output.messages` und `gen_ai.system_instructions`; aus den **veralteten** Events pro Rolle, die ältere Instrumentierungen noch senden (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); aus den indizierten Attributen (`gen_ai.prompt.N.content` und `gen_ai.completion.N.content`, bei OpenInference `llm.input_messages.N.message.content` und `llm.output_messages.N.message.content`); und aus den JSON-Nachrichten-Arrays (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Wie Kosten berechnet werden

Wenn Ihre Instrumentierung Kosten meldet (`gen_ai.usage.cost`), verwendet OneUptime sie unverändert: Der gemeldete Wert gewinnt immer. Werden keine Kosten gemeldet, berechnet OneUptime **bei der Aufnahme geschätzte Kosten** aus den Token-Zahlen des Spans und einem integrierten Listenpreiskatalog gängiger Modelle von OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova und Meta Llama. Modelle werden über das Namenspräfix zugeordnet, sodass datierte Snapshots wie `gpt-4o-2024-08-06` und vom Anbieter ergänzte IDs wie `us.anthropic.claude-3-5-sonnet-20241022-v2:0` korrekt aufgelöst werden. Unbekannte oder eigene Modelle werden nie geraten — ihre Kosten bleiben `0`, bis Sie ihnen im Tab **Preise** einen Preis geben. Schätzungen verwenden Listenpreise und berücksichtigen keine Cache- oder Batch-Rabatte.

Sie hosten OneUptime selbst? Der Katalog liegt in `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Zuordnung zu Mitarbeitern und Teams

„Welcher unserer Entwickler hat letzten Monat 4.000 $ für Opus ausgegeben?“ ist eine Frage nach einer Person, und kein LLM-Span beantwortet sie, sofern nicht etwas auf dem Span eine Person nennt. OneUptime kopiert den menschlichen Akteur bei der Aufnahme in abfragbare Spalten, sodass Sie nach einer Spalte gruppieren und filtern, statt Attribut-Lookups zu schreiben.

Die drei Identitätszeilen in der Tabelle oben sind der ganze Mechanismus; der erste vorhandene Schlüssel gewinnt, in der aufgeführten Reihenfolge. `user.id` steht vorn, weil es der kanonische OpenTelemetry-Schlüssel für einen menschlichen Akteur ist und derjenige, auf den Sie sich festlegen sollten, wenn Sie die Identität selbst setzen. **Eine Ausnahme: Claude Code** sendet `user.id` als zufällige anonyme Kennung, die in `~/.claude.json` gespeichert ist, nicht als Person. Auf seinen Metrik-Datenpunkten, deren Liste mit der E-Mail beginnt, ist das harmlos; wenn Sie aber die Traces-Beta von Claude Code aktivieren, rangiert die anonyme `user.id` auf den Spans vor `user.email`: Entfernen oder ummappen Sie `user.id` für diese Flotte in einem Collector-Prozessor. `enduser.id` ist weiterhin ein aktives Attribut der Semantikkonventionen und wird als gleichwertiger Alias akzeptiert. `cursor.user.id` steht zuletzt, weil es eine undurchsichtige, teamgebundene Ganzzahl ist, die die Admin-API von Cursor braucht, um zu einer Person aufgelöst zu werden.

Die Identität wird nur auf Spans gelesen, die bereits als LLM-Aufrufe erkannt sind: `user.id`, `user.email` und `team.id` sind generische Schlüssel, die auch Browser- und gewöhnliche Backend-Spans tragen. **Metrik-Datenpunkte** tragen eine kürzere Liste, die mit der E-Mail beginnt — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, mit Teams aus `team.id`, `team`, `cost_center`, `department` und `cursor.team.id`, jeweils auch mit dem `resource.`-Präfix abgeglichen —, weil die Coding-Agent-CLIs, die Metriken ohne Spans senden, `user.email` nativ senden. Aus **Log-Einträgen** liest heute nichts eine Identität.

### Team und Kostenstelle setzen

Keine Instrumentierung sendet `team.id`, `team`, `cost_center` oder `department`: Ihre Organisation setzt sie, üblicherweise über `OTEL_RESOURCE_ATTRIBUTES` am Prozess:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Sie kommen bei OneUptime als `resource.team.id`, `resource.team`, `resource.cost_center` und `resource.department` an, und beide Ebenen werden auf Spans und auf Metrik-Datenpunkten erkannt, egal ob Ihr Exporter die Schlüssel im OTLP-Ressourcenblock lässt oder auf jeden Span kopiert (Claude Code tut Letzteres). Ein direkt auf einem Span gesetztes `team.id` ohne Präfix gewinnt weiterhin.

Die Schreibweisen der Gateways kommen ohne jede Konfiguration Ihrerseits an. LiteLLM benennt seine Attribute in seinen beiden OpenTelemetry-Modi unterschiedlich — der standardmäßige v1-`otel`-Callback verwendet ein schlichtes `metadata.`-Präfix (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), der optionale v2-Modus (`LITELLM_OTEL_V2=true`) den Namensraum `litellm.` —, und **OneUptime liest beide**.

### Die Kundenschlüssel sind absichtlich ausgeschlossen

Ein LLM-Span kann **zwei** verschiedene Personen tragen: den Mitarbeiter, der den Aufruf gemacht hat, und den nachgelagerten **Kunden**, für den er gemacht wurde. Diese Schlüssel tragen den Kunden, und OneUptime liest bewusst **keinen** davon in eine Identitätsspalte:

- `gen_ai.user` und `llm.user` — so geben Instrumentierungen den Anfrageparameter `user` von OpenAI wieder, den OpenAI als „a stable identifier for your end-users“ dokumentiert (inzwischen zugunsten von `safety_identifier` und `prompt_cache_key` veraltet).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` und `litellm.end_user.id` — die explizite Endnutzer-ID von LiteLLM in allen drei Schreibweisen, getrennt von der ID des Schlüsselinhabers, die **der** Mitarbeiter ist und **gelesen wird**.

Der Grund ist eine korrekte Kostenverrechnung: Liest man eine Kunden-ID in die Mitarbeiterspalte, erzeugt ein Support-Bot mit 40.000 Kunden 40.000 Phantom-„Mitarbeiter“, während der Entwickler, dem die Ausgaben gehören, scheinbar nichts ausgegeben hat. Diese Attribute bleiben in der rohen Attributmap, wo Sie sie direkt abfragen können.

### Identitätsspalten werden bereinigt

Die Spalte mit der E-Mail des Mitarbeiters enthält echte personenbezogene Daten. Ihre Telemetrie-**Scrub-Regeln** im Bereich **Attribute** erfassen sie genau so wie das Attribut, aus dem sie gelesen wurde, sodass eine Regel zum Schwärzen von E-Mails auch für die Spalte gilt. Scrub-Regeln und Drop-Filter konfigurieren Sie unter **Traces → Einstellungen**.

## Spans und Metriken sind ein Rückgriff, keine Summe

**GenAI-Spans sind maßgeblich. Der Metrikstrom wird nur herangezogen, wenn der Span-Strom nichts gemeldet hat, und die beiden werden nie addiert.** Ein Span trägt Modell, Tokens und Kosten in einer Zeile, sodass Spans, wo es sie gibt, jede Frage beantworten. Wo es keine gibt — die Coding-Agent-CLIs veröffentlichen Token- und Kosten-_Metriken_ und keine GenAI-Spans —, springt der Metrikstrom ein. Sie werden nicht summiert, weil viele Instrumentierungen beide Signale für denselben Aufruf senden (OpenLLMetry ist der häufigste Fall), und eine Addition würde jeden Dollar doppelt zählen.

Die Folge, mit der Sie planen sollten: **Sobald Ihre GenAI-Spans einen Wert ungleich null melden, erscheint der Beitrag einer reinen Metrikquelle zu diesem Wert nicht.** Der Rückgriff gilt pro Wert und pro Aufschlüsselung, nicht pro Sender:

| Wo                                        | Was auf Metriken zurückgreift                        | Wann                                         |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Nutzung → Eingabe-Tokens / Ausgabe-Tokens | Summen der Eingabe- und Ausgabe-Tokens               | Beide Token-Summen der Spans sind 0          |
| Nutzung → Kosten (USD)                    | Kosten, in USD und Mikro-USD, skaliert und addiert   | Die Kostensumme der Spans ist 0              |
| Nutzung → LLM-Aufrufe                     | Nichts — nur Spans                                   | —                                            |
| Nutzung → Mitarbeiter, Team, Modell       | Nur Kosten. Aufruf- und Token-Spalten zeigen `—`     | Diese Aufschlüsselung lieferte keine Span-Zeilen |
| Nutzung → Anbieter, Anwendung / Dienst    | Nichts — nur Spans                                   | —                                            |
| Unterhaltungen                            | Nichts — Unterhaltungen werden aus Spans gebaut      | —                                            |

Anbieter und Anwendung / Dienst haben keinen Metrik-Rückgriff, weil die Zähler der Coding-Agents kein GenAI-Anbieterattribut tragen und keinem OneUptime-Telemetriedienst zugeordnet sind. Wo ein Wert aus Metriken stammt, kennzeichnet die Seite ihn mit **aus GenAI-Metriken**, weil ein aus Metriken stammender Wert keine passenden Zeilen in der Liste Aufrufe hat.

**Wenn die Ausgaben eines reinen Metrik-Tools für sich stehen sollen, geben Sie ihm ein eigenes Projekt**, damit sein Span-Strom wirklich leer ist und der Rückgriff greift. Dasselbe gilt für Budgets: Legen Sie ein Budget pro Dienst fest, statt Dienste mit Spans und reine Metrikdienste zu mischen.

## Dashboards und Metrik-Warnungen

GenAI-Metriken kommen als gewöhnliche OpenTelemetry-Metriken an, sodass Sie **Dashboards** bauen können, die `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` und den Rest darstellen, und **Metrik-Monitore** darauf anlegen können — etwa wenn das p95 von `gen_ai.client.operation.duration` einen Schwellenwert überschreitet, gruppiert nach Modell. Siehe [Metriken-Überwachung](/docs/monitor/metrics-monitor).

## Tägliche Kostenbudgets

Der Tab **Budgets** setzt tägliche Limits in USD, ausgewertet über den UTC-Tag. Alle 15 Minuten summiert ein Hintergrund-Worker die LLM-Span-Kosten des Tages (gemeldet oder berechnet), hält sie am Budget fest und veröffentlicht zwei Gauge-Metriken:

| Metrik                              | Bedeutung                                       |
| ----------------------------------- | ----------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | Die bisherigen Ausgaben des Tages, in USD       |
| `oneuptime.llm.budget.percent.used` | Ausgaben in Prozent des Tageslimits             |

Beide tragen die Attribute `oneuptime.llm.budget.id` und `oneuptime.llm.budget.name`, dazu den Dienst-, Anbieter- und Modellbereich des Budgets, sofern gesetzt. Filtern Sie Monitore nach **`oneuptime.llm.budget.id`**, das stabil ist; der Name ändert sich, wenn Sie das Budget umbenennen.

**Gewarnt wird mit einer [Metriken-Überwachung](/docs/monitor/metrics-monitor) auf diesen Metriken.** Für das klassische Muster 80 % / 100 % legen Sie einen Monitor auf `oneuptime.llm.budget.percent.used` an, filtern ihn nach `oneuptime.llm.budget.id` und fügen zwei Kriterien hinzu: `>= 80` für eine einfache Warnung und `>= 100` für eine kritische. **Setzen Sie das rollierende Zeitfenster des Monitors auf 30 Minuten**: Ein Budget veröffentlicht alle 15 Minuten einen Punkt, sodass das Standardfenster von 1 Minute zwischen zwei Durchläufen eine leere Reihe fände.

Budgets lassen sich auf einen Telemetriedienst, einen LLM-Anbieter oder ein exaktes Modell beschränken oder projektweit lassen, und mehrere können nebeneinander bestehen. Ein Budget-Monitor kann außerdem einen Workflow aufrufen, der einen außer Kontrolle geratenen Agenten stoppt — siehe [Schutzschalter für außer Kontrolle geratene KI-Agenten](/docs/telemetry/ai-agent-circuit-breaker).

## Datenschutz und Schwärzung

Prompts und Completions können sensible Daten enthalten. OneUptime wendet Ihre Telemetrie-**Scrub-Regeln** und **Drop-Filter** auf LLM-Spans an wie auf jeden anderen Trace, sodass Sie Attribute maskieren oder Spans verwerfen können, bevor sie gespeichert werden; konfigurieren Sie sie unter **Traces → Einstellungen**. Die Spalte mit der E-Mail des Mitarbeiters unterliegt denselben Regeln — siehe [Identitätsspalten werden bereinigt](#identitätsspalten-werden-bereinigt).

Unterhaltungen werden mit derselben Berechtigung gelesen wie Traces: Wer die Traces des Projekts lesen kann, kann seine Unterhaltungen lesen, und niemand sonst.

## Verwandte Themen

- [Observability für KI-Coding-Assistenten](/docs/telemetry/ai-coding-assistants) — die Unterstützungsmatrix für Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline und die übrigen, und wie die Ausgaben pro Mitarbeiter über sie hinweg funktionieren.
- [Claude Code überwachen](/docs/telemetry/claude-code)
- [Cursor überwachen](/docs/telemetry/cursor)
- [OpenAI Codex CLI überwachen](/docs/telemetry/openai-codex)
- [Gemini CLI und GitHub Copilot überwachen](/docs/telemetry/gemini-cli-and-copilot)
- [KI-Gateways beobachten (LiteLLM & Portkey)](/docs/telemetry/ai-gateways)
- [Schutzschalter für außer Kontrolle geratene KI-Agenten](/docs/telemetry/ai-agent-circuit-breaker)
