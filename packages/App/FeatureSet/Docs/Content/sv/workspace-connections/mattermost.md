# Mattermost

Anslut OneUptime till din Mattermost-server för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler, ge varje incident en egen kanal och låta responders bekräfta, lösa, lägga till anteckningar och ändra tillstånd utan att lämna Mattermost.

:::cards
- [Anslut Mattermost](#anslut-mattermost): Skapa ett botkonto för OneUptime och anslut sedan projektet med dess token.
- [Anslut ditt eget konto](#anslut-ditt-eget-mattermost-konto): Länka ditt Mattermost-konto till ditt OneUptime-konto.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Vem som är i en posts kanal](#vem-som-är-i-en-posts-kanal): Se vem som är med, gå med och lägg till personer, från postens sida.
- [Agera från Mattermost](#agera-på-incidenter-larm-och-händelser-från-mattermost): Knapparna i OneUptimes meddelanden.
- [Nätverk och egen drift](#nätverk-och-egen-drift): Vad varje server måste kunna nå.
:::

## Så fungerar det

```mermaid title="Från en händelse i OneUptime till ett meddelande i Mattermost"
flowchart TB
    event["En incident, ett larm eller en händelse<br/>skapas eller ändras"] --> rules{"Aviseringsregler<br/>vars villkor matchar"}
    rules -->|"En kanal<br/>för varje"| own["En egen kanal,<br/>med dess personer tillagda allteftersom de tillkommer"]
    rules -->|"Publicera i befintliga kanaler"| existing["Dina befintliga kanaler"]
    own --> message["Ett meddelande med knappar"]
    existing --> message
    message -->|"En responder trycker på en"| change["Ändringen görs i OneUptime,<br/>som den respondern"]
```

Två anslutningar får det här att fungera:

- **Projektets anslutning**, gjord en gång: ett botkonto på din Mattermost-server, i de team där OneUptime publicerar. Det publicerar meddelandena, skapar kanalerna och lägger till personer i dem.
- **Varje persons egen anslutning**: personens Mattermost-konto länkat till personens OneUptime-konto. Knappar agerar som den personen, med personens behörigheter i projektet.

Ett Mattermost-team kan vara anslutet till mer än ett projekt, till exempel produktion och staging. En knapp agerar i projektet för den post som dess meddelande gäller.

## Innan du börjar

- **En roll som får ansluta projektet:** **Projektägare**, **Projektadministratör** eller **Projektmedlem**. Att koppla från kräver **Projektägare** eller **Projektadministratör**.
- **En Mattermost-server** där du får skapa ett botkonto, eller en Mattermost-administratör som kan skapa ett åt dig. Både Mattermost Cloud och Mattermost i egen drift fungerar.
- **Growth-planen på OneUptime Cloud** för aviseringsregler och sammanfattningar.

OneUptime behöver inget konfigurerat på sin egen server för Mattermost: varje projekt tar med sin egen Mattermost-server och sitt eget botkonto.

## Anslut Mattermost

:::steps
### Skapa ett botkonto i Mattermost

Öppna **System Console** > **Integrations** > **Bot Accounts** i Mattermost och kontrollera att **Enable Bot Account Creation** är påslaget. Gå sedan till **Integrations** > **Bot Accounts** > **Add Bot Account**, ge boten namnet `oneuptime` och spara. Mattermost visar botens åtkomsttoken en enda gång: kopiera den.

### Lägg till boten i ditt team

Lägg till boten i varje team där OneUptime ska publicera, på samma sätt som du lägger till en person: **Main Menu** > **Invite People**, och bjud in `@oneuptime`. OneUptime skapar kanaler och publicerar bara i de team som boten är medlem i.

### Anslut projektet

Gå till **Projektinställningar** > **Arbetsyta** > **Mattermost** i OneUptime och klicka på **Anslut till Mattermost**. Ange din servers adress, till exempel `https://chat.example.com`, och botens åtkomsttoken. OneUptime kontrollerar token mot din server innan något sparas. Om boten är med i mer än ett team frågar OneUptime vilket som är standardteamet: det team där en aviseringsregel som inte anger något team skapar sina kanaler. Tills en arbetsyta är ansluten innehåller avsnittet **Arbetsyta** i menyerna Incidenter, Larm, Schemalagt underhåll, Monitorer och Jour **Anslut en arbetsyta**, som också leder hit.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Mattermost** och skapa en regel, till exempel en som skapar en Mattermost-kanal för varje ny incident med alla som arbetar med den. Se [Aviseringsregler](#aviseringsregler).
:::

Botens åtkomsttoken lagras bara på OneUptime-servern, krypterad tillsammans med projektets andra hemligheter, och visas aldrig igen. Serveradressen, teamen och botens användarnamn visas för alla i projektet, på inställningssidan för Mattermost.

Ett projekt är anslutet till en enda Mattermost-server. För att flytta det till en annan server kopplar du först från det: **Projektinställningar** > **Arbetsyta** > **Mattermost**, sedan **⋯** > **Koppla från Mattermost**. Att koppla från kopplar också från varje medlems eget Mattermost-konto och tar bort deras aviseringsmetoder för Mattermost och jourreglerna som använder dem. Dina aviseringsregler och sammanfattningar sparas tills du ansluter igen.

## Mer än ett team

OneUptime fungerar i varje team på din Mattermost-server som boten är medlem i:

1. Lägg till boten i Mattermost i varje team som ska använda OneUptime, på samma sätt som du lägger till en person: öppna teamet och sedan **Main Menu** > **Invite People**.
2. Kortet **Mattermost-team** under **Projektinställningar** > **Arbetsyta** > **Mattermost** listar de teamen, standardteamet först. Klicka på **Uppdatera** när du har lagt till boten i ett nytt team.

- **Vilket team en regel använder.** Aviseringsregler väljer det **Mattermost-team** som deras kanaler finns i. Lämnas fältet tomt skapar regeln sin kanal i standardteamet och letar först där efter kanalerna den anger, sedan i botens andra team.
- **Vilket team en sammanfattning använder.** Sammanfattningar, på fliken **Sammanfattning** i **Incidenter** och **Larm**, väljer också det **Mattermost-team** som deras kanaler finns i. Lämnas fältet tomt letar en sammanfattning först efter sina kanaler i standardteamet, sedan i botens andra team.
- **Standardteamet.** Det är det team som du anslöt projektet till. **Gör till standard** på kortet gör ett annat team till standard, för en roll som får ansluta projektet.
- **Var OneUptime fungerar.** Knapparna i OneUptimes meddelanden, och formulären de öppnar, fungerar i vart och ett av de teamen. I ett team som boten har tagits bort från säger en knapp bara att teamet inte längre är anslutet.
- **Ett standardteam som boten har tagits bort från.** Kortet säger det. Lägg till boten igen i Mattermost, eller gör ett annat team till standard.
- **Ett team som en regel nämner och som boten har tagits bort från.** Regelns kort säger det, och regeln använder inte ett annat team i stället. Lägg till boten i teamet igen i Mattermost, eller välj ett annat team i regeln: formuläret visar fortfarande det gamla valet, så att du kan ändra det.

## Anslut ditt eget Mattermost-konto

Mattermost har ingen inloggning som OneUptime kan skicka dig till, så OneUptimes bot skickar i stället ett direktmeddelande med en länk till ditt Mattermost-konto:

:::steps
1. Gå till **Användarinställningar** > **Arbetsyta** > **Mattermost**. OneUptime letar efter det Mattermost-konto som har din e-postadress. Om den hittar ett klickar du på **Skicka länk till @your-username**. Om inte klickar du på **Skicka en länk till mig** och anger ditt användarnamn i Mattermost.
2. Öppna direktmeddelandet från OneUptime-boten i Mattermost och klicka på **Connect my account**.
3. Länken öppnar OneUptime, som ansluter ditt konto.
:::

Öppna länken i samma webbläsare som du bad om den i: den fungerar bara där, bara en gång och bara i 15 minuter. Det bevisar att den som bad om länken har båda kontona, så ingen kan ansluta någon annans Mattermost-konto. Om du inte bad om någon länk kan du strunta i den: ingenting ansluts förrän den öppnas i webbläsaren där den begärdes.

Ditt kontos anslutning hör till det här projektet. I ett annat projekt som är anslutet till samma Mattermost-team ansluter du det där också.

## Bli larmad i Mattermost

För att bli larmad via direktmeddelande när du har jour lägger du till Mattermost som en av dina aviseringsmetoder:

:::steps
1. Anslut ditt eget Mattermost-konto (se [Anslut ditt eget Mattermost-konto](#anslut-ditt-eget-mattermost-konto)).
2. Gå till **Användarinställningar** > **Aviseringsmetoder**, öppna fliken **Arbetsyteappar** och klicka på **Lägg till Mattermost-konto**.
3. Klicka på **Send Test Message** på dess rad. Meddelandet kommer som ett direktmeddelande från projektets bot.
:::

Att lägga till den lägger in den i dina jourregler direkt, så larm når dig i Mattermost från och med då. Ändra vilka larm den får under **Användarinställningar** > **Så når man mig**. Varje larm har en länk för att bekräfta det och en för att eskalera det. När du kopplar från ditt Mattermost-konto tas den här metoden och jourreglerna som använder den bort.

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Mattermost, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Mattermost** i sin meny: **Incidenter** (med **Incidentepisoder** och fliken **Sammanfattning**), **Larm** (med **Larmepisoder** och **Sammanfattning**), **Schemalagt underhåll**, **Monitorer**, **Jour**, **Säkerhetshändelser** och **SLOs**. De fungerar som Slacks regler: se [Aviseringsregler](/docs/workspace-connections/slack#aviseringsregler) för villkor, mål, de uppdateringar en regel publicerar och vilka som går med i en kanal. Jourmeddelanden är som i Slack, en rad vid varje överlämning: se [Jourmeddelanden](/docs/workspace-connections/slack#jourmeddelanden). En tid i ett meddelande, till exempel när ett jourpass slutar, visas i UTC: Mattermost kan inte visa den i varje läsares egen tidszon.

En kanal som en regel skapar får namn efter sin post: incident INC-42 får `inc-42`. Mattermost tar små bokstäver, siffror, `-` och `_`, upp till 64 tecken, med en bokstav eller en siffra först och sist, och regelformuläret visar namnet medan du skriver. Finns det redan en kanal med det namnet, till exempel en arkiverad kanal, lägger OneUptime till `-2`, `-3` och så vidare. En privat incident, ett privat larm eller en privat episod får en privat kanal.

För att publicera i en befintlig kanal anger du dess namn så som det står i kanalens adress, till exempel `incidents` för `chat.example.com/team/channels/incidents`, eller dess visningsnamn. OneUptime går själv med i en offentlig kanal första gången den publicerar där. Lägg till boten i en privat kanal i Mattermost innan en regel publicerar i den. När boten är med i mer än ett team väljer en regel också det team som dess kanaler finns i: se [Mer än ett team](#mer-än-ett-team).

Personer går med i en regels kanal via det Mattermost-konto de har anslutit, eller annars via det Mattermost-konto som har deras e-postadress, när din server visar e-postadresser för boten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nämner alla som den inte kunde lägga till i ett enda meddelande i kanalen, med en länk för att ansluta sitt konto.

En incident, ett larm, en episod eller en underhållshändelse med en egen kanal har **Öppna i Mattermost** i sidhuvudet på sin sida i OneUptime, bredvid tillståndsknapparna. Den öppnar kanalen i en ny flik, på din Mattermost-server. En post med två egna kanaler listar båda under knappen. En post som också har kanaler i Slack eller Microsoft Teams har i stället en knapp, **Öppna kanal**, som listar alla. De befintliga kanaler som dina regler publicerar i erbjuds inte.

**Testa regel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, precis som för Slack.

OneUptimes meddelanden aviserar ingen genom det de citerar: ett namn eller en beskrivning som innehåller `@channel`, `@here` eller `@someone` visas så som det är skrivet och pingar ingen.

## Vem som är i en posts kanal

En incident, ett larm, en episod eller en underhållshändelse med en egen Mattermost-kanal har kortet **Mattermost-kanal** på sin sida i OneUptime. Kortet visar kanalen, som en länk som öppnar den på din Mattermost-server, om den är privat och vem som är med i den, du först. Från kortet, utan en Mattermost-administratör:

- **Gå med i kanalen** lägger till dig när du inte är med i kanalen.
- **Lägg till personer** öppnar en lista över projektets personer och team: välj en person för att lägga till personen, eller ett team för att lägga till alla i det.

OneUptimes bot lägger till dem, på samma sätt som den lägger till personerna i en regels kanal. Boten stannar kvar i kanalerna den skapar, så det här fungerar även för en privat kanal som alla har lämnat. En post som också har kanaler i Slack eller Microsoft Teams visar alla på ett enda kort **Chattkanaler**.

- **Vem som får lägga till personer.** Den som får redigera posten: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem** för en incident, eller **Edit Incident** i en anpassad roll, och samma behörighet för ett larm, en episod eller en händelse (till exempel **Edit Alert**). Alla andra ser vem som är med i kanalen och hur de kommer in.
- **Vem som kan läggas till.** Någon som OneUptime hittar i Mattermost, via det konto personen har anslutit eller annars via e-postadressen, när din server visar e-postadresser för boten, och som är med i kanalens team. Ett gästkonto i det teamet kan också läggas till: Mattermost låter en kanals medlemmar lägga till gäster. Kortet nämner vilka det inte kunde lägga till, och varför.
- **Vad som registreras.** Vem som lades till, och av vem, i postens flöde (**Kanalmedlem tillagd**) och under **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**.
- **En arkiverad kanal.** Kortet visar fortfarande vem som är med i den, och lägger inte till någon förrän kanalen har återställts från arkivet i Mattermost.
- **En kanal som boten har tagits bort från.** Mattermost visar en kanals personer bara för någon som är med i den, även för en offentlig kanal, så kortet säger att det inte kan se kanalen. Någon i kanalen kan lägga till boten igen i Mattermost. OneUptime går också själv med i en offentlig kanal igen nästa gång det publicerar där.
- **Att ta bort någon.** OneUptime lägger bara till: ta bort någon från kanalen i Mattermost.

## Agera på incidenter, larm och händelser från Mattermost

OneUptimes meddelanden har knappar, och en meny **More actions** för det som färre behöver. Var och en agerar som dig, med dina behörigheter i projektet, och svarar i ett meddelande som bara du ser.

| Post | Knappar och meny |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, och i menyn **Change Severity** och **Change State** |
| **Larm** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Incidentepisod, larmepisod** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Schemalagt underhåll** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** och **Execute On-Call Policy** öppnar ett formulär i Mattermost. En anteckning på en incident eller en underhållshändelse kan vara offentlig, och visas då på statussidan, eller privat; en anteckning på en privat incident är alltid privat, och en anteckning på ett larm är också alltid privat. Varje meddelande har också en länk som öppnar dess post i OneUptime, för allt annat. När projektets offentliga anteckningar kräver godkännande väntar en offentlig anteckning från formuläret på det, och ett meddelande som bara du ser säger vem den väntar på: se [Godkännande av offentliga anteckningar](/docs/incidents/notes-owners-and-feed#godkännande-av-offentliga-anteckningar).

Om ditt Mattermost-konto inte är anslutet än säger en knapp det, med en länk till **Användarinställningar** > **Arbetsyta** > **Mattermost**. Anslut ditt konto och tryck sedan på knappen igen.

Varje tryck registreras under **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**, med vem som tryckte.

## Godkänna en offentlig anteckning

När projektets offentliga anteckningar behöver godkännas och du slår på Mattermost för **Godkännande av offentliga anteckningar** i dina aviseringsinställningar, kommer varje offentlig anteckning som väntar på ett steg som du godkänner till dina direktmeddelanden med OneUptimes bot: vem som skickade den, vilket steg den väntar på, anteckningen, **Approve**, **Reject** och en länk till anteckningen i OneUptime. **Approve** godkänner den för det steget; i det sista steget heter knappen **Approve and publish**, och anteckningen publiceras direkt. **Reject** öppnar ett formulär som frågar efter motiveringen: en motivering krävs, och anteckningens författare ser den. Knapparna agerar som du, enligt samma regler som i OneUptime, och svarar i ett meddelande som bara du ser. Ett tryck efter att någon annan har avgjort, eller efter att anteckningen eller dess steg har ändrats, avgör ingenting och säger vad som hände. När anteckningen är avgjord ändras varje godkännares meddelande om den, även ditt, så att det säger vad som hände: godkänd för sitt steg och vem den väntar på nu, publicerad, avvisad, ändrad eller skickad för godkännande igen, publicerad utan godkännande, eller borttagen. Det behåller sin länk till anteckningen i OneUptime, och **Approve** och **Reject** är borta. Om ditt Mattermost-konto inte är kopplat kopplar du det under **Användarinställningar** > **Arbetsyta** > **Mattermost** och trycker sedan på knappen igen. Om godkännandestegen ändras medan en anteckning väntar, och den inte längre väntar på ditt steg eller du inte längre tillfrågas, ändras även ditt meddelande om den, och de som den nu väntar på får ett eget meddelande. Se [Godkännande av offentliga anteckningar](/docs/incidents/notes-owners-and-feed#godkännande-av-offentliga-anteckningar).

## Nätverk och egen drift

Två servrar pratar med varandra:

- **OneUptime anropar din Mattermost-server** för att publicera, skapa kanaler och lägga till personer. På OneUptime Cloud måste din Mattermost-server kunna nås från internet. En OneUptime-installation i egen drift kan nå en Mattermost-server i ett privat nätverk när den som driver den tillåter privata adresser med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime anropar aldrig en adress på sin egen maskin eller en adress för molnmetadata, och följer aldrig en omdirigering.
- **Din Mattermost-server anropar OneUptime** när någon trycker på en knapp eller skickar ett formulär: `https://<your OneUptime>/api/mattermost/interactive` och `/api/mattermost/dialog`. Om OneUptimes adress är privat lägger du till dess värd under **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** i Mattermost, annars fungerar inte knapparna.

Varje knapp som OneUptime publicerar bär en signatur, som kontrolleras när knappen trycks, för det Mattermost-team där den publicerades: ett tryck som OneUptime inte har signerat, eller ett som skickas från ett annat team, gör ingenting.

## Felsökning

| Vad du ser | Vad du gör |
| --- | --- |
| **Mattermost did not accept the access token** | Kopiera botens token igen. Mattermost visar den bara en gång: skapa en ny under **Integrations** > **Bot Accounts** om du behöver. |
| **The bot account is not a member of any team** | Lägg till boten i ditt team i Mattermost och anslut sedan igen. |
| Ett team som du har lagt till boten i finns inte på kortet **Mattermost-team** | Klicka på **Uppdatera** på kortet. |
| **OneUptime's bot is not a member of this Mattermost team** | Du valde ett team som boten har lämnat. Lägg till boten i teamet i Mattermost och klicka sedan på **Uppdatera**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Lägg till boten i det teamet i Mattermost, eller välj ett annat team i regeln. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Lägg till boten i det teamet i Mattermost, eller välj ett annat team i regeln. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Lägg till boten i det teamet igen i Mattermost, eller gör ett annat team till standard. |
| **OneUptime could not reach the Mattermost server** | Kontrollera adressen, och att OneUptime kan nå den. Se [Nätverk och egen drift](#nätverk-och-egen-drift). |
| **The bot is not a member of the private Mattermost channel** | Lägg till boten i kanalen i Mattermost. |
| En knapp gör ingenting, eller Mattermost säger att åtgärden inte kunde slutföras | Mattermost kan inte nå OneUptime. Se [Nätverk och egen drift](#nätverk-och-egen-drift). |
| Inget direktmeddelande med din länk kommer fram | Kontrollera användarnamnet, och att boten är med i ett team som du är med i. |
| Kanalkortet säger att OneUptime inte kan se kanalen | Kanalen har tagits bort, eller så har boten tagits bort från den. Om den finns kvar kan någon i kanalen lägga till boten igen i Mattermost. |
| Kanalkortet säger att någon inte är med i Mattermost-teamet | Lägg till personen i Mattermost i kanalens team, och lägg sedan till personen igen. |
