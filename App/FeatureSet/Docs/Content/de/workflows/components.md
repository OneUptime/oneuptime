# Komponenten

Komponenten sind die Aktionsknoten, die Sie nach einem Trigger platzieren. Jede erledigt eine Aufgabe — eine HTTP-Anfrage stellen, eine Slack-Nachricht senden, auf eine Bedingung verzweigen, ein JavaScript-Snippet ausführen — und stellt einen oder mehrere Ausgabeports bereit, mit denen sich der nächste Knoten verbinden kann.

Diese Seite ist ein Katalog. Für Verkabelungsregeln und die Arbeitsfläche selbst, siehe [Einen Workflow erstellen](/docs/workflows/authoring).

## API

Stellen Sie eine ausgehende HTTP-Anfrage an eine beliebige URL.

**Argumente**:

- **Methode** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — die Anfrage-URL. Interpoliert.
- **Request Headers** — JSON-Objekt mit Headern.
- **Request Body** — JSON- oder Text-Body für `POST` / `PUT` / `PATCH`.

**Ausgabeports**:

- `success` — feuert, wenn der Antwortstatus 2xx ist. Rückgabewerte: `response-status`, `response-headers`, `response-body`.
- `error` — feuert bei einem Netzwerkfehler oder einer Nicht-2xx-Antwort. Rückgabewert: `error`-Nachricht.

Verwenden Sie dies für: jedes Drittanbieter-REST-API, Ihre eigenen Admin-Endpoints, leichte Integrationen, für die keine dedizierte Komponente existiert.

## Webhook (ausgehend)

Ein dünner Wrapper um die API-Komponente für den häufigen „Fire-and-Forget"-Fall. Postet einen JSON-Body an eine URL und stellt ein einzelnes `success` / `error`-Paar bereit.

Bevorzugen Sie **API**, wenn Sie den Antwort-Body nachgelagert lesen müssen; bevorzugen Sie **Webhook**, wenn Sie einfach nur ein anderes System benachrichtigen möchten.

## Slack

Posten Sie eine Nachricht in einem Slack-Kanal über die Slack-Workspace-Verbindung Ihres Projekts.

**Argumente**:

- **Channel name** — der Kanal, in den gepostet werden soll. Der Bot muss bereits Mitglied dieses Kanals sein.
- **Message text** — der Body. Interpoliert; unterstützt Slack mrkdwn.

Richten Sie die Workspace-Verbindung zuerst unter **Project Settings → Workspace Connections → Slack** ein. Siehe [Slack-Workspace-Verbindung](/docs/workspace-connections/slack).

## Microsoft Teams

Posten Sie eine Nachricht in einem Microsoft Teams-Kanal über die Teams-Verbindung Ihres Projekts.

**Argumente**:

- **Team & channel** — das Ziel.
- **Message text** — der Body.

Siehe [Microsoft Teams-Workspace-Verbindung](/docs/workspace-connections/microsoft-teams) für die Einrichtung der Verbindung.

## Discord

Posten Sie eine Nachricht in einem Discord-Kanal über eine auf der Komponente konfigurierte eingehende Webhook-URL.

## Telegram

Senden Sie eine Nachricht an einen Telegram-Chat über ein Bot-Token und eine Chat-ID, die auf der Komponente konfiguriert sind.

## E-Mail

Senden Sie eine E-Mail über die SMTP-Konfiguration von OneUptime.

**Argumente**:

- **To** — Empfänger-E-Mail-Adresse.
- **Subject** — interpoliert.
- **Body** — Markdown oder HTML.

Die E-Mail wird von der konfigurierten Absenderadresse des Projekts gesendet (siehe [SMTP](/docs/emails/smtp)).

## Custom Code

Führen Sie ein JavaScript-Snippet mit Zugriff auf die Variablen des Workflows und die Rückgabewerte des vorgelagerten Knotens aus.

**Argumente**:

- **Code** — der JavaScript-Body. Der Wert des letzten Ausdrucks (oder alles, was von `(async () => { ... })()` zurückgegeben wird) wird zum Rückgabewert der Komponente.
- **Arguments** — optionale benannte Werte, die als `args` übergeben werden.

**Ausgabeports**: `success` (Rückgabewert), `error` (abgefangene Exception).

Verwenden Sie dies für: Transformieren eines Payloads zwischen zwei Systemen, eine kleine Berechnung, die keine eigene Komponente verdient, Aufruf von JS-spezifischer Logik. Umfangreichere Skripte, die innerhalb Ihrer eigenen Infrastruktur laufen müssen, gehören in einen Bash- oder JavaScript-Schritt eines [Runbooks](/docs/runbooks/index).

