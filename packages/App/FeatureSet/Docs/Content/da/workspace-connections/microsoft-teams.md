# Microsoft Teams

Forbind OneUptime med Microsoft Teams for at slå hændelser, advarsler, episoder, planlagt vedligeholdelse, monitorer og vagtopdateringer op i dine kanaler og chats, give hver hændelse sin egen kanal og lade responders handle fra Teams: bekræfte, løse, tilføje noter, tilkalde vagten, oprette hændelser og spørge OneUptime AI.

:::cards
- [Forbind Microsoft Teams](#forbind-microsoft-teams): Administratorsamtykke, dit login og appen i hvert team.
- [Notifikationsregler](#notifikationsregler): Bestem, hvilke begivenheder der slås op hvor, og hvilke der får deres egen kanal.
- [Tal med OneUptime-botten](#tal-med-oneuptime-botten): Kommandoer, spørgsmål og formularer i en chat med botten.
- [Handl på hændelser, advarsler og begivenheder fra Microsoft Teams](#handl-på-hændelser-advarsler-og-begivenheder-fra-microsoft-teams): Knapperne på OneUptimes kort.
:::

## Sådan virker det

```mermaid title="Fra en begivenhed i OneUptime til et kort i Microsoft Teams"
flowchart TB
    event["En hændelse, advarsel eller begivenhed<br/>oprettes eller ændres"] --> rules{"Notifikationsregler<br/>hvis betingelser passer"}
    rules -->|"Create Microsoft Teams Channel"| own["En kanal for sig selv<br/>i det team, du vælger"]
    rules -->|"Slå op i en eksisterende<br/>kanal eller chat"| existing["Dine kanaler og chats"]
    own --> card["Et kort med knapper"]
    existing --> card
    card -->|"En responder trykker på én"| change["Ændringen sker i OneUptime,<br/>som den responder"]
```

Tre ting får det til at virke:

- **Projektets forbindelse**, lavet én gang: en Microsoft 365-administrator giver samtykke til OneUptime-appen for din organisation.
- **OneUptime-appen i hvert team**, du vil have notifikationer i. Microsoft lader kun botten slå op i et team, den er føjet til.
- **Hver persons egen forbindelse**: personens Microsoft Teams-konto knyttet til personens OneUptime-konto. Knapper, kommandoer og reaktioner handler som den person, med personens rettigheder i projektet.

## Før du begynder

- **En rolle, der må forbinde projektet:** **Project Owner**, **Project Admin** eller **Project Member**. At afinstallere kræver **Project Owner** eller **Project Admin**.
- **En Microsoft 365-administrator**, der giver administratorsamtykke, én gang for hele organisationen.
- **Growth-planen på OneUptime Cloud** til notifikationsregler og opsummeringer. Se [Notifikationsregler under Growth-planen](#notifikationsregler-under-growth-planen).
- **På en selvhostet server,** først en Teams-bot, der er sat op til den. Se [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration).

## Forbind Microsoft Teams

:::steps
### Giv administratorsamtykke

Gå til **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**, og klik på **Giv administratorsamtykke**. En Microsoft 365-administrator logger ind og tillader OneUptime-appen for organisationen. Kortet siger derefter **Admin Consent Completed**. Indtil et workspace er forbundet, indeholder sektionen **Arbejdsområde** i menuerne Hændelser, Advarsler, Planlagt vedligeholdelse, Monitorer og Vagtordning **Forbind Slack eller Teams**, som også fører hertil.

### Forbind din konto

Klik på **Connect with Microsoft Teams**, og log ind med din arbejdskonto. OneUptime læser din organisations teams; **Vis teams** viser dem.

### Føj OneUptime-appen til hvert team (påkrævet)

Det er ikke nok i sig selv at forbinde din konto. Microsoft lader kun OneUptime-botten slå op i et team, den er føjet til, så gør dette for hvert team, du vil have notifikationer i:

- I Microsoft Teams skal du klikke på "..." ud for **teamnavnet** (ikke kanalnavnet).
- Vælg **Manage team** > **Apps** > **More apps**, find **OneUptime**, og klik på **Add**.

På OneUptime Cloud åbner **Åbn Teams Store** appen i Microsoft Teams Store, hvor **Add to a team** gør det samme. På en selvhostet server skal du i stedet installere pakken fra **Download app-manifest-zip**: kun den indeholder din servers bot. Hvis en testnotifikation siger, at OneUptime-appen ikke er installeret i teamet, er det dette trin, der blev sprunget over.

### Forbind alle andre

Hver person knytter sin egen Microsoft Teams-konto under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams** for at handle på hændelser og få direkte beskeder som sig selv. Den sektion vises, så snart projektet er forbundet med Microsoft Teams.

### Tilføj en notifikationsregel

Gå til **Hændelser** > **Arbejdsområde** > **Microsoft Teams**. Sektionen **Arbejdsområde** viser kun de chat-workspaces, dit projekt har forbundet, så **Microsoft Teams** vises der, så snart det er forbundet. Opret en regel, for eksempel en, der slår op i en Teams-kanal, når en hændelse oprettes, og klik derefter på **Testregel** i dens række.
:::

> [!NOTE]
> At installere OneUptime for dig selv, eller føje den til en chat, er en anden installation og lader den ikke slå op i et teams kanaler. **Private kanaler** kræver, at appen er føjet til selve kanalen: åbn kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delte kanaler** kan ikke modtage notifikationer: Microsoft Teams understøtter ikke bots i delte kanaler.

## Notifikationsregler

En notifikationsregel siger, hvilke begivenheder der slås op i Microsoft Teams, og hvor. Hvert produkt har sine egne regler, under **Arbejdsområde** > **Microsoft Teams** i sin menu:

| Produkt | Faner på dets **Microsoft Teams**-side |
| --- | --- |
| **Hændelser** | **Hændelser**, **Hændelse Episoder**, **Summary** |
| **Advarsler** | **Advarsler**, **Advarsel Episoder**, **Summary** |
| **Planlagt vedligeholdelse** | Én liste med regler |
| **Monitorer** | Én liste med regler |
| **Vagtordning** | Én liste med regler |

At oprette en regel går gennem fire trin:

| Trin | Hvad du angiver |
| --- | --- |
| **Grundlæggende** | **Regelnavn** og **Regelbeskrivelse**. |
| **Betingelser** | Hvilke begivenheder reglen udløses for, for eksempel efter alvorlighed, tilstand, etiket, monitor eller ord i titlen. Uden betingelser udløses den for hver begivenhed. Med to eller flere siger **Matchbetingelse**, om alle skal passe, eller om én er nok. |
| **Destination** | Hvor den slår op: en eksisterende kanal i et team, du vælger, de chats, du vælger, en ny kanal, der oprettes i et team, du vælger, eller flere af dem sammen. |
| **Video Call** | Kun hændelser og advarsler: start et opkald for hver. Se [Videoopkald](/docs/workspace-connections/video-calls). |

En kanal, som reglen opretter, får sit navn fra **New Microsoft Teams Channel Name** efterfulgt af postens nummer, som `oneuptime-incident-42`, og kun en oprettet kanal får de folk, reglen inviterer. En privat hændelse, advarsel eller episode får en privat kanal. Hver senere opdatering af posten — en tilstandsændring, en note, en ny ejer — slås op i dens kanaler og chats.

**Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams** viser de kanaler, OneUptime kan se i dine teams, og de chats, den er føjet til, med **Send test** ved siden af hver. En chat vises, så snart OneUptime-appen er føjet til den i Microsoft Teams; **Refresh Chats** henter nye chats og deres nuværende navne.

## Test en regel

**Testregel** i en regels række slår en testbesked for den regel op i de kanaler, den nævner, så du kan se den ankomme. Hvis reglen opretter en kanal for hver begivenhed, opretter testen også en og inviterer reglens folk ind i den.

Ligesom **Send test** ved siden af en kanal i **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams** kræver den rettighed til at oprette notifikationsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en brugerdefineret rolle. For en, der kun må se reglerne, som en **Viewer**, er **Testregel** låst, og dens værktøjstip siger, hvad der kræves; API'en afviser vedkommendes test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kræver det **Growth**-planen at teste en regel, ligesom at tilføje en.

På OneUptime Cloud kræver **Send test** ved siden af en kanal eller en chat også **Growth**-planen, da det at slå op i en kanal er det, regler og opsummeringer gør. **Send test nu** på en opsummering kræver rettighed til at oprette opsummeringer (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en brugerdefineret rolle) og, på OneUptime Cloud, **Growth**-planen; for alle andre er den låst, og dens værktøjstip siger, hvad der kræves. En MCP-klient, der er forbundet med skrivebeskyttet adgang, kan ikke sende nogen test.

## Opsummeringer

Fanen **Summary** i **Hændelser** > **Arbejdsområde** > **Microsoft Teams** (og i **Advarsler**) slår en tilbagevendende opsummering op i de kanaler, du nævner: hvor mange hændelser eller advarsler der var, hvor hurtigt de blev bekræftet og løst, og en liste med links. En ny opsummering sendes hver uge og dækker de seneste 7 dage. Lad **Send første rapport kl.** være tom, så sendes den første kl. 09:00 i starten af næste uge, dag eller måned; formularen siger hvornår.

En opsummering sendes efter uret i sin **Tidszone**, som starter med din. Den holder sit klokkeslæt der hele året: en, der er sat til 09:00 i Berlin, sendes stadig kl. 09:00 i Berlin, efter at urene er stillet til sommertid, og datoerne i dens besked er også Berlins. Via API'en sender du `timezone` som et IANA-tidszonenavn, som `Europe/Berlin`. En opsummering, der oprettes uden tidszone, tager tidszonen fra opretterens profil, eller UTC når en API-nøgle opretter den.

Formularen til en opsummering har fire trin: **Grundlæggende oplysninger** (navnet, kanalerne og deres **Teamnavn**), **Tidsplan**, **Indhold** (**Hvad der skal inkluderes**) og **Filtre** (hvilke hændelser eller advarsler den tæller).

## Notifikationsregler under Growth-planen

På OneUptime Cloud hører notifikationsregler og opsummeringer til **Growth**-planen og derover. Et projekt under den beholder de regler og opsummeringer, det allerede har, og de bliver ved med at slå op i Microsoft Teams. Derfor viser hvert produkts **Microsoft Teams**-side (Hændelser, Advarsler, Planlagt vedligeholdelse, Vagtordning, Monitorer) planbemærkningen med dem nedenunder (**Meddelelsesregler, der stadig er sat op**, **Opsummeringer, der stadig er sat op**): slet en regel, eller slå en opsummering fra eller slet den. At tilføje eller ændre regler og opsummeringer kræver **Growth**.

## Bliv tilkaldt i Microsoft Teams

For at blive tilkaldt via direkte besked, når du har vagt, tilføjer du Microsoft Teams som en af dine notifikationsmetoder:

:::steps
1. Forbind din egen Microsoft Teams-konto (se [Forbind Microsoft Teams](#forbind-microsoft-teams)).
2. Gå til **Brugerindstillinger** > **Notifikationsmetoder**, åbn fanen **Workspace Apps**, og klik på **Add Microsoft Teams Account**.
3. Klik på **Send Test Message** i dens række. Beskeden ankommer i dine chats i Microsoft Teams.
:::

At tilføje den sætter den straks ind i dine vagtregler, så tilkald når dig i Microsoft Teams fra da af. Ændr, hvilke tilkald den får, under **Brugerindstillinger** > **Vagtregler**.

## Gem beskeder som noter

Reagér på en besked, eller et svar, i den kanal, OneUptime oprettede for en hændelse, advarsel, episode eller planlagt vedligeholdelsesbegivenhed, så gemmer OneUptime den som en note på den post. Den opfanger reaktionen inden for et minut og bekræfter med et svar i tråden:

| Reaktion | Gemt som |
| --- | --- |
| 📌 eller 📍 | En privat note, som kun dit team ser |
| 📣 eller 📢 | En offentlig note, vist på statussiden. Kun hændelser og planlagte vedligeholdelsesbegivenheder. |

Noten gemmes som dig, med dine rettigheder, så din egen Microsoft Teams-konto skal være forbundet, og OneUptime-appen skal være i teamet.

## Tal med OneUptime-botten

Skriv til botten i en personlig chat, eller nævn OneUptime med @ i en kanal eller en gruppechat: der svarer den kun, når den nævnes.

| Besked | Hvad botten gør |
| --- | --- |
| `help` | Viser, hvad den kan. |
| `ask <question>`, eller ethvert spørgsmål på almindeligt sprog | OneUptime AI svarer om dine logs, traces, metrikker, hændelser og monitorer, for eksempel "hvilke monitorer er nede lige nu?". Svar læser kun. |
| `create incident [title]` | Åbner hændelsesformularen med titlen udfyldt. |
| `create maintenance [title]` | Åbner formularen til planlagt vedligeholdelse med titlen udfyldt. |
| `show active incidents`, `show active alerts` | Viser, hvad der er åbent nu. |
| `show scheduled maintenance`, `show ongoing maintenance` | Viser kommende, eller igangværende, vedligeholdelsesbegivenheder. |

At spørge OneUptime AI kræver, at AI er slået til for projektet. Se [Spørg AI](/docs/ai/ask-ai).

## Opret hændelser og vedligeholdelse fra Microsoft Teams

At skrive `create incident` eller `create maintenance` til OneUptime-botten åbner en formular for den person, der skrev det, i en personlig chat, en kanal eller en gruppechat. Den udfyldes som den person: som den OneUptime-konto, personens Microsoft Teams-konto er forbundet med (se [Forbind Microsoft Teams](#forbind-microsoft-teams)), med den kontos rettigheder i projektet. En, hvis konto ikke er forbundet, eller hvis OneUptime-konto ikke længere er medlem af projektet, får at vide, hvad der skal gøres, i stedet for formularen.

- **Hvem der må bruge dem.** De personer, der må oprette en hændelse eller en planlagt vedligeholdelsesbegivenhed i OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** og **Incident Member** for en hændelse (**Create Incident** i en brugerdefineret rolle), og **Scheduled Maintenance Admin** og **Scheduled Maintenance Member** for en begivenhed (**Create Scheduled Maintenance**). Alle andre får det at vide og får ingen formular.
- **Hvad en formular tilbyder.** Hver liste — alvorligheder, monitorer, monitorstatusser, vagtpolitikker og etiketter — indeholder det, den person, der bad om den, må læse, ligesom den samme liste i OneUptime, og kortets "not shown"-bemærkninger tæller kun dem: med en rolle, der er begrænset til nogle etiketter, de monitorer og vagtpolitikker, der har de etiketter. En liste, personen slet ikke må læse, udelades. Arkiverede vagtpolitikker tilbydes aldrig.
- **Hvad en formular må nævne.** I en kanal eller en gruppechat må alle, der er til stede, indsende formularen, og den indsendes som den, der gør det, med vedkommendes egne rettigheder. Hændelsen eller begivenheden oprettes med de rettigheder og krediteres den person. En monitor, vagtpolitik, etiket, alvorlighed eller status, personen ikke må læse, eller en fra et andet projekt, afvises som en, projektet ikke har, og intet oprettes: botten svarer "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en hændelse, advarsel eller episode virker på samme måde: den kræver rettighed til at køre en vagtpolitik (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** og **On-Call Member**, eller **Create On-Call Duty Policy Execution Log** i en brugerdefineret rolle) og til at læse den hændelse, advarsel eller episode, og den tilbyder de aktive vagtpolitikker, personen må læse. At se en monitor eller en vagtpolitik fra et kort læser den også som den person, der trykkede på knappen.

## Handl på hændelser, advarsler og begivenheder fra Microsoft Teams

Knapperne på OneUptimes kort handler som den person, der trykker på dem, i en personlig chat, en kanal eller en gruppechat: som den OneUptime-konto, personens Microsoft Teams-konto er forbundet med, med den kontos rettigheder i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** og **Execute On-Call Policy** på en hændelse, en advarsel eller en episode, og **Mark as Ongoing**, **Mark as Complete**, **Change State** og **Add Note** på en planlagt vedligeholdelsesbegivenhed, laver hver den ændring, som samme handling laver i OneUptime, og den krediteres den person der: postens tilstandstidslinje og feed viser, hvem der ændrede dens tilstand, og noten er personens. En note, der gemmes fra en besked med en reaktion, slås op på samme måde.

- **Hvem der må bruge dem.** De personer, der må lave den samme ændring i OneUptime. At bekræfte, løse eller ændre tilstanden for en hændelse kræver rettighed til at ændre dens tilstand: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** og **Incident Member**, eller **Create Incident State Timeline** i en brugerdefineret rolle. En advarsel, en episode eller en planlagt vedligeholdelsesbegivenhed kræver den samme rettighed for sin egen type (**Create Alert State Timeline**, for eksempel), og en note kræver rettighed til at slå den type note op. Ligesom tilstandspanelet i OneUptime beder de ikke om rettighed til at redigere selve hændelsen eller advarslen. Alle andre får det at vide, og intet ændres.
- **Hvilke poster.** Dem, personen må læse, ligesom i OneUptime: med en rolle, der er begrænset til nogle etiketter, de hændelser, advarsler, episoder og begivenheder, der har dem. En knap på enhver anden post, eller på en fra et andet projekt, besvares med, at posten "was not found in this project, or you do not have access to it.", og intet ændres. På OneUptime Cloud afvises en ændring, som projektets plan ikke omfatter, med den plan, den kræver.
- **Hvad Change State tilbyder.** De tilstande, personen må læse, som posten må gå videre til, i projektets rækkefølge: ingen før den tilstand, den er i, for en episode som for en hændelse, en advarsel eller en planlagt vedligeholdelsesbegivenhed, da en tilstandsændring aldrig flytter en post op igen i sin liste (se [Rækkefølgen er en reel begrænsning, ikke en visningspræference](/docs/incidents/states-and-severities#rækkefølgen-er-en-reel-begrænsning-ikke-en-visningspræference)). Når personen ikke må læse nogen, siger botten "No incident states are available to you in this project. Ask a project admin for access to them."; når posten er i den sidste tilstand, den kan nå, siger den "There is no later state to move this incident to." Ingen af dem viser et tomt kort.
- **Escalate.** Et korts **Escalate** kører dets vagtpolitik for den hændelse, advarsel eller episode, kortet handler om, som den person, der trykkede på den, med de samme rettigheder som **Execute On-Call Policy**. Et kort, der ikke handler om nogen af dem, besvares med "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", og ingen tilkaldes.

## Afbryd forbindelsen

- **Disconnect** fjerner kun tilknytningen af din egen Microsoft Teams-konto og fjerner samtidig din Microsoft Teams-notifikationsmetode.
- **Uninstall OneUptime from Microsoft Teams**, på **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**, afbryder projektets forbindelse. OneUptime holder op med at slå op i Microsoft Teams, og menuerne **Arbejdsområde** holder op med at vise det. Notifikationsreglerne og opsummeringerne bevares, til du forbinder igen.

> [!WARNING]
> At afinstallere fjerner også tilknytningen af hvert medlems egen Microsoft Teams-konto i projektet og fjerner Microsoft Teams-notifikationsmetoderne og de vagtregler, der brugte dem. Et projekt er forbundet med én Microsoft 365-organisation: for at flytte det til en anden skal du afinstallere først.

## Fejlfinding

:::details En test siger, at OneUptime-appen ikke er installeret i teamet
Microsoft afviste opslaget, fordi botten ikke er i det team. Føj appen til teamet (se [Forbind Microsoft Teams](#forbind-microsoft-teams)) eller, for en privat kanal, til selve kanalen. At føje den til ét team gør intet for de andre.
:::

:::details Microsoft Teams blev ikke forbundet
Når Microsoft sender dig tilbage uden en forbindelse, siger den side, du startede fra, **Microsoft Teams blev ikke forbundet**, og én sætning siger hvorfor: du mangler rettigheden, linket var brugt eller udløbet, du loggede ind i en anden Microsoft 365-organisation, eller din organisation har endnu ingen teams. Se [Forbindelsen blev ikke fuldført](/docs/self-hosted/microsoft-teams-integration#forbindelsen-blev-ikke-fuldført) for hver sætning, og hvad du skal gøre.
:::

:::details Botten siger, at min konto ikke er forbundet
Knyt den under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, logget ind i den organisation, projektet er forbundet med. En gæstekonto fra en anden organisation er ikke den samme konto.
:::

:::details Alle notifikationer fejler på en selvhostet server
Den Teams-app, der er installeret i dine teams, skal være den pakke, din server byggede, og Microsoft skal kunne nå din servers bot-endpoint. Se fejlfindingen i [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration#fejlfinding).
:::

## Næste trin

:::cards
- [Slack](/docs/workspace-connections/slack): De samme notifikationer og handlinger i Slack.
- [Videoopkald](/docs/workspace-connections/video-calls): Giv hver hændelse et opkald, slået op med dens opdateringer.
- [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration): Sæt Teams-botten op på en selvhostet server.
- [Opret en hændelse](/docs/incidents/declaring-incidents): Alle måder, en hændelse starter på, og hvad der kører, når den gør.
:::
