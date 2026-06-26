# Port-Monitor

Der Port-Monitor ermöglicht die Überwachung der Verfügbarkeit bestimmter TCP- oder UDP-Ports auf einem Host. OneUptime versucht periodisch, eine Verbindung zum angegebenen Port herzustellen, und prüft, ob dieser offen und reaktionsfähig ist.

## Übersicht

Port-Monitore testen, ob ein bestimmter Netzwerkport Verbindungen akzeptiert. Dies ermöglicht Ihnen:

- Dienstverfügbarkeit auf bestimmten Ports überwachen
- Port-Antwortzeiten verfolgen
- Überprüfen, ob Dienste wie Datenbanken, Mail-Server und Anwendungsserver laufen
- Dienstausfälle erkennen, bevor sie Benutzer beeinträchtigen

## Einen Port-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Port** als Monitortyp
4. Geben Sie den Hostnamen oder die IP-Adresse und die Portnummer ein
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Hostname oder IP-Adresse

Geben Sie den Hostnamen oder die IP-Adresse des Ziel-Hosts ein (z. B. `example.com` oder `192.168.1.1`).

### Port

Geben Sie die zu überwachende Portnummer ein (1–65535). Häufige Beispiele:

| Port  | Dienst     |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Port als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp             | Beschreibung                                          |
| ------------------- | ----------------------------------------------------- |
| Ist online          | Ob der Port offen ist und Verbindungen akzeptiert     |
| Antwortzeit (in ms) | Zeit zum Herstellen einer Verbindung in Millisekunden |
| Anfrage-Timeout     | Ob der Verbindungsversuch ein Timeout hatte           |

### Filtertypen

Für **Ist online** und **Anfrage-Timeout**:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **Antwortzeit**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**
- **Über Zeit auswerten** — Mit Aggregation (Durchschnitt, Summe, Maximum, Minimum, Alle Werte, Beliebiger Wert) über ein Zeitfenster auswerten

### Beispielkriterien

#### Als offline markieren, wenn Port geschlossen ist

- **Prüfen auf**: Ist online
- **Filtertyp**: Falsch

#### Benachrichtigung wenn Verbindungszeit 500 ms überschreitet

- **Prüfen auf**: Antwortzeit (in ms)
- **Filtertyp**: Größer als
- **Wert**: 500

#### Als eingeschränkt markieren, wenn Verbindung langsam ist

- **Prüfen auf**: Antwortzeit (in ms)
- **Filtertyp**: Größer als
- **Wert**: 200
