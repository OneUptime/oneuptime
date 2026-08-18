# Skapa ett arbetsflöde

För att skapa ett arbetsflöde, öppna **Arbetsflöden** och klicka på **Skapa arbetsflöde**. En guide som heter **Create a workflow** tar dig genom det: först **Start from** — välj **Start from scratch** eller en av mallarna — sedan **Namn**, och till sist ett **Konfigurera**-steg, som bara dyker upp när mallen du valde vill ha egna inställningar.

När det är skapat, öppna **Byggare** i vänstermenyn. Det är arbetsytan där du designar arbetsflödet.

## Arbetsytan

Ett arbetsflöde som byggs från grunden öppnas med ett enda streckat block där det står **Please click here to add trigger**. Det blocket är startpunkten — klicka på det för att välja en utlösare. Ett arbetsflöde skapat från en mall öppnas med sina block redan på plats.

Varje arbetsflöde har exakt en **utlösare** högst upp. Allt annat är en **komponent** som gör något. Lägger du till en andra utlösare ersätter den den första, och tar du bort den sista kommer den streckade platshållaren tillbaka.

Att lägga till block:

- **Utlösaren** — klicka på det streckade platshållarblocket. En panel med rubriken **Add Trigger** öppnas.
- **Allt annat** — klicka på **Lägg till komponent** i verktygsfältet ovanför arbetsytan. Samma panel öppnas, med rubriken **Lägg till komponent**.

Båda panelerna är sökbara — tryck på `/` för att hoppa till sökrutan — och grupperade efter kategori. Markera ett block och klicka på **Add to Workflow**.

Nya block landar alltid på samma plats på arbetsytan, så ett nytt kan hamna ovanpå något du redan placerat. Dra undan det; arbetsytan snäpper till ett rutnät medan du drar. Blockens positioner sparas, så nästa person ser samma upplägg som du lämnade efter dig.

Ändringar sparas automatiskt. En liten etikett i verktygsfältet håller koll på det: **Saving…** medan ändringen är på väg, sedan **Sparad**, eller **Could not save** om det inte gick. Det finns ingen spara-knapp och inget separat publiceringssteg.

## Vad som finns på ett block

| Fält                          | Vad det gör                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**) | Det korta id:t som visas på blocket, som `log-1`. Det är så andra block refererar till det här blocket, så byter du namn på det slutar varje `{{local.components.…}}`-referens som pekar hit att fungera. Blockets rubrik är komponentens eget namn och går inte att ändra. |
| **Inställningar**             | Det blocket behöver för att göra sitt jobb — en URL, en Slack-kanal, en meddelandetext. Valfria fält är märkta **(Optional)**; allt annat är obligatoriskt. Mindre använda inställningar ligger bakom en **Avancerad**-utfällning. |
| **Input**                     | Punkten på överkanten, dit linjer kommer in från tidigare block. Utlösare har ingen — inget körs före dem.                                                                                                   |
| **Outputs**                   | Punkterna längs nederkanten, med sina etiketter strax ovanför, där linjer går ut till nästa block. Många block har separata **Success**- och **Error**-utgångar så att du kan hantera båda fallen.           |

## Koppla ihop block

Dra från en punkt på undersidan av ett block ner till punkten på ovansidan av nästa. Linjen du drar avgör vad som körs härnäst.

- Kopplar du från **Success** körs nästa block bara när det tidigare fungerade.
- Kopplar du från **Error** körs nästa block bara när det tidigare misslyckades.
- Kopplar du inte en utgång alls stannar den vägen där.

Du kan koppla en utgång till flera block. Alla körs — men en i taget, i en enda kö, inte parallellt. Lita inte på ordningen mellan grenar, och räkna inte med att de överlappar i tid. Varje block körs högst en gång per körning, så en loop tillbaka till ett tidigare block kör det inte en andra gång.

## Konfigurera ett block

Klicka på ett block för att öppna dess inställningar i en dialog. Varje inställning har rätt sorts inmatning — textfält, rullgardinsmenyer, kodredigerare, växlar och så vidare. Fyll i och klicka på **Spara**.

I samma dialog hittar du också:

- **Ta bort** — ta bort det här blocket.
- **Run just this step** — kör bara det här blocket för sig, utan resten av arbetsflödet. Värden det skulle ha läst från andra steg kommer in tomma, och allt det skickar, skriver eller raderar händer på riktigt.
- **Dokumentation**, **Inputs**, **Outputs** och **Returns** — referenskort för vad blocket förväntar sig och vad det producerar.

