# Dashboard-konfiguration & tilladelser

Denne side samler de indstillinger og adgangskontrol-knapper, der er værd at kende, når du har et dashboard, du faktisk vil beholde.

## Ejerskab

Et dashboards **ejere** er de brugere og teams, der får eksplicitte tilladelser på det (adskilt fra den projektomfattende rolle).

Under **Dashboard → Owners**:

- Tilføj en **bruger-ejer** for at give en specifik person ekstra adgang til dette dashboard.
- Tilføj en **team-ejer** for at give det samme til hvert medlem af et team.

Brug ejerskab, når den projektomfattende læserolle er for bred — f.eks. et dashboard med følsomme kunde-detaljer, som kun bør være synligt for customer-success-teamet.

## Labels

Labels er many-to-many-tags til at organisere dashboards. Anvend dem under **Dashboard → Overview**.

Almindelige label-mønstre:

- **Pr. team**: `team:platform`, `team:checkout`, `team:growth`.
- **Pr. miljø**: `env:prod`, `env:staging`.
- **Pr. formål**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

**Dashboards**-listen lader dig filtrere på label, hvilket er den hurtigste måde at finde et dashboard i et projekt, der har akkumuleret snesevis.

## Tilladelser

Dashboards er førsteklasses ressourcer i OneUptimes rollebaserede adgangskontrol. De relevante tilladelser:

| Tilladelse | Tillader |
| --- | --- |
| `CreateDashboard` | Opret nye dashboards i projektet. |
| `ReadDashboard` | Se dashboards (i privat tilstand). |
| `EditDashboard` | Ændr widgets, variabler, indstillinger på et dashboard. |
| `DeleteDashboard` | Slet et dashboard. |

Der er matchende tilladelser til de understøttende entiteter: dashboard-ejere (bruger / team) og brugerdefinerede domæner har deres egne create / read / edit / delete-par, så du kan give "administrér ejere" uden at give "redigér selve dashboardet."

Tildel disse på projekt-roller under **Project Settings → Teams & Roles**.

## Adgangskontrol i offentlig tilstand

Adgang i offentlig tilstand (se [Deling & offentlige dashboards](/docs/dashboards/sharing)) styres af tre lag, i rækkefølge:

1. **Public Dashboard**-kontakt — hvis den er fra, returnerer den offentlige URL en 404.
2. **Master Password** — hvis sat, skal besøgende indtaste den, før dashboardet rendres.
3. **IP Whitelist** (Scale-planen) — hvis sat, modtager anmodninger fra ikke-listede IP'er en 403.

Et dashboard kan have enhver kombination. Den mest defensive konfiguration er "Public til, password sat, IP-allowlist aktiv" — nyttigt til partnerportaler, hvor du vil have alle tre.

## Bevaring

Dashboards selv udløber ikke. De data, de viser, følger projektets telemetri-bevaring — metrikker, logs og traces er forespørgbare så længe din plan beholder dem. En widget, der peger på "seneste 90 dage" på en plan med 30 dages bevaring, vil rendre, hvad end der stadig er i lageret.

## Klon et dashboard

For at duplikere et eksisterende dashboard: åbn det, og brug **Duplicate**-handlingen fra dashboard-listen. Kopien inkluderer hver widget, variabel og indstilling undtagen offentlig-tilstands-konfigurationen (som altid starter fra — du beslutter, om du vil genaktivere på kopien).

Det er det rigtige mønster, når du vil forke en skabelon ("vores oncall-dashboard") ind i en service-specifik version.

## Slet et dashboard

Under **Dashboard → Delete**. Dette er uigenkaldeligt — lærredskonfigurationen og eventuelle bindinger til brugerdefinerede domæner fjernes. Telemetri-data er upåvirket (det lever i metrik- / log- / trace-lagrene, ikke på dashboardet).

Hvis et dashboard er publiceret offentligt med et brugerdefineret domæne, holder den offentlige URL op med at svare i det øjeblik, du sletter det. Træk domænet af først, hvis du har brug for at pege det om.

## Migration og backup

For selv-hostede installationer: dashboardets fulde konfiguration (widgets, variabler, indstillinger) lever i `Dashboard`-tabellen i Postgres. En regelmæssig database-backup er tilstrækkelig — der er ikke et separat dashboard-eksport-format.

For OneUptime Cloud: regelmæssige backups håndteres for dig. Hvis du vil have en lokal kopi af et dashboards konfiguration, så brug [OneUptime API'en](/docs/api-reference/api-reference) til at læse `Dashboard`-recorden.

## Læs videre

- [Deling & offentlige dashboards](/docs/dashboards/sharing) — den offentlige side af adgangskontrol.
- [Dashboard-variabler & filtre](/docs/dashboards/variables) — skabelongørelse.
- [Dashboard-widgets](/docs/dashboards/widgets) — widget-kataloget.
- [Dashboards – Oversigt](/docs/dashboards/index) — det konceptuelle kort.
