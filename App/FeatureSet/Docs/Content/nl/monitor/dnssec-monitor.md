# DNSSEC Monitor

Met DNSSEC-monitoring kunt u de cryptografische integriteit van DNS-antwoorden voor uw zones valideren. OneUptime voert periodiek volledige DNSSEC-validatie uit — controle van DNSKEY-records, DS-delegatie bij de bovenliggende zone, geldigheid van RRSIG-handtekeningen, consensus van resolvers over de AD-vlag en consistentie tussen autoritatieve naamservers.

## Overzicht

DNSSEC-monitors valideren de volledige vertrouwensketen vanaf de rootzone tot aan uw domein. Hiermee kunt u:

- Defecte DNSSEC-ketens detecteren voordat resolvers SERVFAIL aan uw gebruikers gaan retourneren
- Gewaarschuwd worden voordat zone-signing keys verlopen
- Verifiëren dat uw DS-records correct gepubliceerd zijn bij de bovenliggende zone
- Afwijkingen tussen autoritatieve naamservers opvangen (primary/secondary niet synchroon)
- Bevestigen dat valideren­de resolvers daadwerkelijk de AD-vlag instellen voor uw zone

## Een DNSSEC Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **DNSSEC** als het monitortype
4. Voer de zone (domein) in die u wilt valideren
5. Configureer resolvers en monitoringcriteria naar wens

## Configuratie-opties

### Basisinstellingen

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| Zone (domeinnaam) | De zone om via DNSSEC te valideren (bijv. `example.com`) | Ja |
| Resolvers | Door komma's gescheiden lijst van valideren­de resolvers om te bevragen (bijv. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Ja |
| Controleer naamserverconsistentie | Bevraagt elke autoritatieve naamserver rechtstreeks en verifieert dat zij hetzelfde SOA-serienummer retourneren | Nee |

### Geavanceerde instellingen

| Veld | Beschrijving | Standaard |
|-------|-------------|---------|
| Waarschuwing handtekeningverloop (dagen) | Standaarddrempel voor het RRSIG-vervalfilter | 7 |
| Time-out (ms) | Hoe lang te wachten op elke DNS-opvraag | 10000 |
| Nieuwe pogingen | Aantal nieuwe pogingen bij mislukking | 3 |

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw zone als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| DNSSEC-keten is geldig | De volledige validatieketen (root → TLD → zone) wordt correct opgelost |
| DNSSEC DNSKEY-record bestaat | De zone publiceert ten minste één DNSKEY-record |
| DNSSEC DS-record bestaat bij bovenliggende zone | De bovenliggende zone publiceert een DS-record dat overeenkomt met de KSK van de zone |
| DNSSEC handtekening verloopt over dagen | Aantal dagen tot de eerstvolgende RRSIG-handtekening verloopt |
| DNSSEC-resolverconsensus (AD-vlag) | Elke bevraagde resolver retourneert de AD-vlag (Authenticated Data) |
| DNSSEC-naamservers zijn consistent | Alle autoritatieve naamservers retourneren hetzelfde SOA-serienummer |
| DNSSEC is geldig | Aggregaat geslaagd/mislukt over alle validatiecontroles |

### Filtertypen

Voor **DNSSEC-keten is geldig**, **DNSSEC DNSKEY-record bestaat**, **DNSSEC DS-record bestaat bij bovenliggende zone**, **DNSSEC-resolverconsensus (AD-vlag)**, **DNSSEC-naamservers zijn consistent** en **DNSSEC is geldig**:

- **True** — Voorwaarde is waar
- **False** — Voorwaarde is onwaar

Voor **DNSSEC handtekening verloopt over dagen**:

- **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan**, **Gelijk aan**, **Niet gelijk aan**

### Voorbeeldcriteria

#### Melding als de DNSSEC-keten defect is

- **Controleer op**: DNSSEC-keten is geldig
- **Filtertype**: False

#### Waarschuwen voordat handtekeningen verlopen

- **Controleer op**: DNSSEC handtekening verloopt over dagen
- **Filtertype**: Kleiner dan
- **Waarde**: 7

#### Ontbrekend DS bij bovenliggende zone opvangen (delegatie defect)

- **Controleer op**: DNSSEC DS-record bestaat bij bovenliggende zone
- **Filtertype**: False

#### Resolverafwijking detecteren

- **Controleer op**: DNSSEC-resolverconsensus (AD-vlag)
- **Filtertype**: False

#### Naamserver-splitsing opvangen

- **Controleer op**: DNSSEC-naamservers zijn consistent
- **Filtertype**: False

## Best practices

1. **Gebruik meerdere publieke resolvers** — Standaard `1.1.1.1`, `8.8.8.8` en `9.9.9.9` zodat een uitval van één resolver geen vals-positieve meldingen veroorzaakt
2. **Waarschuw ruim voor verloop** — Configureer degraded-meldingen op 7 dagen en offline-meldingen op 2 dagen voor het verlopen van de handtekening; key rollovers kunnen geruisloos mislukken
3. **Bewaak elke ondertekende zone** — Neem apex-domeinen, ondertekende subdomeinen en elke zone die aan een andere operator is gedelegeerd op
4. **Schakel naamserverconsistentiecontroles in** — Vangt synchronisatieproblemen tussen primary/secondary op die alleen DNSSEC-validatie zou missen, tenzij uw netwerk uitgaand DNS naar willekeurige IP's blokkeert
