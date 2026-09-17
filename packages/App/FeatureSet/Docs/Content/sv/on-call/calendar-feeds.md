# Kalenderflöden (jourpass i Google Kalender, Outlook och Apple Kalender)

Kalenderflöden lägger in dina jourpass i den kalender du redan tittar i. OneUptime publicerar en hemlig iCalendar-länk (`.ics`) för varje person, varje schema och varje projekt; Google Kalender, Outlook, Apple Kalender, Thunderbird och alla andra appar som kan prenumerera på en kalender via URL hämtar länken regelbundet och visar en händelse per pass. Inget installeras och inget konto kopplas: länken är hela integrationen.

> **Note:** En prenumererad kalender är till för **planering**. Kalenderappar hämtar om flöden i sin egen takt — Google Kalender bara var 8:e till 24:e timme — så ett byte som görs en timme före ett pass når dig via OneUptimes egna påminnelser, omfördelningsnotiser och sökarnotiser, inte via kalendern.

## Vad du får

- En händelse per pass, med titeln `On-call · <Schedule>` (med ` · <Policy>` tillagt när schemat är kopplat till exakt en eskaleringspolicy) i ditt personliga flöde och `<Name> · On-call · <Schedule>` i ett delat flöde. Beskrivningen anger vem som har jour, schemat och dess tidszon, lagret, passet i schemats zon, i UTC och i din zon, vilka eskaleringspolicyer som söker dig via detta schema, och en länk till schemat i instrumentpanelen.
- Åsidosättningar respekteras. När någon täcker för dig flyttas händelsen till den personen (`(covering for <Name>)` läggs till) och förblir samma händelse i din kalenderapp, så den uppdateras på plats i stället för att dubbleras. En delvis åsidosättning delar passet i angränsande händelser.
- Två dagars historik och 90 dagar framåt som standard. Du kan utöka till 60 dagar bakåt och 180 dagar framåt; ett flöde som skulle överstiga 5 000 händelser förkortas och säger det i sin kalenderbeskrivning.
- Händelser markeras som lediga (`TRANSP:TRANSPARENT`), så ett prenumererat flöde blockerar aldrig din tillgänglighet, och inget markeras som privat, så en delad teamkalender visar titlarna för alla som kan se den.
- Tider skickas i UTC och konverteras av din kalenderapp; beskrivningen anger klockslaget i schemats zon och i din. Ställ in din egen tidszon under **Användarinställningar** > **Profil** och schemats under dess flik **Inställningar**. Ett schema utan tidszon expanderas i serverns zon, precis som vid sökning, och händelsen säger det.

Fasta tilldelningar — en användare eller ett team som namnges direkt i en regel i en eskaleringspolicy — har varken start eller slut och visas inte i något flöde. På OneUptime Cloud följer flöden samma plan som jourscheman (Growth); ett projekt under den planen får en tom kalender i stället för ett fel.

## Tre slags länkar

| Länk                 | Vem skapar den                                                              | Vad den innehåller                                                                        | Var                                                   |
| -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Personligt flöde** | Varje användare, ett per projekt                                            | Dina pass på alla scheman i det projektet, plus passen där du täcker för någon (valfritt) | **Användarinställningar** > **Kalenderflöde**         |
| **Schemaflöde**      | Alla som kan redigera schemat; alla som kan läsa det får kopiera länken     | Allas pass på ett schema, med valfria händelser för täckningsluckor                       | Schemats sida, kortet **Prenumerera på detta schema** |
| **Projektflöde**     | Alla som kan redigera jourscheman; alla som kan läsa dem får kopiera länken | Allas pass på alla scheman i projektet, med valfria händelser för täckningsluckor         | **Jourtjänst** > **Kalenderflöden**                   |

Länkarna ser ut så här:

