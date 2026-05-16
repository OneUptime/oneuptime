# Metriken-Monitor

Der Metriken-Monitor ermöglicht die Überwachung benutzerdefinierter Anwendungs- und Infrastrukturmetriken, die über OpenTelemetry erfasst wurden. OneUptime wertet Metrikwerte über ein Zeitfenster aus und löst Benachrichtigungen basierend auf Ihren konfigurierten Kriterien aus.

## Übersicht

Metriken-Monitore fragen numerische Metriken aus Ihren Telemetrie-Diensten ab und werten diese aus. Dies ermöglicht Ihnen:

- Benutzerdefinierte Anwendungsmetriken überwachen (Anfrage-Raten, Warteschlangentiefen, Fehlerquoten usw.)
- Infrastrukturmetriken verfolgen (CPU, Arbeitsspeicher, Festplatte, Netzwerk)
- Komplexe Metrikabfragen mit Filtern und Aggregationen erstellen
- Mehrere Metriken mit mathematischen Formeln kombinieren
- Benachrichtigungen basierend auf Metrik-Schwellenwerten einrichten

## Einen Metriken-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Metriken** als Monitortyp
4. Konfigurieren Sie Metrikabfragen und optionale Formeln
5. Wählen Sie die Aggregationsstrategie
6. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Metrikabfragen

Definieren Sie eine oder mehrere Metrikabfragen. Jede Abfrage enthält:

| Feld | Beschreibung | Erforderlich |
|-------|-------------|----------|
| Metrikname | Der Name der abzufragenden Metrik | Ja |
| Aggregationstyp | Wie rohe Metrikwerte aggregiert werden (sum, avg, min, max, count) | Ja |
| Attribute | Schlüssel-Wert-Filter zum Eingrenzen der Metrikdaten | Nein |
| Aggregieren nach | Dimensionen, nach denen die Metrik gruppiert werden soll | Nein |

Jeder Abfrage wird ein Alias zugewiesen (z. B. `a`, `b`, `c`) zur Verwendung in Formeln.

### Formeln

Kombinieren Sie mehrere Metrikabfragen mit mathematischen Ausdrücken. Zum Beispiel:

- `a / b * 100` — Einen Prozentsatz aus zwei Abfragen berechnen
- `a + b` — Zwei Metriken summieren
- `a - b` — Differenz zwischen Metriken

### Gleitendes Zeitfenster

Wählen Sie das Zeitfenster für die Metrikauswertung:

- Letzte 1 Minute
- Letzte 5 Minuten
- Letzte 10 Minuten
- Letzte 15 Minuten
- Letzte 30 Minuten
- Letzte 60 Minuten

### Aggregationsstrategie

Wählen Sie, wie die Metrikwerte zur Auswertung aggregiert werden:

| Strategie | Beschreibung |
|----------|-------------|
| Durchschnitt | Durchschnittswert über das Zeitfenster |
| Summe | Summe aller Werte |
| Maximalwert | Höchster Wert im Zeitfenster |
| Minimalwert | Niedrigster Wert im Zeitfenster |
| Alle Werte | Alle Werte müssen den Kriterien entsprechen |
| Beliebiger Wert | Mindestens ein Wert muss übereinstimmen |

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Metrikwert | Der aggregierte Wert der konfigurierten Metrikabfrage oder Formel |

### Filtertypen

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

### Beispielkriterien

#### Benachrichtigung wenn Fehlerquote 5% überschreitet

- **Abfrage a**: `http_requests_total` gefiltert nach `status=5xx`
- **Abfrage b**: `http_requests_total`
- **Formel**: `a / b * 100`
- **Prüfen auf**: Metrikwert
- **Filtertyp**: Größer als
- **Wert**: 5

## Setup-Anforderungen

Der Metriken-Monitor erfordert, dass Ihre Anwendungen oder Infrastruktur Metriken über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
