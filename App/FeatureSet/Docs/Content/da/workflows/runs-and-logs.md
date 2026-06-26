# Kørsler & logfiler

Hver gang et workflow kører, gemmer OneUptime en optegnelse over, hvad der skete — hvornår det kørte, om det lykkedes, og hvad hver blok gjorde. Den optegnelse hedder en **kørsel**. Kørsler er sådan, du bekræfter, at et workflow virkede, fejlfinder et der ikke gjorde, og kigger tilbage på tidligere aktivitet.

## Hvor du finder dem

| Side                        | Hvad du ser                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **Workflows → Runs & Logs** | Hver kørsel fra hvert workflow i projektet. Filtrér efter workflow, status og tid. |
| **Workflow → Logs-fane**    | Kun kørslerne af dette ene workflow.                                               |
| **En enkelt kørsel**        | Én afvikling med outputtet fra hver blok.                                          |

## Kørselsstatusser

| Status        | Hvad det betyder                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled** | Triggeren udløstes, og kørslen er ved at starte. Tager normalt kun en brøkdel af et sekund.                                                  |
| **Running**   | Workflowet er i gang. Langvarige blokke holder en kørsel i denne tilstand.                                                                   |
| **Success**   | Hver blok, der kørte, afsluttede uden fejl. (At tage en **error**-gren med vilje tæller stadig som success — selve workflowet fejlede ikke.) |
| **Error**     | En blok fejlede, og der var ingen **error**-sti forbundet til at håndtere den. Kørslen stoppede der.                                         |
| **Timeout**   | Kørslen kørte længere end tilladt. Se [Konfiguration & sikkerhed](/docs/workflows/configuration).                                            |

## Læs en kørsel

Klik på en kørsel for at åbne detaljerne. Du vil se:

- **Header** — triggeren, start- og sluttid, samlet varighed og status.
- **Blokliste** — hver blok der kørte, i rækkefølge. Hver enkelt viser de værdier, den fik, dens output, og hvilken sti den tog.
- **Errors** — hvis en blok fejlede, så fejlmeddelelsen og (når tilgængelige) flere detaljer.

De viste værdier er præcis, hvad blokken så — efter alle variabler blev udfyldt. Dette er den enkelt mest nyttige debugging-visning: hvis en Slack-besked viser den bogstavelige tekst `{{Incident.title}}` i stedet for den faktiske titel, ved du, at variablen ikke blev løst op.

## Almindelig debugging

### "Mit workflow kørte ikke."

1. Sørg for, at workflowet er **enabled** i Settings. Nye workflows starter deaktiverede.
2. For en OneUptime event-trigger: bekræft at eventen faktisk skete. Åbn posten og tjek dens historik.
3. For en webhook-trigger: bekræft at det andet system sender til den rigtige URL. De fleste værktøjer logger, når de sender en webhook — tjek der.
4. For en tidsplan-trigger: bekræft at cron-udtrykket matcher det tidspunkt, du forventer.

Hvis triggeren udløstes, men ingen kørsel dukker op, så tjek din kørselskvote under **Project Settings → Billing**.

### "En senere blok kørte aldrig."

En blok, der ikke kører, er som regel et koblingsproblem. Åbn lærredet og tjek:

- Er den tidligere bloks output forbundet til denne bloks input?
- Tog den tidligere blok et andet output, end du forventede (for eksempel **error** i stedet for **success**, eller **No** i stedet for **Yes**)? Kørselsdetaljen viser, hvilken sti der blev taget.

### "En variabel kom igennem tom."

Åbn kørslen og kig på den fejlende bloks værdier.

- Hvis du ser den bogstavelige tekst `{{BlockName.field}}`, blev referencen ikke løst op — sandsynligvis en tastefejl i bloknavnet eller feltnavnet.
- Hvis du ser en tom streng, kørte den tidligere blok, men producerede ikke det felt.

### "Det virker, når jeg kører det manuelt, men ikke fra triggeren."

Brug **Run Manually** med en JSON-payload, der ligner det, den rigtige trigger sender. Sammenlign så værdierne i den manuelle kørsel med den rigtige kørsel side om side. Forskellen er som regel et enkelt feltnavn eller en type.

## Genkør et workflow

Der er ingen "prøv denne kørsel igen"-knap. Vi genkører ikke gamle afviklinger automatisk, fordi sideeffekterne (Slack-beskeder, API-kald, tickets) måske ikke er sikre at gentage. For at gøre arbejdet om: ret workflowet, og lad den næste rigtige trigger udløse det.

For manuelle workflows klikker du bare **Run Manually** med samme payload.

## Hvor længe gemmes kørsler?

Kørsler gemmes uden tidsbegrænsning for projektet. Hvis et workflow kører meget ofte og roder i din historik (såsom et debug-workflow, der udløses hvert minut), så deaktivér eller slet det for at stoppe med at tilføje til støjen.

## Læs videre

- [Konfiguration & sikkerhed](/docs/workflows/configuration) — timeouts, rekursionsgrænser, skjulte hemmeligheder.
- [Variabler](/docs/workflows/variables) — variabel-syntaksen brugt i dine blokke.
- [Komponenter](/docs/workflows/components) — hvad hver blok producerer.
