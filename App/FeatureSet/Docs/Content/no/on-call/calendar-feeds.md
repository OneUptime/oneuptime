# Kalenderfeeder (vakter i Google Kalender, Outlook og Apple Kalender)

Kalenderfeeder legger vaktene dine inn i kalenderen du allerede ser i. OneUptime publiserer en hemmelig iCalendar-lenke (`.ics`) for hver person, hver tidsplan og hvert prosjekt; Google Kalender, Outlook, Apple Kalender, Thunderbird og enhver annen app som kan abonnere på en kalender via URL, henter lenken jevnlig og viser én hendelse per vakt. Ingenting installeres og ingen konto kobles til: lenken er hele integrasjonen.

> **Note:** En abonnert kalender er til **planlegging**. Kalenderapper henter feeder på nytt i sitt eget tempo — Google Kalender bare hver 8. til 24. time — så et bytte som gjøres en time før en vakt, når deg gjennom OneUptimes egne påminnelser, omfordelingsvarsler og varslinger, ikke gjennom kalenderen.

## Hva du får

- Én hendelse per vakt, med tittelen `On-call · <Schedule>` i din personlige feed og `<Name> · On-call · <Schedule>` i en delt feed. Beskrivelsen oppgir hvem som har vakt, tidsplanen og dens tidssone, laget, vakten i tidsplanens sone, i UTC og i din sone, hvilke eskaleringsregler som varsler deg gjennom denne tidsplanen, og en lenke til tidsplanen i dashbordet.
- Overstyringer respekteres. Når noen dekker for deg, flyttes hendelsen til den personen (`(covering for <Name>)` legges til) og forblir den samme hendelsen i kalenderappen din, så den oppdateres på stedet i stedet for å dupliseres. En delvis overstyring deler vakten i hendelser som grenser til hverandre.
- To dagers historikk og 90 dager fremover som standard. Du kan utvide til 60 dager bakover og 180 dager fremover; en feed som ville overstige 5 000 hendelser, forkortes og sier det i kalenderbeskrivelsen.
- Hendelser merkes som ledige (`TRANSP:TRANSPARENT`), så en abonnert feed blokkerer aldri tilgjengeligheten din, og ingenting merkes som privat, så en delt teamkalender viser titlene til alle som kan se den.
- Tider sendes i UTC og konverteres av kalenderappen din; beskrivelsen oppgir klokkeslettet i tidsplanens sone og i din. Sett din egen tidssone under **Brukerinnstillinger** > **Profil** og tidsplanens under fanen **Innstillinger**. En tidsplan uten tidssone utvides i serverens sone, slik som ved varsling, og hendelsen sier det.

Faste tildelinger — en bruker eller et team som er navngitt direkte i en regel i en eskaleringspolicy — har verken start eller slutt og vises ikke i noen feed. På OneUptime Cloud følger feeder samme plan som vakttidsplaner (Growth); et prosjekt under den planen får en tom kalender i stedet for en feil.

## Tre slags lenker

| Lenke              | Hvem oppretter den                                                              | Hva den inneholder                                                                                 | Hvor                                                     |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Personlig feed** | Hver bruker, én per prosjekt                                                    | Vaktene dine på alle tidsplaner i det prosjektet, pluss vaktene der du dekker for noen (valgfritt) | **Brukerinnstillinger** > **Kalenderfeed**               |
| **Tidsplanfeed**   | Alle som kan redigere tidsplanen; alle som kan lese den, kan kopiere lenken     | Alles vakter på én tidsplan, med valgfrie hendelser for dekningshull                               | Tidsplanens side, kortet **Abonner på denne tidsplanen** |
| **Prosjektfeed**   | Alle som kan redigere vakttidsplaner; alle som kan lese dem, kan kopiere lenken | Alles vakter på alle tidsplaner i prosjektet, med valgfrie hendelser for dekningshull              | **Vakttjeneste** > **Kalenderfeeder**                    |

