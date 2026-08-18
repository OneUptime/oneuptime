# Konfiguration og sikkerhed

Denne side dækker de indstillinger og sikkerhedsgrænser, det er værd at kende, før du peger en arbejdsgang mod rigtig trafik.

## Slå en arbejdsgang til eller fra

Hver arbejdsgang har en **Enabled**-kontakt i **Settings**. Når den er slået fra, kører arbejdsgangen ikke — webhook-kald, planlagte tidspunkter og OneUptime-hændelser ignoreres alle. Nye arbejdsgange starter deaktiverede.

Brug denne kontakt som din "klar til brug"-port:

1. Byg arbejdsgangen.
2. Klik på **Run Workflow** i **Builder** med realistiske værdier.
3. Tjek **Logs** — sørg for, at hver blok gik, som du forventede.
4. Slå **Enabled** til.

At slå en arbejdsgang fra stopper ikke kørsler, der allerede er i gang; det stopper blot nye i at starte.

## Ejere og etiketter

- **Owners** — brugere og teams, der er angivet som ejere, får adgang til arbejdsgangen og kan vælge at modtage notifikationer, når den fejler. Sæt dem under **Settings → Owners**.
- **Labels** — mærker til gruppering af arbejdsgange. Listen over arbejdsgange lader dig filtrere efter etiket, hvilket gør et travlt projekt langt lettere at navigere i. Nyttigt, når dine arbejdsgange er organiseret efter team, integration eller miljø.
- **Label rules** — under **Workflows → Settings → Label Rules** kan du automatisk anvende etiketter på nye arbejdsgange baseret på mønstre i navn eller beskrivelse.
- **Owner rules** — under **Workflows → Settings → Owner Rules** kan du automatisk tildele ejere til nye arbejdsgange.

## Hemmeligheder

Markér en global variabel som en **secret**, hvis den indeholder noget følsomt. Værdien skjules fra normale API- og UI-læsninger, efter du har gemt den, og arbejdsgangens logning renser den udregnede værdi, før kørselsloggen gemmes.

Brug hemmelige variabler til:

- API-nøgler til eksterne tjenester.
- Autentifikationstokens.
- Signeringsnøgler til webhooks.
- Alt, du ikke ville ønske, at nogen med skrivebeskyttet adgang kunne se.

Indsæt ikke en hemmelighed direkte i en blok — værdier som `Authorization: Bearer eyJh...` ender med at være synlige i arbejdsgangen og i loggene. Brug `{{global.variables.MY_SECRET}}` i stedet.

## Eksport og import af arbejdsgange

Du kan flytte en arbejdsgang mellem projekter, eller mellem en selv-hostet installation og OneUptime Cloud, som en JSON-fil.

- **Export** — åbn arbejdsgangen, og brug **Export Workflow** under **Settings**. Fra listen over arbejdsgange kan du også vælge flere arbejdsgange og eksportere dem til én samlet fil.
- **Import** — på listen **Workflows** klikker du på **Import JSON** og vælger en fil eksporteret fra et hvilket som helst OneUptime-projekt.

Filen indeholder arbejdsgangens navn, beskrivelse, aktiveringstilstand og dens graf. Den indeholder med vilje ikke:

- **Webhook-hemmeligheden.** En ny genereres, når arbejdsgangen oprettes, så en importeret arbejdsgang får en anden webhook-URL. Alt, der kalder den oprindelige, skal omdirigeres.
- **Globale variabler.** En blok, der læser `{{global.variables.MY_SECRET}}`, beholder den reference, men værdien er ikke i filen. Opret variablerne i destinationsprojektet, før du kører den importerede arbejdsgang.
- **Ejere og etiketter.** Dit projekts egne etiket- og ejerregler kører mod den importerede arbejdsgang, ligesom hvis du havde oprettet den i hånden.

En importeret arbejdsgang oprettes altid som **deaktiveret**, selv hvis den var aktiveret der, hvor den blev eksporteret fra — dens graf kan pege på overvågninger, vagtpolitikker eller andre arbejdsgange, der ikke findes i destinationsprojektet. Gennemgå den, aktivér den, test den med **Run Workflow**, og lad den derefter stå til. At duplikere en arbejdsgang opfører sig på samme måde, så en kopi begynder aldrig at køre sammen med originalen, før du har redigeret den.

Fordi grafen rejser ordret med, følger alt, der er skrevet direkte ind i en blok, med. Det er den praktiske grund til at holde legitimationsoplysninger i hemmelige variabler: at eksportere en arbejdsgang med en hardkodet token giver den token videre til den, der modtager filen.

