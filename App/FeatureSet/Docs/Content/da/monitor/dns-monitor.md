# DNS Monitor

DNS-overvågning giver dig mulighed for at overvåge sundheden og korrektheden af DNS-opløsning for dine domæner. OneUptime forespørger periodisk DNS-poster og validerer svarene mod dine konfigurerede kriterier.

## Oversigt

DNS-monitorer forespørger DNS-servere efter specifikke posttyper og evaluerer resultaterne. Dette giver dig mulighed for at:

- Overvåge DNS-servicetilgængelighed
- Bekræfte, at DNS-poster returnerer korrekte værdier
- Spore DNS-opløsningens svartider
- Validere DNSSEC-konfiguration
- Opdage DNS-spredningsproblemer eller -kapring

## Oprettelse af en DNS Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **DNS** som monitortype
4. Indtast domænenavnet og posttypen der skal forespørges
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Grundlæggende indstillinger

| Felt       | Beskrivelse                                                                    | Påkrævet |
| ---------- | ------------------------------------------------------------------------------ | -------- |
| Domænenavn | Det domæne, der skal forespørges (f.eks. `example.com`)                        | Ja       |
| Posttype   | Den DNS-posttype, der skal forespørges                                         | Ja       |
| DNS-server | Brugerdefineret DNS-server (f.eks. `8.8.8.8`). Lad stå tomt for systemstandard | Nej      |

### Understøttede posttyper

| Posttype | Beskrivelse                             |
| -------- | --------------------------------------- |
| A        | IPv4-adresseposter                      |
| AAAA     | IPv6-adresseposter                      |
| CNAME    | Kanonisk navn (alias)-poster            |
| MX       | Mailudvekslingsposter                   |
| NS       | Navneserverposter                       |
| TXT      | Tekstposter (SPF, DKIM osv.)            |
| SOA      | Start af autoritetsposter               |
| PTR      | Pointerposter (omvendt DNS)             |
| SRV      | Servicelokatorposter                    |
| CAA      | Certifikatmyndighedsautorisationsposter |

### Avancerede indstillinger

| Felt         | Beskrivelse              | Standard |
| ------------ | ------------------------ | -------- |
| Port         | DNS-portnummer           | 53       |
| Timeout (ms) | Tid at vente på et svar  | 5000     |
| Genforsøg    | Antal genforsøg ved fejl | 3        |

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din DNS betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontoltyper

| Kontroltype         | Beskrivelse                                |
| ------------------- | ------------------------------------------ |
| DNS er online       | Om DNS-serveren svarer på forespørgsler    |
| DNS-svartid (ms)    | Forespørgselssvartid i millisekunder       |
| DNS-post eksisterer | Om DNS-poster eksisterer for forespørgslen |
| DNS-postværdi       | Værdien returneret af en DNS-post          |
| DNSSEC er gyldig    | Om DNSSEC-validering passerer              |

### Filtertyper

For **DNS er online**, **DNS-post eksisterer** og **DNSSEC er gyldig**:

- **Sand** – Betingelse er sand
- **Falsk** – Betingelse er falsk

For **DNS-svartid**:

- **Større end**, **Mindre end**, **Større end eller lig med**, **Mindre end eller lig med**, **Lig med**, **Ikke lig med**

For **DNS-postværdi**:

- **Indeholder** – Postværdien indeholder den angivne tekst
- **Indeholder ikke** – Postværdien indeholder ikke den angivne tekst
- **Starter med** – Postværdien starter med den angivne tekst
- **Slutter med** – Postværdien slutter med den angivne tekst
- **Lig med** – Postværdien matcher nøjagtigt
- **Ikke lig med** – Postværdien matcher ikke

### Eksempelkriterier

#### Kontroller, om DNS løser

- **Kontroller på**: DNS er online
- **Filtertype**: Sand

#### Bekræft, at A-post peger på korrekt IP

- **Kontroller på**: DNS-postværdi
- **Filtertype**: Lig med
- **Værdi**: `93.184.216.34`

#### Advarsel, hvis DNS-svar er langsomt

- **Kontroller på**: DNS-svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 500

#### Bekræft, at DNSSEC er gyldig

- **Kontroller på**: DNSSEC er gyldig
- **Filtertype**: Sand
