# Skapa en monitor

En monitor kontrollerar något du driver, som en webbplats, ett API, en värd eller ett Kubernetes-kluster, och säger till när det slutar fungera. **Skapa monitor** frågar först vad som ska övervakas, sedan vad som ska kontrolleras och därefter hur ofta. Allt utom typen, namnet och vad som ska kontrolleras börjar med standardvärden som passar de flesta monitorer.

> [!NOTE]
> För att skapa en monitor behöver du rollen Project Owner, Project Admin, Project Member, Monitor Admin eller Monitor Member, eller en anpassad roll med behörigheten Create Monitor.

## Övervakningsinformation

Det första steget frågar vad som ska övervakas och vad monitorn ska heta.

:::steps
### Öppna Skapa monitor

Gå till **Monitorer** och klicka på **Skapa monitor**. Formuläret öppnas på sitt första steg, **Övervakningsinformation**.

### Välj monitortyp

Den första frågan är **Monitortyp**: vad vill du övervaka?

- De sex typer som flest skapar kommer först: **Webbplats**, **API**, **Ping**, **Port**, **SSL Certificate** och **Incoming Request**, för heartbeats från cron-jobb och webhooks.
- **Fler monitortyper** listar alla andra typer under sin kategori, som **Infrastruktur** (Kubernetes, Docker, värd) och **Telemetri** (loggar, mätvärden, spår). **Manual**, en monitor vars status du själv sätter, finns under **Annat**.
- Eller skriv i sökrutan. Den känner till orden du redan använder, som `k8s`, `postgres`, `heartbeat` eller `tls`, och **Enter** väljer den första träffen.

Den valda typen krymper till en rad. Klicka på **Ändra** för att välja en annan; tryck på **Escape** medan du väljer för att behålla den typ du hade.

### Namnge monitorn

Fyll i **Namn**. Det används i larm och i incidenternas rubriker. **Beskrivning** och **Etiketter** är valfria och väntar under **Fler fält**.

En **Manual**-monitor behöver inget mer, så **Skapa monitor** finns på det här steget. För alla andra typer klickar du på **Nästa**.
:::

## Kriterier

Det andra steget frågar vad som ska kontrolleras och avgör vad som räknas som ett problem.

:::steps
### Ange vad som ska kontrolleras

Det här steget öppnas på det som ska kontrolleras. För en webbplats är det dess URL, med ett exempel i rutan; andra typer frågar efter en värd, en fråga, ett kluster eller ett loggfilter. Inställningar som de flesta monitorer aldrig ändrar, som tidsgränser och återförsök, är hopfällda under **Fler fält**.

För en monitor som sonder kontrollerar kör **Testa monitor** kontrollen en gång innan du sparar: välj en sond under **Välj sond** och klicka på **Kör test**. Svaret öppnas i **Resultat av övervakningstest**.

### Gå igenom kriterierna

Nedanför avgör **Monitorkriterier** när monitorn byter status, deklarerar en incident eller skapar ett larm. En ny monitor börjar med kriterier som passar de flesta monitorer, vart och ett hopfällt till en rad som säger vad det kontrollerar och vad det gör. En ny webbplatsmonitor markeras till exempel som offline och deklarerar en incident när webbplatsen inte svarar eller svarar med en felstatuskod.

Klicka på ett kriterium för att öppna och ändra det. **Lägg till kriterier** lägger till ett, öppet och redo att fyllas i. För att ändra ordningen drar du ett kriterium i handtaget till vänster om det.

### Gå till nästa steg

Klicka på **Nästa**. Inget på det här steget markeras som saknat förrän du klickar på **Nästa**.
:::

### Så utvärderas kriterier

Resultatet av varje kontroll går igenom kriterierna uppifrån och ned, och det första som matchar avgör vad som händer. Det kriteriet kan ändra monitorns status, deklarera en incident, skapa ett larm eller valfri kombination av de tre. När inget matchar visar monitorn sin **Standardstatus för övervakning**, som ställs in under **Fler fält** under kriterierna (**Fungerar**, om du inte väljer en annan).

```mermaid title="Från en kontroll till en status, en incident eller ett larm"
flowchart TB
    check["Resultatet av en kontroll"] --> criteria{"Första kriterium<br/>som matchar"}
    criteria -->|"Inget matchar"| fallback["Standardstatus för övervakning"]
    criteria -->|"Ett matchar"| actions
    subgraph actions["Vad det kriteriet gör"]
        direction LR
        status["Ändra statusen"]
        incident["Deklarera en incident"]
        alert["Skapa ett larm"]
    end
```

Incidenter och larm som är inställda på att lösas automatiskt, som standardkriteriernas, löser sig själva så snart deras kriterium slutar matcha. En monitor som kontrolleras av mer än en sond ändras bara när sonderna är överens: som standard måste varje sond som är påslagen och ansluten komma fram till samma resultat. För att kräva färre ställer du in **Sondöverensstämmelse** på monitorns sida **Konfiguration → Sonder och intervall**.

## Sonder och intervall

Monitorer som sonder kontrollerar avslutas med det här steget: Webbplats, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, NTP, Domän, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code och External Status Page. **Sonder** är maskinerna som kör kontrollerna, och projektets standardsonder är förvalda. **Övervakningsintervall** börjar på **Var 5:e minut**.

:::steps
### Välj sonderna

Behåll de valda **Sonder** eller välj andra. En monitor utan sonder kontrolleras aldrig. För att kontrollera något i ett privat nätverk kör du en [anpassad sond](/docs/probe/custom-probe) i det nätverket och väljer den här.

### Välj hur ofta kontrollen körs

Välj ett **Övervakningsintervall**, från **Varje minut** till **Varje vecka**. Monitorer av typen Synthetic Monitor, Custom JavaScript Code och SSL Certificate erbjuds intervall på 5 minuter eller längre.

### Skapa monitorn

Klicka på **Skapa monitor**. Den nya monitorns sida öppnas. För att ändra dess sonder eller intervall senare öppnar du **Konfiguration → Sonder och intervall** på den sidan.
:::

Alla andra typer utom Manual skapas från steget **Kriterier**.

## Börja från en mall eller en länk

En monitormall, och de länkar som skapar en monitor på andra ställen i OneUptime (på ett mätvärdesdiagram, en nätverksenhet eller en detekteringsregel), öppnar **Skapa monitor** med typen vald och resten ifylld. Klicka på **Ändra** för att välja en annan typ. En malls formulär använder samma typväljare: se [Monitormallar](/docs/monitor/monitor-templates).

Varje monitortyp har en egen sida med sina inställningar, sina standardkriterier och exempel. Bra ställen att fortsätta till:

:::cards
- [Webbplatsövervakning](/docs/monitor/website-monitor): Kontrollera att en sida laddas och vad den svarar.
- [API-övervakning](/docs/monitor/api-monitor): Anropa en slutpunkt med en metod, huvuden och en kropp.
- [Monitormallar](/docs/monitor/monitor-templates): Skapa många monitorer från en konfiguration och håll dem lika.
- [Incidenter](/docs/incidents/index): Vad som händer efter att en monitor har deklarerat en incident.
:::
