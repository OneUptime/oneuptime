# Skapa ett arbetsflöde

För att skapa ett arbetsflöde, öppna **Workflows** och klicka på **Create Workflow**. En guide som heter **Create a workflow** leder dig igenom det: först **Start from** — välj **Start from scratch** eller en av mallarna — sedan **Name**, och slutligen ett **Configure**-steg, som bara visas när mallen du valde efterfrågar egna inställningar.

När det är skapat, öppna **Builder** i vänstermenyn. Det är arbetsytan där du designar arbetsflödet.

## Arbetsytan

Ett arbetsflöde från grunden öppnas med ett enda streckat block som säger **Please click here to add trigger**. Det blocket är startpunkten — klicka på det för att välja en utlösare. Ett arbetsflöde skapat från en mall öppnas med sina block redan på plats.

Varje arbetsflöde har exakt en **trigger** högst upp. Allt annat är en **component** som gör något. Att lägga till en andra utlösare ersätter den första, och att radera den sista sätter tillbaka den streckade platshållaren.

Lägga till block:

- **Utlösaren** — klicka på det streckade platshållarblocket. En panel med titeln **Add Trigger** öppnas.
- **Allt annat** — klicka på **Add Component** i verktygsfältet ovanför arbetsytan. Samma panel öppnas, med titeln **Add Component**.

Båda panelerna är sökbara — tryck på `/` för att hoppa till sökrutan — och grupperade efter kategori. Välj ett block och klicka på **Add to Workflow**.

Nya block hamnar alltid på samma plats på arbetsytan, så ett nytt kan landa ovanpå något du redan placerat. Dra det fritt; arbetsytan snäpper till ett rutnät medan du gör det. Blockens positioner sparas, så nästa person ser samma arrangemang du lämnade efter dig.

Ändringar sparas automatiskt. En pill i verktygsfältet håller koll på det: **Saving…** medan ändringen pågår, sedan **Saved**, eller **Could not save** om det inte gick. Det finns ingen Spara-knapp och inget separat publiceringssteg.

## Vad som finns på ett block

| Fält                        | Vad det gör                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identifier** (under **ID**) | Det korta id:t som visas på blocket, som `log-1`. Så här refererar andra block till det här, så att byta namn på det bryter varje `{{local.components.…}}`-referens som pekar på det. Blockets rubrik är komponentens eget namn och kan inte ändras. |
| **Settings**                  | Vad blocket behöver för att göra sitt jobb — en URL, en Slack-kanal, ett meddelandeinnehåll. Valfria fält är märkta **(Optional)**; allt annat är obligatoriskt. Mindre använda inställningar döljs bakom en **Advanced**-utfällning. |
| **Input**                     | Punkten på blockets överkant, dit linjer kommer in från tidigare block. Utlösare har ingen — inget körs innan dem.                                                                                          |
| **Outputs**                   | Punkterna längs nederkanten, märkta strax ovanför dem, dit linjer går ut till nästa block. Många block har separata **Success**- och **Error**-outputs så att du kan hantera båda fallen.                   |

## Koppla ihop block

Dra från en punkt på undersidan av ett block ner till punkten på översidan av nästa. Linjen du drar bestämmer vad som körs härnäst.

- Om du kopplar från **Success** körs nästa block bara när det tidigare lyckades.
- Om du kopplar från **Error** körs nästa block bara när det tidigare misslyckades.
- Om du inte kopplar en output stannar den vägen där.

Du kan koppla en output till flera block. Alla körs — men efter varandra, i en enda kö, inte parallellt. Räkna inte med ordningen mellan grenar, och räkna inte med att de överlappar i tid. Varje block körs som mest en gång per körning, så en loop tillbaka till ett tidigare block kör det inte igen.

## Konfigurera ett block

Klicka på ett block för att öppna dess inställningar i en dialog. Varje inställning har rätt sorts inmatning — textfält, rullgardinsmenyer, kodeditorer, växlar och så vidare. Fyll i det och klicka på **Save**.

Samma dialog är där du hittar:

- **Delete** — ta bort det här blocket.
- **Run just this step** — kör bara det här blocket för sig, utan resten av arbetsflödet. Värden det skulle ha läst från andra steg kommer in tomma, och allt det skickar, skriver eller raderar sker på riktigt.
- **Documentation**, **Inputs**, **Outputs** och **Returns** — referenskort för vad blocket förväntar sig och producerar.

