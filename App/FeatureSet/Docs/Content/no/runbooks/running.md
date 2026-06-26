# Kjøre et runbook

Det er tre måter en runbook-kjøring kan oppstå på:

1. **Automatisk via en regel** — se [Runbook-regler](/docs/runbooks/rules).
2. **Manuelt fra runbook-siden** — klikk **Kjør nå** på et runbook'ets oversikt. Ikke knyttet til noen hendelse, varsel eller vedlikehold.
3. **Manuelt fra en entitets-feed** — klikk **Kjør runbook** på en hendelse, varsel eller planlagt vedlikeholdshendelse. Kjøringen er knyttet til den entiteten.

## Kjøringsvisningen

Åpne en hvilken som helst kjøring for å se sjekkliste-UI-en. Hvert trinn viser:

- **Status** — Avventer, Kjører, Venter på deg, Ferdig, Hoppet over, Feilet.
- **Tittel og beskrivelse** — kopiert fra runbook'et ved utførelse.
- **Output** (kan brettes ut) — stdout, returverdier, HTTP-svar.
- **Feilmelding**, hvis trinnet feilet.
- For manuelle trinn i `WaitingForUser`: knappene **Marker som ferdig** og **Hopp over**.

Mens kjøringen ikke er avsluttende, oppdateres siden hvert 3. sekund, slik at du ser automatiserte trinn fullføre nær sanntid.

## Veksle mellom manuelle og automatiserte trinn

Den klassiske flyten:

1. **Skript-trinn**: fang systemtilstand, skriv til S3.
2. **Manuelt trinn**: "Varsle kunder via banner på statussiden." Responderen huker av.
3. **HTTP-trinn**: tilkall DBA via PagerDuty.
4. **Manuelt trinn**: "Bekreft at sekundær DB er primær." Responderen huker av.
5. **Skript-trinn**: send "alt klart"-melding på Slack.

Trinn 2 og 4 pauser kjøringen til avkryssing. Trinn 1, 3, 5 kjører automatisk. Hele forløpet er én kjøring, én tidslinje, én sannhetskilde.

## Avbryt en kjøring

Klikk **Avbryt kjøring** på siden. Det aktuelle trinnet (om noe) fullføres; etterfølgende trinn starter ikke. Statusen blir `Cancelled`.

## Bevaring av output

Output per trinn er begrenset til **50 KB** for å hindre at løpske skript blåser opp databasen. Trenger du større artefakter, skriv dem fra skriptet til S3 eller en logger og lagre URL-en i returverdien.

## Kjøre et runbook på nytt

En kjøring er en engangs- og uforanderlig oppføring. For å gjenta, klikker du **Kjør nå** på nytt — det gir en fersk kjøring med et nytt snapshot av runbook'ets nåværende trinn. Den opprinnelige kjøringen forblir intakt for revisjonssporet.

## Finn tidligere kjøringer

Hvert runbook har en fane **Kjøringer** som lister alle kjøringene, med filtre for status, datointervall og kildeentitet. På en hendelse, varsel eller vedlikehold viser fanen **Runbooks** kjøringer knyttet til den entiteten.
