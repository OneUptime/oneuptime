# Microsoft Teams

Forbind OneUptime med Microsoft Teams for at slå hændelser, advarsler, episoder, planlagt vedligeholdelse, monitorer og vagtopdateringer op i dine kanaler og chats, give hver hændelse sin egen kanal og lade responders handle fra Teams: bekræfte, løse, tilføje noter, tilkalde vagten, oprette hændelser og spørge OneUptime AI.

:::cards
- [Forbind Microsoft Teams](#forbind-microsoft-teams): Administratorsamtykke, dit login og appen i hvert team.
- [Bed alle om at forbinde deres konto](#bed-alle-om-at-forbinde-deres-konto): Send på én gang en besked til hvert medlem, der ikke har forbundet sin konto.
- [Notifikationsregler](#notifikationsregler): Bestem, hvilke begivenheder der slås op hvor, og hvilke der får deres egen kanal.
- [Tal med OneUptime-botten](#tal-med-oneuptime-botten): Kommandoer, spørgsmål og formularer i en chat med botten.
- [Vagt-mærker](#vagt-mærker): Hold et teams mærke lig med dem, der har vagt, og tilkald det.
- [Handl på hændelser, advarsler og begivenheder fra Microsoft Teams](#handl-på-hændelser-advarsler-og-begivenheder-fra-microsoft-teams): Knapperne på OneUptimes kort.
:::

## Sådan virker det

```mermaid title="Fra en begivenhed i OneUptime til et kort i Microsoft Teams"
flowchart TB
    event["En hændelse, advarsel eller begivenhed<br/>oprettes eller ændres"] --> rules{"Notifikationsregler<br/>hvis betingelser passer"}
    rules -->|"En kanal<br/>for hver"| own["En kanal for sig selv<br/>i det team, du vælger"]
    rules -->|"Slå op i en eksisterende<br/>kanal eller chat"| existing["Dine kanaler og chats"]
    own --> card["Et kort med knapper"]
    existing --> card
    card -->|"En responder trykker på én"| change["Ændringen sker i OneUptime,<br/>som den responder"]
```

Tre ting får det til at virke:

- **Projektets forbindelse**, lavet én gang: en Microsoft 365-administrator giver samtykke til OneUptime-appen for din organisation.
- **OneUptime-appen i hvert team**, du vil have notifikationer i. Microsoft lader kun botten slå op i et team, den er føjet til.
- **Hver persons egen forbindelse**: personens Microsoft Teams-konto knyttet til personens OneUptime-konto. Knapper, kommandoer og reaktioner handler som den person, med personens rettigheder i projektet.

Én Microsoft 365-organisation kan være forbundet til mere end ét projekt, for eksempel produktion og staging. Et korts knap handler i det projekt, kortet blev sendt for, for eksempel projektet for den hændelse, kortet handler om. En besked til botten handler i projektet for den kanal, den sendes i, for eksempel en hændelses kanal, ellers i det ene projekt, afsenderens Microsoft Teams-konto er forbundet i. Når intet viser hvilket, spørger botten afsenderen, hvilket projekt personen mener, med en knap for hvert projekt, personen er med i, og fortsætter dér, når personen har valgt. I en samtale med OneUptime AI gælder valget for de opfølgende spørgsmål, indtil der går en time uden et, og svarene siger, hvilket projekt de kommer fra. Inden for den time stiller **Ask in another project** afsenderens seneste spørgsmål igen i et andet af personens projekter: med det samme, når personen har ét andet, ellers efter at have spurgt hvilket. I en personlig chat tilbyder botten det som en knap ved skrivefeltet.

## Før du begynder

- **En rolle, der må forbinde projektet:** **Projektejer**, **Projektadministrator** eller **Projektmedlem**. At afinstallere kræver **Projektejer** eller **Projektadministrator**.
- **En Microsoft 365-administrator**, der giver administratorsamtykke, én gang for hele organisationen.
- **Growth-planen på OneUptime Cloud** til notifikationsregler og opsummeringer. Se [Notifikationsregler under Growth-planen](#notifikationsregler-under-growth-planen).
- **På en selvhostet server,** først en Teams-bot, der er sat op til den. Se [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration).

## Forbind Microsoft Teams

:::steps
### Giv administratorsamtykke

Gå til **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**, og klik på **Giv administratorsamtykke**. En Microsoft 365-administrator logger ind og tillader OneUptime-appen for organisationen. Kortet siger derefter **Admin Consent Completed**. Indtil et workspace er forbundet, indeholder sektionen **Arbejdsområde** i menuerne Hændelser, Advarsler, Planlagt vedligeholdelse, Monitorer og Vagt **Forbind et arbejdsområde**, som også fører hertil.

### Forbind din konto

Klik på **Connect with Microsoft Teams**, og log ind med din arbejdskonto. OneUptime læser din organisations teams; **Vis teams** viser dem.

### Føj OneUptime-appen til hvert team (påkrævet)

Det er ikke nok i sig selv at forbinde din konto. Microsoft lader kun OneUptime-botten slå op i et team, den er føjet til, så gør dette for hvert team, du vil have notifikationer i:

- I Microsoft Teams skal du klikke på "..." ud for **teamnavnet** (ikke kanalnavnet).
- Vælg **Manage team** > **Apps** > **More apps**, find **OneUptime**, og klik på **Add**.

På OneUptime Cloud åbner **Åbn Teams Store** appen i Microsoft Teams Store, hvor **Add to a team** gør det samme. På en selvhostet server skal du i stedet installere pakken fra **Download app-manifest-zip**: kun den indeholder din servers bot. Hvis en testnotifikation siger, at OneUptime-appen ikke er installeret i teamet, er det dette trin, der blev sprunget over.

### Forbind alle andre

Hver person knytter sin egen Microsoft Teams-konto under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams** for at handle på hændelser og få direkte beskeder som sig selv. Den sektion vises, så snart projektet er forbundet med Microsoft Teams. Vil du have et helt team med på én gang, så se [Bed alle om at forbinde deres konto](#bed-alle-om-at-forbinde-deres-konto).

### Tilføj en notifikationsregel

Gå til **Hændelser** > **Arbejdsområde** > **Microsoft Teams**. Sektionen **Arbejdsområde** viser kun de chat-workspaces, dit projekt har forbundet, så **Microsoft Teams** vises der, så snart det er forbundet. Opret en regel, for eksempel en, der slår op i en Teams-kanal, når en hændelse oprettes, og klik derefter på **Test regel** i dens række.
:::

> [!NOTE]
> At installere OneUptime for dig selv, eller føje den til en chat, er en anden installation og lader den ikke slå op i et teams kanaler. **Private kanaler** kræver, at appen er føjet til selve kanalen: åbn kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delte kanaler** kan ikke modtage notifikationer: Microsoft Teams understøtter ikke bots i delte kanaler.

## Bed alle om at forbinde deres konto

Ingen kan forbinde en andens Microsoft Teams-konto, heller ikke en administrator: hver især logger ind med sin egen. For at få et helt team med beder en **Projektejer** eller **Projektadministrator** alle på én gang under **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**. Kortet **Members' Microsoft Teams accounts** viser, hvor mange medlemmer der har forbundet deres konto. **Ask everyone to connect** får OneUptime-botten til at sende hvert medlem, der ikke har gjort det, en besked med en knap **Connect Microsoft Teams account**, der forbinder medlemmets konto med ét klik.

- **Hvem der får en besked.** Hvert medlem af projektet, der ikke har forbundet sin Microsoft Teams-konto, er i et team, som OneUptime-appen er føjet til, og som OneUptime finder der via medlemmets e-mailadresse eller brugerhovednavn (UPN). Den, der er blevet bedt om det inden for de sidste 24 timer, bliver ikke bedt igen, så beder du igen dagen efter, får kun dem, der stadig ikke har forbundet deres konto, en påmindelse.
- **Hvad kortet siger.** Hvor langt udsendelsen er nået, mens beskederne sendes, og derefter hvem der bad om det, og hvor mange medlemmer der fik en besked. Medlemmer, som OneUptime ikke kunne finde, nævnes ved navn på kortet: føj appen til deres team, eller lad dem selv forbinde deres konto under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams**.
- **Hvad knappen forbinder.** Microsoft Teams-kontoen for den, der trykker på knappen og logger ind, med vedkommendes egen OneUptime-konto. En besked, der sendes videre til en anden, forbinder intet med det medlem, den blev sendt til.

## Notifikationsregler

En notifikationsregel siger, hvilke begivenheder der slås op i Microsoft Teams, og hvor. Hvert produkt har sine egne regler, under **Arbejdsområde** > **Microsoft Teams** i sin menu:

| Produkt | Faner på dets **Microsoft Teams**-side |
| --- | --- |
| **Hændelser** | **Hændelser**, **Hændelsesepisoder**, **Oversigt** |
| **Advarsler** | **Advarsler**, **Advarselsepisoder**, **Oversigt** |
| **Planlagt vedligeholdelse** | Én liste med regler |
| **Monitorer** | Én liste med regler |
| **Vagt** | Én liste med regler |
| **SLOs** | Én liste med regler |

At oprette en regel går gennem op til fem trin:

| Trin | Hvad du angiver |
| --- | --- |
| **Grundlæggende** | **Regelnavn** og **Regelbeskrivelse**. |
| **Betingelser** | Hvilke begivenheder reglen gælder for, for eksempel efter alvorlighed, tilstand, etiket, monitor eller ord i titlen. De kontrolleres, når en begivenhed oprettes, og igen ved hver opdatering, OneUptime slår op om den, så en regel for bekræftede hændelser virker, når en hændelse bekræftes. En ny regel gælder for hver begivenhed, for eksempel **Alle hændelser**. For at indsnævre den vælger du **Kun hændelser, der opfylder betingelserne** og tilføjer betingelserne. Med to eller flere siger **Matchbetingelse**, om alle skal passe, eller om én er nok. |
| **Destination** | Hvor den slår op: en eksisterende kanal i et team, du vælger, de chats, du vælger, en kanal for hver hændelse (eller advarsel, episode, begivenhed, monitor eller vagtpolitik), der oprettes i et team, du vælger, eller flere af dem sammen. Under trinnet siger **Hvad reglen gør** det i sætninger, ligesom reglens kort. |
| **Opdateringer** | Kun hændelser, advarsler, episoder, planlagt vedligeholdelse og vagtpolitikker: hvilke opdateringer reglen slår op efter postens første besked. **Alle opdateringer** slår dem alle op, og en ny regel starter med den, undtagen en vagtpolitiks. **Kun vigtige opdateringer** slår dem op, der betyder mest, som trinnet viser for hver slags post: for en hændelse dens løsning eller genåbning, ændringer i alvorlighed, offentlige noter og postmortem; for en vagtpolitik, hvem der har vagt nu, og hvornår ingen har, som en ny regel for en vagtpolitik starter med. Med **Vælg opdateringer** sætter du flueben ved dem én ad gangen. Uanset hvad du vælger, slår reglen postens første besked op og et videoopkald, når et starter. Se [Vagtbeskeder](#vagtbeskeder). |
| **Video Call** | Kun hændelser og advarsler: start et opkald for hver. Se [Videoopkald](/docs/workspace-connections/video-calls). |

Hver betingelse læses som en sætning: feltet, hvordan det sammenlignes, og værdien. Værdier at vælge kommer fra projektets egne lister, som dets tilstande, alvorligheder, etiketter og monitorer. En regel for vagtpolitikker vælger sine politikker under **Vagtpolitik**, som bliver ved med at matche en politik, efter at den har fået nyt navn, mens **Navn på vagtpolitik** matcher ord i en politiks navn. Hver slags begivenhed, der har ejere, har en ejerbetingelse, som **Ejer af hændelse**: vælg personer og teams, og den matcher de personer og teams, der er registreret som begivenhedens ejere. At være med i et team, der ejer begivenheden, tæller ikke. En ejer, der tilføjes senere, får reglen til at matche fra den opdatering, og en regel, der opretter kanaler, opretter kanalen da. En arkiveret værdi, som en alvorlighed eller en vagtpolitik, tilbydes ikke til en ny betingelse. En regel, der allerede har en, beholder den, markeret **Arkiveret**, og matcher stadig de begivenheder, der har den. En person, et team eller en politik, som projektet ikke længere har, bliver i betingelsen, og reglens kort siger det.

En regel for SLO'er slår skiftene i et SLO's fejlbudgetpolitik op: når SLO'et går ind i et niveau, kommer sig til et mindre alvorligt niveau eller forlader alle niveauer, og når dets udrulninger fryses eller tillades igen. Den slår kun op i eksisterende kanaler og chats, da et SLO ikke får sin egen kanal. Se [Slå op i Slack, Microsoft Teams og Mattermost](/docs/slo/error-budget-policy#slå-op-i-slack-microsoft-teams-og-mattermost).

En kanal, som reglen opretter, får navn efter sin post: hændelse INC-42 får `inc-42`, advarsel ALT-7 får `alt-7`, og i et projekt uden nummerpræfikser får hændelse 42 `incident-42`. Tekst i **Præfiks for kanalnavn** sættes foran, så `prod-` giver `prod-inc-42`, og formularen viser navnet, mens du skriver. For en vedligeholdelseshændelse træder præfikset i stedet for dens nummerpræfiks: SM-5 får `sm-5`, og `maint-` giver `maint-5`. OneUptime beholder bogstaver, tal, mellemrum, `-` og `_`, op til de 50 tegn, Microsoft Teams tager imod. Har teamet allerede en kanal med det navn, fx et andet projekts eller en, der er slettet inden for de sidste 30 dage, tilføjer OneUptime `-2`, `-3` og så videre.

En regel opretter sin kanal første gang, en begivenhed matcher den: når begivenheden oprettes, eller senere, når en opdatering får den til at matche, mens den stadig er åben. En regel for bekræftede hændelser opretter kanalen, når hændelsen bekræftes. Microsoft Teams viser et teams kanaler for alle i teamet, så OneUptime tilføjer ingen til en kanal én ad gangen: alle i det team, du vælger, kan åbne den, som regelformularen siger under **Hvem der kommer med i kanalen**. En privat hændelse, advarsel eller episode får en privat kanal, som kun dens medlemmer ser; tilføj folk i Microsoft Teams.

For at inddrage dem, der har vagt, vælger du deres vagtplaner under **Nævn dem, der har vagt**. Når kanalen oprettes, slår OneUptime en besked op i den lige efter postens første besked. Beskeden @nævner dem, der har vagt i de vagtplaner, så Microsoft Teams underretter dem. Ingen tilkaldes. OneUptime finder hver person i teamet ud fra den Microsoft Teams-konto, personen har forbundet med OneUptime, eller ellers ud fra personens e-mailadresse. En person, der ikke er i teamet, kan ikke åbne dets kanaler, så i stedet står personens navn i beskeden sammen med årsagen. En privat kanal kan kun åbnes af dens medlemmer, så tilføj de vagthavende til den i Microsoft Teams.

Hver senere opdatering af posten — en tilstandsændring, en note, en ny ejer — slås op i dens kanaler og i de eksisterende kanaler og chats, dens regler nævner, så længe deres betingelser passer, når en regel, der slår op dér, vælger den i sit trin **Opdateringer**. OneUptime kan ikke arkivere en Microsoft Teams-kanal, så en regels kanal bliver, når dens post er afsluttet; arkiver eller slet den i Microsoft Teams.

En hændelse, advarsel, episode eller vedligeholdelseshændelse med sin egen kanal har **Åbn i Microsoft Teams** i toppen af sin side i OneUptime, ved siden af tilstandsknapperne. Den åbner kanalen i en ny fane, i Microsoft Teams-appen eller i browseren. En post med to egne kanaler viser dem begge under knappen. En post med kanaler i både Slack og Microsoft Teams har i stedet én knap, **Åbn kanal**, der viser dem alle. De eksisterende kanaler og chats, dine regler slår op i, tilbydes ikke.

Postens side har også kortet **Microsoft Teams-kanal**, der siger, hvem der kan åbne kanalen: alle i teamet eller, for en privat kanal, dens medlemmer, som dens ejere tilføjer i Microsoft Teams. OneUptime ændrer ikke, hvem der er i en Microsoft Teams-kanal. For en Slack-kanal viser kortet, hvem der er i den, og tilføjer personer: se [Hvem der er i en posts kanal](/docs/workspace-connections/slack#hvem-der-er-i-en-posts-kanal).

Kanaler og chats forbliver læsbare: hver begivenhed slås op én gang, og postens første tilstand står i det kort, der annoncerer posten, ikke i et kort for sig. En kørsel af en vagtpolitik er ét kort, der redigeres, efterhånden som kørslen eskalerer: hvem der blev tilkaldt, hvor ofte og hvordan, hvem der ikke blev det og hvorfor, og hvem der bekræftede. Et nyt kort slås kun op, når nogen skal handle: en eskaleringsregel nåede ingen, eller kørslen sluttede, uden at nogen bekræftede. At postens ejere eller statussidens abonnenter har fået besked, står i dens feed i OneUptime.

**Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams** viser de kanaler, OneUptime kan se i dine teams, og de chats, den er føjet til, med **Send test** ved siden af hver. En chat vises, så snart OneUptime-appen er føjet til den i Microsoft Teams; **Refresh Chats** henter nye chats og deres nuværende navne.

En notifikationsregel kan tilhøre teams. **Ansvarlige teams** under **Flere felter** forbeholder den de teams, du vælger: kun deres medlemmer og projektadministratorer kan redigere eller slette den, og alle andre, der kan se reglerne, ser den skrivebeskyttet. Se [Regler, der tilhører teams](/docs/permissions/index#regler-der-tilhører-teams).

### Vagtbeskeder

Ved hvert vagtskifte hører en vagtpolitiks kanaler og chats i én linje, hvem der har vagt:

> 📞 @Ana Lee is now on call for Payments until Sat, Nov 14, 2026 at 5:50 PM, then @Bob Diaz.

Payments linker til politikken i OneUptime. En person nævnes ved sit Microsoft Teams-navn, når vedkommende har forbundet sin Microsoft Teams-konto med OneUptime, og ved sit navn i OneUptime indtil da. Tidspunkter vises i hver læsers egen tidszone. En regels trin **Opdateringer** vælger, hvilke vagtbeskeder den slår op, som i Slack, og en ny regel starter med, hvem der har vagt nu, og hvornår ingen har: se [Vagtbeskeder](/docs/workspace-connections/slack#vagtbeskeder).

## Test en regel

**Test regel** i en regels række slår en testbesked for den regel op i de kanaler, den nævner, så du kan se den ankomme. Hvis reglen opretter en kanal for hver begivenhed, opretter testen også en og inviterer reglens folk ind i den.

Ligesom **Send test** ved siden af en kanal i **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams** kræver den rettighed til at oprette notifikationsregler: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Indstillingsadministrator**, **Indstillingsmedlem** eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en brugerdefineret rolle. For en, der kun må se reglerne, som en **Seer**, er **Test regel** låst, og dens værktøjstip siger, hvad der kræves; API'en afviser vedkommendes test med "You do not have permission to send test notifications in this project." På OneUptime Cloud kræver det **Growth**-planen at teste en regel, ligesom at tilføje en.

På OneUptime Cloud kræver **Send test** ved siden af en kanal eller en chat også **Growth**-planen, da det at slå op i en kanal er det, regler og opsummeringer gør. **Send test nu** på en opsummering kræver rettighed til at oprette opsummeringer (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en brugerdefineret rolle) og, på OneUptime Cloud, **Growth**-planen; for alle andre er den låst, og dens værktøjstip siger, hvad der kræves. En MCP-klient, der er forbundet med skrivebeskyttet adgang, kan ikke sende nogen test.

## Opsummeringer

Fanen **Oversigt** i **Hændelser** > **Arbejdsområde** > **Microsoft Teams** (og i **Advarsler**) slår en tilbagevendende opsummering op i de kanaler, du nævner: hvor mange hændelser eller advarsler der var, hvor hurtigt de blev bekræftet og løst, og en liste med links. En ny opsummering sendes hver uge og dækker de seneste 7 dage. Lad **Send første rapport kl.** være tom, så sendes den første kl. 09:00 i starten af næste uge, dag eller måned; formularen siger hvornår.

En opsummering sendes efter uret i sin **Tidszone**, som starter med din. Den holder sit klokkeslæt der hele året: en, der er sat til 09:00 i Berlin, sendes stadig kl. 09:00 i Berlin, efter at urene er stillet til sommertid, og datoerne i dens besked er også Berlins. Via API'en sender du `timezone` som et IANA-tidszonenavn, som `Europe/Berlin`. En opsummering, der oprettes uden tidszone, tager tidszonen fra opretterens profil, eller UTC når en API-nøgle opretter den.

Formularen til en opsummering har fire trin: **Grundlæggende oplysninger** (navnet, kanalerne og deres **Teamnavn**), **Tidsplan**, **Indhold** (**Hvad der skal inkluderes**) og **Filtre** (hvilke hændelser eller advarsler den tæller).

## Notifikationsregler under Growth-planen

På OneUptime Cloud hører notifikationsregler og opsummeringer til **Growth**-planen og derover. Et projekt under den beholder de regler og opsummeringer, det allerede har, og de bliver ved med at slå op i Microsoft Teams. Derfor viser hvert produkts **Microsoft Teams**-side (Hændelser, Advarsler, Planlagt vedligeholdelse, Vagt, Monitorer) planbemærkningen med dem nedenunder (**Meddelelsesregler, der stadig er sat op**, **Opsummeringer, der stadig er sat op**): slet en regel, eller slå en opsummering fra eller slet den. At tilføje eller ændre regler og opsummeringer kræver **Growth**.

## Bliv tilkaldt i Microsoft Teams

For at blive tilkaldt via direkte besked, når du har vagt, tilføjer du Microsoft Teams som en af dine notifikationsmetoder:

:::steps
1. Forbind din egen Microsoft Teams-konto (se [Forbind Microsoft Teams](#forbind-microsoft-teams)).
2. Gå til **Brugerindstillinger** > **Notifikationsmetoder**, åbn fanen **Arbejdsområdeapps**, og klik på **Add Microsoft Teams Account**.
3. Klik på **Send Test Message** i dens række. Beskeden ankommer i dine chats i Microsoft Teams.
:::

At tilføje den sætter den straks ind i dine vagtregler, så tilkald når dig i Microsoft Teams fra da af. Ændr, hvilke tilkald den får, under **Brugerindstillinger** > **Sådan når man mig**.

## Gem beskeder som noter

Reagér på en besked, eller et svar, i den kanal, OneUptime oprettede for en hændelse, advarsel, episode eller vedligeholdelseshændelse, så gemmer OneUptime den som en note på den post. Den opfanger reaktionen inden for et minut og bekræfter med et svar i tråden:

| Reaktion | Gemt som |
| --- | --- |
| 📌 eller 📍 | En privat note, som kun dem, der kan se posten, kan læse |
| 📣 eller 📢 | En offentlig note, vist på statussiden. Kun hændelser og vedligeholdelseshændelser. På en privat hændelse en privat note, og bekræftelsen siger hvorfor. Når projektets offentlige noter kræver godkendelse, vises den først, når den er godkendt, og bekræftelsen siger, hvem den venter på: se [Godkendelse af offentlige noter](/docs/incidents/notes-owners-and-feed#godkendelse-af-offentlige-noter). |

Noten bevarer beskeden, som Microsoft Teams viste den: dens formatering, links og kode, de personer, den nævner, ved navn, og dens filer og billeder som links til dem. En offentlig note udelader filerne og billederne, da de kun åbner for dit team.

Det er ordene fra den, der skrev beskeden: vedkommendes OneUptime-navn, når deres Microsoft Teams-konto er forbundet, ellers det navn, Teams viser. En privat note placeres på tidslinjen, da beskeden blev slået op, uanset hvor længe efter den gemmes. En offentlig note placeres, når den gemmes, som er når statussiden viser den. Tidslinjen siger, hvem der gemte den. Noten bliver ikke slået op igen i kanalen, hvor beskeden allerede står.

Noten gemmes som dig, med dine rettigheder, og OneUptime-appen skal være i teamet. Hvis din Microsoft Teams-konto ikke er forbundet endnu, beder OneUptime dig om at forbinde den, i et svar der nævner dig, med en knap der gemmer beskeden, så snart du har gjort det.

## Tal med OneUptime-botten

Skriv til botten i en personlig chat, eller nævn OneUptime med @ i en kanal eller en gruppechat: der svarer den kun, når den nævnes.

| Besked | Hvad botten gør |
| --- | --- |
| `help` | Viser, hvad den kan. |
| `incident [title or number]` | Åbner hændelsesformularen med titlen udfyldt. En hændelses nummer, som `42` eller `INC-42`, viser i stedet den hændelse: se [Håndter en hændelse fra Microsoft Teams](#håndter-en-hændelse-fra-microsoft-teams). |
| `maintenance [title]` | Åbner formularen til planlagt vedligeholdelse med titlen udfyldt. |
| `oncall` | Viser, hvem der har vagt lige nu i hver vagtplan, du kan se, til hvornår, og hvem der er den næste. |
| `page [who] [message]` | Tilkalder de personer, du nævner med @, om din besked, eller sender et kort, hvor du vælger, hvem der skal tilkaldes. Se [Tilkald nogen fra Microsoft Teams](#tilkald-nogen-fra-microsoft-teams). |
| `ask [question]`, eller ethvert spørgsmål på almindeligt sprog | OneUptime AI svarer om dine logs, traces, metrikker, hændelser og monitorer, for eksempel "hvilke monitorer er nede lige nu?". Svar læser kun: bedt om en ændring siger den, hvordan du laver den her, fx med `incident` eller knapperne på OneUptimes kort, eller linker til Spørg AI for alt andet. I en hændelses eller en advarsels egen kanal svarer den om den hændelse eller advarsel. |
| `show active incidents`, `show active alerts` | Viser, hvad der er åbent nu. |
| `show scheduled maintenance`, `show ongoing maintenance` | Viser kommende, eller igangværende, vedligeholdelsesbegivenheder. |

Bortset fra `show`-listerne er det de ord, der følger efter `/oneuptime` i Slack; `create incident` og `create maintenance` virker også stadig. At spørge OneUptime AI kræver, at din egen Microsoft Teams-konto er forbundet, og at AI er slået til for projektet. Hvis din ikke er forbundet, beder botten dig én gang i hver tråd eller chat om at forbinde den, med en knap **Connect Microsoft Teams account**. Se [Spørg AI](/docs/ai/ask-ai).

## Din startside i Microsoft Teams

Skriv `home` til OneUptime-botten, så svarer den med din startside: et kort med det, der sker i projektet, som du må se det.

- **Din vagt.** De vagtplaner, du har vagt i lige nu, og til hvornår, eller ellers din næste vagt.
- **Det, der er åbent.** De nyeste åbne hændelser og advarsler, du må læse, hver med et link til dens side i OneUptime.
- **Knapperne.** **Declare incident** og **Page someone** svarer som `incident` og `page`, **Who's on call** som `oncall`, og **Refresh** læser kortet igen, på samme plads.

Når du tilføjer OneUptime-appen for dig selv, sender botten dig straks din startside. Startsiden og `show`-listerne læser som dig, så de kræver din egen forbundne Microsoft Teams-konto: indtil den er forbundet, svarer botten med knappen **Connect Microsoft Teams account**. **Åbn OneUptime i Microsoft Teams** under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams** åbner appen i Teams.

I en Microsoft 365-organisation, der er forbundet til mere end ét projekt, viser startsiden ét projekt ad gangen. Er din Microsoft Teams-konto forbundet i to eller flere af dem, viser `home` og velkomsten ét uden at spørge hvilket: det projekt, du senest skiftede til, så længe du stadig er medlem der, ellers det af dine projekter, der først blev forbundet til Microsoft Teams. Under navnet vælger du et andet af dine i listen **Switch project** og trykker på **Switch**, eller, når du har ét andet, trykker du på knappen, der nævner det: kortet tegnes igen for det projekt, og din startside åbner derefter på det.

Når appen tilføjes til et team, siger botten hej der: hvordan man stiller den et spørgsmål, og hvor man tilføjer en notifikationsregel, der slår op i teamets kanaler.

## Opret hændelser og vedligeholdelse fra Microsoft Teams

At skrive `incident` eller `maintenance` til OneUptime-botten åbner en formular for den person, der skrev det, i en personlig chat, en kanal eller en gruppechat. Den udfyldes som den person: som den OneUptime-konto, personens Microsoft Teams-konto er forbundet med (se [Forbind Microsoft Teams](#forbind-microsoft-teams)), med den kontos rettigheder i projektet. En, hvis konto ikke er forbundet, eller hvis OneUptime-konto ikke længere er medlem af projektet, får i et svar, der nævner personen, at vide, hvad der skal gøres, i stedet for formularen.

- **Hvem der må bruge dem.** De personer, der må oprette en hændelse eller en vedligeholdelseshændelse i OneUptime: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Hændelsesadministrator** og **Hændelsesmedlem** for en hændelse (**Create Incident** i en brugerdefineret rolle), og **Vedligeholdelsesadministrator** og **Vedligeholdelsesmedlem** for en begivenhed (**Create Scheduled Maintenance**). Alle andre får det at vide og får ingen formular.
- **Hvad en formular tilbyder.** Hver liste — alvorligheder, monitorer, monitorstatusser, vagtpolitikker og etiketter — indeholder det, den person, der bad om den, må læse, ligesom den samme liste i OneUptime, og kortets "not shown"-bemærkninger tæller kun dem: med en rolle, der er begrænset til nogle etiketter, de monitorer og vagtpolitikker, der har de etiketter. En liste, personen slet ikke må læse, udelades. Arkiverede vagtpolitikker tilbydes aldrig.
- **Hvad hændelsen handler om.** På hændelseskortet søger **Affected Resources** i projektets værter, netværksenheder, clustre, databaser, cloudressourcer og tjenester, mens nogen skriver, blandt dem den person må læse, og knytter de valgte til hændelsen: OneUptime AI undersøger og retter det, en hændelse er knyttet til (se [Hvilke hændelser et clusters rettelser virker på](/docs/ai/ai-sre#hvilke-hændelser-et-clusters-rettelser-virker-på)). Kortet udelader feltet, når den person, der bad om det, ikke må læse nogen af dem, eller når projektet ikke har nogen. Monitorer knyttes kun, når nogen vælger dem i kortets liste over monitorer, som listen også siger: en monitor, der er knyttet til en hændelse, en person opretter, sætter sine kontroller på pause, indtil hændelsen er løst. Bottens bekræftelse nævner hændelsen ved dens nummer, linker til den og nævner, hvad den er knyttet til. En valgt ressource, der ikke længere kan knyttes (slettet, arkiveret eller ikke længere en, den person, der indsender kortet, må se), udelades, og botten fortæller det til den person i et svar, der nævner personen.
- **I en advarsels egen kanal.** Skrevet i den kanal, OneUptime oprettede til en advarsel, mens advarslen er åben, åbner `incident` et kort, der siger, at hændelsen oprettes fra den advarsel, og starter med advarslens titel og de ressourcer, den er knyttet til, som den person, der bad om kortet, må se. Hændelsen knyttes til advarslen, ligesom en hændelse, der oprettes fra advarslens side, og en privat advarsels hændelse er også privat. Når den person, der indsender kortet, ikke må knytte advarsler til hændelser, oprettes hændelsen uden tilknytningen, og botten fortæller personen hvorfor.
- **Hvad en formular må nævne.** I en kanal eller en gruppechat må alle, der er til stede, indsende formularen, og den indsendes som den, der gør det, med vedkommendes egne rettigheder. Hændelsen eller begivenheden oprettes med de rettigheder og krediteres den person. En monitor, vagtpolitik, etiket, alvorlighed eller status, personen ikke må læse, eller en fra et andet projekt, afvises som en, projektet ikke har, og intet oprettes: botten svarer "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en hændelse, advarsel eller episode virker på samme måde: den kræver rettighed til at køre en vagtpolitik (**Projektejer**, **Projektadministrator**, **Projektmedlem**, **Vagtadministrator** og **Vagtmedlem**, eller **Execute On-Call Policies** i en brugerdefineret rolle) og til at læse den hændelse, advarsel eller episode, og den tilbyder de aktive vagtpolitikker, personen må læse. At se en monitor eller en vagtpolitik fra et kort læser den også som den person, der trykkede på knappen.

## Tilkald nogen fra Microsoft Teams

I en kanal eller en gruppechat tilkalder `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` Nawaz med det samme. Han får et opkald, en SMS, en push-notifikation eller en e-mail, som hans egne vagtregler siger, og hver af dem fortæller ham, hvem der tilkaldte ham, gennem hvilket team eller hvilken vagtplan, og din besked. Hvor du sender kommandoen, afgør, hvad tilkaldet handler om:

- **I en hændelses eller en advarsels egen kanal**, den OneUptime oprettede til den, handler tilkaldet om den hændelse eller advarsel, og intet nyt oprettes. En besked er valgfri der: `@OneUptime page @Nawaz Dhandala` er nok. De personer, du tilkalder, tilkaldes, indtil en af dem svarer, fra tilkaldet eller ved at kvittere for hændelsen eller advarslen; kvitterer en anden, stopper tilkaldet ikke, men løses den, stopper det.
- **Alle andre steder**, som i en anden kanal, en gruppechat, en personlig chat med botten eller kanalen for en løst hændelse eller advarsel, opretter OneUptime en advarsel med din besked som titel og tilkalder, indtil nogen kvitterer for advarslen. Kortet siger det, og tilkaldet, der vises i samtalen, nævner advarslen.
- **Hvem der tilkaldes med det samme.** De personer, du nævner med @, og dem, der har vagt i de vagtplaner, som et mærke, du nævner med @, følger (se [Vagt-mærker](#vagt-mærker)), når en besked følger efter dem, eller uden besked i en hændelses eller en advarsels egen kanal. OneUptime kender en person på den OneUptime-konto, personens Microsoft Teams-konto er forbundet med, eller ellers på personens e-mailadresse i Microsoft Teams. Ingen uden for projektet tilkaldes.
- **Alt andet giver et kort.** Hvis ingen er nævnt med @, som i en personlig chat med botten, der ikke er nogen besked, hvor tilkaldet kræver en, du nævner et mærke, der ikke følger nogen vagtplan, du kan se, eller OneUptime ikke kan se, hvem en person er, svarer botten med kortet **Page someone**, med det, du skrev, udfyldt, og det siger, hvem det ikke kunne vælge. I en hændelses eller en advarsels egen kanal åbner kortet med den hændelse eller advarsel. Vælg personer, et team, en vagtplan, som tilkalder den, der har vagt i den nu, eller en vagtpolitik, som tilkalder via sine eskaleringsregler, og indsend det. Alle i samtalen må indsende kortet, som sig selv. Når det har tilkaldt, fjernes kortet, så ingen tilkalder med det to gange.
- **Hvor det vises.** Samtalen viser tilkaldet som ét kort, der holdes opdateret: hvem der blev tilkaldt og hvordan, hvert team med sit navn og sine personer efter, din besked, og hvem der kvitterede. Hvor botten ikke kan skrive det, fortæller dens svar, hvem der blev tilkaldt, med et link til hændelsen eller advarslen.
- **Hvem der må tilkalde.** I en hændelses eller en advarsels egen kanal alle, der må køre en vagtpolitik (**Projektejer**, **Projektadministrator**, **Projektmedlem**, **Vagtadministrator** og **Vagtmedlem**, eller **Execute On-Call Policies** i en brugerdefineret rolle) og læse den hændelse eller advarsel. Alle andre steder opretter tilkaldet en advarsel, så det kræver også rettighed til at oprette en: **Projektejer**, **Projektadministrator** og **Projektmedlem**, eller **Vagtmedlem** sammen med **Advarselsmedlem** (**Execute On-Call Policies** og **Create Alert** i en brugerdefineret rolle). At tilkalde personer, et team eller en vagtplan direkte, uden en vagtpolitik bag tilkaldet, kræver også adgang til alle projektets vagtpolitikker. Alle andre får det at vide i et svar, og ingen tilkaldes. På OneUptime Cloud kræver tilkald Growth-planen: under den siger OneUptime, hvilken plan der kræves, og ingen tilkaldes.

For at holde personer orienteret, mens andre håndterer det, kan du tilkalde dem som observatører. I en hændelses eller en advarsels egen kanal skriver du `as observers` efter, hvem der skal tilkaldes, som i `@OneUptime page @Oversight as observers Team Y is on it`, eller vælger **Observers: keep them informed** under **Page them as** på kortet. Deres tilkald siger, at de er observatører, og kvitterer de for det, siger det kun, at de har set det: Der bliver ikke kvitteret for hændelsen eller advarslen, ingen andres tilkald stopper, og hvor tilkaldet vises, står der, at de tilkaldes som observatører. Et tilkald om noget nyt kræver, at nogen håndterer det, så alle andre steder afvises `as observers`, og ingen tilkaldes.

## Vagt-mærker

Hold et mærke i Microsoft Teams, f.eks. `@Payments on-call`, lig med dem, der har vagt i en eller flere vagtplaner, så alle i dets team kan nævne det med @ for at nå dem. OneUptime ændrer mærkets medlemmer ved hver overdragelse og hver tilsidesættelse og tjekker det hvert 15. minut.

:::steps
### Forbind et mærke med en vagtplan

Åbn vagtplanen under **Vagt** > **Vagtplaner**. Klik på **Forbind mærke** i dens kort **Mærker i Microsoft Teams**, vælg teamet, og giv mærket et navn: teamets mærke med det navn eller et nyt, som OneUptime opretter. Medlemmerne bliver straks erstattet af dem, der har vagt.

### Forbind det også med den sekundære vagtplan

Til et mærke med både den primære og den sekundære vagt forbinder du det samme mærke på den sekundære vagtplans side. Et mærke kan følge et vilkårligt antal vagtplaner.
:::

- **Hvad kortet viser.** Hvem der er i hvert mærke nu, dets team, de andre vagtplaner, det følger, og om det er **Opdateret**. Et mærke rummer kun personer fra sit eget team: en person med vagt, som ikke er i teamet, nævnes med årsagen.
- **Ingen har vagt.** OneUptime tager alle ud af mærket, indtil nogen har vagt. Et nyt mærke kræver, at nogen fra teamet har vagt, for Microsoft Teams opretter ikke mærker uden medlemmer.
- **Tilkald mærket.** `@OneUptime page @Payments on-call The checkout API is down` tilkalder dem, der har vagt i de vagtplaner, mærket følger. Se [Tilkald nogen fra Microsoft Teams](#tilkald-nogen-fra-microsoft-teams).
- **Hvad Microsoft 365 kræver.** At ændre mærker kræver appens tilladelse `TeamworkTag.ReadWrite.All`, som en Microsoft 365-administrator giver med **Giv administratorsamtykke** under **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**. Hvis din organisation gav samtykke, før OneUptime kunne holde mærker opdateret, så giv det igen én gang.
- **Hvem der må forbinde et.** De roller, der må redigere vagtplaner: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Vagtadministrator** og **Vagtmedlem**, eller **Edit On-Call Schedule** i en brugerdefineret rolle. På OneUptime Cloud kræver det abonnementet **Growth** at forbinde et.
- **Afbryd forbindelsen.** OneUptime holder op med at ændre mærket. Mærket og dets medlemmer bliver i Microsoft Teams, som de er.

## Håndter en hændelse fra Microsoft Teams

En hændelses kort har fire knapper, **Acknowledge Incident**, **Resolve Incident**, **Add Note** og **View Incident**, og resten i dets menu, knappen med tre prikker:

| Menupunkt | Hvad det gør |
| --- | --- |
| **Change Severity** | Sætter hændelsens alvorlighed. |
| **Change Incident State** | Flytter hændelsen til en senere tilstand. |
| **Assign Role** | Giver nogen en rolle i hændelsen, som **Incident Commander**. En rolle til én person går over til vedkommende. |
| **Page Someone** | Tilkalder personer, et team, den der har vagt i en vagtplan, eller en vagtpolitik om hændelsen, med en valgfri besked. Alle, den tilkalder, også en politiks personer, tilkaldes, indtil en af dem svarer, eller hændelsen er løst. |
| **Edit Custom Fields** | Sætter hændelsens brugerdefinerede felter, hvert udfyldt med det, hændelsen har. Et felt, der efterlades tomt, ryddes. |

`incident 42`, skrevet til botten, svarer med hændelse 42, disse knapper og dens menu. Skriv nummeret, som OneUptime viser det: `42`, `#42` eller `INC-42`. I en hændelses egen kanal viser `incident` alene den hændelse.

- **Hvem der må bruge dem.** De personer, der må foretage den samme ændring i OneUptime, som i Slack: se [Håndter en hændelse fra Slack](/docs/workspace-connections/slack#håndter-en-hændelse-fra-slack). Hvert punkt svarer med et kort, udfyldt som den person, der trykkede på det, må se hændelsen. Alle i samtalen må indsende kortet, som sig selv, med deres egne tilladelser.
- **Hvad der sker.** Ændringen foretages som den person, der indsendte kortet, som i OneUptime, og hændelsens feed fortæller, hvad der ændrede sig. Botten siger det i et svar, der nævner personen, og fjerner kortet, så ingen indsender det to gange. **Page Someone** fortæller, hvem der blev tilkaldt, eller hvorfor ingen blev; en hændelse, der allerede er løst, tilkalder ingen.
- **Hvor Microsoft Teams er anderledes.** Et kort kan ikke sige under et felt, hvad der er galt: en værdi, der ikke passer, nævnes i et svar, og kortet bliver stående, så det kan rettes og indsendes igen. Et felt med dato og klokkeslæt er en dag og et klokkeslæt, i din egen tidszone. En ældre Teams-klient viser menuen som flere knapper. `incident 42` svarer i samtalen, hvor alle i den kan se hændelsen.
- **Kort fra før menuen.** De beholder deres knap **Execute On-Call Policy**, og den virker stadig: **Page Someone** tilkalder også en vagtpolitik. Advarsler og episoder beholder deres.

## Handl på hændelser, advarsler og begivenheder fra Microsoft Teams

Knapperne på OneUptimes kort handler som den person, der trykker på dem, i en personlig chat, en kanal eller en gruppechat: som den OneUptime-konto, personens Microsoft Teams-konto er forbundet med, med den kontos rettigheder i projektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** og **Execute On-Call Policy** på en hændelse, en advarsel eller en episode, og **Mark as Ongoing**, **Mark as Complete**, **Change State** og **Add Note** på en vedligeholdelseshændelse, laver hver den ændring, som samme handling laver i OneUptime, og den krediteres den person der: postens tilstandstidslinje og feed viser, hvem der ændrede dens tilstand, og noten er personens. En note, der gemmes fra en besked med en reaktion, slås op på samme måde.

- **Hvem der må bruge dem.** De personer, der må lave den samme ændring i OneUptime. At bekræfte, løse eller ændre tilstanden for en hændelse kræver rettighed til at ændre dens tilstand: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Hændelsesadministrator** og **Hændelsesmedlem**, eller **Create Incident State Timeline** i en brugerdefineret rolle. En advarsel, en episode eller en vedligeholdelseshændelse kræver den samme rettighed for sin egen type (**Create Alert State Timeline**, for eksempel), og en note kræver rettighed til at slå den type note op. Ligesom tilstandspanelet i OneUptime beder de ikke om rettighed til at redigere selve hændelsen eller advarslen. Alle andre får det at vide, og intet ændres.
- **Hvilke poster.** Dem, personen må læse, ligesom i OneUptime: med en rolle, der er begrænset til nogle etiketter, de hændelser, advarsler, episoder og begivenheder, der har dem. En knap på enhver anden post siger hvorfor, og intet ændres: på en hændelse, personens rolle ikke når, "your access in this project does not include this incident. Ask a project admin for access to it."; på en privat hændelse, personen ikke er ejer af, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; og på en, der er slettet siden, "the incident was not found. It may have been deleted." På OneUptime Cloud afvises en ændring, som projektets plan ikke omfatter, med den plan, den kræver.
- **Hvad Change State tilbyder.** De tilstande, personen må læse, som posten må gå videre til, i projektets rækkefølge: ingen før den tilstand, den er i, for en episode som for en hændelse, en advarsel eller en vedligeholdelseshændelse, da en tilstandsændring aldrig flytter en post op igen i sin liste (se [Rækkefølgen er en reel begrænsning](/docs/incidents/states-and-severities#rækkefølgen-er-en-reel-begrænsning-ikke-en-visningspræference)). Når personen ikke må læse nogen, siger botten "No incident states are available to you in this project. Ask a project admin for access to them."; når posten er i den sidste tilstand, den kan nå, siger den "There is no later state to move this incident to." Ingen af dem viser et tomt kort.
- **Add Note på en privat hændelse.** En privat hændelse tager ingen offentlige noter, så dens kort spørger ikke om notetype og tilføjer en privat note. Et kort, der blev sendt, før den blev gjort privat, tilføjer også en privat note og siger det. Se [Private hændelser tager kun private noter](/docs/incidents/notes-owners-and-feed#private-hændelser-tager-kun-private-noter).
- **Escalate.** Et korts **Escalate** kører dets vagtpolitik for den hændelse, advarsel eller episode, kortet handler om, som den person, der trykkede på den, med de samme rettigheder som **Execute On-Call Policy**. Et kort, der ikke handler om nogen af dem, besvares med "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", og ingen tilkaldes.
- **Hvor personen får svar.** I et svar i den samme samtale, kortets tråd i en kanal, der nævner personen, så Microsoft Teams giver besked. En knap, der trykkes for sent, fortæller, hvem der kom først, og hvornår, for eksempel "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Hvis personens konto ikke er forbundet.** Svaret beder personen forbinde den, med en knap **Connect Microsoft Teams account**. Knappen åbner personens egne Microsoft Teams-indstillinger i OneUptime og forbinder kontoen i ét trin, efter login i OneUptime, hvis det er nødvendigt. Derefter gør OneUptime færdigt, hvad personen trykkede på, som personen, og svarer i den samme samtale; for en knap, der åbner en formular, eller en kommando beder det personen trykke på den eller skrive den igen. Knappen virker én gang, i 30 minutter, og kun for den Microsoft-konto, der trykkede på den.

## Godkend en rettelse, som OneUptime AI foreslår

En rettelse, som OneUptime AI foreslår til godkendelse, sendes til hændelsens eller advarslens kanaler som et kort med dens ændringer og tre knapper. **Review and approve** svarer med et kort med alt, hvad rettelsen kører, og **Approve and run**, som kører præcis det, som den person, der trykker; når rettelsen er godkendt, fjernes det kort, og personen får at vide, at rettelsen bliver foretaget. **Dismiss** afviser rettelsen, og **View in OneUptime** åbner hændelsen eller advarslen. De handler som den person, der trykker på dem, ligesom hver knap på OneUptimes kort: en godkendelse kræver tilladelse til at godkende rettelser i projektet og, for en rettelse på en klynge eller ressource, til at redigere den. En rettelse, der ændrede sig, efter dens kort blev sendt, afvises, og intet køres. Se [Godkend eller afvis en rettelse fra Slack eller Microsoft Teams](/docs/ai/ai-sre#godkend-eller-afvis-en-rettelse-fra-slack-eller-microsoft-teams).

## Godkend en offentlig note

Når projektets offentlige noter kræver godkendelse, og du slår Microsoft Teams til for **Godkendelse af offentlige noter** i dine notifikationsindstillinger, kommer hver offentlig note, der venter på et trin, du godkender, til din personlige chat med OneUptime-botten som et kort: hvem der sendte den, hvilket trin den venter på, noten og tre knapper. **Approve** godkender den for det trin; på det sidste trin hedder den **Approve and publish**, og noten offentliggøres med det samme. **Reject** svarer med et kort, der spørger **Why are you rejecting it?**: en begrundelse er påkrævet, og notens forfatter ser den; når noten er afvist, fjernes kortet. **View in OneUptime** åbner noten. Knapperne handler som dig, efter de samme regler som i OneUptime: du skal være nævnt på trinnet, selv eller gennem et team, og du kan ikke afgøre en note, du selv sendte, eller godkende to trin af samme note. Botten svarer i den samme chat. Et tryk, efter at en anden har afgjort, eller efter at noten eller dens trin er ændret, afgør intet og siger, hvad der skete. Når noten er afgjort, ændres hver godkenders kort om den, også dit, så det siger, hvad der skete: godkendt for sit trin og hvem den nu venter på, offentliggjort, afvist, ændret eller sendt til godkendelse igen, offentliggjort uden godkendelse eller slettet. Det beholder **View in OneUptime**, og **Approve** og **Reject** er væk. Hvis din Microsoft Teams-konto ikke er forbundet, beder svaret dig forbinde den, og OneUptime godkender noten for dig, når du har gjort det; tryk på **Reject** igen. Når godkendelsestrinnene ændres, mens en note venter, ændres din besked om den også, hvis noten ikke længere venter på dit trin, eller du ikke længere bliver spurgt, og dem, den nu venter på, får deres egen besked. Se [Godkendelse af offentlige noter](/docs/incidents/notes-owners-and-feed#godkendelse-af-offentlige-noter).

## Afbryd forbindelsen

- **Afbryd forbindelse** fjerner kun tilknytningen af din egen Microsoft Teams-konto og fjerner samtidig din Microsoft Teams-notifikationsmetode.
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
Tryk på **Connect Microsoft Teams account** i botens svar for at forbinde den i ét trin, eller knyt den under **Brugerindstillinger** > **Arbejdsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**. Uanset hvad logger du ind i den organisation, projektet er forbundet med, som gæst, hvis du er gæst der. Er du gæst og har tidligere forbundet din egen organisations konto, så forbind den igen.
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
