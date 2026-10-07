# Användare, team och behörigheter

Allt i OneUptime lever inuti ett **projekt**. Vem som får göra vad där inne beror på tre saker: **användarna** i projektet, de **team** de tillhör och de **behörigheter** dessa team har fått.

Den enda regel som förklarar det mesta: **användare har aldrig behörigheter direkt.** En användares åtkomst är unionen av behörigheterna från alla team användaren tillhör i projektet. Vill du ändra vad någon får göra, ändrar du deras teammedlemskap eller det teamets behörigheter.

**Ägare** är en annan sak. En ägare är den som ansvarar för en specifik resurs — en övervakare, en incident, en instrumentpanel. Ägare aviseras om sina resurser, och behörigheter kan valfritt smalnas av till "bara det jag äger".

## Modellen i korthet

```text
Projekt
  └── Team                        ← behörigheterna hänger här
       ├── Tillåtna behörigheter  ← var och en med omfattning: Alla / Ägda / Etiketter
       ├── Blockerade behörigheter ← vinner alltid över tillåtna
       └── Teammedlemmar          ← användare som accepterat inbjudan
```

| Begrepp | Vad det är |
| --- | --- |
| Användare | Ett enda OneUptime-konto. En inloggning, godtyckligt många projekt. |
| Projekt | Tenantgränsen. Övervakare, incidenter, team och data hör till exakt ett projekt. |
| Team | En namngiven grupp i ett projekt som bär behörigheterna. |
| Teammedlem | En användare som bjudits in till ett team och accepterat. |
| Behörighet | En enskild förmåga, t.ex. `CreateProjectMonitor`, eller en roll som samlar många, t.ex. `MonitorAdmin`. |
| Omfattning | Hur brett en tillåten behörighet når: alla resurser, endast ägda eller endast etiketterade. |
| Ägare | En användare eller ett team som markerats som ansvarig för en specifik resurs. |
| Etikett | En markering du sätter på resurser, använd för att begränsa behörigheter och för att organisera. |

## Användare

Ett användarkonto är globalt för OneUptime-instansen — samma inloggning fungerar i alla projekt användaren bjudits in till.

En användare är "i" ett projekt när hen är medlem i **minst ett team** där. Det finns inget separat steg "lägg till användare i projektet": att bjuda in någon till ett projekt är att bjuda in dem till ett team.

- Inbjudningar skapar en väntande teammedlem. Användaren räknas som projektmedlem — och får någon behörighet alls — **först efter att ha accepterat inbjudan.**
- Tar du bort en användare från alla team i ett projekt förlorar hen åtkomsten till projektet.
- Den som lämnar ett projekt får inte längre dess aviseringar. Personens egna aviseringsmetoder, -regler och -inställningar för projektet tas bort tillsammans med det sista teamet — e-post, SMS, samtal, WhatsApp, Telegram, push, webhook, Slack och Microsoft Teams, e-postsammanfattningen och det ännu inte skickade e-postmeddelandet, numret för inkommande samtal och jourpåminnelserna —, så den som går med igen börjar från standardinställningarna. Det som fortfarande nämner personen, till exempel användaren som en regel för inkommande samtal ringer eller en ägare som behålls på en löst incident, aviserar inte längre personen: ingenting skickas för ett projekts räkning till någon som inte är medlem, och en väntande inbjudan är ännu inget medlemskap. De ställena visar **Inte längre medlem** bredvid namnet, så att du kan sätta in någon annan. Den som är inbjuden och inte har accepterat än visar i stället **Inbjudan inte accepterad än**.
- Om projektet kräver SSO och en användare ännu inte autentiserat sig via identitetsleverantören behandlas hen som obehörig SSO-användare och ser ingenting förrän det skett. Se [SSO](/docs/identity/sso).
- Med SCIM konfigurerat kan din identitetsleverantör skapa, uppdatera och ta bort användare och deras teammedlemskap automatiskt. Se [SCIM](/docs/identity/scim).

Var du hittar det: **Inställningar → Användare** listar alla i projektet och deras inbjudningsstatus.

## Team

Team är vägen behörigheter tar till människor. Varje nytt projekt börjar med tre:

| Team | Behörighet | Redigerbart |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nej. Har alltid minst en medlem. |
| Admin | `ProjectAdmin` | Nej |
| Members | `ProjectMember` | Ja — det är en utgångspunkt, ändra fritt |

Teamen **Owners** och **Admin** är avsiktligt låsta: deras behörigheter går inte att redigera och teamen kan varken tas bort eller döpas om. Det är detta som hindrar ett projekt från att av misstag låsa ut sig självt. Owners-teamet måste alltid behålla minst en medlem.

`ProjectOwner` är den högsta åtkomstnivån: fakturering, radera projektet och allt en administratör kan göra. `ProjectAdmin` täcker allt utom fakturering och radering av projektet.

