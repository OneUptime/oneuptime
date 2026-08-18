# Prenumeranter och meddelanden

En statussida är en plats folk går till. Prenumeranter är de som hellre slipper — de lämnar dig en e-postadress, ett telefonnummer, en Slack-webhook eller en HTTP-slutpunkt en gång, och därefter kommer dina uppdateringar till dem.

Meddelanden är andra halvan av samma uppgift. En monitor kan tala om för dina besökare att kassan svarar med 500-fel; ingen monitor kan tala om för dem att du migrerar databaser på lördag, att en tredjepartsleverantör har en dålig dag, eller att incidenten de läste om igår är helt avslutad. Meddelanden är fritextkanalen för allt dina kontroller inte kan se, och de skickas ut till samma prenumerantlista.

Den här sidan täcker båda delarna: de fem prenumerationskanalerna och hur besökare registrerar sig, vad prenumeranter kan välja att höra om, flödena för dubbel opt-in och avprenumeration, samt hur meddelanden skrivs, schemaläggs och mallas.

## Prenumerationskanaler

En statussida stöder fem kanaler, var och en med sin egen växel på statussidan. Gå till **Statussidor → din sida → Prenumeranter → Prenumerantinställningar**:

- **Aktivera e-postprenumeranter** (`enableEmailSubscribers`) — på som standard. Allt annat är av tills du slår på det.
- **Aktivera SMS-prenumeranter** (`enableSmsSubscribers`) — av som standard.
- **Aktivera Slack-prenumeranter** (`enableSlackSubscribers`) — av som standard.
- **Aktivera Microsoft Teams-prenumeranter** (`enableMicrosoftTeamsSubscribers`) — av som standard.
- **Aktivera webhook-prenumeranter** (`enableWebhookSubscribers`) — av som standard.

Varje kanal får också sin egen lista i statussidans sidomeny under **Prenumeranter**: **E-postprenumeranter**, **SMS-prenumeranter**, **Slack-prenumeranter**, **MS Teams-prenumeranter** och **Webhook-prenumeranter**. Det är där du ser vem som är registrerad, lägger till någon manuellt, eller lämnar en **Anteckningar**-post (`internalNote`) om en viss prenumerant.

**En växel räcker inte.** Posten **Prenumerera** i statussidans navigeringsrad visas bara när **Visa prenumerantsida** (`showSubscriberPageOnStatusPage`) är på *och* minst en kanal är aktiverad. Om du slår på **Aktivera e-postprenumeranter** men lämnar **Visa prenumerantsida** av, har besökarna ingen väg till formuläret.

Samma fem växlar dyker upp en andra gång i kortet **Prenumerantinställningar** på **Avancerade inställningar**, tillsammans med **Visa prenumerantsida**. Det är samma kolumner under ytan — välj en skärm och håll dig till den, och föredra den dedikerade sidan **Prenumerantinställningar** eftersom det är där resten av prenumerantkonfigurationen finns.

## Vad en besökare ser på sidan Prenumerera

Sidan **Prenumerera** har en undermeny med en flik per aktiverad kanal — **E-post**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — kopplade till `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` och `/subscribe/webhooks`. Varje flik frågar efter det minsta den behöver:

- **E-post** — rubriken **Prenumerera via e-post**, ett fält **Din e-post** med platshållaren `subscriber@company.com`.
- **SMS** — rubriken **Prenumerera via SMS**, ett fält **Ditt telefonnummer** med platshållaren `+11234567890`.
- **Slack** — rubriken **Prenumerera via Slack**, med **Slack-arbetsytans namn** (används för validering) och **URL för inkommande webhook i Slack**, platshållare `https://hooks.slack.com/services/...`.
- **MS Teams** — rubriken **Prenumerera via Microsoft Teams**, med **Microsoft Teams-arbetsytans namn** och **URL för inkommande webhook i Microsoft Teams**, platshållare `https://outlook.office.com/webhook/...`.
- **Webhooks** — rubriken **Prenumerera via webhook**, ett fält **Webhook-URL**. En JSON `POST`-förfrågan skickas till den vid varje statussidehändelse.

