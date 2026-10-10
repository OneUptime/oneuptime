# Kalenderflöden

Kalenderflöden lägger in dina jourpass i den kalender du redan tittar i. OneUptime publicerar en hemlig iCalendar-länk (`.ics`) för varje person, varje schema och varje projekt; Google Kalender, Outlook, Apple Kalender, Thunderbird och alla andra appar som kan prenumerera på en kalender via en URL hämtar länken regelbundet och visar en händelse per pass. Inget installeras och inget konto kopplas: länken är hela integrationen.

```mermaid title="Kalenderappar hämtar en hemlig länk; vissa från sina egna servrar"
flowchart TB
    subgraph links["Hemliga .ics-länkar"]
        direction LR
        personal["Personligt flöde"]
        schedule["Schemaflöde"]
        project["Projektflöde"]
    end
    shifts["Scheman, rotationer<br/>och åsidosättningar"] --> links
    links -->|"hämtas från deras servrar"| serverApps["Google Kalender, Outlook på webben"]
    links -->|"hämtas från din enhet"| deviceApps["Apple Kalender, Thunderbird, klassiska Outlook"]
```

> [!NOTE]
> En prenumererad kalender är till för **planering**. Kalenderappar hämtar flöden igen i sin egen takt — Google Kalender bara var 8:e till 24:e timme — så ett byte som görs en timme före ett pass når dig via OneUptimes egna påminnelser, meddelanden om ny tilldelning och larm, inte via kalendern.

## Vad du får

- En händelse per pass, med titeln `On-call · <Schedule>` (med ` · <Policy>` tillagt när schemat är kopplat till exakt en eskaleringspolicy) i ditt personliga flöde och `<Name> · On-call · <Schedule>` i ett delat flöde. Beskrivningen visar vem som har jour, schemat och dess tidszon, lagret, passet i schemats zon, i UTC och i din zon, vilka eskaleringspolicyer som larmar dig via det här schemat och en länk till schemat i instrumentpanelen.
- Åsidosättningar respekteras. När någon täcker upp för dig flyttas händelsen till den personen (`(covering for <Name>)` läggs till) och förblir samma händelse i din kalenderapp, så den uppdateras på plats i stället för att dupliceras. En partiell åsidosättning delar passet i händelser som ligger kant i kant.
- Två dagars historik och 90 dagar framåt som standard. Du kan utöka det till 60 dagar bakåt och 180 dagar framåt; ett flöde som skulle överstiga 5 000 händelser kortas och säger det i kalenderns beskrivning.
- Händelser markeras som lediga (`TRANSP:TRANSPARENT`), så ett prenumererat flöde blockerar aldrig din tillgänglighet, och inget markeras som privat, så en delad teamkalender visar titlarna för alla som kan se den.
- Tider skickas i UTC och räknas om av din kalenderapp; beskrivningen skriver ut klockslaget i schemats zon och i din. Ange din egen tidszon som **Tidszon** på din **Profil** (din bild uppe till höger i instrumentpanelen), och schemats i dess kort **Schedule timezone** på dess sida **Lager**. Ett schema utan tidszon räknas ut i serverns zon, som vid larm, och händelsen säger det.

Fasta tilldelningar — en användare eller ett team som nämns direkt i en regel i en eskaleringspolicy — har ingen start eller slut och visas inte i något flöde. På OneUptime Cloud följer flöden samma plan som jourscheman (Growth); ett projekt under den planen får en tom kalender i stället för ett fel.

## Tre sorters länkar

| Länk | Vem skapar den | Vad den innehåller | Var |
| --- | --- | --- | --- |
| **Personligt flöde** | Varje användare, en per projekt | Dina pass i alla scheman i det projektet, plus de pass där du täcker upp för någon (valfritt) | **Användarinställningar** > **Kalender** > **Kalenderflöde** |
| **Schemaflöde** | Alla som kan redigera schemat; alla som kan läsa det kan kopiera länken | Allas pass i ett schema, med valfria händelser för täckningsluckor | Schemats sida, kortet **Prenumerera på det här schemat** |
| **Projektflöde** | Alla som kan redigera jourscheman; alla som kan läsa dem kan kopiera länken | Allas pass i alla scheman i projektet, med valfria händelser för täckningsluckor | **Jourtjänst** > **Kalenderflöden** |

Länkarna ser ut så här:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Token på 43 tecken i sökvägen är den enda inloggningsuppgiften — det finns ingen inloggning, cookie eller API-nyckel inblandad. Behandla var och en av de här länkarna som ett lösenord.

## Ditt personliga flöde

Personliga flöden är per projekt: ett andra projekt får en andra länk och en andra kalender.

:::steps
### Öppna ditt kalenderflöde

