# Ressurser og grupper

En ressurs er én rad på statussiden din — en overvåking (eller en overvåkingsgruppe) med et navn de besøkende forstår, en gjeldende status, og eventuelt et oppetidstall og et historikkdiagram. En gruppe er en seksjon som holder ressurser, slik at en side med førti overvåkinger leses som «API», «Nettapp» og «Datapipeline» i stedet for én endeløs liste.

Du bygger begge deler på ett enkelt skjermbilde. Åpne en statusside og velg **Ressurser** i sidemenyen (elementet leser **Monitorer** i prosjekter som ikke har overvåkingsgrupper aktivert). Grupper hadde tidligere sin egen side; det har de ikke lenger, og den gamle URL-en `/groups` viderekobler bare hit.

Får du denne delen riktig, er resten av statussiden pynt. De besøkende avgjør «er det meg eller er det dem?» ut fra disse radene, så navngi dem slik kundene snakker om produktet ditt — **Checkout API**, ikke `prod-checkout-lb-healthcheck-us-east-1`.

## Skjermbildet Ressurser

Skjermbildet er delt i to. Til venstre er en navigator som lister hver gruppe på siden; til høyre er innholdet i den gruppen du valgte.

- **Gruppenavigatoren (til venstre)** — et tre av grupper, med et søkefelt (**Search groups...**) over seg og en løpende telling under seg, som `3 groups · 12 resources`. Når en side har flere grupper enn det er plass til, avslører en knapp **Show N more of M** resten.
- **Top of page** — den første raden i navigatoren. Den rommer ressurser som ikke er i noen gruppe, og verktøytipset sier nøyaktig hva det betyr: de besøkende ser disse først, over hver gruppe. Hvis siden ikke har grupper i det hele tatt, har høyre rute tittelen **Alle ressurser** i stedet.
- **Ressursruten (til høyre)** — har tittelen etter gruppen du valgte. Toppteksten bærer **Edit Group**, den primære knappen **Legg til monitor**, og en overflyt **More actions**.

To knapper bor i selve kortets topptekst: **New Group**, og en tre-prikkers overflyt som rommer **Import groups from CSV** og **Oppdater**.

Kortets beskrivelse endrer seg med formen på siden din. Med grupper leser den at dette er alt de besøkende ser, og at du skal velge en gruppe til venstre for å redigere hva som er i den. Uten grupper ennå puffer den deg mot å opprette én for å dele en lengre side i seksjoner.

**Tomtilstander forteller deg hva du skal gjøre.** En tom gruppe viser **No monitors here yet** med **Legg til monitor**, **Add Multiple**, og — kun når statussiden ikke har grupper i det hele tatt — **Create a Group**. Et søk som ikke treffer noe, viser **No resources match your search**. En tom navigator sier at grupper deler en lengre statusside i seksjoner og at de kan nestes.

## Å legge til en overvåking

Velg gruppen du vil at ressursen skal havne i (eller **Top of page** for en ugruppert rad), og klikk deretter **Legg til monitor**. Modalen har tittelen **Add a monitor to {group}** og har to trinn: **Monitordetaljer** og **Avansert**.

På **Monitordetaljer**:

- **Overvåking** — nedtrekkslisten over overvåkinger i prosjektet ditt, plassholder **Velg overvåking**. Obligatorisk.
- **Visningsnavn** — obligatorisk. Dette er teksten de besøkende leser, og den lagres separat fra overvåkingens eget navn, så du kan gi den nytt navn her uten å røre overvåkingen.
- **Beskrivelse** — valgfri markdown som vises under raden. Bra for en setning som forklarer hva tjenesten faktisk gjør.

Hvis prosjektet ditt har overvåkingsgrupper aktivert, leser en lenke under nedtrekkslisten **Add a Monitor Group instead.** — klikk den, så byttes nedtrekkslisten **Overvåking** ut med en nedtrekksliste **Monitor Gruppe** (**Velg overvåkingsgruppe**). Lenken snur da til **Add a Monitor instead.** så du kan gå tilbake. Bruk en overvåkingsgruppe når du vil at én rad på siden skal representere flere sjekker rullet sammen.

### Å legge til flere om gangen

**Add Multiple** (også **Add multiple monitors** i menyen **More actions**) åpner **Add Multiple Monitors**. Den har de samme to trinnene, men det første er et flervalg **Monitorer** i stedet for én enkelt nedtrekksliste, og visningsalternativene du velger på **Avansert** gjelder hver overvåking du valgte. Dette er den raskeste måten å så en ny side på.

## Visningsalternativer på en ressurs

Trinnet **Avansert** er det samme på enkeltleggingsskjemaet og bulkmodalen. Alt her er per ressurs — to rader i den samme gruppen kan konfigureres forskjellig.

