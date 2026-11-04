# Dataprodukter

De mennesker, der bruger data - analytikere, økonomi, ledelse, AI-agenter - tænker i det, de bruger: "omsætningsdashboardets tabeller", ikke databaser. Et **dataprodukt** navngiver de tabeller, med sin ejer, sine forbrugere og sin aktualitets-SLA, og fortæller alle, der er afhængige af det, om dagens data er kommet.

## Opret et dataprodukt

Under **Dataobservabilitet > Dataprodukter** opretter du et dataprodukt: giv det et navn, vælg dets tabeller, og giv det en SLA med en af følgende eller begge:

- **Opdateret senest på et tidspunkt af dagen (UTC):** hver dags data lander samme dag, senest da. Fra det tidspunkt skal hver tabel være ændret den dag; indtil da gælder gårsdagens indlæsning. En indlæsning, der altid er en halv time forsinket, er forsinket i den halve time hver dag.
- **En maksimal alder:** ingen tabels seneste ændring må være ældre end dette.

Hvert femte minut tjekkes hvert produkts tabeller mod dets SLA. Produktet er **Late**, når en af tabellerne er forsinket, og dets data gælder pr. den ældste seneste ændring blandt tabellerne. Det skriver `oneuptime.data.product.late_tables` og `oneuptime.data.product.data_age`, så du kan vise alle produkters aktualitet side om side i en graf.

## På statussider

Når du gemmer et produkt, oprettes der også en **monitor** for det, i dit navn og med dine tilladelser. Monitoren er Forringet, mens en tabel er forsinket, og åbner en hændelse og en advarsel på projektets mindst alvorlige niveau, som løses af sig selv. Tilføj den til en statusside, privat eller offentlig, som en ressource: forbrugere, der abonnerer, får besked, når produktet er forsinket, og når det er opdateret igen. Se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups).

## Som et SLO

Når du gemmer et produkt, oprettes der også et **SLO** over dets monitor: andelen af tiden, hvor dataene er til tiden, målt mod produktets mål over 30 dage, med de advarsler om hurtig og langsom forbrugsrate, som hvert SLO starter med. Se [SLO'er](/docs/slo/introduction). Sletter du produktet, slettes dets monitor og dets SLO også.

## Badget "data as of"

Hvert produkt har et **badge**, der viser, hvilket tidspunkt dets data er fra, grønt, så længe det er til tiden, og orange med "late", når det ikke er. Indlejr det i et BI-dashboard, en wikiside eller en README fra produktets **Oversigt**:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Dets link kræver intet login, så behandl det som et delt link. **Nulstil badge-link** opretter et nyt og trækker det gamle tilbage.

## Næste trin

:::cards
- [Tabellernes tilstand](/docs/data-observability/table-health): Hvordan hver tabels aktualitet læres.
- [OneUptime AI og API'et](/docs/data-observability/ai-and-api): Lad AI-agenter tjekke et produkts tabeller, før de bruger dem.
:::
