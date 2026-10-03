# Prenumeranter och meddelanden

En statussida är ett ställe folk går till. Prenumeranter är de som helst slipper — de lämnar ifrån sig en e-postadress, ett telefonnummer, en Slack-webhook eller en HTTP-endpoint en enda gång, och därefter kommer era uppdateringar till dem.

Meddelanden är den andra halvan av samma jobb. En monitor kan tala om för besökarna att kassan svarar med 500-fel; ingen monitor kan tala om för dem att ni migrerar databaser på lördag, att en tredjepartsleverantör har en dålig dag, eller att incidenten de läste om i går är helt avslutad. Meddelanden är fritextkanalen för allt era kontroller inte kan se, och de går ut till samma prenumerantlista.

Den här sidan täcker båda delarna: de fem prenumerationskanalerna och hur besökare anmäler sig, vad prenumeranter kan välja att höra om, flödena för dubbel opt-in och avslutad prenumeration, och hur meddelanden skrivs, schemaläggs och mallas.

## Prenumerationskanaler

En statussida stöder fem kanaler. De och sidan där besökare anmäler sig styrs från ett ställe: kortet **Kanaler** under **Statussidor → din sida → Prenumeranter → Prenumerantinställningar**. Varje växel sparas så fort du slår om den:

- **Visa prenumerantsida** (`showSubscriberPageOnStatusPage`) — på som standard. Lägger posten **Prenumerera** i statussidans navigeringsrad, där besökare anmäler sig via kanalerna nedan.
- **E-post** (`enableEmailSubscribers`) — på som standard. Allt annat är avslaget tills du slår på det.
- **SMS** (`enableSmsSubscribers`) — av som standard. På OneUptime Cloud betalas varje SMS från projektets saldo för SMS och samtal, om inte sidan har en egen **Twilio-konfiguration**. För att slå på den måste även **SMS** vara på för projektet, i kortet **Aviseringskanaler** under **Projektinställningar > Aviseringar > Aviseringsinställningar**.
- **Slack** (`enableSlackSubscribers`) — av som standard.
- **Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — av som standard.
- **Webhook** (`enableWebhookSubscribers`) — av som standard.

Växlarna avgör hur besökare själva kan anmäla sig: statussidan avvisar en anmälan via en kanal som är av. De stoppar inte aviseringar: prenumeranter som ditt team lägger till i instrumentpanelen, via API:t eller med ett arbetsflöde får uppdateringar oavsett vilka kanaler som är på.

På OneUptime Cloud står namnet på planen bredvid en växel som din plan inte omfattar: **Growth** för **SMS** och **Visa prenumerantsida**, **Scale** för **Slack**, **Microsoft Teams** och **Webhook**.

Varje kanal får också en egen lista i statussidans vänstermeny under **Prenumeranter**: **E-postprenumeranter**, **SMS-prenumeranter**, **Slack-prenumeranter**, **MS Teams-prenumeranter** och **Webhook-prenumeranter**. Det är där du ser vilka som anmält sig, lägger till någon för hand, eller lämnar en **Anteckningar**-notering (`internalNote`) till dig själv på en enskild prenumerant. Så länge en kanal är av står det högst upp i dess lista, med kanalens växel precis där, så att du kan slå på den utan att lämna listan.

**En växel räcker inte.** Posten **Prenumerera** i statussidans navigeringsrad dyker upp först när **Visa prenumerantsida** är på *och* minst en kanal är på. Slår du på **E-post** men låter **Visa prenumerantsida** vara av har besökarna ingen väg fram till formuläret.

## Vad en besökare ser på prenumerationssidan

Sidan **Prenumerera** har en undermeny med en flik per aktiverad kanal — **E-post**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — kopplade till `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` och `/subscribe/webhooks`. Varje flik ber om det minsta den behöver:

- **E-post** — rubriken **Prenumerera via e-post**, ett fält **Din e-post** med platshållaren `prenumerant@foretag.se`.
- **SMS** — rubriken **Prenumerera via SMS**, ett fält **Ditt telefonnummer** med platshållaren `+46701234567`.
- **Slack** — rubriken **Prenumerera via Slack**, med **Slack-arbetsytans namn** (används för validering) och **URL för inkommande webhook i Slack**, platshållare `https://hooks.slack.com/services/...`.
- **MS Teams** — rubriken **Prenumerera via Microsoft Teams**, med **Microsoft Teams-arbetsytans namn** och **URL för inkommande webhook i Microsoft Teams**, platshållare `https://outlook.office.com/webhook/...`.
- **Webhooks** — rubriken **Prenumerera via webhook**, ett fält **Webhook-URL**. En JSON-`POST`-förfrågan skickas dit vid varje händelse på statussidan.

Skicka-knappen heter **Prenumerera**, och en lyckad anmälan visar *Du har prenumererat.* Sidan bär också en uppdelning i **Ny prenumeration** / **Hantera befintlig prenumeration**, så att den som redan prenumererar kan komma tillbaka till sina inställningar utan att leta rätt på ett gammalt mejl.

## Låta prenumeranter välja resurser och händelsetyper

Som standard får en prenumerant allt som finns på sidan. Två växlar i kortet **Avancerade prenumerantinställningar** ändrar det:

- **Tillåt prenumeranter att välja resurser** (`allowSubscribersToChooseResources`) — av som standard. Slår du på den får prenumerationsformuläret en växel **Prenumerera på alla resurser**; avmarkera den så dyker **Välj resurser att prenumerera på** upp, och besökaren kan plocka enskilda resurser.
- **Tillåt prenumeranter att välja händelsetyper** (`allowSubscribersToChooseEventTypes`) — av som standard. Samma form: en växel **Prenumerera på alla händelsetyper**, och **Välj händelsetyper att prenumerera på** under den när den är avmarkerad.

Händelsetyperna är `Incident`, `Announcement` och `Scheduled Event`.

Valen hamnar på prenumerantposten som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard true), **Subscribed to Resources** och **Subscribed to Event Types**.

Bra för: en sida som täcker flera produkter. En kund som bara använder ert API vill inte bli aviserad varje gång marknadssajten vacklar till — låt dem smalna av listan själva istället för att se på när de avslutar prenumerationen helt.

Samma kort bär också **Prenumeranters tidszoner**.

## Dubbel opt-in för e-post

