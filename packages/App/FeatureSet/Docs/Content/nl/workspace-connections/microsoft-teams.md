# OneUptime verbinden met Microsoft Teams

### Stappen om OneUptime te verbinden met Microsoft Teams

1. **Een account aanmaken op OneUptime**

   - Ga naar [OneUptime.com](https://oneuptime.com) en maak een account aan.
   - Zodra het account is aangemaakt, maakt u een nieuw project aan.

2. **Microsoft Teams verbinden met OneUptime-project**

   - Navigeer naar **Projectinstellingen** > **Microsoft Teams** in uw OneUptime-project.
   - Volg de aanwijzingen om uw Microsoft Teams-account te verbinden met het OneUptime-project.

3. **Incidentmeldingen configureren**

   - Ga na het verbinden van uw Microsoft Teams-account naar **Incidentenpagina** > **Microsoft Teams**.
   - Voeg regels toe om incidentmeldingen naar Microsoft Teams te sturen. U kunt bijvoorbeeld een regel aanmaken die berichten plaatst in een Teams-kanaal wanneer een incident wordt aangemaakt.

4. **Meldingen en notificaties voor gepland onderhoud configureren**
   - Vergelijkbare regels kunnen worden toegepast op Meldingen en Gepland onderhoud door naar de respectievelijke pagina's te navigeren en de gewenste regels te configureren.

## Een regel testen

**Testregel** op de rij van een regel plaatst een testbericht van die regel in de kanalen die de regel noemt, zodat je het ziet aankomen. Maakt de regel voor elke gebeurtenis een kanaal aan, dan maakt de test er ook een en nodigt de mensen van de regel uit.

Net als **Test verzenden** naast een kanaal in **Projectinstellingen** > **Workspace** > **Microsoft Teams** vraagt dit toestemming om meldingsregels aan te maken: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** of **Create Workspace Notification Rule** en **Read Workspace Notification Rule** in een eigen rol. Voor wie de regels alleen kan zien, zoals een **Viewer**, is **Testregel** vergrendeld en zegt de tooltip wat ervoor nodig is; de API weigert de test met "You do not have permission to send test notifications in this project." Op OneUptime Cloud vraagt het testen van een regel het abonnement **Growth**, net als het toevoegen ervan.

## Samenvattingen

Het tabblad **Summary** onder **Incidenten** > **Workspace** > **Microsoft Teams** (en dat onder **Waarschuwingen**) plaatst regelmatig een overzicht in de kanalen die je opgeeft: hoeveel incidenten of waarschuwingen er waren, hoe snel ze werden bevestigd en opgelost, en een lijst met links. Een nieuwe samenvatting wordt elke week verzonden en beslaat de laatste 7 dagen. Laat **Eerste rapport verzenden om** leeg, dan gaat de eerste om 09:00 uur aan het begin van de volgende week, dag of maand; het formulier laat zien wanneer.

Een samenvatting volgt de klok van haar **Tijdzone**, die begint op die van jou. Daar houdt ze het hele jaar haar tijdstip: een samenvatting voor 09:00 uur in Berlijn gaat ook nadat de klok is verzet om 09:00 uur Berlijnse tijd, en ook de datums in haar bericht zijn die van Berlijn. Stuur via de API `timezone` als IANA-tijdzonenaam, zoals `Europe/Berlin`. Een samenvatting die zonder tijdzone wordt gemaakt, neemt de tijdzone uit het profiel van wie haar maakt, of UTC als een API-sleutel haar maakt.

## Netwerktoegang voor zelfgehoste implementaties

Raadpleeg het gedeelte over netwerktoegang in de [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration) voor uitgaande verbindingen, inkomende callbacks en privé-implementaties.