Lenkene ser slik ut:

```
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

Tokenet på 43 tegn i stien er den eneste legitimasjonen — ingen innlogging, informasjonskapsel eller API-nøkkel er involvert. Behandle hver av disse lenkene som et passord.

## Din personlige feed

1. Åpne **Brukerinnstillinger** > **Kalenderfeed** i prosjektet du vil ha vaktene fra. Personlige feeder er per prosjekt: et annet prosjekt får en annen lenke og en annen kalender.
2. Klikk på **Generer kalenderlenke**. Kortet **Abonner på vaktene dine** viser nå `https://`-lenken og tre knapper:
   - **Google Kalender** åpner Google Kalender med lenken forhåndsutfylt.
   - **Apple / andre apper** åpner `webcals://`-formen av lenken, som macOS, iOS og de fleste skrivebordsapper sender rett til abonnementsdialogen sin.
   - **Kopier webcal-lenke** kopierer den samme `webcal(s)://`-lenken — den klassisk Outlook for Windows trenger.
3. Abonner i kalenderappen din ved hjelp av trinnene per app nedenfor.

Innstillinger på samme kort:

- **Inkluder vakter jeg dekker for andre** (på som standard) legger til vaktene en overstyring gir deg på tidsplaner du ellers ikke er medlem av.
- **Dager med tidligere vakter** (standard 2, høyst 60) og **Dager fremover** (standard 90, mellom 7 og 180).

Statuslinjen viser når lenken sist ble hentet, av hvilken kalenderapp, hvor mange ganger, og de fire siste tegnene i tokenet så du kan skille lenker fra hverandre. Hvis ingenting har hentet lenken etter to dager, spør siden om serveren kan nås fra internett (se Feilsøking).

Siden lister også opp **Kommende vakter** (de neste 30 dagene), hver med en lenke **Finn avløser** som åpner brukeroverstyringer forhåndsutfylt for den vakten, og kortet **Minn meg på før vakter** som beskrives lenger ned.

Handlinger:

- **Generer lenke på nytt** lager et nytt token. Hver app som abonnerer på den gamle lenken, slutter å oppdatere: i 30 dager leverer den gamle lenken en tom kalender så disse appene tømmer kopien sin, deretter returnerer den 404. Abonner på nytt med den nye lenken.
- **Deaktiver** beholder lenken, men leverer en tom kalender til du aktiverer den igjen.
- **Slett** fjerner lenken. Apper som fortsatt henter den, får 404 og fortsetter å vise det de sist hentet — deaktiver først hvis du vil at de skal tømmes.

Den samme personlige lenken, filtrert til én tidsplan med `?schedule=<id>`, tilbys som **Bare mine vakter på denne tidsplanen** på hver tidsplans side, og vaktbanneret og siden **Mine vaktretningslinjer** har en lenke **Legg vaktene dine i kalenderen din** til siden over.

I mobilappen: **Vakt** > **Legg vakter i kalenderen min** (også under **Innstillinger** > **Kalenderfeed**), med én lenke per prosjekt. På iPhone åpner **Åpne i Kalender** det innebygde abonnementsarket. På Android finnes det ingen måte å abonnere på en URL på telefonen, så skjermen tilbyr **Del lenke** og **Kopier https-lenke** og ber deg legge til lenken på en datamaskin, hvoretter den synkroniseres til telefonen. Appens liste **Vaktene dine** kommer fra samme data og har samme handling **Finn avløser**.

## Abonner i kalenderappen din

Bruk `https://`-lenken med mindre appen ber om `webcal`; avsnittet om skjemaer nedenfor forklarer forskjellen.

### Google Kalender (nett)

1. I Google Kalender på nett, ved siden av **Andre kalendere**, klikk på **+** > **Fra nettadresse**.
2. Lim inn `https://`-lenken og klikk på **Legg til kalender**. Knappen **Google Kalender** i OneUptime gjør det samme med lenken forhåndsutfylt.

