# Koble OneUptime til Slack

### Trinn for å koble OneUptime til Slack

1. **Opprett en konto på OneUptime**

   - Besøk [OneUptime.com](https://oneuptime.com) og opprett en konto.
   - Når kontoen er opprettet, opprett et nytt prosjekt.

2. **Koble Slack til OneUptime-prosjektet**

   - Naviger til **Prosjektinnstillinger** > **Slack** innenfor OneUptime-prosjektet ditt.
   - Følg instruksjonene for å koble Slack-kontoen din til OneUptime-prosjektet.

3. **Konfigurer hendelsesvarsler**

   - Etter at Slack-kontoen er koblet, gå til **Incidents Page** > **Slack**.
   - Legg til regler for å sende hendelsesvarsler til Slack. For eksempel kan du opprette en regel som oppretter en ny Slack-kanal og inviterer hendelseseiere når en hendelse opprettes.

4. **Konfigurer varsler og planlagte vedlikeholdsvarsler**
   - Tilsvarende regler kan brukes på varsler og planlagt vedlikehold ved å navigere til de respektive sidene og konfigurere ønskede regler.

## Teste en regel

**Testregel** på raden til en regel sender en testmelding for regelen til kanalene den nevner, slik at du kan se den komme frem. Oppretter regelen en kanal for hver hendelse, oppretter testen også en og inviterer regelens personer til den.

Som **Send test** ved siden av en kanal i **Prosjektinnstillinger** > **Workspace** > **Slack** krever det tillatelse til å opprette varslingsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en egendefinert rolle. For den som bare kan se reglene, for eksempel en **Viewer**, er **Testregel** låst, og verktøytipset sier hva som kreves; API-et avviser testen med "You do not have permission to send test notifications in this project." På OneUptime Cloud krever det planen **Growth** å teste en regel, som å legge til en.

## Nettverkstilgang for selvhostede installasjoner

Se delen om nettverkstilgang i [Slack-integrasjon](/docs/self-hosted/slack-integration) for informasjon om utgående forbindelser, innkommende tilbakekall og private installasjoner.