Öppna **Användarinställningar** > **Kalender** > **Kalenderflöde** i det projekt vars pass du vill ha. **Kalender** är ett avsnitt i sidomenyn som börjar hopfällt.

### Skapa länken

Klicka på **Skapa kalenderlänk**. Kortet **Prenumerera på dina jourpass** erbjuder nu ett sätt att prenumerera:

- **Lägg till i din kalender**: **Google Kalender** öppnar Google Kalender, som frågar om kalendern ska läggas till. **Apple Kalender / Outlook** öppnar länkens `webcal://`-form i den app som din dator eller telefon prenumererar med: Apple Kalender på en Mac, iPhone eller iPad, Outlook på Windows.
- **Eller kopiera länken**: **Kopiera länk** kopierar `https://`-länken för alla andra appar som kan prenumerera på en kalender via en URL. Länken är dold på sidan tills du klickar för att visa den.

### Prenumerera på länken

Följ stegen för din app under "Prenumerera i din kalenderapp" nedan. Dina pass visas som händelser nästa gång appen hämtar länken: se "Hur ofta kalendrar uppdateras".
:::

### Inställningar för flödet

Klicka på **Redigera inställningar** på kortet **Inställningar för kalenderflöde** för att ändra vad länken innehåller:

| Inställning | Vad den gör |
| --- | --- |
| **Inkludera pass jag täcker för andra** | På som standard. Lägger till de pass som en åsidosättning ger dig i scheman som du annars inte är medlem i. |
| **Dagar med tidigare pass** | Hur långt bakåt kalendern når (standard 2, högst 60). |
| **Dagar framåt** | Hur långt framåt kalendern når (standard 90, mellan 7 och 180). |

Statusraden visar när länken senast hämtades, av vilken kalenderapp, hur många gånger, och de fyra sista tecknen i token så att du kan skilja länkar åt. Om inget har hämtat länken efter två dagar frågar sidan om servern kan nås från internet (se Felsökning).

### Hantera länken

| Åtgärd | Vad som händer |
| --- | --- |
| **Skapa länken på nytt** | Skapar en ny token. Alla appar som prenumererar på den gamla länken slutar uppdateras: i 30 dagar levererar den gamla länken en tom kalender så att de apparna tömmer sin kopia, därefter svarar den 404. Prenumerera igen med den nya länken. |
| **Inaktivera** | Behåller länken men levererar en tom kalender tills du aktiverar den igen. |
| **Ta bort** | Tar bort länken. Appar som fortfarande hämtar den får 404 och fortsätter att visa det de senast hämtade — inaktivera först om du vill att de ska tömmas. |

### Kommande pass och ersättare

Sidan visar också dina **Upcoming shifts** (de kommande 30 dagarna) och kortet **Påminn mig före pass**, som beskrivs längre ned. Vart och ett av dina egna pass har en länk **Hitta ersättare**: den öppnar användaråsidosättningar i passets projekt med en ny åsidosättning som redan är ifylld för det passet, med dig som **Vem är borta?** och passets tider som **Börjar** och **Slutar** (från och med nu, om passet har börjat), så att bara **Vem täcker upp?** återstår. Åsidosättningen skickar alla dina larm under de tiderna till den som täcker upp, från alla jourpolicyer; ett pass som bara finns inuti en policy täcks i stället på den policyns sida för användaråsidosättningar. Ett pass där du täcker upp för någon annan har ingen **Hitta ersättare**: åsidosättningar kedjas inte, så en ersättare för en ersättare skulle inte ändra något.

Samma personliga länk, filtrerad till ett schema med `?schedule=<id>`, erbjuds som **Bara mina pass i det här schemat** på varje schemas sida, och jourbannern och sidan **Mina jourpolicyer** har en länk **Lägg till dina pass i din kalender** till sidan ovan.

### I mobilappen

I mobilappen: **On-Call** > **Add shifts to my calendar** (även under **Settings** > **Calendar feed**), med en länk per projekt. På iPhone öppnar **Open in Calendar** det inbyggda prenumerationsbladet. På Android går det inte att prenumerera på en URL på telefonen, så skärmen erbjuder **Share link** och **Copy https link** och ber dig lägga till länken på en dator, varefter den synkroniseras till telefonen. Appens lista **Your shifts** kommer från samma data och har samma åtgärd **Get cover**.

## Prenumerera i din kalenderapp

Använd **Google Kalender** eller **Apple Kalender / Outlook** i OneUptime där din app har en knapp; alla andra appar tar den `https://`-länk som **Kopiera länk** ger dig. "https- och webcal-länkar" nedan förklarar de två formerna.

