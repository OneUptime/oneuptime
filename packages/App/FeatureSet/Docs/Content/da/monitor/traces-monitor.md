# Traces Monitor

Traces-overvågning giver dig mulighed for at overvåge distribuerede traces fra dine applikationer og udløse advarsler baseret på span-mønstre, -antal og -statusser. OneUptime evaluerer trace-data fra dine telemetritjenester over et tidsvindue.

## Oversigt

Traces-monitorer søger og tæller spans, der matcher specifikke filtre. Dette giver dig mulighed for at:

- Advare om fejlspan-spidser i dine tjenester
- Overvåge specifikke operationer og endpoints
- Spore span-volumen og -mønstre
- Filtrere efter span-status, navn og brugerdefinerede attributter
- Opdage ydeevne- og pålidelighed sproblemer ud fra trace-data

## Oprettelse af en Traces Monitor

1. Gå til **Overvågninger** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Spor** som monitortype
4. Vælg, hvilke spans der skal tælles: span-navnet, tidsvinduet og span-statusserne
5. Åbn **Flere felter** under disse filtre for at begrænse dem til telemetritjenester, infrastrukturenheder eller attributter
6. Konfigurer kriterierne efter behov

## Konfigurationsindstillinger

### Telemetritjenester

Vælg under **Flere felter** én eller flere tjenester, der skal overvåges traces fra. Lad feltet være tomt for at overvåge spans fra alle tjenester. Tjenester skal sende traces til OneUptime via OpenTelemetry.

### Span-filtre

| Filter         | Beskrivelse                                                                       | Påkrævet |
| -------------- | --------------------------------------------------------------------------------- | -------- |
| Span-statusser | Filtrer efter span-statuskode (OK, ERROR, UNSET)                                  | Nej      |
| Span-navn      | Tekstsøgning efter specifikke span-navne (f.eks. operations- eller endpointnavne) | Nej      |
| Attributter    | Nøgle-værdi-par til at filtrere på brugerdefinerede span-attributter              | Nej      |
| Tidsvindue     | Hvor langt tilbage der søges efter spans (i sekunder, standard: 60)               | Nej      |

### Span-statuskoder

- **OK** – Operationen blev eksplicit markeret som vellykket af applikationskode eller en trace-pipeline
- **ERROR** – Operationen stødte på en fejl
- **UNSET** – Der blev ikke angivet nogen fejlstatus. Dette er OpenTelemetrys standardstatus

UNSET betyder ikke, at der mangler data. OpenTelemetry-instrumentering sætter ERROR, når en operation fejler, og lader vellykkede spans stå som UNSET, så på en sund tjeneste er de fleste spans UNSET. OneUptime viser dem med grønt som "Unset (no error)". At registrere en undtagelse ændrer ikke et spans status, så et UNSET-span kan stadig have undtagelser; de vises sammen med spannet. For at advare om fejl skal du filtrere på ERROR. For at tælle alle spans, der ikke fejlede, skal du vælge både OK og UNSET.

Hvis du vil have vellykkede forespørgsler vist som OK, skal du tilføje en trace-pipeline under **Spor > Indstillinger > Pipelines** med filterbetingelsen **Status = Ikke angivet** og en **Status-remapper**, der mapper `http.response.status_code`-værdier såsom `200` til Ok.

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse                                              |
| ----------- | -------------------------------------------------------- |
| Span-antal  | Antallet af spans, der matcher dine filtre i tidsvinduet |

### Filtertyper

- **Større end** – Span-antallet overskrider en grænseværdi
- **Mindre end** – Span-antallet er under en grænseværdi
- **Større end eller lig med** – Span-antallet er ved eller over en grænseværdi
- **Mindre end eller lig med** – Span-antallet er ved eller under en grænseværdi
- **Lig med** – Span-antallet matcher nøjagtigt

### Eksempelkriterier

#### Advarsel, hvis mere end 50 fejlspans på 60 sekunder

- **Span-statusser**: ERROR
- **Tidsvindue**: 60 sekunder
- **Kontroller på**: Span-antal
- **Filtertype**: Større end
- **Værdi**: 50

#### Advarsel ved fejl på et specifikt endpoint

- **Span-navn**: `POST /api/checkout`
- **Span-statusser**: ERROR
- **Tidsvindue**: 120 sekunder
- **Kontroller på**: Span-antal
- **Filtertype**: Større end
- **Værdi**: 0

## Opsætningskrav

Traces-overvågning kræver, at dine applikationer sender distribuerede traces til OneUptime via OpenTelemetry. Se dokumentationen til [OpenTelemetry](/docs/telemetry/open-telemetry) for opsætningsinstruktioner.