Att slå på eller av SMS, telefonsamtal, WhatsApp eller Telegram för projektet räknas som fakturering, eftersom varje meddelande kostar pengar. Bara `ProjectOwner`, rollen `BillingAdmin` (**Billing Admin**) och behörigheten `ManageProjectBilling` (**Manage Billing**) kan ändra de reglagen, under **Projektinställningar > Aviseringar > Aviseringsinställningar** — inte `ProjectAdmin`.

Att fylla på projektets förbetalda saldon räknas också som fakturering. På OneUptime Cloud betalas SMS, telefonsamtal, WhatsApp och Telegram från saldot under **Projektinställningar > Aviseringar > Aviseringsinställningar**, och AI från AI-krediterna under **Projektinställningar > AI > AI-krediter**. Bara en projektägare eller någon med **Manage Billing** kan fylla på dem eller ändra deras **Automatisk påfyllning** — inte en projektadministratör. Ett meddelande om ett saldo som håller på att ta slut säger vem som kan fylla på det, och bara de personerna får en knapp **Fyll på saldo** som fungerar, eller en länk till sidan.

Skapa hur många extra team du vill — "Frontend-jour", "Support", "Skrivskyddade granskare" — och ge varje team de behörigheter det behöver.

Var du hittar det: **Inställningar → Team**. Öppna ett team för att nå **Members** och **Permissions**; **Block Permissions** finns under **More settings** längst ned på sidan Permissions.

## Behörigheter

En behörighet är en enskild förmåga. Det finns två sätt att dela ut dem, båda på teamets flik **Permissions**.

### Roller

En roll samlar ett helt produktområde på en av tre nivåer:

- **Admin** — full kontroll över området, inklusive dess konfiguration (allvarlighetsgrader, tillstånd, mallar).
- **Member** — det dagliga arbetet: skapa, redigera och ta bort resurserna, men inte konfigurera om området.
- **Viewer** — endast läsning.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` och så vidare. Roller är nästan alltid rätt val — de förblir korrekta när OneUptime får nya funktioner, eftersom en ny övervakarrelaterad tabell läggs till de befintliga övervakarrollerna i stället för att kräva en ny tilldelning av dig.

Arbetsflöden är undantaget. Ett arbetsflöde kör sina steg inne i projektet, så `WorkflowMember` öppnar arbetsflöden och deras körningar och kör dem för hand, men skapar, ändrar eller tar inte bort dem. `WorkflowAdmin` bygger dem. Se [Konfiguration av arbetsflöden](/docs/workflows/configuration).

Alla {{PERMISSION_ROLE_COUNT}} roller finns i [Behörighetsreferensen](/docs/permissions/reference).

### Granulära behörigheter

Varje enskild förmåga går också att tilldela för sig — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` och {{PERMISSION_TOTAL_COUNT}} till. Använd dem när en roll är för bred och du behöver ge exakt en sak.

Det är också nycklarna du använder när du skapar API-nycklar, och dem API:et och Terraform-providern förväntar sig.

Hela listan finns i [Behörighetsreferensen](/docs/permissions/reference).

### Tillåt och blockera

Varje team har två listor:

- **Permissions** (tillåt) — vad detta team får göra.
- **Block Permissions** — vad detta team aldrig får göra, oavsett tillåtelser.

**Blockering vinner alltid.** En blockering utan etiketter tar bort förmågan helt för teamet. En blockering med etiketter tar bara bort den för resurser med de etiketterna — praktiskt för "det här teamet får redigera övervakare, utom de som är märkta Production".

En behörighet kan inte bära begränsningsetiketter i båda listorna samtidigt; OneUptime avvisar den andra med en förklaring.

En användares tillåtelser läggs ihop över alla dennes team, men en blockering gäller allt användaren gör: en blockering utan etiketter i ett team tar bort förmågan även där ett annat team tillåter den, och en blockering ger aldrig något. Har någon mindre åtkomst än du väntar dig, leta efter en blockering i vart och ett av personens team; har hen mer, leta efter en tillåtelse i varje team.

## Omfattning: hur långt en tillåten behörighet når

Varje tillåten behörighet ges med en omfattning som du väljer när du lägger till den:

| Omfattning | Innebörd |
| --- | --- |
| Alla resurser i projektet | Standardvalet. Behörigheten gäller alla matchande resurser. |
| Ägda av detta team eller dess medlemmar | Behörigheten gäller bara resurser där detta team, eller användaren som agerar, står som ägare. |
| Begränsa med etiketter (avancerat) | Behörigheten gäller bara resurser med minst en av de valda etiketterna. |