## JSON

Konvertieren zwischen Text und JSON.

- **JSON → Text** — serialisieren Sie ein JSON-Objekt in einen String (praktisch, um es in ein `body`-Argument einer ausgehenden Komponente zu leiten, die Text erwartet).
- **Text → JSON** — parsen Sie einen String in ein JSON-Objekt. Nützlich, wenn ein vorgelagertes API seinen Body als Text zurückgegeben hat, Sie aber ein Feld lesen müssen.

## Conditions

Verzweigen Sie auf einen Vergleich. Konfigurieren Sie:

- **Left value** — typischerweise eine interpolierte Referenz wie `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — der Wert, mit dem verglichen werden soll.

**Ausgabeports**: `yes` und `no`. Verkabeln Sie den Rest des Workflows von dem Zweig, der Ihrer Absicht entspricht.

## Schedule (Verzögerung)

Pausieren Sie einen Workflow für eine konfigurierte Dauer, bevor er fortgesetzt wird. Nützlich, wenn Sie einem externen System einen Moment geben müssen, um sich zu stabilisieren, bevor Sie seinen Zustand überprüfen.

## Log

Schreiben Sie eine Zeile in das Workflow-Ausführungsprotokoll. Reine Debugging-Hilfe; die Zeile wird auf der Ausführung erfasst und unter **Logs** sichtbar. Kein externer Seiteneffekt.

## Execute Workflow

Rufen Sie einen anderen Workflow als Unterschritt auf. Der aufgerufene Workflow läuft unabhängig (Fire-and-Forget) — die Kontrolle kehrt zum Aufrufer zurück, sobald der Aufruf abgesandt ist.

Verwenden Sie dies, um gemeinsame Logik aus mehreren Workflows herauszufaktorisieren: Bauen Sie einmal einen „Post-to-incident-channel"-Workflow und rufen Sie ihn aus jedem anderen Workflow auf, der den Kanal benachrichtigen muss.

Ein Rekursionslimit verhindert, dass Workflows sich gegenseitig in einer Endlosschleife aufrufen. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration).

## Modell-Komponenten (CRUD auf OneUptime-Entitäten)

Für jede OneUptime-Entität, die Workflows unterstützt (Monitore, Vorfälle, Warnmeldungen, Statusseiten, Bereitschaftspläne usw.), stellt die Palette automatisch die folgenden Komponenten bereit — durchsuchbar nach dem Entitätsnamen:

- **Find One {Entity}** — einen einzelnen Datensatz per Query abrufen.
- **Find {Entity}** — eine Liste von Datensätzen per Query abrufen (paginiert).
- **Create {Entity}** — einen neuen Datensatz einfügen.
- **Update {Entity}** — einen Datensatz nach ID aktualisieren.
- **Delete {Entity}** — einen Datensatz nach ID löschen.
- **Count {Entity}** — Datensätze zählen, die einer Query entsprechen.

So kann ein Workflow den OneUptime-Status lesen und schreiben, ohne die Plattform zu verlassen. Zum Beispiel: Ein Webhook von Ihrem CI-Tool ruft **Create Incident** mit der Fehlermeldung des Builds auf; oder ein geplanter Workflow führt alle fünf Minuten **Find Incident** aus und mailt eine Zusammenfassung.

## Die richtige Komponente wählen

Ein paar Faustregeln:

- Wenn eine dedizierte Komponente für das existiert, was Sie tun möchten (Slack, E-Mail, ein CRUD auf einer OneUptime-Entität), verwenden Sie sie — sie bietet besseres Error-Handling und klarere Protokolle als selbstgebaute Lösungen.
- Wenn Sie ein externes HTTP-API aufrufen müssen, für das es keine dedizierte Komponente gibt, verwenden Sie **API**.
- Wenn Sie Daten zwischen zwei Komponenten *formen* müssen, verwenden Sie **Custom Code** oder **JSON**.
- Wenn Sie verschiedene Aktionen basierend auf einem Wert ausführen müssen, verwenden Sie **Conditions**.

## Wo weiterlesen

- [Variablen](/docs/workflows/variables) — wie Sie Daten von einer Komponente in die nächste einspeisen.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) — wie Sie prüfen, was jede Komponente während einer Ausführung zurückgegeben hat.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) — Limits, Ownership und Geheimnisse.
