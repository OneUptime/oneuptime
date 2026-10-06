# Tilslutning af OneUptime til Microsoft Teams

### Trin til at tilslutte OneUptime til Microsoft Teams

1. **Opret en konto på OneUptime**

   - Besøg [OneUptime.com](https://oneuptime.com) og opret en konto.
   - Når kontoen er oprettet, skal du oprette et nyt projekt.

2. **Tilslut Microsoft Teams til OneUptime-projektet**

   - Naviger til **Projektindstillinger** > **Microsoft Teams** i dit OneUptime-projekt.
   - Følg prompterne for at tilslutte din Microsoft Teams-konto med OneUptime-projektet.

3. **Konfigurer incident-notifikationer**

   - Når du har tilsluttet din Microsoft Teams-konto, skal du gå til **Hændelser-siden** > **Microsoft Teams**.
   - Tilføj regler for at sende incident-notifikationer til Microsoft Teams. Du kan f.eks. oprette en regel, der poster meddelelser til en Teams-kanal, når et incident oprettes.

4. **Konfigurer advarsels- og planlagt vedligeholdelsesnotifikationer**
   - Lignende regler kan anvendes på Advarsler og Planlagt vedligeholdelse ved at navigere til deres respektive sider og konfigurere de ønskede regler.

## Test af en regel

**Testregel** på en regels række sender en testbesked for reglen til de kanaler, den nævner, så du kan se den komme frem. Opretter reglen en kanal for hver hændelse, opretter testen også en og inviterer reglens personer til den.

Ligesom **Send test** ved siden af en kanal i **Projektindstillinger** > **Workspace** > **Microsoft Teams** kræver det tilladelse til at oprette notifikationsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** i en brugerdefineret rolle. Den, der kun kan se reglerne, for eksempel en **Viewer**, får at vide, at vedkommende ikke har tilladelse til at sende testnotifikationer. På OneUptime Cloud kræver det planen **Growth** at teste en regel, ligesom at tilføje en.

## Netværksadgang for selvhostede installationer

Læs afsnittet om netværksadgang i [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration) for oplysninger om udgående forbindelser, indgående callbacks og private installationer.
