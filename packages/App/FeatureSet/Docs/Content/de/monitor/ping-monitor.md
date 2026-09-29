# Ping-Monitor

Der Ping-Monitor ermöglicht die Überwachung der Verfügbarkeit und Reaktionsfähigkeit jedes Hosts oder jeder IP-Adresse. OneUptime sendet periodisch Ping-Anfragen an Ihr Ziel und prüft, ob es korrekt antwortet.

## Übersicht

Ping-Monitore testen die grundlegende Netzwerkkonnektivität durch das Senden von ICMP-Ping-Anfragen an einen Host. Dies ermöglicht Ihnen:

- Host-Betriebszeit und Verfügbarkeit überwachen
- Netzwerklatenz und Antwortzeiten verfolgen
- Konnektivitätsprobleme erkennen, bevor sie Ihre Dienste beeinträchtigen
- Überprüfen, ob Server und Netzwerkgeräte erreichbar sind

## Einen Ping-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Ping** als Monitortyp
4. Geben Sie den Hostnamen oder die IP-Adresse ein, die Sie überwachen möchten
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Ping-Hostname oder IP-Adresse

Geben Sie den Hostnamen oder die IP-Adresse des Ziels ein, das Sie überwachen möchten (z. B. `example.com` oder `192.168.1.1`). Sowohl Hostnamen als auch IP-Adressen werden akzeptiert.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Host als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp             | Beschreibung                                                    |
| ------------------- | --------------------------------------------------------------- |
| Ist online          | Ob der Host auf Ping-Anfragen antwortet                         |
| Antwortzeit (in ms) | Rundreisezeit der Ping-Anfrage in Millisekunden                 |
| Paketverlust (in %) | Prozentsatz der ICMP-Echo-Anfragen ohne Antwort                 |
| Jitter (in ms)      | Standardabweichung der Antwortzeiten über die gesendeten Pakete |
| Anfrage-Timeout     | Ob die Ping-Anfrage ein Timeout hatte                           |

### Filtertypen

Für **Ist online** und **Anfrage-Timeout**:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **Antwortzeit**, **Paketverlust** und **Jitter**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**

**Dieses Kriterium über einen Zeitraum auswerten** ist ein Kontrollkästchen im Kriterienformular und keine Filterbedingung. Aktivieren Sie es, um statt des Werts der letzten Prüfung eine Aggregation zu vergleichen — ausgewählt unter **Auswerten** (Durchschnitt, Summe, Maximum, Minimum, Alle Werte, Beliebiger Wert) über den unter **Für die letzten (in Minuten)** festgelegten Zeitraum.

### Beispielkriterien

#### Als offline markieren, wenn Host nicht erreichbar ist

- **Prüfen auf**: Ist online
- **Filtertyp**: Falsch

#### Benachrichtigung wenn Antwortzeit 200 ms überschreitet

- **Prüfen auf**: Antwortzeit (in ms)
- **Filtertyp**: Größer als
- **Wert**: 200
