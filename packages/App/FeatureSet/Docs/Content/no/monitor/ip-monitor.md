# IP-overvåking

En IP-monitor sjekker at en IPv4- eller IPv6-adresse svarer på ping (ICMP-ekkoforespørsler), og måler tur-retur-tiden, pakketapet og jitteren. Bruk den for infrastruktur du kjenner på adressen, som en gateway, den virtuelle IP-en til en lastbalanserer eller en server med fast adresse.

:::cards
- [Opprett monitoren](#opprett-en-ip-monitor): Seks trinn i dashbordet.
- [Konfigurasjonsalternativer](#konfigurasjonsalternativer): Adressen, tidsavbruddet og nye forsøk.
- [Overvåkingskriterier](#overvåkingskriterier): Tilgjengelighet, forsinkelse, pakketap og jitter.
- [Feilsøking](#feilsøking): Når adressen er oppe, men monitoren sier frakoblet.
:::

## Slik fungerer det

En IP-monitor kjører den samme sjekken som en [ping-monitor](/docs/monitor/ping-monitor). Ved hver sjekk sender en sonde fem ekkoforespørsler til adressen. Kommer minst ett svar tilbake, er adressen tilkoblet, og sonden registrerer gjennomsnittlig tur-retur-tid som svartid, sammen med pakketapet, jitteren og det raskeste og tregeste svaret. Kommer det ikke noe svar tilbake, prøver sonden igjen, opptil antallet nye forsøk du tillater. Deretter kjører OneUptime resultatet gjennom monitorens kriterier.

```mermaid title="Én sjekk av en IP-adresse"
flowchart TB
    send["Send 5 ekkoforespørsler"] --> reply{"Noe svar?"}
    reply -->|"Ja"| measure["Registrer tur-retur-tid,<br/>pakketap og jitter"]
    reply -->|"Nei, forsøk igjen"| send
    reply -->|"Nei, ingen forsøk igjen"| trace["Spor nettverksbanen"]
    measure --> criteria["Sjekk kriteriene"]
    trace --> criteria
```

Når en sjekk feiler, sporer sonden også ruten til adressen og legger det den fant ved resultatet som **Network Path at Time of Failure**, så du kan se hvor ruten brøt sammen.

Hvilken du skal bruke:

| Monitor | Tar | Bruk den når |
| --- | --- | --- |
| **IP** | Bare en IP-adresse | Selve adressen er det du overvåker, og den endres ikke. |
| [Ping](/docs/monitor/ping-monitor) | Et vertsnavn eller en IP-adresse | Du kjenner verten ved navn; navnet slås opp ved hver sjekk, så monitoren følger DNS-endringer. |

> [!NOTE]
> Noen vertsleverandører blokkerer ICMP på maskinene en sonde kjører på. En sonde som ikke kan sende ping i det hele tatt, sjekker i stedet TCP-port `80` på adressen, så monitoren fortsatt sier om den kan nås. Pakketap og jitter måles da ikke.

En sonde som har mistet sin egen nettverkstilkobling, rapporterer ikke noe resultat, så den kan ikke merke adressen din som frakoblet.

## Før du starter

- **En rolle som kan opprette monitorer**: Project Owner, Project Admin, Project Member, Monitor Admin eller Monitor Member, eller en egendefinert rolle med tillatelsen Create Monitor.
- **En sonde som når adressen**, med ICMP tillatt på veien. Prosjektets standardsonder velges for hver nye monitor. Står det en brannmur foran den, tillater du ICMP-ekkoforespørsler fra [OneUptime Clouds sonde-IP-adresser](/docs/configuration/ip-addresses). En privat adresse trenger en [egendefinert sonde](/docs/probe/custom-probe) på det nettverket, og en IPv6-adresse trenger en sonde med IPv6-tilkobling.

## Opprett en IP-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klikk på **Opprett monitor**. Klikk på **Flere monitortyper** under **Monitortype**, og velg **IP** under **Basic Monitoring**.

### Gi den et navn

Angi et **Navn**, som `Office gateway`, og klikk så på **Neste**.

### Angi adressen

Angi under **IP-adresse** IPv4- eller IPv6-adressen som skal sjekkes, som `192.168.1.1` eller `2001:db8::1`. Et vertsnavn godtas ikke: feltet viser en feil. For å pinge en vert ved navn bruker du en [ping-monitor](/docs/monitor/ping-monitor).

### Test den

Klikk på **Test monitor**, velg en sonde under **Velg sonde**, og klikk på **Kjør test**. **Resultat av overvåkingstest** viser tur-retur-tidene og pakketapet sonden så.

### Gå gjennom kriteriene

**Monitorkriterier** starter med [standardkriteriene](#standardkriterier): frakoblet når adressen ikke svarer, tilkoblet når den gjør det. Endre dem ved behov, og klikk så på **Neste**.

### Velg sonder og opprett

Behold eller endre **Sonder** og **Overvåkingsintervall** (det starter på **Hvert 5. minutt**), og klikk så på **Opprett monitor**. Monitorens side åpner.
:::

## Konfigurasjonsalternativer

| Felt | Standard | Hva du angir |
| --- | --- | --- |
| **IP-adresse** | Ingen | En IPv4-adresse, som `192.168.1.1`, eller en IPv6-adresse, som `2001:db8::1`. Hakeparenteser rundt en IPv6-adresse fjernes. |
| **Tidsavbrudd for forespørsel (sekunder)** (under **Flere felt**) | `60` | Hvor lenge det ventes på svar ved hvert forsøk. Maksimum er 60 sekunder. |
| **Nye forsøk ved feil** (under **Flere felt**) | Sondens standard, som regel `3` | Hvor mange ganger et mislykket forsøk gjentas. Maksimum er 3. |

**Nye forsøk ved feil** teller nye forsøk _etter_ det første forsøket, så `0` kjører sjekken én gang og `2` opptil tre ganger. Står feltet tomt, brukes sondens standard: 3, med mindre sondens `PROBE_MONITOR_RETRY_LIMIT` sier noe annet. Hver feil prøves på nytt, tidsavbrudd medregnet, med ett sekunds pause mellom forsøkene. En vellykket sjekk der svarene tok lenger enn 10 sekunder, sjekkes også på nytt.

## Overvåkingskriterier

Kriterier avgjør når adressen regnes som tilkoblet, redusert eller frakoblet, og om det erklærer en hendelse eller oppretter et varsel. Hvert kriterium sjekker ett eller flere filtre:

| Filter | Betingelser | Hva det sjekker |
| --- | --- | --- |
| **Is Online** | **Sann**, **Usann** | Om minst én ekkoforespørsel fikk svar. |
| **Svartid (i ms)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | Gjennomsnittlig tur-retur-tid for svarene. |
| **Packet Loss (in %)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | Andelen av de fem ekkoforespørslene som ikke fikk svar. |
| **Jitter (in ms)** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | Standardavviket for tur-retur-tidene over pakkene i én sjekk. |
| **Is Request Timeout** | **Sann**, **Usann** | Om pingen fikk tidsavbrudd ved hvert forsøk. |

Med to eller flere filtre avgjør **Samsvarsbetingelse** om **Alle** må samsvare, eller om **Hvilken som helst** av dem holder. Et kriteriums **Handlinger** avgjør hva det gjør: endrer monitorstatusen, oppretter et varsel, erklærer en hendelse, eller flere av disse.

### Standardkriterier

En ny IP-monitor starter med to kriterier:

- **Frakoblet** — adressen svarer ikke på noen av ekkoforespørslene, eller kan ikke nås i det hele tatt etter alle nye forsøk. Monitoren merkes som **Frakoblet**, og en hendelse kalt "_monitor name_ is offline" opprettes. Hendelsen løser seg selv når adressen svarer igjen.
- **Oppe** — adressen svarer. Monitoren merkes som **I drift**.

Kriterier sjekkes fra topp til bunn, og det første som samsvarer, avgjør hva som skjer. Når ingen samsvarer, viser monitoren standardstatusen sin: **I drift**, med mindre du velger en annen under **Flere felt** under kriteriene.

### Evaluering over en tidsperiode

**Evaluer disse kriteriene over en tidsperiode** er en avkrysningsboks under et filter, som tilbys for **Is Online**, **Svartid (i ms)**, **Packet Loss (in %)** og **Jitter (in ms)**. Slå den på for å vurdere et vindu av tidligere sjekker i stedet for bare den siste: velg en aggregering under **Evaluer** og et vindu fra 2 til 60 minutter under **For de siste (i minutter)**.

| Aggregering | Samsvarer når |
| --- | --- |
| **Gjennomsnitt**, **Sum**, **Maximum Value**, **Minimum Value** | Den verdien over vinduet oppfyller betingelsen. Bare numeriske filtre. |
| **All Values** | Hver sjekk i vinduet oppfyller betingelsen. |
| **Any Value** | Minst én sjekk i vinduet oppfyller betingelsen. |

**All Values** samsvarer først når vinduet faktisk er dekket av data. En monitor som nettopp er opprettet, eller en der sjekkene sluttet å bli registrert, har ikke nok historikk til å si noe om de siste N minuttene, så kriteriet venter i stedet for å samsvare på den ene målingen det har. **Any Value** er innstillingen for "si fra med en gang én enkelt sjekk overskrider grensen" og utløses fortsatt umiddelbart.

**Hvis ingen data** avgjør hva som skjer så lenge vinduet ikke kan underbygge kriteriet:

| Alternativ | Hva som skjer | Bruk det til |
| --- | --- | --- |
| **Ignore** (standard) | Kriteriet samsvarer ikke. | Vanlige terskelvarsler. |
| **Trigger** | De manglende dataene regnes som problemet. | Sjekker der stillhet i seg selv er en feil. |
| **Treat As Zero** | Vinduet sammenlignes som én enkelt null. | Tellere der ingen hendelser virkelig betyr null. |

### Eksempelkriterier

| Mål | Filter | Betingelse | Verdi |
| --- | --- | --- | --- |
| Frakoblet når adressen ikke kan nås | **Is Online** | **Usann** | — |
| Varsle når forsinkelsen er høy | **Svartid (i ms)** | **Greater Than** | `100` |
| Merk adressen som redusert på en forbindelse med tap | **Packet Loss (in %)** | **Greater Than** | `20` |
| Varsle ved en ustabil forbindelse | **Jitter (in ms)** | **Greater Than** | `30` |

## Feilsøking

:::details Adressen er oppe, men monitoren sier frakoblet
Adressen, eller en brannmur foran den, svarer ikke på ICMP-ekkoforespørsler fra sonden. Tillat ICMP-ekkoforespørsler fra sondene, eller overvåk heller en tjeneste på den adressen med en [port-monitor](/docs/monitor/port-monitor). **Network Path at Time of Failure** på den mislykkede sjekken viser hvor langt ruten kom.
:::

:::details En IPv6-adresse feiler alltid
Sonden som kjørte sjekken, har ingen IPv6-tilkobling; feilmeldingen sier det. Kjør monitoren på en sonde med IPv6: se [Egendefinerte probes](/docs/probe/custom-probe).
:::

:::details Pakketap og jitter er tomme
Sonden som kjørte sjekken, kan ikke sende ping, så den sjekket i stedet TCP-port `80`, som ikke måler noen av dem. Kjør monitoren på en sonde som får sende ICMP.
:::

## Neste steg

:::cards
- [Ping-overvåking](/docs/monitor/ping-monitor): Ping en vert ved navn, og følg DNS-endringer.
- [Port-overvåking](/docs/monitor/port-monitor): Sjekk en tjeneste på adressen, ikke bare adressen.
- [Egendefinerte probes](/docs/probe/custom-probe): Sjekk private adresser og IPv6-adresser fra ditt eget nettverk.
- [Hendelser](/docs/incidents/index): Hva som skjer etter at monitoren har erklært en.
:::
