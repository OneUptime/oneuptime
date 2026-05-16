# SNMP-monitor

SNMP (Simple Network Management Protocol)-övervakning gör det möjligt att övervaka nätverksenheter som switchar, routrar, brandväggar och annan nätverksinfrastruktur genom att fråga SNMP OID:er (Object Identifiers).

## Översikt

SNMP-monitorer frågar nätverksenheter efter specifik hanteringsinformation med OID:er. Detta gör det möjligt att:

- Övervaka enhetstillgänglighet och hälsa
- Spåra gränssnittsstatistik (trafik, fel, status)
- Övervaka systemmätvärden (CPU, minne, drifttid)
- Kontrollera anpassade leverantörsspecifika OID:er
- Ange varningar baserat på OID-värden

## Skapa en SNMP-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **SNMP** som monitortyp
4. Konfigurera SNMP-inställningarna som beskrivs nedan

## Konfigurationsalternativ

### Grundinställningar

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| SNMP-version | Protokollversion: v1, v2c eller v3 | Ja |
| Värdnamn/IP | Värdnamnet eller IP-adressen för SNMP-enheten | Ja |
| Port | SNMP-port (standard: 161) | Ja |

### Autentisering

#### SNMP v1/v2c

För SNMP v1 och v2c behöver du bara ange en community string:

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| Community string | SNMP community string (t.ex. "public") | Ja |

#### SNMP v3

SNMPv3 ger förbättrad säkerhet med autentisering och kryptering:

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| Säkerhetsnivå | noAuthNoPriv, authNoPriv eller authPriv | Ja |
| Användarnamn | SNMPv3-användarnamn | Ja |
| Autentiseringsprotokoll | MD5, SHA, SHA256 eller SHA512 | Om authNoPriv eller authPriv |
| Autentiseringsnyckel | Autentiseringslösenord | Om authNoPriv eller authPriv |
| Sekretessprotokoll | DES, AES eller AES256 | Om authPriv |
| Sekretessnyckel | Sekretess-/krypteringslösenord | Om authPriv |

### OID:er att övervaka

Lägg till de OID:er du vill fråga från enheten. För varje OID kan du ange:

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| OID | Den numeriska OID:en (t.ex. 1.3.6.1.2.1.1.1.0) | Ja |
| Namn | Ett läsvänligt namn för OID:en (t.ex. sysDescr) | Nej |
| Beskrivning | En beskrivning av vad denna OID representerar | Nej |

### Vanliga OID-mallar

OneUptime tillhandahåller mallar för vanligt övervakade OID:er:

#### System MIB

| OID | Namn | Beskrivning |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | Systembeskrivning |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | Systemdrifttid (i ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName | Systemnamn |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Systemplats |
| 1.3.6.1.2.1.1.4.0 | sysContact | Systemkontakt |

#### Interface MIB

| OID | Namn | Beskrivning |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Antal nätverksgränssnitt |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Gränssnittets driftstatus (X = gränssnittsindex) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Inkommande bytes (X = gränssnittsindex) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Utgående bytes (X = gränssnittsindex) |

#### Host Resources MIB

| OID | Namn | Beskrivning |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Värdsystemets drifttid |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Antal användare |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Antal körande processer |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | CPU-last (X = processorindex) |

### Avancerade inställningar

| Fält | Beskrivning | Standard |
|------|-------------|----------|
| Timeout | Hur länge man väntar på ett svar (ms) | 5000 |
| Återförsök | Antal återförsök vid fel | 3 |

## Övervakningskriterier

Du kan konfigurera kriterier för att kontrollera SNMP-svar och utlösa varningar eller incidenter.

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| SNMP-enhet är online | Kontrollera om enheten svarar på SNMP-frågor |
| SNMP-svarstid | Kontrollera svarstiden i millisekunder |
| SNMP OID-värde | Kontrollera värdet som returneras av en specifik OID |
| SNMP OID finns | Kontrollera om en OID returnerar ett värde (inte null) |

### Exempelkriterier

#### Kontrollera om enheten är online
- **Kontrollera på**: SNMP-enhet är online
- **Filtertyp**: Sant

#### Varna om svarstiden överstiger tröskeln
- **Kontrollera på**: SNMP-svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 1000

#### Kontrollera gränssnittsstatus
- **Kontrollera på**: SNMP OID-värde
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filtertyp**: Lika med
- **Värde**: 1 (1 = upp, 2 = ner)

## Använda monitorhemligheter

För säkerhet kan du lagra känslig information som community strings och SNMPv3-uppgifter som hemligheter.

### Lägga till en hemlighet

1. Gå till **Projektinställningar** -> **Monitorhemligheter** -> **Skapa monitorhemlighet**
2. Lägg till din hemlighet (t.ex. community string eller SNMPv3-lösenord)
3. Välj de SNMP-monitorer som ska ha åtkomst till denna hemlighet

### Använda hemligheter i SNMP-konfiguration

Använd syntaxen `{{monitorSecrets.SECRET_NAME}}` i valfritt känsligt fält:

- **Community string**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3-autentiseringsnyckel**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3-sekretessnyckel**: `{{monitorSecrets.SnmpPrivKey}}`

## Mallvariabler för varningar

När du skapar incident- eller varningsmallar kan du använda följande variabler:

| Variabel | Beskrivning |
|----------|-------------|
| `{{isOnline}}` | Om enheten är online (sant/falskt) |
| `{{responseTimeInMs}}` | Frågans svarstid i millisekunder |
| `{{failureCause}}` | Felmeddelande om frågan misslyckades |
| `{{oidResponses}}` | Array med OID-svarsobjekt |
| `{{OID_NAME}}` | Värdet av en specifik OID efter namn (t.ex. `{{sysUpTime}}`) |

## Felsökning

### Vanliga problem

#### Enheten svarar inte
- Verifiera att enhetens IP/värdnamn är korrekt
- Kontrollera att SNMP är aktiverat på enheten
- Verifiera att brandväggsregler tillåter UDP-port 161
- Bekräfta att community string är korrekt

#### Autentiseringsfel (v3)
- Verifiera användarnamn, autentiseringsprotokoll och autentiseringsnyckel
- Se till att säkerhetsnivån matchar enhetens konfiguration
- Kontrollera att sekretessprotokoll och -nyckel är korrekta för authPriv-nivå

#### OID hittades inte
- Verifiera att OID:en stöds av din enhet
- Kontrollera om OID:en kräver att en specifik MIB laddas
- Prova att fråga OID:en direkt med snmpget/snmpwalk-verktyg

### Testa SNMP-anslutning

Innan du konfigurerar övervakning kan du testa SNMP-anslutningen med kommandoradsverktyg:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Bästa praxis

1. **Använd SNMPv3 när möjligt** – Det ger autentisering och kryptering för bättre säkerhet
2. **Lagra uppgifter som hemligheter** – Hårdkoda aldrig community strings eller lösenord
3. **Övervaka bara viktiga OID:er** – Fråga bara det du behöver för att minska nätverksbelastningen
4. **Ange lämpliga timeout** – Nätverksenheter kan ha varierande svarstider
5. **Använd beskrivande OID-namn** – Gör det lättare att förstå varningsmeddelanden
6. **Testa innan driftsättning** – Verifiera SNMP-anslutning innan du skapar monitorer
