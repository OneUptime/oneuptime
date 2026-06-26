# Dashboards – Oversigt

Dashboards forvandler de data, OneUptime allerede indsamler — metrikker, logs, traces, hændelser, monitorer, Kubernetes-ressourcer, hosts — til en enkelt side, som nogen kan kigge på og forstå, hvad der foregår.

Sæt et diagram for request-latency ved siden af en liste over åbne hændelser, ved siden af en gauge for CPU, ved siden af et stykke kontekstuel tekst. Gem det. Del linket.

## Hvad dashboards er gode til

- **En "er alt OK?"-side** — til vagten, et team-standup eller en TV-skærm på væggen.
- **At spotte sammenhænge** — en CPU-spids samtidig med en latency-stigning og en åben hændelse er meget lettere at se på én side end på tværs af tre faner.
- **Undersøgelse** — når du fejlfinder, slår et dashboard, du bygger i farten, ti forespørgsler én ad gangen.
- **Ekstern deling** — en kundevendt performance-side, en partnerstatusside, et offentligt dashboard til et open source-projekt.

## Hvad du kan sætte på et dashboard

- **Diagrammer** til tendenser over tid — latency, fejl, gennemløb.
- **Enkeltværdi-fliser og gauges** — aktuel fejlrate, CPU, åbne hændelser.
- **Tabeller** til opdelinger — top 10 mest støjende hosts, fejlantal pr. service.
- **Tekstblokke** til overskrifter, kontekst og links til runbooks.
- **Live-lister** over hændelser, alarmer, monitorer, logs, traces, Kubernetes-ressourcer, Docker-ressourcer og hosts.

Se [Widgets](/docs/dashboards/widgets) for den fulde liste og hvad hver enkelt viser.

## Nøglebegreber

| Begreb           | Betydning                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| **Dashboard**    | Hele siden — et navn, et net af widgets, tidsinterval-kontroller og en liste af variabler.            |
| **Widget**       | Én flise på siden — et diagram, et tal, en liste, et afsnit.                                          |
| **Variable**     | En dropdown i toppen, der filtrerer hver widget på én gang (cluster, service, customer, environment). |
| **Tidsinterval** | Det vindue af tid, hvert diagram og tal bruger. Sæt det én gang i toppen af siden.                    |
| **Refresh**      | Hvor ofte widgets re-forespørger data. Slukket, hvert par sekunder, hvert par minutter.               |
| **Mode**         | Enten **Edit** (træk widgets rundt) eller **View** (read-only, sådan som besøgende ser det).          |

## Hvor du finder dashboards

Åbn **Dashboards** i venstre navigation.

| Side                     | Hvad du gør der                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------- |
| **Dashboards**           | Din liste over dashboards. Opret et nyt, søg eller filtrér efter label.               |
| **Dashboard → View**     | Lærredet. Skift mellem **Edit** og **View** i headeren.                               |
| **Dashboard → Overview** | Beskrivelse, ejere og labels.                                                         |
| **Dashboard → Settings** | Offentlig deling, adgangskode, IP-tilladelsesliste, brugerdefineret domæne, branding. |
| **Dashboard → Owners**   | Brugere og teams med eksplicit adgang.                                                |
| **Dashboard → Delete**   | Fjern dashboardet.                                                                    |

## Byg et dashboard

1. **Opret** — vælg et navn. Lærredet åbnes tomt.
2. **Tilføj widgets** — vælg en widget-type, konfigurér dens data, træk den hen, hvor du vil have den.
3. **(Valgfrit) Tilføj variabler** — for eksempel en `service`-dropdown, så det samme dashboard virker for hver service.
4. **Sæt tidsintervallet** — standarderne er fine; juster senere.
5. **(Valgfrit) Del offentligt** — slå kontakten til i Settings, tilføj en adgangskode eller IP-tilladelsesliste om nødvendigt.
6. **(Valgfrit) Brugerdefineret domæne** — hostr dashboardet på `status.your-domain.com`.

## Et hurtigt eksempel

Mål: en vagt-side til checkout-servicen med latency, fejlrate, åbne hændelser og et live-log-tail.

1. Opret et dashboard kaldet "Checkout on-call."
2. Tilføj en `service`-variabel. Sæt standarden til `checkout`.
3. Tilføj en **Chart**-widget med P95-latency, filtreret efter `service`-variablen.
4. Ved siden af den, en **Value**-widget for fejlrate, med advarsel ved 1% og kritisk ved 5%.
5. Nedenunder en **Incident List**-widget for hændelser tagget `checkout`.
6. Under den en **Log Stream**-widget, der viser logs fra samme service.
7. Gem. Skift dropdownen til `payments` — det samme dashboard viser nu payments-servicen.

## Hvordan dashboards passer ind i resten af OneUptime

- **Monitorer og telemetri** er datakilderne. Hver metrik, log og trace, du indsamler, kan forespørges på en widget.
- **Hændelser og alarmer** dukker op i **Incident List**- og **Alert List**-widgets. Dashboards er read-only for disse — opret og opdater dem andetsteds.
- **Statussider** er kundevendt kommunikation ("er systemet oppe?"). Dashboards er til at kigge i detaljer på, hvordan systemet opfører sig. De to arbejder sammen, de erstatter ikke hinanden.
- **Workflows** er sådan, OneUptime tager handling. Dashboards er sådan, du læser, hvad der sker.

## Læs videre

- [Opret et dashboard](/docs/dashboards/authoring) — brug af lærredet, redigering af widgets.
- [Widgets](/docs/dashboards/widgets) — den fulde liste af widgets.
- [Variabler & filtre](/docs/dashboards/variables) — at gøre et dashboard brugbart for mange services eller kunder.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — offentlige URL'er, adgangskoder, IP-tilladelsesliste, brugerdefinerede domæner.
- [Konfiguration & tilladelser](/docs/dashboards/configuration) — ejere, labels, adgangskontrol.
