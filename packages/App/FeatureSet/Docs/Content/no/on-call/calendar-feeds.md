# Kalenderfeeder

Kalenderfeeder legger vaktene dine inn i kalenderen du allerede ser i. OneUptime publiserer en hemmelig iCalendar-lenke (`.ics`) for hver person, hver vaktplan og hvert prosjekt; Google Kalender, Outlook, Apple Kalender, Thunderbird og alle andre apper som kan abonnere på en kalender via en URL, henter lenken jevnlig og viser én hendelse per vakt. Ingenting installeres, og ingen konto kobles til: lenken er hele integrasjonen.

```mermaid title="Kalenderapper henter en hemmelig lenke; noen fra sine egne servere"
flowchart TB
    subgraph links["Hemmelige .ics-lenker"]
        direction LR
        personal["Personlig feed"]
        schedule["Vaktplanfeed"]
        project["Prosjektfeed"]
    end
    shifts["Vaktplaner, rotasjoner<br/>og overstyringer"] --> links
    links -->|"hentet fra serverne deres"| serverApps["Google Kalender, Outlook på nettet"]
    links -->|"hentet fra enheten din"| deviceApps["Apple Kalender, Thunderbird, klassisk Outlook"]
```

> [!NOTE]
> En abonnert kalender er til **planlegging**. Kalenderapper henter feeder på nytt i sitt eget tempo — Google Kalender bare hver 8. til 24. time — så et bytte som gjøres en time før en vakt, når deg gjennom OneUptimes egne påminnelser, meldinger om ny tildeling og varsler, ikke gjennom kalenderen.

## Hva du får

- Én hendelse per vakt, med tittelen `On-call · <Schedule>` (med ` · <Policy>` lagt til når vaktplanen er knyttet til nøyaktig én eskaleringsretningslinje) i den personlige feeden din og `<Name> · On-call · <Schedule>` i en delt feed. Beskrivelsen viser hvem som har vakt, vaktplanen og tidssonen dens, laget, vakten i vaktplanens sone, i UTC og i din sone, hvilke eskaleringsretningslinjer som varsler deg gjennom denne vaktplanen, og en lenke til vaktplanen i dashbordet.
- Overstyringer følges. Når noen dekker for deg, flyttes hendelsen til dem (`(covering for <Name>)` legges til) og forblir den samme hendelsen i kalenderappen din, så den oppdateres på stedet i stedet for å dupliseres. En delvis overstyring deler vakten i hendelser som ligger inntil hverandre.
- To dager med historikk og 90 dager fremover som standard. Du kan utvide dette til 60 dager bakover og 180 dager fremover; en feed som ville ha over 5 000 hendelser, kortes ned og sier det i kalenderbeskrivelsen.
- Hendelser er merket som ledig (`TRANSP:TRANSPARENT`), så en abonnert feed blokkerer aldri tilgjengeligheten din, og ingenting er merket som privat, så en delt teamkalender viser titlene til alle som kan se den.
- Tider sendes i UTC og regnes om av kalenderappen din; beskrivelsen skriver klokkeslettet i vaktplanens sone og i din. Angi din egen tidssone som **Tidssone** på **Profil** (bildet ditt øverst til høyre i dashbordet), og vaktplanens i kortet **Schedule timezone** på siden **Lag**. En vaktplan uten tidssone regnes ut i serverens sone, slik som ved varsling, og hendelsen sier det.

Faste tildelinger — en bruker eller et team som er nevnt direkte i en regel i en eskaleringsretningslinje — har ingen start eller slutt og vises ikke i noen feed. På OneUptime Cloud følger feeder samme plan som vaktplaner (Growth); et prosjekt under den planen får en tom kalender i stedet for en feil.

## Tre typer lenker

| Lenke | Hvem oppretter den | Hva den inneholder | Hvor |
| --- | --- | --- | --- |
| **Personlig feed** | Hver bruker, én per prosjekt | Vaktene dine i alle vaktplaner i det prosjektet, pluss vaktene der du dekker for noen (valgfritt) | **Brukerinnstillinger** > **Kalender** > **Kalenderfeed** |
| **Vaktplanfeed** | Alle som kan redigere vaktplanen; alle som kan lese den, kan kopiere lenken | Alles vakter i én vaktplan, med valgfrie hendelser for hull i dekningen | Vaktplanens side, kortet **Abonner på denne vaktplanen** |
| **Prosjektfeed** | Alle som kan redigere vaktplaner; alle som kan lese dem, kan kopiere lenken | Alles vakter i alle vaktplaner i prosjektet, med valgfrie hendelser for hull i dekningen | **Vakttjeneste** > **Kalenderfeeder** |

Lenkene ser slik ut:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Tokenet på 43 tegn i stien er den eneste påloggingsinformasjonen — det er ingen innlogging, informasjonskapsel eller API-nøkkel involvert. Behandle hver av disse lenkene som et passord.

## Den personlige feeden din

