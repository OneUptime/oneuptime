# Dashboards – Oversigt

Dashboards er den måde, du forvandler den telemetri, OneUptime allerede indsamler — metrikker, logs, traces, hændelser, monitorer, Kubernetes- og Docker-ressourcer — til én side, som nogen kan kigge på og forstå et systems sundhed.

Læg et diagram for request-latens ved siden af en liste over åbne hændelser ved siden af en måler for CPU-udnyttelse ved siden af en statussætning i klart sprog. Gem det. Del linket.

## I et hurtigt overblik

- **Top-niveau funktion** i OneUptime-dashboardet under **Dashboards**.
- **Grid-baseret lærred** — 12 enheder bredt og 60 enheder højt som standard. Træk widgets ind, ændr størrelse, snap til gitter.
- **20+ widget-typer** — diagrammer, enkeltværdier, målere, tabeller, tekstblokke, log-streams, trace-lister og live ressourcelister for hændelser, alarmer, monitorer, Kubernetes (pods, nodes, deployments, …), Docker og hosts.
- **Variabler og filtre** — gør et enkelt dashboard til en skabelonvisning, der genbruges for hver klynge, service, kunde eller miljø.
- **Offentlig deling** — vip en kontakt, og dashboardet er tilgængeligt på en offentlig URL, med valgfri adgangskodebeskyttelse og IP-allowlisting.
- **Brugerdefinerede domæner** — host et offentligt dashboard på `status.your-domain.com` i stedet for OneUptimes.

## Hvorfor bruge dashboards?

Dashboards er deres penge værd, når en af disse er sande:

- **Du har brug for en "er alt OK?"-side** til en on-call-rotation, et team-standup eller en CEO, der går forbi tv-væggen.
- **Du har brug for at korrelere signaler** — en CPU-spike i samme minut som en stigning i trace-latens og en åben hændelse er langt mere åbenlyst på ét dashboard end på tværs af tre faner.
- **Du undersøger** — et frit dashboard, du bygger under en fejlsøgningssession, er hurtigere end at køre ti forespørgsler i hånden.
- **Du publicerer eksternt** — et kundevendt performance-dashboard, en partnervendt opsummering, en offentlig sundhedstavle for en open source-tjeneste.

## Nøglebegreber

| Begreb | Betydning |
| --- | --- |
| **Dashboard** | Lærredet. En navngiven, genbrugelig visning, der indeholder en liste af widgets, en tidsinterval-styring og et sæt variabler. |
| **Widget** | En komponent på lærredet — et diagram, en værdi, en tabel, en tekstblok, en liste. Hver har en type og en JSON-stil konfiguration. |
| **Dashboard-enhed** | Gitter-firkanten. Widgets måles i dashboard-enheder (f.eks. "4 brede × 6 høje"). Enheder konverteres til pixels ud fra viewporten. |
| **Variabel** | En navngiven værdi, som den, der ser, vælger fra en dropdown (eller taster), og som dashboardet injicerer i hver widgets forespørgsel. Klynge, service, kunde, miljø — alt, du ville filtrere på. |
| **Tidsinterval** | Det tidsvindue, hver widget forespørger mod. Vælg en preset ("seneste 24 timer") eller et brugerdefineret interval. |
| **Opdateringsinterval** | Hvor ofte widgets gen-forespørger i **View**-tilstand. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Tilstand** | `Edit` (træk, størrelse, konfigurér) eller `View` (læseorienteret). De to deler samme lærred. |

## Widget-kataloget

Et ikke-udtømmende kort over, hvad du kan lægge på et dashboard:

| Kategori | Widgets |
| --- | --- |
| **Tidsserie** | Chart |
| **Enkelt-tal** | Value, Gauge |
| **Tabel** | Table |
| **Annotering** | Text |
| **Logs & traces** | LogStream, TraceList |
| **Driftslister** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastruktur** | HostList |

For hver enkelt widgets argumenter og hvornår du skal gribe til den, se [Dashboard-widgets](/docs/dashboards/widgets).

## Hvor dashboards bor i dashboardet

