# Kalenderfeeds (vagter i Google Kalender, Outlook og Apple Kalender)

Kalenderfeeds lægger dine vagter ind i den kalender, du allerede kigger i. OneUptime udgiver et hemmeligt iCalendar-link (`.ics`) for hver person, hver vagtplan og hvert projekt; Google Kalender, Outlook, Apple Kalender, Thunderbird og enhver anden app, der kan abonnere på en kalender via en URL, henter det link løbende og viser én begivenhed pr. vagt. Intet installeres, og ingen konto forbindes: linket er hele integrationen.

> **Note:** En abonneret kalender er til **planlægning**. Kalender-apps genindlæser feeds i deres eget tempo — Google Kalender kun hver 8.–24. time — så et bytte foretaget en time før en vagt når dig via OneUptimes egne påmindelser, omfordelingsbeskeder og pager-notifikationer, ikke via kalenderen.

## Hvad du får

- Én begivenhed pr. vagt med titlen `On-call · <Schedule>` i dit personlige feed og `<Name> · On-call · <Schedule>` i et delt feed. Beskrivelsen angiver, hvem der har vagt, vagtplanen og dens tidszone, laget, vagten i vagtplanens zone, i UTC og i din zone, hvilke eskaleringspolitikker der kalder dig via denne vagtplan, og et link til vagtplanen i dashboardet.
- Overrides respekteres. Når nogen dækker for dig, flyttes begivenheden til den person (`(covering for <Name>)` tilføjes) og forbliver den samme begivenhed i din kalender-app, så den opdateres på stedet i stedet for at blive duplikeret. Et delvist override deler vagten op i sammenhængende begivenheder.
- To dages historik og 90 dage frem som standard. Du kan udvide til 60 dage tilbage og 180 dage frem; et feed, der ville overstige 5.000 begivenheder, forkortes og fortæller det i kalenderbeskrivelsen.
- Begivenheder er markeret som ledige (`TRANSP:TRANSPARENT`), så et abonneret feed blokerer aldrig din tilgængelighed, og intet er markeret privat, så en delt teamkalender viser titlerne til alle, der kan se den.
- Tidspunkter sendes i UTC og konverteres af din kalender-app; beskrivelsen angiver klokkeslættet i vagtplanens zone og i din. Indstil din egen tidszone under **Brugerindstillinger** > **Profil** og vagtplanens under dens fane **Indstillinger**. En vagtplan uden tidszone beregnes i serverens zone, ligesom ved kald, og begivenheden fortæller det.

Faste tildelinger — en bruger eller et team, der er navngivet direkte i en regel i en eskaleringspolitik — har hverken start eller slut og optræder ikke i noget feed. På OneUptime Cloud følger feeds samme plan som vagtplaner (Growth); et projekt under den plan får en tom kalender i stedet for en fejl.

## Tre slags links

| Link                | Hvem opretter det                                                            | Hvad det indeholder                                                                            | Hvor                                                   |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Personligt feed** | Hver bruger, ét pr. projekt                                                  | Dine vagter på alle vagtplaner i projektet, plus de vagter hvor du dækker for nogen (valgfrit) | **Brugerindstillinger** > **Kalenderfeed**             |
| **Vagtplan-feed**   | Alle, der kan redigere vagtplanen; alle, der kan læse den, må kopiere linket | Alles vagter på én vagtplan, med valgfri begivenheder for dækningshuller                       | Vagtplanens side, kortet **Abonnér på denne vagtplan** |
| **Projekt-feed**    | Alle, der kan redigere vagtplaner; alle, der kan læse dem, må kopiere linket | Alles vagter på alle vagtplaner i projektet, med valgfri begivenheder for dækningshuller       | **Vagt** > **Kalenderfeeds**                           |

Linkene ser sådan ud:

```
https://<din host>/api/on-call-calendar/user/<token>/shifts.ics
https://<din host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<din host>/api/on-call-calendar/project/<token>/project.ics
```

Tokenet på 43 tegn i stien er den eneste legitimation — der er hverken login, cookie eller API-nøgle involveret. Behandl hvert af disse links som en adgangskode.

## Dit personlige feed

