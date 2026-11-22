# Drop-Filter & Scrub-Regeln

Drop-Filter und Scrub-Regeln wirken auf Ihre Protokolle und Spans, während sie ankommen, bevor irgendetwas gespeichert wird. Ein Drop-Filter verwirft die Datensätze, die Sie nie brauchen, oder behält nur eine Stichprobe davon. Eine Scrub-Regel maskiert personenbezogene Daten und Geheimnisse wie E-Mail-Adressen, Kartennummern und Passwörter, sodass sie Ihren Speicher nie erreichen.

:::cards
- [Wo sie laufen](#wo-sie-laufen): Vor den Pipelines, vor dem Speichern.
- [Datensätze verwerfen oder Stichproben nehmen](#datensätze-verwerfen-oder-stichproben-nehmen): Datensätze abgleichen, dann verwerfen oder einen Anteil behalten.
- [Sensible Daten bereinigen](#sensible-daten-bereinigen): Schwärzen, maskieren oder hashen, was ein Muster findet.
- [Prüfen, was ein Filter verworfen hat](#prüfen-was-ein-filter-verworfen-hat): Zähler an jedem Filter.
:::

## Wo sie laufen

Protokolle haben ihre unter **Protokolle → Einstellungen** und Spans unter **Traces → Einstellungen**. Wenn ein Datensatz ankommt, führt OneUptime sie in dieser Reihenfolge aus:

```mermaid title="Was mit einem Protokoll oder Span beim Ankommen passiert"
flowchart TB
    arrive["Ein Protokoll oder<br/>Span kommt an"] --> drop{"Verwirft ihn ein<br/>Drop-Filter?"}
    drop -->|"Ja"| gone["Verworfen:<br/>nie gespeichert"]
    drop -->|"Nein"| scrub["Scrub-Regeln maskieren,<br/>was sie finden"]
    scrub --> pipelines["Pipelines ändern<br/>den Datensatz"]
    pipelines --> stored["Gespeichert und<br/>durchsuchbar"]
```

- **Sie wirken nur auf neue Datensätze.** Eine Regel, die Sie anlegen oder ändern, gilt für Datensätze, die etwa eine Minute später ankommen. Bereits gespeicherte Datensätze werden nicht verändert.
- **Ein verworfener Datensatz ist weg.** Keine Suche, kein Diagramm, kein Monitor und keine Aufzeichnungsregel sieht ihn je, und es entsteht keine Ausnahme aus ihm. In OneUptime Cloud wird er auch nicht abgerechnet.
- **Jede Liste läuft der Reihe nach.** Ziehen Sie die Zeilen einer Liste, um die Reihenfolge zu ändern. Nur aktivierte Filter und Regeln laufen.

Drop-Filter und Scrub-Regeln für Protokolle gelten gleichermaßen für Protokolle aus OpenTelemetry, Syslog, Fluent Bit und Fluentd. [Protokoll-Pipelines](/docs/telemetry/log-pipelines) erklärt den Schritt danach.

## Bevor Sie beginnen

- **Protokolle oder Spans, die ankommen.** Siehe [OpenTelemetry](/docs/telemetry/open-telemetry).
- **Eine Rolle, die Telemetrie-Einstellungen ändern darf.** Projektinhaber oder Projektadministrator, oder eine eigene Rolle mit der Berechtigung für das, was Sie ändern, etwa Create Log Drop Filter oder Create Trace Scrub Rule. Die Telemetrie-Rollen sehen Filter und Regeln, können sie aber nicht ändern.

## Datensätze verwerfen oder Stichproben nehmen

:::steps
### Drop-Filter öffnen

Gehen Sie zu **Protokolle → Einstellungen → Drop-Filter**, oder für Spans zu **Traces → Einstellungen → Drop-Filter**.

### Die Datensätze abgleichen

Klicken Sie auf **Protokoll-Drop-Filter erstellen**, oder für Spans auf **Trace-Drop-Filter erstellen**. Geben Sie dem Filter unter **Übereinstimmung** einen **Name** und bauen Sie dann seine **Filterabfrage**: ein Feld, einen Operator und einen Wert für jede Bedingung, und ob **Alle Bedingungen** oder **Eine beliebige Bedingung** zutreffen müssen. Klicken Sie auf **Weiter**.

### Die Aktion wählen

Behalten Sie unter **Aktion** die Option **Verwerfen**, um jeden passenden Datensatz zu verwerfen, oder wählen Sie **Stichprobe** und geben Sie unter **Stichprobenprozentsatz** an, wie viel Prozent behalten werden, von 1 bis 99. Legen Sie den Filter dann an.
:::

Der Filter beginnt innerhalb einer Minute zu verwerfen. Um ihn zu speichern, ohne schon etwas zu verwerfen, schalten Sie **Aktiviert** unter **Erweitert** aus, bevor Sie ihn anlegen.

> [!WARNING]
> Ein verworfener Datensatz lässt sich nicht zurückholen. Halten Sie die Abfrage eines Filters eng, und beobachten Sie nach dem Anlegen seinen Zähler **Verworfen**.

Ein Filter kann diese Felder prüfen, und jedes Attribut über **Benutzerdefiniertes Attribut...**:

| Datensätze | Felder |
| --- | --- |
| Protokolle | **Schweregrad**, **Protokolltext**, **Dienst-ID** |
| Spans | **Span-Name**, **Span-Art**, **Status**, **Statusmeldung**, **Dienst-ID**, **Hat Ausnahme**, **Ist Root-Span** |

| Operator | Trifft zu auf |
| --- | --- |
| **entspricht** | Den genauen Wert, mit Groß- und Kleinschreibung: `Debug` trifft zu, `DEBUG` nicht. |
| **ist nicht gleich** | Alles außer dem genauen Wert. |
| **enthält** | Den Wert irgendwo im Feld, ohne Rücksicht auf Groß- und Kleinschreibung. Ein `%` im Wert ist ein Platzhalter. |
| **ist eines von** | Einen aus einer Liste genauer Werte, durch Kommas getrennt. |

**Abfragevorschau** zeigt die Abfrage, die aus den Bedingungen entsteht. Diese verwirft die Debug-Zeilen eines Health Checks:

```text
severityText = 'Debug' AND body LIKE 'healthcheck'
```

Stichproben werden Datensatz für Datensatz entschieden: Bei einem **Stichprobenprozentsatz** von 10 wird etwa einer von zehn passenden Datensätzen behalten. Filter laufen in der Reihenfolge der Liste, und der erste, der einen Datensatz verwirft, entscheidet; ein Datensatz, den eine Stichprobe behält, geht weiter zum nächsten Filter.

## Sensible Daten bereinigen

:::steps
### Scrub-Regeln öffnen

Gehen Sie zu **Protokolle → Einstellungen → Scrub-Regeln**, oder für Spans zu **Traces → Einstellungen → Scrub-Regeln**.

### Wählen, was gefunden werden soll

Klicken Sie auf **Scrub-Regel für Protokolle erstellen**, oder für Spans auf **Scrub-Regel für Traces erstellen**, und wählen Sie einen **Mustertyp**. Die Regel wird danach benannt, etwa **E-Mail-Adressen bereinigen**, bis Sie einen eigenen Namen eingeben. Für **Benutzerdefinierter Regex** füllen Sie auch **Benutzerdefiniertes Regex-Muster** aus.

### Wählen, wie bereinigt wird

Wählen Sie unter **Erweitert** die **Bereinigungsaktion** und die Felder unter **Zu bereinigende Felder**, oder lassen Sie beides, wie es ist: Eine neue Regel ersetzt jeden Treffer durch `[REDACTED]`, wo immer er im Datensatz steht. Legen Sie die Regel dann an.
:::

| Mustertyp | Was er findet |
| --- | --- |
| **E-Mail-Adresse** | E-Mail-Adressen wie `jane@example.com` |
| **Kreditkartennummer** | Sechzehn Ziffern in Vierergruppen, wie `4111 1111 1111 1111` |
| **SSN (Sozialversicherungsnummer)** | US-Sozialversicherungsnummern wie `123-45-6789` |
| **Telefonnummer** | Nordamerikanische Telefonnummern wie `555-123-4567` |
| **IP-Adresse** | Öffentliche IPv4- und IPv6-Adressen wie `203.0.113.7` oder `2001:db8::1`, aber keine privaten, Loopback- oder Link-local-Adressen |
| **Sensible Attributschlüssel** | Den ganzen Wert jedes Attributs, dessen Schlüssel geheim aussieht, wie `password`, `token`, `api_key`, `authorization` oder `cookie` |
| **Benutzerdefinierter Regex** | Ihr eigener regulärer Ausdruck, ohne Schrägstriche oder Flags geschrieben, und mit Groß- und Kleinschreibung abgeglichen |

| Bereinigungsaktion | Was aus einem Treffer wird |
| --- | --- |
| **Schwärzen** | `[REDACTED]`, die Voreinstellung |
| **Maske** | Größtenteils verborgen: Eine E-Mail behält ihren ersten Buchstaben und das Ende ihrer Domain, eine Karten-, Telefon- oder Sozialversicherungsnummer ihre letzten vier Ziffern, und ein eigener Treffer oder ein geheimer Wert sein erstes und letztes Zeichen. Eine IP-Adresse wird ganz verborgen. |
| **Hash** | Ein Token, das es nur in Ihrem Projekt gibt, für denselben Wert immer dasselbe, sodass sich Wiederholungen weiter zählen lassen, aber niemand auf den Wert zurückschließen kann |

Zum Beispiel speichert eine Regel **E-Mail-Adresse** diesen Protokolltext:

```text
Payment failed for jane@example.com
```

je nach ihrer **Bereinigungsaktion** als eine dieser Zeilen:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:5e29db14e508e09a]
```

**Zu bereinigende Felder** steht bei einer Regel für Protokolle auf **Beide (Inhalt & Attribute)**, außer Sie wählen **Nur Inhalt** oder **Nur Attribute**, und bei einer Regel für Spans auf **Alle (Name, Attribute & Ereignisse)**, außer Sie wählen **Nur Span-Name**, **Nur Attribute** oder **Nur Ereignisattribute**. Die Attribute der Links eines Spans werden mit den eigenen Attributen des Spans bereinigt, und **Alle (Name, Attribute & Ereignisse)** bereinigt auch die Statusmeldung eines Spans und die Namen seiner Ereignisse. Eine Regel **Sensible Attributschlüssel** liest Schlüssel und bereinigt daher immer die Werte darunter: in Attributen und im JSON-Inhalt eines Protokolls.

- **Eine Regel kann für einen Dienst gelten.** Wählen Sie unter **Erweitert** den Dienst bei **Nur für einen Dienst**: Die Regel bereinigt die Datensätze dieses Dienstes, und die anderer Dienste bleiben, wie sie sind. Leer gelassen, bereinigt sie die Datensätze aller Dienste. Die Spalte **Geltungsbereich** der Liste sagt, was gilt.
- **Das Formular sagt, was eine Regel für andere ändern würde.** Bevor Sie eine Regel anlegen und wenn Sie eine aktivieren, listet OneUptime auf, was die Werte liest, die sie verbergen würde: Monitore, Dashboards, gespeicherte Ansichten, Aufzeichnungsregeln und SLOs, jeweils als Link, und was [Sicherheitsereignisse](/docs/telemetry/security-events) verlieren würden. Ein Monitor, der auf einen verborgenen Wert filtert, trifft ihn nicht mehr. Die Regel wird so oder so gespeichert.
- **Eine IP-Adressen-Regel verbirgt die Adressen, die personenbezogene Daten sind.** Das sind öffentliche IPv4- und IPv6-Adressen, wie auch immer sie geschrieben sind: verkürzt wie `2001:db8::1`, in eckigen Klammern mit Port wie `[2001:db8::1]:443`, wobei Klammern und Port bleiben, mit einer Zone wie `2001:db8::2%eth0`, wobei die Zone bleibt, oder eine als IPv6 geschriebene IPv4-Adresse wie `::ffff:203.0.113.7`, die ganz verborgen wird. Private, Loopback- und Link-local-Adressen wie `10.0.0.12`, `127.0.0.1` und `fe80::1` bleiben stehen, ebenso die Cloud-Metadatenadresse `169.254.169.254` in der URL einer Anfrage, in der [Sicherheitsereignisse](/docs/telemetry/security-events) nach serverseitiger Anfragefälschung sucht. Um auch interne Adressen zu verbergen, fügen Sie für sie eine Regel mit **Benutzerdefinierter Regex** hinzu, etwa `\b(?:\d{1,3}\.){3}\d{1,3}\b` für jede IPv4-Adresse.
- **Ein Hash-Token gehört Ihrem Projekt.** Es wird mit einem Schlüssel Ihres Projekts erzeugt, der aus dem `ENCRYPTION_SECRET` der Installation abgeleitet ist. So hat derselbe Wert in einem anderen Projekt ein anderes Token, und niemand, der ein Token liest, kann auf den Wert zurückschließen oder eine Vermutung hashen und vergleichen. Eine IP-Adresse hat ein einziges Token, wie auch immer sie geschrieben ist: `::ffff:203.0.113.7` und `203.0.113.7` teilen sich eines. Datensätze, die gespeichert wurden, bevor Token einen Schlüssel hatten, enthalten Token mit 8 Zeichen wie `[HASHED:8c87b489]`, die sich von den heutigen mit 16 Zeichen unterscheiden: Suchen Sie nach beiden, bis diese Datensätze das Ende ihrer Aufbewahrung erreichen. Eine Änderung von `ENCRYPTION_SECRET` ändert jedes Token, und in einer selbst gehosteten Installation sind die Token nur so geheim wie dieses Secret.
- **Sicherheitsereignisse können eine gehashte IP-Adresse trotzdem nennen.** Wenn [Sicherheitsereignisse](/docs/telemetry/security-events) Ihre Logs oder Traces liest, bewahrt eine IP-Adressen-Regel, die hasht, jede Adresse, die sie verbirgt, zusätzlich neben ihrem Token auf, in einem Speicher, den nur die Scans von Sicherheitsereignisse lesen: Keine Seite, keine Suche, kein Export, keine API und kein KI-Werkzeug kann ihn lesen. So nennt ein Angriff von einer Adresse, die Ihre Logs nur als Token zeigen, trotzdem die Adresse, und sein Fall sagt, welche Adresse zu sperren ist. Jede Adresse wird bis 30 Tage nach ihrem letzten Auftreten aufbewahrt. Eine Regel, die schwärzt oder maskiert, bewahrt nichts auf, und Sicherheitsereignisse sagt dann, dass eine Scrub-Regel die Adresse verborgen hat, wie bei einem Token, das älter als 30 Tage ist oder entstand, bevor Token einen Schlüssel hatten.
- **Auch Listen und verschachtelte Werte werden gelesen.** Eine Regel liest jeden Text in einer Liste, einer Liste von Listen oder einer Schlüssel-Wert-Liste, etwa die Werte eines HTTP-Headers, und behält die Form des Werts bei: Zahlen sowie wahr oder falsch bleiben, wie sie sind. Eine Regel **Sensible Attributschlüssel** liest auch die Schlüssel innerhalb eines Werts, sodass auch das `password` in einer Schlüssel-Wert-Liste verborgen wird. Der Inhalt eines Protokolls, der als Map oder als Liste gesendet wird, wird als sein JSON-Text gespeichert, und eine Regel **Sensible Attributschlüssel** liest die Schlüssel darin, wie in einem als JSON geschriebenen Inhalt. Eine Musterregel lässt einen solchen Inhalt JSON bleiben, ebenso ein als JSON geschriebenes Attribut wie die Nachrichten eines KI-Aufrufs: Sie liest den Text so, wie Ihre Anwendung ihn geschrieben hat, eine Escape-Sequenz wie `\n` als den Zeilenumbruch, für den sie steht, und ersetzt, was sie findet, nur innerhalb seiner Texte und Zahlen.
- **Auch JSON in einem Text wird gelesen.** Ein Text, der selbst JSON ist, etwa ein Attribut `http.request.body` mit `{"password":"hunter2"}` oder die `log`-Zeile eines Fluentd-Datensatzes im Inhalt eines Protokolls, wird als JSON gelesen, bis zu 4 Ebenen JSON ineinander, und tiefer als Text. Eine Regel **Sensible Attributschlüssel** verbirgt die Werte unter den Schlüsseln darin, die geheim aussehen, und sonst nichts: Seine Zahlen, Leerzeichen und anderen Texte bleiben, wie Ihre Anwendung sie geschrieben hat. Ein Text, der nur wie JSON aussieht, etwa `{token}`, bleibt, wie er ist.
- **Ein Wert, der zu groß ist, um ihn Element für Element zu lesen, wird als Text gelesen.** Ein Wert, der mehr als 32 Ebenen tief verschachtelt ist, oder einer, der einen Datensatz über 10.000 Werte in seinen Listen und Maps bringen würde, wird als sein JSON-Text gelesen und gespeichert. Eine Musterregel bereinigt, was sie in diesem Text findet, und eine Regel **Sensible Attributschlüssel** verbirgt den ganzen Wert, wenn ein Wort wie `password` oder `token` darin vorkommt. Im Inhalt eines Protokolls und in JSON in einem Text wird nur der Teil jenseits dieser Grenzen als Text gelesen: Der Rest wird weiterhin Schlüssel für Schlüssel gelesen.
- **Ausnahmen entstehen aus dem bereinigten Datensatz.** Eine Ausnahme aus einem Protokoll entsteht nach dem Bereinigen, und die Regeln, die Span-Ereignisse bereinigen, bereinigen auch die daran aufgezeichneten Ausnahmen. Jede Ausnahme wird weiterhin danach gruppiert, was sie vor dem Bereinigen enthielt. Eine neue Regel macht also nie aus einer Ausnahme, die Sie schon haben, eine neue und löst **Neue Ausnahme** für sie nicht erneut aus. Verbirgt eine Regel einen Teil dessen, wonach eine neue Ausnahme gruppiert wird, wird ihr Fingerabdruck mit einem Schlüssel Ihres Projekts erzeugt, wie ein Hash-Token, sodass niemand daraus auf das Verborgene schließen kann.
- **Die Rohkopien einer Syslog-Zeile verbergen, was die Regeln in ihren Teilen verborgen haben.** Syslog behält die strukturierten Daten einer Zeile nach RFC 5424 so, wie sie ankamen, in `syslog.structured.raw`, und über HTTP gesendetes Syslog behält die ganze Zeile in `syslog.raw`. Jede Kopie wird neu zusammengesetzt aus dem, was die Regeln von den Feldern des Headers, jedem Parameter der strukturierten Daten und der Nachricht übrig gelassen haben, und die Regeln lesen sie danach, wie sie jedes Attribut lesen. So ist ein Passwort, das eine Regel **Sensible Attributschlüssel** in `syslog.structured.auth_1.password` verbirgt, oder eine Adresse, die eine Regel **Nur Inhalt** in der Nachricht verbirgt, auch in den Kopien verborgen, so geschrieben, wie RFC 5424 einen Wert schreibt: `password="[REDACTED\]"`. Eine Zeile, in der die Regeln nichts ändern, behält ihre Kopien so, wie sie ankam.
- **Die Sitzungs-ID eines Datensatzes bleibt erhalten.** Eine Regel **Sensible Attributschlüssel** verbirgt eine Anmeldesitzung, etwa eine `session_id`, eine `sessionid` oder ein Cookie, behält aber `session.id`, wenn es die Sitzung enthält, zu der das Protokoll oder der Span gehört: die zufällige ID, unter der [Session Replay](/docs/telemetry/session-replay) den Datensatz ablegt und die der Datensatz ohnehin als seine Sitzung behält. Die Konversations-ID eines KI-Aufrufs bleibt ebenso erhalten. Senden Sie das Geheimnis einer Anmeldesitzung nicht als `session.id`.
- **Auch Session Replays werden bereinigt.** Scrub-Regeln für Protokolle, die für alle Dienste gelten, laufen auch über Session-Replay-Aufzeichnungen, hinter der Maskierung, die der Rekorder im Browser vornimmt.
- **Regeln laufen in der Reihenfolge der Liste.** Jede Regel sieht, was die Regeln davor übrig gelassen haben.
- **Ein eigenes Muster braucht Zeit im Verhältnis zum Datensatz.** Es behält die Syntax und die Antworten von JavaScript, Lookaheads und Lookbehinds eingeschlossen, wie auch immer es geschrieben ist. Ein Rückverweis wie `\1` kann so nicht laufen: Eine Regel damit wird beim Speichern abgelehnt, ebenso ein Muster, das zu groß zum Ausführen ist. Müsste ein langer Wert immer wieder gelesen werden, um jeden Treffer zu finden, bereinigt die Regel den ganzen Wert. Die Drop-Filter, Scrub-Regeln und Pipelines eines Projekts teilen sich außerdem ein Arbeitskontingent für jeden Stapel, den es sendet, im Verhältnis zur Größe des Stapels und genug, damit Dutzende eigener Muster jeden Wert lesen können. Brauchen ihre Muster mehr, bereinigt eine eigene Scrub-Regel den ganzen Wert, und ein Filter, der keine Antwort findet, gilt nicht für den Datensatz.

## Prüfen, was ein Filter verworfen hat

Die Liste **Drop-Filter** zeigt für jeden Filter seinen Zähler **Verworfen** und wann er **Zuletzt verworfen** hat. **Noch nichts verworfen** bedeutet, dass er nie zugetroffen hat. Die eigene Seite eines Filters zeigt dasselbe unter **Aktivität**, aktualisiert innerhalb einer Minute nach einem Verwerfen. Seine Karte **Filterbedingungen** zeigt, worauf er zutrifft, und dort können Sie die Bedingungen ändern.

## Fehlerbehebung

:::details Ein Drop-Filter verwirft nichts
**entspricht**, **ist nicht gleich** und **ist eines von** vergleichen den genauen Text, einschließlich Groß- und Kleinschreibung. Schweregrade heißen `Information` und `Warning`, nicht `INFO` oder `WARN`. Prüfen Sie, ob der Filter aktiviert ist, und warten Sie nach einer Änderung eine Minute.
:::

:::details Protokolle, die ich erwartet habe, fehlen
Sehen Sie sich den Zähler **Verworfen** und die Zeit **Zuletzt verworfen** jedes Drop-Filters an. Schalten Sie **Aktiviert** beim verdächtigen Filter aus, und die nächsten Protokolle kommen wieder an.
:::

:::details Eine eigene Scrub-Regel zeigt Bereinigt nichts
Ihr Muster ist leer, kein gültiger regulärer Ausdruck oder kann nicht laufen, etwa weil es einen Rückverweis wie `\1` enthält, sie bereinigt also nichts. Bearbeiten Sie die Regel und geben Sie ihr ein Muster, das mindestens ein Zeichen findet.
:::

:::details Alte Datensätze zeigen noch die Daten, die eine neue Regel bereinigt
Scrub-Regeln wirken, während Datensätze ankommen. Datensätze, die vor der Regel gespeichert wurden, behalten ihren Inhalt, bis ihre Aufbewahrung endet. Siehe [Datenaufbewahrung](/docs/telemetry/data-retention).
:::

## Nächste Schritte

:::cards
- [Protokoll-Pipelines](/docs/telemetry/log-pipelines): Die Protokolle, die Sie behalten, parsen und anreichern.
- [Protokoll-Explorer](/docs/telemetry/logs-explorer): Durchsuchen, was gespeichert wurde.
- [Trace-Explorer](/docs/telemetry/traces-explorer): Den Spans folgen, die Sie behalten.
- [Datenaufbewahrung](/docs/telemetry/data-retention): Festlegen, wie lange sie aufbewahrt werden.
:::
