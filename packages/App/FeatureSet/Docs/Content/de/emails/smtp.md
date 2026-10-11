# SMTP

Versenden Sie die E-Mails von OneUptime über Ihren eigenen Mailserver. Ein Projekt legt SMTP-Konfigurationen an, mit denen seine Statusseiten ihre E-Mails versenden, und eine selbst gehostete Installation legt den Server fest, über den OneUptime alles andere versendet. Beide unterstützen drei Arten der Anmeldung:

- **Benutzername und Passwort**: klassische SMTP-Authentifizierung.
- **OAuth 2.0**: für Microsoft 365 und Google Workspace, wo die Standardauthentifizierung oft ausgeschaltet ist.
- **Keine**: für Relay-Server, die keine Authentifizierung verlangen.

```mermaid title="Welcher Mailserver was versendet"
flowchart TB
    SP["E-Mail einer Statusseite"] --> Q{"Benutzerdefinierte SMTP-Konfiguration<br/>für die Seite gewählt?"}
    Q -->|"Ja"| P["Die SMTP-Konfiguration<br/>des Projekts"]
    Q -->|"Nein"| D["Der eigene Mailserver<br/>von OneUptime"]
    E["Alle anderen E-Mails<br/>von OneUptime"] --> D
```

In einer selbst gehosteten Installation ist der eigene Mailserver von OneUptime derjenige, der im Admin Dashboard eingestellt ist. Eine Statusseite wählt ihre SMTP-Konfiguration auf ihrer Seite **Abonnenten-Einstellungen**, in der Karte **Benutzerdefiniertes SMTP**.