E-postprenumeranter bekräftar alltid. När en prenumerant skapas med en e-postadress och inte skapas som redan bekräftad tvingas **Is Subscription Confirmed** (`isSubscriptionConfirmed`) till `false`, och en sexsiffrig **Subscription Confirmation Token** genereras. OneUptime mejlar sedan en bekräftelselänk på formen `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Besökaren landar på en sida **Bekräfta prenumeration** och ser, när det gått igenom, *Prenumeration bekräftad*.

Prenumeranter via SMS, Slack, Microsoft Teams och webhook hoppar över det här — de skapas med `isSubscriptionConfirmed` redan satt till `true`.

**Obekräftad betyder tyst.** Frågan som hämtar prenumeranter inför en avisering filtrerar på `isUnsubscribed: false` och `isSubscriptionConfirmed: true`. En e-postadress som aldrig klickade på länken blir liggande i listan **E-postprenumeranter** och får ingenting. Svär någon på att hen prenumererar men aldrig hör något — kontrollera den kolumnen först.

Det finns ingen växel för att stänga av e-postbekräftelsen — den är ovillkorlig för alla som anmäler sig via statussidan. En separat kolumn per prenumerant, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard true), styr det "du prenumererar nu"-mejl som går ut när en prenumerant väl är bekräftad.

## Hantera och avsluta en prenumeration

Varje prenumerantmejl bär en avprenumerationslänk på formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den sidan heter **Uppdatera prenumeration** och talar om för besökaren att hen kan uppdatera sina inställningar eller avsluta prenumerationen där. Den innehåller:

- De resurs- och händelsetypsväljare som sidan nu tillåter.
- En växel **Avsluta prenumeration**, beskriven som att avsluta prenumerationen på alla resurser. Den skriver **Är avprenumererad** (`isUnsubscribed`, standard false).
- En skicka-knapp som heter **Uppdatera prenumeration**; när du sparar visas *Dina ändringar har sparats.*

Den som tappat bort länken använder **Hantera befintlig prenumeration** på sidan **Prenumerera** och trycker på **Skicka hanteringslänk**. OneUptime svarar att ett mejl med länken har skickats, och att man ska titta i skräpposten om det inte dyker upp.

Endpointerna bakom allt det här är `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` och `PUT .../update-subscription/:statusPageId/:subscriberId`.

Att avsluta en prenumeration vänder en flagga istället för att radera en rad, så posten ligger kvar i kanallistan med **Är avprenumererad** satt — praktiskt när du senare behöver förklara varför en viss adress slutade få mejl.

## Vad prenumeranter aviseras om

Prenumeranter får höra om de tre händelsetyperna ovan, men varje källa har sin egen växel, så ingenting skickas av misstag.

### Aviseringar om meddelanden

Meddelandet självt bär **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), som i skapandeformuläret visas som kryssrutan **Meddela statussideprenumeranter** och är på som standard. Namnger meddelandet monitorer under **Påverkade övervakare (valfritt)** begränsas aviseringen till dem; lämnar du fältet tomt aviseras alla prenumeranter.

### Schemalagda underhållshändelser

En schemalagd underhållshändelse har sin egen uppsättning prenumerantkolumner: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** och **Next subscriber notification before the event at?** för förvarningar. **Statussidor** på händelsen avgör vilka sidor den syns på, och **Should be visible on status page?** avgör om den syns alls.

### Incidenter

`Incident` är den tredje händelsetypen. Vad som får en incident att över huvud taget nå en statussida — vilka resurser den rör och vilka tillstånd som håller den synlig — täcks i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

Sektionen **Aviseringsloggar** i statussidans vänstermeny (`{id}/notification-logs`) är dit du går när du behöver se vad sidan faktiskt skickade.

## Anpassa aviseringsmallar

Kortet **Aviseringsmallar** på **Prenumerantinställningar** listar de mallar den här statussidan använder, med kolumnerna **Mallnamn**, **Händelsetyp** och **Aviseringsmetod** — så att du kan variera formuleringen per händelsetyp och per kanal istället för att nöja dig med ett och samma standardmeddelande för allt.

Projektövergripande mallar bor en nivå upp, på **Statussidor → Inställningar → Prenumerantmallar**, bredvid **Meddelandemallar**.

## E-postsidfot, anpassad SMTP och Twilio

Tre kort till på **Prenumerantinställningar** styr hur prenumerantmeddelanden lämnar projektet:

- **Inställningar för e-postsidfot** — **Aktivera anpassad text för e-postsidfot** och **Sidfotstext för prenumeranters e-postavisering** lägger er egen sidfot i prenumerantmejlen.
- **Anpassad SMTP** — **Anpassad SMTP-konfiguration** skickar prenumerantmejl via er egen mejlserver istället för standardservern.
- **Twilio-konfiguration** — **Twilio-konfiguration** är det Twilio-konto som används för SMS-prenumeranter.

Anpassad SMTP är värd att fixa tidigt om ni har e-postprenumeranter: mejl som kommer från er egen domän filtreras bort betydligt mer sällan, och blir betydligt oftare betrott av kunden som läser det klockan två på natten.

## Meddelanden

Ett meddelande är en post på projektnivå (modellen `StatusPageAnnouncement`) som du sprider till en eller flera statussidor, valfritt begränsad till vissa monitorer, med ett fönster under vilket det visas.

Du skapar ett från **Statussidor → Mer → Meddelanden**, eller från **Meddelanden** i en enskild statussidas vänstermeny. Skapandeformuläret är en guide i fyra steg:

1. **Grundläggande information** — **Meddelanderubrik** (obligatorisk, minst två tecken), **Beskrivning** (Markdown, valfri) och **Bilagor** för filer som ska finnas tillgängliga tillsammans med meddelandet på statussidan.
2. **Statussidor** — **Visa meddelande på dessa statussidor**, ett obligatoriskt flerval. Ett meddelande kan rikta sig till flera sidor samtidigt.
3. **Berörda resurser** — **Påverkade övervakare (valfritt)**. Väljer du ingen aviseras alla prenumeranter.
4. **Schema och inställningar** — **Börja visa meddelande vid** (obligatoriskt, standard är nu), **Sluta visa meddelande vid** (valfritt) och **Meddela statussideprenumeranter** (på som standard).

Besökare läser meddelanden på `/announcements`, uppdelade i **Aktiva meddelanden** och **Tidigare meddelanden**, var och en stämplad med **Meddelat den**. Meddelanden som är aktiva just nu fästs dessutom högst upp på översiktssidan. När det inte finns något att visa står det *Inga meddelanden* på sidan, med noteringen att inga har publicerats hittills.

Bilagor serveras från `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bakom samma läskontroll som statussidan själv — så en bilaga på en privat sida förblir privat.

