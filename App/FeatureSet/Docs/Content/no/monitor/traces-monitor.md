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

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Traces** som monitortype
4. Velg telemetritjenestene som skal overvåkes
5. Konfigurer span-filtre og kriterier etter behov

## Konfigurasjonsalternativer

### Telemetritjenester

Velg én eller flere tjenester det skal overvåkes spor fra. Tjenester må sende spor til OneUptime via OpenTelemetry.

### Span-filtre

| Filter | Beskrivelse | Påkrevd |
|--------|-------------|---------|
| Span Statuses | Filtrer etter span-statuskode (OK, ERROR, UNSET) | Nei |
| Span Name | Tekstsøk etter spesifikke span-navn (f.eks. operasjons- eller endepunktnavn) | Nei |
| Attributes | Nøkkel-verdi-par for filtrering på egendefinerte span-attributter | Nei |
| Time Window | Hvor langt tilbake det skal søkes etter spans (i sekunder, standard: 60) | Nei |

### Span-statuskoder

- **OK** – Operasjonen fullførtes vellykket
- **ERROR** – Operasjonen oppstod en feil
- **UNSET** – Status ble ikke eksplisitt angitt

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| Span Count | Antall spans som samsvarer med filtrene dine i tidsvinduet |

### Filtertyper

- **Greater Than** – Span-antallet overskrider en terskel
- **Less Than** – Span-antallet er under en terskel
- **Greater Than or Equal To** – Span-antallet er ved eller over en terskel
- **Less Than or Equal To** – Span-antallet er ved eller under en terskel
- **Equal To** – Span-antallet samsvarer nøyaktig
- **Not Equal To** – Span-antallet samsvarer ikke

### Eksempelkriterier

#### Varsle hvis mer enn 50 feilspans på 60 sekunder

- **Span Statuses**: ERROR
- **Tidsvindu**: 60 sekunder
- **Sjekk på**: Span Count
- **Filtertype**: Greater Than
- **Verdi**: 50

#### Varsle ved feil i et spesifikt endepunkt

- **Span Name**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Tidsvindu**: 120 sekunder
- **Sjekk på**: Span Count
- **Filtertype**: Greater Than
- **Verdi**: 0

## Krav til oppsett

Sporingsovervåking krever at applikasjonene dine sender distribuerte spor til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
