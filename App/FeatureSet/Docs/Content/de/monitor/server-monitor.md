# Server- / VM-Monitor

Der Server- und VM-Monitor ermöglicht die Überwachung der Gesundheit und Leistung Ihrer Server, virtuellen Maschinen und anderer Infrastruktur durch die Installation eines leichtgewichtigen Agents, der Systemmetriken an OneUptime meldet.

## Übersicht

Server-Monitore verwenden einen Infrastruktur-Agent auf Ihren Servern, um Systemmetriken zu erfassen und zu melden. Dies ermöglicht Ihnen:

- Server-Betriebszeit und Verfügbarkeit überwachen
- CPU-, Arbeitsspeicher- und Festplattennutzung verfolgen
- Laufende Prozesse überwachen
- Benachrichtigungen basierend auf Ressourcenauslastungs-Schwellenwerten setzen
- Infrastrukturprobleme erkennen, bevor sie Ihre Dienste beeinträchtigen

## Einen Server-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Server / VM** als Monitortyp
4. Ein **Geheimer Schlüssel** wird für diesen Monitor generiert — Sie benötigen ihn für die Agent-Konfiguration
5. Befolgen Sie die Installationsanweisungen, um den Agent auf Ihrem Server einzurichten

## Den Infrastruktur-Agent installieren

Der OneUptime Infrastruktur-Agent ist ein leichtgewichtiger Go-basierter Daemon, der alle 30 Sekunden Systemmetriken erfasst und an OneUptime sendet. Er unterstützt Linux, macOS und Windows.

### Linux / macOS

```bash
# Agent installieren
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Agent konfigurieren
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Agent starten
sudo oneuptime-infrastructure-agent start
```

Ersetzen Sie `YOUR_SECRET_KEY` durch den geheimen Schlüssel aus Ihren Monitor-Einstellungen, und `https://oneuptime.com` durch Ihre OneUptime-Instanz-URL, wenn Sie es selbst hosten.

### Windows

1. Laden Sie den neuesten Agent von [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest) herunter
   - `oneuptime-infrastructure-agent_windows_amd64.zip` für x64-Systeme
   - `oneuptime-infrastructure-agent_windows_arm64.zip` für ARM64-Systeme
2. Entpacken Sie die Zip-Datei
3. Öffnen Sie die Eingabeaufforderung als Administrator und führen Sie aus:

```bash
# Agent konfigurieren
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Agent starten
oneuptime-infrastructure-agent start
```

### Proxy-Unterstützung

Wenn Ihr Server über einen Proxy mit dem Internet verbunden ist, können Sie den Agent so konfigurieren, diesen zu verwenden:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent-Befehle

Der Infrastruktur-Agent unterstützt die folgenden Befehle:

| Befehl      | Beschreibung                                                           |
| ----------- | ---------------------------------------------------------------------- |
| `configure` | Agent mit Ihrem geheimen Schlüssel und der OneUptime-URL konfigurieren |
| `start`     | Agent-Dienst starten                                                   |
| `stop`      | Agent-Dienst stoppen                                                   |
| `restart`   | Agent-Dienst neu starten                                               |
| `status`    | Aktuellen Dienststatus anzeigen                                        |
| `logs`      | Agent-Logs anzeigen (mit `-n` für Zeilenanzahl, `-f` zum Folgen)       |
| `uninstall` | Agent-Dienst deinstallieren                                            |

## Erfasste Metriken

Der Agent erfasst die folgenden Metriken von Ihrem Server:

### CPU

- **CPU-Auslastung in Prozent** — Gesamte CPU-Auslastung als Prozentsatz
- **CPU-Kerne** — Anzahl der CPU-Kerne

### Arbeitsspeicher

- **Gesamter Arbeitsspeicher** — Gesamter verfügbarer Arbeitsspeicher
- **Genutzter Arbeitsspeicher** — Aktuell genutzter Arbeitsspeicher
- **Freier Arbeitsspeicher** — Verfügbarer freier Arbeitsspeicher
- **Arbeitsspeicher-Auslastung in Prozent** — Arbeitsspeichernutzung als Prozentsatz

