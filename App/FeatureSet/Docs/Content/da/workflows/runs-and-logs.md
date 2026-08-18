# Kørsler & logfiler

Hver gang et workflow kører, gemmer OneUptime en optegnelse over, hvad der skete — hvornår det kørte, om det lykkedes, og hvad hver blok gjorde. Den optegnelse kaldes en **kørsel**. Kørsler er sådan, du bekræfter, at et workflow virkede, fejlfinder et der ikke gjorde, og kigger tilbage på tidligere aktivitet.

## Hvor du finder dem

| Side                                 | Hvad du ser                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Arbejdsgange → Kørsler og logs**   | Hver kørsel fra hvert workflow i projektet. Filtrér efter workflownavn, status og tid.                |
| **Arbejdsgang → Kørsler og logs**    | Kun kørslerne af dette ene workflow. Denne har et **Run ID**-filter i stedet for et workflow-filter.  |
| **En enkelt kørsel**                 | Åbnes med knappen **View Logs** på en kørselsrække — selve kørselsrækkerne kan ikke klikkes på.       |

## Kørselsstatusser

| Status                              | Hvad det betyder                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scheduled**                        | Triggeren udløstes, og kørslen står i kø til en runner. Normalt en brøkdel af et sekund. En kørsel, der stadig er Scheduled efter 5 minutter, er fejlet — ingen tog den. |
| **Running**                          | Workflowet er i gang. Langvarige blokke holder en kørsel i denne tilstand.                                                                                              |
| **Waiting**                          | Kørslen er parkeret på en **Sleep**-blok og genoptages af sig selv. Den optager ingen worker, mens den venter.                                                          |
| **Executed**                         | Kørslen nåede til enden uden at fejle. (Dette er succes-tilstanden — chippen viser **Executed**, ikke "Success".)                                                       |
| **Error**                            | Kørslen stoppede, fordi en blok kastede en fejl. Bruges også, når en kørsel i kø aldrig bliver taget, når en sovende kørsels genoptagelse går tabt, når et schedule-udtryk ikke kan opløses, eller når workflowet deaktiveres midt i en kørsel. |
| **Timeout**                          | Kørslen kørte længere end tilladt. Se [Konfiguration & sikkerhed](/docs/workflows/configuration).                                                                       |
| **Execution Exceeded Current Plan**  | Projektet har brugt sine workflow-kørsler for de sidste 30 dage, eller abonnementet er ubetalt. Kørslen registreres, men eksekveres ikke. Kun OneUptime Cloud.          |

En blok, der giver videre til sit **Error**-output — for eksempel en API-blok på en 4xx — får ikke kørslen til at fejle. Fejlgrenen kører, og kørslen ender stadig **Executed**. Selve trinnet tegnes dog stadig rødt, så du kan finde det.

## Læs en kørsel

Klik på **View Logs** på en kørsel for at åbne den. Visningen **Workflow Run** har to faner.

**Steps** — én række pr. blok, der kørte, i rækkefølge. Hver række viser blokkens titel, dens component id, hvor lang tid den tog, og det output, den forlod med (`→ success`, `→ error`, `→ yes`). Udvid en række for to blokke af detaljer:

- **Received** — de indstillinger, blokken fik, efter alle variabler var opløst.
- **Returned** — det, den producerede.

Fejlede trin er røde og starter udvidet, med fejlmeddelelsen printet over **Received**.

**Full Log** — den rå, linje-for-linje log, runneren printede, inklusive alt, blokkene selv loggede. Brug den, når Steps-visningen ikke forklarer fejlen.

To detaljer værd at kende. Component id'et printet under hver trin-titel er præcis den streng, du skal indsætte i en `{{local.components.<id>.returnValues.…}}`-reference, hvilket gør dette til den hurtigste måde at få en reference rigtig på. Og en kørsel beholder kun sine sidste 100 trin — en lang eller gentagne gange genoptaget kørsel viser en gul note, hvor de tidligere blev droppet.