## Så fungerar schemaläggningen av meddelanden

**Show At** (`showAnnouncementAt`) och **End At** (`endAnnouncementAt`) styr allt, men översiktssidan och meddelandelistan ställer olika frågor, och skillnaden får folk att snubbla.

- **Översiktssidan** visar ett meddelande när `showAnnouncementAt` ligger bakåt i tiden och `endAnnouncementAt` antingen ligger framåt i tiden eller är tomt.
- **Listan `/announcements`** visar meddelanden vars `showAnnouncementAt` faller inom meddelandenas historikfönster (`showAnnouncementHistoryInDays`, standard 14), och delar sedan upp dem i aktiva och tidigare på klientsidan.

Två följder värda att planera för:

- **Ett meddelande utan slutdatum löper aldrig ut.** Lämnar du **Sluta visa meddelande vid** tomt sitter det fastnålat på översiktssidan i all evighet. Sätt ett slutdatum på allt som är tidsbundet.
- **Ett gammalt men fortfarande aktivt meddelande kan försvinna ur listan.** Startade det för mer än `showAnnouncementHistoryInDays` sedan trillar det av `/announcements` men ligger kvar på översikten. Höj historikfönstret om ni har långvariga notiser.

Om meddelanden syns över huvud taget ställs in i kortet **Vad din statussida visar** på **Avancerade inställningar**: **Visa meddelanden** (`showAnnouncementsOnStatusPage`, standard true) och under den **Visa de senaste … dagarna** (`showAnnouncementHistoryInDays`, standard 14). Med **Visa meddelanden** avslaget avvisar meddelande-endpointen förfrågan rakt av.

## Meddelandemallar

Publicerar du samma sorts notis om och om igen — en månatlig underhållsvarning, en återkommande försämring hos en tredje part — förbered den i förväg. **Statussidor → Inställningar → Meddelandemallar** lagrar modellen `StatusPageAnnouncementTemplate`, och dess formulär frågar efter **Mallnamn**, **Mallbeskrivning**, **Meddelanderubrik**, **Beskrivning**, **Visa meddelande på dessa statussidor**, **Påverkade övervakare (valfritt)** och **Avisera prenumeranter**, så att spridningen och aviseringsbeslutet fattas en gång istället för varje gång.

## Webhook-prenumeranter och SSRF-skydd

Webhook-prenumeranter tar emot en JSON-`POST`-förfrågan vid varje händelse på statussidan, vilket gör dem till det enklaste sättet att mata in statussidans uppdateringar i ett eget system — en chattbot, en intern instrumentpanel, en ärendekö.

Eftersom det är en publik operation på en publik sida att prenumerera skyddar OneUptime målet:

- En vanlig **Webhook-URL** valideras innan den accepteras, och privata adresser, loopback-adresser, link-local-adresser och molnens metadataadresser avvisas. Du kan inte peka en prenumeration mot något inuti OneUptime-installationens eget nätverk.
- En **URL för inkommande webhook i Slack** måste börja med `https://hooks.slack.com/services/`.

Avvisas en webhook-prenumeration vid anmälan är en intern eller felformad URL det första att kontrollera.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur den är hopsatt.
- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — monitorerna och grupperna prenumeranter kan välja mellan.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — egna domäner, logotyper och utseendet på sidan era mejl länkar till.
- [Offentligt API](/docs/status-pages/public-api) — att läsa statussidans data programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som sätter en incident på en statussida och vad som tar bort den.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — reglerna på projektnivå bakom incidentkommunikationen.
