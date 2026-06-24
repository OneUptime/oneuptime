# Runbook-Agents

Ein **Runbook-Agent** ist ein kleiner, selbst gehosteter Prozess, der die Bash- _und_ JavaScript-Schritte Ihrer Runbooks **in Ihrer eigenen Infrastruktur** ausführt. Der OneUptime-Worker führt Ihre Skripte nie selbst aus — er stellt sie in eine Warteschlange, und der Runbook-Agent, den der Schrittautor ausgewählt hat, holt sie ab, führt sie aus und meldet das Ergebnis zurück.

JavaScript läuft weiterhin in einer `isolated-vm`-Sandbox; nur dass diese Sandbox auf Ihrem Agent-Host und nicht auf unserem läuft.

Diese Seite erklärt, wie Sie einen Agent installieren, Bash- und JavaScript-Schritte auf ihn ausrichten und ihn im Alltag betreiben.

## Warum es Agents gibt

Frühere OneUptime-Versionen führten Bash- und JavaScript-Schritte auf dem Worker aus. JavaScript war zwar in einer Sandbox (`isolated-vm`), Bash nicht. Beides war für alles jenseits eines Single-Tenant-Self-Hosted-Setups problematisch:

- **Vertrauensgrenze.** Wer ein Runbook verfassen darf, konnte Code auf dem Worker ausführen — mit Zugriff auf alle Umgebungsvariablen und Dateisysteme, die der Worker hat. Die JavaScript-Sandbox blockierte offensichtliche Dinge, konnte aber einen entschlossenen Nutzer nicht daran hindern, zu prüfen, was von unserem Netzwerk aus erreichbar war.
- **Reichweite.** Die meisten nützlichen Schritte wollen auf der _Kunden_-Infrastruktur arbeiten („Diesen Dienst neu starten", „kubectl auf unserem Cluster", „einen Datensatz in unserer internen DB nachschlagen") — nicht auf OneUptimes.

Runbook-Agents drehen das um. Bash- und JavaScript-Schritte laufen nicht bei uns. Sie laufen auf einem Host, den Sie kontrollieren, und Sie entscheiden, was dieser Host darf.

## Wie es funktioniert

1. Sie erstellen einen Runbook-Agent in OneUptime. OneUptime generiert eine ID und einen geheimen Schlüssel.
2. Sie starten den Agent-Container auf einem Host in Ihrer Infrastruktur mit dieser ID/Schlüssel und Ihrer OneUptime-URL.
3. Der Agent fragt OneUptime alle paar Sekunden: „Habt ihr Arbeit für mich?"
4. Wenn Sie einen Bash- oder JavaScript-Schritt verfassen, wählen Sie den Agent aus einem Dropdown aus — der Schritt ist an genau diesen Agent gebunden.
5. Sobald der Schritt läuft, fügt der Worker einen Job-Eintrag mit `targetAgentId` für diesen Agent ein. Nur dieser Agent kann den Job beanspruchen.
6. Der Agent führt das Skript lokal aus — `bash -c <Skript>` für Bash, eine `isolated-vm`-Sandbox für JavaScript — erfasst das Ergebnis und schickt es zurück. Der Worker setzt das Runbook mit dem Ergebnis fort.

Der Agent benötigt nur **ausgehendes HTTPS** zu Ihrer OneUptime-Instanz. Er akzeptiert keine eingehenden Verbindungen.

## Einen Agent installieren

### 1. Den Agent-Datensatz anlegen

Gehen Sie zu **Runbooks → Settings → Agents** und erstellen Sie einen neuen Agent. Füllen Sie aus:

| Feld             | Hinweise                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**         | Ein sprechender Name — üblicherweise `wo-er-läuft-und-was-er-kann`, z.B. `prod-eu-west-1`. Das ist der Name, der im Dropdown beim Verfassen eines Schritts erscheint. |
| **Beschreibung** | Optional. Ein Satz darüber, was dieser Host erreichen kann. Ihr zukünftiges Ich wird es Ihnen danken.                                                                 |

### 2. Den Installationsbefehl kopieren

Klicken Sie nach dem Anlegen des Agents auf **Setup-Anleitung anzeigen** in seiner Zeile. Sie sehen einen `docker run`-Befehl, in dem die ID und der Schlüssel dieses Agents bereits eingetragen sind. **Speichern Sie den Schlüssel jetzt** — Sie können ihn später zurücksetzen, aber denselben Schlüsselwert nach dem Schließen des Modals nicht mehr einsehen.

### 3. Den Agent auf einem Host in Ihrer Infrastruktur starten

Führen Sie den Docker-Befehl auf einem beliebigen Host in Ihrer Umgebung aus, der:

- Ihre OneUptime-Instanz über HTTPS erreicht und
- das tun kann, was Ihre Bash-/JavaScript-Schritte tun sollen (z. B. SSH zu anderen Hosts, `kubectl`, mit einer Datenbank sprechen).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifizieren, dass der Agent verbunden ist

Gehen Sie zurück zu **Runbooks → Settings → Agents**. Innerhalb von ~60 Sekunden sollte die Zeile des Agents auf `Connected` umschalten und einen frischen **Last seen**-Zeitstempel zeigen. Wenn er auf `Disconnected` bleibt:

- Prüfen Sie die Container-Logs (`docker logs oneuptime-runbook-agent`) auf Auth-Fehler oder Netzwerkprobleme.
- Verifizieren Sie, dass der Host Ihre OneUptime-URL mit `curl` erreicht.
- Verifizieren Sie, dass ID und Schlüssel ohne Whitespace kopiert wurden.

## Einen Schritt auf einen Agent ausrichten

Fügen Sie in Ihrem Runbook einen Bash- oder JavaScript-Schritt hinzu. Das Formular hat ein **Runbook-Agent**-Dropdown, das jeden Agent im aktuellen Projekt auflistet (mit einer Connected/Disconnected-Anzeige):

- Wählen Sie den Agent aus, der diesen Schritt ausführen soll.
- Schreiben Sie Ihr Skript im Editor darunter.

Wenn das Runbook läuft und den Schritt erreicht, stellt der Worker einen Job in die Queue, der auf die ID dieses Agents zielt. Nur dieser Agent kann ihn beanspruchen. Bash wird per `bash -c` ausgeführt; JavaScript läuft auf dem Agent in einer `isolated-vm`-Sandbox (kein Dateisystem, kein Netzwerk, kein `Function`/`eval`).

Brauchen Sie mehr als einen Agent? Erstellen Sie sie und richten Sie einzelne Schritte auf den passenden aus. Wenn Sie Redundanz möchten, können Sie zwei Runbooks (eines pro Agent) verfassen oder Schritte auf Agents aufteilen.

## Betriebshinweise

### Timeouts

Zwei Timeouts gelten für jeden Bash- oder JavaScript-Schritt:

| Timeout                 | Standard    | Was es steuert                                                                                                                                                                                                                                          |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claim-Timeout**       | 2 Minuten   | Wie lange der Worker darauf wartet, dass der ausgewählte Agent den Job beansprucht. Greift der Agent nicht rechtzeitig zu, schlägt der Schritt mit `TimedOut` fehl, und das Runbook macht weiter (oder stoppt, abhängig von **Bei Fehler fortfahren**). |
| **Ausführungs-Timeout** | 30 Sekunden | Wie lange der Agent das Skript laufen lässt, bevor er es beendet. Pro Schritt konfigurierbar. (Bash bekommt `SIGKILL`; das JavaScript-Isolate wird abgerissen.)                                                                                         |

Das Gesamt-Wartefenster des Workers beträgt `Claim-Timeout + Ausführungs-Timeout + ein paar Sekunden`. Wählen Sie Werte, die zum Schritt passen.

### Lease und Heartbeat

Wenn ein Agent einen Job beansprucht, bekommt er einen kurzen Lease (standardmäßig 30 Sekunden). Während das Skript läuft, erneuert der Agent den Lease alle 10 Sekunden. Stirbt der Agent oder verliert mitten im Skript das Netzwerk, läuft der Lease ab, und der Worker markiert den Job als `TimedOut`, anstatt ewig zu warten.

Bash-Kindprozesse werden beim Ablaufen des Lease **nicht** automatisch abgebrochen (ein JavaScript-Isolate läuft auch zu Ende, falls es das jemals tut) — aber der Worker hört auf zu warten, und der Agent kann kein Ergebnis mehr einreichen, sobald ein anderer Claim übernommen hat. Entwerfen Sie Skripte so, dass eine erneute Ausführung sicher ist, wenn Ihnen Genau-Einmal wichtig ist.

### Kein Agent online

Wenn der ausgewählte Agent zum Zeitpunkt der Schrittausführung offline ist, bleibt der Job `Pending`, bis der Claim-Timeout abläuft, und schlägt dann mit einer klaren „kein Agent hat den Job beansprucht"-Meldung fehl. Auf der Agents-Seite bestätigen Sie die Abdeckung, bevor Sie ein Runbook scharf ausführen.

### Ausgabe-Limit

Kombiniertes stdout + stderr ist auf **50&nbsp;KB** pro Schritt begrenzt. Größere Ausgaben werden mit einer Markierung abgeschnitten. Wenn Sie ein vollständiges Log brauchen, schreiben Sie es im Skript nach S3 oder in Ihren Log-Store und `echo`en Sie die URL.

### Abbruch

Wenn Sie eine Runbook-Ausführung abbrechen (über die Ausführungsansicht oder die API), werden alle ihre Bash- und JavaScript-Jobs im Status `Pending`/`Claimed`/`Running` sofort als `Cancelled` markiert. Ein Agent, der schon mitten im Skript ist, beendet seine Arbeit, aber sein Ergebnis wird vom Server nicht akzeptiert.

### Parallelität

Jeder Agent führt standardmäßig einen Job zur Zeit aus. Um mehr zuzulassen, setzen Sie `RUNBOOK_AGENT_CONCURRENCY` auf dem Agent-Container — denken Sie aber daran, dass der Agent den Host mit allem teilt, was sonst dort läuft.

## Umgebungsvariablen

Der Agent liest diese beim Start ein:

| Variable                                  | Erforderlich | Standard | Hinweise                                                                     |
| ----------------------------------------- | ------------ | -------- | ---------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                           | ja           | —        | Basis-URL Ihrer OneUptime-Instanz, z. B. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID`                        | ja           | —        | Die UUID, die im Setup-Modal des Agents angezeigt wird.                      |
| `RUNBOOK_AGENT_KEY`                       | ja           | —        | Das Secret, das im Setup-Modal des Agents angezeigt wird.                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`          | nein         | `5000`   | Wie oft der Agent nach neuen Jobs fragt.                                     |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`     | nein         | `60000`  | Wie oft der Agent seine Lebenszeichen meldet.                                |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nein         | `10000`  | Wie oft der Agent den Lease eines laufenden Jobs erneuert.                   |
| `RUNBOOK_AGENT_CONCURRENCY`               | nein         | `1`      | Maximale gleichzeitige Jobs auf diesem Agent.                                |

## Einen Agent-Schlüssel rotieren

Wenn ein Schlüssel kompromittiert wird, öffnen Sie den Agent in OneUptime und setzen seinen Schlüssel zurück. Der alte Schlüssel funktioniert sofort nicht mehr. Aktualisieren Sie den Agent-Container mit dem neuen Schlüssel und starten Sie ihn neu.

## Berechtigungen

Die Verwaltung von Agents liegt in der bestehenden Runbooks-Berechtigungsgruppe:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Agent-Datensätze verwalten.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (Rollen) — einem Team zuweisen, um vollständige Kontrolle, alltägliche Nutzung oder nur Lesezugriff zu gewähren. `RunbookAdmin` bündelt alle obigen Einzel-Berechtigungen.

Berechtigungen, um ein Runbook _auszulösen_ (und damit Bash- und JavaScript-Schritte zur Ausführung zu bringen), sind weiterhin `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-seitiges API

Für die Neugierigen — der Agent verwendet diese Endpoints, gemountet unter `/runbook-agent-ingest`. Sie werden über die ID + den Schlüssel des Agents im JSON-Body (oder die Header `x-agent-id` / `x-agent-key`) authentifiziert.

| Endpoint                     | Zweck                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /heartbeat`            | Lebenszeichen; aktualisiert `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`.                                                 |
| `POST /claim-next-job`       | Atomar den ältesten `Pending`-Job beanspruchen, der auf die ID dieses Agents zielt. Gibt `{ job: null }` zurück, wenn nichts zu tun ist. |
| `POST /job/:jobId/heartbeat` | Den Lease des Jobs auffrischen. Gibt 404 zurück, sobald der Lease abgelaufen ist oder der Job terminal ist.                              |
| `POST /job/:jobId/result`    | Das Endergebnis einreichen. Wird ignoriert, wenn der Lease bereits weitergezogen ist.                                                    |

Sie sollten diese nicht von Hand aufrufen müssen — der mitgelieferte Agent tut das. Sie sind hier dokumentiert, damit Sie Ihren eigenen Agent bauen können, wenn Sie eine Einschränkung haben, zu der unserer nicht passt.
