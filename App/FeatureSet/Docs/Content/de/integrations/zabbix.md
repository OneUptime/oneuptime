# Zabbix-Integration

[Zabbix](https://www.zabbix.com) überwacht Ihre Server und Ihr Netzwerk; OneUptime steuert Ihre Incident-Response, Rufbereitschaft und Statusseiten. Verbinden Sie beides, und jedes Zabbix-Problem wird automatisch zum OneUptime-Vorfall – damit die richtigen Personen benachrichtigt werden und Ihre Statusseite stets aktuell bleibt.

Diese Integration ist **eingehend**: Zabbix sendet Probleme an OneUptime. Sie nutzt auf der einen Seite einen Zabbix-**Webhook-Medientyp** und auf der anderen einen OneUptime-**[Workflow](/docs/workflows/index)**. Keine Plugins, keine zusätzlichen Dienste.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## So funktioniert es

1. Ein Zabbix-Trigger wechselt zu **PROBLEM**.
2. Eine Zabbix-**Aktion** weist den **OneUptime**-Medientyp an, das Ereignis zu senden.
3. Das Skript des Medientyps sendet einen kleinen JSON-Payload per POST an eine OneUptime-Workflow-URL.
4. Der Workflow liest die Payload und erstellt einen Vorfall (und löst ihn bei Bedarf auf, wenn Zabbix sich erholt).

## Voraussetzungen

- Ein Zabbix-Server, den Sie administrieren (diese Anleitung ist für **Zabbix 6.0 LTS / 7.0 LTS** geschrieben; der Webhook-Medientyp funktioniert ab 5.0+ gleich).
- Ihr Zabbix-Server muss Ihre OneUptime-Instanz über HTTPS erreichen können.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Teil 1 — Den OneUptime-Workflow erstellen

Tun Sie dies zuerst, da Sie die dabei generierte Webhook-URL benötigen.

1. Öffnen Sie **Workflows → Create Workflow**. Benennen Sie ihn `Zabbix → Incidents` und öffnen Sie den **Builder**-Tab.
2. Ziehen Sie einen **Webhook**-Auslöser auf die Arbeitsfläche. Klicken Sie darauf und **kopieren Sie die angezeigte eindeutige URL**. Bewahren Sie diese sicher auf – jeder, der sie besitzt, kann den Workflow starten. Benennen Sie den Block in `Zabbix` um, damit Variablen übersichtlich lesbar sind.
3. Ziehen Sie einen **Conditions**-Block auf die Arbeitsfläche und verbinden Sie den Ausgang des Auslösers damit. Konfigurieren Sie:
   - **Linker Wert**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Rechter Wert**: `1`  *(Zabbix sendet `1` für ein Problem, `0` für eine Wiederherstellung)*
4. Ziehen Sie einen **Create Incident**-Block und verbinden Sie ihn mit dem **Yes**-Ausgang des Conditions-Blocks. Füllen Sie aus:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: Wählen Sie den gewünschten OneUptime-Vorfallsschweregrad (Sie können dies später mit weiteren Conditions-Zweigen verfeinern, die Zabbix-Schweregrade abbilden).
5. Speichern. Lassen Sie **Enabled** vorerst *aus* – Sie aktivieren es nach einem Test.

> **Tipp:** Wenn Sie die Zabbix-`event_id` in die Beschreibung (oder ein Vorfall-Label) einfügen, können Sie diesen Vorfall später wiederfinden, wenn Sie ihn bei einer Wiederherstellung automatisch auflösen möchten. Siehe [Automatisch auflösen](#automatisch-auflösen-optional).

## Teil 2 — Zabbix konfigurieren

### Schritt 1: Den OneUptime-Medientyp erstellen

1. Gehen Sie in Zabbix zu **Alerts → Media types** (in älteren Versionen: **Administration → Media types**).
2. Klicken Sie auf **Create media type** und setzen Sie **Type** auf **Webhook**.
3. **Name**: `OneUptime`.
4. Fügen Sie diese **Parameter** hinzu (klicken Sie für jeden auf *Add*). Diese bilden Zabbix-[Makros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) in eine übersichtliche Payload um:

   | Name | Wert |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Fügen Sie Folgendes in das **Script**-Feld ein:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Klicken Sie auf den Tab **Message templates** und fügen Sie eine Vorlage für **Problem** und **Problem recovery** hinzu (der Body kann leer sein – die Payload wird im Skript aufgebaut). Dies ist erforderlich, damit Zabbix den Medientyp für diese Ereignistypen verwendet.
7. Klicken Sie auf **Add**, um den Medientyp zu speichern.

### Schritt 2: Einen Benutzer für den Webhook anlegen

Zabbix sendet Benachrichtigungen *an einen Benutzer*. Erstellen Sie einen dedizierten Benutzer, damit die Integration leicht auffindbar und deaktivierbar ist.

1. Gehen Sie zu **Users → Users → Create user**. Benennen Sie ihn `OneUptime Webhook`, geben Sie ihm eine Rolle, die Benachrichtigungen empfangen darf (z. B. **User role**), und fügen Sie ihn einer Benutzergruppe hinzu.
2. Klicken Sie im Tab **Media** auf **Add**:
   - **Type**: `OneUptime`
   - **Send to**: Fügen Sie die **Workflow-Webhook-URL** ein, die Sie in Teil 1 kopiert haben.
   - **When active** / Schweregrade: Lassen Sie die Standardwerte (oder schränken Sie auf die gewünschten Schweregrade ein).
3. Klicken Sie auf **Add** und **Update**.

### Schritt 3: Probleme mit einer Aktion an OneUptime senden

1. Gehen Sie zu **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (optional): Schränken Sie ein – zum Beispiel *Trigger severity >= Warning*. Lassen Sie es leer, um alles zu senden.
4. Fügen Sie im Tab **Operations** eine Operation hinzu, die an **User: OneUptime Webhook** über den **OneUptime**-Medientyp sendet.
5. Um Vorfälle bei einer Wiederherstellung später aufzulösen, füllen Sie auch die **Recovery operations** mit demselben Benutzer/Medientyp aus.
6. Klicken Sie auf **Add** zum Speichern und stellen Sie sicher, dass die Aktion **Enabled** ist.

## Teil 3 — Testen

1. Aktivieren Sie im OneUptime-Workflow den Schalter **Enabled**.
2. Lösen Sie in Zabbix ein Testproblem aus – zum Beispiel durch vorübergehendes Absenken eines Trigger-Schwellenwerts oder ein Testelement, das in den Problem-Zustand kippt.
3. Öffnen Sie den Tab **Logs** Ihres Workflows. Sie sollten einen Lauf mit der Zabbix-Payload sehen, den Conditions-Block, der den **Yes**-Pfad nimmt, und den erstellten Vorfall.
4. Prüfen Sie **Incidents** in OneUptime – Ihr Zabbix-Problem ist nun ein Vorfall.

Falls nichts eintrifft, lesen Sie [Fehlerbehebung](#fehlerbehebung).

## Automatisch auflösen (optional)

Der obige Kern-Workflow *öffnet* Vorfälle. Um sie auch zu *schließen*, wenn Zabbix sich erholt:

1. Stellen Sie sicher, dass Ihre Zabbix-Aktion **Recovery operations** konfiguriert hat (Schritt 3 oben), damit auch Wiederherstellungsereignisse gesendet werden. Bei Wiederherstellung kommt `status` als `0` an.
2. Fügen Sie im Workflow einen zweiten **Conditions**-Zweig hinzu: links `{{Zabbix.Request Body.status}}`, Operator `==`, rechts `0`.
3. Fügen Sie an dessen **Yes**-Ausgang einen **Find Incident**-Block hinzu, der den zuvor erstellten offenen Vorfall sucht – gleichen Sie auf der Zabbix-`event_id` ab, die Sie in der Beschreibung oder einem Label gespeichert haben.
4. Verbinden Sie diesen mit einem **Update Incident**-Block und bewegen Sie den Vorfall in Ihren *aufgelösten* Zustand.

Da die Auflösung davon abhängt, wie Sie Vorfallszustände in Ihrem Projekt modellieren, halten Sie den **Erstell**-Pfad als zuverlässigen Kern und ergänzen Sie den Auflöse-Pfad, sobald Sie bestätigt haben, dass die Ereignisse korrekt fließen. Siehe [Komponenten → OneUptime-Datenkomponenten](/docs/workflows/components#oneuptime-data-components).

## Zabbix-Schweregrade abbilden (optional)

Zabbix-Schweregrade (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) kommen als `{{Zabbix.Request Body.severity}}` an. Um sie auf OneUptime-Vorfallsschweregrade abzubilden, fügen Sie **Conditions**-Zweige vor **Create Incident** hinzu – leiten Sie beispielsweise `Disaster` und `High` zu einem „Kritisch"-Vorfall und alles andere zu „Schwerwiegend". Bauen Sie für jeden Zweig einen eigenen **Create Incident**-Block.

## Fehlerbehebung

**Der Workflow läuft nie.**
- Vergewissern Sie sich, dass der **Enabled**-Schalter des Workflows aktiviert ist.
- Überprüfen Sie vom Zabbix-Server aus, ob er die URL erreichen kann: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Sie sollten eine schnelle Bestätigung erhalten.
- Prüfen Sie **Reports → Action log** in Zabbix auf Zustellfehler.

**Zabbix meldet einen Skriptfehler.**
- Öffnen Sie den Medientyp und verwenden Sie **Test**, um eine Beispiel-Payload zu senden. Zabbix zeigt die Ausgabe des Skripts oder den ausgelösten Fehler.
- Eine Nicht-2xx-Antwort von OneUptime wird durch den `throw` im Skript angezeigt – überprüfen Sie, ob die Workflow-URL exakt korrekt ist.

**Der Vorfall wird erstellt, aber Felder sind leer.**
- Öffnen Sie den Tab **Logs** des Workflows und prüfen Sie die Trigger-Ausgabe. Bestätigen Sie, dass die Feldnamen unter **Request Body** mit den referenzierten übereinstimmen (`name`, `host`, `severity`, `status`, `event_id`).
- Ein fehlendes Feld ergibt eine leere Zeichenkette statt eines Fehlers – siehe [Variablen → Fallstricke](/docs/workflows/variables#gotchas).

**Alles wird zweimal ausgelöst.**
- Sie haben wahrscheinlich sowohl einen Problem-Vorgang als auch einen Eskalationsschritt, der an dasselbe Medium sendet. Prüfen Sie die **Operations**-Schritte der Aktion.

## Sicherheitshinweise

- Behandeln Sie die Workflow-Webhook-URL wie ein Passwort. Falls sie durchsickert, löschen Sie den Auslöser und erstellen Sie einen neuen, um die URL zu rotieren.
- Schränken Sie die Bedingungen der Zabbix-Aktion ein, sodass Sie nur die Schweregrade weiterleiten, die einen Vorfall rechtfertigen.
- Wenn Sie OneUptime selbst hinter einer Firewall betreiben, erlauben Sie der Ausgangs-IP Ihres Zabbix-Servers, ihn über HTTPS zu erreichen.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — die eingehenden/ausgehenden Muster.
- [Webhook-Auslöser](/docs/workflows/triggers#webhook) — wie die empfangende URL funktioniert.
- [Komponenten](/docs/workflows/components) — Conditions, Create Incident und mehr.
- [Variablen](/docs/workflows/variables) — die Zabbix-Payload in späteren Blöcken lesen.