1. Åbn **Brugerindstillinger** > **Kalenderfeed** i det projekt, hvis vagter du vil have. Personlige feeds er pr. projekt: et andet projekt får et andet link og en anden kalender.
2. Klik på **Generér kalenderlink**. Kortet **Abonnér på dine vagter** viser nu `https://`-linket og tre knapper:
   - **Google Kalender** åbner Google Kalender med linket udfyldt.
   - **Apple / andre apps** åbner `webcals://`-formen af linket, som macOS, iOS og de fleste desktop-apps sender direkte til deres abonnementsdialog.
   - **Kopiér webcal-link** kopierer det samme `webcal(s)://`-link — det, som klassisk Outlook til Windows har brug for.
3. Abonnér i din kalender-app med trinnene pr. app nedenfor.

Indstillinger på samme kort:

- **Medtag vagter, jeg dækker for andre** (slået til som standard) tilføjer de vagter, et override giver dig på vagtplaner, du ellers ikke er medlem af.
- **Dage med tidligere vagter** (standard 2, højst 60) og **Dage frem** (standard 90, mellem 7 og 180).

Statuslinjen viser, hvornår linket sidst blev hentet, af hvilken kalender-app, hvor mange gange, og de sidste fire tegn i tokenet, så du kan skelne links fra hinanden. Hvis intet har hentet linket efter to dage, spørger siden, om serveren kan nås fra internettet (se Fejlfinding).

Siden viser også dine **Kommende vagter** (de næste 30 dage), hver med et link **Find afløser**, der åbner brugeroverrides udfyldt for den vagt, og kortet **Påmind mig før vagter**, som beskrives længere nede.

Handlinger:

- **Generér link igen** laver et nyt token. Enhver app, der abonnerer på det gamle link, holder op med at opdatere: i 30 dage leverer det gamle link en tom kalender, så de apps rydder deres kopi, derefter svarer det 404. Abonnér igen med det nye link.
- **Deaktivér** beholder linket men leverer en tom kalender, indtil du aktiverer det igen.
- **Slet** fjerner linket. Apps, der stadig henter det, får 404 og bliver ved med at vise det, de sidst hentede — deaktivér først, hvis du vil have dem til at tømme sig.

Det samme personlige link, filtreret til én vagtplan med `?schedule=<id>`, tilbydes som **Kun mine vagter på denne vagtplan** på hver vagtplans side, og vagtbanneret og siden **Mine vagtpolitikker** har et link **Føj dine vagter til din kalender** til siden ovenfor.

I mobilappen: **Vagt** > **Føj vagter til min kalender** (også under **Indstillinger** > **Kalenderfeed**), med ét link pr. projekt. På iPhone åbner **Åbn i Kalender** det indbyggede abonnementsark. På Android er der ingen måde at abonnere på en URL på telefonen, så skærmen tilbyder **Del link** og **Kopiér https-link** og beder dig tilføje linket på en computer, hvorefter det synkroniseres til telefonen. Appens liste **Dine vagter** kommer fra de samme data og har samme handling **Find afløser**.

## Abonnér i din kalender-app

Brug `https://`-linket, medmindre appen beder om `webcal`; afsnittet om skemaer nedenfor forklarer forskellen.

### Google Kalender (web)

1. I Google Kalender på nettet klikker du ved siden af **Andre kalendere** på **+** > **Fra webadresse**.
2. Indsæt `https://`-linket, og klik på **Tilføj kalender**. Knappen **Google Kalender** i OneUptime gør det samme med linket udfyldt.

Google henter feedet **fra Googles servere**, cirka hver 8.–24. time og nogle gange sjældnere. Der er ingen opdateringsknap for abonnerede kalendere, og Google ignorerer opdateringshints i feedet. Kalenderens navn og tidszone læses **kun ved første abonnement**: omdøbes en vagtplan senere, omdøbes kalenderen i Google ikke — fjern den og tilføj den igen, hvis navnet betyder noget. Google smider påmindelser i kalenderfiler væk, så sæt standardnotifikationer på den kalender i Googles indstillinger, eller endnu bedre, brug OneUptimes egne påmindelser. Hvis Google melder, at det ikke kunne hente URL'en, så tjek, at du indsatte `https://`-formen og ikke `webcal://`, og tilføj `?nocache=1` for at få den til at kigge igen (OneUptime ignorerer ukendte forespørgselsparametre, så selve feedet er uændret). Google Kalender-appen på Android og iOS kan ikke abonnere via URL; tilføj linket på en computer, så dukker det op på telefonen.

### Outlook på nettet og Outlook.com

