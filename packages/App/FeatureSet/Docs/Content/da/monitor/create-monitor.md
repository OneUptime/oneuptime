# Opret en monitor

En monitor tjekker noget, du driver, som et websted, en API, en vært eller en Kubernetes-klynge, og giver dig besked, når det holder op med at virke. **Opret monitor** spørger først, hvad der skal overvåges, så hvad der skal tjekkes, og derefter hvor ofte. Alt undtagen typen, navnet og hvad der skal tjekkes, starter med standardværdier, der passer til de fleste monitorer.

> [!NOTE]
> For at oprette en monitor skal du have rollen Project Owner, Project Admin, Project Member, Monitor Admin eller Monitor Member eller en brugerdefineret rolle med tilladelsen Create Monitor.

## Overvågningsinfo

Første trin spørger, hvad der skal overvåges, og hvad monitoren skal hedde.

:::steps
### Åbn Opret monitor

Gå til **Monitorer**, og klik på **Opret monitor**. Formularen åbner på sit første trin, **Overvågningsinfo**.

### Vælg monitortypen

Det første spørgsmål er **Monitortype**: hvad vil du overvåge?

- De seks typer, som de fleste opretter, kommer først: **Websted**, **API**, **Ping**, **Port**, **SSL Certificate** og **Incoming Request** til heartbeats fra cronjobs og webhooks.
- **Flere monitortyper** viser alle andre typer under deres kategori, som **Infrastruktur** (Kubernetes, Docker, vært) og **Telemetri** (protokoller, metrikker, spor). **Manual**, en monitor, hvis status du selv sætter, ligger under **Andet**.
- Eller skriv i søgefeltet. Det kender de ord, du allerede bruger, som `k8s`, `postgres`, `heartbeat` eller `tls`, og **Enter** vælger det første resultat.

Den valgte type skrumper til én linje. Klik på **Skift** for at vælge en anden; tryk på **Escape**, mens du vælger, for at beholde den type, du havde.

### Navngiv monitoren

Udfyld **Navn**. Det bruges i advarsler og i hændelsers titler. **Beskrivelse** og **Etiketter** er valgfrie og venter under **Flere felter**.

En **Manual**-monitor behøver ikke mere, så **Opret monitor** ligger på dette trin. For alle andre typer klikker du på **Næste**.
:::

## Kriterier

Andet trin spørger, hvad der skal tjekkes, og afgør, hvad der tæller som et problem.

:::steps
### Angiv, hvad der skal tjekkes

Dette trin åbner på det, der skal tjekkes. For et websted er det dets URL med et eksempel i feltet; andre typer beder om en vært, en forespørgsel, en klynge eller et logfilter. Indstillinger, som de fleste monitorer aldrig ændrer, som timeouts og genforsøg, er foldet sammen under **Flere felter**.

For en monitor, som sonder tjekker, kører **Test monitor** tjekket én gang, før du gemmer: vælg en sonde under **Vælg sonde**, og klik på **Kør test**. Svaret åbner i **Overvågningstestresultat**.

### Gennemgå kriterierne

Nedenunder afgør **Monitorkriterier**, hvornår monitoren skifter status, erklærer en hændelse eller opretter en advarsel. En ny monitor starter med kriterier, der passer til de fleste monitorer, hver foldet sammen til én linje, der siger, hvad den tjekker, og hvad den gør. En ny webstedsmonitor markeres for eksempel som offline og erklærer en hændelse, når webstedet ikke svarer eller svarer med en fejlstatuskode.

Klik på et kriterium for at åbne og ændre det. **Tilføj kriterier** tilføjer et, åbent og klar til at udfylde. For at ændre rækkefølgen trækker du et kriterium i håndtaget til venstre for det.

### Gå til næste trin

Klik på **Næste**. Intet på dette trin markeres som manglende, før du klikker på **Næste**.
:::

### Sådan evalueres kriterier

Resultatet af hvert tjek går gennem kriterierne fra top til bund, og det første, der matcher, afgør, hvad der sker. Det kriterium kan ændre monitorens status, erklære en hændelse, oprette en advarsel eller en hvilken som helst kombination af de tre. Når intet matcher, viser monitoren sin **Standardstatus for overvågning**, som sættes under **Flere felter** under kriterierne (**I drift**, medmindre du vælger en anden).

```mermaid title="Fra et tjek til en status, en hændelse eller en advarsel"
flowchart TB
    check["Resultatet af et tjek"] --> criteria{"Første kriterium,<br/>der matcher"}
    criteria -->|"Intet matcher"| fallback["Standardstatus for overvågning"]
    criteria -->|"Et matcher"| actions
    subgraph actions["Hvad det kriterium gør"]
        direction LR
        status["Ændre status"]
        incident["Erklære en hændelse"]
        alert["Oprette en advarsel"]
    end
```

Hændelser og advarsler, der er sat til at blive løst automatisk, som standardkriteriernes, løser sig selv, så snart deres kriterium ikke længere matcher. En monitor, som flere sonder tjekker, skifter kun, når sonderne er enige: som standard skal hver sonde, der er slået til og forbundet, nå samme resultat. For at kræve færre sætter du **Sondeenighed** på monitorens side **Konfiguration → Sonder og interval**.

## Sonder og interval

Monitorer, som sonder tjekker, slutter med dette trin: Websted, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, NTP, Domæne, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code og External Status Page. **Sonder** er de maskiner, der kører tjekkene, og dit projekts standardsonder er valgt på forhånd. **Overvågningsinterval** starter på **Hvert 5. minut**.

:::steps
### Vælg sonderne

Behold de valgte **Sonder**, eller vælg andre. En monitor uden sonder bliver aldrig tjekket. For at tjekke noget på et privat netværk kører du en [brugerdefineret sonde](/docs/probe/custom-probe) i det netværk og vælger den her.

### Vælg, hvor ofte der tjekkes

Vælg et **Overvågningsinterval** fra **Hvert minut** til **Hver uge**. Monitorer af typen Synthetic Monitor, Custom JavaScript Code og SSL Certificate får tilbudt intervaller på 5 minutter eller mere.

### Opret monitoren

Klik på **Opret monitor**. Den nye monitors side åbner. For senere at ændre dens sonder eller interval åbner du **Konfiguration → Sonder og interval** på den side.
:::

Alle andre typer undtagen Manual oprettes fra trinnet **Kriterier**.

## Start fra en skabelon eller et link

En monitorskabelon og de links, der opretter en monitor andre steder i OneUptime (på et metrikdiagram, en netværksenhed eller en detektionsregel), åbner **Opret monitor** med typen valgt og resten udfyldt. Klik på **Skift** for at vælge en anden type. En skabelons formular bruger den samme typevælger: se [Monitorskabeloner](/docs/monitor/monitor-templates).

Hver monitortype har sin egen side med sine indstillinger, sine standardkriterier og eksempler. Gode steder at gå videre:

:::cards
- [Websted-monitor](/docs/monitor/website-monitor): Tjek, at en side indlæses, og hvad den svarer.
- [API-monitor](/docs/monitor/api-monitor): Kald et endpoint med en metode, headere og en brødtekst.
- [Monitorskabeloner](/docs/monitor/monitor-templates): Opret mange monitorer fra én konfiguration, og hold dem ens.
- [Hændelser](/docs/incidents/index): Hvad der sker, efter at en monitor erklærer en hændelse.
:::
