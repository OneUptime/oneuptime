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
- **Eine Rolle, die Telemetrie-Einstellungen ändern darf.** Project Owner oder Project Admin, oder eine eigene Rolle mit der Berechtigung für das, was Sie ändern, etwa Create Log Drop Filter oder Create Trace Scrub Rule. Die Telemetrie-Rollen sehen Filter und Regeln, können sie aber nicht ändern.

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
| **IP-Adresse** | IPv4-Adressen wie `192.168.1.1` |
| **Sensible Attributschlüssel** | Den ganzen Wert jedes Attributs, dessen Schlüssel geheim aussieht, wie `password`, `token`, `api_key`, `authorization` oder `cookie` |
| **Benutzerdefinierter Regex** | Ihr eigener regulärer Ausdruck, ohne Schrägstriche oder Flags geschrieben, und mit Groß- und Kleinschreibung abgeglichen |

| Bereinigungsaktion | Was aus einem Treffer wird |
| --- | --- |
| **Schwärzen** | `[REDACTED]`, die Voreinstellung |
| **Maske** | Größtenteils verborgen: Eine E-Mail behält ihren ersten Buchstaben und das Ende ihrer Domain, eine Karten-, Telefon- oder Sozialversicherungsnummer ihre letzten vier Ziffern, und ein eigener Treffer oder ein geheimer Wert sein erstes und letztes Zeichen. Eine IP-Adresse wird ganz verborgen. |
| **Hash** | Ein kurzer Hash davon, für denselben Wert immer derselbe, sodass sich Wiederholungen weiter zählen lassen |

Zum Beispiel speichert eine Regel **E-Mail-Adresse** diesen Protokolltext:

```text
Payment failed for jane@example.com
```

je nach ihrer **Bereinigungsaktion** als eine dieser Zeilen:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:8c87b489]
```

**Zu bereinigende Felder** steht bei einer Regel für Protokolle auf **Beide (Inhalt & Attribute)**, außer Sie wählen **Nur Inhalt** oder **Nur Attribute**, und bei einer Regel für Spans auf **Alle (Name, Attribute & Ereignisse)**, außer Sie wählen **Nur Span-Name**, **Nur Attribute** oder **Nur Ereignisattribute**. Eine Regel **Sensible Attributschlüssel** bereinigt immer Attributwerte, da sie Attributschlüssel liest.

- **Ausnahmen entstehen aus dem bereinigten Datensatz.** Eine Ausnahme aus einem Protokoll entsteht nach dem Bereinigen, und die Regeln, die Span-Ereignisse bereinigen, bereinigen auch die daran aufgezeichneten Ausnahmen.
- **Auch Session Replays werden bereinigt.** Scrub-Regeln für Protokolle laufen auch über Session-Replay-Aufzeichnungen, hinter der Maskierung, die der Rekorder im Browser vornimmt.
- **Regeln laufen in der Reihenfolge der Liste.** Jede Regel sieht, was die Regeln davor übrig gelassen haben.

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
Ihr Muster ist leer oder kein gültiger regulärer Ausdruck, sie bereinigt also nichts. Bearbeiten Sie die Regel und geben Sie ihr ein Muster, das mindestens ein Zeichen findet.
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
