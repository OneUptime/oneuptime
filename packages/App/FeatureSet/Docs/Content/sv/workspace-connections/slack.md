# Ansluta OneUptime till Slack

### Steg för att ansluta OneUptime till Slack

1. **Skapa ett konto på OneUptime**

   - Besök [OneUptime.com](https://oneuptime.com) och skapa ett konto.
   - När kontot har skapats skapar du ett nytt projekt.

2. **Anslut Slack till OneUptime-projektet**

   - Navigera till **Projektinställningar** > **Slack** i ditt OneUptime-projekt.
   - Följ anvisningarna för att ansluta ditt Slack-konto med OneUptime-projektet.

3. **Konfigurera incidentaviseringar**

   - Efter att ha anslutit ditt Slack-konto går du till **Incidentsidan** > **Slack**.
   - Lägg till regler för att skicka incidentaviseringar till Slack. Du kan till exempel skapa en regel som skapar en ny Slack-kanal och bjuder in incidentägare när en incident skapas.

4. **Konfigurera varningar och aviseringar om planerat underhåll**
   - Liknande regler kan tillämpas på varningar och planerat underhåll genom att navigera till respektive sidor och konfigurera önskade regler.

## Testa en regel

**Testregel** på en regels rad skickar ett testmeddelande för regeln till de kanaler den nämner, så att du ser att det kommer fram. Skapar regeln en kanal för varje händelse skapar testet också en och bjuder in regelns personer.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Workspace** > **Slack** krävs behörighet att skapa aviseringsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en egen roll. För den som bara kan se reglerna, till exempel en **Viewer**, är **Testregel** låst, och verktygstipset säger vad som krävs; API:t avvisar testet med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det planen **Growth** att testa en regel, precis som att lägga till en.

På OneUptime Cloud kräver även **Skicka test** bredvid en kanal planen **Growth**, eftersom att posta i en kanal är vad regler och sammanfattningar gör. **Skicka test nu** på en sammanfattning kräver behörighet att skapa sammanfattningar (**Create Workspace Notification Summary** och **Read Workspace Notification Summary** i en egen roll) och, på OneUptime Cloud, planen **Growth**; för alla andra är den låst, och verktygstipset säger vad som krävs. En MCP-klient som är ansluten med skrivskyddad åtkomst kan inte skicka något test.

## Sammanfattningar

Fliken **Summary** under **Incidenter** > **Workspace** > **Slack** (och under **Varningar**) skickar regelbundet en översikt till de kanaler du anger: hur många incidenter eller varningar det var, hur snabbt de bekräftades och löstes, och en lista med länkar. En ny sammanfattning skickas varje vecka och täcker de senaste 7 dagarna. Lämna **Skicka första rapporten kl.** tomt, så skickas den första kl. 09:00 i början av nästa vecka, dag eller månad; formuläret visar när.

En sammanfattning följer klockan i sin **Tidszon**, som börjar på din. Där behåller den sin tid hela året: en sammanfattning inställd på kl. 09:00 i Berlin skickas fortfarande kl. 09:00 Berlintid efter att klockan har ställts om, och datumen i dess meddelande är också Berlins. Skicka `timezone` som ett IANA-tidszonsnamn via API:t, till exempel `Europe/Berlin`. En sammanfattning som skapas utan tidszon får tidszonen från profilen hos den som skapar den, eller UTC när en API-nyckel skapar den.

## Nätverksåtkomst för egenhostade installationer

Läs avsnittet om nätverksåtkomst i [Slack-integration](/docs/self-hosted/slack-integration) för information om utgående anslutningar, inkommande återanrop och privata installationer.
