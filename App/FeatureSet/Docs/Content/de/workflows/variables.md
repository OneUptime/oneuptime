# Variablen

In Workflows geht es darum, Daten zu bewegen – vom Auslöser zum ersten Baustein, von einem Baustein zum nächsten und von gemeinsam genutzten Werten dorthin, wo Sie sie brauchen. Variablen sind das Mittel, mit dem diese Daten reisen.

Es gibt zwei Variablen-Geltungsbereiche, sowie Komponentenausgaben, die während einer Ausführung erzeugt werden.

## Globale Variablen

Projektweite Werte, die Sie einmal speichern und überall wiederverwenden. Denken Sie an API-Schlüssel, URLs, Kanalnamen – alles, was Sie nicht in zehn verschiedene Workflows kopieren möchten.

Sie finden sie unter **Arbeitsabläufe → Globale Variablen**. Jede hat:

- **Name** – wie Sie sie referenzieren werden. Mindestens zwei Zeichen, keine Leerzeichen, und nur Buchstaben, Zahlen, Bindestriche und Unterstriche. `UPPER_SNAKE_CASE` ist eine gute Gewohnheit, weil es in Ihren Bausteinen auffällt.
- **Beschreibung** – optional, Freitext, der Sie daran erinnert, wofür sie ist.
- **Geheimnis** – wenn aktiviert, wird der Wert aus Ausführungsprotokollen und Schritt-Traces entfernt.
- **Inhalt** – der tatsächliche Wert. Es ist ein Langtextfeld, mehrzeilige Werte funktionieren also.

Verwenden Sie eine globale Variable in jedem Workflow mit:

```
{{global.variables.NAME}}
```

Wenn Sie zum Beispiel Ihren PagerDuty-Schlüssel als `PAGERDUTY_KEY` gespeichert haben, kann jeder Baustein ihn als `{{global.variables.PAGERDUTY_KEY}}` verwenden – der Editor speichert die Referenz, und das Workflow-Logging entfernt den aufgelösten geheimen Wert.

Variablen werden erstellt und gelöscht, nicht bearbeitet. Es gibt keinen Bearbeiten-Button in der Tabelle – um einen Wert in der Oberfläche zu ändern, löschen Sie die Variable und legen sie neu an, oder aktualisieren Sie sie über die API, was am Ende dieser Seite behandelt wird. Globale Variablen und Workflow-Variablen sind ein Feature des Growth-Plans.

## Lokale Workflow-Variablen

Variablen, die auf einen Workflow begrenzt sind, verwaltet unter **Workflow-Variablen** im linken Menü dieses Workflows. Referenzieren Sie sie mit:

```
{{local.variables.NAME}}
```

## Komponentenausgaben (Daten aus früheren Bausteinen)

Jeder Auslöser und jede Komponente kann während einer Ausführung eine Ausgabe erzeugen. Verwenden Sie im Editor den Komponentenwert-Picker, um die Referenz zu erstellen, statt sie einzutippen – er fügt genau die IDs ein, die der Runner erwartet.

Referenzieren Sie die Ausgabe eines früheren Bausteins so:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` ist die **Identifier** des Bausteins – die kurze ID, die auf dem Baustein angezeigt wird, nicht der auf ihm angezeigte Name. Neue Bausteine erhalten eine wie `api-get-1`, und Sie können sie im Abschnitt **ID** des Bausteins umbenennen. Das Umbenennen zerstört jede Referenz, die bereits darauf zeigt – genau wie beim Umbenennen einer Variable. `FIELD_ID` ist die ausgewählte Rückgabewert-ID.

Beispiele:

- Nachdem eine **API**-Komponente mit der ID `lookup-user` gelaufen ist, ist ihr Statuscode `{{local.components.lookup-user.returnValues.response-status}}` und ihr Body `{{local.components.lookup-user.returnValues.response-body}}`.
- Nach einer **Run Custom JavaScript**-Komponente mit der ID `transform` liegt ihr Rückgabewert unter `{{local.components.transform.returnValues.returnValue}}`.
- Auslöser für einen Datensatztyp – **On Create Incident** und Verwandte – geben genau einen Wert zurück, `model`, in den Sie hineingehen. Für einen Auslöser mit der ID `incident-on-create-1` ist der Titel des Vorfalls `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Lokale Variablen existieren nur während der aktuellen Ausführung. Jede neue Ausführung beginnt frisch.

