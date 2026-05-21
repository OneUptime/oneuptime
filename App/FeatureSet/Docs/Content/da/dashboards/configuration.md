# Konfiguration & tilladelser

Denne side dækker de indstillinger og adgangskontroller, der er værd at kende, når du har et dashboard, du vil beholde.

## Ejere

Et dashboards **ejere** er brugere og teams, du har givet eksplicit adgang (oven på deres projektomspændende rolle).

Under **Dashboard → Owners**:

- Tilføj en **bruger-ejer** for at give én person ekstra adgang til dette dashboard.
- Tilføj en **team-ejer** for at give det samme til hvert medlem af et team.

Brug ejere, når den projektomspændende læse-rolle er for bred — for eksempel et dashboard med kundeniveau-detaljer, som kun bør være synligt for customer success-teamet.

## Labels

Labels er tags til at organisere dashboards. Anvend dem under **Dashboard → Overview**.

Almindelige mønstre:

- **Efter team**: `team:platform`, `team:checkout`, `team:growth`.
- **Efter miljø**: `env:prod`, `env:staging`.
- **Efter formål**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

**Dashboards**-listen lader dig filtrere efter label, hvilket er den hurtigste måde at finde et dashboard i et projekt, der har samlet en del af dem.

## Tilladelser

Dashboards fungerer sammen med dit projekts rollebaserede adgangskontrol. De relevante tilladelser:

| Tilladelse | Hvad den tillader |
| --- | --- |
| **Create Dashboard** | Opret nye dashboards. |
| **Read Dashboard** | Se dashboards (i privat tilstand). |
| **Edit Dashboard** | Ændr widgets, variabler og indstillinger. |
| **Delete Dashboard** | Slet et dashboard. |

Der er matchende tilladelser til dashboard-ejere og brugerdefinerede domæner, så du kan give "administrér ejere" uden at give "redigér dashboardet."

Tildel disse på projektroller under **Project Settings → Teams & Roles**.

## Adgang til offentlige dashboards

Når du gør et dashboard offentligt (se [Deling & offentlige dashboards](/docs/dashboards/sharing)), kontrollerer tre indstillinger, hvem der kan se det:

1. **Public Dashboard**-kontakten — hvis slukket, returnerer den offentlige URL en 404.
2. **Master Password** — hvis sat, indtaster besøgende en adgangskode, før dashboardet vises.
3. **IP Whitelist** (Scale-planen) — hvis sat, afvises anmodninger fra andre IP'er.

Du kan kombinere enhver af disse. Den mest aflåste kombination er "Public til, adgangskode sat, IP-tilladelsesliste aktiv" — nyttig til partner-portaler, hvor du vil have alle tre lag.

## Datalagring

Selve dashboards udløber ikke. De data, de viser, følger dit projekts opbevaringsindstillinger — metrikker, logs og traces kan forespørges, så længe din plan beholder dem. En widget rettet mod "de seneste 90 dage" på en plan, der beholder 30 dage, viser, hvad der end stadig er gemt.

## Duplicering af et dashboard

For at kopiere et eksisterende dashboard åbner du dashboard-listen og vælger **Duplicate**. Kopien inkluderer hver widget, variabel og indstilling undtagen offentlig deling — den starter altid slukket, så du kan beslutte, om du vil slå den til igen.

Dette er det rigtige træk, når du vil forgrene en skabelon (såsom "vores vagt-dashboard") til en service-specifik kopi.

## Sletning af et dashboard

Under **Dashboard → Delete**. Dette kan ikke fortrydes — dashboardets layout og eventuelle brugerdefinerede domæner knyttet til det fjernes. Dine telemetridata påvirkes ikke.

Hvis dashboardet er offentligt på et brugerdefineret domæne, holder URL'en op med at virke, så snart du sletter det. Flyt domænet til et andet dashboard først, hvis du vil holde URL'en i gang.

## Backup

Hvis du selv-hoster OneUptime, er en regelmæssig database-backup nok — dashboardets konfiguration gemmes ved siden af resten af dit projekt.

På OneUptime Cloud håndteres backups for dig. Hvis du vil have din egen kopi, kan du læse dashboardet via [OneUptime API'et](/docs/api-reference/api-reference).

## Læs videre

- [Deling & offentlige dashboards](/docs/dashboards/sharing) — kontroller for offentlig tilstand.
- [Variabler & filtre](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — widget-kataloget.
- [Dashboards – Oversigt](/docs/dashboards/index) — det store billede.