```
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

Token på 43 tecken i sökvägen är den enda inloggningsuppgiften — ingen inloggning, cookie eller API-nyckel är inblandad. Behandla var och en av dessa länkar som ett lösenord.

## Ditt personliga flöde

1. Öppna **Användarinställningar** > **Kalenderflöde** i det projekt vars pass du vill ha. Personliga flöden är per projekt: ett andra projekt får en andra länk och en andra kalender.
2. Klicka på **Generera kalenderlänk**. Kortet **Prenumerera på dina jourpass** visar nu `https://`-länken och tre knappar:
   - **Google Kalender** öppnar Google Kalender med länken ifylld.
   - **Apple / andra appar** öppnar länkens `webcals://`-form, som macOS, iOS och de flesta skrivbordsappar skickar direkt till sin prenumerationsdialog.
   - **Kopiera webcal-länk** kopierar samma `webcal(s)://`-länk — den som klassiska Outlook för Windows behöver.
3. Prenumerera i din kalenderapp enligt stegen per app nedan.

Inställningar på samma kort:

- **Inkludera pass jag täcker för andra** (på som standard) lägger till de pass en åsidosättning ger dig på scheman du annars inte är medlem i.
- **Dagar med tidigare pass** (standard 2, högst 60) och **Dagar framåt** (standard 90, mellan 7 och 180).

Statusraden visar när länken senast hämtades, av vilken kalenderapp, hur många gånger, och tokens fyra sista tecken så att du kan skilja länkar åt. Om inget har hämtat länken efter två dagar frågar sidan om servern går att nå från internet (se Felsökning).

Sidan listar också dina **Kommande pass** (de närmaste 30 dagarna), vart och ett med en länk **Hitta ersättare** som öppnar användaråsidosättningar förifyllda för det passet, och kortet **Påminn mig före pass** som beskrivs längre ner.

Åtgärder:

- **Generera om länk** skapar en ny token. Varje app som prenumererar på den gamla länken slutar uppdateras: i 30 dagar levererar den gamla länken en tom kalender så att de apparna rensar sin kopia, därefter returnerar den 404. Prenumerera på nytt med den nya länken.
- **Inaktivera** behåller länken men levererar en tom kalender tills du aktiverar den igen.
- **Ta bort** tar bort länken. Appar som fortfarande hämtar den får 404 och fortsätter visa det de senast hämtade — inaktivera först om du vill att de ska tömmas.

Samma personliga länk, filtrerad till ett schema med `?schedule=<id>`, erbjuds som **Bara mina pass på detta schema** på varje schemas sida, och jourbannern och sidan **Mina jourpolicyer** har en länk **Lägg till dina pass i din kalender** till sidan ovan.

I mobilappen: **Jour** > **Lägg till pass i min kalender** (även under **Inställningar** > **Kalenderflöde**), med en länk per projekt. På iPhone öppnar **Öppna i Kalender** det inbyggda prenumerationsarket. På Android går det inte att prenumerera på en URL på telefonen, så skärmen erbjuder **Dela länk** och **Kopiera https-länk** och ber dig lägga till länken på en dator, varefter den synkas till telefonen. Appens lista **Dina pass** kommer från samma data och har samma åtgärd **Hitta ersättare**.

## Prenumerera i din kalenderapp

Använd `https://`-länken om inte appen ber om `webcal`; avsnittet om scheman nedan förklarar skillnaden.

### Google Kalender (webb)

1. I Google Kalender på webben, bredvid **Andra kalendrar**, klicka på **+** > **Från webbadress**.
2. Klistra in `https://`-länken och klicka på **Lägg till kalender**. Knappen **Google Kalender** i OneUptime gör samma sak med länken ifylld.

