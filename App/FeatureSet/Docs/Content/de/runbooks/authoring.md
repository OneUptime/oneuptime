# Ein Runbook verfassen

Erstellen Sie ein Runbook unter **Runbooks → Runbook erstellen**, öffnen Sie es dann und gehen Sie zum **Steps**-Tab.

## Aufbau eines Schritts

Jeder Schritt hat:

| Feld | Zweck |
| --- | --- |
| **Titel** | Kurze Bezeichnung, die in der Checklisten-UI angezeigt wird. Erforderlich. |
| **Beschreibung** | Optionaler Kontext für die reagierende Person. Markdown-sicherer Text. |
| **Bei Fehler fortfahren** | Wenn an, stoppt ein fehlgeschlagener Schritt den Lauf nicht — der nächste Schritt wird trotzdem ausgeführt. |
| **Freigabe erforderlich** | Wenn an, pausiert das Runbook nach diesem Schritt und wartet, bis ein Benutzer freigibt, bevor der nächste Schritt läuft. |
| **Typspezifische Konfiguration** | Skript, URL, Agent usw. — siehe unten. |

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
