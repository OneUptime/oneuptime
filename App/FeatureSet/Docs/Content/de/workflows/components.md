# Komponenten

Komponenten sind die Bausteine, die Sie nach dem Auslöser hinzufügen. Jede erledigt eine Aufgabe – eine Nachricht senden, eine API aufrufen, eine Bedingung prüfen – und verbindet sich mit dem, was als Nächstes kommt.

Diese Seite ist der Katalog. Wie Sie sie auf der Arbeitsfläche hinzufügen und verbinden, erfahren Sie unter [Einen Workflow erstellen](/docs/workflows/authoring).

## API

Stellt eine HTTP-Anfrage an eine beliebige URL.

**Settings**:

- **Method** – `GET`, `POST`, `PUT`, `PATCH` oder `DELETE`.
- **URL** – die aufzurufende Adresse.
- **Headers** – alle zu sendenden Header.
- **Body** – der Request-Body für `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Erfolg** – wird ausgelöst, wenn der Aufruf erfolgreich war (2xx-Antwort). Gibt Status, Header und Body weiter.
- **Fehler** – wird bei einem Netzwerkfehler oder einer Nicht-2xx-Antwort ausgelöst. Gibt die Fehlermeldung weiter.

Verwenden Sie diese Komponente für: jede externe API, Ihre eigenen Admin-Endpunkte oder jede Integration, die keine eigene Komponente besitzt.

## KI

### Generate Text with AI

Erzeugt eine Textantwort aus einem Prompt und optionalem JSON-Kontext. Die Komponente verwendet den im Projekt konfigurierten Standard-LLM-Anbieter und greift auf den globalen Anbieter der Installation zurück, falls einer verfügbar ist. Anbieter-Zugangsdaten und Endpunkte werden zentral konfiguriert; sie sind keine Workflow-Argumente.

**Settings**:

- **System Instructions** – optionale Vorgaben für Rolle, Ton und Einschränkungen des Modells.
- **Prompt** – die erforderliche Aufgabe. Kann Workflow-Variablen und Ausgaben früherer Komponenten enthalten.
- **Context** – optionales JSON, das Sie bewusst mit der Anfrage mitschicken. Es wird nach einer expliziten Vertrauensmarkierung am Nachrichtenende angehängt und für den Rest der Nachricht als nicht vertrauenswürdige Daten behandelt.
- **Temperature** – Variation von `0` bis `1`. Der Standardwert ist `0.2` für vorhersagbare Automatisierung.
- **Maximum Output Tokens** – von `1` bis `4096`. Der Standardwert ist `1024`.

Die kombinierten System Instructions, Prompt und der serialisierte Context sind auf 50.000 Zeichen begrenzt. Die Anfrage an den Anbieter hat eine maximale Dauer von 60 Sekunden und wird einmal versucht. Pro Projekt können höchstens drei Workflow-KI-Anfragen gleichzeitig laufen.

**Outputs**:

- **Response** – der generierte Text.
- **Anbieter** und **Model** – die für den Aufruf verwendete Konfiguration.
- **Total Tokens** und **Completion Tokens** – vom Anbieter gemeldete Nutzung.
- **LLM Log ID** – der abgerechnete KI-Protokolleintrag für den Aufruf.
- **Fehler** – der Validierungs-, Zugriffs-, Anbieter-, Budget-, Abrechnungs- oder Timeout-Fehler, sofern vorhanden.

Verbinden Sie **Erfolg** mit Komponenten, die die Antwort weiterverwenden sollen. Verbinden Sie **Fehler** mit einem expliziten Fallback-, Alarm- oder Log-Pfad. Die Komponente stellt eine einzelne Modellanfrage ohne Tool-Definitionen oder anbieterseitige Capability-Felder: Sie kann OneUptime nicht selbst abfragen, keine APIs aufrufen und keine Projektdaten ändern. Abgesehen von OneUptimes festen Komponenten-Sicherheitsanweisungen werden nur die von Ihnen konfigurierten System Instructions, Prompt und Context an den Anbieter gesendet, nachdem Workflow-Variablen in diesen Feldern aufgelöst wurden. Der konfigurierte Anbieter/das Modell bleibt eine Vertrauensgrenze, weil ein Modell über intrinsische, vom Anbieter verwaltete Fähigkeiten verfügen kann.

Die Modellausgabe ist nicht vertrauenswürdiger Text. Prüfen Sie sie, bevor Sie kundenseitige Kommunikation versenden, und verwenden Sie frei formulierten KI-Text nicht allein, um destruktive Workflow-Aktionen zu autorisieren. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration) für Details zu Anbieter, Egress, Logging und Kosten.

## Webhook (ausgehend)

Eine einfachere Variante der API-Komponente für „Fire and Forget"-Anwendungsfälle. Sendet einen JSON-Body per POST an eine URL.

Verwenden Sie **API**, wenn Sie die Antwort lesen müssen. Verwenden Sie **Webhook**, wenn Sie einfach nur eine Benachrichtigung senden und weiterziehen wollen.

## Slack

Veröffentlicht eine Nachricht in einem Slack-Kanal.

**Settings**:

- **Kanal** – der Kanalname. Der Bot muss bereits Mitglied dieses Kanals sein.
- **Nachricht** – der zu sendende Text. Unterstützt Slack-Formatierung.

Verbinden Sie Slack zuerst mit Ihrem Projekt unter **Projekteinstellungen → Arbeitsbereich → Slack**. Siehe [Slack-Workspace-Verbindung](/docs/workspace-connections/slack).

## Microsoft Teams

Veröffentlicht eine Nachricht in einem Microsoft-Teams-Kanal.

**Settings**:

- **Team and channel** – wo veröffentlicht werden soll.
- **Nachricht** – der zu sendende Text.

Zur Einrichtung siehe [Microsoft-Teams-Workspace-Verbindung](/docs/workspace-connections/microsoft-teams).

## Discord

Veröffentlicht eine Nachricht in einem Discord-Kanal über eine eingehende Webhook-URL.

## Telegram

Sendet eine Nachricht in einen Telegram-Chat mithilfe eines Bot-Tokens und einer Chat-ID.

## E-Mail

Sendet eine E-Mail über OneUptime.

**Settings**:

- **An** – die E-Mail-Adresse des Empfängers.
- **Betreff** – die Betreffzeile.
- **Body** – die Nachricht in Markdown oder HTML.

Die E-Mail wird vom in Ihrem Projekt konfigurierten Absender verschickt – siehe [SMTP](/docs/emails/smtp).

## Custom Code

Führt ein kleines Stück JavaScript aus, wenn Sie etwas brauchen, das die anderen Bausteine nicht abdecken.

**Settings**:

- **Code** – Ihr JavaScript. Der letzte Wert (oder das, was Sie aus einer asynchronen Funktion zurückgeben) wird zur Ausgabe des Bausteins.
- **Arguments** – benannte Werte, die Sie übergeben können.

**Outputs**: Erfolg (Ihr Rückgabewert) und Fehler (jede Ausnahme).

Verwenden Sie diese Komponente für: Daten zwischen zwei Systemen umformen, eine kleine Berechnung durchführen, alles, was keinen eigenen Baustein verdient. Für umfangreichere Skripte verwenden Sie stattdessen ein [Runbook](/docs/runbooks/index).

## JSON

Konvertiert zwischen Text und JSON.

- **JSON → Text** – wandelt ein JSON-Objekt in eine Zeichenkette um. Praktisch, wenn der nächste Baustein Text erwartet.
- **Text → JSON** – wandelt eine Zeichenkette in ein JSON-Objekt um. Praktisch, wenn etwas als Text ankam und Sie ein Feld auslesen müssen.

## Bedingungen

Verzweigt anhand eines Vergleichs. Im Panel **Komponente hinzufügen** heißt dieser Baustein **If / Else**, unter der Kategorie Bedingungen.

**Settings**:

- **Left value** – meist ein Wert aus einem früheren Baustein.
- **Operator** – `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** – womit verglichen werden soll.

