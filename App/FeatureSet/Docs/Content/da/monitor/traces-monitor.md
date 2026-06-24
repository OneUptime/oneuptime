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

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Traces** som monitortype
4. Vælg de telemetritjenester, der skal overvåges
5. Konfigurer span-filtre og kriterier efter behov

## Konfigurationsindstillinger

### Telemetritjenester

Vælg én eller flere tjenester, der skal overvåges traces fra. Tjenester skal sende traces til OneUptime via OpenTelemetry.

### Span-filtre

| Filter         | Beskrivelse                                                                       | Påkrævet |
| -------------- | --------------------------------------------------------------------------------- | -------- |
| Span-statusser | Filtrer efter span-statuskode (OK, ERROR, UNSET)                                  | Nej      |
| Span-navn      | Tekstsøgning efter specifikke span-navne (f.eks. operations- eller endpointnavne) | Nej      |
| Attributter    | Nøgle-værdi-par til at filtrere på brugerdefinerede span-attributter              | Nej      |
| Tidsvindue     | Hvor langt tilbage der søges efter spans (i sekunder, standard: 60)               | Nej      |

### Span-statuskoder

- **OK** – Operationen fuldførte med succes
- **ERROR** – Operationen stødte på en fejl
- **UNSET** – Status blev ikke eksplicit angivet

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
- **Ikke lig med** – Span-antallet matcher ikke

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