| Side | Hvad du laver der |
| --- | --- |
| **Dashboards** | Gennemse, oprette, søge, mærke dashboards. |
| **Et dashboard → View** | Lærredet — Edit-tilstand for forfattere, View-tilstand for alle andre. Skift mellem dem i toppen. |
| **Et dashboard → Overview** | Beskrivelse, ejerskab, labels. |
| **Et dashboard → Settings** | Offentlig deling, master-adgangskode, IP-allowlist, brugerdefinerede domæner, branding (sidetitel, beskrivelse, logo, favicon). |
| **Et dashboard → Owners** | Brugere og teams med eksplicit ejerskab. |
| **Et dashboard → Delete** | Fjern dashboardet (uigenkaldeligt). |

## Et dashboards livscyklus

1. **Opret** — Under **Dashboards → Create Dashboard** giver du det et navn. Lærredet åbner tomt.
2. **Træk widgets ind** — Fra widget-paletten vælger du en type, konfigurerer dens kilde (en metrik-forespørgsel, et listefilter, en fri tekst-body). Placér og ændr størrelse.
3. **(Valgfrit) Tilføj variabler** — Definér en dropdown som `cluster` eller `service`, så samme dashboard rendres for hver værdi.
4. **Sæt tidsinterval og opdateringsinterval** — Standarderne virker fint; finjustér dem senere.
5. **(Valgfrit) Del offentligt** — Under **Settings** vipper du **Public Dashboard** til. Tilføj en master-adgangskode, hvis du vil have en port, eller begræns via IP.
6. **(Valgfrit) Brugerdefineret domæne** — Tilføj en `dashboard.your-domain.com`-record og verificér DNS, og servér så dashboardet på din egen URL.

## Et gennemarbejdet eksempel

Mål: en on-call-side for checkout-servicen med latens, fejlrate, åbne hændelser og en nylig log-hale.

1. Opret et dashboard "Checkout oncall."
2. Tilføj en `service`-variabel af typen **Telemetry Attribute** bundet til attributnøglen `service.name`. Standardværdi `checkout`.
3. Tilføj en **Chart**-widget: P95-latens fra din APM-metrik, filtreret på `service.name = {{service}}`. Tidsintervallet følger dashboardet.
4. Ved siden af tilføjer du en **Value**-widget: fejlrate-procentdel med en advarselstærskel ved 1% og en kritisk tærskel ved 5%.
5. Nedenunder tilføjer du en **IncidentList**-widget filtreret på labels, der inkluderer `checkout`.
6. Nedenunder det, en **LogStream**-widget filtreret på `service.name = {{service}}`.
7. Gem. Skift variabel-dropdownen til `payments` — hele dashboardet rendres igen for payments-servicen. Samme skabelon, andet filter.

## Hvordan dashboards passer ind i resten af OneUptime

- **Monitorer og telemetri** fodrer dashboards med rådata — hver metrik, du har konfigureret, hver loglinje, du har indtaget, hver trace-span er forespørgbart på en widget.
- **Hændelser og alarmer** dukker op i **IncidentList**- og **AlertList**-widgets — dashboards er læseorienterede visninger over dem; opret/redigér de entiteter andetsteds.
- **Statussider** er et kundevendt kommunikationsværktøj ("er systemet oppe lige nu?"). Dashboards er et analytisk værktøj ("hvordan opfører systemet sig i detaljer?"). De to supplerer hinanden, ikke erstatter.
- **Workflows** er skrivesiden af OneUptime — dashboards er læsesiden.

## Læs videre

- [Opret et dashboard](/docs/dashboards/authoring) — brug af lærredet, gitteret, edit vs view-tilstand.
- [Dashboard-widgets](/docs/dashboards/widgets) — kataloget og konfiguration pr. widget.
- [Dashboard-variabler & filtre](/docs/dashboards/variables) — at skabelongøre et dashboard, så det virker for mange services / kunder / klynger.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — offentlige URL'er, master-adgangskode, IP-allowlist, brugerdefinerede domæner.
- [Dashboard-konfiguration & tilladelser](/docs/dashboards/configuration) — ejerskab, labels, bevaring, rollebaseret adgang.
