# Komponenten

Komponenten sind die Bausteine, die Sie nach dem Trigger hinzufügen. Jede tut genau eine Sache – eine Nachricht senden, eine API aufrufen, eine Bedingung prüfen – und verbindet sich mit dem, was als Nächstes kommt.

Diese Seite ist der Katalog. Wie Sie sie auf der Arbeitsfläche hinzufügen und verbinden, steht unter [Einen Workflow erstellen](/docs/workflows/authoring).

## API

Stellen Sie eine HTTP-Anfrage an eine beliebige URL.

**Einstellungen**:

- **Method** – `GET`, `POST`, `PUT`, `PATCH` oder `DELETE`.
- **URL** – die Adresse, die aufgerufen wird.
- **Headers** – die Header, die mitgeschickt werden sollen.
- **Body** – der Anfragetext für `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Erfolg** – feuert, wenn der Aufruf geklappt hat (2xx-Antwort). Reicht Status, Header und Body weiter.
- **Fehler** – feuert bei einem Netzwerkfehler oder einer Antwort außerhalb von 2xx. Reicht die Fehlermeldung weiter.

Gut geeignet für: jede externe API, Ihre eigenen Admin-Endpunkte oder jede Integration, die keine eigene Komponente hat.

## AI

### Generate Text with AI

Erzeugt aus einem Prompt und optionalem JSON-Kontext eine Textantwort. Die Komponente nutzt den im Projekt konfigurierten Standard-LLM-Anbieter und fällt auf den globalen Anbieter der Installation zurück, sofern es einen gibt. Zugangsdaten und Endpunkte der Anbieter werden zentral konfiguriert; sie sind keine Workflow-Argumente.

**Einstellungen**:

- **System Instructions** – optionale Vorgaben zu Rolle, Ton und Grenzen des Modells.
- **Prompt** – die eigentliche Aufgabe, Pflichtfeld. Er darf Workflow-Variablen und Ausgaben früherer Komponenten enthalten.
- **Context** – optionales JSON, das Sie bewusst mit der Anfrage mitschicken. Es wird nach einer ausdrücklichen Vertrauensmarkierung am Nachrichtenende angehängt und im weiteren Verlauf der Nachricht als nicht vertrauenswürdige Daten behandelt.
- **Temperature** – Streuung von `0` bis `1`. Der Standard ist `0.2`, damit die Automatisierung vorhersehbar bleibt.
- **Maximum Output Tokens** – von `1` bis `4096`. Der Standard ist `1024`.

System Instructions, Prompt und serialisierter Context sind zusammen auf 50.000 Zeichen begrenzt. Die Anfrage an den Anbieter dauert höchstens 60 Sekunden und wird genau einmal versucht. Pro Projekt laufen höchstens drei KI-Anfragen aus Workflows gleichzeitig.

**Outputs**:

- **Response** – der erzeugte Text.
- **Anbieter** und **Model** – die für den Aufruf verwendete Konfiguration.
- **Total Tokens** und **Completion Tokens** – die vom Anbieter gemeldete Nutzung.
- **LLM Log ID** – der abgerechnete KI-Protokolleintrag für den Aufruf.
- **Fehler** – der Validierungs-, Zugriffs-, Anbieter-, Budget-, Abrechnungs- oder Timeout-Fehler, sofern vorhanden.

Verbinden Sie **Erfolg** mit den Komponenten, welche die Antwort nutzen sollen. Verbinden Sie **Fehler** mit einem ausdrücklichen Ausweichpfad, einer Warnung oder einer Protokollierung. Die Komponente stellt genau eine Modellanfrage, ohne Tool-Definitionen und ohne anbietereigene Capability-Felder: Sie kann von sich aus weder OneUptime abfragen noch APIs aufrufen noch Projektdaten ändern. Außer den festen Sicherheitsanweisungen, die OneUptime der Komponente mitgibt, gehen nur die von Ihnen konfigurierten System Instructions, Prompt und Context an den Anbieter – nachdem die Workflow-Variablen in diesen Feldern aufgelöst wurden. Der konfigurierte Anbieter und das Modell bleiben eine Vertrauensgrenze, weil ein Modell eigene, vom Anbieter verwaltete Fähigkeiten haben kann.

Die Ausgabe des Modells ist nicht vertrauenswürdiger Text. Prüfen Sie sie, bevor Sie Kundenkommunikation verschicken, und autorisieren Sie zerstörerische Workflow-Aktionen niemals allein mit freiem KI-Text. Details zu Anbietern, ausgehendem Datenverkehr, Protokollierung und Kosten finden Sie unter [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration).

## Webhook (ausgehend)

Eine einfachere Variante der API-Komponente für Fälle nach dem Motto „abschicken und vergessen“. Sie postet einen JSON-Body an eine URL.

Nehmen Sie **API**, wenn Sie die Antwort lesen müssen. Nehmen Sie **Webhook**, wenn Sie nur eine Benachrichtigung abschicken und weitermachen wollen.

## Slack

Eine Nachricht in einen Slack-Kanal posten.

**Einstellungen**:

- **Kanal** – der Name des Kanals. Der Bot muss bereits in diesem Kanal sein.
- **Nachricht** – der zu sendende Text. Slack-Formatierung wird unterstützt.

Verbinden Sie Slack zuerst mit Ihrem Projekt unter **Projekteinstellungen → Arbeitsbereich → Slack**. Siehe [Slack-Workspace-Verbindung](/docs/workspace-connections/slack).

## Microsoft Teams

Eine Nachricht in einen Microsoft-Teams-Kanal posten.

**Einstellungen**:

- **Team and channel** – wohin gepostet wird.
- **Nachricht** – der zu sendende Text.

Zur Einrichtung siehe [Microsoft-Teams-Workspace-Verbindung](/docs/workspace-connections/microsoft-teams).

## Discord

Eine Nachricht über eine Incoming-Webhook-URL in einen Discord-Kanal posten.

## Telegram

Eine Nachricht mit einem Bot-Token und einer Chat-ID an einen Telegram-Chat senden.

## Email

Eine E-Mail über OneUptime versenden.

**Einstellungen**:

- **An** – die E-Mail-Adresse des Empfängers.
- **Betreff** – die Betreffzeile.
- **Body** – die Nachricht in Markdown oder HTML.

Die E-Mail geht von dem in Ihrem Projekt konfigurierten Absender raus – siehe [SMTP](/docs/emails/smtp).

## Custom Code

Führen Sie ein kleines Stück JavaScript aus, wenn Sie etwas brauchen, das die anderen Bausteine nicht können.

**Einstellungen**:

- **Code** – Ihr JavaScript. Der letzte Wert (oder das, was Sie aus einer async-Funktion zurückgeben) wird zur Ausgabe des Bausteins.
- **Arguments** – benannte Werte, die Sie hineinreichen können.

**Outputs**: Erfolg (Ihr Rückgabewert) und Fehler (jede Ausnahme).

Gut geeignet für: Daten zwischen zwei Systemen umformen, eine kleine Berechnung anstellen, alles, was keinen eigenen Baustein verdient. Für umfangreicheres Skripting nehmen Sie stattdessen ein [Runbook](/docs/runbooks/index).

## JSON

Zwischen Text und JSON umwandeln.

- **JSON → Text** – ein JSON-Objekt in eine Zeichenkette verwandeln. Praktisch, wenn der nächste Baustein Text erwartet.
- **Text → JSON** – eine Zeichenkette in ein JSON-Objekt parsen. Praktisch, wenn etwas als Text angekommen ist und Sie ein Feld daraus lesen müssen.

## Conditions

Anhand eines Vergleichs verzweigen. Im Panel **Komponente hinzufügen** heißt dieser Baustein **If / Else** und steht unter der Kategorie Conditions.

**Einstellungen**:

- **Left value** – meist ein Wert aus einem früheren Baustein.
- **Operator** – `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** – womit verglichen wird.

