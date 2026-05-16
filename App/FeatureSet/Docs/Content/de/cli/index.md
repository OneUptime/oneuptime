# OneUptime CLI

Die OneUptime CLI ist eine Befehlszeilenschnittstelle zur Verwaltung Ihrer OneUptime-Ressourcen direkt vom Terminal aus. Sie unterstützt vollständige CRUD-Vorgänge für Monitore, Incidents, Benachrichtigungen, Status-Seiten und mehr.

## Funktionen

- **Multi-Umgebungs-Unterstützung** mit benannten Kontexten für Produktion, Staging und Entwicklung
- **Automatische Erkennung** verfügbarer Ressourcen aus Ihrer OneUptime-Instanz
- **Flexible Authentifizierung** über CLI-Flags, Umgebungsvariablen oder gespeicherte Kontexte
- **Intelligente Ausgabeformatierung** mit JSON-, Tabellen- und erweitertem Anzeigemodus
- **Skriptfähig** für CI/CD-Pipelines und Automatisierungs-Workflows

## Installation

```bash
npm install -g @oneuptime/cli
```

## Schnellstart

```bash
# Mit Ihrer OneUptime-Instanz authentifizieren
oneuptime login <your-api-key> https://oneuptime.com

# Ihre Monitore auflisten
oneuptime monitor list

# Einen bestimmten Incident anzeigen
oneuptime incident get <incident-id>

# Alle verfügbaren Ressourcen anzeigen
oneuptime resources
```

## Dokumentation

| Leitfaden | Beschreibung |
|-------|-------------|
| [Authentifizierung](./authentication.md) | Anmeldung, Kontexte und Anmeldedatenverwaltung |
| [Ressourcenvorgänge](./resource-operations.md) | CRUD-Vorgänge für Monitore, Incidents, Benachrichtigungen und mehr |
| [Ausgabeformate](./output-formats.md) | JSON-, Tabellen- und erweiterter Ausgabemodus |
| [Skripting und CI/CD](./scripting.md) | Automatisierung, Umgebungsvariablen und Pipeline-Nutzung |
| [Befehlsreferenz](./command-reference.md) | Vollständige Referenz für alle Befehle und Optionen |

## Globale Optionen

Diese Flags können mit jedem Befehl verwendet werden:

| Flag | Beschreibung |
|------|-------------|
| `--api-key <key>` | API-Schlüssel für diesen Befehl überschreiben |
| `--url <url>` | Instanz-URL für diesen Befehl überschreiben |
| `--context <name>` | Einen bestimmten benannten Kontext verwenden |
| `-o, --output <format>` | Ausgabeformat: `json`, `table`, `wide` |
| `--no-color` | Farbige Ausgabe deaktivieren |
| `--help` | Befehlshilfe anzeigen |
| `--version` | CLI-Version anzeigen |

## Hilfe erhalten

```bash
# Allgemeine Hilfe
oneuptime --help

# Hilfe für einen spezifischen Befehl
oneuptime monitor --help
oneuptime monitor list --help
```
