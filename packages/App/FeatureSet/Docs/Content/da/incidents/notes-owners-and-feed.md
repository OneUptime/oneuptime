# Noter, ejere og feed

Hver hændelse samler en skreven optegnelse, mens du arbejder på den. En del af den er til dine kunder — opdateringen, der går ud på statussiden klokken 02:14 om, at I har fundet den dårlige udrulning. Resten er til dit team — stak-sporet nogen indsatte, grafen der endelig gav mening, beslutningen om at skifte over.

OneUptime holder de to publikummer adskilt. **Offentlige noter** offentliggøres på din statusside og kan underrette abonnenter. **Private noter** (modellen `IncidentInternalNote`) bliver inde i dashboardet. Under dem begge ligger **Hændelse Feed**, en tidslinje der kun kan tilføjes til, og som registrerer alt, hvad der er sket med hændelsen, samt listen **Ejere**, der afgør, hvem der får besked.

Det hele hænger i hændelsens venstre sidemenu: **Noter → Offentlige noter**, **Noter → Private noter** og **Team → Ejere**. Feedet bor på hændelsens side **Oversigt**.

## Offentlige noter kontra private noter

De to notetyper ligner hinanden i dashboardet og opfører sig vidt forskelligt.

- **Offentlige noter** — modellen `IncidentPublicNote`, som serveres til statussider som en del af hændelsens tidslinje. De har en dato **Skrevet den**, du selv kan sætte, og et afkrydsningsfelt **Underret statussideabonnenter**.
- **Private noter** — modellen `IncidentInternalNote`. Intet i statusside-appen læser dem. De har intet felt for skrevet-den (listen stemples og sorteres efter `createdAt`) og slet ingen abonnentfelter, så en privat note kan aldrig udløse en abonnentnotifikation.

**Hvad "privat" faktisk betyder.** Det betyder "ikke offentliggjort på statussiden" — ikke "forbeholdt en mindre kreds". Begge notetyper deler de samme læserettigheder, så alle, der kan læse hændelsen, kan læse dens private noter. Vil du begrænse, hvem der overhovedet kan se en hændelse, så brug flaget **Privat hændelse** (`isPrivate`) på selve hændelsen, som skjuler hændelsen fra alle statussider og begrænser den til hændelsens ejerbrugere, medlemmerne af dens ejerteams samt projektadministratorer og -ejere.

**Ejere ser begge dele.** Jobbet, der underretter ejere, henter offentlige og private noter samlet. En privat note er privat over for dine abonnenter, ikke over for dem, der håndterer sagen.

| Hvis du vil…                                             | Vælg                |
| -------------------------------------------------------- | ------------------- |
| Fortælle kunderne, hvad I ved, og hvornår I ved mere      | **Offentlig note**  |
| Tilbagedatere en opdatering, du allerede har sendt andetsteds | **Offentlig note**  |
| Notere en hypotese, en kommando du kørte, eller en blindgyde | **Privat note**     |
| Vedhæfte et heap-dump eller et skærmbillede af et internt dashboard | **Privat note**     |

## At skrive en offentlig note

Åbn **Noter → Offentlige noter** i hændelsens sidemenu, og opret en note. Kortet forklarer, at det, du skriver her, dukker op på statussiden; tomtilstanden siger, at der endnu ikke er oprettet offentlige noter for denne hændelse.

| Felt                                | Formål                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Offentlig hændelsesnote**         | Brødteksten, i Markdown. Påkrævet. Formularen minder dig om, at noten er synlig på din statusside, og linker til et snydeark. |
| **Vedhæftninger**                   | Filer, der deles med abonnenter på statussiden. Valgfrit.                                                                  |
| **Underret statussideabonnenter**   | Afkrydsningsfelt, slået til som standard. Slå det fra for at offentliggøre stilfærdigt.                                    |
| **Skrevet den**                     | Påkrævet dato og tidspunkt, sat til nu som standard, vist i din aktuelle tidszone.                                        |

