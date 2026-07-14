# Ein Runbook verfassen

Erstellen Sie ein Runbook unter **Runbooks → Runbook erstellen**, öffnen Sie es dann und gehen Sie zum **Steps**-Tab.

## Aufbau eines Schritts

Jeder Schritt hat:

| Feld                             | Zweck                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Titel**                        | Kurze Bezeichnung, die in der Checklisten-UI angezeigt wird. Erforderlich.                                                |
| **Beschreibung**                 | Optionaler Kontext für die reagierende Person. Markdown-sicherer Text.                                                    |
| **Bei Fehler fortfahren**        | Wenn an, stoppt ein fehlgeschlagener Schritt den Lauf nicht — der nächste Schritt wird trotzdem ausgeführt.               |
| **Freigabe erforderlich**        | Wenn an, pausiert das Runbook nach diesem Schritt und wartet, bis ein Benutzer freigibt, bevor der nächste Schritt läuft. |
| **Typspezifische Konfiguration** | Skript, URL, Agent usw. — siehe unten.                                                                                    |

Schritte laufen **der Reihe nach**. Sortieren Sie sie mit den Pfeilen Auf/Ab im Steps-Editor um.

## Schritttypen

### Manuell

Ein Häkchen, das die reagierende Person abhakt. Die Runbook-Ausführung pausiert, wenn sie einen manuellen Schritt erreicht, und bleibt in `WaitingForManualStep`, bis jemand sie als abgeschlossen markiert (oder überspringt).

Verwenden Sie dies für Dinge, die nur ein Mensch verifizieren kann: „Bestätigt, dass der Traffic im Load-Balancer-Dashboard auf die sekundäre Region umgeschwenkt ist."

### JavaScript

Ein JavaScript-Snippet, das in einer `isolated-vm`-Sandbox läuft. Die Sandbox lebt auf einem [Runbook-Agent](/docs/runbooks/agents) in Ihrer eigenen Infrastruktur — nicht auf dem OneUptime-Worker.

Konfigurieren Sie zwei Dinge an einem JavaScript-Schritt:

- **Runbook-Agent** — wählen Sie aus dem Dropdown den Agent aus, der diesen Schritt ausführen soll. Nur der ausgewählte Agent darf den Job beanspruchen.
- **Skript** — das auszuführende JavaScript.

```js
const start = Date.now();
// ... Ihre Logik ...
return { durationMs: Date.now() - start };
```

Der Rückgabewert wird auf der Schrittausführung festgehalten. `console.log`-Ausgaben werden als Logzeilen festgehalten. Standard-Ausführungs-Timeout: 30 Sekunden. Standard-Claim-Timeout (wie lange der Worker darauf wartet, dass der Agent den Job aufnimmt): 2 Minuten.

### HTTP-Anfrage

Einen ausgehenden HTTP-Aufruf machen. Konfigurieren Sie Methode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optionale JSON-Header und optionalen Body. Response-Status, -Header und -Body werden festgehalten (insgesamt auf 50 KB begrenzt).

Nützlich für: einen PagerDuty-Vorfall anstoßen, in Slack posten, Ihr eigenes Admin-API aufrufen usw. HTTP-Schritte laufen direkt auf dem OneUptime-Worker; kein Agent nötig.

### Bash

Ein Bash-Skript (`bash -c <Skript>`), das auf einem [Runbook-Agent](/docs/runbooks/agents) in Ihrer eigenen Infrastruktur läuft. Bash wird niemals auf dem OneUptime-Worker ausgeführt.

Konfigurieren Sie zwei Dinge an einem Bash-Schritt:

- **Runbook-Agent** — wählen Sie aus dem Dropdown den Agent aus, der diesen Schritt ausführen soll. Nur der ausgewählte Agent darf den Job beanspruchen.
- **Skript** — die auszuführende Bash. Ausgaben (stdout + stderr) werden bis zu 50 KB festgehalten; der Prozess wird beim Timeout beendet.

Wenn der ausgewählte Agent offline ist, wenn das Runbook diesen Schritt erreicht, wartet der Schritt bis zum **Claim-Timeout** (Standard 2 Minuten) und schlägt dann mit `TimedOut` fehl. Fügen Sie unter **Runbooks → Settings → Agents** einen Agent hinzu, bevor Sie sich auf einen Bash-Schritt verlassen.

