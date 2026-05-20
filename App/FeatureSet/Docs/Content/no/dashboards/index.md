# Oversikt over dashbord

Dashbord er hvordan du gjør telemetrien OneUptime allerede samler inn — metrikker, logger, sporinger, hendelser, monitorer, Kubernetes- og Docker-ressurser — om til én enkelt side noen kan kaste et blikk på og forstå helsen til et system.

Slipp et diagram for forespørselslatens ved siden av en liste over åpne hendelser ved siden av en måler for CPU-bruk ved siden av en statussetning på naturlig norsk. Lagre. Del lenken.

## Et raskt overblikk

- **Toppnivåfunksjon** i OneUptime-dashbordet under **Dashbord**.
- **Rutenettbasert lerret** — 12 enheter bredt × 60 enheter høyt som standard. Dra widgets inn, endre størrelse, snap til rutenettet.
- **20+ widget-typer** — diagrammer, enkeltverdier, målere, tabeller, tekstblokker, loggstrømmer, sporingslister og live ressurslister for hendelser, varsler, monitorer, Kubernetes (pods, noder, deployments, …), Docker og hoster.
- **Variabler og filtre** — gjør et enkelt dashbord om til en mal-visning som gjenbrukes for hver klynge, tjeneste, kunde eller miljø.
- **Offentlig deling** — slå på en bryter og dashbordet er tilgjengelig på en offentlig URL, med valgfri passordbeskyttelse og IP-tillatelse.
- **Egendefinerte domener** — host et offentlig dashbord på `status.your-domain.com` i stedet for OneUptimes.

## Hvorfor bruke dashbord?

Dashbord gjør seg fortjent når én av disse stemmer:

- **Du trenger en "er alt OK?"-side** for en oncall-rotasjon, et team-standup eller en CEO som går forbi vegg-TV-en.
- **Du trenger å korrelere signaler** — en CPU-topp i samme minutt som en økning i sporings-latens og en åpen hendelse er langt mer åpenbar på ett dashbord enn på tvers av tre faner.
- **Du undersøker** — et frittflytende dashbord du bygger under en feilsøkingsøkt er raskere enn å kjøre ti spørringer for hånd.
- **Du publiserer eksternt** — et kundevendt ytelses-dashbord, et partner-vendt rollup, et offentlig helsetavle for en open-source-tjeneste.

## Sentrale begreper

| Begrep | Betydning |
| --- | --- |
| **Dashbord** | Lerretet. En navngitt, gjenbrukbar visning som inneholder en liste over widgets, en tidsperiodekontroll og et sett med variabler. |
| **Widget** | Én komponent på lerretet — et diagram, en verdi, en tabell, en tekstblokk, en liste. Hver har en type og en JSON-stil konfigurasjon. |
| **Dashbord-enhet** | Rutenettkvadratet. Widgets er dimensjonert i dashbord-enheter (f.eks. "4 bred × 6 høy"). Enheter konverteres til piksler basert på visningsvinduet. |
| **Variabel** | En navngitt verdi som seeren velger fra en nedtrekksmeny (eller skriver) og dashbordet injiserer i hver widgets spørring. Klynge, tjeneste, kunde, miljø — alt du ville filtrert på. |
| **Tidsperiode** | Tidsvinduet hver widget spør mot. Velg en forhåndsinnstilling ("siste 24 timer") eller en egendefinert periode. |
| **Oppdateringsintervall** | Hvor ofte widgets spør på nytt i **Visnings**-modus. Av, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modus** | `Rediger` (dra, endre størrelse, konfigurer) eller `Vis` (skrivebeskyttet). De to deler samme lerret. |

## Widget-katalogen

Et ikke-uttømmende kart over hva du kan legge på et dashbord:

| Kategori | Widgets |
| --- | --- |
| **Tidsserier** | Chart |
| **Enkelttall** | Value, Gauge |
| **Tabellform** | Table |
| **Annotering** | Text |
| **Logger & sporinger** | LogStream, TraceList |
| **Operasjonelle lister** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastruktur** | HostList |

For argumenter og når du skal gripe til hver enkelt, se [Widgets](/docs/dashboards/widgets).

