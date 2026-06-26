# Dashboards – Overzicht

Dashboards veranderen de data die OneUptime al verzamelt — metrics, logs, traces, incidenten, monitors, Kubernetes-resources, hosts — in één pagina waar iemand in één oogopslag begrijpt wat er aan de hand is.

Zet een chart voor request-latency naast een lijst met openstaande incidenten, naast een gauge voor CPU, naast een alinea met context. Sla het op. Deel de link.

## Waar dashboards goed voor zijn

- **Een "is alles oké?"-pagina** — voor oncall, een team-standup of een muur-TV.
- **Verbanden zien** — een CPU-piek op exact hetzelfde moment als een toename in latency en een openstaand incident is veel makkelijker te zien op één pagina dan verspreid over drie tabbladen.
- **Onderzoeken** — wanneer je debugt, is een dashboard dat je ter plekke bouwt sneller dan tien queries één voor één draaien.
- **Extern delen** — een klantgerichte performance-pagina, een partner-statuspagina, een publiek dashboard voor een opensource-project.

## Wat je op een dashboard kunt zetten

- **Charts** voor trends in de tijd — latency, fouten, throughput.
- **Tegels met één waarde en gauges** — huidig foutpercentage, CPU, openstaande incidenten.
- **Tabellen** voor uitsplitsingen — top 10 luidruchtigste hosts, foutaantal per service.
- **Tekstblokken** voor koppen, context en links naar runbooks.
- **Live lijsten** van incidenten, alerts, monitors, logs, traces, Kubernetes-resources, Docker-resources en hosts.

Zie [Widgets](/docs/dashboards/widgets) voor de volledige lijst en wat elk laat zien.

## Kernbegrippen

| Term            | Betekenis                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **Dashboard**   | De hele pagina — een naam, een grid van widgets, controls voor het tijdsbereik en een lijst variabelen. |
| **Widget**      | Eén tegel op de pagina — een chart, een getal, een lijst, een alinea.                                   |
| **Variabele**   | Een dropdown bovenaan die elke widget tegelijk filtert (cluster, service, klant, omgeving).             |
| **Tijdsbereik** | Het tijdvenster dat elke chart en elk getal gebruikt. Eén keer bovenaan de pagina ingesteld.            |
| **Refresh**     | Hoe vaak widgets de data opnieuw bevragen. Uit, elke paar seconden, elke paar minuten.                  |
| **Modus**       | Ofwel **Edit** (widgets verslepen) of **View** (alleen lezen, zoals bezoekers het zien).                |

## Waar dashboards te vinden

Open **Dashboards** in de linkernavigatie.

| Pagina                   | Wat je daar doet                                                       |
| ------------------------ | ---------------------------------------------------------------------- |
| **Dashboards**           | Je lijst met dashboards. Maak een nieuwe aan, zoek of filter op label. |
| **Dashboard → View**     | Het canvas. Wissel tussen **Edit** en **View** in de header.           |
| **Dashboard → Overview** | Beschrijving, eigenaren en labels.                                     |
| **Dashboard → Settings** | Publiek delen, wachtwoord, IP-allowlist, custom domain, branding.      |
| **Dashboard → Owners**   | Gebruikers en teams met expliciete toegang.                            |
| **Dashboard → Delete**   | Verwijder het dashboard.                                               |

## Een dashboard bouwen

1. **Aanmaken** — kies een naam. Het canvas opent leeg.
2. **Widgets toevoegen** — kies een widget-type, configureer de data en sleep hem waar je hem hebben wilt.
3. **(Optioneel) Variabelen toevoegen** — bijvoorbeeld een `service`-dropdown zodat hetzelfde dashboard voor elke service werkt.
4. **Stel het tijdsbereik in** — de standaardwaarden zijn prima; later afstellen.
5. **(Optioneel) Publiek delen** — zet de schakelaar om in Settings, voeg desgewenst een wachtwoord of IP-allowlist toe.
6. **(Optioneel) Custom domain** — host het dashboard op `status.your-domain.com`.

## Een snel voorbeeld

Doel: een oncall-pagina voor de checkout-service met latency, foutpercentage, openstaande incidenten en een live log-tail.

1. Maak een dashboard met de naam "Checkout on-call".
2. Voeg een `service`-variabele toe. Standaardwaarde `checkout`.
3. Voeg een **Chart**-widget toe met P95-latency, gefilterd op de `service`-variabele.
4. Daarnaast een **Value**-widget voor foutpercentage, met warning op 1% en critical op 5%.
5. Daaronder een **Incident List**-widget voor incidenten gelabeld `checkout`.
6. Daaronder een **Log Stream**-widget die logs van dezelfde service toont.
7. Sla op. Wissel de dropdown naar `payments` — hetzelfde dashboard toont nu de payments-service.

## Hoe dashboards passen bij de rest van OneUptime

- **Monitors en telemetry** zijn de bronnen van data. Elke metric, log en trace die je verzamelt is queryable op een widget.
- **Incidenten en alerts** verschijnen in **Incident List**- en **Alert List**-widgets. Dashboards zijn hier alleen-lezen — aanmaken en bijwerken doe je elders.
- **Statuspagina's** zijn klantgerichte communicatie ("is het systeem up?"). Dashboards zijn om in detail te kijken hoe het systeem zich gedraagt. Ze werken samen, ze vervangen elkaar niet.
- **Workflows** zijn hoe OneUptime actie onderneemt. Dashboards zijn hoe je leest wat er gebeurt.

## Waar verder lezen

- [Een dashboard maken](/docs/dashboards/authoring) — het canvas gebruiken, widgets bewerken.
- [Widgets](/docs/dashboards/widgets) — de volledige lijst met widgets.
- [Variabelen en filters](/docs/dashboards/variables) — een dashboard laten werken voor veel services of klanten.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — openbare URL's, wachtwoorden, IP-allowlist, custom domains.
- [Configuratie en machtigingen](/docs/dashboards/configuration) — eigenaren, labels, toegangscontrole.