### Festplatte

Für jede eingehängte Festplatte/jedes Volume:

- **Gesamter Festplattenplatz** — Gesamtkapazität der Festplatte
- **Genutzter Festplattenplatz** — Aktuell genutzter Platz
- **Freier Festplattenplatz** — Verfügbarer freier Platz
- **Festplatten-Auslastung in Prozent** — Festplattennutzung als Prozentsatz
- **Festplattenpfad** — Einhängepfad der Festplatte

### Prozesse

- **Prozessname** — Name des laufenden Prozesses
- **Prozess-ID (PID)** — Prozesskennung
- **Prozessbefehl** — Vollständiger Befehl zum Starten des Prozesses

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Server als online, eingeschränkt oder offline gilt.

### Verfügbare Prüftypen

| Prüftyp                               | Beschreibung                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Ist online                            | Ob der Server-Agent berichtet (basierend auf Heartbeat)                           |
| CPU-Auslastung in Prozent             | Aktuelle CPU-Auslastung in Prozent                                                |
| Arbeitsspeicher-Auslastung in Prozent | Aktuelle Arbeitsspeicher-Auslastung in Prozent                                    |
| Festplatten-Auslastung in Prozent     | Aktuelle Festplatten-Auslastung in Prozent (für einen bestimmten Festplattenpfad) |
| Server-Prozessname                    | Prüfen, ob ein Prozess mit einem bestimmten Namen läuft                           |
| Server-Prozessbefehl                  | Prüfen, ob ein Prozess mit einem bestimmten Befehl läuft                          |
| Server-Prozess-PID                    | Prüfen, ob ein Prozess mit einer bestimmten PID läuft                             |

### Filtertypen

Für numerische Metriken (CPU, Arbeitsspeicher, Festplatte):

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**
- **Über Zeit auswerten** — Mit Aggregation über ein Zeitfenster auswerten

Für Prozessprüfungen:

- **Wird ausgeführt** — Der Prozess läuft gerade
- **Wird nicht ausgeführt** — Der Prozess läuft nicht

### Beispielkriterien

#### Server als offline markieren, wenn Agent nicht mehr berichtet

- **Prüfen auf**: Ist online
- **Filtertyp**: Falsch

#### Benachrichtigung wenn CPU-Auslastung 90% überschreitet

- **Prüfen auf**: CPU-Auslastung in Prozent
- **Filtertyp**: Größer als
- **Wert**: 90

#### Benachrichtigung wenn kritischer Prozess nicht mehr läuft

- **Prüfen auf**: Server-Prozessname
- **Filtertyp**: Wird nicht ausgeführt
- **Wert**: `nginx`

## Fehlerbehebung

### Agent berichtet nicht

- Überprüfen Sie, ob der Agent läuft: `sudo oneuptime-infrastructure-agent status`
- Agent-Logs prüfen: `sudo oneuptime-infrastructure-agent logs -n 50`
- Sicherstellen, dass der geheime Schlüssel korrekt ist
- Sicherstellen, dass der Server Ihre OneUptime-Instanz-URL erreichen kann
- Firewall-Regeln prüfen: ausgehende HTTPS-Verbindungen erlauben

## Best Practices

1. **Aussagekräftige Schwellenwerte festlegen** — Eingeschränkte und Offline-Kriterien konfigurieren, die dem normalen Betriebsbereich Ihres Servers entsprechen
2. **Kritische Prozesse überwachen** — Prozessüberwachung nutzen, um sicherzustellen, dass wesentliche Dienste wie Webserver und Datenbanken immer laufen
3. **Festplattennutzung proaktiv überwachen** — Festplattenplatzprobleme können Anwendungsfehler verursachen; Benachrichtigungen setzen, bevor Festplatten voll sind
4. **„Über Zeit auswerten" verwenden** — Für Metriken wie CPU, die kurz spiken können, zeitbasierte Aggregation verwenden, um falsche Benachrichtigungen zu vermeiden
5. **Agent aktuell halten** — Infrastruktur-Agent regelmäßig aktualisieren