1. Åbn **Kalender** > **Tilføj kalender** > **Abonner fra internettet**.
2. Indsæt `https://`-linket, giv kalenderen et navn, og klik på **Importér**.

Outlook henter **fra Microsofts servere**: cirka hver 3. time for Outlook.com og hver 4.–6. time for arbejds- og skolekonti, nogle gange mere end et døgn. Intervallet er fast, og der er ingen manuel opdatering. Abonnér her i stedet for i desktop-appen, hvis du også vil have kalenderen på din telefon og i Outlook på nettet — abonnementer oprettet i klassisk Outlook til Windows bliver på den pc. Det nye Outlook til Windows og Outlook til Mac bruger samme dialog **Tilføj kalender** > **Abonner fra internettet**.

### Klassisk Outlook til Windows

1. Klik på **Kopiér webcal-link** i OneUptime.
2. I Outlook åbner du **Filer** > **Kontoindstillinger** > **Kontoindstillinger** > **Internetkalendere** > **Ny**, indsætter `webcals://`-linket og klikker på **Tilføj**. At åbne et `webcal`-link i en browser virker også på en pc, hvor Outlook er installeret; ellers har Windows ingen `webcal`-handler.

Åbn **ikke** selve `https://…/shifts.ics`-linket i klassisk Outlook: det importerer et engangs-øjebliksbillede, der aldrig opdateres. Kun `webcal://` og `webcals://` opretter et abonnement.

Feedet opdateres ved **Send/modtag** (F9, eller intervallet under Send/modtag-grupper). Abonnementets indstillinger har et afkrydsningsfelt **Opdateringsgrænse**: er det markeret, opdaterer Outlook ikke hurtigere end det interval, udgiveren foreslår. OneUptime foreslår én time (`X-PUBLISHED-TTL:PT1H`), så feedet opdateres cirka hver time. Feeds uden det hint opdateres aldrig, mens feltet er markeret; OneUptimes har det, så du kan lade feltet være markeret. Klassisk Outlook henter feedet **fra din pc** og validerer serverens certifikat.

### Apple Kalender på macOS

1. Klik på **Apple / andre apps** i OneUptime, eller vælg i Kalender **Arkiv** > **Nyt kalenderabonnement** og indsæt linket.
2. I abonnementsarket sætter du **Opdater automatisk** — hvert 5. minut, 15. minut, hver time, dag eller uge (hver time er standard) — og vælger **iCloud** under **Placering**, så kalenderen også vises på din iPhone og iPad og bliver ved med at opdatere i det tempo.

macOS henter feedet **fra din Mac**, så det virker for en installation på et privat netværk, så længe Mac'en kan nå den. Et selvsigneret eller internt CA-udstedt certifikat skal først have tillid i macOS-nøgleringen. **Fjern advarsler** er markeret som standard i det ark; det gør ingen forskel her, fordi feedet ikke indeholder alarmer.

### iPhone og iPad

Abonnementer oprettet på selve enheden opdateres efter **Indstillinger** > **Kalender** > **Konti** > **Hent nye data** — **Automatisk** som standard, hvilket mest henter under opladning på Wi-Fi. For pålidelig opdatering skal du abonnere på en Mac med **iCloud** som placering eller sætte **Hent nye data** til et fast interval. For at abonnere på enheden trykker du på **Åbn i Kalender** i OneUptimes mobilapp eller går til **Indstillinger** > **Kalender** > **Konti** > **Tilføj konto** > **Anden** > **Tilføj abonnementskalender** og indsætter linket.

### Thunderbird

Vælg **Filer** > **Ny** > **Kalender** > **På netværket** > **iCalendar (ICS)**, indsæt `https://`-linket, og vælg et opdateringsinterval i kalenderens egenskaber: 1, 5, 15, 30 eller 60 minutter. Thunderbird henter **fra din computer** og skal have tillid til serverens certifikat.

### Fastmail, Proton og andre tjenester

Fastmail opdaterer cirka hver time og **deaktiverer et abonnement efter fem mislykkede hentninger i træk**; sker det, så tilføj det igen, når serveren er rask. Proton Calendar opdaterer hver 4.–16. time og afviser meget store feeds — sæt **Dage frem** ned, hvis den klager. Confluence Team Calendars accepterer vagtplan-feedet; dets grænse på 28 tegn for kalendernavne overholdes.

### Android

