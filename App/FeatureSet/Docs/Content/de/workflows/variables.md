# Variablen

Bei Workflows geht es darum, Daten zu bewegen – vom Trigger zum ersten Baustein, von einem Baustein zum nächsten und von gemeinsam genutzten Werten überall dorthin, wo Sie sie brauchen. Variablen sind das Mittel, mit dem diese Daten sich bewegen.

Es gibt zwei Gültigkeitsbereiche für Variablen, dazu die Ausgaben von Komponenten, die während einer Ausführung entstehen.

## Globale Variablen

Projektweite Werte, die Sie einmal speichern und überall wiederverwenden. Denken Sie an API-Schlüssel, URLs, Kanalnamen – alles, was Sie nicht in zehn verschiedene Workflows kopieren wollen.

Sie finden sie unter **Arbeitsabläufe → Globale Variablen**. Jede hat:

- **Name** – darüber referenzieren Sie sie. Mindestens zwei Zeichen, keine Leerzeichen, und nur Buchstaben, Ziffern, Bindestriche und Unterstriche. `UPPER_SNAKE_CASE` ist eine gute Gewohnheit, weil es in Ihren Bausteinen heraussticht.
- **Beschreibung** – optional, freier Text, der Sie daran erinnert, wofür sie da ist.
- **Geheimnis** – wenn eingeschaltet, wird der Wert aus Ausführungsprotokollen und Schritt-Traces entfernt.
- **Inhalt** – der eigentliche Wert. Das ist ein Langtextfeld, mehrzeilige Werte funktionieren also.

So verwenden Sie eine globale Variable in einem beliebigen Workflow:

```
{{global.variables.NAME}}
```

Haben Sie zum Beispiel Ihren PagerDuty-Schlüssel als `PAGERDUTY_KEY` gespeichert, kann ihn jeder Baustein als `{{global.variables.PAGERDUTY_KEY}}` verwenden – der Editor speichert die Referenz, und das Workflow-Logging entfernt den aufgelösten geheimen Wert.

Variablen werden angelegt und gelöscht, nicht bearbeitet. In der Tabelle gibt es keinen Bearbeiten-Knopf; um einen Wert in der Oberfläche zu ändern, löschen Sie die Variable also und legen sie neu an – oder Sie aktualisieren sie über die API, was am Ende dieser Seite beschrieben ist. Globale und Workflow-Variablen sind eine Funktion des Growth-Plans.

## Lokale Workflow-Variablen

Variablen, die nur für einen Workflow gelten und unter **Workflow-Variablen** im linken Menü dieses Workflows verwaltet werden. Referenzieren Sie sie mit:

```
{{local.variables.NAME}}
```

## Komponentenausgaben (Daten aus früheren Bausteinen)

Jeder Trigger und jede Komponente kann während einer Ausführung Ausgaben produzieren. Erzeugen Sie die Referenz mit der Komponentenwert-Auswahl im Editor, statt sie zu tippen – sie fügt genau die IDs ein, die der Runner erwartet.

So referenzieren Sie die Ausgabe eines früheren Bausteins:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` ist der **Identifier** des Bausteins – die kurze ID, die auf dem Baustein steht, nicht der dort angezeigte Name. Neue Bausteine bekommen eine wie `api-get-1`, und Sie können sie im Abschnitt **ID** des Bausteins umbenennen. Ein Umbenennen bricht jede Referenz, die bereits darauf zeigt – genauso wie beim Umbenennen einer Variablen. `FIELD_ID` ist die ID des gewählten Rückgabewerts.

Beispiele:

- Nachdem eine Komponente **API** mit der ID `lookup-user` gelaufen ist, lautet ihr Statuscode `{{local.components.lookup-user.returnValues.response-status}}` und ihr Body `{{local.components.lookup-user.returnValues.response-body}}`.
- Nach einer Komponente **Run Custom JavaScript** mit der ID `transform` ist ihr zurückgegebener Wert `{{local.components.transform.returnValues.returnValue}}`.
- Trigger für einen Datensatztyp – **On Create Incident** und Verwandte – geben genau einen Wert zurück, `model`, in den Sie hineingreifen. Bei einem Trigger mit der ID `incident-on-create-1` ist der Titel des Vorfalls `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale Variablen existieren nur während der laufenden Ausführung. Jede neue Ausführung fängt bei null an.

