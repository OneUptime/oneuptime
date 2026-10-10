# Kalenderfeeds

Kalenderfeeds lægger dine vagter ind i den kalender, du allerede kigger i. OneUptime udgiver et hemmeligt iCalendar-link (`.ics`) for hver person, hver vagtplan og hvert projekt; Google Kalender, Outlook, Apple Kalender, Thunderbird og enhver anden app, der kan abonnere på en kalender via en URL, henter linket med jævne mellemrum og viser én begivenhed pr. vagt. Der installeres intet, og ingen konto forbindes: linket er hele integrationen.

```mermaid title="Kalenderapps henter et hemmeligt link; nogle fra deres egne servere"
flowchart TB
    subgraph links["Hemmelige .ics-links"]
        direction LR
        personal["Personligt feed"]
        schedule["Vagtplanfeed"]
        project["Projektfeed"]
    end
    shifts["Vagtplaner, rotationer<br/>og overrides"] --> links
    links -->|"hentet fra deres servere"| serverApps["Google Kalender, Outlook på nettet"]
    links -->|"hentet fra din enhed"| deviceApps["Apple Kalender, Thunderbird, klassisk Outlook"]
```

> [!NOTE]
> En abonneret kalender er til **planlægning**. Kalenderapps henter feeds igen i deres eget tempo — Google Kalender kun hver 8. til 24. time — så et bytte, der laves en time før en vagt, når frem til dig via OneUptimes egne påmindelser, meddelelser om ny tildeling og tilkald, ikke via kalenderen.

## Hvad du får

- Én begivenhed pr. vagt med titlen `On-call · <Schedule>` (med ` · <Policy>` tilføjet, når vagtplanen er knyttet til præcis én eskaleringspolitik) i dit personlige feed og `<Name> · On-call · <Schedule>` i et delt feed. Beskrivelsen nævner, hvem der har vagt, vagtplanen og dens tidszone, laget, vagten i vagtplanens zone, i UTC og i din zone, hvilke eskaleringspolitikker der tilkalder dig via denne vagtplan, og et link til vagtplanen i dashboardet.
- Overrides respekteres. Når nogen dækker for dig, flytter begivenheden til dem (`(covering for <Name>)` tilføjes) og forbliver den samme begivenhed i din kalenderapp, så den opdateres på stedet i stedet for at blive dubleret. En delvis override deler vagten i begivenheder, der støder op til hinanden.
- To dages historik og 90 dage frem som standard. Du kan udvide det til 60 dage tilbage og 180 dage frem; et feed, der ville overstige 5.000 begivenheder, bliver afkortet og siger det i kalenderens beskrivelse.
- Begivenheder er markeret som ledige (`TRANSP:TRANSPARENT`), så et abonneret feed aldrig blokerer din tilgængelighed, og intet er markeret som privat, så en delt teamkalender viser titlerne for alle, der kan se den.
- Tider sendes i UTC og omregnes af din kalenderapp; beskrivelsen skriver klokkeslættet i vagtplanens zone og i din. Angiv din egen tidszone som **Tidszone** på din **Profil** (dit billede øverst til højre i dashboardet), og vagtplanens i dens kort **Schedule timezone** på dens side **Lag**. En vagtplan uden tidszone udregnes i serverens zone, ligesom ved tilkald, og begivenheden siger det.

Faste tildelinger — en bruger eller et team, der er nævnt direkte i en regel i en eskaleringspolitik — har ingen start eller slutning og vises ikke i noget feed. På OneUptime Cloud følger feeds samme plan som vagtplaner (Growth); et projekt under den plan får en tom kalender i stedet for en fejl.

## Tre slags links

| Link | Hvem opretter det | Hvad det indeholder | Hvor |
| --- | --- | --- | --- |
| **Personligt feed** | Hver bruger, ét pr. projekt | Dine vagter i alle vagtplaner i det projekt plus de vagter, hvor du dækker for nogen (valgfrit) | **Brugerindstillinger** > **Kalender** > **Kalenderfeed** |
| **Vagtplanfeed** | Alle, der kan redigere vagtplanen; alle, der kan læse den, kan kopiere linket | Alles vagter i én vagtplan, med valgfrie begivenheder for huller i dækningen | Vagtplanens side, kortet **Abonnér på denne vagtplan** |
| **Projektfeed** | Alle, der kan redigere vagtplaner; alle, der kan læse dem, kan kopiere linket | Alles vagter i alle projektets vagtplaner, med valgfrie begivenheder for huller i dækningen | **Vagtordning** > **Kalenderfeeds** |

Linkene ser sådan ud:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Tokenet på 43 tegn i stien er det eneste loginoplysning — der er intet login, ingen cookie og ingen API-nøgle involveret. Behandl hvert af disse links som en adgangskode.

## Dit personlige feed

