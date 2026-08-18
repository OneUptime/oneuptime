# Körningar & loggar

Varje gång ett arbetsflöde körs sparar OneUptime en post över vad som hände — när det kördes, om det fungerade, och vad varje block gjorde. Den posten kallas en **körning**. Körningar är hur du bekräftar att ett arbetsflöde fungerade, felsöker ett som inte gjorde det och tittar tillbaka på tidigare aktivitet.

## Var hittar du dem

| Sida                                    | Vad du ser                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Arbetsflöden → Körningar och loggar** | Varje körning från varje arbetsflöde i projektet. Filtrera på arbetsflödesnamn, status och tid.          |
| **Arbetsflöde → Körningar och loggar**  | Bara körningarna av detta enda arbetsflöde. Detta har ett **Run ID**-filter istället för ett arbetsflödesfilter. |
| **En enskild körning**                  | Öppnas med knappen **View Logs** på en körningsrad — körningsraderna själva går inte att klicka på.     |

## Körningsstatusar

| Status                                | Betydelse                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Schemalagd**                        | Utlösaren triggades och körningen köas för en runner. Vanligtvis en bråkdel av en sekund. En körning som fortfarande är schemalagd efter 5 minuter har misslyckats — ingen tog upp den. |
| **Körs**                              | Arbetsflödet pågår. Långkörande block håller en körning i detta läge.                                                                                             |
| **Väntar**                            | Körningen är parkerad på ett **Sleep**-block och återupptas av sig själv. Den upptar ingen worker medan den väntar.                                              |
| **Executed**                          | Körningen nådde slutet utan att misslyckas. (Detta är framgångstillståndet — pillen visar **Executed**, inte "Success".)                                        |
| **Fel**                               | Körningen stoppades eftersom ett block gav upphov till ett fel. Används också när en köad körning aldrig tas upp, när en sovande körnings återupptagande går förlorat, när ett schemaläggningsuttryck inte kan lösas, eller när arbetsflödet inaktiveras mitt under körningen. |
| **Timeout**                           | Körningen pågick längre än tillåtet. Se [Konfiguration & säkerhet](/docs/workflows/configuration).                                                               |
| **Execution Exceeded Current Plan**   | Projektet har förbrukat sina arbetsflödeskörningar för de senaste 30 dagarna, eller så är prenumerationen obetald. Körningen registreras men körs inte. Endast OneUptime Cloud. |

Ett block som lämnar över till sin **Error**-utdata — ett API-block vid en 4xx, till exempel — får inte körningen att misslyckas. Felgrenen körs och körningen slutar ändå som **Executed**. Själva steget ritas fortfarande i rött så att du kan hitta det.

## Läsa en körning

Klicka på **View Logs** på en körning för att öppna den. Vyn **Workflow Run** har två flikar.

**Steg** — en rad per block som kördes, i ordning. Varje rad visar blockets titel, dess komponent-id, hur lång tid det tog och utdatan det lämnade genom (`→ success`, `→ error`, `→ yes`). Expandera en rad för två block med detaljer:

- **Received** — inställningarna blocket fick, efter att alla variabler lösts upp.
- **Returned** — vad det producerade.

Misslyckade steg är röda och startar expanderade, med felmeddelandet utskrivet ovanför **Received**.

**Full Log** — den råa, rad-för-rad-loggen som runnern skrev ut, inklusive allt blocken själva loggade. Använd den när Steg-vyn inte förklarar felet.

Två detaljer värda att känna till. Komponent-id:t som skrivs ut under varje stegs titel är exakt strängen att klistra in i en `{{local.components.<id>.returnValues.…}}`-referens, vilket gör detta till det snabbaste sättet att få en referens rätt. Och en körning behåller bara sina senaste 100 steg — en lång eller upprepat återupptagen körning visar en gul notering där de tidigare släpptes.

Värdena som visas är vad blocket såg efter att variabler fyllts i, med två undantag: hemligheter och fält blocket markerar som känsliga redigeras bort, och mycket långa värden kortas av med "… (truncated)".

