# Konfigurasjon & tillatelser

Denne siden samler innstillingene og tilgangskontroll-knottene det er verdt å kjenne til når du har et dashbord du faktisk vil beholde.

## Eierskap

Et dashbords **eiere** er brukerne og teamene som er gitt eksplisitte tillatelser på det (separat fra prosjekt-omfattende rolle).

Under **Dashbord → Eiere**:

- Legg til en **brukereier** for å gi en spesifikk person ekstra tilgang til dette dashbordet.
- Legg til en **team-eier** for å gi det samme til hvert medlem av et team.

Bruk eierskap når den prosjekt-omfattende leserollen er for bred — f.eks. et dashbord med sensitive kundenivå-detaljer som kun skal være synlig for customer-success-teamet.

## Etiketter

Etiketter er mange-til-mange-tags for å organisere dashbord. Bruk dem under **Dashbord → Oversikt**.

Vanlige etikettmønstre:

- **Etter team**: `team:platform`, `team:checkout`, `team:growth`.
- **Etter miljø**: `env:prod`, `env:staging`.
- **Etter formål**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

**Dashbord**-listen lar deg filtrere etter etikett, som er den raskeste måten å finne et dashbord i et prosjekt som har samlet dusinvis.

## Tillatelser

Dashbord er førsteklasses ressurser i OneUptimes rollebaserte tilgangskontroll. De relevante tillatelsene:

| Tillatelse | Tillater |
| --- | --- |
| `CreateDashboard` | Opprette nye dashbord i prosjektet. |
| `ReadDashboard` | Vise dashbord (i privat modus). |
| `EditDashboard` | Modifisere widgets, variabler, innstillinger på et dashbord. |
| `DeleteDashboard` | Slette et dashbord. |

Det finnes matchende tillatelser for de støttende entitetene: dashbord-eiere (bruker / team) og egendefinerte domener har sine egne create / read / edit / delete-par, slik at du kan gi "administrer eiere" uten å gi "rediger selve dashbordet."

Tildel disse på prosjekt-roller under **Project Settings → Teams & Roles**.

## Tilgangskontroll i offentlig modus

Offentlig-modus-tilgang (se [Deling & offentlige dashbord](/docs/dashboards/sharing)) styres av tre lag, i rekkefølge:

1. **Public Dashboard**-bryter — hvis av, returnerer den offentlige URL-en en 404.
2. **Master Password** — hvis satt, må besøkende skrive inn det før dashbordet rendres.
3. **IP Whitelist** (Scale-plan) — hvis satt, mottar forespørsler fra ikke-listede IP-er en 403.

Et dashbord kan ha enhver kombinasjon. Den mest defensive konfigurasjonen er "Offentlig på, passord satt, IP-tillatelsesliste aktiv" — nyttig for partnerportaler der du vil ha alle tre.

## Oppbevaring

Dashbord i seg selv utløper ikke. Dataene de viser følger prosjektets telemetri-oppbevaring — metrikker, logger og sporinger er spørrebare så lenge planen din beholder dem. En widget pekt på "siste 90 dager" på en plan med 30 dagers oppbevaring vil rendre det som fortsatt er i lageret.

## Klone et dashbord

For å duplisere et eksisterende dashbord, åpne det og bruk **Dupliser**-handlingen fra dashbord-listen. Kopien inkluderer hver widget, variabel og innstilling unntatt offentlig-modus-konfigurasjonen (som alltid starter av — du bestemmer om du skal aktivere den på nytt på kopien).

Dette er det riktige mønsteret når du vil forke en mal ("oncall-dashbordet vårt") inn i en tjeneste-spesifikk versjon.

## Slette et dashbord

Under **Dashbord → Slett**. Dette er uopprettelig — lerretskonfigurasjonen og eventuelle egendefinerte domene-bindinger fjernes. Telemetridata påvirkes ikke (de lever i metrikk- / logg- / sporings-lagrene, ikke på dashbordet).

Hvis et dashbord er publisert offentlig med et egendefinert domene, slutter den offentlige URL-en å løse seg i øyeblikket du sletter det. Trekk domenet av først hvis du må peke det om.

## Migrering og sikkerhetskopi

For self-hosted-installasjoner: dashbordets fulle konfigurasjon (widgets, variabler, innstillinger) lever i `Dashboard`-tabellen i Postgres. En vanlig databasesikkerhetskopi er tilstrekkelig — det finnes ikke noe eget dashbord-eksportformat.

For OneUptime Cloud: vanlige sikkerhetskopier håndteres for deg. Hvis du vil ha en lokal kopi av et dashbords konfigurasjon, bruk [OneUptime API](/docs/api-reference/api-reference) for å lese `Dashboard`-posten.

## Les videre

- [Deling & offentlige dashbord](/docs/dashboards/sharing) — den offentlige siden av tilgangskontroll.
- [Variabler & filtre](/docs/dashboards/variables) — maling.
- [Widgets](/docs/dashboards/widgets) — widget-katalogen.
- [Oversikt over dashbord](/docs/dashboards/index) — det konseptuelle kartet.
