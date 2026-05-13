# Indgående e-mailmonitor

Indgående e-mailmonitor giver dig mulighed for at oprette og løse advarsler baseret på e-mails sendt til unikke monitor-specifikke e-mailadresser. Dette er nyttigt til integration med ældre systemer, tredjepartsadvarselsværktøjer eller enhver tjeneste, der kan sende e-mailnotifikationer.

## Sådan fungerer det

1. Når du opretter en Indgående e-mailmonitor, genererer OneUptime en unik e-mailadresse til den pågældende monitor
2. Enhver e-mail sendt til den adresse modtages og evalueres mod dine konfigurerede kriterier
3. Baseret på kriterierne kan OneUptime oprette nye advarsler eller løse eksisterende

Dette er en kraftfuld måde at integrere e-mailbaserede advarslingssystemer med OneUptimes incident management-arbejdsgang på.

## Oprettelse af en Indgående e-mailmonitor

1. Naviger til **Monitorer** i dit OneUptime-dashboard
2. Klik på **Opret monitor**
3. Vælg **Indgående e-mail** som monitortype
4. Konfigurer monitorindstillingerne:
   - **Navn:** Et beskrivende navn til din monitor
   - **Beskrivelse:** Hvad denne monitor er til
5. Opsæt dine **Advarselsopretnelseskriterier** (betingelser der opretter advarsler)
6. Opsæt dine **Advarselssolverende kriterier** (betingelser der løser advarsler)
7. Klik på **Opret**

Efter oprettelse vil du se den unikke e-mailadresse til denne monitor vist på monitorens detaljeringside.

## E-mailadresseformat

Hver Indgående e-mailmonitor får en unik e-mailadresse i formatet:

```
monitor-{secret-key}@{inbound-domain}
```

For eksempel: `monitor-abc123def456@inbound.yourdomain.com`

Du kan kopiere denne adresse fra monitorens detaljeside og konfigurere dine eksterne systemer til at sende e-mails til den.

## Tilgængelige kriteriefelter

Du kan oprette kriterier baseret på følgende e-mailfelter:

| Felt | Beskrivelse |
|-------|-------------|
| **E-mailemne** | Emnelinjen i den indgående e-mail |
| **E-mail fra** | Afsenderens e-mailadresse |
| **E-mailindhold** | Det rene tekstindhold af e-mailens krop |
| **E-mail til** | Modtagerens e-mailadresse |
| **E-mail modtaget** | Tidsbaserede kriterier for, hvornår e-mails modtages |

## Tilgængelige filtertyper

### Strengfiltre (Emne, Fra, Indhold, Til)

| Filter | Beskrivelse | Eksempel |
|--------|-------------|---------|
| **Indeholder** | Feltet indeholder den angivne tekst | Emne indeholder "KRITISK" |
| **Indeholder ikke** | Feltet indeholder ikke den angivne tekst | Emne indeholder ikke "TEST" |
| **Er lig med** | Feltet matcher nøjagtigt den angivne tekst | Fra er lig med "alerts@service.com" |
| **Er ikke lig med** | Feltet matcher ikke den angivne tekst | Emne er ikke lig med "OK" |
| **Starter med** | Feltet starter med den angivne tekst | Emne starter med "[ADVARSEL]" |
| **Slutter med** | Feltet slutter med den angivne tekst | Emne slutter med "- Produktion" |
| **Er tomt** | Feltet er tomt eller blankt | Indhold er tomt |
| **Er ikke tomt** | Feltet har indhold | Emne er ikke tomt |

### Tidsbaserede filtre (E-mail modtaget)

| Filter | Beskrivelse | Eksempel |
|--------|-------------|---------|
| **Modtaget inden for minutter** | E-mail modtaget inden for X minutter | E-mail modtaget inden for 30 minutter |
| **Ikke modtaget inden for minutter** | Ingen e-mail modtaget inden for X minutter | E-mail ikke modtaget inden for 60 minutter |

## Eksempelkonfigurationer

### Eksempel 1: Opret advarsel ved kritiske e-mails

**Advarselsopretnelseskriterier:**
- E-mailemne **Indeholder** "KRITISK"
- ELLER E-mailemne **Indeholder** "ADVARSEL"
- ELLER E-mailemne **Indeholder** "FEJL"

**Advarselssolverende kriterier:**
- E-mailemne **Indeholder** "LØST"
- ELLER E-mailemne **Indeholder** "OK"
- ELLER E-mailemne **Indeholder** "GENOPRETTET"

### Eksempel 2: Overvåg specifik afsender

**Advarselsopretnelseskriterier:**
- E-mail fra **Er lig med** "monitoring@legacy-system.com"
- OG E-mailemne **Indeholder** "Mislykket"

**Advarselssolverende kriterier:**
- E-mail fra **Er lig med** "monitoring@legacy-system.com"
- OG E-mailemne **Indeholder** "Succes"