De flesta textfält tar emot variabler — det är så data flödar från ett block till nästa. Istället för att skriva syntaxen för hand, använd värdeväljaren i redigeraren: den bygger en korrekt referens utifrån blocket och fältet du väljer. Se [Arbetsflödesvariabler](/docs/workflows/variables).

## Kontroller medan du bygger

Byggaren kontrollerar hela grafen varje gång du ändrar något och rapporterar vad den hittar i en etikett i verktygsfältet. Klicka på etiketten för att öppna **Problems with this workflow**, som listar varje problem och tar dig till blocket som orsakar det. Block med problem får också en röd markering på arbetsytan.

Den fångar misstagen som annars är osynliga tills en körning går fel — ingen utlösare, två block som delar id, en punkt inuti ett id, ett block som ingenting kopplar till, en obligatorisk inställning som lämnats tom, felformad JSON, mellanslag inuti `{{ }}` och referenser till ett steg eller returvärde som inte finns.

En sak den inte kan kontrollera: om ett variabelnamn finns. En omdöpt variabel visar sig först i körloggen.

## Ditt första arbetsflöde

Snabbaste sättet att få känsla för arbetsytan:

1. Klicka på det streckade platshållarblocket, välj **Manual** i panelen **Add Trigger** och klicka på **Add to Workflow**.
2. Klicka på **Lägg till komponent**, välj **Log** (under **Utils**) och klicka på **Add to Workflow**. Dra det nya blocket undan från utlösaren och koppla sedan utlösarens **Execute**-punkt ner till Log-blockets inmatningspunkt.
3. Öppna Log-blocket och sätt dess **Value** till `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` är utlösarens **Identifier**, som står på utlösarblocket — kontrollera att det stämmer.
4. Gå till **Översikt**, klicka på **Redigera arbetsflöde** på kortet **Arbetsflödesdetaljer** och slå på **Aktiverad**. Ett inaktiverat arbetsflöde kan inte köras alls, inte ens för hand.
5. Tillbaka i **Byggare**, klicka på **Kör arbetsflöde**, lägg `{ "name": "Ada" }` i fältet **JSON**, klicka på **Run Workflow Manually** och bekräfta med **Run**.
6. En panel med **Workflow Run** öppnas av sig själv och följer körningen. Loggen visar `Value:` följt av `Hello from Ada`.

Den cykeln — lägg till, koppla, konfigurera, kör, läs loggen — är så du bygger varje arbetsflöde.

## Slå på det

Nya arbetsflöden startar inaktiverade, och det gör även varje arbetsflöde du duplicerar eller importerar.

Växeln **Aktiverad** sitter på arbetsflödets sida **Översikt**, i kortet **Arbetsflödesdetaljer** — inte på inställningssidan. Samma kort visar aktuellt tillstånd som en grön **Aktiverad**- eller röd **Inaktiverad**-etikett.

Ett inaktiverat arbetsflöde kan inte köras alls. Manuella körningar avvisas med "This workflow is not enabled" precis som utlösta, så ordningen är: aktivera det, testa det med **Kör arbetsflöde**, läs körloggen och slå av **Aktiverad** igen om du inte är redo för att dess utlösare ska smälla. För att testa ett enskilt block utan att köra hela saken, använd **Run just this step** i det blockets inställningar.

För att pausa ett arbetsflöde utan att ta bort det, slå av **Aktiverad**. Inga nya körningar startar. En körning som är mitt i exekveringen slutförs, men en som står parkerad på ett **Sleep**-block avbryts när den vaknar och registreras som ett fel.

## Städa upp

- Dra block för att flytta dem. Layouten sparas.
- För att ta bort en linje, dra någon av dess ändar av punkten och släpp den på tom arbetsyta.
- För att ta bort ett block, klicka på det och använd **Ta bort** längst ner i dess inställningsdialog. Att markera ett block eller en linje och trycka på backsteg tar också bort det.
- Det går inte att duplicera ett enskilt block. **Duplicate Workflow** på arbetsflödets sida **Inställningar** kopierar hela saken, och kopian landar inaktiverad.
- Stapla blocken uppifrån och ner så att de läses i den riktning de körs — inmatningar sitter på överkanten, utgångar på nederkanten, så flödet går naturligt nedåt.

## Läs vidare

- [Arbetsflödesutlösare](/docs/workflows/triggers) — de fyra sätten ett arbetsflöde kan starta på.
- [Arbetsflödeskomponenter](/docs/workflows/components) — varje block du kan lägga till.
- [Arbetsflödesvariabler](/docs/workflows/variables) — flytta data mellan block.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad som hände.