**Outputs**: **Ja** und **Nein**. Verbinden Sie die nächsten Bausteine mit dem gewünschten Zweig.

## Delay

Pausiert den Workflow für eine festgelegte Zeit, bevor er fortgesetzt wird. Nützlich, wenn Sie einem anderen System einen Moment Zeit geben müssen, um nachzuziehen.

## Protokoll

Schreibt eine Zeile in das Ausführungsprotokoll. Keine Außenwirkung – die Zeile erscheint nur in den Protokollen des Workflows, damit Sie sie nachlesen können. Hilfreich beim Debuggen.

## Execute Workflow

Ruft aus diesem Workflow heraus einen anderen Workflow auf. Der aufgerufene Workflow läuft eigenständig – Ihr Workflow fährt fort, ohne auf dessen Abschluss zu warten.

So lassen sich gemeinsame Abläufe wiederverwenden. Bauen Sie zum Beispiel einmal einen Workflow „In Vorfall-Kanal posten" und rufen Sie ihn aus jedem anderen Workflow auf, der den Kanal benachrichtigen soll.

Es gibt ein Sicherheitslimit, damit Workflows einander nicht in einer Endlosschleife aufrufen können. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration).

## OneUptime-Datenkomponenten

Für jede Art von Datensatz in OneUptime (Monitore, Vorfälle, Warnmeldungen, Statusseiten, Bereitschaftsrichtlinien und viele weitere) bietet das Panel **Komponente hinzufügen** diese Komponenten – suchen Sie einfach nach dem Namen des Typs. Jeder Titel wird aus dem Datensatztyp gebildet, für Monitor also:

- **Find One Monitor** – liest einen Datensatz, der der Query entspricht.
- **Find Many Monitors** – liest eine Liste von Datensätzen, die der Query entsprechen.
- **Create One Monitor** – legt einen Datensatz aus einem JSON-Objekt an.
- **Create Many Monitors** – legt mehrere Datensätze aus einem JSON-Array an.
- **Update One Monitor** – wendet den Schreib-Payload auf einen passenden Datensatz an.
- **Update Many Monitors** – wendet den Schreib-Payload auf passende Datensätze an, bis zum Limit.
- **Delete One Monitor** – löscht einen passenden Datensatz.
- **Delete Many Monitors** – löscht passende Datensätze, bis zum Limit.

Dasselbe Set gibt Ihnen drei Trigger – **On Create Monitor**, **On Update Monitor** und **On Delete Monitor**. Siehe [Trigger](/docs/workflows/triggers).

Ein Typ bietet nur die Komponenten, die sein Modell erlaubt. Ein reiner Lese-Typ hat nur die beiden Find-Komponenten und sonst nichts – wenn Sie **Delete One Monitor** also nicht im Panel finden, erlaubt dieser Typ das nicht.

So kann ein Workflow OneUptime-Daten lesen und ändern. Beispiel: Ein Webhook aus Ihrem CI-Tool kann **Create One Incident** verwenden, um einen Vorfall mit den Fehlerdetails zu öffnen.

## Mit Datensätzen arbeiten

Jedes Feld einer Datenkomponente ist auf die eigenen **column**-Namen des Datensatzes bezogen – dieselben Namen, die die API verwendet, nicht die Beschriftungen im Dashboard-Formular. Die ID-Spalte ist `_id`. Die Schreibweise `id` wird überall als Alias akzeptiert, wo Sie einen Spaltennamen eingeben können, aber `_id` ist das, was ein Datensatz zurückgibt – das ist also das, was Sie beim Auslesen verwenden sollten:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** entscheidet, auf welche Datensätze die Komponente wirkt. Schlüssel sind Spalten, Werte sind das, womit verglichen wird:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Eine Query ist immer auf das Projekt begrenzt, in dem der Workflow läuft. Sie können nicht auf die Datensätze eines anderen Projekts zugreifen, und Sie müssen das Projekt der Query nicht selbst hinzufügen.

**JSON Object** bei Create One, **JSON Array** bei Create Many und **Data (JSON Object)** bei den Update-Komponenten enthalten die zu schreibenden Felder, auf dieselbe Weise referenziert:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Ein Schlüssel, der keine Spalte ist, wird ignoriert statt abgelehnt – das Ausführungsprotokoll nennt die verworfenen Schlüssel, schauen Sie dort nach, wenn ein Feld nicht ankommt. **Select Fields** verwendet bei den Find-Komponenten und den Triggern dieselben Spaltenschlüssel mit `true`-Werten: `{"_id": true, "name": true}`.

**Überspringen** und **Limit** sind zwei Zahlenfelder bei Find Many, Update Many und Delete Many – `Skip: 0` mit `Limit: 100` nimmt die ersten hundert Treffer. Limit ist standardmäßig `10` und begrenzt bei Update Many und Delete Many, wie viele Datensätze tatsächlich geschrieben werden, nicht nur, wie viele zurückkommen. `Items Deleted: 10` bedeutet also, dass zehn Datensätze gelöscht wurden, nicht dass zehn Treffer gefunden wurden. Erhöhen Sie Limit, wenn Sie mehr als zehn ändern möchten.

**Erfolg** und **Fehler** melden, ob die Query gelaufen ist, nicht was sie gefunden hat. Eine Query, die nichts trifft, gibt `0` zurück und verlässt die Komponente trotzdem über Erfolg – das ist kein Fehlschlag. Um abhängig davon zu verzweigen, ob etwas getroffen wurde, lesen Sie die zurückgegebene Anzahl in einem **If / Else**-Baustein aus.

## Welche Komponente soll ich verwenden?

Ein paar Faustregeln:

- Wenn es für Ihr Vorhaben einen eigenen Baustein gibt (Slack, E-Mail, einen OneUptime-Datensatz), verwenden Sie ihn – Sie erhalten eine bessere Fehlerbehandlung und klarere Protokolle.
- Für jede andere externe API verwenden Sie **API**.
- Um Text aus explizit ausgewählten Workflow-Daten zusammenzufassen, zu klassifizieren oder zu entwerfen, verwenden Sie **Generate Text with AI**.
- Um Daten zwischen Bausteinen umzuformen, verwenden Sie **Custom Code** oder **JSON**.
- Um abhängig von einem Wert unterschiedliche Aktionen auszuführen, verwenden Sie **Bedingungen**.

## Weiterführende Themen

- [Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen weitergeben.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachvollziehen, was jeder Baustein bei einer Ausführung getan hat.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) – Limits, Eigentümer und Geheimnisse.
