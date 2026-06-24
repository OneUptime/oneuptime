# Innkommende e-postmonitor

Innkommende e-postmonitor lar deg opprette og løse varsler basert på e-poster sendt til unike monitor-spesifikke e-postadresser. Dette er nyttig for integrering med eldre systemer, tredjeparts varslingsverktøy eller enhver tjeneste som kan sende e-postvarsler.

## Slik fungerer det

1. Når du oppretter en innkommende e-postmonitor, genererer OneUptime en unik e-postadresse for den monitoren
2. Enhver e-post sendt til den adressen mottas og evalueres mot dine konfigurerte kriterier
3. Basert på kriteriene kan OneUptime opprette nye varsler eller løse eksisterende

Dette er en kraftig måte å integrere e-postbaserte varslingssystemer med OneUptime sin hendelseshåndteringsarbeidsflyt.

## Opprette en innkommende e-postmonitor

1. Naviger til **Monitors** i OneUptime-dashbordet ditt
2. Klikk **Create Monitor**
3. Velg **Incoming Email** som monitortype
4. Konfigurer monitorinnstillingene:
   - **Navn:** Et beskrivende navn for monitoren din
   - **Beskrivelse:** Hva monitoren er til for
5. Sett opp dine **Kriterier for oppretting av varsler** (betingelser som oppretter varsler)
6. Sett opp dine **Kriterier for løsning av varsler** (betingelser som løser varsler)
7. Klikk **Create**

Etter opprettelse vil du se den unike e-postadressen for denne monitoren vist på monitorens detaljside.

## E-postadresseformat

Hver innkommende e-postmonitor får en unik e-postadresse i formatet:

```
monitor-{secret-key}@{inbound-domain}
```

For eksempel: `monitor-abc123def456@inbound.yourdomain.com`

Du kan kopiere denne adressen fra monitorens detaljside og konfigurere eksterne systemer til å sende e-post til den.

## Tilgjengelige kriteriefelt

Du kan opprette kriterier basert på følgende e-postfelt:

| Felt               | Beskrivelse                                   |
| ------------------ | --------------------------------------------- |
| **Email Subject**  | Emnelinjen i den innkommende e-posten         |
| **Email From**     | Avsenderens e-postadresse                     |
| **Email Body**     | Det rene tekstinnholdet i e-postkroppen       |
| **Email To**       | Mottakerens e-postadresse                     |
| **Email Received** | Tidsbaserte kriterier for når e-poster mottas |

## Tilgjengelige filtertyper

### Strengfiltre (Subject, From, Body, To)

| Filter           | Beskrivelse                                       | Eksempel                           |
| ---------------- | ------------------------------------------------- | ---------------------------------- |
| **Contains**     | Feltet inneholder den angitte teksten             | Subject inneholder "CRITICAL"      |
| **Not Contains** | Feltet inneholder ikke den angitte teksten        | Subject inneholder ikke "TEST"     |
| **Equals**       | Feltet samsvarer nøyaktig med den angitte teksten | From er lik "alerts@service.com"   |
| **Not Equals**   | Feltet samsvarer ikke med den angitte teksten     | Subject er ikke lik "OK"           |
| **Starts With**  | Feltet starter med den angitte teksten            | Subject starter med "[ALERT]"      |
| **Ends With**    | Feltet slutter med den angitte teksten            | Subject slutter med "- Production" |
| **Is Empty**     | Feltet er tomt eller blankt                       | Body er tom                        |
| **Is Not Empty** | Feltet har innhold                                | Subject er ikke tom                |

### Tidsbaserte filtre (Email Received)

| Filter                      | Beskrivelse                           | Eksempel                              |
| --------------------------- | ------------------------------------- | ------------------------------------- |
| **Received In Minutes**     | E-post ble mottatt innen X minutter   | E-post mottatt innen 30 minutter      |
| **Not Received In Minutes** | Ingen e-post mottatt innen X minutter | E-post ikke mottatt innen 60 minutter |

## Eksempelkonfigurasjoner

### Eksempel 1: Opprett varsel ved kritiske e-poster

**Kriterier for oppretting av varsler:**

- E-postemne **Contains** "CRITICAL"
- ELLER E-postemne **Contains** "ALERT"
- ELLER E-postemne **Contains** "ERROR"

**Kriterier for løsning av varsler:**

- E-postemne **Contains** "RESOLVED"
- ELLER E-postemne **Contains** "OK"
- ELLER E-postemne **Contains** "RECOVERED"

### Eksempel 2: Overvåk spesifikk avsender

**Kriterier for oppretting av varsler:**

- E-post fra **Equals** "monitoring@legacy-system.com"
- OG E-postemne **Contains** "Failed"

**Kriterier for løsning av varsler:**

- E-post fra **Equals** "monitoring@legacy-system.com"
- OG E-postemne **Contains** "Success"

