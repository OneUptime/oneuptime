# Mattermost

Anslut OneUptime till din Mattermost-server för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler, ge varje incident en egen kanal och låta responders bekräfta, lösa, lägga till anteckningar och ändra tillstånd utan att lämna Mattermost.

:::cards
- [Anslut Mattermost](#anslut-mattermost): Skapa ett botkonto för OneUptime och anslut sedan projektet med dess token.
- [Anslut ditt eget konto](#anslut-ditt-eget-mattermost-konto): Länka ditt Mattermost-konto till ditt OneUptime-konto.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
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

- **Projektets anslutning**, gjord en gång: ett botkonto på din Mattermost-server, i det team där OneUptime publicerar. Det publicerar meddelandena, skapar kanalerna och lägger till personer i dem.
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

Lägg till boten i det team där OneUptime ska publicera, på samma sätt som du lägger till en person: **Main Menu** > **Invite People**, och bjud in `@oneuptime`. OneUptime skapar kanaler och publicerar bara i det teamet.

### Anslut projektet

Gå till **Projektinställningar** > **Arbetsyta** > **Mattermost** i OneUptime och klicka på **Anslut till Mattermost**. Ange din servers adress, till exempel `https://chat.example.com`, och botens åtkomsttoken. OneUptime kontrollerar token mot din server innan något sparas. Om boten är med i mer än ett team frågar OneUptime vilket den ska publicera i. Tills en arbetsyta är ansluten innehåller avsnittet **Arbetsyta** i menyerna Incidenter, Larm, Schemalagt underhåll, Monitorer och Jourtjänst **Anslut en arbetsyta**, som också leder hit.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Mattermost** och skapa en regel, till exempel en som skapar en Mattermost-kanal för varje ny incident med alla som arbetar med den. Se [Aviseringsregler](#aviseringsregler).
:::

Botens åtkomsttoken lagras bara på OneUptime-servern, krypterad tillsammans med projektets andra hemligheter, och visas aldrig igen. Serveradressen, teamet och botens användarnamn visas för alla i projektet, på inställningssidan för Mattermost.

Ett projekt är anslutet till ett enda Mattermost-team. För att flytta det till ett annat team, eller en annan server, kopplar du först från det: **Projektinställningar** > **Arbetsyta** > **Mattermost**, sedan **⋯** > **Koppla från Mattermost**. Att koppla från kopplar också från varje medlems eget Mattermost-konto. Dina aviseringsregler och sammanfattningar sparas tills du ansluter igen.

## Anslut ditt eget Mattermost-konto

Mattermost har ingen inloggning som OneUptime kan skicka dig till, så OneUptimes bot skickar i stället ett direktmeddelande med en länk till ditt Mattermost-konto:

:::steps
1. Gå till **Användarinställningar** > **Arbetsyta** > **Mattermost**. OneUptime letar efter det Mattermost-konto som har din e-postadress. Om den hittar ett klickar du på **Skicka länk till @your-username**. Om inte klickar du på **Skicka en länk till mig** och anger ditt användarnamn i Mattermost.
2. Öppna direktmeddelandet från OneUptime-boten i Mattermost och klicka på **Connect my account**.
3. Länken öppnar OneUptime, som ansluter ditt konto.
:::

Öppna länken i samma webbläsare som du bad om den i: den fungerar bara där, bara en gång och bara i 15 minuter. Det bevisar att den som bad om länken har båda kontona, så ingen kan ansluta någon annans Mattermost-konto. Om du inte bad om någon länk kan du strunta i den: ingenting ansluts förrän den öppnas i webbläsaren där den begärdes.

Ditt kontos anslutning hör till det här projektet. I ett annat projekt som är anslutet till samma Mattermost-team ansluter du det där också.

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Mattermost, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Mattermost** i sin meny: **Incidenter** (med **Incident Episoder** och fliken **Sammanfattning**), **Larm** (med **Larm Episoder** och **Sammanfattning**), **Schemalagt underhåll**, **Monitorer**, **Jourtjänst** och **Säkerhetshändelser**. De fungerar som Slacks regler: se [Aviseringsregler](/docs/workspace-connections/slack#aviseringsregler) för villkor, mål och vilka som går med i en kanal.

En kanal som en regel skapar får namn efter sin post: incident INC-42 får `inc-42`. Mattermost tar små bokstäver, siffror, `-` och `_`, upp till 64 tecken, med en bokstav eller en siffra först och sist, och regelformuläret visar namnet medan du skriver. Finns det redan en kanal med det namnet, till exempel en arkiverad kanal, lägger OneUptime till `-2`, `-3` och så vidare. En privat incident, ett privat larm eller en privat episod får en privat kanal.

För att publicera i en befintlig kanal anger du dess namn så som det står i kanalens adress, till exempel `incidents` för `chat.example.com/team/channels/incidents`, eller dess visningsnamn. OneUptime går själv med i en offentlig kanal första gången den publicerar där. Lägg till boten i en privat kanal i Mattermost innan en regel publicerar i den.

Personer går med i en regels kanal via det Mattermost-konto de har anslutit, eller annars via det Mattermost-konto som har deras e-postadress, när din server visar e-postadresser för boten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nämner alla som den inte kunde lägga till i ett enda meddelande i kanalen, med en länk för att ansluta sitt konto.

**Testregel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, precis som för Slack.

OneUptimes meddelanden aviserar ingen genom det de citerar: ett namn eller en beskrivning som innehåller `@channel`, `@here` eller `@someone` visas så som det är skrivet och pingar ingen.

## Agera på incidenter, larm och händelser från Mattermost

OneUptimes meddelanden har knappar, och en meny **More actions** för det som färre behöver. Var och en agerar som dig, med dina behörigheter i projektet, och svarar i ett meddelande som bara du ser.

| Post | Knappar och meny |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, och i menyn **Change Severity** och **Change State** |
| **Larm** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Incidentepisod, larmepisod** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Schemalagt underhåll** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** och **Execute On-Call Policy** öppnar ett formulär i Mattermost. En anteckning på en incident eller en schemalagd underhållshändelse kan vara offentlig, och visas då på statussidan, eller privat; en anteckning på en privat incident är alltid privat, och en anteckning på ett larm är också alltid privat. Varje meddelande har också en länk som öppnar dess post i OneUptime, för allt annat.

Om ditt Mattermost-konto inte är anslutet än säger en knapp det, med en länk till **Användarinställningar** > **Arbetsyta** > **Mattermost**. Anslut ditt konto och tryck sedan på knappen igen.

Varje tryck registreras under **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**, med vem som tryckte.

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
| **OneUptime could not reach the Mattermost server** | Kontrollera adressen, och att OneUptime kan nå den. Se [Nätverk och egen drift](#nätverk-och-egen-drift). |
| **The bot is not a member of the private Mattermost channel** | Lägg till boten i kanalen i Mattermost. |
| En knapp gör ingenting, eller Mattermost säger att åtgärden inte kunde slutföras | Mattermost kan inte nå OneUptime. Se [Nätverk och egen drift](#nätverk-och-egen-drift). |
| Inget direktmeddelande med din länk kommer fram | Kontrollera användarnamnet, och att boten är med i ett team som du är med i. |