## Hvor længe en kørsel må tage

Hvert udførelsesforsøg har en deadline i realtid. Kørselsmotoren tjekker den før og efter hver komponent og markerer en forsinket kørsel som **Timeout**, så snart kontrollen vender tilbage. Komponenter, der udfører netværks- eller scriptarbejde, skal også have deres egne tidsgrænser, fordi kørselsmotoren ikke kan tvinge en afbrydelse af vilkårlig komponentkode.

AI-komponenten udleder sin timeout for udbyderforespørgslen fra den resterende arbejdsgangstid og begrænser den til 60 sekunder, hvilket efterlader en lille margin til logning og oprydning.

## Grænse for at kalde andre arbejdsgange

Komponenten **Execute Workflow** lader én arbejdsgang kalde en anden. For at forhindre utilsigtede løkker, hvor arbejdsgang A kalder B, som kalder A igen, er der et loft for, hvor dyb kæden kan gå. En kørsel, der overskrider grænsen, ender med en klar fejl.

Hvis du har et reelt behov for en lang kæde (som et job, der behandler ét element per kørsel), er det som regel enklere at lave en løkke inde i en enkelt arbejdsgang ved hjælp af **Custom Code**.

## Webhook-sikkerhed

Webhook-triggere giver dig en unik URL. Alle, der kender URL'en, kan ramme den. For at beskytte mod utilsigtede eller uønskede kaldere:

- Behandl URL'en som en adgangskode. Del den ikke offentligt, og commit den ikke til et offentligt repo.
- For følsomme arbejdsgange, bed det kaldende system om at sende et delt token som en header (som `X-Webhook-Token`) og tjek det med en **Conditions**-blok, før du gør noget vigtigt. Gem det forventede token som en hemmelig variabel.
- For meget følsomme arbejdsgange, foretræk en OneUptime-hændelsestrigger og et manuelt importtrin frem for en offentlig webhook.

## Udgående netværksadgang

API- og andre HTTP-blokke foretager deres anmodninger fra OneUptime. Hvis du selv-hoster, skal du sikre dig, at din installation kan nå de tjenester, du kalder. Hvis du bruger OneUptime Cloud, er vores udgående IP-intervaller listet under [IP Addresses](/docs/configuration/ip-addresses), så du kan tillade dem i den anden ende.

## AI-komponenter

**Generate Text with AI** sender én anmodning gennem OneUptimes konfigurerede LLM-gateway. Den bruger projektets standard-LLM-udbyder, eller installationens globale udbyder, når projektet ikke har sin egen. Konfigurér udbydere under **Project Settings → AI → LLM Providers**; sæt aldrig en udbyders API-nøgle eller et vilkårligt model-endpoint direkte i arbejdsgangen.

AI-komponenten har en eksplicit udgangsgrænse:

- OneUptime sender en fast komponent-sikkerhedsinstruktion plus de udregnede **System Instructions**, **Prompt** og serialiserede **Context** til den konfigurerede udbyder. Context tilføjes efter en eksplicit markør til sidst i brugerbeskeden; den faste instruktion siger, at alt efter den markør forbliver utroværdige data, selv når det indeholder tags eller instruktioner.
- Den vedhæfter ikke automatisk triggerens nyttelast, arbejdsgangshistorik, andre komponenters output, projektposter, telemetri eller hemmeligheder. Data forlader kun systemet, når du refererer til det i én af de tre inputfelter.
- Den sender ingen værktøjsdefinitioner eller udbyder-native kapacitetsfelter. Modellen kan ikke forespørge OneUptime, foretage HTTP-anmodninger eller ændre projektdata gennem denne komponent. Den konfigurerede udbyder/model forbliver en administrator-tillidsgrænse, så installationer, der kræver strengt offline generering, bør vælge en model uden indbygget udbyderstyret hentning.
- Udbyderniveauets ekstra parametre er begrænset til en tilladelsesliste af rene generings-tuningfelter. De kan ikke erstatte arbejdsgangens beskeder, tilføje værktøjer eller udbyder-native websøgnings-/datakilder, aktivere andre modaliteter end tekst, anmode om flere svarmuligheder, aktivere streaming, beholde anmodningen gennem udbyderens lagringsflag eller hæve denne komponents loft for output-tokens. Ukendte fremtidige kapacitetsfelter frasorteres som standard.
- System Instructions, Prompt, Context og de genererede Response-værdier redigeres væk fra denne AI-komponents egne argument- og returværdi-poster i den automatiske arbejdsgangs eksekveringslog. De forbliver tilgængelige for efterfølgende komponenter, mens kørslen udføres. Hvis du indsætter en af dem i en anden komponent, gælder den komponents logningspolitik, og den kan registrere den udregnede værdi — betragt genbrug som en eksplicit videregivelse. Udbyder-/modelnavne, tokenantal, LLM Log-ID'et og sikre fejlmeddelelser forbliver synlige til drift og fakturering. Rå fejlsvar fra udbyderen udelukkes fra arbejdsgangslogs, LLM-logs, applikationslogs og traces, fordi en udbyder kan ekko anmodningsindholdet tilbage.

