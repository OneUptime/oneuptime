# Videosamtal

Ge varje incident och varje larm ett eget samtal. När en aviseringsregel för Slack eller Microsoft Teams utlöses för en ny incident eller ett nytt larm startar OneUptime ett eget möte (ett Zoom-möte, ett Google Meet, ett Microsoft Teams-möte eller huddlen i incidentens Slack-kanal) och publicerar en **Join call**-knapp överallt där incidentens uppdateringar hamnar. Responders ansluter med ett klick, och ingen behöver skapa ett möte klockan 3 på natten och skicka runt länken.

:::cards
- [Så fungerar det](#så-fungerar-det): En regel startar samtalet, och responders ansluter var de än är.
- [Anslut med ett klick](#anslut-med-ett-klick): Zoom, Google Meet eller Microsoft Teams, genom att logga in.
- [Leverantörer](#leverantörer): Din egen apps tjänsteidentitet, en fast möteslänk eller en Slack-huddle.
- [Starta ett samtal manuellt](#starta-ett-samtal-manuellt): Från en incidents eller ett larms sida.
:::

## Så fungerar det

```mermaid title="Från en aviseringsregel till en Join call-knapp"
flowchart TB
    declared["En incident eller ett larm<br/>deklareras"] --> rule{"En Slack- eller Teams-regel<br/>med videosamtal matchar"}
    rule --> start["OneUptime startar ett samtal<br/>med regelns anslutning"]
    start --> posted["Join call publicerat i dess kanaler,<br/>dess feed och på dess sida"]
    start -.->|"leverantören avvisar"| failed["Feeden säger varför,<br/>incidenten fortsätter"]
```

:::steps
### Anslut en leverantör

Gå till **Projektinställningar** > **Arbetsyta** > **Video Calls** och anslut Zoom, Google Meet eller Microsoft Teams, eller lägg till en fast möteslänk. På OneUptime Cloud är det ett klick att ansluta Zoom, Google Meet eller Microsoft Teams: logga in och tillåt OneUptime att skapa möten (se [Anslut med ett klick](#anslut-med-ett-klick)). Slack-huddles behöver inget utöver projektets Slack-anslutning.

### Slå på det i en regel

Öppna en aviseringsregel för Slack eller Microsoft Teams för incidenter eller larm (**Incidenter** > **Arbetsyta** > **Slack**, till exempel). I regelns steg **Video Call** slår du på **Start a video call for the incident** och väljer var samtalet hålls.

### Delta med ett klick

När regeln utlöses startar OneUptime ett samtal för incidenten och publicerar det med en **Join call**-knapp i de kanaler som incidentens uppdateringar går till och i incidentens feed. Incidentens sida visar samtalet i kortet **Video Call** och en **Join call**-knapp i sidhuvudet.
:::

Regelns villkor avgör vilka incidenter som får ett samtal. För en brygga bara vid Sev1-incidenter ger du regeln ett villkor på **Allvarlighetsgrad**. Samtal startar för incidenter och larm som deklareras som pågående. En incident som skapas redan löst får inget samtal.

### Ett samtal per incident

Ett samtal startas en gång per incident för varje plats där ett samtal hålls. Regler som väljer samma anslutning delar ett samtal, och en regel startar aldrig ett andra samtal för en incident som redan har ett från den anslutningen. Regler som väljer olika platser startar var sitt samtal, till exempel ett Zoom-möte för responders och huddlen i incidentens Slack-kanal.

### När ett samtal inte kan starta

Att deklarera en incident väntar aldrig på en leverantör av videosamtal. Samtalet startas efter att incidenten har skapats, så en långsam eller felande leverantör fördröjer aldrig incidenten eller dess jourlarm.

Om leverantören avvisar (en hemlighet som har gått ut, en saknad behörighet, en borttagen värd) säger incidentens feed att regelns samtal inte kunde startas, med leverantörens skäl, så att responders vet att de ska starta ett från incidentens sida. Regelns körning visas i arbetsytans aviseringsloggar som **Starta videosamtal**, och anslutningens rad i **Projektinställningar** > **Arbetsyta** > **Video Calls** visar felet tills ett samtal startar igen.

### Privata incidenter

Ett möte får namn efter den incident det gäller, med dess nummer och titel, och dess beskrivning länkar tillbaka till incidenten. För en privat incident utelämnas titeln, eftersom alla som bjuds in till mötet kan läsa dess namn.

## Anslut med ett klick

På OneUptime Cloud tar det ett klick att ansluta Zoom, Google Meet eller Microsoft Teams, och inget behöver konfigureras hos leverantören:

:::steps
1. Gå till **Projektinställningar** > **Arbetsyta** > **Video Calls** och klicka på **Anslut** vid Zoom, Google Meet eller Microsoft Teams.
2. Klicka på **Continue to Zoom** (eller Google, eller Microsoft), logga in och tillåt OneUptime att skapa möten.
3. Du kommer tillbaka till sidan för videosamtal med anslutningen gjord. **Start a test meeting** kontrollerar den från början till slut; välj sedan anslutningen i en aviseringsregel för Slack eller Microsoft Teams.
:::

Varje möte skapas som det konto du loggar in med, som är värd för det. Logga in med ett delat konto, som incidents@example.com, i stället för ditt eget, så att samtal fortsätter att starta när personer slutar. Anslutningens rad visar vilket konto den är inloggad som.

| Leverantör | Logga in med | Vad OneUptime får göra |
| --- | --- | --- |
| Zoom | En Zoom-användare. Möten med en Basic-användare (gratis) som värd avslutas efter 40 minuter. | Skapa möten för den användaren (`meeting:write:meeting`) och läsa vem det är (`user:read:user`). |
| Google Meet | Ett Google-konto som kan använda Google Meet. | Skapa Meet-utrymmen som det kontot (`meetings.space.created`) och läsa dess e-postadress. |
| Microsoft Teams | Ett arbets- eller skolkonto med Microsoft Teams. Personliga Microsoft-konton kan inte skapa Teams-möten. | Skapa onlinemöten som det kontot (den delegerade behörigheten `OnlineMeetings.ReadWrite`) och förbli inloggad (`offline_access`). |

En anslutning som har gjorts genom inloggning har fortfarande de inställningar som avgör vem som väntar: **Who can join** för Google Meet och **Who skips the lobby** för Microsoft Teams. Ändra dem med **Redigera** på anslutningens rad.

### Förbli inloggad

OneUptime sparar inloggningens uppdateringstoken, krypterad, och förnyar den minst en gång i veckan, så att den aldrig går ut av brist på användning, hur länge projektet än går utan en incident. Om inloggningen slutar fungera (kontot tog bort OneUptime, togs bort eller stängdes av, eller organisationens policy kräver att det loggar in igen) visar anslutningens rad **Not working** med skälet samma dag som OneUptime märker det, inte vid nästa incident. **Reconnect** på raden loggar in igen.

Anslutningar som är inloggade som samma konto delar en inloggning, i alla projekt: Zoom behåller bara en inloggning per konto, så att ansluta samma Zoom-användare igen ersätter den för alla.

### Anslut igen och ta bort

**Reconnect** på en anslutnings rad loggar in igen, som samma konto eller ett annat. Använd den efter att kontot har tagit bort OneUptime, eller för att flytta incidentmöten till ett annat konto.

Att ta bort en anslutning drar tillbaka OneUptimes åtkomst hos Zoom och Google så snart ingen annan anslutning använder inloggningen. För Microsoft tar du bort OneUptime under kontots **My Apps** (myapps.microsoft.com). Att ta bort OneUptime från ditt Zoom-konto i Zoom App Marketplace tar bort dess inloggning från alla anslutningar som är inloggade som det kontot, och de visar **Not working** tills de ansluts igen.

### Om Microsoft ber om en administratör

Vissa Microsoft 365-organisationer låter bara administratörer godkänna appar. Om Microsoft säger att du behöver godkännande från en administratör ber du en Microsoft 365-administratör att ansluta Microsoft Teams, eller att godkänna OneUptime i [Microsoft Entra-administrationscentret](https://entra.microsoft.com/) under **Enterprise applications** > **Admin consent requests**.

### Använd din egen app i stället

För att ansluta med en tjänsteidentitet i stället för en persons inloggning — en Zoom-app av typen Server-to-Server OAuth, ett Google-tjänstkonto med domänomfattande delegering eller en appregistrering i Microsoft Entra — klickar du på **Use your own Zoom app** (eller Google, eller Microsoft) i dialogrutan Anslut. [Leverantörer](#leverantörer) förklarar var och en. På en egenvärdad server utan konfigurerade enklicksappar öppnar **Anslut** det här formuläret direkt; se [Anslut med ett klick på en egenvärdad server](#anslut-med-ett-klick-på-en-egenvärdad-server) för att konfigurera dem.

## Starta ett samtal manuellt

Kortet **Video Call** på en incidents eller ett larms sida har **Start call** (eller **Start another** när det redan finns ett). Välj en av projektets anslutningar, huddlen i incidentens Slack-kanal, eller klistra in en egen möteslänk. Samtalet publiceras i incidentens kanaler och feed precis som ett som en regel startar.

**Ta bort** på kortet tar bort ett samtal från incidentens sida. Själva mötet tas inte bort, och alla med länken kan fortfarande ansluta till det.

Att starta och ta bort samtal kräver behörighet att arbeta med incidenter (eller larm): **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** eller **Incident Member**, eller **Create Incident Video Call** och **Delete Incident Video Call** i en anpassad roll. Alla som kan läsa incidenten ser dess samtal.

## Leverantörer

Det här avsnittet handlar om att ansluta en leverantör med din egen apps tjänsteidentitet: en Zoom-app av typen Server-to-Server OAuth, ett Google-tjänstkonto, en appregistrering i Microsoft Entra. En tjänsteidentitet är aldrig beroende av en person, så den fortsätter att fungera vem som än slutar. För att ansluta genom inloggning i stället, se [Anslut med ett klick](#anslut-med-ett-klick).

Autentiseringsuppgifter krypteras när de lagras och returneras aldrig av API:et. När du redigerar en anslutning behåller en autentiseringsuppgift som lämnas tom den sparade.

**Start test meeting** i anslutningsformuläret, och **Testa** på en anslutnings rad, skapar ett riktigt möte med anslutningens inställningar och visar dess länk. Det är den enda kontrollen som visar att autentiseringsuppgifterna, behörigheten hos leverantören och värden fungerar tillsammans. Inget publiceras någonstans.

Att ansluta en leverantör kräver **Project Owner**, **Project Admin** eller **Settings Admin**, eller **Create Video Call Connection** och **Edit Video Call Connection** i en anpassad roll.

### Zoom

OneUptime skapar ett Zoom-möte för varje incident via en Zoom-app av typen **Server-to-Server OAuth**, med en licensierad Zoom-användare som du väljer som värd.

:::steps
1. I [Zoom App Marketplace](https://marketplace.zoom.us/) väljer du **Develop** > **Build App** och skapar en app av typen **Server-to-Server OAuth**. Att skapa en kräver en administratör för Zoom-kontot, eller en roll som tillåter Server-to-Server OAuth-appar.
2. På appens sida **Scopes** lägger du till **meeting:write:meeting:admin** (skapa ett möte för en användare). En app som skapades före de detaljerade scopen kan använda **meeting:write:admin** i stället.
3. Klicka på **Activate** för att aktivera appen, och kopiera sedan **Account ID**, **Client ID** och **Client secret** från dess sida **App Credentials** till anslutningsformuläret.
4. Ange **Meeting host**: e-postadressen till en licensierad Zoom-användare, helst ett tjänstkonto som incidents@example.com, så att möten fortsätter att fungera när personer slutar. Möten med en Basic-användare (gratis) som värd avslutas efter 40 minuter.
5. Responders ansluter utan att vänta på värden, eftersom värden är ett tjänstkonto som aldrig ansluter. Se till att inställningen **Waiting room** på ditt Zoom-konto inte är låst som påslagen, annars kommer ingen in.
:::

| Fält | Var du hittar det |
| --- | --- |
| Account ID | Appens sida **App Credentials** |
| Client ID | Appens sida **App Credentials** |
| Client secret | Appens sida **App Credentials** |
| Meeting host | E-postadressen till den licensierade Zoom-användare som är värd för varje möte |

### Google Meet

OneUptime skapar ett Google Meet för varje incident med Google Meet REST API, via ett Google Cloud-tjänstkonto som agerar som en Google Workspace-användare med domänomfattande delegering.

:::steps
1. I [Google Cloud-konsolen](https://console.cloud.google.com/) väljer eller skapar du ett projekt och aktiverar **Google Meet REST API** för det.
2. Under **IAM & Admin** > **Service accounts** skapar du ett tjänstkonto. Öppna det, gå till **Keys** > **Add key** > **Create new key**, välj **JSON** och klistra in den nedladdade filen i anslutningsformuläret som **Service account JSON key**.
3. I [Googles administratörskonsol](https://admin.google.com/) öppnar du **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** och klickar på **Add new**. Ange tjänstkontots numeriska **Client ID** och scopet `https://www.googleapis.com/auth/meetings.space.created`.
4. Ange i **Create meetings as** den Google Workspace-användare som tjänstkontot agerar som: ett eget konto som incidents@example.com. Varje möte ägs av den här användaren.
:::

**Who can join** avgör vem som ansluter utan att fråga: med **People in your organization join directly, others ask to join** (standard) ber personer utanför din Google Workspace om att få ansluta, och någon i samtalet släpper in dem. Med **Anyone with the link joins directly** väntar ingen.

Domänomfattande delegering kan ta några minuter innan den fungerar. Om testet direkt efter att du har lagt till delegeringen rapporterar att Google inte lät tjänstkontot agera som användaren väntar du några minuter och testar igen.

### Microsoft Teams

OneUptime skapar ett Microsoft Teams-möte för varje incident med Microsoft Graph, via en appregistrering i Microsoft Entra som organiserar möten för en licensierad Teams-användares räkning.

:::steps
1. I [Microsoft Entra-administrationscentret](https://entra.microsoft.com/) öppnar du **App registrations** > **New registration** och registrerar en app med en enda klient. Kopiera dess **Directory (tenant) ID** och **Application (client) ID**.
2. Under **API permissions** lägger du till Microsoft Graph-behörigheten av typen **application** **OnlineMeetings.ReadWrite.All** och klickar sedan på **Grant admin consent**.
3. Under **Certificates & secrets** skapar du en klienthemlighet och klistrar in dess **Value**, inte dess Secret ID, i anslutningsformuläret som **Client secret**.
4. Välj organisatören: en licensierad Teams-användare, helst ett tjänstkonto. Kopiera användarens **Object ID** från **Users** i Entra-administrationscentret till **Organizer object ID**.
5. Tillåt appen att skapa möten för organisatören med en åtkomstprincip för program. I Teams PowerShell kör du, efter `Connect-MicrosoftTeams`, de två kommandona nedan.
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

Principen kan ta upp till 30 minuter att börja gälla. Tills dess rapporterar testet att appen inte får skapa möten för organisatören.

**Who skips the lobby** avgör vem som ansluter utan att vänta: med **People in your organization skip the lobby** (standard) väntar alla andra i lobbyn tills någon i mötet släpper in dem. Med **Everyone skips the lobby** väntar ingen.

### Möteslänk

En fast möteslänk är samma rum för varje incident: ett personligt Zoom-mötesrum, ett återkommande Microsoft Teams- eller Google Meet-möte, ett personligt Webex-rum eller ett Jitsi-rum. Inget skapas per incident, så det finns inget att godkänna.

:::steps
1. Skapa ett möte som aldrig går ut i det verktyg som ditt team redan använder.
2. Klistra in dess https-anslutningslänk i anslutningsformuläret som **Meeting link**.
:::

Varje incident och varje larm som startas med den här anslutningen delar rummet, så två samtidiga incidenter delar det också. Se till att mötet låter personer ansluta utan värden.

### Slack-huddles

En Slack-regel kan i stället starta huddlen i incidentens Slack-kanal. Det finns inget att ansluta: välj **Slack huddle** i regelns steg **Video Call**.

Huddlen hålls i den kanal som regeln skapar för incidenten eller, när regeln i stället publicerar i befintliga kanaler, i den första av dem. Regeln måste alltså skapa en kanal eller publicera i en befintlig. Knappen **Join huddle** öppnar kanalens huddle i Slack. Den första respondern som öppnar den startar huddlen, och alla efter ansluter till den. Slack ger inte en app något sätt att starta en huddle, så ingen är i huddlen förrän någon öppnar den.

En Slack-huddle är bara för Slack-regler. En Microsoft Teams-regel startar sina samtal med en av projektets anslutningar för videosamtal.

## Använda API:et

Ett samtal är en post på incidenten (`IncidentVideoCall`) eller larmet (`AlertVideoCall`). Skapa en med incidentens `_id` och något av följande:

- `videoCallConnectionId`: starta ett nytt möte med den anslutningen.
- `provider` satt till `SlackHuddle`: huddlen i incidentens Slack-kanal.
- `joinUrl` (och eventuellt `title`): en egen möteslänk.

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` startar ett testmöte med en sparad anslutning (`{ "connectionId": "..." }`) eller med inställningar som inte har sparats än (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`), och returnerar dess `joinUrl`.

En anslutnings `authMethod` anger hur den loggar in: `OAuth` för en som har gjorts genom inloggning, `AppCredentials` för en med din egen apps autentiseringsuppgifter, och inget för en möteslänk. En anslutning som görs genom inloggning skapas bara genom inloggning, i instrumentpanelen. Via API:et kan du byta namn på den och ändra dess `config`, och dess `connectedAccount` anger vilket konto den är inloggad som.

## Anslut med ett klick på en egenvärdad server

OneUptime Cloud har egna Zoom-, Google- och Microsoft-appar för att ansluta med ett klick. En egenvärdad server erbjuder det för varje leverantör vars app du konfigurerar. Utan den öppnar **Anslut** formuläret för din egen app.

Skapa en OAuth-app per leverantör och registrera den här omdirigerings-URI:n på den, med din servers värd:

| Leverantör | Omdirigerings-URI | Miljövariabler | Helm-värden |
| --- | --- | --- | --- |
| Zoom | `https://<host>/api/video-call-oauth/zoom/callback` | `ZOOM_APP_CLIENT_ID`, `ZOOM_APP_CLIENT_SECRET`, `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.clientId`, `zoomApp.clientSecret`, `zoomApp.webhookSecretToken` |
| Google Meet | `https://<host>/api/video-call-oauth/google-meet/callback` | `GOOGLE_MEET_APP_CLIENT_ID`, `GOOGLE_MEET_APP_CLIENT_SECRET` | `googleMeetApp.clientId`, `googleMeetApp.clientSecret` |
| Microsoft Teams | `https://<host>/api/video-call-oauth/microsoft-teams/callback` | `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID`, `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET` | `microsoftTeamsMeetingsApp.clientId`, `microsoftTeamsMeetingsApp.clientSecret` |

- **Zoom**: i [Zoom App Marketplace](https://marketplace.zoom.us/) väljer du **Develop** > **Build App** och skapar en **General App**, som hanteras av användare. Under **Basic Information** lägger du till omdirigerings-URI:n som OAuth Redirect URL på både fliken **Development** och **Production** och i OAuth-tillåtelselistan, och på fliken **Production** anger du slutpunkts-URL:en för **Deauthorization Notification** som `https://<host>/api/video-call-oauth/zoom/events`. Under **Scopes** lägger du till `meeting:write:meeting` och `user:read:user`. **Secret Token** under **Features** > **Access** är `ZOOM_APP_WEBHOOK_SECRET_TOKEN`. Autentiseringsuppgifterna för **Development** fungerar bara för användare av ditt eget Zoom-konto; de för **Production** fungerar för alla när Zoom har granskat och publicerat appen.
- **Google Meet**: i [Google Cloud-konsolen](https://console.cloud.google.com/) aktiverar du **Google Meet REST API**, konfigurerar OAuth-medgivandeskärmen (**Google Auth Platform**) med scopen `openid`, `email` och `https://www.googleapis.com/auth/meetings.space.created`, och skapar en OAuth-klient av typen **Web application** med omdirigerings-URI:n. Publicera appen i produktion: en app som lämnas i test förlorar sina inloggningar efter sju dagar. Google granskar appar som ber om Meet-scopet; tills det har skett ser personer en varning innan de loggar in.
- **Microsoft Teams**: i [Microsoft Entra-administrationscentret](https://entra.microsoft.com/) registrerar du en app för **Accounts in any organizational directory**, lägger till omdirigerings-URI:n som en **Web**-omdirigerings-URI, lägger till de delegerade Microsoft Graph-behörigheterna `openid`, `profile`, `email`, `offline_access` och `OnlineMeetings.ReadWrite`, och skapar en klienthemlighet. Använd en egen registrering, inte Microsoft Teams-botens (`MICROSOFT_TEAMS_APP_CLIENT_ID`). Tills appen har en verifierad utgivare behöver de flesta organisationer en administratör som ger medgivande till den.

Klient-ID:na är offentliga: de skickas till instrumentpanelen så att den vet vilka leverantörer som ansluter med ett klick. Håll hemligheterna och webhookens hemliga token hemliga. Workern förnyar varje inloggning dagligen, så den behöver samma värden som appen.

## Felsökning

:::details Inget samtal startades för en incident
Kontrollera att regeln matchade incidenten (**Testregel**), att dess steg **Video Call** är påslaget och att incidenten deklarerades som pågående: en incident som skapas redan löst får inget samtal. En regel som redan har startat ett samtal för incidenten med den anslutningen startar inget till.
:::

:::details Feeden säger att samtalet inte kunde startas
Leverantören avvisade, och feeden anger skälet. Starta under tiden ett samtal från incidentens sida. Kör sedan **Testa** på anslutningens rad: den visar samma skäl medan du rättar konfigurationen hos leverantören, till exempel en klienthemlighet som har gått ut eller en saknad behörighet.
:::

:::details En anslutning visar Not working
Dess inloggning slutade fungera: kontot tog bort OneUptime, togs bort eller stängdes av, eller måste logga in igen. Klicka på **Reconnect** på dess rad. Tills dess kan de samtal som den skulle starta inte starta.
:::

:::details Personer väntar i en lobby eller ett väntrum
Ändra **Who can join** (Google Meet) eller **Who skips the lobby** (Microsoft Teams) med **Redigera** på anslutningens rad. För Zoom ser du till att kontots inställning **Waiting room** inte är låst som påslagen.
:::

## Nästa steg

:::cards
- [Slack](/docs/workspace-connections/slack): De regler som startar samtal, och de kanaler de publicerar i.
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Samma regler och samtal i Microsoft Teams.
- [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration): Konfigurera Teams-boten på en egenvärdad server.
- [Deklarera en incident](/docs/incidents/declaring-incidents): Vad som händer när en incident börjar.
:::
