# SNMP Monitor

SNMP-monitoring (Simple Network Management Protocol) stelt u in staat netwerkapparaten zoals switches, routers, firewalls en andere netwerkinfrastructuur te bewaken door SNMP OID's (Object Identifiers) te bevragen.

## Overzicht

SNMP-monitors bevragen netwerkapparaten op specifieke beheers informatie via OID's. Hiermee kunt u:

- Beschikbaarheid en gezondheid van apparaten bewaken
- Interfacestatistieken bijhouden (verkeer, fouten, status)
- Systeemmetrics bewaken (CPU, geheugen, uptime)
- Aangepaste leverancierspecifieke OID's controleren
- Meldingen instellen op basis van OID-waarden

## Een SNMP Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **SNMP** als het monitortype
4. Configureer de SNMP-instellingen zoals hieronder beschreven

## Configuratie-opties

### Basisinstellingen

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| SNMP-versie | Protocolversie: v1, v2c of v3 | Ja |
| Hostnaam/IP | De hostnaam of het IP-adres van het SNMP-apparaat | Ja |
| Poort | SNMP-poort (standaard: 161) | Ja |

### Authenticatie

#### SNMP v1/v2c

Voor SNMP v1 en v2c hoeft u alleen een communitystring op te geven:

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| Communitystring | De SNMP-communitystring (bijv. "public") | Ja |

#### SNMP v3

SNMPv3 biedt verbeterde beveiliging met authenticatie en versleuteling:

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| Beveiligingsniveau | noAuthNoPriv, authNoPriv of authPriv | Ja |
| Gebruikersnaam | SNMPv3-gebruikersnaam | Ja |
| Auth-protocol | MD5, SHA, SHA256 of SHA512 | Als authNoPriv of authPriv |
| Auth-sleutel | Authenticatiewachtwoord | Als authNoPriv of authPriv |
| Priv-protocol | DES, AES of AES256 | Als authPriv |
| Priv-sleutel | Privacy-/versleutelingswachtwoord | Als authPriv |

### Te bewaken OID's

Voeg de OID's toe die u van het apparaat wilt bevragen. Voor elke OID kunt u opgeven:

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| OID | De numerieke OID (bijv. 1.3.6.1.2.1.1.1.0) | Ja |
| Naam | Een beschrijvende naam voor de OID (bijv. sysDescr) | Nee |
| Beschrijving | Een omschrijving van wat deze OID vertegenwoordigt | Nee |

### Veelgebruikte OID-sjablonen

OneUptime biedt sjablonen voor veelgebruikte OID's:

#### Systeem MIB

