# DNS Monitor

DNS-monitoring stelt u in staat de gezondheid en correctheid van DNS-omzetting voor uw domeinen te bewaken. OneUptime vraagt periodiek DNS-records op en valideert de antwoorden aan de hand van uw geconfigureerde criteria.

## Overzicht

DNS-monitors sturen opvragen naar DNS-servers voor specifieke recordtypen en evalueren de resultaten. Hiermee kunt u:

- Beschikbaarheid van DNS-service bewaken
- Verifiëren dat DNS-records de juiste waarden retourneren
- Responstijden voor DNS-omzetting bijhouden
- DNSSEC-configuratie valideren
- DNS-propagatieproblemen of -kaping detecteren

## Een DNS Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **DNS** als het monitortype
4. Voer de domeinnaam en het te bevragen recordtype in
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Basisinstellingen

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| Domeinnaam | Het te bevragen domein (bijv. `example.com`) | Ja |
| Recordtype | Het te bevragen DNS-recordtype | Ja |
| DNS-server | Aangepaste te gebruiken DNS-server (bijv. `8.8.8.8`). Leeg laten voor systeemstandaard | Nee |

### Ondersteunde recordtypen

| Recordtype | Beschrijving |
|-------------|-------------|
| A | IPv4-adresrecords |
| AAAA | IPv6-adresrecords |
| CNAME | Canonieke naam (alias) records |
| MX | Mail exchange records |
| NS | Naamserverrecords |
| TXT | Tekstrecords (SPF, DKIM, enz.) |
| SOA | Start of Authority records |
| PTR | Aanwijzerrecords (omgekeerde DNS) |
| SRV | Service locator records |
| CAA | Certificate Authority Authorization records |

### Geavanceerde instellingen

| Veld | Beschrijving | Standaard |
|-------|-------------|---------|
| Poort | DNS-poortnummer | 53 |
| Time-out (ms) | Hoe lang te wachten op een antwoord | 5000 |
| Nieuwe pogingen | Aantal nieuwe pogingen bij mislukking | 3 |

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw DNS als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| DNS is online | Of de DNS-server reageert op opvragen |
| DNS-responstijd (in ms) | Opvraagresponstijd in milliseconden |
| DNS-record bestaat | Of DNS-records bestaan voor de opvraag |
| DNS-recordwaarde | De waarde die door een DNS-record wordt geretourneerd |
| DNSSEC is geldig | Of DNSSEC-validatie slaagt |

### Filtertypen

Voor **DNS is online**, **DNS-record bestaat** en **DNSSEC is geldig**:

- **True** — Voorwaarde is waar
- **False** — Voorwaarde is onwaar

Voor **DNS-responstijd**:

- **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan**, **Gelijk aan**, **Niet gelijk aan**

Voor **DNS-recordwaarde**:

- **Bevat** — Recordwaarde bevat de opgegeven tekst
- **Bevat niet** — Recordwaarde bevat de opgegeven tekst niet
- **Begint met** — Recordwaarde begint met de opgegeven tekst
- **Eindigt met** — Recordwaarde eindigt met de opgegeven tekst
- **Gelijk aan** — Recordwaarde komt exact overeen
- **Niet gelijk aan** — Recordwaarde komt niet overeen

### Voorbeeldcriteria

#### Controleer of DNS omzet

- **Controleer op**: DNS is online
- **Filtertype**: True

#### Verifieer dat A-record naar het juiste IP-adres wijst

- **Controleer op**: DNS-recordwaarde
- **Filtertype**: Gelijk aan
- **Waarde**: `93.184.216.34`

#### Melding als DNS-response traag is

- **Controleer op**: DNS-responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 500

#### Verifieer dat DNSSEC geldig is

- **Controleer op**: DNSSEC is geldig
- **Filtertype**: True
