# Felbudgetpolicy

En felbudgetpolicy skriver ned vad ditt team har kommit överens om att göra medan ett SLO:s felbudget tar slut, till exempel att granska riskfyllda ändringar när hälften är förbrukad, eller att frysa releaser när allt är förbrukat. OneUptime placerar SLO:et i den nivå i policyn som budgeten har nått, visar teamets överenskommelse för nivån på SLO:ets sidor och kan utlösa ett larm eller deklarera en incident när SLO:et går in i en nivå. Det är praxisen med en felbudgetpolicy från [Google SRE Workbook](https://sre.google/workbook/error-budget-policy/).

:::cards
- [Så fungerar nivåer](#så-fungerar-nivåer): Vilken nivå som gäller, och när SLO:et lämnar den.
- [Ställ in en policy](#ställ-in-en-policy): Börja med den rekommenderade policyn, eller skriv dina egna nivåer.
- [Larm och incidenter](#larm-och-incidenter): Larma ditt team när SLO:et går in i en nivå.
- [Läs nivån via API:et](#läs-nivån-via-apiet): Kontrollera nivån från CI och skript.
:::

## Så fungerar nivåer

En policy är en uppsättning nivåer. Varje nivå har tre fält:

| Fält | Vad det innehåller |
| --- | --- |
| **Namn** | Vad teamet kallar nivån, till exempel "Reliability first". |
| **Budget Left Threshold (%)** | Den andel av återstående felbudget vid eller under vilken nivån gäller. Från 0 till 100, decimaler tillåtna. Varje nivå i ett SLO har en egen tröskel. |
| **What We Do** | Vad teamet har kommit överens om att göra medan SLO:et är i nivån, i Markdown. Obligatoriskt, upp till 10 000 tecken. |

En nivå gäller så länge återstående budget är vid eller under dess tröskel, så en nivå på 0 % är nivån för en förbrukad budget. När flera nivåer gäller är SLO:et i den med lägst tröskel: den allvarligaste. När ingen gäller är SLO:et inte i någon nivå. Med nivåer på 50 %, 25 % och 0 % är ett SLO med 30 % av budgeten kvar i nivån på 50 %, och ett med 10 % kvar är i nivån på 25 %.

### Att gå in i en nivå och lämna den

Nivån följer återstående budget så som SLO:ets status gör:

- Att gå in i en nivå sker direkt: den utvärdering som hittar budgeten vid eller under en nivås tröskel placerar SLO:et i den nivån. En budget som faller förbi flera trösklar på en gång går direkt till den allvarligaste nivån.
- Att lämna en nivå för en mindre allvarlig väntar tills budgeten tydligt är tillbaka. En nivå på 0 % lämnas när 2 % av budgeten finns kvar igen. Alla andra nivåer lämnas när budgeten ligger 5 punkter över tröskeln.

En nivå på 0 % följer alltså statusen **Budget förbrukad**, och en nivå vid SLO:ets tröskel för riskzon följer **I riskzonen**: se [Statusändringar och tröskeln för riskzon](/docs/slo/error-budget#statusändringar-och-tröskeln-för-riskzon). Ett rullande fönster som pendlar kring en tröskel får inte nivån att växla fram och tillbaka.

```mermaid title="Så går ett SLO genom den rekommenderade policyn"
stateDiagram-v2
    state "Ingen nivå" as None
    state "Caution" as Caution
    state "Reliability first" as First
    state "Budget exhausted" as Exhausted
    None --> Caution: 50 % eller mindre kvar
    Caution --> First: 25 % eller mindre kvar
    First --> Exhausted: 0 % eller mindre kvar
    Exhausted --> First: 2 % kvar igen
    First --> Caution: 30 % kvar igen
    Caution --> None: 55 % kvar igen
```

## Ställ in en policy

Du behöver behörighet att skapa nivåer i SLO:ers felbudgetpolicy.

:::steps
### Öppna Error Budget Policy

Öppna SLO:et och gå till **Error Budget Policy** i avsnittet **Regler** i dess sidomeny. Sidan listar SLO:ets nivåer, var och en med sitt namn, den återstående budget den gäller vid och vad teamet gör.

### Börja med den rekommenderade policyn

Så länge SLO:et inte har några nivåer erbjuder sidan **Use the recommended policy**. Klicka på den, kontrollera de tre nivåer den listar och bekräfta. Anpassa sedan varje nivås text till ditt teams egen överenskommelse.

### Eller lägg till en nivå själv

Klicka på **Skapa SLO Error Budget Policy Tier**. Ange ett **Namn** och en **Budget Left Threshold (%)**, och skriv teamets överenskommelse i **What We Do**.

### Välj vad nivån utlöser

En nivå registrerar och visar överenskommelsen. För att också larma någon när SLO:et går in i nivån öppnar du de hopfällda inställningarna för larm och incident och slår på ett larm, en incident eller båda. Båda är avstängda som standard. Se [Larm och incidenter](#larm-och-incidenter).
:::

Att lägga till, redigera eller ta bort en nivå gäller direkt: OneUptime utvärderar SLO:et igen inom ungefär en minut. Ligger budgeten redan vid eller under en nivås tröskel hamnar SLO:et då i den nivån, och nivån utlöser det den är inställd att utlösa. Att stänga av en nivå eller ta bort den löser det nivån utlöste, och SLO:et flyttar till den nivå där budgeten ligger. Att stänga av en nivås larm eller incident löser det larmet eller den incidenten.

### Den rekommenderade policyn

**Use the recommended policy** lägger till tre nivåer, vid halva budgeten, en fjärdedel och noll, med den här engelska texten:

| Nivå | Gäller vid | Vad teamet gör |
| --- | --- | --- |
| **Caution** | 50 % kvar eller mindre | Half of the error budget is spent. Review risky changes before they ship, and find out what has been spending the budget. |
| **Reliability first** | 25 % kvar eller mindre | Reliability comes first. Only reliability improvements and critical fixes ship until the budget recovers. |
| **Budget exhausted** | 0 % kvar eller mindre | The error budget is spent. Freeze non-critical releases: only fixes for this SLO's reliability and security fixes ship until the budget is back. |

Ingen av dem utlöser ett larm eller deklarerar en incident förrän du slår på det. Bara de nivåer som SLO:et saknar läggs till: en nivå med samma namn, eller med samma tröskel, räknas som befintlig, oavsett om den är på eller av. Att be om det två gånger, från en andra flik eller via API:et, lägger alltså inte till något två gånger. Varje nivå som läggs till så registreras i SLO:ets granskningsloggar som tillagd av dig.

## Var nivån visas

- SLO:ets **Översikt** visar nivån det är i och vad teamet har kommit överens om att göra där, så att alla som öppnar SLO:et ser den överenskommelse som gäller nu.
- Diagrammet **Nedbränning av felbudget** ritar en linje med etikett vid varje nivås tröskel, bredvid linjen för tröskeln för riskzon.
- SLO:ets **Feed** visar varje byte av nivå: nivån som SLO:et lämnade och nivån det gick in i, återstående budget och vad teamet har kommit överens om att göra i den nya nivån.
- SLO:ets **Granskningsloggar** registrerar varje byte av nivå som en ändring som OneUptime själv har gjort, och visar det därför bara med **Lagra systemhändelser** påslaget: se [Slå på granskningsloggar](/docs/slo/feed-and-audit-logs#slå-på-granskningsloggar). Att lägga till, redigera och ta bort en nivå registreras på den person som gjorde det.
- SLO:ets läs-API returnerar nivån: se [Läs nivån via API:et](#läs-nivån-via-apiet).

## Larm och incidenter

Varje nivå kan utlösa ett larm, deklarera en incident eller båda när SLO:et går in i den. De har samma alternativ som larmet och incidenten för en regel för förbrukningstakt: allvarlighetsgrad, jourpolicyer, mallar för rubrik, beskrivning och åtgärdsanteckningar, sekretess, automatisk lösning, etiketter, ägarteam och ägaranvändare och att lägga till SLO:ets ägare som ägare. Se [Vad en regel deklarerar](/docs/slo/burn-rate-alerts#vad-en-regel-deklarerar). Båda är avstängda som standard, så en nivå larmar ingen förrän du slår på något av dem.

- Att gå in i en allvarligare nivå löser det som den föregående nivån utlöste, oavsett dess inställning för automatisk lösning, eftersom den nya nivån ersätter den. Därför är högst en nivås larm och incident öppna åt gången, och de hör till den nivå SLO:et är i.
- Att återhämta sig till en mindre allvarlig nivå, eller ut ur alla nivåer, löser dem när nivåns automatiska lösning är påslagen, som den är som standard. Med automatisk lösning avstängd förblir de öppna tills någon löser dem.
- Det finns ingen undertryckning av nya utlösningar. En nivå utlöser igen först när SLO:et tydligt har lämnat den och gått in i den igen, så den kan inte fladdra. Om någon manuellt löser det nivån utlöste medan SLO:et fortfarande är i nivån, förblir det löst.
- Så länge någon monitor i SLO:et är i planerat underhåll utlöser nivåerna ingenting. Själva nivån byts ändå, och det som är öppet löses fortfarande. Är SLO:et fortfarande i nivån när underhållet tar slut, utlöser nivån då det den är inställd att utlösa.

Precis som för en regel för förbrukningstakt listar ett larm eller en incident som en nivå utlöser SLO:et under **Berörda resurser**, och en incident visas aldrig på statussidor. SLO:ets flöde visar varje larm och incident, och när de löses.

### Vad de säger

En nivås rubrik, beskrivning och åtgärdsanteckningar tar mallvariabler, precis som en regels: se [Vad varje larm och incident säger](/docs/slo/burn-rate-alerts#vad-varje-larm-och-incident-säger). En nivås fält erbjuder variablerna för SLO:et och dess budget, och tre av nivåns egna: `{{sloName}}`, `{{sloId}}`, `{{sloLink}}`, `{{sloStatus}}`, `{{policyTier}}`, `{{policyTierThresholdPercentage}}`, `{{policyTierWhatWeDo}}`, `{{targetPercentage}}`, `{{currentSliPercentage}}`, `{{errorBudgetRemainingPercentage}}`, `{{errorBudgetRemaining}}`, `{{errorBudgetRemainingMinutes}}` och `{{windowDescription}}`. En regels egna variabler, som `{{ruleName}}` och förbrukningstakterna, erbjuds inte och är tomma i en nivås mallar.

De tre nivåvariablerna fungerar också i mallarna för regler för förbrukningstakt:

| Variabel | Vad den innehåller |
| --- | --- |
| `{{policyTier}}` | Namnet på den nivå SLO:et är i efter utvärderingen, eller `None` när det inte är i någon nivå. |
| `{{policyTierThresholdPercentage}}` | Nivåns tröskel, till exempel `25`. Tom när SLO:et inte är i någon nivå. |
| `{{policyTierWhatWeDo}}` | Vad teamet har kommit överens om att göra i nivån. Tom när SLO:et inte är i någon nivå. |

En nivå vars rubrik lämnas tom använder den inbyggda rubriken:

```text
SLO error budget policy: {{sloName}} — {{policyTier}}
```

Den inbyggda beskrivningen nämner nivån, ställer återstående budget mot nivåns tröskel och säger vad teamet har kommit överens om att göra i den.

## När budgeten inte mäts

- Ett SLO som är **Pausad** eller **Felkonfigurerad** mäter ingen budget, så dess nivå stannar där den var, och det nivån utlöste förblir öppet tills mätningen återupptas. Regler för förbrukningstakt löser däremot då det de har öppet.
- Att stänga av utvärderingen av SLO:et, eller att arkivera SLO:et, löser det dess nivåer utlöste. Den nivå SLO:et är i förblir som den var.
- Att ta bort SLO:et tar bort dess nivåer och löser det de utlöste.

## Läs nivån via API:et

SLO:ets eget läs-API returnerar den nivå det är i, så att ett CI-jobb eller ett skript kan kontrollera den innan det agerar, till exempel före en release. Alla tre fälten är tomma så länge SLO:et inte är i någon nivå:

| Fält | Vad det innehåller |
| --- | --- |
| `currentErrorBudgetPolicyTierId` | Nivåns ID. |
| `currentErrorBudgetPolicyTierName` | Nivåns namn. |
| `currentErrorBudgetPolicyTierEnteredAt` | När SLO:et gick in i nivån. |

De läses med SLO:ets egen läsbehörighet, samma som dess budget också kräver. Till exempel med en [API-nyckel](/docs/api-reference/api-reference) för projektet:

```bash
curl -X POST 'https://oneuptime.com/api/service-level-objective/<slo-id>/get-item' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "select": { "name": true, "errorBudgetRemainingPercentage": true, "currentErrorBudgetPolicyTierName": true, "currentErrorBudgetPolicyTierEnteredAt": true } }'
```

Själva nivåerna är en egen resurs, `/api/service-level-objective-error-budget-policy-tier`, med de förfrågningar för att lista, läsa, skapa, ändra och ta bort som varje resurs har. Två förfrågningar till betjänar den rekommenderade policyn. Båda tar `{ "serviceLevelObjectiveId": "..." }` och svarar med nivåerna i `tiers`:

| Förfrågan | Vad den gör |
| --- | --- |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy` | Listar de rekommenderade nivåer som SLO:et saknar. Den skriver ingenting. |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy/add` | Lägger till dem och listar vad den lade till. Att fråga igen lägger inte till något. |

## Behörigheter

| Behörighet | Låter en roll |
| --- | --- |
| **Read SLO Error Budget Policy Tier** | Se ett SLO:s nivåer. |
| **Create SLO Error Budget Policy Tier** | Lägga till nivåer, manuellt eller med **Use the recommended policy**. |
| **Edit SLO Error Budget Policy Tier** | Ändra nivåer och slå på eller av dem. |
| **Delete SLO Error Budget Policy Tier** | Ta bort nivåer. |

Dessa behörigheter finns i en rolls SLO-grupp. Rollerna Project Owner och Project Admin har alla, och rollerna Project Member och Viewer kan läsa nivåer.

## Inte tillgängligt än

Vissa delar av en felbudgetpolicy finns inte ännu: en distributionsspärr som själv stoppar releaser (ett CI-jobb kan i stället läsa nivån via API:et), arbetsflödesutlösare och aviseringar i Slack eller Microsoft Teams för varje nivå, en policy som flera SLO:er delar, att kvittera en nivå eller ge ett undantag från den, och nivåer som bygger på budgetens räckvidd i stället för återstående budget.

## Nästa steg

:::cards
- [Felbudgetar](/docs/slo/error-budget): Vad budgeten är, och hur statusen följer den.
- [Larm och incidenter för förbrukningstakt](/docs/slo/burn-rate-alerts): Larma ditt team när budgeten förbrukas för snabbt.
- [SLO-flöde och granskningsloggar](/docs/slo/feed-and-audit-logs): Varje byte av nivå, och vad nivåerna utlöste.
:::
