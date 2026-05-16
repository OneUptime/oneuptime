# Domänmonitor

Domänövervakning gör det möjligt att övervaka registreringsstatus och utgångsdatum för dina domännamn. OneUptime utför periodiska WHOIS-sökningar för att spåra din domäns hälsa och varna dig innan den löper ut.

## Översikt

Domänmonitorer frågar WHOIS-data för dina domäner för att spåra registreringsdetaljer. Detta gör det möjligt att:

- Övervaka domänens utgångsdatum
- Identifiera utgångna eller snart utgående domäner
- Spåra information om domänregistratorer
- Verifiera namnserverkonfiguration
- Övervaka domänstatuskoder

## Skapa en domänmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Domän** som monitortyp
4. Ange domännamnet du vill övervaka
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Grundinställningar

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| Domännamn | Domänen att övervaka (t.ex. `example.com`) | Ja |

### Avancerade inställningar

| Fält | Beskrivning | Standard |
|------|-------------|----------|
| Timeout (ms) | Hur länge man väntar på ett WHOIS-svar | 10000 |
| Återförsök | Antal återförsök vid fel | 3 |

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din domän anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Domänen löper ut om dagar | Antal dagar tills domänregistreringen löper ut |
| Domänregistrator | Registratorns namn |
| Domänens namnserver | Namnserver-värdnamn för domänen |
| Domänstatuskod | WHOIS-domänstatuskoder |
| Domänen är utgången | Om domänen har löpt ut |

### Filtertyper

För **Domänen är utgången**:

- **Sant** – Domänen har löpt ut
- **Falskt** – Domänen har inte löpt ut

För **Domänen löper ut om dagar**:

- **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med**, **Lika med**, **Inte lika med**

För **Domänregistrator**, **Domänens namnserver** och **Domänstatuskod**:

- **Innehåller** – Värdet innehåller den angivna texten
- **Innehåller inte** – Värdet innehåller inte den angivna texten
- **Börjar med** – Värdet börjar med den angivna texten
- **Slutar med** – Värdet slutar med den angivna texten
- **Lika med** – Värdet matchar exakt
- **Inte lika med** – Värdet matchar inte

### Exempelkriterier

#### Varna om domänen löper ut inom 30 dagar

- **Kontrollera på**: Domänen löper ut om dagar
- **Filtertyp**: Mindre än
- **Värde**: 30

#### Markera som offline om domänen är utgången

- **Kontrollera på**: Domänen är utgången
- **Filtertyp**: Sant

#### Verifiera att namnservrarna är korrekta

- **Kontrollera på**: Domänens namnserver
- **Filtertyp**: Innehåller
- **Värde**: `ns1.example.com`

## Bästa praxis

1. **Ange tidiga varningar** – Konfigurera degraderingsvarningar vid 60 dagar och offlinevarningar vid 14 dagar före utgång
2. **Övervaka alla kritiska domäner** – Inkludera primära domäner, separat registrerade underdomäner och domäner som används för e-post eller API:er
3. **Spåra registratorändringar** – Övervaka registratorfältet för att identifiera obehöriga domänöverföringar
