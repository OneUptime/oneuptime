# Fejlbudgetpolitik

En fejlbudgetpolitik skriver ned, hvad dit team har aftalt at gøre, mens et SLO's fejlbudget løber ud, for eksempel at gennemgå risikable ændringer, når halvdelen er brugt, eller at fastfryse udgivelser, når det hele er brugt. OneUptime placerer SLO'et i det niveau i politikken, som dets budget har nået, viser teamets aftale for niveauet på SLO'ets sider og kan udløse en advarsel eller erklære en hændelse, når SLO'et går ind i et niveau. Det er praksissen med en fejlbudgetpolitik fra [Google SRE Workbook](https://sre.google/workbook/error-budget-policy/).

:::cards
- [Sådan fungerer niveauer](#sådan-fungerer-niveauer): Hvilket niveau der gælder, og hvornår SLO'et forlader det.
- [Opsæt en politik](#opsæt-en-politik): Start med den anbefalede politik, eller skriv dine egne niveauer.
- [Advarsler og hændelser](#advarsler-og-hændelser): Alarmér dit team, når SLO'et går ind i et niveau.
- [Læs niveauet via API'et](#læs-niveauet-via-apiet): Tjek niveauet fra CI og scripts.
:::

## Sådan fungerer niveauer

En politik er et sæt niveauer. Hvert niveau har tre felter:

| Felt | Hvad det indeholder |
| --- | --- |
| **Navn** | Hvad teamet kalder niveauet, for eksempel "Reliability first". |
| **Tærskel for resterende budget (%)** | Den andel af det resterende fejlbudget, ved eller under hvilken niveauet gælder. Fra 0 til 100, decimaler tilladt. Hvert niveau i et SLO har sin egen tærskel. |
| **Hvad vi gør** | Hvad teamet har aftalt at gøre, mens SLO'et er i niveauet, i Markdown. Påkrævet, op til 10.000 tegn. |

Et niveau gælder, så længe det resterende budget er ved eller under dets tærskel, så et niveau på 0 % er niveauet for et opbrugt budget. Når flere niveauer gælder, er SLO'et i det med den laveste tærskel: det mest alvorlige. Når ingen gælder, er SLO'et ikke i noget niveau. Med niveauer på 50 %, 25 % og 0 % er et SLO med 30 % af sit budget tilbage i niveauet på 50 %, og et med 10 % tilbage er i niveauet på 25 %.

### At gå ind i et niveau og forlade det

Niveauet følger det resterende budget, sådan som SLO'ets status gør:

- At gå ind i et niveau sker med det samme: Den evaluering, der finder budgettet ved eller under et niveaus tærskel, placerer SLO'et i niveauet. Et budget, der falder forbi flere tærskler på én gang, går direkte til det mest alvorlige niveau.
- At forlade et niveau for et mindre alvorligt venter, til budgettet tydeligt er tilbage. Et niveau på 0 % forlades, når 2 % af budgettet er tilbage igen. Ethvert andet niveau forlades, når budgettet er 5 point over dets tærskel.

Et niveau på 0 % følger altså statussen **Budget opbrugt**, og et niveau ved SLO'ets risikotærskel følger **I risiko**: se [Statusændringer og risikotærsklen](/docs/slo/error-budget#statusændringer-og-risikotærsklen). Et rullende vindue, der svinger omkring en tærskel, får ikke niveauet til at skifte frem og tilbage.

```mermaid title="Sådan går et SLO gennem den anbefalede politik"
stateDiagram-v2
    state "Intet niveau" as None
    state "Caution" as Caution
    state "Reliability first" as First
    state "Budget exhausted" as Exhausted
    None --> Caution: 50 % eller mindre tilbage
    Caution --> First: 25 % eller mindre tilbage
    First --> Exhausted: 0 % eller mindre tilbage
    Exhausted --> First: 2 % tilbage igen
    First --> Caution: 30 % tilbage igen
    Caution --> None: 55 % tilbage igen
```

## Opsæt en politik

Du skal have tilladelse til at oprette niveauer i SLO'ers fejlbudgetpolitik.

:::steps
### Åbn Fejlbudgetpolitik

Åbn SLO'et, og gå til **Fejlbudgetpolitik** i sektionen **Regler** i dets sidemenu. Siden viser SLO'ets niveauer, hver med sit navn, det resterende budget, det gælder ved, og hvad teamet gør.

### Start med den anbefalede politik

Så længe SLO'et ikke har nogen niveauer, tilbyder siden **Brug den anbefalede politik**. Klik på den, tjek de tre niveauer, den viser, og bekræft. Tilpas derefter hvert niveaus ordlyd til dit teams egen aftale.

### Eller tilføj selv et niveau

Klik på **Opret SLO-fejlbudgetpolitikniveau**. Angiv et **Navn** og en **Tærskel for resterende budget (%)**, og skriv teamets aftale i **Hvad vi gør**.

### Vælg, hvad niveauet udløser

Et niveau registrerer og viser aftalen. For også at alarmere nogen, når SLO'et går ind i niveauet, skal du åbne de sammenfoldede indstillinger for advarsel og hændelse og slå en advarsel, en hændelse eller begge til. Begge er slået fra som standard. Se [Advarsler og hændelser](#advarsler-og-hændelser).
:::

At tilføje, redigere eller slette et niveau virker med det samme: OneUptime evaluerer SLO'et igen inden for cirka et minut. Er budgettet allerede ved eller under et niveaus tærskel, kommer SLO'et så i det niveau, og niveauet udløser det, det er sat op til at udløse. At slå et niveau fra eller slette det løser det, niveauet har udløst, og SLO'et flytter til det niveau, dets budget er i. At slå et niveaus advarsel eller hændelse fra løser den advarsel eller hændelse.

### Den anbefalede politik

**Brug den anbefalede politik** tilføjer tre niveauer, ved halvdelen af budgettet, en fjerdedel og nul, med denne engelske ordlyd:

| Niveau | Gælder ved | Hvad teamet gør |
| --- | --- | --- |
| **Caution** | 50 % tilbage eller mindre | Half of the error budget is spent. Review risky changes before they ship, and find out what has been spending the budget. |
| **Reliability first** | 25 % tilbage eller mindre | Reliability comes first. Only reliability improvements and critical fixes ship until the budget recovers. |
| **Budget exhausted** | 0 % tilbage eller mindre | The error budget is spent. Freeze non-critical releases: only fixes for this SLO's reliability and security fixes ship until the budget is back. |

Ingen af dem udløser en advarsel eller erklærer en hændelse, før du slår det til. Kun de niveauer, SLO'et ikke har, tilføjes: Et niveau med samme navn eller med samme tærskel tæller som til stede, uanset om det er slået til eller fra. At bede om det to gange, fra en anden fane eller via API'et, tilføjer altså intet to gange. Hvert niveau, der tilføjes på den måde, registreres i SLO'ets auditlogs som tilføjet af dig.

## Hvor niveauet vises

- SLO'ets **Oversigt** viser det niveau, det er i, og hvad teamet har aftalt at gøre der, så alle, der åbner SLO'et, ser den aftale, der gælder nu.
- Diagrammet **Burn-down af fejlbudget** tegner en linje med etiket ved hvert niveaus tærskel ved siden af risikotærsklens linje.
- SLO'ets **Feed** viser hvert skift af niveau: det niveau, SLO'et forlod, og det niveau, det gik ind i, det resterende budget, og hvad teamet har aftalt at gøre i det nye niveau.
- SLO'ets **Auditlogs** registrerer hvert skift af niveau som en ændring, OneUptime selv har lavet, og viser det derfor kun med **Gem systemhændelser** slået til: se [Slå auditlogs til](/docs/slo/feed-and-audit-logs#slå-auditlogs-til). At tilføje, redigere og fjerne et niveau registreres under den person, der gjorde det.
- SLO'ets læse-API returnerer niveauet: se [Læs niveauet via API'et](#læs-niveauet-via-apiet).

## Advarsler og hændelser

Hvert niveau kan udløse en advarsel, erklære en hændelse eller begge dele, når SLO'et går ind i det. De har de samme muligheder som en forbrugsrateregels advarsel og hændelse: alvorsgrad, vagtpolitikker, skabeloner til titel, beskrivelse og afhjælpningsnoter, privatliv, automatisk løsning, etiketter, ejerteams og -brugere og tilføjelse af SLO'ets ejere som ejere. Se [Hvad en regel erklærer](/docs/slo/burn-rate-alerts#hvad-en-regel-erklærer). Begge er slået fra som standard, så et niveau alarmerer ingen, før du slår en af dem til.

- At gå ind i et mere alvorligt niveau løser det, det forrige niveau udløste, uanset dets indstilling for automatisk løsning, fordi det nye niveau afløser det. Så højst ét niveaus advarsel og hændelse er åbne ad gangen, og de hører til det niveau, SLO'et er i.
- At komme sig til et mindre alvorligt niveau, eller ud af alle niveauer, løser dem, når niveauets automatiske løsning er slået til, som den er som standard. Med automatisk løsning slået fra forbliver de åbne, til nogen løser dem.
- Der er ingen undertrykkelse af nye udløsninger. Et niveau udløser først igen, når SLO'et tydeligt har forladt det og er gået ind i det igen, så det kan ikke blafre. Løser nogen manuelt det, niveauet udløste, mens SLO'et stadig er i niveauet, forbliver det løst.
- Så længe en monitor i SLO'et er i planlagt vedligeholdelse, udløser niveauer intet. Selve niveauet skifter stadig, og det, der er åbent, løses stadig. Er SLO'et stadig i niveauet, når vedligeholdelsen slutter, udløser niveauet det, det er sat op til at udløse.

Ligesom ved en forbrugsrateregel viser en advarsel eller hændelse, som et niveau udløser, SLO'et under **Berørte ressourcer**, og en hændelse vises aldrig på statussider. SLO'ets feed viser hver enkelt, og hvornår den løses.

### Hvad de siger

Et niveaus titel, beskrivelse og afhjælpningsnoter tager skabelonvariabler, ligesom en regels: se [Hvad hver advarsel og hændelse siger](/docs/slo/burn-rate-alerts#hvad-hver-advarsel-og-hændelse-siger). Et niveaus felter tilbyder variablerne for SLO'et og dets budget og tre af niveauets egne: `{{sloName}}`, `{{sloId}}`, `{{sloLink}}`, `{{sloStatus}}`, `{{policyTier}}`, `{{policyTierThresholdPercentage}}`, `{{policyTierWhatWeDo}}`, `{{targetPercentage}}`, `{{currentSliPercentage}}`, `{{errorBudgetRemainingPercentage}}`, `{{errorBudgetRemaining}}`, `{{errorBudgetRemainingMinutes}}` og `{{windowDescription}}`. En regels egne variabler, såsom `{{ruleName}}` og forbrugsraterne, tilbydes ikke og er tomme i et niveaus skabeloner.

De tre niveauvariabler virker også i forbrugsratereglers skabeloner:

| Variabel | Hvad den indeholder |
| --- | --- |
| `{{policyTier}}` | Navnet på det niveau, SLO'et er i efter evalueringen, eller `None`, når det ikke er i noget niveau. |
| `{{policyTierThresholdPercentage}}` | Niveauets tærskel, for eksempel `25`. Tom, når SLO'et ikke er i noget niveau. |
| `{{policyTierWhatWeDo}}` | Hvad teamet har aftalt at gøre i niveauet. Tom, når SLO'et ikke er i noget niveau. |

Et niveau, hvis titel er tom, bruger den indbyggede titel:

```text
SLO error budget policy: {{sloName}} — {{policyTier}}
```

Den indbyggede beskrivelse nævner niveauet, holder det resterende budget op mod niveauets tærskel og siger, hvad teamet har aftalt at gøre i det.

## Når budgettet ikke måles

- Et SLO, der er **Sat på pause** eller **Forkert konfigureret**, måler intet budget, så dets niveau bliver, hvor det var, og det, niveauet udløste, forbliver åbent, til der måles igen. Forbrugsrateregler løser derimod det, de har åbent.
- At slå SLO'ets evaluering fra eller at arkivere SLO'et løser det, dets niveauer udløste. Det niveau, SLO'et er i, forbliver, som det var.
- At slette SLO'et sletter dets niveauer og løser det, de udløste.

## Læs niveauet via API'et

SLO'ets eget læse-API returnerer det niveau, det er i, så et CI-job eller et script kan tjekke det, før det handler, for eksempel før en udgivelse. Alle tre felter er tomme, så længe SLO'et ikke er i noget niveau:

| Felt | Hvad det indeholder |
| --- | --- |
| `currentErrorBudgetPolicyTierId` | Niveauets ID. |
| `currentErrorBudgetPolicyTierName` | Niveauets navn. |
| `currentErrorBudgetPolicyTierEnteredAt` | Hvornår SLO'et gik ind i niveauet. |

De læses med SLO'ets egen læsetilladelse, den samme, som dets budget også kræver. For eksempel med en [API-nøgle](/docs/api-reference/api-reference) til projektet:

```bash
curl -X POST 'https://oneuptime.com/api/service-level-objective/<slo-id>/get-item' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "select": { "name": true, "errorBudgetRemainingPercentage": true, "currentErrorBudgetPolicyTierName": true, "currentErrorBudgetPolicyTierEnteredAt": true } }'
```

Selve niveauerne er en ressource for sig, `/api/service-level-objective-error-budget-policy-tier`, med de anmodninger om at vise, læse, oprette, ændre og slette, som enhver ressource har. To anmodninger mere betjener den anbefalede politik. Begge tager `{ "serviceLevelObjectiveId": "..." }` og svarer med niveauerne i `tiers`:

| Anmodning | Hvad den gør |
| --- | --- |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy` | Viser de anbefalede niveauer, SLO'et mangler. Den skriver intet. |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy/add` | Tilføjer dem og viser, hvad den tilføjede. At spørge igen tilføjer intet. |

## Tilladelser

| Tilladelse | Lader en rolle |
| --- | --- |
| **Read SLO Error Budget Policy Tier** | Se et SLO's niveauer. |
| **Create SLO Error Budget Policy Tier** | Tilføje niveauer, manuelt eller med **Brug den anbefalede politik**. |
| **Edit SLO Error Budget Policy Tier** | Ændre niveauer og slå dem til eller fra. |
| **Delete SLO Error Budget Policy Tier** | Fjerne niveauer. |

Disse tilladelser ligger i en rolles SLO-gruppe. Rollerne Project Owner og Project Admin har dem alle, og rollerne Project Member og Viewer kan læse niveauer.

## Endnu ikke tilgængeligt

Nogle dele af en fejlbudgetpolitik er endnu ikke tilgængelige: en udrulningsspærre, der selv blokerer udgivelser (et CI-job kan i stedet læse niveauet via API'et), workflow-udløsere og Slack- eller Microsoft Teams-notifikationer for hvert niveau, en politik, som flere SLO'er deler, at kvittere for et niveau eller give en undtagelse fra det, og niveauer, der bygger på budgettets rækkevidde i stedet for det resterende budget.

## Næste trin

:::cards
- [Fejlbudgetter](/docs/slo/error-budget): Hvad budgettet er, og hvordan statussen følger det.
- [Forbrugsrateadvarsler og -hændelser](/docs/slo/burn-rate-alerts): Alarmér dit team, når budgettet brændes for hurtigt.
- [SLO-feed og auditlogs](/docs/slo/feed-and-audit-logs): Hvert skift af niveau, og hvad niveauerne udløste.
:::
