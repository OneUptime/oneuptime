# Eingehender Anfrage-Monitor

Ein Eingehender Anfrage-Monitor gibt Ihnen eine URL, an die andere Systeme HTTP-Anfragen senden. OneUptime wertet jede Anfrage anhand Ihrer Kriterien aus und kann den Status des Monitors ändern, Vorfälle deklarieren und Ihre Bereitschaftsrotation alarmieren.

Er deckt zwei verschiedene Aufgaben ab:

- **Heartbeat-Überwachung** — ein Cron-Job, ein Worker oder ein Gerät pingt die URL planmäßig an, und OneUptime löst einen Vorfall aus, wenn die Pings ausbleiben.
- **Alarme von einem anderen System empfangen** — Prometheus Alertmanager, Grafana oder alles andere, was JSON per POST senden kann, schiebt Alarme hinein, und OneUptime macht aus jedem davon einen Vorfall mit Bereitschaftseskalation und automatischer Auflösung bei Wiederherstellung.

Beides nutzt denselben Monitortyp. Der Unterschied liegt in den Kriterien, die Sie konfigurieren.

## Übersicht

Eingehende Anfrage-Monitore stellen eine eindeutige URL bereit, die Ihre Dienste aufrufen. Dies ermöglicht Ihnen:

- Cron-Jobs und geplante Aufgaben überwachen
- Hintergrund-Worker auf Aktivität prüfen
- Dienste hinter Firewalls überwachen, die extern nicht erreichbar sind
- Alarme von Prometheus Alertmanager, Grafana und anderen Alarmierungssystemen empfangen
- Heartbeat-Signale von jedem HTTP-fähigen System verfolgen

## Einen Eingehenden Anfrage-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Eingehende Anfrage** als Monitortyp
4. Ein **Geheimer Schlüssel** und eine URL werden für diesen Monitor generiert
5. Öffnen Sie den Monitor und klicken Sie im linken Menü auf **Documentation**, um die URL zu kopieren
6. Konfigurieren Sie Ihren Dienst so, dass er Anfragen an diese URL sendet
7. Konfigurieren Sie die Überwachungskriterien wie unten beschrieben

## Die Anfrage-URL

Ihr Monitor hat eine eindeutige URL im Format:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Ersetzen Sie `https://oneuptime.com` durch Ihre OneUptime-Instanz-URL, wenn Sie es selbst hosten.

Senden Sie **GET**- oder **POST**-Anfragen an diese URL. HEAD wird akzeptiert und wie GET behandelt. Andere Methoden liefern 404. Der geheime Schlüssel im Pfad ist der einzige Zugangsschlüssel – ein Header oder Token ist nicht erforderlich.

> **Warning:** Jeder, der diese URL kennt, kann den Monitor als gesund markieren – behandeln Sie sie daher als Geheimnis. Jeder Header, den Sie senden, wird auf dem Monitor gespeichert und ist für jeden sichtbar, der ihn lesen kann – senden Sie keine API-Schlüssel oder Tokens in Headern an diesen Endpunkt.

OneUptime antwortet sofort mit einem leeren `200` und verarbeitet die Anfrage in einer Warteschlange. Diese Antwort wird geschrieben, bevor irgendeine Validierung stattfindet, ein `200` ist also **keine** Bestätigung, dass die Anfrage akzeptiert wurde – ein falscher geheimer Schlüssel, ein gelöschter Monitor und ein deaktivierter Monitor liefern ebenfalls `200`. Prüfen Sie die Zeitleiste des Monitors selbst, um zu bestätigen, dass Anfragen ankommen.

### Einen Anfragetext senden

Wenn Sie Felder innerhalb des Texts ansprechen möchten – `{{requestBody.status}}` in einem Vorfallstitel, ein JSON-Pfad in der Vorfallsgruppierung oder ein Kriterium vom Typ JavaScript Expression – senden Sie `Content-Type: application/json`; dieses Format setzt die Dokumentation durchgehend voraus. Ein `application/x-www-form-urlencoded`-Text wird ebenfalls geparst, aber nur zu flachen Feldern auf oberster Ebene. Jeder andere Content-Type – oder gar keiner – wird nicht geparst, und jede `requestBody`-Referenz löst sich zu nichts auf.

