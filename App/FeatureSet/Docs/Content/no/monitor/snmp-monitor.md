# SNMP-monitor

SNMP (Simple Network Management Protocol)-overvåking lar deg overvåke nettverksenheter som svitsjer, rutere, brannmurer og annen nettverksinfrastruktur ved å spørre SNMP OID-er (Object Identifiers).

## Oversikt

SNMP-monitorer spør nettverksenheter etter spesifikk administrasjonsinformasjon ved hjelp av OID-er. Dette gjør det mulig å:

- Overvåke enhetstilgjengelighet og helse
- Spore grensesnittstatistikk (trafikk, feil, status)
- Overvåke systemmålinger (CPU, minne, oppetid)
- Sjekke leverandørspesifikke egendefinerte OID-er
- Sette opp varsler basert på OID-verdier

## Opprette en SNMP-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **SNMP** som monitortype
4. Konfigurer SNMP-innstillingene som beskrevet nedenfor

## Konfigurasjonsalternativer

### Grunnleggende innstillinger

| Felt         | Beskrivelse                                    | Påkrevd |
| ------------ | ---------------------------------------------- | ------- |
| SNMP Version | Protokollversjon: v1, v2c eller v3             | Ja      |
| Hostname/IP  | Vertsnavnet eller IP-adressen til SNMP-enheten | Ja      |
| Port         | SNMP-port (standard: 161)                      | Ja      |

### Autentisering

#### SNMP v1/v2c

For SNMP v1 og v2c trenger du bare å oppgi en community-streng:

| Felt             | Beskrivelse                               | Påkrevd |
| ---------------- | ----------------------------------------- | ------- |
| Community String | SNMP-community-strengen (f.eks. "public") | Ja      |

#### SNMP v3

SNMPv3 gir forbedret sikkerhet med autentisering og kryptering:

| Felt           | Beskrivelse                             | Påkrevd                        |
| -------------- | --------------------------------------- | ------------------------------ |
| Security Level | noAuthNoPriv, authNoPriv eller authPriv | Ja                             |
| Username       | SNMPv3-brukernavn                       | Ja                             |
| Auth Protocol  | MD5, SHA, SHA256 eller SHA512           | Hvis authNoPriv eller authPriv |
| Auth Key       | Autentiseringspassord                   | Hvis authNoPriv eller authPriv |
| Priv Protocol  | DES, AES eller AES256                   | Hvis authPriv                  |
| Priv Key       | Personverns-/krypteringspassord         | Hvis authPriv                  |

### OID-er som skal overvåkes

Legg til OID-ene du ønsker å spørre fra enheten. For hver OID kan du angi:

| Felt        | Beskrivelse                                      | Påkrevd |
| ----------- | ------------------------------------------------ | ------- |
| OID         | Den numeriske OID-en (f.eks. 1.3.6.1.2.1.1.1.0)  | Ja      |
| Name        | Et vennlig navn for OID-en (f.eks. sysDescr)     | Nei     |
| Description | En beskrivelse av hva denne OID-en representerer | Nei     |

### Vanlige OID-maler

OneUptime tilbyr maler for ofte overvåkede OID-er:

#### System MIB

