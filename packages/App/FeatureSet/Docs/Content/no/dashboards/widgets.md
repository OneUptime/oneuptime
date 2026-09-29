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

## HTML

Din egen HTML, CSS og JavaScript, rendret som en widget.

**Innstillinger**: HTML-kroppen, et valgfritt stilark, et valgfritt skript og tre tillatelsesbrytere.

Bruk det når: du trenger noe ingen innebygd widget dekker — et innebygd merke fra en tredjepart, en tabell hentet fra et internt API, en egendefinert forklaring, et sett med stilsatte lenker inn i dine egne verktøy.

### Hva den kan og ikke kan gjøre

Widgeten rendres i en sandkasse-ramme på sitt eget isolerte origin. Inne i den rammen kan koden din gjøre omtrent hva som helst: bygge DOM, kjøre timere, hente fra hvilken som helst URL, tegne på et canvas.

Det den ikke kan gjøre, er å nå OneUptime-siden rundt seg. Den har ingen tilgang til dashbordets DOM, cookies, local storage eller API-sesjon, og den kan ikke navigere nettleserfanen bort. Dette gjelder enten dashbordet er privat eller delt offentlig.

To konsekvenser som er verdt å vite om før du limer inn noe:

- En `fetch` fra widgeten er en forespørsel på tvers av origin, fra et ugjennomsiktig origin, så serveren du kaller må tillate den med CORS. Å kalle OneUptime-API-et herfra støttes ikke.
- Widgeten starter gjennomsiktig. Sett en bakgrunn på `body` i CSS-en din hvis du vil at den skal fylle kortet.

### Bruke dashbord-variabler

Skriv `{{variableName}}` hvor som helst i HTML-en, CSS-en eller JavaScript-en, så erstattes det med variabelens nåværende verdi før widgeten rendres. Å velge en ny verdi rendrer widgeten på nytt. En plassholder som navngir en variabel som ikke finnes, blir stående som den er.

Skript får de samme verdiene, pluss dashbordets tidsperiode, på `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // nåværende verdi, eller "" hvis den ikke er satt
window.ONEUPTIME.startDate; // ISO 8601-streng, starten på dashbordets tidsperiode
window.ONEUPTIME.endDate; // ISO 8601-streng, slutten på den
```

Widgeten lastes på nytt hver gang dashbordet oppdateres, så en widget som henter sine egne data holder tritt med oppdateringsintervallet.

### Tillatelser

**Run JavaScript** (Kjør JavaScript, på som standard) kjører skriptet ditt. Slå det av for å bare rendre markup og stiler — skriptet blir da utelatt fra widgeten helt, i stedet for bare å bli blokkert.

**Open links in a new tab** (Åpne lenker i en ny fane, på som standard) lar lenker og `window.open` åpne en nettleserfane. Lenker åpnes alltid i en ny fane; widgeten kan aldri navigere selve dashbordet.

**Allow forms to submit** (Tillat at skjemaer sendes inn, av som standard) gjør at et `<form>` inne i widgeten kan sendes inn.

Alle som kan redigere dashbordet bestemmer hva denne widgeten kjører, og alle som ser dashbordet kjører det — på et offentlig dashbord inkluderer det anonyme besøkende. Behandle redigeringstilgang til et dashbord med en HTML-widget slik du ville behandlet tilgang til all annen kode du leverer.

## Logger og sporinger

### Loggdiagram

Et tidsseriediagram over loggvolumet i tidsrommet til dashbordet. Hver serie står for en alvorlighetsgrad, slik at feiltopper skiller seg ut fra normal trafikk.

**Innstillinger**:

- Visualisering som stolpe-, linje- eller arealdiagram. Stolpe- og arealdiagrammer stabler alvorlighetsseriene.
- Valgfrie filtre på alvorlighetsgrad.
- Valgfritt tekstsøk i loggteksten.
- Eksakte OpenTelemetry-attributtfiltre via søkbare nøkkel/verdi-rader. Attributtnavn og kjente verdier foreslås mens du skriver, og egne verdier støttes fortsatt.
- En valgfri tittel.

Tidsrom- og oppdateringskontrollene til dashbordet kjører spørringen for diagrammet på nytt automatisk. Telemetriattributt-variabler på dashbordet gjelder også for det, inkludert flervalgsvariabler.

Loggdiagram krever for øyeblikket et dashbord med innlogging. Offentlige dashbord viser widgeten som utilgjengelig i stedet for å eksponere prosjektets loggaggregater anonymt.

