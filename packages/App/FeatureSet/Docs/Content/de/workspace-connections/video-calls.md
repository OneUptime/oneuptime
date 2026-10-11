# Videoanrufe

Geben Sie jedem Vorfall und jeder Warnung einen eigenen Anruf. Wenn eine Benachrichtigungsregel für Slack oder Microsoft Teams bei einem neuen Vorfall oder einer neuen Warnung auslöst, startet OneUptime ein eigenes Meeting (ein Zoom-Meeting, ein Google Meet, ein Microsoft-Teams-Meeting oder den Huddle des Slack-Kanals des Vorfalls) und postet eine Schaltfläche **Anruf beitreten** überall dort, wohin die Updates des Vorfalls gehen. Responder treten mit einem Klick bei, und niemand muss um 3 Uhr nachts ein Meeting anlegen und den Link herumschicken.

:::cards
- [So funktioniert es](#so-funktioniert-es): Eine Regel startet den Anruf, und Responder treten bei, wo immer sie sind.
- [Mit einem Klick verbinden](#mit-einem-klick-verbinden): Zoom, Google Meet oder Microsoft Teams, per Anmeldung.
- [Anbieter](#anbieter): Die Dienstidentität Ihrer eigenen App, ein fester Meeting-Link oder ein Slack-Huddle.
- [Einen Anruf von Hand starten](#einen-anruf-von-hand-starten): Von der Seite eines Vorfalls oder einer Warnung.
:::

## So funktioniert es

```mermaid title="Von einer Benachrichtigungsregel zur Schaltfläche Join call"
flowchart TB
    declared["Ein Vorfall oder eine Warnung<br/>wird gemeldet"] --> rule{"Eine Slack- oder Teams-Regel<br/>mit Videoanruf passt"}
    rule --> start["OneUptime startet einen Anruf<br/>mit der Verbindung der Regel"]
    start --> posted["Join call in seinen Kanälen,<br/>seinem Feed und auf seiner Seite"]
    start -.->|"der Anbieter lehnt ab"| failed["Der Feed sagt, warum,<br/>der Vorfall läuft weiter"]
```

:::steps
### Einen Anbieter verbinden

Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Videoanrufe** und verbinden Sie Zoom, Google Meet oder Microsoft Teams, oder fügen Sie einen festen Meeting-Link hinzu. In OneUptime Cloud ist das Verbinden von Zoom, Google Meet oder Microsoft Teams ein Klick: Melden Sie sich an und erlauben Sie OneUptime, Meetings anzulegen (siehe [Mit einem Klick verbinden](#mit-einem-klick-verbinden)). Slack-Huddles brauchen nichts außer der Slack-Verbindung des Projekts.

### In einer Regel einschalten

Öffnen Sie eine Benachrichtigungsregel für Slack oder Microsoft Teams für Vorfälle oder Warnungen (zum Beispiel **Vorfälle** > **Arbeitsbereich** > **Slack**). Schalten Sie im Schritt **Videoanruf** der Regel **Start a video call for the incident** ein und wählen Sie, wo der Anruf stattfindet.

### Mit einem Klick beitreten

Wenn die Regel auslöst, startet OneUptime einen Anruf für den Vorfall und postet ihn mit einer Schaltfläche **Anruf beitreten** in die Kanäle, in die die Updates des Vorfalls gehen, und in den Feed des Vorfalls. Die Seite des Vorfalls zeigt den Anruf in ihrer Karte **Videoanruf** und eine Schaltfläche **Anruf beitreten** in ihrem Kopfbereich.
:::

Die Bedingungen der Regel entscheiden, welche Vorfälle einen Anruf bekommen. Für eine Konferenz nur bei Sev1-Vorfällen geben Sie der Regel eine Bedingung **Schweregrad**. Anrufe starten für Vorfälle und Warnungen, die als laufend gemeldet werden. Ein bereits behoben erstellter Vorfall bekommt keinen Anruf.

### Ein Anruf pro Vorfall

Ein Anruf wird pro Vorfall einmal für jeden Ort gestartet, an dem ein Anruf stattfindet. Regeln, die dieselbe Verbindung wählen, teilen sich einen Anruf, und eine Regel startet nie einen zweiten Anruf für einen Vorfall, der schon einen über diese Verbindung hat. Regeln, die verschiedene Orte wählen, starten jeweils ihren eigenen Anruf, zum Beispiel ein Zoom-Meeting für die Responder und den Huddle des Slack-Kanals des Vorfalls.

### Wenn ein Anruf nicht starten kann

Das Melden eines Vorfalls wartet nie auf einen Anbieter von Videoanrufen. Der Anruf wird gestartet, nachdem der Vorfall erstellt ist, sodass ein langsamer oder ausfallender Anbieter weder den Vorfall noch seine Bereitschaftsbenachrichtigungen verzögert.

Lehnt der Anbieter ab (ein abgelaufenes Secret, eine fehlende Berechtigung, ein gelöschter Host), sagt der Feed des Vorfalls, dass der Anruf der Regel nicht gestartet werden konnte, mit dem Grund des Anbieters, damit die Responder wissen, dass sie einen von der Seite des Vorfalls starten. Der Lauf der Regel steht in den Workspace-Benachrichtigungsprotokollen als **Videoanruf starten**, und die Zeile der Verbindung unter **Projekteinstellungen** > **Arbeitsbereich** > **Videoanrufe** zeigt den Fehler, bis wieder ein Anruf startet.

### Private Vorfälle

Ein Meeting wird nach dem Vorfall benannt, für den es ist, mit dessen Nummer und Titel, und seine Beschreibung verlinkt zurück auf den Vorfall. Bei einem privaten Vorfall bleibt der Titel weg, weil alle, die zum Meeting eingeladen sind, seinen Namen lesen können.

## Mit einem Klick verbinden

In OneUptime Cloud braucht das Verbinden von Zoom, Google Meet oder Microsoft Teams einen Klick und nichts, was beim Anbieter einzurichten wäre:

:::steps
1. Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Videoanrufe** und klicken Sie bei Zoom, Google Meet oder Microsoft Teams auf **Verbinden**.
2. Klicken Sie auf **Continue to Zoom** (oder Google, oder Microsoft), melden Sie sich an und erlauben Sie OneUptime, Meetings anzulegen.
3. Sie kommen mit hergestellter Verbindung auf die Seite der Videoanrufe zurück. **Testmeeting starten** prüft sie von Anfang bis Ende; wählen Sie die Verbindung dann in einer Benachrichtigungsregel für Slack oder Microsoft Teams.
:::

Jedes Meeting wird als das Konto angelegt, mit dem Sie sich anmelden, und dieses Konto ist der Host. Melden Sie sich mit einem gemeinsamen Konto an, etwa incidents@example.com, statt mit Ihrem eigenen, damit Anrufe weiter starten, wenn Leute gehen. Die Zeile der Verbindung zeigt, als wer sie angemeldet ist.

| Anbieter | Anmelden mit | Was OneUptime darf |
| --- | --- | --- |
| Zoom | Einem Zoom-Benutzer. Meetings mit einem Basic-Benutzer (kostenlos) als Host enden nach 40 Minuten. | Meetings für diesen Benutzer anlegen (`meeting:write:meeting`) und lesen, wer er ist (`user:read:user`). |
| Google Meet | Einem Google-Konto, das Google Meet nutzen kann. | Meet-Räume als dieses Konto anlegen (`meetings.space.created`) und seine E-Mail-Adresse lesen. |
| Microsoft Teams | Einem Geschäfts- oder Schulkonto mit Microsoft Teams. Persönliche Microsoft-Konten können keine Teams-Meetings anlegen. | Onlinebesprechungen als dieses Konto anlegen (die delegierte Berechtigung `OnlineMeetings.ReadWrite`) und angemeldet bleiben (`offline_access`). |

Eine per Anmeldung hergestellte Verbindung hat weiterhin die Einstellungen, die entscheiden, wer wartet: **Who can join** für Google Meet und **Who skips the lobby** für Microsoft Teams. Ändern Sie sie mit **Bearbeiten** in der Zeile der Verbindung.

### Angemeldet bleiben

OneUptime bewahrt das Refresh-Token der Anmeldung verschlüsselt auf und erneuert es mindestens einmal pro Woche, sodass es nie durch Nichtbenutzung abläuft, wie lange das Projekt auch ohne Vorfall bleibt. Funktioniert die Anmeldung nicht mehr (das Konto hat OneUptime entfernt, wurde gelöscht oder gesperrt, oder die Richtlinie Ihrer Organisation verlangt eine neue Anmeldung), zeigt die Zeile der Verbindung **Not working** mit dem Grund, und zwar an dem Tag, an dem OneUptime es bemerkt, nicht erst beim nächsten Vorfall. **Reconnect** in der Zeile meldet sie erneut an.

Verbindungen, die mit demselben Konto angemeldet sind, teilen sich eine Anmeldung, in jedem Projekt: Zoom behält nur eine Anmeldung pro Konto, daher ersetzt ein erneutes Verbinden desselben Zoom-Benutzers sie für alle.

### Neu verbinden und entfernen

**Reconnect** in der Zeile einer Verbindung meldet sie erneut an, mit demselben oder einem anderen Konto. Nutzen Sie es, nachdem das Konto OneUptime entfernt hat, oder um Vorfall-Meetings auf ein anderes Konto zu verlegen.

Das Löschen einer Verbindung entzieht OneUptime den Zugriff bei Zoom und Google, sobald keine andere Verbindung die Anmeldung nutzt. Bei Microsoft entfernen Sie OneUptime unter **My Apps** (myapps.microsoft.com) des Kontos. Das Entfernen von OneUptime aus Ihrem Zoom-Konto im Zoom App Marketplace löscht seine Anmeldung aus jeder Verbindung, die mit diesem Konto angemeldet ist, und sie zeigen **Not working**, bis sie neu verbunden werden.

### Wenn Microsoft nach einem Administrator fragt

Manche Microsoft-365-Organisationen lassen nur Administratoren Apps genehmigen. Sagt Microsoft, dass Sie eine Administratorgenehmigung brauchen, bitten Sie eine Administratorin oder einen Administrator von Microsoft 365, Microsoft Teams zu verbinden oder OneUptime im [Microsoft Entra Admin Center](https://entra.microsoft.com/) unter **Enterprise applications** > **Admin consent requests** zu genehmigen.

### Stattdessen Ihre eigene App nutzen

Um mit einer Dienstidentität statt der Anmeldung einer Person zu verbinden — einer Zoom-App vom Typ Server-to-Server OAuth, einem Google-Dienstkonto mit domänenweiter Delegierung oder einer App-Registrierung in Microsoft Entra — klicken Sie im Dialog Verbinden auf **Use your own Zoom app** (oder Google, oder Microsoft). [Anbieter](#anbieter) erklärt jede davon. Auf einem selbst gehosteten Server ohne eingerichtete Ein-Klick-Apps öffnet **Verbinden** direkt dieses Formular; siehe [Ein-Klick-Verbindung auf einem selbst gehosteten Server](#ein-klick-verbindung-auf-einem-selbst-gehosteten-server), um sie einzurichten.

## Einen Anruf von Hand starten

Die Karte **Videoanruf** auf der Seite eines Vorfalls oder einer Warnung hat **Anruf starten** (oder **Weiteren starten**, sobald es einen gibt). Wählen Sie eine der Verbindungen des Projekts, den Huddle des Slack-Kanals des Vorfalls, oder fügen Sie einen eigenen Meeting-Link ein. Der Anruf wird in die Kanäle und den Feed des Vorfalls gepostet wie einer, den eine Regel startet.

**Entfernen** auf der Karte nimmt einen Anruf von der Seite des Vorfalls. Das Meeting selbst wird nicht gelöscht, und alle mit dem Link können ihm weiterhin beitreten.

Anrufe zu starten und zu entfernen braucht die Berechtigung, an Vorfällen (oder Warnungen) zu arbeiten: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** oder **Incident Member**, oder **Create Incident Video Call** und **Delete Incident Video Call** in einer benutzerdefinierten Rolle. Alle, die den Vorfall lesen können, sehen seine Anrufe.

## Anbieter

Dieser Abschnitt behandelt das Verbinden eines Anbieters mit der Dienstidentität Ihrer eigenen App: einer Zoom-App vom Typ Server-to-Server OAuth, einem Google-Dienstkonto, einer App-Registrierung in Microsoft Entra. Eine Dienstidentität hängt nie an einer Person, also funktioniert sie weiter, wer auch geht. Um stattdessen per Anmeldung zu verbinden, siehe [Mit einem Klick verbinden](#mit-einem-klick-verbinden).

Zugangsdaten werden verschlüsselt gespeichert und nie von der API zurückgegeben. Wenn Sie eine Verbindung bearbeiten, behält ein leer gelassenes Zugangsdatum das gespeicherte.

**Testmeeting starten** im Verbindungsformular und **Testen** in der Zeile einer Verbindung legen mit den Einstellungen der Verbindung ein echtes Meeting an und zeigen dessen Link. Das ist die eine Prüfung, die zeigt, dass Zugangsdaten, Berechtigung beim Anbieter und Host zusammen funktionieren. Gepostet wird nichts.

Einen Anbieter zu verbinden braucht **Project Owner**, **Project Admin** oder **Settings Admin**, oder **Create Video Call Connection** und **Edit Video Call Connection** in einer benutzerdefinierten Rolle.

### Zoom

OneUptime legt für jeden Vorfall ein Zoom-Meeting über eine Zoom-App vom Typ **Server-to-Server OAuth** an, mit einem lizenzierten Zoom-Benutzer Ihrer Wahl als Host.

:::steps
1. Wählen Sie im [Zoom App Marketplace](https://marketplace.zoom.us/) **Develop** > **Build App** und legen Sie eine App vom Typ **Server-to-Server OAuth** an. Dazu braucht es eine Administratorin oder einen Administrator des Zoom-Kontos, oder eine Rolle, die Server-to-Server-OAuth-Apps erlaubt.
2. Fügen Sie auf der Seite **Scopes** der App **meeting:write:meeting:admin** hinzu (ein Meeting für einen Benutzer anlegen). Eine App, die vor den granularen Scopes angelegt wurde, kann stattdessen **meeting:write:admin** nutzen.
3. Klicken Sie bei der App auf **Activate** und kopieren Sie dann **Account ID**, **Client ID** und **Client secret** von ihrer Seite **App Credentials** in das Verbindungsformular.
4. Geben Sie den **Meeting host** ein: die E-Mail-Adresse eines lizenzierten Zoom-Benutzers, idealerweise ein Dienstkonto wie incidents@example.com, damit Meetings weiter funktionieren, wenn Leute gehen. Meetings mit einem Basic-Benutzer (kostenlos) als Host enden nach 40 Minuten.
5. Responder treten bei, ohne auf den Host zu warten, weil der Host ein Dienstkonto ist, das nie beitritt. Stellen Sie sicher, dass die Einstellung **Waiting room** Ihres Zoom-Kontos nicht fest eingeschaltet ist, sonst kommt niemand hinein.
:::

| Feld | Wo Sie es finden |
| --- | --- |
| Account ID | Die Seite **App Credentials** der App |
| Client ID | Die Seite **App Credentials** der App |
| Client secret | Die Seite **App Credentials** der App |
| Meeting host | Die E-Mail-Adresse des lizenzierten Zoom-Benutzers, der jedes Meeting hostet |

### Google Meet

OneUptime legt für jeden Vorfall ein Google Meet mit der Google Meet REST API an, über ein Dienstkonto von Google Cloud, das mit domänenweiter Delegierung als Benutzer von Google Workspace handelt.

:::steps
1. Wählen oder erstellen Sie in der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt und aktivieren Sie dafür die **Google Meet REST API**.
2. Legen Sie unter **IAM & Admin** > **Service accounts** ein Dienstkonto an. Öffnen Sie es, gehen Sie zu **Keys** > **Add key** > **Create new key**, wählen Sie **JSON** und fügen Sie die heruntergeladene Datei als **Service account JSON key** in das Verbindungsformular ein.
3. Öffnen Sie in der [Google Admin Console](https://admin.google.com/) **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** und klicken Sie auf **Add new**. Geben Sie die numerische **Client ID** des Dienstkontos und den Scope `https://www.googleapis.com/auth/meetings.space.created` ein.
4. Geben Sie unter **Create meetings as** den Benutzer von Google Workspace ein, als der das Dienstkonto handelt: ein eigenes Konto wie incidents@example.com. Jedes Meeting gehört diesem Benutzer.
:::

**Who can join** entscheidet, wer ohne Nachfrage beitritt: Mit **People in your organization join directly, others ask to join** (der Standard) bitten Personen außerhalb Ihres Google Workspace um Beitritt, und jemand im Anruf lässt sie herein. Mit **Anyone with the link joins directly** wartet niemand.

Die domänenweite Delegierung kann einige Minuten brauchen, bis sie wirkt. Meldet der Test direkt nach dem Hinzufügen der Delegierung, dass Google das Dienstkonto nicht als den Benutzer handeln ließ, warten Sie ein paar Minuten und testen Sie erneut.

### Microsoft Teams

OneUptime legt für jeden Vorfall ein Microsoft-Teams-Meeting mit Microsoft Graph an, über eine App-Registrierung in Microsoft Entra, die Meetings im Namen eines lizenzierten Teams-Benutzers organisiert.

:::steps
1. Öffnen Sie im [Microsoft Entra Admin Center](https://entra.microsoft.com/) **App registrations** > **New registration** und registrieren Sie eine Single-Tenant-App. Kopieren Sie ihre **Directory (tenant) ID** und **Application (client) ID**.
2. Fügen Sie unter **API permissions** die Microsoft-Graph-Berechtigung vom Typ **application** **OnlineMeetings.ReadWrite.All** hinzu und klicken Sie dann auf **Grant admin consent**.
3. Legen Sie unter **Certificates & secrets** ein Client Secret an und fügen Sie seinen **Value**, nicht seine Secret ID, als **Client-Secret** in das Verbindungsformular ein.
4. Wählen Sie den Organisator: einen lizenzierten Teams-Benutzer, idealerweise ein Dienstkonto. Kopieren Sie seine **Object ID** aus **Users** im Entra Admin Center in **Organizer object ID**.
5. Erlauben Sie der App mit einer Anwendungszugriffsrichtlinie, Meetings für den Organisator anzulegen. Führen Sie in Teams PowerShell nach `Connect-MicrosoftTeams` die beiden Befehle unten aus.
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

Die Richtlinie kann bis zu 30 Minuten brauchen, bis sie greift. Bis dahin meldet der Test, dass die App keine Meetings für den Organisator anlegen darf.

**Who skips the lobby** entscheidet, wer ohne Warten beitritt: Mit **People in your organization skip the lobby** (der Standard) warten alle anderen in der Lobby, bis jemand im Meeting sie hereinlässt. Mit **Everyone skips the lobby** wartet niemand.

### Meeting-Link

Ein fester Meeting-Link ist für jeden Vorfall derselbe Raum: ein persönlicher Zoom-Meetingraum, ein wiederkehrendes Meeting in Microsoft Teams oder Google Meet, ein persönlicher Webex-Raum oder ein Jitsi-Raum. Pro Vorfall wird nichts angelegt, also gibt es nichts zu autorisieren.

:::steps
1. Legen Sie in dem Werkzeug, das Ihr Team schon nutzt, ein Meeting an, das nie abläuft.
2. Fügen Sie seinen https-Beitrittslink als **Meeting-Link** in das Verbindungsformular ein.
:::

Jeder Vorfall und jede Warnung, die mit dieser Verbindung gestartet werden, teilen sich den Raum, also teilen ihn auch zwei gleichzeitige Vorfälle. Stellen Sie sicher, dass das Meeting Beitritte ohne Host erlaubt.

### Slack-Huddles

Eine Slack-Regel kann stattdessen den Huddle des Slack-Kanals des Vorfalls starten. Es gibt nichts zu verbinden: Wählen Sie im Schritt **Videoanruf** der Regel **Slack-Huddle**.

Der Huddle findet in dem Kanal statt, den die Regel für den Vorfall anlegt, oder, wenn die Regel stattdessen in bestehende Kanäle postet, im ersten davon. Die Regel muss also einen Kanal anlegen oder in einen bestehenden posten. Die Schaltfläche **Huddle beitreten** öffnet den Huddle des Kanals in Slack. Der erste Responder, der ihn öffnet, startet den Huddle, und alle danach treten ihm bei. Slack bietet keinen Weg, einen Huddle für eine App zu starten, daher ist niemand im Huddle, bis jemand ihn öffnet.

Ein Slack-Huddle gibt es nur für Slack-Regeln. Eine Microsoft-Teams-Regel startet ihre Anrufe mit einer der Videoanruf-Verbindungen des Projekts.

## Die API nutzen

Ein Anruf ist ein Datensatz am Vorfall (`IncidentVideoCall`) oder an der Warnung (`AlertVideoCall`). Legen Sie einen mit der `_id` des Vorfalls und einem der folgenden an:

- `videoCallConnectionId`: ein neues Meeting mit dieser Verbindung starten.
- `provider` auf `SlackHuddle` gesetzt: der Huddle des Slack-Kanals des Vorfalls.
- `joinUrl` (und optional `title`): ein eigener Meeting-Link.

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` startet ein Testmeeting mit einer gespeicherten Verbindung (`{ "connectionId": "..." }`) oder mit noch nicht gespeicherten Einstellungen (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`) und gibt dessen `joinUrl` zurück.

Das `authMethod` einer Verbindung sagt, wie sie sich anmeldet: `OAuth` für eine per Anmeldung hergestellte, `AppCredentials` für eine mit den Zugangsdaten Ihrer eigenen App, und nichts für einen Meeting-Link. Eine per Anmeldung hergestellte Verbindung entsteht nur durch Anmelden, im Dashboard. Über die API können Sie sie umbenennen und ihr `config` ändern, und ihr `connectedAccount` sagt, als wer sie angemeldet ist.

## Ein-Klick-Verbindung auf einem selbst gehosteten Server

OneUptime Cloud hat eigene Apps von Zoom, Google und Microsoft für die Ein-Klick-Verbindung. Ein selbst gehosteter Server bietet sie für jeden Anbieter an, dessen App Sie einrichten. Ohne eine öffnet **Verbinden** das Formular für Ihre eigene App.

Legen Sie pro Anbieter eine OAuth-App an und registrieren Sie darauf diese Weiterleitungs-URI, mit dem Host Ihres Servers:

| Anbieter | Weiterleitungs-URI | Umgebungsvariablen | Helm-Werte |
| --- | --- | --- | --- |
| Zoom | `https://<host>/api/video-call-oauth/zoom/callback` | `ZOOM_APP_CLIENT_ID`, `ZOOM_APP_CLIENT_SECRET`, `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.clientId`, `zoomApp.clientSecret`, `zoomApp.webhookSecretToken` |
| Google Meet | `https://<host>/api/video-call-oauth/google-meet/callback` | `GOOGLE_MEET_APP_CLIENT_ID`, `GOOGLE_MEET_APP_CLIENT_SECRET` | `googleMeetApp.clientId`, `googleMeetApp.clientSecret` |
| Microsoft Teams | `https://<host>/api/video-call-oauth/microsoft-teams/callback` | `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID`, `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET` | `microsoftTeamsMeetingsApp.clientId`, `microsoftTeamsMeetingsApp.clientSecret` |

- **Zoom**: Wählen Sie im [Zoom App Marketplace](https://marketplace.zoom.us/) **Develop** > **Build App** und legen Sie eine **General App** an, von Benutzern verwaltet. Tragen Sie unter **Basic Information** die Weiterleitungs-URI als OAuth Redirect URL auf den Registerkarten **Development** und **Production** und in der OAuth-Allowlist ein, und setzen Sie auf der Registerkarte **Production** die Endpunkt-URL für **Deauthorization Notification** auf `https://<host>/api/video-call-oauth/zoom/events`. Fügen Sie unter **Scopes** `meeting:write:meeting` und `user:read:user` hinzu. Das **Secret Token** unter **Features** > **Access** ist `ZOOM_APP_WEBHOOK_SECRET_TOKEN`. Die Zugangsdaten unter **Development** funktionieren nur für Benutzer Ihres eigenen Zoom-Kontos; die unter **Production** funktionieren für alle, sobald Zoom die App geprüft und veröffentlicht hat.
- **Google Meet**: Aktivieren Sie in der [Google Cloud Console](https://console.cloud.google.com/) die **Google Meet REST API**, konfigurieren Sie den OAuth-Zustimmungsbildschirm (**Google Auth Platform**) mit den Scopes `openid`, `email` und `https://www.googleapis.com/auth/meetings.space.created`, und legen Sie einen OAuth-Client vom Typ **Web application** mit der Weiterleitungs-URI an. Veröffentlichen Sie die App in die Produktion: Eine App, die im Testmodus bleibt, verliert ihre Anmeldungen nach sieben Tagen. Google prüft Apps, die den Meet-Scope anfordern; bis dahin sehen Personen vor der Anmeldung eine Warnung.
- **Microsoft Teams**: Registrieren Sie im [Microsoft Entra Admin Center](https://entra.microsoft.com/) eine App für **Accounts in any organizational directory**, fügen Sie die Weiterleitungs-URI als **Web**-Weiterleitungs-URI hinzu, fügen Sie die delegierten Microsoft-Graph-Berechtigungen `openid`, `profile`, `email`, `offline_access` und `OnlineMeetings.ReadWrite` hinzu und legen Sie ein Client Secret an. Nutzen Sie eine eigene Registrierung, nicht die des Microsoft-Teams-Bots (`MICROSOFT_TEAMS_APP_CLIENT_ID`). Solange die App keinen verifizierten Herausgeber hat, brauchen die meisten Organisationen eine Administratorin oder einen Administrator, um ihr zuzustimmen.

Die Client-IDs sind öffentlich: Sie werden an das Dashboard gesendet, damit es weiß, welche Anbieter sich mit einem Klick verbinden. Halten Sie die Secrets und das Webhook-Secret-Token geheim. Der Worker erneuert täglich die fälligen Anmeldungen, braucht also dieselben Werte wie die App.

## Fehlerbehebung

:::details Für einen Vorfall wurde kein Anruf gestartet
Prüfen Sie, dass die Regel zum Vorfall gepasst hat (**Regel testen**), dass ihr Schritt **Videoanruf** eingeschaltet ist und dass der Vorfall als laufend gemeldet wurde: Ein bereits behoben erstellter Vorfall bekommt keinen Anruf. Eine Regel, die für den Vorfall mit dieser Verbindung schon einen Anruf gestartet hat, startet keinen weiteren.
:::

:::details Der Feed sagt, der Anruf konnte nicht gestartet werden
Der Anbieter hat abgelehnt, und der Feed nennt seinen Grund. Starten Sie in der Zwischenzeit einen Anruf von der Seite des Vorfalls. Führen Sie dann **Testen** in der Zeile der Verbindung aus: Es zeigt denselben Grund, während Sie die Einrichtung beim Anbieter korrigieren, etwa ein abgelaufenes Client Secret oder eine fehlende Berechtigung.
:::

:::details Eine Verbindung zeigt Not working
Ihre Anmeldung funktioniert nicht mehr: Das Konto hat OneUptime entfernt, wurde gelöscht oder gesperrt, oder muss sich neu anmelden. Klicken Sie in ihrer Zeile auf **Reconnect**. Bis dahin können die Anrufe, die sie starten soll, nicht starten.
:::

:::details Leute warten in einer Lobby oder einem Warteraum
Ändern Sie **Who can join** (Google Meet) oder **Who skips the lobby** (Microsoft Teams) mit **Bearbeiten** in der Zeile der Verbindung. Stellen Sie bei Zoom sicher, dass die Einstellung **Waiting room** des Kontos nicht fest eingeschaltet ist.
:::

## Nächste Schritte

:::cards
- [Slack](/docs/workspace-connections/slack): Die Regeln, die Anrufe starten, und die Kanäle, in die sie posten.
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Dieselben Regeln und Anrufe in Microsoft Teams.
- [Microsoft-Teams-Integration](/docs/self-hosted/microsoft-teams-integration): Den Teams-Bot auf einem selbst gehosteten Server einrichten.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents): Was passiert, wenn ein Vorfall beginnt.
:::