| OID               | Navn        | Beskrivelse             |
| ----------------- | ----------- | ----------------------- |
| 1.3.6.1.2.1.1.1.0 | sysDescr    | Systembeskrivelse       |
| 1.3.6.1.2.1.1.3.0 | sysUpTime   | Systemoppetid (i ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName     | Systemnavn              |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Systemlokasjon          |
| 1.3.6.1.2.1.1.4.0 | sysContact  | Systemkontakt           |

#### Interface MIB

| OID                    | Navn         | Beskrivelse                                                 |
| ---------------------- | ------------ | ----------------------------------------------------------- |
| 1.3.6.1.2.1.2.1.0      | ifNumber     | Antall nettverksgrensesnitt                                 |
| 1.3.6.1.2.1.2.2.1.8.X  | ifOperStatus | Operasjonell status for grensesnitt (X = grensesnittindeks) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets   | Innkommende byte (X = grensesnittindeks)                    |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets  | Utgående byte (X = grensesnittindeks)                       |

#### Host Resources MIB

| OID                      | Navn              | Beskrivelse                          |
| ------------------------ | ----------------- | ------------------------------------ |
| 1.3.6.1.2.1.25.1.1.0     | hrSystemUptime    | Vertsystemoppetid                    |
| 1.3.6.1.2.1.25.1.5.0     | hrSystemNumUsers  | Antall brukere                       |
| 1.3.6.1.2.1.25.1.6.0     | hrSystemProcesses | Antall kjørende prosesser            |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad   | CPU-belastning (X = prosessorindeks) |

### Avanserte innstillinger

| Felt    | Beskrivelse                        | Standard |
| ------- | ---------------------------------- | -------- |
| Timeout | Hvor lenge det ventes på svar (ms) | 5000     |
| Retries | Antall nye forsøk ved feil         | 3        |

## Overvåkingskriterier

Du kan sette opp kriterier for å sjekke SNMP-svar og utløse varsler eller hendelser.

### Tilgjengelige kontrolltyper

| Kontrolltype          | Beskrivelse                                     |
| --------------------- | ----------------------------------------------- |
| SNMP Device Is Online | Sjekk om enheten svarer på SNMP-spørringer      |
| SNMP Response Time    | Sjekk spørringens svartid i millisekunder       |
| SNMP OID Value        | Sjekk verdien returnert av en spesifikk OID     |
| SNMP OID Exists       | Sjekk om en OID returnerer en verdi (ikke null) |

### Eksempelkriterier

#### Sjekk om enheten er tilgjengelig

- **Sjekk på**: SNMP Device Is Online
- **Filtertype**: True

#### Varsle hvis svartid overskrider terskel

- **Sjekk på**: SNMP Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 1000

#### Sjekk grensesnittstatus

- **Sjekk på**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filtertype**: Equal To
- **Verdi**: 1 (1 = opp, 2 = ned)

#### Sjekk CPU-belastningsterskel

- **Sjekk på**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filtertype**: Greater Than
- **Verdi**: 80

## Bruke Monitor Secrets

Av sikkerhetshensyn kan du lagre sensitiv informasjon som community-strenger og SNMPv3-legitimasjon som hemmeligheter.

### Legge til en hemmelighet

1. Gå til **Project Settings** -> **Monitor Secrets** -> **Create Monitor Secret**
2. Legg til hemmeligheten din (f.eks. community-streng eller SNMPv3-passord)
3. Velg SNMP-monitorene som skal ha tilgang til denne hemmeligheten

### Bruke hemmeligheter i SNMP-konfigurasjon

Bruk `{{monitorSecrets.SECRET_NAME}}`-syntaksen i ethvert sensitivt felt:

- **Community String**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth Key**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv Key**: `{{monitorSecrets.SnmpPrivKey}}`

## Malvariabler for varsler

Når du oppretter hendelse- eller varselsmaler, kan du bruke følgende variabler:

| Variabel               | Beskrivelse                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `{{isOnline}}`         | Om enheten er tilgjengelig (true/false)                          |
| `{{responseTimeInMs}}` | Spørringens svartid i millisekunder                              |
| `{{failureCause}}`     | Feilmelding hvis spørringen mislyktes                            |
| `{{oidResponses}}`     | Array med OID-responsobjekter                                    |
| `{{OID_NAME}}`         | Verdien til en spesifikk OID etter navn (f.eks. `{{sysUpTime}}`) |

## Feilsøking

### Vanlige problemer

#### Enheten svarer ikke

- Verifiser at enhetens IP/vertsnavn er korrekt
- Sjekk at SNMP er aktivert på enheten
- Verifiser at brannmurregler tillater UDP-port 161
- Bekreft at community-strengen er korrekt

#### Autentiseringsfeil (v3)

- Verifiser brukernavn, autentiseringsprotokoll og autentiseringsnøkkel
- Sørg for at sikkerhetsnivået samsvarer med enhetskonfigurasjonen
- Sjekk at priv-protokoll og -nøkkel er korrekte for authPriv-nivå

#### OID ikke funnet

- Verifiser at OID-en støttes av enheten din
- Sjekk om OID-en krever at en spesifikk MIB lastes
- Prøv å spørre OID-en direkte ved hjelp av snmpget/snmpwalk-verktøy

### Teste SNMP-tilkobling

Før du setter opp overvåking, kan du teste SNMP-tilkobling ved hjelp av kommandolinjeverktøy:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Beste praksis

1. **Bruk SNMPv3 der det er mulig** – Det gir autentisering og kryptering for bedre sikkerhet
2. **Lagre legitimasjon som hemmeligheter** – Hardkod aldri community-strenger eller passord
3. **Overvåk bare nødvendige OID-er** – Spør bare det du trenger for å redusere nettverksoverhead
4. **Sett passende tidsavbrudd** – Nettverksenheter kan ha varierende svartider
5. **Bruk beskrivende OID-navn** – Gjør det enklere å forstå varselmeldinger
6. **Test før distribusjon** – Verifiser SNMP-tilkobling før du oppretter monitorer