Personlige feeder er per prosjekt: et andre prosjekt får en andre lenke og en andre kalender.

:::steps
### Åpne kalenderfeeden din

Åpne **Brukerinnstillinger** > **Kalender** > **Kalenderfeed** i prosjektet du vil ha vaktene fra. **Kalender** er en del av sidemenyen som starter sammenslått.

### Generer lenken

Klikk på **Generer kalenderlenke**. Kortet **Abonner på vaktene dine** tilbyr nå én måte å abonnere på:

- **Legg til i kalenderen din**: **Google Kalender** åpner Google Kalender, som spør om kalenderen skal legges til. **Apple Kalender / Outlook** åpner lenkens `webcal://`-form i appen datamaskinen eller telefonen din abonnerer med: Apple Kalender på en Mac, iPhone eller iPad, Outlook på Windows.
- **Eller kopier lenken**: **Kopier lenke** kopierer `https://`-lenken for alle andre apper som kan abonnere på en kalender via en URL. Lenken er skjult på siden til du klikker for å vise den.

### Abonner på lenken

Følg stegene for appen din under "Abonner i kalenderappen din" nedenfor. Vaktene dine vises som hendelser neste gang appen henter lenken: se "Hvor ofte kalendere oppdateres".
:::

### Innstillinger for feeden

Klikk på **Rediger innstillinger** på kortet **Innstillinger for kalenderfeed** for å endre hva lenken inneholder:

| Innstilling | Hva den gjør |
| --- | --- |
| **Ta med vakter jeg dekker for andre** | På som standard. Legger til vaktene en overstyring gir deg i vaktplaner du ellers ikke er medlem av. |
| **Dager med tidligere vakter** | Hvor langt tilbake kalenderen går (standard 2, høyst 60). |
| **Dager fremover** | Hvor langt frem kalenderen går (standard 90, mellom 7 og 180). |

Statuslinjen viser når lenken sist ble hentet, av hvilken kalenderapp, hvor mange ganger, og de fire siste tegnene i tokenet, så du kan skille lenker fra hverandre. Har ingenting hentet lenken etter to dager, spør siden om serveren kan nås fra internett (se Feilsøking).

### Administrer lenken

| Handling | Hva som skjer |
| --- | --- |
| **Generer lenke på nytt** | Lager et nytt token. Alle apper som abonnerer på den gamle lenken, slutter å oppdateres: i 30 dager leverer den gamle lenken en tom kalender, så de appene tømmer kopien sin, deretter svarer den 404. Abonner på nytt med den nye lenken. |
| **Deaktiver** | Beholder lenken, men leverer en tom kalender til du aktiverer den igjen. |
| **Slett** | Fjerner lenken. Apper som fortsatt henter den, får 404 og fortsetter å vise det de hentet sist — deaktiver først hvis du vil at de skal tømmes. |

### Kommende vakter og avløsning

Siden viser også **Upcoming shifts** (de neste 30 dagene) og kortet **Påminn meg før vakter**, som er beskrevet lenger ned. Hver av dine egne vakter har en lenke **Finn avløser**: den åpner brukeroverstyringer i vaktens prosjekt med en ny overstyring som allerede er fylt ut for den vakten, med deg som **Hvem er borte?** og vaktens tider som **Starter** og **Slutter** (fra nå, hvis vakten har startet), så det bare gjenstår **Hvem dekker?**. Overstyringen sender alle varslene dine i det tidsrommet til den som dekker, fra alle vaktretningslinjer; en vakt som bare finnes inne i én retningslinje, dekkes i stedet på den retningslinjens side for brukeroverstyringer. En vakt der du dekker for noen andre, har ingen **Finn avløser**: overstyringer lenkes ikke sammen, så avløsning for en avløsning ville ikke endre noe.

Den samme personlige lenken, filtrert til én vaktplan med `?schedule=<id>`, tilbys som **Bare mine vakter i denne vaktplanen** på siden til hver vaktplan, og vaktbanneret og siden **Mine vaktretningslinjer** har en lenke **Legg vaktene dine til i kalenderen din** til siden ovenfor.

### I mobilappen

I mobilappen: **On-Call** > **Add shifts to my calendar** (også under **Settings** > **Calendar feed**), med én lenke per prosjekt. På iPhone åpner **Open in Calendar** det innebygde abonnementsarket. På Android finnes det ingen måte å abonnere på en URL på telefonen, så skjermen tilbyr **Share link** og **Copy https link** og ber deg legge til lenken på en datamaskin, hvoretter den synkroniseres til telefonen. Listen **Your shifts** i appen kommer fra de samme dataene og har den samme handlingen **Get cover**.

## Abonner i kalenderappen din

Bruk **Google Kalender** eller **Apple Kalender / Outlook** i OneUptime der appen din har en knapp; alle andre apper tar `https://`-lenken som **Kopier lenke** gir deg. "https- og webcal-lenker" nedenfor forklarer de to formene.

