# Kubernetes Monitor

Kubernetes-overvågning giver dig mulighed for at overvåge sundheden og ydeevnen af dine Kubernetes-klynger, herunder noder, pods, arbejdsbelastninger og kontrolplankomponenter. OneUptime indsamler metrikker fra din klynge og evaluerer dem mod dine konfigurerede kriterier.

## Oversigt

Kubernetes-monitorer bruger metrikker fra din klynge til at give dybdegående indsigt i din infrastruktur. Dette giver dig mulighed for at:

- Overvåge klynge-, namespace-, arbejdsbelastnings-, node- og pod-sundhed
- Spore CPU-, hukommelses-, disk- og netværksforbrug på tværs af ressourcer
- Opdage pod-nedbrud, genstarter og planlægningsfejl
- Overvåge replikattilgængelighed for deployments
- Advare om kontrolplaneproblemer (etcd, API-server, scheduler)
- Spore ressourceanmodninger og -grænser

## Oprettelse af en Kubernetes Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Kubernetes** som monitortype
4. Vælg klyngen og ressourceomfanget der skal overvåges
5. Konfigurer ressourcefiltre og metriske forespørgsler
6. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Klynge

Vælg den Kubernetes-klynge, der skal overvåges. Klynger skal integreres med OneUptime via OpenTelemetry.

### Ressourceomfang

Vælg det niveau, som ressourcer skal overvåges på:

| Omfang | Beskrivelse |
|-------|-------------|
| Klynge | Overvåg hele klyngen |
| Namespace | Overvåg ressourcer inden for et specifikt namespace |
| Arbejdsbelastning | Overvåg et specifikt deployment, statefulset, daemonset, job eller cronjob |
| Node | Overvåg en specifik klyngenode |
| Pod | Overvåg en specifik pod |

### Ressourcefiltre

Indsnæv omfanget med valgfrie filtre:

| Filter | Beskrivelse | Gældende omfang |
|--------|-------------|-------------------|
| Namespace | Kubernetes-namespace | Namespace, Arbejdsbelastning, Pod |
| Arbejdsbelastningstype | deployment, statefulset, daemonset, job, cronjob | Arbejdsbelastning |
| Arbejdsbelastningsnavn | Navnet på arbejdsbelastningen | Arbejdsbelastning |
| Nodenavn | Nodens navn | Node |
| Podnavn | Poddens navn | Pod |

### Metriske forespørgsler

Konfigurer én eller flere metriske forespørgsler til evaluering. Hver forespørgsel specificerer:

- **Metrisk navn** – Den Kubernetes-metrik, der skal forespørges
- **Aggregering** – Sådan aggregeres metriske værdier
- **Filtre** – Yderligere attributbaseret filtrering

Du kan også oprette **formler**, der kombinerer flere metriske forespørgsler ved hjælp af matematiske udtryk.

### Rullende tidsvindue

Vælg tidsvinduet for metrisk evaluering:

- Seneste 1 minut
- Seneste 5 minutter
- Seneste 10 minutter
- Seneste 15 minutter
- Seneste 30 minutter
- Seneste 60 minutter

## Almindelige Kubernetes-metrikker

### Pod-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Pod CPU-brug | CPU-forbrug af pods |
| Pod-hukommelsesbrug | Hukommelsesforbrug af pods |
| Pod-filsystembrug | Diskforbrug af pods |
| Pod-netværksmodtagelse/-transmission | Netværkstrafik |
| Pod-fase | Aktuel pod-fase (Kørende, Ventende, Mislykket osv.) |

### Node-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Node-CPU-brug | CPU-udnyttelse pr. node |
| Node-hukommelsesbrug | Hukommelsesudnyttelse pr. node |
| Node-filsystembrug | Diskforbrug pr. node |
| Node-disk-I/O | Læse-/skriveoperationer |
| Node-parathedsbetingelse | Om noden er parat |

### Container-metrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Container-genstarter | Antal container-genstarter |
| Container-CPU/hukommelsesgrænser | Ressourcegrænser |
| Container-CPU/hukommelsesanmodninger | Ressourceanmodninger |
| Container-parathedsstatus | Om containere er parate |

### Arbejdsbelastningsmetrikker

| Metrik | Beskrivelse |
|--------|-------------|
| Deployment tilgængelige/utilgængelige replikaer | Replikatantal |
| DaemonSet fejlplanlagte noder | Planlægningsproblemer |
| StatefulSet parate replikaer | Antal parate replikaer |
| Job aktive/mislykkede/gennemførte pods | Jobstatus |

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Metrisk værdi | Værdien af den konfigurerede metriske forespørgsel eller formel |

### Aggregeringstyper

| Aggregering | Beskrivelse |
|-------------|-------------|
| Gennemsnit | Gennemsnitsværdi over tidsvinduet |
| Sum | Sum af alle værdier |
| Maksimumsværdi | Højeste værdi i tidsvinduet |
| Minimumsværdi | Laveste værdi i tidsvinduet |
| Alle værdier | Alle værdier skal opfylde kriterierne |
| Enhver værdi | Mindst én værdi skal opfylde kriterierne |

### Filtertyper

- **Større end**, **Mindre end**, **Større end eller lig med**, **Mindre end eller lig med**, **Lig med**, **Ikke lig med**

## Færdigbyggede advarsels-skabeloner

OneUptime leverer skabeloner til almindelige Kubernetes-overvågningsscenarier:

| Skabelon | Beskrivelse | Grænseværdi |
|----------|-------------|-----------|
| CrashLoopBackOff-detektion | Antal container-genstarter | > 5 genstarter |
| Pod sidder fast i Ventende | Pods i Ventende-fase | > 0 pods |
| Node ikke parat | Node-parathedsbetingelse | = 0 (ikke parat) |
| Høj node-CPU | Node-CPU-udnyttelse | > 90% |
| Høj node-hukommelse | Node-hukommelsesudnyttelse | > 85% |
| Deployment-replikatmismatch | Utilgængelige replikaer | > 0 replikaer |
| Job-fejl | Mislykkede pods i et job | > 0 fejl |
| etcd ingen leder | etcd-klyngeleder mangler | = 0 (ingen leder) |
| API-server-begrænsning | Droppede API-anmodninger | > 0 anmodninger |
| Scheduler-efterslæb | Ventende pods i scheduler | > 0 pods |
| Høj node-diskbrug | Node-filsystembrug | > 90% |
| DaemonSet utilgængelig | Fejlplanlagte noder | > 0 noder |

## Opsætningskrav

For at bruge Kubernetes-overvågning skal du installere OneUptime Kubernetes-agenten i din klynge. Agenten sender klyngemetrikker, hændelser og pod-logs til OneUptime over OTLP.

Se vejledningen [Installer Kubernetes Agent](/docs/monitor/kubernetes-agent) – den dækker én-kommando Helm-installation og `preset`-indstillingen til at vælge den rigtige konfiguration til din klynge (standard, GKE Autopilot, EKS Fargate).
