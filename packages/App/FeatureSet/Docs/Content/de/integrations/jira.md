# Jira-Integration

Öffnen Sie ein [Jira](https://www.atlassian.com/software/jira)-Issue, sobald ein OneUptime-Vorfall erklärt wird, halten Sie es im Gleichschritt, während sich der Vorfall bewegt, und lassen Sie Jira Statusänderungen zurück nach OneUptime schieben – alles mit einem [Workflow](/docs/workflows/index). Es gibt keinen Jira-spezifischen Baustein zu installieren: OneUptime ruft die REST-API von Jira mit der [API-Komponente](/docs/workflows/components#api) auf, und Jira ruft über einen [Webhook-Trigger](/docs/workflows/triggers#webhook) zurück.

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Diese Seite baut beide Richtungen auf. Alles bis zum eingehenden Abschnitt ist für **Jira Cloud** geschrieben; ein Abschnitt gegen Ende listet auf, was sich bei **Jira Data Center** ändert.

> Atlassian benennt in Jira Cloud gerade einiges um: Aus einem **project** ist in weiten Teilen der Oberfläche ein **space** geworden, und aus einem **issue** ein **work item**. Tenants sind mit beiden Vokabularen unterwegs, deshalb finden Sie unten dort, wo die Wortwahl zählt, beide Varianten.

## Voraussetzungen

- Eine Jira-Cloud-Site (`https://your-domain.atlassian.net`) und ein Projekt, in dem Issues angelegt werden sollen. Notieren Sie sich dessen **Projektschlüssel** – das `OPS` in `OPS-1234`.
- Ein Jira-Konto, das in diesem Projekt Issues erstellen darf, und ein **API-Token** dafür von [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Nehmen Sie ein Dienstkonto statt eines persönlichen Kontos – so erstellte Issues werden dem Besitzer des Tokens zugeschrieben.
- Die Berechtigung, in diesem Projekt Automatisierungsregeln anzulegen, für die eingehende Hälfte.
- Ein OneUptime-Projekt, in dem Sie Workflows und globale Variablen erstellen können.

## Schritt 1 — Die Jira-Zugangsdaten als Geheimnis speichern

Die REST-API von Jira Cloud erwartet **Basic-Auth**, gebildet aus Ihrer Atlassian-Konto-E-Mail und einem API-Token, gemeinsam Base64-kodiert.

1. Kodieren Sie `email:api_token` einmal:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Verwenden Sie `printf`, nicht `echo`. `echo` hängt einen Zeilenumbruch an, der Zeilenumbruch wird mitkodiert, und Jira antwortet mit `401` – aus Gründen, die in der eingefügten Zeichenkette unsichtbar sind.

2. Gehen Sie in OneUptime zu **Arbeitsabläufe → Globale Variablen → Erstellen**. Benennen Sie die Variable `JIRA_AUTH`, fügen Sie die Base64-Zeichenkette als **Inhalt** ein und aktivieren Sie **Geheimnis**.
3. Legen Sie eine zweite, nicht geheime Variable `JIRA_URL` an, die `https://your-domain.atlassian.net` ohne abschließenden Schrägstrich enthält.

Jeder Baustein kann nun `Basic {{global.variables.JIRA_AUTH}}` als `Authorization`-Header verwenden, und der Token erscheint nie im Workflow oder in dessen Ausführungsprotokollen. Siehe [Variablen](/docs/workflows/variables).

Zwei Dinge über Atlassian-API-Token, die irgendwann jede Integration einholen, auf die niemand schaut:

- **Sie laufen ab.** Token werden mit einer Lebensdauer von einem Tag bis zu einem Jahr erstellt, standardmäßig ein Jahr, und es gibt keine Erneuerung – ein abgelaufenes Token muss auf derselben Seite von Hand ersetzt und erneut in `JIRA_AUTH` kodiert werden. Tragen Sie das Ablaufdatum irgendwo in einen Kalender ein. Wenn ein Workflow, der monatelang lief, plötzlich `401` antwortet, ist das der Grund.
- **Ein Token mit Scopes braucht eine andere Basis-URL.** Die Token-Seite bietet neben dem klassischen **Create API token** auch **Create API token with scopes** an. Token mit Scopes sind die sicherere Wahl, aber sie sind nicht an Ihre Site adressiert: Sie gehen an `https://api.atlassian.com/ex/jira/<cloudId>`, `JIRA_URL` wird also stattdessen das, und jeder Pfad weiter unten hängt unverändert daran. Ihre `cloudId` steht im JSON unter `https://your-domain.atlassian.net/_edge/tenant_info`. Ein Token mit Scopes, das an `your-domain.atlassian.net` geht, schlägt schlicht fehl.

Wenn Ihre Organisation Atlassians zentralisierte Benutzerverwaltung nutzt, gibt es eine dritte Möglichkeit, die das Ablaufproblem umgeht: ein [OAuth-2.0-Credential für ein Dienstkonto](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Sie erhalten damit eine Client-ID und ein Secret statt eines Tokens, und ein Workflow tauscht sie zu Beginn jeder Ausführung gegen ein kurzlebiges Access Token – dieselbe Form aus zwei Bausteinen, die die Seite [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) verwendet, mit einem Baustein **API Post (JSON)**, der das Token holt, und allem danach, das `Bearer <token>` sendet. Ein Jahr später muss nichts von Hand ersetzt werden. Die genaue Token-Anfrage steht auf Atlassians Seite; die API-Basis-URL ist `https://api.atlassian.com`.

## Schritt 2 — Für jeden Vorfall ein Jira-Issue öffnen

1. Öffnen Sie **Arbeitsabläufe → Workflow erstellen**, benennen Sie ihn `Incidents → Jira`, und öffnen Sie den **Builder**.
2. Klicken Sie auf den gestrichelten Platzhalter-Baustein und fügen Sie den Trigger **On Create Incident** hinzu. Fordern Sie in dessen **Select Fields** die Spalten an, die Sie senden möchten:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Belassen Sie den **Identifier** bei `incident-on-create-1` – unter diesem Namen beziehen sich spätere Bausteine darauf.

3. Klicken Sie auf **Komponente hinzufügen**, fügen Sie einen Baustein **API Post (JSON)** hinzu und ziehen Sie vom Punkt **Erfolg** des Triggers zum Eingangspunkt des neuen Bausteins. Öffnen Sie ihn, setzen Sie seinen **Identifier** auf `create-issue` und füllen Sie aus:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Ersetzen Sie `OPS` durch Ihren Projektschlüssel und `Bug` durch einen Issue-Typ, den es in diesem Projekt gibt. Beide lassen sich auch per ID angeben – `{"id": "10000"}` –, was Atlassians eigene Beispiele verwenden und was Sie bevorzugen sollten, wenn zwei Issue-Typen in Ihrer Site denselben Namen tragen. Die `createmeta`-Aufrufe weiter unten liefern Ihnen diese IDs.

Die Beschreibung wirkt schwerfällig, weil die v3-API von Jira Cloud Rich Text als **Atlassian Document Format** entgegennimmt – einen Dokumentbaum, keine Zeichenkette. Die Form oben ist das minimal gültige Dokument: ein Absatz mit einem Textknoten. Dasselbe gilt für `environment` und für jedes mehrzeilige benutzerdefinierte Textfeld; einzeilige benutzerdefinierte Textfelder nehmen weiterhin eine einfache Zeichenkette entgegen.

Schalten Sie den Workflow nun über **Übersicht → Workflow bearbeiten → Aktiviert** ein, erklären Sie einen Test-Vorfall und öffnen Sie **Ausführungen & Protokolle**. Der Baustein `create-issue` sollte einen `201` zeigen und einen Body, der `id`, `key` und `self` des neuen Issues enthält. Änderungen auf der Arbeitsfläche speichern sich selbst – es gibt keinen Speichern-Knopf, und ein deaktivierter Workflow läuft überhaupt nicht, nicht einmal von Hand.

Der Key des neuen Issues steht jedem Baustein nach diesem zur Verfügung:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Weitere Felder ausfüllen

Ein paar gängige Ergänzungen innerhalb von `fields`:

- **Priorität** — `"priority": { "id": "20000" }`, mit einer Prioritäts-ID aus Ihrer Site. Um OneUptime-Schweregrade auf Jira-Prioritäten abzubilden, setzen Sie einen Baustein **If / Else** zwischen den Trigger und den API-Baustein und verzweigen auf `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Verantwortlicher** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifiziert Personen über die Atlassian-Account-ID; `username` und `userKey` wurden vor Jahren aus der Cloud-API entfernt.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, ein flaches Array von Zeichenketten. Labels dürfen keine Leerzeichen enthalten.
- **Komponenten** — `"components": [{ "id": "10000" }]`.
- **Benutzerdefinierte Felder** — `"customfield_10034": "..."`, mit der eigenen ID des Feldes. Die Form des Wertes richtet sich nach dem Feldtyp: Eine Einfachauswahl nimmt `{"value": "red"}`, eine Mehrfachauswahl ein Array von IDs, ein mehrzeiliges Textfeld ein Dokument im Atlassian Document Format.

Um herauszufinden, was ein Projekt tatsächlich verlangt, fragen Sie Jira, statt zu raten. Listen Sie die Issue-Typen eines Projekts auf, dann die Felder für einen davon:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

Der zweite Aufruf listet jedes Feld auf, das dieser Issue-Typ akzeptiert, welche davon Pflicht sind, und die genauen `customfield_NNNNN`-IDs. Um die IDs an einem Issue abzulesen, das Sie bereits haben, rufen Sie es mit `?expand=names` ab.

## Schritt 3 — Die Vorfall-ID nach Jira mitnehmen

Beide Hälften einer bidirektionalen Synchronisierung brauchen ein System, das die Kennung des anderen hält, und Jira ist der bessere Ort dafür: Die Spalte `customFields` in OneUptime ist ein einziger JSON-Klumpen, das Schreiben eines Wertes aus einem Workflow ersetzt also sämtliche benutzerdefinierten Felder an diesem Vorfall.

**Mit einem Jira-Administrator.** Fügen Sie ein kurzes benutzerdefiniertes Textfeld – nennen Sie es *OneUptime Incident ID* – zum Erstellungsbildschirm des Projekts hinzu, ermitteln Sie seine ID mit `createmeta` und setzen Sie es zusammen mit allem anderen:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Ohne einen solchen.** Packen Sie sie stattdessen in ein Label. Labels vertragen keine Leerzeichen, und eine OneUptime-ID ist eine einfache UUID, `oneuptime-<id>` ist also ein gültiges Label:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Der eingehende Workflow muss dieses Label dann aus der Liste herauspicken, was ein paar Zeilen in einem Baustein **Run Custom JavaScript** sind. Das benutzerdefinierte Feld ist sauberer, wenn Sie eines haben können.

Wo Sie gerade dabei sind, lohnt es sich, am Jira-Issue einen Link zurück zum Vorfall anzulegen. Ein Baustein **API Post (JSON)** nach `create-issue`, gerichtet auf `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, mit:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

gibt allen in Jira einen Weg zurück mit einem Klick. Fügen Sie dafür `projectId` zu den **Select Fields** des Triggers hinzu. Die `globalId` ist das, was den Aufruf gefahrlos wiederholbar macht: Jira aktualisiert den Link, der diese ID bereits trägt, statt einen zweiten hinzuzufügen. Weil eine Aktualisierung außerdem alles leert, was Sie weglassen, senden Sie immer das ganze `object`, nicht einen Ausschnitt davon.

## Schritt 4 — Kommentieren und übergehen, während sich der Vorfall bewegt

Bauen Sie das als **zweiten** Workflow, damit ein Fehler hier niemals das Öffnen von Issues verhindern kann.

1. **Workflow erstellen**, benennen Sie ihn `Incident updates → Jira`, und fügen Sie den Trigger **On Update Incident** hinzu.
2. Tragen Sie in **Listen on** `{"currentIncidentStateId": true}` ein. Der Trigger feuert dann nur bei Zustandsänderungen statt bei jeder Bearbeitung. Fordern Sie in **Select Fields** `{"_id": true, "currentIncidentState": {"name": true}}` an.
3. Fügen Sie einen Baustein **If / Else** hinzu: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` – oder wie auch immer der aufgelöste Zustand in Ihrem Projekt heißt. Siehe [Vorfallszustände & Schweregrade](/docs/incidents/states-and-severities).

Vom Zweig **Ja** aus müssen Sie zuerst das Issue finden, das Sie in Schritt 2 geöffnet haben. Fragen Sie Jira mit der in Schritt 3 gespeicherten ID danach, über einen Baustein **API Post (JSON)**, dessen **Identifier** `find-issue` lautet:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Wenn Sie ein benutzerdefiniertes Feld statt eines Labels verwendet haben, wird die Klausel zu `cf[10050] ~ \"...\"` mit Ihrer eigenen Feld-ID.

Die Issue-ID lautet dann `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, und jeder Endpunkt weiter unten nimmt eine ID genauso bereitwillig entgegen wie einen Key.

Drei Dinge über diesen Endpunkt sollten Sie wissen. **Senden Sie das JQL per POST, packen Sie es nicht in die URL** – ein Query-String, der innerhalb eines Wertes ein `=` enthält, wird auf dem Weg aus einem Workflow abgeschnitten, und JQL besteht aus nichts als `=`-Zeichen. **Die Abfrage muss eingegrenzt sein**: Ein nacktes `order by key desc` wird mit `400` abgelehnt, deshalb steht die Klausel `project =` dort. Und `/rest/api/3/search/jql` ist der aktuelle Endpunkt – das ältere `/rest/api/3/search` ist veraltet und wird abgeschaltet, greifen Sie also nicht danach.

**Einen Kommentar hinterlassen** ist ein einzelner Baustein **API Post (JSON)** an `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, mit einem Body im Atlassian Document Format genau wie bei der Beschreibung:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Das Issue zu bewegen** kostet zwei Aufrufe, weil ein Übergang über eine ID identifiziert wird, die sich zwischen Jira-Workflows und, auf manchen Boards, zwischen Issues unterscheidet.

1. Ein Baustein **API Get (JSON)** auf `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` liefert die Übergänge zurück, die *vom aktuellen Status des Issues aus* verfügbar sind, jeweils mit einer `id` und einem `name`, und einem `to`-Objekt, das den Zielstatus benennt.
2. Ein Baustein **API Post (JSON)** an dieselbe URL führt einen davon aus:

   ```json
   { "transition": { "id": "31" } }
   ```

Ein erfolgreicher Übergang antwortet mit `204` ohne Body. Wenn Sie die Liste lieber nicht zur Laufzeit lesen möchten, rufen Sie sie einmal von Hand für ein Issue im richtigen Status auf und tragen die ID fest ein – denken Sie nur daran, dass sie an diesen Jira-Workflow gebunden ist, ein Administrator, der den Jira-Workflow bearbeitet, kann sie also unbemerkt kaputt machen.

## Eingehend — Jira nach OneUptime

Nun die andere Richtung: Jemand zieht das Issue auf Done, und der OneUptime-Vorfall soll nachziehen.

### Zuerst den empfangenden Workflow bauen

1. **Workflow erstellen**, benennen Sie ihn `Jira → OneUptime`, und fügen Sie den Trigger **Webhook** hinzu.
2. Öffnen Sie die **Einstellungen** dieses Workflows und kopieren Sie den **geheimen Webhook-Schlüssel**. Ihre URL lautet:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Selbst gehostete Installationen verwenden ihren eigenen Host. Behandeln Sie die URL wie ein Passwort – wer sie hat, kann den Workflow starten – und setzen Sie den Schlüssel auf derselben Seite zurück, falls er nach außen gelangt.

3. Fügen Sie einen Baustein **If / Else** hinzu, der ein gemeinsames Geheimnis prüft, bevor irgendetwas anderes läuft. **Input 1** ist `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** ist `{{global.variables.JIRA_WEBHOOK_SECRET}}` – ein Wert, den Sie sich ausdenken und als geheime globale Variable speichern.
4. Fügen Sie vom Zweig **Ja** aus einen Baustein **Update One Incident** hinzu:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: was die Jira-Änderung hier bedeuten soll – üblicherweise eine Zustandsänderung.

   Um einen Vorfall zu bewegen, brauchen Sie die ID des Zielzustands, die Ihnen ein Baustein **Find One Incident State** mit der Query `{"name": "Resolved"}` als `{{local.components.incident-state-find-one-1.returnValues.model._id}}` liefert. Schreiben Sie diese in `currentIncidentStateId`.

Lassen Sie den Workflow aktiviert. Geben Sie Jira nun etwas zum Aufrufen.

### Das Ereignis aus einer Jira-Automatisierungsregel senden

1. Öffnen Sie in Jira die Automatisierungsregeln des Projekts: **Space settings → Automation** auf neueren Tenants, **Project settings → Automation** auf älteren. Für eine Regel über mehrere Projekte hinweg nehmen Sie **Settings → System → Global automation**, wofür die globale Berechtigung *Administer Jira* nötig ist.
2. **Create rule**, und wählen Sie den Trigger **Work item transitioned** – **Issue transitioned** auf älteren Tenants. Stellen Sie ihn so ein, dass er läuft, wenn der Status *auf* **Done** wechselt.

   Nehmen Sie diesen Trigger, nicht *Work item updated*: Der Update-Trigger schließt Statusänderungen absichtlich aus.

3. Fügen Sie die Aktion **Send web request** (Web-Anfrage senden) hinzu und konfigurieren Sie sie:

   - **Web request URL**: die OneUptime-Webhook-URL von oben.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, und `X-OneUptime-Secret` / Ihr gemeinsames Geheimnis. Nutzen Sie die Option **Hide** für den Wert des Geheimnisses, damit andere Regelbearbeiter ihn nicht lesen können – beachten Sie, dass das Verbergen für diesen Wert unumkehrbar ist und verborgene Werte verloren gehen, wenn die Regel exportiert oder dupliziert wird.
   - **Web request body**: **Custom format**, damit Sie die Form bestimmen:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Wenn Sie in Schritt 3 ein Label statt eines benutzerdefinierten Feldes verwendet haben, senden Sie `"labels": "{{issue.labels}}"` und holen die ID auf der OneUptime-Seite mit einem Baustein **Run Custom JavaScript** heraus.

4. Schalten Sie die Regel ein, ziehen Sie ein Test-Issue auf Done und prüfen Sie beide Seiten: das Audit-Log der Regel in Jira und **Ausführungen & Protokolle** in OneUptime.

Was Sie wissen sollten, bevor Sie sich darauf verlassen:

- **Der Zielport ist eingeschränkt.** Send web request erreicht nur die Ports 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 und 9900. OneUptime Cloud liegt auf 443; eine selbst gehostete Installation auf einem ungewöhnlichen Port lässt sich so nicht aufrufen.
- **Es gibt keine Signierung der Anfrage.** Die Aktion hat keine HMAC-Option, ein gemeinsames Geheimnis in einem Header über HTTPS ist also der von Atlassian dokumentierte Mechanismus. Die **If / Else**-Prüfung in Schritt 3 des empfangenden Workflows ist das, was ihn überhaupt lohnenswert macht.
- **Regelausführungen werden gezählt.** Jira Cloud rechnet erfolgreiche Regelausführungen gegen ein monatliches Kontingent, das von Ihrem Plan abhängt – 100 bei Free, 1.700 bei Standard, 1.000 × Benutzer bei Premium, unbegrenzt bei Enterprise. Eine Regel, die bei jedem Übergang in einem betriebsamen Projekt feuert, summiert sich.
- **Werte werden nicht für Sie URL-kodiert.** Das spielt nur eine Rolle, wenn Sie einen formularkodierten Body senden; das JSON oben ist unproblematisch.
- **Atlassian veröffentlicht seine ausgehenden IP-Bereiche** unter [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com), falls Ihre OneUptime-Installation hinter einer Positivliste sitzt. Sie ändern sich, fragen Sie den Feed also regelmäßig ab, statt Adressen festzuschreiben.

### Oder stattdessen einen Jira-Webhook verwenden

Ein Jira-Administrator kann einen Webhook direkt unter **Settings → System → Advanced → WebHooks** registrieren und dabei die zu sendenden Ereignisse und optional eine JQL-Abfrage wählen, die eingrenzt, welche Issues ihn auslösen. Im Vergleich zu einer Automatisierungsregel:

- Die Payload ist Jiras eigene, nicht Ihre: `webhookEvent`, `issue_event_type_name`, das vollständige `issue` und ein `changelog`, dessen `items`-Array das Vorher und Nachher jedes geänderten Feldes enthält. Für eine Statusänderung wollen Sie den Eintrag, bei dem `field` gleich `status` ist. Das innerhalb eines Workflows zu lesen bedeutet meist einen Baustein **Run Custom JavaScript**.
- Webhooks **können** signiert werden – geben Sie dem Webhook ein Geheimnis, und Jira sendet einen `X-Hub-Signature`-Header mit einem HMAC des Anfrage-Bodys –, aber ein Workflow kann das nicht prüfen. Die Signatur deckt genau die Bytes ab, die Jira gesendet hat, und der Webhook-Trigger übergibt dem Workflow einen Body, der bereits zu JSON geparst wurde, es bleibt also nichts mehr zum Hashen. Wenn Sie die Anfrage authentifizieren möchten, nehmen Sie stattdessen eine Automatisierungsregel mit einem Header mit gemeinsamem Geheimnis.
- Die URL muss HTTPS auf einem Port aus Jiras eigener Liste sein, und das ist *nicht* dieselbe Liste, die die Automatisierungsaktion verwendet – Port 80 ist hier nicht erlaubt.
- Die Zustellung wird bis zu fünfmal mit einem Backoff von fünf bis fünfzehn Minuten wiederholt, Ihr Workflow muss also vertragen, dass dasselbe Ereignis zweimal ankommt.

Webhooks, die eine App über `/rest/api/3/webhook` registriert, sind noch einmal etwas anderes: Sie laufen 30 Tage nach der Registrierung ab, sofern sie nicht erneuert werden. Die oben beschriebenen, vom Administrator registrierten laufen nicht ab.

## Jira Data Center

Selbstverwaltetes Jira funktioniert mit einer Handvoll Ersetzungen genauso. **Jira Server** hat im Februar 2024 das Ende des Supports erreicht und erhält keine Fixes mehr, betrachten Sie also Data Center als das selbstverwaltete Ziel.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` – auf Data Center gibt es kein v3                          |
| `description` als Dokument im Atlassian Document Format | `description` als einfache Zeichenkette in Wiki-Markup                  |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API-Token von id.atlassian.com                    | **Profile → Personal access tokens → Create token** in Ihrem eigenen Jira-Konto |
| Automatisierungsaktion **Send web request**       | Automatisierungsaktion **Send outgoing web request**                         |

Der Baustein zum Anlegen des Issues wird damit zu einem `POST` an `/rest/api/2/issue` mit:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

was sich einfacher als Vorlage schreiben lässt – kein Dokumentbaum.

Weitere Unterschiede, mit denen Sie planen sollten:

- **Personal access tokens** gibt es ab Jira Core und Jira Software 8.14 sowie Jira Service Management 4.15. Sie laufen ab – standardmäßig nach 365 Tagen – und die Oberfläche markiert eines fünf Tage vorher als *Expires soon*. Basic-Auth mit Benutzername und Passwort funktioniert auf Data Center weiterhin, aber ein paar fehlgeschlagene Anmeldungen lösen ein CAPTCHA aus, das das Konto vollständig aus der REST-API aussperrt, bis ein Mensch es im Browser auflöst – eine schlechte Art, einen Tippfehler zu entdecken. Nehmen Sie lieber ein Token.
- **Automation ist ab Jira Data Center 10.0 mitgeliefert.** Davor war es die separat installierte App Automation for Jira. Ihre ausgehende Anfrage hat ein Standard-Timeout von 3000 ms, einstellbar über die Property `outgoing.webhook.timeout.ms`.
- **Webhooks** werden unter **Administration → System → Advanced → WebHooks** registriert, und JQL-Eingrenzung wird unterstützt. Halten Sie diese Filter eng: Jira wertet das JQL jedes registrierten Webhooks auf dem Thread aus, der das Ereignis ausgelöst hat, ein Dutzend lockerer Filter bremst also die Benutzeraktion, die sie ausgelöst hat.
- **Ab Data Center 10.0 ist die Webhook-Zustellung asynchron**, und es gibt keine synchrone Option, Ereignisse können also in falscher Reihenfolge ankommen. Machen Sie den empfangenden Workflow idempotent.
- **Jira 10 hat das `$` in Webhook-URL-Variablen fallen gelassen** – aus `${issue.id}` wurde `{issue.id}` – und die Webhook-REST-Ressource von `/rest/webhooks/1.0/webhook` nach `/rest/jira-webhook/1.0/webhooks` verschoben.

## Dasselbe für Warnungen

Alles oben ist um Vorfälle herum geschrieben, weil das der häufige Fall ist, aber Warnungen funktionieren genauso – tauschen Sie den Datensatztyp, und sonst ändert sich nichts:

| Vorfall                                  | Warnung                                     |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Ein Workflow hat genau einen Trigger, Vorfälle und Warnungen brauchen also je einen eigenen Workflow. Wenn beide dieselbe Arbeit erledigen würden, bauen Sie die Jira-Hälfte einmal und rufen sie aus beiden mit der Komponente **Execute Workflow** auf.

## Fehlerbehebung

Öffnen Sie zuerst den fehlgeschlagenen Baustein in **Ausführungen & Protokolle**. Jira liefert einen JSON-Body zurück, der genau benennt, was abgelehnt wurde, und die API-Komponente hält ihn in `response-body` fest.

**`401 Unauthorized`.** Kodieren Sie `email:api_token` mit `printf` neu und aktualisieren Sie `JIRA_AUTH`; ein abschließender Zeilenumbruch von `echo` ist die übliche Ursache. Prüfen Sie dann, ob das Konto, dem das Token gehört, in diesem Projekt Issues erstellen darf. Auf Data Center kontrollieren Sie, dass Sie `Bearer` senden, nicht `Basic`.

**`400 Bad Request` mit Nennung eines Feldes.** Den Issue-Typ gibt es im Projekt nicht, oder das Projekt hat ein Pflichtfeld, das Sie nicht senden. Führen Sie die `createmeta`-Aufrufe von oben gegen dieses Projekt und diesen Issue-Typ aus und vergleichen Sie.

**`400` mit Beanstandung von `description`.** Auf Cloud v3 muss die Beschreibung ein Dokument im Atlassian Document Format sein, keine Zeichenkette. Senden Sie entweder das oben gezeigte Dokument, oder stellen Sie diesen Baustein auf `/rest/api/2/issue` um und senden Sie Klartext.

**`404 Not Found`.** Prüfen Sie die Basis-URL und die API-Version – `/rest/api/3/...` auf Cloud, `/rest/api/2/...` auf Data Center.

**`429 Too Many Requests`.** Jira drosselt. Die Antwort trägt `Retry-After` in Sekunden und einen `RateLimit-Reason`, der benennt, an welche Grenze Sie gestoßen sind. Schreibzugriffe auf ein einzelnes Issue sind eng gedeckelt – in der Größenordnung von zwanzig in zwei Sekunden –, ein Workflow, der in schneller Folge kommentiert und übergeht, kann sie also schon an einem einzigen Issue auslösen. Setzen Sie einen Baustein **Delay** zwischen die Aufrufe, oder verlagern Sie Massenarbeit in einen geplanten Workflow.

**Der Übergangsaufruf antwortet mit `400`.** Die Übergangs-ID ist vom *aktuellen* Status des Issues aus nicht gültig. Rufen Sie `/transitions` für dieses Issue ab und nehmen Sie eine ID aus der Antwort.

**Die Automatisierungsregel wird als erfolgreich angezeigt, aber bei OneUptime kommt nichts an.** Prüfen Sie zuerst den Port – siehe die eingeschränkte Liste oben. Senden Sie dann selbst mit `curl` eine Anfrage an die Webhook-URL und sehen Sie nach, ob sie in **Ausführungen & Protokolle** auftaucht; wenn Ihre ankommt und die von Jira nicht, liegt das Problem auf Jiras Seite.

**Der Workflow läuft, aber der Vorfall ändert sich nicht.** Ein Baustein **Update One Incident** meldet `Items Updated: 0`, wenn seine Query nichts getroffen hat, und das gilt als Erfolg, nicht als Fehler. Prüfen Sie, ob die ID in der Payload wirklich die OneUptime-Vorfall-ID ist und ob Sie nach `_id` abfragen.

**Eine `{{...}}`-Referenz taucht wörtlich in einem Jira-Issue auf.** Eine nicht aufgelöste Referenz wird als Text durchgereicht statt geleert. Das Ausführungsprotokoll nennt jede Referenz, die sich nicht auflösen ließ – meist ein vertippter Baustein-Identifier oder eine umbenannte Variable.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — die eingehenden und ausgehenden Muster und der Authentifizierungs-Spickzettel.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — derselbe Aufbau in beide Richtungen gegen Dynamics.
- [Workflows – Überblick](/docs/workflows/index) und [Einen Workflow erstellen](/docs/workflows/authoring) — die Arbeitsfläche, Identifier und das Einschalten eines Workflows.
- [Komponenten](/docs/workflows/components) — die API-Bausteine, If / Else und die OneUptime-Datenkomponenten.
- [Variablen](/docs/workflows/variables) — Geheimnisse und das Lesen der Ausgabe eines Bausteins im nächsten.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) — Webhook-Sicherheit und ausgehender Netzwerkzugriff.
- [ServiceNow](/docs/integrations/servicenow) und [PagerDuty](/docs/integrations/pagerduty) — dasselbe ausgehende Muster für andere Tools.
