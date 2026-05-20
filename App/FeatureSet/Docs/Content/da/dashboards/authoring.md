# Opret et dashboard

Opret et dashboard under **Dashboards → Create Dashboard**, giv det et navn, og åbn det. Lærredet åbner i **Edit**-tilstand, klar til widgets.

## Lærredet

Et dashboard er et gitter. Standard-lærredet er **12 dashboard-enheder bredt** og **60 enheder højt** — du kan udvide højden ved at tilføje rækker forbi bunden. Hver enhed er en firkant, der skalerer med viewporten: på en desktop er den bredere end på en telefon, men hver widget bevarer sine proportioner.

Widgets optager et rektangel af enheder. Du bestemmer både positionen (øverste venstre hjørne, målt i enheder fra lærredets øverste venstre hjørne) og størrelsen (bredde og højde i enheder). Minimums-dimensioner sikrer, at en lille widget stadig er læsbar.

## Edit vs. View

Kontakten i sidens header skifter mellem de to tilstande:

- **Edit** — widget-paletten er åben, widgets kan trækkes og ændres i størrelse, hver widget har et indstillingstandhjul. Brug denne, mens du bygger.
- **View** — dashboardet rendres læseorienteret, præcis som nogen med view-only-adgang (eller en offentlig besøgende) ser det. Brug denne til at tjekke resultatet før deling.

Det samme dashboard vises i begge tilstande — der er ikke et separat "publicér"-trin. At gemme en redigering træder i kraft straks for hver seer.

## Tilføj en widget

1. Åbn widget-paletten (**+**-knappen i Edit-tilstand).
2. Vælg widget-typen. Se [Dashboard-widgets](/docs/dashboards/widgets) for kataloget.
3. Widgeten lander på lærredet på den næste frie position med en standardstørrelse.
4. Klik på widgetens tandhjul for at åbne dens indstillingspanel.
5. Konfigurér datakilden (metrik-forespørgsel, listefilter, tekst-body osv.) og eventuelle visningsmuligheder (tærskler, enheder, akser, kolonner).
6. Træk widgeten for at placere den. Træk i et hjørne for at ændre størrelse.

Gentag. Gitteret snapper widgets til hele enhedsgrænser.

## Konfigurér datakilder

De fleste widgets læser fra ét af tre steder:

- **Metrikker** — en ClickHouse-baseret metrik-forespørgsel. Widgeten bygger en `metricQueryConfig` (en enkelt serie) eller `metricQueryConfigs` (flere serier stablet eller overlejret). Valgfri `transformAsRate` konverterer en kumulativ OpenTelemetry-tæller til en ændringsrate. Valgfri `formula` lader dig kombinere to forespørgsler (f.eks. fejl-antal / totalt antal).
- **Live ressourcelister** — hændelser, alarmer, monitorer, Kubernetes-ressourcer, Docker-ressourcer, hosts. Hver liste-widget tager et filter (f.eks. labels, status, namespace) og viser de matchende rækker live.
- **Statisk indhold** — **Text**-widgeten tager en Markdown-body. Brug den til overskrifter, dividers, runbook-links og "hvad er dette dashboard?"-annoteringer.

For metrik-widgets spejler konfigurationen den inline-forespørgselsbygger, du ser andre steder i OneUptime — vælg en metrik, vælg en aggregering, tilføj `WHERE`-filtre, vælg en tidsgruppering. Forespørgslen kører mod dit projekts telemetri-data.

## Tærskler og formatering

Widgets, der viser et enkelt tal (**Value**, **Gauge**), tager valgfrie tærskler:

- **Advarselstærskel** — rendér værdien i gult, når den krydser denne.
- **Kritisk tærskel** — rendér værdien i rødt, når den krydser denne.

Diagrammer lader dig sætte Y-aksens enhed, legendens position og om serier skal stables. Tabeller lader dig vælge, hvilke kolonner der skal vises, og række-grænsen.

## Tidsinterval og opdatering

Dashboardets header bærer to globale styringer, der påvirker hver metrik-widget:

- **Tidsinterval** — vælg en preset (seneste 1 time, 24 timer, 7 dage, 30 dage) eller et brugerdefineret interval. Hver metrik-widget forespørger mod dette vindue.
- **Opdateringsinterval** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Genkører hver widgets forespørgsel på den valgte kadence. Liste-widgets, der nativt understøtter websockets, opdaterer ved push uanset det valgte interval.

For widgets, der ignorerer det globale tidsinterval (f.eks. en tekstblok), er styringen en no-op.

## Gem

Lærredet auto-gemmer mens du redigerer. En lille indikator i toppen fortæller dig, hvornår den seneste ændring er gemt. Der er intet "publicér" — hver redigering er live i det øjeblik, den gemmes. Hvis du laver en risikabel ændring, så duplikér dashboardet først.

## Mønstre, der virker godt

- **Ét emne pr. dashboard.** Modstå fristelsen til at lægge "alt, vi monitorerer" på én side. Tre dashboards mærket `oncall-checkout`, `oncall-payments`, `oncall-search` ældes bedre end ét mega-dashboard.
- **Forankr toppen af siden med den vigtigste widget.** Folk scanner fra toppen — sørg for, at det første, de ser, er svaret på "er dette system sundt?"
- **Brug Text-widgets til at mærke sektioner.** En kort overskrift hver par rækker ("Latens" / "Fejl" / "Kapacitet") gør dashboardet scanbart fra den anden side af rummet.
- **Brug variabler i stedet for at duplikere.** Hvis du tager dig selv i at bygge samme dashboard to gange for to services, så har du brug for en `service`-variabel. Se [Dashboard-variabler & filtre](/docs/dashboards/variables).

## Læs videre

- [Dashboard-widgets](/docs/dashboards/widgets) — kataloget og konfiguration pr. widget.
- [Dashboard-variabler & filtre](/docs/dashboards/variables) — skabelongørelse med variabler, attribut-filtre og tidsinterval.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — at gøre et dashboard tilgængeligt uden for teamet.
- [Dashboard-konfiguration & tilladelser](/docs/dashboards/configuration) — ejerskab og adgangskontrol.
