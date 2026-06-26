# Logg-monitor

Loggingsovervåking lar deg overvåke applikasjonsloggene dine og utløse varsler basert på loggmønstre, antall og alvorlighetsnivåer. OneUptime evaluerer logger fra telemetritjenestene dine og sjekker dem mot dine konfigurerte kriterier.

## Oversikt

Logg-monitorer søker etter og teller logger som samsvarer med spesifikke filtre over et tidsvindu. Dette gjør det mulig å:

- Varsle ved topper i feillogger
- Overvåke spesifikke loggmønstre eller meldinger
- Spore loggvolum etter alvorlighetsnivå
- Filtrere logger etter tjeneste, attributter og innhold
- Oppdage applikasjonsproblemer fra loggmønstre

## Opprette en logg-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Logs** som monitortype
4. Velg telemetritjenestene som skal overvåkes
5. Konfigurer loggfiltre og kriterier etter behov

## Konfigurasjonsalternativer

### Telemetritjenester

Velg én eller flere tjenester det skal overvåkes logger fra. Tjenester må sende logger til OneUptime via OpenTelemetry.

### Loggfiltre

| Filter          | Beskrivelse                                                               | Påkrevd |
| --------------- | ------------------------------------------------------------------------- | ------- |
| Severity Levels | Filtrer etter loggalvorlighet (ERROR, WARN, INFO, DEBUG, osv.)            | Nei     |
| Body            | Tekstsøk i loggmeldingens kropp                                           | Nei     |
| Attributes      | Nøkkel-verdi-par for filtrering på egendefinerte loggattributter          | Nei     |
| Time Window     | Hvor langt tilbake det skal søkes etter logger (i sekunder, standard: 60) | Nei     |

### Alvorlighetsnivåer

Filtrer logger etter ett eller flere alvorlighetsnivåer:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse                                                 |
| ------------ | ----------------------------------------------------------- |
| Log Count    | Antall logger som samsvarer med filtrene dine i tidsvinduet |

### Filtertyper

- **Greater Than** – Loggantallet overskrider en terskel
- **Less Than** – Loggantallet er under en terskel
- **Greater Than or Equal To** – Loggantallet er ved eller over en terskel
- **Less Than or Equal To** – Loggantallet er ved eller under en terskel
- **Equal To** – Loggantallet samsvarer nøyaktig
- **Not Equal To** – Loggantallet samsvarer ikke

### Eksempelkriterier

#### Varsle hvis mer enn 100 feillogger på 60 sekunder

- **Severity Levels**: ERROR
- **Tidsvindu**: 60 sekunder
- **Sjekk på**: Log Count
- **Filtertype**: Greater Than
- **Verdi**: 100

#### Varsle hvis noen fatale logger vises

- **Severity Levels**: FATAL
- **Tidsvindu**: 60 sekunder
- **Sjekk på**: Log Count
- **Filtertype**: Greater Than
- **Verdi**: 0

#### Overvåke logger som inneholder en spesifikk feilmelding

- **Body**: `database connection timeout`
- **Tidsvindu**: 300 sekunder
- **Sjekk på**: Log Count
- **Filtertype**: Greater Than
- **Verdi**: 5

## Krav til oppsett

Loggingsovervåking krever at applikasjonene dine sender logger til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
