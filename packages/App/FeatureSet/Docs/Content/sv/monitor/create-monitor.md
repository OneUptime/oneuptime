# Skapa en monitor

En monitor kontrollerar något som du driver, till exempel en webbplats, ett API, en värd eller ett Kubernetes-kluster, och säger till när det slutar fungera. **Skapa monitor** frågar först vad som ska övervakas, sedan vad som ska kontrolleras och sedan hur ofta. Allt utom typen, namnet och det som kontrolleras börjar med standardvärden som passar de flesta monitorer.

## Övervakningsinformation

Gå till **Monitorer** och klicka på **Skapa monitor**. Den första frågan är **Monitortyp**: vad vill du övervaka?

- De sex typer som de flesta skapar kommer först: **Website**, **API**, **Ping**, **Port**, **SSL Certificate** och **Incoming Request**, för heartbeats från cron-jobb och webhooks.
- **Fler monitortyper** visar alla andra typer under sin kategori, till exempel **Infrastruktur** (Kubernetes, Docker, Host) och **Telemetri** (Loggar, Mätvärden, Spår). **Manual**, en monitor vars status du sätter själv, finns under **Other**.
- Eller skriv i sökrutan. Den känner till orden du redan använder, som `k8s`, `postgres`, `heartbeat` eller `tls`, och **Enter** väljer den första träffen.

Typen du väljer krymper till en rad. Klicka på **Ändra** för att välja en annan; tryck på **Escape** medan du väljer för att behålla typen du hade.

Fyll sedan i **Namn**. Det används i larm och i titlarna på incidenter. **Beskrivning** och **Etiketter** är valfria och väntar under **Fler fält**.

En **Manual**-monitor behöver inget mer, så **Skapa monitor** finns på det här steget.

## Kriterier

Det här steget börjar med det som ska kontrolleras. För en webbplats är det dess URL, med ett exempel i rutan; andra typer frågar efter en värd, en fråga, ett kluster eller ett loggfilter. **Testa monitor** kör kontrollen en gång innan du sparar.

Under avgör **Monitorkriterier** när monitorn byter status, rapporterar en incident eller skapar ett larm. En ny monitor börjar med kriterier som passar de flesta monitorer, vart och ett hopfällt till en rad som säger vad det kontrollerar och vad det gör. En ny webbplatsmonitor markeras till exempel som offline och rapporterar en incident när webbplatsen inte svarar eller svarar med en felstatuskod. Klicka på ett kriterium för att öppna och ändra det. **Lägg till kriterier** lägger till ett, öppet och redo att fyllas i.

Inget på det här steget markeras som saknat förrän du klickar på **Nästa**.

## Sonder och intervall

Monitorer som sonder kontrollerar slutar med det här steget: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code och External Status Page. **Sonder** är maskinerna som kör kontrollerna, och projektets standardsonder är redan valda. **Övervakningsintervall** börjar på **Var 5:e minut**. Klicka på **Skapa monitor**.

Alla andra typer skapas från steget **Kriterier**.

## Börja från en mall eller en länk

En monitormall, och länkarna som skapar en monitor på andra ställen i OneUptime (på ett mätvärdesdiagram, en nätverksenhet eller en identifieringsregel), öppnar **Skapa monitor** med typen vald och resten ifyllt. Klicka på **Ändra** för att välja en annan typ. En malls eget formulär använder samma typväljare: se [Monitormallar](/docs/monitor/monitor-templates).