:::tabs
@tab Google Kalender
1. Klikk på **Google Kalender** i OneUptime. Google Kalender åpnes og spør om kalenderen skal legges til; klikk på **Legg til**.
2. Eller klikk på **+** > **Fra nettadresse** ved siden av **Andre kalendere** i Google Kalender på nettet, lim inn lenken (**Kopier lenke** i OneUptime) og klikk på **Legg til kalender**.

Knappen **Google Kalender** åpner Googles side for å legge til via URL, `https://calendar.google.com/calendar/r?cid=` etterfulgt av lenkens `webcal://`-form, prosentkodet. Den siden tar bare `webcal://`-formen: med `https://`-formen svarer Google "Unable to add calendar. Check the URL." **Fra nettadresse** tar begge formene.

Google henter feeden **fra Googles servere**, så OneUptime-serveren må kunne nås fra internett — OneUptime Cloud kan alltid det; se Feilsøking for en selvdriftet installasjon. Den første hentingen skjer vanligvis innen noen minutter etter at du abonnerer; deretter oppdaterer Google omtrent hver 8. til 24. time, noen ganger sjeldnere. Det finnes ingen oppdateringsknapp for abonnerte kalendere, og Google ignorerer oppdateringshintene i feeden. Statuslinjen på feedsiden viser **Sist hentet … av Google Calendar** når Google har lest lenken.

Kalenderens navn og tidssone leses **bare første gang du abonnerer**: gir du en vaktplan nytt navn senere, får ikke kalenderen nytt navn i Google — fjern den og legg den til igjen hvis navnet er viktig. Google forkaster påminnelser i kalenderfiler, så angi standardvarsler for den kalenderen i innstillingene til Google, eller enda bedre: bruk OneUptimes egne påminnelser. Google husker en adresse den ikke kunne lese: når du har rettet det som stoppet den, legger du til lenken igjen med `?nocache=1` bak (OneUptime ignorerer ukjente spørringsparametere, så selve feeden er uendret), eller genererer lenken på nytt. Google Kalender-appen på Android og iOS kan ikke abonnere via URL; legg til lenken på en datamaskin, så dukker den opp på telefonen.
@tab Outlook på nettet
1. Åpne **Kalender** > **Legg til kalender** > **Abonner fra nettet**.
2. Lim inn `https://`-lenken (**Kopier lenke** i OneUptime), gi kalenderen et navn og klikk på **Importer**.

Dette fungerer på samme måte i Outlook.com, Outlook på nettet for jobb- og skolekontoer, nye Outlook for Windows og Outlook for Mac. Outlook henter **fra Microsofts servere**: omtrent hver 3. time for Outlook.com og hver 4. til 6. time for jobb- og skolekontoer, noen ganger mer enn et døgn. Intervallet er fast, og det finnes ingen manuell oppdatering.

Abonner her i stedet for i skrivebordsappen hvis du også vil ha kalenderen på telefonen og i Outlook på nettet — abonnementer som opprettes i klassisk Outlook for Windows, blir på den PC-en.
@tab Klassisk Outlook for Windows
1. Klikk på **Apple Kalender / Outlook** i OneUptime på en PC der Outlook er installert. Windows gir `webcal://`-lenken videre til Outlook, som spør om internettkalenderen skal legges til. Uten Outlook har Windows ingen `webcal`-behandler.
2. Eller åpne **Fil** > **Kontoinnstillinger** > **Kontoinnstillinger** > **Internett-kalendere** > **Ny** i Outlook, lim inn lenken (**Kopier lenke** i OneUptime) og klikk på **Legg til**.

**Ikke** åpne selve `https://…/shifts.ics`-lenken i klassisk Outlook: det importerer et engangsøyeblikksbilde som aldri oppdateres. Å åpne `webcal://`-lenken, eller å legge til adressen under **Internett-kalendere**, oppretter et abonnement.

Feeden oppdateres ved **Send/motta** (F9, eller intervallet under Send/motta-grupper). Abonnementets innstillinger har en avmerkingsboks **Oppdateringsgrense**: når den er merket, oppdaterer ikke Outlook oftere enn intervallet utgiveren foreslår. OneUptime foreslår én time (`X-PUBLISHED-TTL:PT1H`), så feeden oppdateres omtrent hver time. Feeder uten det hintet oppdateres aldri mens boksen er merket; OneUptimes har det, så du kan la boksen være på. Klassisk Outlook henter feeden **fra PC-en din** og validerer serverens sertifikat.
@tab Apple Kalender (macOS)
1. Klikk på **Apple Kalender / Outlook** i OneUptime, eller velg **Arkiv** > **Nytt kalenderabonnement** i Kalender og lim inn lenken.
2. Angi **Oppdater automatisk** i abonnementsarket — hvert 5. minutt, 15. minutt, hver time, dag eller uke (hver time er standard) — og velg **iCloud** under **Plassering**, så kalenderen også vises på iPhone og iPad og fortsetter å oppdateres etter den planen.

