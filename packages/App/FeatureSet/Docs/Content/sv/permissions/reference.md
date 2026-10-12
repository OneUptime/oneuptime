# Behörighetsreferens

Alla roller och behörigheter som OneUptime kan ge, grupperade så som behörighetsväljaren i instrumentpanelen grupperar dem. Använd sidan för att hitta det exakta namnet eller den exakta nyckeln att ge ett team, en API-nyckel eller en Terraform-resurs.

Tabellerna genereras från OneUptimes källkod när sidan visas: det är samma lista som instrumentpanelen, API:et och Terraform-leverantören använder. De stämmer därför alltid med den version du kör. Hur behörigheter hänger ihop (team, omfattningar, ägare och blockeringar) kan du läsa om i [Användare, team och behörigheter](/docs/permissions/index).

## Så läser du tabellerna

Varje roll och varje behörighet har en rad med dessa kolumner:

- **Roll** eller **Behörighet**: namnet som instrumentpanelen visar.
- **Behörighetsnyckel**: värdet du använder med [API:et](/docs/api-reference/api-reference), [CLI:t](/docs/cli/index) och [Terraform-leverantören](/docs/terraform/index).
- **Omfattning** (endast roller): `Alla, Ägda eller Etiketter` betyder att du väljer hur långt rollen når när du ger den. `Endast hela projektet` betyder att rollen alltid gäller i hela projektet.
- **Begränsa med etiketter** (endast behörigheter): `Ja` betyder att en tilldelning av behörigheten kan begränsas till resurser med vissa etiketter.
- **Beskrivning**: vad rollen eller behörigheten tillåter.

> [!TIP]
> Välj en roll först. Roller förblir korrekta när OneUptime får nya funktioner, medan en lista med enskilda behörigheter måste hållas uppdaterad för hand.

## Roller

{{PERMISSION_ROLE_COUNT}} roller. Fyra av dem gäller i hela projektet: Project Owner, Project Admin, Project Member och Viewer. Var och en av de andra täcker ett produktområde, till exempel incidenter eller monitorer, på nivån Admin, Member eller Viewer. Det är dessa som **Lägg till roll** erbjuder på ett teams sida **Behörigheter** och på en API-nyckels sida.

{{PERMISSION_ROLE_TABLES}}

## Granulära behörigheter

{{PERMISSION_TOTAL_COUNT}} enskilda funktioner fördelade på {{PERMISSION_GROUP_COUNT}} grupper. Det är dessa som **Lägg till behörighet** erbjuder för ett team eller en API-nyckel när en roll ger mer än du behöver.

{{PERMISSION_GRANULAR_TABLES}}

## Nästa steg

:::cards
- [Användare, team och behörigheter](/docs/permissions/index): Hur team, omfattningar, ägare och blockeringar avgör vad någon kan göra.
- [API-referens](/docs/api-reference/api-reference): Använd behörighetsnycklar med API-nycklar.
- [Terraform-leverantör](/docs/terraform/index): Hantera team och deras behörigheter som kod.
:::