:::tabs
@tab Google Kalender
1. Klicka på **Google Kalender** i OneUptime. Google Kalender öppnas och frågar om kalendern ska läggas till; klicka på **Lägg till**.
2. Eller klicka på **+** > **Från webbadress** bredvid **Andra kalendrar** i Google Kalender på webben, klistra in länken (**Kopiera länk** i OneUptime) och klicka på **Lägg till kalender**.

Knappen **Google Kalender** öppnar Googles sida för att lägga till via URL, `https://calendar.google.com/calendar/r?cid=` följt av länkens `webcal://`-form, procentkodad. Den sidan tar bara `webcal://`-formen: med `https://`-formen svarar Google "Unable to add calendar. Check the URL." **Från webbadress** tar båda formerna.

Google hämtar flödet **från Googles servrar**, så OneUptime-servern måste kunna nås från internet — OneUptime Cloud kan alltid det; för en egen installation, se Felsökning. Den första hämtningen sker oftast inom några minuter efter att du har prenumererat; därefter uppdaterar Google ungefär var 8:e till 24:e timme, ibland mer sällan. Det finns ingen uppdateringsknapp för prenumererade kalendrar, och Google ignorerar uppdateringstipsen i flödet. Statusraden på flödessidan visar **Senast hämtad … av Google Calendar** när Google har läst länken.

Kalenderns namn och tidszon läses **bara när du prenumererar första gången**: att byta namn på ett schema senare byter inte namn på kalendern i Google — ta bort den och lägg till den igen om namnet spelar roll. Google slänger påminnelser i kalenderfiler, så ställ in standardaviseringar för den kalendern i Googles inställningar, eller hellre: använd OneUptimes egna påminnelser. Google minns en adress som den inte kunde läsa: när du har åtgärdat det som stoppade den lägger du till länken igen med `?nocache=1` på slutet (OneUptime ignorerar okända frågeparametrar, så själva flödet är oförändrat), eller skapar länken på nytt. Google Kalender-appen på Android och iOS kan inte prenumerera via URL; lägg till länken på en dator, så dyker den upp på telefonen.
@tab Outlook på webben
1. Öppna **Kalender** > **Lägg till kalender** > **Prenumerera från webben**.
2. Klistra in `https://`-länken (**Kopiera länk** i OneUptime), ge kalendern ett namn och klicka på **Importera**.

Det fungerar likadant i Outlook.com, Outlook på webben för arbets- och skolkonton, nya Outlook för Windows och Outlook för Mac. Outlook hämtar **från Microsofts servrar**: ungefär var 3:e timme för Outlook.com och var 4:e till 6:e timme för arbets- och skolkonton, ibland mer än ett dygn. Intervallet är fast och det finns ingen manuell uppdatering.

Prenumerera här i stället för i skrivbordsappen om du också vill ha kalendern i telefonen och i Outlook på webben — prenumerationer som skapas i klassiska Outlook för Windows stannar på den datorn.
@tab Klassiska Outlook för Windows
1. Klicka på **Apple Kalender / Outlook** i OneUptime på en dator där Outlook är installerat. Windows lämnar över `webcal://`-länken till Outlook, som frågar om internetkalendern ska läggas till. Utan Outlook har Windows ingen hanterare för `webcal`.
2. Eller öppna **Arkiv** > **Kontoinställningar** > **Kontoinställningar** > **Internetkalendrar** > **Ny** i Outlook, klistra in länken (**Kopiera länk** i OneUptime) och klicka på **Lägg till**.

Öppna **inte** själva `https://…/shifts.ics`-länken i klassiska Outlook: det importerar en engångsögonblicksbild som aldrig uppdateras. Att öppna `webcal://`-länken, eller att lägga till adressen under **Internetkalendrar**, skapar en prenumeration.

Flödet uppdateras vid **Skicka/ta emot** (F9, eller intervallet under Skicka/ta emot-grupper). Prenumerationens inställningar har en kryssruta **Uppdateringsgräns**: när den är markerad uppdaterar Outlook inte oftare än det intervall som utgivaren föreslår. OneUptime föreslår en timme (`X-PUBLISHED-TTL:PT1H`), så flödet uppdateras ungefär varje timme. Flöden utan det tipset uppdateras aldrig medan rutan är markerad; OneUptimes har det, så du kan låta rutan vara markerad. Klassiska Outlook hämtar flödet **från din dator** och validerar serverns certifikat.
@tab Apple Kalender (macOS)
1. Klicka på **Apple Kalender / Outlook** i OneUptime, eller välj **Arkiv** > **Ny kalenderprenumeration** i Kalender och klistra in länken.
2. Ställ in **Uppdatera automatiskt** i prenumerationsbladet — var 5:e minut, var 15:e minut, varje timme, dag eller vecka (varje timme är standard) — och välj **iCloud** under **Plats**, så att kalendern också visas på din iPhone och iPad och fortsätter att uppdateras enligt det schemat.