## Wo Variablen funktionieren

Fast jedes Textfeld akzeptiert Variablen:

- Die URL eines API-Bausteins.
- Der Nachrichtentext bei Slack, Teams, Discord, Telegram, E-Mail.
- Betreff und Text einer E-Mail.
- Header- und Body-Felder (innerhalb von Zeichenketten-Werten).
- Beide Seiten eines **If / Else**-Bausteins (gelistet unter der Kategorie Bedingungen).

In JSON-Feldern können Sie eine Variable innerhalb eines Zeichenketten-Werts verwenden, aber nicht als Schlüssel. Eine Referenz, die einen ganzen Wert für sich allein einnimmt, wird unverpackt eingesetzt, sodass Sie auf diese Weise ein ganzes Objekt in ein JSON-Feld einfügen können. Wenn Sie eine Struktur dynamisch aufbauen müssen, verwenden Sie einen **Run Custom JavaScript**-Baustein, um sie zu erstellen, und geben Sie dessen Ausgabe an den nächsten Baustein weiter.

Der Baustein **Run Custom JavaScript** erhält Variablen nicht automatisch – in die Sandbox wird nichts injiziert. Setzen Sie `{{global.variables.NAME}}` (oder eine beliebige Komponentenreferenz) in das **Arguments**-JSON-Feld des Bausteins; diese Werte werden vor dem Ausführen des Skripts eingesetzt und kommen als `args` an.

## Über Arrays iterieren

Innerhalb eines Textfelds können Sie ein Array mit `{{#each path}}…{{/each}}` durchlaufen. Innerhalb des Blocks liest `{{property}}` aus dem aktuellen Element, `{{@index}}` ist die nullbasierte Position, und `{{this}}` ist bei Arrays aus einfachen Werten das Element selbst. Namen innerhalb eines `{{#each}}`-Blocks werden getrimmt, sodass verirrte Leerzeichen dort harmlos sind – anders als überall sonst.

## Beispiele

### Eine Payload aus einem Webhook zusammenbauen

Ein Webhook kommt mit einem Body wie `{ "service": "checkout", "status": "failed" }` an. So machen Sie daraus einen OneUptime-Vorfall:

1. **Webhook**-Auslöser mit der ID `ci-webhook`.
2. **If / Else**-Baustein: Wählen Sie die Request-Body-Ausgabe des Webhooks und verwenden Sie deren Eigenschaft `status`, Operator `==`, rechts `failed`.
3. Vom **Ja**-Zweig aus ein **Create One Incident**-Baustein mit:
   - Titel: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Beschreibung: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Ein Geheimnis in einem API-Aufruf verwenden

Ein Workflow, der PagerDuty aufruft:

1. Speichern Sie `PAGERDUTY_KEY` als geheime globale Variable.
2. Setzen Sie im **API**-Baustein den `Authorization`-Header auf `Token token={{global.variables.PAGERDUTY_KEY}}`.

Der Schlüssel bleibt aus dem Workflow und den Protokollen heraus.

### Zwei API-Aufrufe verketten

Der erste Aufruf liefert Ihnen eine ID, die der zweite benötigt:

1. **API**-Komponente `lookup-order`: Verwenden Sie den Picker, um das JSON-E-Mail-Feld des manuellen Auslösers in `GET /orders?email=...` einzufügen.
2. **API**-Komponente `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Wenn `lookup-order` fehlschlägt, wird ihr **Fehler**-Ausgang statt **Erfolg** ausgelöst. Verbinden Sie diesen mit einem E-Mail- oder Slack-Baustein, damit Fehler nicht unbemerkt bleiben.

## Eine Variable aus einem Workflow aktualisieren

Ein gängiges Muster ist das planmäßige Rotieren eines Zugangsdatensatzes: Holen Sie ein frisches Token von einem Drittanbieter und speichern Sie es zurück in der Variable, damit die nächste Ausführung es übernimmt. Machen Sie das mit einem **API**-Baustein, der die OneUptime-API aufruft.

`PUT /api/workflow-variable/<variable-id>` mit einem `ApiKey`-Header, und – das ist der Teil, über den die meisten stolpern – die Felder, die Sie ändern möchten, **eingepackt in ein `data`-Objekt**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Ein flacher Body ohne den `data`-Wrapper wird mit einem 400 abgelehnt. Senden Sie nur die Felder, die Sie tatsächlich ändern möchten; `name` und `description` können im Payload weggelassen werden.

Der API-Schlüssel benötigt **Edit Workflow Variables**. Es ist keine Leseberechtigung erforderlich – das Update liest die Zeile nicht zurück.

Zwei Dinge, auf die Sie achten sollten:

- **Benennen Sie keine Variable um, die Sie referenzieren.** `name` ist Teil von `{{local.variables.NAME}}`. Eine Änderung lässt jede bestehende Referenz unaufgelöst, und eine unaufgelöste Referenz wird als wörtlicher Text durchgereicht – siehe die Stolperfalle unten.
- **Eine Variable kann so geschrieben, aber nie zurückgelesen werden.** `content` ist über die API für jede Variable nur schreibbar, geheim oder nicht. Das macht eine Variable zu einem sicheren Ort, um ein rotierendes Token zu parken. Sie als geheim zu markieren, hält den Wert zusätzlich aus Ausführungsprotokollen und Schritt-Traces heraus.

## Stolperfallen

- **Nutzen Sie die Picker.** Sie fügen genau die Komponenten-, Rückgabewert- und Variablen-IDs ein, die der Runner erwartet, und halten Referenzen unabhängig von Anzeigebeschriftungen.
- **Variablennamen unterscheiden Groß- und Kleinschreibung.** `{{global.variables.MyKey}}` und `{{global.variables.mykey}}` sind unterschiedlich.
- **Eine Referenz, die nicht aufgelöst wird, bleibt so stehen, wird nicht geleert.** Sich auf etwas Nichtexistierendes zu beziehen, ist kein Fehler, liefert aber auch keine leere Zeichenkette: Die geschweiften Klammern werden direkt durchgereicht, sodass `{{local.components.api-get-1.returnValues.body}}` mit einer falsch getippten Schritt-ID wörtlich in Ihrer Slack-Nachricht, URL oder im Request-Body landet, und die Ausführung trotzdem **Executed** meldet. Das Ausführungsprotokoll enthält eine Warnzeile, die jede durchgerutschte Referenz benennt.
- **Der Builder kann Variablennamen nicht prüfen.** Er markiert Komponentenreferenzen, die er nicht zuordnen kann – eine unbekannte Schritt-ID, ein unbekannter Rückgabewert, eine fehlerhafte Wurzel – bevor Sie speichern. Er kann nicht erkennen, ob eine Variable existiert, sodass eine umbenannte Variable nur im Ausführungsprotokoll auffällt.
- **Leerzeichen innerhalb der geschweiften Klammern werden nicht entfernt.** `{{ local.variables.NAME }}` ist eine andere Abfrage als `{{local.variables.NAME}}` und wird nie aufgelöst. Die einzige Ausnahme ist innerhalb eines `{{#each}}`-Blocks, wo Namen getrimmt werden.

## Weiterführende Themen

- [Komponenten](/docs/workflows/components) – die vollständige Liste der Ausgaben, die jeder Baustein produziert.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – sehen Sie nach einer Ausführung den tatsächlichen Wert jeder Variablen.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) – was sicher in eine globale Variable gehört.
