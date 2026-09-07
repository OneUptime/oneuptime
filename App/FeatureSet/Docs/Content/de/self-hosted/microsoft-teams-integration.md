# Microsoft Teams-Integration

Um Microsoft Teams mit Ihrer selbst gehosteten OneUptime-Instanz zu integrieren, müssen Sie eine Azure App-Registrierung konfigurieren und die erforderlichen Umgebungsvariablen einrichten.

## Voraussetzungen

- Azure-Konto — Sie können eines erstellen unter [https://azure.com](https://azure.com)
- Zugriff auf Ihre OneUptime-Serverkonfiguration

### Bereitstellungen in privaten Netzwerken

OneUptime verwendet einen Azure Bot für die Teams-Integration. Eine Incoming-Webhook- oder Teams-Workflow-URL ersetzt den Messaging-Endpunkt dieses Bots nicht. Microsoft verlangt einen [öffentlich erreichbaren HTTPS-Endpunkt für einen selbst gehosteten Bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Eine private IP-Adresse, ein interner DNS-Name oder die VPN-Verbindung eines Mitarbeiters gewährt Azure Bot Service keinen Zugriff auf OneUptime.

Befolgen Sie vor der weiteren Einrichtung die Anleitung zum [Zugriff aus privaten Netzwerken für Integrationen](/docs/self-hosted/integration-network-access). Diese behandelt öffentliches DNS, vertrauenswürdiges TLS, einen Reverse-Proxy zur Weiterleitung an Ihre private Bereitstellung, Firewall-Regeln und die Überprüfung. Veröffentlichen Sie für Teams `/api/microsoft-bot/messages` und setzen Sie den Azure-Bot-**Messaging-Endpunkt** in Schritt 4 auf diese vollständige öffentliche HTTPS-URL. Erhalten Sie das Präfix `/api`, den Anfrage-Body und den Header `Authorization`. Lassen Sie die Bot-Authentifizierung die Anfragen prüfen; eine interaktive Proxy-Anmeldung oder Browser-Abfrage verhindert deren Zustellung durch Microsoft.

Die App-Registrierungsumleitungen `/api/microsoft-teams/auth` und `/api/microsoft-teams/admin-consent/callback` erfolgen über den Browser des Benutzers. Dieser Browser muss OneUptime erreichen, beispielsweise über Ihr Firmennetzwerk oder VPN. Bot-Nachrichten und Kartenaktionen kommen von Microsofts Servern und benötigen einen eigenen erreichbaren Ingress. Ausgehende Warnungszustellung allein bestätigt keine eingehende Konnektivität.

Für die Entwicklung beschreibt Microsofts [Teams-Testanleitung](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug), wie ein lokaler Dienst durch einen Tunnel erreichbar gemacht wird. Leiten Sie zum OneUptime-Ingress weiter und verwenden Sie `/api/microsoft-bot/messages` anstelle des Microsoft-Beispielpfads `/api/messages`. Aktualisieren Sie den Azure-Bot-Endpunkt bei jeder Änderung der öffentlichen Tunnel-URL und verwenden Sie im Produktivbetrieb einen stabilen Ingress.

Azure Bot Private Endpoint ersetzt diesen Teams-Ingress nicht. Microsofts [Anleitung zur Netzwerkisolation](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) beschreibt Direct-Line-Isolation und erklärt, dass das Deaktivieren des öffentlichen Netzwerkzugriffs die Teams-Kanalkonfiguration entfernt.

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

- **Team.ReadBasic.All**, **Channel.ReadBasic.All**

`ChannelMessage.Send` ist ausschließlich eine delegierte Berechtigung; laut [Microsoft-Graph-Berechtigungsreferenz](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend) gibt es keine Variante als Anwendungsberechtigung. Belassen Sie sie in der obigen Liste delegierter Berechtigungen.

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

1. Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams**
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