macOS hämtar flödet **från din Mac**, så det fungerar för en installation på ett privat nätverk så länge Macen kan nå den. Ett självsignerat certifikat eller ett certifikat från en intern CA måste först vara betrott i nyckelringen i macOS. **Ta bort påminnelser** är markerat som standard i det bladet; det spelar ingen roll här, eftersom flödet inte innehåller några alarm.
@tab iPhone och iPad
För att prenumerera på enheten trycker du på **Open in Calendar** i OneUptimes mobilapp, eller går till **Inställningar** > **Kalender** > **Konton** > **Lägg till konto** > **Annat** > **Lägg till prenumererad kalender** och klistrar in länken.

Prenumerationer som skapas på själva enheten uppdateras enligt **Inställningar** > **Kalender** > **Konton** > **Hämta nya data** — **Automatiskt** som standard, vilket mest hämtar under laddning på wifi. För en pålitlig uppdatering prenumererar du på en Mac med **iCloud** som plats, eller ställer in **Hämta nya data** på ett fast intervall.
@tab Thunderbird
Välj **Arkiv** > **Ny** > **Kalender** > **På nätverket** > **iCalendar (ICS)**, klistra in `https://`-länken och välj ett uppdateringsintervall i kalenderns egenskaper: 1, 5, 15, 30 eller 60 minuter. Thunderbird hämtar **från din dator** och måste lita på serverns certifikat.
@tab Android
Varken Google Kalender-appen eller Samsung Kalender kan prenumerera på en URL. Lägg till `https://`-länken i Google Kalender på en dator (**Andra kalendrar** > **+** > **Från webbadress**); kalendern synkroniseras sedan till telefonen tillsammans med allt annat i det Google-kontot. OneUptimes mobilapp på Android erbjuder **Share link** och **Copy https link** just för detta.
@tab Andra tjänster
Fastmail uppdaterar ungefär varje timme och **inaktiverar en prenumeration efter fem misslyckade hämtningar i rad**; om det händer lägger du till den igen när servern fungerar. Proton Calendar uppdaterar var 4:e till 16:e timme och avvisar mycket stora flöden — sänk **Dagar framåt** om den klagar. Confluence Team Calendars tar emot schemaflödet; dess gräns på 28 tecken för kalendernamn respekteras.
:::

## Hur ofta kalendrar uppdateras

| Kalenderapp | Vanlig uppdatering | Hämtar från | Anteckningar |
| --- | --- | --- | --- |
| Google Kalender (Från webbadress) | 8–24 timmar, ibland längre | Googles servrar | Ingen manuell uppdatering; ignorerar uppdateringstips; namn och tidszon läses bara vid första prenumerationen |
| Outlook.com | Ungefär 3 timmar | Microsofts servrar | Fast; kan överstiga 24 timmar |
| Outlook på webben (arbete, skola) | Ungefär 4–6 timmar | Microsofts servrar | Fast; kan inte styras av användaren |
| Klassiska Outlook för Windows | Vid Skicka/ta emot; ungefär varje timme med **Uppdateringsgräns** | Din dator | Prenumerera via `webcal`-länken; synkroniseras inte till telefon eller webb |
| Apple Kalender (macOS) | 5 minuter till varje vecka, standard varje timme | Din Mac | Spara i iCloud för att nå iPhone och iPad |
| Apple Kalender (bara iOS) | Enligt **Hämta nya data**, beroende på batteriet | Din telefon | Prenumerera på en Mac för pålitlighet |
| Thunderbird | 1–60 minuter | Din dator | |
| Fastmail | Ungefär varje timme | Fastmails servrar | Inaktiveras efter fem misslyckade hämtningar |
| Proton Calendar | 4–16 timmar | Protons servrar | Avvisar stora flöden |

OneUptime självt levererar färska data: en ändring av ett lager, en rotation, en åsidosättning eller en koppling till en policy gör flödet ogiltigt direkt, och svar cachelagras i högst fem minuter. Väntan du ser är kalenderappens, inte serverns. OneUptime föreslår uppdatering varje timme via `REFRESH-INTERVAL` och `X-PUBLISHED-TTL`; bara klassiska Outlook följer tipset, och bara med **Uppdateringsgräns** påslaget — Apple Kalender, Thunderbird och de andra uppdaterar med det intervall du anger per kalender.

## https- och webcal-länkar

Båda pekar på samma flöde. `webcal://` är länken med ett annat schema, så att operativsystemet öppnar en kalenderapp i stället för en webbläsare; appen hämtar sedan flödet via `https://` när servern levererar https, som Apple Kalender och Google Kalender gör.

