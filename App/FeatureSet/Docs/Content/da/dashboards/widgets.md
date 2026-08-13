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

## HTML

Din egen HTML, CSS og JavaScript, renderet som en widget.

**Indstillinger**: HTML-body'en, et valgfrit stylesheet, et valgfrit script og tre tilladelser, du kan slå til og fra.

Brug den, når: du har brug for noget, som ingen indbygget widget dækker — et indlejret tredjeparts-badge, en tabel hentet fra et internt API, en brugerdefineret legend, et sæt stylede links ind i dine egne værktøjer.

### Hvad den kan og ikke kan

Widget'en renderes i en sandboxed frame på sin egen isolerede origin. Inde i den frame kan din kode stort set gøre hvad som helst: bygge DOM, køre timere, hente fra en hvilken som helst URL, tegne på et canvas.

Hvad den ikke kan, er at nå ud til OneUptime-siden omkring den. Den har ingen adgang til dashboardets DOM, cookies, local storage eller API-session, og den kan ikke navigere browserfanen væk. Det gælder, uanset om dashboardet er privat eller delt offentligt.

To konsekvenser, det er værd at kende, før du indsætter noget:

- En `fetch` fra widget'en er en cross-origin-forespørgsel fra en opaque origin, så den server, du kalder, skal tillade det med CORS. At kalde OneUptime-API'et herfra er ikke understøttet.
- Widget'en starter gennemsigtig. Sæt en baggrund på `body` i din CSS, hvis du vil have den til at fylde kortet.

### Brug af dashboard-variabler

Skriv `{{variableName}}` hvor som helst i din HTML, CSS eller JavaScript, og det erstattes med den variabels aktuelle værdi, før widget'en renderes. At vælge en ny værdi renderer widget'en igen. En pladsholder, der navngiver en variabel, som ikke findes, efterlades som den er.

Scripts får de samme værdier plus dashboardets tidsinterval på `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // aktuel værdi, eller "" hvis ikke sat
window.ONEUPTIME.startDate; // ISO 8601-streng, start på dashboardets tidsinterval
window.ONEUPTIME.endDate; // ISO 8601-streng, slutningen på det
```

Widget'en genindlæses, hver gang dashboardet opdateres, så en widget, der henter sine egne data, følger med refresh-intervallet.

### Tilladelser

**Run JavaScript** (slået til som standard) kører dit script. Slå den fra for kun at rendere markup og styles — scriptet udelades så helt fra widget'en frem for blot at blive blokeret.

**Open links in a new tab** (slået til som standard) lader links og `window.open` åbne en browserfane. Links åbnes altid i en ny fane; widget'en kan aldrig navigere selve dashboardet.

**Allow forms to submit** (slået fra som standard) lader en `<form>` inde i widget'en indsende.

Enhver, der kan redigere dashboardet, bestemmer, hvad denne widget kører, og alle, der ser dashboardet, kører det — på et offentligt dashboard inkluderer det anonyme besøgende. Behandl redigeringsadgang til et dashboard med en HTML-widget på, som du ville behandle adgang til enhver anden kode, du udgiver.

## Logs og traces

### Log Chart

Et tidsseriediagram over logmængden i dashboardets tidsinterval. Hver serie repræsenterer en alvorlighedsgrad, så fejltoppe skiller sig ud fra normal trafik.

**Indstillinger**:

- Visualisering som søjle-, linje- eller arealdiagram. Søjle- og arealdiagrammer stabler alvorlighedsserierne.
- Valgfrie filtre på alvorlighedsgrad.
- Valgfri tekstsøgning i logteksten.
- Præcise OpenTelemetry-attributfiltre via søgbare nøgle/værdi-rækker. Attributnavne og kendte værdier foreslås, mens du skriver, og egne værdier understøttes stadig.
- En valgfri titel.

Dashboardets tidsinterval- og opdateringskontroller forespørger automatisk diagrammet igen. Dashboardets telemetriattribut-variabler gælder også for det, inklusive multi-select-variabler.

Log Chart kræver i øjeblikket et dashboard med login. Offentlige dashboards viser widgetten som utilgængelig i stedet for at udstille projektets logaggregater anonymt.

Brug den, når: du vil opdage ændringer i logmængden eller sammenligne fejl, advarsler og informationslogs uden at forlade dashboardet.

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