Google henter feeden **fra Googles servere**, omtrent hver 8. til 24. time og noen ganger sjeldnere. Det finnes ingen oppdateringsknapp for abonnerte kalendere, og Google ignorerer oppdateringshintene i feeden. Kalenderens navn og tidssone leses **bare når du først abonnerer**: gir du en tidsplan nytt navn senere, endres ikke navnet på kalenderen i Google — fjern og legg den til på nytt hvis navnet betyr noe. Google forkaster påminnelser som følger med i kalenderfiler, så sett standardvarsler for den kalenderen i Googles innstillinger, eller enda bedre, bruk OneUptimes egne påminnelser. Hvis Google melder at nettadressen ikke kunne hentes, sjekk at du limte inn `https://`-formen og ikke `webcal://`, og legg til `?nocache=1` for å få den til å se etter igjen (OneUptime ignorerer ukjente spørringsparametere, så selve feeden er uendret). Google Kalender-appen på Android og iOS kan ikke abonnere via URL; legg til lenken på en datamaskin, så dukker den opp på telefonen.

### Outlook på nett og Outlook.com

1. Åpne **Kalender** > **Legg til kalender** > **Abonner fra nettet**.
2. Lim inn `https://`-lenken, gi kalenderen et navn og klikk på **Importer**.

Outlook henter **fra Microsofts servere**: omtrent hver 3. time for Outlook.com og hver 4. til 6. time for jobb- og skolekontoer, noen ganger mer enn et døgn. Intervallet er fast, og det finnes ingen manuell oppdatering. Abonner her i stedet for i skrivebordsappen hvis du vil ha kalenderen på telefonen og i Outlook på nett også — abonnementer opprettet i klassisk Outlook for Windows blir værende på den PC-en. Nye Outlook for Windows og Outlook for Mac bruker samme dialog **Legg til kalender** > **Abonner fra nettet**.

### Klassisk Outlook for Windows

1. Klikk på **Kopier webcal-lenke** i OneUptime.
2. I Outlook åpner du **Fil** > **Kontoinnstillinger** > **Kontoinnstillinger** > **Internett-kalendere** > **Ny**, limer inn `webcals://`-lenken og klikker på **Legg til**. Å åpne en `webcal`-lenke i en nettleser fungerer også på en PC der Outlook er installert; Windows har ellers ingen `webcal`-behandler.

**Ikke** åpne selve `https://…/shifts.ics`-lenken i klassisk Outlook: den importerer et engangsøyeblikksbilde som aldri oppdateres. Bare `webcal://` og `webcals://` oppretter et abonnement.

Feeden oppdateres ved **Send/motta** (F9, eller intervallet under Send/motta-grupper). Abonnementets innstillinger har en avkrysningsboks **Oppdateringsgrense**: med den avkrysset oppdaterer Outlook ikke oftere enn intervallet utgiveren foreslår. OneUptime foreslår én time (`X-PUBLISHED-TTL:PT1H`), så feeden oppdateres omtrent hver time. Feeder uten det hintet oppdateres aldri så lenge boksen er avkrysset; OneUptimes feeder har det, så du kan la boksen stå på. Klassisk Outlook henter feeden **fra PC-en din** og validerer serverens sertifikat.

### Apple Kalender på macOS

1. Klikk på **Apple / andre apper** i OneUptime, eller velg **Arkiv** > **Nytt kalenderabonnement** i Kalender og lim inn lenken.
2. I abonnementsarket setter du **Automatisk oppdatering** — hvert 5. minutt, hvert 15. minutt, hver time, dag eller uke (hver time er standard) — og velger **iCloud** under **Plassering** så kalenderen også vises på iPhone og iPad og fortsetter å oppdateres etter den planen.