Betragt enhver refereret variabel som data, du bevidst sender til udbyderen. Indsæt især ikke en hemmelig global variabel i prompten eller konteksten, medmindre den videregivelse er nødvendig, og udbyderen er godkendt til at modtage den. En selv-hostet lokal udbyder som Ollama kan holde anmodningen inde i din egen infrastruktur; en hostet udbyder modtager anmodningen under den udbyders databehandlingsvilkår.

Hvert kald registreres under **Project Settings → AI → AI Logs**, inklusive udbyder, model, status, tokens, omkostning og faktureringsoplysninger. Prompt- og svarforhåndsvisninger samt rå fejloplysninger fra udbyderen gemmes ikke i AI-loggen. Kald gennem en betalt global udbyder trækker på projektets AI-kreditsaldo. Workflow AI tæller også med i projektets daglige budget for autonome AI-tokens; når budgettet er opbrugt, tager komponenten sin **Error**-sti uden at kontakte modellen. Projekt-AI skal være aktiveret. På OneUptime Cloud skal abonnementet være betalt, og Growth-planen (eller en plan, der inkluderer Growth-funktioner) er påkrævet; selv-hostede installationer med fakturering slået fra har ikke denne plangrænse.

Indbyggede grænser holder ubemandede kald endelige: System Instructions, Prompt og serialiseret Context er begrænset til 50.000 tegn i alt; Temperature skal være fra `0` til `1`; Maximum Output Tokens skal være fra `1` til `4096` (standard `1024`); og udbyderens anmodning forsøges én gang og får timeout efter højst 60 sekunder. Højst tre workflow-AI-kald kører samtidigt per projekt; yderligere kald tager stien **Error** og kan forsøges igen af en senere arbejdsgangskørsel. Validerings-, konfigurations-, adgangs-, budget-, saldo-, samtidigheds-, udbyder- og timeoutfejl tager alle stien **Error** og udfylder output **Error**. Forbind den sti, før du aktiverer en produktionsarbejdsgang.

## Tilladelser

Arbejdsgange respekterer dit projekts rollebaserede adgangskontrol. De relevante tilladelser:

- **Create / Read / Edit / Delete Workflow** — de grundlæggende tilladelser på selve arbejdsgangen.
- **Run Workflow** — nødvendig for at køre en arbejdsgang manuelt eller udløse en via API.
- **Read Workflow Log** — nødvendig for at se kørsler.
- **Read / Create / Edit / Delete Workflow Variable** — kontrol over listen over globale variabler.

De fleste ingeniører bør have opret/redigér/læs på arbejdsgange, men ikke på variabler. Gem redigeringsadgang til variabler til dem, der administrerer dit projekts hemmeligheder.

## Plangrænser

OneUptime Cloud lægger et loft over antallet af kørsler per måned på mindre planer. Din nuværende grænse vises under **Project Settings → Billing**. Når du når den, afvises nye triggere indtil næste faktureringscyklus. Selv-hostede installationer har ikke denne grænse.

## Når arbejdsgange ikke er det rigtige værktøj

Nogle tilfælde, hvor du bør gribe til noget andet:

- **Tung beregning eller store datasæt** — arbejdsgange er designet til let sammenkoblingsarbejde, ikke talknusning. Kør tungt arbejde i din egen infrastruktur, og lad en arbejdsgang starte det.
- **Langvarig aktiv beregning** — et enkelt udførelsesforsøg er ment til at afslutte hurtigt. Til en passiv forsinkelse som "gør A, vent to timer, gør B", brug komponenten **Sleep**; den gemmer kørslen og genoptager den senere uden at optage en worker.
- **Trin-for-trin hændelsesrespons med mennesker involveret** — det er, hvad [Runbooks](/docs/runbooks/index) er til. Arbejdsgange er til ubemandet automatisering.

## Hvor du kan læse videre

- [Arbejdsgange – Oversigt](/docs/workflows/index) — det store billede.
- [Komponenter](/docs/workflows/components) — blok-for-blok-reference.
- [Runbooks](/docs/runbooks/index) — hvornår du skal bruge et runbook i stedet.