**Ägda** är den enklaste vägen till en modell där "man sköter sina egna tjänster": ge ett team `MonitorAdmin` med omfattningen Ägda och gör sedan teamet till ägare av de övervakare det ansvarar för. Det smalnar bara av resurser som faktiskt kan ha ägare — övervakare, incidenter, instrumentpaneler, tjänster och liknande. Projektkonfiguration (incidenttillstånd, etiketter, teamen själva) har ingen ägare, så där beter sig en roll med omfattningen Ägda helt normalt.

**Etiketter** är den mer manuella varianten av samma idé: märk resurser och ge sedan behörigheter begränsade till de märkningarna.

Vissa roller är projektomfattande per definition och erbjuder ingen omfattning alls, eftersom det vore meningslöst att smalna av dem — "Billing Admin, men bara för den fakturering jag äger" beskriver ingenting:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Ägare

En ägare är en användare eller ett team kopplat till en specifik resurs. De flesta resurser som representerar något du driver — övervakare, incidenter, larm, planerat underhåll, jourpolicyer, instrumentpaneler, tjänster, statussidor, arbetsflöden, runbooks och SLO:er — har en flik **Owners**.

Ägare gör två saker:

1. **Avisering.** Ägare är de OneUptime meddelar när något händer med resursen — en övervakare går ner, en incident skapas, en SLO börjar förbruka sin felbudget.
2. **Åtkomst, när du ber om det.** Ägarskap är det som omfattningen Ägda löses mot. En användare matchar om hen personligen är ägare, eller om något av hens team är ägare.

Ägarskap i sig ger ingenting. Att äga en övervakare ger inte rätt att redigera den om inte något av dina team också har en övervakarbehörighet. Ägarskap smalnar av åtkomst; det vidgar den aldrig.

## Etiketter

Etiketter är projektövergripande märkningar du fäster på resurser. De fyller två syften: filtrering och gruppering i panelen, och begränsning av behörigheter enligt ovan.

En etikettbegränsning är uppfylld om resursen bär **minst en** av behörighetens etiketter. En resurs helt utan etiketter uppfyller ingen etikettbegränsad behörighet.

Var du hittar det: **Inställningar → Etiketter**.

## Telemetri

Loggar, spår, mätvärden, undantag, profiler och sessionsuppspelningar hör till resursen som skickade dem: en tjänst, en värd, ett Kubernetes-kluster, en monitor, en RUM-applikation och liknande. En telemetribehörighet läser så långt som dess omfattning når:

- **Alla resurser** läser telemetrin från alla resurser i projektet.
- **Ägda** läser telemetrin från de resurser som du eller något av dina team äger, och telemetri som inte nämner någon resurs.
- **Etiketter** läser telemetrin från de resurser som bär någon av behörighetens etiketter.

En blockering med etiketter på en telemetribehörighet utelämnar telemetrin från de resurser som bär de etiketterna, oavsett vad du annars har. Det gäller överallt där telemetri läses: utforskarna med sina diagram, filter och attributlistor, exporter, sessionsuppspelningar och det som AI-assistenten läser åt dig. Listan över mätvärdesnamn visar de mätvärden som en tjänst du får läsa rapporterar, och de mätvärden som ingen tjänst rapporterar, till exempel värd- och klustermätvärden. Får du också läsa telemetri från andra slags resurser, till exempel värdar eller kluster, visar den alla mätvärdesnamn.

## API-nycklar

API-nycklar får behörigheter direkt på själva nyckeln — de tillhör inga team och påverkas inte av teammedlemskap.

- Tilldela samma granulära behörigheter och roller som du skulle ge ett team.
- Nycklar stöder **blockerade behörigheter** och **etikettbegränsningar**, precis som team.
- Nycklar stöder **inte** omfattningen Ägda. Ägarskap löses mot en användare och en nyckel är ingen användare — ge därför nycklar den åtkomst de behöver explicit.

Ge varje integration en egen nyckel med den smalaste uppsättning behörigheter som fungerar, så att du kan återkalla en utan att störa de andra.

Var du hittar det: **Inställningar → API-nycklar**. Se även [API-referensen](/docs/api-reference/api-reference).

## Så avgör OneUptime om en begäran är tillåten

För en inloggad användare, i ordning:

1. Hitta de team användaren tillhör i det här projektet — bara accepterade inbjudningar räknas.
2. Samla alla behörighetsrader från dessa team — tillåtna och blockerade, var och en med etiketter och omfattning.
3. Kontrollera blockeringslistan först. En blockering utan etiketter på någon behörighet som måltabellen accepterar för den här operationen avvisar begäran direkt, oavsett vilket team den är satt på.
4. Kontrollera tillåtelselistan. Begäran behöver minst en behörighet som måltabellen accepterar för den här operationen. För en driftresurs — en övervakare, en incident, en instrumentpanel och liknande — räknas även motsvarande **All Operational Resources**-behörighet (Create, Read, Edit eller Delete), om den inte själv är blockerad.
5. Tillämpa omfattningen. Tilldelningar med omfattningen Ägda smalnar av frågan till ägda resurser; etikettbaserade smalnar av till matchande etiketter. Är någon annan tilldelning för samma operation bredare vinner den bredare.
6. Tillämpa etikettblockeringar. En blockering med etiketter avvisar begäran om målresursen bär någon av dem. När en post inte har egna etiketter, till exempel en anteckning på en incident eller ett meddelande på en statussida, utelämnar en blockering med etiketter på att läsa den posten om en post som den hör till bär någon av de etiketterna.

