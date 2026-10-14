# Slack

Anslut OneUptime till Slack för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler, ge varje incident en egen kanal och låta responders agera utan att lämna Slack: bekräfta, lösa, lägga till anteckningar, larma jouren och deklarera incidenter.

:::cards
- [Anslut Slack](#anslut-slack): Installera OneUptime i din arbetsyta och länka sedan ditt eget konto.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Kommandot /oneuptime](#kommandot-oneuptime): Deklarera incidenter, schemalägg underhåll, se vem som har jour och fråga AI.
- [Jouranvändargrupper](#jouranvändargrupper): Håll en användargrupp lika med dem som har jour, och larma den.
- [Agera på incidenter, larm och händelser från Slack](#agera-på-incidenter-larm-och-händelser-från-slack): Knapparna i OneUptimes meddelanden.
:::

## Så fungerar det

```mermaid title="Från en händelse i OneUptime till ett meddelande i Slack"
flowchart TB
    event["En incident, ett larm eller en händelse<br/>skapas eller ändras"] --> rules{"Aviseringsregler<br/>vars villkor matchar"}
    rules -->|"Create Slack Channel"| own["En egen kanal,<br/>med dess personer inbjudna"]
    rules -->|"Post to Existing Slack Channel"| existing["Dina befintliga kanaler"]
    own --> message["Ett meddelande med knappar"]
    existing --> message
    message -->|"En responder trycker på en"| change["Ändringen görs i OneUptime,<br/>som den respondern"]
```

Två anslutningar får det här att fungera:

- **Projektets anslutning**, gjord en gång: OneUptimes app installerad i din Slack-arbetsyta. Den publicerar meddelandena, skapar kanalerna och bjuder in personer.
- **Varje persons egen anslutning**: personens Slack-konto länkat till personens OneUptime-konto. Knappar, kommandon och emoji-reaktioner agerar som den personen, med personens behörigheter i projektet.

## Innan du börjar

- **En roll som får ansluta projektet:** **Project Owner**, **Project Admin** eller **Project Member**. Att avinstallera appen kräver **Project Owner** eller **Project Admin**.
- **En Slack-arbetsyta** där du får installera appar.
- **Growth-planen på OneUptime Cloud** för aviseringsregler och sammanfattningar. Se [Aviseringsregler under Growth-planen](#aviseringsregler-under-growth-planen).
- **På en egenvärdad server,** först en Slack-app som är konfigurerad för den. Se [Slack-integration](/docs/self-hosted/slack-integration).

## Anslut Slack

:::steps
### Installera OneUptime i din Slack-arbetsyta

Gå till **Projektinställningar** > **Arbetsyta** > **Slack** och klicka på **Connect with Slack**. Välj arbetsytan och tillåt OneUptime. Slack skickar dig tillbaka till samma sida, som nu visar vilken arbetsyta projektet är anslutet till. Tills en arbetsyta är ansluten innehåller avsnittet **Arbetsyta** i menyerna Incidenter, Larm, Schemalagt underhåll, Monitorer och Jourtjänst **Anslut Slack eller Teams**, som också leder hit.

### Anslut ditt eget Slack-konto

Att installera appen länkar kontot för den som installerade den. Alla andra länkar sitt eget Slack-konto under **Användarinställningar** > **Arbetsyta** > **Slack** med **Connect my account with Slack**, för att agera på incidenter och få direktmeddelanden som sig själva. Det avsnittet visas så snart projektet är anslutet till Slack.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Slack**. Avsnittet **Arbetsyta** visar bara de chattarbetsytor som ditt projekt har anslutit, så **Slack** visas där så snart det är anslutet. Skapa en regel, till exempel en som skapar en Slack-kanal för varje ny incident och bjuder in incidentens ägare. Se [Aviseringsregler](#aviseringsregler).

### Testa regeln

Klicka på **Testregel** på regelns rad. Ett testmeddelande kommer i de kanaler som regeln anger. Se [Testa en regel](#testa-en-regel).
:::

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Slack, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Slack** i sin meny:

| Produkt | Flikar på produktens **Slack**-sida |
| --- | --- |
| **Incidenter** | **Incidenter**, **Incident Episoder**, **Summary** |
| **Varningar** | **Varningar**, **Larm Episoder**, **Summary** |
| **Schemalagt underhåll** | En lista med regler |
| **Monitorer** | En lista med regler |
| **Jourtjänst** | En lista med regler |

Att skapa en regel går igenom fyra steg:

| Steg | Vad du anger |
| --- | --- |
| **Grundläggande** | **Regelnamn** och **Regelbeskrivning**. |
| **Villkor** | Vilka händelser regeln utlöses för, till exempel efter allvarlighetsgrad, tillstånd, etikett, monitor eller ord i titeln. Utan villkor utlöses den för varje händelse. Med två eller fler anger **Matchningsvillkor** om alla måste matcha, eller om det räcker med ett. |
| **Mål** | Var den publicerar: **Post to Existing Slack Channel** med kanalnamnen, **Create Slack Channel** med den nya kanalens namn och vilka som bjuds in, eller båda. |
| **Video Call** | Endast incidenter och larm: starta ett samtal för var och en. Se [Videosamtal](/docs/workspace-connections/video-calls). |

En kanal som regeln skapar får sitt namn från **New Slack Channel Name** följt av postens nummer, som `oneuptime-incident-42`, och bara en skapad kanal får de personer som regeln bjuder in: postens ägare, valda team och användare och, för incidenter och larm, de jourhavande allteftersom de larmas. En privat incident, ett privat larm eller en privat episod får en privat kanal. Varje senare uppdatering av posten — en tillståndsändring, en anteckning, en ny ägare — publiceras i dess kanaler och i de befintliga kanaler som dess regler anger. En incident, ett larm eller en episod som skapades redan löst får ingen egen kanal; skapandemeddelandet går ändå till de kanaler som dina regler anger. Se [Deklarerad redan bekräftad eller löst](/docs/incidents/declaring-incidents#deklarerad-redan-bekräftad-eller-löst).

En incident, ett larm, en episod eller en schemalagd underhållshändelse med en egen kanal har **Öppna i Slack** i sidhuvudet på sin sida i OneUptime, bredvid tillståndsknapparna. Den öppnar kanalen i en ny flik, i Slack-appen eller i webbläsaren. En post med två egna kanaler listar båda under knappen. En post med kanaler i både Slack och Microsoft Teams har i stället en knapp, **Öppna kanal**, som listar alla. De befintliga kanaler som dina regler publicerar i erbjuds inte.

En kanal förblir läsbar: varje händelse publiceras en gång, och postens första tillstånd står i meddelandet som annonserar posten, inte i ett eget meddelande. En körning av en jourpolicy är ett enda meddelande som redigeras allteftersom körningen eskalerar: vem som larmades, hur ofta och hur, vem som inte larmades och varför, och vem som bekräftade. Ett nytt meddelande publiceras bara när någon måste agera: en eskaleringsregel nådde ingen, eller körningen tog slut utan att någon bekräftade. Den som inte har kopplat sitt Slack-konto till OneUptime kan inte läggas till i en kanal; OneUptime säger det en gång per kanal, i ett enda meddelande som nämner alla och redigeras när listan växer. Skicka länken **Connect Slack account** i meddelandet till dem, så ansluter de sitt konto i ett steg. Att postens ägare eller statussidans prenumeranter meddelades står kvar i dess flöde i OneUptime.

**Projektinställningar** > **Arbetsyta** > **Slack** visar de kanaler som OneUptime kan se, med **Skicka test** bredvid var och en. OneUptime går själv med i en offentlig kanal första gången den publicerar där. En privat kanal visas, och kan ta emot publiceringar, först när OneUptime-appen har bjudits in till den i Slack.

## Testa en regel

**Testregel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, så att du ser att det kommer fram. Om regeln skapar en kanal för varje händelse skapar testet också en och bjuder in regelns personer till den.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Arbetsyta** > **Slack** kräver den behörighet att skapa aviseringsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en anpassad roll. För den som bara får se reglerna, som en **Viewer**, är **Testregel** låst, och dess verktygstips anger vad som krävs; API:et avvisar personens test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det **Growth**-planen att testa en regel, precis som att lägga till en.

På OneUptime Cloud kräver **Skicka test** bredvid en kanal också **Growth**-planen, eftersom att publicera i en kanal är vad regler och sammanfattningar gör. **Skicka test nu** på en sammanfattning kräver behörighet att skapa sammanfattningar (**Create Workspace Notification Summary** och **Read Workspace Notification Summary** i en anpassad roll) och, på OneUptime Cloud, **Growth**-planen; för alla andra är den låst, och dess verktygstips anger vad som krävs. En MCP-klient som är ansluten med skrivskyddad åtkomst kan inte skicka något test.

## Sammanfattningar

Fliken **Summary** i **Incidenter** > **Arbetsyta** > **Slack** (och i **Varningar**) publicerar en återkommande sammanställning i de kanaler du anger: hur många incidenter eller larm det var, hur snabbt de bekräftades och löstes, och en lista med länkar. En ny sammanfattning skickas varje vecka och täcker de senaste 7 dagarna. Lämna **Skicka första rapporten kl.** tomt, så skickas den första kl. 09:00 i början av nästa vecka, dag eller månad; formuläret anger när.

En sammanfattning skickas enligt klockan i sin **Tidszon**, som utgår från din. Den behåller sin tid på dagen där hela året: en som är inställd på 09:00 i Berlin skickas fortfarande kl. 09:00 i Berlin efter övergången till sommartid, och datumen i dess meddelande är också Berlins. Via API:et skickar du `timezone` som ett IANA-tidszonsnamn, som `Europe/Berlin`. En sammanfattning som skapas utan tidszon tar tidszonen från profilen för den som skapade den, eller UTC när en API-nyckel skapar den.

Formuläret för en sammanfattning har fyra steg: **Grundläggande information** (namnet och kanalerna), **Schema**, **Innehåll** (**Vad som ska inkluderas**) och **Filter** (vilka incidenter eller larm den räknar).

## Aviseringsregler under Growth-planen

På OneUptime Cloud ingår aviseringsregler och sammanfattningar i **Growth**-planen och uppåt. Ett projekt under den behåller de regler och sammanfattningar det redan har, och de fortsätter att publicera i Slack. Därför visar varje produkts **Slack**-sida (Incidenter, Larm, Schemalagt underhåll, Jourtjänst, Monitorer) planmeddelandet med dem listade nedanför (**Aviseringsregler som fortfarande är konfigurerade**, **Sammanfattningar som fortfarande är konfigurerade**): ta bort en regel, eller stäng av eller ta bort en sammanfattning. Att lägga till eller ändra regler och sammanfattningar kräver **Growth**.

## Bli larmad i Slack

För att bli larmad via direktmeddelande när du har jour lägger du till Slack som en av dina aviseringsmetoder:

:::steps
1. Anslut ditt eget Slack-konto (se [Anslut Slack](#anslut-slack)).
2. Gå till **Användarinställningar** > **Aviseringsmetoder**, öppna fliken **Workspace Apps** och klicka på **Add Slack Account**.
3. Klicka på **Send Test Message** på dess rad. Meddelandet kommer i dina direktmeddelanden i Slack.
:::

Att lägga till den lägger in den i dina jourregler direkt, så larm når dig i Slack från och med då. Ändra vilka larm den får under **Användarinställningar** > **Jourregler**.

## Spara meddelanden som anteckningar

Reagera på ett meddelande i kanalen för en incident, ett larm, en episod eller en schemalagd underhållshändelse, så sparar OneUptime det som en anteckning på den posten och bekräftar med ett svar i tråden:

| Reaktion | Sparas som |
| --- | --- |
| 📌 En häftstift-emoji, eller Slacks egen **Pin to channel** | En privat anteckning, som bara ditt team ser |
| 📢 En megafon- eller högtalar-emoji | En offentlig anteckning, som visas på statussidan. Endast incidenter och schemalagda underhållshändelser. |

Anteckningen sparas som dig, med dina behörigheter, så ditt eget Slack-konto måste vara anslutet. Ett meddelande sparas bara en gång, oavsett hur många som reagerar.

## Kommandot /oneuptime

OneUptime har ett enda kommando i Slack, `/oneuptime`. Ordet du skriver efter det säger vad som ska göras; allt annat efter det är en fråga till OneUptime AI.

| Kommando | Vad det gör |
| --- | --- |
| `/oneuptime help` | Visar kommandona, med exempel. |
| `/oneuptime incident [title]` | Öppnar incidentformuläret med titeln ifylld. |
| `/oneuptime maintenance [title]` | Öppnar formuläret för schemalagt underhåll med titeln ifylld. |
| `/oneuptime oncall` | Visar vem som har jour just nu i varje jourschema du kan se, till när, och vem som är nästa. |
| `/oneuptime page [who] [message]` | Larmar personerna du nämner med @ om ditt meddelande, eller öppnar ett formulär där du väljer vem som ska larmas. Se [Larma någon från Slack](#larma-någon-från-slack). |
| `/oneuptime ask [question]`, eller vilken fråga som helst | OneUptime AI svarar om dina loggar, traces, mätvärden, incidenter och monitorer. |

Svaren på `help` och `oncall` är meddelanden som bara du ser, under kommandot. Ett första ord som ser ut som ett felstavat kommando, som `incidnet`, får kommandot det liknar, inte ett svar från OneUptime AI. Formulären för incidenter och underhåll agerar som dig: se [Skapa incidenter och underhåll från Slack](#skapa-incidenter-och-underhåll-från-slack).

> [!NOTE]
> `/oneuptime incident` och `/oneuptime maintenance` ersätter `/incident` och `/maintenance`, som kunde krocka med kommandon med samma namn i andra Slack-appar. En Slack-app som skapats från ett tidigare manifest behåller dem, och de öppnar samma formulär, tills appen uppdateras: se [Appar skapade från ett äldre manifest](/docs/self-hosted/slack-integration#appar-skapade-från-ett-äldre-manifest).

## Fråga OneUptime AI från Slack

Fråga om dina loggar, traces, mätvärden, incidenter och monitorer på vanligt språk. Nämn OneUptime med @ i en kanal, eller skicka ett direktmeddelande, så svarar den i tråden. `/oneuptime ask which monitors are down?` publicerar svaret i kanalen. Båda kräver att ditt eget Slack-konto är anslutet och att AI är påslaget för projektet. Svar i Slack läser bara: använd knapparna för att ändra något. Se [Fråga AI](/docs/ai/ask-ai).

OneUptime svarar bara på det som riktas till den.

- **I din egen konversation svarar du bara.** En fråga som du ställer i en kanal, inte i en tråd, startar en konversation i tråden under den: svara där för att fråga mer utan att nämna OneUptime igen, och alla andra kommer med genom att nämna den.
- **I alla andra trådar nämner du OneUptime.** Under en incidents meddelande, till exempel, nämner du den varje gång: det som folk skriver till varandra där får inget svar.
- **Om ditt Slack-konto inte är anslutet.** OneUptime ber dig en gång i varje konversation att ansluta det, i ett meddelande som bara du ser, med knappen **Connect Slack account**.

## Skapa incidenter och underhåll från Slack

`/oneuptime incident` och `/oneuptime maintenance` öppnar ett formulär som du fyller i och skickar som dig själv: som det OneUptime-konto som ditt Slack-konto är anslutet till (se [Anslut Slack](#anslut-slack)), med det kontots behörigheter i projektet. Om ditt Slack-konto inte är anslutet, eller om ditt OneUptime-konto inte längre är medlem i projektet, berättar OneUptime vad du ska göra där du körde kommandot, i ett meddelande som bara du ser, och inget formulär öppnas. Genvägarna **Create New Incident** och **Create Scheduled Event** öppnar samma formulär.

- **Vem som får använda dem.** De som får deklarera en incident eller skapa en schemalagd underhållshändelse i OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member** för en incident (**Create Incident** i en anpassad roll), och **Scheduled Maintenance Admin** och **Scheduled Maintenance Member** för en händelse (**Create Scheduled Maintenance**). Alla andra får veta det där de körde det, och inget formulär öppnas.
- **Vad ett formulär erbjuder.** Varje lista — allvarlighetsgrader, monitorer, monitorstatusar, jourpolicyer och etiketter — innehåller det du får läsa, precis som samma lista i OneUptime: med en roll som är begränsad till vissa etiketter, de monitorer och jourpolicyer som har de etiketterna. En lista som du inte får läsa alls utelämnas från formuläret. Arkiverade jourpolicyer erbjuds aldrig.
- **Vad ett formulär får ange.** Incidenten eller händelsen skapas med dina egna behörigheter och tillskrivs dig. En monitor, jourpolicy, etikett, allvarlighetsgrad eller status som du inte får läsa, eller en från ett annat projekt, avvisas som en som projektet inte har, även från ett formulär som öppnades innan din åtkomst ändrades, och inget skapas. OneUptime berättar varför i kanalen, i ett meddelande som bara du ser.

**Execute On-Call Policy** på en incident, ett larm eller en episod fungerar på samma sätt: den kräver behörighet att köra en jourpolicy (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** och **On-Call Member**, eller **Create On-Call Duty Policy Execution Log** i en anpassad roll) och att läsa den incidenten, det larmet eller den episoden, och den erbjuder de aktiva jourpolicyer som du får läsa.

## Larma någon från Slack

`/oneuptime page @nawaz The checkout API is throwing 500s` larmar Nawaz direkt. OneUptime skapar ett larm med ditt meddelande som rubrik, och varje person du nämner med @ får ett telefonsamtal, ett sms, en pushnotis eller ett mejl, så som personens egna jourregler säger, tills någon bekräftar larmet.

- **Vem som larmas direkt.** Personerna du nämner med @, och de som har jour i de scheman som en användargrupp du nämner med @ följer (se [Jouranvändargrupper](#jouranvändargrupper)), när ett meddelande följer efter dem. OneUptime känner igen en person på det OneUptime-konto som personens Slack-konto är anslutet till, eller annars på den e-postadress Slack har för personen. Ingen utanför projektet larmas.
- **Allt annat öppnar ett formulär.** Utan någon nämnd med @, utan meddelande, med `@here`, med en användargrupp som inte följer något jourschema du kan se, eller med en person som OneUptime inte känner igen, öppnas formuläret **Page someone** med det du skrev ifyllt, och det säger vem det inte kunde välja. Välj personer, ett team, ett jourschema, som larmar den som har jour i det just nu, eller en jourpolicy, som larmar genom sina eskaleringsregler, och skicka det. Ett namn du skriver först, som i `/oneuptime page Primary The disk is full`, väljer schemat, teamet eller policyn med det namnet.
- **Var det syns.** Kanalen visar larmningen som ett enda meddelande som hålls uppdaterat: vem som larmades och hur, och vem som bekräftade. Där OneUptime inte kan posta, till exempel i en privat kanal den inte har bjudits in till, säger ett meddelande som bara du ser vem som larmades, med en länk till larmet.
- **Vem som får larma.** Alla som får både köra en jourpolicy och skapa ett larm: **Project Owner**, **Project Admin** och **Project Member**, eller **On-Call Member** tillsammans med **Alert Member** (**Create On-Call Duty Policy Execution Log** och **Create Alert** i en anpassad roll). Att larma personer, ett team eller ett schema direkt, utan en jourpolicy bakom larmningen, kräver också åtkomst till alla projektets jourpolicyer. Alla andra får veta det där de körde kommandot, och ingen larmas.

## Jouranvändargrupper

Håll en användargrupp i Slack, till exempel `@payments-oncall`, lika med dem som har jour i ett eller flera jourscheman, så att alla kan nämna den med @ för att nå dem. OneUptime ändrar gruppens medlemmar vid varje överlämning och åsidosättning, och kontrollerar den var 15:e minut.

:::steps
### Anslut en användargrupp till ett schema

Öppna schemat under **Jourtjänst** > **Jourscheman**. Klicka på **Anslut användargrupp** i dess kort **Användargrupper i Slack**, och välj en av arbetsytans användargrupper, eller **Skapa en ny användargrupp** med ett namn och ett alias. Medlemmarna ersätts direkt med dem som har jour.

### Anslut den även till det sekundära schemat

För en grupp med både den primära och den sekundära jouren ansluter du samma grupp på det sekundära schemats sida. En grupp kan följa hur många scheman som helst.
:::

- **Vad kortet visar.** Vem som är i varje grupp nu, de andra scheman den följer, och om den är **Uppdaterad**. Den som har jour men inte kan läggas i gruppen nämns, med skälet: OneUptime hittar en person via personens anslutna Slack-konto, eller annars via den e-postadress Slack har för personen, och Slack håller gäster utanför användargrupper.
- **Ingen har jour.** Slack kan inte behålla en användargrupp utan medlemmar, så OneUptime stänger av gruppen tills någon har jour, och slår sedan på den igen.
- **Larma gruppen.** `/oneuptime page @payments-oncall The checkout API is down` larmar dem som har jour i de scheman gruppen följer. Se [Larma någon från Slack](#larma-någon-från-slack).
- **Vad Slack kräver.** Användargrupper ingår i Slacks betalda abonnemang, och en arbetsyta kan låta bara sina ägare och administratörer ändra dem: kortet säger vilket, och vad du gör. Om Slack anslöts innan OneUptime kunde hålla användargrupper uppdaterade, ansluter du det igen en gång under **Projektinställningar** > **Arbetsyta** > **Slack**.
- **Vem som får ansluta en.** De roller som får redigera scheman: **Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** och **On-Call Member**, eller **Edit On-Call Duty Policy Schedule** i en anpassad roll. På OneUptime Cloud kräver det abonnemanget **Growth** att ansluta en.
- **Koppla från.** OneUptime slutar ändra gruppen. Gruppen och dess medlemmar stannar i Slack som de är.

## Agera på incidenter, larm och händelser från Slack

Knapparna i OneUptimes Slack-meddelanden agerar också som dig: som det OneUptime-konto som ditt Slack-konto är anslutet till, med det kontots behörigheter i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** och **Execute On-Call Policy** på en incident, ett larm eller en episod, och **Mark as Ongoing**, **Mark as Complete**, **Change State** och **Add Note** på en schemalagd underhållshändelse, gör var och en den ändring som samma åtgärd gör i OneUptime, och den tillskrivs dig där: postens tillståndstidslinje och feed visar att du ändrade dess tillstånd, och anteckningen är din. En anteckning som sparas från ett meddelande med en emoji-reaktion publiceras på samma sätt.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. Att bekräfta, lösa eller ändra tillståndet för en incident kräver behörighet att ändra dess tillstånd: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member**, eller **Create Incident State Timeline** i en anpassad roll. Ett larm, en episod eller en schemalagd underhållshändelse kräver samma behörighet för sin egen typ (**Create Alert State Timeline**, till exempel), och en anteckning kräver behörighet att publicera den typen av anteckning. Alla andra får veta det, och inget ändras.
- **Vilka poster.** De som du får läsa, precis som i OneUptime: med en roll som är begränsad till vissa etiketter, de incidenter, larm, episoder och händelser som har dem. En knapp på någon annan post, eller på en från ett annat projekt, besvaras med att posten "was not found in this project, or you do not have access to it.", och inget ändras. På OneUptime Cloud avvisas en ändring som projektets plan inte omfattar, med den plan som krävs.
- **Vad Change State erbjuder.** De tillstånd som du får läsa och som posten får gå vidare till, i projektets ordning: inget före det tillstånd den är i, för en episod som för en incident, ett larm eller en schemalagd underhållshändelse, eftersom en tillståndsändring aldrig flyttar en post uppåt i sin lista igen (se [Ordningen är en verklig begränsning, inte en visningspreferens](/docs/incidents/states-and-severities#ordningen-är-en-verklig-begränsning-inte-en-visningspreferens)). När du inte får läsa något får du beskedet "No incident states are available to you in this project. Ask a project admin for access to them."; när posten är i det sista tillstånd den kan nå får du beskedet "There is no later state to move this incident to." Ingen av dem öppnar ett tomt formulär.
- **Var du får svar.** Under meddelandet med knappen, i ett meddelande som bara du ser; i ett direktmeddelande bara om Slack nekar det. En knapp som trycks för sent säger vem som hann först, och när, till exempel "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Om ditt Slack-konto inte är anslutet.** Svaret ber dig ansluta det, med knappen **Connect Slack account**. Knappen öppnar dina egna Slack-inställningar i OneUptime och ansluter ditt konto i ett steg, efter att du loggat in i OneUptime om det behövs. Sedan slutför OneUptime det du tryckte på, som du, och svarar under samma meddelande; för en knapp som öppnar ett formulär, eller ett kommando, ber det dig trycka på den eller köra det igen. Knappen fungerar en gång, i 30 minuter, och bara för det Slack-konto som tryckte på den: inloggad i Slack som någon annan ansluter den ingenting.

## Koppla från

- **Disconnect** kopplar bara från ditt eget Slack-konto och tar samtidigt bort din aviseringsmetod för Slack.
- **Uninstall OneUptime from Slack**, på **Projektinställningar** > **Arbetsyta** > **Slack**, kopplar från projektet. OneUptime slutar publicera i Slack, och menyerna **Arbetsyta** slutar visa det. Aviseringsreglerna och sammanfattningarna sparas tills du ansluter igen.

> [!WARNING]
> Att avinstallera kopplar också från varje medlems eget Slack-konto i projektet, och tar bort aviseringsmetoderna för Slack och de jourregler som använde dem. De som larmades i Slack larmas via sina andra aviseringsmetoder tills de lägger till Slack igen.

## Felsökning

:::details En regel publicerar ingenting
Kontrollera regelns villkor med **Testregel**: om testet kommer fram matchade inte regelns villkor händelsen. Om det inte gör det visar Slack-sidan varför. För en privat kanal måste du först bjuda in OneUptime-appen till den i Slack. Varje meddelande som OneUptime publicerar, och varje meddelande som Slack avvisade, visas i **Projektinställningar** > **Aviseringar** > **Aviseringsloggar**, på fliken **Arbetsyta**.
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
