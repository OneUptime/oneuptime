# Tilladelsesreference

Alle roller og tilladelser, som OneUptime kan tildele, grupperet som i dashboardets tilladelsesvælger. Brug siden til at finde det præcise navn eller den præcise nøgle, du skal give et team, en API-nøgle eller en Terraform-ressource.

Tabellerne bliver genereret ud fra OneUptimes kildekode, når siden vises: det er den samme liste, som dashboardet, API'et og Terraform-udbyderen bruger. De passer derfor altid til den version, du kører. Hvordan tilladelser hænger sammen (teams, omfang, ejere og blokeringer), kan du læse om i [Brugere, teams og tilladelser](/docs/permissions/index).

## Sådan læser du tabellerne

Hver rolle og hver tilladelse har en række med disse kolonner:

- **Rolle** eller **Tilladelse**: navnet, som dashboardet viser.
- **Tilladelsesnøgle**: værdien, du bruger med [API'et](/docs/api-reference/api-reference), [CLI'en](/docs/cli/index) og [Terraform-udbyderen](/docs/terraform/index).
- **Omfang** (kun roller): `Alle, Ejede eller Labels` betyder, at du vælger, hvor langt rollen rækker, når du tildeler den. `Kun hele projektet` betyder, at rollen altid gælder i hele projektet.
- **Begræns efter labels** (kun tilladelser): `Ja` betyder, at en tildeling af tilladelsen kan begrænses til ressourcer med bestemte labels.
- **Beskrivelse**: hvad rollen eller tilladelsen giver lov til.

> [!TIP]
> Vælg en rolle først. Roller forbliver korrekte, når OneUptime får nye funktioner, mens en liste af enkelte tilladelser skal holdes ajour i hånden.

## Roller

{{PERMISSION_ROLE_COUNT}} roller. Fire af dem gælder i hele projektet: Project Owner, Project Admin, Project Member og Viewer. Hver af de andre dækker ét produktområde, for eksempel hændelser eller monitorer, på niveauet Admin, Member eller Viewer. Det er dem, **Tilføj rolle** tilbyder på et teams side **Tilladelser** og på en API-nøgles side.

{{PERMISSION_ROLE_TABLES}}

## Enkelte tilladelser

{{PERMISSION_TOTAL_COUNT}} enkelte muligheder fordelt på {{PERMISSION_GROUP_COUNT}} grupper. Det er dem, **Tilføj tilladelse** tilbyder for et team eller en API-nøgle, når en rolle giver mere, end du har brug for.

{{PERMISSION_GRANULAR_TABLES}}

## Næste trin

:::cards
- [Brugere, teams og tilladelser](/docs/permissions/index): Hvordan teams, omfang, ejere og blokeringer afgør, hvad en person kan gøre.
- [API-reference](/docs/api-reference/api-reference): Brug tilladelsesnøgler med API-nøgler.
- [Terraform-udbyder](/docs/terraform/index): Administrer teams og deres tilladelser som kode.
:::
