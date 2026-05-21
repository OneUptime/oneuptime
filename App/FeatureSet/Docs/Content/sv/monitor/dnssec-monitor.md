# DNSSEC-monitor

DNSSEC-övervakning gör det möjligt att validera den kryptografiska integriteten hos DNS-svar för dina zoner. OneUptime utför periodiskt fullständig DNSSEC-validering — kontroll av DNSKEY-poster, DS-delegering vid den överordnade zonen, giltighet hos RRSIG-signaturer, resolverkonsensus om AD-flaggan och konsekvens mellan auktoritativa namnservrar.

## Översikt

DNSSEC-monitorer validerar hela förtroendekedjan från rotzonen ner till din domän. Detta gör det möjligt att:

- Upptäcka brutna DNSSEC-kedjor innan resolvrar börjar returnera SERVFAIL till dina användare
- Bli varnad innan zonsigneringsnycklar löper ut
- Verifiera att dina DS-poster är korrekt publicerade vid den överordnade zonen
- Identifiera avvikelser mellan auktoritativa namnservrar (primär/sekundär ur synk)
- Bekräfta att validerande resolvrar faktiskt sätter AD-flaggan för din zon

## Skapa en DNSSEC-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **DNSSEC** som monitortyp
4. Ange den zon (domän) du vill validera
5. Konfigurera resolvrar och övervakningskriterier efter behov

## Konfigurationsalternativ

### Grundinställningar

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| Zon (domännamn) | Zonen att validera via DNSSEC (t.ex. `example.com`) | Ja |
| Resolvrar | Kommaseparerad lista över validerande resolvrar att fråga (t.ex. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Ja |
| Kontrollera namnserverkonsekvens | Frågar varje auktoritativ namnserver direkt och verifierar att de returnerar samma SOA-serienummer | Nej |

### Avancerade inställningar

| Fält | Beskrivning | Standard |
|------|-------------|----------|
| Varning om signaturutgång (dagar) | Standardtröskel för RRSIG-utgångsfiltret | 7 |
| Timeout (ms) | Hur länge man väntar på varje DNS-fråga | 10000 |
| Återförsök | Antal återförsök vid fel | 3 |

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din zon anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| DNSSEC-kedjan är giltig | Hela valideringskedjan (root → TLD → zon) löses korrekt |
| DNSSEC DNSKEY-post finns | Zonen publicerar minst en DNSKEY-post |
| DNSSEC DS-post finns hos överordnad | Den överordnade zonen publicerar en DS-post som matchar zonens KSK |
| DNSSEC-signatur löper ut om dagar | Antal dagar tills den närmast utgående RRSIG-signaturen löper ut |
| DNSSEC-resolverkonsensus (AD-flagga) | Varje förfrågad resolver returnerar AD-flaggan (Authenticated Data) |
| DNSSEC-namnservrar är konsekventa | Alla auktoritativa namnservrar returnerar samma SOA-serienummer |
| DNSSEC är giltig | Samlat godkänt/underkänt över alla valideringskontroller |

### Filtertyper

För **DNSSEC-kedjan är giltig**, **DNSSEC DNSKEY-post finns**, **DNSSEC DS-post finns hos överordnad**, **DNSSEC-resolverkonsensus (AD-flagga)**, **DNSSEC-namnservrar är konsekventa** och **DNSSEC är giltig**:

- **Sant** – Villkoret är sant
- **Falskt** – Villkoret är falskt

För **DNSSEC-signatur löper ut om dagar**:

- **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med**, **Lika med**, **Inte lika med**

### Exempelkriterier

#### Varna om DNSSEC-kedjan är bruten

- **Kontrollera på**: DNSSEC-kedjan är giltig
- **Filtertyp**: Falskt

#### Varna innan signaturer löper ut

- **Kontrollera på**: DNSSEC-signatur löper ut om dagar
- **Filtertyp**: Mindre än
- **Värde**: 7

#### Fånga upp saknad DS hos överordnad (delegering bruten)

- **Kontrollera på**: DNSSEC DS-post finns hos överordnad
- **Filtertyp**: Falskt

#### Upptäck resolveroenighet

- **Kontrollera på**: DNSSEC-resolverkonsensus (AD-flagga)
- **Filtertyp**: Falskt

#### Fånga upp delade namnservrar

- **Kontrollera på**: DNSSEC-namnservrar är konsekventa
- **Filtertyp**: Falskt

## Bästa praxis

1. **Använd flera publika resolvrar** – Använd som standard `1.1.1.1`, `8.8.8.8` och `9.9.9.9` så att ett avbrott hos en enskild resolver inte orsakar falska larm
2. **Varna i god tid före utgång** – Konfigurera degraderade larm vid 7 dagar och offline-larm vid 2 dagar före signaturens utgång; nyckelrullningar kan misslyckas i tysthet
3. **Övervaka varje signerad zon** – Inkludera apex-domäner, signerade underdomäner och varje zon som delegerats till en annan operatör
4. **Aktivera namnserverkonsekvenskontroller** – Fångar upp synkproblem mellan primär/sekundär som enbart DNSSEC-validering skulle missa, om inte ditt nätverk blockerar utgående DNS till godtyckliga IP-adresser