Skicka-knappen lyder **Prenumerera**, och en lyckad registrering visar *Du har prenumererat.* Sidan har också en uppdelning mellan **Ny prenumeration** / **Hantera befintlig prenumeration**, så att den som redan prenumererar kan komma tillbaka till sina inställningar utan att leta efter ett gammalt mejl.

## Låta prenumeranter välja resurser och händelsetyper

Som standard får en prenumerant allt på sidan. Två växlar i kortet **Avancerade prenumerantinställningar** ändrar det:

- **Tillåt prenumeranter att välja resurser** (`allowSubscribersToChooseResources`) — av som standard. Slå på den och prenumerationsformuläret får en växel **Prenumerera på alla resurser**; rensa den och **Välj resurser att prenumerera på** dyker upp så att besökaren kan välja enskilda resurser.
- **Tillåt prenumeranter att välja händelsetyper** (`allowSubscribersToChooseEventTypes`) — av som standard. Samma form: en växel **Prenumerera på alla händelsetyper**, och **Välj händelsetyper att prenumerera på** därunder när den är rensad.

Händelsetyperna är `Incident`, `Announcement` och `Scheduled Event`.

Valen hamnar på prenumerantposten som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard true), **Subscribed to Resources** och **Subscribed to Event Types**.

Bra för: en sida som täcker flera produkter. En kund som bara använder ditt API vill inte ha en sida varje gång marknadsföringssajten vinglar till — låt dem snäva in listan själva i stället för att se dem avsluta prenumerationen helt.

Samma kort bär också **Prenumeranters tidszoner**.

## Dubbel opt-in för e-post

