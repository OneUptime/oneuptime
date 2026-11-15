# Larm och incidenter för förbrukningstakt

Felbudgetar talar om var du står; regler för förbrukningstakt talar om när du måste upp ur sängen. När ett SLO förbrukar sin felbudget tillräckligt snabbt för att det ska spela roll utlöser en regel för förbrukningstakt ett larm, deklarerar en incident eller båda, med din egen rubrik och beskrivning, allvarlighetsgrad, ägare, etiketter, joureskalering och aviseringar i arbetsytan.

:::cards
- [Hur en regel bestämmer sig](#hur-en-regel-bestämmer-sig-för-att-utlösas): Två fönster, båda över tröskeln.
- [Standardregler](#standardregler): Fast burn, Slow burn och Slow leak, anpassade till SLO:ets fönster.
- [Skapa en regel](#skapa-eller-redigera-en-regel): Fem steg på SLO:ets sida Burn Rate Rules.
- [Mallvariabler](#vad-varje-larm-och-incident-säger): Skriv egna rubriker och beskrivningar.
:::

## Vad förbrukningstakt betyder

Förbrukningstakten är hur snabbt du förbrukar felbudgeten jämfört med en jämn takt:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Med förbrukningstakten 1 förbrukar du budgeten precis under fönstret och når målet utan något över. Högre tal gör slut på den tidigare. För ett SLO på 99,9 % under 30 dagar:

| Förbrukningstakt, om den håller i sig | Budgeten är slut efter |
| --- | --- |
| 1 | 30 dagar |
| 2 | 15 dagar |
| 6 | 5 dagar |
| 14.4 | ungefär 2 dagar (50 timmar) |

Förbrukningstakten beror inte på hur mycket budget som finns kvar. Den svarar på ”hur illa är det just nu?”, och det är vad du behöver veta för att avgöra om du ska larma någon.

För att i stället agera efter hur mycket budget som finns kvar, till exempel bara leverera tillförlitlighetsarbete när en fjärdedel finns kvar, ger du SLO:et en [felbudgetpolicy](/docs/slo/error-budget-policy).

## Hur en regel bestämmer sig för att utlösas

OneUptime kontrollerar varje aktiverad regel för förbrukningstakt vid varje utvärdering av SLO:et, var 5:e minut. Varje regel mäter förbrukningstakten över två fönster och utlöses bara när båda ligger på dess tröskel eller högre:

- Det **långa fönstret** (till exempel 1 timme) visar att förbrukningen är ihållande och betydande, och inte en enda misslyckad kontroll.
- Det **korta fönstret** (till exempel 5 minuter) visar att det fortfarande pågår. Utan det skulle en topp för en timme sedan fortsätta larma långt efter att allt återhämtat sig.

Det här är mönstret med flera fönster och flera förbrukningstakter från Google SRE Workbook, och det som OneUptime ställer in åt dig.

```mermaid title="Vad en regel för förbrukningstakt gör vid varje utvärdering"
flowchart TB
    start["SLO:et utvärderas"] --> long(["Långt fönster<br/>vid eller över<br/>tröskeln?"])
    long -->|"Nej"| recover["Lös det som är öppet,<br/>om automatisk<br/>lösning är på"]
    long -->|"Ja"| short(["Kort fönster<br/>vid eller över<br/>tröskeln?"])
    short -->|"Nej"| hold["Låt det som är<br/>öppet vara öppet"]
    short -->|"Ja"| fire["Utlös larmet,<br/>deklarera incidenten<br/>eller båda"]
```

En regel kan inte utlösas förrän SLO:et har ett helt långt fönster med övervakningshistorik: annars skulle en monitors allra första misslyckade kontroll, delad med några minuters historik, ge en enorm förbrukningstakt. Ett nytt SLO kan därför inte utlösa sin regel **Fast burn** under den första timmen, sin regel **Slow burn** under de första sex eller sin regel **Slow leak** under de första tre dagarna. Om ett SLO senare inte längre har så mycket historik, till exempel efter att dess monitorer bytts ut mot nya, löser regeln det den hade öppnat i stället för att lämna det hängande. En regel utlöses inte heller medan någon av SLO:ets monitorer är under planerat underhåll: se [Planerat underhåll](#planerat-underhåll).

## Standardregler

Varje nytt SLO får tre regler för förbrukningstakt. För ett fönster på 30 dagar:

| Regel | Tröskel | Långt fönster | Kort fönster | Utlöses när |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 timme | 5 minuter | Ungefär 2 % av budgeten förbrukas på en timme: den skulle vara slut på ungefär 2 dagar. |
| **Slow burn** | 6× | 6 timmar | 30 minuter | Ungefär 5 % av budgeten förbrukas på sex timmar: den skulle vara slut på ungefär 5 dagar. |
| **Slow leak** | 1× | 3 dagar | 6 timmar | Ungefär 10 % av budgeten förbrukas på tre dagar: den skulle vara slut när fönstret är över. |

Fast burn och Slow burn är till för att larma folk: de utlöser ett larm med projektets högsta allvarlighetsgrad för larm. Slow leak är ett ärende: den utlöser sitt larm med projektets lägsta allvarlighetsgrad för larm. Den fångar en jämn förbrukning som är för låg för de andra två: vid 3× är en budget på 99,9 % slut på 10 dagar, men ändå utlöses bara Slow leak. När dess larm har lösts väntar den 24 timmar, inte sitt långa fönster på 3 dagar, innan den utlöser ett nytt.

Trösklarna är beräknade för en budget på 30 dagar, så OneUptime anpassar dem till ditt SLO:s fönster. Fast burn och Slow burn betyder alltid ”2 % av budgeten på 1 timme” och ”5 % av budgeten på 6 timmar”:

| SLO:ets fönster | Tröskel för Fast burn | Tröskel för Slow burn |
| --- | --- | --- |
| 7 dagar | 3.36× | 1.4× |
| 28 dagar | 13.44× | 5.6× |
| 30 dagar | 14.4× | 6× |
| 90 dagar | 43.2× | 18× |

Slow leak betyder alltid ”10 % av budgeten på dess långa fönster”. För ett fönster på 30 dagar eller mer förblir dess långa och korta fönster 3 dagar och 6 timmar, och dess tröskel växer med fönstret. För ett kortare fönster är dess långa fönster en tiondel av SLO:ets fönster och dess korta fönster en tolftedel av det, så att dess tröskel ligger kvar på 1×. Om det långa fönstret låg kvar på 3 dagar skulle tröskeln hamna under 1×, och regeln skulle utlösas för ett SLO som är på väg att nå sitt mål.

| SLO:ets fönster | Tröskel för Slow leak | Långt fönster | Kort fönster |
| --- | --- | --- | --- |
| 7 dagar | 1× | 16,8 timmar | 84 minuter |
| 28 dagar | 1× | 2,8 dagar | 5,6 timmar |
| 30 dagar | 1× | 3 dagar | 6 timmar |
| 90 dagar | 3× | 3 dagar | 6 timmar |

SLO:er med kalendermånad får värdena för 30 dagar. Reglerna använder standardrubriken och -beskrivningen, löser sina larm automatiskt och lägger inte till några ägare eller etiketter. Ingen av dem deklarerar en incident, så en uppgradering av OneUptime börjar aldrig deklarera incidenter åt dig. Redigera dem, radera dem eller lägg till egna.

### Lägg till de rekommenderade reglerna i ett befintligt SLO

SLO:er som skapades innan Slow leak fanns har bara Fast burn och Slow burn: en uppgradering av OneUptime lägger aldrig till en regel som skulle börja utlösa larm av sig själv. Så länge ett SLO saknar någon av de tre standardreglerna nämner dess sida **Förbrukningstaktsregler** dem i en notis ovanför tabellen. Klicka på knappen **Lägg till rekommenderade regler** i notisen för att se exakt vad den lägger till, anpassat till SLO:ets fönster, och bekräfta. Den lägger bara till de regler som saknas, och klickar du på den igen läggs inget till.

En regel anses redan finnas när SLO:et har en regel med samma namn, eller en med samma långa fönster, oavsett om den är påslagen eller avstängd. En standardregel som du har bytt namn på eller justerat läggs alltså aldrig till två gånger. Vill du inte ha en av standardreglerna, behåll då regeln och inaktivera den i stället för att ta bort den, så erbjuder notisen den inte längre. Du behöver behörighet att skapa SLO-regler för förbrukningstakt. Varje regel som den lägger till publiceras i SLO:ets flöde och registreras i dess granskningsloggar, precis som en regel som du skapar själv.

### Lägg till dem i många SLO:er på en gång

Vill du ge många SLO:er de rekommenderade reglerna utgår du från SLO-listan i stället för från varje SLO:s egen sida.

:::steps
#### Markera SLO:erna

Öppna **SLOs** och markera de SLO:er som ska uppdateras. Vill du ta med varje SLO som ett filter visar markerar du hela sidan och sedan alla träffar som listan erbjuder.

#### Välj Lägg till rekommenderade regler

Öppna **Massåtgärder** och välj **Lägg till rekommenderade regler**.

#### Kontrollera vad som läggs till och bekräfta

Innan något läggs till visar bekräftelsen hur många av de markerade SLO:erna som får varje regel, anpassad till deras egna fönster. När SLO:er med olika fönster får en regel i olika varianter, till exempel Slow leak på ett SLO med ett fönster på 7 dagar och på ett med 30 dagar, listar den varje variant med dess tröskel, dess fönster och de SLO:er som får den. Den anger också hur många som redan har alla rekommenderade regler och hur många som inte kunde läsas. Klicka på **Lägg till rekommenderade regler** för att lägga till dem.
:::

Varje SLO får bara de regler som det saknar, precis som dess egen sida **Förbrukningstaktsregler** skulle lägga till dem: med samma kontroll av vad som anses redan finnas, och med en post i flödet och en post i granskningsloggarna för varje regel. Resultatet visar för varje SLO om regler lades till, om det redan hade alla rekommenderade regler eller om det inte ändrades och i så fall varför, till exempel för att det är ett SLO som du inte får ändra. Ett SLO som inte ändras stoppar aldrig de andra, och kör du åtgärden igen på samma SLO:er läggs inget till. Arkiverade SLO:er finns inte i listan och erbjuds aldrig reglerna, eftersom de inte utvärderas: avarkivera ett SLO först.

Skript kan göra samma sak via API:et, med en [API-nyckel](/docs/api-reference/api-reference) för projektet. Förfrågningarna för ett enskilt SLO tar `{ "serviceLevelObjectiveId": "..." }` och svarar med reglerna i `rules`. Massförfrågningarna tar `{ "serviceLevelObjectiveIds": ["..."] }`, högst 100 SLO:er per förfrågan, och svarar med en post för varje SLO i `results`, i den ordning de efterfrågades:

| Förfrågan | Vad den gör |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Listar de rekommenderade regler som SLO:et saknar. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Lägger till dem och listar vad den lade till. Frågar du igen läggs inget till. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Anger vad varje SLO saknar: `Missing` med reglerna, `NothingMissing`, eller `Refused` för ett SLO som du inte får läsa. Den skriver ingenting. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Lägger till det som varje SLO saknar, ett SLO i taget: `Added` med reglerna, `NothingMissing`, `Refused`, eller `Failed` med de regler som lades till innan det misslyckades. Frågar du igen läggs bara det till som fortfarande saknas. |

## Skapa eller redigera en regel

Du behöver behörighet att skapa SLO-regler för förbrukningstakt.

:::steps
### Öppna Burn Rate Rules

Öppna SLO:et, gå till **Förbrukningstaktsregler** i sektionen **Regler** i dess sidomeny och klicka på **Skapa SLO-förbrukningstaktsregel**, eller redigera en av standardreglerna.

### Ge regeln ett namn

Under **Regel** anger du ett **Namn**, som ”Fast burn”. En ny regel är påslagen; vill du senare hindra den från att utlösas stänger du av **Aktiverad** i dess redigeringsformulär.

### Ange förbrukningsfönstret

Under **Förbrukningsfönster** anger du **Tröskel för förbrukningstakt** (till exempel `14.4`), **Långt fönster (minuter)** och **Kort fönster (minuter)**, och om du vill **Undertryckning av ny utlösning (minuter)**.

### Välj vad den deklarerar

Under **Vad den deklarerar** svarar du på **När den utlöses**: **Skapa ett larm**, standardvalet, **Deklarera en incident** eller **Båda**. **Lägg till SLO-ägare som ägare** gör också SLO:ets ägare till ägare av allt som regeln skapar.

### Beskriv larmet och incidenten

Stegen **Larm** och **Incident** visas bara för det som regeln deklarerar. Var och en har en rubrik och en allvarlighetsgrad, och hopfällda avsnitt: **Beskrivning**, **Ägarskap och etiketter**, **Jour** och **Fler fält**, som innehåller automatisk lösning, sekretess och åtgärdsanteckningar. Nya regler börjar med standardrubriken och -beskrivningen, redo att redigeras. Klicka på **Skapa SLO-förbrukningstaktsregel** i det sista steget.
:::

OneUptime kontrollerar en regels siffror när du sparar den:

| Inställning | Måste vara |
| --- | --- |
| **Tröskel för förbrukningstakt** | Större än 0. |
| **Kort fönster (minuter)** | Större än 0. |
| **Långt fönster (minuter)** | Längre än det korta fönstret. |
| **Undertryckning av ny utlösning (minuter)** | 0 eller mer. Tomt betyder det långa fönstrets längd. |

Varje svar på **När den utlöses** öppnar något. API:et avvisar en regel som varken skulle skapa ett larm eller deklarera en incident, eftersom den skulle kontrolleras vid varje utvärdering utan att någonsin deklarera något.

Regeltabellen visar för varje regel tröskeln, fönstren och undertryckningen, vad den deklarerar (och om larmet eller incidenten bara löses för hand, eller är privat), allvarlighetsgraderna, jourpolicyerna, ägarna och etiketterna.

> [!TIP]
> En bra början: behåll de tre standardreglerna, skicka regeln för snabb förbrukning till den jourpolicy som larmar folk, med hög allvarlighetsgrad, låt regeln för långsam förbrukning utlösa ett larm med lägre allvarlighetsgrad för kontorstid, och låt regeln för långsamt läckage vara ett ärende för det ansvariga teamet. Arbetar ditt team med incidenter väljer du **Deklarera en incident** för regeln för snabb förbrukning, eller **Båda** för att också få ett larm.

## Vad en regel deklarerar

|  | **Larm** | **Incident** |
| --- | --- | --- |
| Öppnas av | **Skapa ett larm**, standardvalet, eller **Båda** | **Deklarera en incident** eller **Båda** |
| Vad det är | Den lätta signalen: hamnar i listan över larm. | Den tunga signalen: får ett incidentnummer och startar hela insatsflödet. |
| Rubrik och beskrivning | Egna, eller standardtexten | Egna, eller standardtexten |
| Allvarlighetsgrad | **Larmallvar**: projektets högsta om tomt | **Incidentallvar**: projektets högsta om tomt |
| Eskalering | **Jourpolicyer för larmet** | **Jourpolicyer för incidenten** |
| Ägare och etiketter | **Ägare av larmet** och **Larmetiketter** | **Ägare av incidenten** och **Incidentetiketter** |
| Privat | Av | Av |
| Automatisk lösning | På | På |
| Statussidor | Publiceras aldrig | Publiceras aldrig |

Eftersom var och en ställs in för sig kan du skicka ett kort larm till det ansvariga teamets jourschema och en utförlig incident till ditt schema för större incidenter. De lever också var för sig: var och en dedupliceras, löses och undertrycks för sig, så att lösa incidenten nollställer inte larmets undertryckning, och tvärtom.

### SLO:et är en berörd resurs

Varje larm och incident som en regel för förbrukningstakt skapar visar sitt SLO under **Berörda resurser** och länkar till det. Filtret **Berörda resurser** i listorna över larm och incidenter begränsar dem till ett SLO, och SLO:ets sidor **Larm** och **Incidenter** visar dem, med märken i sidomenyn som räknar de öppna. OneUptime skapar den här kopplingen själv, och att redigera larmet eller incidenten tar aldrig bort den.

### Incidenter för förbrukningstakt förblir interna

En felbudget som förbrukas snabbt är en signal till utvecklingen, inte ett deklarerat avbrott. En incident för förbrukningstakt visas aldrig på statussidor och aviserar aldrig statussidornas prenumeranter. Den kopplas inte heller till några monitorer, eftersom en lösning av den annars skulle skriva om just den statushistorik för monitorerna som SLO:et mäts från.

Om du löser en sådan incident för hand deklarerar inget den igen förrän förbrukningen har återhämtat sig och regeln verkligen utlöses på nytt, så att du aldrig behöver kämpa mot regeln medan du arbetar med en incident.

## Vad varje larm och incident säger

Nya regler börjar med standardrubriken och -beskrivningen, både för larmet och för incidenten. Töm en rubrik eller beskrivning för att gå tillbaka till standardtexten. Standardrubriken är:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

Standardbeskrivningen namnger regeln, anger förbrukningstakten för båda fönstren mot tröskeln och den återstående felbudgeten.

För att skriva egna texter använder du mallvariabler i rubriken, beskrivningen och åtgärdsanteckningarna. Vart och ett av de fälten listar dem under **Mallvariabler**: klicka på en för att infoga den vid markören, eller skriv `{{` i fältet och välj en. Beskrivningen och åtgärdsanteckningarna har också **Infoga variabel** i sitt verktygsfält. Variablerna fylls i när regeln utlöses:

| Variabel | Vad den innehåller | Exempel |
| --- | --- | --- |
| `{{sloName}}` | SLO:ets namn. | `Checkout availability` |
| `{{sloId}}` | SLO:ets ID. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Länk till SLO:et i OneUptimes instrumentpanel. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | SLO:ets status efter den här utvärderingen. | `At Risk` |
| `{{ruleName}}` | Namnet på regeln för förbrukningstakt som utlöstes. | `Fast burn` |
| `{{burnRateThreshold}}` | Regelns tröskel för förbrukningstakt (en multipel av den hållbara takten). | `14.4` |
| `{{longWindowBurnRate}}` | Förbrukningstakt uppmätt över regelns långa fönster. | `21.5` |
| `{{shortWindowBurnRate}}` | Förbrukningstakt uppmätt över regelns korta fönster. | `36` |
| `{{longWindowInMinutes}}` | Längden på regelns långa fönster, i minuter. | `60` |
| `{{shortWindowInMinutes}}` | Längden på regelns korta fönster, i minuter. | `5` |
| `{{targetPercentage}}` | SLO:ets mål, i procent. | `99.9` |
| `{{currentSliPercentage}}` | SLI:n uppmätt över SLO:ets efterlevnadsfönster, i procent. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Andel av felbudgeten som fortfarande är tillgänglig, i procent. Negativ när budgeten är överskriden. | `42.5` |
| `{{errorBudgetRemaining}}` | Felbudget som fortfarande är tillgänglig, som varaktighet. Börjar med ett minustecken när budgeten är överskriden. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Felbudget som fortfarande är tillgänglig, i minuter. | `18.37` |
| `{{windowDescription}}` | SLO:ets efterlevnadsfönster, i ord. | `rolling 30-day window` |
| `{{policyTier}}` | Namnet på den nivå i felbudgetpolicyn som SLO:et är i efter den här utvärderingen. "None" när det inte är i någon nivå. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Nivåns tröskel för återstående budget, i procent. Tom när SLO:et inte är i någon nivå. | `25` |
| `{{policyTierWhatWeDo}}` | Vad teamet har kommit överens om att göra i nivån, så som det står på nivån. Tom när SLO:et inte är i någon nivå. | `Only reliability work and critical fixes ship.` |

Till exempel blir rubriken `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` till `Fast burn: Checkout availability is burning 21.5x`.

:::details Hur variabler fylls i
- Tal avrundas till två decimaler.
- Blanksteg inom klammerparenteserna går bra: `{{ sloName }}` fungerar.
- En felstavad variabel står kvar precis som den är, så att ett skrivfel syns i larmet i stället för att försvinna i tysthet.
- Rubriker får vara 500 tecken långa, och beskrivningar och åtgärdsanteckningar 50 000. En rubrik som blir längre än 500 tecken när variablerna har fyllts i sätts på en rad och kortas med en ellips, så att larmet eller incidenten ändå skapas.
- Om länken till SLO:et inte kan byggas när regeln utlöses förblir `{{sloLink}}` tom, och larmet eller incidenten skapas ändå.
:::

## Ägare, etiketter och sekretess

- **Ägare av larmet** och **Ägare av incidenten** är personer och team, valda från en enda lista med **Lägg till ägare**. De läggs till på larmet eller incidenten så snart det skapas, och aviseras. Personer måste vara medlemmar i projektet.
- **Lägg till SLO-ägare som ägare** lägger också till SLO:ets ägare, dess ägaranvändare och medlemmarna i dess ägarteam, på allt som regeln skapar. SLO:ets ägare får redan höra om själva SLO:ets statusändringar, så det kan avisera dem två gånger. Det är avstängt som standard.
- Varje ägare läggs till en gång: en användare som redan är ägare av larmet eller incidenten, till exempel via projektets ägarregler, eller som ingår i ett tillagt ägarteam, läggs inte till igen.
- **Larmetiketter** och **Incidentetiketter** läggs till på larmet eller incidenten, så att filter, ägarregler och aviseringsregler för arbetsytan kan matcha dem.
- Ett privat larm eller en privat incident syns bara för sina ägare, projektets administratörer och projektets ägare.

Etiketter, ägarteam och jourpolicyer måste höra till SLO:ets projekt.

## Lösning och undertryckning av nya utlösningar

- **Lösningen följer det långa fönstret.** Med automatisk lösning påslagen (standard) löser OneUptime en regels larm och incident så snart det långa fönstrets förbrukningstakt sjunker under tröskeln. Att lösa på det korta fönstret skulle ge fladder: ett återkommande avbrott skulle lösas efter fem lugna minuter och larma folk igen hela natten.
- **Automatisk lösning avstängd.** Stäng av **Lös larm automatiskt** eller **Lös incident automatiskt**, så förblir den posten öppen tills någon löser den, även efter att förbrukningen har återhämtat sig. Regeln öppnar inte en ny ovanpå den, och när den har lösts för hand och det långa fönstret ligger under tröskeln kan regeln utlösas igen efter sin undertryckning.
- **Undertryckning av nya utlösningar.** När en post har lösts deklarerar regeln inte den typen av post igen under undertryckningsperioden, som standard det långa fönstrets längd. På så sätt får ett system som återhämtar sig tid att göra det utan att larma någon för det brus som finns kvar. Slow leak skapas med en undertryckning på 24 timmar i stället för sitt långa fönster på 3 dagar, så att en läcka som kommer tillbaka rapporteras igen nästa dag.

Vissa ändringar löser alltid det som en regel har öppnat, oavsett vad dess inställningar för automatisk lösning säger, så att inget fortsätter att eskalera för en regel som inte längre kan motivera det:

- att ändra **När den utlöses** så att larmet eller incidenten utelämnas stänger det som den utdatan hade öppnat;
- att stänga av regeln eller radera den;
- att stänga av SLO:ets utvärdering, arkivera SLO:et eller radera det;
- att SLO:et går över till **Pausad** eller **Felkonfigurerad**, eftersom det då inte mäter något;
- att regeln förlorar sin tröskel eller sina fönster, eller att SLO:et inte längre har ett helt långt fönster med historik.

## Planerat underhåll

Medan en av SLO:ets monitorer ingår i en pågående underhållshändelse utlöser dess regler för förbrukningstakt inga larm och deklarerar inga incidenter: planerat arbete ska inte larma någon. Det som reglerna redan hade öppnat löses fortfarande som vanligt. Tiden räknas fortfarande in i felbudgeten, enligt SLO:ets driftstoppsstatusar.

## SLO:ets flöde

SLO:ets **Feed** publicerar varje larm som en regel utlöser och varje incident som den deklarerar, med en länk och de förbrukningstakter som förklarar den, och när var och en löses, automatiskt eller för hand. En post som regeln plockar upp igen eftersom den fortfarande var öppen publiceras inte två gånger. Att skapa, redigera och radera en regel publiceras också, och registreras i SLO:ets **Granskningsloggar**. Se [SLO-flöde och granskningsloggar](/docs/slo/feed-and-audit-logs).

## Felsökning

:::details En regel utlöstes inte direkt efter att SLO:et skapades
En regel utlöses bara när SLO:et har ett helt långt fönster med övervakningshistorik: en timme för standardregeln för snabb förbrukning, sex timmar för den för långsam förbrukning och tre dagar för den för långsamt läckage, eller en tiondel av SLO:ets fönster när det är kortare än 30 dagar.
:::

:::details Ett larm löstes medan avbrottet fortfarande pågick
Den automatiska lösningen följer det långa fönstret: så snart det långa fönstrets förbrukningstakt sjunker under tröskeln löses larmet. Ge regeln ett längre långt fönster, eller stäng av **Lös larm automatiskt** och lös larmet för hand.
:::

:::details Inget utlöstes under en underhållshändelse
Regler för förbrukningstakt är tysta medan någon av SLO:ets monitorer ingår i en pågående underhållshändelse. Driftstoppet räknas fortfarande in i budgeten.
:::

:::details Finns det ett minsta antal mätningar?
Inte för SLO:er som mäts på monitorernas tillgänglighet. Tillgänglighet mäts i sekunder, så varje sekund i fönstret är en mätning och det finns inget fall med låg trafik att skydda sig mot. Ett minsta antal mätningar spelar bara roll för händelsebaserade SLI:er, som ännu inte finns.
:::

## Nästa steg

:::cards
- [Felbudgetar](/docs/slo/error-budget): Vad budgeten är och hur länge den räcker.
- [Felbudgetpolicy](/docs/slo/error-budget-policy): Agera efter hur mycket budget som finns kvar, nivå för nivå.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Vem som larmas, och i vilken ordning.
- [SLO-flöde och granskningsloggar](/docs/slo/feed-and-audit-logs): Varje larm och incident som en regel utlöser.
:::