macOS henter feeden **fra Mac-en din**, så det fungerer for en installasjon på et privat nettverk så lenge Mac-en kan nå den. Et selvsignert sertifikat eller et sertifikat fra en intern CA må først være klarert i nøkkelringen i macOS. **Fjern varsler** er merket som standard i det arket; det har ingen betydning her, fordi feeden ikke har alarmer.
@tab iPhone og iPad
For å abonnere på enheten trykker du på **Open in Calendar** i OneUptimes mobilapp, eller går til **Innstillinger** > **Kalender** > **Kontoer** > **Legg til konto** > **Annet** > **Legg til abonnert kalender** og limer inn lenken.

Abonnementer som opprettes på selve enheten, oppdateres etter **Innstillinger** > **Kalender** > **Kontoer** > **Hent nye data** — **Automatisk** som standard, som stort sett henter under lading på Wi-Fi. For pålitelig oppdatering abonnerer du på en Mac med **iCloud** som plassering, eller setter **Hent nye data** til et fast intervall.
@tab Thunderbird
Velg **Fil** > **Ny** > **Kalender** > **På nettverket** > **iCalendar (ICS)**, lim inn `https://`-lenken og velg et oppdateringsintervall i kalenderens egenskaper: 1, 5, 15, 30 eller 60 minutter. Thunderbird henter **fra datamaskinen din** og må stole på serverens sertifikat.
@tab Android
Verken Google Kalender-appen eller Samsung Kalender kan abonnere på en URL. Legg til `https://`-lenken i Google Kalender på en datamaskin (**Andre kalendere** > **+** > **Fra nettadresse**); kalenderen synkroniseres deretter til telefonen sammen med alt annet i den Google-kontoen. OneUptimes mobilapp på Android tilbyr **Share link** og **Copy https link** nettopp for dette.
@tab Andre tjenester
Fastmail oppdaterer omtrent hver time og **deaktiverer et abonnement etter fem mislykkede hentinger på rad**; skjer det, legger du det til igjen når serveren er frisk. Proton Calendar oppdaterer hver 4. til 16. time og avviser svært store feeder — senk **Dager fremover** hvis den klager. Confluence Team Calendars tar imot vaktplanfeeden; grensen på 28 tegn for kalendernavn respekteres.
:::

## Hvor ofte kalendere oppdateres

| Kalenderapp | Vanlig oppdatering | Henter fra | Merknader |
| --- | --- | --- | --- |
| Google Kalender (Fra nettadresse) | 8–24 timer, noen ganger lenger | Googles servere | Ingen manuell oppdatering; ignorerer oppdateringshint; navn og tidssone leses bare ved første abonnement |
| Outlook.com | Omtrent 3 timer | Microsofts servere | Fast; kan overstige 24 timer |
| Outlook på nettet (jobb, skole) | Omtrent 4–6 timer | Microsofts servere | Fast; kan ikke styres av brukeren |
| Klassisk Outlook for Windows | Ved Send/motta; omtrent hver time med **Oppdateringsgrense** | PC-en din | Abonner via `webcal`-lenken; synkroniseres ikke til telefon eller nett |
| Apple Kalender (macOS) | 5 minutter til ukentlig, standard hver time | Mac-en din | Lagre i iCloud for å nå iPhone og iPad |
| Apple Kalender (bare iOS) | Etter **Hent nye data**, avhengig av batteriet | Telefonen din | Abonner på en Mac for pålitelighet |
| Thunderbird | 1–60 minutter | Datamaskinen din | |
| Fastmail | Omtrent hver time | Fastmails servere | Deaktiveres etter fem mislykkede hentinger |
| Proton Calendar | 4–16 timer | Protons servere | Avviser store feeder |

OneUptime selv leverer ferske data: en endring i et lag, en rotasjon, en overstyring eller en tilknytning til en retningslinje gjør feeden ugyldig med en gang, og svar mellomlagres i høyst fem minutter. Ventetiden du ser, er kalenderappens, ikke serverens. OneUptime foreslår oppdatering hver time via `REFRESH-INTERVAL` og `X-PUBLISHED-TTL`; bare klassisk Outlook følger hintet, og bare med **Oppdateringsgrense** på — Apple Kalender, Thunderbird og resten oppdaterer med intervallet du angir per kalender.

## https- og webcal-lenker

Begge peker på den samme feeden. `webcal://` er lenken med et annet skjema, slik at operativsystemet åpner en kalenderapp i stedet for en nettleser; appen henter deretter feeden over `https://` når serveren leverer https, slik Apple Kalender og Google Kalender gjør.

