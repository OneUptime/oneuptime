# SMTP-Konfiguration

OneUptime unterstützt das Versenden von E-Mails über benutzerdefinierte SMTP-Server mit drei Authentifizierungsmethoden:

- **Benutzername und Passwort** – Traditionelle SMTP-Authentifizierung
- **OAuth 2.0** – Moderne Authentifizierung für Microsoft 365 und Google Workspace
- **Keine** – Für Relay-Server, die keine Authentifizierung erfordern

Diese Anleitung beschreibt, wie Sie die OAuth 2.0-Authentifizierung für Microsoft 365 und Google Workspace konfigurieren.

## OAuth 2.0-Authentifizierung

OAuth 2.0 bietet eine sicherere Möglichkeit zur Authentifizierung bei E-Mail-Servern, insbesondere für Unternehmensumgebungen, die die Basisauthentifizierung deaktiviert haben. OneUptime unterstützt zwei OAuth-Grant-Typen:

- **Client Credentials** – Wird von Microsoft 365 und den meisten OAuth-Anbietern verwendet
- **JWT Bearer** – Wird von Google Workspace-Dienstkonten verwendet

### Erforderliche Felder für OAuth

Bei der Konfiguration von SMTP mit OAuth-Authentifizierung in OneUptime benötigen Sie:

| Feld | Beschreibung |
|-------|-------------|
| **Hostname** | SMTP-Serveradresse |
| **Port** | SMTP-Port (in der Regel 587 für STARTTLS oder 465 für implizites TLS) |
| **Benutzername** | Die E-Mail-Adresse, von der aus gesendet werden soll |
| **Authentifizierungstyp** | „OAuth" auswählen |
| **OAuth-Anbietertyp** | „Client Credentials" für Microsoft 365 oder „JWT Bearer" für Google Workspace auswählen |
| **Client-ID** | Anwendungs-/Client-ID von Ihrem OAuth-Anbieter (für Google: Dienstkonto-E-Mail) |
| **Client Secret** | Client Secret von Ihrem OAuth-Anbieter (für Google: privater Schlüssel) |
| **Token-URL** | OAuth-Token-Endpunkt-URL |
| **Scope** | Erforderliche OAuth-Bereiche für den SMTP-Zugriff |

---

## Microsoft 365-Konfiguration

Um OAuth mit Microsoft 365/Exchange Online zu verwenden, müssen Sie eine Anwendung in Microsoft Entra (Azure AD) registrieren und die entsprechenden Berechtigungen konfigurieren.

### Schritt 1: Anwendung in Microsoft Entra registrieren