macOS henter feeden **fra Mac-en din**, så det fungerer for en installasjon på et privat nettverk så lenge Mac-en når den. Et selvsignert sertifikat eller et fra en intern CA må først klareres i macOS-nøkkelringen. **Fjern varsler** er avkrysset som standard i det arket; det spiller ingen rolle her fordi feeden ikke inneholder alarmer.

### iPhone og iPad

Abonnementer opprettet på selve enheten oppdateres i henhold til **Innstillinger** > **Kalender** > **Kontoer** > **Hent nye data** — **Automatisk** som standard, som stort sett henter under lading på Wi-Fi. For pålitelig oppdatering, abonner på en Mac med **iCloud** som plassering, eller sett **Hent nye data** til et fast intervall. For å abonnere på enheten, trykk på **Åpne i Kalender** i OneUptime-mobilappen, eller gå til **Innstillinger** > **Kalender** > **Kontoer** > **Legg til konto** > **Annet** > **Legg til abonnert kalender** og lim inn lenken.

### Thunderbird

Velg **Fil** > **Ny** > **Kalender** > **På nettverket** > **iCalendar (ICS)**, lim inn `https://`-lenken og velg et oppdateringsintervall i kalenderens egenskaper: 1, 5, 15, 30 eller 60 minutter. Thunderbird henter **fra datamaskinen din** og må stole på serverens sertifikat.

### Fastmail, Proton og andre tjenester

Fastmail oppdaterer omtrent hver time og **deaktiverer et abonnement etter fem mislykkede hentinger på rad**; skjer det, legg det til igjen når serveren er frisk. Proton Calendar oppdaterer hver 4. til 16. time og avviser svært store feeder — reduser **Dager fremover** hvis den klager. Confluence Team Calendars godtar tidsplanfeeden; grensen på 28 tegn for kalendernavn respekteres.

### Android

Verken Google Kalender-appen eller Samsung Kalender kan abonnere på en URL. Legg til `https://`-lenken i Google Kalender på en datamaskin (**Andre kalendere** > **+** > **Fra nettadresse**); kalenderen synkroniseres deretter til telefonen sammen med alt annet i den Google-kontoen. OneUptime-mobilappen på Android tilbyr **Del lenke** og **Kopier https-lenke** nettopp for dette.

## Hvor ofte kalendere oppdateres

| Kalenderapp                       | Typisk oppdatering                                           | Henter fra         | Merknader                                                                                                |
| --------------------------------- | ------------------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| Google Kalender (Fra nettadresse) | 8–24 timer, noen ganger lenger                               | Googles servere    | Ingen manuell oppdatering; ignorerer oppdateringshint; navn og tidssone leses bare ved første abonnement |
| Outlook.com                       | Omtrent 3 timer                                              | Microsofts servere | Fast; kan overstige 24 timer                                                                             |
| Outlook på nett (jobb, skole)     | Omtrent 4–6 timer                                            | Microsofts servere | Fast; ingen brukerkontroll                                                                               |
| Klassisk Outlook for Windows      | Ved Send/motta; omtrent hver time med **Oppdateringsgrense** | PC-en din          | Trenger en `webcal`-lenke; synkroniseres ikke til telefon eller nett                                     |
| Apple Kalender (macOS)            | 5 minutter til ukentlig, standard hver time                  | Mac-en din         | Lagre i iCloud for å nå iPhone og iPad                                                                   |
| Apple Kalender (bare iOS)         | Etter **Hent nye data**, batteristyrt                        | Telefonen din      | Abonner på en Mac for pålitelighet                                                                       |
| Thunderbird                       | 1–60 minutter                                                | Datamaskinen din   |                                                                                                          |
| Fastmail                          | Omtrent hver time                                            | Fastmails servere  | Deaktiveres etter fem mislykkede hentinger                                                               |
| Proton Calendar                   | 4–16 timer                                                   | Protons servere    | Avviser store feeder                                                                                     |

