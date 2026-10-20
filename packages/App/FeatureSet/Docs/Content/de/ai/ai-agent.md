# Code

Code ist der Ort, an dem Sie OneUptime AI bitten, in Ihren Repositorys zu arbeiten, so wie Sie einen Coding-Agenten bitten würden: einen Fehler beheben, Tests schreiben, den Code erklären, eine Änderung vornehmen. Code öffnet sich mit Ihren verbundenen Repositorys; die Seite eines Repositorys enthält seine Aufgaben und das Feld, in dem Sie fragen; die Seite einer Aufgabe ist eine Unterhaltung, in der Sie antworten können. OneUptime startet auch selbst Aufgaben, aus Ausnahmen, Traces und Untersuchungen. Ein [Runner](/docs/runbooks/agents) klont das Repository, schreibt die Änderung in einen neuen Branch, baut und testet sie und öffnet einen Pull Request. Jeden davon prüft und mergt ein Mensch: Der Runner kann Branches pushen und Pull Requests öffnen, mehr nicht.

:::cards
- [KI in einem Repository bitten](#ki-in-einem-repository-bitten): Eine Anfrage in Ihren eigenen Worten, mit dem Kontext, den sie braucht.
- [Die Unterhaltung einer Aufgabe](#die-unterhaltung-einer-aufgabe): Was die KI getan und geändert hat, und Ihre Antwort.
- [Wie ein Korrekturlauf abläuft](#wie-ein-korrekturlauf-abläuft): Vom Klick bis zum Pull Request, Schritt für Schritt.
- [Wo Korrekturaufgaben starten](#wo-korrekturaufgaben-starten): Die Aufgaben, die OneUptime startet, und was jeder Pull Request tut.
- [Bevor Sie beginnen](#bevor-sie-beginnen): Ein Modell, ein verbundenes Repository und ein Runner.
- [Wenn eine Korrektur fehlschlägt](#wenn-eine-korrektur-fehlschlägt): Was mit einem Lauf passiert, der fehlschlägt, hängen bleibt oder wartet.
:::

> [!TIP]
> Sie können das auch aus GitHub heraus starten. Erwähnen Sie die OneUptime GitHub App in einem Issue oder einem Pull Request, und sie implementiert, überarbeitet oder prüft direkt dort: siehe [GitHub App](/docs/ai/github-app). Es ist derselbe Agent, derselbe Runner und dasselbe Budget; nur der Auslöser unterscheidet sich.

## KI in einem Repository bitten

:::steps
### Ein Repository öffnen

Öffnen Sie **Produkte → Code**. Dort stehen die Repositorys des Projekts, jedes mit den Aufgaben, an denen die KI arbeitet, denen, die auf Sie warten, und seinen offenen Pull Requests. Gibt es noch keines, bietet Code **GitHub verbinden** an (siehe [Bevor Sie beginnen](#bevor-sie-beginnen)).

### Sagen, was Sie möchten

Schreiben Sie auf der Seite des Repositorys die Änderung, den Fehler oder die Frage in Ihren eigenen Worten. Ein Repository ohne Aufgabe schlägt unter **Zum Beispiel** einige vor.

### Kontext hinzufügen

Klicken Sie auf **Kontext hinzufügen**, um der KI zu geben, was sie braucht: eine Datei oder einen Ordner des Repositorys, eine Notiz, einen Link oder einen Datensatz des Projekts. OneUptime liest jeden Datensatz beim Senden der Anfrage mit Ihren Berechtigungen und behält, was die KI bekommen hat.

### Die Aufgabe starten

Klicken Sie auf **Aufgabe starten** oder drücken Sie die Eingabetaste. Die Seite der Aufgabe öffnet sich, und die Arbeit der KI erscheint dort, während sie geschieht.
:::

| Kontext | Was die KI bekommt |
| --- | --- |
| **Datei oder Ordner** | Einen Pfad im Repository, den die KI zuerst liest. |
| **Notiz** | Text, den Sie einfügen: einen Fehler, eine Spezifikation, eine Protokollzeile. |
| **Link** | Eine Webadresse als Referenz. |
| **Vorfall** oder **Warnung** | Status, Beschreibung und Grundursache, so wie sie beim Senden der Anfrage sind. |
| **Ausnahme** | Meldung und Stacktrace. |
| **Überwachung** | Typ, Status und Beschreibung. |
| **Trace** | Die Spans: ihre Namen, Zeiten und Fehler. |
| **Protokolle** | Die neuesten 20 Protokollzeilen, die Ihren Suchbegriff enthalten, aus der letzten Stunde, dem letzten Tag oder der letzten Woche. |
| **Leistungsprofil** | Wohin die Zeit einer Funktion in den Profilen ihres Dienstes geht: wer sie aufruft, was sie aufruft und ihre heißesten Zeilen. |

Eine Anfrage trägt höchstens 10 Kontextelemente. Token, Schlüssel, Passwörter und E-Mail-Adressen in dem, was OneUptime liest, werden geschwärzt, bevor die KI sie sieht, wie überall, wo OneUptime AI Ihre Daten liest.

## Die Unterhaltung einer Aufgabe

Die Seite einer Aufgabe ist eine Unterhaltung: was gefragt wurde und welcher Kontext hinzugefügt wurde, dann der Zug der KI – die Schritte, während sie sie ausführt (die Dateien, die sie gelesen und bearbeitet hat, wonach sie gesucht hat, die Befehle, die sie ausgeführt hat), ihre Antwort, die geänderten Dateien mit ihrem Diff und der Pull Request. Oben auf der Seite steht, wie es um die Aufgabe steht:

| Status | Was er bedeutet |
| --- | --- |
| **In der Warteschlange** | Sie wartet darauf, dass ein Runner sie übernimmt. |
| **Wird bearbeitet…** | Die KI arbeitet daran. **Stoppen** stoppt sie; was sie gepusht hat, bleibt im Branch. |
| **Wartet auf Sie** | Die KI hat eine Frage gestellt. Beantworten Sie sie im Feld unten. |
| **Fertig** | Die KI ist fertig: ihre Antwort und der Pull Request, wenn sie Code geändert hat. |
| **Fehlgeschlagen** | Der Durchgang konnte nicht abgeschlossen werden und sagt, warum. **Erneut versuchen** fragt dasselbe noch einmal. |
| **Gestoppt** | Jemand hat sie gestoppt. **Erneut versuchen** fragt dasselbe noch einmal. |

Um nachzufassen, schreiben Sie in das Feld unten: Antworten Sie der KI, fügen Sie Kontext hinzu oder bitten Sie um Änderungen. Jede Antwort ist der nächste Durchgang derselben Aufgabe: Sie arbeitet im selben Branch und pusht in denselben Pull Request, solange er offen ist. Eine Aufgabe hat immer nur einen Durchgang zur Zeit, deshalb wartet das Feld, während die KI arbeitet. Das **Protokoll** jedes Durchgangs ist die wörtliche Aufzeichnung dessen, was er getan hat.

Wer ein Repository lesen darf, liest seine Aufgaben. Die KI bitten, antworten und eine Aufgabe stoppen erfordern die Berechtigung, das Repository zu bearbeiten, ebenso das Ansehen des Diffs einer Änderung: Alle anderen sehen, welche Dateien sich geändert haben. Die Aufgaben, die OneUptime selbst startet (unten), stehen ebenfalls in ihrem Repository, als Unterhaltungen, in denen Sie antworten können.

## Wie ein Korrekturlauf abläuft

```mermaid title="Vom Klick zum Pull Request"
flowchart TB
    S["Eine Anfrage, eine<br/>Schaltfläche oder<br/>ein Auslöser"] --> Q["Eine Korrektur-<br/>aufgabe wird<br/>eingereiht"]
    Q --> R["Ein Runner für KI-<br/>Codekorrekturen<br/>übernimmt sie"]
    R --> C["Er klont das Repository<br/>und legt einen<br/>Branch an"]
    C --> A["Der Code-Agent<br/>schreibt die Änderung"]
    A --> V["Einrichtungs-, Build-<br/>und Testbefehle<br/>prüfen sie"]
    V -->|"ein Fehler"| A
    V --> P["Commit, Push und<br/>Pull Request öffnen"]
    P --> H["Ein Mensch prüft<br/>und mergt ihn"]
```

1. Sie klicken in einem Repository auf **Aufgabe starten** oder bei einer ungelösten Ausnahme auf **Mit KI beheben**, oder eine andere Schaltfläche oder ein Auslöser startet eine Aufgabe (siehe [Wo Korrekturaufgaben starten](#wo-korrekturaufgaben-starten)).
2. Die Aufgabe wird eingereiht, und ein verfügbarer Runner mit eingeschaltetem **Führt KI-Codekorrekturen aus** übernimmt sie.
3. Der Runner holt den Kontext der Aufgabe. Bei einer Anfrage sind das ihre Worte, der hinzugefügte Kontext und die bisherige Unterhaltung; bei einer Ausnahme ihr Typ, ihre Meldung und ihr Stack-Trace.
4. Er klont das Repository in einen eigenen Arbeitsbereich und legt einen Branch an. Eine Korrektur einer Ausnahme heißt `oneuptime-fix-exception-`, gefolgt von den ersten Zeichen der ID des Laufs. Eine Antwort arbeitet stattdessen im Branch des offenen Pull Requests der Aufgabe.
5. Ein Code-Agent, angetrieben vom LLM-Anbieter Ihres Projekts, liest den Code und schreibt die Änderung. Der OneUptime-Server führt die LLM-Aufrufe aus, sodass der Runner den API-Schlüssel Ihres Anbieters nie besitzt, und jeder Aufruf wird gemessen und in den KI-Protokollen aufgeführt.
6. Hat das Repository Prüfbefehle, baut und testet ein eigener Runner die Änderung, bevor er etwas committet, und gibt einen Fehler zur Reparatur an den Code-Agenten zurück (siehe [Prüfung vor dem Pull Request](#prüfung-vor-dem-pull-request)).
7. Der Runner committet, pusht den Branch, öffnet den Pull Request (bei einer Anfrage nur, wenn sie Code geändert hat) und löscht den Arbeitsbereich.

Die Seite, auf der die Aufgabe gestartet wurde, zeigt ihren Live-Status. Jede Aufgabe steht in ihrem Repository unter **Produkte → Code**: Ihre Seite ist ihre Unterhaltung, und das **Protokoll** jedes Durchgangs hat eine Zeile für jede Datei, die der Runner gelesen oder geschrieben hat, und jeden Befehl, den er ausgeführt hat.

Jeder Lauf unterliegt Budgets, die der Server durchsetzt: höchstens **40 LLM-Aufrufe** und **100.000 Ausgabe-Tokens**. Ein Lauf, der eines davon erreicht, endet mit einer Zusammenfassung der bisherigen Arbeit, statt in einer Schleife zu laufen. Korrekturläufe zählen auch zu den täglichen KI-Limits des Projekts, wenn das Projekt sie festlegt.

## Wo Korrekturaufgaben starten

| Wo | Klick | Der Pull Request |
| --- | --- | --- |
| Die Seite **KI-Unterstützung** einer Ausnahme | **Mit KI beheben** | Behebt den Fehler hinter der Ausnahme. |
| Die Seite **KI-Unterstützung** einer Ausnahme | **Regressionstest generieren** | Fügt einen Test hinzu, der die Ausnahme reproduziert und fehlschlägt, bis der Fehler behoben ist. |
| Die Seite **KI-Unterstützung** einer Ausnahme | **Fehlerbehandlung verbessern** | Für einen erwarteten Fehler, etwa eine ungültige Eingabe: nimmt Benutzerdaten aus der Meldung, prüft die Eingabe früher und markiert den Fehler als behandelt, ohne das Verhalten zu ändern. |
| Die Karte **KI-Untersuchung** eines Vorfalls oder einer Warnung | **Korrektur-PR aus dieser Analyse öffnen** | Behebt die Grundursache, die die Untersuchung veröffentlicht hat (siehe [Automatische Codekorrekturen aus Untersuchungen](#automatische-codekorrekturen-aus-untersuchungen)). |
| Ein Trace, der eine Korrektur lohnt | **Mit KI beschleunigen** | Behebt das langsame Muster, das die Schaltfläche nennt, etwa eine N+1-Abfrage oder Aufrufe, die parallel laufen könnten. |
| Die Seite **Protokolle** eines Dienstes | **Logging verbessern** | Macht die Logs des Dienstes strukturiert, mit dem richtigen Schweregrad und mit seinen Traces verknüpft, ohne das Verhalten zu ändern. |
| Die Seite **Traces** eines Dienstes | **Tracing verbessern** | Fügt Spans und Attribute hinzu, wo das Tracing des Dienstes fehlt, ohne das Verhalten zu ändern. |
| Eine Funktion in **Leistungsprofile** | **Mit KI beheben** | Lässt die Funktion dieselbe Arbeit mit weniger Zeit oder Speicher erledigen, mit ihrem Profil als Beleg. |

Diese Schaltflächen erscheinen nur dort, wo sie eine Aufgabe starten können. Ist KI für das Projekt ausgeschaltet, erscheint keine davon, und das Seitenmenü einer Ausnahme hat keine **KI-Unterstützung**. **Logging verbessern** und **Tracing verbessern** erscheinen, sobald ein Repository verbunden ist, und **Mit KI beschleunigen** nur bei einem Trace, der eine Korrektur lohnt (siehe [Trace-Explorer](/docs/telemetry/traces-explorer)). **Mit KI beheben** bei einer Funktion erscheint nur für den eigenen Code der Anwendung, der mindestens 5 % der Zeit oder des Speichers des Profils beansprucht oder dessen Anteil seit dem Vergleichsfenster um 3 Punkte oder mehr gewachsen ist (siehe [Kontinuierliches Profiling](/docs/telemetry/profiles)).

Um die Seite **KI-Unterstützung** einer Ausnahme zu öffnen, öffnen Sie die Ausnahme unter **Produkte → Observability → Ausnahmen** und wählen im Seitenmenü **KI-Unterstützung**. Eine gelöste oder archivierte Ausnahme muss zuerst als ungelöst markiert werden.

OneUptime AI startet Korrekturaufgaben auch selbst: aus einer Untersuchung, die eine Codeänderung findet, aus einer, die ergebnislos endet, weil Telemetrie fehlte, und aus KI-Einblicken zu Ausnahmen und langsamen Traces. Jede davon hat einen eigenen Schalter; siehe [Automatische Codekorrekturen](/docs/ai/ai-sre#automatische-code-korrekturen).

## Prüfung vor dem Pull Request

Ein Repository kann auf seiner Seite **Einstellungen** in Code bis zu drei Prüfbefehle haben:

| Befehl | Beispiel | Wann er läuft |
| --- | --- | --- |
| **Einrichtungsbefehl** | `npm ci` | Zuerst, um Abhängigkeiten zu installieren. |
| **Build-Befehl** | `npm run build` | Nach der Einrichtung. |
| **Testbefehl** | `npm test` | Zuletzt. |

Ist einer davon gesetzt, prüft jeder Korrekturlauf seine Änderung, bevor der Pull Request geöffnet wird:

1. Wenn der Code-Agent fertig ist, laufen die Befehle der Reihe nach im Stammverzeichnis des Repositorys, auf dem Runner, im geklonten Arbeitsbereich. Jeder bekommt bis zu 15 Minuten und läuft mit `CI=true`, sodass nichts auf eine Eingabe wartet; der erste Fehler beendet den Durchlauf.
2. Bei einem Fehler geht das Ende der Ausgabe des fehlgeschlagenen Befehls als Reparaturaufgabe an denselben Code-Agenten zurück, mit der Anweisung, seine eigene Änderung zu korrigieren, statt Tests abzuschwächen oder zu überspringen, und die Befehle laufen erneut. Er unternimmt höchstens **2** Reparaturversuche. Sie teilen sich das LLM-Budget des Laufs, und ihre Änderungen landen im selben Commit wie die Korrektur.
3. Das Ergebnis, bestanden, fehlgeschlagen oder übersprungen (keine Befehle gesetzt oder ein gemeinsam genutzter Runner), steht in einem Abschnitt Verification der Beschreibung des Pull Requests und wird am Pull Request der Aufgabe gespeichert.

Eine Änderung, die die Prüfung weiterhin nicht besteht, wird nicht verworfen: Der Pull Request öffnet sich trotzdem, mit einem deutlich markierten Abschnitt "Verification failed", der den fehlgeschlagenen Befehl nennt und mit seiner Ausgabe endet. Die Arbeit bleibt erhalten, und der Prüfer entscheidet. Ein Repository ohne gesetzte Befehle wird als übersprungen gemeldet, statt einen grünen Build vorzutäuschen.

Die Befehle sind Repository-Einstellungen, die Ihr Team schreibt und die auf Ihrem eigenen Runner laufen: dasselbe Vertrauensmodell wie die Bash-Schritte eines Runbooks. Die KI schreibt oder ändert sie nie. Die gemeinsam genutzten Runner von OneUptime führen sie nie aus: Auf einem gemeinsam genutzten Runner wird die Korrektur geschrieben und zur Durchsicht geöffnet, die Prüfung wird als übersprungen gemeldet, und das eigene CI Ihres Repositorys prüft die Änderung. [Betreiben Sie einen eigenen Runner](#einen-eigenen-runner-betreiben), damit Korrekturen gebaut und getestet werden, bevor sich der Pull Request öffnet.

## Bevor Sie beginnen

Eine Aufgabe braucht drei Dinge. Die Seite eines Repositorys in Code und die Seite **KI-Unterstützung** der Ausnahme prüfen alle drei, bevor sie den Start anbieten, und sagen, was fehlt.

| Was | OneUptime Cloud | Selbst gehostet |
| --- | --- | --- |
| Ein LLM-Anbieter | Nichts einzurichten: Ein Projekt ohne eigenen Anbieter nutzt den globalen Anbieter, bezahlt aus dem KI-Guthaben des Projekts. Ein eigener Anbieter unter **Projekteinstellungen → KI → LLM-Anbieter** hat Vorrang. | Setzen Sie die Umgebungsvariablen `GLOBAL_LLM_PROVIDER_*` einmal auf dem Server, oder fügen Sie dem Projekt einen Anbieter hinzu. |
| Ein über die GitHub App verbundenes Repository | **Produkte → Code**, dann **GitHub verbinden**. Ist die App auf dem GitHub-Konto bereits installiert, klicken Sie stattdessen auf **Vorhandene Installation verbinden**: Eine erneute Installation verbindet sie nicht. Erfordert den Growth-Tarif. | Dasselbe, sobald Ihre Instanz eine GitHub App hat (siehe [GitHub-Integration](/docs/self-hosted/github-integration)). |
| Ein Runner, der KI-Codekorrekturen ausführt | Nichts zu betreiben: Das erledigen die gemeinsamen Runner von OneUptime. | Der Dienst `runner` von Docker Compose oder der Runner des Helm-Charts (`runner.enabled`, standardmäßig eingeschaltet) registriert sich selbst und führt KI-Codekorrekturen aus. |

Auf einer selbst gehosteten Instanz ist der globale Anbieter ein Block in `config.env` (Docker Compose) oder in Ihren Helm-Werten. Für ein selbst gehostetes Ollama:

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach, never localhost.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No GLOBAL_LLM_PROVIDER_API_KEY needed — Ollama is keyless.
```

Jeder unterstützte Anbieter funktioniert: siehe [LLM-Anbieter](/docs/ai/llm-provider) für alle Anbieter und jede Umgebungsvariable.

Sie ordnen Repositories keinen Diensten zu. Wenn eine Aufgabe startet, findet OneUptime das Repository, indem es die Dateipfade aus dem Stack-Trace der Ausnahme mit Ihren verbundenen Repositories abgleicht. Passt nichts, weicht es auf ein Repository aus, das wie der Dienst heißt, und dann auf das einzige Repository des Projekts, wenn es nur eines gibt. Die Seite **KI-Unterstützung** zeigt, welches Repository gefunden wurde.

### Einen eigenen Runner betreiben

So betreiben Sie einen Runner an anderer Stelle, etwa auf einem Rechner in der Nähe Ihrer Repositories:

:::steps
### Den Runner anlegen

Legen Sie einen Runner unter **Runbooks → Runbook-Agents** an und klicken Sie in seiner Zeile auf **Einrichtungsanweisungen anzeigen**. Der Befehl enthält den geheimen Schlüssel des Runners, den nur ein Project Owner, Project Admin oder Runbook Admin lesen kann. Er sieht so aus:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=<your-oneuptime-url> \
  -d oneuptime/runner:release
```

### KI-Codekorrekturen einschalten

Schalten Sie beim Runner **Führt KI-Codekorrekturen aus** ein. Es ist standardmäßig ausgeschaltet, und der Runner übernimmt die Änderung mit seinem nächsten Heartbeat, innerhalb etwa einer Minute; es muss nichts neu gestartet werden.

### Prüfen, dass er sich verbindet

Der Runner erscheint innerhalb von ein, zwei Minuten als verbunden auf der Seite **Runbooks → Runbook-Agents**. Wenn nicht, lesen Sie das Log des Containers (`docker logs oneuptime-runner`) auf einen Anmelde- oder Netzwerkfehler hin.
:::

Jede Art, den Container zu betreiben, funktioniert (Docker Compose, Kubernetes und so weiter), solange er diese Variablen hat und Ihre OneUptime-Instanz über HTTPS erreicht:

| Variable | Was sie ist |
| --- | --- |
| `ONEUPTIME_RUNNER_ID` | Die ID des Runners, aus dem Dashboard. |
| `ONEUPTIME_RUNNER_KEY` | Der geheime Schlüssel des Runners. |
| `ONEUPTIME_URL` | Die Adresse Ihrer OneUptime-Instanz (`https://oneuptime.com` in OneUptime Cloud). |

> [!NOTE]
> Vor OneUptime 12 liefen KI-Codekorrekturen auf einer eigenen Komponente AI Agent (dem Image `oneuptime/ai-agent` mit Variablen `AI_AGENT_*`). Sie ist im Runner aufgegangen: Wenn Sie noch eine betreiben, beschreibt der [Upgrade-Leitfaden von v11 auf v12](/docs/installation/upgrading), wie Sie sie ersetzen.

## Automatische Codekorrekturen aus Untersuchungen

Wenn eine [KI-Untersuchung](/docs/ai/ai-sre) eine Ursachenanalyse zu einem Vorfall oder einer Warnung veröffentlicht und ihre sorgfältige Einordnung eine Änderung am Code empfiehlt, bietet die Untersuchungskarte **Korrektur-PR aus dieser Analyse öffnen** an: eine Korrekturaufgabe, deren ganzer Kontext die veröffentlichte Analyse ist. Die Schaltfläche ist ausgeblendet, wenn die Abhilfe betrieblich ist, nur die Infrastruktur betrifft, extern ist, eine erwartete Ablehnung, ein Benutzerfehler oder ergebnislos ist. Passende Korrekturen geschehen ohne Klick, solange der Schalter **Korrektur-Pull-Anfrage öffnen, wenn eine Untersuchung eine Codeänderung findet** eingeschaltet ist. Er gehört zum Beheben: Er steht unter **Neue Vorfälle automatisch beheben** auf **Vorfälle → KI → Einstellungen** (und unter **Neue Warnungen automatisch beheben** auf **Warnungen → KI → Einstellungen**), schaltet sich ein, wenn das Beheben eingeschaltet wird, und öffnet Pull Requests nur, solange das Beheben eingeschaltet ist. Beide sind anfangs ausgeschaltet, auch bei neuen Projekten.

Solange er eingeschaltet ist, reiht eine Untersuchung, die mit einer sicheren, belegten Grundursache endet, die eine Codeänderung beheben kann, dieselbe Korrekturaufgabe ein, die die Schaltfläche anlegt. Die Entscheidung ist eine eingeschränkte Einordnung, die der Server prüft, nie ein Muster, das gegen den Text der Analyse abgeglichen wird: Nur ein positives Urteil für eine Codekorrektur öffnet einen Pull Request. Fehlende Belege, eine Abhilfe außerhalb des Codes und eine fehlgeschlagene Einordnung enden alle damit, dass nichts geschieht.

Alles andere entspricht der Schaltfläche:

- Der Pull Request öffnet sich prüfbereit, geschrieben aus der veröffentlichten Analyse, und braucht ein über die GitHub App verbundenes Repository und einen Runner mit eingeschaltetem **Führt KI-Codekorrekturen aus**.
- Er zählt zum täglichen Limit für Korrekturaufgaben dieses Signals (**Tägliches Limit für KI-Korrekturaufgaben bei Vorfällen** oder **Tägliches Limit für KI-Korrekturaufgaben bei Warnungen**, unter **Weitere Einstellungen** auf seiner KI-Einstellungsseite) und zur Obergrenze offener Pull Requests des Repositorys, wenn eines davon gesetzt ist. Ungesetzt begrenzt keines davon etwas.
- Jeder Auslöser sucht zuerst nach einer Korrekturaufgabe, die für denselben Vorfall oder dieselbe Warnung bereits eingereiht ist oder läuft, sodass ein automatischer Auslöser und ein Klick normalerweise zu einer Aufgabe werden, nicht zu zwei Pull Requests. Die Prüfung ist ein Lesen vor dem Schreiben, keine Sperre, sodass zwei Auslöser im selben Moment trotzdem beide durchkommen können.
- Der Lauf stammt vom System, wird niemandem zugeschrieben, und nichts wird von selbst gemergt.

## Wenn eine Korrektur fehlschlägt

:::details Der Lauf schlägt fehl
Die Korrektur ließ sich nicht anwenden, das Repository war nicht erreichbar oder der LLM-Aufruf schlug fehl. Die Unterhaltung der Aufgabe und die Seite, auf der sie gestartet wurde, zeigen den Grund und bieten einen neuen Versuch an. Das **Protokoll** des Durchgangs enthält das vollständige Laufprotokoll.
:::

:::details Der Runner bleibt mitten im Lauf stehen
Ein Lauf, dessen Heartbeat länger als 12 Minuten ausbleibt, wird mit einem Fehler beendet. Er wird nie von selbst erneut eingereiht, weil der Runner bereits einen Teil eines Korrektur-Branches gepusht haben kann; starten Sie ihn dort neu, wo Sie ihn gestartet haben.
:::

:::details Kein Runner übernimmt die Aufgabe
Eine Aufgabe, die länger als 30 Minuten wartet, während kein Runner mit **Führt KI-Codekorrekturen aus** verbunden ist, schlägt mit dem Hinweis fehl, den Runner zu prüfen, sodass sie nie für immer als laufend angezeigt wird. Ist ein Runner online, aber beschäftigt, warten eingereihte Aufgaben, bis sie an der Reihe sind. Ein Runner, der älter als Code ist, bekommt nie eine Anfrage aus Code: Aktualisieren Sie einen selbst betriebenen Runner zusammen mit dem Server.
:::

## Datenschutz

Der Klon Ihres Repositorys liegt in einem Arbeitsbereich im Container des Runners und wird gelöscht, wenn der Lauf endet, ob erfolgreich oder nicht. Der Runner besitzt nie den API-Schlüssel Ihres LLM-Anbieters: Der OneUptime-Server führt die LLM-Aufrufe für ihn aus. OneUptime behält Ihr Repository nicht und trainiert nicht mit Ihrem Code. Das Protokoll der Aufgabe behält die ersten 300 Zeichen der Ausgabe jedes Schritts, damit Sie prüfen können, was der Runner getan hat, und das kann Codeausschnitte enthalten. Betreiben Sie einen selbst gehosteten Runner mit Ihrem eigenen LLM-Anbieter (lokales Ollama eingeschlossen), verlässt Ihr Code Ihre Infrastruktur nie.

## Geplant

Geplant, und **heute noch nicht verfügbar**:

- **Unterstützung für GitLab.** Repositories werden nur über die GitHub App verbunden.
- **Mehr Telemetrie in einer Korrektur.** Die Traces, Logs und Metriken rund um eine Ausnahme in ihre Korrektur einfließen lassen, über den Stack-Trace hinaus.

## Nächste Schritte

:::cards
- [GitHub App](/docs/ai/github-app): Bitten Sie direkt aus GitHub um eine Änderung, eine Überarbeitung oder eine Prüfung.
- [AI SRE](/docs/ai/ai-sre): Die Untersuchungen, deren Analysen Korrekturaufgaben in Pull Requests verwandeln können.
- [Runbook-Agents](/docs/runbooks/agents): Der Worker, der jeden Korrekturlauf ausführt.
:::
