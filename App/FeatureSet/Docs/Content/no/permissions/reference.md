# Tillatelsesreferanse

Alle tillatelser OneUptime kan gi, gruppert nøyaktig slik tillatelsesvelgeren i dashbordet grupperer dem.

Denne siden genereres fra OneUptimes kildekode når den hentes — fra den samme listen som dashbordet, API-et og Terraform-provideren bruker. Den kan ikke avvike fra produktet og gjenspeiler versjonen du kjører.

Ser du etter hvordan delene henger sammen — team, omfang, eiere, blokkeringer — begynn med [Brukere, team og tillatelser](/docs/permissions/index).

Kolonnen **Tillatelsesnøkkel** inneholder verdien du bruker med [API-et](/docs/api-reference/api-reference), [CLI-en](/docs/cli/index) og [Terraform-provideren](/docs/terraform/index). Titlene er dem du ser i dashbordet.

## Roller

{{PERMISSION_ROLE_COUNT}} roller som hver samler et produktområde på nivået Admin, Member eller Viewer. Det er disse **Rolle**-velgeren tilbyr når du legger en tillatelse til et team.

Kolonnen **Omfang** sier om rollen kan snevres inn når den gis. `Alle, Eide eller Etiketter` betyr at du kan velge; `Bare hele prosjektet` betyr at rollen alltid gjelder hele prosjektet.

{{PERMISSION_ROLE_TABLES}}

## Granulære tillatelser

{{PERMISSION_TOTAL_COUNT}} enkeltstående funksjoner fordelt på {{PERMISSION_GROUP_COUNT}} grupper. Det er disse **Granulær**-velgeren tilbyr, og dem du tildeler API-nøkler.

Kolonnen **Begrens etter etiketter** sier om en tildeling av denne tillatelsen kan begrenses til ressurser med bestemte etiketter.

{{PERMISSION_GRANULAR_TABLES}}
