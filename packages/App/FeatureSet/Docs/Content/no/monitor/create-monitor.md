# Opprett en monitor

En monitor sjekker noe du drifter, for eksempel et nettsted, et API, en vert eller en Kubernetes-klynge, og sier fra når det slutter å virke. **Opprett monitor** spør først hva som skal overvåkes, så hva som skal sjekkes, og så hvor ofte. Alt unntatt typen, navnet og det som sjekkes, starter med standardverdier som passer for de fleste monitorer.

## Overvåkingsinfo

Gå til **Monitorer** og klikk på **Opprett monitor**. Det første spørsmålet er **Monitortype**: Hva vil du overvåke?

- De seks typene folk oftest oppretter, kommer først: **Website**, **API**, **Ping**, **Port**, **SSL Certificate** og **Incoming Request**, for heartbeats fra cron-jobber og webhooks.
- **Flere monitortyper** viser alle andre typer under kategorien sin, for eksempel **Infrastruktur** (Kubernetes, Docker, Host) og **Telemetri** (Logger, Målinger, Spor). **Manual**, en monitor du setter statusen for selv, ligger under **Other**.
- Eller skriv i søkefeltet. Det kjenner ordene du allerede bruker, som `k8s`, `postgres`, `heartbeat` eller `tls`, og **Enter** velger det første treffet.

Typen du velger, krymper til én linje. Klikk på **Endre** for å velge en annen; trykk **Escape** mens du velger, for å beholde typen du hadde.

Fyll deretter inn **Navn**. Det brukes i varsler og i titlene på hendelser. **Beskrivelse** og **Etiketter** er valgfrie og venter under **Flere felt**.

En **Manual**-monitor trenger ikke noe mer, så **Opprett monitor** ligger på dette trinnet.

## Kriterier

Dette trinnet starter med det som skal sjekkes. For et nettsted er det URL-en, med et eksempel i feltet; andre typer spør etter en vert, en spørring, en klynge eller et loggfilter. **Test monitor** kjører sjekken én gang før du lagrer.

Under bestemmer **Monitorkriterier** når monitoren endrer status, erklærer en hendelse eller oppretter et varsel. En ny monitor starter med kriterier som passer for de fleste monitorer, hvert brettet sammen til én linje som sier hva det sjekker og hva det gjør. En ny nettstedsmonitor blir for eksempel merket som frakoblet og erklærer en hendelse når nettstedet ikke svarer eller svarer med en feilstatuskode. Klikk på et kriterium for å åpne og endre det. **Legg til kriterier** legger til ett, åpent og klart til å fylles ut.

Ingenting på dette trinnet merkes som manglende før du klikker på **Neste**.

## Sonder og intervall

Monitorer som sonder sjekker, slutter med dette trinnet: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code og External Status Page. **Sonder** er maskinene som kjører sjekkene, og prosjektets standardsonder er allerede valgt. **Overvåkingsintervall** starter på **Hvert 5. minutt**. Klikk på **Opprett monitor**.

Alle andre typer opprettes fra trinnet **Kriterier**.

## Start fra en mal eller en lenke

En monitormal, og lenkene som oppretter en monitor andre steder i OneUptime (på et måldiagram, en nettverksenhet eller en deteksjonsregel), åpner **Opprett monitor** med typen valgt og resten fylt ut. Klikk på **Endre** for å velge en annen type. Skjemaet til en mal bruker den samme typevelgeren: se [Monitormaler](/docs/monitor/monitor-templates).
