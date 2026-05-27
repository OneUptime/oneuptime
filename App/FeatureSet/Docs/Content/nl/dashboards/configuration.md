# Configuratie en machtigingen

Deze pagina behandelt de instellingen en toegangscontroles die de moeite waard zijn om te kennen zodra je een dashboard hebt dat je wilt behouden.

## Eigenaren

De **eigenaren** van een dashboard zijn gebruikers en teams aan wie je expliciete toegang hebt gegeven (bovenop hun projectbrede rol).

Onder **Dashboard → Owners**:

- Voeg een **gebruiker als eigenaar** toe om één persoon extra toegang tot dit dashboard te geven.
- Voeg een **team als eigenaar** toe om hetzelfde aan elk lid van een team te geven.

Gebruik eigenaren wanneer de projectbrede leesrol te breed is — bijvoorbeeld een dashboard met klantdetails dat alleen zichtbaar zou moeten zijn voor het customer-success-team.

## Labels

Labels zijn tags om dashboards te organiseren. Pas ze toe onder **Dashboard → Overview**.

Veelvoorkomende patronen:

- **Per team**: `team:platform`, `team:checkout`, `team:growth`.
- **Per omgeving**: `env:prod`, `env:staging`.
- **Per doel**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

De **Dashboards**-lijst laat je filteren op label, wat de snelste manier is om een dashboard te vinden in een project waar er al veel van zijn opgehoopt.

## Machtigingen

Dashboards werken met de role-based access control van je project. De relevante machtigingen:

| Machtiging | Wat het toestaat |
| --- | --- |
| **Create Dashboard** | Nieuwe dashboards aanmaken. |
| **Read Dashboard** | Dashboards bekijken (in privé-modus). |
| **Edit Dashboard** | Widgets, variabelen en instellingen wijzigen. |
| **Delete Dashboard** | Een dashboard verwijderen. |

Er zijn bijbehorende machtigingen voor dashboard-eigenaren en custom domains, zodat je "eigenaren beheren" kunt toekennen zonder "het dashboard bewerken" toe te kennen.

Wijs deze toe op projectrollen onder **Project Settings → Teams & Roles**.

## Toegang voor publieke dashboards

Wanneer je een dashboard publiek maakt (zie [Delen en publieke dashboards](/docs/dashboards/sharing)), bepalen drie instellingen wie het kan zien:

1. **Public Dashboard**-schakelaar — als deze uit is, geeft de publieke URL een 404 terug.
2. **Master Password** — indien ingesteld voeren bezoekers een wachtwoord in voordat het dashboard verschijnt.
3. **IP Whitelist** (Scale-plan) — indien ingesteld worden verzoeken vanaf andere IP's afgewezen.

Je kunt al deze combineren. De meest dichtgetimmerde combinatie is "Public aan, wachtwoord ingesteld, IP-allowlist actief" — handig voor partner-portalen waar je alle drie de lagen wilt.

## Dataretentie

Dashboards zelf verlopen niet. De data die ze tonen volgt de retentie-instellingen van je project — metrics, logs en traces zijn queryable zolang je plan ze bewaart. Een widget die op "de afgelopen 90 dagen" wijst op een plan dat 30 dagen bewaart, toont wat er nog is opgeslagen.

## Een dashboard dupliceren

Om een bestaand dashboard te kopiëren open je de dashboards-lijst en kies je **Duplicate**. De kopie bevat elke widget, variabele en instelling behalve publiek delen — dat staat altijd uit zodat je kunt besluiten of je het weer wilt aanzetten.

Dit is de juiste zet wanneer je een template (zoals "ons oncall-dashboard") wilt afsplitsen naar een servicespecifieke kopie.

## Een dashboard verwijderen

Onder **Dashboard → Delete**. Dit kan niet ongedaan worden gemaakt — de layout van het dashboard en eventuele eraan gekoppelde custom domains worden verwijderd. Je telemetry-data wordt niet beïnvloed.

Als het dashboard publiek staat op een custom domain, stopt de URL met werken zodra je hem verwijdert. Verplaats het domein eerst naar een ander dashboard als je de URL wilt blijven gebruiken.

## Backup

Als je OneUptime zelf host, is een reguliere database-backup voldoende — de configuratie van het dashboard wordt naast de rest van je project opgeslagen.

Op OneUptime Cloud worden backups voor je geregeld. Wil je je eigen kopie, dan kun je het dashboard uitlezen via de [OneUptime API](/docs/api-reference/api-reference).

## Waar verder lezen

- [Delen en publieke dashboards](/docs/dashboards/sharing) — controls voor publieke modus.
- [Variabelen en filters](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — de widget-catalogus.
- [Dashboards – Overzicht](/docs/dashboards/index) — het grote plaatje.
