# GitHub-Integration

Um GitHub mit Ihrer selbst gehosteten OneUptime-Instanz zu integrieren, müssen Sie eine GitHub App erstellen und die erforderlichen Umgebungsvariablen konfigurieren. Dies ermöglicht OneUptime, sich mit Ihren GitHub-Repositories für die Code-Repository-Verwaltung zu verbinden.

## Voraussetzungen

- GitHub-Konto mit Organisations-Admin-Zugriff (für Organisations-Repositories) oder persönlichem Konto
- Zugriff auf Ihre OneUptime-Serverkonfiguration

## Einrichtungsanweisungen

### Schritt 1: GitHub App erstellen

1. Gehen Sie zu GitHub und navigieren Sie zu Ihren Organisations- oder persönlichen Einstellungen:
   - **Für Organisationen:** Gehen Sie zu `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **Für persönliches Konto:** Gehen Sie zu `https://github.com/settings/apps`

2. Klicken Sie auf **„New GitHub App"**

3. Füllen Sie das Registrierungsformular aus:
   - **GitHub App name:** OneUptime (oder ein eindeutiger Name) - **Speichern Sie diesen Namen, Sie benötigen ihn für die Umgebungsvariable `GITHUB_APP_NAME`**
   - **Homepage URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **Wichtig: Diese URL ist der Ort, an den GitHub Benutzer nach der Installation der App weiterleitet.**
   - **Redirect on update:** Diese Option aktivieren, um Benutzer nach der Aktualisierung weiterzuleiten
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** Generieren Sie eine sichere Zufallszeichenkette (für später aufheben)

### Schritt 2: App-Berechtigungen konfigurieren

Im Abschnitt „Berechtigungen & Ereignisse" konfigurieren Sie die folgenden Berechtigungen:

**Repository-Berechtigungen:**

| Berechtigung | Zugriffsebene | Zweck |
|------------|--------------|---------|
| Contents | Lesen & Schreiben | Repository-Dateien lesen, Branches pushen (für KI-Agent erforderlich) |
| Pull requests | Lesen & Schreiben | Pull Requests erstellen und verwalten |
| Issues | Lesen & Schreiben | Issues lesen und kommentieren |
| Commit statuses | Lesen | Build-/CI-Status prüfen |
| Actions | Lesen | GitHub Actions Workflow-Läufe und Logs lesen |
| Metadata | Lesen | Grundlegende Repository-Metadaten (erforderlich) |

### Schritt 3: Webhook-Ereignisse abonnieren

Um Echtzeit-Updates zu erhalten, abonnieren Sie diese Webhook-Ereignisse:

- **Pull request** - Benachrichtigungen wenn PRs geöffnet, geschlossen oder zusammengeführt werden
- **Push** - Benachrichtigungen wenn Code gepusht wird
- **Workflow run** - CI/CD-Status-Updates erhalten

### Schritt 8: OneUptime-Umgebungsvariablen konfigurieren

#### Docker Compose

Fügen Sie diese Umgebungsvariablen zu Ihrer `config.env`-Datei hinzu:

```bash
# GitHub App-Konfiguration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # Der genaue Name Ihrer GitHub App (z. B. "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

#### Kubernetes mit Helm

Fügen Sie dies zu Ihrer `values.yaml`-Datei hinzu:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # Der genaue Name Ihrer GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Wichtig:** Starten Sie Ihren OneUptime-Server nach dem Hinzufügen dieser Umgebungsvariablen neu.

## Umgebungsvariablen-Referenz

| Variable | Beschreibung | Erforderlich |
|----------|-------------|----------|
| `GITHUB_APP_ID` | Die App-ID aus Ihren GitHub App-Einstellungen | Ja |
| `GITHUB_APP_NAME` | Der genaue Name Ihrer GitHub App | Ja |
| `GITHUB_APP_CLIENT_ID` | Die Client-ID aus Ihren GitHub App-Einstellungen | Ja |
| `GITHUB_APP_CLIENT_SECRET` | Das von Ihnen generierte Client-Secret | Ja |
| `GITHUB_APP_PRIVATE_KEY` | Der Inhalt des privaten Schlüssels (.pem-Datei) | Ja |
| `GITHUB_APP_WEBHOOK_SECRET` | Das Webhook-Secret zur Verifizierung von Webhook-Payloads | Nein (empfohlen) |

## Fehlerbehebung

### Häufige Probleme

**Keine Weiterleitung zurück zu OneUptime nach der Installation der GitHub App:**
- Stellen Sie sicher, dass die **Setup URL** in Ihren GitHub App-Einstellungen konfiguriert ist auf: `https://your-oneuptime-domain.com/api/github/auth/callback`

**Fehler „GitHub App is not configured":**
- Stellen Sie sicher, dass die Umgebungsvariable `GITHUB_APP_CLIENT_ID` gesetzt ist
- Starten Sie Ihren OneUptime-Server nach dem Setzen der Umgebungsvariablen neu

## Support

Bei Problemen mit der GitHub-Integration:

1. Prüfen Sie den Abschnitt zur Fehlerbehebung oben
2. Überprüfen Sie die OneUptime-Logs auf detaillierte Fehlermeldungen
3. Kontaktieren Sie uns unter [hello@oneuptime.com](mailto:hello@oneuptime.com)