- **Kopiera länk** ger `https://`-formen. **Från webbadress** i Google Kalender, Outlook på webben, Thunderbird och Fastmail tar den.
- **Apple Kalender / Outlook** öppnar `webcal://`-formen: Apple Kalender och klassiska Outlook för Windows prenumererar utifrån den. I klassiska Outlook är det en engångsimport att öppna `https://`-formen i stället.
- **Google Kalender** lägger `webcal://`-formen i Googles länk för att lägga till via URL, den enda form som den sidan tar.
- OneUptime delar inte längre ut `webcals://`: iOS öppnar det inte ("adressen är ogiltig"), och Google tar det inte heller. En kalender som du redan prenumererar på med en `webcals://`-länk fortsätter att fungera.
- Om din installation fortfarande kör på vanlig `http` hämtas flödet i klartext, token inräknad, och instrumentpanelen visar en varning vid länken; byt till `https` innan du delar länkar brett.

Flödes-URL:er omdirigerar aldrig. De svarar `200` på det schema som når OneUptime, eftersom appen inte kan se vilket schema kalenderappen använde när TLS avslutas framför den — på OneUptime Cloud eller bakom din egen lastbalanserare eller CDN — och en omdirigering där pekar tillbaka på samma URL. Skicka vidare vanlig `http` till `https` på den proxy som avslutar TLS, det enda hopp som vet.

## Påminnelser och meddelanden om ny tilldelning

Kalenderappar levererar inte alarm från prenumererade flöden — Google slänger dem, Apple tar bort dem som standard, Outlook plattar till dem — så OneUptime skickar sina egna.

:::steps
1. Öppna **Användarinställningar** > **Kalender** > **Kalenderflöde**.
2. Välj på kortet **Påminn mig före pass** hur lång tid i förväg: **1 vecka**, **1 dag**, **1 timme**, **15 min** eller, med **Anpassad**, ett eget värde mellan 15 minuter och 14 dagar. Du kan välja flera samtidigt.
3. Välj hur påminnelser når dig under **Innan mitt jourpass börjar** på **Användarinställningar** > **Aviseringsinställningar** (fliken Jour). E-post och push är påslagna som standard.
:::

Varje påminnelse skickas en gång per pass. Meddelandet nämner schemat, de policyer det larmar via och starttiden i din tidszon.

- Ett pass som hamnar inom en av dina påminnelsetider på grund av en sen åsidosättning — någon ger dig ett pass 20 minuter innan det börjar — får direkt en enda påminnelse i efterhand.
- Om ett pass som du har fått en påminnelse om ges till någon annan får du **Mitt kommande jourpass tilldelas någon annan**, en separat händelsetyp, så att den kan tystas för sig.
- Påminnelser skickas aldrig efter att ett pass har börjat, och aldrig för scheman som inte är kopplade till någon eskaleringspolicy, eftersom de inte kan larma någon.
- På WhatsApp kommer en påminnelse via Metas förgodkända jourmall, som nämner schemat och eskaleringspolicyn och länkar till schemat men inte innehåller starttiden, och som WhatsApp bara levererar på engelska. Meddelanden om ny tilldelning har ingen godkänd WhatsApp-mall, så de når dig via dina andra kanaler i stället.

## Delade länkar för ett schema eller ett projekt

En delad länk tillhör **projektet**, inte den som kopierade den, och den visar personers namn, aldrig deras e-postadresser. Lägg schemalänken i en delad teamkalender — Google, Outlook eller Confluence — så betjänar en prenumeration hela teamet.

### Schemaflöde

På ett schemas sida har kortet **Prenumerera på det här schemat** två halvor: **Bara mina pass i det här schemat** (din personliga länk med ett schemafilter) och **Allas pass i det här schemat (delad teamlänk)**. Alla med behörigheten **Redigera** för scheman kan använda **Publicera delad länk**, förnya länken med **Skapa länken på nytt** eller stänga av den med **Inaktivera**; alla som kan läsa schemat kan kopiera den. Kortet visar när länken senast förnyades.

### Projektflöde

**Jourtjänst** > **Kalenderflöden** har kortet **Allas pass i det här projektet (delad länk)** — en delad länk som täcker alla scheman i projektet — med samma åtgärder för att publicera, skapa på nytt och inaktivera, och en länk till sidan för ditt personliga flöde.

### Inställningar för delade länkar

Klicka på **Redigera inställningar** på kortet **Inställningar för delad länk**:

| Inställning | Vad den gör |
| --- | --- |
| **Visa täckningsluckor** | Av som standard. Lägger till en händelse `No coverage · <Schedule>` överallt där ett lager _ska_ täcka men ingen har jour: ett tomt lager, ett lager vars startdatum ligger i framtiden, lager som inte passar ihop, eller någon lucka i ett schema som går dygnet runt alla dagar (24×7). Tider utanför kontorstid i ett schema för kontorstid rapporteras aldrig, och högst 100 luckhändelser skickas ut, de äldsta först. |
| **Minsta lucka att visa (minuter)** | Standard 60. Döljer kortare luckor. |
| **Skapa på nytt när någon lämnar projektet** | Av som standard. Skapar länken på nytt automatiskt när någon lämnar sitt sista team i projektet, så att en före detta kollegas kalender slutar uppdateras. Alla andra måste prenumerera igen efteråt, och därför måste man slå på det själv. |
| **Dagar med tidigare pass**, **Dagar framåt** | Som för det personliga flödet. |

Förnya en delad länk när någon som hade den slutar, eller slå på den automatiska förnyelsen ovan.

När en person lämnar sitt sista team i ett projekt tar OneUptime också bort personen från projektets schemalager och eskaleringsregler, tar bort projektets pågående och framtida åsidosättningar som nämner personen (som den som täcks upp för eller som ersättare), inaktiverar personens personliga flöde för projektet och tar bort personens påminnelser där. En personlig länk visar pass bara så länge ägaren är medlem i projektet: det kontrolleras varje gång länken hämtas, så den som har lämnat får en tom kalender, och listan över kommande pass i mobilappen omfattar bara de projekt som personen fortfarande är medlem i.

## Händelser i detalj

- Varje pass har en fast identitet som bildas av schemat och passets start, så samma pass är samma händelse i ditt personliga flöde, i schemaflödet och efter att du har skapat en länk på nytt. Kalenderappar uppdaterar den på plats; en ändring ökar händelsens sekvensnummer.
- En åsidosättning som byter hela passet behåller händelsen och byter person; en åsidosättning som täcker en del av ett pass ger tre händelser som ligger kant i kant, till exempel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- När ett schema är kopplat till två eller fler eskaleringspolicyer och en åsidosättning bara gäller för en av dem, är det olika personer som larmas per policy. Flödet visar det i stället för att dölja det: passet behåller sin händelse för den person som de andra policyerna larmar, med en anteckning som nämner den policy som larmar någon annan, och ersättaren får en extra händelse med titeln `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Pass i det förflutna har raden "Past shifts reflect the current rotation, not who was actually paged" i sin beskrivning.
- Ett schema som inte är kopplat till någon eskaleringspolicy visas ändå, med en anteckning om att det inte kommer att larma någon.

## Planering, inte revision

Flödet visar rotationen **som den är inställd nu**, även för tidigare dagar: en åsidosättning som läggs in i efterhand skriver om historiken i kalendern. För timmar som faktiskt har tillbringats med jour, rättvisegranskningar och ersättning använder du **Jourtjänst** > **Rapporter** > **Användarens jourtid**, som bygger på vad personsökaren faktiskt gjorde.

## Säkerhet

- Token i länken är den enda inloggningsuppgiften. Alla som har länken ser passen — namn, scheman, policyer — tills den skapas på nytt. Klistra inte in länkar i chattrum eller ärenden; när ett team behöver en kalender delar du schema- eller projektlänken i stället för din personliga.
- Länkar är per projekt. En läckt personlig länk avslöjar ett projekts pass, inte alla projekt du tillhör.
- Att skapa en länk på nytt flyttar den gamla token till en frist på 30 dagar (tom kalender, sedan 404). **Inaktivera** levererar en tom kalender. En okänd eller utgången länk ger en ren 404 utan ledtråd. Tomma kalendrar får prenumererande appar att tömma sin kopia; en 404 får dem att behålla den, och därför levererar inaktivering och ny länk tomma kalendrar.
- Token lagras hashade; kopian som visas på inställningssidan är krypterad med `ENCRYPTION_SECRET`. Ställ in den variabeln på en riktig hemlighet i en egen installation — servern varnar vid start när den inte är inställd eller fortfarande är en av platshållarna som det här kodförrådet levererar (`secret`, eller den `please-change-this-to-random-value` som `config.example.env` anger). Om du ändrar den senare erbjuder sidan **Skapa länken på nytt**, eftersom den lagrade kopian inte längre kan läsas; flödet fortsätter att fungera tills du gör det.
- Flödessvar är märkta `Cache-Control: private`, utesluts från sökmotorer (`X-Robots-Tag: noindex`) och har en hastighetsgräns per länk och per klientadress.

OneUptimes egen Nginx håller flödesförfrågningar borta från sina loggar:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Därför hamnar en token aldrig i en loggfil bredvid en klientadress; programmet loggar den inte heller. `access_log off` tar bort raden per förfrågan, `error_log` tar bort de rader som Nginx skriver när en hämtning från uppströmsservern misslyckas — utan den registreras token för varje klient som hämtar under en omstart — och `proxy_max_temp_file_size 0` håller ett stort flöde borta från en temporär fil.

> [!WARNING]
> **Varje proxy, WAF eller CDN som du kör framför OneUptime loggar fortfarande hela URI:n, i sin åtkomstlogg och i sin fellogg,** om du inte konfigurerar den att låta bli — kontrollera det innan du rullar ut flöden.

## Konfiguration för egen drift

Inget behöver slås på: flöden fungerar i alla installationer. Fyra miljövariabler styr dem, inställda i `config.env` för Docker Compose eller under `onCallCalendarFeed` i Helm-värdena (se diagrammets [konfigurationsreferens](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel | Helm-värde | Standard | Effekt |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Nödbrytare. Varje flödes-URL svarar `503` med `Retry-After: 3600`; prenumererande appar behåller sin kopia och försöker igen senare. Inget tas bort. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Längden på fönstret för hastighetsgränsen. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Hämtningar som en länk får göra från en klientadress per fönster. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Hämtningar som en klientadress får göra över alla länkar per fönster — taket för ett helt kontor bakom en adress. |

Också relevant:

- **`HOST` och `HTTP_PROTOCOL`** bygger länkarna. Om `HOST` är tom eller `localhost`, eller om `HTTP_PROTOCOL` är `http`, visar flödessidan en varning och länkarna fungerar inte utifrån. Om `HOST` är en privat adress — `10.x`, `172.16–31.x`, `192.168.x`, ett namn utan punkt som ett containernamn, eller ett namn under `.internal`, `.local`, `.lan` och liknande — säger sidan att Google Kalender och Outlook på webben inte kan nå länken; appar på en dator i samma nätverk kan fortfarande det.
- **`TRUSTED_PROXY_HOPS`** avgör vilken adress som gränsen per adress räknar. Standardvärdet `1` är rätt för de medföljande uppsättningarna för Docker Compose och Helm; lägg till ett för varje egen proxy — en CDN, WAF eller lastbalanserare — som lägger till i `X-Forwarded-For`, annars ser varje kalenderklient ut som samma adress och delar en budget. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i diagrammets dokumentation.
- **Redis** stöder cacharna och hastighetsbegränsaren. Båda faller tillbaka snyggt: utan Redis byggs flöden fortfarande, bara långsammare, och begränsaren släpper igenom förfrågningar.
- I Helm-diagrammets delade läge (`worker.enabled: true`) byggs flöden på API-nivån, så dimensionera den nivån för en topp av kalenderklienter som hämtar vid varje hel timme.
- Undantaget för Nginx-åtkomstloggen ovan är en del av den medföljande `packages/Nginx/default.conf.template`; behåll det om du anpassar mallen.

## Felsökning

:::details Google Kalender säger "Unable to add calendar. Check the URL."
Äldre versioner av OneUptime lade länkens `https://`-form i knappen **Google Kalender**, och Googles sida för att lägga till via URL tar bara `webcal://`-formen. Ladda om flödessidan och klicka på **Google Kalender** igen, eller lägg till länken under **Andra kalendrar** > **+** > **Från webbadress**.
:::

