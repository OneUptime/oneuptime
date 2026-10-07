# Konfiguration & sikkerhed

Denne side handler om de indstillinger og sikkerhedsgrænser, der er værd at kende, før du retter et workflow mod rigtig trafik.

## Sådan tænder og slukker du et workflow

Hvert workflow har en kontakt, **Aktiveret**, øverst i sin **Bygger** og på sin side **Oversigt**. Når den er slukket, kører workflowet ikke — webhook-kald, planlagte tidspunkter og OneUptime-begivenheder bliver alle ignoreret, og det samme gør **Kør arbejdsgang** og **Run just this step**. Nye workflows starter deaktiveret.

Brug kontakten som din "klar til brug"-port:

1. Byg workflowet.
2. Klik **Kør arbejdsgang** i **Bygger** med realistiske værdier. Et deaktiveret workflow kører ikke engang i hånden, så Bygger spørger først, om det skal slås til: klik **Slå til og kør**.
3. Tjek **Logs** — sørg for, at hver blok gik derhen, du forventede.
4. Lad **Aktiveret** være slået til, hvis det er klar. Hvis ikke, så slå det fra, indtil det er: mens det er slået til, fyrer triggeren ved rigtige begivenheder.

At slukke for et workflow stopper ikke kørsler, der allerede er i gang; det forhindrer bare nye i at starte.

## Ejere og etiketter

- **Ejere** — brugere og teams, der står som ejere, får adgang til workflowet og kan tilvælge besked, når det fejler. Sæt dem under **Indstillinger → Ejere**.
- **Etiketter** — mærkater til at gruppere workflows. Listen over workflows kan filtreres på etiket, og det gør et travlt projekt langt nemmere at navigere i. Nyttigt, når du organiserer workflows efter team, integration eller miljø.
- **Etiketregler** — under **Arbejdsgange → Indstillinger → Etiketregler** sætter du automatisk etiketter på nye workflows ud fra mønstre i navn eller beskrivelse.
- **Ejerregler** — under **Arbejdsgange → Indstillinger → Ejerregler** tildeler du automatisk ejere til nye workflows.

## Hemmeligheder

Markér en global variabel som en **Hemmelighed**, hvis den indeholder noget følsomt. Værdien skjules for almindelige API- og UI-læsninger, når du har gemt den, og workflow-logningen renser den opløste værdi ud, før kørselsloggen gemmes.

Brug hemmelige variabler til:

- API-nøgler til eksterne tjenester.
- Godkendelsestokens.
- Signeringsnøgler til webhooks.
- Alt, du ikke ville bryde dig om, at en med læseadgang kunne se.

Indsæt aldrig en hemmelighed direkte i en blok — værdier som `Authorization: Bearer eyJh...` ender synlige i både workflowet og logfilerne. Brug `{{global.variables.MY_SECRET}}` i stedet.

## Eksport og import af workflows

Du kan flytte et workflow mellem projekter, eller mellem en selv-hostet installation og OneUptime Cloud, som en JSON-fil.

- **Eksport** — åbn workflowet, og brug **Export Workflow** under **Indstillinger**. Fra listen over workflows kan du også markere flere workflows og eksportere dem til én samlet fil.
- **Import** — klik **Import JSON** på listen **Arbejdsgange**, og vælg en fil eksporteret fra et hvilket som helst OneUptime-projekt.

Filen indeholder workflowets navn, beskrivelse, aktiveringstilstand og dets graf. Den indeholder bevidst ikke:

- **Webhook-hemmeligheden.** Der genereres en ny, når workflowet oprettes, så et importeret workflow har en anden webhook-URL. Alt, der kaldte det oprindelige, skal peges om.
- **Globale variabler.** En blok, der læser `{{global.variables.MY_SECRET}}`, beholder referencen, men selve værdien ligger ikke i filen. Opret variablerne i modtagerprojektet, før du kører det importerede workflow.
- **Ejere og etiketter.** Projektets egne etiket- og ejerregler kører mod det importerede workflow, præcis som hvis du havde oprettet det i hånden.

