# Opret en monitor

En monitor tjekker noget, du driver, for eksempel et websted, en API, en vært eller en Kubernetes-klynge, og giver besked, når det holder op med at virke. **Opret monitor** spørger først, hvad der skal overvåges, så hvad der skal tjekkes, og så hvor ofte. Alt undtagen typen, navnet og det, der tjekkes, starter med standardværdier, der passer til de fleste monitorer.

## Overvågningsinfo

Gå til **Monitorer**, og klik på **Opret monitor**. Det første spørgsmål er **Monitortype**: Hvad vil du overvåge?

- De seks typer, som de fleste opretter, kommer først: **Website**, **API**, **Ping**, **Port**, **SSL Certificate** og **Incoming Request**, til heartbeats fra cron-job og webhooks.
- **Flere monitortyper** viser alle andre typer under deres kategori, for eksempel **Infrastruktur** (Kubernetes, Docker, Host) og **Telemetri** (Protokoller, Metrikker, Spor). **Manual**, en monitor, hvis status du selv sætter, står under **Other**.
- Eller skriv i søgefeltet. Det kender de ord, du allerede bruger, som `k8s`, `postgres`, `heartbeat` eller `tls`, og **Enter** vælger det første resultat.

Den valgte type skrumper til én linje. Klik på **Skift** for at vælge en anden; tryk på **Escape**, mens du vælger, for at beholde den type, du havde.

Udfyld derefter **Navn**. Det bruges i advarsler og i titlerne på hændelser. **Beskrivelse** og **Etiketter** er valgfrie og venter under **Flere felter**.

En **Manual**-monitor behøver ikke mere, så **Opret monitor** står på dette trin.

## Kriterier

Dette trin starter med det, der skal tjekkes. For et websted er det dets URL, med et eksempel i feltet; andre typer spørger efter en vært, en forespørgsel, en klynge eller et logfilter. **Test monitor** kører tjekket én gang, før du gemmer.

Nedenunder afgør **Monitorkriterier**, hvornår monitoren skifter status, erklærer en hændelse eller opretter en advarsel. En ny monitor starter med kriterier, der passer til de fleste monitorer, hver foldet sammen til én linje, der siger, hvad den tjekker, og hvad den gør. En ny webstedsmonitor markeres for eksempel som offline og erklærer en hændelse, når webstedet ikke svarer eller svarer med en fejlstatuskode. Klik på et kriterium for at åbne og ændre det. **Tilføj kriterier** tilføjer et, åbent og klar til at blive udfyldt.

Intet på dette trin markeres som manglende, før du klikker på **Næste**.

## Sonder og interval

Monitorer, som sonder tjekker, slutter med dette trin: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code og External Status Page. **Sonder** er de maskiner, der kører tjekkene, og projektets standardsonder er allerede valgt. **Overvågningsinterval** starter på **Hvert 5. minut**. Klik på **Opret monitor**.

Alle andre typer oprettes fra trinnet **Kriterier**.

## Start fra en skabelon eller et link

En monitorskabelon og de links, der opretter en monitor andre steder i OneUptime (på et metrikdiagram, en netværksenhed eller en detektionsregel), åbner **Opret monitor** med typen valgt og resten udfyldt. Klik på **Skift** for at vælge en anden type. En skabelons egen formular bruger den samme typevælger: se [Monitorskabeloner](/docs/monitor/monitor-templates).
