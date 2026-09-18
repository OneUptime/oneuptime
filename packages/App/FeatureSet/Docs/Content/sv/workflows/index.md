# Översikt över arbetsflöden

Arbetsflöden låter dig automatisera uppgifter i OneUptime utan att skriva kod. Lägg några block på en arbetsyta, koppla ihop dem, och du har automation som körs så fort något händer — en incident öppnas, ett schema löser ut, eller ett annat verktyg skickar data till OneUptime.

Tänk på arbetsflöden som hjälpredor i bakgrunden för ditt projekt: de reagerar på händelser, pratar med andra verktyg och håller tyst och stilla saker i synk medan du fokuserar på ditt arbete.

## Vad du kan göra med arbetsflöden

- **Koppla OneUptime till era andra verktyg** — skicka incidenter till Slack, skapa Jira-ärenden, posta till en webhook i er stack.
- **Reagera på det som händer i OneUptime** — när en kritisk incident skapas, avisera jourteamet och öppna ett ärende automatiskt.
- **Kör jobb på schema** — var femte minut, varje natt, varje måndagsmorgon.
- **Ta emot data utifrån** — låt andra system skicka in data till OneUptime via en unik URL.
- **Återanvänd vanlig automation** — bygg den en gång, anropa den från vilket annat arbetsflöde som helst.

## Så fungerar ett arbetsflöde

Varje arbetsflöde har tre delar:

1. **En utlösare** — det som startar arbetsflödet. Det kan vara en manuell knapp, ett schema, en inkommande webhook eller en händelse i OneUptime (som en ny incident).
2. **En eller flera komponenter** — det arbetsflödet gör. Skicka ett meddelande, göra ett HTTP-anrop, köra en snabb kontroll, förgrena utifrån ett villkor.
3. **Kopplingar mellan dem** — du drar linjer från ett block till nästa för att bestämma ordningen.

Allt det här bygger du visuellt på en arbetsyta. Ingen kodning krävs för de flesta arbetsflöden, men du kan lägga in en snutt JavaScript när du behöver.

## Nyckelbegrepp

| Begrepp             | Vad det betyder                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Arbetsflöde**     | Hela automationen — ett namn, en arbetsyta och en växel för att slå på eller av den.        |
| **Utlösare**        | Det första blocket. Det avgör när arbetsflödet körs. Varje arbetsflöde har exakt en utlösare. |
| **Komponent**       | Ett åtgärdsblock — skickar ett meddelande, gör en förfrågan, kontrollerar ett villkor.       |
| **Körning**         | En exekvering av arbetsflödet. Sparas med tidsstämplar och output från varje block.          |
| **Global variabel** | Ett värde (som en API-nyckel) som du sparar en gång och återanvänder i vilket arbetsflöde som helst. |

## Var du hittar arbetsflöden i OneUptime

Öppna **Arbetsflöden** i vänsternavigeringen. Den sektionen rymmer:

- **Arbetsflöden** — din lista över arbetsflöden. Skapa ett nytt eller öppna ett befintligt.
- **Globala variabler** — värden som delas mellan alla dina arbetsflöden.
- **Körningar och loggar** — körhistorik för varje arbetsflöde i projektet.

Öppnar du ett enskilt arbetsflöde rymmer dess egen vänstermeny:

- **Översikt** — namn, beskrivning, etiketter och växeln **Aktiverad**.
- **Byggare** — arbetsytan där du designar arbetsflödet.
- **Arbetsflödesvariabler** — värden som bara gäller det här enda arbetsflödet.
- **Körningar och loggar** — varje körning av det här arbetsflödet, med detaljer.
- **Inställningar** — webhook-hemlighet, duplicering och export.

## Bygg ditt första arbetsflöde

1. **Skapa** — välj en startpunkt och ge sedan arbetsflödet ett namn.
2. **Välj en utlösare** — manuell, schemalagd, webhook eller en händelse från OneUptime.
3. **Lägg till komponenter** — lägg åtgärder på arbetsytan och koppla ihop dem.
4. **Slå på det** — slå på **Aktiverad** från sidan **Översikt**. Ett inaktiverat arbetsflöde kan inte köras alls, inte ens för hand.
5. **Testa** — klicka på **Kör arbetsflöde** i Byggaren och följ körloggen.

## Ett snabbt exempel

Säg att du vill posta i Slack varje gång en kritisk incident skapas:

1. Skapa ett arbetsflöde som heter "Kritiska incidenter till Slack."
2. Välj utlösaren **On Create Incident**.
3. Lägg till ett **If / Else**-block. Ställ in det på att kontrollera om incidentens titel innehåller "Sev 1."
4. Från grenen **Yes**, lägg till ett **Slack**-block. Välj kanalen och skriv meddelandet.
5. Slå på arbetsflödet.

Nästa gång någon öppnar en incident med "Sev 1" i titeln lyser Slack upp.

## Hur arbetsflöden passar ihop med resten av OneUptime

- **Monitorer** upptäcker problemet. **Incidenter** dokumenterar det. **Arbetsflöden** reagerar på det.
- **Runbooks** är steg-för-steg-guider för människor. Arbetsflöden är obevakad automation. Använd ett runbook när en människa behöver fatta beslut; använd ett arbetsflöde när stegen är automatiska.
- **Arbetsyteanslutningar** (Slack, Teams) är dit arbetsflöden skickar sina meddelanden.

## Läs vidare

- [Skapa ett arbetsflöde](/docs/workflows/authoring) — att bygga på arbetsytan.
- [Arbetsflödesutlösare](/docs/workflows/triggers) — de olika sätten ett arbetsflöde kan starta på.
- [Arbetsflödeskomponenter](/docs/workflows/components) — byggstenarna du kan lägga till.
- [Arbetsflödesvariabler](/docs/workflows/variables) — att använda värden mellan block och arbetsflöden.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — att kontrollera vad som hände.
- [Arbetsflödeskonfiguration & säkerhet](/docs/workflows/configuration) — inställningar värda att känna till.