Et importeret workflow oprettes altid **deaktiveret**, også selvom det var aktiveret dér, hvor det blev eksporteret fra — dets graf kan pege på monitorer, vagtpolitikker eller andre workflows, der ikke findes i modtagerprojektet. Gennemgå det, aktivér det, test det med **Kør arbejdsgang**, og lad det så være tændt. Dublering af et workflow opfører sig på samme måde, så en kopi begynder aldrig at køre side om side med originalen, før du har redigeret den.

Fordi grafen rejser ordret med, følger alt, hvad der er skrevet direkte ind i en blok, også med. Det er den praktiske grund til at holde credentials i hemmelige variabler: eksporterer du et workflow med et hårdkodet token, forærer du det token til den, der modtager filen.

## Hvor længe en kørsel må tage

Hvert eksekveringsforsøg har en deadline i faktisk tid. Runneren tjekker den før og efter hver komponent og markerer en kørsel, der er løbet over, som **Timeout**, så snart kontrollen vender tilbage. Komponenter, der laver netværks- eller script-arbejde, har også brug for deres egne timeouts, fordi runneren ikke med magt kan afbryde vilkårlig komponentkode.

AI-komponenten udleder sin timeout for udbyderanmodningen af den resterende workflow-tid og skærer den af ved 60 sekunder, så der er en lille margen til logning og oprydning.

## Grænse for at kalde andre workflows

Komponenten **Execute Workflow** lader ét workflow kalde et andet. For at forhindre utilsigtede løkker, hvor workflow A kalder B, som kalder A igen, er der et loft over, hvor dyb kæden må blive. En kørsel, der går forbi grænsen, ender med en tydelig fejl.

Har du et reelt behov for en lang kæde (for eksempel et job, der behandler ét element per kørsel), er det som regel enklere at løkke inde i ét enkelt workflow med **Custom Code**.

## Webhook-sikkerhed

Webhook-triggere giver dig en unik URL. Alle, der kender URL'en, kan ramme den. Sådan beskytter du dig mod utilsigtede eller uønskede kaldere:

- Behandl URL'en som en adgangskode. Del den ikke offentligt, og commit den ikke til et offentligt repo.
- Bed for følsomme workflows det kaldende system om at sende et delt token som header (for eksempel `X-Webhook-Token`), og tjek det med en **Conditions**-blok, før der sker noget vigtigt. Gem det forventede token som en hemmelig variabel.
- For meget følsomme workflows er en OneUptime-begivenhedstrigger med et manuelt importtrin at foretrække frem for en offentlig webhook.

## Udgående netværksadgang

API-blokke og andre HTTP-blokke sender deres anmodninger fra OneUptime. Hoster du selv, så sørg for, at din installation kan nå de tjenester, du kalder. Bruger du OneUptime Cloud, står vores udgående IP-intervaller i [IP-adresser](/docs/configuration/ip-addresses), så du kan tillade dem i den anden ende.

## AI-komponenter

**Generate Text with AI** sender én anmodning gennem OneUptimes konfigurerede LLM-gateway. Den bruger projektets standard-LLM-udbyder, eller installationens globale udbyder, når projektet ikke har en. Konfigurér udbydere under **Projektindstillinger → AI → LLM-udbydere**; læg aldrig en udbyder-API-nøgle eller et vilkårligt model-endpoint ind i selve workflowet.

AI-komponenten har en eksplicit grænse for, hvad der forlader systemet:

- OneUptime sender en fast komponent-sikkerhedsinstruktion plus de opløste **System Instructions**, **Prompt** og serialiserede **Context** til den konfigurerede udbyder. Context tilføjes efter en eksplicit markør i slutningen af brugerbeskeden; den faste instruktion siger, at alt efter den markør forbliver utroværdige data, også når det indeholder tags eller instruktioner.
- Den vedhæfter ikke automatisk triggerens payload, workflowets historik, andre komponenters output, projektposter, telemetri eller hemmeligheder. Data forlader kun systemet, når du refererer til dem i et af de tre felter.
- Den sender ingen værktøjsdefinitioner eller udbyder-specifikke kapabilitetsfelter. Modellen kan ikke forespørge OneUptime, foretage HTTP-anmodninger eller ændre projektdata gennem denne komponent. Den konfigurerede udbyder og model er fortsat en tillidsgrænse, administratoren sætter, så installationer, der kræver strengt offline generering, bør vælge en model uden indbygget udbyderstyret opslag.
- Yderligere parametre på udbyderniveau er begrænset til en tilladelsesliste af rene genereringsindstillinger. De kan ikke erstatte workflowets beskeder, tilføje værktøjer eller udbyder-specifik websøgning og datakilder, aktivere ikke-tekstlige modaliteter, bede om flere svarmuligheder, aktivere streaming, gemme anmodningen via udbyderens lagringsflag eller hæve denne komponents loft for output-tokens. Ukendte fremtidige kapabilitetsfelter droppes som udgangspunkt.
- Værdierne i System Instructions, Prompt, Context og det genererede Response redigeres væk fra denne AI-komponents egne argument- og returværdiposter i den automatiske workflow-eksekveringslog. De er stadig tilgængelige for efterfølgende komponenter, mens kørslen er i gang. Indsætter du en af dem i en anden komponent, gælder den komponents logningspolitik og kan gemme den opløste værdi; betragt genbrug som en bevidst videregivelse. Udbyder- og modelnavne, tokenantal, LLM Log ID og ufarlige fejlbeskeder er fortsat synlige til drift og fakturering. Rå fejlsvar fra udbyderen udelades fra workflow-logfiler, LLM-logfiler, applikationslogfiler og traces, fordi en udbyder kan gengive indholdet af anmodningen.

Betragt hver refereret variabel som data, du bevidst sender til udbyderen. Sæt især ikke en hemmelig global variabel ind i prompten eller konteksten, medmindre den videregivelse er nødvendig, og udbyderen er godkendt til at modtage den. En selv-hostet lokal udbyder som Ollama kan holde anmodningen inde i din egen infrastruktur; en hostet udbyder modtager anmodningen under den pågældende udbyders databehandlingsvilkår.

Hvert kald registreres under **Projektindstillinger → AI → AI-logs**, inklusive udbyder, model, status, tokens, omkostning og faktureringsoplysninger. Forhåndsvisninger af prompt og svar samt rå fejldetaljer fra udbyderen gemmes ikke i AI-loggen. Kald gennem en betalt global udbyder trækker på projektets AI-kreditsaldo. Workflow-AI tæller også med i projektets daglige budget for autonome AI-tokens; er budgettet brugt op, tager komponenten sin **Error**-sti uden at kontakte modellen. Projekt-AI skal være aktiveret. På OneUptime Cloud skal abonnementet være betalt, og Growth-planen (eller en plan, der indeholder Growth-funktioner) er påkrævet; selv-hostede installationer med fakturering slået fra har ikke den planbegrænsning.

Indbyggede grænser holder kald uden opsyn endelige: System Instructions, Prompt og serialiseret Context er tilsammen begrænset til 50.000 tegn; Temperature skal ligge fra `0` til `1`; Maximum Output Tokens skal ligge fra `1` til `4096` (standard `1024`); og udbyderanmodningen forsøges én gang og timer ud efter højst 60 sekunder. Højst tre workflow-AI-kald kører samtidig per projekt; yderligere kald tager **Error**-stien og kan forsøges igen af en senere workflow-kørsel. Fejl i validering, konfiguration, adgang, budget, saldo, samtidighed, udbyder og timeout tager alle **Error**-stien og fylder outputtet **Error**. Forbind den sti, før du aktiverer et produktionsworkflow.

## Tilladelser

Workflows respekterer dit projekts rollebaserede adgangskontrol. De tre workflow-roller:

- **Workflow Admin** — bygger workflows: opretter, ændrer, kører og sletter dem og administrerer de variabler, de bruger.
- **Workflow Member** — bruger dem: åbner workflows og deres kørsler og kører et workflow manuelt med **Kør arbejdsgang**. Et medlem kan ikke oprette, ændre eller slette et workflow eller køre et af dets trin for sig selv.
- **Workflow Viewer** — læser workflows og deres kørsler.

**Project Owner** og **Project Admin** kan alt, hvad en Workflow Admin kan. **Project Member** kan oprette og slette workflows, men ikke ændre eller køre dem.

De enkelte tilladelser, til et team eller en API-nøgle, der skal have præcis én ting:

- **Create / Read / Edit / Delete Workflow** — de grundlæggende tilladelser på selve workflowet. At ændre et workflow, herunder at slå det til eller fra og arkivere det, kræver **Edit Workflow**; **Delete Workflow** sletter kun.
- **Edit Workflow** — er også det, der skal til for at køre ét trin for sig selv med **Run just this step** og for at se eller nulstille et workflows webhook-URL og indgående e-mailadresse. At køre et helt workflow manuelt kræver **Edit Workflow**, **Workflow Admin** eller **Workflow Member**.
- **Read Workflow Log** — nødvendig for at se kørsler.
- **Read / Create / Edit / Delete Workflow Variable** — kontrol over listen af globale variabler.

En manuel kørsel når kun de workflows, du kan åbne: en rolle, der er begrænset til bestemte etiketter eller til de workflows, dit team ejer, kører kun dem. Den, der ikke kan køre et workflow, ser **Kør arbejdsgang** nedtonet med årsagen i værktøjstippet.

Giv dem, der bygger automatisering, **Workflow Admin**, og dem, der kun starter den, **Workflow Member**. Gem redigeringsadgangen til variabler til de folk, der administrerer projektets hemmeligheder.

## Hvad workflow-trin må gøre

De trin, der læser og ændrer OneUptime-poster – komponenterne Find, Create, Update og Delete og udløserne On Create, On Update og On Delete – handler som en **Project Admin** i workflowets projekt. De møder de samme kontroller som en Project Admin i dashboardet og API'et:

- **Kun workflowets eget projekt.** Et trin læser og ændrer aldrig et andet projekts poster, og en Update flytter aldrig en post til et andet projekt.
- **Kun det, en Project Admin må.** Et trin kan ikke give tilladelser, som en Project Admin ikke selv har (som **Project Owner** eller fakturering), og kan ikke tilføje nogen til et team med flere tilladelser, som ejernes team.
- **Kun det, jeres plan indeholder.** På OneUptime Cloud afvises det, jeres plan ikke indeholder, med navnet på den plan, der kræves.
- **Intet af det, OneUptime selv holder styr på.** Feed-poster kan ikke redigeres eller slettes, notifikationslogge kan ikke skrives, og værdier, OneUptime selv sætter (som en bekræftet CNAME, et teams beskyttelseskontakter eller hvem der har vagt nu), kan ikke ændres.
- **Som ingen person.** En post, et workflow opretter, har ingen opretter, og revisionsloggen angiver workflowet som den, der foretog ændringen.

Et afvist trin tager sit **Error**-output uden at foretage den afviste ændring, og kørselsloggen fortæller, hvilket trin der blev afvist og hvorfor. Et Create Many-trin opretter sine poster én ad gangen og stopper ved den afviste; de poster, der blev oprettet før den, bevares. Trin, der taler med andre systemer (API, e-mail, chat, Custom Code, AI), berøres ikke.

## Plangrænser

OneUptime Cloud sætter et loft over antallet af kørsler per måned på de mindre planer. Din nuværende grænse står under **Projektindstillinger → Fakturering**. Når du når den, afvises nye triggere indtil næste faktureringsperiode. Selv-hostede installationer har ikke den grænse.

## Når workflows ikke er det rigtige værktøj

Et par tilfælde, hvor du bør gribe ud efter noget andet:

- **Tunge beregninger eller store datasæt** — workflows er lavet til let limarbejde, ikke til talknuseri. Kør det tunge arbejde i din egen infrastruktur, og lad et workflow sætte det i gang.
- **Langvarig aktiv beregning** — ét eksekveringsforsøg er tænkt til at blive færdigt hurtigt. Til en passiv pause som "gør A, vent to timer, gør B" bruger du komponenten **Sleep**; den gemmer kørslen og genoptager den senere uden at optage en worker.
- **Trin-for-trin-hændelseshåndtering med mennesker involveret** — det er dét, [Runbooks](/docs/runbooks/index) er til. Workflows er til automatik uden opsyn.

## Hvor du kan læse videre

- [Workflows – Oversigt](/docs/workflows/index) — det store billede.
- [Workflow-komponenter](/docs/workflows/components) — reference blok for blok.
- [Runbooks – Oversigt](/docs/runbooks/index) — hvornår du hellere skal bruge et runbook.