## Hvor dashbord bor i dashbordet

| Side | Hva du gjør der |
| --- | --- |
| **Dashbord** | Bla, opprette, søke, merke dashbord. |
| **Et dashbord → Vis** | Lerretet — Rediger-modus for forfattere, Vis-modus for alle andre. Veksle mellom dem i toppen. |
| **Et dashbord → Oversikt** | Beskrivelse, eierskap, etiketter. |
| **Et dashbord → Innstillinger** | Offentlig deling, masterpassord, IP-tillatelsesliste, egendefinerte domener, merkevarebygging (sidetittel, beskrivelse, logo, favicon). |
| **Et dashbord → Eiere** | Brukere og team med eksplisitt eierskap. |
| **Et dashbord → Slett** | Fjern dashbordet (uopprettelig). |

## Livssyklusen til et dashbord

1. **Opprett** — Under **Dashbord → Opprett dashbord**, gi det et navn. Lerretet åpnes tomt.
2. **Slipp widgets** — Fra widget-paletten, velg en type, konfigurer kilden (en metrikkspørring, et listefilter, en fri tekstkropp). Posisjoner og endre størrelse.
3. **(Valgfritt) Legg til variabler** — Definer en nedtrekksmeny som `cluster` eller `service` slik at samme dashbord rendres for hver verdi.
4. **Sett tidsperioden og oppdateringsintervallet** — Standarder fungerer fint; juster dem senere.
5. **(Valgfritt) Del offentlig** — Under **Innstillinger**, slå på **Public Dashboard**. Legg til et masterpassord hvis du vil ha en port, eller begrens med IP.
6. **(Valgfritt) Egendefinert domene** — Legg til en `dashboard.your-domain.com`-post og verifiser DNS, og server dashbordet på din egen URL.

## Et gjennomarbeidet eksempel

Mål: en oncall-side for checkout-tjenesten med latens, feilrate, åpne hendelser og en nylig logghale.

1. Opprett et dashbord "Checkout oncall."
2. Legg til en `service`-variabel av typen **Telemetry Attribute** bundet til attributtnøkkelen `service.name`. Standardverdi `checkout`.
3. Legg til en **Chart**-widget: P95-latens fra APM-metrikken din, filtrert etter `service.name = {{service}}`. Tidsperiode følger dashbordet.
4. Ved siden av, legg til en **Value**-widget: feilrate i prosent med en advarselsterskel på 1 % og en kritisk terskel på 5 %.
5. Under, legg til en **IncidentList**-widget filtrert etter etiketter som inkluderer `checkout`.
6. Under det, en **LogStream**-widget filtrert etter `service.name = {{service}}`.
7. Lagre. Endre variabel-nedtrekksmenyen til `payments` — hele dashbordet rendres på nytt for payments-tjenesten. Samme mal, ulikt filter.

## Hvordan dashbord passer inn i resten av OneUptime

- **Monitorer og telemetri** mater dashbord med rådata — hver metrikk du har konfigurert, hver loggelinje du har tatt inn, hvert sporings-span er spørrebart på en widget.
- **Hendelser og varsler** dukker opp i **IncidentList**- og **AlertList**-widgets — dashbord er skrivebeskyttede visninger over dem; opprett/rediger disse entitetene andre steder.
- **Statussider** er et kundevendt kommunikasjonsverktøy ("er systemet oppe akkurat nå?"). Dashbord er et analytisk verktøy ("hvordan oppfører systemet seg i detalj?"). De to er komplementære, ikke erstatninger.
- **Arbeidsflyter** er skrivedelen av OneUptime — dashbord er lesedelen.

## Les videre

- [Opprette et dashbord](/docs/dashboards/authoring) — bruke lerretet, rutenettet, edit-modus vs visnings-modus.
- [Widgets](/docs/dashboards/widgets) — katalogen og konfigurasjon per widget.
- [Variabler & filtre](/docs/dashboards/variables) — male et dashbord slik at det fungerer for mange tjenester / kunder / klynger.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — offentlige URL-er, masterpassord, IP-tillatelsesliste, egendefinerte domener.
- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — eierskap, etiketter, oppbevaring, rollebasert tilgang.