OneUptime selv leverer ferske data: en endring i et lag, en rotasjon, en overstyring eller en policytilknytning ugyldiggjør feeden umiddelbart, og svar bufres i høyst fem minutter. Ventetiden du ser, er kalenderappens, ikke serverens. OneUptime foreslår oppdatering hver time gjennom `REFRESH-INTERVAL` og `X-PUBLISHED-TTL`; bare klassisk Outlook og Apple Kalender tar hintet.

## https, webcal og webcals

Alle tre peker på samme feed. `webcal://` og `webcals://` er `http://`- og `https://`-lenken med skjemaet omdøpt, slik at operativsystemet åpner en kalenderapp i stedet for en nettleser; `webcals` er den krypterte og er det OneUptime tilbyr når `HTTP_PROTOCOL` er `https`.

- Google Kalender, Outlook på nett, Thunderbird og Fastmail vil ha `https://`-formen.
- Apple Kalender og klassisk Outlook for Windows abonnerer fra en `webcal(s)://`-lenke; i klassisk Outlook er `https://`-formen en engangsimport.
- `webcal://` uten `s` er ukryptert og sender tokenet i klartekst ved hver henting. Hvis installasjonen din fortsatt kjører på vanlig `http`, viser dashbordet en advarsel ved siden av lenken; bytt til `https` før du deler lenker bredt.

## Påminnelser og omfordelingsvarsler

Kalenderapper leverer ikke alarmer fra abonnerte feeder — Google forkaster dem, Apple fjerner dem som standard, Outlook flater dem ut — så OneUptime sender sine egne.

På **Brukerinnstillinger** > **Kalenderfeed** lar kortet **Minn meg på før vakter** deg velge forvarsel: **1 uke**, **1 dag**, **1 time**, **15 min** eller en egendefinert verdi mellom 15 minutter og 14 dager, flere samtidig. Hver påminnelse sendes én gang per vakt gjennom leveringsmåtene du valgte for **Før vakten min starter** på **Brukerinnstillinger** > **Varselinnstillinger** (fanen Vakt; e-post og push er på som standard). Meldingen oppgir tidsplanen, reglene den varsler gjennom og starttiden i din tidssone.

- En vakt som havner innenfor ett av forvarslene dine på grunn av en sen overstyring — noen gir deg en vakt 20 minutter før den starter — får én innhentingspåminnelse med en gang.
- Hvis en vakt du ble påminnet om, gis til noen andre, får du **Den kommende vakten min er omfordelt**, en egen hendelsestype så den kan dempes for seg.
- Påminnelser sendes aldri etter at en vakt har startet, og aldri for tidsplaner som ikke er knyttet til noen eskaleringspolicy, fordi de ikke kan varsle noen.

## Delte lenker for en tidsplan eller et prosjekt

En delt lenke tilhører **prosjektet**, ikke den som kopierte den, og den viser folks navn, aldri e-postadressene deres.

**Tidsplanfeed.** På en tidsplans side har kortet **Abonner på denne tidsplanen** to halvdeler: **Bare mine vakter på denne tidsplanen** (din personlige lenke med et tidsplanfilter) og **Alles vakter på denne tidsplanen (delt teamlenke)**. Alle med **Rediger**-tillatelse på tidsplaner kan **Publiser delt lenke**, **Generer på nytt** eller **Deaktiver** den; alle som kan lese tidsplanen, kan kopiere den. Kortet viser når lenken sist ble rotert.

**Prosjektfeed.** **Vakttjeneste** > **Kalenderfeeder** inneholder kortet **Alles vakter i dette prosjektet (delt lenke)** — én delt lenke som dekker hver tidsplan i prosjektet — med de samme handlingene for publisering, ny generering og deaktivering, og en lenke til din personlige feedside.

Innstillinger på begge:

- **Vis dekningshull** (av som standard) legger til en hendelse `No coverage · <Schedule>` overalt der et lag _skal_ dekke, men ingen har vakt: et tomt lag, et lag med startdato i fremtiden, lag som ikke passer sammen, eller ethvert hull i en 24×7-tidsplan. Fritid utenom arbeidstid i en kontortidsplan rapporteres aldri. **Minste hull som vises (minutter)** (standard 60) skjuler kortere hull; høyst 100 hullhendelser lages, eldst først.
- **Generer på nytt når noen forlater prosjektet** (av som standard) genererer lenken på nytt automatisk når noen forlater sitt siste team i prosjektet, så en tidligere kollegas kalender slutter å oppdatere. Alle andre må abonnere på nytt etterpå, og derfor er den valgfri.
- **Dager med tidligere vakter** og **Dager fremover**, som på den personlige feeden.

Legg tidsplanlenken i en delt teamkalender — Google, Outlook eller Confluence — så tjener ett abonnement hele teamet. Roter den når noen som hadde den slutter, eller slå på den automatiske rotasjonen over.

Når en person forlater sitt siste team i et prosjekt, fjerner OneUptime også personen fra prosjektets tidsplanlag og eskaleringsregler, deaktiverer personens personlige feed for prosjektet og sletter personens påminnelser der.

## Hendelser i detalj

