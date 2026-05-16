# SSL-Zertifikat-Monitor

Der SSL-Zertifikat-Monitor ermöglicht die Überwachung der Gültigkeit und des Ablaufs von SSL/TLS-Zertifikaten auf Ihren Websites und Diensten. OneUptime prüft Ihre Zertifikate periodisch und warnt Sie, bevor sie ablaufen oder wenn Probleme erkannt werden.

## Übersicht

SSL-Zertifikat-Monitore verbinden sich mit Ihren HTTPS-Endpunkten und inspizieren das SSL/TLS-Zertifikat. Dies ermöglicht Ihnen:

- Ablaufdaten von Zertifikaten überwachen
- Abgelaufene oder bald ablaufende Zertifikate erkennen
- Selbst signierte Zertifikate identifizieren
- Zertifikatsgültigkeit überprüfen
- Dienstausfälle durch abgelaufene Zertifikate verhindern

## Einen SSL-Zertifikat-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **SSL-Zertifikat** als Monitortyp
4. Geben Sie die URL des zu prüfenden HTTPS-Endpunkts ein
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### URL

Geben Sie die vollständige HTTPS-URL des Endpunkts ein, dessen SSL-Zertifikat Sie überwachen möchten (z. B. `https://example.com` oder `https://example.com:8443`).

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Zertifikatsstatus als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Ist online | Ob der Server erreichbar ist |
| Ist gültiges Zertifikat | Ob das Zertifikat gültig ist (nicht abgelaufen, nicht selbst signiert) |
| Ist selbst signiertes Zertifikat | Ob das Zertifikat selbst signiert ist |
| Ist abgelaufenes Zertifikat | Ob das Zertifikat abgelaufen ist |
| Ist kein gültiges Zertifikat | Ob das Zertifikat ungültig ist |
| Läuft ab in Stunden | Anzahl der Stunden bis zum Ablauf des Zertifikats |
| Läuft ab in Tagen | Anzahl der Tage bis zum Ablauf des Zertifikats |
| Anfrage-Timeout | Ob die Verbindung ein Timeout hatte |

### Filtertypen

Für boolesche Prüftypen:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **Läuft ab in Stunden** und **Läuft ab in Tagen**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

### Beispielkriterien

#### Als eingeschränkt markieren, wenn Zertifikat in 30 Tagen abläuft

- **Prüfen auf**: Läuft ab in Tagen
- **Filtertyp**: Kleiner als
- **Wert**: 30

#### Als offline markieren, wenn Zertifikat abgelaufen ist

- **Prüfen auf**: Ist abgelaufenes Zertifikat
- **Filtertyp**: Wahr

#### Benachrichtigung wenn Zertifikat selbst signiert ist

- **Prüfen auf**: Ist selbst signiertes Zertifikat
- **Filtertyp**: Wahr

## Best Practices

1. **Mehrere Schwellenwerte festlegen** — Eingeschränkten Status bei 30 Tagen und Offline-Status bei 7 Tagen vor Ablauf verwenden, um Zeit zur Erneuerung zu haben
2. **Alle Endpunkte überwachen** — Wenn Sie mehrere Domains oder Subdomains haben, einen Monitor für jede erstellen
3. **Nicht-Standard-Ports einschließen** — Dienste, die HTTPS auf nicht-standardmäßigen Ports betreiben, nicht vergessen
4. **Nach Erneuerung überwachen** — Nach der Erneuerung eines Zertifikats überprüfen, ob der Monitor es als gültig bestätigt
