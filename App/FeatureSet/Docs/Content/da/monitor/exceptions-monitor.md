# Undtagelsesmonitor

Undtagelsesovervågning giver dig mulighed for at overvåge applikationsundtagelser og -fejl og udløse advarsler, når antallet af undtagelser overskrider dine konfigurerede grænseværdier. OneUptime evaluerer undtagelsesdata fra dine telemetritjenester over et tidsvindue.

## Oversigt

Undtagelsesmonitoer tæller og filtrerer undtagelser, der matcher specifikke kriterier. Dette giver dig mulighed for at:

- Advare om undtagelsesspidser i dine applikationer
- Overvåge specifikke undtagelsestyper
- Søge efter undtagelser efter fejlmeddelelse
- Spore løste og aktive undtagelser separat
- Opdage applikationsstabilitetsproblemer ud fra fejlmønstre

## Oprettelse af en Undtagelsesmonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Undtagelser** som monitortype
4. Vælg de telemetritjenester, der skal overvåges
5. Konfigurer undtagelsesfiltre og kriterier efter behov

## Konfigurationsindstillinger

### Telemetritjenester

Vælg én eller flere tjenester, der skal overvåges undtagelser fra. Tjenester skal sende undtagelsesdata til OneUptime via OpenTelemetry.

### Undtagelsesfiltre

| Filter              | Beskrivelse                                                                     | Påkrævet |
| ------------------- | ------------------------------------------------------------------------------- | -------- |
| Undtagelsestyper    | Filtrer efter undtagelsestypenavne (f.eks. `NullPointerException`, `TypeError`) | Nej      |
| Meddelelse          | Tekstsøgning inden for undtagelsesmeddelelser                                   | Nej      |
| Inkludér løste      | Inkludér undtagelser, der er markeret som løst (standard: falsk)                | Nej      |
| Inkludér arkiverede | Inkludér undtagelser, der er arkiveret (standard: falsk)                        | Nej      |
| Tidsvindue          | Hvor langt tilbage der søges efter undtagelser (i sekunder, standard: 60)       | Nej      |

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype      | Beskrivelse                                                    |
| ---------------- | -------------------------------------------------------------- |
| Undtagelsesantal | Antallet af undtagelser, der matcher dine filtre i tidsvinduet |

### Filtertyper

- **Større end** – Undtagelsesantallet overskrider en grænseværdi
- **Mindre end** – Undtagelsesantallet er under en grænseværdi
- **Større end eller lig med** – Undtagelsesantallet er ved eller over en grænseværdi
- **Mindre end eller lig med** – Undtagelsesantallet er ved eller under en grænseværdi
- **Lig med** – Undtagelsesantallet matcher nøjagtigt
- **Ikke lig med** – Undtagelsesantallet matcher ikke

### Eksempelkriterier

#### Advarsel, hvis mere end 10 undtagelser på 60 sekunder

- **Tidsvindue**: 60 sekunder
- **Kontroller på**: Undtagelsesantal
- **Filtertype**: Større end
- **Værdi**: 10

#### Advarsel ved enhver NullPointerException

- **Undtagelsestyper**: `NullPointerException`
- **Tidsvindue**: 60 sekunder
- **Kontroller på**: Undtagelsesantal
- **Filtertype**: Større end
- **Værdi**: 0

#### Overvåg undtagelser, der indeholder en specifik meddelelse

- **Meddelelse**: `out of memory`
- **Tidsvindue**: 300 sekunder
- **Kontroller på**: Undtagelsesantal
- **Filtertype**: Større end
- **Værdi**: 0

## Opsætningskrav

Undtagelsesovervågning kræver, at dine applikationer sender undtagelsesdata til OneUptime via OpenTelemetry. Se dokumentationen til [OpenTelemetry](/docs/telemetry/open-telemetry) for opsætningsinstruktioner.
