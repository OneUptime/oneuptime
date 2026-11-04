# Dataprodukter

De som bruker data – analytikere, økonomiavdelingen, ledere, AI-agenter – tenker i det de bruker: «tabellene bak inntektsdashbordet», ikke databaser. Et **dataprodukt** navngir disse tabellene, med eier, forbrukere og aktualitets-SLA, og forteller alle som er avhengige av det, om dagens data er på plass.

## Opprett et dataprodukt

Under **Dataobserverbarhet > Dataprodukter** oppretter du et dataprodukt: gi det et navn, velg tabellene, og gi det en SLA med ett av disse kravene eller begge:

- **Oppdatert innen et klokkeslett (UTC):** dataene for hver dag kommer samme dag, innen da. Fra det klokkeslettet må hver tabell ha endret seg den dagen; inntil da gjelder gårsdagens lasting. En lasting som alltid er en halvtime forsinket, er forsinket i den halvtimen hver dag.
- **En maksimal alder:** ingen tabells siste endring kan være eldre enn dette.

Hvert femte minutt sjekkes tabellene i hvert produkt mot SLA-en. Produktet er **Sen** når en av tabellene er det, og dataene er oppdatert per den eldste siste endringen blant dem. Det skriver `oneuptime.data.product.late_tables` og `oneuptime.data.product.data_age`, så du kan vise aktualiteten til alle produktene side om side i en graf.

## På statussider

Når du lagrer et produkt, opprettes det også en **monitor** for det, som deg og med dine tillatelser. Monitoren har statusen Degraded mens en tabell er forsinket, og åpner en hendelse og et varsel på prosjektets minst alvorlige nivå, som løses av seg selv. Legg den til på en statusside, privat eller offentlig, som en ressurs: forbrukere som abonnerer, får beskjed når produktet er forsinket, og når det er ferskt igjen. Se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).

## Som et SLO

Når du lagrer et produkt, opprettes det også et **SLO** over monitoren: andelen av tiden dataene er i rute, målt mot produktets mål over 30 dager, med de raske og langsomme forbruksratevarslene hvert SLO starter med. Se [SLO-er](/docs/slo/introduction). Sletter du produktet, slettes monitoren og SLO-et.

## «data as of»-merket

Hvert produkt har et **merke** som viser hvilket tidspunkt dataene er oppdatert per, grønt når de er i rute og gult med «late» når de ikke er det. Bygg det inn i et BI-dashbord, en wikiside eller en README fra produktets **Oversikt**:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Lenken krever ingen innlogging, så behandle den som en delt lenke. **Tilbakestill merkelenke** lager en ny lenke og trekker tilbake den gamle.

## Neste steg

:::cards
- [Tabellhelse](/docs/data-observability/table-health): Hvordan aktualiteten til hver tabell læres.
- [OneUptime AI og API-et](/docs/data-observability/ai-and-api): La AI-agenter sjekke tabellene i et produkt før de bruker dem.
:::
