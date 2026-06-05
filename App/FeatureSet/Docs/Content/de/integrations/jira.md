# Jira-Integration

Öffnen Sie automatisch ein [Jira](https://www.atlassian.com/software/jira)-Issue, sobald ein OneUptime-Vorfall erstellt wird – damit die technische Arbeit dort nachverfolgt wird, wo Ihre Entwickler bereits arbeiten, mit einem Link zurück zum Vorfall.

Diese Integration ist **ausgehend**: OneUptime ruft die REST-API von Jira auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**. Optional können Sie einen **eingehenden** Pfad hinzufügen, sodass das Schließen des Jira-Issues den OneUptime-Vorfall auflöst.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Voraussetzungen

- Eine Jira-Cloud-Site (`https://your-domain.atlassian.net`) und ein Projekt, in dem Issues angelegt werden sollen – notieren Sie sich den **Projektschlüssel** (z. B. `OPS`).
- Ein Jira-Konto, das Issues erstellen kann, sowie ein **API-Token** dafür von [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

> Verwenden Sie **Jira Data Center / Server** (selbstverwaltet)? Der Ablauf ist identisch – verwenden Sie Ihre eigene Basis-URL und ein [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) mit einem `Bearer`-Auth-Header statt Basic-Auth. Der Endpunkt `/rest/api/2/issue` akzeptiert eine Klartextbeschreibung, was die Vorlagengestaltung einfacher macht.

## Schritt 1 — Jira-Zugangsdaten als Geheimnis speichern

Jira Cloud verwendet **Basic-Auth** mit Ihrer E-Mail und Ihrem API-Token, Base64-kodiert.

1. Kodieren Sie `email:api_token` einmal mit Base64. Unter macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. Gehen Sie in OneUptime zu **Workflows → Global Variables → Create**.
3. Benennen Sie die Variable `JIRA_AUTH`, fügen Sie die Base64-Zeichenkette als Wert ein und aktivieren Sie **Is Secret**.

Jetzt können Sie `Basic {{variable.JIRA_AUTH}}` als Auth-Header verwenden, und der Token erscheint nie im Workflow oder dessen Logs.

## Schritt 2 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → Jira`, und öffnen Sie den **Builder**.
2. Ziehen Sie einen **Incident**-Auslöser auf die Arbeitsfläche und wählen Sie das Ereignis **On Create**. Benennen Sie ihn in `Incident` um.
3. Ziehen Sie einen **API**-Block und verbinden Sie den Auslöser damit. Konfigurieren Sie:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 verwendet das Atlassian Document Format für die Beschreibung):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Ersetzen Sie `OPS` durch Ihren Projektschlüssel und `Bug` durch einen Issue-Typ, der in diesem Projekt existiert.
4. **Speichern.** Lassen Sie den Workflow deaktiviert, bis Sie ihn getestet haben.

## Schritt 3 — Testen

1. Aktivieren Sie den Workflow mit **Enabled**.
2. Erstellen Sie einen Test-Vorfall in OneUptime (oder lösen Sie einen aus einem Monitor heraus aus).
3. Öffnen Sie den Tab **Logs** des Workflows. Der **API**-Block sollte einen `201`-Status und einen Response-Body anzeigen, der den `key` des neuen Issues enthält (zum Beispiel `OPS-1234`).
4. Prüfen Sie Jira – das Issue ist vorhanden.

Wenn der API-Block einen Fehler zurückgibt, klappen Sie ihn in den Logs auf – die Antwort von Jira erklärt genau, welches Feld abgelehnt wurde. Siehe [Fehlerbehebung](#fehlerbehebung).

## Schritt 4 — Den Vorfall mit dem Issue verknüpfen (empfohlen)

Es ist nützlich, den Jira-Issue-Key am Vorfall zu speichern, damit Personen leicht zwischen beiden wechseln können.

- Die Antwort des API-Blocks ist als `{{CreateIssue.response-body.key}}` verfügbar (wenn Sie den Block `CreateIssue` benannt haben).
- Fügen Sie danach einen **Update Incident**-Block hinzu und schreiben Sie den Key in ein Label, ein benutzerdefiniertes Feld oder eine Notiz am Vorfall.

Dies ermöglicht auch die unten beschriebene optionale bidirektionale Synchronisierung.

## Bidirektionale Synchronisierung (optional)

Um den OneUptime-Vorfall aufzulösen, wenn jemand das Jira-Issue schließt, fügen Sie einen **eingehenden** Workflow hinzu:

1. Erstellen Sie einen zweiten Workflow, der mit einem **Webhook**-Auslöser beginnt, und kopieren Sie dessen URL.
2. Gehen Sie in Jira zu **Project settings → Automation → Create rule**:
   - **Trigger**: *Issue transitioned* zu **Done** (oder *Issue resolved*).
   - **Action**: *Send web request* → Methode `POST`, URL = Ihre Workflow-Webhook-URL, Body enthält den Issue-Key und die OneUptime-Vorfall-ID, z. B.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. Verwenden Sie im Workflow einen **Find Incident**-Block, um den Vorfall anhand des gespeicherten Keys zu finden, dann einen **Update Incident**-Block, um ihn in Ihren aufgelösten Zustand zu bewegen.

Wenn Sie den Jira-Key in Schritt 4 am Vorfall gespeichert haben, ist die Zuordnung unkompliziert. Siehe [Komponenten → OneUptime-Datenkomponenten](/docs/workflows/components#oneuptime-data-components).

## Das Issue anpassen

Einige häufige Anpassungen am Body des API-Blocks:

- **Priorität** — fügen Sie `"priority": { "name": "High" }` in `fields` ein. Sie können auf `{{Incident.incidentSeverity.name}}` mit **Conditions** verzweigen, um OneUptime-Schweregrade auf Jira-Prioritäten abzubilden.
- **Labels** — fügen Sie `"labels": ["oneuptime", "incident"]` hinzu.
- **Verantwortlicher** — fügen Sie `"assignee": { "id": "<accountId>" }` hinzu (Jira Cloud verwendet Account-IDs, keine Benutzernamen).
- **Benutzerdefinierte Felder** — fügen Sie `"customfield_XXXXX": "..."` mit der Feld-ID aus Ihrer Jira-Administration hinzu.

Um die genauen Feldnamen zu ermitteln, die ein Projekt erwartet, rufen Sie den Endpunkt `GET /rest/api/3/issue/createmeta` von Jira einmal über Ihren Browser oder `curl` auf.

## Fehlerbehebung

**`401 Unauthorized`.**
- Kodieren Sie `email:api_token` erneut und aktualisieren Sie die Variable `JIRA_AUTH`. Ein abschließender Zeilenumbruch ist der häufigste Grund – verwenden Sie beim Kodieren `printf` (nicht `echo`).
- Überprüfen Sie, ob das Konto, dem der API-Token gehört, Issues im Projekt erstellen darf.

**`400 Bad Request` mit Erwähnung eines Felds.**
- Der Issue-Typ oder ein Pflichtfeld ist falsch. Prüfen Sie den Namen des **Issue-Typs** im Projekt und ob es erforderliche benutzerdefinierte Felder hat. Verwenden Sie `createmeta` (oben), um zu sehen, was Pflicht ist.

**`404 Not Found`.**
- Überprüfen Sie die Basis-URL und stellen Sie sicher, dass Sie `/rest/api/3/issue` (Cloud) oder `/rest/api/2/issue` (Server/Data Center) aufrufen.

**Die Beschreibung erscheint als einzelne Zeile / sieht merkwürdig aus.**
- v3 erfordert das oben gezeigte Atlassian Document Format. Wenn Sie lieber Klartext senden möchten, verwenden Sie den Endpunkt `/rest/api/2/issue` mit `"description": "{{Incident.description}}"` als einfache Zeichenkette.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — die eingehenden/ausgehenden Muster und der Authentifizierungs-Spickzettel.
- [API-Komponente](/docs/workflows/components#api) — Methoden, Header und das Lesen der Antwort.
- [Variablen](/docs/workflows/variables) — Geheimnisse und Vorfallsfelder.
- [PagerDuty](/docs/integrations/pagerduty) und [ServiceNow](/docs/integrations/servicenow) — dasselbe ausgehende Muster für andere Tools.
