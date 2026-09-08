# Microsoft Teams-Integration

Um Microsoft Teams mit Ihrer selbst gehosteten OneUptime-Instanz zu integrieren, müssen Sie eine Azure App-Registrierung konfigurieren und die erforderlichen Umgebungsvariablen einrichten.

## Voraussetzungen

- Azure-Konto — Sie können eines erstellen unter [https://azure.com](https://azure.com)
- Zugriff auf Ihre OneUptime-Serverkonfiguration

## Netzwerkzugriff

OneUptime verwendet einen Azure Bot für die Teams-Integration. Eine Incoming-Webhook- oder Teams-Workflow-URL ersetzt den Messaging-Endpunkt dieses Bots nicht. Microsoft verlangt einen [öffentlich erreichbaren HTTPS-Endpunkt für einen selbst gehosteten Bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Eine private IP-Adresse, ein interner DNS-Name oder die VPN-Verbindung eines Mitarbeiters gewährt Azure Bot Service keinen Zugriff auf OneUptime.

| Funktion | OneUptime zum Anbieter | Anbieter zu OneUptime |
| --- | --- | --- |
| Teams-Benachrichtigungen | HTTPS zu Microsoft-APIs | Für die vollständige Bot-Integration einschließlich Unterhaltungserkennung erforderlich |
| Teams-Befehle, Kartenschaltflächen, Chat-Installationsereignisse | HTTPS | `POST /api/microsoft-bot/messages` |

Die App-Registrierungsumleitungen `/api/microsoft-teams/auth` und `/api/microsoft-teams/admin-consent/callback` erfolgen über den Browser des Benutzers. Dieser Browser muss OneUptime erreichen, beispielsweise über Ihr Firmennetzwerk oder VPN. Bot-Nachrichten und Kartenaktionen kommen von Microsofts Servern und benötigen einen eigenen erreichbaren Ingress. Ausgehende Warnungszustellung allein bestätigt keine eingehende Konnektivität.

### Produktivbetrieb: Gateway zur privaten Bereitstellung veröffentlichen

1. **Wählen Sie einen Hostnamen**, beispielsweise `oneuptime.example.com`. Veröffentlichen Sie öffentliche DNS-Einträge, die auf ein über das Internet erreichbares Gateway zeigen. Private IP-Adressen und ausschließlich interne DNS-Namen sind für die Anbieter unerreichbar. Mit Split-DNS können Mitarbeiter denselben Hostnamen zum privaten Ingress auflösen und das Dashboard weiterhin über das VPN nutzen. Auch der private Ingress muss HTTPS mit einem für diesen Hostnamen gültigen Zertifikat bereitstellen.

2. **Verbinden Sie das Gateway mit OneUptime.** Platzieren Sie es in einer DMZ mit einer Route zum privaten Ingress oder verwenden Sie ein öffentliches Gateway, das über Ihr eigenes Site-to-Site-VPN bzw. eine private Verbindung angebunden ist. Erlauben Sie Datenverkehr vom Gateway zum Ingress am Port des vorgelagerten Dienstes. Für Kubernetes/Portainer reicht ein privater `ClusterIP`-Dienst allein nicht: Das Gateway benötigt einen Ingress/Controller oder ein anderes erreichbares Ziel. Halten Sie Datenbanken und andere interne Dienste privat.

3. **Terminieren Sie HTTPS auf Port 443** mit einem öffentlich vertrauenswürdigen Zertifikat und vollständiger Zwischenzertifikatskette. Erlauben Sie eingehendes TCP 443 zum Gateway. Die Installation eines Zertifikats oder eine DNS-Änderung allein erzeugt keine Route zum privaten Ziel.

4. Veröffentlichen Sie nur `/api/microsoft-bot/messages` und tragen Sie diese vollständige öffentliche HTTPS-URL in Schritt 4 als Azure-Bot-Messaging-Endpunkt ein. OneUptimes Bot-Framework-Adapter muss die Anfragen empfangen und authentifizieren. Erhalten Sie Methode, Pfad, Abfragezeichenfolge, Body und Authentifizierungsheader (`Authorization`). Bewahren Sie den öffentlichen `Host` und setzen Sie vertrauenswürdige Header `X-Forwarded-Host` und `X-Forwarded-Proto: https`. Fügen Sie keine Weiterleitungen hinzu.

5. Nehmen Sie diese Pfade von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus. Lassen Sie OneUptimes Authentifizierung aktiviert. Beschränken Sie den Ursprungszugriff auf das Gateway und autorisierte interne Clients; maskieren Sie Token in Protokollen.

6. **Legen Sie die kanonische URL von OneUptime fest**:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-Werte:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Ersetzen Sie das Beispiel durch Ihre Domain. Diese Einstellungen erzeugen URLs, aber keine DNS-Einträge, TLS-Konfiguration oder Firewall-Regeln. Wenden Sie die Compose-Konfiguration beziehungsweise das Helm-Update an und warten Sie auf den Neustart der Anwendung. Bei einer Hostnamenänderung aktualisieren Sie den Azure-Bot-Endpunkt und die Weiterleitungs-URIs der App-Registrierung. Laden Sie anschließend das Teams-Manifest erneut herunter und hoch.

Die [Einstellungen für den Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) steuern ausgehende Anfragen von OneUptime an interne Dienste. Das Aktivieren von `ALLOW_PRIVATE_NETWORK_WEBHOOKS` macht OneUptime nicht für Teams erreichbar.

### Ausgehender Zugriff und IP-Beschränkungen

Erlauben Sie DNS-Auflösung und ausgehendes HTTPS (TCP 443) aus der OneUptime-Anwendung. Teams verwendet `graph.microsoft.com`, `login.microsoftonline.com`, Authentifizierungs-/Kanalendpunkte des Bot Framework und die Connector-Dienst-URL der Unterhaltung. Nutzen Sie [Microsofts Firewall-Anleitung](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) und untersuchen Sie beim Testen blockierten Datenverkehr; diese Beispiele sind keine vollständige Domainliste. Der Ersatz-Connector für die kommerzielle Cloud ist `https://smba.trafficmanager.net/teams/`; die Dienst-URL einer Unterhaltung kann abweichen.

Microsoft unterstützt keine festen eingehenden Bot-Framework-IP-Freigabelisten, da sich die Adressen ändern. Teams-Client-Medienbereiche sind keine Bot-Webhook-Quellbereiche. Lassen Sie die Bot-Framework-Authentifizierung aktiviert.

### Tests und Bereitstellungen ohne eingehenden Zugriff

Prüfen Sie öffentliches DNS und TLS von einem Netzwerk außerhalb Ihres VPN und prüfen Sie anschließend die Teams-Route:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Auf aktuellen OneUptime-Versionen erwarten Sie `405 Method Not Allowed` mit `Allow: POST`. Dies bestätigt, dass die GET-Anfrage die Route erreicht hat, nicht, dass eine authentifizierte Bot-POST-Anfrage funktioniert. Ältere Versionen können den JSON-404-Fehler von OneUptime zurückgeben; prüfen Sie den Antwort-Body und die Proxy-Protokolle. TLS-Fehler, Zeitüberschreitungen oder eine HTML-Fehlerseite des Proxys weisen auf Zertifikats- oder Routingprobleme hin.

Verbinden Sie Teams, senden Sie eine Testbenachrichtigung, schreiben Sie dem Bot und betätigen Sie eine Kartenschaltfläche. Prüfen Sie die Aktion in OneUptime und vergleichen Sie Microsofts Diagnosen mit Gateway- und Anwendungsprotokollen. Eine zugestellte Benachrichtigung bestätigt keinen authentifizierten eingehenden POST.

Für die Entwicklung beschreibt Microsofts [Teams-Testanleitung](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams), wie ein lokaler Dienst durch einen Tunnel erreichbar gemacht wird. Leiten Sie zum OneUptime-Ingress weiter und verwenden Sie `/api/microsoft-bot/messages` anstelle des Microsoft-Beispielpfads `/api/messages`. Aktualisieren Sie den Azure-Bot-Endpunkt bei jeder Änderung der öffentlichen Tunnel-URL und verwenden Sie im Produktivbetrieb einen stabilen Ingress. Konfigurieren Sie außerdem den passenden OneUptime-Hostnamen. Beenden Sie den Tunnel nach den Tests; er ermöglicht weiterhin eingehenden Zugriff.

Wenn eingehende Verbindungen vollständig verboten sind, funktioniert die vollständige Teams-Integration nicht: Befehle, Kartenaktionen und Unterhaltungserkennung sind darauf angewiesen. Eine vollständig getrennte Installation kann Teams nicht verwenden.

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
