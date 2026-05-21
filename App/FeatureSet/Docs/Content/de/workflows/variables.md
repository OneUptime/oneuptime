# Variablen

In Workflows geht es darum, Daten zu bewegen – vom Auslöser zum ersten Baustein, von einem Baustein zum nächsten und von gemeinsam genutzten Werten dorthin, wo Sie sie brauchen. Variablen sind das Mittel, mit dem diese Daten reisen.

Es gibt zwei Arten, beide nutzen dieselbe Syntax.

## Globale Variablen

Projektweite Werte, die Sie einmal speichern und überall wiederverwenden. Denken Sie an API-Schlüssel, URLs, Kanalnamen – alles, was Sie nicht in zehn verschiedene Workflows kopieren möchten.

Sie finden sie unter **Workflows → Globale Variablen**. Jede Variable hat:

- **Name** – wie Sie sie referenzieren. Verwenden Sie `UPPER_SNAKE_CASE`, damit sie in Ihren Bausteinen hervorsticht.
- **Wert** – der tatsächliche Wert. Mehrzeilige Werte sind ebenfalls möglich.
- **Ist geheim** – wenn aktiv, wird der Wert nach dem Speichern in der Oberfläche ausgeblendet und auch in den Ausführungslogs verborgen.

Verwenden Sie eine globale Variable in jedem Workflow mit:

```
{{variable.NAME}}
```

Wenn Sie zum Beispiel Ihren PagerDuty-Schlüssel als `PAGERDUTY_KEY` gespeichert haben, kann jeder Baustein ihn als `{{variable.PAGERDUTY_KEY}}` verwenden – der echte Schlüssel taucht weder im Workflow noch in dessen Logs auf.

## Lokale Variablen (Daten aus früheren Bausteinen)

Lokale Variablen sind die Ausgaben von Bausteinen, die in dieser Ausführung bereits gelaufen sind. Jeder Auslöser und jede Komponente produziert eine Ausgabe, die Sie lesen können.

So referenzieren Sie die Ausgabe eines früheren Bausteins:

```
{{BlockName.fieldName}}
```

`BlockName` ist der Name des Auslösers oder der Komponente auf der Arbeitsfläche (Sie können ihn in etwas Kurzes und Klares umbenennen). `fieldName` ist das, was dieser Baustein erzeugt.

Beispiele:

- Nach einem **API**-Baustein namens `LookupUser` können Sie den Statuscode als `{{LookupUser.response-status}}` und den Body als `{{LookupUser.response-body}}` lesen.
- Nach einem Auslöser **Vorfall → Bei Erstellung** namens `Incident` können Sie `{{Incident.title}}`, `{{Incident.description}}` und alle weiteren Felder des Vorfalls lesen.
- Nach einem Baustein **Benutzerdefinierter Code** namens `Transform` liegt der Rückgabewert unter `{{Transform.value}}`.

Lokale Variablen existieren nur während der aktuellen Ausführung. Jede neue Ausführung beginnt frisch.

## Wo Variablen funktionieren

Fast jedes Textfeld akzeptiert Variablen:

- Die URL eines API-Bausteins.
- Der Nachrichtentext in Slack, Teams, Discord, Telegram, E-Mail.
- Betreff und Body einer E-Mail.
- Header und Body-Felder (innerhalb von Zeichenketten-Werten).
- Beide Seiten eines Bedingungs-Bausteins.

Reine JSON-Felder akzeptieren Variablen innerhalb von Zeichenketten-Werten, aber Sie können keine Variable als Schlüssel verwenden. Wenn Sie eine Struktur dynamisch aufbauen müssen, nutzen Sie einen Baustein **Benutzerdefinierter Code**, um sie zu erstellen, und geben Sie dessen Ausgabe an den nächsten Baustein weiter.

Der Baustein **Benutzerdefinierter Code** liest Variablen anders – globale Variablen kommen über `args.variables` herein, und Sie entscheiden, welche früheren Ausgaben Sie als Argumente übergeben.

## Beispiele

### Eine Payload aus einem Webhook zusammenbauen

Ein Webhook kommt mit einem Body wie `{ "service": "checkout", "status": "failed" }` an. So machen Sie daraus einen OneUptime-Vorfall:

1. **Webhook**-Auslöser namens `CIWebhook`.
2. **Bedingungen**-Baustein: links `{{CIWebhook.Request Body.status}}`, Operator `==`, rechts `failed`.
3. Im **Ja**-Zweig ein Baustein **Vorfall erstellen** mit:
   - Titel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beschreibung: `See {{CIWebhook.Request Body.url}} for the logs.`

### Ein Geheimnis in einem API-Aufruf verwenden

Ein Workflow, der PagerDuty aufruft:

1. Speichern Sie `PAGERDUTY_KEY` als geheime globale Variable.
2. Setzen Sie im **API**-Baustein den `Authorization`-Header auf `Token token={{variable.PAGERDUTY_KEY}}`.

Der Schlüssel bleibt aus dem Workflow und den Logs heraus.

### Zwei API-Aufrufe verketten

Der erste Aufruf liefert eine ID, die der zweite benötigt:

1. **API**-Baustein `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-Baustein `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Wenn `LookupOrder` fehlschlägt, wird statt **Erfolg** der Ausgang **Fehler** ausgelöst. Verbinden Sie diesen mit einem E-Mail- oder Slack-Baustein, damit Fehler nicht unbemerkt bleiben.

## Stolperfallen

- **Das Umbenennen eines Bausteins zerstört Referenzen.** Wenn Sie einen Baustein umbenennen, aktualisieren Sie jede Stelle, an der er verwendet wird. Im Ausführungslog erscheint eine nicht aufgelöste Referenz wörtlich als `{{BlockName.field}}`.
- **Variablennamen unterscheiden Groß- und Kleinschreibung.** `{{variable.MyKey}}` und `{{variable.mykey}}` sind verschieden.
- **Fehlende Felder werden zu leeren Werten.** Eine Referenz auf ein nicht existierendes Feld liefert eine leere Zeichenkette, keinen Fehler. Bequem – aber das kann Fehler verstecken. Prüfen Sie wichtige Felder mit einem Baustein **Bedingungen**, bevor Sie weitermachen.

## Weiterführende Themen

- [Komponenten](/docs/workflows/components) – die vollständige Liste der Ausgaben, die jeder Baustein produziert.
- [Ausführungen & Logs](/docs/workflows/runs-and-logs) – sehen Sie nach einer Ausführung den tatsächlichen Wert jeder Variablen.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) – was sicher in eine globale Variable gehört.
