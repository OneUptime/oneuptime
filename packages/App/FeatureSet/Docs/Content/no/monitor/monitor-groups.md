# Monitorgrupper

En monitorgruppe samler flere monitorer i én status. Grupper monitorene som til sammen utgjør én tjeneste, som Checkout: API-et, betalingstjenesten og nettappen. Gruppen viser den verste statusen blant dem, har sin egen oppetid, og en statusside kan vise hele gruppen som én rad. Se [Hvilken skal jeg bruke?](/docs/introduction/which-one#monitorgruppe-tjeneste-eller-etikett) for å velge mellom en monitorgruppe, en tjeneste og en etikett.

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
- **Monitorer med overvåking slått av teller ikke.** Ingenting sjekker en monitor med overvåking slått av, så statusen er bare det den siste kontrollen så. Gruppen utelater den fra statusen sin: en monitor som sto på **Frakoblet** da overvåkingen ble slått av, gjør ikke gruppen **Frakoblet**. Gruppens oppetid og **Oppetidsgraf** beholder monitorens historikk frem til overvåkingen ble slått av, og utelater tiden etterpå, både på dashbordet og på statussider. Slås den på igjen, teller monitoren med fra det øyeblikket.
- **En tom gruppe er i drift.** En gruppe uten monitorer, eller bare med arkiverte, viser den driftsklare statusen din. Til du legger til en monitor, viser dashbordet **Ingen monitorer ennå** i stedet for statusen.
- **Overvåking slått av viser Deaktivert.** Når overvåking er slått av for alle monitorer i en gruppe, sjekker ingenting dem, så dashbordet viser **Deaktivert** i stedet for gruppens status, og **Oppetidsgraf** og oppetiden slutter der overvåkingen ble slått av for den siste av dem. En statusside viser gruppen som **Ikke overvåket**.
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

Klikk på **Opprett Monitorgruppe**, skriv inn et **Navn** og, om du vil, en **Beskrivelse**, og klikk på **Opprett Monitorgruppe** nederst i skjemaet. Gruppen starter uten monitorer.

### Legg til monitorene

Åpne gruppen: til den har en monitor, tilbyr **Oversikt** **Legg til monitorer**. Senere klikker du på **Monitorer** i sidemenyen og deretter på **Legg til monitorer**. Velg hver monitor i gruppen under **Monitorer** og klikk på **Legg til monitorer**.

### Sjekk statusen

Klikk på **Oversikt**. **Gjeldende status** viser gruppens status nå, og **Oppetidsgraf** viser de siste 90 dagene, én stolpe per dag.
:::

For å ta en monitor ut av gruppen klikker du på **Fjern** i raden i **Overvåkinger i gruppe**. Selve monitoren endres ikke. En monitor kan høre til mer enn én gruppe.

## Sidene til en gruppe

Åpne en gruppe for å se sidene i sidemenyen:

| Side | Hva den viser |
| --- | --- |
| **Oversikt** | **Detaljer for overvåkingsgruppe**, **Gjeldende status**, **Overvåking** og **Oppetidsgraf** med gruppens oppetid i prosent de siste 90 dagene. En gruppe uten monitorer tilbyr **Legg til monitorer** i stedet for grafen. |
| **Monitorer** | **Overvåkinger i gruppe**, med **Legg til monitorer** og **Fjern**. |
| **Hendelser** | Hendelsene på en hvilken som helst monitor i gruppen. |
| **Varsler** | Varslene på en hvilken som helst monitor i gruppen. |
| **Eiere** | Personene og teamene som har ansvaret for gruppen. Den ligger under **Avansert**, som starter sammenslått. |
| **Revisjonslogger** | Hvem som endret gruppen, og når, også under **Avansert**. |
| **Slett gruppe** | Sletter gruppen, også under **Avansert**. |

Oppetiden på **Oversikt** teller alle statuser unntatt den driftsklare som nedetid. En statusside teller bare statusene i sin egen liste **Teller som nedetid**: se [Velg hva siden viser](/docs/status-pages/index#å-velge-hva-som-vises-på-siden).

Hver stolpe i oppetidsgrafen, her og på en statusside, viser hvor lenge gruppen selv var i hver status den dagen: i hvert øyeblikk har den den verste statusen blant monitorene sine, så en time da to av dem er offline samtidig, er én time for gruppen, og en dag blir aldri mer enn en dag. Dagene er dine egne: dashbordet tegner dem i tidssonen fra brukerinnstillingene dine, og en statusside i hver besøkendes.

Listen **Monitorgrupper** kan filtrere grupper etter eier og etikett, sette etiketter og eiere på mange grupper samtidig, og eksportere eller importere grupper som JSON.

## Slå av overvåking for en hel gruppe

Kortet **Overvåking** på en gruppes **Oversikt** slår overvåking av, eller på igjen, for alle monitorer i gruppen på én gang.

- **Slå av overvåking** spør først. Deretter sjekker ingenting gruppens monitorer før overvåkingen slås på igjen, så de åpner ingen hendelser eller varsler, og gruppen viser **Deaktivert** i stedet for statusen sin.
- **Slå på overvåking** lagrer med en gang. Neste sjekk av hver monitor setter statusen dens igjen.

Å slå av overvåking løser også monitorenes åpne hendelser og varsler som er satt til automatisk løsning, slik hver monitor ville ha gjort da den ble frisk igjen. Hendelser og varsler som er meldt for hånd, eller der kriteriene ikke løser automatisk, forblir åpne. Å slå av overvåkingen for én monitor, på siden **Innstillinger**, gjør det samme.

Kortet endrer monitorene, ikke gruppen: hver monitors eget kort **Overvåking** viser endringen, og en monitor som legges til i gruppen senere, beholder sin egen innstilling. Arkiverte monitorer forblir som de er. Så lenge overvåking bare er slått av for noen av monitorene, sier kortet hvor mange og tilbyr begge knappene.

## Vis en gruppe på en statusside

:::steps
### Åpne statussidens ressurser

Gå til **Statussider**, åpne siden og klikk på **Ressurser** i sidemenyen.

### Bytt dialogen til en gruppe

Klikk på **Legg til monitor**. Under nedtrekkslisten med monitorer klikker du på **Legg heller til en monitorgruppe.** Nedtrekkslisten blir til **Monitorgruppe**.

### Velg gruppen, og legg den til

Velg gruppen. **Visningsnavn**, navnet besøkende leser, tar gruppens navn til du skriver ditt eget. Klikk på **Legg til monitor**: raden vises på siden med gruppens status.
:::

På statussiden står raden for hver monitor i gruppen:

- **Statusen.** Den er gruppens: den verste blant monitorene med overvåking slått på. Når overvåking er slått av for alle, viser raden **Ikke overvåket** og teller verken for overskriften over den eller for sidens samlede status.
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
**Legg heller til en monitorgruppe.** vises bare i dialogen så lenge bryteren **Monitorgrupper** er slått på for prosjektet.
:::

## Neste trinn

:::cards
- [Kriterier og statuser](/docs/monitor/criteria-and-statuses): Hva som setter statusen til hver monitor.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups): Legg opp radene på en statusside.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers): Fortell kundene om en gruppes hendelser.
:::