Personlige feeds er pr. projekt: et andet projekt får et andet link og en anden kalender.

:::steps
### Åbn dit kalenderfeed

Åbn **Brugerindstillinger** > **Kalender** > **Kalenderfeed** i det projekt, hvis vagter du vil have. **Kalender** er et afsnit i sidemenuen, der starter foldet sammen.

### Generér linket

Klik på **Generér kalenderlink**. Kortet **Abonnér på dine vagter** tilbyder nu én måde at abonnere på:

- **Føj til din kalender**: **Google Kalender** åbner Google Kalender, som spørger, om kalenderen skal tilføjes. **Apple Kalender / Outlook** åbner linkets `webcal://`-form i den app, din computer eller telefon abonnerer med: Apple Kalender på en Mac, iPhone eller iPad, Outlook på Windows.
- **Eller kopiér linket**: **Kopiér link** kopierer `https://`-linket til enhver anden app, der kan abonnere på en kalender via en URL. Linket forbliver skjult på siden, indtil du klikker for at vise det.

### Abonnér på linket

Følg trinene for din app under "Abonnér i din kalenderapp" nedenfor. Dine vagter vises som begivenheder, næste gang appen henter linket: se "Hvor ofte kalendere opdateres".
:::

### Indstillinger for feedet

Klik på **Redigér indstillinger** på kortet **Indstillinger for kalenderfeed** for at ændre, hvad linket indeholder:

| Indstilling | Hvad den gør |
| --- | --- |
| **Medtag vagter, jeg dækker for andre** | Slået til som standard. Tilføjer de vagter, en override giver dig i vagtplaner, du ellers ikke er medlem af. |
| **Dage med tidligere vagter** | Hvor langt tilbage kalenderen rækker (standard 2, højst 60). |
| **Dage frem** | Hvor langt frem kalenderen rækker (standard 90, mellem 7 og 180). |

Statuslinjen viser, hvornår linket sidst blev hentet, af hvilken kalenderapp, hvor mange gange, og de sidste fire tegn i tokenet, så du kan skelne links fra hinanden. Har intet hentet linket efter to dage, spørger siden, om serveren kan nås fra internettet (se Fejlfinding).

### Administrer linket

| Handling | Hvad der sker |
| --- | --- |
| **Generér link igen** | Laver et nyt token. Alle apps, der abonnerer på det gamle link, holder op med at blive opdateret: i 30 dage leverer det gamle link en tom kalender, så de apps tømmer deres kopi, derefter svarer det 404. Abonnér igen med det nye link. |
| **Deaktivér** | Beholder linket, men leverer en tom kalender, indtil du aktiverer det igen. |
| **Slet** | Fjerner linket. Apps, der stadig henter det, får 404 og bliver ved med at vise det, de sidst hentede — deaktivér først, hvis du vil have dem til at tømme sig. |

### Kommende vagter og afløsning

Siden viser også dine **Upcoming shifts** (de næste 30 dage) og kortet **Påmind mig før vagter**, som er beskrevet længere nede. Hver af dine egne vagter har et link **Find afløser**: det åbner brugeroverrides i vagtens projekt med en ny override, der allerede er udfyldt for den vagt, med dig som **Hvem er fraværende?** og vagtens tider som **Starter** og **Slutter** (fra nu, hvis vagten er begyndt), så der kun mangler **Hvem dækker?**. Overriden sender alle dine tilkald i det tidsrum til den, der dækker, fra alle vagtpolitikker; en vagt, der kun findes inde i én politik, dækkes i stedet på den politiks side med brugeroverrides. En vagt, hvor du dækker for en anden, har ingen **Find afløser**: overrides kædes ikke sammen, så afløsning for en afløsning ville ikke ændre noget.

Det samme personlige link, filtreret til én vagtplan med `?schedule=<id>`, tilbydes som **Kun mine vagter i denne vagtplan** på hver vagtplans side, og vagtbanneret og siden **Mine vagtpolitikker** har et link **Føj dine vagter til din kalender** til siden ovenfor.

### I mobilappen

I mobilappen: **On-Call** > **Add shifts to my calendar** (også under **Settings** > **Calendar feed**), med ét link pr. projekt. På iPhone åbner **Open in Calendar** det indbyggede abonnementsark. På Android er der ingen måde at abonnere på en URL på telefonen, så skærmen tilbyder **Share link** og **Copy https link** og beder dig tilføje linket på en computer, hvorefter det synkroniseres til telefonen. Appens liste **Your shifts** kommer fra de samme data og har den samme handling **Get cover**.

## Abonnér i din kalenderapp

Brug **Google Kalender** eller **Apple Kalender / Outlook** i OneUptime, hvor din app har en knap; enhver anden app tager det `https://`-link, som **Kopiér link** giver dig. "https- og webcal-links" nedenfor forklarer de to former.

