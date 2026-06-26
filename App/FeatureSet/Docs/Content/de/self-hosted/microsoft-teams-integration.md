# Microsoft Teams-Integration

Um Microsoft Teams mit Ihrer selbst gehosteten OneUptime-Instanz zu integrieren, müssen Sie eine Azure App-Registrierung konfigurieren und die erforderlichen Umgebungsvariablen einrichten.

## Voraussetzungen

- Azure-Konto — Sie können eines erstellen unter [https://azure.com](https://azure.com)
- Zugriff auf Ihre OneUptime-Serverkonfiguration

## Einrichtungsanweisungen

### Schritt 1: Azure App-Registrierung erstellen

1. Gehen Sie zum [Azure Portal](https://portal.azure.com)
2. Navigieren Sie zu „App-Registrierungen" und klicken Sie auf „Neue Registrierung"
3. Füllen Sie das Registrierungsformular aus:
   - **Name:** oneuptime
   - **Unterstützte Kontotypen:** Konten in einem beliebigen Organisationsverzeichnis (Mehrinstanzenfähig)
   - **Umleitungs-URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Fügen Sie auch hinzu: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Klicken Sie auf „Registrieren"
5. Notieren Sie die „Anwendungs-(Client-)ID" — Sie benötigen diese später

### Schritt 2: App-Berechtigungen konfigurieren

1. Gehen Sie in Ihrer App-Registrierung zu „API-Berechtigungen"
2. Klicken Sie auf „Berechtigung hinzufügen" und wählen Sie „Microsoft Graph"

**Delegierte Berechtigungen hinzufügen:**

- **User.Read** — Erforderlich, um das Profil des authentifizierten Benutzers abzurufen
- **Team.ReadBasic.All** — Erforderlich, um Teams aufzulisten, in denen der Benutzer Mitglied ist
- **Channel.ReadBasic.All** — Erforderlich, um Kanalinformationen zu lesen
- **ChannelMessage.Send** — Erforderlich, um Benachrichtigungen an Teams-Kanäle zu senden

**Anwendungsberechtigungen hinzufügen:**

- **Team.ReadBasic.All**, **Channel.ReadBasic.All**, **ChannelMessage.Send**

3. Klicken Sie auf „Administratorzustimmung erteilen" für Ihre Organisation

### Schritt 3: Client-Secret erstellen

1. Gehen Sie zu „Zertifikate und Geheimnisse" in Ihrer App-Registrierung
2. Klicken Sie auf „Neues Client-Secret"
3. Fügen Sie eine Beschreibung hinzu und legen Sie den Ablaufzeitraum fest (24 Monate empfohlen)
4. Klicken Sie auf „Hinzufügen" und kopieren Sie den geheimen Wert sofort

**Wichtig:** Kopieren Sie nicht die Geheimnis-ID, sondern den Geheimnis-WERT.

### Schritt 4: Bot-Dienst erstellen

1. Navigieren Sie im Azure Portal zu „Azure Bot" und klicken Sie auf „Erstellen"
2. Füllen Sie das Bot-Erstellungsformular aus:

   - **Bot-Handle:** oneuptime-bot
   - Verwenden Sie die App-(Client-)ID und Mandanten-ID aus Ihrer App-Registrierung

3. Nach der Bereitstellung gehen Sie zu Ihrer Bot-Ressource und navigieren Sie zu „Konfiguration"
4. Setzen Sie den „Messaging-Endpunkt" auf `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
5. Speichern Sie die Konfiguration

### Schritt 5: Microsoft Teams-Kanal zum Bot hinzufügen

1. Navigieren Sie in Ihrer Azure Bot-Ressource zu „Kanäle"
2. Suchen Sie und wählen Sie „Microsoft Teams" und klicken Sie auf „Öffnen" oder „Hinzufügen"
3. Klicken Sie auf „Speichern"

### Schritt 6: OneUptime-Umgebungsvariablen konfigurieren

#### Docker Compose

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes mit Helm

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
  tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Wichtig:** Starten Sie Ihren OneUptime-Server nach dem Hinzufügen dieser Umgebungsvariablen neu.

### Schritt 7: Teams-App-Manifest hochladen

1. Gehen Sie zu Projekteinstellungen > **Integrationen** > **Microsoft Teams**
2. Laden Sie das Teams-App-Manifest von dort herunter
3. Gehen Sie zu Microsoft Teams, klicken Sie auf „Apps" in der Seitenleiste
4. Klicken Sie am unteren Rand auf „Ihre Apps verwalten"
5. Klicken Sie auf „Benutzerdefinierte App hochladen"
6. Wählen Sie „Für mich oder meine Teams hochladen"
7. Laden Sie die heruntergeladene Manifest-ZIP-Datei hoch

## Fehlerbehebung

Bei Problemen:

- Stellen Sie sicher, dass Ihre App die richtigen Berechtigungen hat
- Prüfen Sie, ob die Umleitungs-URI exakt übereinstimmt
- Überprüfen Sie, ob Ihre Umgebungsvariablen korrekt gesetzt sind
- Stellen Sie sicher, dass der Bot-Messaging-Endpunkt vom Internet erreichbar ist

## Support

Wir möchten diese Integration verbessern, daher ist Feedback sehr willkommen. Bitte senden Sie uns Feedback an [hello@oneuptime.com](mailto:hello@oneuptime.com)
