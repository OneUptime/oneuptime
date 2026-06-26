# Widgets

En widget er én flis på et dashbord. Denne siden lister hver widget du kan legge til, hva den viser og når du skal gripe til den.

For hvordan du drar widgets rundt på lerretet, se [Lage et dashbord](/docs/dashboards/authoring).

## Diagrammer og tall

### Diagram

Et linje-, søyle- eller arealdiagram av én eller flere metrikkserier over dashbordets tidsperiode.

**Innstillinger**:

- Én eller flere metrikkspørringer.
- En valgfri formel som kombinerer to spørringer (for eksempel `errors / total * 100` for å få en feilrate).
- Et "vis som rate"-alternativ for kumulative tellere som vokser uten å nullstille seg.
- Visningsalternativer: stablet eller overlagt, Y-akse-enhet, plassering av forklaring, diagramtype.

Bruk det når: trender betyr noe. Latens over tid, feilantall, kødybde, alt der formen på linjen forteller historien.

### Verdi

Ett stort tall med valgfrie fargede terskler.

**Innstillinger**:

- En metrikkspørring som gir tilbake ett tall (siste verdi, gjennomsnitt eller maks over tidsperioden).
- En valgfri **advarselsterskel** (gul over).
- En valgfri **kritisk terskel** (rød over).
- Tallformat og enhet.

Bruk det når: ett tall svarer på spørsmålet. Nåværende feilrate, P95-latens akkurat nå, antall åpne hendelser.

### Måler

En sirkulær måler med et minimum, maksimum, advarselsbånd og kritisk bånd.

**Innstillinger**: en metrikkspørring og de fire grensene.

Bruk det når: verdien passer innenfor et kjent område. CPU-prosent (0–100 %), diskbruk, kø-kapasitet.

### Tabell

En tabell med metrikkresultater, én rad per gruppe.

**Innstillinger**: en metrikkspørring (vanligvis gruppert etter en etikett som host eller tjeneste), kolonnene som skal vises og en rad-grense.

Bruk det når: du vil ha en nedbrytning i stedet for en trend. Topp 10 mest støyende hoster, feilantall per tjeneste, forespørsler per endepunkt.

## Tekst

En statisk blokk med Markdown.

**Innstillinger**: Markdown-kroppen. Overskrifter, lister, lenker, utheving og kodeblokker rendres alle.

Bruk det når: du vil ha en seksjonsoverskrift, et avsnitt med kontekst, en liste med lenker til runbooks eller et midlertidig banner under en hendelse.

## Logger og sporinger

### Loggstrøm

En live tail av loggelinjer som matcher et filter.

**Innstillinger**: loggfiltre (tjeneste, alvorlighetsgrad, attributter) og kolonnene som skal vises.

Bruk det når: du vil se hva applikasjonen sier akkurat nå, uten å forlate dashbordet.

### Sporingsliste

En liste over nylige sporinger som matcher et filter, med varighet, status og tjeneste.

**Innstillinger**: sporingsfiltre (tjeneste, status, attributter).

Bruk det når: du vil ha en liste over nylig aktivitet i stedet for et diagram. Et vanlig mønster er et latensdiagram øverst med en liste over trege sporinger under.

## Live lister

### Hendelsesliste

En live liste over hendelser som matcher et filter.

**Innstillinger**: filtre etter tilstand, alvorlighetsgrad, etiketter, monitor eller team.

Bruk det når: dashbordet svarer på "hva er ødelagt akkurat nå?"

### Varselliste

En live liste over varsler som matcher et filter.

**Innstillinger**: filtre etter tilstand, alvorlighetsgrad, etiketter.

Bruk det når: et teamdashbord sporer varsler på tjenestene sine.

### Monitorliste

En live liste over monitorer og deres nåværende status.

**Innstillinger**: filtre etter monitortype, etiketter eller nåværende tilstand.

Bruk det når: du vil ha en flåtevisning — "er alle nettstedene oppe?"

## Kubernetes ressurslister

For prosjekter med en [Kubernetes Agent](/docs/monitor/kubernetes-agent) installert. Hver tar valgfrie filtre for klynge, namespace og etiketter.

- **Kubernetes Pod-liste** — pods med fasen sin, omstarter og node.
- **Kubernetes Node-liste** — noder med tilstandene sine og kapasitet.
- **Kubernetes Namespace-liste** — namespaces og arbeidsmengde-antall.
- **Kubernetes Deployment-liste** — deployments med ønskede vs. klare replikaer.
- **Kubernetes StatefulSet-liste** — stateful sets med klare replikaer.
- **Kubernetes DaemonSet-liste** — daemon sets med ønsket vs. klar.
- **Kubernetes Job-liste** — jobber og fullføringsstatus.
- **Kubernetes CronJob-liste** — cron-jobber med tidsplan og siste kjøring.

Bruk disse når: du vil ha ett enkelt dashbord som blander Kubernetes-tilstand med telemetri fra disse arbeidsmengdene.

## Docker ressurslister

For prosjekter med Docker-overvåking satt opp.

- **Docker Host-liste** — hoster som kjører Docker, med antall containere.
- **Docker Container-liste** — containere med tilstand, image, host, oppetid.
- **Docker Image-liste** — images og størrelsene deres.
- **Docker Network-liste** — Docker-nettverk og tilkoblede containere.
- **Docker Volume-liste** — Docker-volumer og bruken deres.

## Infrastruktur

### Host-liste

Hoster overvåket av OneUptimes server-monitor, med status, CPU, minne og oppetid.

**Innstillinger**: filtre etter etiketter eller nåværende tilstand.

## Hvilken widget bør jeg bruke?

Noen raske regler:

- **Trend over tid?** Diagram.
- **Ett tall som betyr noe akkurat nå?** Verdi (eller Måler hvis den har en tydelig min/maks).
- **Nedbrytning på tvers av mange ting?** Tabell.
- **Hva som skjer i systemet akkurat nå?** Loggstrøm, Sporingsliste, Hendelsesliste.
- **Tilstanden til en spesifikk gruppe ressurser?** Den tilsvarende listewidgeten.
- **En overskrift, et avsnitt eller en lenke?** Tekst.

De fleste dashbord blander noen få — et diagram øverst, en verdi eller to ved siden av, en tekstdeler, og en liste eller to under.

## Hvor du leser videre

- [Variabler & filtre](/docs/dashboards/variables) — å gjøre widgets gjenbrukbare for mange tjenester eller kunder.
- [Lage et dashbord](/docs/dashboards/authoring) — lerret-mekanikken.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — å dele utenfor teamet ditt.