:::tabs
@tab Google Kalender
1. Klik på **Google Kalender** i OneUptime. Google Kalender åbner og spørger, om kalenderen skal tilføjes; klik på **Tilføj**.
2. Eller klik i Google Kalender på nettet ud for **Andre kalendere** på **+** > **Fra webadresse**, indsæt linket (**Kopiér link** i OneUptime), og klik på **Tilføj kalender**.

Knappen **Google Kalender** åbner Googles side til at tilføje via URL, `https://calendar.google.com/calendar/r?cid=` efterfulgt af linkets `webcal://`-form, procentkodet. Den side tager kun `webcal://`-formen: med `https://`-formen svarer Google "Unable to add calendar. Check the URL." **Fra webadresse** tager begge former.

Google henter feedet **fra Googles servere**, så OneUptime-serveren skal kunne nås fra internettet — OneUptime Cloud kan det altid; se Fejlfinding for en selvhostet installation. Den første hentning sker som regel inden for få minutter efter, at du abonnerer; derefter opdaterer Google cirka hver 8. til 24. time og nogle gange sjældnere. Der er ingen opdateringsknap for abonnerede kalendere, og Google ignorerer opdateringstipsene i feedet. Statuslinjen på feedsiden viser **Senest hentet … af Google Calendar**, når Google har læst linket.

Kalenderens navn og tidszone læses **kun første gang, du abonnerer**: omdøber du en vagtplan senere, omdøbes kalenderen ikke i Google — fjern den, og tilføj den igen, hvis navnet betyder noget. Google smider påmindelser i kalenderfiler væk, så angiv standardnotifikationer for den kalender i Googles indstillinger, eller endnu bedre: brug OneUptimes egne påmindelser. Google husker en adresse, det ikke kunne læse: når du har rettet det, der stoppede det, så tilføj linket igen med `?nocache=1` til sidst (OneUptime ignorerer ukendte forespørgselsparametre, så selve feedet er uændret), eller generér linket igen. Google Kalender-appen på Android og iOS kan ikke abonnere via URL; tilføj linket på en computer, så dukker det op på telefonen.
@tab Outlook på nettet
1. Åbn **Kalender** > **Tilføj kalender** > **Abonner fra internettet**.
2. Indsæt `https://`-linket (**Kopiér link** i OneUptime), giv kalenderen et navn, og klik på **Importér**.

Det virker på samme måde i Outlook.com, Outlook på nettet til arbejds- og skolekonti, nye Outlook til Windows og Outlook til Mac. Outlook henter **fra Microsofts servere**: cirka hver 3. time for Outlook.com og hver 4. til 6. time for arbejds- og skolekonti, nogle gange mere end et døgn. Intervallet ligger fast, og der er ingen manuel opdatering.

Abonnér her i stedet for i skrivebordsappen, hvis du også vil have kalenderen på din telefon og i Outlook på nettet — abonnementer, der oprettes i klassisk Outlook til Windows, bliver på den pc.
@tab Klassisk Outlook til Windows
1. Klik på en pc, hvor Outlook er installeret, på **Apple Kalender / Outlook** i OneUptime. Windows giver `webcal://`-linket videre til Outlook, som spørger, om internetkalenderen skal tilføjes. Uden Outlook har Windows ingen `webcal`-handler.
2. Eller åbn i Outlook **Filer** > **Kontoindstillinger** > **Kontoindstillinger** > **Internetkalendere** > **Ny**, indsæt linket (**Kopiér link** i OneUptime), og klik på **Tilføj**.

Åbn **ikke** selve `https://…/shifts.ics`-linket i klassisk Outlook: det importerer et engangsøjebliksbillede, der aldrig opdateres. At åbne `webcal://`-linket, eller at tilføje adressen under **Internetkalendere**, opretter et abonnement.

Feedet opdateres ved **Send/modtag** (F9, eller intervallet under Send/modtag-grupper). Abonnementets indstillinger har et afkrydsningsfelt **Opdateringsgrænse**: når det er markeret, opdaterer Outlook ikke hurtigere end det interval, udgiveren foreslår. OneUptime foreslår én time (`X-PUBLISHED-TTL:PT1H`), så feedet opdateres cirka hver time. Feeds uden det tip opdateres aldrig, mens feltet er markeret; OneUptimes har det, så du kan lade feltet være slået til. Klassisk Outlook henter feedet **fra din pc** og validerer serverens certifikat.
@tab Apple Kalender (macOS)
1. Klik på **Apple Kalender / Outlook** i OneUptime, eller vælg i Kalender **Arkiv** > **Nyt kalenderabonnement**, og indsæt linket.
2. Angiv **Opdater automatisk** i abonnementsarket — hvert 5. minut, 15. minut, hver time, dag eller uge (hver time er standard) — og vælg **iCloud** under **Placering**, så kalenderen også vises på din iPhone og iPad og bliver ved med at opdatere efter den plan.

