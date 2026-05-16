# SSL-certifikatmonitor

SSL-certifikatovervågning giver dig mulighed for at overvåge gyldighed og udløb af SSL/TLS-certifikater på dine websteder og tjenester. OneUptime kontrollerer periodisk dine certifikater og advarer dig, inden de udløber, eller hvis der opdages problemer.

## Oversigt

SSL-certifikatmonitorer opretter forbindelse til dine HTTPS-endpoints og inspicerer SSL/TLS-certifikatet. Dette giver dig mulighed for at:

- Overvåge certifikatudløbsdatoer
- Opdage udløbne eller snart-udløbende certifikater
- Identificere selvsignerede certifikater
- Bekræfte certifikatgyldighed
- Forhindre serviceudfald forårsaget af udløbne certifikater

## Oprettelse af en SSL-certifikatmonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **SSL-certifikat** som monitortype
4. Indtast URL'en til det HTTPS-endpoint der skal kontrolleres
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### URL

Indtast den fulde HTTPS-URL til det endpoint, hvis SSL-certifikat du vil overvåge (f.eks. `https://example.com` eller `https://example.com:8443`).

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din certifikatstatus betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Er online | Om serveren er tilgængelig |
| Er gyldigt certifikat | Om certifikatet er gyldigt (ikke udløbet, ikke selvsigneret) |
| Er selvsigneret certifikat | Om certifikatet er selvsigneret |
| Er udløbet certifikat | Om certifikatet er udløbet |
| Er ikke et gyldigt certifikat | Om certifikatet er ugyldigt |
| Udløber om timer | Antal timer, indtil certifikatet udløber |
| Udløber om dage | Antal dage, indtil certifikatet udløber |
| Er anmodning-timeout | Om forbindelsen fik timeout |

### Filtertyper

For **Er online**, **Er gyldigt certifikat**, **Er selvsigneret certifikat**, **Er udløbet certifikat**, **Er ikke et gyldigt certifikat** og **Er anmodning-timeout**:

- **Sand** – Betingelse er sand
- **Falsk** – Betingelse er falsk

For **Udløber om timer** og **Udløber om dage**:

- **Større end** – Udløb er mere end den angivne værdi væk
- **Mindre end** – Udløb er mindre end den angivne værdi væk
- **Større end eller lig med** – Udløb er ved eller mere end den angivne værdi væk
- **Mindre end eller lig med** – Udløb er ved eller mindre end den angivne værdi væk
- **Lig med** – Udløb matcher nøjagtigt
- **Ikke lig med** – Udløb matcher ikke

### Eksempelkriterier

#### Markér som forringet, hvis certifikatet udløber inden for 30 dage

- **Kontroller på**: Udløber om dage
- **Filtertype**: Mindre end
- **Værdi**: 30

#### Markér som offline, hvis certifikatet er udløbet

- **Kontroller på**: Er udløbet certifikat
- **Filtertype**: Sand

#### Advarsel, hvis certifikatet er selvsigneret

- **Kontroller på**: Er selvsigneret certifikat
- **Filtertype**: Sand

#### Markér som offline, hvis certifikatet er ugyldigt

- **Kontroller på**: Er ikke et gyldigt certifikat
- **Filtertype**: Sand

## Bedste praksis

1. **Sæt flere grænseværdier** – Brug forringet status ved 30 dage og offline ved 7 dage inden udløb for at give dig tid til at forny
2. **Overvåg alle endpoints** – Hvis du har flere domæner eller underdomæner, skal du oprette en monitor til hvert
3. **Inkludér ikke-standardporte** – Glem ikke tjenester, der kører HTTPS på ikke-standardporte
4. **Overvåg efter fornyelse** – Når et certifikat er fornyet, skal du bekræfte, at monitoren bekræfter, at det er gyldigt
