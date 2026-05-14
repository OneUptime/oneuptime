# Köra ett runbook

Det finns tre sätt en runbook-körning kan uppstå:

1. **Automatiskt via en regel** — se [Runbook-regler](/docs/runbooks/rules).
2. **Manuellt från runbook-sidan** — klicka **Kör nu** på en runbookens översikt. Inte kopplad till någon incident, larm eller underhåll.
3. **Manuellt från en entitets-feed** — klicka **Kör runbook** på en incident, ett larm eller en planerad underhållshändelse. Körningen är kopplad till den entiteten.

## Körningsvyn

Öppna valfri körning för att se checklist-gränssnittet. Varje steg visar:

- **Status** — Väntar, Pågår, Väntar på dig, Klart, Hoppat över, Misslyckades.
- **Titel och beskrivning** — kopierade från runbooken vid körningstillfället.
- **Utdata** (kan fällas ihop) — stdout, returvärden, HTTP-svar.
- **Felmeddelande** om steget misslyckades.
- För manuella steg i `WaitingForUser`: knapparna **Markera som klart** och **Hoppa över**.

Så länge körningen inte är avslutande uppdateras sidan var 3:e sekund, så du ser automatiserade steg slutföras nästan i realtid.

## Växla mellan manuella och automatiserade steg

Det klassiska flödet:

1. **Skript-steg**: fånga systemtillstånd, skriv till S3.
2. **Manuellt steg**: "Meddela kunder via banner på statussidan." Respondern kryssar i.
3. **HTTP-steg**: kalla in DBA via PagerDuty.
4. **Manuellt steg**: "Bekräfta att sekundär DB är primär." Respondern kryssar i.
5. **Skript-steg**: skicka "allt klart"-meddelande på Slack.

Steg 2 och 4 pausar körningen tills ikryssning. Steg 1, 3, 5 körs automatiskt. Hela förloppet är en körning, en tidslinje, en sanningskälla.

## Avbryt en körning

Klicka **Avbryt körning** på sidan. Aktuellt steg (om något) slutförs; efterföljande steg startas inte. Statusen blir `Cancelled`.

## Bevarande av utdata

Utdata per steg är begränsat till **50 KB** för att förhindra att skenande skript sprängfyller databasen. Behöver du större artefakter, skriv dem från skriptet till S3 eller en logger och spara URL:en i returvärdet.

## Köra ett runbook igen

En körning är en engångs- och oföränderlig post. För att upprepa klickar du **Kör nu** igen — det skapar en färsk körning med en ny snapshot av runbookens nuvarande steg. Den ursprungliga körningen ligger kvar för revisionsspåret.

## Hitta tidigare körningar

Varje runbook har en flik **Körningar** som listar alla dess körningar, med filter för status, datumintervall och källentitet. På en incident, larm eller underhåll visar fliken **Runbooks** körningar kopplade till den entiteten.