Att starta en körning från **Builder** öppnar samma vy och följer redan körningen, så att du kan se den hända istället för att leta efter den efteråt.

## Vanlig felsökning

### "Mitt arbetsflöde kördes inte."

1. Kontrollera att arbetsflödet är **Enabled** på sin **Overview**-sida. Nya arbetsflöden startar inaktiverade, och ett inaktiverat arbetsflöde avvisar varje körning — inklusive manuella.
2. För en OneUptime-händelseutlösare: bekräfta att händelsen faktiskt inträffade. Öppna posten och kontrollera dess historik.
3. För en webhook-utlösare: bekräfta att det andra systemet skickar till rätt URL. De flesta verktyg loggar när de skickar en webhook — kolla där.
4. För en schemaläggningsutlösare: bekräfta att cron-uttrycket matchar den tid du förväntar dig.

Om körningen *faktiskt* dyker upp med statusen **Execution Exceeded Current Plan** har projektet förbrukat alla sina arbetsflödeskörningar för de senaste 30 dagarna, eller så är prenumerationen obetald. Körningens logg anger antalet och din plans gräns. Detta gäller endast OneUptime Cloud.

### "Ett senare block kördes aldrig."

Ett block som inte körs är vanligtvis ett kopplingsproblem. Öppna **Builder** och kontrollera:

- Är det tidigare blockets utdata kopplad till detta blocks indata?
- Tog det tidigare blocket en annan utdata än du förväntade dig — **Error** istället för **Success**, eller **No** istället för **Yes**? Fliken Steg visar vilken det tog.

### "En variabel kom igenom tom."

Öppna körningen och titta på det misslyckade stegets **Received**-block.

- Om du ser den bokstavliga texten `{{local.components.…}}` löstes inte referensen. Vanligtvis är det ett stavfel i komponent-id:t eller returvärdes-id:t — kom ihåg att det är blockets **Identifier**, inte namnet som visas på det. Kontrollera stavningen av `local.components` självt också: `{{local.componets.api-get-1.returnValues.response-body}}` skickas som bokstavlig text och körningen rapporterar ändå **Executed**.
- Om du ser en tom sträng kördes det tidigare blocket men producerade inte det fältet.

Fliken **Full Log** bär en varningsrad som namnger varje referens som inte löstes, vilket vanligtvis är det snabbaste sättet att hitta den.

### "Det fungerar när jag kör det för hand men inte från utlösaren."

Öppna **Builder**, klicka på **Run Workflow**, och fyll i utlösarens fält med värden som liknar det den riktiga utlösaren skickar. Jämför sedan den körningens **Received**-värden med den riktiga körningens, sida vid sida. Skillnaden är oftast ett enda fältnamn eller en typ.

## Köra ett arbetsflöde igen

Det finns ingen "kör om denna körning"-knapp. Vi kör inte gamla exekveringar igen automatiskt eftersom sidoeffekterna — Slack-meddelanden, API-anrop, ärenden — kanske inte är säkra att upprepa. För att göra om arbetet, åtgärda arbetsflödet och låt nästa riktiga utlösare trigga det, eller öppna **Builder** och klicka på **Run Workflow** med samma värden.

## Hur länge sparas körningar?

På OneUptime Cloud sparas körningar i **30 dagar** och raderas sedan — det är därför båda körningslistorna beskriver sig själva som att täcka de senaste 30 dagarna. Självhostade installationer behåller körningar tills du raderar dem; om ett arbetsflöde körs väldigt ofta och skräpar ner din historik, inaktivera eller radera det för att sluta lägga till bruset.

Körningar som registrerades innan stegspårning lades till har inget **Steg**-innehåll och visar bara sin **Full Log**.

## Läs vidare

- [Konfiguration & säkerhet](/docs/workflows/configuration) — timeouts, rekursionsgränser, dolda hemligheter.
- [Variabler](/docs/workflows/variables) — variabelsyntaxen som används i dina block.
- [Komponenter](/docs/workflows/components) — vad varje block producerar.
