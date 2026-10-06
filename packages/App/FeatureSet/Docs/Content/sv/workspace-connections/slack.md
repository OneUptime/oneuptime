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

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Workspace** > **Slack** krävs behörighet att skapa aviseringsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** i en egen roll. Den som bara kan se reglerna, till exempel en **Viewer**, får veta att den inte har behörighet att skicka testaviseringar. På OneUptime Cloud kräver det planen **Growth** att testa en regel, precis som att lägga till en.

## Nätverksåtkomst för egenhostade installationer

Läs avsnittet om nätverksåtkomst i [Slack-integration](/docs/self-hosted/slack-integration) för information om utgående anslutningar, inkommande återanrop och privata installationer.
