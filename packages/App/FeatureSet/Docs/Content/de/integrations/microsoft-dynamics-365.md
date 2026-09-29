# Microsoft-Dynamics-365-Integration

Öffnen Sie einen **Case** in [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365), sobald ein OneUptime-Vorfall erklärt wird, halten Sie diesen Case im Gleichschritt, während sich der Vorfall bewegt, und lassen Sie Dynamics Case-Änderungen zurück nach OneUptime schieben – alles mit einem [Workflow](/docs/workflows/index). Es gibt keinen Dynamics-spezifischen Baustein zu installieren: OneUptime spricht über die [API-Komponente](/docs/workflows/components#api) mit der **Dataverse Web API**, und Dynamics spricht über einen [Webhook-Trigger](/docs/workflows/triggers#webhook) zurück.

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Diese Seite deckt beide Richtungen ab. Bauen Sie die ausgehende Hälfte zuerst – sie ist diejenige, die die Einrichtung in Microsoft Entra ID braucht, und sobald sie läuft, ist die eingehende Hälfte ein einzelner Flow.

## Voraussetzungen

- Eine **Dynamics 365**-Umgebung, die die Tabelle **Case** enthält. Cases stammen aus Dynamics 365 Customer Service; eine Dataverse-Umgebung ohne dieses Modul hat keine `incident`-Tabelle, in die geschrieben werden könnte.
- Den **Web API endpoint** der Umgebung. Sie finden ihn im [Power Platform admin center](https://admin.powerplatform.microsoft.com/) unter **Settings → Developer resources** Ihrer Umgebung, oder in **make.powerapps.com → Settings → Developer resources**. Er sieht aus wie `https://yourorg.crm.dynamics.com/api/data/v9.2/` – das Regionssegment variiert (`crm` für Nordamerika, `crm2` für Südamerika, `crm7` für Japan und so weiter).
- Die Rechte, eine Anwendung in **Microsoft Entra ID** zu registrieren und einen **application user** (Anwendungsbenutzer) in der Dynamics-Umgebung anzulegen. Das sind in der Regel zwei verschiedene Administratoren.
- Ein OneUptime-Projekt, in dem Sie Workflows und globale Variablen erstellen können.

> Alles unten verwendet die Dataverse-Tabellennamen, nicht die Beschriftungen auf den Dynamics-Formularen. Ein Case ist die Tabelle **`incident`**, ihre Collection in einer URL ist **`incidents`**, ihr Primärschlüssel ist **`incidentid`**, und ihre Titelspalte ist **`title`**. Die Case-Nummer, die Sie in der Oberfläche sehen, ist **`ticketnumber`**.

## Schritt 1 — Eine Anwendung in Microsoft Entra ID registrieren

OneUptime authentifiziert sich als Anwendung, nicht als Person, und verwendet deshalb den OAuth-2.0-Flow **client credentials**.

1. Melden Sie sich am [Azure portal](https://portal.azure.com) als Administrator desselben Tenants an, in dem Ihre Dynamics-Umgebung liegt, und öffnen Sie **Microsoft Entra ID**.
2. Gehen Sie zu **App registrations → New registration**. Geben Sie ihr einen Namen wie `OneUptime Integration`, belassen Sie **Supported account types** auf **Accounts in this organizational directory only**, und wählen Sie **Register**.
3. Kopieren Sie auf der Seite **Overview** der App die **Application (client) ID** und die **Directory (tenant) ID**.
4. Gehen Sie zu **Certificates & secrets → Client secrets → New client secret**. Kopieren Sie den **Value** des Secrets – nicht dessen ID –, bevor Sie die Seite verlassen. Er wird nie wieder angezeigt. Ein Client Secret kann höchstens 24 Monate leben, notieren Sie das Ablaufdatum also dort, wo Sie es sehen werden.

Zwei Dinge, die hier gerne ergänzt werden und die Sie nicht brauchen:

- **Keine API permissions.** Im Flow client credentials gibt es keinen angemeldeten Benutzer, delegierte Berechtigungen bewirken also nichts. `user_impersonation` unter **Dataverse** ist eine delegierte Berechtigung und nur für interaktive Apps gedacht. Microsoft Entra ID stellt bereitwillig ein Token für Dataverse aus, auch ganz ohne konfigurierte Berechtigungen – über den Zugriff wird auf der Dynamics-Seite entschieden, in Schritt 2.
- **Kein Schritt admin consent.** Aus demselben Grund.

Microsoft bevorzugt für Produktivanwendungen ein Zertifikat gegenüber einem Client Secret. Diese Variante verlangt, dass der Aufrufer selbst ein JWT-Assertion baut und signiert, was ein Workflow nicht kann – ein Client Secret ist hier also die praktikable Wahl. Behandeln Sie es entsprechend: Bewahren Sie es in einer geheimen Variable auf und rotieren Sie es, bevor es abläuft.

## Schritt 2 — Den Anwendungsbenutzer in Dynamics anlegen

Das ist der Schritt, der übersprungen wird, und ihn zu überspringen erzeugt den verwirrendsten Fehler dieser ganzen Integration: Die Token-Anfrage gelingt, und jeder Dataverse-Aufruf scheitert danach mit `403 Forbidden` und dem Fehlercode `0x80072560` – *„The user isn't a member of the organization.“* Entra ID stellt das Token aus, ohne irgendetwas über Dynamics zu wissen; Dynamics sucht dann eine Benutzerzeile, die zur Anwendung passt, und findet keine.

1. Öffnen Sie das [Power Platform admin center](https://admin.powerplatform.microsoft.com/) und wählen Sie **Manage → Environments**, dann Ihre Umgebung.
2. Wählen Sie **Settings → Users + permissions → Application users**.
3. Wählen Sie **+ New app user**, dann **+ Add an app**, wählen Sie die Registrierung aus Schritt 1 und wählen Sie **Add**.
4. Wählen Sie eine **Business unit**, tragen Sie eine **Email address** ein, und nutzen Sie dann das Bearbeiten-Symbol neben **Security roles**.
5. Weisen Sie eine **benutzerdefinierte** Sicherheitsrolle mit den Rechten Erstellen, Lesen und Schreiben auf der Tabelle **Case** zu. Einem Anwendungsbenutzer kann keine der eingebauten Rollen gegeben werden – Microsoft verlangt eine benutzerdefinierte. Wenn Sie keine passende Rolle haben, kopieren Sie eine bestehende und kürzen sie zurecht.
6. Wählen Sie **Save**, dann **Create**.

Pro registrierter Anwendung kann es in einer Umgebung nur einen Anwendungsbenutzer geben. Anwendungsbenutzer sind nicht lizenziert und von den Regeln zur Sicherheitsgruppen-Mitgliedschaft der Umgebung ausgenommen.

## Schritt 3 — Die Zugangsdaten in OneUptime speichern

Gehen Sie zu **Arbeitsabläufe → Globale Variablen → Erstellen** und legen Sie diese an, wobei Sie **Geheimnis** für die entsprechend markierten aktivieren:

| Name                     | Wert                                                        | Geheimnis |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | Die Directory (tenant) ID aus Schritt 1                     | Nein   |
| `DYNAMICS_CLIENT_ID`     | Die Application (client) ID aus Schritt 1                   | Nein   |
| `DYNAMICS_CLIENT_SECRET` | Der **Value** des Client Secrets aus Schritt 1              | Ja     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` – kein abschließender Schrägstrich | Nein   |

Fügen Sie das Client Secret genau so ein, wie Entra ID es Ihnen gegeben hat. OneUptime kodiert den Formular-Body für Sie, URL-kodieren Sie ihn also nicht von Hand.

Referenzieren Sie jede davon aus einem Baustein mit `{{global.variables.DYNAMICS_CLIENT_ID}}`. Unter [Variablen](/docs/workflows/variables) steht, wie Geheimnisse aus den Ausführungsprotokollen entfernt werden.

## Schritt 4 — Ein Access Token holen

Jede Ausführung holt ihr eigenes Token. Token halten 60–90 Minuten, und der Flow client credentials stellt nie ein Refresh Token aus, es gibt also nichts zwischenzuspeichern und nichts zu erneuern – ein zusätzlicher HTTP-Aufruf pro Ausführung ist der gesamte Aufwand.

1. Öffnen Sie **Arbeitsabläufe → Workflow erstellen**, benennen Sie ihn `Incidents → Dynamics 365`, und öffnen Sie den **Builder**.
2. Klicken Sie auf den gestrichelten Platzhalter, fügen Sie den Trigger **On Create Incident** hinzu und fordern Sie in dessen **Select Fields** die Spalten an, die Sie senden möchten:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Belassen Sie den **Identifier** bei `incident-on-create-1`.

3. Klicken Sie auf **Komponente hinzufügen**, fügen Sie einen Baustein **API Post (JSON)** hinzu, verbinden Sie den Punkt **Erfolg** des Triggers damit und öffnen Sie seine Einstellungen. Setzen Sie seinen **Identifier** auf `get-token`, dann:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Tippen Sie den Header-Namen als `Content-Type`, mit genau dieser Groß- und Kleinschreibung.** Er ist es, der OneUptime anweist, den Body als Formular-Post statt als JSON zu senden, und das ist die einzige Form, die der Token-Endpunkt von Microsoft akzeptiert. `content-type` in Kleinbuchstaben passt nicht, die Anfrage geht als JSON hinaus und kommt mit `400` zurück.

Der `scope` muss Ihre Umgebungs-URL gefolgt von `/.default` sein – das ist die Form für vertrauliche Clients. Eine falsche Umgebungs-URL hier ist die übliche Ursache für `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Das Token steht nun nachgelagert zur Verfügung als:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Schritt 5 — Den Case anlegen

Fügen Sie einen zweiten Baustein **API Post (JSON)** hinzu, verbinden Sie den Punkt **Erfolg** von `get-token` damit und setzen Sie seinen **Identifier** auf `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Ersetzen Sie die Account-GUID durch den Account, zu dem diese Cases gehören. **`customerid` ist an einem Case tatsächlich Pflicht** – es ist eine der Spalten, die Dataverse bei jedem programmatischen Schreibvorgang erzwingt, ein Anlegen ohne sie wird also abgelehnt. Weil sie entweder auf einen Account oder auf einen Kontakt zeigen kann, schreiben Sie nie `customerid@odata.bind`; Sie schreiben `customerid_account@odata.bind` oder `customerid_contact@odata.bind`, und bei diesen Namen zählt die Groß- und Kleinschreibung. `title` ist auf andere Weise Pflicht: Die Dynamics-Formulare bestehen darauf, die API nicht – senden Sie es trotzdem.

`Prefer: return=representation` ist das, was den Aufruf aus einem Workflow heraus brauchbar macht. Ohne diesen Header antwortet ein erfolgreiches Anlegen mit `204 No Content` und legt die URI des neuen Datensatzes in einen `OData-EntityId`-Antwortheader, aus dem Sie dann eine GUID herauspicken müssten. Mit ihm ist die Antwort `201 Created` und trägt den Datensatz selbst, sodass der nächste Baustein lesen kann:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Schalten Sie den Workflow nun ein – **Übersicht → Workflow bearbeiten → Aktiviert** –, erklären Sie einen Test-Vorfall und lesen Sie die Ausführung unter **Ausführungen & Protokolle**. Der Baustein `create-case` sollte einen `201` zeigen und einen Body, der die neue `incidentid` enthält. Änderungen auf der Arbeitsfläche speichern sich selbst; es gibt keinen Speichern-Knopf.

### Schweregrad und Status zuordnen

Dynamics liefert `severitycode` mit einer einzigen Option aus, „Default Value“, es gibt also keine ab Werk vorhandene Schweregradskala, auf die man abbilden könnte. Nehmen Sie stattdessen **`prioritycode`**, und verzweigen Sie mit einem Baustein **If / Else** auf `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`, wenn Sie Prioritäten je Schweregrad möchten.

| Spalte           | Werte                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` ist anpassbar, ein Tenant kann also eigene Werte ergänzt haben. Senden Sie Ganzzahlen, keine Beschriftungen.

## Schritt 6 — Vorfall und Case füreinander auffindbar halten

Was Sie später auch tun – kommentieren, auflösen, zurücksynchronisieren –, es braucht eines der beiden Systeme, das die Kennung des anderen hält. Legen Sie sie auf die Dynamics-Seite.

Fügen Sie der Tabelle Case eine Spalte vom Typ **single line of text** hinzu, zum Beispiel `new_oneuptimeincidentid`, und setzen Sie sie beim Anlegen des Case:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Jeder spätere Workflow kann den Case dann mit einem Filter finden:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Wenn Sie diese Spalte als **alternate key** auf der Tabelle Case definieren, können Sie die Suche ganz überspringen und direkt an `incidents(new_oneuptimeincidentid='<id>')` ein `PATCH` schicken – ein Upsert, der den Case anlegt, wenn es ihn nicht gibt, und ihn aktualisiert, wenn es ihn gibt. Der Schlüssel muss fertig aufgebaut sein (sein Zustand wird **Active**), bevor er verwendet werden kann, und Werte alternativer Schlüssel dürfen `/ < > * % & : \ ? + #` nicht enthalten. Eine OneUptime-ID ist eine einfache UUID, also unbedenklich.

Die umgekehrte Richtung – die Dynamics-Case-ID am OneUptime-Vorfall zu speichern – funktioniert ebenfalls, mit einem Baustein **Update One Incident**, der in `customFields` schreibt. Seien Sie damit vorsichtig: `customFields` ist eine einzige JSON-Spalte, sie zu schreiben ersetzt also jeden Wert eines benutzerdefinierten Feldes an diesem Vorfall, nicht nur Ihren. Die Verknüpfung auf der Dynamics-Seite zu halten vermeidet das vollständig.

## Schritt 7 — Den Case auflösen, wenn der Vorfall aufgelöst wird

Bauen Sie das als **zweiten** Workflow, damit ein Fehler hier das Öffnen von Cases nicht verhindern kann.

1. **Workflow erstellen**, benennen Sie ihn `Incident resolved → Close Dynamics case`, und fügen Sie den Trigger **On Update Incident** hinzu.
2. Tragen Sie in **Listen on** des Triggers `{"currentIncidentStateId": true}` ein, damit der Workflow nur bei Zustandsänderungen aufwacht statt bei jeder Bearbeitung. Fordern Sie in **Select Fields** `{"_id": true, "currentIncidentState": {"name": true}}` an.
3. Fügen Sie einen Baustein **If / Else** hinzu. **Input 1** ist `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** ist `==`, **Input 2** ist `Resolved` – oder wie auch immer der aufgelöste Zustand in Ihrem Projekt heißt. Siehe [Vorfallszustände & Schweregrade](/docs/incidents/states-and-severities).
4. Wiederholen Sie vom Zweig **Ja** aus den Baustein `get-token` aus Schritt 4.
5. Fügen Sie einen Baustein **API Get (JSON)** hinzu, setzen Sie seinen **Identifier** auf `find-case` und geben Sie ihm die `$filter`-URL aus Schritt 6. Eine Dataverse-Abfrage antwortet mit einem `value`-Array, und eine Workflow-Referenz kann mit Klammern in ein Array hineingreifen, die Case-ID ist also `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Fügen Sie einen Baustein **API Post (JSON)** hinzu, der den Case schließt:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: dieselben wie in Schritt 5, ohne `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` ist ein `statuscode`-Wert im Zustand Resolved – `5` ist *Problem Solved*.

     **Testen Sie diesen Body gegen Ihre eigene Umgebung, bevor Sie sich darauf verlassen.** `CloseIncident` nimmt zwei Parameter entgegen, `IncidentResolution` und `Status`, aber Microsoft veröffentlicht dafür kein HTTP-Beispiel – jedes offizielle Beispiel ist C#. Die Form oben ist die übliche Übersetzung. Wenn Ihre Umgebung sie ablehnt, versuchen Sie, den Case mit einer einfachen Eigenschaft `"incidentid": "<the case id>"` zu identifizieren statt mit der Form `@odata.bind`, denn so referenzieren Microsofts andere Action-Beispiele einen bestehenden Datensatz.

**Warum nicht einfach den Case per `PATCH` auf `statecode: 1` setzen?** Können Sie – Microsoft dokumentiert ein `PATCH` von `statecode` und `statuscode` als Web-API-Entsprechung der älteren SetState-Nachricht, und es ist das richtige Werkzeug, um einen Case zwischen aktiven Status zu bewegen. Was es nicht tut, ist die Aktivität **Case Resolution** anzulegen, die ein aufgelöster Case in Dynamics 365 Customer Service haben sollte, und es wird in einer Umgebung, in der ein Administrator eigene Statusübergänge konfiguriert hat, rundheraus abgelehnt. Nehmen Sie `CloseIncident` zum Auflösen; nehmen Sie `PATCH` für alles andere. Und wann immer Sie `statecode` schreiben, setzen Sie `statuscode` in derselben Anfrage – sonst wendet Dynamics stillschweigend den Standardstatus dieses Zustands an.

`CloseIncident` stammt aus Dynamics 365 Customer Service und nicht aus dem Dataverse-Kern, und es ist in der Dataverse-Action-Referenz nicht aufgeführt. Wenn es `404` zurückgibt, bestätigen Sie seine Existenz in Ihrer Umgebung, indem Sie `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` abrufen und nach `CloseIncident` suchen.

Für alles unterhalb des Schließens eines Case – eine Notiz, eine Prioritätsanhebung, eine Titeländerung – nehmen Sie einen Baustein **API Patch (JSON)** gegen `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` mit einem Header `If-Match: *`, der verhindert, dass ein versehentlicher Upsert einen neuen Case anlegt. Senden Sie nur die Spalten, die Sie ändern.

## Eingehend — Dynamics 365 nach OneUptime

Nun die andere Richtung: Jemand schließt den Case in Dynamics, oder ein Agent fügt eine Notiz hinzu, und OneUptime soll davon erfahren.

### Zuerst den empfangenden Workflow bauen

1. **Workflow erstellen**, benennen Sie ihn `Dynamics 365 → OneUptime`, und fügen Sie den Trigger **Webhook** hinzu.
2. Öffnen Sie die **Einstellungen** dieses Workflows und kopieren Sie den **geheimen Webhook-Schlüssel**. Ihre URL lautet:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Bei einer selbst gehosteten Installation setzen Sie Ihren eigenen Host ein. Behandeln Sie die URL wie ein Passwort – wer sie hat, kann den Workflow starten. Den Schlüssel können Sie auf derselben Seite zurücksetzen.

3. Fügen Sie einen Baustein **If / Else** hinzu, der ein gemeinsames Geheimnis prüft, bevor irgendetwas anderes passiert. **Input 1** ist `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` – ein Wert, den Sie sich ausdenken und als geheime globale Variable speichern.
4. Fügen Sie vom Zweig **Ja** aus einen Baustein **Update One Incident** hinzu:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: was auch immer die Case-Änderung in OneUptime bedeuten soll – eine Zustandsänderung, eine Notiz, eine Beschriftung.

   Um den Vorfall in einen Zustand zu bewegen, brauchen Sie dessen ID: Ein Baustein **Find One Incident State** mit der Query `{"name": "Resolved"}` liefert Ihnen `{{local.components.incident-state-find-one-1.returnValues.model._id}}`, das Sie in `currentIncidentStateId` schreiben.

Lassen Sie ihn aktiviert und bereit. Geben Sie Dynamics nun etwas zum Aufrufen.

### Option A — ein Power-Automate-Flow (empfohlen)

Das ist der Weg, den die meisten Teams nehmen sollten: Sie bestimmen die Payload, und es ist nichts zu installieren.

1. Erstellen Sie in [Power Automate](https://make.powerautomate.com) einen **Automated cloud flow**.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` – alles Engere feuert nur für Zeilen, die Ihnen oder Ihrer Business Unit gehören.
   - **Select columns**: `statecode,statuscode`. Das ist ein Filter, der nur für Update gilt, und es lohnt sich, ihn richtig zu setzen. Lookup-Spalten werden hier nicht unterstützt, und führen Sie niemals eine Spalte auf, die bei jedem Update vorhanden ist (etwa den Primärschlüssel), sonst feuert der Flow bei jedem Speichern.

3. Fügen Sie **Microsoft Dataverse → Get a row by ID** hinzu, Tabelle `Cases`, Zeilen-ID aus dem Trigger, und als **Select columns** `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Dieser zweite Aufruf ist seinen Preis wert. Bei einem Update trägt der Trigger nur die Spalten, die sich geändert haben, die Kennungen, auf die Sie abgleichen müssen, sind also möglicherweise schlicht nicht dabei.

4. Fügen Sie die eingebaute Aktion **HTTP** hinzu:

   - **Method**: `POST`
   - **URI**: die OneUptime-Webhook-URL von oben
   - **Headers**: `Content-Type: application/json` und `X-OneUptime-Secret: <the same secret>`
   - **Body**: bauen Sie ihn aus den Ausgaben von *Get a row by ID*, zum Beispiel

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Speichern Sie und schalten Sie den Flow ein.

Wissenswertes, bevor Sie sich auf diesen Weg festlegen:

- Der **Microsoft-Dataverse-Connector ist premium.** Bei einem automatisierten Flow braucht nur der Besitzer des Flows die Lizenz, nicht jeder, den der Case berührt – aber wenn die Lizenz des Besitzers ausläuft, steht der Flow stillschweigend still.
- Dataverse-Trigger arbeiten mit **Push, nicht mit Polling** – Dynamics registriert einen Callback und feuert ihn. Die Zustellung erfolgt normalerweise innerhalb von Sekunden; alles jenseits von fünf Minuten bedeutet, dass der asynchrone Dienst überlastet ist, was Sie im Admin Center unter **Settings → System Jobs** sehen können.
- Eigene Header überleben. Power Automate entfernt aus HTTP-Aktionen mehrere Standard-Header-Familien (die meisten `Accept-*`- und `Content-*`-Header, `Host`, `Origin`, `Cookie`), aber ein eigener Header wie `X-OneUptime-Secret` wird durchgereicht.
- Der Flow muss in derselben Umgebung liegen wie die Tabelle, die er beobachtet.
- Anfragen zählen gegen das Power-Platform-Anfragekontingent Ihres Tenants, und Connector-Drosselung zeigt sich als `429` innerhalb der Flow-Ausführung.

### Option B — ein nativer Dataverse-Webhook

Wenn Power Automate nicht verfügbar ist, kann Dataverse OneUptime direkt aufrufen. Registrieren Sie den Endpunkt mit dem [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, geben Sie ihm die OneUptime-URL, wählen Sie die Authentifizierung **HttpHeader** und fügen Sie `X-OneUptime-Secret` mit Ihrem Geheimnis hinzu. Registrieren Sie dann einen Step auf der Tabelle **incident** für die Nachricht **Update**, mit **Filtering Attributes** beschränkt auf die Spalten, die Sie interessieren, Stage **PostOperation**, Ausführungsmodus **Asynchronous**.

Gehen Sie diesen Weg mit offenen Augen:

- **Nur Port 80 und 443.** Ein selbst gehostetes OneUptime auf einem anderen Port lässt sich nicht registrieren.
- **Dataverse prüft Ihr Geheimnis nicht.** Es sendet den Header; eine Anfrage abzulehnen, die ihn nicht trägt, ist allein die Aufgabe Ihres Workflows – wofür der Baustein **If / Else** im empfangenden Workflow da ist.
- **Die Payload ist kein freundliches JSON-Objekt.** Sie ist ein serialisierter `RemoteExecutionContext`, in dem `InputParameters` ein *Array* von `{key, value}`-Paaren ist und die geänderte Zeile unter dem Schlüssel `Target` sitzt, mit ihren Spalten in einem weiteren `Attributes`-Array. Rechnen Sie damit, einen Baustein **Run Custom JavaScript** zu ergänzen, der das flach macht, bevor irgendetwas anderes es lesen kann.
- **Nur geänderte Spalten sind enthalten** bei einem Update, registrieren Sie also ein **Post Image**, wenn Sie `ticketnumber` oder Ihre OneUptime-ID-Spalte brauchen.
- **Oberhalb von 256 KB werden die interessanten Teile entfernt** – `InputParameters`, `PreEntityImages` und `PostEntityImages` fallen alle weg, und die Anfrage trägt einen Header `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` und `PrimaryEntityName` überleben, der Ausweg ist also, die Zeile über die Web API zurückzulesen.
- **Die Zustellung ist nahezu unnachgiebig.** Dataverse wartet 60 Sekunden auf ein `2xx` und wiederholt genau einmal, und nur bei `502`, `503` und `504`. Alles andere – auch ein `500` von Ihrer Seite – wird nicht wiederholt; es landet als fehlgeschlagener System Job.
- Wählen Sie **Asynchronous**. Ein synchroner Step blockiert das Speichern des Agents an Ihrem Endpunkt, und wenn die Transaktion danach zurückgerollt wird, ist die Anfrage bereits hinausgegangen und kann nicht zurückgeholt werden.

Klassische Dynamics-Hintergrund-Workflows haben überhaupt keinen HTTP- oder Webhook-Schritt, sie sind hier also keine dritte Option.

## Dasselbe für Warnungen

Alles oben ist um Vorfälle herum geschrieben, weil das der häufige Fall ist, aber Warnungen funktionieren genauso – tauschen Sie den Datensatztyp, und sonst ändert sich nichts:

| Vorfall                                                       | Warnung                                             |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Ein Workflow hat genau einen Trigger, Vorfälle und Warnungen brauchen also je einen eigenen Workflow. Wenn beide dieselbe Arbeit erledigen würden, bauen Sie die Dynamics-Hälfte einmal und rufen sie aus beiden mit der Komponente **Execute Workflow** auf.

## Fehlerbehebung

Lesen Sie zuerst den fehlgeschlagenen Baustein in **Ausführungen & Protokolle** – beide Microsoft-Endpunkte liefern einen erklärenden JSON-Body zurück, und die API-Komponente hält ihn in `response-body` fest.

**Die Token-Anfrage scheitert mit `400` und `invalid_request` oder einem nicht unterstützten Grant-Typ.** Der Header `Content-Type` lautet nicht exakt `Content-Type: application/x-www-form-urlencoded`, der Body ist also als JSON hinausgegangen. Prüfen Sie die Groß- und Kleinschreibung.

**`400` mit `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** Der `scope` ist nicht Ihre Umgebungs-URL plus `/.default`. Kopieren Sie die URL aus **Developer resources** und entfernen Sie einen abschließenden Schrägstrich sowie jeden Pfad `/api/data/...`.

**`401 Unauthorized` von Dynamics.** Der Header `Authorization` fehlt, ist fehlerhaft, oder das Token ist mitten in der Ausführung abgelaufen. Er muss `Bearer <token>` mit einem einzelnen Leerzeichen lauten.

**`403 Forbidden` mit `0x80072560`, „The user isn't a member of the organization“.** Schritt 2 wurde übersprungen, oder der Anwendungsbenutzer ist an eine andere App-Registrierung gebunden. Das Token ist in Ordnung; der Benutzer auf der Dynamics-Seite ist nicht da.

**`403 Forbidden` mit einem Berechtigungsfehler.** Der Anwendungsbenutzer existiert, aber seiner benutzerdefinierten Sicherheitsrolle fehlen Create, Read oder Write auf **Case**.

**`400 Bad Request` mit Erwähnung des Kunden.** `customerid` ist Pflicht. Setzen Sie `customerid_account@odata.bind` oder `customerid_contact@odata.bind`, exakt so geschrieben, mit einer URI mit führendem Schrägstrich wie `/accounts(<guid>)`.

**`404 Not Found` auf `/CloseIncident`.** Die Action gehört zu Dynamics 365 Customer Service. Durchsuchen Sie das `$metadata` Ihrer Umgebung danach, bevor Sie annehmen, dass sie verfügbar ist.

**`412 Precondition Failed` mit `DuplicateRecord`.** Eine Duplikatserkennungsregel hat gegriffen. Grenzen Sie entweder die Regel ein, oder senden Sie das Feld nicht mehr, auf das sie abgleicht.

**`429 Too Many Requests`.** Die Service-Protection-Grenzen von Dataverse – ungefähr 6.000 Anfragen und 20 Minuten Ausführungszeit pro Benutzer in einem beliebigen Fünf-Minuten-Fenster, pro Webserver. Die Antwort trägt ein `Retry-After` in Sekunden. Wenn ein Workflow stoßweise arbeitet, setzen Sie einen Baustein **Delay** hinein oder verlagern Sie die Arbeit in einen geplanten Workflow, der bündelt.

**Bei OneUptime kommt nichts an.** Senden Sie selbst mit `curl` eine Anfrage an die Webhook-URL und prüfen Sie **Ausführungen & Protokolle** des Workflows. Wenn Ihre eigene Anfrage auftaucht und die von Dynamics nicht, liegt das Problem weiter oben: bei Power Automate im Ausführungsverlauf des Flows, bei einem nativen Webhook unter **Settings → System Jobs**, gefiltert auf Fehlschläge.

**Der Workflow läuft, aber der Vorfall ändert sich nicht.** Ein Baustein **Update One Incident** meldet `Items Updated: 0`, wenn die Query nichts getroffen hat – das ist ein Erfolg, kein Fehler. Prüfen Sie, ob die ID in der Payload die OneUptime-Vorfall-ID ist und ob Sie nach `_id` abfragen.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — die eingehenden und ausgehenden Muster und der Authentifizierungs-Spickzettel.
- [Jira](/docs/integrations/jira) — derselbe Aufbau in beide Richtungen gegen Jira.
- [Workflows – Überblick](/docs/workflows/index) und [Einen Workflow erstellen](/docs/workflows/authoring) — die Arbeitsfläche, Identifier und das Einschalten eines Workflows.
- [Komponenten](/docs/workflows/components) — die API-Bausteine, If / Else und die OneUptime-Datenkomponenten.
- [Variablen](/docs/workflows/variables) — Geheimnisse und das Lesen der Ausgabe eines Bausteins im nächsten.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) — Webhook-Sicherheit und ausgehender Netzwerkzugriff.
- [IP-Adressen](/docs/configuration/ip-addresses) — die ausgehenden Bereiche von OneUptime, falls Dynamics hinter einer Positivliste sitzt.