### AI

Bitten Sie eine KI, mitten im Lauf etwas zu analysieren, zusammenzufassen oder zu entscheiden. Der Prompt wird an den LLM-Provider Ihres Projekts gesendet (**Settings → Sentinel → LLM Providers**), und die Antwort des Modells wird zur Schrittausgabe auf der Ausführungs-Timeline. AI-Schritte laufen auf dem OneUptime-Worker; kein Agent nötig.

Konfigurieren Sie an einem AI-Schritt:

- **Prompt** — was die KI tun soll. Zum Beispiel: „Prüfe die Ausgabe der vorherigen Schritte und gib an, ob es sicher ist, mit der Behebung fortzufahren."
- **Kontext vorheriger Schritte einbeziehen** — wenn an, sieht die KI alles über die Schritte, die vor diesem gelaufen sind: Titel, Typ, Status, Ausgabe und Fehlermeldungen.
- **Auslöser-Kontext einbeziehen** — wenn an, sieht die KI, was die Ausführung gestartet hat: den verknüpften Vorfall, die Warnmeldung oder das geplante Wartungsereignis (Beschreibung, Schweregrad, aktueller Status, betroffene Monitore, Ursache, Status-Timeline und öffentliche Notizen), oder wer das Runbook manuell ausgeführt hat.

Kombinieren Sie einen AI-Schritt mit **Freigabe erforderlich**, um einen Menschen in die Schleife zu holen: Die KI analysiert, eine reagierende Person liest ihre Antwort und gibt frei, und erst dann läuft der nächste (Behebungs-)Schritt.

**Was die KI nie sieht.** Die Antwort eines AI-Schritts wird als Schrittausgabe auf der Ausführung gespeichert, und Ausführungen sind für alle mit Runbook-Leseberechtigung lesbar — ein größerer Personenkreis als die ACL des Vorfalls. Deshalb schließt der Auslöser-Kontext **private interne Notizen** und **Slack-/Teams-Kanalnachrichten** bewusst aus: Sie bleiben im Vorfall, wo die bestehenden Postmortem- und Notiz-Generatoren ihre abgeleiteten Texte halten. Die Ausgabe früherer Schritte wird auf Geheimnisse (Tokens, Schlüssel, Zugangsdaten) geprüft und geschwärzt, bevor sie an das Modell gesendet wird.

AI-Schritte werden wie jedes andere KI-Feature gemessen und abgerechnet. Wenn für das Projekt kein LLM-Provider konfiguriert ist, schlägt der Schritt mit einem klaren Fehler fehl (setzen Sie **Bei Fehler fortfahren**, wenn der Rest des Runbooks trotzdem laufen soll).

## Speichern und Bearbeiten

Drücken Sie **Schritte speichern**, um zu persistieren. Laufende Ausführungen älterer Versionen des Runbooks sind nicht betroffen — sie verwenden weiter ihren Snapshot.

## Mehrere Schritte und Fehlerbehandlung

Standardmäßig stoppt ein fehlgeschlagener Schritt den Lauf und markiert die Ausführung als `Failed`. Wenn Sie **Bei Fehler fortfahren** an einem Schritt setzen, wird ein Fehler protokolliert, aber der nächste Schritt läuft. Das ist nützlich für „diese drei Dinge probieren, dann benachrichtigen"-Muster.

## Ein durchgespieltes Beispiel

Ein einfaches Runbook für „DB-Primary nicht erreichbar":

1. **JavaScript** — den aktuellen Primary-Host aus Ihrem Config-Service holen und loggen.
2. **Manuell** — „Bestätigen, dass das Replikations-Lag im Secondary unter 5 Sekunden liegt."
3. **HTTP-Anfrage** — POST an das API Ihres Failover-Orchestrators.
4. **Manuell** — „Bestätigen, dass Writes nun an den neuen Primary gehen."
5. **HTTP-Anfrage** — POST an Slack mit einer „Entwarnung"-Nachricht.

Die reagierende Person sieht einen automatisierten Schritt laufen, hakt einen manuellen ab, sieht den nächsten automatisierten Schritt laufen, und so weiter. Die Ausgabe jedes Schritts wird fürs Post-Mortem festgehalten.