| Felt                                                     | Formål                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Verktøytips** (`displayTooltip`)                       | Ekstra tekst som vises ved siden av ressursen på statussiden din. Bruk den til omfang: «Kunder i USA og EU». |
| **Vis gjeldende ressursstatus** (`showCurrentStatus`)    | På som standard. Viser den løpende statusen — operativ, forringet, offline — ved siden av raden.     |
| **Vis oppetid %** (`showUptimePercent`)                  | Av som standard. Viser en oppetidsprosent ved siden av ressursen.                                    |
| **Velg presisjon for oppetid** (`uptimePercentPrecision`) | Vises kun når **Vis oppetid %** er på. Obligatorisk, med én desimal som standard.                   |
| **Vis statushistorikkdiagram** (`showStatusHistoryChart`) | På som standard. Viser dag-for-dag-stolpediagrammet over oppetidshistorikk for ressursen.           |

**Visningsnavn** (`displayName`) og **Beskrivelse** (`displayDescription`) fra det første trinnet er også kun for visning — de endrer aldri selve overvåkingen.

## Oppetidsprosenter og historikkdiagrammer

Både **Vis oppetid %** og **Vis statushistorikkdiagram** avhenger av en innstilling som bor et annet sted. Vinduet de dekker er **Vis oppetidshistorikk (i dager)** under **Statussider → siden din → Avansert → Avanserte innstillinger**, i kortet **Innstillinger for oppetidshistorikk**. Det tar imot 1 til 90 dager og er som standard 90.

Så rekkefølgen er: slå på bryterne per ressurs, og sett så vinduet én gang for hele siden.

**Presisjon er en skjønnssak.** Nedtrekkslisten **Velg presisjon for oppetid** tilbyr `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` og `99.999% (Three Decimal)`. Flere desimaler ser presise ut og inviterer til krangel om den tredje; hvis du publiserer en SLA på tre nier, match den og ikke mer.

Grupper har sine egne kopier av disse bryterne — se under — så en gruppe kan vise en oppsummert prosent mens de enkelte overvåkingene inne i den holder seg stille, eller motsatt.

Fargene på historikkdiagrammets stolper, og hvilke overvåkingsstatuser som teller som «nede», settes på merkevareskjermbildet **Oversiktsside**, dekket i [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains).

## Grupper

Klikk **New Group** for å åpne **Create New Status Page Group**. Skjemaet har tre trinn: **Gruppedetaljer**, **Oppsett** og **Avansert**.

**Gruppedetaljer**:

- **Gruppenavn** (`name`) — obligatorisk. Dette er seksjonsoverskriften de besøkende ser.
- **Gruppebeskrivelse** (`description`) — valgfri markdown, vist under overskriften.
- **Parent Group** (`parentStatusPageGroupId`) — valgfri. La den stå på **No parent group (top level)** for å holde gruppen på øverste nivå.
- **Utvid på statusside som standard** (`isExpandedByDefault`) — om seksjonen starter åpen eller sammenslått for de besøkende.

**Avansert** speiler ressursbryterne på gruppenivå:

- **Vis gjeldende gruppestatus** (`showCurrentStatus`) — på som standard. Viser en status ved siden av gruppeoverskriften.
- **Vis oppetid %** (`showUptimePercent`) — av som standard, med **Velg presisjon for oppetid** som dukker opp når den er på.

Redigering fungerer på samme måte: **Edit Group** i rutens topptekst, eller **Edit group** i radmenyen i navigatoren, åpner **Edit Status Page Group** med en knapp **Lagre endringer**.

Rutens topptekst viser brikker for innstillingene som er på for øyeblikket — **Grid**, **Collapsed by default**, **Uptime %** — så du kan se hvordan en gruppe er konfigurert uten å åpne skjemaet.

### Å administrere en gruppe

Navigatorens meny per rad rommer **Edit group**, **Move up**, **Move down**, **Vis ID** og **Slett gruppe**. Rutens overflyt **More actions** har de lengre ekvivalentene — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Oppdater** og **Delete this group**. En gruppe lagret uten navn vises som **Untitled group**, som er et godt tegn på at du mente å skrive noe.

## Å neste grupper

Grupper kan nestes: sett **Parent Group** på barnet, eller bruk navigatorens handling **Add a sub group inside this group**. Skjemaets egen hjelpetekst beskriver formen det er bygget for — noe som Corporate Units › Region › Market — og påpeker at hvert nivå viser den oppsummerte statusen og oppetiden til alt under seg.

Når en gruppe har barn, viser ressursruten en brikkerad **Sub groups** som lenker rett inn i hvert barn, så du kan gå gjennom hierarkiet uten å gå tilbake til navigatoren.

