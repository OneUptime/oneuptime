# Microsoft Teams

Anslut OneUptime till Microsoft Teams för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler och chattar, ge varje incident en egen kanal och låta responders agera från Teams: bekräfta, lösa, lägga till anteckningar, larma jouren, deklarera incidenter och fråga OneUptime AI.

:::cards
- [Anslut Microsoft Teams](#anslut-microsoft-teams): Administratörsmedgivande, din inloggning och appen i varje team.
- [Be alla att ansluta](#be-alla-att-ansluta): Skicka ett meddelande till varje medlem som inte har anslutit sitt konto, i ett svep.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Prata med OneUptime-boten](#prata-med-oneuptime-boten): Kommandon, frågor och formulär i en chatt med boten.
- [Jourtaggar](#jourtaggar): Håll ett teams tagg lika med dem som har jour, och larma den.
- [Agera på incidenter, larm och händelser från Microsoft Teams](#agera-på-incidenter-larm-och-händelser-från-microsoft-teams): Knapparna på OneUptimes kort.
:::

## Så fungerar det

```mermaid title="Från en händelse i OneUptime till ett kort i Microsoft Teams"
flowchart TB
    event["En incident, ett larm eller en händelse<br/>skapas eller ändras"] --> rules{"Aviseringsregler<br/>vars villkor matchar"}
    rules -->|"En kanal<br/>för varje"| own["En egen kanal<br/>i det team du väljer"]
    rules -->|"Publicera i en befintlig<br/>kanal eller chatt"| existing["Dina kanaler och chattar"]
    own --> card["Ett kort med knappar"]
    existing --> card
    card -->|"En responder trycker på en"| change["Ändringen görs i OneUptime,<br/>som den respondern"]
```

Tre saker får det här att fungera:

- **Projektets anslutning**, gjord en gång: en Microsoft 365-administratör ger medgivande till OneUptime-appen för din organisation.
- **OneUptime-appen i varje team** som du vill ha aviseringar i. Microsoft låter bara boten publicera i ett team som den har lagts till i.
- **Varje persons egen anslutning**: personens Microsoft Teams-konto länkat till personens OneUptime-konto. Knappar, kommandon och reaktioner agerar som den personen, med personens behörigheter i projektet.

En Microsoft 365-organisation kan vara ansluten till mer än ett projekt, till exempel produktion och staging. Ett korts knapp agerar i det projekt kortet skickades för, till exempel projektet för den incident kortet gäller. Ett meddelande till boten agerar i projektet för den kanal det skickas i, till exempel en incidents kanal, annars i det enda projekt där avsändarens Microsoft Teams-konto är anslutet. När inget visar vilket frågar boten avsändaren vilket projekt personen menar, med en knapp för varje projekt personen är med i, och fortsätter där så snart personen har valt. I en konversation med OneUptime AI gäller valet för följdfrågorna tills det har gått en timme utan någon.

## Innan du börjar

- **En roll som får ansluta projektet:** **Projektägare**, **Projektadministratör** eller **Projektmedlem**. Att avinstallera kräver **Projektägare** eller **Projektadministratör**.
- **En Microsoft 365-administratör** som ger administratörsmedgivande, en gång för hela organisationen.
- **Growth-planen på OneUptime Cloud** för aviseringsregler och sammanfattningar. Se [Aviseringsregler under Growth-planen](#aviseringsregler-under-growth-planen).
- **På en egenvärdad server,** först en Teams-bot som är konfigurerad för den. Se [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration).

## Anslut Microsoft Teams

:::steps
### Ge administratörsmedgivande

Gå till **Projektinställningar** > **Arbetsyta** > **Microsoft Teams** och klicka på **Bevilja administratörssamtycke**. En Microsoft 365-administratör loggar in och tillåter OneUptime-appen för organisationen. Kortet säger sedan **Admin Consent Completed**. Tills en arbetsyta är ansluten innehåller avsnittet **Arbetsyta** i menyerna Incidenter, Larm, Schemalagt underhåll, Monitorer och Jourtjänst **Anslut Slack eller Teams**, som också leder hit.

### Anslut ditt konto

Klicka på **Connect with Microsoft Teams** och logga in med ditt arbetskonto. OneUptime läser organisationens team; **Visa team** visar dem.

### Lägg till OneUptime-appen i varje team (obligatoriskt)

Att ansluta ditt konto räcker inte i sig. Microsoft låter bara OneUptime-boten publicera i ett team som den har lagts till i, så gör så här för varje team som du vill ha aviseringar i:

- I Microsoft Teams klickar du på "..." bredvid **teamnamnet** (inte kanalnamnet).
- Välj **Manage team** > **Apps** > **More apps**, sök efter **OneUptime** och klicka på **Add**.

På OneUptime Cloud öppnar **Öppna Teams Store** appen i Microsoft Teams Store, där **Add to a team** gör samma sak. På en egenvärdad server installerar du i stället paketet från **Ladda ner app-manifest-zip**: bara det innehåller din servers bot. Om en testavisering säger att OneUptime-appen inte är installerad i teamet är det det här steget som hoppades över.

### Anslut alla andra

Varje person länkar sitt eget Microsoft Teams-konto under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, för att agera på incidenter och få direktmeddelanden som sig själv. Det avsnittet visas så snart projektet är anslutet till Microsoft Teams. Se [Be alla att ansluta](#be-alla-att-ansluta) för att få med ett helt team på en gång.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Microsoft Teams**. Avsnittet **Arbetsyta** visar bara de chattarbetsytor som ditt projekt har anslutit, så **Microsoft Teams** visas där så snart det är anslutet. Skapa en regel, till exempel en som publicerar i en Teams-kanal när en incident skapas, och klicka sedan på **Testregel** på dess rad.
:::

> [!NOTE]
> Att installera OneUptime för dig själv, eller lägga till den i en chatt, är en annan installation och låter den inte publicera i ett teams kanaler. **Privata kanaler** kräver att appen läggs till i själva kanalen: öppna kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delade kanaler** kan inte ta emot aviseringar: Microsoft Teams stöder inte botar i delade kanaler.

## Be alla att ansluta

Ingen kan ansluta någon annans Microsoft Teams-konto, inte ens en administratör: var och en loggar in med sitt eget. För att få med ett helt team ber en **Projektägare** eller **Projektadministratör** alla på en gång på **Projektinställningar** > **Arbetsyta** > **Microsoft Teams**. Kortet **Members' Microsoft Teams accounts** visar hur många medlemmar som har anslutit. **Ask everyone to connect** låter OneUptime-boten skicka ett meddelande till varje medlem som inte har gjort det, med knappen **Connect Microsoft Teams account**, som ansluter personens konto med ett klick.

- **Vem som får ett meddelande.** Varje medlem i projektet som inte har anslutit sitt Microsoft Teams-konto och som är med i ett team där OneUptime-appen har lagts till; OneUptime hittar personen där via e-postadressen eller användarens huvudnamn (UPN). Den som har tillfrågats under de senaste 24 timmarna tillfrågas inte igen, så en ny förfrågan dagen efter påminner bara dem som fortfarande inte har anslutit.
- **Vad kortet säger.** Hur långt utskicket har kommit medan meddelandena skickas, och sedan vem som frågade och hur många medlemmar som fick ett meddelande. Medlemmar som OneUptime inte kunde hitta nämns på kortet: lägg till appen i deras team, eller låt dem själva ansluta under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams**.
- **Vad knappen ansluter.** Microsoft Teams-kontot för den som trycker på den och loggar in, till personens eget OneUptime-konto. Ett meddelande som skickas vidare till någon annan ansluter ingenting till den medlem det skickades till.

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Microsoft Teams, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Microsoft Teams** i sin meny:

| Produkt | Flikar på produktens **Microsoft Teams**-sida |
| --- | --- |
| **Incidenter** | **Incidenter**, **Incident Episoder**, **Sammanfattning** |
| **Larm** | **Larm**, **Larm Episoder**, **Sammanfattning** |
| **Schemalagt underhåll** | En lista med regler |
| **Monitorer** | En lista med regler |
| **Jourtjänst** | En lista med regler |

Att skapa en regel går igenom fyra steg:

| Steg | Vad du anger |
| --- | --- |
| **Grundläggande** | **Regelnamn** och **Regelbeskrivning**. |
| **Villkor** | Vilka händelser regeln gäller, till exempel efter allvarlighetsgrad, tillstånd, etikett, monitor eller ord i titeln. De kontrolleras när en händelse skapas och igen vid varje uppdatering som OneUptime publicerar om den, så en regel för bekräftade incidenter verkar när en incident bekräftas. En ny regel gäller varje händelse, till exempel **Alla incidenter**. För att snäva in den väljer du **Endast incidenter som uppfyller villkoren** och lägger till villkoren. Med två eller fler anger **Matchningsvillkor** om alla måste matcha, eller om det räcker med ett. |
| **Mål** | Var den publicerar: en befintlig kanal i ett team som du väljer, de chattar som du väljer, en kanal för varje incident (eller larm, episod, händelse, monitor eller jourpolicy) som skapas i ett team som du väljer, eller flera av dessa tillsammans. Under steget säger **Vad regeln gör** det i meningar, som regelns kort. |
| **Video Call** | Endast incidenter och larm: starta ett samtal för var och en. Se [Videosamtal](/docs/workspace-connections/video-calls). |

En kanal som regeln skapar får namn efter sin post: incident INC-42 får `inc-42`, larm ALT-7 får `alt-7`, och i ett projekt utan nummerprefix får incident 42 `incident-42`. Text i **Prefix för kanalnamn** hamnar framför, så `prod-` ger `prod-inc-42`, och formuläret visar namnet medan du skriver. För en schemalagd underhållshändelse ersätter prefixet dess nummerprefix: SM-5 får `sm-5`, och `maint-` ger `maint-5`. OneUptime behåller bokstäver, siffror, mellanslag, `-` och `_`, upp till de 50 tecken som Microsoft Teams tar emot. Har teamet redan en kanal med det namnet, till exempel ett annat projekts eller en som raderats de senaste 30 dagarna, lägger OneUptime till `-2`, `-3` och så vidare.

En regel skapar sin kanal första gången en händelse matchar den: när händelsen skapas, eller senare, när en uppdatering får den att matcha medan den fortfarande är öppen. En regel för bekräftade incidenter skapar kanalen när incidenten bekräftas. Microsoft Teams visar ett teams kanaler för alla i teamet, så OneUptime lägger inte till någon i en kanal en och en: alla i det team du väljer kan öppna den, som regelformuläret säger under **Vem som går med i kanalen**. En privat incident, ett privat larm eller en privat episod får en privat kanal, som bara dess medlemmar ser; lägg till personer i Microsoft Teams.

För att ta med dem som har jour väljer du deras jourscheman under **Nämn dem som har jour**. När kanalen skapas publicerar OneUptime, direkt efter postens första meddelande, ett meddelande i den som med @ nämner dem som har jour i de schemana, så att Microsoft Teams aviserar dem. Ingen larmas. OneUptime hittar varje person i teamet via det Microsoft Teams-konto som personen har anslutit till OneUptime, eller annars via personens e-postadress. Den som inte är med i teamet kan inte öppna dess kanaler och nämns därför i stället i meddelandet, med skälet. En privat kanal kan bara öppnas av dess medlemmar, så lägg till de jourhavande i kanalen i Microsoft Teams.

Varje senare uppdatering av posten — en tillståndsändring, en anteckning, en ny ägare — publiceras i dess kanaler, och i de befintliga kanaler och chattar som dess regler anger så länge deras villkor stämmer. OneUptime kan inte arkivera en Microsoft Teams-kanal, så en regels kanal finns kvar när dess post är avslutad; arkivera eller ta bort den i Microsoft Teams.

En incident, ett larm, en episod eller en schemalagd underhållshändelse med en egen kanal har **Öppna i Microsoft Teams** i sidhuvudet på sin sida i OneUptime, bredvid tillståndsknapparna. Den öppnar kanalen i en ny flik, i Microsoft Teams-appen eller i webbläsaren. En post med två egna kanaler listar båda under knappen. En post med kanaler i både Slack och Microsoft Teams har i stället en knapp, **Öppna kanal**, som listar alla. De befintliga kanaler och chattar som dina regler publicerar i erbjuds inte.

Postens sida har också kortet **Microsoft Teams-kanal**, som säger vem som kan öppna kanalen: alla i teamet eller, för en privat kanal, dess medlemmar, som dess ägare lägger till i Microsoft Teams. OneUptime ändrar inte vem som är med i en Microsoft Teams-kanal. För en Slack-kanal visar kortet vem som är med i den och lägger till personer: se [Vem som är i en posts kanal](/docs/workspace-connections/slack#vem-som-är-i-en-posts-kanal).

Kanaler och chattar förblir läsbara: varje händelse publiceras en gång, och postens första tillstånd står i kortet som annonserar posten, inte i ett eget kort. En körning av en jourpolicy är ett enda kort som redigeras allteftersom körningen eskalerar: vem som larmades, hur ofta och hur, vem som inte larmades och varför, och vem som bekräftade. Ett nytt kort publiceras bara när någon måste agera: en eskaleringsregel nådde ingen, eller körningen tog slut utan att någon bekräftade. Att postens ägare eller statussidans prenumeranter meddelades står kvar i dess flöde i OneUptime.

**Projektinställningar** > **Arbetsyta** > **Microsoft Teams** visar de kanaler som OneUptime ser i dina team, och de chattar som den har lagts till i, med **Skicka test** bredvid var och en. En chatt visas så snart OneUptime-appen har lagts till i den i Microsoft Teams; **Refresh Chats** hämtar nya chattar och deras aktuella namn.

## Testa en regel

**Testregel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, så att du ser att det kommer fram. Om regeln skapar en kanal för varje händelse skapar testet också en och bjuder in regelns personer till den.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Arbetsyta** > **Microsoft Teams** kräver den behörighet att skapa aviseringsregler: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Inställningsadministratör**, **Inställningsmedlem**, eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en anpassad roll. För den som bara får se reglerna, som en **Tittare**, är **Testregel** låst, och dess verktygstips anger vad som krävs; API:et avvisar personens test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det **Growth**-planen att testa en regel, precis som att lägga till en.

På OneUptime Cloud kräver **Skicka test** bredvid en kanal eller en chatt också **Growth**-planen, eftersom att publicera i en kanal är vad regler och sammanfattningar gör. **Skicka test nu** på en sammanfattning kräver behörighet att skapa sammanfattningar (**Create Workspace Notification Summary** och **Read Workspace Notification Summary** i en anpassad roll) och, på OneUptime Cloud, **Growth**-planen; för alla andra är den låst, och dess verktygstips anger vad som krävs. En MCP-klient som är ansluten med skrivskyddad åtkomst kan inte skicka något test.

## Sammanfattningar

Fliken **Sammanfattning** i **Incidenter** > **Arbetsyta** > **Microsoft Teams** (och i **Larm**) publicerar en återkommande sammanställning i de kanaler du anger: hur många incidenter eller larm det var, hur snabbt de bekräftades och löstes, och en lista med länkar. En ny sammanfattning skickas varje vecka och täcker de senaste 7 dagarna. Lämna **Skicka första rapporten kl.** tomt, så skickas den första kl. 09:00 i början av nästa vecka, dag eller månad; formuläret anger när.

En sammanfattning skickas enligt klockan i sin **Tidszon**, som utgår från din. Den behåller sin tid på dagen där hela året: en som är inställd på 09:00 i Berlin skickas fortfarande kl. 09:00 i Berlin efter övergången till sommartid, och datumen i dess meddelande är också Berlins. Via API:et skickar du `timezone` som ett IANA-tidszonsnamn, som `Europe/Berlin`. En sammanfattning som skapas utan tidszon tar tidszonen från profilen för den som skapade den, eller UTC när en API-nyckel skapar den.

Formuläret för en sammanfattning har fyra steg: **Grundläggande information** (namnet, kanalerna och deras **Teamnamn**), **Schema**, **Innehåll** (**Vad som ska inkluderas**) och **Filter** (vilka incidenter eller larm den räknar).

## Aviseringsregler under Growth-planen

På OneUptime Cloud ingår aviseringsregler och sammanfattningar i **Growth**-planen och uppåt. Ett projekt under den behåller de regler och sammanfattningar det redan har, och de fortsätter att publicera i Microsoft Teams. Därför visar varje produkts **Microsoft Teams**-sida (Incidenter, Larm, Schemalagt underhåll, Jourtjänst, Monitorer) planmeddelandet med dem listade nedanför (**Aviseringsregler som fortfarande är konfigurerade**, **Sammanfattningar som fortfarande är konfigurerade**): ta bort en regel, eller stäng av eller ta bort en sammanfattning. Att lägga till eller ändra regler och sammanfattningar kräver **Growth**.

## Bli larmad i Microsoft Teams

För att bli larmad via direktmeddelande när du har jour lägger du till Microsoft Teams som en av dina aviseringsmetoder:

:::steps
1. Anslut ditt eget Microsoft Teams-konto (se [Anslut Microsoft Teams](#anslut-microsoft-teams)).
2. Gå till **Användarinställningar** > **Aviseringsmetoder**, öppna fliken **Workspace Apps** och klicka på **Add Microsoft Teams Account**.
3. Klicka på **Send Test Message** på dess rad. Meddelandet kommer i dina chattar i Microsoft Teams.
:::

Att lägga till den lägger in den i dina jourregler direkt, så larm når dig i Microsoft Teams från och med då. Ändra vilka larm den får under **Användarinställningar** > **Jourregler**.

## Spara meddelanden som anteckningar

Reagera på ett meddelande, eller ett svar, i den kanal som OneUptime skapade för en incident, ett larm, en episod eller en schemalagd underhållshändelse, så sparar OneUptime det som en anteckning på den posten. Den fångar upp reaktionen inom en minut och bekräftar med ett svar i tråden:

| Reaktion | Sparas som |
| --- | --- |
| 📌 eller 📍 | En privat anteckning, som bara ditt team ser |
| 📣 eller 📢 | En offentlig anteckning, som visas på statussidan. Endast incidenter och schemalagda underhållshändelser. På en privat incident en privat anteckning, och bekräftelsen säger varför. |

Anteckningen behåller meddelandet så som Microsoft Teams visade det: formateringen, länkarna och koden, personerna det nämner, med namn, och filerna och bilderna som länkar till dem. En offentlig anteckning utelämnar filerna och bilderna, eftersom de bara öppnas för ditt team.

Det är orden från den som skrev meddelandet: personens OneUptime-namn när personens Microsoft Teams-konto är anslutet, annars namnet Teams visar. En privat anteckning placeras i tidslinjen där meddelandet skickades, hur långt efteråt den än sparas. En offentlig anteckning placeras när den sparas, alltså när statussidan visar den. Tidslinjen säger vem som sparade den. Anteckningen skickas inte tillbaka till kanalen, där meddelandet redan finns.

Anteckningen sparas som dig, med dina behörigheter, och OneUptime-appen måste finnas i teamet. Om ditt Microsoft Teams-konto inte är anslutet än ber OneUptime dig ansluta det, i ett svar som nämner dig, med en knapp som sparar meddelandet så snart du har gjort det.

## Prata med OneUptime-boten

Skriv till boten i en personlig chatt, eller nämn OneUptime med @ i en kanal eller en gruppchatt: där svarar den bara när den nämns.

| Meddelande | Vad boten gör |
| --- | --- |
| `help` | Visar vad den kan göra. |
| `incident [title or number]` | Öppnar incidentformuläret med titeln ifylld. En incidents nummer, som `42` eller `INC-42`, visar i stället den incidenten: se [Hantera en incident från Microsoft Teams](#hantera-en-incident-från-microsoft-teams). |
| `maintenance [title]` | Öppnar formuläret för schemalagt underhåll med titeln ifylld. |
| `oncall` | Visar vem som har jour just nu i varje jourschema du kan se, till när, och vem som är nästa. |
| `page [who] [message]` | Larmar personerna du nämner med @ om ditt meddelande, eller skickar ett kort där du väljer vem som ska larmas. Se [Larma någon från Microsoft Teams](#larma-någon-från-microsoft-teams). |
| `ask [question]`, eller vilken fråga som helst på vanligt språk | OneUptime AI svarar om dina loggar, traces, mätvärden, incidenter och monitorer, till exempel "vilka monitorer är nere just nu?". Svar läser bara. |
| `show active incidents`, `show active alerts` | Visar det som är öppet nu. |
| `show scheduled maintenance`, `show ongoing maintenance` | Visar kommande, eller pågående, underhållshändelser. |

Förutom `show`-listorna är detta orden som följer efter `/oneuptime` i Slack; `create incident` och `create maintenance` fungerar fortfarande också. Att fråga OneUptime AI kräver att ditt eget Microsoft Teams-konto är anslutet och att AI är påslaget för projektet. Om ditt konto inte är anslutet ber boten dig en gång i varje tråd eller chatt att ansluta det, med knappen **Connect Microsoft Teams account**. Se [Fråga AI](/docs/ai/ask-ai).

## Din startsida i Microsoft Teams

Skriv `home` till OneUptime-boten, så svarar den med din startsida: ett kort med det som händer i projektet, så som du får se det.

- **Din jour.** Jourschemana du har jour i just nu, och till när, eller annars ditt nästa pass.
- **Det som är öppet.** De senaste öppna incidenterna och larmen du får läsa, var och en med en länk till sin sida i OneUptime.
- **Knapparna.** **Declare incident** och **Page someone** svarar som `incident` och `page`, **Who's on call** som `oncall`, och **Refresh** läser om kortet, på samma plats.

När du lägger till OneUptime-appen för dig själv skickar boten din startsida direkt. Startsidan och `show`-listorna läser som du, så de behöver ditt eget anslutna Microsoft Teams-konto: tills det är anslutet svarar boten med knappen **Connect Microsoft Teams account**. **Öppna OneUptime i Microsoft Teams** under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams** öppnar appen i Teams.

När appen läggs till i ett team säger boten hej där: hur man ställer en fråga till den, och var man lägger till en aviseringsregel som publicerar i teamets kanaler.

## Skapa incidenter och underhåll från Microsoft Teams

Att skriva `incident` eller `maintenance` till OneUptime-boten öppnar ett formulär för den person som skrev det, i en personlig chatt, en kanal eller en gruppchatt. Det fylls i som den personen: som det OneUptime-konto som personens Microsoft Teams-konto är anslutet till (se [Anslut Microsoft Teams](#anslut-microsoft-teams)), med det kontots behörigheter i projektet. Den som inte har sitt konto anslutet, eller vars OneUptime-konto inte längre är medlem i projektet, får veta vad som ska göras i ett svar som nämner personen, i stället för formuläret.

- **Vem som får använda dem.** De som får deklarera en incident eller skapa en schemalagd underhållshändelse i OneUptime: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem** för en incident (**Create Incident** i en anpassad roll), och **Underhållsadministratör** och **Underhållsmedlem** för en händelse (**Create Scheduled Maintenance**). Alla andra får veta det, och får inget formulär.
- **Vad ett formulär erbjuder.** Varje lista — allvarlighetsgrader, monitorer, monitorstatusar, jourpolicyer och etiketter — innehåller det som personen som bad om det får läsa, precis som samma lista i OneUptime, och kortets "not shown"-noteringar räknar bara dessa: med en roll som är begränsad till vissa etiketter, de monitorer och jourpolicyer som har de etiketterna. En lista som personen inte får läsa alls utelämnas. Arkiverade jourpolicyer erbjuds aldrig.
- **Vad ett formulär får ange.** I en kanal eller en gruppchatt får alla som är där skicka formuläret, och det skickas som den som gör det, med personens egna behörigheter. Incidenten eller händelsen skapas med de behörigheterna och tillskrivs den personen. En monitor, jourpolicy, etikett, allvarlighetsgrad eller status som personen inte får läsa, eller en från ett annat projekt, avvisas som en som projektet inte har, och inget skapas: boten svarar "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en incident, ett larm eller en episod fungerar på samma sätt: den kräver behörighet att köra en jourpolicy (**Projektägare**, **Projektadministratör**, **Projektmedlem**, **Jouradministratör** och **Jourmedlem**, eller **Create On-Call Duty Policy Execution Log** i en anpassad roll) och att läsa den incidenten, det larmet eller den episoden, och den erbjuder de aktiva jourpolicyer som personen får läsa. Att visa en monitor eller en jourpolicy från ett kort läser den också som den person som tryckte på knappen.

## Larma någon från Microsoft Teams

I en kanal eller en gruppchatt larmar `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` Nawaz direkt. OneUptime skapar ett larm med ditt meddelande som rubrik, och varje person du nämner med @ får ett telefonsamtal, ett sms, en pushnotis eller ett mejl, så som personens egna jourregler säger, tills någon bekräftar larmet.

- **Vem som larmas direkt.** Personerna du nämner med @, och de som har jour i de scheman som en tagg du nämner med @ följer (se [Jourtaggar](#jourtaggar)), när ett meddelande följer efter dem. OneUptime känner igen en person på det OneUptime-konto som personens Microsoft Teams-konto är anslutet till, eller annars på personens e-postadress i Microsoft Teams. Ingen utanför projektet larmas.
- **Allt annat får ett kort.** Utan någon nämnd med @, som i en personlig chatt med boten, utan meddelande, med en tagg som inte följer något jourschema du kan se, eller med en person som OneUptime inte känner igen, svarar boten med kortet **Page someone**, med det du skrev ifyllt, och säger vem den inte kunde välja. Välj personer, ett team, ett jourschema, som larmar den som har jour i det just nu, eller en jourpolicy, som larmar genom sina eskaleringsregler, och skicka kortet. Alla i konversationen får skicka kortet, som sig själva. När det har larmat tas kortet bort, så att ingen larmar med det två gånger.
- **Var det syns.** Konversationen visar larmningen som ett enda kort som hålls uppdaterat: vem som larmades och hur, och vem som bekräftade. Där boten inte kan posta det, säger dess svar vem som larmades, med en länk till larmet.
- **Vem som får larma.** Alla som får både köra en jourpolicy och skapa ett larm: **Projektägare**, **Projektadministratör** och **Projektmedlem**, eller **Jourmedlem** tillsammans med **Larmmedlem** (**Create On-Call Duty Policy Execution Log** och **Create Alert** i en anpassad roll). Att larma personer, ett team eller ett schema direkt, utan en jourpolicy bakom larmningen, kräver också åtkomst till alla projektets jourpolicyer. Alla andra får veta det i ett svar, och ingen larmas. På OneUptime Cloud kräver larmning Growth-planen: under den säger OneUptime vilken plan som krävs, och ingen larmas.

## Jourtaggar

Håll en tagg i Microsoft Teams, till exempel `@Payments on-call`, lika med dem som har jour i ett eller flera jourscheman, så att alla i dess team kan nämna den med @ för att nå dem. OneUptime ändrar taggens medlemmar vid varje överlämning och åsidosättning, och kontrollerar den var 15:e minut.

:::steps
### Anslut en tagg till ett schema

Öppna schemat under **Jourtjänst** > **Jourscheman**. Klicka på **Anslut tagg** i dess kort **Taggar i Microsoft Teams**, välj teamet och namnge taggen: teamets tagg med det namnet, eller en ny som OneUptime skapar. Medlemmarna ersätts direkt med dem som har jour.

### Anslut den även till det sekundära schemat

För en tagg med både den primära och den sekundära jouren ansluter du samma tagg på det sekundära schemats sida. En tagg kan följa hur många scheman som helst.
:::

- **Vad kortet visar.** Vem som är i varje tagg nu, dess team, de andra scheman den följer, och om den är **Uppdaterad**. En tagg innehåller bara personer i sitt eget team: den som har jour men inte är med i teamet nämns, med skälet.
- **Ingen har jour.** OneUptime tar bort alla från taggen tills någon har jour. En ny tagg behöver någon från teamet som har jour, eftersom Microsoft Teams inte skapar taggar utan medlemmar.
- **Larma taggen.** `@OneUptime page @Payments on-call The checkout API is down` larmar dem som har jour i de scheman taggen följer. Se [Larma någon från Microsoft Teams](#larma-någon-från-microsoft-teams).
- **Vad Microsoft 365 kräver.** Att ändra taggar kräver appens behörighet `TeamworkTag.ReadWrite.All`, som en Microsoft 365-administratör beviljar med **Bevilja administratörssamtycke** under **Projektinställningar** > **Arbetsyta** > **Microsoft Teams**. Om din organisation gav samtycke innan OneUptime kunde hålla taggar uppdaterade, ger du det igen en gång.
- **Vem som får ansluta en.** De roller som får redigera scheman: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Jouradministratör** och **Jourmedlem**, eller **Edit On-Call Duty Policy Schedule** i en anpassad roll. På OneUptime Cloud kräver det abonnemanget **Growth** att ansluta en.
- **Koppla från.** OneUptime slutar ändra taggen. Taggen och dess medlemmar stannar i Microsoft Teams som de är.

## Hantera en incident från Microsoft Teams

En incidents kort har fyra knappar, **Acknowledge Incident**, **Resolve Incident**, **Add Note** och **View Incident**, och resten i dess meny, knappen med tre punkter:

| Menyval | Vad det gör |
| --- | --- |
| **Change Severity** | Anger incidentens allvarlighetsgrad. |
| **Change Incident State** | Flyttar incidenten till ett senare tillstånd. |
| **Assign Role** | Ger någon en roll i incidenten, som **Incident Commander**. En roll för en person går över till den personen. |
| **Page Someone** | Larmar personer, ett team, den som har jour i ett schema just nu, eller en jourpolicy om incidenten, tills någon bekräftar den. |
| **Edit Custom Fields** | Anger incidentens anpassade fält, vart och ett ifyllt med det incidenten har. Ett fält som lämnas tomt rensas. |

`incident 42`, skrivet till boten, svarar med incident 42, de här knapparna och dess meny. Skriv numret som OneUptime visar det: `42`, `#42` eller `INC-42`. I en incidents egen kanal visar `incident` ensamt den incidenten.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime, som i Slack: se [Hantera en incident från Slack](/docs/workspace-connections/slack#hantera-en-incident-från-slack). Varje val svarar med ett kort, ifyllt så som personen som tryckte på det får se incidenten. Alla i konversationen får skicka kortet, som sig själva, med sina egna behörigheter.
- **Vad som händer.** Ändringen görs som personen som skickade kortet, som i OneUptime, och incidentens feed säger vad som ändrades. Boten säger det i ett svar som nämner personen, och tar bort kortet, så att ingen skickar det två gånger. **Page Someone** säger vem som larmades, eller varför ingen gjorde det; en incident som redan är löst larmar ingen.
- **Där Microsoft Teams skiljer sig.** Ett kort kan inte säga under ett fält vad som är fel: ett värde som inte passar nämns i ett svar, och kortet ligger kvar för att rättas och skickas igen. Ett fält för datum och tid är en dag och en tid, i din egen tidszon. En äldre Teams-klient visar menyn som fler knappar. `incident 42` svarar i konversationen, där alla i den kan se incidenten.
- **Kort från före menyn.** De behåller sin knapp **Execute On-Call Policy**, och den fungerar fortfarande: **Page Someone** larmar också en jourpolicy. Larm och episoder behåller sina.

## Agera på incidenter, larm och händelser från Microsoft Teams

Knapparna på OneUptimes kort agerar som den person som trycker på dem, i en personlig chatt, en kanal eller en gruppchatt: som det OneUptime-konto som personens Microsoft Teams-konto är anslutet till, med det kontots behörigheter i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** och **Execute On-Call Policy** på en incident, ett larm eller en episod, och **Mark as Ongoing**, **Mark as Complete**, **Change State** och **Add Note** på en schemalagd underhållshändelse, gör var och en den ändring som samma åtgärd gör i OneUptime, och den tillskrivs den personen där: postens tillståndstidslinje och feed visar vem som ändrade dess tillstånd, och anteckningen är personens. En anteckning som sparas från ett meddelande med en reaktion publiceras på samma sätt.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. Att bekräfta, lösa eller ändra tillståndet för en incident kräver behörighet att ändra dess tillstånd: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem**, eller **Create Incident State Timeline** i en anpassad roll. Ett larm, en episod eller en schemalagd underhållshändelse kräver samma behörighet för sin egen typ (**Create Alert State Timeline**, till exempel), och en anteckning kräver behörighet att publicera den typen av anteckning. Precis som tillståndspanelen i OneUptime kräver de inte behörighet att redigera själva incidenten eller larmet. Alla andra får veta det, och inget ändras.
- **Vilka poster.** De som personen får läsa, precis som i OneUptime: med en roll som är begränsad till vissa etiketter, de incidenter, larm, episoder och händelser som har dem. En knapp på någon annan post säger varför, och inget ändras: på en incident som personens roll inte når, "your access in this project does not include this incident. Ask a project admin for access to it."; på en privat incident som personen inte är ägare till, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; och på en som har raderats sedan dess, "the incident was not found. It may have been deleted." På OneUptime Cloud avvisas en ändring som projektets plan inte omfattar, med den plan som krävs.
- **Vad Change State erbjuder.** De tillstånd som personen får läsa och som posten får gå vidare till, i projektets ordning: inget före det tillstånd den är i, för en episod som för en incident, ett larm eller en schemalagd underhållshändelse, eftersom en tillståndsändring aldrig flyttar en post uppåt i sin lista igen (se [Ordningen är en verklig begränsning, inte en visningspreferens](/docs/incidents/states-and-severities#ordningen-är-en-verklig-begränsning-inte-en-visningspreferens)). När personen inte får läsa något säger boten "No incident states are available to you in this project. Ask a project admin for access to them."; när posten är i det sista tillstånd den kan nå säger den "There is no later state to move this incident to." Ingen av dem visar ett tomt kort.
- **Add Note på en privat incident.** En privat incident tar inga offentliga anteckningar, så dess kort frågar inte efter anteckningstyp och lägger till en privat anteckning. Ett kort som skickades innan den gjordes privat lägger också till en privat anteckning, och säger det. Se [Privata incidenter tar bara privata anteckningar](/docs/incidents/notes-owners-and-feed#privata-incidenter-tar-bara-privata-anteckningar).
- **Escalate.** Ett korts **Escalate** kör dess jourpolicy för den incident, det larm eller den episod som kortet gäller, som den person som tryckte på den, med samma behörigheter som **Execute On-Call Policy**. Ett kort som inte gäller någon av dem besvaras med "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", och ingen larmas.
- **Var personen får svar.** I ett svar i samma konversation, kortets tråd i en kanal, som nämner personen, så att Microsoft Teams aviserar dem. En knapp som trycks för sent säger vem som hann först, och när, till exempel "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Om personens konto inte är anslutet.** Svaret ber personen ansluta det, med knappen **Connect Microsoft Teams account**. Knappen öppnar personens egna Microsoft Teams-inställningar i OneUptime och ansluter kontot i ett steg, efter inloggning i OneUptime om det behövs. Sedan slutför OneUptime det personen tryckte på, som personen, och svarar i samma konversation; för en knapp som öppnar ett formulär, eller ett kommando, ber det personen trycka på den eller skriva det igen. Knappen fungerar en gång, i 30 minuter, och bara för det Microsoft-konto som tryckte på den.

## Koppla från

- **Koppla från** kopplar bara från ditt eget Microsoft Teams-konto och tar samtidigt bort din aviseringsmetod för Microsoft Teams.
- **Uninstall OneUptime from Microsoft Teams**, på **Projektinställningar** > **Arbetsyta** > **Microsoft Teams**, kopplar från projektet. OneUptime slutar publicera i Microsoft Teams, och menyerna **Arbetsyta** slutar visa det. Aviseringsreglerna och sammanfattningarna sparas tills du ansluter igen.

> [!WARNING]
> Att avinstallera kopplar också från varje medlems eget Microsoft Teams-konto i projektet, och tar bort aviseringsmetoderna för Microsoft Teams och de jourregler som använde dem. Ett projekt är anslutet till en enda Microsoft 365-organisation: för att flytta det till en annan avinstallerar du först.

## Felsökning

:::details Ett test säger att OneUptime-appen inte är installerad i teamet
Microsoft avvisade publiceringen eftersom boten inte finns i det teamet. Lägg till appen i teamet (se [Anslut Microsoft Teams](#anslut-microsoft-teams)) eller, för en privat kanal, i själva kanalen. Att lägga till den i ett team gör ingenting för de andra.
:::

:::details Microsoft Teams anslöts inte
När Microsoft skickar tillbaka dig utan en anslutning säger sidan du började på **Microsoft Teams anslöts inte**, och en mening säger varför: du saknar behörigheten, länken var redan använd eller hade gått ut, du loggade in i en annan Microsoft 365-organisation, eller din organisation har inga team ännu. Se [Anslutningen slutfördes inte](/docs/self-hosted/microsoft-teams-integration#anslutningen-slutfördes-inte) för varje mening och vad du ska göra.
:::

:::details Boten säger att mitt konto inte är anslutet
Tryck på **Connect Microsoft Teams account** i botens svar för att ansluta det i ett steg, eller länka det under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams** med **Connect my account with Microsoft Teams**. I båda fallen loggar du in i den organisation som projektet är anslutet till, som gäst om du är gäst där. Är du gäst och har tidigare anslutit din egen organisations konto, anslut det igen.
:::

:::details Alla aviseringar misslyckas på en egenvärdad server
Teams-appen som är installerad i dina team måste vara det paket som din server byggde, och Microsoft måste kunna nå din servers bot-slutpunkt. Se felsökningen i [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration#felsökning).
:::

## Nästa steg

:::cards
- [Slack](/docs/workspace-connections/slack): Samma aviseringar och åtgärder i Slack.
- [Videosamtal](/docs/workspace-connections/video-calls): Ge varje incident ett samtal, publicerat med dess uppdateringar.
- [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration): Konfigurera Teams-boten på en egenvärdad server.
- [Deklarera en incident](/docs/incidents/declaring-incidents): Alla sätt som en incident börjar på, och vad som körs när den gör det.
:::
