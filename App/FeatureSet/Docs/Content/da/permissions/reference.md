# Tilladelsesreference

Alle tilladelser, OneUptime kan tildele, grupperet præcis som tilladelsesvælgeren i dashboardet grupperer dem.

Denne side genereres fra OneUptimes kildekode på forespørgselstidspunktet — ud fra den samme liste, som dashboardet, API'et og Terraform-provideren bruger. Den kan ikke afvige fra produktet og afspejler den version, du kører.

Leder du efter, hvordan delene hænger sammen — teams, omfang, ejere, blokeringer — så begynd med [Brugere, teams og tilladelser](/docs/permissions/index).

Kolonnen **Tilladelsesnøgle** indeholder den værdi, du bruger med [API'et](/docs/api-reference/api-reference), [CLI'en](/docs/cli/index) og [Terraform-provideren](/docs/terraform/index). Titlerne er dem, du ser i dashboardet.

## Roller

{{PERMISSION_ROLE_COUNT}} roller, der hver samler et produktområde på niveauet Admin, Member eller Viewer. Det er dem, **Rolle**-vælgeren tilbyder, når du tilføjer en tilladelse til et team.

Kolonnen **Omfang** angiver, om rollen kan indsnævres, når den tildeles. `Alle, Ejede eller Labels` betyder, at du kan vælge; `Kun hele projektet` betyder, at rollen altid gælder hele projektet.

{{PERMISSION_ROLE_TABLES}}

## Granulære tilladelser

{{PERMISSION_TOTAL_COUNT}} enkeltstående funktioner fordelt på {{PERMISSION_GROUP_COUNT}} grupper. Det er dem, **Granulær**-vælgeren tilbyder, og dem du tildeler API-nøgler.

Kolonnen **Begræns efter labels** angiver, om en tildeling af denne tilladelse kan begrænses til ressourcer med bestemte labels.

{{PERMISSION_GRANULAR_TABLES}}
