# Machtigingsreferentie

Elke rol en elke machtiging die OneUptime kan toekennen, gegroepeerd zoals de machtigingskiezer van het dashboard ze groepeert. Gebruik deze pagina om de exacte naam of sleutel te vinden die u aan een team, een API-sleutel of een Terraform-resource geeft.

De tabellen worden bij het serveren van de pagina gegenereerd uit de broncode van OneUptime: dezelfde lijst die het dashboard, de API en de Terraform-provider gebruiken. Ze passen dus altijd bij de versie die u draait. Hoe machtigingen samenwerken (teams, bereiken, eigenaren en blokkades), leest u in [Gebruikers, teams en machtigingen](/docs/permissions/index).

## Zo leest u de tabellen

Elke rol en elke machtiging heeft een rij met deze kolommen:

- **Rol** of **Machtiging**: de naam die het dashboard toont.
- **Machtigingssleutel**: de waarde voor de [API](/docs/api-reference/api-reference), de [CLI](/docs/cli/index) en de [Terraform-provider](/docs/terraform/index).
- **Bereik** (alleen rollen): `Alle, Eigen of Labels` betekent dat u bij het toekennen kiest hoe ver de rol reikt. `Alleen projectbreed` betekent dat de rol altijd voor het hele project geldt.
- **Beperken met labels** (alleen machtigingen): `Ja` betekent dat een toekenning van deze machtiging beperkt kan worden tot resources met bepaalde labels.
- **Beschrijving**: wat de rol of machtiging toestaat.

> [!TIP]
> Kies eerst een rol. Rollen blijven kloppen als OneUptime functies toevoegt, terwijl u een lijst losse machtigingen met de hand bij moet houden.

## Rollen

{{PERMISSION_ROLE_COUNT}} rollen. Vier daarvan gelden voor het hele project: Project Owner, Project Admin, Project Member en Viewer. Elk van de andere dekt één productgebied, zoals incidenten of monitors, op het niveau Admin, Member of Viewer. Deze rollen biedt **Rol toevoegen** aan op de pagina **Machtigingen** van een team en op de pagina van een API-sleutel.

{{PERMISSION_ROLE_TABLES}}

## Losse machtigingen

{{PERMISSION_TOTAL_COUNT}} losse mogelijkheden in {{PERMISSION_GROUP_COUNT}} groepen. Deze biedt **Machtiging toevoegen** aan, voor een team of een API-sleutel, als een rol meer toestaat dan u nodig hebt.

{{PERMISSION_GRANULAR_TABLES}}

## Volgende stappen

:::cards
- [Gebruikers, teams en machtigingen](/docs/permissions/index): Hoe teams, bereiken, eigenaren en blokkades bepalen wat iemand mag.
- [API-referentie](/docs/api-reference/api-reference): Machtigingssleutels gebruiken met API-sleutels.
- [Terraform-provider](/docs/terraform/index): Teams en hun machtigingen als code beheren.
:::