E-postprenumeranter måste alltid bekräfta. När en prenumerant skapas med en e-postadress och inte redan skapades som bekräftad, tvingas **Is Subscription Confirmed** (`isSubscriptionConfirmed`) till `false` och en sexsiffrig **Subscription Confirmation Token** genereras. OneUptime mejlar sedan en bekräftelselänk formad som `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Besökaren hamnar på en sida **Bekräfta prenumeration** och ser, när den går igenom, *Prenumeration bekräftad*.

SMS-, Slack-, Microsoft Teams- och webhook-prenumeranter hoppar över det här — de skapas med `isSubscriptionConfirmed` redan satt till `true`.

**Obekräftad betyder tyst.** Frågan som hämtar prenumeranter för en avisering filtrerar på `isUnsubscribed: false` och `isSubscriptionConfirmed: true`. En e-postadress som aldrig klickade på länken kommer att ligga kvar i din lista **E-postprenumeranter** och inte ta emot något. Om någon svär på att de prenumererar men inte hör något, kontrollera den kolumnen först.

Det finns ingen växel för att stänga av e-postbekräftelse — den är ovillkorlig för alla som registrerar sig via statussidan. En separat kolumn per prenumerant, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard true), styr mejlet "du har prenumererat" som skickas ut när en prenumerant har bekräftats.

## Hantera och avsluta en prenumeration

Varje prenumerant-mejl bär en avprenumerationslänk på formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den sidan heter **Uppdatera prenumeration** och talar om för besökaren att de kan uppdatera sina inställningar eller avsluta prenumerationen där. Den innehåller:

- Vilka resurs- och händelsetypväljare sidan än tillåter.
- En växel **Avsluta prenumeration**, beskriven som att avsluta prenumerationen på alla resurser. Den skriver **Är avprenumererad** (`isUnsubscribed`, standard false).
- En skicka-knapp med texten **Uppdatera prenumeration**; att spara visar *Dina ändringar har sparats.*

Den som har tappat bort länken använder **Hantera befintlig prenumeration** på sidan **Prenumerera** och trycker på **Skicka hanteringslänk**. OneUptime svarar att ett e-postmeddelande med länken har skickats och att man ska kontrollera skräppostmappen om det inte kommer fram.

Slutpunkterna bakom allt detta är `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` och `PUT .../update-subscription/:statusPageId/:subscriberId`.

Att avsluta en prenumeration slår om en flagga snarare än att radera en rad, så posten finns kvar i kanallistan med **Är avprenumererad** satt — användbart när du senare behöver förklara varför en viss adress slutade få mejl.

## Vad prenumeranter aviseras om

Prenumeranter får höra om de tre händelsetyperna ovan, men varje källa har sin egen växel, så inget skickas av misstag.

### Meddelandeaviseringar

Meddelandet bär självt på **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), som exponeras i skapa-formuläret som kryssrutan **Meddela statussideprenumeranter** och är på som standard. Om meddelandet anger monitorer under **Påverkade övervakare (valfritt)** begränsas aviseringen till dessa monitorer; lämna det tomt så aviseras alla prenumeranter.

### Schemalagda underhållshändelser

En schemalagd underhållshändelse har sin egen uppsättning prenumerantkolumner: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** och **Next subscriber notification before the event at?** för förhandsvarningar. **Statussidor** på händelsen avgör vilka sidor den visas på, och **Should be visible on status page?** avgör om den visas alls.

### Incidenter

`Incident` är den tredje händelsetypen. Vad som gör att en incident överhuvudtaget når en statussida — vilka resurser den berör och vilka tillstånd som håller den synlig — beskrivs i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

Sektionen **Aviseringsloggar** i statussidans sidomeny (`{id}/notification-logs`) är där du går när du behöver se vad sidan faktiskt skickade.

## Anpassa aviseringsmallar

Kortet **Aviseringsmallar** på **Prenumerantinställningar** listar de mallar den här statussidan använder, med kolumnerna **Mallnamn**, **Händelsetyp** och **Aviseringsmetod** — så att du kan variera formuleringen per händelsetyp och per kanal istället för att nöja dig med ett standardmeddelande för allt.

Projektövergripande mallar finns en nivå upp, på **Statussidor → Inställningar → Prenumerantmallar**, bredvid **Meddelandemallar**.

## E-postsidfot, anpassad SMTP och Twilio

Tre kort till på **Prenumerantinställningar** styr hur prenumerantmeddelanden lämnar ditt projekt:

- **Inställningar för e-postsidfot** — **Aktivera anpassad text för e-postsidfot** och **Sidfotstext för prenumeranters e-postavisering** sätter din egen sidfot på prenumerant-mejl.
- **Anpassad SMTP** — **Anpassad SMTP-konfiguration** skickar prenumerant-e-post genom din egen mejlserver istället för standarden.
- **Twilio-konfiguration** — **Twilio-konfiguration** är det Twilio-konto som används för SMS-prenumeranter.

Anpassad SMTP är värt att göra tidigt om du har e-postprenumeranter: mejl som kommer från din egen domän är mycket mindre sannolikt att filtreras bort, och mycket mer sannolikt att lita på för kunden som läser det klockan två på natten.

## Meddelanden

Ett meddelande är en projektnivå-post (modellen `StatusPageAnnouncement`) som du sprider till en eller flera statussidor, valfritt begränsad till specifika monitorer, med ett tidsfönster då det visas.

Du skapar ett från **Statussidor → Mer → Meddelanden**, eller från **Meddelanden** i en enskild statussidas sidomeny. Skapa-formuläret är en guide i fyra steg:

1. **Grundläggande information** — **Meddelanderubrik** (obligatoriskt, minst två tecken), **Beskrivning** (Markdown, valfritt) och **Bilagor** för filer som ska finnas tillgängliga med meddelandet på statussidan.
2. **Statussidor** — **Visa meddelande på dessa statussidor**, ett obligatoriskt flerval. Ett meddelande kan rikta sig mot flera sidor samtidigt.
3. **Berörda resurser** — **Påverkade övervakare (valfritt)**. Om du inte väljer några aviseras alla prenumeranter.
4. **Schema och inställningar** — **Börja visa meddelande vid** (obligatoriskt, standard nu), **Sluta visa meddelande vid** (valfritt) och **Meddela statussideprenumeranter** (på som standard).

Besökare läser meddelanden på `/announcements`, uppdelat i **Aktiva meddelanden** och **Tidigare meddelanden**, vart och ett stämplat med **Meddelat den**. Meddelanden som är aktiva just nu fästs också högst upp på översiktssidan. När det inte finns något att visa läser sidan *Inga meddelanden* med anteckningen att inga har publicerats hittills.

Bilagor serveras från `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bakom samma läsbehörighetskontroll som statussidan själv — så en bilaga på en privat sida förblir privat.

