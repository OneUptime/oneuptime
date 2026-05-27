# Oversikt over dashbord

Dashbord gjør dataene OneUptime allerede samler inn — metrikker, logger, sporinger, hendelser, monitorer, Kubernetes-ressurser, hoster — om til én enkelt side noen kan kaste et blikk på og forstå hva som foregår.

Plasser et diagram for forespørselslatens ved siden av en liste over åpne hendelser, ved siden av en måler for CPU, ved siden av et avsnitt med kontekst. Lagre det. Del lenken.

## Hva dashbord er gode til

- **En "er alt OK?"-side** — for vakthavende, et team-standup eller en vegg-TV.
- **Å oppdage sammenhenger** — en CPU-topp samtidig med en latensøkning og en åpen hendelse er mye lettere å se på én side enn på tvers av tre faner.
- **Å undersøke** — når du feilsøker, slår et dashbord du bygger på sparket ti spørringer kjørt én om gangen.
- **Å dele eksternt** — en kundevendt ytelsesside, en partner-statusside, et offentlig dashbord for et open source-prosjekt.

## Hva du kan ha på et dashbord

- **Diagrammer** for trender over tid — latens, feil, gjennomstrømning.
- **Enkeltverdifliser og målere** — nåværende feilrate, CPU, åpne hendelser.
- **Tabeller** for nedbrytninger — topp 10 mest støyende hoster, feilantall per tjeneste.
- **Tekstblokker** for overskrifter, kontekst og lenker til runbooks.
- **Live lister** over hendelser, varsler, monitorer, logger, sporinger, Kubernetes-ressurser, Docker-ressurser og hoster.

Se [Widgets](/docs/dashboards/widgets) for hele listen og hva hver enkelt viser.

## Sentrale begreper

| Begrep | Betydning |
| --- | --- |
| **Dashbord** | Hele siden — et navn, et rutenett med widgets, tidsperiodekontroller og en liste over variabler. |
| **Widget** | Én flis på siden — et diagram, et tall, en liste, et avsnitt. |
| **Variabel** | En nedtrekksliste øverst som filtrerer hver widget samtidig (klynge, tjeneste, kunde, miljø). |
| **Tidsperiode** | Tidsvinduet hvert diagram og tall bruker. Sett det én gang øverst på siden. |
| **Oppdatering** | Hvor ofte widgets spør etter data på nytt. Av, hvert par sekunder, hvert par minutter. |
| **Modus** | Enten **Rediger** (dra widgets rundt) eller **Vis** (kun lesing, slik besøkende ser det). |

## Hvor du finner dashbord

Åpne **Dashbord** i venstre navigasjon.

| Side | Hva du gjør der |
| --- | --- |
| **Dashbord** | Listen over dashbordene dine. Opprett et nytt, søk eller filtrer etter etikett. |
| **Dashbord → Vis** | Lerretet. Veksle mellom **Rediger** og **Vis** i headeren. |
| **Dashbord → Oversikt** | Beskrivelse, eiere og etiketter. |
| **Dashbord → Innstillinger** | Offentlig deling, passord, IP-tillatelse, egendefinert domene, merkevarebygging. |
| **Dashbord → Eiere** | Brukere og team med eksplisitt tilgang. |
| **Dashbord → Slett** | Fjern dashbordet. |

## Bygge et dashbord

1. **Opprett** — velg et navn. Lerretet åpnes tomt.
2. **Legg til widgets** — velg en widget-type, konfigurer dataene, dra det dit du vil.
3. **(Valgfritt) Legg til variabler** — for eksempel en `service`-nedtrekksliste slik at det samme dashbordet fungerer for hver tjeneste.
4. **Sett tidsperioden** — standardene holder; juster senere.
5. **(Valgfritt) Del offentlig** — vri på bryteren i Innstillinger, legg til et passord eller IP-tillatelsesliste om nødvendig.
6. **(Valgfritt) Egendefinert domene** — host dashbordet på `status.your-domain.com`.

## Et raskt eksempel

Mål: en vakthavende-side for checkout-tjenesten med latens, feilrate, åpne hendelser og en live loggtail.

1. Opprett et dashbord kalt "Checkout vakthavende."
2. Legg til en `service`-variabel. Sett standarden til `checkout`.
3. Legg til en **Diagram**-widget med P95-latens, filtrert etter `service`-variabelen.
4. Ved siden av legg til en **Verdi**-widget for feilrate, med advarsel ved 1 % og kritisk ved 5 %.
5. Under legg til en **Hendelsesliste**-widget for hendelser merket `checkout`.
6. Under det, en **Loggstrøm**-widget som viser logger fra samme tjeneste.
7. Lagre. Bytt nedtrekkslisten til `payments` — det samme dashbordet viser nå payments-tjenesten.

## Hvordan dashbord passer sammen med resten av OneUptime

- **Monitorer og telemetri** er kildene til data. Hver metrikk, logg og sporing du samler inn kan spørres på en widget.
- **Hendelser og varsler** dukker opp i widgetene **Hendelsesliste** og **Varselliste**. Dashbord er skrivebeskyttet for disse — opprett og oppdater dem andre steder.
- **Statussider** er kundevendt kommunikasjon ("er systemet oppe?"). Dashbord er for å se på hvordan systemet oppfører seg i detalj. De to fungerer sammen, de erstatter ikke hverandre.
- **Arbeidsflyter** er hvordan OneUptime tar handling. Dashbord er hvordan du leser hva som skjer.

## Hvor du leser videre

- [Lage et dashbord](/docs/dashboards/authoring) — å bruke lerretet, redigere widgets.
- [Widgets](/docs/dashboards/widgets) — den fullstendige listen over widgets.
- [Variabler & filtre](/docs/dashboards/variables) — å få et dashbord til å fungere for mange tjenester eller kunder.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — offentlige URL-er, passord, IP-tillatelsesliste, egendefinerte domener.
- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — eiere, etiketter, tilgangskontroll.