Texte bis 50 MB werden akzeptiert. Komprimieren Sie den Text nicht mit `Content-Encoding: gzip`; er wird ungeparst gespeichert und Pfade in ihn hinein lösen sich nicht auf.

### Einen Heartbeat senden

#### Mit curl

```bash
# Einfache GET-Anfrage
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-Anfrage mit benutzerdefiniertem Text
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Von einem Cron-Job

```bash
# Zu crontab hinzufügen, um alle 5 Minuten einen Heartbeat zu senden
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Aus Anwendungscode

```javascript
// Node.js-Beispiel
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python-Beispiel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Dienst als online, eingeschränkt oder offline gilt. Jeder Kriterienfilter hat einen **Filter Type** (worauf geschaut wird), eine **Filter Condition** (wie verglichen wird) und einen **Value**.

### Verfügbare Filter Types

| Filter Type           | Prüft                                                  | Hinweise                                                                                   |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Incoming Request      | Ob eine Anfrage innerhalb eines Zeitfensters einging   | Die einzige Prüfung, die auslösen kann, wenn nichts ankommt                                |
| Request Body          | Den Anfragetext                                        | Teilstring-Vergleich. Objekt-Texte werden als kompaktes JSON verglichen                    |
| Request Header        | Die Namen der Anfrage-Header                           | Exakter Vergleich mit einem Header-Namen, kleingeschrieben                                 |
| Request Header Value  | Die Werte der Anfrage-Header                           | Exakter Vergleich mit einem Header-Wert, kleingeschrieben                                  |
| JavaScript Expression | Jeden Ausdruck über `requestBody` und `requestHeaders` | Die flexibelste Option – siehe [JavaScript-Ausdrücke](/docs/monitor/javascript-expression) |

### Filter Conditions

Jeder Filter Type bietet seinen eigenen Satz an Bedingungen.

Für **Incoming Request** (hier mit der Schreibweise des Dashboards wiedergegeben):

- **Recieved In Minutes** — innerhalb der angegebenen Minutenzahl ging eine Anfrage ein
- **Not Recieved In Minutes** — innerhalb der angegebenen Minutenzahl ging keine Anfrage ein

Für **Request Body**, **Request Header** und **Request Header Value**: **Contains** und **Not Contains**.

Für **JavaScript Expression**: **Evaluates To True**.

> **Note:** Header-Namen und Header-Werte werden vor dem Vergleich in Kleinbuchstaben umgewandelt, und verglichen wird der gesamte Name bzw. Wert, nicht ein Teilstring. Schreiben Sie `content-type`, nicht `Content-Type`, und `application/json`, nicht `application/JSON`. Nur **Request Body** führt einen echten Teilstring-Vergleich durch.

Objekt-Texte werden als kompaktes JSON ohne Leerzeichen verglichen, ein **Request Body** / **Contains**-Filter muss also `"status":"firing"` lauten – ein aus einer formatierten Payload kopiertes `"status": "firing"` wird niemals passen.

### Beispielkriterien

#### Als offline markieren, wenn kein Heartbeat in 10 Minuten

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Als eingeschränkt markieren anhand des Anfragetext-Inhalts

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** Ein Monitor wird nur dann im Hintergrund neu bewertet, wenn mindestens eines seiner Kriterien auf **Incoming Request** prüft. Ein Monitor, dessen Kriterien nur Request Body, Request Header oder eine JavaScript Expression prüfen, wird beim Eintreffen einer Anfrage bewertet und zu keinem anderen Zeitpunkt – er kann also nie von selbst offline gehen. Wenn Sie einen Alarm für ausbleibende Heartbeats möchten, brauchen Sie ein **Incoming Request**-Kriterium.

Beachten Sie außerdem: Ein Monitor, der noch nie eine Anfrage empfangen hat, wird so behandelt, als wäre sein Erstellungszeitpunkt die letzte Anfrage. Ein Kriterium „Not Recieved In Minutes: 10" auf einem brandneuen Monitor löst 10 Minuten nach dem Erstellen aus, selbst wenn der Sender nie angebunden wurde.

## Alarme von einem anderen System empfangen

Alertmanager, Grafana und ähnliche Tools senden per POST ein JSON-Dokument, das einen oder mehrere Alarme beschreibt. Standardmäßig öffnet ein Kriterium **einen** Vorfall, eine Payload mit fünf Alarmen würde also einen einzigen Vorfall erzeugen. Die Vorfallsgruppierung ändert das: Sie extrahiert einen Wert aus der Payload und öffnet **pro eindeutigem Wert einen eigenen Vorfall**, die alle gleichzeitig offen sein können.

### Vorfallsgruppierung einschalten

Öffnen Sie das Kriterium, klappen Sie **Settings** auf und aktivieren Sie **Group incidents and alerts by a payload field**. Vier Felder erscheinen:

| Feld                               | Beispiel                                 | Was es tut                                                                                 |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Der Pfad, dessen eindeutige Werte die Vorfälle voneinander trennen                         |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Der Pfad, der geprüft wird, um zu entscheiden, ob ein Alarm sich erholt hat                |
| Value that means recovered         | `resolved`                               | Der exakte Wert, der eine Wiederherstellung kennzeichnet                                   |
| Max incidents per request          | `100` (Standard)                         | Sicherheitsgrenze, damit ein Feld hoher Kardinalität nicht unbegrenzt Vorfälle öffnen kann |

### Pfadsyntax

Pfade müssen mit dem wörtlichen Präfix `requestBody.` beginnen. Ein Pfad ohne dieses Präfix – `alerts[*].labels.alertname` – passt auf nichts, und zwar stillschweigend. Die `{{ }}`-Umschließung ist optional: `requestBody.status` und `{{requestBody.status}}` verhalten sich identisch.

- `[*]` fächert über ein Array auf – ein Vorfall pro **eindeutigem** Wert. Zwei Elemente mit demselben Wert fallen zu einem Vorfall zusammen, und der Firing-/Resolved-Zustand dieses Vorfalls stammt vom **ersten** passenden Element. **Nur das erste `[*]` in einem Pfad ist ein Platzhalter**; `requestBody.groups[*].alerts[*].name` passt auf nichts.
- `[0]` und `[last]` wählen ein einzelnes Element aus und dürfen auf ein `[*]` folgen.
- Objekt- und Array-Werte, leere Zeichenketten und Nulls werden übersprungen. `0` und `false` sind gültige Schlüssel.

### Auflösung ist ereignisgesteuert

Ein Webhook beschreibt nur, was in dieser Payload steht, deshalb löst OneUptime einen Vorfall nie deshalb auf, weil sein Schlüssel nicht mehr auftaucht. Ein Vorfall wird nur aufgelöst, wenn eine Payload ausdrücklich sagt, dass dieser Schlüssel sich erholt hat. Zwei Dinge müssen zugleich zutreffen:

1. **Field that signals recovery** und **Value that means recovered** sind gesetzt und passen zur Payload. Der Vergleich ist exakt und unterscheidet Groß-/Kleinschreibung – `Resolved` passt nicht auf `resolved`.
2. Der Vorfall des Kriteriums hat **Auto Resolve Incident** aktiviert, unter **Advanced Options** im Vorfallsformular. Ohne das werden passende Wiederherstellungsereignisse ignoriert und die Vorfälle bleiben offen. (Dasselbe gilt für Warnmeldungen und **Auto Resolve Alert**.)

**Max incidents per request** begrenzt die Extraktion, nicht nur das Anlegen. Schlüssel jenseits der Grenze sind auch für die Wiederherstellung unsichtbar; in einer Payload mit mehr eindeutigen Schlüsseln als der Grenzwert schließt ein Alarm, der jenseits davon `resolved` meldet, seinen Vorfall nicht.

> **Warning:** Wenn **Field that signals recovery** ein `[*]` enthält, **Open a separate incident for each…** aber nicht, wird sich nie etwas auflösen. Verwenden Sie `[*]` entweder in beiden oder in keinem. Ein Wiederherstellungspfad ohne `[*]` wird gegen die gesamte Payload ausgewertet, ein `status: resolved` auf Payload-Ebene löst also jeden Schlüssel dieser Payload auf – auch Alarme, deren eigener Status noch firing ist.

### Die Vorfälle benennen

Der Gruppierungsschlüssel wird Vorfalls- und Warnmeldungsvorlagen als Variable bereitgestellt, benannt nach dem **letzten Segment des Pfads**:

| Pfad                                     | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

Die vollständige Payload steht daneben zur Verfügung, ein Vorfallstitel `{{alertname}}` und eine Beschreibung mit `{{requestBody.commonAnnotations.summary}}` funktionieren also beide. Siehe [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).

> **Warning:** Der Variablenname ist Teil der Identität, über die OneUptime ein Wiederherstellungsereignis einem offenen Vorfall zuordnet. Wenn Sie den Gruppierungspfad auf einen mit anderem letztem Segment ändern, verwaisen alle Vorfälle, die derzeit unter dem alten Pfad offen sind – sie können nicht mehr automatisch aufgelöst werden und müssen von Hand geschlossen werden.

Beachten Sie, dass `[*]` **nur** in den beiden Gruppierungspfad-Feldern funktioniert. Anderswo löst es sich nicht auf, und ein nicht aufgelöster Platzhalter wird **wörtlich** ausgegeben statt geleert – ein Titel `{{requestBody.alerts[*].labels.alertname}}` erscheint mitsamt geschweiften Klammern. Ein Titel `{{requestBody.alerts[0].annotations.summary}}` löst sich zwar auf, liest aber immer den ersten Alarm der Payload, nicht denjenigen, für den dieser Vorfall geöffnet wurde. Bevorzugen Sie die Gruppierungsvariable plus die gemeinsamen `commonAnnotations`-Felder der Payload.

### Ausgearbeitetes Beispiel

Eine vollständige Alertmanager-Konfiguration finden Sie unter [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Für Grafana siehe [Grafana](/docs/integrations/grafana).

## Best Practices

1. **Zeitfenster angemessen festlegen** — Wenn Ihr Cron-Job alle 5 Minuten läuft, setzen Sie den Schwellenwert „Not Recieved In Minutes" auf 10–15 Minuten, um gelegentliche Verzögerungen zu berücksichtigen
2. **Aussagekräftige Daten einschließen** — Statusinformationen im Anfragetext senden, um granulare Kriterien einzurichten
3. **POST mit `Content-Type: application/json` verwenden** — alles, was in den Text hineinliest, hängt davon ab
4. **Die beiden Aufgaben nicht auf einem Monitor mischen** — ein Monitor, der ereignisgesteuerte Alarme empfängt, hat keine regelmäßige Taktung, ein „Not Recieved In Minutes"-Kriterium darauf flattert also. Verwenden Sie für den Totmannschalter einen eigenen Monitor
5. **Den Monitor überwachen** — Sicherstellen, dass der Dienst, der Anfragen sendet, eine ordnungsgemäße Fehlerbehandlung hat, damit fehlgeschlagene Anfragen nicht unbemerkt bleiben

## Weiterführende Themen

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — ein vollständiges eingehendes Alarmierungs-Setup
- [Grafana](/docs/integrations/grafana) — dasselbe für die Grafana-Alarmierung
- [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating) — jede in Titeln und Beschreibungen verfügbare Variable
- [JavaScript-Ausdrücke](/docs/monitor/javascript-expression) — Ausdruckssyntax und Anführungszeichen-Regeln
