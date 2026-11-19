# Arbejdsgangskonfiguration & sikkerhed

Det skal du vide, før du retter en arbejdsgang mod rigtig trafik: hvordan du slår det sikkert til, hvem der må hvad, hvordan hemmeligheder og URL'er forbliver private, hvad en arbejdsgangs trin må ændre, og de grænser, hver kørsel arbejder inden for.

:::cards
- [Gå live](#sådan-tænder-og-slukker-du-en-arbejdsgang): Test med Kør arbejdsgang, mens den er slået fra, og slå den så til.
- [Tilladelser](#tilladelser): Arbejdsgangsrollerne og de enkelte tilladelser bag dem.
- [Hvad trin må](#hvad-arbejdsgangstrin-må-gøre): Trin handler som Projektadministrator i arbejdsgangens projekt.
- [Grænser](#plangrænser): Kørsler pr. plan, kørselstid og kald mellem arbejdsgange.
:::

## Sådan tænder og slukker du en arbejdsgang

Hver arbejdsgang har en kontakt, **Aktiveret**, øverst i sin **Bygger** og på sin side **Oversigt**. Når den er slået fra, er dens trigger sat på pause — webhook-kald, indgående e-mail, planlagte tidspunkter, OneUptime-begivenheder og andre arbejdsganges **Kør en anden arbejdsgang**-trin starter den ikke. **Kør arbejdsgang** og **Run just this step** gør: en kørsel, du selv starter, mens arbejdsgangen er slået fra, er en **Testkørsel**. Nye arbejdsgange starter deaktiveret.

Brug kontakten som din «klar til brug»-port:

:::steps
1. Byg arbejdsgangen.
2. Klik på **Kør arbejdsgang** i **Bygger** med realistiske værdier, mens arbejdsgangen stadig er slået fra. Kørslen er en **Testkørsel**: hver blok kører for alvor, så peg den først mod en testkanal eller en testpost.
3. Åbn kørslen, og tjek, at hver blok gik derhen, du forventede. Se [Kørsler](/docs/workflows/runs-and-logs).
4. Slå **Aktiveret** til, når den er klar: fra da af udløses dens trigger ved rigtige begivenheder.
:::

At slå en arbejdsgang fra forhindrer dens trigger i at starte nye kørsler. En kørsel, der allerede er i gang, gør sig færdig, men en kørsel, som dens trigger startede, og som venter ved en **Pause**-blok, annulleres, når den vågner. Testkørsler fortsætter. For at slå flere til eller fra på én gang markerer du dem i listen **Arbejdsgange** og vælger **Aktivér** eller **Deaktivér** under **Massehandlinger**.

## Arkiver en arbejdsgang

Arkiver en arbejdsgang, du ikke længere har brug for, men vil beholde. En arkiveret arbejdsgang:

- **Kører aldrig**, fra nogen trigger. Manuelle kørsler og **Run just this step**, webhook-kald, tidsplaner, OneUptime-begivenheder, indgående e-mail og andre arbejdsgange' **Kør en anden arbejdsgang**-trin afvises alle. Et webhook-kald til en arkiveret arbejdsgang får en fejl, der siger, at arbejdsgangen er arkiveret.
- **Stopper kørsler, der venter.** En kørsel, der sover i et **Pause**-trin, annulleres, når den vågner, og en kørsel, der stod i kø, men endnu ikke var startet, slutter med "Workflow was archived before this run started, so it did not run."
- **Forsvinder fra listen over arbejdsgange.** Find den under **Arbejdsgange → Avanceret → Arkiveret**.
- **Beholder alt.** Dens trin, variabler, ejere, etiketter og kørselshistorik forbliver, som de var.

For at arkivere én arbejdsgang åbner du den, går til **Indstillinger** og klikker på **Arkiver**. For at arkivere flere markerer du dem i listen **Arbejdsgange** og vælger **Arkiver**.

For at hente en arbejdsgang tilbage åbner du **Arbejdsgange → Avanceret → Arkiveret**, markerer den og vælger **Fjern fra arkivet**, eller du åbner den og klikker på **Fjern fra arkivet** i banneret øverst på dens sider.

Arkivering og kontakten **Aktiveret** er to forskellige ting. Arkivering rører ikke kontakten, så en arbejdsgang, der var slået til, kører igen, så snart den fjernes fra arkivet, og en, der var slået fra, forbliver slået fra. Siden **Arkiveret** viser i sin kolonne **Når den fjernes fra arkivet**, hvilket der er hvilket.

En eksporteret arbejdsgang medbringer aldrig sin arkiverede tilstand, så en importeret kopi er aldrig arkiveret.

## Ejere og etiketter

| Hvad             | Hvor                                            | Hvad det gør                                                                                                                                              |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ejere**        | Arbejdsgangens side **Ejere**                      | De brugere og teams, der er ansvarlige for arbejdsgangen. En rolle, der er begrænset til det, dens team ejer, når de arbejdsgange, det team ejer.                |
| **Etiketter**    | Arbejdsgangens side **Oversigt**                   | Mærkater til at gruppere arbejdsgange efter team, integration eller miljø. Filtrer listen **Arbejdsgange** på etiket, og begræns en rolle til bestemte etiketter. |
| **Etiketregler** | **Arbejdsgange → Indstillinger → Etiketregler** | Sæt automatisk etiketter på nye arbejdsgange ud fra mønstre i deres navn eller beskrivelse.                                                                  |
| **Ejerregler**   | **Arbejdsgange → Indstillinger → Ejerregler**   | Tildel automatisk ejere til nye arbejdsgange.                                                                                                                |

Se [Etiket- og ejerregler](/docs/configuration/label-and-owner-rules) for, hvordan reglerne matcher.

## Hemmeligheder

Markér en variabel som **hemmelig**, hvis den indeholder noget følsomt: dens værdi renses så ud af kørslernes logge og trinspor. Ingen variabels værdi kan læses tilbage, når den er gemt, hemmelig eller ej, hverken i dashboardet eller via API'et, og når en variabel først er hemmelig, forbliver den hemmelig.

Brug hemmelige variabler til:

- API-nøgler til eksterne tjenester.
- Godkendelsestokens.
- Signeringsnøgler til webhooks.
- Alt, du ikke ville have, at en med kun læseadgang kunne se.

Indsæt ikke en hemmelighed direkte i en blok — værdier som `Authorization: Bearer eyJh...` ender synlige i arbejdsgangen og i loggene. Brug `{{global.variables.MY_SECRET}}` i stedet.

Er hemmeligheden et OAuth-adgangstoken, der udløber, så gør variablen til en [OAuth 2.0-variabel](/docs/workflows/variables#oauth-20-variabler-tokens-der-fornyer-sig-selv). OneUptime henter så tokenet fra din identitetsudbyder og fornyer det, hver gang en arbejdsgang er ved at bruge et udløbet token. OAuth 2.0-variabler er altid hemmelige, og deres loginoplysninger er krypteret i databasen.

## Eksport og import af arbejdsgange

Du kan flytte en arbejdsgang mellem projekter, eller mellem en selvhostet installation og OneUptime Cloud, som en JSON-fil.

:::tabs
@tab Eksport
Åbn arbejdsgangen, gå til **Indstillinger**, og klik på **Eksportér Arbejdsgang**. For at lægge flere arbejdsgange i én fil markerer du dem i listen **Arbejdsgange** og vælger **Eksportér JSON**.
@tab Import
Klik på **Importér JSON** i listen **Arbejdsgange**, og vælg en fil, der er eksporteret fra et hvilket som helst OneUptime-projekt. En arbejdsgang, hvis navn projektet allerede har, importeres med "(Imported)" efter sit navn.
:::

Filen indeholder arbejdsgangens navn, beskrivelse, aktiveringstilstand og graf. Den indeholder bevidst ikke:

- **Webhookens hemmelige nøgle.** Der genereres en ny, når arbejdsgangen oprettes, så en importeret arbejdsgang har en anden webhook-URL — kopiér den fra den nye arbejdsgangs Webhook-trigger. Alt, der kaldte den oprindelige, skal peges om.
- **Adressen til indgående e-mail.** En importeret arbejdsgang med en Indgående e-mail-trigger får sin egen adresse — kopiér den fra den nye arbejdsgangs trigger. Alt, der sendte e-mail til den oprindelige, skal have den nye adresse.
- **Globale variabler.** En blok, der læser `{{global.variables.MY_SECRET}}`, beholder referencen, men værdien er ikke i filen. Opret variablerne i modtagerprojektet, før du kører den importerede arbejdsgang.
- **Ejere og etiketter.** Dit projekts egne etiket- og ejerregler kører mod den importerede arbejdsgang, præcis som hvis du havde oprettet den manuelt.

En importeret arbejdsgang oprettes altid **deaktiveret**, også hvis den var aktiveret dér, hvor den blev eksporteret fra — dens graf kan pege på monitorer, vagtpolitikker eller andre arbejdsgange, der ikke findes i modtagerprojektet. Gennemgå den, test den med **Kør arbejdsgang**, og slå den så til. Dublering af en arbejdsgang opfører sig på samme måde, så en kopi aldrig begynder at køre side om side med originalen, før du har redigeret den.

Fordi grafen rejser ordret med, følger alt, hvad der er skrevet direkte ind i en blok, også med. Det er den praktiske grund til at holde loginoplysninger i hemmelige variabler: eksporterer du en arbejdsgang med et hårdkodet token, giver du det token til den, der modtager filen.

## Webhook-sikkerhed

Webhook-triggere giver dig en unik URL. Alle, der kender URL'en, kan kalde den. Sådan beskytter du dig mod utilsigtede eller uønskede kaldere:

- Behandl URL'en som en adgangskode. Del den ikke offentligt, og commit den ikke til et offentligt repo. Webhook-triggeren skjuler URL'ens hemmelige nøgle, indtil du klikker på **Vis**, og **Kopiér URL** kopierer URL'en uden at vise den.
- Lækker URL'en, så klik på Webhook-triggeren i **Bygger**, og klik på **Nulstil URL**. Arbejdsgangen får en ny URL, og den gamle holder op med at virke med det samme.
- Siger triggeren, at dens URL ender på arbejdsgangens ID, så nulstil den. Arbejdsgange, der blev oprettet, før webhook-URL'er fik deres egen hemmelige nøgle, bruger i stedet arbejdsgangens ID, og det kan alle, der kan åbne arbejdsgangen, se.
- For følsomme arbejdsgange: bed det kaldende system sende et delt token som header (som `X-Webhook-Token`), og tjek det med en **Hvis / Ellers**-blok, før der sker noget vigtigt. Gem det forventede token som en hemmelig variabel.
- For meget følsomme arbejdsgange: foretræk en OneUptime-begivenhedstrigger og et manuelt importtrin frem for en offentlig webhook.

Kun folk, der kan redigere arbejdsgangen — **Projektejer**, **Projektadministrator**, **Arbejdsgangsadministrator** eller **Edit Workflow** — kan se eller nulstille dens webhook-URL. Alle med URL'en kan starte arbejdsgangen hvorfra som helst uden at logge ind, så alle andre ser en note om, hvem de kan spørge i stedet. Det gælder også en **Arbejdsgangsmedlem**, der kører arbejdsgangen manuelt fra **Bygger**.

## Sikkerhed for indgående e-mail

Indgående e-mail-triggeren giver arbejdsgangen sin egen adresse, og alle, der kender adressen, kan sende e-mail til den. Delen før `@` er arbejdsgangens hemmelige nøgle, så behandl adressen som en adgangskode:

- Offentliggør den ikke, og læg den ikke i et offentligt repo. Triggeren skjuler nøglen, indtil du klikker på **Vis**, og **Kopiér adresse** kopierer adressen uden at vise den.
- Lækker adressen, så klik på Indgående e-mail-triggeren i **Bygger**, og klik på **Nulstil adresse**. Arbejdsgangen får en ny adresse, og e-mail til den gamle ignoreres fra da af.
- Alle kan sætte en hvilken som helst afsender på en e-mail, så **Fra** beviser ikke, hvem der sendte den. Før en arbejdsgang gør noget vigtigt, så tjek noget, kun den rigtige afsender kender — et token i emnet eller i en header — med en **Hvis / Ellers**-blok. Gem det forventede token som en hemmelig variabel.
- Nøglen skjules i alt, hvad kørslen modtager — **Til**, **CC**, headerne og brødteksterne — fordi kørslens log er synlig for alle, der kan læse arbejdsgangens kørsler.

Kun folk, der kan redigere arbejdsgangen — **Projektejer**, **Projektadministrator**, **Arbejdsgangsadministrator** eller **Edit Workflow** — kan se eller nulstille dens adresse. Alle andre ser en note om, hvem de kan spørge.

## Udgående netværksadgang

API-blokke og andre HTTP-blokke sender deres forespørgsler fra OneUptime, og IRC-blokken forbinder fra OneUptime til IRC-serverens port. Hoster du selv, så sørg for, at din installation kan nå de tjenester, du kalder. Bruger du OneUptime Cloud, står vores udgående IP-intervaller i [IP-adresser](/docs/configuration/ip-addresses), så du kan tillade dem i den anden ende.

Hvilke adresser en blok må nå, afhænger af blokken:

| Blokke                                                        | Loopback, link-local, cloud-metadata                                         | Private netværksadresser                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**- og **Mattermost**-blokke samt forespørgsler fra **Kør egen JavaScript** | Afvises, medmindre den præcise vært står i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Afvises, medmindre en administrator af en selvhostet installation tillader dem med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send e-mail**, **IRC** og OAuth 2.0-token-URL'er             | Afvises                                                                      | Afvises i OneUptime Cloud. Tilladt på en selvhostet installation, medmindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`                       |
| Slack, Microsoft Teams, Discord og Telegram                   | Afvises                                                                      | Afvises: hver sender kun til sin egen tjenestes adresser                                                                                          |

Se [Adgang til private netværk](/docs/self-hosted/private-network-access) for, hvordan en administrator af en selvhostet installation åbner for dem.

## AI-komponenter

**Generér tekst med AI** sender én forespørgsel til en LLM: projektets standard-LLM-udbyder, eller installationens globale udbyder, når projektet ikke har nogen. Opsæt udbydere under **Projektindstillinger → AI → LLM-udbydere**, og læg aldrig en udbyders API-nøgle eller et endpoint af dit eget i en arbejdsgang.

Hvad udbyderen modtager, og hvad modellen kan gøre med det:

- **Kun det, du lægger i blokken.** OneUptime sender en fast sikkerhedsinstruktion og derefter blokkens **Systeminstruktioner**, **Prompt** og **Kontekst** med deres referencer udfyldt. **Kontekst** kommer sidst, efter en markør, og sikkerhedsinstruktionen fortæller modellen, at alt efter markøren er data, der ikke er til at stole på, også tekst, der ligner instruktioner.
- **Intet andet.** Triggerens data, arbejdsgangens historik, andre blokkes output, projektposter, telemetri og hemmeligheder vedhæftes aldrig. De forlader kun OneUptime, når du henviser til dem i en af de tre indstillinger.
- **Tekst og ingen værktøjer.** Modellen kan ikke forespørge OneUptime, foretage HTTP-forespørgsler eller ændre data. En udbyders ekstra parametre lader kun en tilladelsesliste af felter igennem, der alene justerer genereringen: de kan ikke erstatte beskederne, tilføje værktøjer, websøgning eller andre datakilder, bede om andet end tekst eller om flere svar, streame, lade udbyderen gemme forespørgslen eller hæve blokkens grænse for output. Felter, OneUptime ikke kender, droppes.
- **Modellen er din administrators valg.** Skal genereringen forblive offline, så vælg en model, der ikke selv henter noget på udbyderens side.

Hvad der logges:

- Kørslens log skjuler blokkens **Systeminstruktioner**, **Prompt**, **Kontekst** og **Svar**. Senere blokke kan stadig bruge dem under kørslen, og en blok, du indsætter en af dem i, logger den efter sine egne regler, så at indsætte en er et valg om at vise den.
- Udbyderen, modellen, antallet af tokens, **LLM-log-ID** og en sikker fejlbesked forbliver synlige, til drift og fakturering. En udbyders rå fejl holdes ude af alle logge, fordi en udbyder kan gentage forespørgslen i den.
- Hvert kald står under **Projektindstillinger → AI → AI-logs** med udbyder, model, status, tokens, omkostning og fakturering, uden prompten, svaret eller den rå fejl.

Hvad blokken kræver, og hvad den koster:

- **Aktivér AI** skal være slået til under **Projektindstillinger → AI → AI-funktioner**. I OneUptime Cloud skal projektet også have Growth-planen eller højere og et betalt abonnement. Selvhostede installationer uden fakturering har ingen plankrav.
- Kald gennem en global udbyder med omkostninger bruger projektets AI-kreditter.
- Hvert kald tæller med i [projektets egne daglige AI-grænser](/docs/ai/ai-sre#projektets-egne-daglige-grænser), når en Projektejer sætter dem. Når en grænse er nået, tager blokken **Fejl** uden at kontakte modellen, indtil midnat UTC.

| Grænse                                                        | Værdi                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Systeminstruktioner**, **Prompt** og **Kontekst** tilsammen  | 50.000 tegn                                                              |
| **Temperatur**                                               | Fra `0` til `1`                                                          |
| **Maksimalt antal output-tokens**                                     | Fra `1` til `4096`, `1024` som standard                                  |
| Én forespørgsel                                               | Forsøges én gang, i højst 60 sekunder                                    |
| Kald på samme tid                                             | 3 pr. projekt. Flere tager **Fejl**, og en senere kørsel kan prøve igen. |

Fejl i validering, konfiguration, adgang, grænser, kredit, samtidighed, udbyder og timeout tager alle stien **Fejl**, med årsagen i **Fejl**. Forbind den sti, før arbejdsgangen går live.

> [!WARNING]
> Hver værdi, du henviser til, er data, du sender til udbyderen. Læg ikke en hemmelig variabel i prompten eller konteksten, medmindre udbyderen er godkendt til at modtage den. En selvhostet lokal udbyder som Ollama holder forespørgsler inde i din egen infrastruktur; en hostet udbyder modtager dem under sine egne vilkår for databehandling.

## Tilladelser

Arbejdsgange respekterer dit projekts rollebaserede adgangskontrol. De tre arbejdsgangsroller:

- **Arbejdsgangsadministrator** — bygger arbejdsgange: opretter, ændrer, kører og sletter dem og administrerer de variabler, de bruger.
- **Arbejdsgangsmedlem** — bruger dem: åbner arbejdsgange og deres kørsler og kører en arbejdsgang manuelt med **Kør arbejdsgang**. Et medlem kan ikke oprette, ændre eller slette en arbejdsgang eller køre et af dens trin for sig selv. **Bygger** viser dem en arbejdsgang, som den er, markeret **Kun visning**: Et trin åbner, så det kan læses, og intet af det, de gør der, gemmes.
- **Arbejdsgangsseer** — læser arbejdsgange og deres kørsler.

**Projektejer** og **Projektadministrator** kan alt, hvad en Arbejdsgangsadministrator kan. **Projektmedlem** kan oprette og slette arbejdsgange, men ikke ændre eller køre dem.

De enkelte tilladelser, til et team eller en API-nøgle, der har brug for præcis én ting:

- **Create / Read / Edit / Delete Workflow** — de grundlæggende tilladelser på selve arbejdsgangen. At ændre en arbejdsgang, herunder at slå den til eller fra og arkivere den, kræver **Edit Workflow**; **Delete Workflow** sletter kun.
- **Edit Workflow** — er også det, der skal til for at køre ét trin for sig selv med **Run just this step** og for at se eller nulstille en arbejdsgangs webhook-URL og adresse til indgående e-mail. At køre en helt arbejdsgang manuelt kræver **Edit Workflow**, **Arbejdsgangsadministrator** eller **Arbejdsgangsmedlem**.
- **Read Workflow Log** — nødvendig for at se kørsler.
- **Create / Read / Edit / Delete Workflow Variables** — administration af globale variabler og arbejdsgangsvariabler.

En manuel kørsel når kun de arbejdsgange, du kan åbne: en rolle, der er begrænset til bestemte etiketter eller til de arbejdsgange, dit team ejer, kører kun dem. Den, der ikke kan køre en arbejdsgang, ser **Kør arbejdsgang** nedtonet med årsagen i værktøjstippet.

En arbejdsgang, der kører som **Projektejer** eller som en brugerdefineret rolle, ændres og køres manuelt kun af personer, der selv har de tilladelser; alle andre kan kun se den i **Bygger**. Se [Run As](#run-as).

Giv dem, der bygger automatisering, **Arbejdsgangsadministrator**, og dem, der kun starter den, **Arbejdsgangsmedlem**. Gem redigeringsadgangen til variabler til de folk, der administrerer projektets hemmeligheder. Se [Brugere, teams og tilladelser](/docs/permissions/index) for, hvordan roller tildeles.

## Hvad arbejdsgangstrin må gøre

De trin, der læser og ændrer OneUptime-poster — komponenterne Find, Create, Update og Delete og triggerne On Create, On Update, On Create or Update og On Delete — handler som en **Projektadministrator** i arbejdsgangens projekt. Uanset hvem der byggede arbejdsgangen, møder et trin de samme kontroller, som en Projektadministrator møder i dashboardet og API'et:

- **Kun arbejdsgangens eget projekt.** Et trin læser og skriver posterne i det projekt, arbejdsgangen hører til, og intet andet, og en Update flytter aldrig en post til et andet projekt.
- **Kun det, en Project Admin må.** Et trin kan ikke gøre det, som kun **Projektejer** og tilladelser til fakturering eller sletning af projektet giver lov til, og det kan ikke læse, hvem der oprettede en sonde eller en AI-agent, hvilket kun Projektejere ser.
- **Ikke hvem der har adgang.** Med standardtilladelserne opretter, ændrer og sletter et trin ikke teams, teammedlemmer, teamtilladelser eller brugerdefinerede roller, selvom en Projektadministrator må. Den, der bygger en arbejdsgang, bestemmer, hvad dens trin gør, og det kan være en **Projektmedlem**, så et trin, der kunne, ville give den, der byggede det, adgang, vedkommende ikke har fået, som **Projektadministrator**. Trinnet afvises, og kørslens log nævner den tilladelse, ændringen kræver, og siger, at du skal vælge **Run As** i arbejdsgangens **Indstillinger**: en arbejdsgang, der kører som **Projektejer** eller som en brugerdefineret rolle med den tilladelse, må foretage ændringen (se [Run As](#run-as)). Intet trin i en arbejdsgang ændrer API-nøgler, single sign-on eller SCIM-indstillinger, uanset hvad arbejdsgangen kører som. Triggere og Find-trin på disse poster virker stadig.
- **Ikke læsning af indstillinger, der indeholder loginoplysninger.** En Projektadministrator må læse SMTP-servere, opkalds- og SMS-udbydere, SNMP-loginoplysninger, videoopkaldsforbindelser og API-nøgler, men det lånes aldrig ud til et trin, uanset hvem der byggede eller gemte arbejdsgangen. Et trin kan ikke angive en af disse indstillinger, som den SMTP-server, en statusside sender e-mail med, eller den API-nøgle, en tilladelse gives til. Trinnet afvises, og dets kørselslog siger, at en person, der må læse dem (læsetilladelsen til den slags indstilling, eller en Projektejer eller Projektadministrator), skal foretage ændringen. Et trin, der beholder den indstilling, en post allerede angiver, eller rydder den, afvises ikke.
- **Ikke private hændelser, advarsler og episoder.** En Projektadministrator ser enhver privat hændelse, advarsel og episode, men det lånes aldrig ud til et trin, uanset hvem der har bygget eller gemt arbejdsgangen. Et trin finder ingen private, ændrer ingen og føjer intet til en, og en arbejdsgang starter ikke på en eller på noget, der hører til en, hvad enten en hændelse på en post eller **Kør arbejdsgang** starter den. Den, der bygger en arbejdsgang, bestemmer, hvor det, trinene læser, sendes hen — en webhook, en e-mail, en chat, kørselsloggen — og det kan være en **Projektmedlem**, som ikke må se en privat post. Se [Private hændelser, advarsler og episoder](/docs/permissions/index#private-hændelser-advarsler-og-episoder).
- **Kun det, jeres plan indeholder.** I OneUptime Cloud afvises et trin, der opretter eller ændrer noget, jeres plan ikke indeholder, med den plan, det kræver, præcis som dashboardet gør. Selvhostede installationer uden fakturering har ingen plangrænser.
- **Intet af det, OneUptime holder for sig selv.** Dette afvises for alle, arbejdsgange inklusive:
  - at redigere eller slette en feed-post (feeds for hændelser, advarsler, episoder, monitorer, vagtpolitikker og planlagt vedligeholdelse);
  - at skrive en notifikationslog (logge for sms, opkald, e-mail, WhatsApp, Telegram, push, webhooks og workspace-beskeder);
  - værdier, OneUptime sætter, efterhånden som tingene sker: om et brugerdefineret domænes CNAME er bekræftet, et teams beskyttelseskontakter (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), hvilken hændelsesrolle der er den primære, og om den kan slettes, om en ejer eller et medlem har fået besked, påmindelsestidspunkter og -antal, hvem der har vagt på et skema nu og som den næste, en vagtkørsels fremskridt, en SLO's aktuelle burn rate og error budget, en monitor sat på pause af en hændelse eller en vedligeholdelseshændelse, en privat statussidebrugers token til nulstilling af adgangskode og seneste login, de fakta, en tjeneste rapporterer om sig selv (version, runtime, cloud), og en detektionsregels eller et trusselsfeeds seneste kørsel;
  - at erklære en hændelse ud fra en skabelon ved at sende `createdIncidentTemplateId` til **Opret Hændelse (én post)** — vælg i stedet skabelonen under trinnets indstilling **Hændelsesskabelon**: trinnet erklærer så hændelsen ud fra den, som Projektadministrator, og registrerer skabelonen;
  - at ændre, hvilken post en post hører til, efter at den er oprettet, som den monitor, en ejerrække gælder for, eller den hændelse, en note står på.
- **Som ingen person.** En post, en arbejdsgang opretter, har ingen opretter, og revisionsloggen angiver arbejdsgangen, med dens navn på det tidspunkt, som den, der foretog ændringen.

Når en kontrol afviser et trin, tager trinnet sit **Fejl**-output uden at foretage den afviste ændring, og kørslens log nævner trinnet og årsagen i klare ord, for eksempel *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Læs den under arbejdsgangens [Kørsler](/docs/workflows/runs-and-logs). Et Create Many-trin opretter sine poster én ad gangen og stopper ved den første, der afvises: de poster, det oprettede før den, bevares.

Trin, der taler med andre systemer — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code og Generate Text with AI — læser eller ændrer ikke OneUptime-poster, så intet af dette ændrer noget for dem.

### Run As

Som standard kører en arbejdsgang med tilladelserne ovenfor, og de fleste arbejdsgange har aldrig brug for mere. Når en har – for eksempel en arbejdsgang, der giver hvert nyt team en brugerdefineret rolle –, åbner du dens **Indstillinger**, derefter **Yderligere indstillinger**, og vælger **Change Run As**:

- Standard: tilladelserne ovenfor.
- Projektejer: det, en **Projektejer** må i dette projekt, herunder at ændre, hvem der er med i et team, og hvad et team må. Kun en Projektejer kan vælge det.
- En brugerdefineret rolle: præcis det, en af projektets brugerdefinerede roller tillader. Kun en, der kunne give et team den rolle, kan vælge den.

Uanset hvad arbejdsgangen kører som, læser et trin aldrig indstillinger, der indeholder loginoplysninger, ser aldrig private hændelser, advarsler eller episoder og ændrer aldrig API-nøgler, single sign-on eller SCIM-indstillinger. Når det giver et team en tilladelse eller en rolle, kan det kun give det, det selv har, og mangler det noget, nævner kørslens log tilladelsen.

En arbejdsgang, der kører med mere end standardtilladelserne, kører med tilladelserne fra den, der gav den dem: den person eller den API-nøgle i projektet, der sidst valgte dens **Run As** eller gemte dens trin eller variabler. Så ingen får mere gennem den, end de selv har:

- Kun personer, der har de tilladelser, kan ændre den eller dens variabler, arkivere eller slette den, køre den eller et af dens trin manuelt eller se dens webhook-URL og indgående e-mailadresse. Alle, der må redigere den, kan stadig slå den fra. Når den kommer til at køre med mere end standardtilladelserne, eller det ændres, hvad den kører som, får den en ny webhook-URL og en ny indgående e-mailadresse, så kopier af de gamle ikke længere starter den.
- En person eller en af projektets API-nøgler kan give dem, og kun det, de selv har: en nøgles tilladelser, dens brugerdefinerede roller medregnet, vejes som en persons. En arbejdsgangs trin og master-API-nøglen kan ikke give dem, og at nulstille en nøgle kræver alle de tilladelser, nøglen har.
- Hver kørsel tjekker først, at den, der gav dem, stadig har dem: en person, der stadig er i projektet, eller en nøgle, der stadig findes, ikke er udløbet og ikke har mistet dem. Hvis ikke, stopper kørslen før sit første trin, og dens log siger hvorfor, og hvem der kan give dem igen.
- Den læser ikke projektets globale variabler, som alle, der må redigere arbejdsgangsvariabler, kan ændre.
- En anden arbejdsgangs **Kør en anden arbejdsgang**-trin kan kun starte den, hvis den arbejdsgang kører med de samme tilladelser eller flere.

En eksporteret, importeret eller duplikeret arbejdsgang kører med standardtilladelserne, uanset hvad originalen kørte som: en, der har flere, vælger dens **Run As** igen.

Hver kørsel registrerer, hvad den kørte som, og med hvis tilladelser, vist i kørslens vindue og i en downloadet log. [Revisionsloggen](/docs/configuration/audit-logs) registrerer, hvem der ændrede en arbejdsgangs **Run As**, en person eller en API-nøgle ved navn, og hver ændring, et trin i en arbejdsgang foretager, siger, hvad trinnet kørte som, og med hvis tilladelser. Revisionsloggens filtre **Arbejdsgang kørt som** og **Arbejdsgangens tilladelser givet af** finder de ændringer.

At slette en brugerdefineret rolle, som arbejdsgange kører som, ville stoppe dem, så sletningen viser dem og spørger, hvad de skal køre som fremover: **Standardtilladelser** eller en anden brugerdefineret rolle, du kunne give et team. Den, der ikke kan redigere arbejdsgange, kan ikke slette rollen, før deres Run As er ændret. Via API'en afvises sletning af sådan en rolle, medmindre anmodningen siger, hvad de skal køre som i stedet: `miscDataProps` med `workflowsRunAs` sat til `Default` eller til `CustomRole` med rollens id i `workflowsRunAsCustomRoleId`. I Terraform sætter du `workflows_run_as_on_delete` på `oneuptime_custom_role` og `workflows_run_as_custom_role_id_on_delete` for en anden rolle og kører apply, før du sletter rollen. Rollens side viser de arbejdsgange, der kører som den, under **Arbejdsgange, der kører som denne rolle**.

## Plangrænser

I OneUptime Cloud kræver arbejdsgange Growth-planen eller højere, og hver plan tillader et antal kørsler inden for 30 dage:

| Plan       | Kørsler de seneste 30 dage |
| ---------- | -------------------------- |
| Growth     | 500                        |
| Scale      | 2.000                      |
| Enterprise | Ingen praktisk grænse      |

Vinduet glider: hver kørsel, projektet registrerer, manuelt eller fra en trigger, tæller med i 30 dage. På Growth- og Scale-planerne viser siden **Arbejdsgange** et kort, **Arbejdsgangskørsler**, med hvor mange projektet har brugt. Når grænsen er nået, registreres nye kørsler med status **Udførelse overskred aktuel plan** og udføres ikke, og det samme sker, mens abonnementet er ubetalt. Selvhostede installationer uden fakturering har ingen grænse. På en plan, der ikke kører arbejdsgange, siger **Bygger** og siden **Arbejdsgange** det, med et link til at opgradere.

## Hvor længe en kørsel må tage

| Grænse                                                           | Standard      | Indstilling ved selvhosting     |
| ---------------------------------------------------------------- | ------------- | ------------------------------- |
| En kørsel, fra dens start eller fra den vågner efter en **Pause** | 2 minutter    | `WORKFLOW_TIMEOUT_IN_MS`        |
| En **Kør egen JavaScript**-blok                                | 5 sekunder    | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| En **Pause**-blok                                                | Højst 30 dage | —                               |

Afvikleren tjekker deadlinen før og efter hver blok og markerer en kørsel, der er over tiden, som **Tidsgrænse overskredet**, så snart kontrollen vender tilbage. Den kan ikke afbryde en blok midtvejs, så blokke, der venter på netværket, har deres egne tidsgrænser: en forespørgsel fra Generate Text with AI giver op efter højst 60 sekunder og en OAuth 2.0-tokenforespørgsel efter 20. Ventetid ved en **Pause**-blok tæller ikke med i en kørsels tid: kørslen lægges til side og får friske 2 minutter, når den vågner.

## Grænse for at kalde andre arbejdsgange

Komponenten **Kør en anden arbejdsgang** lader én arbejdsgang starte et andet. For at forhindre løkker, hvor arbejdsgang A starter B, som starter A igen, afvises en kæde af arbejdsgange, der starter hinanden, når den ville løbe tilbage til en arbejdsgang, der allerede er i den, eller gå dybere end 10 arbejdsgange. Blokken **Kør en anden arbejdsgang** tager så sit **Fejl**-output, og fejlen viser kæden.

Har du et reelt behov for en lang kæde (som et job, der behandler ét element pr. kørsel), er det som regel enklere at løkke inde i én enkelt arbejdsgang med **Kør egen JavaScript**.

## Når arbejdsgange ikke er det rigtige værktøj

Et par tilfælde, hvor du bør gribe efter noget andet:

- **Tunge beregninger eller store datasæt** — arbejdsgange er lavet til let limarbejde, ikke til talknuseri. Kør det tunge arbejde i din egen infrastruktur, og lad en arbejdsgang sætte det i gang.
- **Langvarig aktiv beregning** — en kørsel har 2 minutter som standard. Til en passiv pause som «gør A, vent to timer, gør B» bruger du komponenten **Pause**; den lægger kørslen til side og genoptager den senere uden at optage en worker.
- **Trin-for-trin-hændelseshåndtering med mennesker involveret** — det er dét, [Runbooks](/docs/runbooks/index) er til. Arbejdsgange er til automatisering uden opsyn.

## Næste trin

:::cards
- [Arbejdsgange – Oversigt](/docs/workflows/index): Det store billede og en første arbejdsgang fra start til slut.
- [Komponenter](/docs/workflows/components): Hvad hver blok kræver, returnerer og må nå.
- [Runbooks](/docs/runbooks/index): Når folk skal træffe beslutningerne undervejs.
:::
