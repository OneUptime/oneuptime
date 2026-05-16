# Logsmonitor

Log-overvågning giver dig mulighed for at overvåge dine applikationslogs og udløse advarsler baseret på logmønstre, antal og alvorlighedsniveauer. OneUptime evaluerer logs fra dine telemetritjenester og kontrollerer dem mod dine konfigurerede kriterier.

## Oversigt

Log-monitorer søger og tæller logs, der matcher specifikke filtre over et tidsvindue. Dette giver dig mulighed for at:

- Advare om fejllogspidser
- Overvåge specifikke logmønstre eller -meddelelser
- Spore log-volumen efter alvorlighedsniveau
- Filtrere logs efter tjeneste, attributter og indhold
- Opdage applikationsproblemer ud fra logmønstre

## Oprettelse af en Log-monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Logs** som monitortype
4. Vælg de telemetritjenester, der skal overvåges
5. Konfigurer log-filtre og kriterier efter behov

## Konfigurationsindstillinger

### Telemetritjenester

Vælg én eller flere tjenester, der skal overvåges logs fra. Tjenester skal sende logs til OneUptime via OpenTelemetry.

### Log-filtre

| Filter | Beskrivelse | Påkrævet |
|--------|-------------|----------|
| Alvorlighedsniveauer | Filtrer efter log-alvorlighed (ERROR, WARN, INFO, DEBUG osv.) | Nej |
| Indhold | Tekstsøgning inden for log-beskedens krop | Nej |
| Attributter | Nøgle-værdi-par til at filtrere på brugerdefinerede log-attributter | Nej |
| Tidsvindue | Hvor langt tilbage der søges efter logs (i sekunder, standard: 60) | Nej |

### Alvorlighedsniveauer

Filtrer logs efter et eller flere alvorlighedsniveauer:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Log-antal | Antallet af logs, der matcher dine filtre i tidsvinduet |

### Filtertyper

- **Større end** – Log-antallet overskrider en grænseværdi
- **Mindre end** – Log-antallet er under en grænseværdi
- **Større end eller lig med** – Log-antallet er ved eller over en grænseværdi
- **Mindre end eller lig med** – Log-antallet er ved eller under en grænseværdi
- **Lig med** – Log-antallet matcher nøjagtigt
- **Ikke lig med** – Log-antallet matcher ikke

### Eksempelkriterier

#### Advarsel, hvis mere end 100 fejllogs på 60 sekunder

- **Alvorlighedsniveauer**: ERROR
- **Tidsvindue**: 60 sekunder
- **Kontroller på**: Log-antal
- **Filtertype**: Større end
- **Værdi**: 100

#### Advarsel, hvis fatale logs opstår

- **Alvorlighedsniveauer**: FATAL
- **Tidsvindue**: 60 sekunder
- **Kontroller på**: Log-antal
- **Filtertype**: Større end
- **Værdi**: 0

#### Overvåg logs, der indeholder en specifik fejlmeddelelse

- **Indhold**: `database connection timeout`
- **Tidsvindue**: 300 sekunder
- **Kontroller på**: Log-antal
- **Filtertype**: Større end
- **Værdi**: 5

## Opsætningskrav

Log-overvågning kræver, at dine applikationer sender logs til OneUptime via OpenTelemetry. Se dokumentationen til [OpenTelemetry](/docs/telemetry/open-telemetry) for opsætningsinstruktioner.
