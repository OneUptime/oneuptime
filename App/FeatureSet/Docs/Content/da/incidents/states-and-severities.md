# Tilstande og alvorsgrader

Hver hændelse bærer to klassifikationer: en **tilstand**, der siger, hvor den er i din respons, og en **alvorsgrad**, der siger, hvor meget det gør ondt. I dashboardet ligner de hinanden — begge vises som farvede piller på listen over hændelser, begge er projektafgrænsede lister, du kan omdøbe og give nye farver. De gør meget forskellige ting.

Tilstande driver adfærd. Tre booleanske flag på tilstandsrækkerne bestemmer, hvilke hændelser der tæller som aktive, hvilke knapper der vises i hændelsens sidehoved, hvornår SLA-uret stopper, og hvornår hændelsen falder af din statusside. Alvorsgrader driver intet i sig selv — de er etiketter, der beskriver påvirkning, og som andre regler kan matche på.

Begge lister oprettes, når dit projekt oprettes, og begge redigeres under **Hændelser → Indstillinger**. Den sektion af hændelsernes sidemenu er sammenklappet som standard, så fold **Indstillinger** ud, før du går på jagt.

## Tilstande bærer adfærd, alvorsgrader bærer betydning

Modellen `IncidentState` har `name`, `description`, `color` og `order`, plus tre booleans: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Alt, hvad produktet gør med tilstande, læner sig op ad de booleans og op ad `order` — aldrig op ad tilstandens navn. Det er derfor, du kan omdøbe **Løst** til "Lukket", uden at noget går i stykker: flaget følger rækken.

Modellen `IncidentSeverity` har `name`, `description`, `color` og `order` og intet andet. Der er ingen flag. Intet i OneUptime behandler **Critical Incident** anderledes end **Minor Incident** i sig selv — alvorsgrad betyder kun noget dér, hvor du peger noget mod den, såsom matchkriteriet **Hændelse Alvorligheder** på en vagtregel.

Et par hurtige regler:

- **Vælg alvorsgrad for at kommunikere påvirkning** — den vises på listen over hændelser, på hændelsens **Oversigt**, og den er et påkrævet felt, når du erklærer en hændelse.
- **Vælg tilstande for at modellere din proces** — de responstrin, du faktisk går igennem, i den rækkefølge, du går igennem dem.
- **Kod ikke hastværk ind i tilstande** — en tilstand ved navn "Kritisk" ville ikke tilkalde nogen. Alvorsgrad plus en vagtregel gør det.

## De forudoprettede tilstande

Tre tilstande oprettes sammen med projektet, i denne rækkefølge. Oprettelsen er idempotent — en tilstand tilføjes kun, når en med det navn ikke allerede findes.

| Tilstand         | `order` | Flag                  | Farve     | Betydning                                                  |
| ---------------- | ------- | --------------------- | --------- | ---------------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Den tilstand nye hændelser lander i.                       |
| **Bekræftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Nogen har taget hændelsen op.                              |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Hændelsen er ovre og holder op med at tælle som aktiv.     |

Bemærk navnet: den første tilstand er **Identified**, selvom flere beskrivelser inde i produktet stadig kalder den den "oprettede" tilstand. Når en dokumentationsside eller et værktøjstip siger "oprettet tilstand", menes den tilstand, der bærer `isCreatedState` — i et nyt projekt er det **Identified**.

## Hvad hvert tilstandsflag faktisk gør

| Flag                  | Formål                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Den tilstand en hændelse får, når ingen valgte en. Hvis ingen tilstand i projektet bærer dette flag, fejler oprettelsen af en hændelse med en fejl, der beder dig tilføje en oprettet hændelsestilstand fra indstillingerne. |
| `isAcknowledgedState` | Driver knappen **Acknowledge** og statistikfeltet "<tilstandsnavn> i" på hændelsens **Oversigt**. Ved en tilstandsændring til denne tilstand markeres hændelsens SLA som besvaret.                   |
| `isResolvedState`     | Driver knappen **Løs** og det løste statistikfelt, definerer listen **Aktive hændelser** og er det, der fjerner hændelsen fra en statussides aktive sektion. Markerer SLA'en som løst.               |

Kun én tilstand per projekt forventes at bære hvert flag — opslagene henter en enkelt række. De tre flagbærende tilstande kan omdøbes, få nye farver og flyttes i rækkefølgen, men indstillingssiden nægter at slette dem og viser en fejl, der nævner den oprettede, den bekræftede og den løste tilstand.

