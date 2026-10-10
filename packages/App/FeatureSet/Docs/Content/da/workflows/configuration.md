# Workflow-konfiguration & sikkerhed

Det skal du vide, før du retter et workflow mod rigtig trafik: hvordan du slår det sikkert til, hvem der må hvad, hvordan hemmeligheder og URL'er forbliver private, hvad et workflows trin må ændre, og de grænser, hver kørsel arbejder inden for.

:::cards
- [Gå live](#sådan-tænder-og-slukker-du-et-workflow): Test med Kør arbejdsgang, og lad så workflowet være slået til.
- [Tilladelser](#tilladelser): Workflow-rollerne og de enkelte tilladelser bag dem.
- [Hvad trin må](#hvad-workflow-trin-må-gøre): Trin handler som Project Admin i workflowets projekt.
- [Grænser](#plangrænser): Kørsler pr. plan, kørselstid og kald mellem workflows.
:::

## Sådan tænder og slukker du et workflow

Hvert workflow har en kontakt, **Aktiveret**, øverst i sin **Bygger** og på sin side **Oversigt**. Når den er slået fra, kører workflowet ikke — webhook-kald, indgående e-mail, planlagte tidspunkter og OneUptime-begivenheder ignoreres alle, og det samme gør **Kør arbejdsgang** og **Run just this step**. Nye workflows starter deaktiveret.

Brug kontakten som din «klar til brug»-port:

:::steps
1. Byg workflowet.
2. Klik på **Kør arbejdsgang** i **Bygger** med realistiske værdier. Et deaktiveret workflow kan ikke køre, heller ikke manuelt, så Bygger beder dig først slå det til: klik på **Slå til og kør**.
3. Åbn kørslen, og tjek, at hver blok gik derhen, du forventede. Se [Kørsler](/docs/workflows/runs-and-logs).
4. Lad **Aktiveret** være slået til, hvis det er klar. Er det ikke, så slå det fra, indtil det er: mens det er slået til, udløses dets trigger ved rigtige begivenheder.
:::

At slå et workflow fra forhindrer nye kørsler i at starte. En kørsel, der allerede er i gang, gør sig færdig, men en kørsel, der venter ved en **Sleep**-blok, annulleres, når den vågner.

## Arkivér et workflow

Arkivér et workflow, du ikke længere har brug for, men vil beholde. Et arkiveret workflow:

- **Kører aldrig**, fra nogen trigger. Manuelle kørsler og **Run just this step**, webhook-kald, tidsplaner, OneUptime-begivenheder, indgående e-mail og andre workflows' **Execute Workflow**-trin afvises alle. Et webhook-kald til et arkiveret workflow får en fejl, der siger, at workflowet er arkiveret.
- **Stopper kørsler, der venter.** En kørsel, der sover i et **Sleep**-trin, annulleres, når den vågner, og en kørsel, der stod i kø, men endnu ikke var startet, slutter med "Workflow was archived before this run started, so it did not run."
- **Forsvinder fra listen over workflows.** Find det under **Arbejdsgange → Avanceret → Arkiveret**.
- **Beholder alt.** Dets trin, variabler, ejere, etiketter og kørselshistorik forbliver, som de var.

For at arkivere ét workflow åbner du det, går til **Indstillinger** og klikker på **Arkiver**. For at arkivere flere markerer du dem i listen **Arbejdsgange** og vælger **Arkiver**.

For at hente et workflow tilbage åbner du **Arbejdsgange → Avanceret → Arkiveret**, markerer det og vælger **Fjern fra arkiv**, eller du åbner det og klikker på **Fjern fra arkiv** i banneret øverst på dets sider.

Arkivering og kontakten **Aktiveret** er to forskellige ting. Arkivering rører ikke kontakten, så et workflow, der var slået til, kører igen, så snart det fjernes fra arkivet, og et, der var slået fra, forbliver slået fra. Siden **Arkiveret** viser i sin kolonne **When Unarchived**, hvilket der er hvilket.

Et eksporteret workflow medbringer aldrig sin arkiverede tilstand, så en importeret kopi er aldrig arkiveret.

## Ejere og etiketter

| Hvad             | Hvor                                            | Hvad det gør                                                                                                                                              |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ejere**        | Workflowets side **Ejere**                      | De brugere og teams, der er ansvarlige for workflowet. En rolle, der er begrænset til det, dens team ejer, når de workflows, det team ejer.                |
| **Etiketter**    | Workflowets side **Oversigt**                   | Mærkater til at gruppere workflows efter team, integration eller miljø. Filtrer listen **Arbejdsgange** på etiket, og begræns en rolle til bestemte etiketter. |
| **Etiketregler** | **Arbejdsgange → Indstillinger → Etiketregler** | Sæt automatisk etiketter på nye workflows ud fra mønstre i deres navn eller beskrivelse.                                                                  |
| **Ejerregler**   | **Arbejdsgange → Indstillinger → Ejerregler**   | Tildel automatisk ejere til nye workflows.                                                                                                                |

Se [Etiket- og ejerregler](/docs/configuration/label-and-owner-rules) for, hvordan reglerne matcher.

## Hemmeligheder

Markér en variabel som **hemmelig**, hvis den indeholder noget følsomt: dens værdi renses så ud af kørslernes logge og trinspor. Ingen variabels værdi kan læses tilbage, når den er gemt, hemmelig eller ej, hverken i dashboardet eller via API'et, og når en variabel først er hemmelig, forbliver den hemmelig.

Brug hemmelige variabler til:

- API-nøgler til eksterne tjenester.
- Godkendelsestokens.
- Signeringsnøgler til webhooks.
- Alt, du ikke ville have, at en med kun læseadgang kunne se.

Indsæt ikke en hemmelighed direkte i en blok — værdier som `Authorization: Bearer eyJh...` ender synlige i workflowet og i loggene. Brug `{{global.variables.MY_SECRET}}` i stedet.

Er hemmeligheden et OAuth-adgangstoken, der udløber, så gør variablen til en [OAuth 2.0-variabel](/docs/workflows/variables#oauth-20-variabler-tokens-der-fornyer-sig-selv). OneUptime henter så tokenet fra din identitetsudbyder og fornyer det, hver gang et workflow er ved at bruge et udløbet token. OAuth 2.0-variabler er altid hemmelige, og deres loginoplysninger er krypteret i databasen.

## Eksport og import af workflows

Du kan flytte et workflow mellem projekter, eller mellem en selvhostet installation og OneUptime Cloud, som en JSON-fil.

:::tabs
@tab Eksport
Åbn workflowet, gå til **Indstillinger**, og klik på **Eksportér Arbejdsgang**. For at lægge flere workflows i én fil markerer du dem i listen **Arbejdsgange** og vælger **Eksportér JSON**.
@tab Import
Klik på **Import JSON** i listen **Arbejdsgange**, og vælg en fil, der er eksporteret fra et hvilket som helst OneUptime-projekt. Et workflow, hvis navn projektet allerede har, importeres med "(Imported)" efter sit navn.
:::

Filen indeholder workflowets navn, beskrivelse, aktiveringstilstand og graf. Den indeholder bevidst ikke:

- **Webhookens hemmelige nøgle.** Der genereres en ny, når workflowet oprettes, så et importeret workflow har en anden webhook-URL — kopiér den fra det nye workflows Webhook-trigger. Alt, der kaldte det oprindelige, skal peges om.
- **Adressen til indgående e-mail.** Et importeret workflow med en Incoming Email-trigger får sin egen adresse — kopiér den fra det nye workflows trigger. Alt, der sendte e-mail til det oprindelige, skal have den nye adresse.
- **Globale variabler.** En blok, der læser `{{global.variables.MY_SECRET}}`, beholder referencen, men værdien er ikke i filen. Opret variablerne i modtagerprojektet, før du kører det importerede workflow.
- **Ejere og etiketter.** Dit projekts egne etiket- og ejerregler kører mod det importerede workflow, præcis som hvis du havde oprettet det manuelt.

Et importeret workflow oprettes altid **deaktiveret**, også hvis det var aktiveret dér, hvor det blev eksporteret fra — dets graf kan pege på monitorer, vagtpolitikker eller andre workflows, der ikke findes i modtagerprojektet. Gennemgå det, aktivér det, test det med **Kør arbejdsgang**, og lad det så være slået til. Dublering af et workflow opfører sig på samme måde, så en kopi aldrig begynder at køre side om side med originalen, før du har redigeret den.

Fordi grafen rejser ordret med, følger alt, hvad der er skrevet direkte ind i en blok, også med. Det er den praktiske grund til at holde loginoplysninger i hemmelige variabler: eksporterer du et workflow med et hårdkodet token, giver du det token til den, der modtager filen.

## Webhook-sikkerhed

Webhook-triggere giver dig en unik URL. Alle, der kender URL'en, kan kalde den. Sådan beskytter du dig mod utilsigtede eller uønskede kaldere:

- Behandl URL'en som en adgangskode. Del den ikke offentligt, og commit den ikke til et offentligt repo. Webhook-triggeren skjuler URL'ens hemmelige nøgle, indtil du klikker på **Vis**, og **Kopiér URL** kopierer URL'en uden at vise den.
- Lækker URL'en, så klik på Webhook-triggeren i **Bygger**, og klik på **Nulstil URL**. Workflowet får en ny URL, og den gamle holder op med at virke med det samme.
- Siger triggeren, at dens URL ender på workflowets ID, så nulstil den. Workflows, der blev oprettet, før webhook-URL'er fik deres egen hemmelige nøgle, bruger i stedet workflowets ID, og det kan alle, der kan åbne workflowet, se.
- For følsomme workflows: bed det kaldende system sende et delt token som header (som `X-Webhook-Token`), og tjek det med en **If / Else**-blok, før der sker noget vigtigt. Gem det forventede token som en hemmelig variabel.
- For meget følsomme workflows: foretræk en OneUptime-begivenhedstrigger og et manuelt importtrin frem for en offentlig webhook.

Kun folk, der kan redigere workflowet — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller nulstille dets webhook-URL. Alle med URL'en kan starte workflowet hvorfra som helst uden at logge ind, så alle andre ser en note om, hvem de kan spørge i stedet. Det gælder også en **Workflow Member**, der kører workflowet manuelt fra **Bygger**.

## Sikkerhed for indgående e-mail

Incoming Email-triggeren giver workflowet sin egen adresse, og alle, der kender adressen, kan sende e-mail til den. Delen før `@` er workflowets hemmelige nøgle, så behandl adressen som en adgangskode:

- Offentliggør den ikke, og læg den ikke i et offentligt repo. Triggeren skjuler nøglen, indtil du klikker på **Vis**, og **Kopiér adresse** kopierer adressen uden at vise den.
- Lækker adressen, så klik på Incoming Email-triggeren i **Bygger**, og klik på **Nulstil adresse**. Workflowet får en ny adresse, og e-mail til den gamle ignoreres fra da af.
- Alle kan sætte en hvilken som helst afsender på en e-mail, så **From** beviser ikke, hvem der sendte den. Før et workflow gør noget vigtigt, så tjek noget, kun den rigtige afsender kender — et token i emnet eller i en header — med en **If / Else**-blok. Gem det forventede token som en hemmelig variabel.
- Nøglen skjules i alt, hvad kørslen modtager — **To**, **CC**, headerne og brødteksterne — fordi kørslens log er synlig for alle, der kan læse workflowets kørsler.

Kun folk, der kan redigere workflowet — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller nulstille dets adresse. Alle andre ser en note om, hvem de kan spørge.

## Udgående netværksadgang

API-blokke og andre HTTP-blokke sender deres forespørgsler fra OneUptime, og IRC-blokken forbinder fra OneUptime til IRC-serverens port. Hoster du selv, så sørg for, at din installation kan nå de tjenester, du kalder. Bruger du OneUptime Cloud, står vores udgående IP-intervaller i [IP-adresser](/docs/configuration/ip-addresses), så du kan tillade dem i den anden ende.

Hvilke adresser en blok må nå, afhænger af blokken:

| Blokke                                                        | Loopback, link-local, cloud-metadata                                         | Private netværksadresser                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**-blokke og forespørgsler fra **Run Custom JavaScript** | Afvises, medmindre den præcise vært står i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Afvises, medmindre en administrator af en selvhostet installation tillader dem med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** og OAuth 2.0-token-URL'er             | Afvises                                                                      | Afvises i OneUptime Cloud. Tilladt på en selvhostet installation, medmindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`                       |
| Slack, Microsoft Teams, Discord og Telegram                   | Afvises                                                                      | Afvises: hver sender kun til sin egen tjenestes adresser                                                                                          |

Se [Adgang til private netværk](/docs/self-hosted/private-network-access) for, hvordan en administrator af en selvhostet installation åbner for dem.

## AI-komponenter

**Generate Text with AI** sender én forespørgsel til en LLM: projektets standard-LLM-udbyder, eller installationens globale udbyder, når projektet ikke har nogen. Opsæt udbydere under **Projektindstillinger → AI → LLM-udbydere**, og læg aldrig en udbyders API-nøgle eller et endpoint af dit eget i et workflow.

Hvad udbyderen modtager, og hvad modellen kan gøre med det:

- **Kun det, du lægger i blokken.** OneUptime sender en fast sikkerhedsinstruktion og derefter blokkens **System Instructions**, **Prompt** og **Context** med deres referencer udfyldt. **Context** kommer sidst, efter en markør, og sikkerhedsinstruktionen fortæller modellen, at alt efter markøren er data, der ikke er til at stole på, også tekst, der ligner instruktioner.
- **Intet andet.** Triggerens data, workflowets historik, andre blokkes output, projektposter, telemetri og hemmeligheder vedhæftes aldrig. De forlader kun OneUptime, når du henviser til dem i en af de tre indstillinger.
- **Tekst og ingen værktøjer.** Modellen kan ikke forespørge OneUptime, foretage HTTP-forespørgsler eller ændre data. En udbyders ekstra parametre lader kun en tilladelsesliste af felter igennem, der alene justerer genereringen: de kan ikke erstatte beskederne, tilføje værktøjer, websøgning eller andre datakilder, bede om andet end tekst eller om flere svar, streame, lade udbyderen gemme forespørgslen eller hæve blokkens grænse for output. Felter, OneUptime ikke kender, droppes.
- **Modellen er din administrators valg.** Skal genereringen forblive offline, så vælg en model, der ikke selv henter noget på udbyderens side.

Hvad der logges:

- Kørslens log skjuler blokkens **System Instructions**, **Prompt**, **Context** og **Response**. Senere blokke kan stadig bruge dem under kørslen, og en blok, du indsætter en af dem i, logger den efter sine egne regler, så at indsætte en er et valg om at vise den.
- Udbyderen, modellen, antallet af tokens, **LLM Log ID** og en sikker fejlbesked forbliver synlige, til drift og fakturering. En udbyders rå fejl holdes ude af alle logge, fordi en udbyder kan gentage forespørgslen i den.
- Hvert kald står under **Projektindstillinger → AI → AI-logs** med udbyder, model, status, tokens, omkostning og fakturering, uden prompten, svaret eller den rå fejl.

Hvad blokken kræver, og hvad den koster:

- **Aktivér AI** skal være slået til under **Projektindstillinger → AI → AI Features**. I OneUptime Cloud skal projektet også have Growth-planen eller højere og et betalt abonnement. Selvhostede installationer uden fakturering har ingen plankrav.
- Kald gennem en global udbyder med omkostninger bruger projektets AI-kreditter.
- Hvert kald tæller med i [projektets egne daglige AI-grænser](/docs/ai/ai-sre#the-projects-own-daily-limits), når en projektejer sætter dem. Når en grænse er nået, tager blokken **Error** uden at kontakte modellen, indtil midnat UTC.

| Grænse                                                        | Værdi                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **System Instructions**, **Prompt** og **Context** tilsammen  | 50.000 tegn                                                              |
| **Temperature**                                               | Fra `0` til `1`                                                          |
| **Maximum Output Tokens**                                     | Fra `1` til `4096`, `1024` som standard                                  |
| Én forespørgsel                                               | Forsøges én gang, i højst 60 sekunder                                    |
| Kald på samme tid                                             | 3 pr. projekt. Flere tager **Error**, og en senere kørsel kan prøve igen. |

Fejl i validering, konfiguration, adgang, grænser, kredit, samtidighed, udbyder og timeout tager alle stien **Error**, med årsagen i **Error**. Forbind den sti, før workflowet går live.

> [!WARNING]
> Hver værdi, du henviser til, er data, du sender til udbyderen. Læg ikke en hemmelig variabel i prompten eller konteksten, medmindre udbyderen er godkendt til at modtage den. En selvhostet lokal udbyder som Ollama holder forespørgsler inde i din egen infrastruktur; en hostet udbyder modtager dem under sine egne vilkår for databehandling.

## Tilladelser

Workflows respekterer dit projekts rollebaserede adgangskontrol. De tre workflow-roller:

- **Workflow Admin** — bygger workflows: opretter, ændrer, kører og sletter dem og administrerer de variabler, de bruger.
- **Workflow Member** — bruger dem: åbner workflows og deres kørsler og kører et workflow manuelt med **Kør arbejdsgang**. Et medlem kan ikke oprette, ændre eller slette et workflow eller køre et af dets trin for sig selv.
- **Workflow Viewer** — læser workflows og deres kørsler.

**Project Owner** og **Project Admin** kan alt, hvad en Workflow Admin kan. **Project Member** kan oprette og slette workflows, men ikke ændre eller køre dem.

De enkelte tilladelser, til et team eller en API-nøgle, der har brug for præcis én ting:

- **Create / Read / Edit / Delete Workflow** — de grundlæggende tilladelser på selve workflowet. At ændre et workflow, herunder at slå det til eller fra og arkivere det, kræver **Edit Workflow**; **Delete Workflow** sletter kun.
- **Edit Workflow** — er også det, der skal til for at køre ét trin for sig selv med **Run just this step** og for at se eller nulstille et workflows webhook-URL og adresse til indgående e-mail. At køre et helt workflow manuelt kræver **Edit Workflow**, **Workflow Admin** eller **Workflow Member**.
- **Read Workflow Log** — nødvendig for at se kørsler.
- **Create / Read / Edit / Delete Workflow Variables** — administration af globale variabler og workflowvariabler.

En manuel kørsel når kun de workflows, du kan åbne: en rolle, der er begrænset til bestemte etiketter eller til de workflows, dit team ejer, kører kun dem. Den, der ikke kan køre et workflow, ser **Kør arbejdsgang** nedtonet med årsagen i værktøjstippet.

Giv dem, der bygger automatisering, **Workflow Admin**, og dem, der kun starter den, **Workflow Member**. Gem redigeringsadgangen til variabler til de folk, der administrerer projektets hemmeligheder. Se [Brugere, teams og tilladelser](/docs/permissions/index) for, hvordan roller tildeles.

## Hvad workflow-trin må gøre

De trin, der læser og ændrer OneUptime-poster — komponenterne Find, Create, Update og Delete og triggerne On Create, On Update og On Delete — handler som en **Project Admin** i workflowets projekt. Uanset hvem der byggede workflowet, møder et trin de samme kontroller, som en Project Admin møder i dashboardet og API'et:

- **Kun workflowets eget projekt.** Et trin læser og skriver posterne i det projekt, workflowet hører til, og intet andet, og en Update flytter aldrig en post til et andet projekt.
- **Kun det, en Project Admin må.** Et trin kan kun tildele de team- og API-nøgletilladelser, som en Project Admin selv har, så det kan ikke uddele **Project Owner**-, fakturerings- eller projektsletningstilladelser, og det kan ikke tilføje nogen til et team, hvis tilladelser går ud over en Project Admins, såsom ejernes team. Et trin kan ikke læse, hvem der oprettede en probe eller en AI-agent, hvilket kun projektejere ser.
- **Ikke læsning af runbook-loginoplysninger.** En Project Admin må læse runbook-loginoplysninger, men det lånes ikke ud til et trin. Hvor en ændring kræver den læsning — at lade OneUptime AI køre sine kommandoer uden at spørge, at slå **Kører AI-afhjælpningskommandoer** til for en Runner, at tildele en SSH-loginoplysning til en Runner, der kører OneUptime AI's kommandoer, eller at navngive en runbook-loginoplysning, som i et runbooks trin —, spørges der i stedet om den person, der sidst gemte workflowets trin, og trinnet afvises, medmindre vedkommende må læse runbook-loginoplysninger (**Read Runbook Credential**, eller en Project Owner eller Project Admin). OneUptime registrerer den person, når nogen opretter workflowet, og hver gang nogen gemmer dets trin; at omdøbe workflowet, ændre dets etiketter eller slå det til eller fra bevarer, hvem der sidst gemte dets trin. Gemmes dets trin med en API-nøgle, registreres ingen, så workflowets trin kan ikke foretage disse ændringer, før en person gemmer dem.
- **Kun det, jeres plan indeholder.** I OneUptime Cloud afvises et trin, der opretter eller ændrer noget, jeres plan ikke indeholder, med den plan, det kræver, præcis som dashboardet gør. Selvhostede installationer uden fakturering har ingen plangrænser.
- **Intet af det, OneUptime holder for sig selv.** Dette afvises for alle, workflows inklusive:
  - at redigere eller slette en feed-post (feeds for hændelser, advarsler, episoder, monitorer, vagtpolitikker og planlagt vedligeholdelse);
  - at skrive en notifikationslog (logge for sms, opkald, e-mail, WhatsApp, Telegram, push, webhooks og workspace-beskeder);
  - værdier, OneUptime sætter, efterhånden som tingene sker: om et brugerdefineret domænes CNAME er bekræftet, et teams beskyttelseskontakter (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), hvilken hændelsesrolle der er den primære, og om den kan slettes, om en ejer eller et medlem har fået besked, påmindelsestidspunkter og -antal, hvem der har vagt på et skema nu og som den næste, en vagtkørsels fremskridt, en SLO's aktuelle burn rate og error budget, en monitor sat på pause af en hændelse eller en vedligeholdelse, en privat statussidebrugers token til nulstilling af adgangskode og seneste login, de fakta, en tjeneste rapporterer om sig selv (version, runtime, cloud), og en detektionsregels eller et trusselsfeeds seneste kørsel;
  - at erklære en hændelse ud fra en skabelon ved at sende `createdIncidentTemplateId` til **Create One Incident** — vælg i stedet skabelonen under trinnets indstilling **Incident Template**: trinnet erklærer så hændelsen ud fra den, som Project Admin, og registrerer skabelonen;
  - at ændre, hvilken post en post hører til, efter at den er oprettet, som den monitor, en ejerrække gælder for, eller den hændelse, en note står på.
- **Som ingen person.** En post, et workflow opretter, har ingen opretter, og revisionsloggen angiver workflowet, med dets navn på det tidspunkt, som den, der foretog ændringen.

Når en kontrol afviser et trin, tager trinnet sit **Error**-output uden at foretage den afviste ændring, og kørslens log nævner trinnet og årsagen i klare ord, for eksempel *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Læs den under workflowets [Kørsler](/docs/workflows/runs-and-logs). Et Create Many-trin opretter sine poster én ad gangen og stopper ved den første, der afvises: de poster, det oprettede før den, bevares.

Trin, der taler med andre systemer — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code og Generate Text with AI — læser eller ændrer ikke OneUptime-poster, så intet af dette ændrer noget for dem.

## Plangrænser

I OneUptime Cloud kræver workflows Growth-planen eller højere, og hver plan tillader et antal kørsler inden for 30 dage:

| Plan       | Kørsler de seneste 30 dage |
| ---------- | -------------------------- |
| Growth     | 500                        |
| Scale      | 2.000                      |
| Enterprise | Ingen praktisk grænse      |

Vinduet glider: hver kørsel, projektet registrerer, manuelt eller fra en trigger, tæller med i 30 dage. På Growth- og Scale-planerne viser siden **Arbejdsgange** et kort, **Arbejdsgangskørsler**, med hvor mange projektet har brugt. Når grænsen er nået, registreres nye kørsler med status **Execution Exceeded Current Plan** og udføres ikke, og det samme sker, mens abonnementet er ubetalt. Selvhostede installationer uden fakturering har ingen grænse.

## Hvor længe en kørsel må tage

| Grænse                                                           | Standard      | Indstilling ved selvhosting     |
| ---------------------------------------------------------------- | ------------- | ------------------------------- |
| En kørsel, fra dens start eller fra den vågner efter en **Sleep** | 2 minutter    | `WORKFLOW_TIMEOUT_IN_MS`        |
| En **Run Custom JavaScript**-blok                                | 5 sekunder    | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| En **Sleep**-blok                                                | Højst 30 dage | —                               |

Afvikleren tjekker deadlinen før og efter hver blok og markerer en kørsel, der er over tiden, som **Timeout**, så snart kontrollen vender tilbage. Den kan ikke afbryde en blok midtvejs, så blokke, der venter på netværket, har deres egne tidsgrænser: en forespørgsel fra Generate Text with AI giver op efter højst 60 sekunder og en OAuth 2.0-tokenforespørgsel efter 20. Ventetid ved en **Sleep**-blok tæller ikke med i en kørsels tid: kørslen lægges til side og får friske 2 minutter, når den vågner.

## Grænse for at kalde andre workflows

Komponenten **Execute Workflow** lader ét workflow starte et andet. For at forhindre løkker, hvor workflow A starter B, som starter A igen, afvises en kæde af workflows, der starter hinanden, når den ville løbe tilbage til et workflow, der allerede er i den, eller gå dybere end 10 workflows. Blokken **Execute Workflow** tager så sit **Error**-output, og fejlen viser kæden.

Har du et reelt behov for en lang kæde (som et job, der behandler ét element pr. kørsel), er det som regel enklere at løkke inde i ét enkelt workflow med **Run Custom JavaScript**.

## Når workflows ikke er det rigtige værktøj

Et par tilfælde, hvor du bør gribe efter noget andet:

- **Tunge beregninger eller store datasæt** — workflows er lavet til let limarbejde, ikke til talknuseri. Kør det tunge arbejde i din egen infrastruktur, og lad et workflow sætte det i gang.
- **Langvarig aktiv beregning** — en kørsel har 2 minutter som standard. Til en passiv pause som «gør A, vent to timer, gør B» bruger du komponenten **Sleep**; den lægger kørslen til side og genoptager den senere uden at optage en worker.
- **Trin-for-trin-hændelseshåndtering med mennesker involveret** — det er dét, [Runbooks](/docs/runbooks/index) er til. Workflows er til automatisering uden opsyn.

## Næste trin

:::cards
- [Workflows – Oversigt](/docs/workflows/index): Det store billede og et første workflow fra start til slut.
- [Komponenter](/docs/workflows/components): Hvad hver blok kræver, returnerer og må nå.
- [Runbooks](/docs/runbooks/index): Når folk skal træffe beslutningerne undervejs.
:::