Google hämtar flödet **från Googles servrar**, ungefär var 8:e till 24:e timme och ibland mer sällan. Det finns ingen uppdateringsknapp för prenumererade kalendrar, och Google ignorerar uppdateringstipsen i flödet. Kalenderns namn och tidszon läses **bara när du först prenumererar**: byter du namn på ett schema senare byter kalendern i Google inte namn — ta bort och lägg till den igen om namnet spelar roll. Google slänger påminnelser som följer med i kalenderfiler, så ställ in standardaviseringar för den kalendern i Googles inställningar, eller ännu hellre, använd OneUptimes egna påminnelser. Om Google rapporterar att URL:en inte kunde hämtas, kontrollera att du klistrade in `https://`-formen och inte `webcal://`, och lägg till `?nocache=1` för att få den att titta igen (OneUptime ignorerar okända frågeparametrar, så flödet i sig är oförändrat). Google Kalender-appen på Android och iOS kan inte prenumerera via URL; lägg till länken på en dator så dyker den upp på telefonen.

### Outlook på webben och Outlook.com

1. Öppna **Kalender** > **Lägg till kalender** > **Prenumerera från webben**.
2. Klistra in `https://`-länken, ge kalendern ett namn och klicka på **Importera**.

Outlook hämtar **från Microsofts servrar**: ungefär var tredje timme för Outlook.com och var 4:e till 6:e timme för jobb- och skolkonton, ibland mer än ett dygn. Intervallet är fast och det finns ingen manuell uppdatering. Prenumerera här i stället för i skrivbordsappen om du vill ha kalendern på telefonen och i Outlook på webben också — prenumerationer som skapas i klassiska Outlook för Windows stannar på den datorn. Nya Outlook för Windows och Outlook för Mac använder samma dialog **Lägg till kalender** > **Prenumerera från webben**.

### Klassiska Outlook för Windows

1. Klicka på **Kopiera webcal-länk** i OneUptime.
2. I Outlook öppnar du **Arkiv** > **Kontoinställningar** > **Kontoinställningar** > **Internetkalendrar** > **Ny**, klistrar in `webcals://`-länken och klickar på **Lägg till**. Att öppna en `webcal`-länk i en webbläsare fungerar också på en dator där Outlook är installerat; Windows har annars ingen `webcal`-hanterare.

Öppna **inte** själva `https://…/shifts.ics`-länken i klassiska Outlook: den importerar en engångsögonblicksbild som aldrig uppdateras. Bara `webcal://` och `webcals://` skapar en prenumeration.

Flödet uppdateras vid **Skicka/ta emot** (F9, eller intervallet under Skicka/ta emot-grupper). Prenumerationens inställningar har en kryssruta **Uppdateringsgräns**: med den ikryssad uppdaterar Outlook inte oftare än det intervall utgivaren föreslår. OneUptime föreslår en timme (`X-PUBLISHED-TTL:PT1H`), så flödet uppdateras ungefär varje timme. Flöden utan det tipset uppdateras aldrig så länge rutan är ikryssad; OneUptimes flöden har det, så du kan låta rutan vara på. Klassiska Outlook hämtar flödet **från din dator** och validerar serverns certifikat.

### Apple Kalender på macOS

1. Klicka på **Apple / andra appar** i OneUptime, eller välj **Arkiv** > **Ny kalenderprenumeration** i Kalender och klistra in länken.
2. I prenumerationsarket ställer du in **Uppdatera automatiskt** — var 5:e minut, var 15:e minut, varje timme, dag eller vecka (varje timme är standard) — och väljer **iCloud** under **Plats** så att kalendern också visas på din iPhone och iPad och fortsätter uppdateras enligt det schemat.

macOS hämtar flödet **från din Mac**, så det fungerar för en installation på ett privat nätverk så länge datorn når den. Ett självsignerat certifikat eller ett från en intern CA måste först betros i macOS nyckelhanterare. **Ta bort påminnelser** är ikryssat som standard i det arket; det spelar ingen roll här eftersom flödet inte innehåller några alarm.

### iPhone och iPad

