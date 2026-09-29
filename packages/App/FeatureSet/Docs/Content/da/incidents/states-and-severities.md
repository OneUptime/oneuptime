# Tilstande og alvorsgrader

Hver hændelse bærer to klassifikationer: en **tilstand**, der siger hvor langt den er i din indsats, og en **alvorsgrad**, der siger hvor ondt det gør. I dashboardet ligner de hinanden — begge vises som farvede plaketter på listen over hændelser, og begge er projektafgrænsede lister, du kan omdøbe og give nye farver. De laver vidt forskellige ting.

Tilstande styrer adfærd. Tre booleske flag på tilstandsrækkerne afgør, hvilke hændelser der tæller som aktive, hvilke knapper der dukker op i hændelsens sidehoved, hvornår SLA-uret stopper, og hvornår hændelsen forsvinder fra din statusside. Alvorsgrader styrer ingenting i sig selv — de er etiketter, der beskriver påvirkning, og som andre regler kan matche på.

Begge lister oprettes sammen med dit projekt, og begge redigeres under **Hændelser → Indstillinger**. Den sektion af hændelsernes sidemenu er sammenklappet som standard, så fold **Indstillinger** ud, før du går på jagt.

## Tilstande bærer adfærd, alvorsgrader bærer betydning

Modellen `IncidentState` har `name`, `description`, `color` og `order` plus tre booleans: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Alt, hvad produktet gør med tilstande, hænger på de booleans og på `order` — aldrig på tilstandens navn. Derfor kan du omdøbe **Løst** til "Lukket", uden at noget går i stykker: flaget følger rækken.

Modellen `IncidentSeverity` har `name`, `description`, `color` og `order` og intet andet. Der er ingen flag. Intet i OneUptime behandler **Critical Incident** anderledes end **Minor Incident** af sig selv — alvorsgrad betyder kun noget dér, hvor du peger noget mod den, som matchkriteriet **Hændelse Alvorligheder** på en vagtregel.

Et par hurtige regler:

- **Vælg alvorsgrad for at kommunikere påvirkning** — den vises på listen over hændelser, på hændelsens **Oversigt**, og den er et påkrævet felt, når du erklærer en hændelse.
- **Vælg tilstande for at afspejle din proces** — de skridt i indsatsen, du faktisk går igennem, i den rækkefølge du går dem.
- **Læg ikke hastegrad i tilstandene** — en tilstand ved navn "Kritisk" tilkalder ingen. Det gør alvorsgrad plus en vagtregel.

## De forudoprettede tilstande

Tre tilstande oprettes sammen med projektet, i denne rækkefølge. Oprettelsen er idempotent — en tilstand tilføjes kun, hvis der ikke allerede findes en med det navn.

| Tilstand         | `order` | Flag                  | Farve     | Hvad den betyder                                     |
| ---------------- | ------- | --------------------- | --------- | ---------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Den tilstand nye hændelser lander i.                 |
| **Bekræftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Nogen har taget hændelsen på sig.                    |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Hændelsen er ovre og tæller ikke længere som aktiv.  |

Bemærk navnet: den første tilstand hedder **Identified**, selv om flere beskrivelser inde i produktet stadig kalder den den "oprettede" tilstand. Når en dokumentationsside eller et værktøjstip siger "oprettet tilstand", menes den tilstand, der bærer `isCreatedState` — i et nyt projekt er det **Identified**.

## Hvad hvert tilstandsflag faktisk gør

