# DNS-monitor

DNS-övervakning gör det möjligt att övervaka hälsan och korrektheten hos DNS-upplösning för dina domäner. OneUptime frågar periodiskt DNS-poster och validerar svaren mot dina konfigurerade kriterier.

## Översikt

DNS-monitorer frågar DNS-servrar efter specifika posttyper och utvärderar resultaten. Detta gör det möjligt att:

- Övervaka tillgängligheten för DNS-tjänster
- Verifiera att DNS-poster returnerar korrekta värden
- Spåra svarstider för DNS-upplösning
- Validera DNSSEC-konfiguration
- Identifiera DNS-spridningsproblem eller kapning

## Skapa en DNS-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **DNS** som monitortyp
4. Ange domännamnet och posttypen att fråga
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Grundinställningar

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| Domännamn | Domänen att fråga (t.ex. `example.com`) | Ja |
| Posttyp | DNS-posttypen att fråga | Ja |
| DNS-server | Anpassad DNS-server att använda (t.ex. `8.8.8.8`). Lämna tomt för systemstandard | Nej |

### Posttyper som stöds

| Posttyp | Beskrivning |
|---------|-------------|
| A | IPv4-adressposter |
| AAAA | IPv6-adressposter |
| CNAME | Kanoniska namnposter (alias) |
| MX | Brevlådeserverörter |
| NS | Namnserverposter |
| TXT | Textposter (SPF, DKIM etc.) |
| SOA | Start of Authority-poster |
| PTR | Pekarposter (omvänd DNS) |
| SRV | Tjänstelokaliserarposter |
| CAA | Certificate Authority Authorization-poster |

### Avancerade inställningar

| Fält | Beskrivning | Standard |
|------|-------------|----------|
| Port | DNS-portnummer | 53 |
| Timeout (ms) | Hur länge man väntar på ett svar | 5000 |
| Återförsök | Antal återförsök vid fel | 3 |

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när ditt DNS anses vara online, degraderat eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| DNS är online | Om DNS-servern svarar på frågor |
| DNS-svarstid (i ms) | Svarstid i millisekunder |
| DNS-post finns | Om DNS-poster finns för frågan |
| DNS-postvärde | Värdet som returneras av en DNS-post |
| DNSSEC är giltig | Om DNSSEC-validering godkänns |

### Filtertyper

För **DNS är online**, **DNS-post finns** och **DNSSEC är giltig**:

- **Sant** – Villkoret är sant
- **Falskt** – Villkoret är falskt

För **DNS-svarstid**:

- **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med**, **Lika med**, **Inte lika med**

För **DNS-postvärde**:

- **Innehåller** – Postvärdet innehåller den angivna texten
- **Innehåller inte** – Postvärdet innehåller inte den angivna texten
- **Börjar med** – Postvärdet börjar med den angivna texten
- **Slutar med** – Postvärdet slutar med den angivna texten
- **Lika med** – Postvärdet matchar exakt
- **Inte lika med** – Postvärdet matchar inte

### Exempelkriterier

#### Kontrollera om DNS löser upp

- **Kontrollera på**: DNS är online
- **Filtertyp**: Sant

#### Verifiera att A-posten pekar på rätt IP

- **Kontrollera på**: DNS-postvärde
- **Filtertyp**: Lika med
- **Värde**: `93.184.216.34`

#### Varna om DNS-svaret är långsamt

- **Kontrollera på**: DNS-svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 500

#### Verifiera att DNSSEC är giltig

- **Kontrollera på**: DNSSEC är giltig
- **Filtertyp**: Sant