## Serviceniveaumål

### SLO

Ét serviceniveaumål, tegnet enten som et enkelt tal eller som en linje over tid.

**Indstillinger**: hvilket SLO, hvilket af dets tre tal (SLI, Error Budget Remaining eller Burn Rate), visning som Tile eller Chart, og en valgfri titel.

- **Tile** viser det aktuelle tal, plus en anden linje hvor der er en — målet under SLI'en, resterende minutter under fejlbudgettet. En statusmarkering farver det hele.
- **Chart** tegner det samme tal over dashboardets tidsinterval, med målet markeret som en stiplet linje på SLI-serien. Historikken skrives med få minutters mellemrum af evalueringsjobbet, så et helt nyt SLO tegnes som tomt, indtil det er blevet evalueret første gang.

Brug den, når: dashboardet svarer på "lever vi op til det, vi har lovet?" snarere end "hvad sker der lige nu?"

SLO-widgetten virker på [offentlige dashboards](/docs/dashboards/sharing). Det, der publiceres, er SLO'ets vigtigste tal — navn, mål, aktuel SLI, resterende fejlbudget, burn rate og status — uanset hvilket af dem widgetten tilfældigvis tegner. Definitionen forbliver privat: de monitorer, det holder øje med, dets labels, dets beskrivelse, dets forespørgsel og dets evalueringsplan sendes aldrig til en offentlig besøgende. En Tile-widget publicerer kun de aktuelle tal; en Chart-widget publicerer også historikken for den ene serie, den tegner, og intet andet.

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

## Netværk

### Network Map

Dine netværkssites tegnet på verdenskortet, hver placeret på sin egen bredde- og længdegrad og farvet efter den monitorstatus, der er rullet op på den. Sites, der ligger tæt sammen, deler en markør med antallet skrevet inde i den; en markør, der står for præcis ét site, åbner det site, når du klikker på den.

Kortet indrammer sig selv efter de sites, det tegnede — en portefølje inden for ét land fylder rammen med det land, en spredt over kontinenter åbner på verdenskortet. Der er ingen zoom- eller panoreringskontroller: en dashboard-flade er et billede, og Network Map-siden under Network er der, hvor du går gennem hierarkiet.

Over kortet skriver den, hvor mange sites der er nede, for en to pixel stor rød prik blandt to hundrede grønne er ikke noget, nogen læser på dashboard-afstand. Under det fortæller en dækningslinje, hvad kortet _ikke_ viser — sites uden koordinater, og om rækkegrænsen blev nået.

**Indstillinger**: titel, kort- eller listevisning, maksimalt antal tegnede sites, om sitenavne skal skrives, og filtre efter sitetype og status. Sitenavne fjernes automatisk, når kortet bliver for tæt til, at de kan læses; tooltippet navngiver stadig hver markør.

Et site vises kun, hvis det har koordinater. Tilføj bredde- og længdegrad på sitet (eller importér dem fra CSV) for at placere det.

## Hvilken widget skal jeg bruge?

Et par hurtige regler:

- **Tendens over tid?** Chart.
- **Logmængde eller fejltoppe over tid?** Log Chart.
- **Ét tal der betyder noget lige nu?** Value (eller Gauge, hvis det har en klar min/max).
- **Opdeling på tværs af mange ting?** Table.
- **Hvad sker der i systemet lige nu?** Log Stream, Trace List, Incident List.
- **Tilstanden af en specifik gruppe ressourcer?** Den matchende liste-widget.
- **Lever vi op til den pålidelighed, vi har lovet?** SLO.
- **Hvor i verden dit netværk er, og hvad der er rødt?** Network Map.
- **En overskrift, et afsnit eller et link?** Text.
- **Noget, som ingen af ovenstående dækker?** HTML — men først efter du har tjekket, at en indbygget widget virkelig ikke kan klare det.

De fleste dashboards blander et par stykker — et diagram i toppen, en værdi eller to ved siden af, en tekst-adskillelse og en liste eller to nedenunder.

## Læs videre

- [Variabler & filtre](/docs/dashboards/variables) — at gøre widgets genbrugelige for mange services eller kunder.
- [Opret et dashboard](/docs/dashboards/authoring) — lærredsmekanikken.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — at dele uden for dit team.