| OID | Naam | Beschrijving |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | Systeembeschrijving |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | Systeem-uptime (in ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName | Systeemnaam |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Systeemlocatie |
| 1.3.6.1.2.1.1.4.0 | sysContact | Systeemcontact |

#### Interface MIB

| OID | Naam | Beschrijving |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Aantal netwerkinterfaces |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Operationele interfacestatus (X = interface-index) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Inkomende bytes (X = interface-index) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Uitgaande bytes (X = interface-index) |

#### Host Resources MIB

| OID | Naam | Beschrijving |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Host-systeem-uptime |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Aantal gebruikers |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Aantal actieve processen |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | CPU-belasting (X = processorindex) |

### Geavanceerde instellingen

| Veld | Beschrijving | Standaard |
|-------|-------------|---------|
| Time-out | Hoe lang te wachten op een antwoord (ms) | 5000 |
| Nieuwe pogingen | Aantal nieuwe pogingen bij mislukking | 3 |

## Monitoringcriteria

U kunt criteria instellen om SNMP-antwoorden te controleren en meldingen of incidenten te activeren.

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| SNMP-apparaat is online | Controleer of het apparaat reageert op SNMP-opvragen |
| SNMP-responstijd | Controleer de opvraagresponstijd in milliseconden |
| SNMP OID-waarde | Controleer de waarde die door een specifieke OID wordt geretourneerd |
| SNMP OID bestaat | Controleer of een OID een waarde retourneert (niet null) |

### Voorbeeldcriteria

#### Controleer of apparaat online is
- **Controleer op**: SNMP-apparaat is online
- **Filtertype**: True

#### Melding als responstijd drempelwaarde overschrijdt
- **Controleer op**: SNMP-responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 1000

#### Controleer interfacestatus
- **Controleer op**: SNMP OID-waarde
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filtertype**: Gelijk aan
- **Waarde**: 1 (1 = actief, 2 = inactief)

#### Controleer CPU-belastingsdrempelwaarde
- **Controleer op**: SNMP OID-waarde
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filtertype**: Groter dan
- **Waarde**: 80

## Monitor Secrets gebruiken

Voor beveiliging kunt u gevoelige informatie zoals communitystrings en SNMPv3-inloggegevens als secrets opslaan.

### Een secret toevoegen

1. Ga naar **Projectinstellingen** -> **Monitor Secrets** -> **Monitor Secret aanmaken**
2. Voeg uw secret toe (bijv. communitystring of SNMPv3-wachtwoord)
3. Selecteer de SNMP-monitors die toegang moeten hebben tot dit secret

### Secrets gebruiken in SNMP-configuratie

Gebruik de syntaxis `{{monitorSecrets.SECRET_NAME}}` in elk gevoelig veld:

- **Communitystring**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth-sleutel**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv-sleutel**: `{{monitorSecrets.SnmpPrivKey}}`

## Sjabloonvariabelen voor meldingen

Bij het aanmaken van incident- of meldingssjablonen kunt u de volgende variabelen gebruiken:

| Variabele | Beschrijving |
|----------|-------------|
| `{{isOnline}}` | Of het apparaat online is (true/false) |
| `{{responseTimeInMs}}` | Opvraagresponstijd in milliseconden |
| `{{failureCause}}` | Foutbericht als de opvraag mislukte |
| `{{oidResponses}}` | Array van OID-responsobijecten |
| `{{OID_NAME}}` | Waarde van een specifieke OID op naam (bijv. `{{sysUpTime}}`) |

## Probleemoplossing

### Veelgebruikte problemen

#### Apparaat reageert niet
- Controleer of het IP/hostnaam van het apparaat correct is
- Controleer of SNMP is ingeschakeld op het apparaat
- Controleer of firewallregels UDP-poort 161 toestaan
- Bevestig dat de communitystring correct is

#### Authenticatiefouten (v3)
- Controleer de gebruikersnaam, het auth-protocol en de auth-sleutel
- Zorg dat het beveiligingsniveau overeenkomt met de apparaatconfiguratie
- Controleer of het priv-protocol en de sleutel correct zijn voor het authPriv-niveau

#### OID niet gevonden
- Controleer of de OID wordt ondersteund door uw apparaat
- Controleer of de OID een specifieke MIB vereist om geladen te worden
- Probeer de OID rechtstreeks te bevragen met snmpget/snmpwalk-tools

### SNMP-connectiviteit testen

Voordat u monitoring instelt, kunt u de SNMP-connectiviteit testen met opdrachtregelhulpmiddelen:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Best practices

1. **Gebruik SNMPv3 waar mogelijk** — Het biedt authenticatie en versleuteling voor betere beveiliging
2. **Sla inloggegevens op als secrets** — Codeer communitystrings of wachtwoorden nooit hard
3. **Bewaken alleen essentiële OID's** — Bevraag alleen wat u nodig heeft om netwerkoverlast te verminderen
4. **Stel passende time-outs in** — Netwerkapparaten kunnen wisselende responstijden hebben
5. **Gebruik beschrijvende OID-namen** — Maakt het gemakkelijker om meldingsberichten te begrijpen
6. **Test voor implementatie** — Controleer de SNMP-connectiviteit voordat u monitors aanmaakt