## Wo Variablen funktionieren

Fast jedes Textfeld nimmt Variablen entgegen:

- Die URL an einem API-Baustein.
- Der Nachrichtentext bei Slack, Teams, Discord, Telegram, E-Mail.
- Betreff und Text einer E-Mail.
- Header- und Body-Felder (innerhalb von String-Werten).
- Beide Seiten eines Bausteins **If / Else** (zu finden unter der Kategorie Conditions).

In JSON-Feldern können Sie eine Variable innerhalb eines String-Werts verwenden, aber nicht als Schlüssel. Eine Referenz, die allein einen ganzen Wert ausfüllt, wird nackt eingesetzt – so bekommen Sie ein komplettes Objekt in ein JSON-Feld hinein. Wenn Sie eine Struktur dynamisch aufbauen müssen, bauen Sie sie in einem Baustein **Run Custom JavaScript** und geben dessen Ausgabe an den nächsten Baustein weiter.

Der Baustein **Run Custom JavaScript** bekommt Variablen nicht automatisch – in die Sandbox wird nichts hineingereicht. Tragen Sie `{{global.variables.NAME}}` (oder eine beliebige Komponentenreferenz) in das JSON-Feld **Arguments** des Bausteins ein; diese Werte werden vor dem Lauf des Skripts eingesetzt und kommen als `args` an.

## Über Arrays iterieren

In einem Textfeld können Sie mit `{{#each path}}…{{/each}}` über ein Array laufen. Innerhalb des Blocks liest `{{property}}` aus dem aktuellen Element, `{{@index}}` ist die nullbasierte Position, und `{{this}}` ist bei Arrays einfacher Werte das Element selbst. Namen innerhalb eines `{{#each}}`-Blocks werden getrimmt, überzählige Leerzeichen sind dort also harmlos – anders als überall sonst.

## Beispiele

### Eine Payload aus einem Webhook bauen

Ein Webhook kommt mit einem Body wie `{ "service": "checkout", "status": "failed" }` an. Um daraus einen OneUptime-Vorfall zu machen:

1. Trigger **Webhook** mit der ID `ci-webhook`.
2. Baustein **If / Else**: Wählen Sie die Ausgabe Request Body des Webhooks und nutzen Sie deren Eigenschaft `status`, Operator `==`, rechts `failed`.
3. Aus dem Zweig **Ja** heraus ein Baustein **Create One Incident** mit:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beschreibung: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Ein Geheimnis in einem API-Aufruf verwenden

Ein Workflow, der PagerDuty aufruft:

1. Speichern Sie `PAGERDUTY_KEY` als geheime globale Variable.
2. Setzen Sie am Baustein **API** den Header `Authorization` auf `Token token={{global.variables.PAGERDUTY_KEY}}`.

Der Schlüssel bleibt aus dem Workflow und aus den Protokollen heraus.

### Zwei API-Aufrufe verketten

Der erste Aufruf liefert Ihnen eine ID, die der zweite braucht:

1. Komponente **API** `lookup-order`: Fügen Sie mit der Auswahl das E-Mail-Feld aus dem JSON des Manual-Triggers in `GET /orders?email=...` ein.
2. Komponente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Schlägt `lookup-order` fehl, feuert statt **Erfolg** der Ausgang **Fehler**. Verbinden Sie ihn mit einem E-Mail- oder Slack-Baustein, damit Fehlschläge nicht unbemerkt bleiben.

## Eine Variable aus einem Workflow heraus aktualisieren

