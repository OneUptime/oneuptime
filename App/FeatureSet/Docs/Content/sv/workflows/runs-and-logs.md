# Körningar & loggar

Varje gång ett arbetsflöde körs sparar OneUptime en post över vad som hände — när det kördes, om det fungerade, och vad varje block gjorde. Den posten kallas en **körning**. Körningar är hur du bekräftar att ett arbetsflöde fungerade, felsöker ett som inte gjorde det och tittar tillbaka på tidigare aktivitet.

## Var hittar du dem

| Sida                        | Vad du ser                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| **Workflows → Runs & Logs** | Varje körning från varje arbetsflöde i projektet. Filtrera på arbetsflöde, status och tid. |
| **Workflow → Logs-fliken**  | Bara körningarna av detta enda arbetsflöde.                                                |
| **En enskild körning**      | En exekvering, med utdata från varje block.                                                |

## Körningsstatusar

| Status        | Betydelse                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled** | Utlösaren triggades och körningen ska just börja. Tar oftast bara en bråkdel av en sekund.                                                                |
| **Running**   | Arbetsflödet pågår. Långkörande block håller en körning i detta läge.                                                                                     |
| **Success**   | Varje block som kördes avslutades utan fel. (Att avsiktligt ta en **error**-gren räknas fortfarande som success — själva arbetsflödet misslyckades inte.) |
| **Error**     | Ett block misslyckades och det fanns ingen **error**-väg kopplad för att hantera det. Körningen stannade där.                                             |
| **Timeout**   | Körningen pågick längre än tillåtet. Se [Konfiguration & säkerhet](/docs/workflows/configuration).                                                        |

## Läsa en körning

Klicka på vilken körning som helst för att öppna detaljerna. Du ser:

- **Header** — utlösaren, start- och sluttid, total tidsåtgång och status.
- **Block list** — varje block som kördes, i ordning. Var och en visar värdena det fick, dess utdata och vilken väg det tog.
- **Errors** — om ett block misslyckades, felmeddelandet och (när det är tillgängligt) mer detaljer.

Värdena som visas är exakt vad blocket såg — efter att alla variabler fyllts i. Detta är den enskilt mest användbara felsökningsvyn: om ett Slack-meddelande visar den bokstavliga texten `{{Incident.title}}` istället för den faktiska titeln, vet du att variabeln inte löstes.

## Vanlig felsökning

### "Mitt arbetsflöde kördes inte."

1. Kontrollera att arbetsflödet är **enabled** i Settings. Nya arbetsflöden börjar inaktiverade.
2. För en OneUptime-händelseutlösare: bekräfta att händelsen faktiskt inträffade. Öppna posten och kontrollera dess historik.
3. För en webhook-utlösare: bekräfta att det andra systemet skickar till rätt URL. De flesta verktyg loggar när de skickar en webhook — kolla där.
4. För en schemaläggningsutlösare: bekräfta att cron-uttrycket matchar den tid du förväntar dig.

Om utlösaren triggades men ingen körning dyker upp, kolla din körningskvot under **Project Settings → Billing**.

### "Ett senare block kördes aldrig."

Ett block som inte körs är vanligtvis ett kopplingsproblem. Öppna arbetsytan och kontrollera:

- Är det tidigare blockets utdata kopplad till detta blocks indata?
- Tog det tidigare blocket en annan utdata än du förväntade dig (till exempel **error** istället för **success**, eller **No** istället för **Yes**)? Körningsdetaljen visar vilken väg som togs.

### "En variabel kom igenom tom."

Öppna körningen och titta på det misslyckade blockets värden.

- Om du ser den bokstavliga texten `{{BlockName.field}}` löstes inte referensen — sannolikt ett stavfel i blockets namn eller fältnamnet.
- Om du ser en tom sträng kördes det tidigare blocket men producerade inte det fältet.

### "Det fungerar när jag kör det manuellt men inte från utlösaren."

Använd **Run Manually** med en JSON-payload som ser ut som det den riktiga utlösaren skickar. Jämför sedan värdena i den manuella körningen med den riktiga körningen sida vid sida. Skillnaden är oftast ett enda fältnamn eller en typ.

## Köra ett arbetsflöde igen

Det finns ingen "kör om denna körning"-knapp. Vi kör inte gamla exekveringar igen automatiskt eftersom sidoeffekterna (Slack-meddelanden, API-anrop, ärenden) kanske inte är säkra att upprepa. För att göra om arbetet, åtgärda arbetsflödet och låt nästa riktiga utlösare trigga det.

För manuella arbetsflöden, klicka helt enkelt på **Run Manually** med samma payload.

## Hur länge sparas körningar?

Körningar sparas obegränsat för projektet. Om ett arbetsflöde körs väldigt ofta och skräpar ner din historik (som ett felsökningsarbetsflöde som triggas varje minut), inaktivera eller radera det för att sluta lägga till bruset.

## Läs vidare

- [Konfiguration & säkerhet](/docs/workflows/configuration) — timeouts, rekursionsgränser, dolda hemligheter.
- [Variabler](/docs/workflows/variables) — variabelsyntaxen som används i dina block.
- [Komponenter](/docs/workflows/components) — vad varje block producerar.