Fordi brugerfladen læser tilstandsnavne dynamisk, ændrer en omdøbning af en tilstand det, du ser overalt — statistikfelterne, bekræftelsesmodalernes titler og pillen på listen over hændelser følger alle det navn, du gav rækken.

## At tilføje dine egne tilstande

Gå til **Hændelser → Indstillinger → Hændelsesstatus**. Siden er en ordnet liste sorteret efter `order` stigende, og nye tilstande føjes til slutningen. Træk en række for at ændre dens placering.

**Felter på en tilstand:**

- **Navn** — påkrævet, mindst to tegn. Pladsholderen foreslår noget i stil med "Investigating".
- **Beskrivelse** — valgfri fritekst, der forklarer, hvornår en hændelse er i denne tilstand.
- **Farve** — påkrævet. Vælges fra farvevælgeren; gemmes som en hex-værdi såsom `#fd625e`.

Du kan ikke sætte de tre flag fra denne formular — de hører til de forudoprettede rækker. En tilstand, du tilføjer, er derfor en tilstand uden flag, hvilket har to konsekvenser, der er værd at planlægge efter:

- **Den tæller som aktiv.** **Aktive hændelser** er defineret som "den aktuelle tilstand er ikke den løste tilstand", så alt, du tilføjer ud over den løste tilstand, holder hændelsen på den aktive liste og i sidebar-tællingen.
- **Dens overgangsknap er generisk.** I stedet for **Acknowledge** eller **Løs** hedder bekræftelsesmodalen **Mark Incident as `<tilstandsnavn>`** med indsend-knappen **Mark as `<tilstandsnavn>`**.

En almindelig form er at indsætte et triage- eller afhjælpningstrin mellem den bekræftede og den løste tilstand — for eksempel ved at trække en ny tilstand "Mitigated", så den ligger efter **Bekræftet** og før **Løst**.

## Rækkefølge er en reel begrænsning, ikke en visningspræference

Kolonnen `order` håndhæves, når en tilstandsændring skrives, ikke kun når listen tegnes:

- **Overgange baglæns afvises.** At flytte en hændelse til en tilstand, der ligger tidligere i rækkefølgen end dens nuværende tilstand, fejler med en fejl, der nævner begge tilstande.
- **At vælge den aktuelle tilstand igen afvises.** At sætte en hændelse til den tilstand, den allerede er i, fejler med "Incident state cannot be same as previous state."
- **En tilbagedateret række kan ikke duplikere sin nabo.** At indsætte en tidslinjerække, hvis tilstand matcher den række, der følger efter den, afvises også.
- **Knapperne i sidehovedet følger de flagbærende tilstandes placering i rækkefølgen.** **Acknowledge** og **Løs** tilbydes ud fra, hvor den aktuelle tilstand ligger på den rækkefølgesorterede liste. En brugerdefineret tilstand placeret *efter* den løste tilstand vil aldrig vise en **Løs**-knap, fordi der ikke er noget tilbage at flytte fremad til.

Så når du tilføjer en tilstand, så placér den dér, hvor en hændelse rent faktisk ville passere igennem den. At sætte den forkert i rækkefølgen ser ikke bare mærkeligt ud — det gør overgange umulige.

## De forudoprettede alvorsgrader

Tre alvorsgrader oprettes sammen med projektet, i denne rækkefølge:

- **Critical Incident** (`order` 1, `#b70400`) — problemer, der har meget høj påvirkning på kunderne og kræver øjeblikkelig respons. Et fuldt udfald eller et databrud.
- **Major Incident** (`order` 2, `#fd625e`) — betydelig påvirkning, kræver normalt øjeblikkelig respons, undertiden med en workaround, der begrænser skaden. Et vigtigt undersystem, der fejler.
- **Minor Incident** (`order` 3, `#ffbf53`) — lav påvirkning, håndteres normalt inden for arbejdstiden, og de fleste kunder vil næppe bemærke det. Et lille fald i applikationens ydeevne.

Alvorsgrad er påkrævet, når du erklærer en hændelse, og den er påkrævet på hver hændelsesspecifikation i en monitors kriterier, så hver hændelse — manuel eller automatisk — ankommer med en. Se [Opret en hændelse](/docs/incidents/declaring-incidents) for erklæringsflowet og [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) for den monitor-drevne vej.