- Hver vakt har en stabil identitet laget av tidsplanen og vaktens start, så samme vakt er samme hendelse i din personlige feed, i tidsplanfeeden og etter at du har generert en lenke på nytt. Kalenderapper oppdaterer den på stedet; en endring øker hendelsens sekvensnummer.
- En overstyring som bytter hele vakten, beholder hendelsen og bytter person; en overstyring som dekker en del av en vakt, gir tre hendelser som grenser til hverandre, for eksempel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Når en tidsplan er knyttet til to eller flere eskaleringsregler og en overstyring bare gjelder én av dem, er de som varsles forskjellige per policy. Feeden viser dette i stedet for å skjule det: vakten beholder hendelsen sin for personen som de andre reglene varsler, med en merknad som navngir policyen som varsler noen andre, og avløseren får en ekstra hendelse med tittelen `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vakter i fortiden har linjen "Past shifts reflect the current rotation, not who was actually paged" i beskrivelsen.
- En tidsplan som ikke er knyttet til noen eskaleringspolicy, vises likevel, med en merknad om at den ikke varsler noen.

## Planlegging, ikke revisjon

Feeden viser rotasjonen **slik den er konfigurert nå**, også for tidligere dager: en overstyring som legges inn i ettertid, skriver om historikken i kalenderen. For faktisk vakttid, rettferdighetsgjennomganger og kompensasjon bruker du **Vakttjeneste** > **Rapporter** > **Brukerens vakttid**, som skrives ut fra hva varslingen faktisk gjorde.

## Sikkerhet

- Tokenet i lenken er den eneste legitimasjonen. Alle som har lenken, ser vaktene — navn, tidsplaner, regler — til den genereres på nytt. Ikke lim inn lenker i chatterom eller saker; når et team trenger en kalender, del tidsplan- eller prosjektlenken i stedet for din personlige.
- Lenker er per prosjekt. En lekket personlig lenke avslører ett prosjekts vakter, ikke alle prosjektene du tilhører.
- **Generer på nytt** flytter det gamle tokenet inn i en 30 dagers karensperiode (tom kalender, deretter 404). **Deaktiver** leverer en tom kalender. En ukjent eller utløpt lenke returnerer en ren 404 uten hint. Tomme kalendere får abonnerende apper til å tømme kopien sin; en 404 får dem til å beholde den, og derfor leverer deaktivering og ny generering tomme kalendere.
- Tokener lagres hashet; kopien som vises på innstillingssiden, er kryptert med `ENCRYPTION_SECRET`. Sett den variabelen til en ekte hemmelighet på en selvdriftet installasjon — serveren advarer ved oppstart når den er usatt eller fortsatt er den bokstavelige `secret`. Endrer du den senere, tilbyr siden **Generer lenke på nytt** fordi den lagrede kopien ikke lenger kan leses; feeden fortsetter å fungere til du gjør det.
- Feedsvar merkes med `Cache-Control: private`, utelukkes fra søkemotorer (`X-Robots-Tag: noindex`) og hastighetsbegrenses per lenke og per klientadresse.
- OneUptimes egen Nginx skriver ikke feedforespørsler til tilgangsloggen:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  så et token havner aldri i en loggfil ved siden av en klientadresse; applikasjonen logger det heller aldri. **Enhver proxy, WAF eller CDN du kjører foran OneUptime, logger fortsatt hele URI-en** med mindre du konfigurerer den til å la være — sjekk det før du ruller ut feeder.

## Konfigurasjon for selvdrift

Ingenting trenger å slås på: feeder fungerer på hver installasjon. Fire miljøvariabler styrer dem, satt i `config.env` for Docker Compose eller under `onCallCalendarFeed` i Helm-verdiene (se diagrammets [konfigurasjonsreferanse](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel                                                | Helm-verdi                                       | Standard | Effekt                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`  | Nødbryter. Hver feed-URL svarer `503` med `Retry-After: 3600`; abonnerende apper beholder kopien de har og prøver igjen senere. Ingenting slettes. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`     | Lengden på hastighetsbegrensningsvinduet.                                                                                                          |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`     | Hentinger én lenke kan gjøre fra én klientadresse per vindu.                                                                                       |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`   | Hentinger én klientadresse kan gjøre på tvers av alle lenker per vindu — taket for et helt kontor bak én adresse.                                  |

Også relevant:

- **`HOST` og `HTTP_PROTOCOL`** bygger lenkene. Hvis `HOST` er tom eller `localhost`, eller `HTTP_PROTOCOL` er `http`, viser feedsiden en advarsel og lenkene fungerer ikke utenfra.
- **`TRUSTED_PROXY_HOPS`** avgjør hvilken adresse grensen per adresse teller. Standardverdien `1` er riktig for standardoppsettene for Docker Compose og Helm; legg til én for hver egen proxy — en CDN, WAF eller lastbalanserer — som legger til i `X-Forwarded-For`, ellers ser hver kalenderklient ut som samme adresse og deler ett budsjett. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i diagrammets dokumentasjon.
- **Redis** støtter bufrene og hastighetsbegrenseren. Begge degraderer pent: uten Redis gjengis feeder likevel, bare tregere, og begrenseren slipper forespørsler gjennom.
- I Helm-diagrammets delte modus (`worker.enabled: true`) gjengis feeder på API-nivået, så dimensjoner det nivået for en bølge av kalenderklienter som poller ved hel time.
- Unntaket fra Nginx-tilgangsloggen vist over er en del av den medfølgende `Nginx/default.conf.template`; behold det hvis du tilpasser malen.

## Feilsøking

**Ingenting har hentet lenken, eller "Kunne ikke hente nettadressen".** Google Kalender, Outlook på nett, Fastmail og Proton henter **fra sine egne servere**, så OneUptime-verten må kunne nås fra det offentlige internett med et sertifikat de stoler på. En installasjon på et privat nettverk, bak en VPN eller med en intern sertifikatutsteder kan ikke nås av dem uansett hva du limer inn. Apple Kalender, Thunderbird og klassisk Outlook henter fra enheten, så de fungerer overalt der enheten kan åpne dashbordet — etter at sertifikatet er klarert på den enheten hvis det er selvsignert. Feedsidens statuslinje forteller om noe har hentet lenken ennå; `curl -I` mot lenken utenfra nettverket ditt er den raskeste kontrollen. Å la OneUptime _nå_ private nettverk — [Private Network Access](/docs/self-hosted/private-network-access) — er en annen sak og hjelper ikke her.

**Kalenderen er utdatert.** Les først oppdateringstabellen: for Google er forsinkelsen normal. For å få Google til å se etter igjen, fjern og legg til kalenderen på nytt eller legg til `?nocache=1` på lenken (ukjente parametere ignoreres, så feeden er uendret, men Google behandler den som ny). I klassisk Outlook, trykk F9 og sjekk innstillingen **Oppdateringsgrense**. I Apple Kalender, bruk **Vis** > **Oppdater kalendere**. Hvis en endring samme dag betyr noe, stol på OneUptimes påminnelser og omfordelingsvarsler i stedet for på kalenderen.

**Kalenderen er tom.** En tom kalender er tilsiktet. Det betyr at lenken er deaktivert, er en gammel lenke innenfor sin 30 dagers karensperiode etter ny generering, at prosjektet ligger under planen som omfatter vakttidsplaner, eller at du ikke lenger er på noen tidsplan i det prosjektet. Åpne lenken i en nettleser: kalenderbeskrivelsen (`X-WR-CALDESC`) oppgir årsaken.

**404.** Lenken er ukjent, er slettet, eller karensperioden er over. Generer en ny og abonner på nytt.

**503.** Enten er `DISABLE_ON_CALL_CALENDAR_FEED` satt, eller serveren er opptatt: bare noen få feeder gjengis om gangen, og en tidsplan som tar svært lang tid å utvide, kuttes. Når en tidligere kopi av feeden finnes, leverer serveren den i stedet, med en `Warning: 110`-header, så en 503 betyr at det ikke var noe å falle tilbake på. Klienter beholder sin siste kopi og prøver igjen etter `Retry-After`-intervallet. Fastmail deaktiverer et abonnement etter fem feil på rad; legg det til igjen når serveren er frisk. Målingen `oncall_calendar_render_duration_ms` viser operatører hvilke feeder som er trege.

**429 eller "for mange forespørsler".** Mange klienter bak én adresse — et kontor-NAT, en VPN-gateway — deler budsjettet per adresse. Øk `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, og sjekk `TRUSTED_PROXY_HOPS`: når den er for lav, tilskrives hver klient din egen proxy og alle deler ett budsjett.

