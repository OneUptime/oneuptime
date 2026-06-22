# Profilmonitor

Profilovervågning giver dig mulighed for at overvåge kontinuerlige profileringsdata fra dine applikationer og udløse advarsler baseret på profilantal og -mønstre. OneUptime evaluerer profileringsdata fra dine telemetritjenester over et tidsvindue.

## Oversigt

Profilmonitorer tæller og filtrerer profileringsdata, der matcher specifikke kriterier. Dette giver dig mulighed for at:

- Overvåge kontinuerlige profileringsdata fra dine applikationer
- Filtrere profiler efter type (CPU, hukommelse, goroutines osv.)
- Spore profilvolumen og -mønstre
- Advare om profileringsanomalier
- Filtrere efter brugerdefinerede profilattributter

## Oprettelse af en Profilmonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Profiler** som monitortype
4. Vælg de telemetritjenester, der skal overvåges
5. Konfigurer profilfiltre og kriterier efter behov

## Konfigurationsindstillinger

### Telemetritjenester

Vælg én eller flere tjenester, der skal overvåges profiler fra. Tjenester skal sende kontinuerlige profileringsdata til OneUptime via OpenTelemetry.

### Profilfiltre

| Filter      | Beskrivelse                                                            | Påkrævet |
| ----------- | ---------------------------------------------------------------------- | -------- |
| Profiltyper | Filtrer efter profiltypenavne (f.eks. CPU, hukommelse, goroutines)     | Nej      |
| Attributter | Nøgle-værdi-par til at filtrere på brugerdefinerede profilattributter  | Nej      |
| Tidsvindue  | Hvor langt tilbage der søges efter profiler (i sekunder, standard: 60) | Nej      |

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse                                                 |
| ----------- | ----------------------------------------------------------- |
| Profilantal | Antallet af profiler, der matcher dine filtre i tidsvinduet |

### Filtertyper

- **Større end** – Profilantallet overskrider en grænseværdi
- **Mindre end** – Profilantallet er under en grænseværdi
- **Større end eller lig med** – Profilantallet er ved eller over en grænseværdi
- **Mindre end eller lig med** – Profilantallet er ved eller under en grænseværdi
- **Lig med** – Profilantallet matcher nøjagtigt
- **Ikke lig med** – Profilantallet matcher ikke

### Eksempelkriterier

#### Advarsel, hvis ingen profiler modtaget på 5 minutter

- **Tidsvindue**: 300 sekunder
- **Kontroller på**: Profilantal
- **Filtertype**: Lig med
- **Værdi**: 0

## Opsætningskrav

Profilovervågning kræver, at dine applikationer sender kontinuerlige profileringsdata til OneUptime via OpenTelemetry. Se dokumentationen til [OpenTelemetry](/docs/telemetry/open-telemetry) for opsætningsinstruktioner.