:::cards
- [Einen Mailserver hinzufügen](#einen-smtp-server-hinzufügen): Zwei Schritte, alles andere ist eingeklappt.
- [Microsoft 365](#konfiguration-für-microsoft-365): OAuth mit einer App-Registrierung in Entra.
- [Google Workspace](#konfiguration-für-google-workspace): OAuth mit einem Dienstkonto.
- [Fehlerbehebung](#fehlerbehebung): Häufige Fehler und was sie bedeuten.
:::

## Einen SMTP-Server hinzufügen

Den Mailserver eines Projekts fügen Sie unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen** in der Karte **Benutzerdefinierte SMTP-Konfigurationen** hinzu. In einer selbst gehosteten Installation legen Sie den Server, über den OneUptime selbst versendet, unter **Admin Dashboard > Einstellungen > Benachrichtigungen > E-Mails** in der Karte **Benutzerdefinierte E-Mail- und SMTP-Einstellungen** fest. Beide Formulare fragen dasselbe ab, in zwei Schritten.

:::steps
### Das Formular öffnen

:::tabs
@tab Projekt
Klicken Sie unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen** in der Karte **Benutzerdefinierte SMTP-Konfigurationen** auf **SMTP-Konfiguration erstellen**.
@tab Selbst gehostete Instanz
Öffnen Sie im Admin Dashboard **Einstellungen** und dann im Seitenmenü **Benachrichtigungen > E-Mails** (**Benachrichtigungen** ist anfangs eingeklappt). Klicken Sie in der Karte **E-Mail-Server-Einstellungen** auf **Server bearbeiten** und setzen Sie **E-Mail-Servertyp** auf `Custom SMTP`. Klicken Sie dann in der Karte **Benutzerdefinierte E-Mail- und SMTP-Einstellungen**, die darunter erscheint, auf **SMTP-Konfiguration bearbeiten**.
:::

### Den Schritt Server ausfüllen

Geben Sie im Schritt **Server** den **Name** (nur bei Projektkonfigurationen), den **Hostname**, den **Port** (eine neue Projektkonfiguration beginnt mit `587`), den **Benutzername** und das **Passwort** ein.

### Weitere Felder prüfen

Alles andere ist am Ende des Schritts **Server** unter **Weitere Felder** eingeklappt. Im eingeklappten Zustand sagt die Überschrift, wie E-Mails versendet werden, zum Beispiel „E-Mails werden über SMTP gesendet, mit Anmeldung per Benutzername und Passwort. TLS ist erforderlich.“ Öffnen Sie den Abschnitt nur, wenn Sie eine der Einstellungen aus der Tabelle unten ändern müssen.

### Den Schritt Absender ausfüllen

Geben Sie im Schritt **Absender** die **Absender-E-Mail** und den **Absendername** ein, von denen Ihre E-Mails kommen. Ihr Server muss das Senden von dieser Adresse erlauben.

### Speichern und eine Test-E-Mail senden

Speichern Sie die Konfiguration. Sobald eine Projektkonfiguration gespeichert ist, prüft **Test-E-Mail senden** in ihrer Zeile, ob sie funktioniert. Dafür braucht es die Berechtigung, SMTP-Konfigurationen hinzuzufügen: **Project Owner**, **Project Admin** oder **Create SMTP Config** und **Read SMTP Config** in einer eigenen Rolle. In OneUptime Cloud braucht es außerdem den Tarif **Growth**, wie das Hinzufügen einer Konfiguration. Für alle anderen ist die Schaltfläche gesperrt, und ihr Tooltip sagt, was sie braucht.

Der Test fragt nach einer **E-Mail**-Adresse, an die er sendet, zunächst Ihrer eigenen. Prüfen Sie, ob die Nachricht ankommt.
:::

Das sind die Einstellungen unter **Weitere Felder**:

| Feld | Was es bewirkt |
| --- | --- |
| **Transport** | `SMTP` (Standard) oder `Microsoft Graph` für einen Microsoft-365-Mandanten, in dem SMTP AUTH ausgeschaltet ist. Mit Microsoft Graph werden Hostname, Port, Benutzername und Passwort ausgeblendet und die OAuth-Felder angezeigt. |
| **TLS erzwingen** | Bei einer neuen Projektkonfiguration an. E-Mails werden nur über eine verschlüsselte Verbindung mit gültigem Zertifikat gesendet. Ist dies aus, werden E-Mails nur verschlüsselt, wenn der Server es anbietet, und das Zertifikat wird nicht geprüft. Port 465 ist immer verschlüsselt. |
| **Authentifizierungstyp** | `Username and Password` (Standard), `OAuth` oder `None` für ein Relay, das keine Anmeldung braucht. |
| **OAuth-Felder** | **OAuth-Anbietertyp**, **OAuth-Client-ID**, **OAuth-Client-Secret**, **OAuth-Token-URL** und **OAuth-Scope**; sie erscheinen, sobald OAuth oder Microsoft Graph gewählt ist. |
| **Beschreibung** | Eine Notiz für Ihr Team (nur bei Projektkonfigurationen). |

**Microsoft Graph.** Öffnen Sie **Weitere Felder**, setzen Sie **Transport** auf `Microsoft Graph` und tragen Sie eine Azure-App mit der Anwendungsberechtigung **Mail.Send** ein: ihre Client-ID und ihr Client-Secret, die Token-URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` und den Scope `https://graph.microsoft.com/.default`. E-Mails werden aus dem Postfach der **Absender-E-Mail** gesendet, das ein lizenziertes Postfach in Ihrem Mandanten sein muss.

> [!NOTE]
> In OneUptime Cloud muss der Mailserver eines Projekts über das Internet erreichbar sein: Ein Host, der zu einer privaten oder internen Adresse aufgelöst wird, wird abgelehnt. In einer selbst gehosteten Installation sind private Adressen erlaubt, sofern `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` nicht `true` ist; Loopback- und Link-Local-Adressen werden immer abgelehnt. Der eigene Mailserver der Instanz wird so nicht geprüft.

## Authentifizierung mit OAuth 2.0

Mit OAuth 2.0 meldet sich OneUptime ohne Passwort bei Ihrem Mailserver an, was Mail-Dienste für Unternehmen zunehmend verlangen. OneUptime unterstützt zwei OAuth-Grant-Typen:

- **Client Credentials**: verwendet von Microsoft 365 und den meisten OAuth-Anbietern.
- **JWT Bearer**: verwendet von Dienstkonten in Google Workspace.

```mermaid title="Wie sich OneUptime mit OAuth anmeldet"
sequenceDiagram
    participant O as OneUptime
    participant T as Token-URL
    participant M as Mailserver
    O->>T: Ein Zugriffstoken anfordern
    T-->>O: Zugriffstoken
    Note over O: Zwischengespeichert und<br/>vor Ablauf erneuert
    O->>M: Mit dem Token anmelden
    O->>M: Die E-Mail senden
```

**Authentifizierungstyp** und die OAuth-Felder finden Sie im Schritt Server des Formulars unter **Weitere Felder**. Um sich mit OAuth anzumelden, füllen Sie aus:

| Feld | Beschreibung |
| --- | --- |
| **Hostname** | Adresse des SMTP-Servers |
| **Port** | SMTP-Port (meist 587 für STARTTLS oder 465 für implizites TLS) |
| **Benutzername** | Die E-Mail-Adresse des Postfachs, das sendet |
| **Authentifizierungstyp** | `OAuth` |
| **OAuth-Anbietertyp** | `Client Credentials` für Microsoft 365 oder `JWT Bearer` für Google Workspace |
| **OAuth-Client-ID** | Anwendungs-ID (Client-ID) Ihres OAuth-Anbieters (bei Google: die E-Mail-Adresse des Dienstkontos) |
| **OAuth-Client-Secret** | Client-Secret Ihres OAuth-Anbieters (bei Google: der private Schlüssel) |
| **OAuth-Token-URL** | Der OAuth-Token-Endpunkt Ihres Anbieters |
| **OAuth-Scope** | Der OAuth-Scope, der SMTP-Zugriff gewährt |

OneUptime speichert OAuth-Token zwischen und erneuert sie automatisch, bevor sie ablaufen.

## Konfiguration für Microsoft 365

Um OAuth mit Microsoft 365 (Exchange Online) zu verwenden, registrieren Sie eine Anwendung in Microsoft Entra, geben ihr die Berechtigung, E-Mails über SMTP zu senden, und erlauben ihr, das Postfach zu verwenden, aus dem Sie senden.

:::steps
### Eine Anwendung in Microsoft Entra registrieren

1. Melden Sie sich im [Microsoft Entra Admin Center](https://entra.microsoft.com) an.
2. Gehen Sie zu **Identity** > **Applications** > **App registrations** und klicken Sie auf **New registration**.
3. Geben Sie einen Namen ein (zum Beispiel „OneUptime SMTP“), wählen Sie „Accounts in this organizational directory only“ und lassen Sie **Redirect URI** leer.
4. Klicken Sie auf **Register**.

Notieren Sie auf der Seite **Overview** die **Application (client) ID** (Ihre Client-ID) und die **Directory (tenant) ID** (für die Token-URL).

### Ein Client-Secret erstellen

1. Gehen Sie in Ihrer App-Registrierung zu **Certificates & secrets** und klicken Sie auf **New client secret**.
2. Fügen Sie eine Beschreibung hinzu, wählen Sie eine Gültigkeitsdauer und klicken Sie auf **Add**.
3. **Kopieren Sie den Wert des Secrets sofort**: Er wird nicht noch einmal angezeigt.

### Die SMTP-Berechtigung hinzufügen

1. Gehen Sie zu **API permissions** und klicken Sie auf **Add a permission**.
2. Wählen Sie **APIs my organization uses**, suchen Sie dann **Office 365 Exchange Online** und wählen Sie es aus.
3. Wählen Sie **Application permissions**, aktivieren Sie **SMTP.SendAsApp** und klicken Sie auf **Add permissions**.
4. Klicken Sie auf **Grant admin consent for [your organization]** (dafür sind Administratorrechte nötig).

### Den Dienstprinzipal in Exchange Online registrieren

Bevor die Anwendung E-Mails senden kann, registrieren Sie ihren Dienstprinzipal in Exchange Online und geben ihm Zugriff auf das Postfach, aus dem Sie senden:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Verwenden Sie `Add-MailboxPermission`, nicht `Add-RecipientPermission`. `Add-RecipientPermission` gewährt nur `SendAs` für den Empfänger, was nicht reicht, damit der Dienstprinzipal E-Mails über SMTP mit OAuth senden kann: Das Senden scheitert mit einem Authentifizierungs- oder Berechtigungsfehler.

### Die SMTP-Konfiguration in OneUptime anlegen

Legen Sie eine SMTP-Konfiguration mit diesen Einstellungen an oder bearbeiten Sie eine, wobei Sie `<tenant-id>` durch Ihre **Directory (tenant) ID** ersetzen:

| Feld | Wert |
| --- | --- |
| Hostname | `smtp.office365.com` |
| Port | `587` |
| Benutzername | Die E-Mail-Adresse, der Sie die Berechtigungen gegeben haben (z. B. `sender@yourdomain.com`) |
| Authentifizierungstyp | `OAuth` |
| OAuth-Anbietertyp | `Client Credentials` |
| OAuth-Client-ID | Ihre **Application (client) ID** |
| OAuth-Client-Secret | Der Wert des Client-Secrets |
| OAuth-Token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth-Scope | `https://outlook.office365.com/.default` |
| Absender-E-Mail | Wie Benutzername |
| TLS erzwingen | An |

Prüfen Sie sie dann mit **Test-E-Mail senden**.
:::

## Konfiguration für Google Workspace

Google Workspace braucht ein **Dienstkonto** mit domainweiter Delegierung, das E-Mails im Namen eines Benutzers Ihrer Domain sendet. Die SMTP-Server von Google unterstützen für Gmail keinen einfachen Client-Credentials-Ablauf.

### Bevor Sie mit Google Workspace beginnen

- Ein Google-Workspace-Konto. Private Gmail-Konten unterstützen das nicht.
- Super-Admin-Zugriff auf die Admin-Konsole von Google Workspace.
- Zugriff auf die Google Cloud Console.

:::steps
### Ein Google-Cloud-Projekt anlegen

1. Gehen Sie zur [Google Cloud Console](https://console.cloud.google.com).
2. Klicken Sie auf die Projektauswahl und wählen Sie **New Project**.
3. Geben Sie einen Projektnamen ein, klicken Sie auf **Create** und wählen Sie Ihr neues Projekt aus.

### Die Gmail API aktivieren

1. Gehen Sie zu **APIs & Services** > **Library**.
2. Suchen Sie nach „Gmail API“, klicken Sie auf **Gmail API** und dann auf **Enable**.

### Ein Dienstkonto anlegen

1. Gehen Sie zu **APIs & Services** > **Credentials**.
2. Klicken Sie auf **Create Credentials** > **Service account**.
3. Geben Sie einen Namen und eine Beschreibung ein, klicken Sie auf **Create and Continue**, überspringen Sie die optionalen Schritte und klicken Sie auf **Done**.

### Einen Schlüssel für das Dienstkonto erstellen

1. Klicken Sie auf das gerade angelegte Dienstkonto und gehen Sie zum Tab **Keys**.
2. Klicken Sie auf **Add Key** > **Create new key**, wählen Sie **JSON** und klicken Sie auf **Create**.
3. Bewahren Sie die heruntergeladene JSON-Datei sicher auf. Ihr `client_email` ist Ihre OAuth-Client-ID und ihr `private_key` Ihr OAuth-Client-Secret.

### Die domainweite Delegierung aktivieren

1. Klicken Sie in den Details des Dienstkontos auf **Show Advanced Settings**.
2. Notieren Sie die numerische **Client ID**.
3. Aktivieren Sie **Enable Google Workspace Domain-wide Delegation** und klicken Sie auf **Save**.

### Das Dienstkonto in der Admin-Konsole von Google Workspace autorisieren

1. Melden Sie sich in der [Admin-Konsole von Google Workspace](https://admin.google.com) an.
2. Gehen Sie zu **Security** > **Access and data control** > **API Controls** und klicken Sie auf **Manage Domain Wide Delegation**.
3. Klicken Sie auf **Add new**, geben Sie die numerische **Client ID** aus dem vorigen Schritt ein und tragen Sie unter **OAuth Scopes** `https://mail.google.com/` ein.
4. Klicken Sie auf **Authorize**.

Bis die Delegierung wirkt, können einige Minuten bis zu 24 Stunden vergehen.

### Die SMTP-Konfiguration für Google Workspace anlegen

Legen Sie eine SMTP-Konfiguration mit diesen Einstellungen an oder bearbeiten Sie eine:

| Feld | Wert |
| --- | --- |
| Hostname | `smtp.gmail.com` |
| Port | `587` |
| Benutzername | Die E-Mail-Adresse in Google Workspace, von der gesendet wird (z. B. `notifications@yourdomain.com`). Das Dienstkonto tritt im Namen dieses Benutzers auf. |
| Authentifizierungstyp | `OAuth` |
| OAuth-Anbietertyp | `JWT Bearer` |
| OAuth-Client-ID | Das `client_email` aus der JSON-Datei Ihres Dienstkontos (z. B. `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth-Client-Secret | Der `private_key` aus der JSON-Datei Ihres Dienstkontos (der ganze Schlüssel einschließlich `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----`) |
| OAuth-Token-URL | `https://oauth2.googleapis.com/token` |
| OAuth-Scope | `https://mail.google.com/` |
| Absender-E-Mail | Wie Benutzername |
| TLS erzwingen | An |

Prüfen Sie sie dann mit **Test-E-Mail senden**.
:::

> [!IMPORTANT]
> Bei Google (JWT Bearer) ist die **OAuth-Client-ID** die **E-Mail-Adresse des Dienstkontos** (`client_email`), nicht die numerische `client_id`. Das Dienstkonto tritt im Namen des Benutzers unter **Benutzername** auf, um E-Mails zu senden.

## Fehlerbehebung

### Fehler bei Microsoft 365

| Problem | Lösung |
| --- | --- |
| "Authentication unsuccessful" | Prüfen Sie, ob der Dienstprinzipal in Exchange registriert ist und Postfachberechtigungen hat |
| "AADSTS700016: Application not found" | Prüfen Sie, ob die Client-ID stimmt und die App in Ihrem Mandanten existiert |
| "AADSTS7000215: Invalid client secret" | Erstellen Sie ein neues Client-Secret: Das alte ist vielleicht abgelaufen |
| "The mailbox is not enabled for this operation" | Führen Sie `Add-MailboxPermission` aus, um Zugriff auf das Postfach zu gewähren |

### Fehler bei Google Workspace

| Problem | Lösung |
| --- | --- |
| "invalid_grant" | Stellen Sie sicher, dass die domainweite Delegierung richtig eingerichtet und wirksam ist |
| "unauthorized_client" | Prüfen Sie, ob die Client-ID in der Admin-Konsole von Google Workspace autorisiert ist |
| "access_denied" | Prüfen Sie, ob der Scope `https://mail.google.com/` autorisiert ist |
| "Domain policy has disabled third-party Drive apps" | Aktivieren Sie den API-Zugriff in der Admin-Konsole von Google Workspace unter Security > API Controls |

### Andere Probleme

:::details "Cannot send email. Please check your SMTP config."
**Test-E-Mail senden** meldet dies, wenn ein Server, bei dem man sich mit Benutzername und Passwort oder gar nicht anmeldet, die E-Mail nicht annimmt. Prüfen Sie **Hostname**, **Port**, **Benutzername** und **Passwort**. Wenn Ihr Server kein TLS anbietet oder sein Zertifikat für seinen Hostnamen nicht gültig ist, schalten Sie **TLS erzwingen** unter **Weitere Felder** aus und versuchen Sie es erneut. Die eigene Antwort des Servers wird mit dem Test aufbewahrt: Öffnen Sie den Tab **E-Mail** unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungsprotokolle** und wählen Sie in seiner Zeile **Statusmeldung anzeigen**.
:::

:::details "Cannot send email with OAuth authentication"
Die Anmeldung mit OAuth ist gescheitert, und die Meldung endet mit dem Fehler, den Ihr Anbieter zurückgegeben hat. Prüfen Sie **OAuth-Client-ID**, **OAuth-Client-Secret**, **OAuth-Token-URL** und **OAuth-Scope**, ob die Anwendung die oben genannten Berechtigungen hat und ob die Administratorzustimmung erteilt wurde. Wenn in Ihrem Microsoft-365-Mandanten SMTP AUTH ausgeschaltet ist, setzen Sie **Transport** stattdessen auf `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Eine Konfiguration, deren **Transport** `Microsoft Graph` ist, meldet dies, wenn Graph die E-Mail nicht annimmt, gefolgt vom eigenen Fehler von Microsoft. Prüfen Sie, ob die App die Anwendungsberechtigung **Mail.Send** mit erteilter Administratorzustimmung hat, ob **OAuth-Scope** `https://graph.microsoft.com/.default` ist und ob die **Absender-E-Mail** ein lizenziertes Postfach in Ihrem Mandanten ist.
:::

:::details "SMTP server host … could not be reached"
OneUptime hat die Verbindung zum Mailserver des Projekts abgelehnt. In OneUptime Cloud wird ein Hostname, der sich nicht auflösen lässt oder zu einer privaten, Loopback- oder Link-Local-Adresse aufgelöst wird, mit dieser Meldung abgelehnt, die nie sagt, welcher Fall vorliegt: Verwenden Sie den öffentlichen Hostnamen des Mailservers. In einer selbst gehosteten Installation und bei einem Mailserver, der als IP-Adresse angegeben ist, nennt die Meldung stattdessen den Grund. **Test-E-Mail senden** zeigt sie nur bei einer OAuth-Konfiguration; bei den anderen finden Sie sie unter **Statusmeldung anzeigen** im Tab **E-Mail** der Benachrichtigungsprotokolle.
:::

:::details Die Test-E-Mail kommt nicht an
Prüfen Sie die **Absender-E-Mail**: Ihr Server muss das Senden von ihr erlauben. Sehen Sie dann im Spam-Ordner des Empfängers nach und in den Protokollen Ihres Mailservers nach dem Versuch.
:::

## Bewährte Sicherheitspraktiken

- **Secrets regelmäßig erneuern.** Richten Sie Erinnerungen ein, um Client-Secrets zu ersetzen, bevor sie ablaufen.
- **Eigene Zugangsdaten verwenden.** Legen Sie für OneUptime eigene Zugangsdaten an, statt sie mit anderen Anwendungen zu teilen.
- **Nur die nötigsten Rechte gewähren.** Gewähren Sie nur, was das Senden braucht: **SMTP.SendAsApp** bei Microsoft, den Scope `https://mail.google.com/` bei Google.
- **Die Nutzung überwachen.** Prüfen Sie E-Mail-Protokolle und Anmeldungen von OAuth-Anwendungen auf Auffälligkeiten.
- **Secrets sicher aufbewahren.** Committen Sie Client-Secrets nie in die Versionsverwaltung.

## Weiterführende Literatur

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Nächste Schritte

:::cards
- [Benachrichtigungs-Zusammenfassung](/docs/emails/notification-rollup): Wie OneUptime Schübe von E-Mails an Eigentümer zusammenfasst.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers): Die E-Mails an die Abonnenten einer Statusseite über eine SMTP-Konfiguration des Projekts senden.
:::
