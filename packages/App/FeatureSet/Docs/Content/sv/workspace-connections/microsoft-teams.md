# Microsoft Teams

Anslut OneUptime till Microsoft Teams för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler och chattar, ge varje incident en egen kanal och låta responders agera från Teams: bekräfta, lösa, lägga till anteckningar, larma jouren, deklarera incidenter och fråga OneUptime AI.

:::cards
- [Anslut Microsoft Teams](#anslut-microsoft-teams): Administratörsmedgivande, din inloggning och appen i varje team.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Prata med OneUptime-boten](#prata-med-oneuptime-boten): Kommandon, frågor och formulär i en chatt med boten.
- [Agera på incidenter, larm och händelser från Microsoft Teams](#agera-på-incidenter-larm-och-händelser-från-microsoft-teams): Knapparna på OneUptimes kort.
:::

## Så fungerar det

```mermaid title="Från en händelse i OneUptime till ett kort i Microsoft Teams"
flowchart TB
    event["En incident, ett larm eller en händelse<br/>skapas eller ändras"] --> rules{"Aviseringsregler<br/>vars villkor matchar"}
    rules -->|"Create Microsoft Teams Channel"| own["En egen kanal<br/>i det team du väljer"]
    rules -->|"Publicera i en befintlig<br/>kanal eller chatt"| existing["Dina kanaler och chattar"]
    own --> card["Ett kort med knappar"]
    existing --> card
    card -->|"En responder trycker på en"| change["Ändringen görs i OneUptime,<br/>som den respondern"]
```

Tre saker får det här att fungera:

- **Projektets anslutning**, gjord en gång: en Microsoft 365-administratör ger medgivande till OneUptime-appen för din organisation.
- **OneUptime-appen i varje team** som du vill ha aviseringar i. Microsoft låter bara boten publicera i ett team som den har lagts till i.
- **Varje persons egen anslutning**: personens Microsoft Teams-konto länkat till personens OneUptime-konto. Knappar, kommandon och reaktioner agerar som den personen, med personens behörigheter i projektet.

## Innan du börjar

- **En roll som får ansluta projektet:** **Project Owner**, **Project Admin** eller **Project Member**. Att avinstallera kräver **Project Owner** eller **Project Admin**.
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

Varje person länkar sitt eget Microsoft Teams-konto under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, för att agera på incidenter och få direktmeddelanden som sig själv. Det avsnittet visas så snart projektet är anslutet till Microsoft Teams.

### Lägg till en aviseringsregel

Gå till **Incidenter** > **Arbetsyta** > **Microsoft Teams**. Avsnittet **Arbetsyta** visar bara de chattarbetsytor som ditt projekt har anslutit, så **Microsoft Teams** visas där så snart det är anslutet. Skapa en regel, till exempel en som publicerar i en Teams-kanal när en incident skapas, och klicka sedan på **Testregel** på dess rad.
:::

> [!NOTE]
> Att installera OneUptime för dig själv, eller lägga till den i en chatt, är en annan installation och låter den inte publicera i ett teams kanaler. **Privata kanaler** kräver att appen läggs till i själva kanalen: öppna kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delade kanaler** kan inte ta emot aviseringar: Microsoft Teams stöder inte botar i delade kanaler.

## Aviseringsregler

En aviseringsregel anger vilka händelser som publiceras i Microsoft Teams, och var. Varje produkt har sina egna regler, under **Arbetsyta** > **Microsoft Teams** i sin meny:

| Produkt | Flikar på produktens **Microsoft Teams**-sida |
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
| **Mål** | Var den publicerar: en befintlig kanal i ett team som du väljer, de chattar som du väljer, en ny kanal som skapas i ett team som du väljer, eller flera av dessa tillsammans. |
| **Video Call** | Endast incidenter och larm: starta ett samtal för var och en. Se [Videosamtal](/docs/workspace-connections/video-calls). |

En kanal som regeln skapar får sitt namn från **New Microsoft Teams Channel Name** följt av postens nummer, som `oneuptime-incident-42`, och bara en skapad kanal får de personer som regeln bjuder in. En privat incident, ett privat larm eller en privat episod får en privat kanal. Varje senare uppdatering av posten — en tillståndsändring, en anteckning, en ny ägare — publiceras i dess kanaler och chattar.

**Projektinställningar** > **Arbetsyta** > **Microsoft Teams** visar de kanaler som OneUptime ser i dina team, och de chattar som den har lagts till i, med **Skicka test** bredvid var och en. En chatt visas så snart OneUptime-appen har lagts till i den i Microsoft Teams; **Refresh Chats** hämtar nya chattar och deras aktuella namn.

## Testa en regel

**Testregel** på en regels rad publicerar ett testmeddelande för den regeln i de kanaler den anger, så att du ser att det kommer fram. Om regeln skapar en kanal för varje händelse skapar testet också en och bjuder in regelns personer till den.

Precis som **Skicka test** bredvid en kanal i **Projektinställningar** > **Arbetsyta** > **Microsoft Teams** kräver den behörighet att skapa aviseringsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, eller **Create Workspace Notification Rule** och **Read Workspace Notification Rule** i en anpassad roll. För den som bara får se reglerna, som en **Viewer**, är **Testregel** låst, och dess verktygstips anger vad som krävs; API:et avvisar personens test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kräver det **Growth**-planen att testa en regel, precis som att lägga till en.

På OneUptime Cloud kräver **Skicka test** bredvid en kanal eller en chatt också **Growth**-planen, eftersom att publicera i en kanal är vad regler och sammanfattningar gör. **Skicka test nu** på en sammanfattning kräver behörighet att skapa sammanfattningar (**Create Workspace Notification Summary** och **Read Workspace Notification Summary** i en anpassad roll) och, på OneUptime Cloud, **Growth**-planen; för alla andra är den låst, och dess verktygstips anger vad som krävs. En MCP-klient som är ansluten med skrivskyddad åtkomst kan inte skicka något test.

## Sammanfattningar

Fliken **Summary** i **Incidenter** > **Arbetsyta** > **Microsoft Teams** (och i **Varningar**) publicerar en återkommande sammanställning i de kanaler du anger: hur många incidenter eller larm det var, hur snabbt de bekräftades och löstes, och en lista med länkar. En ny sammanfattning skickas varje vecka och täcker de senaste 7 dagarna. Lämna **Skicka första rapporten kl.** tomt, så skickas den första kl. 09:00 i början av nästa vecka, dag eller månad; formuläret anger när.

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
| 📣 eller 📢 | En offentlig anteckning, som visas på statussidan. Endast incidenter och schemalagda underhållshändelser. |

Anteckningen sparas som dig, med dina behörigheter, så ditt eget Microsoft Teams-konto måste vara anslutet, och OneUptime-appen måste finnas i teamet.

## Prata med OneUptime-boten

Skriv till boten i en personlig chatt, eller nämn OneUptime med @ i en kanal eller en gruppchatt: där svarar den bara när den nämns.

| Meddelande | Vad boten gör |
| --- | --- |
| `help` | Visar vad den kan göra. |
| `ask <question>`, eller vilken fråga som helst på vanligt språk | OneUptime AI svarar om dina loggar, traces, mätvärden, incidenter och monitorer, till exempel "vilka monitorer är nere just nu?". Svar läser bara. |
| `create incident [title]` | Öppnar incidentformuläret med titeln ifylld. |
| `create maintenance [title]` | Öppnar formuläret för schemalagt underhåll med titeln ifylld. |
| `show active incidents`, `show active alerts` | Visar det som är öppet nu. |
| `show scheduled maintenance`, `show ongoing maintenance` | Visar kommande, eller pågående, underhållshändelser. |

Att fråga OneUptime AI kräver att AI är påslaget för projektet. Se [Fråga AI](/docs/ai/ask-ai).

## Skapa incidenter och underhåll från Microsoft Teams

Att skriva `create incident` eller `create maintenance` till OneUptime-boten öppnar ett formulär för den person som skrev det, i en personlig chatt, en kanal eller en gruppchatt. Det fylls i som den personen: som det OneUptime-konto som personens Microsoft Teams-konto är anslutet till (se [Anslut Microsoft Teams](#anslut-microsoft-teams)), med det kontots behörigheter i projektet. Den som inte har sitt konto anslutet, eller vars OneUptime-konto inte längre är medlem i projektet, får veta vad som ska göras i stället för formuläret.

- **Vem som får använda dem.** De som får deklarera en incident eller skapa en schemalagd underhållshändelse i OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member** för en incident (**Create Incident** i en anpassad roll), och **Scheduled Maintenance Admin** och **Scheduled Maintenance Member** för en händelse (**Create Scheduled Maintenance**). Alla andra får veta det, och får inget formulär.
- **Vad ett formulär erbjuder.** Varje lista — allvarlighetsgrader, monitorer, monitorstatusar, jourpolicyer och etiketter — innehåller det som personen som bad om det får läsa, precis som samma lista i OneUptime, och kortets "not shown"-noteringar räknar bara dessa: med en roll som är begränsad till vissa etiketter, de monitorer och jourpolicyer som har de etiketterna. En lista som personen inte får läsa alls utelämnas. Arkiverade jourpolicyer erbjuds aldrig.
- **Vad ett formulär får ange.** I en kanal eller en gruppchatt får alla som är där skicka formuläret, och det skickas som den som gör det, med personens egna behörigheter. Incidenten eller händelsen skapas med de behörigheterna och tillskrivs den personen. En monitor, jourpolicy, etikett, allvarlighetsgrad eller status som personen inte får läsa, eller en från ett annat projekt, avvisas som en som projektet inte har, och inget skapas: boten svarar "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en incident, ett larm eller en episod fungerar på samma sätt: den kräver behörighet att köra en jourpolicy (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** och **On-Call Member**, eller **Create On-Call Duty Policy Execution Log** i en anpassad roll) och att läsa den incidenten, det larmet eller den episoden, och den erbjuder de aktiva jourpolicyer som personen får läsa. Att visa en monitor eller en jourpolicy från ett kort läser den också som den person som tryckte på knappen.

## Agera på incidenter, larm och händelser från Microsoft Teams

Knapparna på OneUptimes kort agerar som den person som trycker på dem, i en personlig chatt, en kanal eller en gruppchatt: som det OneUptime-konto som personens Microsoft Teams-konto är anslutet till, med det kontots behörigheter i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** och **Execute On-Call Policy** på en incident, ett larm eller en episod, och **Mark as Ongoing**, **Mark as Complete**, **Change State** och **Add Note** på en schemalagd underhållshändelse, gör var och en den ändring som samma åtgärd gör i OneUptime, och den tillskrivs den personen där: postens tillståndstidslinje och feed visar vem som ändrade dess tillstånd, och anteckningen är personens. En anteckning som sparas från ett meddelande med en reaktion publiceras på samma sätt.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. Att bekräfta, lösa eller ändra tillståndet för en incident kräver behörighet att ändra dess tillstånd: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member**, eller **Create Incident State Timeline** i en anpassad roll. Ett larm, en episod eller en schemalagd underhållshändelse kräver samma behörighet för sin egen typ (**Create Alert State Timeline**, till exempel), och en anteckning kräver behörighet att publicera den typen av anteckning. Precis som tillståndspanelen i OneUptime kräver de inte behörighet att redigera själva incidenten eller larmet. Alla andra får veta det, och inget ändras.
- **Vilka poster.** De som personen får läsa, precis som i OneUptime: med en roll som är begränsad till vissa etiketter, de incidenter, larm, episoder och händelser som har dem. En knapp på någon annan post, eller på en från ett annat projekt, besvaras med att posten "was not found in this project, or you do not have access to it.", och inget ändras. På OneUptime Cloud avvisas en ändring som projektets plan inte omfattar, med den plan som krävs.
- **Vad Change State erbjuder.** De tillstånd som personen får läsa och som posten får gå vidare till, i projektets ordning: inget före det tillstånd den är i, för en episod som för en incident, ett larm eller en schemalagd underhållshändelse, eftersom en tillståndsändring aldrig flyttar en post uppåt i sin lista igen (se [Ordningen är en verklig begränsning, inte en visningspreferens](/docs/incidents/states-and-severities#ordningen-är-en-verklig-begränsning-inte-en-visningspreferens)). När personen inte får läsa något säger boten "No incident states are available to you in this project. Ask a project admin for access to them."; när posten är i det sista tillstånd den kan nå säger den "There is no later state to move this incident to." Ingen av dem visar ett tomt kort.
- **Escalate.** Ett korts **Escalate** kör dess jourpolicy för den incident, det larm eller den episod som kortet gäller, som den person som tryckte på den, med samma behörigheter som **Execute On-Call Policy**. Ett kort som inte gäller någon av dem besvaras med "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", och ingen larmas.

## Koppla från

- **Disconnect** kopplar bara från ditt eget Microsoft Teams-konto och tar samtidigt bort din aviseringsmetod för Microsoft Teams.
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
Länka det under **Användarinställningar** > **Arbetsyta** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, inloggad i den organisation som projektet är anslutet till. Ett gästkonto från en annan organisation är inte samma konto.
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
