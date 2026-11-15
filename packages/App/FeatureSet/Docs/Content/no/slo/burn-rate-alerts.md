# Forbruksratevarsler og -hendelser

Feilbudsjetter forteller deg hvor du står; forbruksrateregler forteller deg når du må ut av sengen. Når et SLO bruker feilbudsjettet sitt fort nok til at det betyr noe, utløser en forbruksrateregel et varsel, erklærer en hendelse eller begge deler, med din egen tittel og beskrivelse, alvorsgrad, eiere, etiketter, vakteskalering og varsler i arbeidsområdet.

:::cards
- [Hvordan en regel bestemmer seg](#hvordan-en-regel-bestemmer-seg-for-å-utløses): To vinduer, begge over terskelen.
- [Standardregler](#standardregler): Fast burn, Slow burn og Slow leak, tilpasset vinduet til SLO-et.
- [Opprett en regel](#opprett-eller-rediger-en-regel): Fem trinn på siden Burn Rate Rules til SLO-et.
- [Malvariabler](#hva-hvert-varsel-og-hver-hendelse-sier): Skriv dine egne titler og beskrivelser.
:::

## Hva forbruksrate betyr

Forbruksraten er hvor fort du bruker feilbudsjettet, sammenlignet med et jevnt tempo:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Med en forbruksrate på 1 bruker du budsjettet akkurat over vinduet og når målet uten noe til overs. Høyere tall bruker det opp tidligere. For et SLO på 99,9 % over 30 dager:

| Forbruksrate, hvis den vedvarer | Budsjettet er brukt opp etter |
| --- | --- |
| 1 | 30 dager |
| 2 | 15 dager |
| 6 | 5 dager |
| 14.4 | omtrent 2 dager (50 timer) |

Forbruksraten avhenger ikke av hvor mye budsjett som er igjen. Den svarer på «hvor ille er det nå?», og det er det du må vite for å bestemme om du skal tilkalle noen.

For heller å handle etter hvor mye budsjett som er igjen, for eksempel bare levere pålitelighetsarbeid når en fjerdedel er igjen, gir du SLO-et en [feilbudsjettpolicy](/docs/slo/error-budget-policy).

## Hvordan en regel bestemmer seg for å utløses

OneUptime sjekker hver aktivert forbruksrateregel ved hver evaluering av SLO-et, hvert 5. minutt. Hver regel måler forbruksraten over to vinduer og utløses bare når begge ligger på terskelen eller over:

- Det **lange vinduet** (for eksempel 1 time) viser at forbruket er vedvarende og betydelig, og ikke én mislykket sjekk.
- Det **korte vinduet** (for eksempel 5 minutter) viser at det fortsatt skjer. Uten det ville en topp for en time siden fortsatt varsle lenge etter at alt var i orden igjen.

Dette er mønsteret med flere vinduer og flere forbruksrater fra Google SRE Workbook, og det OneUptime setter opp for deg.

```mermaid title="Hva en forbruksrateregel gjør ved hver evaluering"
flowchart TB
    start["SLO-et evalueres"] --> long(["Langt vindu<br/>på eller over<br/>terskelen?"])
    long -->|"Nei"| recover["Løs det som er åpent,<br/>hvis automatisk<br/>løsning er på"]
    long -->|"Ja"| short(["Kort vindu<br/>på eller over<br/>terskelen?"])
    short -->|"Nei"| hold["La det som er<br/>åpent, være åpent"]
    short -->|"Ja"| fire["Utløs varselet,<br/>erklær hendelsen<br/>eller begge"]
```

En regel kan ikke utløses før SLO-et har et helt langt vindu med overvåkingshistorikk: ellers ville den aller første mislykkede sjekken til en monitor, delt på noen få minutter med historikk, gi en enorm forbruksrate. Et nytt SLO kan derfor ikke utløse regelen **Fast burn** den første timen, regelen **Slow burn** de første seks eller regelen **Slow leak** de første tre dagene. Har et SLO senere ikke lenger så mye historikk, for eksempel etter at monitorene er byttet ut med nye, løser regelen det den hadde åpnet, i stedet for å la det henge. En regel utløses heller ikke mens en av monitorene til SLO-et er i planlagt vedlikehold: se [Planlagt vedlikehold](#planlagt-vedlikehold).

## Standardregler

Hvert nytt SLO får tre forbruksrateregler. For et vindu på 30 dager:

| Regel | Terskel | Langt vindu | Kort vindu | Utløses når |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 time | 5 minutter | Omtrent 2 % av budsjettet brukes på en time: det ville vært brukt opp på omtrent 2 dager. |
| **Slow burn** | 6× | 6 timer | 30 minutter | Omtrent 5 % av budsjettet brukes på seks timer: det ville vært brukt opp på omtrent 5 dager. |
| **Slow leak** | 1× | 3 dager | 6 timer | Omtrent 10 % av budsjettet brukes på tre dager: det ville vært brukt opp når vinduet slutter. |

Fast burn og Slow burn er tilkallinger: de utløser et varsel med prosjektets høyeste varselsalvorsgrad. Slow leak er en sak: den utløser varselet sitt med prosjektets laveste varselsalvorsgrad. Den fanger opp et jevnt forbruk som de to andre aldri når: ved 3× er et budsjett på 99,9 % brukt opp på 10 dager, men bare Slow leak utløses. Når varselet er løst, venter den 24 timer, ikke det lange vinduet sitt på 3 dager, før den utløser et nytt.

Tersklene er regnet ut for et budsjett på 30 dager, så OneUptime tilpasser dem til vinduet til SLO-et ditt. Fast burn og Slow burn betyr alltid «2 % av budsjettet på 1 time» og «5 % av budsjettet på 6 timer»:

| Vinduet til SLO-et | Terskel for Fast burn | Terskel for Slow burn |
| --- | --- | --- |
| 7 dager | 3.36× | 1.4× |
| 28 dager | 13.44× | 5.6× |
| 30 dager | 14.4× | 6× |
| 90 dager | 43.2× | 18× |

Slow leak betyr alltid «10 % av budsjettet på det lange vinduet». Med et vindu på 30 dager eller mer forblir vinduene 3 dager og 6 timer, og terskelen vokser med vinduet. Med et kortere vindu er det lange vinduet en tidel av vinduet til SLO-et og det korte vinduet en tolvtedel av det, så terskelen blir liggende på 1×. Ble det lange vinduet holdt på 3 dager, ville terskelen falt under 1×, og regelen ville blitt utløst for et SLO som er i rute til å nå målet sitt.

| Vinduet til SLO-et | Terskel for Slow leak | Langt vindu | Kort vindu |
| --- | --- | --- | --- |
| 7 dager | 1× | 16.8 timer | 84 minutter |
| 28 dager | 1× | 2.8 dager | 5.6 timer |
| 30 dager | 1× | 3 dager | 6 timer |
| 90 dager | 3× | 3 dager | 6 timer |

SLO-er med kalendermåned får verdiene for 30 dager. Reglene bruker standardtittelen og -beskrivelsen, løser varslene sine automatisk og legger ikke til eiere eller etiketter. Ingen av dem erklærer en hendelse, så en oppgradering av OneUptime begynner aldri å erklære hendelser for deg. Rediger dem, slett dem eller legg til dine egne.

### Legg til de anbefalte reglene på et eksisterende SLO

SLO-er som ble opprettet før Slow leak fantes, har bare Fast burn og Slow burn: en oppgradering av OneUptime legger aldri til en regel som ville begynt å utløse varsler av seg selv. Så lenge et SLO mangler en av de tre standardreglene, nevner siden **Forbruksrateregler** til SLO-et dem i en merknad over tabellen. Klikk på knappen **Legg til anbefalte regler** i merknaden for å se nøyaktig hva den legger til, tilpasset vinduet til SLO-et, og bekreft. Den legger bare til reglene som mangler, og klikker du på den igjen, legger den ikke til noe.

En regel teller som allerede på plass når SLO-et har en regel med samme navn, eller en med samme lange vindu, enten den er slått på eller av. En standardregel du har gitt nytt navn eller justert, legges derfor aldri til to ganger. Vil du ikke ha en av standardreglene, så behold regelen og deaktiver den i stedet for å slette den, så tilbyr merknaden den ikke lenger. Du trenger tillatelse til å opprette SLO-forbruksrateregler. Hver regel knappen legger til, publiseres i feeden til SLO-et og registreres i revisjonsloggene, som en regel du oppretter selv.

### Legg dem til på mange SLO-er på én gang

Skal mange SLO-er få de anbefalte reglene, starter du fra SLO-listen i stedet for fra siden til hvert enkelt SLO.

:::steps
#### Velg SLO-ene

Åpne **SLOs** og velg SLO-ene som skal oppdateres. Vil du ha med alle SLO-ene et filter viser, velger du hele siden og deretter alle de samsvarende SLO-ene listen tilbyr.

#### Velg Legg til anbefalte regler

Åpne **Massehandlinger** og velg **Legg til anbefalte regler**.

#### Sjekk hva som legges til, og bekreft

Før noe legges til, teller bekreftelsen hvor mange av de valgte SLO-ene som får hver regel, tilpasset vinduet til hvert enkelt SLO. Der SLO-er med ulike vinduer får en regel i ulike utgaver, som Slow leak på et 7-dagers og et 30-dagers SLO, viser den hver utgave med terskelen, vinduene og SLO-ene som får den. Den sier også hvor mange som allerede har alle de anbefalte reglene, og hvor mange som ikke kunne leses. Klikk på **Legg til anbefalte regler** for å legge dem til.
:::

Hvert SLO får bare reglene det mangler, nøyaktig slik siden **Forbruksrateregler** til SLO-et ville lagt dem til: den samme sjekken av hva som teller som allerede på plass, og et feedelement og en oppføring i revisjonsloggene for hver regel. Resultatet sier for hvert SLO om regler ble lagt til, om det allerede hadde alle de anbefalte reglene, eller om det ikke ble endret og hvorfor, for eksempel et SLO du ikke har lov til å endre. Et SLO som ikke endres, stopper aldri de andre, og kjører du handlingen på nytt på de samme SLO-ene, legges ingenting til. Arkiverte SLO-er står ikke i listen og blir aldri tilbudt reglene, fordi de ikke evalueres: fjern et SLO fra arkivet først.

Skript kan gjøre det samme gjennom API-et, med en [API-nøkkel](/docs/api-reference/api-reference) fra prosjektet. Forespørslene for ett SLO tar `{ "serviceLevelObjectiveId": "..." }` og svarer med reglene i `rules`. Masseforespørslene tar `{ "serviceLevelObjectiveIds": ["..."] }`, høyst 100 SLO-er per forespørsel, og svarer med ett element for hvert SLO i `results`, i rekkefølgen de ble oppgitt i:

| Forespørsel | Hva den gjør |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Viser de anbefalte reglene SLO-et mangler. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Legger dem til og viser hva den la til. Spør du igjen, legges ingenting til. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Sier hva hvert SLO mangler: `Missing` med reglene, `NothingMissing` eller `Refused` for et SLO du ikke har lov til å lese. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Legger til det hvert SLO mangler, ett SLO om gangen: `Added` med reglene, `NothingMissing`, `Refused` eller `Failed` med reglene som ble lagt til før den feilet. Spør du igjen, legges bare det til som fortsatt mangler. |

## Opprett eller rediger en regel

Du trenger tillatelse til å opprette SLO-forbruksrateregler.

:::steps
### Åpne Burn Rate Rules

Åpne SLO-et, gå til **Forbruksrateregler** i seksjonen **Regler** i sidemenyen, og klikk på **Opprett SLO-forbruksrateregel**, eller rediger en av standardreglene.

### Gi regelen et navn

Under **Regel** skriver du inn et **Navn**, som «Fast burn». En ny regel er slått på; vil du senere hindre den i å utløses, slår du av **Aktivert** i redigeringsskjemaet.

### Angi forbruksvinduet

Under **Forbruksvindu** angir du **Terskel for forbruksrate** (for eksempel `14.4`), **Langt vindu (minutter)** og **Kort vindu (minutter)**, og eventuelt **Undertrykking av ny utløsning (minutter)**.

### Velg hva den erklærer

Under **Hva den erklærer** svarer du på **Når den utløses**: **Opprett et varsel**, standardvalget, **Erklær en hendelse** eller **Begge**. **Legg til SLO-eiere som eiere** gjør også eierne av SLO-et til eiere av alt regelen oppretter.

### Beskriv varselet og hendelsen

Trinnene **Varsel** og **Hendelse** vises bare for det regelen erklærer. Hvert av dem har en tittel og en alvorsgrad, og sammenslåtte seksjoner: **Beskrivelse**, **Eierskap og etiketter**, **Vakt** og **Flere felt**, som inneholder automatisk løsning, personvern og utbedringsnotater. Nye regler starter med standardtittelen og -beskrivelsen, klare til å redigeres. Klikk på **Opprett SLO-forbruksrateregel** i det siste trinnet.
:::

OneUptime sjekker tallene til en regel når du lagrer den:

| Innstilling | Må være |
| --- | --- |
| **Terskel for forbruksrate** | Større enn 0. |
| **Kort vindu (minutter)** | Større enn 0. |
| **Langt vindu (minutter)** | Lengre enn det korte vinduet. |
| **Undertrykking av ny utløsning (minutter)** | 0 eller mer. Tom betyr lengden på det lange vinduet. |

Hvert svar på **Når den utløses** åpner noe. API-et avviser en regel som verken ville opprettet et varsel eller erklært en hendelse, fordi den ville blitt sjekket ved hver evaluering uten noen gang å erklære noe.

Regeltabellen viser for hver regel terskelen, vinduene og undertrykkingen, hva den erklærer (og om varselet eller hendelsen bare løses for hånd, eller er privat), alvorsgradene, vaktpolicyene, eierne og etikettene.

> [!TIP]
> Et godt utgangspunkt: behold de tre standardreglene, send regelen for raskt forbruk til vaktpolicyen som tilkaller folk, med høy alvorsgrad, la regelen for sakte forbruk utløse et varsel med lavere alvorsgrad for arbeidstiden, og la regelen for sakte lekkasje være en sak for teamet som eier tjenesten. Jobber teamet ditt med hendelser, velger du **Erklær en hendelse** for regelen for raskt forbruk, eller **Begge** for også å få et varsel.

## Hva en regel erklærer

|  | **Varsel** | **Hendelse** |
| --- | --- | --- |
| Åpnes av | **Opprett et varsel**, standardvalget, eller **Begge** | **Erklær en hendelse** eller **Begge** |
| Hva det er | Det lette signalet: havner i listen over varsler. | Det tunge signalet: får et hendelsesnummer og starter hele responsforløpet. |
| Tittel og beskrivelse | Egne, eller standardteksten | Egne, eller standardteksten |
| Alvorsgrad | **Varselsalvor**: prosjektets høyeste hvis tom | **Hendelsesalvor**: prosjektets høyeste hvis tom |
| Eskalering | **Vaktpolicyer for varselet** | **Vaktpolicyer for hendelsen** |
| Eiere og etiketter | **Eiere av varselet** og **Varseletiketter** | **Eiere av hendelsen** og **Hendelsesetiketter** |
| Privat | Av | Av |
| Automatisk løsning | På | På |
| Statussider | Aldri publisert | Aldri publisert |

Fordi hver av dem settes opp for seg, kan du sende et kort varsel til vaktplanen til teamet som eier tjenesten, og en utførlig hendelse til vaktplanen for større hendelser. De lever også hver for seg: hver av dem dedupliseres, løses og undertrykkes for seg, så å løse hendelsen nullstiller ikke undertrykkingen av varselet, og omvendt.

### SLO-et er en berørt ressurs

Hvert varsel og hver hendelse som en forbruksrateregel oppretter, viser SLO-et sitt under **Berørte ressurser** og lenker til det. Filteret **Berørte ressurser** i listene over varsler og hendelser begrenser dem til ett SLO, og sidene **Varsler** og **Hendelser** til SLO-et viser dem, med merker i sidemenyen som teller de åpne. OneUptime lager denne koblingen selv, og å redigere varselet eller hendelsen fjerner den aldri.

### Forbruksratehendelser forblir interne

Et feilbudsjett som brennes fort, er et signal til utviklingen, ikke et erklært brudd. En forbruksratehendelse vises aldri på statussider og gir aldri abonnenter på statussider beskjed. Den knyttes heller ikke til noen monitorer, fordi det å løse den ellers ville skrevet om selve statushistorikken til monitorene som SLO-et måles ut fra.

Løser du en slik hendelse for hånd, erklærer ingenting den igjen før forbruket har hentet seg inn og regelen virkelig utløses på nytt, så du aldri kjemper mot regelen mens du jobber med en hendelse.

## Hva hvert varsel og hver hendelse sier

Nye regler starter med standardtittelen og -beskrivelsen, både på varselet og på hendelsen. Tøm en tittel eller beskrivelse for å gå tilbake til standardteksten. Standardtittelen er:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

Standardbeskrivelsen nevner regelen og oppgir forbruksraten for begge vinduene mot terskelen, og gjenværende feilbudsjett.

For å skrive din egen tekst bruker du malvariabler i tittelen, beskrivelsen og utbedringsnotatene. Hvert av disse feltene viser dem under **Malvariabler**: klikk på en for å sette den inn ved markøren, eller skriv `{{` i feltet og velg en. Beskrivelsen og utbedringsnotatene har også **Sett inn variabel** i verktøylinjen. Variablene fylles ut når regelen utløses:

| Variabel | Hva den inneholder | Eksempel |
| --- | --- | --- |
| `{{sloName}}` | Navnet til SLO-et. | `Checkout availability` |
| `{{sloId}}` | ID-en til SLO-et. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Lenke til SLO-et i OneUptime-dashbordet. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Statusen til SLO-et etter denne evalueringen. | `At Risk` |
| `{{ruleName}}` | Navnet på forbruksrateregelen som ble utløst. | `Fast burn` |
| `{{burnRateThreshold}}` | Forbruksrateterskelen til regelen (et multiplum av det bærekraftige tempoet). | `14.4` |
| `{{longWindowBurnRate}}` | Forbruksrate målt over det lange vinduet til regelen. | `21.5` |
| `{{shortWindowBurnRate}}` | Forbruksrate målt over det korte vinduet til regelen. | `36` |
| `{{longWindowInMinutes}}` | Lengden på det lange vinduet til regelen, i minutter. | `60` |
| `{{shortWindowInMinutes}}` | Lengden på det korte vinduet til regelen, i minutter. | `5` |
| `{{targetPercentage}}` | Målet til SLO-et, i prosent. | `99.9` |
| `{{currentSliPercentage}}` | SLI-en målt over samsvarsvinduet til SLO-et, i prosent. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Andelen av feilbudsjettet som fortsatt er tilgjengelig, i prosent. Negativ når budsjettet er overskredet. | `42.5` |
| `{{errorBudgetRemaining}}` | Feilbudsjett som fortsatt er tilgjengelig, som varighet. Starter med et minustegn når budsjettet er overskredet. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Feilbudsjett som fortsatt er tilgjengelig, i minutter. | `18.37` |
| `{{windowDescription}}` | Samsvarsvinduet til SLO-et, med ord. | `rolling 30-day window` |
| `{{policyTier}}` | Navnet på nivået i feilbudsjettpolicyen som SLO-et er i etter denne evalueringen. "None" når det ikke er i noe nivå. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Terskelen for gjenværende budsjett for det nivået, i prosent. Tom når SLO-et ikke er i noe nivå. | `25` |
| `{{policyTierWhatWeDo}}` | Hva teamet har avtalt å gjøre i det nivået, slik det står på nivået. Tom når SLO-et ikke er i noe nivå. | `Only reliability work and critical fixes ship.` |

For eksempel blir tittelen `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` til `Fast burn: Checkout availability is burning 21.5x`.

:::details Hvordan variabler fylles ut
- Tall avrundes til to desimaler.
- Mellomrom inne i klammeparentesene går fint: `{{ sloName }}` fungerer.
- En feilstavet variabel blir stående nøyaktig som den er, så en skrivefeil synes i varselet i stedet for å forsvinne i stillhet.
- Titler kan være 500 tegn lange, og beskrivelser og utbedringsnotater 50 000. En tittel som blir lengre enn 500 tegn etter at variablene er fylt ut, settes på én linje og kortes ned med en ellipse, så varselet eller hendelsen likevel opprettes.
- Kan lenken til SLO-et ikke bygges når regelen utløses, blir `{{sloLink}}` tom, og varselet eller hendelsen opprettes likevel.
:::

## Eiere, etiketter og personvern

- **Eiere av varselet** og **Eiere av hendelsen** er personer og team, valgt fra én liste med **Legg til eier**. De legges til på varselet eller hendelsen så snart det opprettes, og får beskjed. Personer må være medlemmer av prosjektet.
- **Legg til SLO-eiere som eiere** legger også til eierne av SLO-et, eierbrukerne og medlemmene av eierteamene, på alt regelen oppretter. Eierne av SLO-et får allerede høre om statusendringene til selve SLO-et, så dette kan gi dem beskjed to ganger. Det er slått av som standard.
- Hver eier legges til én gang: en bruker som allerede er eier av varselet eller hendelsen, for eksempel via prosjektets eierregler, eller som er med i et eierteam som er lagt til, legges ikke til på nytt.
- **Varseletiketter** og **Hendelsesetiketter** legges til på varselet eller hendelsen, så filtre, eierregler og varslingsregler for arbeidsområdet kan treffe dem.
- Et privat varsel eller en privat hendelse er bare synlig for eierne, prosjektadministratorene og prosjekteierne.

Etiketter, eierteam og vaktpolicyer må høre til prosjektet til SLO-et.

## Løsning og undertrykking av nye utløsninger

- **Løsning følger det lange vinduet.** Med automatisk løsning på (standard) løser OneUptime varselet og hendelsen til en regel så snart forbruksraten i det lange vinduet faller under terskelen. Å løse på det korte vinduet ville gitt flimring: et brudd som kommer og går, ville blitt løst etter fem rolige minutter og tilkalt folk igjen hele natten.
- **Automatisk løsning av.** Slå av **Løs varsel automatisk** eller **Løs hendelse automatisk**, så blir den posten stående åpen til noen løser den, også etter at forbruket har hentet seg inn. Regelen åpner ikke en ny oppå den, og når den er løst for hånd og det lange vinduet er under terskelen, kan regelen utløses igjen etter undertrykkingen.
- **Undertrykking av nye utløsninger.** Etter at en post er løst, erklærer ikke regelen den typen post igjen i undertrykkingsperioden, som standard lengden på det lange vinduet. Da får et system som henter seg inn, tid til det uten å tilkalle noen for støyen som er igjen. Slow leak opprettes med 24 timer i stedet for det lange vinduet sitt på 3 dager, så en lekkasje som kommer tilbake, rapporteres igjen dagen etter.

Noen endringer løser alltid det en regel har åpnet, uansett hva innstillingene for automatisk løsning sier, så ingenting fortsetter å eskalere for en regel som ikke lenger kan begrunne det:

- å endre **Når den utløses** slik at varselet eller hendelsen utelates, lukker det den utgangen hadde åpnet;
- å slå av regelen eller slette den;
- å slå av evalueringen av SLO-et, arkivere SLO-et eller slette det;
- at SLO-et går over til **Pauset** eller **Feilkonfigurert**, fordi det da ikke måler noe;
- at regelen mister terskelen eller vinduene sine, eller at SLO-et ikke lenger har et helt langt vindu med historikk.

## Planlagt vedlikehold

Mens en monitor i SLO-et er i en pågående vedlikeholdshendelse, utløser ikke forbruksratereglene varsler og erklærer ikke hendelser: planlagt arbeid skal ikke tilkalle noen. Det reglene allerede hadde åpnet, løses fortsatt som vanlig. Tiden teller fortsatt mot feilbudsjettet, etter nedetidsstatusene til SLO-et.

## Feeden til SLO-et

**Feed** til SLO-et publiserer hvert varsel en regel utløser og hver hendelse den erklærer, med en lenke og forbruksratene som forklarer det, og når hver av dem løses, automatisk eller for hånd. En post som regelen plukker opp igjen fordi den fortsatt var åpen, publiseres ikke to ganger. Å opprette, redigere og slette en regel publiseres også, og registreres i **Revisjonslogger** til SLO-et. Se [SLO-feed og revisjonslogger](/docs/slo/feed-and-audit-logs).

## Feilsøking

:::details En regel ble ikke utløst rett etter at SLO-et ble opprettet
En regel utløses bare når SLO-et har et helt langt vindu med overvåkingshistorikk: én time for standardregelen for raskt forbruk, seks timer for den for sakte forbruk og tre dager for den for sakte lekkasje, eller en tidel av vinduet til SLO-et når det er kortere enn 30 dager.
:::

:::details Et varsel ble løst mens bruddet fortsatt pågikk
Automatisk løsning følger det lange vinduet: så snart forbruksraten i det lange vinduet faller under terskelen, løses varselet. Gi regelen et lengre langt vindu, eller slå av **Løs varsel automatisk** og løs varselet for hånd.
:::

:::details Ingenting ble utløst under en vedlikeholdshendelse
Forbruksrateregler er stille mens en av monitorene til SLO-et er i en pågående vedlikeholdshendelse. Nedetiden teller fortsatt mot budsjettet.
:::

:::details Finnes det et minste antall målinger?
Ikke for SLO-er som måles på tilgjengeligheten til monitorer. Tilgjengelighet måles i sekunder, så hvert sekund i vinduet er en måling, og det finnes ingen situasjon med lite trafikk å beskytte seg mot. Et minste antall målinger betyr bare noe for hendelsesbaserte SLI-er, som ennå ikke er tilgjengelige.
:::

## Neste steg

:::cards
- [Feilbudsjetter](/docs/slo/error-budget): Hva budsjettet er, og hvor lenge det varer.
- [Feilbudsjettpolicy](/docs/slo/error-budget-policy): Handle etter hvor mye budsjett som er igjen, nivå for nivå.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvem som tilkalles, og i hvilken rekkefølge.
- [SLO-feed og revisjonslogger](/docs/slo/feed-and-audit-logs): Hvert varsel og hver hendelse en regel utløser.
:::