Prenumerationer som skapas på själva enheten uppdateras enligt **Inställningar** > **Kalender** > **Konton** > **Hämta nya data** — **Automatiskt** som standard, vilket mest hämtar under laddning på Wi-Fi. För pålitlig uppdatering, prenumerera på en Mac med **iCloud** som plats, eller sätt **Hämta nya data** till ett fast intervall. För att prenumerera på enheten trycker du på **Öppna i Kalender** i OneUptimes mobilapp, eller går till **Inställningar** > **Kalender** > **Konton** > **Lägg till konto** > **Annat** > **Lägg till prenumererad kalender** och klistrar in länken.

### Thunderbird

Välj **Arkiv** > **Ny** > **Kalender** > **På nätverket** > **iCalendar (ICS)**, klistra in `https://`-länken och välj ett uppdateringsintervall i kalenderns egenskaper: 1, 5, 15, 30 eller 60 minuter. Thunderbird hämtar **från din dator** och måste lita på serverns certifikat.

### Fastmail, Proton och andra tjänster

Fastmail uppdaterar ungefär varje timme och **inaktiverar en prenumeration efter fem misslyckade hämtningar i rad**; händer det, lägg till den igen när servern är frisk. Proton Calendar uppdaterar var 4:e till 16:e timme och avvisar mycket stora flöden — minska **Dagar framåt** om den klagar. Confluence Team Calendars accepterar schemaflödet; dess gräns på 28 tecken för kalendernamn respekteras.

### Android

Varken Google Kalender-appen eller Samsung Kalender kan prenumerera på en URL. Lägg till `https://`-länken i Google Kalender på en dator (**Andra kalendrar** > **+** > **Från webbadress**); kalendern synkas sedan till telefonen tillsammans med allt annat i det Google-kontot. OneUptimes mobilapp på Android erbjuder **Dela länk** och **Kopiera https-länk** just för detta.

## Hur ofta kalendrar uppdateras

| Kalenderapp                       | Typisk uppdatering                                                | Hämtar från        | Anteckningar                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Google Kalender (Från webbadress) | 8–24 timmar, ibland längre                                        | Googles servrar    | Ingen manuell uppdatering; ignorerar uppdateringstips; namn och tidszon läses bara vid första prenumerationen |
| Outlook.com                       | Cirka 3 timmar                                                    | Microsofts servrar | Fast; kan överstiga 24 timmar                                                                                 |
| Outlook på webben (jobb, skola)   | Cirka 4–6 timmar                                                  | Microsofts servrar | Fast; ingen användarkontroll                                                                                  |
| Klassiska Outlook för Windows     | Vid Skicka/ta emot; ungefär varje timme med **Uppdateringsgräns** | Din dator          | Behöver en `webcal`-länk; synkas inte till telefon eller webb                                                 |
| Apple Kalender (macOS)            | 5 minuter till varje vecka, standard varje timme                  | Din Mac            | Lagra i iCloud för att nå iPhone och iPad                                                                     |
| Apple Kalender (endast iOS)       | Enligt **Hämta nya data**, batteristyrt                           | Din telefon        | Prenumerera på en Mac för pålitlighet                                                                         |
| Thunderbird                       | 1–60 minuter                                                      | Din dator          |                                                                                                               |
| Fastmail                          | Cirka varje timme                                                 | Fastmails servrar  | Inaktiveras efter fem misslyckade hämtningar                                                                  |
| Proton Calendar                   | 4–16 timmar                                                       | Protons servrar    | Avvisar stora flöden                                                                                          |

OneUptime självt levererar färska data: en ändring av ett lager, en rotation, en åsidosättning eller en policykoppling ogiltigförklarar flödet omedelbart, och svar cachas i högst fem minuter. Väntetiden du ser är kalenderappens, inte serverns. OneUptime föreslår uppdatering varje timme via `REFRESH-INTERVAL` och `X-PUBLISHED-TTL`; bara klassiska Outlook tar tipset, och bara med **Uppdateringsgräns** påslagen — Apple Kalender, Thunderbird och de övriga uppdaterar med det intervall du själv väljer per kalender.

## https, webcal och webcals

