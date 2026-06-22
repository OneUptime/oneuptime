# Domænemonitor

Domæneovervågning giver dig mulighed for at overvåge registreringsstatus og udløb af dine domænenavne. OneUptime udfører periodisk WHOIS-opslag for at spore dit domænes sundhed og advare dig inden det udløber.

## Oversigt

Domænemonitoer forespørger WHOIS-data for dine domæner for at spore registreringsdetaljer. Dette giver dig mulighed for at:

- Overvåge domæneudløbsdatoer
- Opdage udløbne eller snart-udløbende domæner
- Spore domæneregistraroplysninger
- Bekræfte navneserverkonfiguration
- Overvåge domænestatuskoder

## Oprettelse af en Domænemonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Domæne** som monitortype
4. Indtast det domænenavn, du vil overvåge
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Grundlæggende indstillinger

| Felt       | Beskrivelse                                          | Påkrævet |
| ---------- | ---------------------------------------------------- | -------- |
| Domænenavn | Det domæne der skal overvåges (f.eks. `example.com`) | Ja       |

### Avancerede indstillinger

| Felt         | Beskrivelse                   | Standard |
| ------------ | ----------------------------- | -------- |
| Timeout (ms) | Tid at vente på et WHOIS-svar | 10000    |
| Genforsøg    | Antal genforsøg ved fejl      | 3        |

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår dit domæne betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype            | Beskrivelse                                     |
| ---------------------- | ----------------------------------------------- |
| Domæne udløber om dage | Antal dage, indtil domæneregistreringen udløber |
| Domæneregistrar        | Domæneregistrarens navn                         |
| Domænenavneserver      | Navneserver-hostnavne for domænet               |
| Domænestatuskode       | WHOIS-domænestatuskoder                         |
| Domæne er udløbet      | Om domænet er udløbet                           |

### Filtertyper

For **Domæne er udløbet**:

- **Sand** – Domænet er udløbet
- **Falsk** – Domænet er ikke udløbet

For **Domæne udløber om dage**:

- **Større end**, **Mindre end**, **Større end eller lig med**, **Mindre end eller lig med**, **Lig med**, **Ikke lig med**

For **Domæneregistrar**, **Domænenavneserver** og **Domænestatuskode**:

- **Indeholder** – Værdien indeholder den angivne tekst
- **Indeholder ikke** – Værdien indeholder ikke den angivne tekst
- **Starter med** – Værdien starter med den angivne tekst
- **Slutter med** – Værdien slutter med den angivne tekst
- **Lig med** – Værdien matcher nøjagtigt
- **Ikke lig med** – Værdien matcher ikke

### Eksempelkriterier

#### Advarsel, hvis domænet udløber inden for 30 dage

- **Kontroller på**: Domæne udløber om dage
- **Filtertype**: Mindre end
- **Værdi**: 30

#### Markér som offline, hvis domænet er udløbet

- **Kontroller på**: Domæne er udløbet
- **Filtertype**: Sand

#### Bekræft, at navneservere er korrekte

- **Kontroller på**: Domænenavneserver
- **Filtertype**: Indeholder
- **Værdi**: `ns1.example.com`

## Bedste praksis

1. **Sæt tidlige advarsler** – Konfigurer forringede advarsler ved 60 dage og offline-advarsler ved 14 dage inden udløb
2. **Overvåg alle kritiske domæner** – Inkludér primære domæner, separat registrerede underdomæner og eventuelle domæner, der bruges til e-mail eller API'er
3. **Spor registrarændringer** – Overvåg registrarfeltet for at opdage uautoriserede domæneoverførsler
