# Körningar och loggar

Varje gång ett arbetsflöde körs sparar OneUptime en redogörelse för vad som hände — när det kördes, om det fungerade och vad varje block gjorde. Den redogörelsen kallas en **körning**. Körningar är hur du bekräftar att ett arbetsflöde fungerade, felsöker ett som inte gjorde det och tittar tillbaka på tidigare aktivitet.

## Var du hittar dem

| Sida                        | Vad du ser                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Arbetsflöden → Körningar och loggar** | Varje körning av varje arbetsflöde i projektet. Filtrera på arbetsflödesnamn, status och tid.  |
| **Arbetsflöde → Körningar och loggar**  | Bara körningarna för det här enda arbetsflödet. Den här har ett **Körnings-ID**-filter istället för ett arbetsflödesfilter. |
| **En enskild körning**      | Öppnas med knappen **Visa loggar** på en körningsrad — raderna i sig går inte att klicka på.        |

## Körningsstatusar

| Status                             | Vad den betyder                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                      | Utlösaren har utlösts och körningen står i kö för en körmotor. Oftast en bråkdel av en sekund. En körning som fortfarande är schemalagd efter 5 minuter räknas som misslyckad — ingen plockade upp den. |
| **Running**                        | Arbetsflödet pågår. Långsamma block håller kvar en körning i det här tillståndet.                                                                          |
| **Waiting**                        | Körningen står parkerad på ett **Sleep**-block och återupptas av sig själv. Den håller ingen worker upptagen under tiden.                                  |
| **Executed**                       | Körningen nådde slutet utan att misslyckas. (Det här är lyckat-tillståndet — etiketten säger **Executed**, inte "Success".)                               |
| **Error**                          | Körningen stannade för att ett block gav ett fel. Används också när en köad körning aldrig plockas upp, när en sovande körnings återupptagning tappas bort, när ett schemauttryck inte kan tolkas, eller när arbetsflödet inaktiveras mitt i körningen. |
| **Timeout**                        | Körningen pågick längre än tillåtet. Se [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration).                                             |
| **Execution Exceeded Current Plan** | Projektet har förbrukat sina arbetsflödeskörningar för de senaste 30 dagarna, eller så är prenumerationen obetald. Körningen registreras men körs inte. Endast OneUptime Cloud. |

Ett block som lämnar över till sin **Error**-utgång — säg ett API-block på en 4xx — får inte körningen att misslyckas. Felgrenen körs och körningen slutar ändå som **Executed**. Själva steget ritas fortfarande i rött så att du hittar det.

## Läsa en körning

Klicka på **Visa loggar** på en körning för att öppna den. Vyn **Workflow Run** har två flikar.

**Steps** — en rad per block som kördes, i ordning. Varje rad visar blockets titel, dess komponent-id, hur lång tid det tog och vilken utgång det lämnade via (`→ success`, `→ error`, `→ yes`). Fäll ut en rad för två block med detaljer:

- **Received** — inställningarna blocket fick, efter att alla variabler lösts upp.
- **Returned** — vad det producerade.

Misslyckade steg är röda och är utfällda från början, med felmeddelandet utskrivet ovanför **Received**.

**Full Log** — den råa rad-för-rad-loggen som körmotorn skrev ut, inklusive allt blocken själva loggade. Använd den när Steps-vyn inte förklarar felet.

Två detaljer värda att känna till. Komponent-id:t som skrivs ut under varje stegtitel är exakt den sträng du ska klistra in i en `{{local.components.<id>.returnValues.…}}`-referens, vilket gör det här till snabbaste sättet att få en referens rätt. Och en körning behåller bara sina 100 senaste steg — en lång eller upprepat återupptagen körning visar en gul notis där de tidigare stegen föll bort.

Värdena som visas är vad blocket såg efter att variablerna fyllts i, med två undantag: hemligheter och fält som blocket markerar som känsliga maskeras, och mycket långa värden kapas med "… (truncated)".

