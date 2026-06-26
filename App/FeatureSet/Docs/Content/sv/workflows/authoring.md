# Skapa ett arbetsflöde

För att skapa ett arbetsflöde, öppna **Workflows → Create Workflow**, ge det ett namn och klicka in i fliken **Builder**. Du ser en tom arbetsyta där du bygger automationen.

## Arbetsytan

Builder är en arbetsyta för dra-och-släpp. Du lägger till block från paletten på sidan, kopplar ihop dem med linjer och klickar på varje block för att konfigurera vad det gör. Ändringar sparas automatiskt — du ser en indikator högst upp när de är sparade.

Varje arbetsflöde börjar med en **utlösare** i början. Allt annat är en **komponent** som gör något.

## Vad som finns på ett block

| Fält         | Funktion                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**    | Namnet som visas på arbetsytan. Byt namn för att göra komplexa arbetsflöden lättare att läsa.                                                               |
| **Settings** | Vad blocket behöver för att göra sitt jobb — en URL, en Slack-kanal, en meddelandetext osv. Obligatoriska fält är märkta med en asterisk.                   |
| **Input**    | Punkten till vänster där linjer kommer in från tidigare block.                                                                                              |
| **Outputs**  | Punkterna till höger där linjer går ut till nästa block. Många block har separata utgångar för **success** och **error** så att du kan hantera båda fallen. |

## Koppla ihop block

Dra från ett blocks utgångspunkt till nästa blocks ingångspunkt. Linjen du drar bestämmer vad som körs härnäst.

- Om du kopplar från **success** körs nästa block bara när det tidigare lyckades.
- Om du kopplar från **error** körs nästa block bara när det tidigare misslyckades.
- Om du inte kopplar en utgång stannar den vägen där.

Du kan koppla en utgång till flera block. De körs alla samtidigt från den punkten.

## Konfigurera ett block

Klicka på ett block för att öppna dess inställningar på sidan. Varje inställning har rätt typ av inmatning — textfält, rullgardinsmenyer, kodredigerare, växlar och så vidare.

De flesta textfält accepterar variabler — det är så data flödar från ett block till nästa. Se [Variabler](/docs/workflows/variables) för syntaxen.

## Ditt första arbetsflöde

Det snabbaste sättet att känna in arbetsytan:

1. Dra en **Manual**-utlösare till arbetsytan.
2. Dra en **Log**-komponent (under **Utils**) bredvid den. Koppla utlösaren till Log-komponenten.
3. I Log-blockets meddelandefält, skriv `Hello from {{Manual.JSON.name}}`.
4. Spara och slå på arbetsflödet.
5. Klicka på **Run Manually**, klistra in `{ "name": "Ada" }` som inmatning och skicka.
6. Öppna fliken **Logs**. Den senaste körningen visar `Hello from Ada`.

Den cykeln — dra, koppla, konfigurera, kör, kontrollera loggen — är hur du bygger varje arbetsflöde.

## Spara och slå på

Arbetsytan sparar medan du arbetar. Det finns inget separat "publicera"-steg.

Men ett arbetsflöde körs faktiskt bara när **Enabled** är på i Settings. Nya arbetsflöden börjar inaktiverade. Använd den växeln som ditt skyddsnät — bygg det, testa med **Run Manually**, kontrollera loggarna, slå sedan på det.

För att pausa ett arbetsflöde utan att radera det, slå av **Enabled**. Pågående körningar avslutas; inga nya startar.

## Hålla ordning

- Dra block för att flytta dem. Layouten sparas så att nästa person ser samma arrangemang.
- Högerklicka på en linje för att radera den. Högerklicka på ett block för att radera eller duplicera det.
- För breda arbetsflöden, lägg ut dem från vänster till höger så att de läses i den riktning de körs.

## Läs vidare

- [Utlösare](/docs/workflows/triggers) — de fyra sätten ett arbetsflöde kan starta på.
- [Komponenter](/docs/workflows/components) — varje block du kan lägga till.
- [Variabler](/docs/workflows/variables) — flytta data mellan block.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad som hände.
