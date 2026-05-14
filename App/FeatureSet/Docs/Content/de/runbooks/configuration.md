# Runbook-Konfiguration & Sicherheit

## Ausgabelimits

- Ausgabe pro Schritt: **50 KB**. Größere Ausgaben werden mit einem Marker abgeschnitten.
- Timeout pro Schritt (Standard): **30 Sekunden** für JavaScript, Bash und HTTP. Pro Schritt konfigurierbar.
- **Claim-Timeout** für Bash-Schritte (Standard): **2 Minuten** — so lange wartet der Worker auf einen Runbook-Agent, der den Job übernimmt, bevor der Schritt fehlschlägt.

## Berechtigungen

Runbook-Berechtigungen leben in der Berechtigungsgruppe `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook-Vorlagen verwalten.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — Ausführungen starten, abhaken und lesen.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — Auto-Trigger-Regeln verwalten.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — Runbook-Agents verwalten, die Bash-Schritte in Ihrer eigenen Infrastruktur ausführen.
- `RunbookManager` (Rolle) — bündelt alle obigen; weisen Sie sie einem Team zu, um vollen Runbook-Zugriff zu gewähren.

## Queue & Worker

Runbook-Ausführungen laufen auf der `Runbook`-BullMQ-Queue. Die Worker-Parallelität ist 25 — passen Sie sie in Ihrem Deployment an, wenn Sie viele gleichzeitige Läufe haben.

Wird ein manueller Schritt per API abgehakt, wird die Ausführung erneut in die Queue gestellt, um beim nächsten Schritt fortzufahren. So bleibt der Worker für den Rest des Runbooks heiß.

## Härtungs-Hinweise

- **JavaScript-Schritte** laufen in `isolated-vm` mit einer Sandbox-Härtungs-Präambel (kappt Prototypenketten, entfernt `Function` und `eval`, friert eingebaute Prototypen ein).
- **Bash-Schritte** laufen nie auf dem OneUptime-Worker. Sie werden als Jobs an einen [Runbook-Agent](/docs/runbooks/agents) gesendet, den Sie in Ihrer eigenen Infrastruktur installiert haben. Der Worker stellt den Job mit dem **Agent Tag** des Schritts in die Warteschlange, ein Agent beansprucht ihn atomar, führt `bash -c <Skript>` lokal aus und schickt das Ergebnis zurück. Der Worker-Prozess hat selbst keinen Shell-Zugriff auf Ihre Umgebung.
- **HTTP-Schritte** verwenden einen permissiven Status-Validator, sodass eine 4xx- oder 5xx-Antwort als fehlgeschlagener Schritt protokolliert wird, anstatt geworfen zu werden. Dadurch spiegelt die erfasste Ausgabe wider, was die Gegenseite tatsächlich geliefert hat.

## Datenbanktabellen

- `Runbook` — Vorlage (Name, Slug, Beschreibung, isEnabled, JSON der Schritte).
- `RunbookExecution` — eine Zeile pro Lauf mit nullbaren `incidentId`-, `alertId`- und `scheduledMaintenanceId`-Fremdschlüsseln und einem JSON-Array `stepExecutions`, das Schritte und Schrittzustand als Snapshot enthält.
- `RunbookRule` — Auto-Trigger-Regeln mit Diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance) und einer Many-to-Many-Beziehung zu den zu startenden Runbooks.
- `RunbookAgent` — eine Zeile pro installiertem Agent: Name, Tags, Geheimschlüssel, `lastAlive`, `connectionStatus`, Host-Info.
- `RunbookAgentJob` — eine Zeile pro versandtem Bash-Schritt: erforderlicher Tag, Skript, Status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), Claim-Deadline, Lease, Ausgabe, Exit-Code.

## Betriebshinweise

- **Mindestens einen Agent pro Ziel-Tag betreiben**, idealerweise zwei für Hochverfügbarkeit. Mit zwei Agents gleichen Tags kann jeder einen Job übernehmen — Sie können rollende Neustarts machen, ohne Runbooks zu brechen.
- **URLs erfassen, keine Blobs.** Erzeugt ein Schritt mehr als ein paar KB, schreiben Sie das Ergebnis in S3 oder den Log-Stack und geben Sie die URL zurück.
- **Idempotenz zählt.** Automatisierte Schritte (HTTP, JavaScript, Bash) können bei Worker-Neustart oder wenn der Lease eines Agents während eines laufenden Skripts abläuft mehrfach laufen; gestalten Sie sie so, dass Wiederholungen sicher sind.
