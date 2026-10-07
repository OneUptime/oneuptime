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

Ligesom **Send test** ved siden af en kanal i **Projektindstillinger** > **Workspace** > **Microsoft Teams** kræver det tilladelse til at oprette notifikationsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en brugerdefineret rolle. For den, der kun kan se reglerne, for eksempel en **Viewer**, er **Testregel** låst, og dens værktøjstip siger, hvad det kræver; API'et afviser testen med "You do not have permission to send test notifications in this project." På OneUptime Cloud kræver det planen **Growth** at teste en regel, ligesom at tilføje en.

På OneUptime Cloud kræver **Send test** ved siden af en kanal eller en chat også planen **Growth**, for at poste i en kanal er det, regler og opsummeringer gør. **Send test nu** på en opsummering kræver tilladelse til at oprette opsummeringer (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en brugerdefineret rolle) og, på OneUptime Cloud, planen **Growth**; for alle andre er den låst, og dens værktøjstip siger, hvad det kræver. En MCP-klient, der er forbundet med skrivebeskyttet adgang, kan ikke sende nogen test.

## Oversigter

Fanen **Summary** under **Hændelser** > **Workspace** > **Microsoft Teams** (og under **Advarsler**) sender jævnligt et overblik til de kanaler, du angiver: hvor mange hændelser eller advarsler der var, hvor hurtigt de blev kvitteret og løst, og en liste med links. En ny oversigt sendes hver uge og dækker de seneste 7 dage. Lad **Send første rapport kl.** stå tomt, så sendes den første kl. 09:00 ved begyndelsen af næste uge, dag eller måned; formularen viser hvornår.

En oversigt følger uret i sin **Tidszone**, som starter på din. Dér holder den sit tidspunkt hele året: en oversigt sat til kl. 09:00 i Berlin sendes stadig kl. 09:00 Berlin-tid, efter at uret er stillet om, og datoerne i dens besked er også Berlins. Send via API'et `timezone` som et IANA-tidszonenavn, fx `Europe/Berlin`. En oversigt oprettet uden tidszone får tidszonen fra profilen hos den, der opretter den, eller UTC, når en API-nøgle opretter den.

## Netværksadgang for selvhostede installationer

Læs afsnittet om netværksadgang i [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration) for oplysninger om udgående forbindelser, indgående callbacks og private installationer.