1. Melden Sie sich beim [Microsoft Entra Admin Center](https://entra.microsoft.com) an
2. Navigieren Sie zu **Identität** > **Anwendungen** > **App-Registrierungen**
3. Klicken Sie auf **Neue Registrierung**
4. Geben Sie einen Namen für Ihre Anwendung ein (z. B. "OneUptime SMTP")
5. Wählen Sie unter **Unterstützte Kontotypen** „Nur Konten in diesem Organisationsverzeichnis"
6. Lassen Sie **Umleitungs-URI** leer (wird für den Client-Credentials-Flow nicht benötigt)
7. Klicken Sie auf **Registrieren**

Notieren Sie nach der Registrierung die folgenden Werte von der **Übersicht**-Seite:
- **Anwendungs-(Client-)ID** – Dies ist Ihre Client-ID
- **Verzeichnis-(Mandanten-)ID** – Diese benötigen Sie für die Token-URL

### Schritt 2: Client Secret erstellen

1. Gehen Sie in Ihrer App-Registrierung zu **Zertifikate und Geheimnisse**
2. Klicken Sie auf **Neues Client Secret**
3. Fügen Sie eine Beschreibung hinzu und wählen Sie einen Ablaufzeitraum
4. Klicken Sie auf **Hinzufügen**
5. **Kopieren Sie den geheimen Wert sofort** – er wird nicht erneut angezeigt

### Schritt 3: SMTP-API-Berechtigungen hinzufügen

1. Gehen Sie zu **API-Berechtigungen**
2. Klicken Sie auf **Berechtigung hinzufügen**
3. Wählen Sie **Von meiner Organisation verwendete APIs**
4. Suchen und wählen Sie **Office 365 Exchange Online**
5. Wählen Sie **Anwendungsberechtigungen**
6. Suchen und aktivieren Sie **SMTP.SendAsApp**
7. Klicken Sie auf **Berechtigungen hinzufügen**
8. Klicken Sie auf **Administratorzustimmung erteilen für [Ihre Organisation]** (erfordert Administratorrechte)

### Schritt 4: Dienstprinzipal in Exchange Online registrieren

Bevor Ihre Anwendung E-Mails senden kann, müssen Sie den Dienstprinzipal in Exchange Online registrieren und Postfachberechtigungen erteilen.

1. Installieren Sie das Exchange Online PowerShell-Modul:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Verbinden Sie sich mit Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registrieren Sie den Dienstprinzipal (verwenden Sie die Objekt-ID aus **Unternehmensanwendungen**, nicht aus App-Registrierungen):

```powershell
# Objekt-ID in Microsoft Entra > Unternehmensanwendungen > Ihre App > Objekt-ID finden
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Erteilen Sie dem Dienstprinzipal die Berechtigung, als ein bestimmtes Postfach zu senden:

```powershell
# Vollzugriff auf das Postfach für den Dienstprinzipal erteilen
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Hinweis:** Verwenden Sie `Add-MailboxPermission` (nicht `Add-RecipientPermission`). `Add-RecipientPermission` erteilt nur `SendAs` auf dem Empfänger und reicht für den Dienstprinzipal zum Senden von E-Mails über SMTP mit OAuth nicht aus – Sie erhalten einen Authentifizierungs-/Berechtigungsfehler beim Senden. `Add-MailboxPermission` mit `FullAccess` ist der Befehl, der tatsächlich funktioniert.

### Schritt 5: In OneUptime konfigurieren

Erstellen oder bearbeiten Sie in OneUptime eine SMTP-Konfiguration mit diesen Einstellungen:

| Feld | Wert |
|-------|-------|
| Hostname | `smtp.office365.com` |
| Port | `587` |
| Benutzername | Die E-Mail-Adresse, für die Sie Berechtigungen erteilt haben (z. B. `sender@yourdomain.com`) |
| Authentifizierungstyp | `OAuth` |
| OAuth-Anbietertyp | `Client Credentials` |
| Client-ID | Ihre Anwendungs-(Client-)ID aus Schritt 1 |
| Client Secret | Der geheime Wert aus Schritt 2 |
| Token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| Absender-E-Mail | Gleich wie Benutzername |
| Sicher (TLS) | Aktiviert |

Ersetzen Sie `<tenant-id>` durch Ihre Verzeichnis-(Mandanten-)ID aus Schritt 1.

---

## Google Workspace-Konfiguration

Google Workspace erfordert ein **Dienstkonto** mit domänenweiter Delegierung, um E-Mails im Namen von Benutzern zu senden. Dies ist notwendig, da Googles SMTP-Server keinen direkten OAuth-Client-Credentials-Flow für Gmail unterstützen.

### Voraussetzungen

- Google Workspace-Konto (kein normales Gmail – Consumer-Gmail-Konten unterstützen dies nicht)
- Super Admin-Zugriff auf die Google Workspace Admin-Konsole
- Zugriff auf die Google Cloud Console

### Schritt 1: Google Cloud-Projekt erstellen

1. Gehen Sie zur [Google Cloud Console](https://console.cloud.google.com)
2. Klicken Sie auf das Projekt-Dropdown und wählen Sie **Neues Projekt**
3. Geben Sie einen Projektnamen ein und klicken Sie auf **Erstellen**
4. Wählen Sie Ihr neues Projekt

### Schritt 2: Gmail API aktivieren

1. Gehen Sie zu **APIs und Dienste** > **Bibliothek**
2. Suchen Sie nach "Gmail API"
3. Klicken Sie auf **Gmail API** und dann auf **Aktivieren**

### Schritt 3: Dienstkonto erstellen

1. Gehen Sie zu **APIs und Dienste** > **Anmeldedaten**
2. Klicken Sie auf **Anmeldedaten erstellen** > **Dienstkonto**
3. Geben Sie einen Namen und eine Beschreibung für das Dienstkonto ein
4. Klicken Sie auf **Erstellen und fortfahren**
5. Überspringen Sie die optionalen Schritte und klicken Sie auf **Fertig**

### Schritt 4: Dienstkonto-Schlüssel erstellen

1. Klicken Sie auf das soeben erstellte Dienstkonto
2. Gehen Sie zum Tab **Schlüssel**
3. Klicken Sie auf **Schlüssel hinzufügen** > **Neuen Schlüssel erstellen**
4. Wählen Sie **JSON** und klicken Sie auf **Erstellen**
5. Speichern Sie die heruntergeladene JSON-Datei sicher – sie enthält:
   - `client_id` – Ihre Client-ID
   - `private_key` – Ihr Client Secret (der private Schlüssel)

### Schritt 5: Domänenweite Delegierung aktivieren

1. Klicken Sie in den Dienstkonto-Details auf **Erweiterte Einstellungen anzeigen**
2. Notieren Sie die **Client-ID** (numerische ID)
3. Aktivieren Sie **Domänenweite Delegierung für Google Workspace aktivieren**
4. Klicken Sie auf **Speichern**

### Schritt 6: Dienstkonto in der Google Workspace Admin-Konsole autorisieren

1. Melden Sie sich bei der [Google Workspace Admin-Konsole](https://admin.google.com) an
2. Gehen Sie zu **Sicherheit** > **Zugriff und Datenkontrolle** > **API-Steuerung**
3. Klicken Sie auf **Domänenweite Delegierung verwalten**
4. Klicken Sie auf **Neu hinzufügen**
5. Geben Sie die **Client-ID** aus Schritt 5 ein
6. Geben Sie für **OAuth-Bereiche** ein: `https://mail.google.com/`
7. Klicken Sie auf **Autorisieren**

Hinweis: Die Weitergabe der Delegierung kann einige Minuten bis zu 24 Stunden dauern.

### Schritt 7: In OneUptime konfigurieren

Erstellen oder bearbeiten Sie in OneUptime eine SMTP-Konfiguration mit diesen Einstellungen:

| Feld | Wert |
|-------|-------|
| Hostname | `smtp.gmail.com` |
| Port | `587` |
| Benutzername | Die Google Workspace E-Mail-Adresse, von der aus gesendet werden soll (z. B. `notifications@yourdomain.com`). Dieser Benutzer wird vom Dienstkonto imitiert. |
| Authentifizierungstyp | `OAuth` |
| OAuth-Anbietertyp | `JWT Bearer` |
| Client-ID | Die `client_email` aus Ihrer Dienstkonto-JSON-Datei (z. B. `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | Der `private_key` aus Ihrer Dienstkonto-JSON-Datei (der gesamte Schlüssel einschließlich `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----`) |
| Token-URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| Absender-E-Mail | Gleich wie Benutzername |
| Sicher (TLS) | Aktiviert |

**Wichtig:** Für Google (JWT Bearer) ist die Client-ID die **Dienstkonto-E-Mail** (`client_email`), NICHT die numerische `client_id`. Das Dienstkonto imitiert den im Feld Benutzername angegebenen Benutzer, um E-Mails zu senden.

---

## Fehlerbehebung

### Microsoft 365

| Problem | Lösung |
|-------|----------|
| "Authentication unsuccessful" | Überprüfen Sie, ob der Dienstprinzipal in Exchange registriert ist und Postfachberechtigungen hat |
| "AADSTS700016: Application not found" | Prüfen Sie, ob die Client-ID korrekt ist und die App in Ihrem Mandanten vorhanden ist |
| "AADSTS7000215: Invalid client secret" | Erstellen Sie das Client Secret neu – es kann abgelaufen sein |
| "The mailbox is not enabled for this operation" | Führen Sie `Add-MailboxPermission` aus, um Zugriff auf das Postfach zu erteilen |

### Google Workspace

| Problem | Lösung |
|-------|----------|
| "invalid_grant" | Stellen Sie sicher, dass die domänenweite Delegierung korrekt konfiguriert und weitergegeben wurde |
| "unauthorized_client" | Überprüfen Sie, ob die Client-ID in der Google Workspace Admin-Konsole autorisiert ist |
| "access_denied" | Prüfen Sie, ob der Bereich `https://mail.google.com/` autorisiert ist |
| "Domain policy has disabled third-party Drive apps" | Aktivieren Sie den API-Zugriff in der Google Workspace Admin-Konsole unter Sicherheit > API-Steuerung |

### Allgemein

- **Konfiguration testen**: Verwenden Sie die Schaltfläche „Test-E-Mail senden" in OneUptime, um Ihre Einrichtung zu überprüfen
- **Logs prüfen**: Überprüfen Sie OneUptime-Logs auf detaillierte Fehlermeldungen
- **Token-Caching**: OneUptime cached OAuth-Token und erneuert sie automatisch vor dem Ablauf

---

## Sicherheits-Best-Practices

1. **Geheimnisse regelmäßig rotieren**: Kalender-Erinnerungen setzen, um Client Secrets vor ihrem Ablauf zu rotieren
2. **Dedizierte Dienstkonten verwenden**: Separate Anmeldedaten für OneUptime erstellen, anstatt sie mit anderen Anwendungen zu teilen
3. **Prinzip der minimalen Berechtigung**: Nur die minimal notwendigen Berechtigungen erteilen (SMTP.SendAsApp für Microsoft, mail.google.com-Bereich für Google)
4. **Nutzung überwachen**: E-Mail-Logs und OAuth-Anwendungsanmeldungen auf ungewöhnliche Aktivitäten prüfen
5. **Sichere Speicherung**: Client Secrets niemals in die Versionsverwaltung übertragen

---

## Weitere Ressourcen

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