Varje fält i en post läses med postens egen läsbehörighet: en behörighet för en annan sorts post öppnar det aldrig. Vissa fält är avsiktligt snävare. Hemligheter läses bara av personer som får redigera eller administrera posten de hör till, till exempel en monitors nycklar för inkommande förfrågningar och inkommande e-post och dess serveragentnyckel, eller ett arbetsflödes webhook- och e-postnycklar. Att titta på inspelningen av en sessionsuppspelning kräver **Watch Session Replays**, inte bara **List Session Replays**. Telemetri läses signal för signal: **Read Telemetry Service Log** läser loggar, **Read Telemetry Service Traces** läser spår och **Read Telemetry Service Metrics** läser mätvärden, mätvärdesdiagram inräknade.

Fält följer samma regel. En blockering utan etiketter på ett fälts behörighet tar bort fältet, och för en driftresurs öppnar motsvarande **All Operational Resources**-behörighet varje fält som alla som får läsa eller ändra posten får öppna — men inte ett fält som är avsiktligt snävare, som en hemlig nyckel.

Samma regel avgör allt annat som frågar om du har en behörighet: åtgärder som inte är en enkel läsning eller skrivning — att lägga till SMS-, samtals- eller AI-kredit, betala en faktura eller testa en aviseringsregel — och knapparna som OneUptime visar. En knapp du inte får använda visas låst och säger varför; är en blockering i ett av dina team orsaken, namnger den den blockerade behörigheten.

Liveuppdateringar följer samma regel. När en post skapas, ändras eller tas bort meddelar OneUptime de öppna sidorna hos de personer som får läsa posten, och ingen annan. Det som begränsar vad du får läsa begränsar också dina liveuppdateringar: etiketter, ägare, en blockering med etiketter, en privat incident eller någon annans AI-konversation. När en ändring tar ifrån dig åtkomsten till en post, till exempel när den görs privat, meddelas även dina öppna sidor, så att de slutar visa den. En ändring av dina behörigheter, en blockering eller att du inte längre är master admin når dina öppna sidor direkt.

Liveuppdateringar upphör också med inloggningen som startade dem. När du loggar ut, byter lösenord eller blir blockerad stoppas liveuppdateringarna på dina öppna sidor direkt. En öppen sida förnyar sin inloggning var 15:e minut och fortsätter sedan med sina liveuppdateringar; om inloggningen inte kan förnyas skickar den dig till inloggningssidan. Ett projekt som kräver SSO skickar liveuppdateringar bara till sidor som är inloggade med SSO, precis som med allt annat.

Varje inloggad användare har dessutom en liten uppsättning automatiska behörigheter som täcker sådant som att läsa sin egen profil och sina egna aviseringsregler. Det är inga administratörsbehörigheter och de ger inte åtkomst till någon annans data.

Upplösta behörigheter cachas per användare och projekt och uppdateras när teammedlemskap eller teambehörigheter ändras. Om du ändrar behörigheter och en användare inte ser ändringen direkt, be hen ladda om.

## Recept

**Ett team som bara tittar på.** Skapa teamet och lägg till rollen `Viewer`, eller de områdesvisa `*Viewer`-rollerna för precis de områden teamet ska se.

**Jourhavande som sköter sina egna tjänster.** Ge teamet `MonitorAdmin`, `IncidentMember` och `OnCallMember` med omfattningen **Ägda** och lägg sedan till teamet som ägare av de övervakare det driver.

**Konsulter som hålls borta från produktion.** Ge teamet de roller det behöver med omfattningen **Alla** och lägg sedan till en **blockerad behörighet** för de känsliga förmågorna, begränsad till etiketten `Production`.

**En CI-pipeline som bara rapporterar driftsättningar.** Skapa en API-nyckel med precis de granulära behörigheter den behöver — inga roller.

**Någon som inte ska se faktureringen.** Lägg inte till personen i Owners-teamet. `ProjectAdmin` utesluter redan fakturering.

## Vidare

- [Behörighetsreferens](/docs/permissions/reference) — varje roll och varje granulär behörighet, genererade från OneUptimes källkod.
- [SSO](/docs/identity/sso) och [SCIM](/docs/identity/scim) — autentisering och automatisk användarprovisionering.
- [API-referens](/docs/api-reference/api-reference) — använda behörigheter från API:et.
