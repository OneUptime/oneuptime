# Dashboard-configuratie en machtigingen

Deze pagina verzamelt de instellingen en toegangscontrole-knoppen die je moet kennen zodra je een dashboard hebt dat je daadwerkelijk wilt behouden.

## Eigenaarschap

De **eigenaren** van een dashboard zijn de gebruikers en teams die expliciete machtigingen erop krijgen (gescheiden van de projectbrede rol).

Onder **Dashboard → Owners**:

- Voeg een **gebruiker-eigenaar** toe om een specifieke persoon extra toegang tot dit dashboard te geven.
- Voeg een **team-eigenaar** toe om hetzelfde te doen voor elk lid van een team.

Gebruik eigenaarschap wanneer de projectbrede leesrol te breed is — bijvoorbeeld een dashboard met gevoelige klant-specifieke details dat alleen voor het customer-success-team zichtbaar zou moeten zijn.

## Labels

Labels zijn many-to-many-tags voor het organiseren van dashboards. Pas ze toe onder **Dashboard → Overview**.

Veelvoorkomende label-patronen:

- **Per team**: `team:platform`, `team:checkout`, `team:growth`.
- **Per omgeving**: `env:prod`, `env:staging`.
- **Per doel**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

De **Dashboards**-lijst laat je filteren op label, wat de snelste manier is om een dashboard te vinden in een project dat tientallen heeft verzameld.

## Machtigingen

Dashboards zijn first-class resources in OneUptime's rolgebaseerde toegangscontrole. De relevante machtigingen:

| Machtiging | Staat toe |
| --- | --- |
| `CreateDashboard` | Nieuwe dashboards in het project aanmaken. |
| `ReadDashboard` | Dashboards bekijken (in privé-modus). |
| `EditDashboard` | Widgets, variabelen en instellingen op een dashboard wijzigen. |
| `DeleteDashboard` | Een dashboard verwijderen. |

Er zijn bijbehorende machtigingen voor de ondersteunende entiteiten: dashboard-eigenaren (gebruiker / team) en custom domains hebben hun eigen create- / read- / edit- / delete-paren, zodat je "manage owners" kunt verlenen zonder "het dashboard zelf bewerken" toe te kennen.

Wijs deze toe aan projectrollen onder **Project Settings → Teams & Roles**.

## Toegangscontrole in publieke modus

Toegang in publieke modus (zie [Delen en publieke dashboards](/docs/dashboards/sharing)) wordt geregeld door drie lagen, in volgorde:

1. **Public Dashboard**-toggle — als uit, geeft de publieke URL een 404.
2. **Master Password** — als ingesteld, moeten bezoekers het invoeren voordat het dashboard rendert.
3. **IP Whitelist** (Scale-abonnement) — als ingesteld, krijgen verzoeken van niet-gelijste IP's een 403.

Een dashboard kan een willekeurige combinatie hebben. De meest defensieve configuratie is "Public aan, wachtwoord ingesteld, IP-allowlist actief" — handig voor partnerportalen waar je alle drie wilt.

## Retentie

Dashboards zelf verlopen niet. De data die ze tonen volgt de telemetry-retentie van het project — metrics, logs en traces zijn queryable zolang je abonnement ze bewaart. Een widget die naar "de afgelopen 90 dagen" wijst op een abonnement met 30 dagen retentie rendert wat er nog in de store zit.

## Een dashboard klonen

Om een bestaand dashboard te dupliceren, open je het en gebruik je de **Duplicate**-actie vanuit de dashboards-lijst. De kopie bevat elke widget, variabele en instelling behalve de configuratie van de publieke modus (die altijd uit begint — jij beslist of je hem op de kopie opnieuw aanzet).

Dit is het juiste patroon wanneer je een template ("ons oncall-dashboard") wilt forken naar een service-specifieke versie.

## Een dashboard verwijderen

Onder **Dashboard → Delete**. Dit is onomkeerbaar — de canvas-configuratie en eventuele bindings van custom domains worden verwijderd. Telemetry-data wordt niet beïnvloed (die leeft in de metric- / log- / trace-stores, niet op het dashboard).

Als een dashboard publiek is gepubliceerd met een custom domain, stopt de publieke URL met resolven zodra je hem verwijdert. Haal het domein er eerst af als je het wilt herrouteren.

## Migratie en back-up

Voor self-hosted-installaties: de volledige configuratie van het dashboard (widgets, variabelen, instellingen) leeft in de `Dashboard`-tabel in Postgres. Een reguliere database-back-up volstaat — er is geen apart dashboard-exportformaat.

Voor OneUptime Cloud: reguliere back-ups worden voor je geregeld. Als je een lokale kopie van de configuratie van een dashboard wilt, gebruik je de [OneUptime API](/docs/api-reference/api-reference) om het `Dashboard`-record te lezen.

## Waar verder lezen

- [Delen en publieke dashboards](/docs/dashboards/sharing) — de publieke kant van toegangscontrole.
- [Variabelen en filters](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — de widget-catalogus.
- [Dashboards – Overzicht](/docs/dashboards/index) — de conceptuele kaart.
