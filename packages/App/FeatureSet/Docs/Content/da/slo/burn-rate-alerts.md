# Forbrugsrateadvarsler og -hændelser

Fejlbudgetter fortæller dig, hvor du står; forbrugsrateregler fortæller dig, hvornår du skal ud af sengen. Når et SLO bruger sit fejlbudget hurtigt nok til, at det betyder noget, udløser en forbrugsrateregel en advarsel, erklærer en hændelse eller begge dele, med din egen titel og beskrivelse, alvor, ejere, etiketter, vagteskalering og beskeder i arbejdsområdet.

:::cards
- [Hvordan en regel beslutter](#hvordan-en-regel-beslutter-at-udløse): To vinduer, begge over tærsklen.
- [Standardregler](#standardregler): Fast burn, Slow burn og Slow leak, tilpasset SLO'ets vindue.
- [Opret en regel](#opret-eller-redigér-en-regel): Fem trin på SLO'ets side Burn Rate Rules.
- [Skabelonvariabler](#hvad-hver-advarsel-og-hændelse-siger): Skriv dine egne titler og beskrivelser.
:::

## Hvad forbrugsrate betyder

Forbrugsraten er, hvor hurtigt du bruger fejlbudgettet sammenlignet med et jævnt tempo:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Ved en forbrugsrate på 1 bruger du budgettet præcis over vinduet og når målet uden noget tilovers. Højere tal bruger det op tidligere. For et SLO på 99,9 % over 30 dage:

| Forbrugsrate, hvis den fortsætter | Budgettet er brugt op efter |
| --- | --- |
| 1 | 30 dage |
| 2 | 15 dage |
| 6 | 5 dage |
| 14.4 | cirka 2 dage (50 timer) |

Forbrugsraten afhænger ikke af, hvor meget budget der er tilbage. Den svarer på "hvor slemt er det lige nu?", og det er det, du skal vide for at beslutte, om du skal tilkalde nogen.

For i stedet at handle efter, hvor meget budget der er tilbage, for eksempel kun at udgive pålidelighedsarbejde, når en fjerdedel af det er tilbage, giver du SLO'et en [fejlbudgetpolitik](/docs/slo/error-budget-policy).

## Hvordan en regel beslutter at udløse

OneUptime tjekker hver aktiveret forbrugsrateregel ved hver evaluering af SLO'et, hvert 5. minut. Hver regel måler forbrugsraten over to vinduer og udløser kun, når begge ligger på dens tærskel eller derover:

- Det **lange vindue** (for eksempel 1 time) viser, at forbruget er vedvarende og betydeligt, og ikke et enkelt mislykket tjek.
- Det **korte vindue** (for eksempel 5 minutter) viser, at det stadig sker. Uden det ville en spids for en time siden blive ved med at advare længe efter, at alt var kommet sig.

Det er mønsteret med flere vinduer og flere forbrugsrater fra Google SRE Workbook, og det, OneUptime sætter op for dig.

```mermaid title="Hvad en forbrugsrateregel gør ved hver evaluering"
flowchart TB
    start["SLO'et evalueres"] --> long(["Langt vindue<br/>på eller over<br/>tærsklen?"])
    long -->|"Nej"| recover["Løs det, der er åbent,<br/>hvis automatisk<br/>løsning er slået til"]
    long -->|"Ja"| short(["Kort vindue<br/>på eller over<br/>tærsklen?"])
    short -->|"Nej"| hold["Lad det, der er<br/>åbent, være åbent"]
    short -->|"Ja"| fire["Udløs advarslen,<br/>erklær hændelsen<br/>eller begge"]
```

En regel kan ikke udløse, før SLO'et har et helt langt vindue af overvågningshistorik: ellers ville en monitors allerførste mislykkede tjek, delt med få minutters historik, give en enorm forbrugsrate. Så et nyt SLO kan ikke udløse sin regel **Fast burn** i den første time, sin regel **Slow burn** i de første seks eller sin regel **Slow leak** i de første tre dage. Hvis et SLO senere ikke længere har så meget historik, for eksempel efter at dets monitorer er skiftet ud med nye, løser reglen det, den havde åbnet, i stedet for at lade det hænge. En regel udløser heller ikke, mens en af SLO'ets monitorer er i planlagt vedligeholdelse: se [Planlagt vedligeholdelse](#planlagt-vedligeholdelse).

## Standardregler

Hvert nyt SLO får tre forbrugsrateregler. For et vindue på 30 dage:

| Regel | Tærskel | Langt vindue | Kort vindue | Udløser, når |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 time | 5 minutter | Cirka 2 % af budgettet bruges på en time: det ville være brugt op på cirka 2 dage. |
| **Slow burn** | 6× | 6 timer | 30 minutter | Cirka 5 % af budgettet bruges på seks timer: det ville være brugt op på cirka 5 dage. |
| **Slow leak** | 1× | 3 dage | 6 timer | Cirka 10 % af budgettet bruges på tre dage: det ville være brugt op ved vinduets slutning. |

Fast burn og Slow burn er tilkald: de udløser en advarsel med projektets højeste advarselsalvor. Slow leak er en sag: den udløser sin advarsel med projektets laveste advarselsalvor. Den fanger et jævnt forbrug, som de to andre aldrig når: ved 3× er et budget på 99,9 % brugt op på 10 dage, men kun Slow leak udløser. Når dens advarsel er løst, venter den 24 timer, ikke sit lange vindue på 3 dage, før den udløser en ny.

Tærsklerne er beregnet til et budget på 30 dage, så OneUptime tilpasser dem til dit SLO's vindue. Fast burn og Slow burn betyder altid "2 % af budgettet på 1 time" og "5 % af budgettet på 6 timer":

| SLO'ets vindue | Tærskel for Fast burn | Tærskel for Slow burn |
| --- | --- | --- |
| 7 dage | 3.36× | 1.4× |
| 28 dage | 13.44× | 5.6× |
| 30 dage | 14.4× | 6× |
| 90 dage | 43.2× | 18× |

Slow leak betyder altid "10 % af budgettet på det lange vindue". Ved et vindue på 30 dage eller mere forbliver dens vinduer 3 dage og 6 timer, og dens tærskel vokser med vinduet. Ved et kortere vindue er dens lange vindue en tiendedel af SLO'ets vindue og dens korte vindue en tolvtedel af det, så dens tærskel forbliver på 1×. Blev det lange vindue holdt på 3 dage, ville tærsklen falde under 1×, og reglen ville udløse for et SLO, der er på vej til at nå sit mål.

| SLO'ets vindue | Tærskel for Slow leak | Langt vindue | Kort vindue |
| --- | --- | --- | --- |
| 7 dage | 1× | 16.8 timer | 84 minutter |
| 28 dage | 1× | 2.8 dage | 5.6 timer |
| 30 dage | 1× | 3 dage | 6 timer |
| 90 dage | 3× | 3 dage | 6 timer |

SLO'er med kalendermåned får værdierne for 30 dage. Reglerne bruger standardtitlen og -beskrivelsen, løser deres advarsler automatisk og tilføjer ingen ejere eller etiketter. Ingen af dem erklærer en hændelse, så en opgradering af OneUptime begynder aldrig at erklære hændelser for dig. Redigér dem, slet dem, eller tilføj dine egne.

### Tilføj de anbefalede regler til et eksisterende SLO

SLO'er, der blev oprettet, før Slow leak fandtes, har kun Fast burn og Slow burn: en opgradering af OneUptime tilføjer aldrig en regel, der af sig selv ville begynde at udløse advarsler. Så længe et SLO mangler en af de tre standardregler, nævner dets side **Forbrugsrateregler** dem i en note over tabellen. Klik på knappen **Tilføj anbefalede regler** i noten for at se præcis, hvad den tilføjer, tilpasset SLO'ets vindue, og bekræft. Den tilføjer kun de manglende regler, og klikker du på den igen, tilføjer den ingenting.

En regel tæller som allerede på plads, når SLO'et har en regel med samme navn eller en med samme lange vindue, uanset om den er slået til eller fra. Så en standardregel, du har omdøbt eller justeret, tilføjes aldrig to gange. Vil du ikke have en af standardreglerne, så behold reglen og deaktiver den i stedet for at slette den, så tilbyder noten den ikke længere. Du skal have tilladelse til at oprette SLO-forbrugsrateregler. Hver regel, knappen tilføjer, offentliggøres i SLO'ets feed og registreres i dets auditlogs, ligesom en regel, du selv opretter.

### Tilføj dem til mange SLO'er på én gang

Skal mange SLO'er have de anbefalede regler, så start fra SLO-listen i stedet for hvert SLO's egen side.

:::steps
#### Vælg SLO'erne

Åbn **SLOs**, og vælg de SLO'er, der skal opdateres. Vil du have alle de SLO'er med, som et filter viser, så vælg hele siden og derefter alle de matchende SLO'er, som listen tilbyder.

#### Vælg Tilføj anbefalede regler

Åbn **Massehandlinger**, og vælg **Tilføj anbefalede regler**.

#### Tjek, hvad der tilføjes, og bekræft

Før noget tilføjes, tæller bekræftelsen, hvor mange af de valgte SLO'er der får hver regel, tilpasset deres egne vinduer. Hvor SLO'er med forskellige vinduer får en regel i forskellige udgaver, som Slow leak på et 7-dages og et 30-dages SLO, viser den hver udgave med dens tærskel, dens vinduer og de SLO'er, der får den. Den fortæller også, hvor mange der allerede har alle de anbefalede regler, og hvor mange der ikke kunne læses. Klik på **Tilføj anbefalede regler** for at tilføje dem.
:::

Hvert SLO får kun de regler, det mangler, præcis som dets egen side **Forbrugsrateregler** ville tilføje dem: det samme tjek af, hvad der tæller som allerede på plads, og et feedelement og en post i dets auditlogs for hver regel. Resultatet fortæller for hvert SLO, om der blev tilføjet regler, om det allerede havde alle de anbefalede regler, eller om det ikke blev ændret og hvorfor, for eksempel et SLO, du ikke må ændre. Et SLO, der ikke bliver ændret, stopper aldrig de andre, og kører du handlingen igen på de samme SLO'er, tilføjer den ingenting. Arkiverede SLO'er er ikke på listen og får aldrig tilbudt reglerne, fordi de ikke evalueres: fjern først et SLO fra arkivet.

Scripts kan gøre det samme via API'et med en [API-nøgle](/docs/api-reference/api-reference) fra projektet. Forespørgslerne for ét SLO tager `{ "serviceLevelObjectiveId": "..." }` og svarer med reglerne i `rules`. Masseforespørgslerne tager `{ "serviceLevelObjectiveIds": ["..."] }`, højst 100 SLO'er pr. forespørgsel, og svarer med ét element for hvert SLO i `results`, i den rækkefølge, de blev angivet:

| Forespørgsel | Hvad den gør |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Viser de anbefalede regler, som SLO'et mangler. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Tilføjer dem og viser, hvad den tilføjede. Spørger du igen, tilføjes ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Fortæller, hvad hvert SLO mangler: `Missing` med reglerne, `NothingMissing` eller `Refused` for et SLO, du ikke må læse. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Tilføjer det, hvert SLO mangler, ét SLO ad gangen: `Added` med reglerne, `NothingMissing`, `Refused` eller `Failed` med de regler, der blev tilføjet, før den fejlede. Spørger du igen, tilføjes kun det, der stadig mangler. |

## Opret eller redigér en regel

Du skal have tilladelse til at oprette SLO-forbrugsrateregler.

:::steps
### Åbn Burn Rate Rules

Åbn SLO'et, gå til **Forbrugsrateregler** i sektionen **Regler** i dets sidemenu, og klik på **Opret SLO-forbrugsrateregel**, eller redigér en af standardreglerne.

### Giv reglen et navn

Under **Regel** angiver du et **Navn**, som "Fast burn". En ny regel er slået til; vil du senere stoppe den i at udløses, slår du **Aktiveret** fra på dens redigeringsformular.

### Angiv forbrugsvinduet

Under **Forbrugsvindue** angiver du **Tærskel for forbrugsrate** (for eksempel `14.4`), **Langt vindue (minutter)** og **Kort vindue (minutter)** og eventuelt **Undertrykkelse af genudløsning (minutter)**.

### Vælg, hvad den erklærer

Under **Hvad den erklærer** svarer du på **Når den udløses**: **Opret en advarsel**, standardvalget, **Erklær en hændelse** eller **Begge**. **Tilføj SLO-ejere som ejere** gør også SLO'ets ejere til ejere af alt, hvad reglen opretter.

### Beskriv advarslen og hændelsen

Trinnene **Advarsel** og **Hændelse** vises kun for det, reglen erklærer. Hvert har en titel og en alvor og sammenfoldede sektioner: **Beskrivelse**, **Ejerskab og etiketter**, **Vagt** og **Flere felter**, der rummer automatisk løsning, privatliv og afhjælpningsnoter. Nye regler starter med standardtitlen og -beskrivelsen, klar til at blive redigeret. Klik på **Opret SLO-forbrugsrateregel** i det sidste trin.
:::

OneUptime tjekker en regels tal, når du gemmer den:

| Indstilling | Skal være |
| --- | --- |
| **Tærskel for forbrugsrate** | Større end 0. |
| **Kort vindue (minutter)** | Større end 0. |
| **Langt vindue (minutter)** | Længere end det korte vindue. |
| **Undertrykkelse af genudløsning (minutter)** | 0 eller mere. Tom betyder det lange vindues længde. |

Hvert svar på **Når den udløses** åbner noget. API'et afviser en regel, der hverken ville oprette en advarsel eller erklære en hændelse, fordi den ville blive tjekket ved hver evaluering uden nogensinde at erklære noget.

Regeltabellen viser for hver regel tærsklen, vinduerne og undertrykkelsen, hvad den erklærer (og om advarslen eller hændelsen kun løses manuelt eller er privat), alvorsgraderne, vagtpolitikkerne, ejerne og etiketterne.

> [!TIP]
> Et godt udgangspunkt: behold de tre standardregler, send reglen for hurtigt forbrug til den vagtpolitik, der tilkalder folk, med høj alvor, lad reglen for langsomt forbrug udløse en advarsel med lavere alvor til arbejdstiden, og lad reglen for langsom lækage være en sag for det ansvarlige team. Arbejder dit team med hændelser, så vælg **Erklær en hændelse** for reglen for hurtigt forbrug, eller **Begge** for også at få en advarsel.

## Hvad en regel erklærer

|  | **Advarsel** | **Hændelse** |
| --- | --- | --- |
| Åbnes af | **Opret en advarsel**, standardvalget, eller **Begge** | **Erklær en hændelse** eller **Begge** |
| Hvad det er | Det lette signal: havner på advarselslisten. | Det tunge signal: får et hændelsesnummer og starter hele responsforløbet. |
| Titel og beskrivelse | Egne, eller standardteksten | Egne, eller standardteksten |
| Alvor | **Advarselsalvor**: projektets højeste, hvis tom | **Hændelsesalvor**: projektets højeste, hvis tom |
| Eskalering | **Vagtpolitikker for advarslen** | **Vagtpolitikker for hændelsen** |
| Ejere og etiketter | **Ejere af advarslen** og **Advarselsmærkater** | **Ejere af hændelsen** og **Hændelsesetiketter** |
| Privat | Fra | Fra |
| Automatisk løsning | Til | Til |
| Statussider | Aldrig offentliggjort | Aldrig offentliggjort |

Fordi hver af dem sættes op for sig, kan du sende en kort advarsel til det ansvarlige teams vagtplan og en udførlig hændelse til din vagtplan for større hændelser. De lever også hver for sig: hver bliver deduplikeret, løst og undertrykt for sig, så at løse hændelsen nulstiller ikke advarslens undertrykkelse, og omvendt.

### SLO'et er en berørt ressource

Hver advarsel og hændelse, som en forbrugsrateregel opretter, viser sit SLO under **Berørte ressourcer** og linker til det. Filteret **Berørte ressourcer** på listerne over advarsler og hændelser begrænser dem til ét SLO, og SLO'ets sider **Advarsler** og **Hændelser** viser dem, med mærker i sidemenuen, der tæller de åbne. OneUptime opretter selv denne forbindelse, og at redigere advarslen eller hændelsen fjerner den aldrig.

### Forbrugsratehændelser forbliver interne

Et fejlbudget, der brændes hurtigt af, er et signal til udviklingen, ikke et erklæret nedbrud. En forbrugsratehændelse vises aldrig på statussider og giver aldrig abonnenter på statussider besked. Den knyttes heller ikke til nogen monitorer, fordi det ellers ville omskrive selve den statushistorik for monitorerne, som SLO'et måles ud fra, når den bliver løst.

Løser du sådan en hændelse manuelt, erklærer intet den igen, før forbruget er kommet sig, og reglen virkelig udløser igen, så du aldrig kæmper mod reglen, mens du arbejder på en hændelse.

## Hvad hver advarsel og hændelse siger

Nye regler starter med standardtitlen og -beskrivelsen, både på advarslen og på hændelsen. Tøm en titel eller en beskrivelse for at gå tilbage til standardteksten. Standardtitlen er:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

Standardbeskrivelsen nævner reglen, angiver forbrugsraten for begge vinduer i forhold til tærsklen og det resterende fejlbudget.

For at skrive din egen tekst bruger du skabelonvariabler i titlen, beskrivelsen og afhjælpningsnoterne. Hvert af de felter viser dem under **Skabelonvariabler**: klik på en for at indsætte den ved markøren, eller skriv `{{` i feltet, og vælg en. Beskrivelsen og afhjælpningsnoterne har også **Indsæt variabel** i deres værktøjslinje. Variablerne udfyldes, når reglen udløser:

| Variabel | Hvad den indeholder | Eksempel |
| --- | --- | --- |
| `{{sloName}}` | SLO'ets navn. | `Checkout availability` |
| `{{sloId}}` | SLO'ets ID. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Link til SLO'et i OneUptime-dashboardet. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | SLO'ets status efter denne evaluering. | `At Risk` |
| `{{ruleName}}` | Navnet på den forbrugsrateregel, der udløste. | `Fast burn` |
| `{{burnRateThreshold}}` | Reglens forbrugsratetærskel (et multiplum af det holdbare tempo). | `14.4` |
| `{{longWindowBurnRate}}` | Forbrugsrate målt over reglens lange vindue. | `21.5` |
| `{{shortWindowBurnRate}}` | Forbrugsrate målt over reglens korte vindue. | `36` |
| `{{longWindowInMinutes}}` | Længden af reglens lange vindue, i minutter. | `60` |
| `{{shortWindowInMinutes}}` | Længden af reglens korte vindue, i minutter. | `5` |
| `{{targetPercentage}}` | SLO'ets mål, i procent. | `99.9` |
| `{{currentSliPercentage}}` | SLI'en målt over SLO'ets compliancevindue, i procent. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Andelen af fejlbudgettet, der stadig er til rådighed, i procent. Negativ, når budgettet er overskredet. | `42.5` |
| `{{errorBudgetRemaining}}` | Fejlbudget, der stadig er til rådighed, som varighed. Starter med et minustegn, når budgettet er overskredet. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Fejlbudget, der stadig er til rådighed, i minutter. | `18.37` |
| `{{windowDescription}}` | SLO'ets compliancevindue, med ord. | `rolling 30-day window` |
| `{{policyTier}}` | Navnet på det niveau i fejlbudgetpolitikken, som SLO'et er i efter denne evaluering. "None", når det ikke er i noget niveau. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Niveauets tærskel for resterende budget, i procent. Tom, når SLO'et ikke er i noget niveau. | `25` |
| `{{policyTierWhatWeDo}}` | Hvad teamet har aftalt at gøre i niveauet, som det står på niveauet. Tom, når SLO'et ikke er i noget niveau. | `Only reliability work and critical fixes ship.` |

For eksempel bliver titlen `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` til `Fast burn: Checkout availability is burning 21.5x`.

:::details Hvordan variabler udfyldes
- Tal afrundes til to decimaler.
- Mellemrum inden for tuborgklammerne er i orden: `{{ sloName }}` virker.
- En stavet forkert variabel bliver stående præcis, som den er, så en tastefejl ses i advarslen i stedet for at forsvinde i stilhed.
- Titler må være 500 tegn lange, og beskrivelser og afhjælpningsnoter 50.000. En titel, der er længere end 500 tegn, efter at variablerne er udfyldt, sættes på én linje og afkortes med en ellipse, så advarslen eller hændelsen alligevel oprettes.
- Kan linket til SLO'et ikke bygges, når reglen udløser, forbliver `{{sloLink}}` tom, og advarslen eller hændelsen oprettes alligevel.
:::

## Ejere, etiketter og privatliv

- **Ejere af advarslen** og **Ejere af hændelsen** er personer og teams, valgt fra én liste med **Tilføj ejer**. De tilføjes til advarslen eller hændelsen, så snart den oprettes, og får besked. Personer skal være medlemmer af projektet.
- **Tilføj SLO-ejere som ejere** tilføjer også SLO'ets ejere, dets ejerbrugere og medlemmerne af dets ejerteams, til alt, hvad reglen opretter. SLO'ets ejere hører allerede om selve SLO'ets statusændringer, så det kan give dem besked to gange. Det er slået fra som standard.
- Hver ejer tilføjes én gang: en bruger, der allerede er ejer af advarslen eller hændelsen, for eksempel via projektets ejerregler, eller som er med i et tilføjet ejerteam, tilføjes ikke igen.
- **Advarselsmærkater** og **Hændelsesetiketter** tilføjes til advarslen eller hændelsen, så filtre, ejerregler og beskedregler for arbejdsområdet kan matche dem.
- En privat advarsel eller hændelse er kun synlig for sine ejere, projektets administratorer og projektets ejere.

Etiketter, ejerteams og vagtpolitikker skal høre til SLO'ets projekt.

## Løsning og undertrykkelse af nye udløsninger

- **Løsning følger det lange vindue.** Med automatisk løsning slået til (standard) løser OneUptime en regels advarsel og hændelse, så snart det lange vindues forbrugsrate falder under tærsklen. At løse på det korte vindue ville give flimmer: et nedbrud, der kommer og går, ville blive løst efter fem rolige minutter og tilkalde folk igen hele natten.
- **Automatisk løsning slået fra.** Slå **Løs advarsel automatisk** eller **Løs hændelse automatisk** fra, og den post forbliver åben, indtil nogen løser den, også efter at forbruget er kommet sig. Reglen åbner ikke en ny oven i den, og når den er løst manuelt, og det lange vindue ligger under tærsklen, kan reglen udløse igen efter sin undertrykkelse.
- **Undertrykkelse af nye udløsninger.** Når en post er løst, erklærer reglen ikke den slags post igen i undertrykkelsesperioden, som standard det lange vindues længde. Så får et system, der er ved at komme sig, tid til det uden at tilkalde nogen for den støj, der er tilbage. Slow leak oprettes med 24 timer i stedet for sit lange vindue på 3 dage, så en lækage, der vender tilbage, rapporteres igen dagen efter.

Nogle ændringer løser altid det, en regel har åbnet, uanset hvad dens indstillinger for automatisk løsning siger, så intet bliver ved med at eskalere for en regel, der ikke længere kan begrunde det:

- at ændre **Når den udløses**, så advarslen eller hændelsen udelades, lukker det, det output havde åbnet;
- at slå reglen fra eller slette den;
- at slå SLO'ets evaluering fra, arkivere SLO'et eller slette det;
- at SLO'et skifter til **Sat på pause** eller **Forkert konfigureret**, fordi det så ikke måler noget;
- at reglen mister sin tærskel eller sine vinduer, eller at SLO'et ikke længere har et helt langt vindue af historik.

## Planlagt vedligeholdelse

Mens en af SLO'ets monitorer er i en igangværende vedligeholdelseshændelse, udløser dets forbrugsrateregler ikke advarsler og erklærer ikke hændelser: planlagt arbejde skal ikke tilkalde nogen. Det, reglerne allerede havde åbnet, løses stadig som normalt. Tiden tæller stadig med i fejlbudgettet, efter SLO'ets nedetidsstatusser.

## SLO'ets feed

SLO'ets **Feed** offentliggør hver advarsel, en regel udløser, og hver hændelse, den erklærer, med et link og de forbrugsrater, der forklarer den, og hvornår hver af dem løses, automatisk eller manuelt. En post, som reglen samler op igen, fordi den stadig var åben, offentliggøres ikke to gange. At oprette, redigere og slette en regel offentliggøres også og registreres i SLO'ets **Auditlogs**. Se [SLO-feed og auditlogs](/docs/slo/feed-and-audit-logs).

## Fejlfinding

:::details En regel udløste ikke lige efter, at SLO'et blev oprettet
En regel udløser kun, når SLO'et har et helt langt vindue af overvågningshistorik: en time for standardreglen for hurtigt forbrug, seks timer for den for langsomt forbrug og tre dage for den for langsom lækage, eller en tiendedel af SLO'ets vindue, når det er kortere end 30 dage.
:::

:::details En advarsel blev løst, mens nedbruddet stadig stod på
Automatisk løsning følger det lange vindue: så snart det lange vindues forbrugsrate falder under tærsklen, løses advarslen. Giv reglen et længere langt vindue, eller slå **Løs advarsel automatisk** fra, og løs advarslen manuelt.
:::

:::details Intet udløste under en vedligeholdelseshændelse
Forbrugsrateregler er tavse, mens en af SLO'ets monitorer er i en igangværende vedligeholdelseshændelse. Nedetiden tæller stadig med i budgettet.
:::

:::details Er der et minimumsantal målinger?
Ikke for SLO'er, der måles på monitorernes tilgængelighed. Tilgængelighed måles i sekunder, så hvert sekund i vinduet er en måling, og der er ikke noget tilfælde med lav trafik at beskytte sig mod. Et minimumsantal målinger har kun betydning for hændelsesbaserede SLI'er, som endnu ikke findes.
:::

## Næste trin

:::cards
- [Fejlbudgetter](/docs/slo/error-budget): Hvad budgettet er, og hvor længe det holder.
- [Fejlbudgetpolitik](/docs/slo/error-budget-policy): Handl efter, hvor meget budget der er tilbage, niveau for niveau.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvem der tilkaldes, og i hvilken rækkefølge.
- [SLO-feed og auditlogs](/docs/slo/feed-and-audit-logs): Hver advarsel og hændelse, en regel udløser.
:::
