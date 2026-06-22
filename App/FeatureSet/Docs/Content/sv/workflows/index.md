# Översikt över arbetsflöden

Arbetsflöden låter dig automatisera uppgifter i OneUptime utan att skriva kod. Dra och släpp några block på en arbetsyta, koppla ihop dem, och du har en automation som körs så snart något händer — en incident öppnas, ett schema utlöses eller ett annat verktyg skickar data till OneUptime.

Tänk på arbetsflöden som hjälpredor i bakgrunden för ditt projekt: de reagerar på händelser, pratar med andra verktyg och håller saker synkroniserade i tysthet medan du fokuserar på ditt arbete.

## Vad du kan göra med arbetsflöden

- **Koppla OneUptime till dina andra verktyg** — skicka incidenter till Slack, skapa Jira-ärenden, posta till en webhook i din stack.
- **Reagera på vad som händer i OneUptime** — när en kritisk incident skapas, meddela jourteamet och öppna ett ärende automatiskt.
- **Kör jobb enligt ett schema** — var femte minut, varje natt, varje måndag morgon.
- **Ta emot data utifrån** — låt andra system skicka in data till OneUptime via en unik URL.
- **Återanvänd vanlig automation** — bygg den en gång, anropa den från vilket annat arbetsflöde som helst.

## Hur ett arbetsflöde fungerar

Varje arbetsflöde har tre delar:

1. **En utlösare** — vad som startar arbetsflödet. Det kan vara en manuell knapp, ett schema, en inkommande webhook eller en händelse i OneUptime (som en ny incident).
2. **En eller flera komponenter** — vad arbetsflödet gör. Skicka ett meddelande, gör ett HTTP-anrop, kör en snabb kontroll, förgrena dig baserat på ett villkor.
3. **Kopplingar mellan dem** — du drar linjer från ett block till nästa för att bestämma ordningen.

Du bygger allt detta visuellt på en arbetsyta. Ingen kodning krävs för de flesta arbetsflöden, men du kan släppa in en snutt JavaScript när du behöver det.

## Nyckelbegrepp

| Term                | Betydelse                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Arbetsflöde**     | Hela automationen — ett namn, en arbetsyta och en växel för att slå på eller av den.                 |
| **Utlösare**        | Det första blocket. Det bestämmer när arbetsflödet körs. Varje arbetsflöde har exakt en utlösare.    |
| **Komponent**       | Ett åtgärdsblock — skickar ett meddelande, gör en förfrågan, kontrollerar ett villkor.               |
| **Körning**         | En exekvering av arbetsflödet. Sparas med tidsstämplar och utdata från varje block.                  |
| **Global variabel** | Ett värde (som en API-nyckel) som du sparar en gång och återanvänder i vilket arbetsflöde som helst. |

## Var du hittar arbetsflöden i OneUptime

Öppna **Workflows** i den vänstra navigeringen. Därifrån:

- **Workflows** — din lista över arbetsflöden. Skapa ett nytt eller öppna ett befintligt.
- **Builder-flik** — arbetsytan där du designar arbetsflödet.
- **Logs-flik** — varje körning av detta arbetsflöde, med detaljer.
- **Settings-flik** — namn, beskrivning, ägare, etiketter, aktivera/inaktivera.
- **Global Variables** — värden som delas mellan alla dina arbetsflöden.
- **Runs & Logs** — exekveringshistorik över varje arbetsflöde i ditt projekt.

## Bygga ditt första arbetsflöde

1. **Skapa** — ge ditt arbetsflöde ett namn och en kort beskrivning.
2. **Välj en utlösare** — manuell, schemalagd, webhook eller en händelse från OneUptime.
3. **Lägg till komponenter** — dra åtgärder till arbetsytan och koppla ihop dem.
4. **Testa** — klicka på **Run Manually** och se vad som händer i loggarna.
5. **Slå på det** — slå på **Enabled**-växeln i Settings när du är redo.

## Ett snabbt exempel

Säg att du vill posta i Slack varje gång en kritisk incident skapas:

1. Skapa ett arbetsflöde som heter "Kritiska incidenter till Slack."
2. Välj utlösaren **Incident → On Create**.
3. Lägg till ett **Conditions**-block. Ställ in det så att det kontrollerar om incidentens titel innehåller "Sev 1."
4. Från grenen **Yes**, lägg till ett **Slack**-block. Välj kanalen och skriv meddelandet.
5. Slå på arbetsflödet.

Nästa gång någon öppnar en incident med "Sev 1" i titeln, lyser Slack upp.

## Hur arbetsflöden passar in med resten av OneUptime

- **Monitorer** upptäcker problemet. **Incidenter** registrerar det. **Arbetsflöden** reagerar på det.
- **Runbooks** är steg-för-steg-guider för människor. Arbetsflöden är obevakad automation. Använd en runbook när en människa behöver fatta beslut; använd ett arbetsflöde när stegen är automatiska.
- **Workspace connections** (Slack, Teams) är dit arbetsflöden skickar sina meddelanden.

## Läs vidare

- [Skapa ett arbetsflöde](/docs/workflows/authoring) — bygga på arbetsytan.
- [Utlösare](/docs/workflows/triggers) — de olika sätten ett arbetsflöde kan starta på.
- [Komponenter](/docs/workflows/components) — byggstenarna du kan lägga till.
- [Variabler](/docs/workflows/variables) — använda värden mellan block och arbetsflöden.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad som hände.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — inställningar värda att känna till.
