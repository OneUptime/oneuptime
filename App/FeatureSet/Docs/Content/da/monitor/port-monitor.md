# Port Monitor

Port-overvågning giver dig mulighed for at overvåge tilgængelighed af specifikke TCP- eller UDP-porte på en host. OneUptime forsøger periodisk at oprette forbindelse til den angivne port og kontrollerer, om den er åben og responsiv.

## Oversigt

Port-monitorer tester, om en specifik netværksport accepterer forbindelser. Dette giver dig mulighed for at:

- Overvåge servicetilgængelighed på specifikke porte
- Spore portsvartider
- Bekræfte, at tjenester som databaser, mailservere og applikationsservere kører
- Opdage serviceudfald, inden de påvirker brugere

## Oprettelse af en Port Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Port** som monitortype
4. Indtast hostnavnet eller IP-adressen og portnummeret
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Hostnavn eller IP-adresse

Indtast hostnavnet eller IP-adressen på mål-hosten (f.eks. `example.com` eller `192.168.1.1`).

### Port

Indtast portnummeret der skal overvåges (1-65535). Almindelige eksempler:

| Port  | Tjeneste   |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din port betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype          | Beskrivelse                                        |
| -------------------- | -------------------------------------------------- |
| Er online            | Om porten er åben og accepterer forbindelser       |
| Svartid (ms)         | Tid til at etablere en forbindelse i millisekunder |
| Er anmodning-timeout | Om forbindelsesforsøget fik timeout                |

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

#### Markér som offline, hvis porten er lukket

- **Kontroller på**: Er online
- **Filtertype**: Falsk

#### Advarsel, hvis forbindelsestid overskrider 500 ms

- **Kontroller på**: Svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 500

#### Markér som forringet, hvis forbindelsen er langsom

- **Kontroller på**: Svartid (ms)
- **Filtertype**: Større end
- **Værdi**: 200
