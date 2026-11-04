# Dataprodukter

De som använder data - analytiker, ekonomi, ledning, AI-agenter - tänker i det de använder: "intäktspanelens tabeller", inte i databaser. En **dataprodukt** namnger de tabellerna, med sin ägare, sina konsumenter och sin aktualitets-SLA, och talar om för alla som är beroende av den om dagens data har kommit in.

## Skapa en dataprodukt

Under **Dataobserverbarhet > Dataprodukter** skapar du en dataprodukt: namnge den, välj dess tabeller och ge den en SLA med något av följande, eller båda:

- **Uppdaterad senast en viss tid på dygnet (UTC):** varje dags data landar samma dag, senast då. Från den tiden måste varje tabell ha ändrats den dagen; fram till dess gäller gårdagens laddning. En laddning som alltid är en halvtimme sen är försenad den halvtimmen varje dag.
- **En högsta ålder:** ingen tabells senaste ändring får vara äldre än så.

Var femte minut kontrolleras varje produkts tabeller mot dess SLA. Produkten är **Late** när någon tabell är försenad, och dess data gäller per den äldsta senaste ändringen bland tabellerna. Den skriver `oneuptime.data.product.late_tables` och `oneuptime.data.product.data_age`, så att du kan visa alla produkters aktualitet sida vid sida i ett diagram.

## På statussidor

När du sparar en produkt skapas också en **monitor** för den, i ditt namn och med dina behörigheter. Monitorn är Försämrad medan en tabell är försenad, och öppnar en incident och ett larm på projektets minst allvarliga nivå, som löses av sig själva. Lägg till den på en statussida, privat eller offentlig, som en resurs: konsumenter som prenumererar får veta när produkten är försenad, och när den är aktuell igen. Se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups).

## Som en SLO

När du sparar en produkt skapas också en **SLO** över dess monitor: andelen av tiden som data är i tid, mot produktens mål över 30 dagar, med de larm för snabb och långsam förbrukningstakt som varje SLO börjar med. Se [SLO:er](/docs/slo/introduction). Om du tar bort produkten tas även dess monitor och dess SLO bort.

## Märket "data as of"

Varje produkt har ett **märke** som visar per när dess data gäller, grönt så länge den är i tid och orange med "late" när den inte är det. Bädda in det i en BI-instrumentpanel, en wikisida eller en README från produktens **Översikt**:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Dess länk kräver ingen inloggning, så behandla den som en delad länk. **Återställ märkeslänk** skapar en ny och drar in den gamla.

## Nästa steg

:::cards
- [Tabellhälsa](/docs/data-observability/table-health): Hur varje tabells aktualitet lärs in.
- [OneUptime AI och API:t](/docs/data-observability/ai-and-api): Låt AI-agenter kontrollera en produkts tabeller innan de använder dem.
:::
