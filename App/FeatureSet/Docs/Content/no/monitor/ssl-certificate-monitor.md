# SSL-sertifikatmonitor

SSL-sertifikatovervåking lar deg overvåke gyldigheten og utløpet for SSL/TLS-sertifikater på nettsteder og tjenester. OneUptime sjekker sertifikatene dine periodisk og varsler deg før de utløper eller hvis det oppdages problemer.

## Oversikt

SSL-sertifikatmonitorer kobler til HTTPS-endepunktene dine og inspiserer SSL/TLS-sertifikatet. Dette gjør det mulig å:

- Overvåke utløpsdatoer for sertifikater
- Oppdage utløpte eller snart utløpende sertifikater
- Identifisere selvsignerte sertifikater
- Verifisere sertifikatgyldighet
- Forhindre tjenesteavbrudd forårsaket av utløpte sertifikater

## Opprette en SSL-sertifikatmonitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **SSL Certificate** som monitortype
4. Skriv inn URL-en til HTTPS-endepunktet som skal sjekkes
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### URL

Skriv inn den fullstendige HTTPS-URL-en til endepunktet hvis SSL-sertifikat du ønsker å overvåke (f.eks. `https://example.com` eller `https://example.com:8443`).

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når sertifikatstatusen anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype               | Beskrivelse                                               |
| -------------------------- | --------------------------------------------------------- |
| Is Online                  | Om serveren er tilgjengelig                               |
| Is Valid Certificate       | Om sertifikatet er gyldig (ikke utløpt, ikke selvsignert) |
| Is Self-Signed Certificate | Om sertifikatet er selvsignert                            |
| Is Expired Certificate     | Om sertifikatet har utløpt                                |
| Is Not A Valid Certificate | Om sertifikatet er ugyldig                                |
| Expires In Hours           | Antall timer til sertifikatet utløper                     |
| Expires In Days            | Antall dager til sertifikatet utløper                     |
| Is Request Timeout         | Om tilkoblingen fikk tidsavbrudd                          |

### Filtertyper

For **Is Online**, **Is Valid Certificate**, **Is Self-Signed Certificate**, **Is Expired Certificate**, **Is Not A Valid Certificate** og **Is Request Timeout**:

- **True** – Betingelsen er sann
- **False** – Betingelsen er usann

For **Expires In Hours** og **Expires In Days**:

- **Greater Than** – Utløpet er mer enn den angitte verdien unna
- **Less Than** – Utløpet er mindre enn den angitte verdien unna
- **Greater Than or Equal To** – Utløpet er ved eller mer enn den angitte verdien unna
- **Less Than or Equal To** – Utløpet er ved eller mindre enn den angitte verdien unna
- **Equal To** – Utløpet samsvarer nøyaktig
- **Not Equal To** – Utløpet samsvarer ikke

### Eksempelkriterier

#### Marker som degradert hvis sertifikatet utløper innen 30 dager

- **Sjekk på**: Expires In Days
- **Filtertype**: Less Than
- **Verdi**: 30

#### Marker som utilgjengelig hvis sertifikatet er utløpt

- **Sjekk på**: Is Expired Certificate
- **Filtertype**: True

#### Varsle hvis sertifikatet er selvsignert

- **Sjekk på**: Is Self-Signed Certificate
- **Filtertype**: True

#### Marker som utilgjengelig hvis sertifikatet er ugyldig

- **Sjekk på**: Is Not A Valid Certificate
- **Filtertype**: True

## Beste praksis

1. **Sett flere terskler** – Bruk degradert status ved 30 dager og utilgjengelig ved 7 dager før utløp for å gi deg tid til fornyelse
2. **Overvåk alle endepunkter** – Hvis du har flere domener eller underdomener, opprett en monitor for hvert
3. **Inkluder ikke-standardporter** – Ikke glem tjenester som kjører HTTPS på ikke-standardporter
4. **Overvåk etter fornyelse** – Etter fornyelse av et sertifikat, verifiser at monitoren bekrefter at det er gyldig
