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
   - **Request user authorization (OAuth) during installation:** **Aktivieren Sie diese erforderliche Option.** OneUptime überprüft mit OAuth die Eigentümerschaft der Installation und lehnt die Verbindung ohne diese Einstellung ab.
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** Generieren Sie eine sichere Zufallszeichenkette (für später aufheben)

### Schritt 2: App-Berechtigungen konfigurieren

Im Abschnitt „Berechtigungen & Ereignisse" konfigurieren Sie die folgenden Berechtigungen:

**Repository-Berechtigungen:**

| Berechtigung    | Zugriffsebene     | Zweck                                                                 |
| --------------- | ----------------- | --------------------------------------------------------------------- |
| Contents        | Lesen & Schreiben | Repository-Dateien lesen, Branches pushen (für KI-Agent erforderlich) |
| Pull requests   | Lesen & Schreiben | Pull Requests erstellen und verwalten                                 |
| Issues          | Lesen & Schreiben | Issues lesen und kommentieren                                         |
| Commit statuses | Lesen             | Build-/CI-Status prüfen                                               |
| Actions         | Lesen             | GitHub Actions Workflow-Läufe und Logs lesen                          |
| Metadata        | Lesen             | Grundlegende Repository-Metadaten (erforderlich)                      |

### Schritt 3: Webhook-Ereignisse abonnieren

OneUptime synchronisiert Installation und Repository-Zugriff über `installation` und `installation_repositories`, die GitHub Apps automatisch erhalten. Andere Ereignisse wie **Pull request**, **Push** und **Workflow run** werden derzeit nur bestätigt; ihr Abonnement aktiviert keine Benachrichtigungen oder CI/CD-Automatisierung.

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
  name: "YOUR_APP_NAME" # Der genaue Name Ihrer GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Wichtig:** Starten Sie Ihren OneUptime-Server nach dem Hinzufügen dieser Umgebungsvariablen neu.

## Umgebungsvariablen-Referenz

| Variable                    | Beschreibung                                              | Erforderlich     |
| --------------------------- | --------------------------------------------------------- | ---------------- |
| `GITHUB_APP_ID`             | Die App-ID aus Ihren GitHub App-Einstellungen             | Ja               |
| `GITHUB_APP_NAME`           | Der genaue Name Ihrer GitHub App                          | Ja               |
| `GITHUB_APP_CLIENT_ID`      | Die Client-ID aus Ihren GitHub App-Einstellungen          | Ja               |
| `GITHUB_APP_CLIENT_SECRET`  | Das von Ihnen generierte Client-Secret                    | Ja               |
| `GITHUB_APP_PRIVATE_KEY`    | Der Inhalt des privaten Schlüssels (.pem-Datei)           | Ja               |
| `GITHUB_APP_WEBHOOK_SECRET` | Das Webhook-Secret zur Verifizierung von Webhook-Payloads | Ja, für Webhooks |

## Netzwerkzugriff für selbst gehostete Bereitstellungen

### Verkehrsrichtung und Endpunkte

| Verkehr | Erforderlicher Zugriff |
| --- | --- |
| OneUptime → GitHub | DNS und ausgehendes HTTPS über TCP 443 zu `api.github.com` für App-Tokens und Repository-API-Aufrufe sowie `github.com` für OAuth-Tokenaustausch und HTTPS-Git-Operationen |
| GitHub → OneUptime | Öffentliches HTTPS über TCP 443 zu `POST /api/github/webhook` für die Synchronisierung von Installation und Repository-Zugriff |
| Browser des Benutzers → OneUptime | Dashboard und `GET /api/github/auth/callback` für Installation/Autorisierung; diese können über das Benutzer-VPN erreichbar bleiben |

Callback- und Setup-URL dienen einer [Browserweiterleitung](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url); den Webhook rufen GitHubs Server auf. Das Benutzer-VPN ermöglicht GitHub keinen Webhook-Zugriff. Die genannten Domains decken Kernanfragen ab; Repository-Werkzeuge, Downloads, LFS oder Pakete können weitere Ziele benötigen. Diese Einstellungen gelten für GitHub.com; Firewalländerungen konfigurieren keine Unterstützung für einen GitHub-Enterprise-Server-Hostnamen.

### Private Bereitstellungen und Callback-Sicherheit

Verwenden Sie öffentliches DNS und ein Gateway mit öffentlich vertrauenswürdigem HTTPS-Zertifikat, vollständiger Zertifikatskette und privater Route zum OneUptime-Ingress. Erlauben Sie eingehendes TCP 443 und veröffentlichen Sie nur die oben genannten Provider-POST-Callbacks. Ein privater `ClusterIP`, internes DNS oder ein Mitarbeiter-VPN allein ermöglicht dem Provider keinen Zugriff. Mit Split-DNS bleiben Dashboard und Browser-OAuth-Routen unter demselben Hostnamen privat erreichbar.

Setzen Sie `HOST=oneuptime.example.com` und `HTTP_PROTOCOL=https` in `config.env`, beziehungsweise `host: oneuptime.example.com` und `httpProtocol: https` in Helm. Wenden Sie die Konfiguration an und warten Sie auf den Neustart. Diese Werte erzeugen URLs; DNS, TLS und Firewallzugriff müssen separat eingerichtet werden. Aktualisieren Sie nach einer Hostnamenänderung die Webhook-, Callback-, Setup- und Homepage-URLs der GitHub App.

Erhalten Sie Methode, ursprünglichen Pfad, Abfrageparameter, Body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` und `X-GitHub-Delivery`. Übermitteln Sie öffentlichen Host und HTTPS-Schema über vertrauenswürdige Proxy-Header. Nehmen Sie den Webhook von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus. Lassen Sie GitHubs SSL-Prüfung aktiviert und setzen Sie in beiden Systemen dasselbe `GITHUB_APP_WEBHOOK_SECRET`: OneUptime lehnt unsignierte Anfragen ab und kann ohne dieses Secret keine Webhooks prüfen. Siehe [GitHubs Validierungsanleitung](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Wenn Sie zusätzlich Quell-IPs einschränken, verwenden und aktualisieren Sie die `hooks`-Bereiche der GitHub Meta API. Verwenden Sie keine GitHub-Actions-Runner-Bereiche und behalten Sie die Signaturprüfung bei. GitHub weist darauf hin, dass [Adressen wechseln und die Liste unvollständig ist](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Zugriff prüfen und Einschränkungen verstehen

Schließen Sie die Installation aus OneUptime ab und prüfen Sie **Advanced > Recent Deliveries** der GitHub App. Senden oder wiederholen Sie eine Testzustellung und prüfen Sie Weiterleitung und Annahme. Fügen Sie ein Test-Repository hinzu oder entfernen Sie es und prüfen Sie die aktualisierte Repository-Liste. GitHub beschreibt die [Zustellungsdiagnose](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) und verlangt [eine 2xx-Bestätigung innerhalb von zehn Sekunden](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Ein Browser-GET testet keinen signierten POST.

Ohne eingehenden Zugriff können Browserautorisierung und ausgehende API-/Git-Operationen funktionieren; Installationslöschungen und Repository-Zugriffsänderungen werden jedoch nicht per Webhook synchronisiert. OneUptime verarbeitet derzeit `installation` und `installation_repositories`; andere angenommene Ereignisse bedeuten keine zusätzliche Automatisierung. Die [Einstellung für private Netzwerke](/docs/self-hosted/private-network-access) steuert ausgehende Anfragen an private Ziele und macht den Webhook nicht erreichbar.

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