Bruk det når: du vil oppdage endringer i loggvolumet eller sammenligne feil, advarsler og informasjonslogger uten å forlate dashbordet.

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

## Tjenestenivåmål

### SLO

Ett tjenestenivåmål, tegnet enten som ett enkelt tall eller som en linje over tid.

**Innstillinger**: hvilket SLO, hvilket av de tre tallene (SLI, gjenstående feilbudsjett eller burn rate), visning som Flis eller Diagram, og en valgfri tittel.

- **Flis** viser det gjeldende tallet, og en andre linje der det finnes en — målet under SLI-en, minuttene som er igjen under feilbudsjettet. En statusmarkør farger hele widgeten.
- **Diagram** tegner samme tall over tidsrommet til dashbordet, med målet markert som en stiplet linje på SLI-serien. Historikken skrives med noen minutters mellomrom av evalueringsjobben, så et helt nytt SLO tegnes som tomt til det er evaluert for første gang.

Bruk det når: dashbordet svarer på "leverer vi det vi har lovet?" heller enn "hva skjer akkurat nå?"

SLO-widgeten fungerer på [offentlige dashbord](/docs/dashboards/sharing). Det som publiseres, er hovedtallene til SLO-en — navn, mål, gjeldende SLI, gjenstående feilbudsjett, burn rate og status — uansett hvilket av dem widgeten faktisk tegner. Definisjonen holdes privat: monitorene den følger, etikettene, beskrivelsen, spørringen og evalueringsplanen sendes aldri til en offentlig besøkende. En Flis-widget publiserer bare de gjeldende tallene; en Diagram-widget publiserer i tillegg historikken til den ene serien den tegner, og ingenting mer.

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

## Nettverk

### Nettverkskart

Nettverksstedene dine tegnet på verdenskartet, hvert festet til sin egen breddegrad og lengdegrad og farget etter monitorstatusen som er rullet opp på det. Steder som ligger tett, deler en markør med antallet skrevet inni; en markør som står for nøyaktig ett sted, åpner det stedet når du klikker på den.

Kartet rammer seg selv inn etter stedene det tegnet — en portefølje innenfor ett land fyller rammen med det landet, en spredt over kontinenter åpner på verden. Det finnes ingen zoom- eller panoreringskontroller: en dashbordflis er et bilde, og Nettverkskart-siden under Nettverk er der du går gjennom hierarkiet.

Over kartet skriver den hvor mange steder som er nede, for en to piksler stor rød prikk blant to hundre grønne er ikke noe noen leser på dashbordavstand. Under det sier en dekningslinje hva kartet _ikke_ viser — steder uten koordinater, og om radgrensen ble nådd.

**Innstillinger**: tittel, kart- eller listevisning, maksimalt antall tegnede steder, om stedsnavn skal skrives, og filtre etter stedstype og status. Stedsnavn forsvinner automatisk når kartet blir for travelt for at de kan leses; verktøytipset navngir fortsatt hver markør.

Et sted vises bare hvis det har koordinater. Legg til breddegrad og lengdegrad på stedet (eller importer dem fra CSV) for å feste det.

## Hvilken widget bør jeg bruke?

Noen raske regler:

- **Trend over tid?** Diagram.
- **Loggvolum eller feiltopper over tid?** Loggdiagram.
- **Ett tall som betyr noe akkurat nå?** Verdi (eller Måler hvis den har en tydelig min/maks).
- **Nedbrytning på tvers av mange ting?** Tabell.
- **Hva som skjer i systemet akkurat nå?** Loggstrøm, Sporingsliste, Hendelsesliste.
- **Tilstanden til en spesifikk gruppe ressurser?** Den tilsvarende listewidgeten.
- **Leverer vi den påliteligheten vi har lovet?** SLO.
- **Hvor i verden nettverket ditt er, og hva som er rødt?** Nettverkskart.
- **En overskrift, et avsnitt eller en lenke?** Tekst.
- **Noe ingen av widgetene over dekker?** HTML — men bare etter at du har sjekket at en innebygd widget virkelig ikke klarer det.

De fleste dashbord blander noen få — et diagram øverst, en verdi eller to ved siden av, en tekstdeler, og en liste eller to under.

## Hvor du leser videre

- [Variabler & filtre](/docs/dashboards/variables) — å gjøre widgets gjenbrukbare for mange tjenester eller kunder.
- [Lage et dashbord](/docs/dashboards/authoring) — lerret-mekanikken.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — å dele utenfor teamet ditt.
