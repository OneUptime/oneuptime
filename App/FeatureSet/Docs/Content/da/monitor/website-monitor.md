# Website Monitor

Website-overvågning giver dig mulighed for at overvåge tilgængelighed, ydeevne og svar fra ethvert websted eller webside. OneUptime sender periodisk HTTP-anmodninger til din webstedss-URL og kontrollerer, om den svarer korrekt.

## Oversigt

Website-monitorer kontrollerer dine websider ved at sende HTTP-anmodninger og evaluere svarene. Dette giver dig mulighed for at:

- Overvåge websteds-oppetid og -tilgængelighed
- Spore svartider og ydeevne
- Bekræfte HTTP-statuskoder
- Kontrollere svarheadere
- Opdage nedetid, inden dine brugere gør det

## Oprettelse af en Website Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Website** som monitortype
4. Indtast det websteds-URL, du vil overvåge
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Websteds-URL

Indtast den fulde URL til det websted, du vil overvåge, inklusive protokollen (f.eks. `https://example.com`).

### Dynamiske URL-pladsholdere

Når du overvåger URL'er bag CDN'er eller cachingproxyer, kan monitoren modtage et cachelagret svar frem for at ramme origin-serveren. For at omgå cachen ved hvert tjek kan du bruge dynamiske URL-pladsholdere, der erstattes med en unik værdi ved hver overvågningsanmodning.

#### Understøttede pladsholdere

| Pladsholder | Beskrivelse | Eksempelværdi |
|-------------|-------------|---------------|
| `{{timestamp}}` | Erstattes med det aktuelle Unix-tidsstempel (sekunder) | `1719500000` |
| `{{random}}` | Erstattes med en tilfældig unik streng | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Eksempel

Konfigurer din monitor-URL med en pladsholder:

```
https://example.com/health?cb={{timestamp}}
```

Ved hvert overvågningsskjek bliver URL'en:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

Du kan også bruge `{{random}}` til en unik streng ved hver anmodning:

```
https://example.com/health?nocache={{random}}
```

### Avancerede indstillinger

#### Følg ikke omdirigeringer

Som standard følger OneUptime HTTP-omdirigeringer (301, 302 osv.). Aktiver denne indstilling, hvis du vil overvåge omdirigeringssvaret selv frem for den endelige destination.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår dit websted betragtes som online, forringet eller offline baseret på:

- **Svarstatuskode** – Kontroller, om HTTP-statuskoden matcher forventede værdier (f.eks. 200, 301)
- **Svartid** – Overvåg, om svartiden overskrider en grænseværdi
- **Svarindhold** – Kontroller, om svarindholdet indeholder eller matcher specifikt indhold
- **Svarheadere** – Bekræft, at specifikke svarheadere er til stede eller matcher forventede værdier
