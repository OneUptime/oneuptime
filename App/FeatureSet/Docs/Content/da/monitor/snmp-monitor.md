# SNMP Monitor

SNMP (Simple Network Management Protocol)-overvågning giver dig mulighed for at overvåge netværksenheder som switches, routere, firewalls og anden netværksinfrastruktur ved at forespørge SNMP OID'er (Object Identifiers).

## Oversigt

SNMP-monitorer forespørger netværksenheder efter specifik styringsoplysninger ved hjælp af OID'er. Dette giver dig mulighed for at:

- Overvåge enhedstilgængelighed og -sundhed
- Spore grænsefladestatistikker (trafik, fejl, status)
- Overvåge systemmetrikker (CPU, hukommelse, oppetid)
- Kontrollere brugerdefinerede leverandørspecifikke OID'er
- Sætte advarsler baseret på OID-værdier

## Oprettelse af en SNMP Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **SNMP** som monitortype
4. Konfigurer SNMP-indstillingerne som beskrevet nedenfor

## Konfigurationsindstillinger

### Grundlæggende indstillinger

| Felt | Beskrivelse | Påkrævet |
|-------|-------------|----------|
| SNMP-version | Protokolversion: v1, v2c eller v3 | Ja |
| Hostnavn/IP | Hostnavnet eller IP-adressen på SNMP-enheden | Ja |
| Port | SNMP-port (standard: 161) | Ja |

### Autentificering

#### SNMP v1/v2c

Til SNMP v1 og v2c behøver du kun at angive en community-streng:

| Felt | Beskrivelse | Påkrævet |
|-------|-------------|----------|
| Community-streng | SNMP community-strengen (f.eks. "public") | Ja |

#### SNMP v3

SNMPv3 leverer forbedret sikkerhed med autentificering og kryptering:

| Felt | Beskrivelse | Påkrævet |
|-------|-------------|----------|
| Sikkerhedsniveau | noAuthNoPriv, authNoPriv eller authPriv | Ja |
| Brugernavn | SNMPv3-brugernavn | Ja |
| Auth-protokol | MD5, SHA, SHA256 eller SHA512 | Hvis authNoPriv eller authPriv |
| Auth-nøgle | Autentificeringsadgangskode | Hvis authNoPriv eller authPriv |
| Priv-protokol | DES, AES eller AES256 | Hvis authPriv |
| Priv-nøgle | Privatliv/krypteringsadgangskode | Hvis authPriv |

### OID'er der skal overvåges

Tilføj de OID'er, du vil forespørge fra enheden. For hver OID kan du angive:

| Felt | Beskrivelse | Påkrævet |
|-------|-------------|----------|
| OID | Den numeriske OID (f.eks. 1.3.6.1.2.1.1.1.0) | Ja |
| Navn | Et brugervenligt navn til OID'en (f.eks. sysDescr) | Nej |
| Beskrivelse | En beskrivelse af, hvad denne OID repræsenterer | Nej |

### Almindelige OID-skabeloner

OneUptime leverer skabeloner til almindeligt overvågede OID'er:

#### System MIB

