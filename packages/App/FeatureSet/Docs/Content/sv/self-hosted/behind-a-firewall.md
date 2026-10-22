# Bakom VPN eller brandvägg

En egenvärdad OneUptime kan hållas borta från det publika internet: den skickar varje larm över utgående anslutningar. Några saker kommer ändå tillbaka in. En jourhavande trycker på **Acknowledge** i ett meddelande, Twilio rapporterar en knapptryckning under ett samtal och Slack rapporterar ett klick på en knapp. Den här sidan listar var och en av dem, vem som ansluter till din server för den och på vilken sökväg, så att du kan publicera bara det du använder, eller ingenting alls.

:::cards
- [Vem ansluter till din server](#vem-ansluter-till-din-server): De jourhavandes telefoner och leverantörerna som skickar återanrop.
- [Håll allt privat](#håll-allt-privat): Anslut de jourhavandes telefoner till ditt VPN.
- [Publicera bara bekräftelsesidorna](#publicera-bara-bekräftelsesidorna): En smal ingång för bekräftelselänkar.
- [Återanrop från leverantörer](#återanrop-från-leverantörer): Telegram, Twilio, WhatsApp, Slack och Microsoft Teams.
:::

## Vem ansluter till din server

Att skicka kräver aldrig inkommande åtkomst: OneUptime ansluter utåt till din e-postserver, Twilio, Telegram, Meta, Slack, Microsoft och push-reläet. Det som kommer tillbaka in är något av följande:

| Vad som händer | Vem som ansluter till din server | Kan en tillåtelselista för källadresser täcka det? |
| --- | --- | --- |
| En jourhavande trycker på **Acknowledge** i ett e-postmeddelande, ett SMS eller ett meddelande i WhatsApp eller Telegram | Den jourhavandes telefon eller dator | Nej: den ansluter från var den jourhavande än befinner sig |
| En jourhavande bekräftar i appen OneUptime On-Call | Den jourhavandes telefon | Nej: av samma skäl |
| En jourhavande trycker 1 under ett jourlarm per telefon | Twilio | Bara med Twilios Static Proxy for Webhooks |
| Någon kopplar sitt Telegram-konto | Telegram | Ja, eller polla Telegram och tillåt ingenting |
| Någon klickar på en knapp i ett meddelande i Slack eller Microsoft Teams | Slack eller Microsoft | Nej: ingen av dem publicerar fasta adresser |
| WhatsApp rapporterar att ett meddelande har levererats eller lästs | Meta | Nej: Meta publicerar inga fasta adresser |

En egenvärdad server pratar direkt med de här leverantörerna, aldrig via OneUptimes egna servrar, så det finns ingen lista med OneUptime-adresser att tillåta.

## Håll allt privat

Anslut de jourhavandes telefoner till ditt VPN: alltid på, eller på begäran för ditt OneUptime-värdnamn, så att ingen behöver ansluta det innan de bekräftar ett larm klockan tre på natten. När ingenting är publicerat:

- Bekräftelselänkarna i e-post, SMS och meddelanden i WhatsApp och Telegram öppnas, eftersom telefonen når din server.
- Appen OneUptime On-Call fungerar: peka den mot din servers adress. Push-aviseringar behöver ingen inkommande åtkomst, eftersom servern skickar dem via push-reläet.
- Användare kan koppla sina Telegram-konton när du har slagit på pollning (se [Telegram](#telegram)).

En länk i en meddelandeapp öppnas i appens egen webbläsare eller i telefonens standardwebbläsare, aldrig i OneUptime-appen. Ett VPN per app måste därför täcka meddelandeapparna och webbläsaren, inte bara OneUptime-appen.

Att trycka 1 under ett samtal, knappar i meddelanden i Slack och Microsoft Teams samt WhatsApps leveranskvitton kräver fortfarande att respektive leverantör kan nå din server.

## Publicera bara bekräftelsesidorna

Om de jourhavandes telefoner inte kan använda ditt VPN publicerar du sidorna som en bekräftelselänk öppnar, och ingenting annat. Sätt en omvänd proxy framför OneUptime, eller en utgående tunnel som Cloudflare Tunnel, som inte behöver någon inkommande brandväggsregel, och släpp bara igenom de här sökvägarna:

| Metod | Sökväg | Vad den levererar |
| --- | --- | --- |
| GET | `/l/*` | De korta länkarna i SMS och i meddelanden i WhatsApp och Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | Sidan som visar vad larmet gäller, med knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Valfritt: sidan som skickar larmet vidare till nästa person |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Valfritt: dess knapp |
| GET | `/oneuptime-assets/*` | Typsnitt, stilar och logotyp för de sidorna |

:::steps
### Peka ett publikt namn mot proxyn
Länkarna i meddelanden byggs från din inställning `HOST`, så det namnet måste slås upp publikt till proxyn, med ett offentligt betrott certifikat. Med delad DNS fortsätter personer i ditt nätverk att slå upp det till den privata adressen och använda allt annat som förut.

### Vidarebefordra sökvägarna oförändrade
Skicka de här sökvägarna till OneUptimes ingress med deras metod, sökväg och frågesträng, och svara med 404 på allt annat.

### Begränsa antalet begäranden
Varje länk bär ett slumpmässigt ID, och en kort länk är åtta bokstäver lång. Begränsa hur många begäranden varje adress får göra, så att ingen kan prova ID:n i snabb takt.
:::

När en jourhavande har bekräftat öppnar sidan larmet i dashboarden, som bara laddas i ditt nätverk. Då är bekräftelsen redan sparad.

## Återanrop från leverantörer

### Telegram

Att skicka larm kräver bara utgående HTTPS till `api.telegram.org`. Att koppla ett konto innebär att din server tar emot meddelandet `/start` som en person skickar till din bot, på ett av två sätt:

- **Pollning**: slå på **Poll Telegram for Messages** i **Admin Dashboard > Inställningar > Telegram**. OneUptime hämtar botens meddelanden från Telegram med några sekunders mellanrum över utgående HTTPS, så ingenting behöver nå din server.
- **Webhook**: Telegram postar varje meddelande till `POST /api/notification/telegram/webhook`. Telegram [skickar webhooks](https://core.telegram.org/bots/webhooks) från `149.154.160.0/20` och `91.108.4.0/22`, så du kan tillåta bara de adresserna.

### Twilio

När en jourhavande trycker 1 för att bekräfta ett samtal postar Twilio knapptryckningen till `POST /api/user-notification-log-timeline/call/gather-input/*`. Twilios webhook-adresser ändras, om inte din Twilio-utgåva innehåller [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Uppdateringar om SMS-leverans och inkommande samtal beskrivs i [Twilio-integration](/docs/self-hosted/twilio-integration).

### WhatsApp

Larm och bekräftelser behöver ingenting inkommande. Meta postar leverans- och läskvitton till `/api/notification/whatsapp/webhook`; utan dem kan OneUptimes WhatsApp-logg inte visa om ett meddelande levererades, lästes eller misslyckades efter att Meta tagit emot det. Meta signerar varje begäran och publicerar inga fasta adresser.

### Slack och Microsoft Teams

Knappar, menyer och kommandon i deras meddelanden anropar din server, från adresser som ingen av dem publicerar. Sökvägarna, och hur du publicerar dem, finns i [Slack-integration](/docs/self-hosted/slack-integration) och [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration).

## Nästa steg

:::cards
- [Twilio-integration](/docs/self-hosted/twilio-integration): SMS och samtal via ditt eget Twilio-konto.
- [Push-aviseringar](/docs/self-hosted/push-notifications): Push-reläet, och vad din server och telefonerna når.
- [Appar – Översikt](/docs/mobile-desktop-apps/index): Anslut appen OneUptime On-Call till din server.
- [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access): Åt andra hållet: låt OneUptime nå dina interna verktyg.
:::