## At redigere alvorsgrader

Gå til **Hændelser → Indstillinger → Hændelsesalvor**. Samme form som tilstandssiden — en ordnet liste sorteret efter `order`, træk for at ændre rækkefølgen, nye alvorsgrader føjes til slutningen, med **Navn**, **Beskrivelse** og **Farve** på formularen.

To forskelle fra tilstande:

- **Der er ingen sletteværn.** Enhver alvorsgrad kan slettes, inklusive de tre forudoprettede.
- **Der er ingen flag at arve.** En ny alvorsgrad opfører sig præcis som de forudoprettede — den er en etiket med en farve og en placering.

**En bemærkning om pladsholderne.** Alvorsgradsformularen genbruger tilstandsformularens eksempeltekst ord for ord, så hjælpeteksterne taler om hændelsestilstande frem for alvorsgrader. Se bort fra dem og skriv dine egne navne og beskrivelser til alvorsgrader.

Hvor alvorsgrad gør mere end at beskrive: på **Hændelser → Regler → Vagtregler** er en regels felt **Hændelse Alvorligheder** et matchkriterium. At nævne **Critical Incident** dér er måden, "tilkald databaseteamet ved alt kritisk" udtrykkes på — vagtpolitikken bor på reglen, ikke på alvorsgraden.

## At flytte en hændelse gennem dens tilstande

Der er fire måder, en hændelse skifter tilstand på:

- **Knapperne i sidehovedet.** Åbn en hændelse. Hvis dens aktuelle tilstand er før den bekræftede tilstand, får du **Acknowledge** og **Løs**; hvis den er mellem de to, får du **Løs**. Hver åbner en bekræftelsesmodal — **Acknowledge Incident** eller **Resolve Incident** — som også tilbyder **Vælg noteskabelon**, **Offentlig note** og **Underret statussideabonnenter**.
- **Tilstandstidslinjen.** Tilføj en række i hånden fra hændelsens side **Tilstandstidslinje** med **Hændelsesstatus**, **Begynder den** og **Underret statussideabonnenter**.
- **Masseændring.** Listen over hændelser har en masse-handling **Skift tilstand** til at flytte flere hændelser på én gang.
- **Automatisk.** Et monitorkriterium med **Løs hændelse automatisk** aktiveret løser sin hændelse, når kriteriet ikke længere er opfyldt, og API'et kan opdatere tilstanden gennem `/api/incident-state-timeline`.

Hver eneste af disse skriver en tidslinjerække. En tilstandsændring gør også et par ting, du ikke behøver at bede om: den skriver et punkt i hændelsesfeedet, tildeler en Hændelsesleder, hvis hændelsen ikke allerede har en, og opdaterer SLA-uret. At genåbne en løst hændelse starter en frisk SLA-registrering fra genåbningstidspunktet.

## Tilstandstidslinjen

Hændelsens side **Tilstandstidslinje** i hændelsens sidemenu er revisionssporet over hver tilstand, hændelsen har været i. Kortet på den side hedder **Statustidslinje**, og det er sorteret nyeste først.

**Kolonner:**

- **Hændelsesstatus** — en farvet pille med tilstandens navn og farve.
- **Begynder den** — hvornår hændelsen gik ind i denne tilstand.
- **Slutter den** — hvornår den forlod den. Den aktuelle tilstand viser `Currently Active`.
- **Varighed** — tid tilbragt i tilstanden, talt til nu for den aktuelle.
- **Abonnentnotifikationsstatus** — om statussidenotifikationen for denne ændring blev sendt, sprunget over eller stadig afventer, med et link til **flere detaljer**, og — når afsendelsen fejlede — en **Retry**-handling.

**Rækkehandlinger:**

- **Vis årsag** — åbner en modal **Grundårsag**, der viser den markdown, der blev registreret med den tilstandsændring.
- **Vis logge** — åbner en modal, der forklarer, hvorfor statussen ændrede sig, med en **Hændelsestilstandslog**-fremviser.

Tidslinjerækker kan oprettes og slettes, men ikke redigeres. At slette den forkerte række omskriver hændelsens historik, så behandl det som et korrektionsværktøj frem for en oprydningsvane.

## Listen Aktive hændelser

