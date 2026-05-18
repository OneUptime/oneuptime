# Runbook-Konfiguration & Sicherheit

## Wie Bash und JavaScript tatsächlich laufen

Bash- und JavaScript-Schritte werden **niemals auf dem OneUptime-Worker ausgeführt**. Sie werden als Jobs an einen bestimmten [Runbook-Agent](/docs/runbooks/agents) verteilt — einen kleinen Prozess, den Sie auf einem Host in Ihrer eigenen Infrastruktur installieren.

Das Dispatch-Modell:

1. Der Autor des Runbook-Schritts wählt beim Verfassen des Schritts einen Runbook-Agent aus dem Dropdown.
2. Wenn der Schritt läuft, fügt der Worker eine Zeile in `RunbookAgentJob` mit `targetAgentId` auf die ID dieses Agents gesetzt und Status `Pending` ein.
3. Dieser spezielle Agent (und nur dieser Agent) beansprucht den Job atomar, führt das Skript lokal aus — Bash über `bash -c <Skript>`, JavaScript in einer `isolated-vm`-Sandbox — und schickt das Ergebnis zurück.
4. Der Worker setzt das Runbook mit dem Ergebnis fort.

Es gibt kein `RUNBOOK_BASH_ENABLED`-Umgebungsflag mehr. Ob Bash- oder JavaScript-Schritte in einem Deployment funktionieren, hängt einzig davon ab, ob mindestens ein verbundener Runbook-Agent im Projekt existiert.

## Ausgabe-Limits und Timeouts

- Ausgabe pro Schritt: **50&nbsp;KB**. Größere Ausgaben werden mit einer Markierung abgeschnitten.
- Standard-Ausführungs-Timeout pro Schritt: **30 Sekunden** für JavaScript, Bash und HTTP. Pro Schritt konfigurierbar.
- **Claim-Timeout** pro Schritt für Bash- und JavaScript-Schritte: **2 Minuten** — wie lange der Worker darauf wartet, dass der ausgewählte Agent den Job aufnimmt, bevor er fehlschlägt.

## Berechtigungen

Runbook-Berechtigungen liegen in der `Runbook`-Berechtigungsgruppe:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook-Vorlagen verwalten.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — Ausführungen starten, abhaken und lesen.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — Auto-Trigger-Regeln verwalten.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Runbook-Agents verwalten, die Bash- und JavaScript-Schritte in Ihrer eigenen Infrastruktur ausführen.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (Rollen) — einem Team zuweisen, um vollständige Kontrolle, alltägliche Nutzung oder nur Lesezugriff zu gewähren. `RunbookAdmin` bündelt alle obigen Einzel-Berechtigungen.

## Queue & Worker

Runbook-Ausführungen laufen auf der `Runbook`-BullMQ-Queue. Die Worker-Parallelität liegt bei 25 — passen Sie sie in Ihrem Deployment an, wenn Sie viele gleichzeitige Läufe haben.

Wenn ein manueller Schritt über die API abgehakt wird, wird die Ausführung erneut in die Queue gestellt, um vom nächsten Schritt aus weiterzulaufen. Das hält den Worker für den Rest des Runbooks warm.

## Härtungshinweise

- **JavaScript und Bash** laufen auf einem Runbook-Agent-Host, den Sie kontrollieren, nicht auf dem OneUptime-Worker. JavaScript ist in eine `isolated-vm`-Sandbox mit dem üblichen Prelude eingewickelt (kappt Prototypketten, entfernt `Function`/`eval`, friert eingebaute Prototypen ein). Bash läuft über `bash -c` mit Timeout-Durchsetzung auf dem Agent.
- **HTTP-Schritte** verwenden einen permissiven Status-Validator, sodass eine 4xx- oder 5xx-Antwort als fehlgeschlagener Schritt protokolliert wird, statt geworfen zu werden. So spiegelt die festgehaltene Ausgabe wider, was die Gegenstelle tatsächlich zurückgegeben hat.
- **Agent-Auth** erfolgt über ID + Secret-Key, die als Env-Variablen am Agent-Container gesetzt werden. Serverseitig kommt die maßgebliche Agent-Identität aus der DB-Zeile, die per präsentierter ID/Schlüssel adressiert wird — Clients können selbst mit kompromittiertem Schlüssel keinen anderen Agent imitieren.

## Datenbank-Tabellen

- `Runbook` — Vorlage (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — eine Zeile pro Lauf, mit nullable `incidentId`-, `alertId`- und `scheduledMaintenanceId`-Fremdschlüsseln und einem JSON-`stepExecutions`-Array, das die Schritte und den Pro-Schritt-Zustand snapshottet.
- `RunbookRule` — Auto-Trigger-Regeln mit einem `triggerEntityType`-Diskriminator (Incident, Alert, ScheduledMaintenance) und einer Many-to-Many-Beziehung zu zu startenden Runbooks.
- `RunbookAgent` — eine Zeile pro installiertem Agent: Name, Secret-Key, `lastAlive`, `connectionStatus`, Host-Info.
- `RunbookAgentJob` — eine Zeile pro versandtem Bash- oder JavaScript-Schritt: `targetAgentId` (der vom Schrittautor ausgewählte Agent), Schritttyp, Skript, Status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), Claim-Deadline, Lease, Ausgabe, Exit-Code.

## Betriebstipps

- **Sorgen Sie dafür, dass der bei einem Schritt ausgewählte Agent gesund ist.** Wenn Sie Redundanz brauchen, betreiben Sie einen zweiten Agent und teilen Ihre Schritte zwischen ihnen auf, oder halten Sie ein Backup-Runbook bereit, das auf den anderen Agent zielt.
- **URLs festhalten, keine Blobs.** Wenn ein Schritt mehr als ein paar KB an Ausgabe erzeugt, schreiben Sie sie nach S3 oder in Ihren Logging-Stack und geben Sie die URL zurück.
- **Idempotenz zählt.** Automatisierte Schritte (HTTP, JavaScript, Bash) können mehr als einmal laufen, wenn der Worker mitten im Schritt neu startet oder ein Agent-Lease abläuft, während ein Skript noch läuft; entwerfen Sie sie so, dass sie sicher wiederholbar sind.