**Sertifikatfeil i Apple Kalender, Thunderbird eller Outlook.** Disse appene validerer TLS på enheten. Importer din interne CA i enhetens klareringslager — macOS-nøkkelringen, Windows-sertifikatlageret, Thunderbirds sertifikatbehandler — eller bruk et offentlig klarert sertifikat. Serverbaserte hentere som Google og Microsoft kan ikke fås til å stole på en privat CA.

**Tidene er feil.** Alle tider i filen er UTC; kalenderappen konverterer til sin egen sone. Hvis vaktene ser forskjøvet ut med en fast forskyvning, sjekk tidsplanens tidssone (fanen **Innstillinger**) og din egen (**Brukerinnstillinger** > **Profil**). En tidsplan uten tidssone utvides i serverens sone og hendelsen sier det.

**Feeden sier den ble forkortet.** Mer enn 5 000 hendelser havnet innenfor vinduet. Reduser **Dager fremover**, eller abonner på **Bare mine vakter på denne tidsplanen** i stedet for et helt prosjekt.

**Google viser et gammelt kalendernavn.** Google leser navnet bare ved første abonnement; fjern og legg til kalenderen på nytt.

**Innstillingssiden sier at lenken må genereres på nytt.** `ENCRYPTION_SECRET` ble endret etter at lenken ble opprettet, så serveren kan ikke lenger vise den. Det eksisterende abonnementet fortsetter å fungere; ny generering gir deg en lenke du kan kopiere igjen og pensjonerer den gamle etter 30 dager.

**En vakt mangler i feeden min.** Bare tidsplanvakter vises; direkte bruker- eller teamtildelinger i en policyregel er faste og har ingen hendelser. En vakt som noen andre har overtatt gjennom en overstyring, forlater feeden din fordi den nå er i deres. Slå på **Inkluder vakter jeg dekker for andre** for å se vakter du har fått gjennom overstyringer på tidsplaner du ikke er medlem av.
