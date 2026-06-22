# Profiler-monitor

Profileringsovervåking lar deg overvåke kontinuerlige profileringsdata fra applikasjonene dine og utløse varsler basert på profilerantall og mønstre. OneUptime evaluerer profileringsdata fra telemetritjenestene dine over et tidsvindu.

## Oversikt

Profiler-monitorer teller og filtrerer profileringsdata som samsvarer med spesifikke kriterier. Dette gjør det mulig å:

- Overvåke kontinuerlige profileringsdata fra applikasjonene dine
- Filtrere profiler etter type (CPU, minne, goroutines, osv.)
- Spore profilvolum og mønstre
- Varsle ved profileringsavvik
- Filtrere etter egendefinerte profilattributter

## Opprette en profiler-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Profiles** som monitortype
4. Velg telemetritjenestene som skal overvåkes
5. Konfigurer profilfiltre og kriterier etter behov

## Konfigurasjonsalternativer

### Telemetritjenester

Velg én eller flere tjenester det skal overvåkes profiler fra. Tjenester må sende kontinuerlige profileringsdata til OneUptime via OpenTelemetry.

### Profilfiltre

| Filter        | Beskrivelse                                                                 | Påkrevd |
| ------------- | --------------------------------------------------------------------------- | ------- |
| Profile Types | Filtrer etter profiltypenavnet (f.eks. CPU, memory, goroutines)             | Nei     |
| Attributes    | Nøkkel-verdi-par for filtrering på egendefinerte profilattributter          | Nei     |
| Time Window   | Hvor langt tilbake det skal søkes etter profiler (i sekunder, standard: 60) | Nei     |

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype  | Beskrivelse                                                   |
| ------------- | ------------------------------------------------------------- |
| Profile Count | Antall profiler som samsvarer med filtrene dine i tidsvinduet |

### Filtertyper

- **Greater Than** – Profilerantallet overskrider en terskel
- **Less Than** – Profilerantallet er under en terskel
- **Greater Than or Equal To** – Profilerantallet er ved eller over en terskel
- **Less Than or Equal To** – Profilerantallet er ved eller under en terskel
- **Equal To** – Profilerantallet samsvarer nøyaktig
- **Not Equal To** – Profilerantallet samsvarer ikke

### Eksempelkriterier

#### Varsle hvis ingen profiler mottatt på 5 minutter

- **Tidsvindu**: 300 sekunder
- **Sjekk på**: Profile Count
- **Filtertype**: Equal To
- **Verdi**: 0

## Krav til oppsett

Profileringsovervåking krever at applikasjonene dine sender kontinuerlige profileringsdata til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
