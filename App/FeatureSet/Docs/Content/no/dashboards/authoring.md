# Lage et dashbord

For å opprette et dashbord, åpne **Dashbord → Opprett dashbord**, gi det et navn, og åpne det. Lerretet åpnes i **Rediger**-modus, klart til at du kan begynne å legge til widgets.

## Lerretet

Et dashbord er et rutenett. Widgets snapper på plass — du bestemmer hvor hver enkelt sitter og hvor stor den er. Du kan utvide siden nedover etter hvert som du legger til flere rader. Hver widget beholder proporsjonene sine på større eller mindre skjermer.

## Rediger og Vis

Bryteren i headeren veksler mellom to moduser:

- **Rediger** — widget-paletten er åpen, du kan dra widgets rundt, endre størrelse på dem og klikke på en hvilken som helst widget for å endre innstillingene.
- **Vis** — dashbordet er skrivebeskyttet, nøyaktig slik besøkende og andre teammedlemmer ser det. Bruk dette for å sjekke resultatet før du deler.

Det er det samme dashbordet i begge modusene. Det er ingen separat "publiser"-steg — hver redigering er live i det øyeblikket den lagres.

## Legge til en widget

1. Klikk **+**-knappen for å åpne widget-paletten.
2. Velg widget-typen. Se [Widgets](/docs/dashboards/widgets) for katalogen.
3. Widgeten dukker opp på lerretet.
4. Klikk på tannhjul-ikonet på widgeten for å åpne innstillingene.
5. Velg datakilden (en metrikk, et listefilter, et avsnitt med tekst osv.) og eventuelle visningsalternativer.
6. Dra widgeten for å flytte den. Dra et hjørne for å endre størrelse.

## Hvor data kommer fra

De fleste widgets leser fra ett av tre steder:

- **Metrikker** — velg en metrikk og en aggregasjon (gjennomsnitt, maks, antall, persentil). Legg til filtre. Velg hvordan resultatet skal grupperes. Dette er den samme spørringsbyggeren du ser andre steder i OneUptime.
- **Live lister** — hendelser, varsler, monitorer, Kubernetes-pods, Docker-containere, hoster. Hver listewidget tar et filter og viser de samsvarende elementene, oppdatert live.
- **Statisk innhold** — **Tekst**-widgeten tar en blokk med Markdown. Bruk den for overskrifter, kontekst, lenker til runbooks eller midlertidige notater under en hendelse.

## Terskler og formatering

Enkeltverdi-widgets (**Verdi**, **Måler**) lar deg sette:

- En **advarselsterskel** — fargen blir gul når verdien krysser den.
- En **kritisk terskel** — fargen blir rød når verdien krysser den.

Diagrammer lar deg sette Y-akse-enheten, velge hvor forklaringen skal plasseres, og velge om serier skal stables oppå hverandre eller overlegges. Tabeller lar deg velge hvilke kolonner som skal vises og hvor mange rader.

## Tidsperiode og oppdatering

Øverst på dashbordet påvirker to kontroller hver metrikk-widget:

- **Tidsperiode** — en forhåndsinnstilling (siste time, 24 timer, 7 dager, 30 dager) eller et egendefinert område. Hvert diagram og tall bruker dette vinduet.
- **Oppdatering** — hvor ofte widgets spør på nytt. Av, 5s, 10s, 30s, 1m, 5m, 15m. Live lister oppdateres på egen hånd uavhengig av denne innstillingen.

Widgets som ikke bruker tidsperioden (som en Tekst-widget) ignorerer begge kontrollene.

## Lagring

Lerretet lagrer på egen hånd mens du arbeider. En liten indikator i headeren forteller deg når den siste endringen er lagret. Hvis du gjør en stor endring, dupliser dashbordet først slik at du har en trygg kopi.

## Tips for dashbord som eldes godt

- **Ett emne per dashbord.** Motstå fristelsen til å sette "alt vi overvåker" på én side. Noen få fokuserte dashbord slår én gigantisk side.
- **Sett den viktigste widgeten øverst.** Folk skanner fra toppen og ned — gjør det første de ser til svaret på "er dette systemet sunt?"
- **Merk seksjoner med Tekst-widgets.** En kort overskrift hvert par rader ("Latens," "Feil," "Kapasitet") gjør siden skannbar fra den andre siden av rommet.
- **Bruk variabler i stedet for duplisering.** Hvis du er i ferd med å bygge samme dashbord for en annen tjeneste, bygg ett dashbord med en `service`-variabel i stedet. Se [Variabler & filtre](/docs/dashboards/variables).

## Hvor du leser videre

- [Widgets](/docs/dashboards/widgets) — katalogen.
- [Variabler & filtre](/docs/dashboards/variables) — variabler, filtre og tidsperioden.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — å dele utenfor teamet ditt.
- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — eiere og tilgangskontroll.
