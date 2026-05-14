# Ein Runbook verfassen

Erstellen Sie ein Runbook unter **Runbooks → Runbook erstellen**, öffnen Sie es und gehen Sie zur Registerkarte **Schritte**.

## Aufbau eines Schritts

Jeder Schritt besitzt:

| Feld | Zweck |
| --- | --- |
| **Titel** | Kurze Bezeichnung in der Checklisten-UI. Pflichtfeld. |
| **Beschreibung** | Optionaler Kontext für den Bearbeiter. Markdown-tauglicher Text. |
| **Bei Fehler fortfahren** | Wenn aktiv, hält ein fehlgeschlagener Schritt den Lauf nicht an — der nächste Schritt wird trotzdem ausgeführt. |
| **Typspezifische Konfiguration** | Skript, URL usw. — siehe unten. |

Schritte laufen **in der angegebenen Reihenfolge**. Mit den Auf/Ab-Pfeilen im Schritt-Editor können Sie sie umordnen.

## Schritttypen

### Manuell

Ein Kontrollkästchen, das der Bearbeiter abhakt. Die Ausführung pausiert beim Erreichen eines manuellen Schritts und bleibt im Zustand `WaitingForManualStep`, bis jemand ihn als erledigt markiert (oder überspringt).

Verwenden Sie dies für Dinge, die nur ein Mensch bestätigen kann: „Verkehr wurde laut Load-Balancer-Dashboard in die sekundäre Region verschoben — bestätigt."

### JavaScript

Ein JavaScript-Snippet, das in einer `isolated-vm`-Sandbox läuft (kein Dateisystem, kein Netzwerk, außer Sie bringen eine API mit).

```js
const start = Date.now();
// ... Ihre Logik ...
return { durationMs: Date.now() - start };
```

Der Rückgabewert wird in der Schritt-Ausführung erfasst. `console.log`-Ausgaben werden als Logzeilen festgehalten. Standard-Timeout: 30 Sekunden.

### HTTP-Anfrage

Ausgehender HTTP-Aufruf. Methode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optionale JSON-Header und optionaler Body konfigurieren. Statuscode, Header und Body der Antwort werden erfasst (insgesamt auf 50 KB begrenzt).

Nützlich für: einen PagerDuty-Vorfall starten, in Slack posten, die eigene Admin-API aufrufen usw.

### Bash

Ein Bash-Skript, das auf einem [Runbook-Agent](/docs/runbooks/agents) ausgeführt wird — einem kleinen Prozess, den Sie auf einem Host in Ihrer eigenen Infrastruktur installieren. Bash-Schritte laufen nie auf dem OneUptime-Worker.

Bei einem Bash-Schritt konfigurieren Sie zwei Dinge:

- **Agent Tag** — der Tag, der angibt, welche(r) Agent(s) diesen Schritt ausführen soll(en). Jeder gesunde Agent im Projekt, der diesen Tag trägt, beansprucht und führt den Job aus.
- **Skript** — das auszuführende Bash. Ausgabe (stdout + stderr) wird bis 50 KB erfasst; bei Timeout wird der Prozess beendet.

Ist beim Erreichen dieses Schritts kein Agent mit dem gewählten Tag online, wartet der Schritt bis zum **Claim-Timeout** (Standard 2 Minuten) und schlägt dann fehl. Legen Sie einen Agent unter **Runbooks → Agents** an, bevor Sie sich auf einen Bash-Schritt verlassen.

## Speichern und bearbeiten

Klicken Sie auf **Schritte speichern**, um zu persistieren. Laufende Ausführungen älterer Versionen des Runbooks sind nicht betroffen — sie verwenden weiterhin ihren Snapshot.

## Mehrere Schritte und Fehlerbehandlung

Standardmäßig hält ein fehlgeschlagener Schritt den Lauf an und markiert die Ausführung als `Failed`. Wenn Sie **Bei Fehler fortfahren** an einem Schritt aktivieren, wird ein Fehler protokolliert, der nächste Schritt aber trotzdem ausgeführt. Hilfreich für Muster nach dem Schema „diese drei Dinge versuchen, dann benachrichtigen".

## Ein durchgespieltes Beispiel

Ein einfaches Runbook für „Primäre Datenbank nicht erreichbar":

1. **JavaScript** — den aktuellen Primary-Host vom Konfigurationsdienst holen und loggen.
2. **Manuell** — „Replikationsverzögerung der Sekundärinstanz liegt unter 5 Sekunden — bestätigt."
3. **HTTP-Anfrage** — POST an die API Ihres Failover-Orchestrators.
4. **Manuell** — „Schreibvorgänge gehen jetzt an den neuen Primary — bestätigt."
5. **HTTP-Anfrage** — POST an Slack mit einer „Alles klar"-Nachricht.

Der Bearbeiter sieht einem automatisierten Schritt zu, hakt einen manuellen ab, sieht dem nächsten automatisierten zu und so weiter. Die Ausgabe jedes Schritts wird für das Post-Mortem festgehalten.