**Skrevet den er notens rigtige tidsstempel.** Statussider sorterer og viser offentlige noter efter `postedAt`, ikke efter hvornår du tastede dem — så hvis du får statussiden ajour med en opdatering, du sendte for 40 minutter siden, så sæt **Skrevet den** til det tidspunkt, det faktisk skete. Kommer en note ind via API'et uden et, stempler OneUptime det aktuelle tidspunkt.

Listen viser, hvem der skrev hver note, dens **Skrevet den**, den gengivne Markdown med dens vedhæftninger og en kolonne **Abonnentnotifikationsstatus**. Du kan filtrere på **Oprettet af**, **Note** og **Oprettet den**.

## At skrive en privat note

**Noter → Private noter** er bevidst mere spartansk. Der er kun to felter:

- **Privat hændelsesnote** — Markdown-brødtekst, påkrævet. Formularen siger lige ud, at den er privat for dit team og ikke synlig på statussiden.
- **Vedhæftninger** — filer beregnet til det team, der håndterer hændelsen.

Ingen **Skrevet den**, intet afkrydsningsfelt til abonnenter — noten stemples, når den oprettes.

## Vedhæftninger på noter

Begge notetyper tager imod filer gennem et felt **Vedhæftninger**, og begge viser en liste over vedhæftninger under notens brødtekst med et link **Download attachment** per fil.

Dér hvor de skiller sig, er, hvem der kan hente filen:

- **Vedhæftninger på offentlige noter** kan hentes af statussidens besøgende gennem en statusside-rute, side om side med selve noten.
- **Vedhæftninger på private noter** kan kun nås gennem det godkendte dashboard-API. Der findes ingen statusside-rute til dem.

Det gør vedhæftninger til den samme offentlig/privat-beslutning som noteteksten. Et kundevendt tidslinjebillede hører til på en offentlig note; et konfigurationsdump hører til på en privat.

## At generere en note med AI

Begge notesider har en knap **Generate with AI**. Den sender hændelsen til dit projekts AI-udbyder og lægger den genererede Markdown ind i noteeditoren, hvor du redigerer den, før du gemmer — intet offentliggøres automatisk.

- **Generate Public Note with AI** — beskrevet som at analysere hændelsesdataene for at producere en kundevendt note. Skabelonerne omfatter **Status Update** og **Resolution Notice**.
- **Generate Private Note with AI** — producerer i stedet en intern teknisk note. Skabelonerne omfatter **Investigation Update** og **Technical Analysis**.

Bag knappen sender dashboardet en POST til `/incident/generate-note-from-ai/{incidentId}` med den valgte skabelon og en notetype på `public` eller `internal`.

## Noteskabeloner

Skriver dit team de samme tre opdateringer ved hvert udfald, så gem dem én gang. Begge notesider har en knap **Opret fra skabelon**, der åbner vælgeren **Opret note fra skabelon** med en rullemenu **Vælg noteskabelon**.

Skabeloner deles mellem offentlige og private noter: én skabelonliste betjener begge, og den samme skabelon kan indsættes i begge slags noter.

Du styrer dem under **Hændelser → Indstillinger → Noteskabeloner** — kortet hedder **Skabeloner til offentlige eller private noter for hændelser**, og dets formular har et trin **Skabeloninformation** (**Skabelonnavn** og **Skabelonbeskrivelse**, begge påkrævede) og et trin **Notedetaljer** til brødteksten. Klikker du **Opret fra skabelon**, før du har oprettet nogen, fortæller OneUptime dig, at der ingen findes endnu; bemærk at beskeden peger på Projektindstillinger, men siden ligger faktisk under **Hændelser → Indstillinger → Noteskabeloner**.

## At skrive noter fra Slack eller Microsoft Teams