Hverken Google Kalender-appen eller Samsung Kalender kan abonnere på en URL. Tilføj `https://`-linket til Google Kalender på en computer (**Andre kalendere** > **+** > **Fra webadresse**); kalenderen synkroniseres derefter til telefonen sammen med alt andet i den Google-konto. OneUptimes mobilapp på Android tilbyder **Del link** og **Kopiér https-link** netop til dette.

## Hvor ofte kalendere opdaterer

| Kalender-app                       | Typisk opdatering                                          | Henter fra         | Bemærkninger                                                                               |
| ---------------------------------- | ---------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Google Kalender (Fra webadresse)   | 8–24 timer, nogle gange længere                            | Googles servere    | Ingen manuel opdatering; ignorerer hints; navn og tidszone læses kun ved første abonnement |
| Outlook.com                        | Cirka 3 timer                                              | Microsofts servere | Fast; kan overstige 24 timer                                                               |
| Outlook på nettet (arbejde, skole) | Cirka 4–6 timer                                            | Microsofts servere | Fast; ingen brugerkontrol                                                                  |
| Klassisk Outlook til Windows       | Ved Send/modtag; cirka hver time med **Opdateringsgrænse** | Din pc             | Kræver et `webcal`-link; synkroniserer ikke til telefon eller web                          |
| Apple Kalender (macOS)             | 5 minutter til ugentligt, standard hver time               | Din Mac            | Gem i iCloud for at nå iPhone og iPad                                                      |
| Apple Kalender (kun iOS)           | Efter **Hent nye data**, batteribegrænset                  | Din telefon        | Abonnér på en Mac for pålidelighed                                                         |
| Thunderbird                        | 1–60 minutter                                              | Din computer       |                                                                                            |
| Fastmail                           | Cirka hver time                                            | Fastmails servere  | Deaktiveret efter fem mislykkede hentninger                                                |
| Proton Calendar                    | 4–16 timer                                                 | Protons servere    | Afviser store feeds                                                                        |

OneUptime selv leverer friske data: en ændring af et lag, en rotation, et override eller en politiktilknytning ugyldiggør feedet med det samme, og svar caches i højst fem minutter. Ventetiden, du ser, er kalender-appens, ikke serverens. OneUptime foreslår timevis opdatering via `REFRESH-INTERVAL` og `X-PUBLISHED-TTL`; kun klassisk Outlook og Apple Kalender følger hintet.

## https, webcal og webcals

Alle tre peger på det samme feed. `webcal://` og `webcals://` er `http://`- og `https://`-linket med omdøbt skema, så styresystemet åbner en kalender-app i stedet for en browser; `webcals` er den krypterede variant og er den, OneUptime tilbyder, når `HTTP_PROTOCOL` er `https`.

- Google Kalender, Outlook på nettet, Thunderbird og Fastmail vil have `https://`-formen.
- Apple Kalender og klassisk Outlook til Windows abonnerer fra et `webcal(s)://`-link; i klassisk Outlook er `https://`-formen en engangsimport.
- `webcal://` uden `s` er ukrypteret og sender tokenet i klartekst ved hver hentning. Kører din installation stadig på almindelig `http`, viser dashboardet en advarsel ved linket; skift til `https`, før du deler links bredt.

## Påmindelser og omfordelingsbeskeder

Kalender-apps leverer ikke alarmer fra abonnerede feeds — Google smider dem væk, Apple fjerner dem som standard, Outlook flader dem ud — så OneUptime sender sine egne.

Under **Brugerindstillinger** > **Kalenderfeed** lader kortet **Påmind mig før vagter** dig vælge varsler: **1 uge**, **1 dag**, **1 time**, **15 min** eller en brugerdefineret værdi mellem 15 minutter og 14 dage, flere ad gangen. Hver påmindelse sendes én gang pr. vagt via de leveringsmetoder, du valgte for **Før min vagt begynder** under **Brugerindstillinger** > **Notifikationsindstillinger** (fanen Vagt; e-mail og push er slået til som standard). Beskeden nævner vagtplanen, de politikker den kalder igennem, og starttidspunktet i din tidszone.

- En vagt, der havner inden for et af dine varsler på grund af et sent override — nogen giver dig en vagt 20 minutter før den begynder — får med det samme én indhentningspåmindelse.
- Hvis en vagt, du er blevet påmindet om, gives til en anden, får du **Min kommende vagt er omfordelt**, en separat begivenhedstype, der kan slås fra for sig.
- Påmindelser sendes aldrig, efter en vagt er begyndt, og aldrig for vagtplaner, der ikke er knyttet til nogen eskaleringspolitik, fordi de ikke kan kalde nogen.