- **Kopier lenke** gir `https://`-formen. **Fra nettadresse** i Google Kalender, Outlook på nettet, Thunderbird og Fastmail tar den.
- **Apple Kalender / Outlook** åpner `webcal://`-formen: Apple Kalender og klassisk Outlook for Windows abonnerer fra den. I klassisk Outlook er det å åpne `https://`-formen i stedet en engangsimport.
- **Google Kalender** legger `webcal://`-formen inn i Googles lenke for å legge til via URL, den eneste formen den siden tar.
- OneUptime deler ikke lenger ut `webcals://`: iOS åpner det ikke ("adressen er ugyldig"), og Google tar det heller ikke. En kalender du allerede abonnerer på med en `webcals://`-lenke, fortsetter å fungere.
- Kjører installasjonen din fortsatt på vanlig `http`, hentes feeden i klartekst, tokenet medregnet, og dashbordet viser en advarsel ved lenken; bytt til `https` før du deler lenker bredt.

Feed-URL-er videresender aldri. De svarer `200` på det skjemaet som når OneUptime, fordi appen ikke kan se hvilket skjema kalenderappen brukte når TLS avsluttes foran den — på OneUptime Cloud eller bak din egen lastbalanserer eller CDN — og en videresending der peker tilbake på den samme URL-en. Send vanlig `http` videre til `https` på proxyen som avslutter TLS, det ene hoppet som vet det.

## Påminnelser og meldinger om ny tildeling

Kalenderapper leverer ikke alarmer fra abonnerte feeder — Google forkaster dem, Apple fjerner dem som standard, Outlook flater dem ut — så OneUptime sender sine egne.

:::steps
1. Åpne **Brukerinnstillinger** > **Kalender** > **Kalenderfeed**.
2. Velg på kortet **Påminn meg før vakter** hvor lang tid i forveien: **1 uke**, **1 dag**, **1 time**, **15 min** eller, med **Egendefinert**, en egen verdi mellom 15 minutter og 14 dager. Du kan velge flere samtidig.
3. Velg hvordan påminnelser når deg under **Før vakten min starter** på **Brukerinnstillinger** > **Varselinnstillinger** (fanen Vakt). E-post og push er på som standard.
:::

Hver påminnelse sendes én gang per vakt. Meldingen nevner vaktplanen, retningslinjene den varsler gjennom, og starttidspunktet i din tidssone.

- En vakt som havner innenfor en av påminnelsestidene dine på grunn av en sen overstyring — noen gir deg en vakt 20 minutter før den starter — får straks én innhentingspåminnelse.
- Gis en vakt du har fått påminnelse om, til noen andre, får du **Min kommende vakt blir tildelt noen andre**, en egen hendelsestype, så den kan dempes for seg selv.
- Påminnelser sendes aldri etter at en vakt har startet, og aldri for vaktplaner som ikke er knyttet til noen eskaleringsretningslinje, fordi de ikke kan varsle noen.
- På WhatsApp kommer en påminnelse via Metas forhåndsgodkjente vaktmal, som nevner vaktplanen og eskaleringsretningslinjen og lenker til vaktplanen, men ikke har med starttidspunktet, og som WhatsApp bare leverer på engelsk. Meldinger om ny tildeling har ingen godkjent WhatsApp-mal, så de når deg gjennom de andre kanalene dine i stedet.

## Delte lenker for en vaktplan eller et prosjekt

En delt lenke tilhører **prosjektet**, ikke den som kopierte den, og den viser navnene til folk, aldri e-postadressene deres. Legg vaktplanlenken inn i en delt teamkalender — Google, Outlook eller Confluence — så betjener ett abonnement hele teamet.

### Vaktplanfeed

På siden til en vaktplan har kortet **Abonner på denne vaktplanen** to halvdeler: **Bare mine vakter i denne vaktplanen** (den personlige lenken din med et vaktplanfilter) og **Alles vakter i denne vaktplanen (delt teamlenke)**. Alle med tillatelsen **Rediger** på vaktplaner kan bruke **Publiser delt lenke**, fornye lenken med **Generer lenke på nytt** eller slå den av med **Deaktiver**; alle som kan lese vaktplanen, kan kopiere den. Kortet viser når lenken sist ble fornyet.

### Prosjektfeed

**Vakttjeneste** > **Kalenderfeeder** har kortet **Alles vakter i dette prosjektet (delt lenke)** — én delt lenke som dekker alle vaktplanene i prosjektet — med de samme handlingene for å publisere, generere på nytt og deaktivere, og en lenke til siden for den personlige feeden din.

### Innstillinger for delte lenker

Klikk på **Rediger innstillinger** på kortet **Innstillinger for delt lenke**:

| Innstilling | Hva den gjør |
| --- | --- |
| **Vis hull i dekningen** | Av som standard. Legger til en hendelse `No coverage · <Schedule>` overalt der et lag _skal_ dekke, men ingen har vakt: et tomt lag, et lag med startdato i fremtiden, lag som ikke henger sammen, eller et hvilket som helst hull i en vaktplan som går 24×7. Timer utenfor arbeidstid i en vaktplan for arbeidstid rapporteres aldri, og det sendes ut høyst 100 hullhendelser, de eldste først. |
| **Minste hull å vise (minutter)** | Standard 60. Skjuler kortere hull. |
| **Generer på nytt når noen forlater prosjektet** | Av som standard. Genererer lenken på nytt automatisk når noen forlater sitt siste team i prosjektet, så kalenderen til en tidligere kollega slutter å oppdateres. Alle andre må abonnere på nytt etterpå, og derfor må man slå det på selv. |
| **Dager med tidligere vakter**, **Dager fremover** | Som på den personlige feeden. |

