# Ansluta OneUptime till Microsoft Teams

### Steg för att ansluta OneUptime till Microsoft Teams

1. **Skapa ett konto på OneUptime**

   - Besök [OneUptime.com](https://oneuptime.com) och skapa ett konto.
   - När kontot har skapats skapar du ett nytt projekt.

2. **Anslut Microsoft Teams till OneUptime-projektet**

   - Navigera till **Projektinställningar** > **Microsoft Teams** i ditt OneUptime-projekt.
   - Följ anvisningarna för att ansluta ditt Microsoft Teams-konto med OneUptime-projektet.

3. **Konfigurera incidentaviseringar**

   - Efter att ha anslutit ditt Microsoft Teams-konto går du till **Incidentsidan** > **Microsoft Teams**.
   - Lägg till regler för att skicka incidentaviseringar till Microsoft Teams. Du kan till exempel skapa en regel som publicerar meddelanden till en Teams-kanal när en incident skapas.

4. **Konfigurera varningar och aviseringar om planerat underhåll**
   - Liknande regler kan tillämpas på varningar och planerat underhåll genom att navigera till respektive sidor och konfigurera önskade regler.

## Testa en regel

**Testregel** på en regels rad skickar ett testmeddelande för regeln till de kanaler den nämner, så att du ser att det kommer fram. Skapar regeln en kanal för varje händelse skapar testet också en och bjuder in regelns personer.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Workspace** > **Microsoft Teams** krävs behörighet att skapa aviseringsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en egen roll. För den som bara kan se reglerna, till exempel en **Viewer**, är **Testregel** låst, och verktygstipset säger vad som krävs; API:t avvisar testet med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det planen **Growth** att testa en regel, precis som att lägga till en.

## Nätverksåtkomst för egenhostade installationer

Läs avsnittet om nätverksåtkomst i [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration) för information om utgående anslutningar, inkommande återanrop och privata installationer.
