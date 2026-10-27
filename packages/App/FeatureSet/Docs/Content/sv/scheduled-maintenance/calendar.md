# Underhållskalender

Underhållskalendern visar ditt schemalagda underhåll efter datum: på en egen sida i instrumentpanelen, i ditt teams egna kalenderappar via en hemlig länk och i kalendrarna hos de människor som följer dina statussidor. På dess sida kan kalendrar utanför projektet, som helgdagar eller ett ändringsstopp, visas bredvid dina händelser. Den här sidan förklarar kalendersidan, externa kalendrar, teamets kalenderlänk, en statussidas kalender och vad varje kalenderhändelse innehåller.

:::cards
- [Kalendersidan](#kalendersidan): Varje händelse på en månad, en vecka eller en dag, i färgen för dess tillstånd.
- [Externa kalendrar](#externa-kalendrar): Helgdagar, ändringsstopp eller ett annat teams underhåll, bredvid dina händelser.
- [Teamets kalenderlänk](#teamets-kalenderlänk): Varje händelse i projektet i Google Kalender, Outlook eller Apple Kalender.
- [En statussidas kalender](#en-statussidas-kalender): Det en statussida visar, i besökarnas kalendrar.
- [Vad en kalenderhändelse innehåller](#vad-en-kalenderhändelse-innehåller): Titeln, tidsfönstret, tillståndet och en länk tillbaka.
:::

```mermaid title="En lista med händelser, tre kalendrar"
flowchart TB
    events["Schemalagda<br/>underhållshändelser"] --> view["Kalendervyn<br/>i instrumentpanelen"]
    events --> team["Teamets länk<br/>varje händelse"]
    events --> page["En statussidas länk<br/>det sidan visar"]
    team --> apps["Kalenderappar"]
    page --> apps
```

## Kalendersidan

Öppna **Schemalagt underhåll → Underhållskalender** i avsnittet **Kalender** i sidomenyn. **Alla händelser** visar samma händelser som en lista.

- Kalendern öppnas på den här månaden, med dagens datum markerat. **Månad**, **Vecka** och **Dag** ändrar hur mycket den visar; bläddra med pilarna och gå tillbaka med **Idag**. Tiderna visas i din egen tidszon.
- Varje händelse är ett block i färgen för dess tillstånd, och tillståndens färger namnges under kalendern. Klicka på en händelse för att öppna den.
- Filtren ovanför kalendern fungerar som i listan: välj ett tillstånd, en etikett eller en ägare för att bara se de händelserna.
- En dag som ännu inte har kommit visar ett **+** när du pekar på dess vecka. Det öppnar **Skapa schemalagt underhållsevenemang** med **Börjar den** på den dagen, vid den timme formuläret skulle välja i dag. Du ser det bara om du får skapa händelser.
- En vy visar upp till 500 händelser. En fullare månad säger till: begränsa den med filtren eller titta på en vecka.

**Alla händelser** växlade tidigare mellan en lista och en kalender. Om din webbläsare senast lämnade den på kalendern öppnar **Alla händelser** **Underhållskalender** en gång och är listan från och med då.

## Externa kalendrar

Kalendersidan kan också visa händelserna från kalendrar utanför projektet: helgdagar, ett ändringsstopp som ditt företag har i en annan kalender eller ett annat teams underhåll. OneUptime läser var och en från dess iCalendar-länk (`.ics`) och ritar dess händelser bredvid dina, ljusare och i kalenderns egen färg. De är skrivskyddade: de blir aldrig underhållshändelser, ingen meddelas om dem och de visas aldrig i projektets egna kalenderlänkar.

:::steps
### Lägg till kalendern

Välj **Lägg till extern kalender** i kalenderns **⋯**-meny, eller öppna **Schemalagt underhåll → Kalenderinställningar** i avsnittet **Inställningar** i sidomenyn och klicka på **Lägg till extern kalender**. Fyll i **Namn** och klistra in länken i **Kalenderlänk**. **Fler fält** innehåller dess **Färg** och **Uppdatera**, hur ofta den läses: **Varje timme** om du inte väljer något annat.

### Kontrollera att den lästes

OneUptime läser en ny kalender direkt. Dess **Status** säger **Fungerar** när den har lästs, och **Senast läst** säger när, och hur många händelser den sparade. En läsning som misslyckades säger **Fungerar inte**, med orsaken och vad du ska göra.

### Visa eller dölj den

Varje extern kalender har en växel med sitt namn under kalendern. Döljer du en döljs den bara för dig; webbläsaren kommer ihåg valet för projektet.
:::

Kopiera länken från kalenderns egna delningsinställningar: i Google Kalender dess hemliga adress i iCal-format, i Outlook ICS-länken till en publicerad kalender, i alla andra appar dess `.ics`- eller `webcal://`-länk. Länken får vara privat: OneUptime lagrar den krypterad, visar den aldrig igen, och **Byt länk** ersätter den.

| Åtgärd | Vad som händer |
| --- | --- |
| **Läs nu** | Läser kalendern nu i stället för vid nästa läsning. |
| **Byt länk** | Ersätter dess länk. Händelserna från den gamla länken glöms, och den nya läses direkt. |
| **Stäng av** | Slutar läsa den och döljer dess händelser för alla, tills **Slå på**. |

Varje kalender sparar sina händelser från 90 dagar bakåt till ett år framåt, upp till 2 000 av dem, de närmast i dag först. En kalender större än 5 MB läses inte. Återkommande händelser, deras undantag och deras tidszoner läses som kalenderappen skrev dem, och en heldagshändelse stannar på sitt datum i alla tidszoner. Ett projekt kan ha upp till 20 externa kalendrar, och en vy av kalendern ritar upp till 500 av deras händelser.

De roller som skapar, redigerar och tar bort schemalagda underhållshändelser lägger till, ändrar och tar bort externa kalendrar, och alla som kan läsa händelserna ser dem i kalendern. OneUptime läser aldrig en adress på sin egen server eller en metadataadress i molnet, och OneUptime Cloud avvisar adresser på ett privat nätverk. En egen server kan läsa en kalender på ditt eget nätverk, om inte `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` är `true`.

## Teamets kalenderlänk

**Prenumerera på kalender**, under kalendern, öppnar projektets kalenderlänk: en hemlig iCalendar-länk (`.ics`) som lägger in varje schemalagd underhållshändelse i projektet i Google Kalender, Outlook, Apple Kalender eller vilken app som helst som prenumererar på en kalender via en URL.

:::steps
### Publicera länken

Klicka på **Publicera länk**. Ett projekt har en länk för hela teamet, så det behövs bara en gång.

### Lägg till den i din kalenderapp

**Google Kalender** öppnar Google Kalender, som frågar om kalendern ska läggas till. **Apple Kalender / Outlook** öppnar länken i kalenderappen på din dator eller telefon. **Kopiera länk** kopierar den för vilken annan app som helst.

### Kontrollera att det fungerar

Panelen **Status** visar när en kalenderapp senast läste länken, och vilken. En ny länk visar **Väntar på första synkroniseringen** tills en app läser den.
:::

Länken ser ut så här:

```text
https://<your host>/api/scheduled-maintenance-calendar/project/<token>/maintenance.ics
```

> [!WARNING]
> Alla som har länken ser varje schemalagd underhållshändelse i projektet utan att logga in. Behandla den som ett lösenord och skapa den på nytt om den delas av misstag.

### Vem som kan se länken

Länken visar varje händelse i projektet, så dialogen visar den bara för personer som kan läsa varje händelse. Den vars roll begränsar dem till vissa händelser, efter etikett eller till de händelser de äger, får i stället veta varför.

| Åtgärd | Vem som kan göra det |
| --- | --- |
| Kopiera länken | Alla som kan läsa varje schemalagd underhållshändelse i projektet |
| **Publicera länk** | Alla som också kan skapa schemalagda underhållshändelser |
| **Skapa länken på nytt**, **Inaktivera länk** | Alla som också kan redigera schemalagda underhållshändelser |

### Hantera länken

**Skapa länken på nytt** och **Inaktivera länk** finns i menyn **⋯** högst upp i dialogen.

| Åtgärd | Vad som händer |
| --- | --- |
| **Skapa länken på nytt** | Skapar en ny länk. I 30 dagar levererar den gamla en tom kalender, så att apparna som har den rensar sin kopia; därefter hittas den inte. Prenumerera igen med den nya länken. |
| **Inaktivera länk** | Behåller länken, men den levererar en tom kalender tills **Aktivera länk**. |

Kalendern innehåller varje händelse från 90 dagar bakåt till ett år framåt, upp till 1 000 händelser.

## En statussidas kalender

De som följer en statussida kan lägga in dess schemalagda underhåll i sin egen kalender. På statussidans sida med schemalagda händelser erbjuder **Prenumerera på kalender** Google Kalender, kalenderappen på deras enhet eller länken att kopiera. Länken är sidans adress följd av `/maintenance.ics`, till exempel `https://status.example.com/maintenance.ics`.

- **Vad den innehåller.** Exakt det sidan visar: händelserna i sidans historikfönster, varje händelse som ännu inte har börjat och varje som pågår, så länge **Synlig på statussidan** är påslaget, och från dess **Publicera den** om du har valt ett. Det varje händelse påverkar namnges som sidan namnger sina resurser, aldrig med dina monitorers egna namn.
- **En privat sida.** En kalenderapp kan inte logga in, så en privat sida erbjuder ingen **Prenumerera på kalender**, och dess länk levererar en tom kalender som säger att sidan är privat.
- **En händelse.** **Lägg till i kalender** på en händelses sida lägger bara till den händelsen: Google Kalender öppnas med den ifylld, eller så laddas den ned som en fil som enhetens kalenderapp öppnar. Det fungerar också på en privat sida för en besökare som har loggat in, och erbjuds inte när händelsen är över.

## Vad en kalenderhändelse innehåller

Varje kalender, teamets och en statussidas, skriver en händelse på samma sätt.

| Del | Vad den innehåller |
| --- | --- |
| Titel | Händelsens titel |
| Start och slut | Dess planerade tidsfönster i UTC; kalenderappen visar det i din egen tidszon |
| Beskrivning | Dess beskrivning som ren text, dess tillstånd, vad den påverkar och en länk till händelsen; teamets länk namnger också dess statussidor |
| Status | Inställd när händelsen ställdes in: slutförd utan att någonsin ha pågått |
| Ledig eller upptagen | Ledig, så att ett underhållsfönster aldrig blockerar din tillgänglighet |
| Kategorier | Dess etiketter; en statussidas kalender visar dem bara när sidan visar etiketter |

En händelse som redigeras i OneUptime uppdateras på plats i varje kalender som har den, och en som tas bort eller tas bort från en statussida försvinner ur kalendern vid nästa uppdatering.

## Hur ofta kalendrar uppdateras

Kalenderappar läser en prenumererad länk enligt sitt eget schema. Google Kalender gör det med några timmars mellanrum, ibland bara en gång om dagen; Apple Kalender och Outlook oftast varje timme. OneUptime sparar en kalender i högst fem minuter, så väntan du ser är kalenderappens. Stegen för varje app finns på [Kalenderflöden](/docs/on-call/calendar-feeds#prenumerera-i-din-kalenderapp), som fungerar på samma sätt för jourpass.

## Felsökning

:::details Kalenderappen visar inte längre nya händelser
Länken har skapats på nytt eller inaktiverats: öppna **Prenumerera på kalender** för att se dess status. En länk som har skapats på nytt måste prenumereras på igen med den nya länken; en inaktiverad länk kommer tillbaka med **Aktivera länk**.
:::

:::details Google Kalender kan inte lägga till länken
Google Kalender läser länken från Googles servrar, så OneUptime-servern måste kunna nås från internet. Se [Kalenderflöden](/docs/on-call/calendar-feeds#felsökning) för en server i egen drift.
:::

:::details En händelse saknas i en statussidas kalender
Sidans kalender innehåller det sidan visar. Kontrollera att händelsen nämner sidan, att **Synlig på statussidan** är påslaget i dess **Inställningar**, att dess **Publicera den**, om den har ett, har inträffat och att den började inom sidans historikfönster.
:::

:::details En extern kalender säger Fungerar inte
Orsaken står under **Fungerar inte** i dess **Status**: ingen kalender på länken, en länk som kräver inloggning eller inte längre delas, ett fel från dess server, en kalender större än 5 MB eller en som upprepar händelser för ofta för att kunna bearbetas. Rätta länken med **Byt länk**, eller använd **Läs nu** när kalendern är tillbaka. Till dess visar kalendern händelserna från sin senaste lyckade läsning.
:::

## Nästa steg

:::cards
- [Skapa underhållshändelser](/docs/scheduled-maintenance/creating-events): Formuläret, fält för fält, och vad som händer sedan.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers#schemalagda-underhållshändelser): Vad en statussidas prenumeranter får veta om underhåll.
- [Kalenderflöden](/docs/on-call/calendar-feeds): Samma sorts länk för jourpass.
:::