Forny en delt lenke når noen som hadde den, slutter, eller slå på den automatiske fornyelsen ovenfor.

Når en person forlater sitt siste team i et prosjekt, fjerner OneUptime også personen fra prosjektets vaktplanlag og eskaleringsregler, sletter prosjektets pågående og fremtidige overstyringer som nevner personen (som den som blir dekket eller som avløser), deaktiverer personens personlige feed for prosjektet og sletter påminnelsene personen har der. En personlig lenke viser vakter bare så lenge eieren er medlem av prosjektet: det sjekkes hver gang lenken hentes, så den som har sluttet, får en tom kalender, og listen over kommende vakter i mobilappen dekker bare prosjektene personen fortsatt er medlem av.

## Hendelser i detalj

- Hver vakt har en fast identitet laget av vaktplanen og vaktens start, så den samme vakten er den samme hendelsen i den personlige feeden din, i vaktplanfeeden og etter at du har generert en lenke på nytt. Kalenderapper oppdaterer den på stedet; en endring øker hendelsens sekvensnummer.
- En overstyring som bytter hele vakten, beholder hendelsen og endrer personen; en overstyring som dekker en del av en vakt, gir tre hendelser som ligger inntil hverandre, for eksempel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Når en vaktplan er knyttet til to eller flere eskaleringsretningslinjer og en overstyring bare gjelder for én av dem, er det forskjellige personer som varsles per retningslinje. Feeden viser dette i stedet for å skjule det: vakten beholder hendelsen sin for personen de andre retningslinjene varsler, med en merknad som nevner retningslinjen som varsler noen andre, og avløseren får en ekstra hendelse med tittelen `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vakter i fortiden har linjen "Past shifts reflect the current rotation, not who was actually paged" i beskrivelsen.
- En vaktplan som ikke er knyttet til noen eskaleringsretningslinje, vises fortsatt, med en merknad om at den ikke vil varsle noen.

## Planlegging, ikke revisjon

Feeden viser rotasjonen **slik den er satt opp nå**, også for tidligere dager: en overstyring som legges inn i etterkant, skriver om historikken i kalenderen. For timer som faktisk er brukt på vakt, vurderinger av rettferdig fordeling og kompensasjon bruker du **Vakttjeneste** > **Rapporter** > **Brukerens vakttid**, som bygger på hva personsøkeren faktisk gjorde.

## Sikkerhet

- Tokenet i lenken er den eneste påloggingsinformasjonen. Alle som har lenken, ser vaktene — navn, vaktplaner, retningslinjer — til den genereres på nytt. Ikke lim inn lenker i chatterom eller saker; når et team trenger en kalender, deler du vaktplan- eller prosjektlenken i stedet for din personlige.
- Lenker er per prosjekt. En lekket personlig lenke avslører vaktene i ett prosjekt, ikke i alle prosjektene du er med i.
- Å generere en lenke på nytt flytter det gamle tokenet inn i en karensperiode på 30 dager (tom kalender, deretter 404). **Deaktiver** leverer en tom kalender. En ukjent eller utløpt lenke gir en ren 404 uten hint. Tomme kalendere får abonnerte apper til å tømme kopien sin; en 404 får dem til å beholde den, og derfor leverer deaktivering og ny generering tomme kalendere.
- Tokener lagres hashet; kopien som vises på innstillingssiden, er kryptert med `ENCRYPTION_SECRET`. Sett den variabelen til en ekte hemmelighet på en selvdriftet installasjon — serveren advarer ved oppstart når den ikke er satt eller fortsatt er en av plassholderne dette repositoriet leverer (`secret`, eller `please-change-this-to-random-value` som `config.example.env` setter). Endrer du den senere, tilbyr siden **Generer lenke på nytt**, fordi den lagrede kopien ikke lenger kan leses; feeden fortsetter å fungere til du gjør det.
- Feedsvar er merket `Cache-Control: private`, utelukkes fra søkemotorer (`X-Robots-Tag: noindex`) og har en hastighetsgrense per lenke og per klientadresse.

OneUptimes egen Nginx holder feedforespørsler utenfor loggene sine:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Slik havner aldri et token i en loggfil ved siden av en klientadresse; applikasjonen logger det heller aldri. `access_log off` dropper linjen per forespørsel, `error_log` dropper linjene Nginx skriver når en henting fra upstream mislykkes — uten den registreres tokenet for hver klient som henter under en omstart — og `proxy_max_temp_file_size 0` holder en stor feed unna en midlertidig fil.

> [!WARNING]
> **Enhver proxy, WAF eller CDN du kjører foran OneUptime, logger fortsatt hele URI-en, i tilgangsloggen og i feilloggen sin,** med mindre du konfigurerer den til å la være — sjekk det før du ruller ut feeder.

## Konfigurasjon ved egen drift

Ingenting må slås på: feeder fungerer på alle installasjoner. Fire miljøvariabler styrer dem, satt i `config.env` for Docker Compose eller under `onCallCalendarFeed` i Helm-verdiene (se chartens [konfigurasjonsreferanse](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variabel | Helm-verdi | Standard | Virkning |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Nødstopp. Hver feed-URL svarer `503` med `Retry-After: 3600`; abonnerte apper beholder kopien sin og prøver igjen senere. Ingenting slettes. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Lengden på vinduet for hastighetsgrensen. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Hentinger én lenke kan gjøre fra én klientadresse per vindu. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Hentinger én klientadresse kan gjøre på tvers av alle lenker per vindu — taket for et helt kontor bak én adresse. |

Også relevant:

- **`HOST` og `HTTP_PROTOCOL`** bygger lenkene. Er `HOST` tom eller `localhost`, eller er `HTTP_PROTOCOL` `http`, viser feedsiden en advarsel, og lenkene fungerer ikke utenfra. Er `HOST` en privat adresse — `10.x`, `172.16–31.x`, `192.168.x`, et navn uten punktum, for eksempel et containernavn, eller et navn under `.internal`, `.local`, `.lan` og lignende — sier siden at Google Kalender og Outlook på nettet ikke kan nå lenken; apper på en datamaskin i samme nettverk kan det fortsatt.
- **`TRUSTED_PROXY_HOPS`** avgjør hvilken adresse grensen per adresse teller. Standarden `1` er riktig for de medfølgende oppsettene for Docker Compose og Helm; legg til én for hver egen proxy — en CDN, WAF eller lastbalanserer — som legger til i `X-Forwarded-For`, ellers ser hver kalenderklient ut som den samme adressen og deler ett budsjett. Se [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) i chartens dokumentasjon.
- **Redis** støtter mellomlagrene og hastighetsbegrenseren. Begge faller pent tilbake: uten Redis bygges feeder fortsatt, bare saktere, og begrenseren slipper forespørsler gjennom.
- I Helm-chartens delte modus (`worker.enabled: true`) bygges feeder på API-laget, så dimensjoner det laget for en bølge av kalenderklienter som henter ved hver hele time.
- Unntaket for Nginx-tilgangsloggen ovenfor er en del av den medfølgende `packages/Nginx/default.conf.template`; behold det hvis du tilpasser malen.

## Feilsøking

:::details Google Kalender sier "Unable to add calendar. Check the URL."
Eldre versjoner av OneUptime la lenkens `https://`-form i knappen **Google Kalender**, og Googles side for å legge til via URL tar bare `webcal://`-formen. Last inn feedsiden på nytt og klikk på **Google Kalender** igjen, eller legg til lenken under **Andre kalendere** > **+** > **Fra nettadresse**.
:::