Alla tre pekar på samma flöde. `webcal://` och `webcals://` är `http://`- och `https://`-länken med schemat omdöpt, så att operativsystemet öppnar en kalenderapp i stället för en webbläsare; `webcals` är den krypterade varianten och den OneUptime erbjuder när `HTTP_PROTOCOL` är `https`.

- Google Kalender, Outlook på webben, Thunderbird och Fastmail vill ha `https://`-formen.
- Apple Kalender och klassiska Outlook för Windows prenumererar från en `webcal(s)://`-länk; i klassiska Outlook är `https://`-formen en engångsimport.
- `webcal://` utan `s` är okrypterat och skickar token i klartext vid varje hämtning. Om din installation fortfarande kör på vanlig `http` visar instrumentpanelen en varning bredvid länken; byt till `https` innan du delar länkar brett.

## Påminnelser och omfördelningsnotiser

Kalenderappar levererar inte alarm från prenumererade flöden — Google slänger dem, Apple tar bort dem som standard, Outlook plattar till dem — så OneUptime skickar sina egna.

På **Användarinställningar** > **Kalenderflöde** låter kortet **Påminn mig före pass** dig välja framförhållning: **1 vecka**, **1 dag**, **1 timme**, **15 min** eller ett eget värde mellan 15 minuter och 14 dagar, flera samtidigt. Varje påminnelse skickas en gång per pass via de leveranssätt du valt för **Innan mitt jourpass börjar** på **Användarinställningar** > **Aviseringsinställningar** (fliken Jour; e-post och push är på som standard). Meddelandet anger schemat, policyerna det söker via och starttiden i din tidszon.

- Ett pass som hamnar inom en av dina framförhållningar på grund av en sen åsidosättning — någon lämnar över ett pass 20 minuter innan det börjar — får en enda ikapp-påminnelse direkt.
- Om ett pass du fått påminnelse om lämnas över till någon annan får du **Mitt kommande jourpass har omfördelats**, en separat händelsetyp så att den kan tystas för sig.
- Påminnelser skickas aldrig efter att ett pass har börjat, och aldrig för scheman som inte är kopplade till någon eskaleringspolicy, eftersom de inte kan söka någon.
- På WhatsApp kommer en påminnelse via Metas förhandsgodkända jourmall, som nämner schemat och eskaleringspolicyn och länkar till schemat men inte innehåller starttiden, och som WhatsApp bara levererar på engelska. Meddelanden om omfördelning har ingen godkänd WhatsApp-mall och når dig därför via dina andra kanaler.

## Delade länkar för ett schema eller ett projekt

En delad länk tillhör **projektet**, inte den som kopierade den, och den visar personers namn, aldrig deras e-postadresser.

**Schemaflöde.** På ett schemas sida har kortet **Prenumerera på detta schema** två halvor: **Bara mina pass på detta schema** (din personliga länk med ett schemafilter) och **Allas pass på detta schema (delad teamlänk)**. Alla med behörigheten **Redigera** för scheman kan **Publicera delad länk**, **Generera om** eller **Inaktivera** den; alla som kan läsa schemat kan kopiera den. Kortet visar när länken senast roterades.

**Projektflöde.** **Jourtjänst** > **Kalenderflöden** innehåller kortet **Allas pass i detta projekt (delad länk)** — en delad länk som täcker varje schema i projektet — med samma åtgärder för publicering, omgenerering och inaktivering, och en länk till din personliga flödessida.

Inställningar på båda:

- **Visa täckningsluckor** (av som standard) lägger till en händelse `No coverage · <Schedule>` överallt där ett lager _ska_ täcka men ingen har jour: ett tomt lager, ett lager vars startdatum ligger i framtiden, lager som inte passar ihop, eller vilket hål som helst i ett 24×7-schema. Icke-arbetstid i ett kontorstidsschema rapporteras aldrig. **Minsta lucka att visa (minuter)** (standard 60) döljer kortare hål; högst 100 luckhändelser skapas, äldst först.
- **Generera om när någon lämnar projektet** (av som standard) genererar om länken automatiskt när någon lämnar sitt sista team i projektet, så att en före detta kollegas kalender slutar uppdateras. Alla andra måste prenumerera på nytt efteråt, vilket är varför den är valfri.
- **Dagar med tidigare pass** och **Dagar framåt**, som i det personliga flödet.

