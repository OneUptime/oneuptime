# Skapa en instrumentpanel

För att skapa en instrumentpanel öppnar du **Produkter → Instrumentpaneler** och klickar på **Skapa instrumentpanel**. Dialogrutan **Skapa en instrumentpanel** frågar hur du vill börja och sedan efter ett namn. **Börja från grunden** ger dig en tom instrumentpanel; en mall bygger sina widgetar, och ofta sina variabler, åt dig och fyller i sitt namn (numrerat, som i "Kubernetes Dashboard 2", när projektet redan har en). Klicka på **Skapa instrumentpanel** så öppnas den nya instrumentpanelen. En tom instrumentpanel öppnas på sin arbetsyta, med knappen **Lägg till widget** för den första widgeten.

:::cards
- [Skapa instrumentpanelen](#skapa-instrumentpanelen): Börja från grunden eller från en mall.
- [Redigera och spara](#redigera-och-spara): Inget ändras för någon förrän du klickar på Spara ändringar.
- [Lägg till en widget](#lägg-till-en-widget): Välj den i katalogen, ställ in den och placera den.
- [Zooma in på en topp](#zooma-in-på-en-topp): Dra över ett diagram för att läsa hela instrumentpanelen i det ögonblicket.
:::

## Innan du börjar

Projektägare och -administratörer kan skapa och redigera alla instrumentpaneler. Alla andra behöver en teambehörighet: `CreateDashboard` för att skapa instrumentpaneler och `EditDashboard` för att ändra dem. Projektmedlemmar och läsare kan läsa instrumentpaneler utan någon av dem. Den som inte får redigera en instrumentpanel kan ändå öppna dess **⋯**-meny, där **Redigera instrumentpanel** är låst och talar om vilken behörighet som krävs.

## Skapa instrumentpanelen

:::steps
### Välj hur du börjar

Öppna **Produkter → Instrumentpaneler** och klicka på **Skapa instrumentpanel**. Dialogrutan **Skapa en instrumentpanel** öppnas på **Börja från grunden**, en tom instrumentpanel för dina egna widgetar. Under den listar **Eller börja från en mall** sex mallar under **Rekommenderade**.

### Välj en mall

Klicka på en mall för att se vad den lägger till: dess widgetar, namngivna som i **Lägg till widget**, och variablerna du smalnar av den med i dess verktygsfält. För de andra väljer du en kategori bredvid sökrutan, eller **Alla mallar**, eller skriver i **Sök mallar…**: varje ord du skriver måste stämma. Klicka sedan på **Använd den här mallen**, eller dubbelklicka på mallen. I sökrutan väljer piltangenterna en mall och **Enter** använder den.

### Namnge instrumentpanelen

En malls namn är ifyllt, numrerat förbi de namn som projektet redan har. **Börja från grunden** lämnar det tomt: skriv ett. Beskrivningen är valfri, hopfälld under **Fler fält**, och du kan lägga till den senare på instrumentpanelens sida **Översikt**. **Tillbaka** tar dig tillbaka till mallarna som du lämnade dem.

### Skapa den

Klicka på **Skapa instrumentpanel**. Den nya instrumentpanelen öppnas: med en malls widgetar direkt, eller med en tom arbetsyta med **Lägg till widget** på.
:::

Mallarna, efter den kategori som väljaren listar dem under:

| Kategori | Mallar |
| --- | --- |
| Övervakning och APM | Monitor Dashboard, Metrics Dashboard, Real User Monitoring Dashboard, SLO Dashboard |
| Incidenthantering | Incident Dashboard, Alert Dashboard |
| Infrastruktur | Kubernetes Dashboard, Kubernetes Cost Dashboard, Hosts Dashboard, Proxmox Dashboard, VMware Dashboard, Ceph Dashboard, Storage Array Dashboard, Docker Swarm Dashboard, Network Dashboard |

**Rekommenderade** innehåller Monitor Dashboard, Incident Dashboard, Alert Dashboard, Kubernetes Dashboard, Hosts Dashboard och Metrics Dashboard. En mall är en utgångspunkt, inte en koppling: när instrumentpanelen är skapad ändrar du den som du vill. Mallen uppdaterar den inte senare.

## Redigera och spara

En instrumentpanel öppnas i visningsläge, för läsning. För att ändra den öppnar du **⋯**-menyn i dess verktygsfält och väljer **Redigera instrumentpanel**. Verktygsfältet visar **Redigerar** bredvid namnet och byter ut tidsintervallet och de andra kontrollerna mot **Lägg till widget**, **Variabler**, **Avbryt** och **Spara ändringar**, med en rad under dem för instrumentpanelens **Standardtidsintervall** och **Standard för automatisk uppdatering**.

```mermaid title="Från att läsa en instrumentpanel till att ändra den, och tillbaka"
flowchart TB
    view["Visningsläge: panelen<br/>öppnas här"] -->|"⋯ → Edit Dashboard"| edit["Redigeringsläge: lägg<br/>till, ändra, flytta och<br/>ändra storlek"]
    edit -->|"Spara ändringar"| saved["Alla ser<br/>ändringarna"]
    edit -->|"Avbryt, sedan<br/>Kasta ändringar"| dropped["Inget ändras"]
    saved --> back["Tillbaka i<br/>visningsläge"]
    dropped --> back
```

Dina ändringar är bara dina tills du sparar dem. Inget sparas medan du redigerar, så andra ser fortfarande instrumentpanelen som den var.

- **Spara ändringar** sparar widgetarna, deras placeringar och storlekar, variablerna samt standardtidsintervallet och standarden för automatisk uppdatering, allt på en gång, och går tillbaka till visningsläge. Om sparandet nekas, till exempel för att du har förlorat behörigheten under tiden, stannar du i redigeringsläge med dina ändringar, och orsaken visas ovanför rutnätet.
- **Avbryt** frågar först, eftersom den kastar dina ändringar: **Kasta ändringar** går tillbaka till instrumentpanelen som den sparades, och **Fortsätt redigera** tar dig tillbaka till ditt arbete.

Medan du redigerar pausas den automatiska uppdateringen, och ett inzoomat tidsintervall går tillbaka till intervallet du valde.

## Lägg till en widget

:::steps
### Öppna widgetkatalogen

Klicka på **Lägg till widget**: i verktygsfältet medan du redigerar, eller på arbetsytan i en tom instrumentpanel. Katalogen grupperar sina widgetar efter vad de visar. Skriv i sökrutan för att hitta en efter namn eller syfte ("error budget", "pods"), och tryck på Retur för att lägga till den första träffen.

### Välj en widget

Klicka på den. Widgeten hamnar på den första lediga platsen i rutnätet där den får plats, och dess inställningar öppnas.

### Ange vad den visar

Inställningsdialogen visar en **Live Preview** av widgeten ovanför inställningarna, och förhandsvisningen följer varje ändring du gör. Välj vad widgeten läser (en mätvärdesfråga, ett filter, en text) och hur den ser ut, och klicka sedan på **Klar**.

### Placera den

Dra widgeten för att flytta den, och dra i dess kanter eller hörn för att ändra storlek. Se [Widgetar i rutnätet](#widgetar-i-rutnätet).
:::

[Instrumentpanels-widgetar](/docs/dashboards/widgets) går igenom varje widget och dess inställningar.

## Widgetar i rutnätet

Arbetsytan är ett rutnät som är tolv kolumner brett. Widgetar fäster mot det, och sidan växer nedåt när du lägger till rader. Medan du drar en widget visar en streckad kontur var den kommer att hamna, med dess kolumn och rad; medan du ändrar storlek på en visar konturen dess storlek i rutnätsenheter. Widgetar som är i vägen flyttar på sig, så två widgetar överlappar aldrig.

Varje sorts widget har en minsta storlek, så att det den ritar förblir läsbart: ett diagram är minst sex kolumner brett och tre rader högt, medan ett enda tal får plats i en cell.

Rutnätet är lika brett som skärmen. På en smalare skärm blir dess kolumner smalare och dess rader behåller sin höjd. På en telefon visas widgetarna under varandra, var och en lika bred som skärmen, i den ordning de står i rutnätet: rad för rad uppifrån och, inom en rad, från vänster till höger. Ett diagram ritas högre där, så att dess kurva får plats. När du redigerar på en telefon ser du rutnätet, som går att rulla i sidled.

För att ändra en widget senare klickar du på den medan du redigerar. Dess inställningar öppnas igen, med två knappar till längst ned:

- **Duplicate Widget** lägger till en kopia, med samma inställningar, på den första lediga platsen.
- **Radera widget** tar bort den när du har bekräftat.

## Tidsintervall och automatisk uppdatering

I visningsläge anger verktygsfältets tidsintervallväljare fönstret som alla diagram-, tal-, logg- och spårwidgetar läser. Välj en förinställning från de senaste 5 minuterna till de senaste 3 månaderna, eller en egen start och ett eget slut. Instrumentpanelen öppnas på sitt standardtidsintervall: den senaste timmen, om inte någon som redigerar den väljer ett annat.

Listor över incidenter, larm, övervakare och resurser visar sitt aktuella tillstånd, oavsett tidsintervall.

Bredvid tidsintervallet läser menyn för automatisk uppdatering varje widget igen med 5, 10 eller 30 sekunders eller 1, 5 eller 15 minuters mellanrum, med en nedräkning till nästa uppdatering. Låt den vara av medan du felsöker, så att vyn står still. Instrumentpanelen öppnas med sin standard för automatisk uppdatering: av, om inte någon som redigerar den väljer en annan.

Tidsintervallväljaren, variablerna och den automatiska uppdateringen visas så snart instrumentpanelen har en widget.

### Instrumentpanelens standarder

Medan du redigerar instrumentpanelen anger raden under verktygsfältets knappar vad alla öppnar den med: **Standardtidsintervall**, en förinställning från de senaste 5 minuterna till de senaste 3 månaderna, och **Standard för automatisk uppdatering**. **Spara ändringar** sparar dem med resten av instrumentpanelen, för ditt team och för besökarna på dess offentliga länk. En egen start och ett eget slut kan inte vara en standard: instrumentpanelen skulle stå kvar på det ögonblicket för alltid. Raden visas så snart instrumentpanelen har en widget.

Instrumentpaneler som sparades före de här inställningarna öppnas på den senaste timmen, med den automatiska uppdatering de hade. Via API:et och Terraform ligger båda i instrumentpanelens `dashboardViewConfig`: `timeRange`, en förinställning stavad som i API-referensen, till exempel `Past 1 Day`, och `refreshInterval`, till exempel `1m`. Alla andra värden avvisas.

### Dina egna val

Tidsintervallet och den automatiska uppdatering du väljer i visningsläge gäller bara dig, och din webbläsare kommer ihåg dem för varje instrumentpanel: en omladdning, en omstart av webbläsaren eller av en väggskärm öppnar instrumentpanelen som du lämnade den. Bara en förinställning sparas. Ett eget intervall eller en zoom varar tills du lämnar sidan, så att instrumentpanelen aldrig fastnar på ett ögonblick i det förflutna.

Det första valet i varje väljare visar instrumentpanelens standard, som i Standard (Past 1 Day). Välj det för att gå tillbaka till standarden: webbläsaren glömmer ditt val, och instrumentpanelen följer sin standard igen, även när någon ändrar den senare. När du själv sparar nya standarder ser du dem direkt.

### Zooma in på en topp

Du behöver inte ta till tidsintervallväljaren för att titta på en topp. Dra över det intressanta avsnittet i ett linje- eller ytdiagram, så flyttar **hela instrumentpanelen** till det fönstret, precis som om du hade valt det i tidsintervallväljaren: varje widget som använder tidsintervallet frågar om samtidigt, så du läser ett ögonblick över hela instrumentpanelen i stället för ett diagram i en annan skala än grannarna. Livelistor fortsätter att visa vad som händer nu, som de alltid gör.

**Dubbelklicka på ett valfritt diagram** för att ångra: instrumentpanelen går tillbaka till intervallet den hade innan du började zooma, oavsett hur många gånger du har zoomat vidare. En knapp **Återställ zoom** visas bredvid tidsintervallväljaren medan en zoom är aktiv, och ett dubbelklick på en instrumentpanel som inte är inzoomad gör ingenting.

Ett inzoomat fönster ligger fast, så det slutar rulla framåt medan automatisk uppdatering är på; det är avsiktligt, eftersom ett fönster som gled undan mitt i en felsökning vore värre. Återställ zoomen för att få det att rulla igen.

Zoom fungerar bara i visningsläge; i redigeringsläge flyttar och ändrar dragning i stället storlek på widgetar. Stapeldiagram zoomar på samma sätt (dra över staplarna), och ett dubbelklick på ett av dem återställer instrumentpanelen som vilket annat diagram som helst. Bara en dragning zoomar: ett vanligt klick på ett diagram ändrar aldrig instrumentpanelens tidsintervall. Samma gester fungerar på diagrammen i hela OneUptime; se [Zooma in på ett tidsintervall](/docs/telemetry/charts-and-time-ranges).

## Helskärm

**⋯ → Helskärm** visar instrumentpanelens widgetar på hela skärmen, för en väggskärm eller ett möte. Tryck på Esc för att lämna den.

## Tips för instrumentpaneler som håller över tid

- **Ett ämne per instrumentpanel.** Några få fokuserade instrumentpaneler slår en sida med allt du bevakar.
- **Lägg den viktigaste widgeten överst.** Folk läser uppifrån och ned, så låt det första de ser svara på "är det här friskt?"
- **Namnge avsnitten med Text-widgetar.** En kort rubrik med några raders mellanrum ("Svarstid", "Fel", "Kapacitet") gör sidan lätt att skumma, även från andra sidan rummet.
- **Använd variabler i stället för kopior.** Om du är på väg att bygga samma instrumentpanel för en andra tjänst lägger du i stället till en variabel `service`. Se [Instrumentpanelsvariabler & filter](/docs/dashboards/variables).
- **Gör en kopia före en stor ändring.** **Duplicera Instrumentpanel**, på instrumentpanelens sida **Inställningar**, gör en säker kopia att pröva dina idéer på.

## Nästa steg

:::cards
- [Instrumentpanels-widgetar](/docs/dashboards/widgets): Varje widget, dess inställningar och vilken du ska välja.
- [Instrumentpanelsvariabler & filter](/docs/dashboards/variables): En instrumentpanel för varje tjänst, värd eller kund.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing): Dela instrumentpanelen utanför ditt team.
- [Instrumentpanelskonfiguration & behörigheter](/docs/dashboards/configuration): Ägare, etiketter, arkivering och vem som får göra vad.
:::
