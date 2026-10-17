# Monitorgrupper

En monitorgruppe samler flere monitorer i én status. Grupper monitorene som til sammen utgjør én tjeneste, som Checkout: API-et, betalingstjenesten og nettappen. Gruppen viser den verste statusen blant dem, har sin egen oppetid, og en statusside kan vise hele gruppen som én rad.

:::cards
- [Slik beregnes en gruppes status](#slik-beregnes-en-gruppes-status): Den verste statusen blant monitorene.
- [Slå på monitorgrupper](#slå-på-monitorgrupper): Én bryter i prosjektinnstillingene.
- [Opprett en monitorgruppe](#opprett-en-monitorgruppe): Gi den et navn, og legg så til monitorene.
- [Vis en gruppe på en statusside](#vis-en-gruppe-på-en-statusside): Én rad for hele gruppen.
:::

## Slik beregnes en gruppes status

En gruppe starter på den driftsklare statusen din og tar den verste statusen blant monitorene sine: den som står lengst ned i prosjektets liste over monitorstatuser. Går én monitor til **Redusert**, blir hele gruppen **Redusert**; går én til **Frakoblet**, blir den **Frakoblet**.

```mermaid title="En gruppe viser den verste statusen blant monitorene sine"
flowchart TB
    subgraph G["Monitorgruppe: Checkout"]
        direction LR
        A["Checkout-API:<br/>I drift"]
        B["Betalinger:<br/>Redusert"]
        C["Webapp:<br/>I drift"]
    end
    G --> W["Gruppen viser<br/>den verste: Redusert"]
    W --> P["Raden på<br/>statussider"]
    W --> U["Tilgjengeligheten"]
```

- **Arkiverte monitorer teller ikke.** En arkivert monitor kontrolleres ikke, så statusen er frosset; gruppen utelater den.
- **En tom gruppe er i drift.** En gruppe uten monitorer, eller bare med arkiverte, viser den driftsklare statusen din.
- **Rekkefølgen er din.** Hvilken status som er verst, følger rekkefølgen under **Overvåkere → Innstillinger → Monitorstatus**. Se [Monitorstatuser](/docs/monitor/criteria-and-statuses#monitorstatuser).

En monitorgruppe er ikke en statussidegruppe. En statussidegruppe er en overskrift på én statusside som rommer rader. En monitorgruppe er én rad som står for flere monitorer, og enhver statusside kan vise den.

## Før du begynner

- **Planen din.** På OneUptime Cloud krever monitorgrupper Scale-planen.
- **Bryteren.** Monitorgrupper er skjult til **Monitorgrupper** er slått på for prosjektet (se nedenfor). Å slå den på krever rollen Project Owner, eller en egendefinert rolle med tillatelsen Edit Project eller Manage Billing.
- **Rollen din.** Å opprette, endre og slette grupper krever rollen Project Owner, Project Admin, Project Member, Monitor Admin eller Monitor Member, eller en egendefinert rolle med tilsvarende tillatelser for monitorgrupper. En Viewer kan se grupper, men ikke endre dem.

## Slå på monitorgrupper

:::steps
### Åpne funksjonsflagg

Gå til **Prosjektinnstillinger → Avansert → Funksjonsflagg**. **Avansert** er sammenslått i sidemenyen: utvid den først.

### Slå på bryteren

Slå på bryteren **Monitorgrupper**. Den lagres med en gang: **Monitorgrupper** vises i sidemenyen for **Monitorer**, og hver statussides menypunkt **Monitorer** heter nå **Ressurser**, der du kan legge til en gruppe.
:::

Slår du av bryteren igjen, skjules **Monitorgrupper** i menyen. Ingen grupper slettes.

## Opprett en monitorgruppe

:::steps
### Åpne Monitorgrupper

Gå til **Overvåkere → Monitorgrupper**. Kortet **Monitorgrupper** viser hver gruppe med **Gjeldende status**, etiketter og eiere.

### Opprett gruppen

Klikk på **Opprett Monitor Gruppe**, skriv inn et **Navn** og, om du vil, en **Beskrivelse**, og klikk på **Opprett Monitor Gruppe** nederst i skjemaet. Gruppen starter uten monitorer.

### Legg til monitorene

Åpne gruppen: til den har en monitor, tilbyr **Oversikt** **Add Monitors**. Senere klikker du på **Monitorer** i sidemenyen og deretter på **Add Monitors**. Velg hver monitor i gruppen under **Monitorer** og klikk på **Add Monitors**.

### Sjekk statusen

Klikk på **Oversikt**. **Gjeldende status** viser gruppens status nå, og **Oppetidsgraf** viser de siste 90 dagene, én stolpe per dag.
:::

For å ta en monitor ut av gruppen klikker du på **Fjern** i raden i **Overvåkinger i gruppe**. Selve monitoren endres ikke. En monitor kan høre til mer enn én gruppe.

## Sidene til en gruppe

Åpne en gruppe for å se sidene i sidemenyen:

| Side | Hva den viser |
| --- | --- |
| **Oversikt** | **Detaljer for overvåkingsgruppe**, **Gjeldende status** og **Oppetidsgraf** med gruppens oppetid i prosent de siste 90 dagene. En gruppe uten monitorer tilbyr **Add Monitors** i stedet for grafen. |
| **Monitorer** | **Overvåkinger i gruppe**, med **Add Monitors** og **Fjern**. |
| **Hendelser** | Hendelsene på en hvilken som helst monitor i gruppen. |
| **Varsler** | Varslene på en hvilken som helst monitor i gruppen. |
| **Eiere** | Personene og teamene som har ansvaret for gruppen. Den ligger under **Avansert**, som starter sammenslått. |
| **Revisjonslogger** | Hvem som endret gruppen, og når, også under **Avansert**. |
| **Slett gruppe** | Sletter gruppen, også under **Avansert**. |

Oppetiden på **Oversikt** teller alle statuser unntatt den driftsklare som nedetid. En statusside teller bare statusene i sin egen liste **Teller som nedetid**: se [Velg hva siden viser](/docs/status-pages/index#å-velge-hva-som-vises-på-siden).

Listen **Monitorgrupper** kan filtrere grupper etter eier og etikett, sette etiketter og eiere på mange grupper samtidig, og eksportere eller importere grupper som JSON.

## Vis en gruppe på en statusside

:::steps
### Åpne statussidens ressurser

Gå til **Statussider**, åpne siden og klikk på **Ressurser** i sidemenyen.

### Bytt dialogen til en gruppe

Klikk på **Legg til monitor**. Under nedtrekkslisten med monitorer klikker du på **Add a Monitor Group instead.** Nedtrekkslisten blir til **Monitor Gruppe**.

### Velg gruppen, og legg den til

Velg gruppen. **Visningsnavn**, navnet besøkende leser, tar gruppens navn til du skriver ditt eget. Klikk på **Legg til monitor**: raden vises på siden med gruppens status.
:::

På statussiden står raden for hver monitor i gruppen:

- **Statusen.** Den er gruppens: den verste blant monitorene.
- **Hendelsene.** En hendelse på en hvilken som helst monitor i gruppen vises på siden, med gruppen nevnt blant de berørte ressursene.
- **Abonnentene.** En abonnent som velger gruppen, får høre om hver monitor i den. Se [La abonnenter velge ressurser og hendelsestyper](/docs/status-pages/subscribers#la-abonnentene-velge-ressurser-og-hendelsestyper).

For radens øvrige innstillinger, som oppetiden og historikkdiagrammet, se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).

> [!WARNING]
> Når du sletter en monitorgruppe, slettes også raden fra hver statusside som viser den. Monitorene i gruppen, og hendelsene deres, slettes ikke.

## API og Terraform

En gruppe er `/api/monitor-group`, og hver monitor i den er en rad i `/api/monitor-group-resource` som kobler en `monitorGroupId` til en `monitorId`. I Terraform er de `oneuptime_monitor_group` og `oneuptime_monitor_group_resource`: se [Monitorgruppe](/docs/terraform/examples#monitorgruppe).

## Feilsøking

:::details Monitorgrupper er ikke i menyen Monitorer
Bryteren **Monitorgrupper** er slått av. Slå den på under **Prosjektinnstillinger → Avansert → Funksjonsflagg**. På OneUptime Cloud krever grupper også Scale-planen.
:::

:::details Gruppen viser Frakoblet, men de fleste monitorene er oppe
Det er regelen: gruppen viser den verste monitoren sin. Åpne **Monitorer** i gruppen for å finne monitoren som er nede, eller fjern en monitor som ikke hører hjemme i gruppen.
:::

:::details En statusside kan ikke legge til gruppen
**Add a Monitor Group instead.** vises bare i dialogen så lenge bryteren **Monitorgrupper** er slått på for prosjektet.
:::

## Neste trinn

:::cards
- [Monitorkriterier og statuser](/docs/monitor/criteria-and-statuses): Hva som setter statusen til hver monitor.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups): Legg opp radene på en statusside.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers): Fortell kundene om en gruppes hendelser.
:::