### Eksempel 3: Hjerteslag-monitor (ingen e-post = varsel)

**Kriterier for oppretting av varsler:**

- E-post mottatt **Not Received In Minutes** med verdi `60`

Dette oppretter et varsel hvis ingen e-post mottas på 60 minutter – nyttig for å overvåke planlagte jobber eller batchprosesser som skal sende fullføringse-poster.

**Kriterier for løsning av varsler:**

- E-post mottatt **Received In Minutes** med verdi `5`

Dette løser varselet når en e-post mottas.

## Bruksområder

### Integrering av eldre systemer

Mange eldre systemer støtter bare e-postbasert varsling. Bruk innkommende e-postmonitor til å:

- Konvertere e-postvarsler til OneUptime-hendelser
- Automatisk løse hendelser når gjenopprettingse-poster ankommer
- Sentralisere varsling fra flere eldre systemer

### Overvåking av tredjeparts tjenester

Integrer med tjenester som sender e-postvarsler:

- Advarsler fra skyleverandører (AWS, GCP, Azure)
- Sikkerhetsscanneverktøy
- Varsler om fullføring av sikkerhetskopiering
- Advarsler om utløp av SSL-sertifikater

### Overvåking av planlagte jobber

Overvåk batchjobber og planlagte oppgaver:

- Opprett varsler hvis fullføringse-poster ikke mottas i tide
- Spor jobbfeil gjennom e-poster om feilmeldinger
- Overvåk fullføring av datapipelines

### Aggregering av varsler fra flere leverandører

Konsolider varsler fra flere overvåkingsverktøy:

- Motta varsler fra Nagios, Zabbix eller andre verktøy via e-post
- Samle hendelseshåndtering i OneUptime
- Oppretthold én enkelt kilde til sannhet for alle varsler

## Malvariabler

Når du konfigurerer hendelsesmaler, kan du bruke disse variablene fra innkommende e-poster:

| Variabel              | Beskrivelse                      |
| --------------------- | -------------------------------- |
| `{{emailSubject}}`    | Emnet til den mottatte e-posten  |
| `{{emailFrom}}`       | Avsenderens e-postadresse        |
| `{{emailTo}}`         | Mottakerens e-postadresse        |
| `{{emailBody}}`       | Den rene tekstkroppen i e-posten |
| `{{emailReceivedAt}}` | Når e-posten ble mottatt         |

## Sammendragsvisning for monitoren

Monitorsammendraget viser:

- **Last Email Received At:** Når den seneste e-posten ble mottatt
- **From:** Avsenderen av den siste e-posten
- **Subject:** Emnelinjen i den siste e-posten
- **Email Headers:** Fullstendige hoder for den siste e-posten (utvidbar)
- **Email Body:** Innholdet i den siste e-posten (utvidbar)

## Oppsett for selvhostede installasjoner

Hvis du selvhoster OneUptime, må du konfigurere en innkommende e-postleverandør. For øyeblikket støttes:

- **SendGrid Inbound Parse** – Se [SendGrid innkommende e-postintegrasjon](/docs/self-hosted/sendgrid-inbound-email) for installasjonsinstruksjoner

## Ting å vurdere

- **E-postadressesikkerhet:** Monitorens e-postadresse inneholder en hemmelig nøkkel. Behandle den som et passord og ikke del den offentlig.
- **E-poststørrelse:** Svært store e-poster (med store vedlegg) kan bli avkuttet eller avvist av e-postleverandøren.
- **Behandlingstid:** E-poster behandles asynkront. Det kan være noen sekunders forsinkelse mellom sending av e-post og oppretting av varsel.
- **Ufølsomhet for store/små bokstaver:** Alle strengsammenligninger (Contains, Equals, osv.) er ufølsomme for store/små bokstaver.
- **Ren tekst:** E-postkropps-kriterier bruker ren tekstversjon av e-posten. HTML-formatering fjernes.

## Feilsøking

### E-poster mottas ikke

1. Verifiser at e-postadressen er korrekt (se etter skrivefeil)
2. Sjekk om e-posten blokkeres av spamfiltre
3. Verifiser at innkommende e-postleverandør er konfigurert korrekt
4. Sjekk OneUptime-loggene for eventuelle feilmeldinger

### Varsler opprettes ikke

1. Verifiser at kriteriene samsvarer med e-postinnholdet
2. Sjekk at monitoren ikke er deaktivert
3. Se gjennom evalueringsloggene i monitordetaljene
4. Test med nøyaktige strengtreff før du bruker mønstermatching

### Varsler løses ikke

1. Verifiser at løsningskriteriene samsvarer med gjenopprettingse-posten
2. Forsikre deg om at det finnes et aktivt varsel å løse
3. Sjekk at løsningse-posten sendes til samme monitoradresse