De viste værdier er, hvad blokken så, efter variabler blev udfyldt, med to undtagelser: hemmeligheder og felter, blokken markerer som følsomme, er skjult, og meget lange værdier afkortes med "… (truncated)".

Starter du en kørsel fra **Builder**, åbnes denne samme visning, allerede i gang med at følge kørslen, så du kan se den ske i stedet for at lede efter den bagefter.

## Almindelig fejlfinding

### "Mit workflow kørte ikke."

1. Sørg for, at workflowet er **Enabled** på sin **Overview**-side. Nye workflows starter deaktiverede, og et deaktiveret workflow afviser enhver kørsel — også manuelle.
2. For en OneUptime event-trigger: bekræft, at eventen faktisk skete. Åbn posten og tjek dens historik.
3. For en webhook-trigger: bekræft, at det andet system sender til den rigtige URL. De fleste værktøjer logger, når de sender en webhook — tjek der.
4. For en schedule-trigger: bekræft, at cron-udtrykket matcher det tidspunkt, du forventer.

Hvis kørslen *dukker op* med statussen **Execution Exceeded Current Plan**, har projektet brugt alle sine workflow-kørsler for de sidste 30 dage, eller abonnementet er ubetalt. Kørslens log navngiver antallet og din plans grænse. Dette gælder kun OneUptime Cloud.

### "En senere blok kørte aldrig."

En blok, der ikke kører, er som regel et koblingsproblem. Åbn **Builder** og tjek:

- Er den tidligere bloks output forbundet til denne bloks input?
- Tog den tidligere blok et andet output, end du forventede — **Error** i stedet for **Success**, eller **No** i stedet for **Yes**? Steps-fanen viser, hvilken der blev taget.

### "En variabel kom igennem tom."

Åbn kørslen, og kig på det fejlende trins **Received**-blok.

- Hvis du ser den bogstavelige tekst `{{local.components.…}}`, blev referencen ikke løst op. Sædvanligvis er det en tastefejl i component id'et eller return-value id'et — husk, at det er blokkens **Identifier**, ikke navnet, der vises på den. Tjek også stavningen af selve `local.components`: `{{local.componets.api-get-1.returnValues.response-body}}` sendes som bogstavelig tekst, og kørslen rapporterer stadig **Executed**.
- Hvis du ser en tom streng, kørte den tidligere blok, men producerede ikke det felt.

Fanen **Full Log** bærer en advarselslinje, der navngiver enhver reference, der ikke blev løst op, hvilket sædvanligvis er den hurtigste måde at finde den på.

### "Det virker, når jeg kører det manuelt, men ikke fra triggeren."

Åbn **Builder**, klik **Run Workflow**, og udfyld triggerens felter med værdier, der ligner det, den rigtige trigger sender. Sammenlign så den kørsels **Received**-værdier med den rigtige kørsels, side om side. Forskellen er som regel et enkelt feltnavn eller en type.

## Genkør et workflow

Der er ingen "genkør denne kørsel"-knap. Vi genkører ikke gamle afviklinger automatisk, fordi sideeffekterne — Slack-beskeder, API-kald, tickets — måske ikke er sikre at gentage. For at gøre arbejdet om: ret workflowet, og lad den næste rigtige trigger udløse det, eller åbn **Builder**, og klik **Run Workflow** med de samme værdier.

## Hvor længe gemmes kørsler?

På OneUptime Cloud gemmes kørsler i **30 dage** og slettes derefter — det er derfor, begge kørselslister beskriver sig selv som dækkende de sidste 30 dage. Selv-hostede installationer beholder kørsler, indtil du sletter dem; hvis et workflow kører meget ofte og roder i din historik, så deaktivér eller slet det for at stoppe med at tilføje til støjen.

Kørsler registreret, før trin-sporing blev tilføjet, har intet **Steps**-indhold og viser kun deres **Full Log**.

## Læs videre

- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — timeouts, rekursionsgrænser, skjulte hemmeligheder.
- [Workflow-variabler](/docs/workflows/variables) — variabel-syntaksen brugt i dine blokke.
- [Workflow-komponenter](/docs/workflows/components) — hvad hver blok producerer.