Har du forbundet et arbejdsområde, behøver respondere aldrig forlade kanalen. Både Slack og Microsoft Teams har en handling til at tilføje en note, som åbner en dialog med en rullemenu, der tilbyder **Offentlig note** eller **Privat note**, plus et tekstfelt, og skriver resultatet direkte på hændelsen.

To detaljer er værd at kende:

- **Beskyttelse mod dubletter** — hver note registrerer den Slack-besked, den kom fra (`postedFromSlackMessageId`, formateret `channel_id:message_ts`), så flere folk, der reagerer på den samme besked, giver én note og ikke fem.
- **Noter giver ekko tilbage** — at skrive begge slags noter sender også en besked ind i den forbundne hændelseskanal, fordi notens feed-punkt oprettes med notifikation til arbejdsområdet slået til.

## Hvornår en offentlig note faktisk når abonnenterne

At oprette en offentlig note med **Underret statussideabonnenter** slået til er ikke i sig selv en garanti for, at der går en e-mail ud. Noten skal igennem en kæde af kontroller, og hver fejl registrerer en konkret årsag frem for at fejle:

1. **Underret statussideabonnenter** skal være slået til. Er den ikke det, stemples noten som oversprunget i det øjeblik den oprettes.
2. Noten skal høre til en hændelse, der stadig findes.
3. Hændelsen skal have mindst én monitor knyttet — uden monitorer er der ingen statussideressource at dirigere noten til.
4. Hændelsens flag **Synlig på statussiden** (`isVisibleOnStatusPage`) skal være sandt.
5. Hver statusside, hændelsen når ud til, skal have **Vis hændelser** (`showIncidentsOnStatusPage`) slået til.
6. Hver abonnent skal passere sine egne præferencer — ikke afmeldt, og tilmeldt denne ressource og begivenhedstypen `Incident`, dér hvor siden lader abonnenter vælge.

**Notifikationer er ikke øjeblikkelige.** Jobbet, der sender dem, kører én gang i minuttet, så regn med op mod et minut mellem, at du gemmer noten, og at posten går. Det er det, mærket **Sending Soon** betyder.

Kolonnen **Abonnentnotifikationsstatus** følger hele rejsen:

| Status                       | Hvad den betyder                                            |
| ---------------------------- | ----------------------------------------------------------- |
| **Notifications skipped.**   | En af portene ovenfor lukkede. Årsagen registreres.         |
| **Sending Soon**             | I kø, venter på næste kørsel af afsendelsesjobbet.          |
| **Notifications Being Sent** | Jobbet arbejder sig gennem abonnentlisten.                  |
| **Notifikationer sendt**     | Alle abonnentnotifikationer er gået ud.                     |
| **Mislykkedes**              | Jobbet fejlede; fejlen gemmes sammen med noten.             |

Klik **flere detaljer** på statussen for at åbne **Detaljer om notifikationsstatus**. Dér hvor en genafsendelse giver mening, hedder dialogens knap **Retry**, som sætter noten tilbage i afventende tilstand, så næste kørsel samler den op igen.

Den besked, abonnenterne faktisk får, er skabelonstyret per statusside og per kanal — e-mail, SMS, Slack og Microsoft Teams har hver deres egen skabelon til begivenheden **Subscriber Incident Note Created**, med variabler for statussidens navn og URL, detaljelinket, de berørte ressourcer, hændelsens alvorsgrad og titel, notens brødtekst og et afmeldingslink per abonnent. Se [Abonnenter og meddelelser](/docs/status-pages/subscribers) for hvordan de skabeloner og kanaler konfigureres.

## Hændelsesfeedet

Kortet **Hændelse Feed** sidder nederst i venstre kolonne på hændelsens side **Oversigt**. Det er hændelsens historie i rækkefølge: hvert punkt er et ikon, avataren og navnet på den, der udløste det, et relativt tidsstempel med det præcise lokale klokkeslæt ved hover, og en Markdown-brødtekst. Punkterne er sorteret ældste først.

