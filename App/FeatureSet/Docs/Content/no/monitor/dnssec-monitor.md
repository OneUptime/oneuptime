# DNSSEC-monitor

DNSSEC-overvåking lar deg validere den kryptografiske integriteten til DNS-svar for sonene dine. OneUptime utfører periodisk fullstendig DNSSEC-validering — kontroll av DNSKEY-poster, DS-delegering ved den overordnede sonen, gyldigheten av RRSIG-signaturer, resolverkonsensus om AD-flagget og konsistens mellom autoritative navneservere.

## Oversikt

DNSSEC-monitorer validerer hele tillitskjeden fra rotsonen og ned til ditt domene. Dette gjør det mulig å:

- Oppdage brutte DNSSEC-kjeder før resolvere begynner å returnere SERVFAIL til brukerne dine
- Bli varslet før sonesigneringsnøkler utløper
- Verifisere at DS-postene dine er korrekt publisert ved den overordnede sonen
- Fange opp avvik mellom autoritative navneservere (primær/sekundær ute av synk)
- Bekrefte at validerende resolvere faktisk setter AD-flagget for sonen din

## Opprette en DNSSEC-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **DNSSEC** som monitortype
4. Skriv inn sonen (domenet) du vil validere
5. Konfigurer resolvere og overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Grunnleggende innstillinger

| Felt | Beskrivelse | Påkrevd |
|------|-------------|---------|
| Sone (domenenavn) | Sonen som skal valideres via DNSSEC (f.eks. `example.com`) | Ja |
| Resolvere | Kommaseparert liste over validerende resolvere som skal spørres (f.eks. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Ja |
| Sjekk navneserverkonsistens | Spør hver autoritative navneserver direkte og verifiserer at de returnerer det samme SOA-serienummeret | Nei |

### Avanserte innstillinger

| Felt | Beskrivelse | Standard |
|------|-------------|---------|
| Varsel om signaturutløp (dager) | Standardterskel for RRSIG-utløpsfilteret | 7 |
| Tidsavbrudd (ms) | Hvor lenge det ventes på hver DNS-spørring | 10000 |
| Nye forsøk | Antall nye forsøk ved feil | 3 |

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når sonen din anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| DNSSEC Chain Is Valid | Hele valideringskjeden (root → TLD → sone) løses opp korrekt |
| DNSSEC DNSKEY Record Exists | Sonen publiserer minst én DNSKEY-post |
| DNSSEC DS Record Exists At Parent | Den overordnede sonen publiserer en DS-post som matcher sonens KSK |
| DNSSEC Signature Expires In Days | Antall dager til den førstkommende RRSIG-signaturen utløper |
| DNSSEC Resolver Consensus (AD Flag) | Hver forespurte resolver returnerer AD-flagget (Authenticated Data) |
| DNSSEC Nameservers Are Consistent | Alle autoritative navneservere returnerer det samme SOA-serienummeret |
| DNSSEC Is Valid | Samlet bestått/ikke bestått på tvers av alle valideringskontroller |

### Filtertyper

For **DNSSEC Chain Is Valid**, **DNSSEC DNSKEY Record Exists**, **DNSSEC DS Record Exists At Parent**, **DNSSEC Resolver Consensus (AD Flag)**, **DNSSEC Nameservers Are Consistent** og **DNSSEC Is Valid**:

- **True** – Betingelsen er sann
- **False** – Betingelsen er usann

For **DNSSEC Signature Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

### Eksempelkriterier

#### Varsle hvis DNSSEC-kjeden er brutt

- **Sjekk på**: DNSSEC Chain Is Valid
- **Filtertype**: False

#### Varsle før signaturer utløper

- **Sjekk på**: DNSSEC Signature Expires In Days
- **Filtertype**: Less Than
- **Verdi**: 7

#### Fang opp manglende DS hos overordnet (delegering brutt)

- **Sjekk på**: DNSSEC DS Record Exists At Parent
- **Filtertype**: False

#### Oppdag resolveruenighet

- **Sjekk på**: DNSSEC Resolver Consensus (AD Flag)
- **Filtertype**: False

#### Fang opp delte navneservere

- **Sjekk på**: DNSSEC Nameservers Are Consistent
- **Filtertype**: False

## Beste praksis

1. **Bruk flere offentlige resolvere** – Bruk som standard `1.1.1.1`, `8.8.8.8` og `9.9.9.9` slik at et avbrudd hos én enkelt resolver ikke forårsaker falske positiver
2. **Varsle i god tid før utløp** – Konfigurer degraderte varsler ved 7 dager og offline-varsler ved 2 dager før signaturen utløper; nøkkelrulleringer kan feile uten varsel
3. **Overvåk hver signert sone** – Inkluder apex-domener, signerte underdomener og enhver sone som er delegert til en annen operatør
4. **Aktiver navneserverkonsistenskontroller** – Fanger opp synkroniseringsproblemer mellom primær/sekundær som DNSSEC-validering alene ville oversett, med mindre nettverket ditt blokkerer utgående DNS til vilkårlige IP-adresser