:::details Google Kalender viser kalenderen, men ingen vakter
Sjekk først statuslinjen på feedsiden. **Sist hentet … av Google Calendar** betyr at Google har lest lenken: åpne lenken i en nettleser og se hva den leverer — en tom kalender oppgir årsaken i `X-WR-CALDESC` (se "Kalenderen er tom" nedenfor).

**Ikke hentet ennå** betyr at Google ikke kunne lese den: fra en maskin utenfor nettverket ditt må `curl -sI <link>` svare `200` med `Content-Type: text/calendar` med en gang. En videresending, en påloggingsside, en brannmur eller en botsjekk foran OneUptime stopper Googles henter; det gjorde også en videresendingssløyfe i eldre versjoner av OneUptime, på installasjoner med `PROVISION_SSL=true` der TLS avsluttes foran Nginx. Når den svarer `200`, legger du til lenken igjen med `?nocache=1` bak, så Google leser den på nytt.
:::

:::details Ingenting har hentet lenken, eller "Kunne ikke hente nettadressen"
Google Kalender, Outlook på nettet, Fastmail og Proton henter **fra sine egne servere**, så OneUptime-verten må kunne nås fra det offentlige internett med et sertifikat de stoler på. En installasjon på et privat nettverk, bak en VPN eller med en intern sertifiseringsinstans er utilgjengelig for dem, uansett hva du limer inn.

Apple Kalender, Thunderbird og klassisk Outlook henter fra enheten, så de fungerer overalt der enheten kan åpne dashbordet — etter at sertifikatet er klarert på den enheten hvis det er selvsignert. Statuslinjen på feedsiden forteller deg om noe har hentet lenken ennå; `curl -I` mot lenken fra utenfor nettverket ditt er den raskeste sjekken:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Å la OneUptime _nå_ private nettverk — [Tilgang til privat nettverk](/docs/self-hosted/private-network-access) — er en annen sak og hjelper ikke her.
:::