| Flag                  | Formål                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isCreatedState`      | Den tilstand en hændelse får, når ingen har valgt en. Bærer ingen tilstand i projektet dette flag, fejler oprettelsen af en hændelse med en fejl, der beder dig tilføje en oprettet hændelsestilstand fra indstillingerne. |
| `isAcknowledgedState` | Driver knappen **Acknowledge** og nøgletalsfeltet "<tilstandsnavn> i" på hændelsens **Oversigt**. Ved et skift til denne tilstand markeres hændelsens SLA som besvaret.                               |
| `isResolvedState`     | Driver knappen **Løs** og det løste nøgletalsfelt, definerer listen **Aktive hændelser** og er det, der fjerner hændelsen fra en statussides aktive sektion. Markerer SLA'en som løst.                |

Kun én tilstand per projekt forventes at bære hvert flag — opslagene henter en enkelt række. De tre flagbærende tilstande kan omdøbes, få nye farver og flyttes rundt, men indstillingssiden nægter at slette dem og viser en fejl, der nævner den oprettede, den bekræftede og den løste tilstand.

Fordi brugerfladen læser tilstandsnavne dynamisk, ændrer en omdøbning, hvad du ser overalt — nøgletalsfelterne, titlerne på bekræftelsesdialoger og plaketten på listen over hændelser følger alle det navn, du gav rækken.

## At tilføje dine egne tilstande

Gå til **Hændelser → Indstillinger → Hændelsesstatus**. Siden er en ordnet liste sorteret stigende efter `order`, og nye tilstande føjes til slutningen. Træk i en række for at flytte den.

**Felter på en tilstand:**

- **Navn** — påkrævet, mindst to tegn. Pladsholderen foreslår noget i retning af "Investigating".
- **Beskrivelse** — valgfri fritekst, der forklarer, hvornår en hændelse ligger i denne tilstand.
- **Farve** — påkrævet. Vælges i farvevælgeren og gemmes som en hex-værdi som `#fd625e`.

Du kan ikke sætte de tre flag fra denne formular — de hører til de forudoprettede rækker. En tilstand, du tilføjer, er derfor uden flag, hvilket har to konsekvenser, det er værd at planlægge efter:

- **Den tæller som aktiv.** **Aktive hændelser** er defineret som "den aktuelle tilstand er ikke den løste tilstand", så alt andet end den løste tilstand holder hændelsen på den aktive liste og med i tælleren i sidemenuen.
- **Dens overgangsknap er generisk.** I stedet for **Acknowledge** eller **Løs** hedder bekræftelsesdialogen **Markér hændelse som `<tilstandsnavn>`** med indsend-knappen **Mark as `<tilstandsnavn>`**.

En almindelig løsning er at indsætte et triage- eller afhjælpningstrin mellem den bekræftede og den løste tilstand — for eksempel ved at trække en ny tilstand "Mitigated" ind, så den ligger efter **Bekræftet** og før **Løst**.

## Rækkefølgen er en reel begrænsning, ikke en visningspræference

Kolonnen `order` håndhæves, når et tilstandsskift skrives — ikke kun når listen tegnes:

- **Skift baglæns afvises.** At flytte en hændelse til en tilstand, der ligger tidligere i rækkefølgen end dens nuværende, fejler med en fejl, der nævner begge tilstande.
- **At vælge den nuværende tilstand igen afvises.** At sætte en hændelse til den tilstand, den allerede er i, fejler med "Incident state cannot be same as previous state."
- **En tilbagedateret række må ikke dublere sin nabo.** At indsætte en tidslinjerække, hvis tilstand er den samme som rækken efter den, afvises også.
- **Knapperne i sidehovedet følger de flagbærende tilstandes plads i rækkefølgen.** **Acknowledge** og **Løs** tilbydes ud fra, hvor den aktuelle tilstand ligger på den rækkefølgesorterede liste. En egen tilstand placeret *efter* den løste tilstand vil aldrig vise en **Løs**-knap, for der er ikke noget tilbage at rykke frem til.

Så når du tilføjer en tilstand, så placér den dér, hvor en hændelse reelt ville passere igennem den. Forkert rækkefølge ser ikke bare mærkelig ud — den gør overgange umulige.

## De forudoprettede alvorsgrader

Tre alvorsgrader oprettes sammen med projektet, i denne rækkefølge:

- **Critical Incident** (`order` 1, `#b70400`) — problemer med meget stor påvirkning på kunderne, som kræver øjeblikkelig indsats. Et fuldt udfald eller et databrud.
- **Major Incident** (`order` 2, `#fd625e`) — betydelig påvirkning, kræver som regel øjeblikkelig indsats, nogle gange med en omgåelse, der begrænser skaden. Et vigtigt delsystem, der fejler.
- **Minor Incident** (`order` 3, `#ffbf53`) — lille påvirkning, klares normalt inden for arbejdstiden, og de fleste kunder opdager det næppe. Et let fald i applikationens ydeevne.

Alvorsgrad er påkrævet, når du erklærer en hændelse, og den er påkrævet på hver hændelsesspecifikation i en monitors kriterier, så hver eneste hændelse — manuel eller automatisk — kommer ind med en. Se [Opret en hændelse](/docs/incidents/declaring-incidents) for erklæringsforløbet og [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) for den monitordrevne vej.