macOS henter feedet **fra din Mac**, så det virker for en installation på et privat netværk, så længe Mac'en kan nå den. Et selvsigneret certifikat eller et certifikat fra en intern CA skal først være betroet i macOS-nøgleringen. **Fjern advarsler** er markeret som standard i det ark; det gør ingen forskel her, fordi feedet ikke indeholder alarmer.
@tab iPhone og iPad
For at abonnere på enheden skal du trykke på **Open in Calendar** i OneUptimes mobilapp eller gå til **Indstillinger** > **Kalender** > **Konti** > **Tilføj konto** > **Andet** > **Tilføj abonneret kalender** og indsætte linket.

Abonnementer, der oprettes på selve enheden, opdateres efter **Indstillinger** > **Kalender** > **Konti** > **Hent nye data** — **Automatisk** som standard, hvilket mest henter under opladning på Wi-Fi. For en pålidelig opdatering skal du abonnere på en Mac med **iCloud** som placering eller sætte **Hent nye data** til et fast interval.
@tab Thunderbird
Vælg **Filer** > **Ny** > **Kalender** > **På netværket** > **iCalendar (ICS)**, indsæt `https://`-linket, og vælg et opdateringsinterval i kalenderens egenskaber: 1, 5, 15, 30 eller 60 minutter. Thunderbird henter **fra din computer** og skal have tillid til serverens certifikat.
@tab Android
Hverken Google Kalender-appen eller Samsung Kalender kan abonnere på en URL. Føj `https://`-linket til Google Kalender på en computer (**Andre kalendere** > **+** > **Fra webadresse**); kalenderen synkroniseres derefter til telefonen sammen med alt andet i den Google-konto. OneUptimes mobilapp på Android tilbyder **Share link** og **Copy https link** præcis til dette.
@tab Andre tjenester
Fastmail opdaterer cirka hver time og **deaktiverer et abonnement efter fem mislykkede hentninger i træk**; sker det, så tilføj det igen, når serveren er sund. Proton Calendar opdaterer hver 4. til 16. time og afviser meget store feeds — sænk **Dage frem**, hvis den klager. Confluence Team Calendars tager imod vagtplanfeedet; dens grænse på 28 tegn for kalendernavne overholdes.
:::

## Hvor ofte kalendere opdateres

| Kalenderapp | Typisk opdatering | Henter fra | Bemærkninger |
| --- | --- | --- | --- |
| Google Kalender (Fra webadresse) | 8–24 timer, nogle gange længere | Googles servere | Ingen manuel opdatering; ignorerer opdateringstips; navn og tidszone læses kun ved første abonnement |
| Outlook.com | Cirka 3 timer | Microsofts servere | Fast; kan overstige 24 timer |
| Outlook på nettet (arbejde, skole) | Cirka 4–6 timer | Microsofts servere | Fast; kan ikke styres af brugeren |
| Klassisk Outlook til Windows | Ved Send/modtag; cirka hver time med **Opdateringsgrænse** | Din pc | Abonnér via `webcal`-linket; synkroniseres ikke til telefon eller net |
| Apple Kalender (macOS) | 5 minutter til ugentligt, standard hver time | Din Mac | Gem i iCloud for at nå iPhone og iPad |
| Apple Kalender (kun iOS) | Efter **Hent nye data**, afhængigt af batteriet | Din telefon | Abonnér på en Mac for pålidelighed |
| Thunderbird | 1–60 minutter | Din computer | |
| Fastmail | Cirka hver time | Fastmails servere | Deaktiveres efter fem mislykkede hentninger |
| Proton Calendar | 4–16 timer | Protons servere | Afviser store feeds |

OneUptime selv leverer friske data: en ændring af et lag, en rotation, en override eller en tilknytning til en politik gør feedet ugyldigt med det samme, og svar caches i højst fem minutter. Den ventetid, du ser, er kalenderappens, ikke serverens. OneUptime foreslår opdatering hver time via `REFRESH-INTERVAL` og `X-PUBLISHED-TTL`; kun klassisk Outlook følger tipset, og kun med **Opdateringsgrænse** slået til — Apple Kalender, Thunderbird og resten opdaterer med det interval, du angiver pr. kalender.

## https- og webcal-links

Begge peger på det samme feed. `webcal://` er linket med et andet skema, så operativsystemet åbner en kalenderapp i stedet for en browser; appen henter derefter feedet over `https://`, når serveren leverer https, som Apple Kalender og Google Kalender gør.

