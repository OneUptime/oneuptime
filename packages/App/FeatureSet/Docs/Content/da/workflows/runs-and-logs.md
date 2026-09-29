# Kørsler & logfiler

Hver gang et workflow kører, gemmer OneUptime en optegnelse over, hvad der skete — hvornår det kørte, om det lykkedes, og hvad hver blok gjorde. Den optegnelse kaldes en **kørsel**. Kørsler er dem, du bruger til at bekræfte, at et workflow virkede, til at fejlfinde et, der ikke gjorde, og til at se tilbage på tidligere aktivitet.

## Hvor du finder dem

| Side                                | Hvad du ser                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Arbejdsgange → Kørsler og logs**  | Alle kørsler fra alle workflows i projektet. Filtrér på workflownavn, status og tid.                 |
| **Arbejdsgang → Kørsler og logs**   | Kun kørslerne for dette ene workflow. Her er der et **Kørsels-ID**-filter i stedet for et workflowfilter. |
| **En enkelt kørsel**                | Åbnes med knappen **Vis logge** på en kørselsrække — selve rækkerne kan man ikke klikke på.           |

## Kørselsstatusser

| Status                              | Hvad det betyder                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Planlagt**                        | Triggeren fyrede, og kørslen står i kø til en runner. Som regel et splitsekund. En kørsel, der stadig er planlagt efter 5 minutter, er fejlet — ingen tog den. |
| **Kører**                           | Workflowet er i gang. Blokke, der tager lang tid, holder en kørsel i denne tilstand.                                                                      |
| **Venter**                          | Kørslen er parkeret på en **Sleep**-blok og fortsætter af sig selv. Den optager ingen worker imens.                                                       |
| **Executed**                        | Kørslen nåede til enden uden at fejle. (Det er succes-tilstanden — pillen siger **Executed**, ikke "Success".)                                            |
| **Fejl**                            | Kørslen stoppede, fordi en blok rejste en fejl. Bruges også, når en kørsel i kø aldrig bliver taget, når genoptagelsen af en sovende kørsel går tabt, når et tidsplansudtryk ikke kan opløses, eller når workflowet bliver deaktiveret midt i kørslen. |
| **Timeout**                         | Kørslen kørte længere end tilladt. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration).                                                |
| **Execution Exceeded Current Plan** | Projektet har brugt sine workflowkørsler for de seneste 30 dage, eller abonnementet er ubetalt. Kørslen registreres, men udføres ikke. Kun OneUptime Cloud. |

En blok, der giver videre fra sit **Fejl**-output — en API-blok på et 4xx, for eksempel — får ikke kørslen til at fejle. Fejlgrenen kører, og kørslen ender stadig som **Executed**. Trinnet selv tegnes stadig rødt, så du kan finde det.

## Læs en kørsel

Klik **Vis logge** på en kørsel for at åbne den. Visningen **Workflow Run** har to faner.

**Trin** — én række pr. blok, der kørte, i rækkefølge. Hver række viser blokkens titel, dens komponent-id, hvor lang tid den tog, og hvilket output den forlod ved (`→ success`, `→ error`, `→ yes`). Fold en række ud for to blokke med detaljer:

- **Received** — de indstillinger, blokken fik, efter at alle variabler var opløst.
- **Returned** — det, den producerede.

Fejlede trin er røde og starter foldet ud, med fejlmeddelelsen skrevet over **Received**.

**Full Log** — den rå log linje for linje, som runneren skrev, inklusive alt det, blokkene selv loggede. Brug den, når **Trin** ikke forklarer fejlen.

To detaljer er værd at kende. Komponent-id'et, der står under hver trintitel, er præcis den streng, du skal sætte ind i en `{{local.components.<id>.returnValues.…}}`-henvisning, og det gør det her til den hurtigste vej til en korrekt henvisning. Og en kørsel gemmer kun sine sidste 100 trin — en lang eller gentagne gange genoptaget kørsel viser en gul note der, hvor de tidligere trin blev droppet.

De værdier, du ser, er dem, blokken så, efter at variablerne var fyldt ud, med to undtagelser: hemmeligheder og felter, blokken markerer som følsomme, er sløret, og meget lange værdier klippes af med "… (truncated)".

