# Widgets

En widget er én flise på et dashboard. Denne side oplister hver widget, du kan tilføje, hvad den viser, og hvornår du skal gribe til den.

For hvordan du trækker widgets rundt på lærredet, se [Opret et dashboard](/docs/dashboards/authoring).

## Diagrammer og tal

### Chart

Et linje-, søjle- eller arealdiagram af én eller flere metrikserier over dashboardets tidsinterval.

**Indstillinger**:

- En eller flere metrik-forespørgsler.
- En valgfri formel, der kombinerer to forespørgsler (for eksempel `errors / total * 100` for at få en fejlrate).
- En "vis som rate"-mulighed for kumulative tællere, der vokser uden at nulstille.
- Visningsmuligheder: stablet eller overlejret, Y-akse-enhed, legend-position, diagramtype.

Brug den, når: tendenser betyder noget. Latency over tid, fejlantal, kødybde, alt hvor formen på linjen fortæller historien.

### Value

Et enkelt stort tal med valgfrie farvede tærskler.

**Indstillinger**:

- En metrik-forespørgsel, der giver ét tal tilbage (sidste værdi, gennemsnit eller max over tidsintervallet).
- En valgfri **warning**-tærskel (gul over).
- En valgfri **critical**-tærskel (rød over).
- Talformat og enhed.

Brug den, når: ét tal besvarer spørgsmålet. Aktuel fejlrate, P95-latency lige nu, antal åbne hændelser.

### Gauge

En cirkulær gauge med minimum, maksimum, advarselsbånd og kritisk bånd.

**Indstillinger**: en metrik-forespørgsel og de fire grænser.

Brug den, når: værdien passer ind i et kendt interval. CPU-procent (0–100%), diskforbrug, kø-kapacitet.

### Table

En tabel af metrik-resultater, én række pr. gruppe.

**Indstillinger**: en metrik-forespørgsel (typisk grupperet efter en label som host eller service), de kolonner der skal vises, og en rækkegrænse.

Brug den, når: du vil have en opdeling i stedet for en tendens. Top 10 mest støjende hosts, fejlantal pr. service, requests pr. endpoint.

## Text

En statisk blok af Markdown.

**Indstillinger**: Markdown-body'en. Overskrifter, lister, links, fremhævelse og kodeblokke renderes alle.

Brug den, når: du vil have en sektionsoverskrift, et stykke kontekstuel tekst, en liste af links til runbooks eller et midlertidigt banner under en hændelse.

## Logs og traces

### Log Stream

Et live-tail af loglinjer, der matcher et filter.

**Indstillinger**: log-filtre (service, severity, attributter) og de kolonner, der skal vises.

Brug den, når: du vil se, hvad applikationen siger lige nu, uden at forlade dashboardet.

### Trace List

En liste af nylige traces, der matcher et filter, med varighed, status og service.

**Indstillinger**: trace-filtre (service, status, attributter).

Brug den, når: du vil have en liste af nylig aktivitet snarere end et diagram. Et almindeligt mønster er et latency-diagram i toppen med en liste af langsomme traces nedenunder.

## Live-lister

### Incident List

En live-liste af hændelser, der matcher et filter.

**Indstillinger**: filtre efter tilstand, alvorlighed, labels, monitor eller team.

Brug den, når: dashboardet besvarer "hvad er ødelagt lige nu?"

### Alert List

En live-liste af alarmer, der matcher et filter.

**Indstillinger**: filtre efter tilstand, alvorlighed, labels.

Brug den, når: et team-dashboard sporer alarmer på dets services.

### Monitor List

En live-liste af monitorer og deres aktuelle status.

**Indstillinger**: filtre efter monitortype, labels eller aktuel tilstand.

Brug den, når: du vil have et flådeoverblik — "er alle siderne oppe?"

## Kubernetes-ressourcelister

Til projekter med en [Kubernetes Agent](/docs/monitor/kubernetes-agent) installeret. Hver tager valgfrie filtre for cluster, namespace og labels.

- **Kubernetes Pod List** — pods med deres fase, genstarter og node.
- **Kubernetes Node List** — noder med deres conditions og kapacitet.
- **Kubernetes Namespace List** — namespaces og workload-antal.
- **Kubernetes Deployment List** — deployments med ønskede vs. klare replicas.
- **Kubernetes StatefulSet List** — stateful sets med klare replicas.
- **Kubernetes DaemonSet List** — daemon sets med ønskede vs. klare.
- **Kubernetes Job List** — jobs og deres færdiggørelsesstatus.
- **Kubernetes CronJob List** — cron jobs med tidsplan og seneste kørsel.

Brug disse, når: du vil have et enkelt dashboard, der blander Kubernetes-tilstand med telemetri fra disse workloads.

## Docker-ressourcelister

Til projekter med Docker-overvågning sat op.

- **Docker Host List** — hosts der kører Docker, med container-antal.
- **Docker Container List** — containere med tilstand, image, host, uptime.
- **Docker Image List** — images og deres størrelser.
- **Docker Network List** — Docker-netværk og forbundne containere.
- **Docker Volume List** — Docker-volumes og deres forbrug.

## Infrastruktur

### Host List

Hosts overvåget af OneUptimes server-monitor, med status, CPU, hukommelse og uptime.

**Indstillinger**: filtre efter labels eller aktuel tilstand.

## Hvilken widget skal jeg bruge?

Et par hurtige regler:

- **Tendens over tid?** Chart.
- **Ét tal der betyder noget lige nu?** Value (eller Gauge, hvis det har en klar min/max).
- **Opdeling på tværs af mange ting?** Table.
- **Hvad sker der i systemet lige nu?** Log Stream, Trace List, Incident List.
- **Tilstanden af en specifik gruppe ressourcer?** Den matchende liste-widget.
- **En overskrift, et afsnit eller et link?** Text.

De fleste dashboards blander et par stykker — et diagram i toppen, en værdi eller to ved siden af, en tekst-adskillelse og en liste eller to nedenunder.

## Læs videre

- [Variabler & filtre](/docs/dashboards/variables) — at gøre widgets genbrugelige for mange services eller kunder.
- [Opret et dashboard](/docs/dashboards/authoring) — lærredsmekanikken.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — at dele uden for dit team.