- **Kopiér link** giver `https://`-formen. Google Kalenders **Fra webadresse**, Outlook på nettet, Thunderbird og Fastmail tager den.
- **Apple Kalender / Outlook** åbner `webcal://`-formen: Apple Kalender og klassisk Outlook til Windows abonnerer ud fra den. I klassisk Outlook er det at åbne `https://`-formen i stedet en engangsimport.
- **Google Kalender** lægger `webcal://`-formen ind i Googles link til at tilføje via URL, den eneste form, den side tager.
- OneUptime udleverer ikke længere `webcals://`: iOS åbner det ikke ("adressen er ugyldig"), og Google tager det heller ikke. En kalender, du allerede abonnerer på med et `webcals://`-link, bliver ved med at virke.
- Kører din installation stadig på almindelig `http`, hentes feedet i klartekst, token medregnet, og dashboardet viser en advarsel ved linket; skift til `https`, før du deler links bredt.

Feed-URL'er omdirigerer aldrig. De svarer `200` på det skema, der når OneUptime, fordi appen ikke kan se, hvilket skema kalenderappen brugte, når TLS slutter foran den — på OneUptime Cloud eller bag din egen load balancer eller CDN — og en omdirigering dér peger tilbage på den samme URL. Send almindelig `http` videre til `https` på den proxy, der afslutter TLS, det ene hop, der ved det.

## Påmindelser og meddelelser om ny tildeling

Kalenderapps leverer ikke alarmer fra abonnerede feeds — Google smider dem væk, Apple fjerner dem som standard, Outlook flader dem ud — så OneUptime sender sine egne.

:::steps
1. Åbn **Brugerindstillinger** > **Kalender** > **Kalenderfeed**.
2. Vælg på kortet **Påmind mig før vagter**, hvor lang tid i forvejen: **1 uge**, **1 dag**, **1 time**, **15 min.** eller, med **Brugerdefineret**, en egen værdi mellem 15 minutter og 14 dage. Du kan vælge flere på én gang.
3. Vælg, hvordan påmindelser når dig, under **Før min vagt starter** på **Brugerindstillinger** > **Notifikationsindstillinger** (fanen Vagt). E-mail og push er slået til som standard.
:::

Hver påmindelse sendes én gang pr. vagt. Beskeden nævner vagtplanen, de politikker, den tilkalder igennem, og starttidspunktet i din tidszone.

- En vagt, der på grund af en sen override lander inden for et af dine påmindelsestidspunkter — nogen giver dig en vagt 20 minutter før, den starter — får straks én indhentningspåmindelse.
- Gives en vagt, du er blevet påmindet om, til en anden, får du **Min kommende vagt bliver tildelt en anden**, en særskilt hændelsestype, så den kan gøres lydløs for sig.
- Påmindelser sendes aldrig, efter en vagt er begyndt, og aldrig for vagtplaner, der ikke er knyttet til nogen eskaleringspolitik, fordi de ikke kan tilkalde nogen.
- På WhatsApp kommer en påmindelse via Metas forhåndsgodkendte vagtskabelon, som nævner vagtplanen og eskaleringspolitikken og linker til vagtplanen, men ikke indeholder starttidspunktet, og som WhatsApp kun leverer på engelsk. Meddelelser om ny tildeling har ingen godkendt WhatsApp-skabelon, så de når dig via dine andre kanaler i stedet.

## Delte links til en vagtplan eller et projekt

Et delt link tilhører **projektet**, ikke den, der kopierede det, og det viser folks navne, aldrig deres e-mailadresser. Læg vagtplanlinket ind i en delt teamkalender — Google, Outlook eller Confluence — så betjener ét abonnement hele teamet.

### Vagtplanfeed

På en vagtplans side har kortet **Abonnér på denne vagtplan** to halvdele: **Kun mine vagter i denne vagtplan** (dit personlige link med et vagtplanfilter) og **Alles vagter i denne vagtplan (delt teamlink)**. Alle med tilladelsen **Rediger** på vagtplaner kan bruge **Udgiv delt link**, forny linket med **Generér link igen** eller slå det fra med **Deaktivér**; alle, der kan læse vagtplanen, kan kopiere det. Kortet viser, hvornår linket sidst blev fornyet.

### Projektfeed

**Vagtordning** > **Kalenderfeeds** indeholder kortet **Alles vagter i dette projekt (delt link)** — ét delt link, der dækker alle vagtplaner i projektet — med de samme handlinger til at udgive, generere igen og deaktivere og et link til siden med dit personlige feed.

### Indstillinger for delte links

Klik på **Redigér indstillinger** på kortet **Indstillinger for delt link**:

| Indstilling | Hvad den gør |
| --- | --- |
| **Vis huller i dækningen** | Slået fra som standard. Tilføjer en begivenhed `No coverage · <Schedule>`, overalt hvor et lag _skal_ dække, men ingen har vagt: et tomt lag, et lag, hvis startdato ligger i fremtiden, lag, der ikke passer sammen, eller ethvert hul i en vagtplan, der kører 24×7. Timer uden for arbejdstid i en vagtplan for arbejdstid meldes aldrig, og der udsendes højst 100 hulbegivenheder, ældste først. |
| **Mindste hul at vise (minutter)** | Standard 60. Skjuler kortere huller. |
| **Generér igen, når nogen forlader projektet** | Slået fra som standard. Genererer linket igen automatisk, når nogen forlader sit sidste team i projektet, så en tidligere kollegas kalender holder op med at blive opdateret. Alle andre skal abonnere igen bagefter, og derfor skal man selv slå det til. |
| **Dage med tidligere vagter**, **Dage frem** | Som på det personlige feed. |

