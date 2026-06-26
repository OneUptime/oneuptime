# Domene-monitor

Domeneovervåking lar deg overvåke registreringsstatus og utløp for dine domenenavn. OneUptime utfører periodiske WHOIS-oppslag for å spore domenets helse og varsle deg før det utløper.

## Oversikt

Domene-monitorer spør WHOIS-data for domenene dine for å spore registreringsdetaljer. Dette gjør det mulig å:

- Overvåke utløpsdatoer for domener
- Oppdage utløpte eller snart utløpende domener
- Spore informasjon om domeneregistrar
- Verifisere navneserverkonfigurasjon
- Overvåke domenstatuskoder

## Opprette en domene-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Domain** som monitortype
4. Skriv inn domenenavnet du ønsker å overvåke
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Grunnleggende innstillinger

| Felt       | Beskrivelse                                       | Påkrevd |
| ---------- | ------------------------------------------------- | ------- |
| Domenenavn | Domenet som skal overvåkes (f.eks. `example.com`) | Ja      |

### Avanserte innstillinger

| Felt             | Beskrivelse                            | Standard |
| ---------------- | -------------------------------------- | -------- |
| Tidsavbrudd (ms) | Hvor lenge det ventes på et WHOIS-svar | 10000    |
| Nye forsøk       | Antall nye forsøk ved feil             | 3        |

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når domenet anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype           | Beskrivelse                                   |
| ---------------------- | --------------------------------------------- |
| Domain Expires In Days | Antall dager til domeneregistreringen utløper |
| Domain Registrar       | Navnet på domeneregistraren                   |
| Domain Name Server     | Navneserver-vertsnavn for domenet             |
| Domain Status Code     | WHOIS-domenestatuskoder                       |
| Domain Is Expired      | Om domenet har utløpt                         |

### Filtertyper

For **Domain Is Expired**:

- **True** – Domenet har utløpt
- **False** – Domenet har ikke utløpt

For **Domain Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

For **Domain Registrar**, **Domain Name Server** og **Domain Status Code**:

- **Contains** – Verdien inneholder den angitte teksten
- **Not Contains** – Verdien inneholder ikke den angitte teksten
- **Starts With** – Verdien starter med den angitte teksten
- **Ends With** – Verdien slutter med den angitte teksten
- **Equal To** – Verdien samsvarer nøyaktig
- **Not Equal To** – Verdien samsvarer ikke

### Eksempelkriterier

#### Varsle hvis domenet utløper innen 30 dager

- **Sjekk på**: Domain Expires In Days
- **Filtertype**: Less Than
- **Verdi**: 30

#### Marker som utilgjengelig hvis domenet er utløpt

- **Sjekk på**: Domain Is Expired
- **Filtertype**: True

#### Verifiser at navneserverne er korrekte

- **Sjekk på**: Domain Name Server
- **Filtertype**: Contains
- **Verdi**: `ns1.example.com`

## Beste praksis

1. **Sett tidlige advarsler** – Konfigurer degradert-varsler ved 60 dager og utilgjengelig-varsler ved 14 dager før utløp
2. **Overvåk alle kritiske domener** – Inkluder primærdomener, separat registrerte underdomener og alle domener som brukes til e-post eller API-er
3. **Spor registrarendringer** – Overvåk registrar-feltet for å oppdage uautoriserte domeneoverføringer
