# Kubernetes-monitor

Kubernetes-övervakning gör det möjligt att övervaka hälsan och prestandan hos dina Kubernetes-kluster, inklusive noder, pods, arbetsbelastningar och kontrollplanekomponenter. OneUptime samlar in mätvärden från ditt kluster och utvärderar dem mot dina konfigurerade kriterier.

## Översikt

Kubernetes-monitorer använder mätvärden från ditt kluster för att ge djup insyn i din infrastruktur. Detta gör det möjligt att:

- Övervaka kluster-, namnrymds-, arbetsbelastnings-, nod- och pod-hälsa
- Spåra CPU, minne, disk och nätverksanvändning för resurser
- Identifiera podkraschar, omstarter och schemaläggningsfel
- Övervaka tillgänglighet för deployment-repliker
- Varna om problem med kontrollplanet (etcd, API-server, schemaläggare)
- Spåra resursbegäranden och gränser

## Skapa en Kubernetes-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Kubernetes** som monitortyp
4. Välj klustret och resursomfånget att övervaka
5. Konfigurera resursfilter och mätvärdesförfrågningar
6. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Kluster

Välj det Kubernetes-kluster att övervaka. Kluster måste vara integrerade med OneUptime via OpenTelemetry.

### Resursomfång

Välj nivån att övervaka resurser på:

| Omfång | Beskrivning |
|--------|-------------|
| Kluster | Övervaka hela klustret |
| Namnrymd | Övervaka resurser inom en specifik namnrymd |
| Arbetsbelastning | Övervaka en specifik deployment, statefulset, daemonset, jobb eller cronjobb |
| Nod | Övervaka en specifik klusternod |
| Pod | Övervaka en specifik pod |

### Resursfilter

Begränsa omfånget med valfria filter:

| Filter | Beskrivning | Tillämpliga omfång |
|--------|-------------|-------------------|
| Namnrymd | Kubernetes-namnrymd | Namnrymd, Arbetsbelastning, Pod |
| Arbetsbelastningstyp | deployment, statefulset, daemonset, jobb, cronjobb | Arbetsbelastning |
| Arbetsbelastningsnamn | Arbetsbelastningens namn | Arbetsbelastning |
| Nodnamn | Nodens namn | Nod |
| Podnamn | Podens namn | Pod |

### Mätvärdesförfrågningar

Konfigurera en eller flera mätvärdesförfrågningar att utvärdera. Varje förfrågan anger:

- **Mätvärdets namn** – Kubernetes-mätvärdet att fråga
- **Aggregering** – Hur man aggregerar mätvärden
- **Filter** – Ytterligare attributbaserad filtrering

Du kan också skapa **formler** som kombinerar flera mätvärdesförfrågningar med matematiska uttryck.

### Rullande tidsfönster

Välj tidsfönstret för mätvärdesutvärdering:

- Senaste 1 minuten
- Senaste 5 minuterna
- Senaste 10 minuterna
- Senaste 15 minuterna
- Senaste 30 minuterna
- Senaste 60 minuterna

## Vanliga Kubernetes-mätvärden

### Pod-mätvärden

| Mätvärde | Beskrivning |
|---------|-------------|
| Pod CPU-användning | CPU-förbrukning av pods |
| Pod-minnesanvändning | Minnesförbrukning av pods |
| Pod-filsystemanvändning | Diskanvändning av pods |
| Pod-nätverksmottagning/-sändning | Nätverkstrafik |
| Pod-fas | Aktuell pod-fas (Running, Pending, Failed etc.) |

### Nodmätvärden

| Mätvärde | Beskrivning |
|---------|-------------|
| Nod-CPU-användning | CPU-utnyttjande per nod |
| Nod-minnesanvändning | Minnesutnyttjande per nod |
| Nod-filsystemanvändning | Diskanvändning per nod |
| Nod-disk-I/O | Läs/skriv-operationer |
| Nodklar-tillstånd | Om noden är klar |

### Containermätvärden

| Mätvärde | Beskrivning |
|---------|-------------|
| Containeromstarter | Antal containeromstarter |
| Container-CPU/minnesgränser | Resursgränser |
| Container-CPU/minnesbegäranden | Resursbegäranden |
| Container klartillstånd | Om containers är redo |

### Arbetsbelastningsmätvärden

| Mätvärde | Beskrivning |
|---------|-------------|
| Deployment tillgängliga/otillgängliga repliker | Replikat antal |
| DaemonSet felschemalagda noder | Schemaläggningsproblem |
| StatefulSet redo repliker | Antal redo repliker |
| Jobb aktiva/misslyckade/lyckade pods | Jobbstatus |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Mätvärde | Värdet av den konfigurerade mätvärdesförfrågan eller formeln |

### Aggregeringstyper

| Aggregering | Beskrivning |
|-------------|-------------|
| Medelvärde | Medelvärde under tidsfönstret |
| Summa | Summan av alla värden |
| Maxvärde | Högsta värdet i tidsfönstret |
| Minvärde | Lägsta värdet i tidsfönstret |
| Alla värden | Alla värden måste matcha kriterierna |
| Valfritt värde | Minst ett värde måste matcha |

### Filtertyper

- **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med**, **Lika med**, **Inte lika med**

## Förbyggda varningsmallar

OneUptime tillhandahåller mallar för vanliga Kubernetes-övervakningsscenarier:

| Mall | Beskrivning | Tröskel |
|------|-------------|---------|
| CrashLoopBackOff-identifiering | Antal containeromstarter | > 5 omstarter |
| Pod fastnad i Pending | Pods i Pending-fas | > 0 pods |
| Nod inte klar | Nodens klartillstånd | = 0 (inte klar) |
| Hög nod-CPU | Nod-CPU-utnyttjande | > 90% |
| Högt nod-minne | Nod-minnesutnyttjande | > 85% |
| Deployment-replikmismatch | Otillgängliga repliker | > 0 repliker |
| Jobbmisslyckanden | Misslyckade pods i ett jobb | > 0 misslyckanden |
| etcd ingen ledare | etcd-klustrets ledare saknas | = 0 (ingen ledare) |
| API-serverthrottling | Borttagna API-förfrågningar | > 0 förfrågningar |
| Schemaläggningseftersläpning | Väntande pods i schemaläggare | > 0 pods |
| Hög nodiskanvändning | Nod-filsystemanvändning | > 90% |
| DaemonSet otillgänglig | Felschemalagda noder | > 0 noder |

## Konfigurationskrav

För att använda Kubernetes-övervakning behöver du installera OneUptime Kubernetes-agenten i ditt kluster. Agenten skickar klustermätvärden, händelser och pod-loggar till OneUptime via OTLP.

Se guiden [Installera Kubernetes-agenten](/docs/monitor/kubernetes-agent) – den täcker Helm-installationen med ett kommando och alternativet `preset` för att välja rätt konfiguration för ditt kluster (standard, GKE Autopilot, EKS Fargate).
