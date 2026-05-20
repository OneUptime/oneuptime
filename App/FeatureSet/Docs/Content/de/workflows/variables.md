# Variablen

Ein Workflow ist nur dann nützlich, wenn Daten durch ihn fließen. Variablen sind das Mittel, mit dem sich diese Daten bewegen — vom Trigger in die erste Komponente, von der Ausgabe einer Komponente in die Eingabe der nächsten und von projektweiten Geheimnissen überall dorthin, wo sie referenziert werden.

OneUptime hat zwei Arten von Variablen und eine Interpolationssyntax, die für beide funktioniert.

## Globale Variablen

Projektweite Werte, die einmal unter **Workflows → Global Variables** definiert werden. Denken Sie an API-Schlüssel, Basis-URLs, Kanalnamen — alles, was Sie nicht in zehn Workflows hartcodieren möchten.

Eine globale Variable hat:

- **Name** — der Bezeichner, mit dem Sie sie referenzieren. Verwenden Sie `UPPER_SNAKE_CASE`, damit sie in Templates offensichtlich ist.
- **Value** — der String-Wert. Mehrzeilige Werte werden unterstützt.
- **Is Secret** — wenn aktiviert, ist der Wert nach dem Speichern in der UI nur beschreibbar und wird in Ausführungsprotokollen redigiert.

Referenzieren Sie eine globale Variable von überall in jedem Workflow mit:

```
{{variable.NAME}}
```

Wenn Sie z. B. `PAGERDUTY_KEY` als geheime Variable definieren, kann jede API-Komponente, die PagerDuty aufruft, sie als `{{variable.PAGERDUTY_KEY}}` lesen, ohne dass jemand den eigentlichen Schlüssel im Workflow-JSON sieht.

## Lokale Variablen

Lokale Variablen sind die Rückgabewerte von Knoten, die in dieser Ausführung bereits gelaufen sind. Jeder Trigger und jede Komponente veröffentlicht eine — siehe [Trigger](/docs/workflows/triggers) und [Komponenten](/docs/workflows/components) für die Listen pro Knoten.

Referenzieren Sie eine lokale Variable als:

```
{{NodeId.fieldName}}
```

Die `NodeId` ist der Name des Triggers oder der Komponente auf der Arbeitsfläche (Sie können ihn aus Lesbarkeitsgründen umbenennen — halten Sie ihn kurz und `PascalCase`, damit die Referenzen sauber bleiben). Der `fieldName` ist das, was dieser Knoten veröffentlicht.

Beispiele:

- Nach einer **API**-Komponente namens `LookupUser`, die erfolgreich zurückkehrt, können nachgelagerte Knoten ihren Statuscode als `{{LookupUser.response-status}}` und den geparsten Body als `{{LookupUser.response-body}}` lesen.
- Nach einem **Incident → On Create**-Trigger namens `Incident` können Sie `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` und jede andere Spalte des Vorfalls lesen.
- Nach einer **Custom Code**-Komponente namens `Transform` wird der zurückgegebene Wert als `{{Transform.value}}` bereitgestellt.

Lokale Variablen sind auf eine einzelne Ausführung beschränkt. Die nächste Ausführung beginnt mit einer leeren Tafel.

## Wo Interpolation funktioniert

Fast jedes Textstil-Argument unterstützt Interpolation:

- URL-Felder der API-Komponente
- Nachrichtentext bei Slack / Teams / Discord / Telegram / E-Mail
- Subject und Body bei E-Mail
- Header- und Body-Felder (innerhalb von JSON-Werten verwendbar)
- Linker und rechter Operand bei Conditions

Reine JSON-Argumente akzeptieren Interpolation innerhalb von String-Werten; Sie können keinen Schlüssel interpolieren. Wenn Sie eine dynamische Struktur aufbauen müssen, verwenden Sie **Custom Code**, um den Payload zusammenzustellen, und leiten Sie dann seinen Rückgabewert in den nächsten Knoten.

Die **Custom Code**-Komponente liest Variablen anders — globale Variablen werden auf `args.variables` bereitgestellt, und vorgelagerte Rückgabewerte werden als benannte Argumente übergeben, die Sie auf der Komponente konfigurieren.

## Beispiele

### Einen Payload aus einem Trigger aufbauen

Ein Webhook empfängt ein CI-Build-Ergebnis. Der Body ist JSON wie `{ "service": "checkout", "status": "failed" }`. Um daraus einen OneUptime-Vorfall zu machen:

1. **Webhook**-Trigger namens `CIWebhook`.
2. **Conditions**-Komponente: links `{{CIWebhook.Request Body.status}}`, Operator `==`, rechts `failed`.
3. Vom `yes`-Port eine **Create Incident**-Komponente mit:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Ein Geheimnis in einem ausgehenden API-Aufruf verwenden

Ein Workflow, der PagerDuty aufruft:

1. Definieren Sie `PAGERDUTY_KEY` als geheime globale Variable.
2. Setzen Sie auf der **API**-Komponente den `Authorization`-Header auf `Token token={{variable.PAGERDUTY_KEY}}`.

Der Schlüssel erscheint nie im Workflow-JSON oder in Ausführungsprotokollen.

### Zwei API-Aufrufe verketten

Der erste Aufruf gibt eine ID zurück, die der zweite Aufruf benötigt:

1. **API**-Komponente `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-Komponente `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Wenn `LookupOrder` eine Nicht-2xx-Antwort zurückgibt, feuert sein `error`-Port anstelle von `success` — verkabeln Sie diesen Zweig mit einer E-Mail- oder Slack-Komponente, damit Fehler nicht stillschweigend bleiben.

## Ein paar Stolperfallen

- **Tippfehler in Knotennamen brechen Referenzen stillschweigend.** Wenn Sie einen Knoten nach dem Verkabeln von `{{OldName.field}}` nachgelagert umbenennen, aktualisieren Sie jede Referenz. Schauen Sie sich das Ausführungsprotokoll an — wenn Sie das wörtliche `{{OldName.field}}` im erfassten Argument sehen, wurde das Lookup nicht aufgelöst.
- **Geheimnisse sind case-sensitive.** `{{variable.MyKey}}` und `{{variable.mykey}}` sind unterschiedliche Variablen.
- **Fehlende Felder sind leer.** Eine Referenz auf `{{Foo.nonexistent}}` ergibt einen leeren String, keinen Fehler. Nützlich, aber es kann Bugs verbergen — verwenden Sie einen **Conditions**-Knoten, um die Anwesenheit zu prüfen, wenn das Feld für den nächsten Schritt erforderlich ist.

## Wo weiterlesen

- [Komponenten](/docs/workflows/components) — der vollständige Katalog der Rückgabewert-Namen.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) — inspizieren Sie den literalen Wert jedes interpolierten Arguments nach einer Ausführung.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) — was sicher in einer globalen Variable abgelegt werden kann.