Nesting gjør nytte for seg på store sider: en hostingleverandør med regioner inne i produkter, eller en forhandler med markeder inne i forretningsenheter. På en side med tolv overvåkinger er ett flatt nivå vennligere.

## Listeoppsett kontra rutenettoppsett

Trinnet **Oppsett** setter **Visningsmodus** (`viewMode`) for gruppen, og det endrer hvordan gruppen vises offentlig.

| Hvis du vil …                                                            | Velg                     |
| ------------------------------------------------------------------------ | ------------------------ |
| Vise en enkel vertikal liste over tjenester, én per rad                  | **List** (standarden)    |
| Vise den samme tjenesten på tvers av flere regioner eller tenanter som en matrise | **Grid**         |

Velg **Grid**, så dukker fire felt til opp:

- **Etikett for radakse** — navnet på raddimensjonen, plassholder `Service`.
- **Verdier for radakse** — selve radene, lagt til én om gangen med **Add Row** (plassholder `e.g. Auth`).
- **Kolonneakseetikett** — kolonnedimensjonen, plassholder `Region`.
- **Kolonneakseverdier** — lagt til med **Add Column** (plassholder `e.g. US-East`).

Hver overvåking i en rutenettgruppe plasseres så i en celle, så bulkmodalen spør om raden og kolonnen sammen med overvåkingene, og bruker dine egne akseetiketter.

**Sett opp aksene før du legger til overvåkinger.** En rutenettgruppe uten rader eller kolonner viser et gult varsel om at det ikke er noe sted å plassere en overvåking før aksene finnes, med en knapp **Set up the grid** — og knappen **Legg til monitor** trekkes tilbake til du gjør det.

## Å bestemme rekkefølgen de besøkende ser

Rekkefølgen er eksplisitt, ikke alfabetisk, og den settes tre steder:

- **Ressurser inne i en gruppe** — dra en rad. Ruten sier det: **Drag a row to change the order visitors see**.
- **Grupper i forhold til hverandre** — **Move up** / **Move down** i navigatorens radmeny, eller **Move group up** / **Move group down** i rutens overflyt.
- **Ugrupperte ressurser** — de bor i **Top of page** og vises alltid over hver gruppe, så plasser den ene tingen alle sjekker først der.

**To tilfeller der dragging er av.** Å filtrere ruten med feltet **Search in {group}...** deaktiverer omordning — ruten forteller deg `N of M shown · drag to reorder is off while filtering`, så tøm søket først. Og rutenettgrupper støtter aldri dragrekkefølge, fordi posisjonen kommer fra rad- og kolonneaksene i stedet.

Sett tjenesten det spørres mest om øverst. Besøkende som kom til siden under en nedetid, slutter vanligvis å lese etter den første skjermen.

## Å importere grupper fra CSV

Å bygge et dypt hierarki for hånd er kjedelig. Tre-prikkers-overflyten i kortets topptekst har **Import groups from CSV**, som åpner modalen **Import Groups from CSV**.

Flyten er: **Download CSV Template** for å få `status-page-groups-template.csv`, fyll den ut, **Choose CSV File**, og deretter **Preview Import** for å sjekke hva som vil bli opprettet før noe skrives. Resultatet deler seg i **Groups Imported** og **Some Groups Could Not Be Imported**, så en dårlig rad forsvinner ikke i stillhet.

Bare `name` er obligatorisk. De aksepterte kolonnene er:

| Kolonne                  | Hva den setter                                          |
| ------------------------ | ------------------------------------------------------- |
| `name`                   | Gruppenavnet. Obligatorisk.                             |
| `parentName`             | Navnet på gruppen denne nestes inne i.                  |
| `description`            | Gruppebeskrivelsen.                                     |
| `isExpandedByDefault`    | Om seksjonen starter åpen for de besøkende.             |
| `showCurrentStatus`      | Om en status vises ved siden av gruppeoverskriften.     |
| `showUptimePercent`      | Om en oppetidsprosent vises ved siden av gruppen.       |
| `uptimePercentPrecision` | Hvor mange desimaler den prosenten bruker.              |
| `viewMode`               | `List` eller `Grid`.                                    |
| `rowAxisLabel`           | Navn på raddimensjonen for en rutenettgruppe.           |
| `rowAxisValues`          | Radverdiene for en rutenettgruppe.                      |
| `columnAxisLabel`        | Navn på kolonnedimensjonen for en rutenettgruppe.       |
| `columnAxisValues`       | Kolonneverdiene for en rutenettgruppe.                  |

Importen oppretter grupper, ikke ressurser — legg til overvåkinger etterpå med **Legg til monitor** eller **Add Multiple**.

## Hvor du leser videre

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan bitene henger sammen.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — logo, favicon, diagramfarger, og å sette siden på ditt eget domene.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får beskjed når disse ressursene endrer seg.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på, og forsvinne fra, siden.