Forny et delt link, når nogen, der havde det, forlader projektet, eller slå den automatiske fornyelse ovenfor til.

Når en person forlader sit sidste team i et projekt, fjerner OneUptime også personen fra projektets vagtplanlag og eskaleringsregler, sletter projektets aktive og fremtidige overrides, der nævner personen (enten som den, der bliver dækket, eller som afløser), deaktiverer personens personlige feed for projektet og sletter personens påmindelser dér. Et personligt link viser kun vagter, så længe ejeren er medlem af projektet: det kontrolleres, hver gang linket hentes, så den, der er gået, får en tom kalender, og listen over kommende vagter i mobilappen omfatter kun de projekter, personen stadig er medlem af.

## Begivenheder i detaljer

- Hver vagt har en fast identitet ud fra vagtplanen og vagtens start, så den samme vagt er den samme begivenhed i dit personlige feed, i vagtplanfeedet og efter, at du har genereret et link igen. Kalenderapps opdaterer den på stedet; en ændring øger begivenhedens sekvensnummer.
- En override, der bytter hele vagten, beholder begivenheden og skifter personen; en override, der dækker en del af en vagt, giver tre begivenheder, der støder op til hinanden, fx A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Når en vagtplan er knyttet til to eller flere eskaleringspolitikker, og en override kun gælder for én af dem, er det forskellige personer, der tilkaldes pr. politik. Feedet viser det i stedet for at skjule det: vagten beholder sin begivenhed for den person, de andre politikker tilkalder, med en bemærkning, der nævner den politik, der tilkalder en anden, og afløseren får en ekstra begivenhed med titlen `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vagter i fortiden har linjen "Past shifts reflect the current rotation, not who was actually paged" i deres beskrivelse.
- En vagtplan, der ikke er knyttet til nogen eskaleringspolitik, vises stadig, med en bemærkning om, at den ikke vil tilkalde nogen.

## Planlægning, ikke revision

Feedet viser rotationen, **som den er sat op nu**, også for tidligere dage: en override, der indtastes bagefter, omskriver historikken i kalenderen. Til de timer, der faktisk er brugt på vagt, til vurderinger af fordelingen og til kompensation skal du bruge **Vagtordning** > **Rapporter** > **Brugerens vagttid**, som bygger på, hvad personsøgeren faktisk gjorde.

## Sikkerhed

- Tokenet i linket er den eneste loginoplysning. Alle, der har linket, ser vagterne — navne, vagtplaner, politikker — indtil det genereres igen. Indsæt ikke links i chatrum eller sager; når et team har brug for en kalender, så del vagtplan- eller projektlinket i stedet for dit personlige.
- Links er pr. projekt. Et lækket personligt link afslører ét projekts vagter, ikke alle de projekter, du er med i.
- At generere et link igen flytter det gamle token ind i en henstandsperiode på 30 dage (tom kalender, derefter 404). **Deaktivér** leverer en tom kalender. Et ukendt eller udløbet link giver en ren 404 uden hint. Tomme kalendere får abonnerede apps til at tømme deres kopi; en 404 får dem til at beholde den, og derfor leverer deaktivering og ny generering tomme kalendere.
- Tokens gemmes hashet; kopien på indstillingssiden er krypteret med `ENCRYPTION_SECRET`. Sæt den variabel til en rigtig hemmelighed på en selvhostet installation — serveren advarer ved opstart, når den ikke er sat eller stadig er en af de pladsholdere, dette repository leverer (`secret`, eller den `please-change-this-to-random-value`, som `config.example.env` sætter). Ændrer du den senere, tilbyder siden **Generér link igen**, fordi den gemte kopi ikke længere kan læses; feedet virker videre, indtil du gør det.
- Feedsvar er mærket `Cache-Control: private`, udelukkes fra søgemaskiner (`X-Robots-Tag: noindex`) og har en hastighedsgrænse pr. link og pr. klientadresse.

OneUptimes egen Nginx holder feedforespørgsler ude af sine logs:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Så havner et token aldrig i en logfil ved siden af en klientadresse; applikationen logger det heller aldrig. `access_log off` dropper linjen pr. forespørgsel, `error_log` dropper de linjer, Nginx skriver, når en hentning fra upstream mislykkes — uden den bliver tokenet registreret for hver klient, der henter under en genstart — og `proxy_max_temp_file_size 0` holder et stort feed ude af en midlertidig fil.

> [!WARNING]
> **Enhver proxy, WAF eller CDN, du kører foran OneUptime, logger stadig hele URI'en, i sin adgangslog og i sin fejllog,** medmindre du konfigurerer den til at lade være — tjek det, før du ruller feeds ud.

## Konfiguration ved selvhosting

Intet skal slås til: feeds virker på alle installationer. Fire miljøvariabler styrer dem, sat i `config.env` til Docker Compose eller under `onCallCalendarFeed` i Helm-værdierne (se chartets [konfigurationsreference](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel | Helm-værdi | Standard | Virkning |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Nødstop. Hver feed-URL svarer `503` med `Retry-After: 3600`; abonnerede apps beholder deres kopi og prøver igen senere. Intet slettes. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Længden af vinduet for hastighedsgrænsen. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Hentninger, ét link må foretage fra én klientadresse pr. vindue. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Hentninger, én klientadresse må foretage på tværs af alle links pr. vindue — loftet for et helt kontor bag én adresse. |

Også relevant:

- **`HOST` og `HTTP_PROTOCOL`** bygger linkene. Er `HOST` tom eller `localhost`, eller er `HTTP_PROTOCOL` `http`, viser feedsiden en advarsel, og linkene virker ikke udefra. Er `HOST` en privat adresse — `10.x`, `172.16–31.x`, `192.168.x`, et navn uden punktum såsom et containernavn eller et navn under `.internal`, `.local`, `.lan` og lignende — siger siden, at Google Kalender og Outlook på nettet ikke kan nå linket; apps på en computer i samme netværk kan stadig.
- **`TRUSTED_PROXY_HOPS`** afgør, hvilken adresse grænsen pr. adresse tæller. Standarden `1` passer til de medfølgende Docker Compose- og Helm-opsætninger; læg én til for hver egen proxy — en CDN, WAF eller load balancer — der føjer til `X-Forwarded-For`, ellers ligner hver kalenderklient den samme adresse og deler ét budget. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i chartets dokumentation.
- **Redis** understøtter cachene og hastighedsbegrænseren. Begge falder pænt tilbage: uden Redis bygges feeds stadig, bare langsommere, og begrænseren lukker forespørgsler igennem.
- I Helm-chartets opdelte tilstand (`worker.enabled: true`) bygges feeds på API-laget, så dimensionér det lag til en bølge af kalenderklienter, der henter ved hvert hele klokkeslæt.
- Undtagelsen for Nginx-adgangsloggen ovenfor er en del af den medfølgende `packages/Nginx/default.conf.template`; behold den, hvis du tilpasser skabelonen.

## Fejlfinding

:::details Google Kalender siger "Unable to add calendar. Check the URL."
Ældre versioner af OneUptime lagde linkets `https://`-form i knappen **Google Kalender**, og Googles side til at tilføje via URL tager kun `webcal://`-formen. Genindlæs feedsiden, og klik på **Google Kalender** igen, eller tilføj linket under **Andre kalendere** > **+** > **Fra webadresse**.
:::

