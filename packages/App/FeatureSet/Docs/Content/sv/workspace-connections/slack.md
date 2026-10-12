# Slack

Anslut OneUptime till Slack för att publicera incidenter, larm, episoder, schemalagt underhåll, monitorer och jouruppdateringar i dina kanaler, ge varje incident en egen kanal och låta responders agera utan att lämna Slack: bekräfta, lösa, lägga till anteckningar, larma jouren och deklarera incidenter.

:::cards
- [Anslut Slack](#anslut-slack): Installera OneUptime i din arbetsyta och länka sedan ditt eget konto.
- [Aviseringsregler](#aviseringsregler): Bestäm vilka händelser som publiceras var, och vilka som får en egen kanal.
- [Skapa incidenter och underhåll från Slack](#skapa-incidenter-och-underhåll-från-slack): `/incident` och `/maintenance`, som dig själv.
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

## Fråga OneUptime AI från Slack

Fråga om dina loggar, traces, mätvärden, incidenter och monitorer på vanligt språk. Nämn OneUptime med @ i en kanal, eller skicka ett direktmeddelande, så svarar den i tråden; svara där för att fråga mer. `/oneuptime ask which monitors are down?` publicerar svaret i kanalen. Båda kräver att ditt eget Slack-konto är anslutet och att AI är påslaget för projektet. Svar i Slack läser bara: använd knapparna för att ändra något. Se [Fråga AI](/docs/ai/ask-ai).

## Skapa incidenter och underhåll från Slack

`/incident` och `/maintenance` öppnar ett formulär som du fyller i och skickar som dig själv: som det OneUptime-konto som ditt Slack-konto är anslutet till (se [Anslut Slack](#anslut-slack)), med det kontots behörigheter i projektet. Om ditt Slack-konto inte är anslutet, eller om ditt OneUptime-konto inte längre är medlem i projektet, berättar OneUptime i ett direktmeddelande vad du ska göra, och inget formulär öppnas. Genvägarna **Create New Incident** och **Create Scheduled Event** öppnar samma formulär.

- **Vem som får använda dem.** De som får deklarera en incident eller skapa en schemalagd underhållshändelse i OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member** för en incident (**Create Incident** i en anpassad roll), och **Scheduled Maintenance Admin** och **Scheduled Maintenance Member** för en händelse (**Create Scheduled Maintenance**). Alla andra får veta det i ett direktmeddelande, och inget formulär öppnas.
- **Vad ett formulär erbjuder.** Varje lista — allvarlighetsgrader, monitorer, monitorstatusar, jourpolicyer och etiketter — innehåller det du får läsa, precis som samma lista i OneUptime: med en roll som är begränsad till vissa etiketter, de monitorer och jourpolicyer som har de etiketterna. En lista som du inte får läsa alls utelämnas från formuläret. Arkiverade jourpolicyer erbjuds aldrig.
- **Vad ett formulär får ange.** Incidenten eller händelsen skapas med dina egna behörigheter och tillskrivs dig. En monitor, jourpolicy, etikett, allvarlighetsgrad eller status som du inte får läsa, eller en från ett annat projekt, avvisas som en som projektet inte har, även från ett formulär som öppnades innan din åtkomst ändrades, och inget skapas. OneUptime berättar varför i ett direktmeddelande.

**Execute On-Call Policy** på en incident, ett larm eller en episod fungerar på samma sätt: den kräver behörighet att köra en jourpolicy (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** och **On-Call Member**, eller **Create On-Call Duty Policy Execution Log** i en anpassad roll) och att läsa den incidenten, det larmet eller den episoden, och den erbjuder de aktiva jourpolicyer som du får läsa.

## Agera på incidenter, larm och händelser från Slack

Knapparna i OneUptimes Slack-meddelanden agerar också som dig: som det OneUptime-konto som ditt Slack-konto är anslutet till, med det kontots behörigheter i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** och **Execute On-Call Policy** på en incident, ett larm eller en episod, och **Mark as Ongoing**, **Mark as Complete**, **Change State** och **Add Note** på en schemalagd underhållshändelse, gör var och en den ändring som samma åtgärd gör i OneUptime, och den tillskrivs dig där: postens tillståndstidslinje och feed visar att du ändrade dess tillstånd, och anteckningen är din. En anteckning som sparas från ett meddelande med en emoji-reaktion publiceras på samma sätt.

- **Vem som får använda dem.** De som får göra samma ändring i OneUptime. Att bekräfta, lösa eller ändra tillståndet för en incident kräver behörighet att ändra dess tillstånd: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** och **Incident Member**, eller **Create Incident State Timeline** i en anpassad roll. Ett larm, en episod eller en schemalagd underhållshändelse kräver samma behörighet för sin egen typ (**Create Alert State Timeline**, till exempel), och en anteckning kräver behörighet att publicera den typen av anteckning. Alla andra får veta det i ett direktmeddelande, och inget ändras.
- **Vilka poster.** De som du får läsa, precis som i OneUptime: med en roll som är begränsad till vissa etiketter, de incidenter, larm, episoder och händelser som har dem. En knapp på någon annan post, eller på en från ett annat projekt, besvaras med att posten "was not found in this project, or you do not have access to it.", och inget ändras. På OneUptime Cloud avvisas en ändring som projektets plan inte omfattar, med den plan som krävs.
- **Vad Change State erbjuder.** De tillstånd som du får läsa och som posten får gå vidare till, i projektets ordning: inget före det tillstånd den är i, för en episod som för en incident, ett larm eller en schemalagd underhållshändelse, eftersom en tillståndsändring aldrig flyttar en post uppåt i sin lista igen (se [Ordningen är en verklig begränsning, inte en visningspreferens](/docs/incidents/states-and-severities#ordningen-är-en-verklig-begränsning-inte-en-visningspreferens)). När du inte får läsa något får du beskedet "No incident states are available to you in this project. Ask a project admin for access to them."; när posten är i det sista tillstånd den kan nå får du beskedet "There is no later state to move this incident to." Ingen av dem öppnar ett tomt formulär.

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
Länka det under **Användarinställningar** > **Arbetsyta** > **Slack** med **Connect my account with Slack**. Om du inte längre är medlem i projektet säger OneUptime det i stället, och agerar inte på något åt dig.
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
