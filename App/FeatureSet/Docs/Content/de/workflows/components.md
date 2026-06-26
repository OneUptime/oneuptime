# Komponenten

Komponenten sind die Bausteine, die Sie nach dem Auslöser hinzufügen. Jede erledigt eine Aufgabe – eine Nachricht senden, eine API aufrufen, eine Bedingung prüfen – und verbindet sich mit dem, was als Nächstes kommt.

Diese Seite ist der Katalog. Wie Sie die Bausteine auf der Arbeitsfläche ziehen, ablegen und verbinden, lesen Sie unter [Workflow erstellen](/docs/workflows/authoring).

## API

Stellt eine HTTP-Anfrage an eine beliebige URL.

**Einstellungen**:

- **Methode** – `GET`, `POST`, `PUT`, `PATCH` oder `DELETE`.
- **URL** – die aufzurufende Adresse.
- **Header** – alle zu sendenden Header.
- **Body** – der Anfrage-Body für `POST` / `PUT` / `PATCH`.

**Ausgänge**:

- **Erfolg** – wird ausgelöst, wenn der Aufruf geklappt hat (2xx-Antwort). Liefert Status, Header und Body weiter.
- **Fehler** – wird bei einem Netzwerkfehler oder einer Nicht-2xx-Antwort ausgelöst. Liefert die Fehlermeldung weiter.

Verwenden Sie diese Komponente für: jede externe API, Ihre eigenen Admin-Endpunkte oder jede Integration, die keine eigene Komponente besitzt.

## Webhook (ausgehend)

Eine einfachere Variante der API-Komponente für „Fire and Forget"-Anwendungsfälle. Sendet einen JSON-Body per POST an eine URL.

Verwenden Sie **API**, wenn Sie die Antwort lesen müssen. Verwenden Sie **Webhook**, wenn Sie einfach nur eine Benachrichtigung senden und weiterziehen wollen.

## Slack

Veröffentlicht eine Nachricht in einem Slack-Kanal.

**Einstellungen**:

- **Kanal** – der Kanalname. Der Bot muss bereits Mitglied im Kanal sein.
- **Nachricht** – der zu sendende Text. Unterstützt Slack-Formatierung.

Verbinden Sie Slack zuerst mit Ihrem Projekt unter **Projekteinstellungen → Workspace-Verbindungen → Slack**. Siehe [Slack-Workspace-Verbindung](/docs/workspace-connections/slack).

## Microsoft Teams

Veröffentlicht eine Nachricht in einem Microsoft-Teams-Kanal.

**Einstellungen**:

- **Team und Kanal** – wo veröffentlicht werden soll.
- **Nachricht** – der zu sendende Text.

Zur Einrichtung siehe [Microsoft-Teams-Workspace-Verbindung](/docs/workspace-connections/microsoft-teams).

## Discord

Veröffentlicht eine Nachricht in einem Discord-Kanal über eine eingehende Webhook-URL.

## Telegram

Sendet eine Nachricht in einen Telegram-Chat mithilfe eines Bot-Tokens und einer Chat-ID.

## E-Mail

Sendet eine E-Mail über OneUptime.

**Einstellungen**:

- **An** – die E-Mail-Adresse des Empfängers.
- **Betreff** – die Betreffzeile.
- **Body** – die Nachricht in Markdown oder HTML.

Die E-Mail wird vom in Ihrem Projekt konfigurierten Absender verschickt – siehe [SMTP](/docs/emails/smtp).

## Benutzerdefinierter Code

Führt ein kleines Stück JavaScript aus, wenn Sie etwas brauchen, das die anderen Bausteine nicht abdecken.

**Einstellungen**:

- **Code** – Ihr JavaScript. Der letzte Wert (oder das, was Sie aus einer asynchronen Funktion zurückgeben) wird zur Ausgabe des Bausteins.
- **Argumente** – benannte Werte, die Sie übergeben können.

**Ausgänge**: Erfolg (Ihr Rückgabewert) und Fehler (jede Ausnahme).