:::details Kalenderen er utdatert
Les først oppdateringstabellen: for Google er forsinkelsen normal. For å få Google til å se igjen fjerner du kalenderen og legger den til på nytt, eller setter `?nocache=1` bak lenken (ukjente parametere ignoreres, så feeden er uendret, men Google behandler den som ny). Trykk på F9 i klassisk Outlook og sjekk innstillingen **Oppdateringsgrense**. Bruk **Vis** > **Oppdater kalendere** i Apple Kalender. Er en endring samme dag viktig, så stol på OneUptimes påminnelser og meldinger om ny tildeling i stedet for på kalenderen.
:::

:::details Kalenderen er tom
En tom kalender er tilsiktet. Det betyr at lenken er deaktivert, er en gammel lenke innenfor karensperioden på 30 dager etter ny generering, at prosjektet ligger under planen som inkluderer vaktplaner, eller at du ikke lenger er med i noen vaktplan i det prosjektet. Åpne lenken i en nettleser: kalenderbeskrivelsen (`X-WR-CALDESC`) oppgir årsaken. Hvis du har forlatt prosjektet, forblir lenken tom: den viser vakter bare så lenge du er medlem.
:::

:::details Lenken svarer 404
Lenken er ukjent, er slettet, eller karensperioden er over. Generer en ny og abonner på nytt.
:::

:::details Lenken svarer 503
Enten er `DISABLE_ON_CALL_CALENDAR_FEED` satt, eller serveren er opptatt: høyst noen få feeder bygges om gangen, og en vaktplan som tar svært lang tid å regne ut, avbrytes. Finnes det en tidligere kopi av feeden, leverer serveren den i stedet, med en `Warning: 110`-header, så en 503 betyr at det ikke fantes noe å falle tilbake på. Klienter beholder sin siste kopi og prøver igjen etter intervallet i `Retry-After`. Fastmail deaktiverer et abonnement etter fem feil på rad; legg det til igjen når serveren er frisk. Metrikken `oncall_calendar_render_duration_ms` viser driftsfolk hvilke feeder som er trege.
:::

:::details 429 eller "too many requests"
Mange klienter bak én adresse — en kontor-NAT, en VPN-gateway — deler budsjettet per adresse. Øk `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, og sjekk `TRUSTED_PROXY_HOPS`: når den er for lav, tilskrives hver klient din egen proxy, og alle deler ett budsjett.
:::

:::details Sertifikatfeil i Apple Kalender, Thunderbird eller Outlook
Disse appene validerer TLS på enheten. Importer din interne CA i enhetens tillitslager — nøkkelringen i macOS, sertifikatlageret i Windows, sertifikatbehandleren i Thunderbird — eller bruk et offentlig klarert sertifikat. Hentere på serversiden, som Googles og Microsofts, kan ikke fås til å stole på en privat CA.
:::

:::details Tidene er feil
Alle tider i filen er UTC; kalenderappen regner om til sin egen sone. Ser vaktene ut til å være forskjøvet med en fast forskjell, sjekker du vaktplanens tidssone (**Schedule timezone** på siden **Lag**) og din egen (**Tidssone** på **Profil**). En vaktplan uten tidssone regnes ut i serverens sone, og hendelsen sier det.
:::

:::details Feeden sier at den er kortet ned
Mer enn 5 000 hendelser falt innenfor vinduet. Senk **Dager fremover**, eller abonner på **Bare mine vakter i denne vaktplanen** i stedet for et helt prosjekt.
:::

:::details Google viser et gammelt kalendernavn
Google leser navnet bare ved første abonnement; fjern kalenderen og legg den til igjen.
:::

:::details Innstillingssiden sier at lenken må genereres på nytt
`ENCRYPTION_SECRET` er endret siden lenken ble opprettet, så serveren kan ikke lenger vise den. Det eksisterende abonnementet fortsetter å fungere; å generere på nytt gir deg en lenke du kan kopiere igjen, og trekker tilbake den gamle etter 30 dager.
:::

:::details En vakt mangler i feeden min
Bare vakter fra vaktplaner vises; direkte tildelinger av brukere eller team i en retningslinjeregel er faste og har ingen hendelser. En vakt som noen andre har overtatt gjennom en overstyring, forsvinner fra feeden din, fordi den nå er i deres. Slå på **Ta med vakter jeg dekker for andre** for å se vakter du har fått gjennom overstyringer i vaktplaner du ikke er medlem av.
:::

## Neste steg

:::cards
- [Vaktplaner](/docs/on-call/schedules): Sett opp rotasjonene feedene dine viser.
- [Tidslinje for vaktplaner](/docs/on-call/schedule-timeline): Se alle vaktplanene side om side i dashbordet.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Knytt vaktplaner til retningslinjer, så vaktene deres varsler folk.
:::