Nogle punkter bærer ekstra detaljer — en ejernotifikation lister for eksempel alle, der fik post. De viser en knap **More Information**, som åbner et panel **More Information**.

Kortets sidehoved har også en menu **Handlinger**, så du kan handle uden at forlade tidslinjen:

- **Execute Runbook** — start et [runbook](/docs/runbooks/index) mod denne hændelse.
- **Udfør vagtpolitik** — tilkald en politik på forlangende.
- **Add Public Note** — de samme fire felter som siden Offentlige noter, i en dialog.
- **Tilføj privat note** — kun notetekst og vedhæftninger.

Ved siden af den henter **Opdater** feedet igen.

**Feedet kan kun tilføjes til, og det er ikke din auditlog.** API'et tillader at oprette og læse feed-punkter, men ikke at opdatere eller slette dem, så ingen kan i stilhed skrive en hændelses historik om. Det er heller ikke permanent: på fakturerede installationer fjernes feed-rækker, der er ældre end tre år. Vil du have en varig optegnelse over, hvem der ændrede hvad, så brug **Revision → Auditlogs** i hændelsens sidemenu.

## Hvad feedet registrerer

Feed-punkter skrives af hændelsestjenesten selv, af begge notetjenester, af tilstandstidslinjen, af ejer- og medlemsændringer, af regelmotorerne, af vagtudførelsen, af AI-undersøgelses- og postmortem-kørslerne og af cron-jobbene til notifikationer. Begivenhedstyperne dækker:

- **Selve hændelsen** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Noter og opsamlinger** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Mennesker** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Notifikationer** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Hver type får sit eget ikon, så du kan skimme et langt feed og plukke tilstandsskiftene ud af støjen. AI-genereret grundårsagsanalyse markeres tydeligt og gengives i en begrænset Markdown-tilstand.

Feeds respekterer hændelsers privatliv: for private hændelser filtreres feed-læsninger på samme måde som hændelsen selv.

## Ejere

Ejere er de folk og teams, der har ansvaret for en hændelse. De er modtagerne af alt, hvad der sker med den — og de er grunden til, at en hændelse ikke bliver overset, mens alle går ud fra, at en anden er på den.

Åbn **Team → Ejere** i hændelsens sidemenu. Kortet **Ejere** viser et tællemærke og beskriver ejere som de folk og teams, der har ansvaret for denne hændelse, og som underrettes om ændringer, med en løbende optælling i stil med "2 personer · 1 team". Ejere vises som overlappende avatarer; holder du musen over en, vises personens e-mail, eller punktet markeres som **Team**.

- Klik **Tilføj ejer** for at åbne en vælger med et søgefelt til personer eller teams.
- Klik fjern-knappen på en avatar for at åbne bekræftelsen **Fjern ejer** og derefter **Fjern**.
- Er der endnu ingen ejere, siger kortet det og opfordrer dig til at tilføje en kollega eller et team, så de får besked om ændringer.

Ejerbrugere og ejerteams er separate optegnelser — at tilføje et team gør hvert medlem af det team til ejer, hvad notifikationer angår, uden at de skal listes enkeltvis.

## Hvordan ejere bliver tildelt

Der er fire veje ind på ejerlisten:

- **Fra en hændelsesskabelon** — skabeloner har felterne **Ejer - Teams** og **Ejer - Brugere**, beskrevet som de teams og brugere, der ejer hændelsen og underrettes, når den oprettes eller opdateres. At oprette en hændelse fra skabelonen forudfylder dem. Se [Opret en hændelse](/docs/incidents/declaring-incidents).
- **Fra Ejerregler for hændelse** — matchende regler tilføjer ejere automatisk ved oprettelsen.
- **Ved oprettelsen gennem API'et** — ejerbrugere og -teams sendt med oprettelseskaldet tilføjes med det samme, med et flag der styrer, om de får "du er blevet tilføjet"-e-mailen.
- **I hånden** — knappen **Tilføj ejer** på siden **Ejere**, når som helst under hændelsen.