## At redigere alvorsgrader

Gå til **Hændelser → Indstillinger → Hændelsesalvor**. Samme form som tilstandssiden — en ordnet liste sorteret efter `order`, træk for at ændre rækkefølgen, nye alvorsgrader føjes til slutningen, med **Navn**, **Beskrivelse** og **Farve** på formularen.

To forskelle fra tilstande:

- **Der er ingen sletteværn.** Enhver alvorsgrad kan slettes, også de tre forudoprettede.
- **Der er ingen flag at arve.** En ny alvorsgrad opfører sig præcis som de forudoprettede — den er en etiket med en farve og en placering.

**En bemærkning om pladsholderne.** Formularen til alvorsgrader genbruger eksempelteksten fra tilstandsformularen ord for ord, så hjælpeteksten taler om hændelsestilstande frem for alvorsgrader. Ignorér den, og skriv dine egne navne og beskrivelser til alvorsgrader.

Dér hvor alvorsgrad gør mere end at beskrive: på **Hændelser → Regler → Vagtregler** er en regels felt **Hændelse Alvorligheder** et matchkriterium. At nævne **Critical Incident** dér er måden, "tilkald databaseteamet ved alt kritisk" bliver udtrykt på — vagtpolitikken bor på reglen, ikke på alvorsgraden.

## At flytte en hændelse gennem dens tilstande

Der er fire måder, en hændelse skifter tilstand på:

- **Knapperne i sidehovedet.** Åbn en hændelse. Ligger dens aktuelle tilstand før den bekræftede tilstand, får du **Acknowledge** og **Løs**; ligger den mellem de to, får du **Løs**. Hver åbner en bekræftelsesdialog — **Acknowledge Incident** eller **Resolve Incident** — der også tilbyder **Vælg noteskabelon**, **Offentlig note** og **Underret statussideabonnenter**.
- **Tilstandstidslinjen.** Tilføj en række i hånden fra hændelsens side **Tilstandstidslinje** med **Hændelsesstatus**, **Begynder den** og **Underret statussideabonnenter**.
- **Massevis.** Listen over hændelser har massehandlingen **Skift tilstand** til at flytte flere hændelser på én gang.
- **Automatisk.** Et monitorkriterium med **Løs hændelse automatisk** slået til løser sin hændelse, når kriteriet ikke længere er opfyldt, og API'et kan opdatere tilstanden gennem `/api/incident-state-timeline`.

Hver eneste af dem skriver en tidslinjerække. Et tilstandsskift gør også et par ting, du ikke behøver at bede om: det skriver et punkt i hændelsesfeedet, tildeler en Hændelsesleder, hvis hændelsen ikke har en endnu, og opdaterer SLA-uret. At genåbne en løst hændelse starter en frisk SLA-optegnelse fra genåbningstidspunktet.

## Tilstandstidslinjen

Hændelsens side **Tilstandstidslinje** i hændelsens sidemenu er revisionssporet over hver tilstand, hændelsen har været i. Kortet på den side hedder **Statustidslinje**, og det er sorteret nyeste først.

**Kolonner:**

- **Hændelsesstatus** — en farvet plakette med tilstandens navn og farve.
- **Begynder den** — hvornår hændelsen gik ind i denne tilstand.
- **Slutter den** — hvornår den forlod den. Den aktuelle tilstand viser `Currently Active`.
- **Varighed** — tid brugt i tilstanden, talt op til nu for den aktuelle.
- **Abonnentnotifikationsstatus** — om statussidenotifikationen for dette skift blev sendt, sprunget over eller stadig afventer, med et link **flere detaljer** og — når afsendelsen fejlede — en handling **Retry**.

**Rækkehandlinger:**

- **Vis årsag** — åbner en dialog **Grundårsag**, der gengiver den markdown, der blev registreret med tilstandsskiftet.
- **Vis logge** — åbner en dialog, der forklarer hvorfor statussen ændrede sig, med en **Incident State Log**-fremviser.

Tidslinjerækker kan oprettes og slettes, men ikke redigeres. At slette den forkerte række skriver hændelsens historik om, så behandl det som et rettelsesværktøj frem for en oprydningsvane.

## Listen Aktive hændelser