**Hændelser → Aktive hændelser** er den liste, du holder øje med under en vagt. Dens definition er præcis én betingelse: hændelsens aktuelle tilstand er en tilstand, hvor `isResolvedState` er falsk. Intet andet tages i betragtning — ikke alvorsgrad, ikke alder, ikke om nogen har bekræftet den.

Punktet i sidemenuen bærer et rødt tællemærke, der bruger den samme forespørgsel, så mærket og listen altid er enige. Når der intet er at se, siger siden det.

Den praktiske konsekvens: enhver brugerdefineret tilstand, du tilføjer, holder hændelser på denne liste. Det er som regel det, du vil have — "Mitigated" er ikke "færdig" — men det betyder, at mærket kun ryddes, når hændelser faktisk når den løste tilstand.

## At fortælle statussideabonnenter om en tilstandsændring

En tilstandsændring kan sende en e-mail til dine statussideabonnenter, men den skal igennem flere porte. At forstå dem sparer en masse fejlsøgning af typen "hvorfor fik ingen besked".

Notifikation anmodes om per tidslinjerække af **Underret statussideabonnenter** (`shouldStatusPageSubscribersBeNotified`), afkrydsningsfeltet på tilstandsændringsmodalen og på den manuelle tidslinjeformular. Når det er slået fra, gemmes rækken med en oversprunget status og en forklaring. Når det er slået til, sættes rækken i kø, og et baggrundsjob henter den — jobbet kører hvert minut, så leveringen er hurtig, men ikke øjeblikkelig.

**Rækken i kø springes derefter over, når blot én af disse gælder:**

- **Den nye tilstand er den oprettede tilstand.** Abonnenter fik allerede besked, da hændelsen blev erklæret, så den første tidslinjerække sender bevidst ikke en besked mere.
- **Hændelsen har ingen monitorer knyttet.** Uden ressourcer er der ingen statusside at knytte hændelsen til.
- **Hændelsen er ikke synlig på statussiden** (`isVisibleOnStatusPage` er slået fra).
- **Statussiden har hændelser slået fra** (`showIncidentsOnStatusPage` er slået fra). Denne gælder per statusside — andre sider, der viser den samme monitor, får stadig besked.

**Én ting mere, der ændrer udfaldet.** Hvis du skriver en **Offentlig note** i tilstandsændringsmodalen, markeres tidslinjerækken som allerede underrettet frem for at blive sat i kø. Selve noten er det, der når abonnenterne, så de får én besked i stedet for to. Hændelsestypen bag den rene tilstandsændringsbesked er `Subscriber Incident State Changed`.

For hvem der modtager disse, og hvordan skabelonerne vælges, se [Abonnenter og meddelelser](/docs/status-pages/subscribers).

## At holde en hændelse væk fra statussiden

Tre separate ting afgør, om en hændelse overhovedet er på den offentlige side, og alle tre skal være sande:

- **Vis hændelser** (`showIncidentsOnStatusPage`) på selve statussiden.
- **Synlig på statussiden** (`isVisibleOnStatusPage`) på hændelsen — en kontakt på hændelsens side **Indstillinger**. Den står som standard til sand og er ikke med i erklæringsguiden; et monitorkriterium kan sætte den med **Vis hændelse på statusside**.
- **Den aktuelle tilstand er ikke den løste tilstand.** Dette er det, der fjerner en hændelse fra den aktive sektion: statussidens forespørgsel henter hændelser, hvis aktuelle tilstand er en hvilken som helst uløst tilstand. Du arkiverer eller lukker ikke noget — du løser den, og den flytter ind i historikken.

**Private hændelser optræder aldrig.** At slå **Privat hændelse** til skjuler hændelsen fra alle statussider, uanset kontakterne ovenfor, og begrænser den til dens ejere plus projektadministratorer og -ejere.

Hvor meget løst historik siden beholder, er en statussideindstilling, ikke en hændelsesindstilling. Se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) for hvordan monitorerne på siden bestemmer, hvilke hændelser der overhovedet vises.

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesområdet hænger sammen.
- [Opret en hændelse](/docs/incidents/declaring-incidents) — erklæringsguiden, skabelonerne og API'et.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige noter, private noter og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, regler og workflow-triggere.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får de e-mails, en tilstandsændring sender.
- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside viser, og for hvem.
- [Workflows – Oversigt](/docs/workflows/index) — at reagere på tilstandsændringer med automatisering.