Det er ufarligt at tilføje den samme person to gange; ejere, der allerede er tildelt, dubleres ikke.

## Ejerregler for hændelse

**Ejerregler for hændelse** tildeler automatisk ejerbrugere og -teams, når matchende hændelser oprettes — det dirigeringslag, der gør at en databasehændelse lander hos databaseteamet, uden at nogen skal tænke over det. Du finder dem sammen med resten af hændelsesautomatiseringen i [Hændelsesindstillinger og automatisering](/docs/incidents/settings).

Regelformularen har tre trin — **Grundlæggende oplysninger**, **Matchkriterier** og **Ejere** — og ejertrinnet rummer to sektioner:

- **Ejere at tildele** — vælg **Ejer-teams** og **Ejer-brugere**. Når reglen matcher, tilføjes hver valgt bruger og hvert valgt team som ejer, og allerede tildelte ejere dubleres ikke.
- **Nedarv ejere** — tildel ejere fra beslægtede enheder i stedet for at nævne dem. **Nedarv ejere fra overvågninger** gør hver ejer af hændelsens monitorer til ejer af hændelsen, og **Nedarv ejere fra værter**, **… fra Kubernetes-klynger**, **… fra Docker-værter**, **… fra Podman-værter** og **… fra tjenester** gør det samme for de ressourcer.

En kontakt **Underret ejere** styrer, om folk får det at vide. Lad den være slået til ved rigtig dirigering; slå den fra for at tilføje ejere i stilhed — nyttigt når en regel er en bogholderibekvemmelighed frem for en tilkaldelse.

Hver regelkørsel skrives til hændelsesfeedet, så du altid kan se, om en person blev tilføjet af en regel eller af et menneske.

## Hvad ejere bliver underrettet om

Fem jobs underretter ejere, og hvert kører én gang i minuttet:

- **Hændelse oprettet** — emne `[New Incident {number}] - {title}`.
- **Der blev skrevet en note** — for offentlige *og* private noter, emne `[Update Incident {number}] - {title}`.
- **Hændelsens tilstand ændrede sig** — se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).
- **Du blev tilføjet som ejer** — emne `You have been added as the owner of Incident {number} - {title}`.
- **Stadig uløst** — en påmindelse styret af hændelsens næste påmindelsestidspunkt, emne `[Reminder] Incident {number} is still {state} - {title}`.

Hver notifikation bygges til e-mail, SMS, taleopkald, push og WhatsApp og overdrages til brugerens notifikationsindstillinger, som afgør, hvad der faktisk sendes. Hver modtager kan slå hver af dem fra enkeltvis — indstillingerne per bruger er formuleret som at sende dig notifikationer om oprettet hændelse, skrevet note, ændret tilstand, tilføjet ejer, tildelt medlem og påmindelse om stadig åben. Én, der kun vil ringes op ved tilstandsskift, kan få præcis det.

**Hændelser uden ejere er ikke tavse.** Har en hændelse slet ingen ejere, falder notifikationsjobbene tilbage til projektets ejere, så intet tabes på gulvet. Hver person, der underrettes, føjes også til det tilsvarende feed-punkt, så du bagefter kan se præcis, hvem der fik besked, og på hvilken adresse.

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvad en hændelse er, og hvordan delene hænger sammen.
- [Opret en hændelse](/docs/incidents/declaring-incidents) — at oprette hændelser i hånden, fra skabeloner og fra monitorer.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — den tilstandsmaskine, der driver halvdelen af feedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — ejerregler, noteskabeloner og resten af automatiseringen.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvor offentlige noter ender, og hvem der modtager dem.
- [Statussider – Oversigt](/docs/status-pages/index) — hændelsens kundevendte side.
