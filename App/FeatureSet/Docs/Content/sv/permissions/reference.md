# Behörighetsreferens

Alla behörigheter OneUptime kan ge, grupperade precis som behörighetsväljaren i panelen grupperar dem.

Den här sidan genereras från OneUptimes källkod när den hämtas — från samma lista som panelen, API:et och Terraform-providern använder. Den kan inte avvika från produkten och speglar den version du kör.

Söker du hur delarna hänger ihop — team, omfattningar, ägare, blockeringar — börja med [Användare, team och behörigheter](/docs/permissions/index).

Kolumnen **Behörighetsnyckel** innehåller värdet du använder med [API:et](/docs/api-reference/api-reference), [CLI:t](/docs/cli/index) och [Terraform-providern](/docs/terraform/index). Titlarna är de du ser i panelen.

## Roller

{{PERMISSION_ROLE_COUNT}} roller, var och en samlar ett produktområde på nivån Admin, Member eller Viewer. Det är dessa **Roll**-väljaren erbjuder när du lägger till en behörighet till ett team.

Kolumnen **Omfattning** anger om rollen kan smalnas av när den ges. `Alla, Ägda eller Etiketter` betyder att du kan välja; `Endast hela projektet` betyder att rollen alltid gäller hela projektet.

{{PERMISSION_ROLE_TABLES}}

## Granulära behörigheter

{{PERMISSION_TOTAL_COUNT}} enskilda funktioner fördelade på {{PERMISSION_GROUP_COUNT}} grupper. Det är dessa **Granulär**-väljaren erbjuder och dessa du tilldelar API-nycklar.

Kolumnen **Begränsa med etiketter** anger om en tilldelning av den här behörigheten kan begränsas till resurser med vissa etiketter.

{{PERMISSION_GRANULAR_TABLES}}