Lägg schemalänken i en delad teamkalender — Google, Outlook eller Confluence — så tjänar en prenumeration hela teamet. Rotera den när någon som hade den slutar, eller slå på den automatiska rotationen ovan.

När en person lämnar sitt sista team i ett projekt tar OneUptime också bort personen från projektets schemalager och eskaleringsregler, tar bort projektets pågående och framtida åsidosättningar som nämner personen (antingen som den som täcks eller som ersättare), inaktiverar personens personliga flöde för projektet och tar bort personens påminnelser där.

## Händelser i detalj

- Varje pass har en stabil identitet bildad av schemat och passets start, så samma pass är samma händelse i ditt personliga flöde, i schemaflödet och efter att du genererat om en länk. Kalenderappar uppdaterar den på plats; en ändring höjer händelsens sekvensnummer.
- En åsidosättning som byter hela passet behåller händelsen och byter person; en åsidosättning som täcker en del av ett pass ger tre angränsande händelser, till exempel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- När ett schema är kopplat till två eller fler eskaleringspolicyer och en åsidosättning bara gäller en av dem skiljer sig de som söks åt per policy. Flödet visar detta i stället för att dölja det: passet behåller sin händelse för den person som de andra policyerna söker, med en notering som namnger den policy som söker någon annan, och ersättaren får en extra händelse med titeln `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Pass i det förflutna har raden "Past shifts reflect the current rotation, not who was actually paged" i sin beskrivning.
- Ett schema som inte är kopplat till någon eskaleringspolicy visas ändå, med en notering om att det inte söker någon.

## Planering, inte revision

Flödet visar rotationen **som den är konfigurerad nu**, även för gångna dagar: en åsidosättning som matas in i efterhand skriver om historiken i kalendern. För faktiskt jourade timmar, rättviseöversyner och ersättning använder du **Jourtjänst** > **Rapporter** > **Användarens jourtid**, som skrivs utifrån vad sökaren faktiskt gjorde.

## Säkerhet

- Token i länken är den enda inloggningsuppgiften. Alla som har länken ser passen — namn, scheman, policyer — tills den genereras om. Klistra inte in länkar i chattrum eller ärenden; när ett team behöver en kalender, dela schema- eller projektlänken i stället för din personliga.
- Länkar är per projekt. En läckt personlig länk avslöjar ett projekts pass, inte alla projekt du tillhör.
- **Generera om** flyttar den gamla token till en 30 dagars respitperiod (tom kalender, sedan 404). **Inaktivera** levererar en tom kalender. En okänd eller utgången länk returnerar en ren 404 utan ledtråd. Tomma kalendrar får prenumererande appar att rensa sin kopia; en 404 får dem att behålla den, vilket är varför inaktivering och omgenerering levererar tomma kalendrar.
- Token lagras hashade; kopian som visas på inställningssidan är krypterad med `ENCRYPTION_SECRET`. Sätt den variabeln till en riktig hemlighet på en självhostad installation — servern varnar vid start när den är osatt eller fortfarande är en av platshållarna som det här repot levererar (`secret`, eller den `please-change-this-to-random-value` som `config.example.env` sätter). Om du ändrar den senare erbjuder sidan **Generera om länk** eftersom den lagrade kopian inte längre kan läsas; flödet fortsätter fungera tills du gör det.
- Flödessvar markeras med `Cache-Control: private`, utesluts från sökmotorer (`X-Robots-Tag: noindex`) och hastighetsbegränsas per länk och per klientadress.
- OneUptimes egen Nginx håller flödesförfrågningar borta från sina loggar:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      error_log /dev/null crit;
      proxy_max_temp_file_size 0;
      ...
  }
  ```

  så en token hamnar aldrig i en loggfil bredvid en klientadress; applikationen loggar den inte heller. `access_log off` tar bort raden per förfrågan, `error_log` tar bort raderna Nginx skriver när ett anrop till applikationen misslyckas — utan den skrivs token ner för varje klient som hämtar flödet under en omstart — och `proxy_max_temp_file_size 0` håller ett stort flöde borta från en temporär fil. **Alla proxyer, WAF:er eller CDN:er du kör framför OneUptime loggar fortfarande hela URI:n, både i sin åtkomstlogg och i sin fellogg** om du inte konfigurerar dem att låta bli — kontrollera det innan du rullar ut flöden.