## Delte links til en vagtplan eller et projekt

Et delt link tilhører **projektet**, ikke den, der kopierede det, og det viser folks navne, aldrig deres e-mailadresser.

**Vagtplan-feed.** På en vagtplans side har kortet **Abonnér på denne vagtplan** to halvdele: **Kun mine vagter på denne vagtplan** (dit personlige link med et vagtplanfilter) og **Alles vagter på denne vagtplan (delt teamlink)**. Alle med rettigheden **Redigér** på vagtplaner kan **Udgiv delt link**, **Generér det igen** eller **Deaktivér** det; alle, der kan læse vagtplanen, kan kopiere det. Kortet viser, hvornår linket sidst blev roteret.

**Projekt-feed.** **Vagt** > **Kalenderfeeds** indeholder kortet **Alles vagter i dette projekt (delt link)** — ét delt link, der dækker alle vagtplaner i projektet — med samme handlinger for udgivelse, ny generering og deaktivering, og et link til din personlige feed-side.

Indstillinger på begge:

- **Vis dækningshuller** (slået fra som standard) tilføjer en begivenhed `No coverage · <Schedule>`, hvor et lag _burde_ dække, men ingen har vagt: et tomt lag, et lag med startdato i fremtiden, lag, der ikke passer sammen, eller ethvert hul i en 24×7-vagtplan. Timerne uden for kontortid i en kontortids-vagtplan rapporteres aldrig. **Mindste hul, der vises (minutter)** (standard 60) skjuler kortere huller; højst 100 hul-begivenheder udsendes, de ældste først.
- **Generér igen, når nogen forlader projektet** (slået fra som standard) genererer linket automatisk igen, når nogen forlader sit sidste team i projektet, så en tidligere kollegas kalender holder op med at opdatere. Alle andre skal derefter abonnere igen, og derfor er det tilvalg.
- **Dage med tidligere vagter** og **Dage frem**, som i det personlige feed.

Læg vagtplan-linket i en delt teamkalender — Google, Outlook eller Confluence — så betjener ét abonnement hele teamet. Rotér det, når nogen, der havde det, rejser, eller slå den automatiske rotation ovenfor til.

Når en person forlader sit sidste team i et projekt, fjerner OneUptime også personen fra projektets vagtplan-lag og eskaleringsregler, deaktiverer personens personlige feed for projektet og sletter personens påmindelser der.

## Begivenheder i detaljer

