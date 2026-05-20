# Opprette et dashbord

Opprett et dashbord under **Dashbord → Opprett dashbord**, gi det et navn og åpne det. Lerretet åpnes i **Rediger**-modus, klart for widgets.

## Lerretet

Et dashbord er et rutenett. Standardlerretet er **12 dashbord-enheter bredt** × **60 enheter høyt** — du kan utvide høyden ved å legge til rader forbi bunnen. Hver enhet er et kvadrat som skalerer med visningsvinduet: på en stasjonær er den bredere enn på en telefon, men hver widget beholder proporsjonene sine.

Widgets okkuperer et rektangel av enheter. Du bestemmer både posisjonen (øverst-venstre hjørne, målt i enheter fra øverst-venstre hjørne av lerretet) og størrelsen (bredde og høyde i enheter). Minimumsdimensjoner sikrer at en liten widget fortsatt er lesbar.

## Rediger vs. Vis

Bryteren i sidetoppen veksler mellom de to modusene:

- **Rediger** — widget-paletten er åpen, widgets er dragbare og størrelsesjusterbare, hver widget har et innstillingstannhjul. Bruk dette mens du bygger.
- **Vis** — dashbordet rendres skrivebeskyttet, akkurat som noen med kun-visningstilgang (eller en offentlig besøkende) ser det. Bruk dette for å sjekke resultatet før du deler.

Det samme dashbordet vises i begge modusene — det er ikke noe eget "publiser"-trinn. Å lagre en redigering trer i kraft umiddelbart for hver seer.

## Legge til en widget

1. Åpne widget-paletten (**+**-knappen i Rediger-modus).
2. Velg widget-typen. Se [Widgets](/docs/dashboards/widgets) for katalogen.
3. Widgeten lander på lerretet på neste ledige posisjon med en standardstørrelse.
4. Klikk på widgetens tannhjul for å åpne innstillingspanelet.
5. Konfigurer datakilden (metrikkspørring, listefilter, tekstkropp osv.) og eventuelle visningsalternativer (terskler, enheter, akser, kolonner).
6. Dra widgeten for å posisjonere den. Dra et hjørne for å endre størrelse.

Gjenta. Rutenettet snapper widgets til hel-enhets-grenser.

## Konfigurere datakilder

De fleste widgets leser fra ett av tre steder:

- **Metrikker** — en ClickHouse-støttet metrikkspørring. Widgeten bygger en `metricQueryConfig` (en enkelt serie) eller `metricQueryConfigs` (flere serier stablet eller overlappet). Valgfri `transformAsRate` konverterer en OpenTelemetry kumulativ teller til en endringsrate. Valgfri `formula` lar deg kombinere to spørringer (f.eks. feilantall / totalantall).
- **Live ressurslister** — hendelser, varsler, monitorer, Kubernetes-ressurser, Docker-ressurser, hoster. Hver liste-widget tar et filter (f.eks. etiketter, status, navnerom) og viser de matchende radene live.
- **Statisk innhold** — **Text**-widgeten tar en Markdown-body. Bruk den for overskrifter, skilletegn, runbook-lenker og "hva er dette dashbordet?"-merknader.

For metrikk-widgets speiler konfigurasjonen den innebygde spørrebyggeren du ser andre steder i OneUptime — velg en metrikk, velg en aggregering, legg til `WHERE`-filtre, velg en tidsgruppering. Spørringen kjører mot prosjektets telemetridata.

## Terskler og formatering

Widgets som viser et enkelt tall (**Value**, **Gauge**) tar valgfrie terskler:

- **Advarselsterskel** — render verdien i gult når den krysser denne.
- **Kritisk terskel** — render verdien i rødt når den krysser denne.

Diagrammer lar deg sette Y-akse-enheten, forklaringsposisjonen og om serier skal stables. Tabeller lar deg velge hvilke kolonner som vises og radgrensen.

## Tidsperiode og oppdatering

Dashbord-toppen bærer to globale kontroller som påvirker hver metrikk-widget:

- **Tidsperiode** — velg en forhåndsinnstilling (Siste 1 time, 24 timer, 7 dager, 30 dager) eller en egendefinert periode. Hver metrikk-widget spør mot dette vinduet.
- **Oppdateringsintervall** — Av, 5s, 10s, 30s, 1m, 5m, 15m. Kjør hver widgets spørring på nytt på den valgte takten. Liste-widgets som naturlig støtter websockets oppdateres på push uavhengig av valgt intervall.

For widgets som ignorerer den globale tidsperioden (f.eks. en tekstblokk) er kontrollen en no-op.

## Lagring

Lerretet lagrer automatisk mens du redigerer. En liten indikator i toppen forteller deg når siste endring er persistert. Det er ikke noe "publiser" — hver redigering er live i øyeblikket den lagres. Hvis du gjør en risikabel endring, dupliser dashbordet først.

## Mønstre som fungerer godt

- **Ett tema per dashbord.** Motstå fristelsen til å legge "alt vi overvåker" på én side. Tre dashbord merket `oncall-checkout`, `oncall-payments`, `oncall-search` eldes bedre enn ett mega-dashbord.
- **Forankre toppen av siden med den viktigste widgeten.** Folk skanner ovenfra — sørg for at det første de ser er svaret på "er dette systemet sunt?"
- **Bruk Text-widgets for å merke seksjoner.** En kort overskrift med noen rader mellom ("Latens" / "Feil" / "Kapasitet") gjør dashbordet skannerbart fra andre siden av rommet.
- **Bruk variabler i stedet for å duplisere.** Hvis du finner deg selv i å bygge det samme dashbordet to ganger for to tjenester, vil du ha en `service`-variabel. Se [Variabler & filtre](/docs/dashboards/variables).

## Les videre

- [Widgets](/docs/dashboards/widgets) — katalogen og konfigurasjon per widget.
- [Variabler & filtre](/docs/dashboards/variables) — maling med variabler, attributtfiltre og tidsperiode.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — gjøre et dashbord tilgjengelig utenfor teamet.
- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — eierskap og tilgangskontroll.