:::details Google Kalender viser kalenderen, men ingen vagter
Tjek først statuslinjen på feedsiden. **Senest hentet … af Google Calendar** betyder, at Google har læst linket: åbn linket i en browser, og se, hvad det leverer — en tom kalender angiver sin årsag i `X-WR-CALDESC` (se "Kalenderen er tom" nedenfor).

**Ikke hentet endnu** betyder, at Google ikke kunne læse det: fra en maskine uden for dit netværk skal `curl -sI <link>` straks svare `200` med `Content-Type: text/calendar`. En omdirigering, en loginside, en firewall eller et bottjek foran OneUptime stopper Googles henter; det gjorde en omdirigeringsløkke i ældre versioner af OneUptime også, på installationer med `PROVISION_SSL=true`, hvis TLS slutter foran Nginx. Når det svarer `200`, så tilføj linket igen med `?nocache=1` til sidst, så Google læser det på ny.
:::

:::details Intet har hentet linket, eller "Webadressen kunne ikke hentes"
Google Kalender, Outlook på nettet, Fastmail og Proton henter **fra deres egne servere**, så OneUptime-værten skal kunne nås fra det offentlige internet med et certifikat, de har tillid til. En installation på et privat netværk, bag en VPN eller med en intern certifikatudsteder er uopnåelig for dem, uanset hvad du indsætter.

Apple Kalender, Thunderbird og klassisk Outlook henter fra enheden, så de virker overalt, hvor enheden kan åbne dashboardet — når certifikatet er betroet på den enhed, hvis det er selvsigneret. Statuslinjen på feedsiden fortæller dig, om noget har hentet linket endnu; `curl -I` mod linket uden for dit netværk er det hurtigste tjek:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