- Hver vagt har en stabil identitet dannet af vagtplanen og vagtens start, så den samme vagt er den samme begivenhed i dit personlige feed, i vagtplan-feedet og efter at et link er genereret igen. Kalender-apps opdaterer den på stedet; en ændring hæver begivenhedens sekvensnummer.
- Et override, der bytter hele vagten, beholder begivenheden og skifter personen; et override, der dækker en del af en vagt, giver tre sammenhængende begivenheder, for eksempel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Når en vagtplan er knyttet til to eller flere eskaleringspolitikker, og et override kun gælder én af dem, er de kaldte personer forskellige pr. politik. Feedet viser det i stedet for at skjule det: vagten beholder sin begivenhed for den person, de andre politikker kalder, med en note, der nævner politikken, som kalder en anden, og afløseren får en ekstra begivenhed med titlen `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vagter i fortiden bærer linjen "Past shifts reflect the current rotation, not who was actually paged" i beskrivelsen.
- En vagtplan, der ikke er knyttet til nogen eskaleringspolitik, vises stadig, med en note om, at den ikke vil kalde nogen.

## Planlægning, ikke revision

Feedet viser rotationen, **som den er konfigureret nu**, også for forgangne dage: et override indtastet bagefter omskriver historien i kalenderen. Til faktisk brugte vagttimer, retfærdighedsgennemgange og aflønning skal du bruge **Vagt** > **Rapporter** > **Vagttid pr. bruger**, som skrives ud fra, hvad pageren faktisk gjorde.

## Sikkerhed

- Tokenet i linket er den eneste legitimation. Enhver, der har linket, ser vagterne — navne, vagtplaner, politikker — indtil det genereres igen. Indsæt ikke links i chatrum eller sager; når et team har brug for en kalender, så del vagtplan- eller projekt-linket frem for dit personlige.
- Links er pr. projekt. Et lækket personligt link afslører ét projekts vagter, ikke alle de projekter, du tilhører.
- **Generér igen** flytter det gamle token til en 30-dages henstandsperiode (tom kalender, derefter 404). **Deaktivér** leverer en tom kalender. Et ukendt eller udløbet link svarer med en ren 404 uden hint. Tomme kalendere får abonnerede apps til at rydde deres kopi; en 404 får dem til at beholde den, og derfor leverer deaktivering og ny generering tomme kalendere.
- Tokens gemmes hashede; kopien, der vises på indstillingssiden, er krypteret med `ENCRYPTION_SECRET`. Sæt den variabel til en rigtig hemmelighed på en selvhostet installation — serveren advarer ved opstart, når den ikke er sat eller stadig er bogstaveligt `secret`. Ændrer du den senere, tilbyder siden **Generér link igen**, fordi den gemte kopi ikke længere kan læses; feedet virker videre, indtil du gør det.
- Feed-svar er markeret `Cache-Control: private`, udelukket fra søgemaskiner (`X-Robots-Tag: noindex`) og hastighedsbegrænset pr. link og pr. klientadresse.
- OneUptimes egen Nginx skriver ikke feed-forespørgsler i sin adgangslog:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  så et token havner aldrig i en logfil ved siden af en klientadresse; applikationen logger det heller aldrig. **Enhver proxy, WAF eller CDN, du sætter foran OneUptime, logger stadig den fulde URI**, medmindre du konfigurerer den til at lade være — tjek det, før du ruller feeds ud.

## Selvhostet konfiguration

Intet skal slås til: feeds virker på enhver installation. Fire miljøvariabler styrer dem, sat i `config.env` for Docker Compose eller under `onCallCalendarFeed` i Helm-værdierne (se chartets [konfigurationsreference](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel                                                | Helm-værdi                                       | Standard | Virkning                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`  | Nødafbryder. Enhver feed-URL svarer `503` med `Retry-After: 3600`; abonnerede apps beholder deres kopi og prøver igen senere. Intet slettes. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`     | Længden af hastighedsbegrænsningsvinduet.                                                                                                    |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`     | Hentninger, ét link må lave fra én klientadresse pr. vindue.                                                                                 |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`   | Hentninger, én klientadresse må lave på tværs af alle links pr. vindue — loftet for et helt kontor bag én adresse.                           |

Også relevant:

- **`HOST` og `HTTP_PROTOCOL`** bygger linkene. Hvis `HOST` er tom eller `localhost`, eller `HTTP_PROTOCOL` er `http`, viser feed-siden en advarsel, og linkene virker ikke udefra.
- **`TRUSTED_PROXY_HOPS`** afgør, hvilken adresse grænsen pr. adresse tæller. Standarden `1` er rigtig for standardopsætningerne af Docker Compose og Helm; læg én til for hver egen proxy — en CDN, WAF eller load balancer — der tilføjer til `X-Forwarded-For`, ellers ligner alle kalenderklienter samme adresse og deler ét budget. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i chart-dokumentationen.
- **Redis** bærer caches og hastighedsbegrænseren. Begge degraderer pænt: uden Redis renderes feeds stadig, blot langsommere, og begrænseren lader forespørgsler passere.
- I Helm-chartets opdelte tilstand (`worker.enabled: true`) renderes feeds på API-laget, så dimensionér det lag til et ryk af kalenderklienter, der henter på hel time.
- Undtagelsen fra Nginx-adgangsloggen vist ovenfor er en del af det medfølgende `Nginx/default.conf.template`; behold den, hvis du tilpasser skabelonen.

## Fejlfinding

**Intet har hentet linket, eller "Kunne ikke hente URL'en".** Google Kalender, Outlook på nettet, Fastmail og Proton henter **fra deres egne servere**, så OneUptime-værten skal kunne nås fra det offentlige internet med et certifikat, de har tillid til. En installation på et privat netværk, bag en VPN eller med en intern certifikatmyndighed er utilgængelig for dem, uanset hvad du indsætter. Apple Kalender, Thunderbird og klassisk Outlook henter fra enheden, så de virker, hvor enheden kan åbne dashboardet — efter at certifikatet har fået tillid på enheden, hvis det er selvsigneret. Feed-sidens statuslinje fortæller dig, om noget har hentet linket endnu; `curl -I` mod linket uden for dit netværk er den hurtigste kontrol. At lade OneUptime _nå_ private netværk — [Adgang til private netværk](/docs/self-hosted/private-network-access) — er en anden sag og hjælper ikke her.

**Kalenderen er forældet.** Læs først opdateringstabellen: for Google er forsinkelsen normal. For at få Google til at kigge igen skal du fjerne kalenderen og tilføje den igen eller tilføje `?nocache=1` til linket (ukendte parametre ignoreres, så feedet er uændret, men Google behandler det som nyt). I klassisk Outlook trykker du F9 og tjekker indstillingen **Opdateringsgrænse**. I Apple Kalender bruger du **Oversigt** > **Opdater kalendere**. Hvis en ændring samme dag betyder noget, så stol på OneUptimes påmindelser og omfordelingsbeskeder frem for kalenderen.

**Kalenderen er tom.** En tom kalender er tilsigtet. Det betyder, at linket er deaktiveret, er et gammelt link inden for sin 30-dages henstandsperiode efter ny generering, at projektet er under den plan, der omfatter vagtplaner, eller at du ikke længere er på nogen vagtplan i det projekt. Åbn linket i en browser: kalenderbeskrivelsen (`X-WR-CALDESC`) angiver årsagen.

**404.** Linket er ukendt, er slettet, eller dets henstandsperiode er udløbet. Generér et nyt, og abonnér igen.

**503.** Enten er `DISABLE_ON_CALL_CALENDAR_FEED` sat, eller også er serveren optaget: højst nogle få feeds renderes ad gangen, og en vagtplan, der tager meget lang tid at udfolde, afbrydes. Når der findes en tidligere kopi af feedet, leverer serveren den i stedet med en `Warning: 110`-header, så en 503 betyder, at der intet var at falde tilbage på. Klienter beholder deres seneste kopi og prøver igen efter `Retry-After`-intervallet. Fastmail deaktiverer et abonnement efter fem fejl i træk; tilføj det igen, når serveren er rask. Metrikken `oncall_calendar_render_duration_ms` viser operatører, hvilke feeds der er langsomme.

**429 eller "for mange forespørgsler".** Mange klienter bag én adresse — en kontor-NAT, en VPN-gateway — deler budgettet pr. adresse. Hæv `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, og tjek `TRUSTED_PROXY_HOPS`: er den for lav, tilskrives hver klient din egen proxy, og alle deler ét budget.

