# Spor-monitor

Sporingsovervåking lar deg overvåke distribuerte spor fra applikasjonene dine og utløse varsler basert på span-mønstre, antall og statuser. OneUptime evaluerer sporingsdata fra telemetritjenestene dine over et tidsvindu.

## Oversikt

Spor-monitorer søker etter og teller spans som samsvarer med spesifikke filtre. Dette gjør det mulig å:

- Varsle ved topper i feilspans i tjenestene dine
- Overvåke spesifikke operasjoner og endepunkter
- Spore span-volum og mønstre
- Filtrere etter span-status, navn og egendefinerte attributter
- Oppdage ytelses- og pålitelighetssproblemer fra sporingsdata

## Opprette en spor-monitor

1. Gå til **Overvåkere** i OneUptime-dashbordet
2. Klikk **Opprett monitor**
3. Velg **Spor** som monitortype
4. Velg hvilke spans som skal telles: span-navnet, tidsvinduet og span-statusene
5. Åpne **Flere felt** under disse filtrene for å avgrense dem til telemetritjenester, infrastrukturenheter eller attributter
6. Konfigurer kriteriene etter behov

## Konfigurasjonsalternativer

### Telemetritjenester

Velg under **Flere felt** én eller flere tjenester det skal overvåkes spor fra. La feltet stå tomt for å overvåke spans fra alle tjenester. Tjenester må sende spor til OneUptime via OpenTelemetry.

### Span-filtre

| Filter        | Beskrivelse                                                                  | Påkrevd |
| ------------- | ---------------------------------------------------------------------------- | ------- |
| Span Statuses | Filtrer etter span-statuskode (OK, ERROR, UNSET)                             | Nei     |
| Span Name     | Tekstsøk etter spesifikke span-navn (f.eks. operasjons- eller endepunktnavn) | Nei     |
| Attributes    | Nøkkel-verdi-par for filtrering på egendefinerte span-attributter            | Nei     |
| Time Window   | Hvor langt tilbake det skal søkes etter spans (i sekunder, standard: 60)     | Nei     |

### Span-statuskoder

- **OK** – Operasjonen ble eksplisitt merket som vellykket av applikasjonskode eller en sporings-pipeline
- **ERROR** – Operasjonen støtte på en feil
- **UNSET** – Ingen feilstatus ble angitt. Dette er standardstatusen i OpenTelemetry

UNSET betyr ikke at data mangler. OpenTelemetry-instrumentering setter ERROR når en operasjon feiler, og lar vellykkede spans stå som UNSET, så på en sunn tjeneste er de fleste spans UNSET. OneUptime viser dem i grønt som «Unset (no error)». Å registrere et unntak endrer ikke statusen til et span, så et UNSET-span kan fortsatt ha unntak; de vises sammen med spannet. Filtrer på ERROR for å varsle ved feil. Velg både OK og UNSET for å telle alle spans som ikke feilet.

Hvis du vil at vellykkede forespørsler skal vises som OK, legger du til en sporings-pipeline under **Spor > Innstillinger > Pipelines** med filtervilkåret **Status = Ikke angitt** og en **Status-omkartlegger** som tilordner `http.response.status_code`-verdier, for eksempel `200`, til OK.

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse                                                |
| ------------ | ---------------------------------------------------------- |
| Span Count   | Antall spans som samsvarer med filtrene dine i tidsvinduet |

### Filtertyper

- **Greater Than** – Span-antallet overskrider en terskel
- **Less Than** – Span-antallet er under en terskel
- **Greater Than or Equal To** – Span-antallet er ved eller over en terskel
- **Less Than or Equal To** – Span-antallet er ved eller under en terskel
- **Equal To** – Span-antallet samsvarer nøyaktig

### Eksempelkriterier

#### Varsle hvis mer enn 50 feilspans på 60 sekunder

- **Span Statuses**: ERROR
- **Tidsvindu**: 60 sekunder
- **Check On**: Span Count
- **Filtertype**: Greater Than
- **Verdi**: 50

#### Varsle ved feil i et spesifikt endepunkt

- **Span-navn**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Tidsvindu**: 120 sekunder
- **Check On**: Span Count
- **Filtertype**: Greater Than
- **Verdi**: 0

## Krav til oppsett

Sporingsovervåking krever at applikasjonene dine sender distribuerte spor til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
