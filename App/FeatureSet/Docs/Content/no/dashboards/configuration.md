# Konfigurasjon & tillatelser

Denne siden dekker innstillingene og tilgangskontrollene som er verdt å kjenne til når du har et dashbord du vil beholde.

## Eiere

Et dashbords **eiere** er brukere og team du har gitt eksplisitt tilgang (på toppen av deres prosjekt-omfattende rolle).

Under **Dashbord → Eiere**:

- Legg til en **bruker-eier** for å gi én person ekstra tilgang til dette dashbordet.
- Legg til en **team-eier** for å gi det samme til hvert medlem av et team.

Bruk eiere når den prosjekt-omfattende lese-rollen er for bred — for eksempel et dashbord med kunde-nivå detaljer som bare skal være synlig for kundesuksess-teamet.

## Etiketter

Etiketter er tagger for å organisere dashbord. Bruk dem under **Dashbord → Oversikt**.

Vanlige mønstre:

- **Etter team**: `team:platform`, `team:checkout`, `team:growth`.
- **Etter miljø**: `env:prod`, `env:staging`.
- **Etter formål**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

**Dashbord**-listen lar deg filtrere etter etikett, noe som er den raskeste måten å finne et dashbord i et prosjekt som har samlet opp mange.

## Tillatelser

Dashbord fungerer med prosjektets rollebaserte tilgangskontroll. De relevante tillatelsene:

| Tillatelse | Hva den tillater |
| --- | --- |
| **Opprett dashbord** | Opprett nye dashbord. |
| **Les dashbord** | Vis dashbord (i privatmodus). |
| **Rediger dashbord** | Endre widgets, variabler og innstillinger. |
| **Slett dashbord** | Slett et dashbord. |

Det finnes tilsvarende tillatelser for dashbord-eiere og egendefinerte domener, slik at du kan gi "administrer eiere" uten å gi "rediger dashbordet."

Tildel disse på prosjektroller under **Prosjektinnstillinger → Team & roller**.

## Tilgang for offentlige dashbord

Når du gjør et dashbord offentlig (se [Deling & offentlige dashbord](/docs/dashboards/sharing)), kontrollerer tre innstillinger hvem som kan se det:

1. **Offentlig dashbord**-bryter — hvis av, returnerer den offentlige URL-en en 404.
2. **Hovedpassord** — hvis satt, skriver besøkende inn et passord før dashbordet vises.
3. **IP-tillatelsesliste** (Scale-plan) — hvis satt, avvises forespørsler fra andre IP-er.

Du kan kombinere hvilke som helst av disse. Den mest låste kombinasjonen er "Offentlig på, passord satt, IP-tillatelsesliste aktiv" — nyttig for partnerportaler hvor du vil ha alle tre lagene.

## Dataoppbevaring

Dashbord i seg selv utløper ikke. Dataene de viser følger prosjektets oppbevaringsinnstillinger — metrikker, logger og sporinger kan spørres så lenge planen din beholder dem. En widget pekt på "de siste 90 dagene" på en plan som beholder 30 dager vil vise det som fortsatt er lagret.

## Duplisere et dashbord

For å kopiere et eksisterende dashbord, åpne dashbord-listen og velg **Dupliser**. Kopien inkluderer hver widget, variabel og innstilling unntatt offentlig deling — det starter alltid av slik at du kan bestemme om du skal slå det på igjen.

Dette er det riktige trekket når du vil forgrene en mal (som "vakthavende-dashbordet vårt") til en tjeneste-spesifikk kopi.

## Slette et dashbord

Under **Dashbord → Slett**. Dette kan ikke angres — dashbordets oppsett og eventuelle egendefinerte domener koblet til det fjernes. Telemetri-dataene dine påvirkes ikke.

Hvis dashbordet er offentlig på et egendefinert domene, slutter URL-en å løse seg så snart du sletter det. Flytt domenet til et annet dashbord først hvis du vil at URL-en skal fortsette å fungere.

## Sikkerhetskopi

Hvis du kjører OneUptime selvvertet, er en regelmessig databasekopi nok — dashbordets konfigurasjon lagres sammen med resten av prosjektet ditt.

På OneUptime Cloud håndteres sikkerhetskopier for deg. Hvis du vil ha din egen kopi, kan du lese dashbordet via [OneUptime API](/docs/api-reference/api-reference).

## Hvor du leser videre

- [Deling & offentlige dashbord](/docs/dashboards/sharing) — offentlig-modus kontroller.
- [Variabler & filtre](/docs/dashboards/variables) — maler.
- [Widgets](/docs/dashboards/widgets) — widget-katalogen.
- [Oversikt over dashbord](/docs/dashboards/index) — det store bildet.