:::details Google Kalender visar kalendern men inga pass
Kontrollera först statusraden på flödessidan. **Senast hämtad … av Google Calendar** betyder att Google har läst länken: öppna länken i en webbläsare och se vad den levererar — en tom kalender anger sin orsak i `X-WR-CALDESC` (se "Kalendern är tom" nedan).

**Inte hämtad ännu** betyder att Google inte kunde läsa den: från en dator utanför ditt nätverk måste `curl -sI <link>` svara `200` med `Content-Type: text/calendar` direkt. En omdirigering, en inloggningssida, en brandvägg eller en robotkontroll framför OneUptime stoppar Googles hämtare; det gjorde också en omdirigeringsslinga i äldre versioner av OneUptime, i installationer med `PROVISION_SSL=true` där TLS avslutas framför Nginx. När den svarar `200` lägger du till länken igen med `?nocache=1` på slutet, så att Google läser den på nytt.
:::

:::details Inget har hämtat länken, eller "Det gick inte att hämta webbadressen"
Google Kalender, Outlook på webben, Fastmail och Proton hämtar **från sina egna servrar**, så OneUptime-värden måste kunna nås från det öppna internet med ett certifikat som de litar på. En installation på ett privat nätverk, bakom en VPN eller med en intern certifikatutfärdare är onåbar för dem, vad du än klistrar in.

Apple Kalender, Thunderbird och klassiska Outlook hämtar från enheten, så de fungerar överallt där enheten kan öppna instrumentpanelen — efter att certifikatet har betrotts på den enheten om det är självsignerat. Statusraden på flödessidan talar om ifall något har hämtat länken ännu; `curl -I` mot länken utanför ditt nätverk är den snabbaste kontrollen:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Att låta OneUptime _nå_ privata nätverk — [Åtkomst till privat nätverk](/docs/self-hosted/private-network-access) — är en annan sak och hjälper inte här.
:::