Verwenden Sie diese Komponente für: Daten zwischen zwei Systemen umformen, eine kleine Berechnung durchführen, alles, was keinen eigenen Baustein verdient. Für umfangreichere Skripte nutzen Sie stattdessen ein [Runbook](/docs/runbooks/index).

## JSON

Konvertiert zwischen Text und JSON.

- **JSON → Text** – wandelt ein JSON-Objekt in eine Zeichenkette um. Praktisch, wenn der nächste Baustein Text erwartet.
- **Text → JSON** – parst eine Zeichenkette in ein JSON-Objekt. Praktisch, wenn etwas als Text ankommt und Sie ein Feld auslesen müssen.

## Bedingungen

Verzweigt anhand eines Vergleichs.

**Einstellungen**:

- **Linker Wert** – meist ein Wert aus einem früheren Baustein.
- **Operator** – `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Rechter Wert** – womit verglichen werden soll.

**Ausgänge**: **Ja** und **Nein**. Verbinden Sie die nächsten Bausteine mit dem gewünschten Zweig.

## Verzögerung

Pausiert den Workflow für eine bestimmte Zeit, bevor er fortgesetzt wird. Nützlich, wenn Sie einem anderen System einen Moment Zeit geben müssen, um nachzuziehen.

## Log

Schreibt eine Zeile in das Ausführungslog. Hat keine Außenwirkung – die Zeile erscheint nur im Log des Workflows, damit Sie sie nachlesen können. Hilfreich beim Debuggen.

## Workflow ausführen

Ruft aus diesem Workflow heraus einen anderen Workflow auf. Der aufgerufene Workflow läuft eigenständig – Ihr Workflow fährt fort, ohne auf dessen Ende zu warten.

So lassen sich gemeinsame Abläufe wiederverwenden. Bauen Sie zum Beispiel einen Workflow „In Vorfall-Kanal posten" einmal und rufen Sie ihn aus jedem anderen Workflow auf, der den Kanal benachrichtigen soll.

Es gibt ein Sicherheitslimit, damit Workflows einander nicht in einer Endlosschleife aufrufen können. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration).

## OneUptime-Datenkomponenten

Für jede Art von Datensatz in OneUptime (Monitore, Vorfälle, Benachrichtigungen, Statusseiten, Rufbereitschafts-Richtlinien und viele weitere) bietet die Palette diese Komponenten – einfach nach dem Typnamen suchen:

- **Einen finden** – einen Datensatz per ID oder Filter holen.
- **Finden** – eine Liste von Datensätzen holen.
- **Erstellen** – einen neuen Datensatz anlegen.
- **Aktualisieren** – einen Datensatz ändern.
- **Löschen** – einen Datensatz entfernen.
- **Zählen** – Datensätze zählen, die einem Filter entsprechen.

So kann ein Workflow OneUptime-Daten lesen und ändern. Beispiel: Ein Webhook aus Ihrem CI-Tool kann **Vorfall erstellen** nutzen, um einen Vorfall mit den Fehlerdetails zu öffnen.

## Welche Komponente soll ich verwenden?

Ein paar Faustregeln:

- Wenn es für Ihr Vorhaben einen speziellen Baustein gibt (Slack, E-Mail, einen OneUptime-Datensatz), verwenden Sie ihn – die Fehlerbehandlung wird sauberer und die Logs werden klarer.
- Für jede andere externe API verwenden Sie **API**.
- Um Daten zwischen Bausteinen umzuformen, nutzen Sie **Benutzerdefinierter Code** oder **JSON**.
- Um abhängig von einem Wert unterschiedlich zu reagieren, nutzen Sie **Bedingungen**.

## Weiterführende Themen

- [Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen übergeben.
- [Ausführungen & Logs](/docs/workflows/runs-and-logs) – nachvollziehen, was jeder Baustein bei einer Ausführung getan hat.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) – Limits, Eigentümer und Geheimnisse.
