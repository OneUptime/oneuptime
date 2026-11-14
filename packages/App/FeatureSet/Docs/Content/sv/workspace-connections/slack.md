# Slack

Anslut OneUptime till Slack för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler, ge varje incident en egen kanal och låta responders agera utan att lämna Slack: bekräfta, lösa, lägga till anteckningar, larma jouren och deklarera incidenter.

:::cards
- [Anslut Slack](#anslut-slack): Installera OneUptime i din arbetsyta och länka sedan ditt eget konto.
- [Be alla att ansluta](#be-alla-att-ansluta): Skicka ett meddelande till varje medlem som inte har anslutit sitt konto, i ett svep.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Vem som är i en posts kanal](#vem-som-är-i-en-posts-kanal): Se vem som är med, gå med och lägg till personer, från postens sida.
- [Kommandot /oneuptime](#kommandot-oneuptime): Deklarera incidenter, schemalägg underhåll, se vem som har jour och fråga AI.
- [Jouranvändargrupper](#jouranvändargrupper): Håll en användargrupp lika med dem som har jour, och larma den.
- [Agera på incidenter, larm och händelser från Slack](#agera-på-incidenter-larm-och-händelser-från-slack): Knapparna i OneUptimes meddelanden.
:::

## Så fungerar det

```mermaid title="Från en händelse i OneUptime till ett meddelande i Slack"
flowchart TB
    event["En incident, ett larm eller en händelse<br/>skapas eller ändras"] --> rules{"Aviseringsregler<br/>vars villkor matchar"}
    rules -->|"En kanal<br/>för varje"| own["En egen kanal,<br/>med dess personer inbjudna allteftersom de tillkommer"]
    rules -->|"Publicera i befintliga kanaler"| existing["Dina befintliga kanaler"]
    own --> message["Ett meddelande med knappar"]
    existing --> message
    message -->|"En responder trycker på en"| change["Ändringen görs i OneUptime,<br/>som den respondern"]
```

Två anslutningar får det här att fungera:

- **Projektets anslutning**, gjord en gång: OneUptimes app installerad i din Slack-arbetsyta. Den publicerar meddelandena, skapar kanalerna och bjuder in personer.
- **Varje persons egen anslutning**: personens Slack-konto länkat till personens OneUptime-konto. Knappar, kommandon och emoji-reaktioner agerar som den personen, med personens behörigheter i projektet.

En Slack-arbetsyta kan vara ansluten till mer än ett projekt, till exempel produktion och staging. En knapp eller ett formulär agerar i projektet för den post det gäller. Ett kommando eller ett meddelande till OneUptime agerar i projektet för den kanal det skrivs i, till exempel en incidents kanal, annars i det enda projekt där ditt Slack-konto är anslutet. När inget visar vilket frågar OneUptime vilket projekt du menar, med en knapp för varje projekt du är med i, och fortsätter där så snart du har valt. I en konversation med OneUptime AI gäller ditt val resten av tråden.

## Innan du börjar

- **En roll som får ansluta projektet:** **Projektägare**, **Projektadministratör** eller **Projektmedlem**. Att avinstallera appen kräver **Projektägare** eller **Projektadministratör**.
- **En Slack-arbetsyta** där du får installera appar.
- **Growth-planen på OneUptime Cloud** för aviseringsregler och sammanfattningar. Se [Aviseringsregler under Growth-planen](#aviseringsregler-under-growth-planen).
- **På en egenvärdad server,** först en Slack-app som är konfigurerad för den. Se [Slack-integration](/docs/self-hosted/slack-integration).

## Anslut Slack

:::steps
### Installera OneUptime i din Slack-arbetsyta

Gå till **Projektinställningar** > **Arbetsyta** > **Slack** och klicka på **Anslut med Slack**. Välj arbetsytan och tillåt OneUptime. Slack skickar dig tillbaka till samma sida, som nu visar vilken arbetsyta projektet är anslutet till. Tills en arbetsyta är ansluten innehåller avsnittet **Arbetsyta** i menyerna Incidenter, Larm, Schemalagt underhåll, Monitorer och Jour **Anslut en arbetsyta**, som också leder hit.

### Anslut ditt eget Slack-konto

Att installera appen länkar kontot för den som installerade den. Alla andra länkar sitt eget Slack-konto under **Användarinställningar** > **Arbetsyta** > **Slack** med **Connect my account with Slack**, för att agera på incidenter och få direktmeddelanden som sig själva. Det avsnittet visas så snart projektet är anslutet till Slack. Se [Be alla att ansluta](#be-alla-att-ansluta) för att få med ett helt team på en gång.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Slack**. Avsnittet **Arbetsyta** visar bara de chattarbetsytor som ditt projekt har anslutit, så **Slack** visas där så snart det är anslutet. Skapa en regel, till exempel en som skapar en Slack-kanal för varje ny incident med alla som arbetar med den: de larmade, den incidentansvarige och ägarna. Se [Aviseringsregler](#aviseringsregler).

### Testa regeln

Klicka på **Testa regel** på regelns rad. Ett testmeddelande kommer i de kanaler som regeln anger. Se [Testa en regel](#testa-en-regel).
:::

## Slack Enterprise-organisationer

Med Slack Enterprise Grid kan ett projekt arbeta i flera arbetsytor i din organisation. Installera OneUptime för hela organisationen i stället för en arbetsyta:

1. En administratör eller ägare av organisationen klickar på **Anslut med Slack** under **Projektinställningar** > **Arbetsyta** > **Slack**, väljer organisationen i stället för en av dess arbetsytor på Slacks installationssida och ger OneUptime åtkomst.
2. I Slacks organisationsinställningar lägger en administratör till OneUptime i varje arbetsyta som ska använda det.
3. Kortet **Slack-arbetsytor** listar de arbetsytorna. Klicka på **Uppdatera** när OneUptime har lagts till i en ny arbetsyta.

- **Vilken arbetsyta en regel använder.** Aviseringsregler väljer den **Slack-arbetsyta** som deras kanaler finns i. Lämnas fältet tomt använder regeln standardarbetsytan och letar först där efter kanalerna den anger. **Gör till standard** på kortet ändrar standarden. Tas OneUptime bort från standardarbetsytan blir den av de återstående arbetsytorna som kommer först i bokstavsordning standard. Den förblir standard när OneUptime läggs till i den gamla arbetsytan igen.
- **En arbetsyta som OneUptime har tagits bort från.** En regel som väljer den postar inte i en annan arbetsyta i stället: regelns kort, **Testa regel** och aviseringsloggarna säger att OneUptime inte längre är tillagt i den. Kortet **Slack-kanal** säger det också när kanalen ligger i den arbetsytan. Lägg till OneUptime i den arbetsytan igen i Slacks organisationsinställningar, eller välj en annan arbetsyta i regeln.
- **Var OneUptime fungerar.** Knappar, kommandon, fliken Home och OneUptime AI fungerar i var och en av de arbetsytorna, och medlemmar ansluter sitt eget Slack-konto från vilken som helst av dem.
- **Ett projekt som är anslutet till en enda arbetsyta.** Hör den arbetsytan till organisationen behåller projektet sina regler, kanaler och anslutna konton när det installeras för hela organisationen med **Installera för organisationen** på samma sida. Den arbetsytan blir standard.
- **På en egen server** tillåter en Slack-app som skapats från OneUptimes manifest redan detta: manifestet sätter `org_deploy_enabled`.

## Be alla att ansluta

Ingen kan ansluta någon annans Slack-konto, inte ens en administratör: var och en loggar in med sitt eget. För att få med ett helt team ber en **Projektägare** eller **Projektadministratör** alla på en gång på **Projektinställningar** > **Arbetsyta** > **Slack**. Kortet **Members' Slack accounts** visar hur många medlemmar som har anslutit. **Ask everyone to connect** skickar ett direktmeddelande från OneUptime i Slack till varje medlem som inte har gjort det, med knappen **Connect Slack account**, som ansluter personens konto med ett klick.

- **Vem som får ett meddelande.** Varje medlem i projektet som inte har anslutit sitt Slack-konto och som OneUptime hittar i Slack via personens e-postadress. Den som har tillfrågats under de senaste 24 timmarna tillfrågas inte igen, så en ny förfrågan dagen efter påminner bara dem som fortfarande inte har anslutit.
- **Vad kortet säger.** Hur långt utskicket har kommit medan meddelandena skickas, och sedan vem som frågade och hur många medlemmar som fick ett meddelande. Medlemmar som OneUptime inte kunde hitta i Slack via deras e-postadress nämns på kortet: de ansluter själva under **Användarinställningar** > **Arbetsyta** > **Slack**.
- **Vad knappen ansluter.** Slack-kontot för den som trycker på den och loggar in, till personens eget OneUptime-konto. Ett meddelande som skickas vidare till någon annan ansluter ingenting till den medlem det skickades till.

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Slack, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Slack** i sin meny:

| Produkt | Flikar på produktens **Slack**-sida |
| --- | --- |
| **Incidenter** | **Incidenter**, **Incidentepisoder**, **Sammanfattning** |
| **Larm** | **Larm**, **Larmepisoder**, **Sammanfattning** |
| **Schemalagt underhåll** | En lista med regler |
| **Monitorer** | En lista med regler |
| **Jour** | En lista med regler |
| **SLOs** | En lista med regler |

Att skapa en regel går igenom upp till fem steg:

| Steg | Vad du anger |
| --- | --- |
| **Grundläggande** | **Regelnamn** och **Regelbeskrivning**. |
| **Villkor** | Vilka händelser regeln gäller, till exempel efter allvarlighetsgrad, tillstånd, etikett, monitor eller ord i titeln. De kontrolleras när en händelse skapas och igen vid varje uppdatering som OneUptime publicerar om den, så en regel för bekräftade incidenter verkar när en incident bekräftas. En ny regel gäller varje händelse, till exempel **Alla incidenter**. För att snäva in den väljer du **Endast incidenter som uppfyller villkoren** och lägger till villkoren. Med två eller fler anger **Matchningsvillkor** om alla måste matcha, eller om det räcker med ett. |
| **Mål** | Var den publicerar: **Publicera i befintliga kanaler** med kanalnamnen, **Skapa en kanal för varje incident** (eller larm, episod, händelse, monitor eller jourpolicy) med vilka som går med i den, eller båda. Under steget säger **Vad regeln gör** det i meningar, som regelns kort. |
| **Uppdateringar** | Endast incidenter, larm, episoder, schemalagt underhåll och jourpolicyer: vilka uppdateringar regeln publicerar efter postens första meddelande. **Alla uppdateringar** publicerar alla, och en ny regel börjar med det, utom en jourpolicys. **Bara viktiga uppdateringar** publicerar dem som betyder mest, som steget listar för varje slags post: för en incident att den löses eller öppnas igen, ändringar av allvarlighetsgrad, offentliga anteckningar och efteranalysen; för en jourpolicy vem som har jour nu och när ingen har det, som en ny regel för en jourpolicy börjar med. Med **Välj uppdateringar** bockar du för dem en i taget. Vad du än väljer publicerar regeln postens första meddelande, och ett videosamtal när ett startar. Se [Jourmeddelanden](#jourmeddelanden). |
| **Video Call** | Endast incidenter och larm: starta ett samtal för var och en. Se [Videosamtal](/docs/workspace-connections/video-calls). |

Varje villkor läses som en mening: fältet, hur det jämförs och värdet. Värden att välja kommer från projektets egna listor, som dess tillstånd, allvarlighetsgrader, etiketter och monitorer. En regel för jourpolicyer väljer sina policyer under **Jourpolicy**, som fortsätter att matcha en policy efter att den har bytt namn, medan **Namn på jourpolicy** matchar ord i en policys namn. Varje sorts händelse som har ägare har ett ägarvillkor, som **Ägare av incident**: välj personer och team, så matchar det de personer och team som är registrerade som händelsens ägare. Att vara med i ett team som äger händelsen räknas inte. En ägare som läggs till senare får regeln att matcha från den uppdateringen, och en regel som skapar kanaler skapar kanalen då. Ett arkiverat värde, som en allvarlighetsgrad eller en jourpolicy, erbjuds inte för ett nytt villkor. En regel som redan har ett behåller det, märkt **Arkiverad**, och matchar fortfarande de händelser som har det. En person, ett team eller en policy som projektet inte längre har stannar kvar i villkoret, och regelns kort säger det.

Ett SLO:s regel publicerar ändringarna i dess felbudgetpolicy: när SLO:et går in i en nivå, återhämtar sig till en mindre allvarlig nivå eller lämnar alla nivåer, och när dess distributioner fryses eller tillåts igen. Den publicerar bara i befintliga kanaler, eftersom ett SLO inte får någon egen kanal. Se [Publicera i Slack, Microsoft Teams och Mattermost](/docs/slo/error-budget-policy#publicera-i-slack-microsoft-teams-och-mattermost).

En kanal som regeln skapar får namn efter sin post: incident INC-42 får `inc-42`, larm ALT-7 får `alt-7`, och i ett projekt utan nummerprefix får incident 42 `incident-42`. Text i **Prefix för kanalnamn** hamnar framför, så `prod-` ger `prod-inc-42`, och formuläret visar namnet medan du skriver. För en underhållshändelse ersätter prefixet dess nummerprefix: SM-5 får `sm-5`, och `maint-` ger `maint-5`. Slack tar små bokstäver, siffror, `-` och `_`, upp till 80 tecken. Finns det redan en kanal med det namnet, till exempel ett annat projekts eller en arkiverad kanal, lägger OneUptime till `-2`, `-3` och så vidare.

En regel skapar sin kanal första gången en händelse matchar den: när händelsen skapas, eller senare, när en uppdatering får den att matcha medan den fortfarande är öppen. En regel för bekräftade incidenter skapar kanalen när incidenten bekräftas. En privat incident, ett privat larm eller en privat episod får en privat kanal.

**Vem som går med i kanalen** visar vilka regeln lägger till i sin kanal, var och en allteftersom de tillkommer posten, inte bara när kanalen skapas: **Jourhavande, allteftersom de larmas**, **Incidentansvarig och andra incidentroller, allteftersom de tilldelas** (incidenter och incidentepisoder) och **Ägare, allteftersom de läggs till**, alla ikryssade för en ny regel, och personerna, teamen och jourschemana i **Bjud också in** när kanalen skapas. Den incidentansvarige tilldelas oftast när någon först bekräftar incidenten, och går då med i dess kanal. En regel som sparades innan incidentroller fick en egen ruta lägger till dem när den lägger till ägarna eller de jourhavande, och dess ruta visas ikryssad. En befintlig kanal som en regel publicerar i får ingen.

För ett jourschema i **Bjud också in** går den som har jour i schemat när kanalen skapas med i den, så som schemats sida visar, utan att larmas. För att bara lägga till personer i vissa incidenters kanaler ger du en andra regel de villkoren och de personerna, med samma **Prefix för kanalnamn** som den första: regler som matchar en incident när dess kanal skapas delar på den kanalen, och var och en lägger till sina egna personer.

Varje senare uppdatering av posten — en tillståndsändring, en anteckning, en ny ägare — publiceras i dess kanaler, och i de befintliga kanaler som dess regler anger så länge deras villkor stämmer, när en regel som publicerar där väljer den i sitt steg **Uppdateringar**. Med **Arkivera kanalen när incidenten är löst** påslagen, eller dess motsvarighet för larm, episoder, händelser, monitorer och jourpolicyer, arkiverar regeln som skapade en kanal den när posten är löst, slutförd eller borttagen, vad dess villkor än säger då. En incident, ett larm eller en episod som skapades redan löst får ingen egen kanal; skapandemeddelandet går ändå till de kanaler som dina regler anger. Se [Deklarerad redan bekräftad eller löst](/docs/incidents/declaring-incidents#deklarerad-redan-bekräftad-eller-löst).

En incident, ett larm, en episod eller en underhållshändelse med en egen kanal har **Öppna i Slack** i sidhuvudet på sin sida i OneUptime, bredvid tillståndsknapparna. Den öppnar kanalen i en ny flik, i Slack-appen eller i webbläsaren. En post med två egna kanaler listar båda under knappen. En post med kanaler i både Slack och Microsoft Teams har i stället en knapp, **Öppna kanal**, som listar alla. De befintliga kanaler som dina regler publicerar i erbjuds inte.

En kanal förblir läsbar: varje händelse publiceras en gång, och postens första tillstånd står i meddelandet som annonserar posten, inte i ett eget meddelande. En körning av en jourpolicy är ett enda meddelande som redigeras allteftersom körningen eskalerar: vem som larmades, hur ofta och hur, vem som inte larmades och varför, och vem som bekräftade. Ett nytt meddelande publiceras bara när någon måste agera: en eskaleringsregel nådde ingen, eller körningen tog slut utan att någon bekräftade. Den som inte har kopplat sitt Slack-konto till OneUptime läggs till via det Slack-konto som har personens e-postadress. Den som OneUptime inte hittar på något av sätten, eller som är gäst i Slack, kan inte läggas till i en kanal; OneUptime säger det en gång per kanal, i ett enda meddelande som nämner alla och redigeras när listan växer. Skicka länken **Connect Slack account** i meddelandet till dem, så ansluter de sitt konto i ett steg. Att postens ägare eller statussidans prenumeranter meddelades står kvar i dess flöde i OneUptime.

**Projektinställningar** > **Arbetsyta** > **Slack** visar de kanaler som OneUptime kan se, med **Skicka test** bredvid var och en. OneUptime går själv med i en offentlig kanal första gången den publicerar där. En privat kanal visas, och kan ta emot publiceringar, först när OneUptime-appen har bjudits in till den i Slack.

En aviseringsregel kan tillhöra team. **Ansvariga team** under **Fler fält** förbehåller den de team du väljer: bara deras medlemmar och projektadministratörer kan redigera eller ta bort den, och alla andra som ser reglerna ser den skrivskyddad. Se [Regler som tillhör team](/docs/permissions/index#regler-som-tillhör-team).

### Jourmeddelanden

Vid varje överlämning får en jourpolicys kanaler veta vem som har jour, på en rad:

> 📞 @ana is now on call for Payments until tomorrow at 5:50 PM, then @bob.

- Payments länkar till policyn i OneUptime. När policyn larmar mer än ett schema nämner raden också schemat: Payments (Primary).
- En person nämns med sitt Slack-namn när hen har kopplat sitt Slack-konto till OneUptime, och med sitt namn i OneUptime fram till dess. Tider visas i varje läsares egen tidszon.
- När flera av policyns eskaleringsregler larmar samma schema publiceras varje överlämning en gång, inte en gång per regel.

En regel publicerar det den valde i sitt steg **Uppdateringar**, och en ny regel börjar med **Bara viktiga uppdateringar**: vem som har jour nu, och när ingen har det.

| Uppdatering | Vad kanalen får veta |
| --- | --- |
| **Vem som har jour nu** | Raden ovan, vid varje överlämning. |
| **Vem som har jour härnäst** | Vem som tar över vid nästa överlämning, och när: i slutet av den raden, eller på en egen rad för en regel som inte publicerar vem som har jour nu. |
| **Ingen har jour** | Ett schema som står utan någon som har jour, så att larm som når det inte larmar någon: "⚠️ Nobody is on call for Payments until tomorrow at 5:50 PM, when @bob takes over." |
| **Användaråsidosättningar** | En åsidosättning som lagts till, ändrats eller dragits tillbaka: vem som är borta, och vem som täcker upp. |
| **Ändringar i policyn** | Scheman, personer och team som lagts till i dess eskaleringsregler eller tagits bort. |
| **Ägare** | Ägare som lagts till och tagits bort. |

En kanal får ett meddelande per överlämning, även när två regler publicerar i den. En jourregel som sparades innan regler valde sina uppdateringar publicerar alla, som förut.

## Vem som är i en posts kanal

En incident, ett larm, en episod eller en underhållshändelse med en egen Slack-kanal har kortet **Slack-kanal** på sin sida i OneUptime. Kortet visar kanalen, som en länk som öppnar den i Slack, om den är privat och vem som är med i den, du först. Från kortet, utan en Slack-administratör:

- **Gå med i kanalen** lägger till dig när du inte är med i kanalen.
- **Lägg till personer** öppnar en lista över projektets personer och team: välj en person för att lägga till personen, eller ett team för att lägga till alla i det.

OneUptime-appen lägger till dem, på samma sätt som den lägger till personerna i en regels kanal. Appen stannar kvar i kanalerna den skapar, så det här fungerar även för en privat kanal som alla har lämnat.

- **Vem som får lägga till personer.** Den som får redigera posten: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem** för en incident, eller **Edit Incident** i en anpassad roll, och samma behörighet för ett larm, en episod eller en händelse (till exempel **Edit Alert**). Alla andra ser vem som är med i kanalen och hur de kommer in.
- **Vem som kan läggas till.** Någon som OneUptime hittar i Slack: via det Slack-konto personen har anslutit, eller annars via den e-postadress Slack har för personen. Kortet nämner vilka det inte kunde lägga till, och varför, till exempel en gäst som Slack håller utanför kanalen.
- **Vad som registreras.** Vem som lades till, och av vem, i postens flöde (**Kanalmedlem tillagd**) och under **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**.
- **Att ta bort någon.** OneUptime lägger bara till: ta bort någon från kanalen i Slack.

## Testa en regel

**Testa regel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, så att du ser att det kommer fram. Om regeln skapar en kanal för varje händelse skapar testet också en och bjuder in regelns personer till den.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Arbetsyta** > **Slack** kräver den behörighet att skapa aviseringsregler: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Inställningsadministratör**, **Inställningsmedlem**, eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en anpassad roll. För den som bara får se reglerna, som en **Tittare**, är **Testa regel** låst, och dess verktygstips anger vad som krävs; API:et avvisar personens test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det **Growth**-planen att testa en regel, precis som att lägga till en.

På OneUptime Cloud kräver **Skicka test** bredvid en kanal också **Growth**-planen, eftersom att publicera i en kanal är vad regler och sammanfattningar gör. **Skicka test nu** på en sammanfattning kräver behörighet att skapa sammanfattningar (**Create Workspace Notification Summary** och **Read Workspace Notification Summary** i en anpassad roll) och, på OneUptime Cloud, **Growth**-planen; för alla andra är den låst, och dess verktygstips anger vad som krävs. En MCP-klient som är ansluten med skrivskyddad åtkomst kan inte skicka något test.

## Sammanfattningar

Fliken **Sammanfattning** i **Incidenter** > **Arbetsyta** > **Slack** (och i **Larm**) publicerar en återkommande sammanställning i de kanaler du anger: hur många incidenter eller larm det var, hur snabbt de bekräftades och löstes, och en lista med länkar. En ny sammanfattning skickas varje vecka och täcker de senaste 7 dagarna. Lämna **Skicka första rapporten kl.** tomt, så skickas den första kl. 09:00 i början av nästa vecka, dag eller månad; formuläret anger när.

En sammanfattning skickas enligt klockan i sin **Tidszon**, som utgår från din. Den behåller sin tid på dagen där hela året: en som är inställd på 09:00 i Berlin skickas fortfarande kl. 09:00 i Berlin efter övergången till sommartid, och datumen i dess meddelande är också Berlins. Via API:et skickar du `timezone` som ett IANA-tidszonsnamn, som `Europe/Berlin`. En sammanfattning som skapas utan tidszon tar tidszonen från profilen för den som skapade den, eller UTC när en API-nyckel skapar den.

Formuläret för en sammanfattning har fyra steg: **Grundläggande information** (namnet och kanalerna), **Schema**, **Innehåll** (**Vad som ska inkluderas**) och **Filter** (vilka incidenter eller larm den räknar).

## Aviseringsregler under Growth-planen

På OneUptime Cloud ingår aviseringsregler och sammanfattningar i **Growth**-planen och uppåt. Ett projekt under den behåller de regler och sammanfattningar det redan har, och de fortsätter att publicera i Slack. Därför visar varje produkts **Slack**-sida (Incidenter, Larm, Schemalagt underhåll, Jour, Monitorer) planmeddelandet med dem listade nedanför (**Aviseringsregler som fortfarande är konfigurerade**, **Sammanfattningar som fortfarande är konfigurerade**): ta bort en regel, eller stäng av eller ta bort en sammanfattning. Att lägga till eller ändra regler och sammanfattningar kräver **Growth**.

## Bli larmad i Slack

För att bli larmad via direktmeddelande när du har jour lägger du till Slack som en av dina aviseringsmetoder:

:::steps
1. Anslut ditt eget Slack-konto (se [Anslut Slack](#anslut-slack)).
2. Gå till **Användarinställningar** > **Aviseringsmetoder**, öppna fliken **Arbetsyteappar** och klicka på **Add Slack Account**.
3. Klicka på **Send Test Message** på dess rad. Meddelandet kommer i dina direktmeddelanden i Slack.
:::

Att lägga till den lägger in den i dina jourregler direkt, så larm når dig i Slack från och med då. Ändra vilka larm den får under **Användarinställningar** > **Så når man mig**.

## Spara meddelanden som anteckningar

Reagera på ett meddelande i kanalen för en incident, ett larm, en episod eller en underhållshändelse, så sparar OneUptime det som en anteckning på den posten och bekräftar med ett svar i tråden:

| Reaktion | Sparas som |
| --- | --- |
| 📌 En häftstift-emoji, eller Slacks egen **Pin to channel** | En privat anteckning, som bara de som kan se posten kan läsa |
| 📢 En megafon- eller högtalar-emoji | En offentlig anteckning, som visas på statussidan. Endast incidenter och underhållshändelser. På en privat incident en privat anteckning, och bekräftelsen säger varför. När projektets offentliga anteckningar kräver godkännande visas den först när den har godkänts, och bekräftelsen säger vem den väntar på: se [Godkännande av offentliga anteckningar](/docs/incidents/notes-owners-and-feed#godkännande-av-offentliga-anteckningar). |

Anteckningen behåller meddelandet så som Slack visade det: formateringen, länkarna och koden, personerna och kanalerna det nämner, med namn, och filerna och bilderna som länkar till dem. En offentlig anteckning utelämnar filerna och bilderna, eftersom de bara öppnas för ditt team.

Det är orden från den som skrev meddelandet: personens OneUptime-namn när personens Slack-konto är anslutet, annars namnet Slack visar. En privat anteckning placeras i tidslinjen där meddelandet skickades, hur långt efteråt den än sparas. En offentlig anteckning placeras när den sparas, alltså när statussidan visar den. Tidslinjen säger vem som sparade den. Anteckningen skickas inte tillbaka till kanalen, där meddelandet redan finns.

Anteckningen sparas som dig, med dina behörigheter. Om ditt Slack-konto inte är anslutet än ber OneUptime dig ansluta det, i ett meddelande som bara du ser, med en knapp som sparar meddelandet så snart du har gjort det. Ett meddelande sparas bara en gång, oavsett hur många som reagerar.

## Kommandot /oneuptime

OneUptime har ett enda kommando i Slack, `/oneuptime`. Ordet du skriver efter det säger vad som ska göras; allt annat efter det är en fråga till OneUptime AI.

| Kommando | Vad det gör |
| --- | --- |
| `/oneuptime help` | Visar kommandona, med exempel. |
| `/oneuptime incident [title or number]` | Öppnar incidentformuläret med titeln ifylld. En incidents nummer, som `42` eller `INC-42`, visar i stället den incidenten: se [Hantera en incident från Slack](#hantera-en-incident-från-slack). |
| `/oneuptime maintenance [title]` | Öppnar formuläret för schemalagt underhåll med titeln ifylld. |
| `/oneuptime oncall` | Visar vem som har jour just nu i varje jourschema du kan se, till när, och vem som är nästa. |
| `/oneuptime page [who] [message]` | Larmar personerna du nämner med @ om ditt meddelande, eller öppnar ett formulär där du väljer vem som ska larmas. Se [Larma någon från Slack](#larma-någon-från-slack). |
| `/oneuptime ask [question]`, eller vilken fråga som helst | OneUptime AI svarar om dina loggar, traces, mätvärden, incidenter och monitorer. |

Svaren på `help` och `oncall` är meddelanden som bara du ser, under kommandot. Ett första ord som ser ut som ett felstavat kommando, som `incidnet`, får kommandot det liknar, inte ett svar från OneUptime AI. Formulären för incidenter och underhåll agerar som dig: se [Skapa incidenter och underhåll från Slack](#skapa-incidenter-och-underhåll-från-slack).

> [!NOTE]
> `/oneuptime incident` och `/oneuptime maintenance` ersätter `/incident` och `/maintenance`, som kunde krocka med kommandon med samma namn i andra Slack-appar. En Slack-app som skapats från ett tidigare manifest behåller dem, och de öppnar samma formulär, tills appen uppdateras: se [Appar skapade från ett äldre manifest](/docs/self-hosted/slack-integration#appar-skapade-från-ett-äldre-manifest).

## OneUptimes startsida i Slack

Öppna OneUptime under **Apps** i sidofältet i Slack: fliken **Home** visar vad som händer i projektet, så som du får se det, och läses om varje gång du öppnar den.

- **Din jour.** Jourschemana du har jour i just nu, och till när, eller annars ditt nästa pass.
- **Det som är öppet.** De senaste öppna incidenterna och larmen du får läsa, var och en med en länk till sin sida i OneUptime.
- **Knapparna.** **Declare incident**, **Schedule maintenance** och **Page someone** öppnar samma formulär som `/oneuptime incident`, `/oneuptime maintenance` och `/oneuptime page`, och **Who's on call** svarar som `/oneuptime oncall`.

Startsidan läser som du, så den behöver ditt eget anslutna Slack-konto. Tills det är anslutet har startsidan knappen **Connect Slack account**, och den visar din startsida så snart du har anslutit det.

I en Slack-arbetsyta som är ansluten till mer än ett projekt visar startsidan ett projekt i taget. Är ditt Slack-konto anslutet i två eller fler av dem listar menyn **Switch project** bredvid projektets namn de andra du är medlem i. Välj ett för att se dess startsida, så öppnas startsidan på det från och med då, så länge du fortfarande är medlem där. Tills du väljer ett visar den det av dina projekt som anslöts till Slack först.

När någon lägger till OneUptime i en kanal publicerar den en hälsning där: hur man ställer en fråga till den, och var man lägger till en aviseringsregel som publicerar i kanalen. Första gången du öppnar fliken **Messages** välkomnar den dig där: vad den gör i Slack, och hur du kommer igång.

## Fråga OneUptime AI från Slack

Fråga om dina loggar, traces, mätvärden, incidenter och monitorer på vanligt språk. Nämn OneUptime med @ i en kanal, eller skicka ett direktmeddelande, så svarar den i tråden. `/oneuptime ask which monitors are down?` publicerar svaret i kanalen. Båda kräver att ditt eget Slack-konto är anslutet och att AI är påslaget för projektet. Svar i Slack läser bara: ber du om en ändring säger OneUptime AI hur du gör den från Slack, till exempel med `/oneuptime incident` eller knapparna på OneUptimes meddelanden, eller länkar till Fråga AI för allt annat. Tillfrågad i en incidents eller ett larms egen kanal svarar den om den incidenten eller det larmet. Se [Fråga AI](/docs/ai/ask-ai).

OneUptime svarar bara på det som riktas till den.

- **I din egen konversation svarar du bara.** En fråga som du ställer i en kanal, inte i en tråd, startar en konversation i tråden under den: svara där för att fråga mer utan att nämna OneUptime igen, och alla andra kommer med genom att nämna den.
- **I alla andra trådar nämner du OneUptime.** Under en incidents meddelande, till exempel, nämner du den varje gång: det som folk skriver till varandra där får inget svar.
- **Om ditt Slack-konto inte är anslutet.** OneUptime ber dig en gång i varje konversation att ansluta det, i ett meddelande som bara du ser, med knappen **Connect Slack account**.

## Skapa incidenter och underhåll från Slack

`/oneuptime incident` och `/oneuptime maintenance` öppnar ett formulär som du fyller i och skickar som dig själv: som det OneUptime-konto som ditt Slack-konto är anslutet till (se [Anslut Slack](#anslut-slack)), med det kontots behörigheter i projektet. Om ditt Slack-konto inte är anslutet, eller om ditt OneUptime-konto inte längre är medlem i projektet, berättar OneUptime vad du ska göra där du körde kommandot, i ett meddelande som bara du ser, och inget formulär öppnas. Genvägarna **Create New Incident** och **Create Scheduled Event** öppnar samma formulär. När du skickar ett formulär bekräftar OneUptime det du skapade i kanalen du öppnade formuläret från, eller, för ett formulär som öppnats från appens flik **Home** eller en genväg, där det inte finns någon kanal, i appens flik **Messages**.

- **Vem som får använda dem.** De som får deklarera en incident eller skapa en underhållshändelse i OneUptime: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem** för en incident (**Create Incident** i en anpassad roll), och **Underhållsadministratör** och **Underhållsmedlem** för en händelse (**Create Scheduled Maintenance**). Alla andra får veta det där de körde det, och inget formulär öppnas.
- **Vad ett formulär erbjuder.** Varje lista — allvarlighetsgrader, monitorer, monitorstatusar, jourpolicyer och etiketter — innehåller det du får läsa, precis som samma lista i OneUptime: med en roll som är begränsad till vissa etiketter, de monitorer och jourpolicyer som har de etiketterna. En lista som du inte får läsa alls utelämnas från formuläret. Arkiverade jourpolicyer erbjuds aldrig.
- **Vad incidenten handlar om.** På incidentformuläret söker **Affected Resources** bland projektets värdar, nätverksenheter, kluster, databaser, molnresurser och tjänster medan du skriver, bland dem du får läsa, och kopplar dem du väljer till incidenten: OneUptime AI undersöker och åtgärdar det som en incident är kopplad till (se [Vilka incidenter ett klusters åtgärder gäller](/docs/ai/ai-sre#vilka-incidenter-ett-klusters-åtgärder-gäller)). Formuläret utelämnar fältet när du inte får läsa någon av dem, eller när projektet inte har några. Monitorer kopplas bara när du väljer dem i formulärets lista över monitorer, som den listan också säger: en monitor som kopplas till en incident som du deklarerar pausar sina kontroller tills incidenten är löst. Meddelandet om att incidenten har skapats nämner vad den är kopplad till. En resurs som du valde och som inte längre kan kopplas (borttagen, arkiverad eller inte längre en som du får se) utelämnas, och bara du får veta det.
- **I ett larms egen kanal.** I den kanal som OneUptime skapade för ett larm säger formuläret, så länge larmet är öppet, att incidenten deklareras från det larmet, och börjar med larmets titel och de resurser det är kopplat till som du får se. Incidenten kopplas till larmet, precis som en incident som deklareras från larmets sida, och incidenten för ett privat larm är också privat. När du inte får koppla larm till incidenter deklareras incidenten utan kopplingen, och du får veta varför.
- **Vad ett formulär får ange.** Incidenten eller händelsen skapas med dina egna behörigheter och tillskrivs dig. En monitor, jourpolicy, etikett, allvarlighetsgrad eller status som du inte får läsa, eller en från ett annat projekt, avvisas som en som projektet inte har, även från ett formulär som öppnades innan din åtkomst ändrades, och inget skapas. OneUptime berättar varför i kanalen, i ett meddelande som bara du ser.

**Execute On-Call Policy** på en incident, ett larm eller en episod fungerar på samma sätt: den kräver behörighet att köra en jourpolicy (**Projektägare**, **Projektadministratör**, **Projektmedlem**, **Jouradministratör** och **Jourmedlem**, eller **Execute On-Call Policies** i en anpassad roll) och att läsa den incidenten, det larmet eller den episoden, och den erbjuder de aktiva jourpolicyer som du får läsa.

## Larma någon från Slack

`/oneuptime page @nawaz The checkout API is throwing 500s` larmar Nawaz direkt. Han får ett telefonsamtal, ett sms, en pushnotis eller ett mejl, så som hans egna jourregler säger, och vart och ett berättar för honom vem som larmade honom, genom vilket team eller schema, och ditt meddelande. Var du kör kommandot avgör vad larmningen gäller:

- **I en incidents eller ett larms egen kanal**, den som OneUptime skapade för den, gäller larmningen den incidenten eller det larmet, och inget nytt skapas. Ett meddelande är valfritt där: `/oneuptime page @nawaz` räcker. Personerna du larmar larmas tills någon av dem svarar, från larmningen eller genom att bekräfta incidenten eller larmet; bekräftar någon annan stoppas inte larmningen, men löses den stoppas den.
- **Överallt annars**, till exempel i en annan kanal, ett direktmeddelande, appens flik **Home** eller kanalen för en löst incident eller ett löst larm, skapar OneUptime ett larm med ditt meddelande som rubrik och larmar tills någon bekräftar larmet. Formuläret säger det, och det gör även svaret som bara du ser innan någon larmas.
- **Vem som larmas direkt.** Personerna du nämner med @, och de som har jour i de scheman som en användargrupp du nämner med @ följer (se [Jouranvändargrupper](#jouranvändargrupper)), när ett meddelande följer efter dem, eller utan meddelande i en incidents eller ett larms egen kanal. OneUptime känner igen en person på det OneUptime-konto som personens Slack-konto är anslutet till, eller annars på den e-postadress Slack har för personen. Ingen utanför projektet larmas.
- **Allt annat öppnar ett formulär.** Utan någon nämnd med @, utan meddelande där larmningen behöver ett, med `@here`, med en användargrupp som inte följer något jourschema du kan se, eller med en person som OneUptime inte känner igen, öppnas formuläret **Page someone** med det du skrev ifyllt, och det säger vem det inte kunde välja. I en incidents eller ett larms egen kanal öppnas det med den incidenten eller det larmet. Välj personer, ett team, ett jourschema, som larmar den som har jour i det just nu, eller en jourpolicy, som larmar genom sina eskaleringsregler, och skicka det. Ett namn du skriver först, som i `/oneuptime page Primary The disk is full`, väljer schemat, teamet eller policyn med det namnet.
- **Var det syns.** Kanalen visar larmningen som ett enda meddelande som hålls uppdaterat: vem som larmades och hur, varje team med sitt namn och sina personer efter, ditt meddelande, och vem som bekräftade. Där OneUptime inte kan posta, till exempel i en privat kanal den inte har bjudits in till, säger ett meddelande som bara du ser vem som larmades, med en länk till incidenten eller larmet.
- **Vem som får larma.** I en incidents eller ett larms egen kanal alla som får köra en jourpolicy (**Projektägare**, **Projektadministratör**, **Projektmedlem**, **Jouradministratör** och **Jourmedlem**, eller **Execute On-Call Policies** i en anpassad roll) och läsa den incidenten eller det larmet. Överallt annars skapar larmningen ett larm, så den kräver också behörighet att skapa ett: **Projektägare**, **Projektadministratör** och **Projektmedlem**, eller **Jourmedlem** tillsammans med **Larmmedlem** (**Execute On-Call Policies** och **Create Alert** i en anpassad roll). Att larma personer, ett team eller ett schema direkt, utan en jourpolicy bakom larmningen, kräver också åtkomst till alla projektets jourpolicyer. Alla andra får veta det där de körde kommandot, och ingen larmas. På OneUptime Cloud kräver larmning Growth-planen: under den säger OneUptime vilken plan som krävs, och ingen larmas.

För att hålla personer informerade medan andra hanterar det larmar du dem som observatörer. Skriv `as observers` efter vem du larmar i en incidents eller ett larms egen kanal, som i `/oneuptime page @oversight as observers Team Y is on it`, eller välj **Observers: keep them informed** under **Page them as** i formuläret. Deras larmning säger att de är observatörer, och bekräftar de den säger det bara att de har sett den: incidenten eller larmet bekräftas inte, ingen annans larmning stoppas, och där larmningen visas står det att de larmas som observatörer. En larmning om något nytt behöver någon som hanterar det, så överallt annars avvisas `as observers`, och ingen larmas.

## Jouranvändargrupper

Håll en användargrupp i Slack, till exempel `@payments-oncall`, lika med dem som har jour i ett eller flera jourscheman, så att alla kan nämna den med @ för att nå dem. OneUptime ändrar gruppens medlemmar vid varje överlämning och åsidosättning, och kontrollerar den var 15:e minut.

:::steps
### Anslut en användargrupp till ett schema

Öppna schemat under **Jour** > **Jourscheman**. Klicka på **Anslut användargrupp** i dess kort **Användargrupper i Slack**, och välj en av arbetsytans användargrupper, eller **Skapa en ny användargrupp** med ett namn och ett alias. Medlemmarna ersätts direkt med dem som har jour.

### Anslut den även till det sekundära schemat

För en grupp med både den primära och den sekundära jouren ansluter du samma grupp på det sekundära schemats sida. En grupp kan följa hur många scheman som helst.
:::

- **Vad kortet visar.** Vem som är i varje grupp nu, de andra scheman den följer, och om den är **Uppdaterad**. Den som har jour men inte kan läggas i gruppen nämns, med skälet: OneUptime hittar en person via personens anslutna Slack-konto, eller annars via den e-postadress Slack har för personen, och Slack håller gäster utanför användargrupper.
- **Ingen har jour.** Slack kan inte behålla en användargrupp utan medlemmar, så OneUptime stänger av gruppen tills någon har jour, och slår sedan på den igen.
- **Larma gruppen.** `/oneuptime page @payments-oncall The checkout API is down` larmar dem som har jour i de scheman gruppen följer. Se [Larma någon från Slack](#larma-någon-från-slack).
- **Vad Slack kräver.** Användargrupper ingår i Slacks betalda abonnemang, och en arbetsyta kan låta bara sina ägare och administratörer ändra dem: kortet säger vilket, och vad du gör. Om Slack anslöts innan OneUptime kunde hålla användargrupper uppdaterade, ansluter du det igen en gång under **Projektinställningar** > **Arbetsyta** > **Slack**.
- **Vem som får ansluta en.** De roller som får redigera scheman: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Jouradministratör** och **Jourmedlem**, eller **Edit On-Call Schedule** i en anpassad roll. På OneUptime Cloud kräver det abonnemanget **Growth** att ansluta en.
- **I en Slack Enterprise-organisation.** När OneUptime är tillagt i två eller fler av dess arbetsytor frågar **Anslut användargrupp** först vilken **Slack-arbetsyta** gruppen finns i, och listar sedan den arbetsytans användargrupper. Kortet anger varje grupps arbetsyta, och OneUptime håller gruppen uppdaterad där.
- **Koppla från.** OneUptime slutar ändra gruppen. Gruppen och dess medlemmar stannar i Slack som de är.

## Hantera en incident från Slack

En incidents meddelande har fyra knappar, **Acknowledge Incident**, **Resolve Incident**, **Add Note** och **View Incident**, och resten i dess meny, knappen med tre punkter efter dem:

| Menyval | Vad det gör |
| --- | --- |
| **Change Severity** | Anger incidentens allvarlighetsgrad. |
| **Change Incident State** | Flyttar incidenten till ett senare tillstånd. |
| **Assign Role** | Ger någon en roll i incidenten, som **Incident Commander**. En roll för en person går över till den personen. |
| **Page Someone** | Larmar personer, ett team, den som har jour i ett schema just nu, eller en jourpolicy om incidenten, med ett valfritt meddelande. Alla som den larmar, även personerna i en policy, larmas tills någon av dem svarar eller incidenten är löst. |
| **Edit Custom Fields** | Anger incidentens anpassade fält, vart och ett ifyllt med det incidenten har. Ett fält som lämnas tomt rensas. |

`/oneuptime incident 42` visar incident 42, med de här knapparna och dess meny, i ett meddelande som bara du ser. Skriv numret som OneUptime visar det: `42`, `#42` eller `INC-42`. I en incidents egen kanal visar `/oneuptime incident` ensamt den incidenten.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. **Change Severity** och **Edit Custom Fields** kräver behörighet att redigera incidenten: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem**, eller **Edit Incident** i en anpassad roll. **Assign Role** kräver **Create Incident Member**, och **Delete Incident Member** för att flytta en roll för en person. **Page Someone** kräver samma som **Execute On-Call Policy**. Alla andra får veta varför, och inget formulär öppnas.
- **Vad formulären erbjuder.** Det du får läsa i projektet. Ett anpassat fält som kopieras från incidentens monitor utelämnas, eftersom det skulle kopieras igen, och ett formulär rymmer 40 fält: redigera resten i OneUptime.
- **Vad som händer.** Formuläret stängs, och ändringen görs som du, som i OneUptime: incidentens feed, och incidentens kanaler med den, säger vad som ändrades, varje anpassat fält med sitt nya värde. Ett värde som inte passar sitt fält, som text för ett tal, nämns under fältet, och formuläret förblir öppet. **Page Someone** säger vem som larmades, eller varför ingen gjorde det; en incident som redan är löst larmar ingen.
- **Meddelanden från före menyn.** De behåller sin knapp **Execute On-Call Policy**, och den fungerar fortfarande: **Page Someone** larmar också en jourpolicy. Larm och episoder behåller sina.

## Agera på incidenter, larm och händelser från Slack

Knapparna i OneUptimes Slack-meddelanden agerar också som dig: som det OneUptime-konto som ditt Slack-konto är anslutet till, med det kontots behörigheter i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** och **Execute On-Call Policy** på en incident, ett larm eller en episod, och **Mark as Ongoing**, **Mark as Complete**, **Change State** och **Add Note** på en underhållshändelse, gör var och en den ändring som samma åtgärd gör i OneUptime, och den tillskrivs dig där: postens tillståndstidslinje och feed visar att du ändrade dess tillstånd, och anteckningen är din. En anteckning som sparas från ett meddelande med en emoji-reaktion publiceras på samma sätt.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. Att bekräfta, lösa eller ändra tillståndet för en incident kräver behörighet att ändra dess tillstånd: **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Incidentadministratör** och **Incidentmedlem**, eller **Create Incident State Timeline** i en anpassad roll. Ett larm, en episod eller en underhållshändelse kräver samma behörighet för sin egen typ (**Create Alert State Timeline**, till exempel), och en anteckning kräver behörighet att publicera den typen av anteckning. Alla andra får veta det, och inget ändras.
- **Vilka poster.** De som du får läsa, precis som i OneUptime: med en roll som är begränsad till vissa etiketter, de incidenter, larm, episoder och händelser som har dem. En knapp på någon annan post säger varför, och inget ändras: på en incident som din roll inte når, "your access in this project does not include this incident. Ask a project admin for access to it."; på en privat incident som du inte är ägare till, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; och på en som har raderats sedan dess, "the incident was not found. It may have been deleted." På OneUptime Cloud avvisas en ändring som projektets plan inte omfattar, med den plan som krävs.
- **Vad Change State erbjuder.** De tillstånd som du får läsa och som posten får gå vidare till, i projektets ordning: inget före det tillstånd den är i, för en episod som för en incident, ett larm eller en underhållshändelse, eftersom en tillståndsändring aldrig flyttar en post uppåt i sin lista igen (se [Ordningen är en verklig begränsning](/docs/incidents/states-and-severities#ordningen-är-en-verklig-begränsning-inte-en-visningspreferens)). När du inte får läsa något får du beskedet "No incident states are available to you in this project. Ask a project admin for access to them."; när posten är i det sista tillstånd den kan nå får du beskedet "There is no later state to move this incident to." Ingen av dem öppnar ett tomt formulär.
- **Add Note på en privat incident eller episod.** En privat incident eller episod tar inga offentliga anteckningar, så dess formulär frågar inte efter anteckningstyp och lägger till en privat anteckning. Ett formulär som öppnades innan den gjordes privat lägger också till en privat anteckning, och säger det. Se [Privata incidenter tar bara privata anteckningar](/docs/incidents/notes-owners-and-feed#privata-incidenter-tar-bara-privata-anteckningar).
- **Var du får svar.** Under meddelandet med knappen, i ett meddelande som bara du ser; i ett direktmeddelande bara om Slack nekar det. En knapp som trycks för sent säger vem som hann först, och när, till exempel "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Om ditt Slack-konto inte är anslutet.** Svaret ber dig ansluta det, med knappen **Connect Slack account**. Knappen öppnar dina egna Slack-inställningar i OneUptime och ansluter ditt konto i ett steg, efter att du loggat in i OneUptime om det behövs. Sedan slutför OneUptime det du tryckte på, som du, och svarar under samma meddelande; för en knapp som öppnar ett formulär, eller ett kommando, ber det dig trycka på den eller köra det igen. Knappen fungerar en gång, i 30 minuter, och bara för det Slack-konto som tryckte på den: inloggad i Slack som någon annan ansluter den ingenting.

## Godkänn en åtgärd som OneUptime AI föreslår

En åtgärd som OneUptime AI föreslår för godkännande skickas till incidentens eller larmets kanaler med dess ändringar och tre knappar. **Review and approve** öppnar allt som åtgärden kör, med **Approve and run**, som kör exakt det, som dig. **Dismiss** avvisar åtgärden, och **View in OneUptime** öppnar incidenten eller larmet. De agerar som dig, liksom varje knapp på OneUptimes Slack-meddelanden: ett godkännande kräver behörighet att godkänna åtgärder i projektet och, för en åtgärd på ett kluster eller en resurs, att redigera den. En åtgärd som ändrades efter att dess meddelande skickades avvisas, och inget körs. Se [Godkänn eller avvisa en åtgärd från Slack eller Microsoft Teams](/docs/ai/ai-sre#godkänn-eller-avvisa-en-åtgärd-från-slack-eller-microsoft-teams).

## Godkänna en offentlig anteckning

När projektets offentliga anteckningar behöver godkännas och du slår på Slack för **Godkännande av offentliga anteckningar** i dina aviseringsinställningar, kommer varje offentlig anteckning som väntar på ett steg som du godkänner till dina direktmeddelanden med OneUptime: vem som skickade den, vilket steg den väntar på, anteckningen och tre knappar. **Approve** godkänner den för det steget; i det sista steget heter knappen **Approve and publish**, och anteckningen publiceras direkt. **Reject** öppnar ett formulär som frågar **Why are you rejecting it?**: en motivering krävs, och anteckningens författare ser den. **View in OneUptime** öppnar anteckningen. Knapparna agerar som du, enligt samma regler som i OneUptime: du måste vara angiven på steget, själv eller genom ett team, och du kan inte avgöra en anteckning du själv skickade eller godkänna två steg av samma anteckning. Du får svar i ett meddelande som bara du ser. Ett tryck efter att någon annan har avgjort, eller efter att anteckningen eller dess steg har ändrats, avgör ingenting och säger vad som hände. När anteckningen är avgjord ändras varje godkännares meddelande om den, även ditt, så att det säger vad som hände: godkänd för sitt steg och vem den väntar på nu, publicerad, avvisad, ändrad eller skickad för godkännande igen, publicerad utan godkännande, eller borttagen. Det behåller **View in OneUptime**, och **Approve** och **Reject** är borta. Om ditt Slack-konto inte är kopplat ber svaret dig koppla det, och OneUptime godkänner anteckningen åt dig när du har gjort det; tryck på **Reject** igen. Om godkännandestegen ändras medan en anteckning väntar, och den inte längre väntar på ditt steg eller du inte längre tillfrågas, ändras även ditt meddelande om den, och de som den nu väntar på får ett eget meddelande. Se [Godkännande av offentliga anteckningar](/docs/incidents/notes-owners-and-feed#godkännande-av-offentliga-anteckningar).

## Koppla från

- **Koppla från** kopplar bara från ditt eget Slack-konto och tar samtidigt bort din aviseringsmetod för Slack.
- **Avinstallera OneUptime från Slack**, på **Projektinställningar** > **Arbetsyta** > **Slack**, kopplar från projektet. OneUptime slutar publicera i Slack, och menyerna **Arbetsyta** slutar visa det. Aviseringsreglerna och sammanfattningarna sparas tills du ansluter igen.

> [!WARNING]
> Att avinstallera kopplar också från varje medlems eget Slack-konto i projektet, och tar bort aviseringsmetoderna för Slack och de jourregler som använde dem. De som larmades i Slack larmas via sina andra aviseringsmetoder tills de lägger till Slack igen.

## Dina Slack-data

OneUptime läser bara det från Slack som de här funktionerna behöver, med de behörigheter du ger när du installerar den:

- **Meddelanden till OneUptime.** Ett meddelande som nämner den med @, ett som du skickar den i ett direktmeddelande och dina svar i en konversation med den, tillsammans med de tidigare meddelandena i den tråden eller det direktmeddelandet, så att OneUptime AI kan svara. Slack skickar också de andra meddelandena i de kanaler och gruppmeddelanden den är med i; OneUptime varken svarar på dem eller sparar dem.
- **Meddelanden du sparar som anteckningar.** Ett meddelande du reagerar på med 📌 eller 📢, eller fäster, i kanalen för en incident, ett larm, en episod eller en underhållshändelse, sparat som en anteckning på den posten med författarens namn.
- **Namn på kanaler och personer.** Kanalerna den kan publicera i, så att du kan välja dem, personers namn, för att visa vem som skrev eller gjorde något, och vilka som är med i en posts egen kanal, läst när postens sida visar det.
- **E-postadresser.** Den e-postadress Slack har för en person, för att matcha personens Slack-konto med personens OneUptime-konto när personen inte har anslutit det: för att larma personen, lägga personen i en jouranvändargrupp, lägga till personen i en posts kanal eller be personen ansluta det.
- **Användargrupper.** Arbetsytans användargrupper, så att du kan välja en till ett jourschema, och personerna i en grupp du ansluter, för att hålla den lika med dem som har jour.

Det OneUptime sparar av detta — arbetsytans namn, dess kanaler, de Slack-konton som personer ansluter, anteckningarna och användargrupperna — lagras med ditt projekt. [Integritetspolicyn](https://oneuptime.com/legal/privacy) beskriver hur OneUptime hanterar dina data.

## Felsökning

:::details En regel publicerar ingenting
Kontrollera regelns villkor med **Testa regel**: om testet kommer fram matchade inte regelns villkor händelsen. Om det inte gör det visar Slack-sidan varför. För en privat kanal måste du först bjuda in OneUptime-appen till den i Slack. Varje meddelande som OneUptime publicerar, och varje meddelande som Slack avvisade, visas i **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**.
:::

:::details Någon saknas i en regels kanal
Regelns kort säger under **Sedan** vilka regeln bjuder in. Varje slags person går med allteftersom de tillkommer posten: de larmade när de larmas, den incidentansvarige när den tilldelas, en ägare när den läggs till, och de som redan fanns på posten när kanalen skapades. Den som OneUptime inte hittar i Slack, varken via det konto personen har anslutit eller via personens e-postadress, kan inte läggas till; OneUptime nämner personen i kanalen, med en länk för att ansluta sitt konto. Vill du lägga till någon direkt trycker du på **Lägg till personer** på postens kort **Slack-kanal**.
:::

:::details Alla har lämnat en privat kanal
Öppna incidenten, larmet, episoden eller händelsen i OneUptime och tryck på **Gå med i kanalen** på dess kort **Slack-kanal**, och sedan på **Lägg till personer** för att hämta tillbaka de andra. Det kräver behörighet att redigera posten, inte en Slack-administratör: OneUptime-appen är fortfarande med i kanalen och lägger till dem. Säger kortet att OneUptime inte kan se kanalen har kanalen tagits bort, eller appen tagits bort från den: Någon i kanalen kan lägga till appen igen genom att skriva `/invite @OneUptime`.
:::

:::details Slack anslöts inte
När Slack skickar tillbaka dig utan en anslutning säger sidan du började på **Slack anslöts inte**, och en mening säger varför: du saknar behörigheten, länken var redan använd eller hade gått ut, du loggade in på en annan arbetsyta, eller servern är inte konfigurerad för Slack. Se [Anslutningen slutfördes inte](/docs/self-hosted/slack-integration#anslutningen-slutfördes-inte) för varje mening och vad du ska göra.
:::

:::details En knapp eller ett kommando säger att mitt Slack-konto inte är anslutet
Tryck på **Connect Slack account** i det svaret för att ansluta det i ett steg, eller länka det under **Användarinställningar** > **Arbetsyta** > **Slack** med **Connect my account with Slack**. Om du inte längre är medlem i projektet säger OneUptime det i stället, och agerar inte på något åt dig.
:::

:::details OneUptime svarar inte på ett svar i en tråd
Ett svar som inte nämner OneUptime besvaras bara i din egen konversation med OneUptime AI: tråden under en fråga som du ställde till den i en kanal. I alla andra trådar, som den under en incidents meddelande, nämner du OneUptime med @. Om ditt Slack-konto inte är anslutet ber OneUptime dig att ansluta det en gång i varje konversation, inte vid varje meddelande: tryck på **Connect Slack account** i det meddelandet, eller länka det under **Användarinställningar** > **Arbetsyta** > **Slack**. Se [Fråga OneUptime AI från Slack](#fråga-oneuptime-ai-från-slack).
:::

:::details Aviseringar kommer fram, men knappar och kommandon gör ingenting
På en egenvärdad server måste Slack kunna nå OneUptime för knappar, formulär och kommandon; aviseringar behöver bara utgående åtkomst. Se [Nätverksåtkomst för egenvärdade installationer](/docs/self-hosted/slack-integration#nätverksåtkomst-för-egenvärdade-installationer).
:::

## Nästa steg

:::cards
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Samma aviseringar och åtgärder i Microsoft Teams.
- [Videosamtal](/docs/workspace-connections/video-calls): Ge varje incident ett samtal, publicerat med dess uppdateringar.
- [Slack-integration](/docs/self-hosted/slack-integration): Konfigurera Slack-appen på en egenvärdad server.
- [Deklarera en incident](/docs/incidents/declaring-incidents): Alla sätt som en incident börjar på, och vad som körs när den gör det.
:::
