# Machtigingsreferentie

Elke machtiging die OneUptime kan verlenen, precies zo gegroepeerd als de machtigingenkiezer in het dashboard ze groepeert.

Deze pagina wordt bij het opvragen gegenereerd uit de OneUptime-broncode — uit dezelfde lijst die het dashboard, de API en de Terraform-provider gebruiken. Ze kan niet afwijken van het product en toont de versie die u draait.

Zoekt u hoe het geheel in elkaar zit — teams, bereiken, eigenaren, blokkades — begin dan bij [Gebruikers, teams en machtigingen](/docs/permissions/index).

De kolom **Machtigingssleutel** bevat de waarde die u gebruikt met de [API](/docs/api-reference/api-reference), de [CLI](/docs/cli/index) en de [Terraform-provider](/docs/terraform/index). De titels zijn wat u in het dashboard ziet.

## Rollen

{{PERMISSION_ROLE_COUNT}} rollen, elk bundelt een productgebied op het niveau Admin, Member of Viewer. Dit zijn de rollen die de **Rol**-kiezer aanbiedt wanneer u een machtiging aan een team toevoegt.

De kolom **Bereik** geeft aan of de rol bij het toekennen ingeperkt kan worden. `Alle, Eigen of Labels` betekent dat u kunt kiezen; `Alleen projectbreed` betekent dat de rol altijd voor het hele project geldt.

{{PERMISSION_ROLE_TABLES}}

## Granulaire machtigingen

{{PERMISSION_TOTAL_COUNT}} losse mogelijkheden verdeeld over {{PERMISSION_GROUP_COUNT}} groepen. Dit zijn de machtigingen die de **Granulair**-kiezer aanbiedt en die u aan API-sleutels toekent.

De kolom **Beperken met labels** geeft aan of een toekenning van deze machtiging beperkt kan worden tot resources met bepaalde labels.

{{PERMISSION_GRANULAR_TABLES}}
