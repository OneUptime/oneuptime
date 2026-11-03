# Molnkostnader och besparingar

Ett anslutet molnkonto säger också vad det kostar och hur det kunde kosta mindre. OneUptime läser varje dags kostnader från molnets egen fakturering och rekommendationerna från molnets egen rekommendationstjänst, visar dem under **Moln → Utgifter → Kostnader** och **Moln → Utgifter → Besparingar**, och varnar innan en månad kostar mer än sin budget under **Moln → Utgifter → Budgetar**.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer och Cost Optimization Hub, var och en påslagen en gång.
- [Microsoft Azure](#microsoft-azure): Cost Management och Azure Advisor, med en roll till.
- [Google Cloud](#google-cloud): Din faktureringsexport till BigQuery, och Recommender.
- [Budgetar](#budgetar): Ett larm när en månads utgifter passerar en andel av dess budget.
:::

## Så fungerar det

```mermaid title="Från molnets fakturering till Molns sidor"
flowchart TB
    bill["Molnets fakturering,<br/>läses två gånger om dagen"] --> costs["Kostnader"]
    rec["Molnets rekommendationer,<br/>läses en gång om dagen"] --> savings["Besparingar"]
    costs --> budgets["Budgetar som varnar"]
    costs --> overview["Molns översikt"]
    savings --> overview
```

- **Kostnaderna kommer från molnets egen fakturering.** AWS Cost Explorer, Azure Cost Management och Google Clouds faktureringsexport till BigQuery, före krediter och återbetalningar, i den valuta kontot faktureras i. Varje belopp gäller en dag, i UTC-dagar, så som molnet fakturerar dem.
- **Ett moln rapporterar den sista dagen eller två sent.** Varje läsning tar den senaste veckan igen, och hela förra månaden under en månads första dagar, så en dags kostnad faller på plats medan molnet avslutar den. En anslutnings första läsning går tillbaka till början av månaden före förra månaden.
- **Månadens prognos följer takten under den senaste veckan.** Den är vad månaden har kostat hittills, med varje dag som återstår till genomsnittet av de senaste sju hela dagarna.
- **Besparingarna kommer från molnets egen rekommendationstjänst.** AWS Cost Optimization Hub, Azure Advisor och Google Clouds Recommender: en mindre storlek, en resurs som står oanvänd, ett åtagande som lönar sig, var och en med vad den skulle spara per månad. En rekommendation som du genomför eller avfärdar i molnets konsol försvinner vid nästa läsning.

## Innan du börjar

- **Ett anslutet konto.** [Anslut ett molnkonto](/docs/telemetry/cloud-accounts) med dagens installationskommando: det låter anslutningen läsa kostnader och rekommendationer. En anslutning som skapades tidigare läser ingetdera förrän du kör dess kommando igen.

## Amazon Web Services

Anslutningen läser kostnader med `ce:GetCostAndUsage` och rekommendationer med `cost-optimization-hub:ListRecommendations`. Var och en kräver att något först slås på i kontot:

:::steps
### Slå på Cost Explorer

Öppna Cost Explorer en gång i AWS-konsolen Billing and Cost Management: AWS förbereder kontots kostnader inom en dag. Anslut organisationens hanteringskonto för att läsa kostnaderna för varje medlemskonto.

### Anmäl dig till Cost Optimization Hub

Öppna Cost Optimization Hub i samma konsol och anmäl dig, för organisationen från dess hanteringskonto eller bara för kontot. Dess rekommendationer kommer inom en dag.
:::

Cost Explorer tar $0.01 för varje begäran, och en läsning av kostnaderna gör några få. Cost Optimization Hub är gratis.

## Microsoft Azure

Appen läser kostnader med rollen **Cost Management Reader**, på samma omfång som **Monitoring Reader**: installationskommandot tilldelar båda. Azure Advisors rekommendationer läses med **Monitoring Reader**, så det finns inget att slå på. För att ge en app som skapades tidigare rollen kör du:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management svarar för varje prenumeration, med den resurs varje kostnad gäller, och det kostar inget att läsa. När den inte kan svara för en prenumeration säger kontots **Kostnader** varför.

## Google Cloud

Google Cloud har inget API för ett projekts kostnader: OneUptime läser dem från faktureringskontots export till BigQuery.

:::steps
### Exportera din fakturering till BigQuery

Öppna Billing och sedan Billing export i Google Cloud-konsolen, och slå på exporten av detaljerade användningskostnader till en BigQuery-datauppsättning. Google skriver den några timmar i efterhand, från den dag du slår på den.

### Låt tjänstkontot läsa den

Ge anslutningens tjänstkonto **BigQuery Data Viewer** på exportens datauppsättning. Installationskommandot har redan gett det **BigQuery Job User**, så att det kan köra frågan i sitt eget projekt.

### Ange exportens tabell

Redigera anslutningen under **Moln → Anslut**, och sätt under **Fler fält** **Tabell för faktureringsexport** till tabellens fullständiga namn: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

Den detaljerade exporten anger den resurs varje kostnad gäller; standardexporten anger bara tjänsten och regionen. BigQuery debiterar frågan: den första 1 TiB per månad är gratis, därefter $6.25 per TiB, och en månad av en export är från några få megabyte till några få gigabyte. Recommenders rekommendationer om maskintyper och oanvända resurser läses med **Compute Recommender Viewer**, som installationskommandot tilldelar, och kostar inget.

## Sätt att spendera mindre

**Moln → Utgifter → Besparingar** listar varje rekommendation, den största besparingen först: vad som ska göras, för vilken resurs, vad som skulle ändras och vad den sparar per månad. Remsan ovanför summerar dem, totalt och efter typ: en mindre storlek, en resurs som står oanvänd, ett åtagande. En rekommendation länkar till sidan för sin resurs när OneUptime har resursen.

## Budgetar

:::steps
### Skapa en budget

Under **Moln → Utgifter → Budgetar** skapar du en budget: dess **Månadsbelopp** och det **Konto** den gäller, eller inget för alla konton.

### Välj när den varnar

**Varna vid** tar de andelar av budgeten som det ska varnas vid, i procent: 80 och 100 till att börja med. **Varna när en överskridning är på väg** varnar också, en gång per månad, när takten under den senaste veckan skulle ta månaden över budgeten. **Larmallvar** och **Jourpolicyer** anger hur allvarliga larmen är och vem som larmas.
:::

En budget kontrolleras efter varje läsning av kostnaderna och varje timme. När månadens utgifter passerar ett tröskelvärde skapas ett larm för det, det högsta när en läsning passerar flera på en gång, och en ny månad löser förra månadens larm. En budget räknar bara de konton som faktureras i dess valuta.

## Det du ser i OneUptime

- **Molns översikt.** **Moln → Översikt** visar månadens utgifter mot förra månadens på samma dag, de dyraste tjänsterna och de största sätten att spendera mindre, bredvid det som behöver uppmärksamhet.
- **Varje dags utgifter.** **Moln → Utgifter → Kostnader** ritar var och en av de senaste 30 dagarna och delar upp en period efter tjänst, region, konto eller resurs. De konton vars kostnader inte läses listas nedanför, var och en med orsaken.
- **Ett kontos kostnader.** Ett kontos **Kostnader** visar samma sak för kontot ensamt, med dess sätt att spendera mindre.
- **En resurs kostnad.** En resurs sida visar vad den har kostat den här månaden och de senaste 30 dagarna när dess moln fakturerar den med namn, med dess sätt att spendera mindre.

## Felsökning

:::details Ett konto säger Kräver behörighet
Anslutningen får inte läsa kontots kostnader än. Kör dess installationskommando igen från **Moln → Anslut**: det lägger till det som läsningen av kostnader behöver. På Google Cloud ger du också tjänstkontot **BigQuery Data Viewer** på exportens datauppsättning.
:::

:::details Ett konto säger Inte konfigurerad
Dess moln har inga kostnader att ge än. På AWS slår du på Cost Explorer; på Google Cloud anger du exportens tabell under **Tabell för faktureringsexport**. De första beloppen kommer med nästa läsning, inom 12 timmar.
:::

:::details Beloppen utelämnar ett konto
Beloppen är i den valuta som de flesta av dina konton faktureras i. Ett konto som faktureras i en annan listas nedanför med sin valuta, och en budget räknar bara de konton som faktureras i dess egen.
:::

:::details Den här månaden är lägre än i molnets konsol
Molnet rapporterar den sista dagen eller två sent, och beloppen är före krediter och återbetalningar. Nästa läsningar kommer ikapp.
:::

## Nästa steg

:::cards
- [Anslut ett molnkonto](/docs/telemetry/cloud-accounts): Anslut ett annat konto, eller kör dess kommando igen.
- [Molnresurser](/docs/telemetry/cloud-resources): Varje resurs mätvärden, från en egen collector.
- [Kostnadsobservability för Kubernetes](/docs/telemetry/kubernetes-cost): Vad varje Kubernetes-arbetsbelastning kostar.
:::