**Hændelser → Aktive hændelser** er den liste, du holder øje med på en vagt. Definitionen er præcis én betingelse: hændelsens aktuelle tilstand er en tilstand, hvor `isResolvedState` er falsk. Intet andet tæller med — ikke alvorsgrad, ikke alder, ikke om nogen har bekræftet den.

Punktet i sidemenuen bærer et rødt tællemærke, der bruger den samme forespørgsel, så mærket og listen altid er enige. Er der intet at se, siger siden det.

Den praktiske konsekvens: enhver egen tilstand, du tilføjer, holder hændelser på denne liste. Det er som regel det, du vil have — "Mitigated" er ikke "færdig" — men det betyder også, at mærket først bliver ryddet, når hændelserne faktisk når den løste tilstand.

## At fortælle statussidens abonnenter om et tilstandsskift

Et tilstandsskift kan sende en e-mail til din statussides abonnenter, men det skal igennem flere porte. At forstå dem sparer en masse "hvorfor fik ingen besked"-fejlsøgning.

Notifikation bestilles per tidslinjerække med **Underret statussideabonnenter** (`shouldStatusPageSubscribersBeNotified`), afkrydsningsfeltet i dialogen ved tilstandsskift og på den manuelle tidslinjeformular. Er det slået fra, gemmes rækken med en oversprunget status og en forklaring. Er det slået til, sættes rækken i kø, og et baggrundsjob samler den op — jobbet kører hvert minut, så leveringen er hurtig, men ikke øjeblikkelig.

**Den kølagte række springes derefter over, hvis blot ét af disse gælder:**

- **Den nye tilstand er den oprettede tilstand.** Abonnenterne fik allerede besked, da hændelsen blev erklæret, så den første tidslinjerække sender med vilje ikke en besked mere.
- **Hændelsen har ingen monitorer knyttet.** Uden ressourcer er der ingen statusside at koble hændelsen til.
- **Hændelsen er ikke synlig på statussiden** (`isVisibleOnStatusPage` er slået fra).
- **Statussiden har hændelser slået fra** (`showIncidentsOnStatusPage` er slået fra). Den her gælder per statusside — andre sider, der viser den samme monitor, får stadig besked.

**Én ting mere, der ændrer udfaldet.** Skriver du en **Offentlig note** i dialogen ved tilstandsskift, markeres tidslinjerækken som allerede underrettet frem for at blive sat i kø. Det er noten selv, der når abonnenterne, så de får én besked i stedet for to. Begivenhedstypen bag den rene tilstandsskiftbesked er `Subscriber Incident State Changed`.

For hvem der modtager dem, og hvordan skabelonerne vælges, se [Abonnenter og meddelelser](/docs/status-pages/subscribers).

## At holde en hændelse væk fra statussiden

Tre uafhængige ting afgør, om en hændelse overhovedet er på den offentlige side, og alle tre skal være sande:

- **Vis hændelser** (`showIncidentsOnStatusPage`) på selve statussiden.
- **Synlig på statussiden** (`isVisibleOnStatusPage`) på hændelsen — en kontakt på hændelsens side **Indstillinger**. Den er slået til som standard og findes ikke i erklæringsguiden; et monitorkriterium kan sætte den med **Vis hændelse på statusside**.
- **Den aktuelle tilstand er ikke den løste tilstand.** Det er det, der fjerner en hændelse fra den aktive sektion: statussidens forespørgsel henter hændelser, hvis aktuelle tilstand er en hvilken som helst uløst tilstand. Du arkiverer eller lukker ikke noget — du løser det, og så flytter det over i historikken.

**Private hændelser dukker aldrig op.** At slå **Privat hændelse** til skjuler hændelsen fra alle statussider uanset kontakterne ovenfor og begrænser den til dens ejere plus projektadministratorer og -ejere.

Hvor meget løst historik siden beholder, er en indstilling på statussiden, ikke på hændelsen. Se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) for hvordan sidens monitorer afgør, hvilke hændelser der overhovedet dukker op.

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesområdet hænger sammen.
- [Opret en hændelse](/docs/incidents/declaring-incidents) — erklæringsguiden, skabelonerne og API'et.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige noter, private noter og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, regler og workflow-triggere.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får de e-mails, et tilstandsskift sender.
- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside viser, og for hvem.
- [Workflows – Oversigt](/docs/workflows/index) — at reagere på tilstandsskift med automatisering.