De flesta textfält accepterar variabler — det är så data flödar från ett block till nästa. Istället för att skriva syntaxen för hand, använd värdeväljaren i editorn: den bygger en korrekt referens från blocket och fältet du väljer. Se [Arbetsflödesvariabler](/docs/workflows/variables).

## Kontroller medan du bygger

Builder kontrollerar hela grafen varje gång du ändrar den och rapporterar vad den hittar i en pill i verktygsfältet. Klicka på pillen för att öppna **Problems with this workflow**, som listar varje problem och hoppar till blocket som orsakar det. Block med ett problem bär också en röd badge på arbetsytan.

Den fångar de misstag som annars är osynliga tills en körning går fel — ingen utlösare, två block som delar ett id, en punkt inuti ett id, ett block som inget kopplar till, en obligatorisk inställning lämnad tom, felaktig JSON, mellanslag inuti `{{ }}`, och referenser till ett steg eller returvärde som inte finns.

En sak den inte kan kontrollera: om ett variabelnamn existerar. Ett omdöpt variabelnamn syns bara i körloggen.

## Ditt första arbetsflöde

Det snabbaste sättet att känna på arbetsytan:

1. Klicka på det streckade platshållarblocket, välj **Manual** i panelen **Add Trigger**, och klicka på **Add to Workflow**.
2. Klicka på **Add Component**, välj **Log** (under **Utils**), och klicka på **Add to Workflow**. Dra det nya blocket fritt från utlösaren, koppla sedan utlösarens **Execute**-punkt ner till Log-blockets input-punkt.
3. Öppna Log-blocket och ställ dess **Value** till `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` är utlösarens **Identifier**, visad på utlösarblocket — kontrollera att det stämmer.
4. Gå till **Overview**, klicka på **Edit Workflow** på kortet **Workflow Details**, och slå på **Enabled**. Ett inaktiverat arbetsflöde kan inte köras alls, inte ens för hand.
5. Tillbaka i **Builder**, klicka på **Run Workflow**, sätt `{ "name": "Ada" }` i fältet **JSON**, klicka på **Run Workflow Manually**, och bekräfta med **Run**.
6. En **Workflow Run**-panel öppnas av sig själv och följer körningen. Loggen visar `Value:` följt av `Hello from Ada`.

Den cykeln — lägg till, koppla, konfigurera, kör, läs loggen — är hur du kommer att bygga varje arbetsflöde.

## Slå på det

Nya arbetsflöden startar inaktiverade, liksom varje arbetsflöde du duplicerar eller importerar.

**Enabled**-växeln finns på arbetsflödets **Overview**-sida, i kortet **Workflow Details** — inte på Settings-sidan. Samma kort visar det aktuella tillståndet som en grön **Enabled**- eller röd **Disabled**-pill.

Ett inaktiverat arbetsflöde kan inte köras alls. Manuella körningar avvisas med "This workflow is not enabled" precis som utlösta, så ordningen är: aktivera det, testa det med **Run Workflow**, läs körloggen, och slå sedan tillbaka **Enabled** om du inte är redo för att dess utlösare ska aktiveras. För att testa ett enskilt block utan att köra hela arbetsflödet, använd **Run just this step** i det blockets inställningar.

För att pausa ett arbetsflöde utan att radera det, slå av **Enabled**. Inga nya körningar startar. En körning som är mitt i exekveringen avslutas, men en som väntar på ett **Sleep**-block avbryts när den vaknar och registreras som ett fel.

## Städa upp

- Dra block för att flytta dem. Layouten sparas.
- För att radera en linje, dra endera änden bort från punkten och släpp den på tom arbetsyta.
- För att radera ett block, klicka på det och använd **Delete** längst ner i dess inställningsdialog. Att markera ett block eller en linje och trycka på Backspace tar också bort det.
- Det finns inget sätt att duplicera ett enskilt block. **Duplicate Workflow** på arbetsflödets **Settings**-sida kopierar hela det, och kopian landar inaktiverad.
- Stapla block uppifrån och ner så att de läses i den riktning de körs — inputs sitter på överkanten, outputs på nederkanten, så flödet går naturligt nedåt.

## Läs vidare

- [Arbetsflödesutlösare](/docs/workflows/triggers) — de fyra sätten ett arbetsflöde kan starta på.
- [Arbetsflödeskomponenter](/docs/workflows/components) — varje block du kan lägga till.
- [Arbetsflödesvariabler](/docs/workflows/variables) — flytta data mellan block.
- [Arbetsflödeskörningar & loggar](/docs/workflows/runs-and-logs) — kontrollera vad som hände.