## Så fungerar schemaläggning av meddelanden

**Show At** (`showAnnouncementAt`) och **End At** (`endAnnouncementAt`) styr allt, men översiktssidan och meddelandelistan ställer olika frågor, och skillnaden ställer till det för folk.

- **Översiktssidan** visar ett meddelande när `showAnnouncementAt` ligger i det förflutna och `endAnnouncementAt` antingen ligger i framtiden eller är tomt.
- **Listan `/announcements`** visar meddelanden vars `showAnnouncementAt` faller inom **Visa meddelandehistorik (i dagar)** (`showAnnouncementHistoryInDays`, standard 14), och delar sedan upp dem klientsidan i aktiva och tidigare.

Två konsekvenser värda att planera för:

- **Ett meddelande utan slutdatum går aldrig ut.** Lämna **Sluta visa meddelande vid** tomt så fästs det på översiktssidan på obestämd tid. Sätt ett slutdatum på allt som är tidsbegränsat.
- **Ett gammalt men fortfarande aktivt meddelande kan försvinna från listan.** Om det startade mer än `showAnnouncementHistoryInDays` dagar sedan faller det bort från `/announcements` samtidigt som det finns kvar på översikten. Höj historikfönstret om du har långvariga meddelanden.

Om meddelanden visas alls styrs av kortet **Meddelandeinställningar** på **Avancerade inställningar**: **Visa meddelanden** (`showAnnouncementsOnStatusPage`, standard true) och **Visa meddelandehistorik (i dagar)** (standard 14). Med **Visa meddelanden** avstängt avvisar meddelande-slutpunkten förfrågan helt.

## Meddelandemallar

Om du postar samma typ av meddelande upprepade gånger — en månatlig underhållsvarning, en återkommande tredjepartsstörning — förbered den i förväg. **Statussidor → Inställningar → Meddelandemallar** lagrar modellen `StatusPageAnnouncementTemplate`, och dess formulär frågar efter **Mallnamn**, **Mallbeskrivning**, **Meddelanderubrik**, **Beskrivning**, **Visa meddelande på dessa statussidor**, **Påverkade övervakare (valfritt)** och **Avisera prenumeranter**, så att spridningen och aviseringsbeslutet görs en gång istället för varje gång.

## Webhook-prenumeranter och SSRF-skydd

Webhook-prenumeranter tar emot en JSON `POST`-förfrågan vid varje statussidehändelse, vilket gör dem till det enklaste sättet att leda statussideuppdateringar in i ett eget system — en chatbot, en intern instrumentpanel, en ärendekö.

Eftersom prenumeration är en offentlig åtgärd på en offentlig sida skyddar OneUptime målet:

- En generisk **Webhook-URL** valideras innan den accepteras, och privata adresser, loopback-adresser, länklokala adresser och molnmetadata-adresser avvisas. Du kan inte peka en prenumeration mot något inuti OneUptime-driftsättningens eget nätverk.
- En **URL för inkommande webhook i Slack** måste börja med `https://hooks.slack.com/services/`.

Om en webhook-prenumeration avvisas vid registrering är en intern eller felaktigt formad URL det första att kontrollera.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur den är uppbyggd.
- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — monitorerna och grupperna prenumeranter kan välja mellan.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — anpassade domäner, logotyper och utseendet på sidan dina mejl länkar till.
- [Offentligt API](/docs/status-pages/public-api) — läsa statussidedata programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som sätter en incident på en statussida och vad som tar bort den.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — de projektnivåregler som styr incidentkommunikation.