Starter du en kørsel fra **Bygger**, åbner den samme visning og følger allerede kørslen, så du kan se den ske i stedet for at lede efter den bagefter.

## Almindelig fejlfinding

### "Mit workflow kørte ikke."

1. Sikr dig, at workflowet er **Aktiveret** på siden **Oversigt**. Nye workflows starter deaktiveret, og et deaktiveret workflow afviser hver eneste kørsel — også de manuelle.
2. Ved en OneUptime-begivenhedstrigger: bekræft, at begivenheden rent faktisk skete. Åbn posten, og tjek dens historik.
3. Ved en webhook-trigger: bekræft, at det andet system sender til den rigtige URL. De fleste værktøjer logger, når de sender en webhook — kig der.
4. Ved en tidsplanstrigger: bekræft, at cron-udtrykket rammer det tidspunkt, du forventer.

Dukker kørslen *op* med statussen **Execution Exceeded Current Plan**, har projektet brugt alle sine workflowkørsler for de seneste 30 dage, eller abonnementet er ubetalt. Kørslens log nævner antallet og din plans grænse. Det gælder kun OneUptime Cloud.

### "En senere blok kørte aldrig."

En blok, der ikke kører, skyldes som regel forbindelserne. Åbn **Bygger**, og tjek:

- Er den tidligere bloks output forbundet til denne bloks input?
- Tog den tidligere blok et andet output, end du regnede med — **Fejl** i stedet for **Succes**, eller **Nej** i stedet for **Ja**? Fanen **Trin** viser, hvilket ét den tog.

### "En variabel kom tom igennem."

Åbn kørslen, og se på det fejlende trins **Received**-blok.

- Ser du den bogstavelige `{{local.components.…}}`-tekst, blev henvisningen ikke opløst. Som regel er det en tastefejl i komponent-id'et eller i returværdiens id — husk, at det er blokkens **Identifier**, ikke det navn, der vises på den. Tjek også stavningen af `local.components` selv: `{{local.componets.api-get-1.returnValues.response-body}}` sendes som bogstavelig tekst, og kørslen melder stadig **Executed**.
- Ser du en tom streng, kørte den tidligere blok, men producerede ikke det felt.

Fanen **Full Log** har en advarselslinje, der navngiver enhver henvisning, som ikke blev opløst, og det er som regel den hurtigste måde at finde den på.

### "Det virker, når jeg kører det i hånden, men ikke fra triggeren."

Åbn **Bygger**, klik **Kør arbejdsgang**, og udfyld triggerens felter med værdier, der ligner dem, den rigtige trigger sender. Sammenlign så den kørsels **Received**-værdier med den rigtige kørsels, side om side. Forskellen er som regel et enkelt feltnavn eller en type.

## Genkør et workflow

Der er ingen "kør denne kørsel igen"-knap. Vi genkører ikke gamle eksekveringer automatisk, fordi bivirkningerne — Slack-beskeder, API-kald, sager — ikke nødvendigvis er sikre at gentage. Vil du gøre arbejdet om, så ret workflowet, og lad den næste rigtige trigger fyre det af, eller åbn **Bygger** og klik **Kør arbejdsgang** med de samme værdier.

## Hvor længe gemmes kørsler?

På OneUptime Cloud gemmes kørsler i **30 dage** og slettes så — det er derfor, begge kørselslister beskriver sig selv som dækkende de seneste 30 dage. Selvhostede installationer gemmer kørsler, indtil du sletter dem; kører et workflow meget ofte og roder din historik til, så deaktivér eller slet det for at holde op med at lave støj.

Kørsler, der blev registreret, før trinsporing kom til, har intet indhold under **Trin** og viser kun deres **Full Log**.

## Hvor du kan læse videre

- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — timeouts, rekursionsgrænser, skjulte hemmeligheder.
- [Workflow-variabler](/docs/workflows/variables) — den variabelsyntaks, du bruger i dine blokke.
- [Workflow-komponenter](/docs/workflows/components) — hvad hver blok producerer.
