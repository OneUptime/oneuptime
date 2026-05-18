# Köra ett runbook

Det finns tre sätt en runbook-körning skapas:

1. **Automatiskt via en regel** — se [Runbook-regler](/docs/runbooks/rules).
2. **Manuellt från runbook-sidan** — klicka **Kör nu** på ett runbooks översiktssida. Inte kopplad till någon incident, något larm eller någon planerad underhållshändelse.
3. **Manuellt från ett entitetsflöde** — klicka **Kör runbook** på en incident, ett larm eller en planerad underhållshändelse. Körningen kopplas till den entiteten.

## Körningsvyn

Öppna vilken körning som helst för att se dess checklist-UI. Varje steg visar:

- **Statusetikett** — Pending, Running, Väntar på dig, Done, Skipped, Failed.
- **Titel och beskrivning** — kopierade från runbooket vid körtid.
- **Utdata** (hopfällbart) — stdout, returvärden, HTTP-svar.
- **Felmeddelande** om steget misslyckades.
- För manuella steg i `WaitingForUser`: **Markera som klar**- och **Hoppa över**-knappar.

Sidan pollar var tredje sekund medan körningen inte är terminal, så du ser automatiserade steg avslutas i nära realtid.

## Varva manuella och automatiserade steg

Det klassiska flödet:

1. **Skript-steg**: fånga systemtillstånd, skriva till S3.
2. **Manuellt steg**: "Notifiera kunder via statussidebannern." Svararen bockar av.
3. **HTTP-steg**: paga DBA:n via PagerDuty.
4. **Manuellt steg**: "Bekräfta att sekundär-DB nu är primary." Svararen bockar av.
5. **Skript-steg**: skicka klart-meddelandet via Slack.

Steg 2 och 4 pausar körningen tills de bockas av. Steg 1, 3, 5 körs automatiskt. Hela körningen är en körning, en tidslinje, en källa till sanning.

## Avbryta en körning

Klicka **Avbryt körning** på körningssidan. Det aktuella steget (om något) avslutar; efterföljande steg startar inte. Status blir `Cancelled`.

## Utdataretention

Utdata per steg är begränsad till **50KB** för att förhindra att skenande skript blåser upp databasen. Behöver du större artefakter, skriv dem till S3 eller en logger från skriptet och lagra URL:en i returvärdet.

## Köra ett runbook igen

En runbook-körning är ett engångs, oföränderligt register. För att köra igen, klicka **Kör nu** igen — det skapar en färsk körning med ett färskt snapshot av runbookets nuvarande steg. Den ursprungliga körningen förblir intakt för audit-spåret.

## Hitta tidigare körningar

Varje runbook har en **Executions**-flik som listar alla dess körningar, med filter för status, datumintervall och käll-entitet. Från en incident, ett larm eller en planerad underhållshändelse visar **Runbooks**-fliken körningar kopplade till den entiteten.
