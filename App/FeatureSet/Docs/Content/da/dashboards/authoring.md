# Opret et dashboard

For at oprette et dashboard åbner du **Dashboards → Create Dashboard**, giver det et navn og åbner det. Lærredet åbner i **Edit**-tilstand, klar til at du begynder at tilføje widgets.

## Lærredet

Et dashboard er et net. Widgets snapper på plads — du beslutter, hvor hver enkelt sidder, og hvor stor den er. Du kan udvide siden nedad, efterhånden som du tilføjer flere rækker. Hver widget bevarer sine proportioner på større eller mindre skærme.

## Edit og View

Kontakten i headeren skifter mellem to tilstande:

- **Edit** — widget-paletten er åben, du kan trække widgets rundt, ændre størrelse og klikke på enhver widget for at ændre dens indstillinger.
- **View** — dashboardet er read-only, præcis sådan som besøgende og andre teammedlemmer ser det. Brug denne til at tjekke resultatet, før du deler.

Det er samme dashboard i begge tilstande. Der er ikke noget separat "publicer"-skridt — hver redigering er live i det øjeblik, den gemmes.

## Tilføj en widget

1. Klik på knappen **+** for at åbne widget-paletten.
2. Vælg widget-typen. Se [Widgets](/docs/dashboards/widgets) for kataloget.
3. Widget'en dukker op på lærredet.
4. Klik på tandhjuls-ikonet på widget'en for at åbne dens indstillinger.
5. Vælg datakilden (en metrik, et listefilter, et stykke tekst osv.) og eventuelle visningsmuligheder.
6. Træk widget'en for at flytte den. Træk i et hjørne for at ændre størrelse.

## Hvor data kommer fra

De fleste widgets læser fra ét af tre steder:

- **Metrikker** — vælg en metrik og en aggregering (gennemsnit, max, antal, percentil). Tilføj filtre. Vælg, hvordan resultatet skal grupperes. Det er den samme query-builder, du ser andre steder i OneUptime.
- **Live-lister** — hændelser, alarmer, monitorer, Kubernetes-pods, Docker-containere, hosts. Hver liste-widget tager et filter og viser de matchende elementer, opdateret live.
- **Statisk indhold** — **Text**-widget'en tager en blok Markdown. Brug den til overskrifter, kontekst, links til runbooks eller midlertidige noter under en hændelse.

## Tærskler og formatering

Enkeltværdi-widgets (**Value**, **Gauge**) lader dig sætte:

- En **warning-tærskel** — farven bliver gul, når værdien krydser den.
- En **critical-tærskel** — farven bliver rød, når værdien krydser den.

Diagrammer lader dig sætte Y-aksens enhed, vælge hvor legenden skal være, og vælge om serier skal stables oven på hinanden eller overlejres. Tabeller lader dig vælge, hvilke kolonner der skal vises, og hvor mange rækker.

## Tidsinterval og refresh

I toppen af dashboardet påvirker to kontroller hver metrik-widget:

- **Tidsinterval** — en forudindstilling (sidste time, 24 timer, 7 dage, 30 dage) eller et brugerdefineret interval. Hvert diagram og tal bruger dette vindue.
- **Refresh** — hvor ofte widgets re-forespørger. Slukket, 5s, 10s, 30s, 1m, 5m, 15m. Live-lister opdaterer sig selv uanset denne indstilling.

Widgets, der ikke bruger tidsintervallet (som en Text-widget), ignorerer begge kontroller.

## Gem

Lærredet gemmer af sig selv, mens du arbejder. En lille indikator i headeren fortæller dig, hvornår den seneste ændring er gemt. Hvis du foretager en stor ændring, så duplicér dashboardet først, så du har en sikker kopi.

## Tips til dashboards, der ældes godt

- **Ét emne pr. dashboard.** Modstå fristelsen til at sætte "alt vi overvåger" på én side. Et par fokuserede dashboards slår en gigantisk side.
- **Sæt den vigtigste widget øverst.** Folk scanner oppefra og ned — gør det første, de ser, til svaret på "er dette system sundt?"
- **Mærk sektioner med Text-widgets.** En kort overskrift hver par rækker ("Latency," "Errors," "Capacity") gør siden læsbar på tværs af rummet.
- **Brug variabler i stedet for at duplikere.** Hvis du er ved at bygge det samme dashboard til en anden service, så byg ét dashboard med en `service`-variabel i stedet. Se [Variabler & filtre](/docs/dashboards/variables).

## Læs videre

- [Widgets](/docs/dashboards/widgets) — kataloget.
- [Variabler & filtre](/docs/dashboards/variables) — variabler, filtre og tidsintervallet.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — at dele uden for dit team.
- [Konfiguration & tilladelser](/docs/dashboards/configuration) — ejere og adgangskontrol.
