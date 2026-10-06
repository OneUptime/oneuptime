# OneUptime verbinden met Slack

### Stappen om OneUptime te verbinden met Slack

1. **Een account aanmaken op OneUptime**

   - Ga naar [OneUptime.com](https://oneuptime.com) en maak een account aan.
   - Zodra het account is aangemaakt, maakt u een nieuw project aan.

2. **Slack verbinden met OneUptime-project**

   - Navigeer naar **Projectinstellingen** > **Slack** in uw OneUptime-project.
   - Volg de aanwijzingen om uw Slack-account te verbinden met het OneUptime-project.

3. **Incidentmeldingen configureren**

   - Ga na het verbinden van uw Slack-account naar **Incidentenpagina** > **Slack**.
   - Voeg regels toe om incidentmeldingen naar Slack te sturen. U kunt bijvoorbeeld een regel aanmaken die een nieuw Slack-kanaal aanmaakt en incidenteigenaren uitnodigt wanneer een incident wordt aangemaakt.

4. **Meldingen en notificaties voor gepland onderhoud configureren**
   - Vergelijkbare regels kunnen worden toegepast op Meldingen en Gepland onderhoud door naar de respectievelijke pagina's te navigeren en de gewenste regels te configureren.

## Een regel testen

**Testregel** op de rij van een regel plaatst een testbericht van die regel in de kanalen die de regel noemt, zodat je het ziet aankomen. Maakt de regel voor elke gebeurtenis een kanaal aan, dan maakt de test er ook een en nodigt de mensen van de regel uit.

Net als **Test verzenden** naast een kanaal in **Projectinstellingen** > **Workspace** > **Slack** vraagt dit toestemming om meldingsregels aan te maken: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** of **Create Workspace Notification Rule** en **Read Workspace Notification Rule** in een eigen rol. Voor wie de regels alleen kan zien, zoals een **Viewer**, is **Testregel** vergrendeld en zegt de tooltip wat ervoor nodig is; de API weigert de test met "You do not have permission to send test notifications in this project." Op OneUptime Cloud vraagt het testen van een regel het abonnement **Growth**, net als het toevoegen ervan.

## Netwerktoegang voor zelfgehoste implementaties

Raadpleeg het gedeelte over netwerktoegang in de [Slack-integratie](/docs/self-hosted/slack-integration) voor uitgaande verbindingen, inkomende callbacks en privé-implementaties.
