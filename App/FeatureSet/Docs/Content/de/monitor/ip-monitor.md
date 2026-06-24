# IP-Monitor

Der IP-Monitor ermöglicht die Überwachung der Verfügbarkeit und Reaktionsfähigkeit jeder IPv4- oder IPv6-Adresse. OneUptime testet regelmäßig die Konnektivität zur Ziel-IP-Adresse und meldet deren Status.

## Übersicht

IP-Monitore überprüfen, ob eine bestimmte IP-Adresse erreichbar und reaktionsfähig ist. Dies ermöglicht Ihnen:

- IPv4- und IPv6-Adressverfügbarkeit überwachen
- Antwortzeiten und Latenz verfolgen
- Netzwerkkonnektivitätsprobleme erkennen
- Erreichbarkeit von Infrastruktur-Endpunkten überprüfen

## Einen IP-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **IP** als Monitortyp
4. Geben Sie die zu überwachende IP-Adresse ein
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### IP-Adresse

Geben Sie die zu überwachende IPv4- oder IPv6-Adresse ein (z. B. `192.168.1.1` oder `2001:db8::1`). Der Wert muss ein gültiges IP-Adressformat haben.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihre IP-Adresse als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp             | Beschreibung                     |
| ------------------- | -------------------------------- |
| Ist online          | Ob die IP-Adresse erreichbar ist |
| Antwortzeit (in ms) | Antwortzeit in Millisekunden     |
| Anfrage-Timeout     | Ob die Anfrage ein Timeout hatte |

### Filtertypen

Für **Ist online** und **Anfrage-Timeout**:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **Antwortzeit**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**
- **Über Zeit auswerten** — Mit Aggregation (Durchschnitt, Summe, Maximum, Minimum, Alle Werte, Beliebiger Wert) über ein Zeitfenster auswerten

### Beispielkriterien

#### Als offline markieren, wenn IP nicht erreichbar ist

- **Prüfen auf**: Ist online
- **Filtertyp**: Falsch

#### Benachrichtigung wenn Latenz 100 ms überschreitet

- **Prüfen auf**: Antwortzeit (in ms)
- **Filtertyp**: Größer als
- **Wert**: 100
