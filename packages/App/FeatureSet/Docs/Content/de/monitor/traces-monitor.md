# Traces-Überwachung

Ein Traces-Monitor zählt die Spans, die Ihre Dienste an OneUptime senden und die zu Ihren Filtern passen – Span-Name, Status, Dienst, Attribute –, über ein Zeitfenster. Erfüllt die Anzahl Ihre Kriterien, ändert er den Status des Monitors, erstellt eine Warnung oder eröffnet einen Vorfall. Damit warnen Sie bei fehlschlagenden Anfragen an einen Endpunkt, bei einer Spitze von Fehler-Spans oder bei einem Dienst, der keine Traces mehr sendet.

:::cards
- [Den Monitor erstellen](#einen-traces-monitor-erstellen): Wählen, welche Spans gezählt werden und wann gewarnt wird.
- [Span-Statuscodes](#span-statuscodes): Was OK, ERROR und UNSET bedeuten und wonach Sie filtern.
- [Wie er ausgewertet wird](#wie-er-ausgewertet-wird): Das Zeitfenster, die Anzahl und der Minutentakt.
- [Kriterien](#kriterien): Schwellenwerte, Anomalieerkennung und die Voreinstellungen.
:::

## So funktioniert es

```mermaid title="Jede Minute zählt und prüft ein Traces-Monitor"
flowchart TB
    App["Ihre Dienste"] -->|OpenTelemetry| Store[("Spans in OneUptime")]
    Store --> Count["Passende Spans<br/>im Zeitfenster zählen"]
    Count --> Check{"Kriterien erfüllt?"}
    Check -->|"Erster Treffer"| Act["Status ändern,<br/>Warnung oder Vorfall"]
    Check -->|Keiner| Default["Standardstatus"]
```

Jede Minute zählt OneUptime die Spans, die zu den Filtern des Monitors passen und innerhalb seines Zeitfensters begonnen haben. Diese Anzahl prüft es von oben nach unten gegen die Kriterien des Monitors, und das erste passende Kriterium entscheidet, was geschieht. Passt keines, kehrt der Monitor zu seinem Standardstatus zurück.

## Bevor Sie beginnen

- Ihre Dienste senden Traces über OpenTelemetry an OneUptime. Siehe [OpenTelemetry](/docs/telemetry/open-telemetry).
- Schlagen Sie den genauen Span-Namen, den Sie beobachten wollen, im Trace-Explorer nach: Span-Namen legt Ihre Instrumentierung fest, zum Beispiel `POST /api/checkout` oder `GET`.

## Einen Traces-Monitor erstellen

:::steps
### Einen neuen Monitor beginnen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**. Oder filtern Sie im Trace-Explorer die Spans, über die Sie informiert werden wollen, und klicken Sie in seiner Werkzeugleiste auf **Monitor erstellen**: Der neue Monitor überwacht von Anfang an die Dienste, die Status, den Span-Namen und die Attribute des Explorers.

### Traces wählen

Klicken Sie unter **Monitortyp** auf **Weitere Monitortypen** und wählen Sie **Traces** unter **Telemetrie**, oder tippen Sie `traces` in das Suchfeld. Geben Sie einen **Name** ein und klicken Sie dann auf **Weiter**.

### Wählen, worüber der Monitor informiert

Wählen Sie unter **Worüber soll dieser Monitor Sie informieren?** **Zu viele fehlgeschlagene Anfragen** oder **Anfragen bleiben aus**. Jede Wahl füllt die zu überwachenden Spans und die Regel aus, die Sie darunter ändern können. Wählen Sie **Etwas anderes**, um beides selbst einzurichten.

### Die zu zählenden Spans wählen

Legen Sie in **Zu überwachende Spans** die Felder **Span-Status** und **Span-Name enthält** fest. Ein leer gelassener Filter passt auf jeden Span. **Passende Spans** unter den Filtern zeigt die Spans, auf die sie gerade passen.

### Weiter eingrenzen (optional)

Öffnen Sie **Weitere Felder**, um nach Telemetrie-Dienst, Infrastruktur-Entität oder Attribut zu filtern.

### Festlegen, wann alarmiert wird

Wählen Sie in **Wann alarmieren** eine **Bedingung**, die **Anzahl der Spans** und ein **Zeitfenster**. Der Satz darunter gibt die Regel in einfachen Worten wieder. Das Diagramm darunter zählt die passenden Spans in jedem Fenster der letzten Stunden, zeichnet die Zahl der Regel als Linie ein und sagt, wie oft die Regel alarmiert hätte. Seine Schaltfläche schlägt eine Zahl vor, die die Regel in dieser Zeit nicht überschritten hätte.

### Wählen, was passiert

Wählen Sie in **Was passiert** **Warnung erstellen**, **Vorfall melden** oder **Beide**, und geben Sie ihr einen Titel und einen Schweregrad. Solange die Regel zutrifft, zeigt der Monitor den Status unter **Weitere Felder**; trifft sie nicht mehr zu, kehrt der Monitor zu seinem Standardstatus zurück, und die Warnung oder der Vorfall behebt sich selbst.

### Den Monitor erstellen

Klicken Sie auf **Monitor erstellen**. Der Monitor öffnet sich auf seiner Seite **Übersicht**, und seine erste Auswertung läuft innerhalb einer Minute.
:::

> [!TIP]
> Um zu erfahren, wenn eine KI-Funktion schlecht antwortet – fehlgeschlagene, verweigerte, abgeschnittene, leere, markierte oder langsame Antworten –, wählen Sie stattdessen **KI / LLM** unter **Telemetrie**. Dieser Monitor liest die KI-Aufrufe in Ihren Traces für Sie, ohne dass Sie Span-Filter schreiben müssen. Siehe [KI- / LLM-Observability](/docs/telemetry/ai-llm-observability#erfahren-wenn-die-ki-schlecht-antwortet).

## Was er abfragt

| Feld | Worauf es passt | Standard |
| --- | --- | --- |
| **Span-Status** | Spans mit einem der gewählten Status: **Nicht festgelegt**, **OK** oder **Fehler**. | Leer: jeder Status |
| **Span-Name enthält** | Spans, deren Name diesen Text enthält, ohne Beachtung der Groß-/Kleinschreibung. | Leer: jeder Span |
| **Zeitfenster** (in **Wann alarmieren**) | Spans, die in den letzten 5 Sekunden bis zu den letzten 24 Stunden begonnen haben. | **Letzte 5 Minuten** |
| **Nach Telemetrie-Dienst filtern** (unter **Weitere Felder**) | Spans von einem der gewählten Dienste. | Leer: jeder Dienst |
| **Nach Infrastruktur-Entität filtern** (unter **Weitere Felder**) | Spans von einem der gewählten Hosts, Pods, Container und anderen Entitäten. | Leer: jede Entität |
| **Nach Attributen filtern** (unter **Weitere Felder**) | Spans, deren Attribute jede Bedingung erfüllen. Jede Bedingung hat ihren eigenen Operator, etwa „gleich“ oder „enthält“. | Leer: keine Bedingung |

Alle Filter, die Sie festlegen, müssen passen, damit ein Span gezählt wird.

### Span-Statuscodes

- **OK** — Die Operation wurde vom Anwendungscode oder von einer Trace-Pipeline ausdrücklich als erfolgreich markiert
- **ERROR** — Die Operation ist auf einen Fehler gestoßen
- **UNSET** — Es wurde kein Fehlerstatus gesetzt. Dies ist der Standardstatus von OpenTelemetry

UNSET bedeutet nicht, dass Daten fehlen. Die OpenTelemetry-Instrumentierung setzt ERROR, wenn eine Operation fehlschlägt, und belässt erfolgreiche Spans auf UNSET, sodass bei einem gesunden Dienst die meisten Spans UNSET sind. OneUptime zeigt sie in Grün als „Unset (no error)“ an. Das Erfassen einer Ausnahme ändert den Status eines Spans nicht, daher kann ein UNSET-Span trotzdem Ausnahmen haben; sie werden zusammen mit dem Span aufgeführt. Um bei Fehlern benachrichtigt zu werden, filtern Sie nach ERROR. Um alle Spans zu zählen, die nicht fehlgeschlagen sind, wählen Sie sowohl OK als auch UNSET aus.

Wenn erfolgreiche Anfragen als OK angezeigt werden sollen, fügen Sie unter **Traces > Einstellungen > Pipelines** eine Trace-Pipeline mit der Filterbedingung **Status = Nicht festgelegt** und einem **Status-Remapper** hinzu, der Werte von `http.response.status_code` wie `200` auf Ok abbildet.

## Wie er ausgewertet wird

- **Jede Minute.** Ein Traces-Monitor wird nicht von Sonden geprüft, deshalb hat er kein Intervall zum Einstellen und keine Seite **Sonden & Intervall**.
- **Eine Zahl pro Auswertung.** Der Monitor zählt die Spans, die zu jedem Filter passen und innerhalb des **Zeitfenster** vor der Auswertung begonnen haben. Mit **Letzte 5 Minuten** blickt jede Auswertung fünf Minuten zurück, sodass sich die Fenster aufeinanderfolgender Auswertungen überlappen.
- **Keine Spans ergeben die Anzahl 0.** Ein Dienst, der keine Traces mehr sendet, liefert 0 – genau darauf achtet **Anfragen bleiben aus**.
- **Die eigene Ausfallzeit von OneUptime ist keine Stille.** Solange das Zeitfenster Zeit enthält, in der OneUptime selbst keine Daten empfangen hat – weil es neu startete, aktualisiert wurde oder einen Rückstand aufholte –, wartet die Prüfung: Der Status ändert sich nicht, und kein Vorfall und keine Warnung wird eröffnet oder behoben. Siehe [Wenn OneUptime keine Daten empfängt](/docs/monitor/when-oneuptime-is-not-receiving).
- **Kriterien von oben nach unten.** Das erste passende Kriterium entscheidet; stellen Sie also das schwerwiegendste nach oben.

Jede Statusänderung wird mit ihrem Grund in der **Status-Zeitachse** des Monitors festgehalten.

## Kriterien

Die Kriterien eines Traces-Monitors haben einen **Filtertyp**: **Span Count**, die Anzahl der Spans, die im Fenster gepasst haben. **Wann alarmieren** richtet ein Kriterium ein, dessen **Bedingung** **Mehr als**, **Mindestens**, **Weniger als**, **Höchstens**, **Genau**, **Ungewöhnlich hoch**, **Ungewöhnlich niedrig** oder **Ungewöhnlich hoch oder niedrig** lautet. Für mehrere Kriterien oder eines mit mehr als einem Filter klicken Sie in **Was passiert** unter **Weitere Felder** auf **Als eigene Kriterien bearbeiten**: Jedes Kriterium dort hat eine **Filterbedingung** und, bei einer Schwellenwertbedingung, einen **Wert**.

| Filterbedingung | Passt, wenn die Anzahl der Spans … |
| --- | --- |
| **Größer als** | über dem Wert liegt |
| **Größer als oder gleich** | den Wert erreicht oder darüber liegt |
| **Kleiner als** | unter dem Wert liegt |
| **Kleiner als oder gleich** | den Wert erreicht oder darunter liegt |
| **Gleich** | genau dem Wert entspricht |
| **Anomalously High** | über dem Bereich liegt, der für diese Stunde der Woche erwartet wird |
| **Anomalously Low** | unter diesem Bereich liegt |
| **Anomalous** | außerhalb dieses Bereichs liegt, in die eine oder andere Richtung |

Die Anomaliebedingungen haben keinen **Wert**. Wählen Sie eine **Empfindlichkeit** – Niedrig, Mittel (der Standard) oder Hoch – und, in den eigenen Kriterien, ein **Baseline-Fenster** von 14 (der Standard), 28, 60 oder 90 Tagen. OneUptime rechnet die Anzahl in eine Rate pro Minute um und vergleicht sie mit derselben Stunde der Woche über dieses Fenster. Die Baseline umfasst nur die Dienste und Span-Status des Monitors: Seine Span-Namen- und Attributfilter gehören nicht dazu. Solange diese Stunde der Woche nicht genug Verlauf hat, lernt das Kriterium noch und löst nicht aus.

Ein in „Monitor erstellen“ angelegter Traces-Monitor beginnt mit der Regel dessen, was Sie unter **Worüber soll dieser Monitor Sie informieren?** gewählt haben:

| Auswahl | Regel | Was passiert |
| --- | --- | --- |
| **Zu viele fehlgeschlagene Anfragen** | **Span-Status** **Fehler**, **Mehr als** `10` in **Letzte 5 Minuten** | Erstellt eine Warnung, die sich selbst behebt |
| **Anfragen bleiben aus** | **Genau** `0` in **Letzte 10 Minuten** | Meldet einen Vorfall, der sich selbst behebt |

Ein über die API oder Terraform ohne Kriterien angelegter Traces-Monitor beginnt mit diesen Kriterien:

| Kriterium | Filter | Wirkung |
| --- | --- | --- |
| Check if … is offline | **Span Count** **Gleich** `0` | Setzt den Monitor auf offline und eröffnet einen Vorfall, der automatisch behoben wird |
| Check if … is online | **Span Count** **Größer als** `0` | Setzt den Monitor auf online |

## Ein Beispiel: fehlgeschlagene Checkout-Anfragen

In fünf Minuten zeichnet der Checkout-Dienst 1.200 Spans namens `POST /api/checkout` auf: 1.150 UNSET, 20 OK und 30 ERROR. Derselbe Monitor zählt je nach **Span-Status** sehr unterschiedliche Zahlen:

| Span-Status | Span Count | Was er misst |
| --- | --- | --- |
| **Fehler** | 30 | Anfragen, die fehlgeschlagen sind |
| **OK** | 20 | Nur die Anfragen, die Ihr Code als erfolgreich markiert hat |
| **Nicht festgelegt** und **OK** | 1.170 | Jede Anfrage, die nicht fehlgeschlagen ist |
| Leer | 1.200 | Jede Anfrage |

Um alarmiert zu werden, wenn in fünf Minuten mehr als 10 Checkout-Anfragen fehlschlagen:

- **Span-Name enthält**: `POST /api/checkout`
- **Zeitfenster**: **Letzte 5 Minuten**
- **Span-Status**: **Fehler**
- **Wann alarmieren**: **Mehr als** `10`
- **Was passiert**: **Vorfall melden**

Bei 30 fehlgeschlagenen Anfragen trifft die Regel zu, und der Vorfall wird eröffnet. Sobald fünf Minuten mit 10 oder weniger Fehlschlägen vergangen sind, trifft die Regel nicht mehr zu, der Monitor ist wieder online und der Vorfall behebt sich selbst.

## Fehlerbehebung

:::details Der Monitor zählt keine Spans für meinen Endpunkt
**Span-Name enthält** wird mit dem Namen des Spans abgeglichen, und Instrumentierungen benennen Server-Spans oft nach der Route (`POST /api/checkout`) oder nur nach der Methode (`GET`). Suchen Sie den genauen Namen im Trace-Explorer. Öffnen Sie dann die Seite **Kriterien** des Monitors (unter **Konfiguration**) und klicken Sie auf **Überwachungskriterien bearbeiten**: **Passende Spans** zeigt, worauf die Filter gerade passen.
:::

:::details Erfolgreiche Anfragen werden beim Filtern auf OK nicht gezählt
Die meisten Instrumentierungen belassen erfolgreiche Spans auf UNSET, nicht auf OK – siehe [Span-Statuscodes](#span-statuscodes). Wählen Sie sowohl **Nicht festgelegt** als auch **OK**, oder fügen Sie die dort beschriebene Trace-Pipeline hinzu.
:::

:::details Ein Span hat eine Ausnahme, wird aber nicht als Fehler gezählt
Das Erfassen einer Ausnahme ändert den Status eines Spans nicht. Filtern Sie nach **Fehler**, oder verwenden Sie einen [Ausnahmen-Monitor](/docs/monitor/exceptions-monitor), um auf die Ausnahmen selbst zu warnen.
:::

:::details Ein Anomaliekriterium löst nie aus
Es lernt noch: Die Stunde der Woche, mit der es vergleicht, hat innerhalb des **Baseline-Fenster** noch nicht genug Verlauf.
:::

## Nächste Schritte

:::cards
- [Ausnahmen-Überwachung](/docs/monitor/exceptions-monitor): Auf die Ausnahmen warnen, die Ihre Dienste erfassen.
- [Logs-Überwachung](/docs/monitor/logs-monitor): Auf Log-Volumen und -Inhalt warnen.
- [Suchsyntax](/docs/telemetry/search-syntax): Span-Namen und Status im Trace-Explorer finden.
- [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating): Nützliche Titel und Beschreibungen für Warnungen schreiben.
:::
