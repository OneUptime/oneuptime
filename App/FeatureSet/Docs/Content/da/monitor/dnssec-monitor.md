# DNSSEC Monitor

DNSSEC-overvågning giver dig mulighed for at validere den kryptografiske integritet af DNS-svar for dine zoner. OneUptime udfører periodisk fuld DNSSEC-validering — kontrol af DNSKEY-poster, DS-delegering ved den overordnede zone, gyldighed af RRSIG-signaturer, resolverkonsensus om AD-flaget og konsistens mellem autoritative navneservere.

## Oversigt

DNSSEC-monitorer validerer hele tillidskæden fra rodzonen ned til dit domæne. Dette giver dig mulighed for at:

- Opdage brudte DNSSEC-kæder, før resolvere begynder at returnere SERVFAIL til dine brugere
- Blive advaret, før zone-signing-nøgler udløber
- Bekræfte, at dine DS-poster er korrekt udgivet ved den overordnede zone
- Opfange afvigelser mellem autoritative navneservere (primær/sekundær ude af synkronisering)
- Bekræfte, at validerende resolvere faktisk sætter AD-flaget for din zone

## Oprettelse af en DNSSEC Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **DNSSEC** som monitortype
4. Indtast den zone (domæne), du vil validere
5. Konfigurer resolvere og overvågningskriterier efter behov

## Konfigurationsindstillinger

### Grundlæggende indstillinger

| Felt                             | Beskrivelse                                                                                                | Påkrævet |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| Zone (domænenavn)                | Zonen, der skal valideres via DNSSEC (f.eks. `example.com`)                                                | Ja       |
| Resolvere                        | Kommasepareret liste over validerende resolvere, der skal forespørges (f.eks. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Ja       |
| Kontroller navneserverkonsistens | Forespørger hver autoritativ navneserver direkte og bekræfter, at de returnerer det samme SOA-serienummer  | Nej      |

### Avancerede indstillinger

| Felt                             | Beskrivelse                              | Standard |
| -------------------------------- | ---------------------------------------- | -------- |
| Advarsel om signaturudløb (dage) | Standardtærskel for RRSIG-udløbsfilteret | 7        |
| Timeout (ms)                     | Tid at vente på hver DNS-forespørgsel    | 10000    |
| Genforsøg                        | Antal genforsøg ved fejl                 | 3        |

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din zone betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype                              | Beskrivelse                                                         |
| ---------------------------------------- | ------------------------------------------------------------------- |
| DNSSEC-kæde er gyldig                    | Hele valideringskæden (root → TLD → zone) opløses korrekt           |
| DNSSEC DNSKEY-post eksisterer            | Zonen udgiver mindst én DNSKEY-post                                 |
| DNSSEC DS-post eksisterer ved overordnet | Den overordnede zone udgiver en DS-post, der matcher zonens KSK     |
| DNSSEC-signatur udløber om dage          | Antal dage indtil den førstkommende RRSIG-signatur udløber          |
| DNSSEC-resolverkonsensus (AD-flag)       | Hver forespurgt resolver returnerer AD-flaget (Authenticated Data)  |
| DNSSEC-navneservere er konsistente       | Alle autoritative navneservere returnerer det samme SOA-serienummer |
| DNSSEC er gyldig                         | Samlet bestået/ikke bestået på tværs af alle valideringskontroller  |

### Filtertyper

For **DNSSEC-kæde er gyldig**, **DNSSEC DNSKEY-post eksisterer**, **DNSSEC DS-post eksisterer ved overordnet**, **DNSSEC-resolverkonsensus (AD-flag)**, **DNSSEC-navneservere er konsistente** og **DNSSEC er gyldig**:

- **Sand** – Betingelse er sand
- **Falsk** – Betingelse er falsk

For **DNSSEC-signatur udløber om dage**:

- **Større end**, **Mindre end**, **Større end eller lig med**, **Mindre end eller lig med**, **Lig med**, **Ikke lig med**

### Eksempelkriterier

#### Advarsel, hvis DNSSEC-kæden er brudt

- **Kontroller på**: DNSSEC-kæde er gyldig
- **Filtertype**: Falsk

#### Advar, før signaturer udløber

- **Kontroller på**: DNSSEC-signatur udløber om dage
- **Filtertype**: Mindre end
- **Værdi**: 7

#### Opfang manglende DS hos overordnet (brudt delegering)

- **Kontroller på**: DNSSEC DS-post eksisterer ved overordnet
- **Filtertype**: Falsk

#### Opdag resolveruenighed

- **Kontroller på**: DNSSEC-resolverkonsensus (AD-flag)
- **Filtertype**: Falsk

#### Opfang uoverensstemmelse mellem navneservere

- **Kontroller på**: DNSSEC-navneservere er konsistente
- **Filtertype**: Falsk

## Bedste praksis

1. **Brug flere offentlige resolvere** – Brug som standard `1.1.1.1`, `8.8.8.8` og `9.9.9.9`, så et nedbrud hos en enkelt resolver ikke forårsager falske positiver
2. **Advar i god tid før udløb** – Konfigurer forringede advarsler ved 7 dage og offline-advarsler ved 2 dage før signaturudløb; nøglerullinger kan mislykkes stille
3. **Overvåg hver signeret zone** – Inkluder apex-domæner, signerede underdomæner og enhver zone, der er delegeret til en anden operatør
4. **Aktiver navneserverkonsistenskontrol** – Opfanger synkroniseringsproblemer mellem primær/sekundær, som DNSSEC-validering alene ville overse, medmindre dit netværk blokerer udgående DNS til vilkårlige IP-adresser