:::details Kalendern är inaktuell
Läs först uppdateringstabellen: för Google är fördröjningen normal. För att få Google att titta igen tar du bort kalendern och lägger till den igen, eller lägger till `?nocache=1` efter länken (okända parametrar ignoreras, så flödet är oförändrat men Google behandlar det som nytt). Tryck på F9 i klassiska Outlook och kontrollera inställningen **Uppdateringsgräns**. Använd **Visa** > **Uppdatera kalendrar** i Apple Kalender. Om en ändring samma dag spelar roll litar du på OneUptimes påminnelser och meddelanden om ny tilldelning i stället för på kalendern.
:::

:::details Kalendern är tom
En tom kalender är avsiktlig. Det betyder att länken är inaktiverad, är en gammal länk inom sin frist på 30 dagar efter att den skapats på nytt, att projektet ligger under den plan som omfattar jourscheman, eller att du inte längre finns i något schema i det projektet. Öppna länken i en webbläsare: kalenderbeskrivningen (`X-WR-CALDESC`) anger orsaken. Om du har lämnat projektet förblir länken tom: den visar pass bara så länge du är medlem.
:::

:::details Länken svarar 404
Länken är okänd, har tagits bort, eller dess frist har gått ut. Skapa en ny och prenumerera igen.
:::

:::details Länken svarar 503
Antingen är `DISABLE_ON_CALL_CALENDAR_FEED` inställd, eller så är servern upptagen: högst några få flöden byggs åt gången, och ett schema som tar mycket lång tid att räkna ut avbryts. När det finns en tidigare kopia av flödet levererar servern den i stället, med en `Warning: 110`-rubrik, så en 503 betyder att det inte fanns något att falla tillbaka på. Klienter behåller sin senaste kopia och försöker igen efter intervallet i `Retry-After`. Fastmail inaktiverar en prenumeration efter fem fel i rad; lägg till den igen när servern fungerar. Måttet `oncall_calendar_render_duration_ms` visar driftpersonalen vilka flöden som är långsamma.
:::

:::details 429 eller "too many requests"
Många klienter bakom en adress — ett kontors-NAT, en VPN-gateway — delar budgeten per adress. Höj `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` och kontrollera `TRUSTED_PROXY_HOPS`: när den är för låg tillskrivs varje klient din egen proxy, och alla delar en budget.
:::

:::details Certifikatfel i Apple Kalender, Thunderbird eller Outlook
De här apparna validerar TLS på enheten. Importera din interna CA i enhetens förtroendearkiv — nyckelringen i macOS, certifikatarkivet i Windows, certifikathanteraren i Thunderbird — eller använd ett offentligt betrott certifikat. Hämtare på serversidan, som Googles och Microsofts, kan inte fås att lita på en privat CA.
:::

:::details Tiderna är fel
Alla tider i filen är UTC; kalenderappen räknar om till sin egen zon. Om passen ser förskjutna ut med en fast skillnad kontrollerar du schemats tidszon (**Schedule timezone** på dess sida **Lager**) och din egen (**Tidszon** på din **Profil**). Ett schema utan tidszon räknas ut i serverns zon, och händelsen säger det.
:::

:::details Flödet säger att det har kortats
Fler än 5 000 händelser föll inom fönstret. Sänk **Dagar framåt**, eller prenumerera på **Bara mina pass i det här schemat** i stället för ett helt projekt.
:::

:::details Google visar ett gammalt kalendernamn
Google läser namnet bara vid första prenumerationen; ta bort kalendern och lägg till den igen.
:::

:::details Inställningssidan säger att länken måste skapas på nytt
`ENCRYPTION_SECRET` har ändrats sedan länken skapades, så servern kan inte längre visa den. Den befintliga prenumerationen fortsätter att fungera; att skapa länken på nytt ger dig en länk som du kan kopiera igen och drar tillbaka den gamla efter 30 dagar.
:::

:::details Ett pass saknas i mitt flöde
Bara pass från scheman visas; direkta tilldelningar av användare eller team i en policyregel är fasta och har inga händelser. Ett pass som någon annan har tagit över via en åsidosättning försvinner från ditt flöde, eftersom det nu finns i deras. Slå på **Inkludera pass jag täcker för andra** för att se pass som du har fått via åsidosättningar i scheman som du inte är medlem i.
:::

## Nästa steg

:::cards
- [Jourscheman](/docs/on-call/schedules): Ställ in de rotationer som dina flöden visar.
- [Tidslinje för jourscheman](/docs/on-call/schedule-timeline): Se alla scheman sida vid sida i instrumentpanelen.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Koppla scheman till policyer så att deras pass larmar personer.
:::