## Konfiguration för självhostning

Inget behöver slås på: flöden fungerar på varje installation. Fyra miljövariabler styr dem, satta i `config.env` för Docker Compose eller under `onCallCalendarFeed` i Helm-värdena (se diagrammets [konfigurationsreferens](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel                                                | Helm-värde                                       | Standard | Effekt                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`  | Nödstopp. Varje flödes-URL svarar `503` med `Retry-After: 3600`; prenumererande appar behåller kopian de har och försöker igen senare. Inget tas bort. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`     | Hastighetsbegränsningsfönstrets längd.                                                                                                                 |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`     | Hämtningar en länk får göra från en klientadress per fönster.                                                                                          |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`   | Hämtningar en klientadress får göra över alla länkar per fönster — taket för ett helt kontor bakom en adress.                                          |

Också relevant:

- **`HOST` och `HTTP_PROTOCOL`** bygger länkarna. Om `HOST` är tomt eller `localhost`, eller `HTTP_PROTOCOL` är `http`, visar flödessidan en varning och länkarna fungerar inte utifrån.
- **`TRUSTED_PROXY_HOPS`** avgör vilken adress gränsen per adress räknar. Standardvärdet `1` är rätt för de standardmässiga Docker Compose- och Helm-uppsättningarna; lägg till ett för varje egen proxy — ett CDN, en WAF eller en lastbalanserare — som lägger till i `X-Forwarded-For`, annars ser varje kalenderklient ut som samma adress och delar en budget. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i diagrammets dokumentation.
- **Redis** backar cacharna och hastighetsbegränsaren. Båda degraderar mjukt: utan Redis renderas flöden ändå, bara långsammare, och begränsaren släpper igenom förfrågningar.
- I Helm-diagrammets delade läge (`worker.enabled: true`) renderas flöden på API-nivån, så dimensionera den nivån för en skur av kalenderklienter som pollar vid hel timme.
- Undantaget från Nginx åtkomstlogg som visas ovan är en del av den medföljande `Nginx/default.conf.template`; behåll det om du anpassar mallen.

## Felsökning

**Inget har hämtat länken, eller "Kunde inte hämta URL:en".** Google Kalender, Outlook på webben, Fastmail och Proton hämtar **från sina egna servrar**, så OneUptime-värden måste gå att nå från det publika internet med ett certifikat de litar på. En installation på ett privat nätverk, bakom en VPN eller med en intern certifikatutfärdare går inte att nå för dem oavsett vad du klistrar in. Apple Kalender, Thunderbird och klassiska Outlook hämtar från enheten, så de fungerar överallt där enheten kan öppna instrumentpanelen — efter att certifikatet betrotts på den enheten om det är självsignerat. Flödessidans statusrad talar om huruvida något har hämtat länken än; `curl -I` mot länken utanför ditt nätverk är den snabbaste kontrollen. Att låta OneUptime _nå_ privata nätverk — [Private Network Access](/docs/self-hosted/private-network-access) — är en annan sak och hjälper inte här.

**Kalendern är inaktuell.** Läs först uppdateringstabellen: för Google är fördröjningen normal. För att få Google att titta igen, ta bort och lägg till kalendern igen eller lägg till `?nocache=1` till länken (okända parametrar ignoreras, så flödet är oförändrat men Google behandlar det som nytt). I klassiska Outlook, tryck F9 och kontrollera inställningen **Uppdateringsgräns**. I Apple Kalender, använd **Innehåll** > **Uppdatera kalendrar**. Om en ändring samma dag spelar roll, lita på OneUptimes påminnelser och omfördelningsnotiser snarare än på kalendern.

**Kalendern är tom.** En tom kalender är avsiktlig. Det betyder att länken är inaktiverad, är en gammal länk inom sin 30 dagars respitperiod efter omgenerering, att projektet ligger under planen som omfattar jourscheman, eller att du inte längre finns på något schema i det projektet. Öppna länken i en webbläsare: kalenderbeskrivningen (`X-WR-CALDESC`) anger orsaken.

**404.** Länken är okänd, har tagits bort eller dess respitperiod har gått ut. Generera en ny och prenumerera på nytt.

**503.** Antingen är `DISABLE_ON_CALL_CALENDAR_FEED` satt, eller så är servern upptagen: bara några få flöden renderas åt gången, och ett schema som tar mycket lång tid att expandera klipps av. När en tidigare kopia av flödet finns levererar servern den i stället, med en `Warning: 110`-rubrik, så en 503 betyder att det inte fanns något att falla tillbaka på. Klienter behåller sin senaste kopia och försöker igen efter `Retry-After`-intervallet. Fastmail inaktiverar en prenumeration efter fem misslyckanden i rad; lägg till den igen när servern är frisk. Måttet `oncall_calendar_render_duration_ms` visar driftansvariga vilka flöden som är långsamma.

**429 eller "för många förfrågningar".** Många klienter bakom en adress — ett kontors-NAT, en VPN-gateway — delar budgeten per adress. Höj `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, och kontrollera `TRUSTED_PROXY_HOPS`: när det är för lågt tillskrivs varje klient din egen proxy och alla delar en budget.

**Certifikatfel i Apple Kalender, Thunderbird eller Outlook.** Dessa appar validerar TLS på enheten. Importera din interna CA i enhetens förtroendearkiv — macOS nyckelhanterare, Windows certifikatarkiv, Thunderbirds certifikathanterare — eller använd ett publikt betrott certifikat. Serverbaserade hämtare som Google och Microsoft kan inte fås att lita på en privat CA.

**Tiderna är fel.** Alla tider i filen är UTC; kalenderappen konverterar till sin egen zon. Om passen ser förskjutna ut med en fast förskjutning, kontrollera schemats tidszon (dess flik **Inställningar**) och din egen (**Användarinställningar** > **Profil**). Ett schema utan tidszon expanderas i serverns zon och händelsen säger det.

**Flödet säger att det förkortades.** Fler än 5 000 händelser hamnade inom fönstret. Minska **Dagar framåt**, eller prenumerera på **Bara mina pass på detta schema** i stället för ett helt projekt.

**Google visar ett gammalt kalendernamn.** Google läser namnet bara vid första prenumerationen; ta bort och lägg till kalendern igen.

**Inställningssidan säger att länken behöver genereras om.** `ENCRYPTION_SECRET` ändrades sedan länken skapades, så servern kan inte längre visa den. Den befintliga prenumerationen fortsätter fungera; omgenerering ger dig en länk du kan kopiera igen och pensionerar den gamla efter 30 dagar.

**Ett pass saknas i mitt flöde.** Bara schemapass visas; direkta användar- eller teamtilldelningar i en policyregel är fasta och har inga händelser. Ett pass som någon annan tagit över via en åsidosättning lämnar ditt flöde eftersom det nu finns i deras. Slå på **Inkludera pass jag täcker för andra** för att se pass du fått via åsidosättningar på scheman du inte är medlem i.