**Certifikatfejl i Apple Kalender, Thunderbird eller Outlook.** Disse apps validerer TLS på enheden. Importér din interne CA i enhedens tillidslager — macOS-nøgleringen, Windows-certifikatlageret, Thunderbirds certifikathåndtering — eller brug et offentligt betroet certifikat. Serverside-hentere som Google og Microsoft kan ikke fås til at stole på en privat CA.

**Tidspunkterne er forkerte.** Alle tidspunkter i filen er UTC; kalender-appen konverterer til sin egen zone. Ser vagterne ud til at være forskudt med et fast interval, så tjek vagtplanens tidszone (fanen **Indstillinger**) og din egen (**Brugerindstillinger** > **Profil**). En vagtplan uden tidszone beregnes i serverens zone, og begivenheden fortæller det.

**Feedet siger, det blev forkortet.** Mere end 5.000 begivenheder faldt inden for vinduet. Sæt **Dage frem** ned, eller abonnér på **Kun mine vagter på denne vagtplan** i stedet for et helt projekt.

**Google viser et gammelt kalendernavn.** Google læser navnet kun ved første abonnement; fjern kalenderen, og tilføj den igen.

**Indstillingssiden siger, at linket skal genereres igen.** `ENCRYPTION_SECRET` er ændret, siden linket blev oprettet, så serveren kan ikke længere vise det. Det eksisterende abonnement virker videre; ny generering giver dig et link, du kan kopiere igen, og trækker det gamle tilbage efter 30 dage.

**En vagt mangler i mit feed.** Kun vagtplan-vagter vises; direkte bruger- eller teamtildelinger i en politikregel er faste og har ingen begivenheder. En vagt, som en anden har overtaget via et override, forlader dit feed, fordi den nu er i vedkommendes. Slå **Medtag vagter, jeg dækker for andre** til for at se vagter, du har fået via overrides på vagtplaner, du ikke er medlem af.
