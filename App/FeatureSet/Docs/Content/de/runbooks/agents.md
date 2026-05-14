# Runbook-Agents

Ein **Runbook-Agent** ist ein kleiner, selbst gehosteter Prozess, der die Bash- *und* JavaScript-Schritte Ihrer Runbooks **in Ihrer eigenen Infrastruktur** ausführt. Der OneUptime-Worker führt Ihre Skripte nie selbst aus — er stellt sie in eine Warteschlange, und ein Runbook-Agent, den Sie in Ihrer Umgebung installiert haben, holt sie ab, führt sie aus und meldet das Ergebnis zurück.

JavaScript läuft weiterhin in einer `isolated-vm`-Sandbox; nur dass diese Sandbox auf Ihrem Agent-Host und nicht auf unserem läuft.

Diese Seite erklärt, wie Sie einen Agent installieren, Bash- und JavaScript-Schritte zu ihm leiten und ihn im Alltag betreiben.

## Warum es Agents gibt

Frühere OneUptime-Versionen führten Bash- und JavaScript-Schritte auf dem Worker aus. JavaScript war zwar in einer Sandbox (`isolated-vm`), Bash nicht. Beides war für alles jenseits eines Single-Tenant-Self-Hosted-Setups problematisch:

- **Vertrauensgrenze.** Wer ein Runbook verfassen darf, konnte Code auf dem Worker ausführen — mit Zugriff auf alle Umgebungsvariablen und Dateisysteme, die der Worker hat. Die JavaScript-Sandbox blockierte offensichtliche Dinge, konnte aber einen entschlossenen Nutzer nicht daran hindern, zu prüfen, was von unserem Netzwerk aus erreichbar war.
- **Reichweite.** Die meisten nützlichen Schritte wollen auf der *Kunden*-Infrastruktur arbeiten („Diesen Dienst neu starten", „kubectl auf unserem Cluster", „einen Datensatz in unserer internen DB nachschlagen") — nicht auf OneUptimes.

Runbook-Agents drehen das um. Bash- und JavaScript-Schritte laufen nicht bei uns. Sie laufen auf einem Host, den Sie kontrollieren, und Sie entscheiden, was dieser Host darf.

## Wie es funktioniert

1. Sie erstellen einen Runbook-Agent in OneUptime. OneUptime generiert eine ID und einen geheimen Schlüssel.
2. Sie starten den Agent-Container auf einem Host in Ihrer Infrastruktur mit dieser ID/Schlüssel und Ihrer OneUptime-URL.
3. Der Agent fragt OneUptime alle paar Sekunden: „Habt ihr Arbeit für mich?"
4. Sobald ein Bash- oder JavaScript-Schritt läuft, fügt der Worker einen Job-Eintrag mit dem **Agent-Tag** des Schritts und einem Schritttyp (Bash oder JavaScript) ein und setzt seinen Status auf `Pending`.
5. Ein beliebiger funktionierender Agent im selben Projekt, der diesen Tag trägt, beansprucht den Job atomar (niemals führen zwei Agents denselben Job aus), führt ihn lokal aus — `bash -c <Skript>` für Bash, eine `isolated-vm`-Sandbox für JavaScript — erfasst das Ergebnis und schickt es zurück.
6. Der Worker setzt das Runbook mit dem Ergebnis fort.

Der Agent benötigt nur **ausgehendes HTTPS** zu Ihrer OneUptime-Instanz. Er akzeptiert keine eingehenden Verbindungen.

## Einen Agent installieren

### 1. Den Agent-Datensatz anlegen

Gehen Sie zu **Runbooks → Agents → Neu erstellen**. Füllen Sie aus:

| Feld | Hinweise |
| --- | --- |
| **Name** | Ein sprechender Name — üblicherweise `wo-er-läuft-und-was-er-kann`, z.B. `prod-eu-west-1`. |
| **Beschreibung** | Optional. Ein Satz darüber, was dieser Host erreichen kann. Ihr zukünftiges Ich wird es Ihnen danken. |
| **Tags** | Kommagetrennt. Bash- und JavaScript-Schritte zielen auf einen Tag; jeder Agent im Projekt mit diesem Tag darf sie ausführen. Übliche Muster: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Den Installationsbefehl kopieren

Klicken Sie nach dem Anlegen in der Zeile des Agents auf **Setup-Anweisungen anzeigen**. Sie sehen einen `docker run`-Befehl, in dem die ID und der Schlüssel dieses Agents bereits eingesetzt sind. **Speichern Sie den Schlüssel jetzt** — Sie können ihn zurücksetzen, aber denselben Wert nach Schließen des Dialogs nicht wieder anzeigen.

### 3. Auf einem Host in Ihrer Infrastruktur ausführen

Führen Sie den Docker-Befehl auf einem beliebigen Host in Ihrer Umgebung aus, der:

- Ihre OneUptime-Instanz per HTTPS erreichen kann, und
- die Dinge tun darf, die Ihre Bash-Schritte tun sollen (z.B. SSH zu anderen Hosts, `kubectl`, Datenbankzugriff).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.ihre-domain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Prüfen, ob der Agent verbunden ist

Gehen Sie zurück zu **Runbooks → Agents**. Innerhalb von etwa 60 Sekunden sollte die Zeile des Agents auf `Connected` wechseln, mit einem aktuellen **Last seen**-Zeitstempel. Bleibt sie `Disconnected`:

- Prüfen Sie die Container-Logs (`docker logs oneuptime-runbook-agent`) auf Auth-Fehler oder Netzwerkprobleme.
- Stellen Sie sicher, dass der Host Ihre OneUptime-URL per `curl` erreicht.
- Prüfen Sie, dass ID und Schlüssel ohne Whitespace kopiert wurden.

## Tagging und Routing

Tags sind der Weg, wie ein Bash- oder JavaScript-Schritt einen Agent findet. Ein paar Muster:

- **Ein Tag pro Umgebung.** Markieren Sie den prod-Agent `prod`, den staging-Agent `staging`. Bash-Schritte mit dem Tag `prod` laufen nur auf prod.
- **Ein Tag pro Region.** `eu-west-1`, `us-east-1`. Sinnvoll, wenn ein Schritt nahe der Ressource laufen muss, die er anfasst.
- **Mehrere Agents, gleicher Tag.** Zwei Agents beide mit `prod` markieren. Beide können einen Job beanspruchen — gibt Ihnen Hochverfügbarkeit und erlaubt rollende Neustarts ohne Runbook-Ausfälle.
- **Mehrere Tags pro Agent.** Ein Agent in Ihrem prod-EU-Cluster könnte `prod`, `eu-west-1` und `kubernetes` tragen. Bash-Schritte können jedes davon ansprechen.

Bash- und JavaScript-Schritte **müssen** jeweils genau einen Agent-Tag angeben. Mehrfach-Tag-Routing (auf irgendeinem Agent laufen, der `prod` AND `db` hat) steht auf der Roadmap, ist aber in diesem Release nicht enthalten.

## Einen Schritt auf einen Agent zeigen lassen

Fügen Sie in Ihrem Runbook einen Bash- oder JavaScript-Schritt hinzu. Das Formular fragt nach einem **Agent Tag**:

- Tragen Sie den Tag der Agent(s) ein, auf denen er laufen soll.
- Schreiben Sie Ihr Skript im Editor darunter.

Wenn das Runbook läuft und den Schritt erreicht, stellt der Worker einen Job mit diesem Tag und Schritttyp in die Warteschlange. Ist mindestens ein funktionierender Agent mit diesem Tag online, wird der Job innerhalb weniger Sekunden beansprucht und ausgeführt. Bash wird über `bash -c` ausgeführt; JavaScript läuft in einer `isolated-vm`-Sandbox auf dem Agent (kein Dateisystem, kein Netzwerk, kein `Function`/`eval`).

## Betriebshinweise

### Timeouts

Auf jeden Bash- oder JavaScript-Schritt wirken zwei Timeouts:

| Timeout | Standard | Wirkung |
| --- | --- | --- |
| **Claim-Timeout** | 2 Minuten | Wie lange der Worker auf *irgendeinen* Agent wartet, der den Job übernimmt. Greift keiner rechtzeitig zu, schlägt der Schritt mit `TimedOut` fehl und das Runbook macht weiter (oder stoppt, je nach **Bei Fehler fortfahren**). |
| **Ausführungs-Timeout** | 30 Sekunden | Wie lange der Agent das Skript laufen lässt, bevor er es beendet. Pro Schritt konfigurierbar. (Bash bekommt `SIGKILL`; die Isolate von JavaScript wird abgebaut.) |

Das gesamte Wartefenster des Workers ist `Claim-Timeout + Ausführungs-Timeout + ein paar Sekunden Puffer`. Wählen Sie Werte, die zum Schritt passen.

### Lease und Heartbeat

Wenn ein Agent einen Job beansprucht, erhält er einen kurzen Lease (Standard 30 Sekunden). Während das Skript läuft, erneuert der Agent den Lease alle 10 Sekunden. Stirbt der Agent oder verliert er mitten im Skript das Netzwerk, läuft der Lease ab und der Worker markiert den Job als `TimedOut`, anstatt ewig zu warten.

Bash-Kindprozesse werden beim Ablauf des Lease **nicht** automatisch abgebrochen (auch eine JavaScript-Isolate läuft – falls sie das überhaupt tut – bis zum Ende weiter) — aber der Worker wartet nicht mehr darauf, und der Agent kann kein Ergebnis mehr einreichen, sobald ein anderer Claim übernommen hat. Gestalten Sie Skripte so, dass sie sicher wiederholbar sind, falls Sie Exactly-once brauchen.

### Kein Agent online

Trägt zum Zeitpunkt der Ausführung kein gesunder Agent den Tag des Schritts, bleibt der Job `Pending`, bis der Claim-Timeout abläuft, und schlägt dann mit einer klaren Meldung („no agent claimed the job") fehl. Die Agents-Seite ist der Ort, an dem Sie vor einem Runbook-Lauf prüfen, ob Sie Abdeckung haben.

### Output-Limit

Kombinierte stdout + stderr sind pro Schritt auf **50 KB** begrenzt. Größere Ausgaben werden mit Marker abgeschnitten. Brauchen Sie ein vollständiges Log, schreiben Sie es im Skript nach S3 oder in Ihren Log-Store und `echo`en Sie die URL.

### Abbruch

Wird eine Runbook-Ausführung abgebrochen (über die Ausführungsansicht oder die API), werden sofort alle ihre `Pending`/`Claimed`/`Running`-Bash-Jobs als `Cancelled` markiert. Ein Agent, der schon mitten im Skript ist, wird seine Arbeit beenden, sein Ergebnis aber nicht mehr vom Server akzeptiert.

### Nebenläufigkeit

Jeder Agent verarbeitet standardmäßig einen Job zur selben Zeit. Mehr erlauben Sie mit `RUNBOOK_AGENT_CONCURRENCY` am Agent-Container — denken Sie aber daran, dass der Agent sich den Host mit allem teilt, was sonst dort lebt.

## Umgebungsvariablen

Der Agent liest diese beim Start:

| Variable | Pflicht | Standard | Hinweise |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | ja | — | Basis-URL Ihrer OneUptime-Instanz, z.B. `https://oneuptime.ihre-domain.com`. |
| `RUNBOOK_AGENT_ID` | ja | — | Die UUID aus dem Setup-Dialog des Agents. |
| `RUNBOOK_AGENT_KEY` | ja | — | Das Geheimnis aus dem Setup-Dialog des Agents. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | nein | `5000` | Wie oft der Agent nach neuen Jobs fragt. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | nein | `60000` | Wie oft der Agent seine Lebendigkeit meldet. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | nein | `10000` | Wie oft der Agent den Lease eines laufenden Jobs erneuert. |
| `RUNBOOK_AGENT_CONCURRENCY` | nein | `1` | Maximale Anzahl gleichzeitiger Jobs auf diesem Agent. |

## Einen Agent-Schlüssel rotieren

Wenn ein Schlüssel ausläuft, öffnen Sie den Agent in OneUptime und setzen Sie seinen Schlüssel zurück. Der alte Schlüssel funktioniert sofort nicht mehr. Aktualisieren Sie den Agent-Container mit dem neuen Schlüssel und starten Sie ihn neu.

## Berechtigungen

Das Verwalten von Agents lebt in der bestehenden Runbooks-Berechtigungsgruppe:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Agent-Datensätze verwalten.
- `RunbookManager` (Rolle) — bündelt all diese.

Berechtigungen zum *Auslösen* eines Runbooks (und damit zum Versand von Bash-Schritten) bleiben `CreateRunbookExecution` / `EditRunbookExecution`.

## API für Agents

Für Neugierige — der Agent verwendet diese Endpoints, gemountet unter `/runbook-agent-ingest`. Sie sind über die Agent-ID + den Schlüssel im JSON-Body authentifiziert (oder `x-agent-id` / `x-agent-key`-Header).

| Endpoint | Zweck |
| --- | --- |
| `POST /heartbeat` | Lebendigkeit; aktualisiert `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Beansprucht atomar den ältesten `Pending`-Job, dessen Tag zu einem dieser Agent-Tags passt. Liefert `{ job: null }`, wenn nichts ansteht. |
| `POST /job/:jobId/heartbeat` | Erneuert den Lease des Jobs. Liefert 404, sobald der Lease abgelaufen oder der Job terminal ist. |
| `POST /job/:jobId/result` | Reicht das Endergebnis ein. Wird ignoriert, sobald der Lease bereits weitergewandert ist. |

Sie sollten diese nicht selbst aufrufen müssen — der mitgelieferte Agent tut es. Sie sind hier dokumentiert, falls Sie einen eigenen Agent bauen wollen, weil Ihre Einschränkungen unseren nicht passen.