Ein gängiges Muster ist das zeitgesteuerte Rotieren von Zugangsdaten: ein frisches Token bei einem Drittanbieter holen und es zurück in die Variable schreiben, damit die nächste Ausführung es aufgreift. Das erledigen Sie mit einem Baustein **API**, der die OneUptime-API aufruft.

`PUT /api/workflow-variable/<variable-id>` mit einem `ApiKey`-Header und – das ist die Stelle, an der alle stolpern – den zu ändernden Feldern **eingepackt in ein `data`-Objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Ein flacher Body ohne die `data`-Hülle wird mit einem 400 abgelehnt. Schicken Sie nur die Felder, die Sie wirklich ändern wollen; `name` und `description` dürfen aus der Payload herausbleiben.

Der API-Schlüssel braucht **Edit Workflow Variables**. Eine Leseberechtigung ist nicht nötig – die Aktualisierung liest den Datensatz nicht zurück.

Zwei Dinge, auf die Sie achten sollten:

- **Benennen Sie keine Variable um, die Sie referenzieren.** `name` ist Teil von `{{local.variables.NAME}}`. Ändern Sie ihn, bleibt jede bestehende Referenz unaufgelöst, und eine unaufgelöste Referenz wird als wörtlicher Text durchgereicht – siehe die Stolperfalle weiter unten.
- **Eine Variable lässt sich so schreiben, aber nie zurücklesen.** `content` ist über die API bei jeder Variablen nur beschreibbar, ob geheim oder nicht. Genau das macht eine Variable zu einem sicheren Ort für ein rotierendes Token. Sie als geheim zu markieren, hält den Wert zusätzlich aus Ausführungsprotokollen und Schritt-Traces heraus.

## Stolperfallen

- **Nutzen Sie die Auswahlfelder.** Sie fügen genau die Komponenten-, Rückgabewert- und Variablen-IDs ein, die der Runner erwartet, und halten Referenzen unabhängig von Anzeigebezeichnungen.
- **Bei Variablennamen zählt Groß- und Kleinschreibung.** `{{global.variables.MyKey}}` und `{{global.variables.mykey}}` sind zwei verschiedene Dinge.
- **Eine Referenz, die sich nicht auflösen lässt, bleibt stehen und wird nicht geleert.** Auf etwas zu verweisen, das es nicht gibt, ist kein Fehler – und Sie bekommen auch keine leere Zeichenkette: Die geschweiften Klammern werden unverändert durchgereicht. `{{local.components.api-get-1.returnValues.body}}` mit einer vertippten Schritt-ID landet also wörtlich in Ihrer Slack-Nachricht, Ihrer URL oder Ihrem Request-Body, und die Ausführung meldet trotzdem **Executed**. Das Ausführungsprotokoll enthält eine Warnzeile, die jede durchgerutschte Referenz benennt.
- **Der Builder kann Variablennamen nicht prüfen.** Er markiert Komponentenreferenzen, die er nicht zuordnen kann – eine unbekannte Schritt-ID, einen unbekannten Rückgabewert, eine fehlerhafte Wurzel –, bevor Sie speichern. Ob eine Variable existiert, kann er nicht erkennen; eine umbenannte Variable fällt daher erst im Ausführungsprotokoll auf.
- **Leerzeichen innerhalb der Klammern werden nicht entfernt.** `{{ local.variables.NAME }}` ist eine andere Suche als `{{local.variables.NAME}}` und löst sich nie auf. Die einzige Ausnahme ist innerhalb eines `{{#each}}`-Blocks, wo Namen getrimmt werden.

## Weiterführende Themen

- [Workflow-Komponenten](/docs/workflows/components) – die vollständige Liste der Ausgaben, die jeder Baustein produziert.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – den tatsächlichen Wert jeder Variablen nach einer Ausführung sehen.
- [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration) – was gefahrlos in eine globale Variable gehört.