### Eksempel 3: Hjerteslag-monitor (ingen e-mail = advarsel)

**Advarselsopretnelseskriterier:**
- E-mail modtaget **Ikke modtaget inden for minutter** med værdien `60`

Dette opretter en advarsel, hvis ingen e-mail modtages inden for 60 minutter – nyttigt til overvågning af planlagte jobs eller batchprocesser, der bør sende afslutnings-e-mails.

**Advarselssolverende kriterier:**
- E-mail modtaget **Modtaget inden for minutter** med værdien `5`

Dette løser advarslen, når en e-mail modtages.

## Anvendelsesscenarier

### Integration med ældre systemer

Mange ældre systemer understøtter kun e-mailbaseret advarsling. Brug Indgående e-mailmonitor til at:
- Konvertere e-mailadvarsler til OneUptime-incidents
- Automatisk løse incidents, når gendannelses-e-mails ankommer
- Centralisere advarsling fra flere ældre systemer

### Overvågning af tredjepartstjenester

Integrer med tjenester, der sender e-mailnotifikationer:
- Advarsler fra cloud-udbydere (AWS, GCP, Azure)
- Sikkerhedsscanningsværktøjer
- Notifikationer om afslutning af sikkerhedskopier
- Advarsler om udløb af SSL-certifikater

### Overvågning af planlagte jobs

Overvåg batchjobs og planlagte opgaver:
- Opret advarsler, hvis afslutnings-e-mails ikke modtages til tiden
- Spor jobbejl via notifikations-e-mails om fejl
- Overvåg afslutning af datapipelines

### Aggregering af multi-leverandøradvarsler

Konsolider advarsler fra flere overvågningsværktøjer:
- Modtag advarsler fra Nagios, Zabbix eller andre værktøjer via e-mail
- Forener incident management i OneUptime
- Oprethold en enkelt kilde til sandhed for alle advarsler

## Skabelonvariabler

Når du konfigurerer incident-skabeloner, kan du bruge disse variabler fra indgående e-mails:

| Variabel | Beskrivelse |
|----------|-------------|
| `{{emailSubject}}` | Emnet i den modtagne e-mail |
| `{{emailFrom}}` | Afsenderens e-mailadresse |
| `{{emailTo}}` | Modtagerens e-mailadresse |
| `{{emailBody}}` | Den rene tekstkrop i e-mailen |
| `{{emailReceivedAt}}` | Hvornår e-mailen blev modtaget |

## Monitor-oversigtvisning

Monitoroversigten viser:
- **Seneste e-mail modtaget kl.:** Hvornår den seneste e-mail blev modtaget
- **Fra:** Afsenderen af den seneste e-mail
- **Emne:** Emnelinjen i den seneste e-mail
- **E-mailheadere:** Fulde headere i den seneste e-mail (udvidelig)
- **E-mailindhold:** Indhold af den seneste e-mail (udvidelig)

## Selvhostet opsætning

Hvis du selvhoster OneUptime, skal du konfigurere en indgående e-mailudbyder. Understøttede i øjeblikket:

- **SendGrid Inbound Parse** – Se [SendGrid indgående e-mail-integration](/docs/self-hosted/sendgrid-inbound-email) for opsætningsinstruktioner

## Ting at overveje

- **E-mailadressesikkerhed:** Monitor-e-mailadressen indeholder en hemmelig nøgle. Behandl den som en adgangskode og del den ikke offentligt.
- **E-mailstørrelse:** Meget store e-mails (med store vedhæftede filer) kan blive afkortet eller afvist af e-mailudbyderen.
- **Behandlingstid:** E-mails behandles asynkront. Der kan være et par sekunders forsinkelse mellem afsendelse af en e-mail og oprettelse af advarsel.
- **Ufølsomhed over for store/små bogstaver:** Alle strengsammenligninger (Indeholder, Er lig med osv.) er ufølsomme over for store/små bogstaver.
- **Klartekst:** Kriterierne for e-mailindhold bruger klartekstversionen af e-mailen. HTML-formatering fjernes.

## Fejlfinding

### E-mails modtages ikke

1. Bekræft, at e-mailadressen er korrekt (kontroller for stavefejl)
2. Kontroller, om e-mailen blokeres af spamfiltre
3. Bekræft, at din indgående e-mailudbyder er korrekt konfigureret
4. Kontroller OneUptime-logs for eventuelle fejlmeddelelser

### Advarsler oprettes ikke

1. Bekræft, at dine kriterier matcher e-mailindholdet
2. Kontroller, at monitoren ikke er deaktiveret
3. Gennemgå evalueringsloggene i monitordetaljerne
4. Test med nøjagtige strengmatch inden du bruger mønstermatch

### Advarsler løses ikke

1. Bekræft, at dine løsningskriterier matcher gendannelses-e-mailen
2. Sørg for, at der er en aktiv advarsel at løse
3. Kontroller, at løsnings-e-mailen sendes til den samme monitoradresse
