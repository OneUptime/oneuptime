# Körningar & loggar

Varje gång ett arbetsflödes utlösare triggas skapar OneUptime en **körning** — en post över en exekvering med tidsåtgång, status och utdata per nod. Körningar är hur du bekräftar att ett arbetsflöde fungerade, hur du felsöker ett som inte gjorde det och hur du skriver en post-mortem när en automation missköter sig.

## Var hittar du dem

| Sida | Omfattning |
| --- | --- |
| **Workflows → Runs & Logs** | Projektomfattande. Varje körning av varje arbetsflöde. Filtrera efter arbetsflöde, status och tidsintervall. |
| **Ett arbetsflödes Logs-flik** | Bara körningarna av detta arbetsflöde. |
| **En körnings detaljsida** | En exekvering, utökad med utdata per nod och eventuella felmeddelanden. |

## Körningsstatusar

| Status | Betydelse |
| --- | --- |
| **Scheduled** | Utlösaren triggades och körningen är köad, men workern har inte plockat upp den ännu. Vanligtvis en bråkdel av en sekund. |
| **Running** | Workern går för närvarande igenom grafen. Långkörande komponenter (långsamma HTTP-anrop, avsiktliga fördröjningar) håller en körning i detta tillstånd. |
| **Success** | Varje nod som körts avslutades utan fel. (Ett arbetsflöde som avsiktligt tog en `error`-gren är fortfarande `Success` totalt sett — själva arbetsflödet misslyckades inte.) |
| **Error** | En nod misslyckades och det fanns ingen `error`-port kopplad för att hantera den. Körningen stannade vid den noden. |
| **Timeout** | Körningen överskred timeouten per körning. Se [Konfiguration & säkerhet](/docs/workflows/configuration). |

## Läsa en körning

Klicka på en körning från listan för att öppna dess detaljsida. Du ser:

- **Header** — utlösaren som triggades, start- och sluttidsstämpel, total varaktighet, status.
- **Nodlista** — varje nod som exekverades i ordning, var och en med sina fångade argument, sitt returvärde och sin valda utgångsport.
- **Fel** — om en nod misslyckades, felmeddelandet och (när tillgängligt) stack trace.

De fångade argumenten visar värden *efter interpolation* — det vill säga de exakta strängar som noden såg efter att variabler löstes upp. Det här är den enskilt mest användbara felsökningsvyn: om ett Slack-meddelande har den bokstavliga texten `{{Incident.title}}` i sig, vet du att variabelreferensen inte löstes upp.

## Vanliga felsökningsmönster

### "Mitt arbetsflöde triggades inte."

1. Bekräfta att arbetsflödet är **aktiverat** i **Settings**. Nya arbetsflöden levereras inaktiverade.
2. För en modellhändelse-utlösare: bekräfta att händelsen faktiskt inträffade. Öppna entiteten (incidenten, larmet, monitorn) och titta på dess historik.
3. För en webhook-utlösare: bekräfta att det externa systemet träffar rätt URL. Många verktyg loggar utgående webhook-leverans — kontrollera där.
4. För en schemautlösare: bekräfta att cron-uttrycket utvärderas till den tid du förväntar dig. Använd en cron-parser om du är osäker.

Om utlösaren triggades men ingen körning dyker upp, kontrollera projektets körningskvot under **Project Settings → Billing**.

### "Det körs men en nedströmsnod kör aldrig."

En nod som inte körs är oftast ett kopplingsproblem. Öppna arbetsytan och kontrollera:

- Är uppströmsnodens utgångsport faktiskt kopplad till denna nods ingångsport?
- Tog uppströmsnoden en annan port (t.ex. `error` istället för `success`, eller `no` istället för `yes`)? Titta på körningsdetaljen för att se vilken port den valde.

### "En variabel kommer igenom tom."

Öppna körningsdetaljen och titta på den misslyckande nodens fångade argument. Om du ser den bokstavliga `{{NodeId.field}}`-texten löstes inte referensen upp — troligen ett stavfel i `NodeId` eller `field`. Om du ser en tom sträng körde uppströmsnoden men producerade inte det fältet.

### "Det fungerar manuellt men inte från utlösaren."

Använd **Run Manually** med en JSON-payload som speglar vad den riktiga utlösaren publicerar. Jämför sedan de fångade argumenten i den manuella körningen med produktionskörningen sida vid sida — skillnaden ligger oftast i ett enskilt fältnamn eller typ.

## Köra om ett arbetsflöde

Det finns ingen "försök igen denna körning"-knapp — det är medvetet, OneUptime kör aldrig om en gammal körning, eftersom de utgående sidoeffekterna (Slack-meddelanden, API-anrop) kanske inte är idempotenta. Om du vill göra om arbetet, fixa arbetsflödet och låt nästa riktiga utlösare trigga det.

För manuella arbetsflöden, klicka bara på **Run Manually** med samma payload.

## Loggretention

Körningar bevaras på obestämd tid på projektet. Om du behöver städa upp högvolymsbrusiga arbetsflöden (t.ex. ett felsökningsarbetsflöde som triggas varje minut), inaktivera eller ta bort dem — det finns ingen växel för retention per arbetsflöde.

## Var läsa vidare

- [Konfiguration & säkerhet](/docs/workflows/configuration) — timeouts, rekursionsgränser, redaktion av hemligheter.
- [Variabler](/docs/workflows/variables) — syntaxen som interpolerade argument använder.
- [Komponenter](/docs/workflows/components) — returvärdesfälten som varje komponent publicerar.
