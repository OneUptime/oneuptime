# DNS-monitor

DNS-overvåking lar deg overvåke helse og korrekthet for DNS-oppslag for dine domener. OneUptime spør periodisk DNS-poster og validerer svarene mot dine konfigurerte kriterier.

## Oversikt

DNS-monitorer spør DNS-servere om spesifikke posttyper og evaluerer resultatene. Dette gjør det mulig å:

- Overvåke tilgjengeligheten til DNS-tjenesten
- Verifisere at DNS-poster returnerer korrekte verdier
- Spore svartider for DNS-oppslag
- Validere DNSSEC-konfigurasjon
- Oppdage DNS-spredningsproblemer eller kapring

## Opprette en DNS-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **DNS** som monitortype
4. Skriv inn domenenavnet og posttypen som skal spørres
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Grunnleggende innstillinger

| Felt       | Beskrivelse                                                               | Påkrevd |
| ---------- | ------------------------------------------------------------------------- | ------- |
| Domenenavn | Domenet som skal spørres (f.eks. `example.com`)                           | Ja      |
| Posttype   | DNS-posttypen som skal spørres                                            | Ja      |
| DNS-server | Egendefinert DNS-server (f.eks. `8.8.8.8`). La stå tom for systemstandard | Nei     |

### Støttede posttyper

| Posttype | Beskrivelse                                |
| -------- | ------------------------------------------ |
| A        | IPv4-adresseposter                         |
| AAAA     | IPv6-adresseposter                         |
| CNAME    | Kanonisk navn (alias)-poster               |
| MX       | E-postutvekslingsposter                    |
| NS       | Navneserverposter                          |
| TXT      | Tekstposter (SPF, DKIM, osv.)              |
| SOA      | Start of Authority-poster                  |
| PTR      | Pekerpost (omvendt DNS)                    |
| SRV      | Tjenestelokalisatorposter                  |
| CAA      | Certificate Authority Authorization-poster |

### Avanserte innstillinger

| Felt             | Beskrivelse                      | Standard |
| ---------------- | -------------------------------- | -------- |
| Port             | DNS-portnummer                   | 53       |
| Tidsavbrudd (ms) | Hvor lenge det ventes på et svar | 5000     |
| Nye forsøk       | Antall nye forsøk ved feil       | 3        |

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når DNS-en anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype              | Beskrivelse                             |
| ------------------------- | --------------------------------------- |
| DNS Is Online             | Om DNS-serveren svarer på spørringer    |
| DNS Response Time (in ms) | Svartid for spørringen i millisekunder  |
| DNS Record Exists         | Om det finnes DNS-poster for spørringen |
| DNS Record Value          | Verdien returnert av en DNS-post        |
| DNSSEC Is Valid           | Om DNSSEC-validering er gyldig          |

### Filtertyper

For **DNS Is Online**, **DNS Record Exists** og **DNSSEC Is Valid**:

- **True** – Betingelsen er sann
- **False** – Betingelsen er usann

For **DNS Response Time**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

For **DNS Record Value**:

- **Contains** – Postverdien inneholder den angitte teksten
- **Not Contains** – Postverdien inneholder ikke den angitte teksten
- **Starts With** – Postverdien starter med den angitte teksten
- **Ends With** – Postverdien slutter med den angitte teksten
- **Equal To** – Postverdien samsvarer nøyaktig
- **Not Equal To** – Postverdien samsvarer ikke

### Eksempelkriterier

#### Sjekk om DNS løser opp

- **Sjekk på**: DNS Is Online
- **Filtertype**: True

#### Verifiser at A-posten peker til korrekt IP

- **Sjekk på**: DNS Record Value
- **Filtertype**: Equal To
- **Verdi**: `93.184.216.34`

#### Varsle hvis DNS-svaret er tregt

- **Sjekk på**: DNS Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 500

#### Verifiser at DNSSEC er gyldig

- **Sjekk på**: DNSSEC Is Valid
- **Filtertype**: True
