# Authentifizierung

Die OneUptime CLI unterstützt mehrere Möglichkeiten zur Authentifizierung mit Ihrer OneUptime-Instanz. Sie können benannte Kontexte, Umgebungsvariablen oder Anmeldedaten direkt als Flags übergeben.

## Anmelden

Authentifizieren Sie sich mit Ihrer OneUptime-Instanz mithilfe eines API-Schlüssels:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumente:**

| Argument         | Beschreibung                                               |
| ---------------- | ---------------------------------------------------------- |
| `<api-key>`      | Ihr OneUptime-API-Schlüssel (z. B. `sk-your-api-key`)      |
| `<instance-url>` | Ihre OneUptime-Instanz-URL (z. B. `https://oneuptime.com`) |

**Optionen:**

| Option                  | Beschreibung                                    |
| ----------------------- | ----------------------------------------------- |
| `--context-name <name>` | Name für diesen Kontext (Standard: `"default"`) |

**Beispiele:**

```bash
# Mit Standard-Kontext anmelden
oneuptime login sk-abc123 https://oneuptime.com

# Mit benanntem Kontext anmelden
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Mehrere Umgebungen einrichten
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Kontexte

Kontexte ermöglichen Ihnen das Speichern und Wechseln zwischen mehreren OneUptime-Umgebungen (z. B. Produktion, Staging, Entwicklung).

### Kontexte auflisten

```bash
oneuptime context list
```

Zeigt alle konfigurierten Kontexte an. Der aktuelle Kontext ist mit `*` markiert.

### Kontext wechseln

```bash
oneuptime context use <name>
```

Wechselt zu einem anderen benannten Kontext für alle nachfolgenden Befehle.

```bash
# Zu Staging wechseln
oneuptime context use staging

# Zu Produktion wechseln
oneuptime context use production
```

### Aktuellen Kontext anzeigen

```bash
oneuptime context current
```

Zeigt den aktuell aktiven Kontext an, einschließlich der Instanz-URL und eines maskierten API-Schlüssels.

### Einen Kontext löschen

```bash
oneuptime context delete <name>
```

Entfernt einen benannten Kontext. Wenn der gelöschte Kontext der aktuelle ist, wechselt die CLI automatisch zum ersten verbleibenden Kontext.

## Auflösung von Anmeldedaten

Anmeldedaten werden in der folgenden Prioritätsreihenfolge aufgelöst:

1. **CLI-Flags** (`--api-key` und `--url`)
2. **Umgebungsvariablen** (`ONEUPTIME_API_KEY` und `ONEUPTIME_URL`)
3. **Benannter Kontext** (über `--context`-Flag)
4. **Aktueller Kontext** (aus gespeicherter Konfiguration)

Sie können Quellen mischen – verwenden Sie beispielsweise eine Umgebungsvariable für den API-Schlüssel und einen gespeicherten Kontext für die URL.

### CLI-Flags verwenden

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Umgebungsvariablen verwenden

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Einen spezifischen Kontext verwenden

```bash
oneuptime --context production incident list
```

## Authentifizierung verifizieren

Prüfen Sie Ihren aktuellen Authentifizierungsstatus:

```bash
oneuptime whoami
```

Dies zeigt:

- Instanz-URL
- Maskierter API-Schlüssel
- Aktueller Kontextname (nur angezeigt, wenn ein gespeicherter Kontext aktiv ist)

Falls nicht authentifiziert, zeigt der Befehl eine hilfreiche Meldung mit dem Vorschlag, `oneuptime login` auszuführen.

## Konfigurationsdatei

Anmeldedaten werden in `~/.oneuptime/config.json` mit eingeschränkten Berechtigungen (`0600`) gespeichert.

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
