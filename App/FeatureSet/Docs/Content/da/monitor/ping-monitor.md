# Ping Monitor

Ping-overvågning giver dig mulighed for at overvåge tilgængelighed og responsivitet af enhver host eller IP-adresse. OneUptime sender periodisk ping-anmodninger til dit mål og kontrollerer, om det svarer korrekt.

## Oversigt

Ping-monitorer tester grundlæggende netværksforbindelsen ved at sende ICMP-ping-anmodninger til en host. Dette giver dig mulighed for at:

- Overvåge host-oppetid og -tilgængelighed
- Spore netværkslatens og svartider
- Opdage forbindelsesproblemer, inden de påvirker dine tjenester
- Bekræfte, at servere og netværksenheder er tilgængelige

## Oprettelse af en Ping Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Ping** som monitortype
4. Indtast det hostnavn eller den IP-adresse, du vil overvåge
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Ping hostnavn eller IP-adresse

Indtast hostnavnet eller IP-adressen på det mål, du vil overvåge (f.eks. `example.com` eller `192.168.1.1`). Både hostnavne og IP-adresser accepteres.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din host betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Er online | Om hosten svarer på ping-anmodninger |
| Svartid (ms) | Tur-retur-tid for ping-anmodningen i millisekunder |
| Er anmodning-timeout | Om ping-anmodningen fik timeout |

### Filtertyper

For **Er online** og **Er anmodning-timeout**:

- **Sand** – Betingelse er sand
- **Falsk** – Betingelse er falsk

For **Svartid**:

- **Større end** – Svartiden overskrider en grænseværdi
- **Mindre end** – Svartiden er under en grænseværdi
- **Større end eller lig med** – Svartiden er ved eller over en grænseværdi
- **Mindre end eller lig med** – Svartiden er ved eller under en grænseværdi
- **Lig med** – Svartiden matcher nøjagtigt
- **Ikke lig med** – Svartiden matcher ikke
- **Evaluer over tid** – Evaluer ved hjælp af aggregering (Gennemsnit, Sum, Maksimum, Minimum, Alle værdier, Enhver værdi) over et tidsvindue

### Eksempelkriterier

#### Markér som offline, hvis host er utilgængelig

- **Kontroller på**: Er online
- **Filtertype**: Falsk

#### Advarsel, hvis svartid overskrider 200 ms

- **Kontroller på**: Svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 200
