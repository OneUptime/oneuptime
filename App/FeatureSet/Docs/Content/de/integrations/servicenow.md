# ServiceNow-Integration

Öffnen Sie automatisch einen [ServiceNow](https://www.servicenow.com)-Vorfall, sobald ein OneUptime-Vorfall erstellt wird – damit ITSM und Monitoring stets synchron bleiben.

Diese Integration ist **ausgehend**: OneUptime ruft die ServiceNow-[Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Voraussetzungen

- Eine ServiceNow-Instanz (`https://your-instance.service-now.com`).
- Ein ServiceNow-Benutzer mit den Rollen `rest_api_explorer` / `itil` (oder ausreichenden Rechten zum Erstellen von `incident`-Datensätzen). Basic-Auth mit den Zugangsdaten dieses Benutzers ist der einfachste Einstieg; für die Produktion wird OAuth empfohlen.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Zugangsdaten als Geheimnis speichern

Die Table API von ServiceNow akzeptiert **Basic-Auth**.

1. Kodieren Sie `username:password` einmal mit Base64:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. Gehen Sie in OneUptime zu **Workflows → Global Variables → Create**, benennen Sie die Variable `SERVICENOW_AUTH`, fügen Sie die Base64-Zeichenkette ein und aktivieren Sie **Is Secret**.

## Schritt 2 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → ServiceNow`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie einen **API**-Block verbunden mit dem Auslöser hinzu:

   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` erhält einen Rückverweis auf den OneUptime-Vorfall – praktisch, wenn Sie später einen Auflöse-Schritt hinzufügen. ServiceNow `urgency`/`impact` verwenden `1` (hoch), `2` (mittel), `3` (niedrig).

4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Eine `201 Created`-Antwort in den Workflow-Logs gibt die `sys_id` und `number` des neuen Datensatzes zurück (zum Beispiel `INC0012345`).

## Schritt 3 — Bei OneUptime-Auflösung auflösen (optional)

1. Erstellen Sie einen **zweiten** Workflow mit einem **Incident → On Update**-Auslöser und einem **Conditions**-Block, der prüft, ob der Vorfall aufgelöst ist.
2. Um den richtigen ServiceNow-Datensatz zu aktualisieren, benötigen Sie seine `sys_id`. Entweder speichern Sie diese am OneUptime-Vorfall in Schritt 2 (lesen Sie `{{CreateRecord.response-body.result.sys_id}}` und schreiben Sie sie mit **Update Incident** in ein Label), oder suchen Sie den Datensatz zuerst mit einem `GET` auf `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Fügen Sie einen **API**-Block hinzu: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, Body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Aufgelöst im Standard-ITIL-Workflow).

## Fehlerbehebung

- **`401`** — kodieren Sie `username:password` erneut mit `printf` (nicht `echo`, das einen Zeilenumbruch hinzufügt) und aktualisieren Sie `SERVICENOW_AUTH`.
- **`403`** — der Benutzer hat keine Rechte zum Schreiben der `incident`-Tabelle; fügen Sie die Rolle `itil` hinzu.
- **`400`** — ein Feldname oder -wert ist für die Anpassungen Ihrer Instanz falsch. Prüfen Sie Feldnamen unter **System Definition → Tables → incident**.
- **Die Instanz lehnt den Aufruf ab** — einige Instanzen schränken die Table API ein; bestätigen Sie, dass REST aktiviert ist und Ihre IP nicht durch eine ACL blockiert wird.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — Muster und der Authentifizierungs-Spickzettel.
- [Jira](/docs/integrations/jira) — dasselbe ausgehende Muster für Jira.
- [API-Komponente](/docs/workflows/components#api) — den Response-Body lesen.