At lade OneUptime _nå_ private netværk — [Adgang til privat netværk](/docs/self-hosted/private-network-access) — er en anden sag og hjælper ikke her.
:::

:::details Kalenderen er forældet
Læs først opdateringstabellen: for Google er forsinkelsen normal. For at få Google til at kigge igen skal du fjerne kalenderen og tilføje den igen eller sætte `?nocache=1` efter linket (ukendte parametre ignoreres, så feedet er uændret, men Google behandler det som nyt). Tryk på F9 i klassisk Outlook, og tjek indstillingen **Opdateringsgrænse**. Brug **Oversigt** > **Opdater kalendere** i Apple Kalender. Betyder en ændring samme dag noget, så stol på OneUptimes påmindelser og meddelelser om ny tildeling i stedet for på kalenderen.
:::

:::details Kalenderen er tom
En tom kalender er tilsigtet. Det betyder, at linket er deaktiveret, er et gammelt link inden for sin henstandsperiode på 30 dage efter ny generering, at projektet er under den plan, der omfatter vagtplaner, eller at du ikke længere er på nogen vagtplan i det projekt. Åbn linket i en browser: kalenderbeskrivelsen (`X-WR-CALDESC`) angiver årsagen. Hvis du har forladt projektet, forbliver linket tomt: det viser kun vagter, så længe du er medlem.
:::

:::details Linket svarer 404
Linket er ukendt, er blevet slettet, eller dets henstandsperiode er slut. Generér et nyt, og abonnér igen.
:::

:::details Linket svarer 503
Enten er `DISABLE_ON_CALL_CALENDAR_FEED` sat, eller serveren har travlt: der bygges højst nogle få feeds ad gangen, og en vagtplan, der tager meget lang tid at udregne, afbrydes. Findes der en tidligere kopi af feedet, leverer serveren den i stedet, med headeren `Warning: 110`, så en 503 betyder, at der ikke var noget at falde tilbage på. Klienter beholder deres seneste kopi og prøver igen efter intervallet i `Retry-After`. Fastmail deaktiverer et abonnement efter fem fejl i træk; tilføj det igen, når serveren er sund. Metrikken `oncall_calendar_render_duration_ms` viser driftsfolk, hvilke feeds der er langsomme.
:::

:::details 429 eller "too many requests"
Mange klienter bag én adresse — en kontor-NAT, en VPN-gateway — deler budgettet pr. adresse. Hæv `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, og tjek `TRUSTED_PROXY_HOPS`: når den er for lav, tilskrives hver klient din egen proxy, og de deler alle ét budget.
:::

:::details Certifikatfejl i Apple Kalender, Thunderbird eller Outlook
Disse apps validerer TLS på enheden. Importér din interne CA i enhedens tillidslager — macOS-nøgleringen, Windows' certifikatlager, Thunderbirds certifikathåndtering — eller brug et offentligt betroet certifikat. Hentere på serversiden, som Googles og Microsofts, kan ikke fås til at stole på en privat CA.
:::

:::details Tiderne er forkerte
Alle tider i filen er UTC; kalenderappen omregner til sin egen zone. Ser vagterne ud til at være forskudt med en fast forskel, så tjek vagtplanens tidszone (**Schedule timezone** på dens side **Lag**) og din egen (**Tidszone** på din **Profil**). En vagtplan uden tidszone udregnes i serverens zone, og begivenheden siger det.
:::

:::details Feedet siger, at det er blevet afkortet
Mere end 5.000 begivenheder faldt inden for vinduet. Sænk **Dage frem**, eller abonnér på **Kun mine vagter i denne vagtplan** i stedet for et helt projekt.
:::

:::details Google viser et gammelt kalendernavn
Google læser kun navnet ved første abonnement; fjern kalenderen, og tilføj den igen.
:::

:::details Indstillingssiden siger, at linket skal genereres igen
`ENCRYPTION_SECRET` er ændret, siden linket blev oprettet, så serveren kan ikke længere vise det. Det eksisterende abonnement virker videre; at generere igen giver dig et link, du kan kopiere igen, og trækker det gamle tilbage efter 30 dage.
:::

:::details En vagt mangler i mit feed
Kun vagter fra vagtplaner vises; direkte tildelinger af brugere eller teams i en politikregel er faste og har ingen begivenheder. En vagt, som en anden har overtaget via en override, forsvinder fra dit feed, fordi den nu er i deres. Slå **Medtag vagter, jeg dækker for andre** til for at se vagter, du har fået via overrides i vagtplaner, du ikke er medlem af.
:::

## Næste trin

:::cards
- [Vagtplaner](/docs/on-call/schedules): Opsæt de rotationer, dine feeds viser.
- [Tidslinje for vagtplaner](/docs/on-call/schedule-timeline): Se alle vagtplaner side om side i dashboardet.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Knyt vagtplaner til politikker, så deres vagter tilkalder folk.
:::
