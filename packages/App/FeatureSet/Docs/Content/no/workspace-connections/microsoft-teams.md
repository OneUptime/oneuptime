# Koble OneUptime til Microsoft Teams

### Trinn for å koble OneUptime til Microsoft Teams

1. **Opprett en konto på OneUptime**

   - Besøk [OneUptime.com](https://oneuptime.com) og opprett en konto.
   - Når kontoen er opprettet, opprett et nytt prosjekt.

2. **Koble Microsoft Teams til OneUptime-prosjektet**

   - Naviger til **Prosjektinnstillinger** > **Microsoft Teams** innenfor OneUptime-prosjektet ditt.
   - Følg instruksjonene for å koble Microsoft Teams-kontoen din til OneUptime-prosjektet.

3. **Konfigurer hendelsesvarsler**

   - Etter at Microsoft Teams-kontoen er koblet, gå til **Incidents Page** > **Microsoft Teams**.
   - Legg til regler for å sende hendelsesvarsler til Microsoft Teams. For eksempel kan du opprette en regel som publiserer meldinger til en Teams-kanal når en hendelse opprettes.

4. **Konfigurer varsler og planlagte vedlikeholdsvarsler**
   - Tilsvarende regler kan brukes på varsler og planlagt vedlikehold ved å navigere til de respektive sidene og konfigurere ønskede regler.

## Teste en regel

**Testregel** på raden til en regel sender en testmelding for regelen til kanalene den nevner, slik at du kan se den komme frem. Oppretter regelen en kanal for hver hendelse, oppretter testen også en og inviterer regelens personer til den.

Som **Send test** ved siden av en kanal i **Prosjektinnstillinger** > **Workspace** > **Microsoft Teams** krever det tillatelse til å opprette varslingsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en egendefinert rolle. For den som bare kan se reglene, for eksempel en **Viewer**, er **Testregel** låst, og verktøytipset sier hva som kreves; API-et avviser testen med "You do not have permission to send test notifications in this project." På OneUptime Cloud krever det planen **Growth** å teste en regel, som å legge til en.

På OneUptime Cloud krever også **Send test** ved siden av en kanal eller en chat planen **Growth**, for å poste i en kanal er det regler og sammendrag gjør. **Send test nå** på et sammendrag krever tillatelse til å opprette sammendrag (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en egendefinert rolle) og, på OneUptime Cloud, planen **Growth**; for alle andre er den låst, og verktøytipset sier hva som kreves. En MCP-klient som er koblet til med skrivebeskyttet tilgang, kan ikke sende noen test.

## Sammendrag

Fanen **Summary** under **Hendelser** > **Workspace** > **Microsoft Teams** (og under **Varsler**) sender jevnlig en oversikt til kanalene du angir: hvor mange hendelser eller varsler det var, hvor raskt de ble bekreftet og løst, og en liste med lenker. Et nytt sammendrag sendes hver uke og dekker de siste 7 dagene. La **Send første rapport kl.** stå tomt, så sendes det første kl. 09:00 ved begynnelsen av neste uke, dag eller måned; skjemaet viser når.

Et sammendrag følger klokken i sin **Tidssone**, som starter på din. Der holder det tidspunktet sitt hele året: et sammendrag satt til kl. 09:00 i Berlin sendes fortsatt kl. 09:00 Berlin-tid etter at klokken er stilt om, og datoene i meldingen er også Berlins. Send `timezone` som et IANA-tidssonenavn via API-et, for eksempel `Europe/Berlin`. Et sammendrag som opprettes uten tidssone, får tidssonen fra profilen til den som oppretter det, eller UTC når en API-nøkkel oppretter det.

## Nettverkstilgang for selvhostede installasjoner

Se delen om nettverkstilgang i [Microsoft Teams-integrasjon](/docs/self-hosted/microsoft-teams-integration) for informasjon om utgående forbindelser, innkommende tilbakekall og private installasjoner.