Att starta en körning från **Byggare** öppnar samma vy, redan inställd på att följa körningen, så att du kan se det hända istället för att leta upp det efteråt.

## Vanlig felsökning

### "Mitt arbetsflöde kördes inte."

1. Kontrollera att arbetsflödet är **Aktiverad** på sin sida **Översikt**. Nya arbetsflöden startar inaktiverade, och ett inaktiverat arbetsflöde avvisar varje körning — även manuella.
2. För en OneUptime-händelseutlösare: bekräfta att händelsen verkligen inträffade. Öppna posten och kontrollera dess historik.
3. För en webhook-utlösare: bekräfta att det andra systemet skickar till rätt URL. De flesta verktyg loggar när de skickar en webhook — kolla där.
4. För en schemautlösare: bekräfta att cron-uttrycket matchar tiden du förväntar dig.

Om körningen *visas* med statusen **Execution Exceeded Current Plan** har projektet förbrukat alla sina arbetsflödeskörningar för de senaste 30 dagarna, eller så är prenumerationen obetald. Körningens logg anger antalet och din plans gräns. Det här gäller bara OneUptime Cloud.

### "Ett senare block kördes aldrig."

Ett block som inte körs beror oftast på hur det är kopplat. Öppna **Byggare** och kontrollera:

- Är det tidigare blockets utgång kopplad till det här blockets ingång?
- Tog det tidigare blocket en annan utgång än du förväntade dig — **Error** istället för **Success**, eller **No** istället för **Yes**? Fliken Steps visar vilken det tog.

### "En variabel kom in tom."

Öppna körningen och titta på det misslyckade stegets **Received**-block.

- Ser du den bokstavliga texten `{{local.components.…}}` löstes referensen inte upp. Oftast är det ett stavfel i komponent-id:t eller returvärdes-id:t — kom ihåg att det är blockets **Identifier**, inte namnet som visas på det. Kontrollera stavningen av `local.components` också: `{{local.componets.api-get-1.returnValues.response-body}}` skickas som ren text och körningen rapporteras ändå som **Executed**.
- Ser du en tom sträng kördes det tidigare blocket, men det producerade inte det fältet.

Fliken **Full Log** innehåller en varningsrad som namnger varje referens som inte löstes upp, vilket oftast är snabbaste sättet att hitta den.

### "Det fungerar när jag kör det för hand men inte från utlösaren."

Öppna **Byggare**, klicka på **Kör arbetsflöde** och fyll utlösarens fält med värden som liknar det den riktiga utlösaren skickar. Jämför sedan den körningens **Received**-värden med den riktiga körningens, sida vid sida. Skillnaden är oftast ett enda fältnamn eller en typ.

## Köra om ett arbetsflöde

Det finns ingen "försök igen"-knapp. Vi kör inte om gamla exekveringar automatiskt eftersom sidoeffekterna — Slack-meddelanden, API-anrop, ärenden — kanske inte är säkra att upprepa. För att göra om arbetet, rätta arbetsflödet och låt nästa riktiga utlösning köra det, eller öppna **Byggare** och klicka på **Kör arbetsflöde** med samma värden.

## Hur länge sparas körningar?

På OneUptime Cloud sparas körningar i **30 dagar** och tas sedan bort — det är därför båda körningslistorna beskriver sig själva som att de täcker de senaste 30 dagarna. Självhostade installationer behåller körningar tills du tar bort dem; om ett arbetsflöde körs väldigt ofta och skräpar ner din historik, inaktivera eller ta bort det för att sluta bidra till bruset.

Körningar som registrerades innan stegspårning fanns har inget **Steps**-innehåll och visar bara sin **Full Log**.

## Läs vidare

- [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration) — timeouts, rekursionsgränser, dolda hemligheter.
- [Arbetsflödesvariabler](/docs/workflows/variables) — variabelsyntaxen du använder i dina block.
- [Arbetsflödeskomponenter](/docs/workflows/components) — vad varje block producerar.