**Outputs**: **Ja** und **Nein**. Verbinden Sie die nächsten Bausteine mit dem Zweig, den Sie brauchen.

## Delay

Den Workflow für eine festgelegte Zeit anhalten, bevor es weitergeht. Praktisch, wenn Sie einem anderen System einen Moment zum Nachziehen geben müssen.

## Log

Eine Zeile ins Ausführungsprotokoll schreiben. Keine Wirkung nach außen – sie taucht einfach in den Protokollen des Workflows auf, damit Sie sie lesen können. Praktisch zur Fehlersuche.

## Execute Workflow

Aus diesem Workflow heraus einen anderen aufrufen. Der aufgerufene Workflow läuft eigenständig – Ihr Workflow macht weiter, ohne auf dessen Ende zu warten.

So teilen Sie gemeinsame Logik. Bauen Sie einmal einen Workflow „in den Vorfallskanal posten“ und rufen Sie ihn aus jedem anderen Workflow auf, der den Kanal benachrichtigen muss.

Es gibt eine Sicherheitsgrenze, damit Workflows sich nicht endlos gegenseitig aufrufen können. Siehe [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration).

## OneUptime-Datenkomponenten

Für jede Art von Datensatz in OneUptime (Monitore, Vorfälle, Warnungen, Statusseiten, Bereitschaftsrichtlinien und viele mehr) hält das Panel **Komponente hinzufügen** diese Komponenten bereit – suchen Sie nach dem Namen des Typs. Jeder Titel wird aus dem Datensatztyp erzeugt, für Monitor lautet der Satz also:

- **Find One Monitor** – einen Datensatz lesen, der zur Abfrage passt.
- **Find Many Monitors** – eine Liste von Datensätzen lesen, die zur Abfrage passen.
- **Create One Monitor** – einen Datensatz aus einem JSON-Objekt anlegen.
- **Create Many Monitors** – mehrere Datensätze aus einem JSON-Array anlegen.
- **Update One Monitor** – die Schreib-Payload auf einen passenden Datensatz anwenden.
- **Update Many Monitors** – die Schreib-Payload auf die passenden Datensätze anwenden, bis zur Grenze aus Limit.
- **Delete One Monitor** – einen passenden Datensatz löschen.
- **Delete Many Monitors** – die passenden Datensätze löschen, bis zur Grenze aus Limit.

Derselbe Satz liefert Ihnen drei Trigger – **On Create Monitor**, **On Update Monitor** und **On Delete Monitor**. Siehe [Workflow-Trigger](/docs/workflows/triggers).

Ein Typ bietet nur die Komponenten an, die sein Modell zulässt. Ein nur lesbarer Typ hat die beiden Find-Komponenten und sonst nichts – wenn Sie also **Delete One Monitor** im Panel nicht finden, erlaubt dieser Typ es nicht.

So kann ein Workflow OneUptime-Daten lesen und ändern. Zum Beispiel: Ein Webhook aus Ihrem CI-Tool kann mit **Create One Incident** einen Vorfall mit den Fehlerdetails eröffnen.

## Mit Datensätzen arbeiten

Jedes Feld einer Datenkomponente arbeitet mit den **Spaltennamen** des Datensatzes selbst – denselben Namen, die auch die API verwendet, nicht den Beschriftungen im Dashboard-Formular. Die ID-Spalte heißt `_id`. Die Schreibweise `id` wird überall dort als Alias akzeptiert, wo Sie einen Spaltennamen eintippen können, aber ein Datensatz gibt `_id` zurück – das ist es also, was Sie beim Auslesen verwenden:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** entscheidet, auf welche Datensätze die Komponente wirkt. Die Schlüssel sind Spalten, die Werte das, worauf verglichen wird:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Eine Abfrage ist immer auf das Projekt beschränkt, in dem der Workflow läuft. Sie erreichen die Datensätze eines anderen Projekts nicht, und Sie müssen das Projekt auch nicht selbst in die Abfrage schreiben.

**JSON Object** bei Create One, **JSON Array** bei Create Many und **Data (JSON Object)** bei den Update-Komponenten enthalten die zu schreibenden Felder, mit denselben Schlüsseln:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Ein Schlüssel, der keine Spalte ist, wird ignoriert statt abgelehnt – das Ausführungsprotokoll nennt die verworfenen, schauen Sie also dort nach, wenn ein Feld nicht ankommt. **Select Fields** an den Find-Komponenten und den Triggern nutzt dieselben Spaltenschlüssel mit dem Wert `true`: `{"_id": true, "name": true}`.

**Skip** und **Limit** sind zwei Zahlenfelder an Find Many, Update Many und Delete Many – `Skip: 0` zusammen mit `Limit: 100` nimmt die ersten hundert Treffer. Limit steht standardmäßig auf `10`, und bei Update Many und Delete Many begrenzt es, wie viele Datensätze tatsächlich geschrieben werden, nicht nur, wie viele zurückkommen. `Items Deleted: 10` heißt also, dass zehn Datensätze gelöscht wurden, nicht dass zehn gepasst haben. Erhöhen Sie Limit, wenn Sie mehr als zehn ändern wollen.

**Erfolg** und **Fehler** melden, ob die Abfrage gelaufen ist, nicht was sie gefunden hat. Eine Abfrage ohne Treffer liefert `0` und verlässt den Baustein trotzdem über Erfolg – das ist kein Fehlschlag. Um danach zu verzweigen, ob überhaupt etwas gepasst hat, lesen Sie die zurückgegebene Anzahl in einem Baustein **If / Else** aus.

## Welche Komponente soll ich nehmen?

Ein paar schnelle Faustregeln:

- Gibt es einen eigenen Baustein für das, was Sie vorhaben (Slack, E-Mail, ein OneUptime-Datensatz), nehmen Sie ihn – Sie bekommen sauberere Fehlerbehandlung und klarere Protokolle.
- Für jede andere externe API nehmen Sie **API**.
- Um aus ausdrücklich ausgewählten Workflow-Daten zusammenzufassen, zu klassifizieren oder Text zu entwerfen, nehmen Sie **Generate Text with AI**.
- Um Daten zwischen Bausteinen umzuformen, nehmen Sie **Custom Code** oder **JSON**.
- Um je nach Wert unterschiedlich zu handeln, nehmen Sie **Conditions**.

## Weiterführende Themen

- [Workflow-Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen weitergeben.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachsehen, was jeder Baustein bei einer Ausführung getan hat.
- [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration) – Grenzen, Owners und Geheimnisse.
