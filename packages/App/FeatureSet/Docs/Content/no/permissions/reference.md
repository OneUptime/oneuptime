# Tillatelsesreferanse

Alle roller og tillatelser som OneUptime kan gi, gruppert slik tillatelsesvelgeren i dashbordet grupperer dem. Bruk siden til å finne det nøyaktige navnet eller den nøyaktige nøkkelen du skal gi et team, en API-nøkkel eller en Terraform-ressurs.

Tabellene genereres fra kildekoden til OneUptime når siden vises: det er den samme listen som dashbordet, API-et og Terraform-leverandøren bruker. De stemmer derfor alltid med versjonen du kjører. Hvordan tillatelser henger sammen (team, omfang, eiere og blokkeringer), kan du lese om i [Brukere, team og tillatelser](/docs/permissions/index).

## Slik leser du tabellene

Hver rolle og hver tillatelse har en rad med disse kolonnene:

- **Rolle** eller **Tillatelse**: navnet som dashbordet viser.
- **Tillatelsesnøkkel**: verdien du bruker med [API-et](/docs/api-reference/api-reference), [CLI-en](/docs/cli/index) og [Terraform-leverandøren](/docs/terraform/index).
- **Omfang** (bare roller): `Alle, Eide eller Etiketter` betyr at du velger hvor langt rollen rekker når du gir den. `Bare hele prosjektet` betyr at rollen alltid gjelder i hele prosjektet.
- **Begrens etter etiketter** (bare tillatelser): `Ja` betyr at en tildeling av tillatelsen kan begrenses til ressurser med bestemte etiketter.
- **Beskrivelse**: hva rollen eller tillatelsen gir lov til.

> [!TIP]
> Velg en rolle først. Roller forblir riktige når OneUptime får nye funksjoner, mens en liste med enkelttillatelser må holdes oppdatert for hånd.

## Roller

{{PERMISSION_ROLE_COUNT}} roller. Fire av dem gjelder i hele prosjektet: Project Owner, Project Admin, Project Member og Viewer. Hver av de andre dekker ett produktområde, for eksempel hendelser eller monitorer, på nivået Admin, Member eller Viewer. Det er disse **Legg til rolle** tilbyr på siden **Tillatelser** for et team og på siden for en API-nøkkel.

{{PERMISSION_ROLE_TABLES}}

## Enkelttillatelser

{{PERMISSION_TOTAL_COUNT}} enkeltmuligheter fordelt på {{PERMISSION_GROUP_COUNT}} grupper. Det er disse **Legg til tillatelse** tilbyr for et team eller en API-nøkkel når en rolle gir mer enn du trenger.

{{PERMISSION_GRANULAR_TABLES}}

## Neste steg

:::cards
- [Brukere, team og tillatelser](/docs/permissions/index): Hvordan team, omfang, eiere og blokkeringer avgjør hva en person kan gjøre.
- [API-referanse](/docs/api-reference/api-reference): Bruk tillatelsesnøkler med API-nøkler.
- [Terraform-leverandør](/docs/terraform/index): Administrer team og tillatelsene deres som kode.
:::
