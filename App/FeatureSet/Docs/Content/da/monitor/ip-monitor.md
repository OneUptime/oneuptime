# IP Monitor

IP-overvågning giver dig mulighed for at overvåge tilgængelighed og responsivitet af enhver IPv4- eller IPv6-adresse. OneUptime tester periodisk forbindelsen til mål-IP-adressen og rapporterer dens status.

## Oversigt

IP-monitorer bekræfter, at en specifik IP-adresse er tilgængelig og responsiv. Dette giver dig mulighed for at:

- Overvåge IPv4- og IPv6-adressetilgængelighed
- Spore svartider og latens
- Opdage netværksforbindelsesproblemer
- Bekræfte, at infrastruktur-endpoints er tilgængelige

## Oprettelse af en IP Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **IP** som monitortype
4. Indtast den IP-adresse, du vil overvåge
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### IP-adresse

Indtast den IPv4- eller IPv6-adresse, du vil overvåge (f.eks. `192.168.1.1` eller `2001:db8::1`). Værdien skal være i et gyldigt IP-adresseformat.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din IP-adresse betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Er online | Om IP-adressen er tilgængelig |
| Svartid (ms) | Svartid i millisekunder |
| Er anmodning-timeout | Om anmodningen fik timeout |

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

#### Markér som offline, hvis IP er utilgængelig

- **Kontroller på**: Er online
- **Filtertype**: Falsk

#### Advarsel, hvis latens overskrider 100 ms

- **Kontroller på**: Svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 100