| OID | Navn | Beskrivelse |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | Systembeskrivelse |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | Systemoppetid (i ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName | Systemnavn |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Systemplacering |
| 1.3.6.1.2.1.1.4.0 | sysContact | Systemkontakt |

#### Interface MIB

| OID | Navn | Beskrivelse |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Antal netværksgrænseflader |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Grænsefladeoperationsstatus (X = grænsefladeindeks) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Inputbytes (X = grænsefladeindeks) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Outputbytes (X = grænsefladeindeks) |

#### Host Resources MIB

| OID | Navn | Beskrivelse |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Host-systemoppetid |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Antal brugere |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Antal kørende processer |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | CPU-belastning (X = processorindeks) |

### Avancerede indstillinger

| Felt | Beskrivelse | Standard |
|-------|-------------|---------|
| Timeout | Tid at vente på et svar (ms) | 5000 |
| Genforsøg | Antal genforsøg ved fejl | 3 |

## Overvågningskriterier

Du kan opsætte kriterier til at kontrollere SNMP-svar og udløse advarsler eller incidents.

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| SNMP-enhed er online | Kontroller, om enheden svarer på SNMP-forespørgsler |
| SNMP-svartid | Kontroller forespørgselssvartiden i millisekunder |
| SNMP OID-værdi | Kontroller værdien returneret af en specifik OID |
| SNMP OID eksisterer | Kontroller, om en OID returnerer en værdi (ikke null) |

### Eksempelkriterier

#### Kontroller, om enheden er online
- **Kontroller på**: SNMP-enhed er online
- **Filtertype**: Sand

#### Advarsel, hvis svartid overskrider grænseværdi
- **Kontroller på**: SNMP-svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 1000

#### Kontroller grænsefladestatuss
- **Kontroller på**: SNMP OID-værdi
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filtertype**: Lig med
- **Værdi**: 1 (1 = op, 2 = ned)

#### Kontroller CPU-belastningsgrænseværdi
- **Kontroller på**: SNMP OID-værdi
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filtertype**: Større end
- **Værdi**: 80

## Brug af Monitor Secrets

Af sikkerhedshensyn kan du gemme følsomme oplysninger som community-strenge og SNMPv3-legitimationsoplysninger som hemmeligheder.

### Tilføjelse af en hemmelighed

1. Gå til **Projektindstillinger** -> **Monitor Secrets** -> **Opret Monitor Secret**
2. Tilføj din hemmelighed (f.eks. community-streng eller SNMPv3-adgangskode)
3. Vælg de SNMP-monitorer, der skal have adgang til denne hemmelighed

### Brug af hemmeligheder i SNMP-konfiguration

Brug syntaksen `{{monitorSecrets.SECRET_NAME}}` i ethvert følsomt felt:

- **Community-streng**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth-nøgle**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv-nøgle**: `{{monitorSecrets.SnmpPrivKey}}`

## Skabelonvariabler til advarsler

Når du opretter incident- eller advarselsskabeloner, kan du bruge følgende variabler:

| Variabel | Beskrivelse |
|----------|-------------|
| `{{isOnline}}` | Om enheden er online (sand/falsk) |
| `{{responseTimeInMs}}` | Forespørgselssvartid i millisekunder |
| `{{failureCause}}` | Fejlmeddelelse, hvis forespørgslen mislykkedes |
| `{{oidResponses}}` | Array af OID-svarobjekter |
| `{{OID_NAME}}` | Værdi af en specifik OID efter navn (f.eks. `{{sysUpTime}}`) |

## Fejlfinding

### Almindelige problemer

#### Enheden svarer ikke
- Bekræft, at enhedens IP/hostnavn er korrekt
- Kontroller, at SNMP er aktiveret på enheden
- Bekræft firewallregler, der tillader UDP-port 161
- Bekræft, at community-strengen er korrekt

#### Autentificeringsfejl (v3)
- Bekræft brugernavn, auth-protokol og auth-nøgle
- Sørg for, at sikkerhedsniveauet matcher enhedskonfigurationen
- Kontroller, at priv-protokol og -nøgle er korrekte til authPriv-niveau

#### OID ikke fundet
- Bekræft, at OID'en understøttes af din enhed
- Kontroller, om OID'en kræver, at en specifik MIB er indlæst
- Prøv at forespørge OID'en direkte ved hjælp af snmpget/snmpwalk-værktøjer

### Test af SNMP-forbindelsen

Inden du opsætter overvågning, kan du teste SNMP-forbindelsen ved hjælp af kommandolinjeværktøjer:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Bedste praksis

1. **Brug SNMPv3, når det er muligt** – Det leverer autentificering og kryptering for bedre sikkerhed
2. **Gem legitimationsoplysninger som hemmeligheder** – Hardkod aldrig community-strenge eller adgangskoder
3. **Overvåg kun essentielle OID'er** – Forespørg kun det nødvendige for at reducere netværksoverhead
4. **Sæt passende timeouts** – Netværksenheder kan have varierende svartider
5. **Brug beskrivende OID-navne** – Gør det lettere at forstå advarselsmeddelelser
6. **Test inden deployment** – Bekræft SNMP-forbindelsen inden du opretter monitorer
