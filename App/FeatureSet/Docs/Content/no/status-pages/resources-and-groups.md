# Ressurser og grupper

En ressurs er én rad på statussiden din — en overvåking (eller en overvåkingsgruppe) med et navn de besøkende forstår, en gjeldende status og eventuelt et oppetidstall og et historikkdiagram. En gruppe er en seksjon som rommer ressurser, slik at en side med førti overvåkinger leses som «API», «Nettapp» og «Datapipeline» i stedet for én endeløs liste.

Du bygger begge deler på ett og samme skjermbilde. Åpne en statusside og velg **Ressurser** i sidemenyen (elementet leser **Monitorer** i prosjekter som ikke har overvåkingsgrupper aktivert). Grupper hadde en gang sin egen side; det har de ikke lenger, og den gamle `/groups`-URL-en viderekobler bare hit.

Får du denne delen riktig, er resten av statussiden pynt. De besøkende avgjør «er det meg eller er det dem?» ut fra disse radene, så navngi dem slik kundene snakker om produktet ditt — **Checkout API**, ikke `prod-checkout-lb-healthcheck-us-east-1`.

## Skjermbildet Ressurser

Skjermbildet er delt i to. Til venstre ligger en navigator som lister hver gruppe på siden; til høyre ligger innholdet i gruppen du valgte.

- **Gruppenavigatoren (til venstre)** — et tre av grupper, med et søkefelt (**Search groups...**) over og en løpende telling under, som `3 groups · 12 resources`. Har en side flere grupper enn det er plass til, avdekker en knapp **Show N more of M** resten.
- **Top of page** — den første raden i navigatoren. Den rommer ressurser som ikke ligger i noen gruppe, og verktøytipset sier nøyaktig hva det betyr: de besøkende ser disse først, over hver gruppe. Har siden ingen grupper i det hele tatt, heter høyre rute **Alle ressurser** i stedet.
- **Ressursruten (til høyre)** — navngitt etter gruppen du valgte. Toppen bærer **Edit Group**, primærknappen **Legg til monitor** og en overflytsmeny **More actions**.

To knapper ligger i selve korttoppen: **New Group**, og en trepunktsmeny som rommer **Import groups from CSV** og **Oppdater**.

Kortets beskrivelse endrer seg med formen på siden din. Med grupper leser den at dette er alt de besøkende ser, og at du skal velge en gruppe til venstre for å redigere hva som ligger i den. Uten grupper ennå dytter den deg mot å opprette én for å dele en lengre side i seksjoner.

**Tomtilstandene forteller deg hva du skal gjøre.** En tom gruppe viser **No monitors here yet** med **Legg til monitor**, **Add Multiple** og — bare når statussiden ikke har noen grupper i det hele tatt — **Create a Group**. Et søk uten treff viser **No resources match your search**. En tom navigator forteller at grupper deler en lengre statusside i seksjoner, og at de kan nestes.

## Å legge til en overvåking

Velg gruppen ressursen skal havne i (eller **Top of page** for en rad uten gruppe), og klikk så **Legg til monitor**. Modalen heter **Add a monitor to {group}** og har to trinn: **Monitordetaljer** og **Avansert**.

På **Monitordetaljer**:

- **Overvåking** — nedtrekkslisten over overvåkinger i prosjektet ditt, plassholder **Velg overvåking**. Påkrevd.
- **Visningsnavn** — påkrevd. Dette er teksten de besøkende leser, og den lagres atskilt fra overvåkingens eget navn, så du kan gi den nytt navn her uten å røre overvåkingen.
- **Beskrivelse** — valgfri markdown som vises under raden. Fint til én setning om hva tjenesten faktisk gjør.

Har prosjektet ditt overvåkingsgrupper aktivert, ligger det en lenke under nedtrekkslisten som leser **Add a Monitor Group instead.** — klikk den, så byttes nedtrekkslisten **Overvåking** ut med en nedtrekksliste **Monitor Gruppe** (**Velg overvåkingsgruppe**). Lenken snur seg da til **Add a Monitor instead.** så du kan gå tilbake. Bruk en overvåkingsgruppe når du vil at én rad på siden skal representere flere sjekker rullet sammen.

### Å legge til flere om gangen

**Add Multiple** (også **Add multiple monitors** i menyen **More actions**) åpner **Add Multiple Monitors**. Den har de samme to trinnene, men det første er et flervalg **Monitorer** i stedet for én nedtrekksliste, og visningsvalgene du gjør på **Avansert**, gjelder hver eneste overvåking du plukket. Dette er den raskeste måten å så en ny side på.

## Visningsvalg på en ressurs

Trinnet **Avansert** er det samme i enkeltskjemaet og i bulkmodalen. Alt her gjelder per ressurs — to rader i samme gruppe kan settes opp helt ulikt.

| Felt                                                     | Formål                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Verktøytips** (`displayTooltip`)                       | Ekstra tekst som vises ved siden av ressursen på statussiden. Bruk den til rekkevidde: «Kunder i USA og EU». |
| **Vis gjeldende ressursstatus** (`showCurrentStatus`)    | På som standard. Viser sanntidsstatusen — i drift, redusert, nede — ved siden av raden.                     |
| **Vis oppetid %** (`showUptimePercent`)                  | Av som standard. Viser en oppetidsprosent ved siden av ressursen.                                           |
| **Velg presisjon for oppetid** (`uptimePercentPrecision`) | Dukker først opp når **Vis oppetid %** er på. Påkrevd, med én desimal som standard.                        |
| **Vis statushistorikkdiagram** (`showStatusHistoryChart`) | På som standard. Viser stolpediagrammet med oppetidshistorikk dag for dag for ressursen.                    |

**Visningsnavn** (`displayName`) og **Beskrivelse** (`displayDescription`) fra første trinn er også rene visningsfelt — de endrer aldri selve overvåkingen.

## Oppetidsprosenter og historikkdiagrammer

Både **Vis oppetid %** og **Vis statushistorikkdiagram** avhenger av en innstilling som bor et annet sted. Vinduet de dekker, er **Vis oppetidshistorikk (i dager)** under **Statussider → siden din → Avansert → Avanserte innstillinger**, i kortet **Innstillinger for oppetidshistorikk**. Det tar imot 1 til 90 dager og er 90 som standard.

Rekkefølgen er altså: slå på bryterne per ressurs, og sett så vinduet én gang for hele siden.

**Presisjon er en vurderingssak.** Nedtrekkslisten **Velg presisjon for oppetid** tilbyr `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` og `99.999% (Three Decimal)`. Flere desimaler ser presise ut og inviterer til krangel om den tredje; publiserer du en SLA på tre nier, treff den og ikke mer.

Grupper har sine egne utgaver av disse bryterne — se nedenfor — så en gruppe kan vise en oppsummert prosent mens de enkelte overvåkingene inni holder seg stille, eller omvendt.

Fargene på stolpene i historikkdiagrammet, og hvilke overvåkingsstatuser som teller som «nede», settes på merkevareskjermbildet **Oversiktsside**, som er dekket i [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains).

## Grupper

Klikk **New Group** for å åpne **Create New Status Page Group**. Skjemaet har tre trinn: **Gruppedetaljer**, **Oppsett** og **Avansert**.

**Gruppedetaljer**:

- **Gruppenavn** (`name`) — påkrevd. Dette er seksjonsoverskriften de besøkende ser.
- **Gruppebeskrivelse** (`description`) — valgfri markdown, vist under overskriften.
- **Parent Group** (`parentStatusPageGroupId`) — valgfritt. La den stå på **No parent group (top level)** for å holde gruppen på øverste nivå.
- **Utvid på statusside som standard** (`isExpandedByDefault`) — om seksjonen starter åpen eller sammenslått for de besøkende.

**Avansert** speiler ressursbryterne på gruppenivå:

- **Vis gjeldende gruppestatus** (`showCurrentStatus`) — på som standard. Viser en status ved siden av gruppeoverskriften.
- **Vis oppetid %** (`showUptimePercent`) — av som standard, med **Velg presisjon for oppetid** som dukker opp så snart den er på.

Redigering fungerer likedan: **Edit Group** i rutetoppen, eller **Edit group** i radmenyen i navigatoren, åpner **Edit Status Page Group** med en knapp **Lagre endringer**.

Rutetoppen viser brikker for innstillingene som er på akkurat nå — **Grid**, **Collapsed by default**, **Uptime %** — så du kan se hvordan en gruppe er satt opp uten å åpne skjemaet.

### Å administrere en gruppe

Radmenyen i navigatoren rommer **Edit group**, **Move up**, **Move down**, **Vis ID** og **Slett gruppe**. Overflytsmenyen **More actions** i ruten har de lengre variantene — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Oppdater** og **Delete this group**. En gruppe som lagres uten navn, vises som **Untitled group**, noe som er et godt tegn på at du mente å skrive noe.

## Å neste grupper

Grupper kan nestes: sett **Parent Group** på barnet, eller bruk navigatorens handling **Add a sub group inside this group**. Skjemaets egen hjelpetekst beskriver formen den er bygget for — noe i retning av Corporate Units › Region › Market — og nevner at hvert nivå viser den oppsummerte statusen og oppetiden til alt under seg.

Når en gruppe har barn, viser ressursruten en brikkerad **Sub groups** som lenker rett inn i hvert barn, så du kan gå gjennom hierarkiet uten å hoppe tilbake til navigatoren.

Nesting gjør nytte for seg på store sider: en hostingleverandør med regioner inni produkter, eller en varehandelskjede med markeder inni forretningsområder. På en side med tolv overvåkinger er ett flatt nivå vennligere.

## Listeoppsett mot rutenettoppsett

Trinnet **Oppsett** setter **Visningsmodus** (`viewMode`) for gruppen, og det endrer hvordan gruppen vises offentlig.

| Hvis du vil …                                                          | Velg                    |
| ----------------------------------------------------------------------- | ---------------------- |
| Vise en enkel loddrett liste over tjenester, én per rad                | **List** (standarden)  |
| Vise den samme tjenesten på tvers av flere regioner eller tenanter som en matrise | **Grid**     |

Velger du **Grid**, dukker fire felt til opp:

- **Etikett for radakse** — navnet på raddimensjonen, plassholder `Service`.
- **Verdier for radakse** — selve radene, lagt til én om gangen med **Add Row** (plassholder `e.g. Auth`).
- **Kolonneakseetikett** — kolonnedimensjonen, plassholder `Region`.
- **Kolonneakseverdier** — lagt til med **Add Column** (plassholder `e.g. US-East`).

Hver overvåking i en rutenettgruppe plasseres så i en celle, så bulkmodalen spør om raden og kolonnen ved siden av overvåkingene, med dine egne akseetiketter.

**Sett opp aksene før du legger til overvåkinger.** En rutenettgruppe uten rader eller kolonner viser en gul melding om at det ikke finnes noe sted å plassere en overvåking før aksene finnes, med en knapp **Set up the grid** — og knappen **Legg til monitor** er trukket tilbake til du gjør det.

## Å bestemme rekkefølgen de besøkende ser

Rekkefølgen er eksplisitt, ikke alfabetisk, og den settes tre steder:

- **Ressurser inni en gruppe** — dra en rad. Ruten sier det selv: **Drag a row to change the order visitors see**.
- **Grupper i forhold til hverandre** — **Move up** / **Move down** i radmenyen i navigatoren, eller **Move group up** / **Move group down** i rutens overflytsmeny.
- **Ressurser uten gruppe** — de bor i **Top of page** og vises alltid over hver gruppe, så legg den ene tingen alle sjekker først, dit.

**To tilfeller der dragingen er av.** Filtrerer du ruten med feltet **Search in {group}...**, slås omorganisering av — ruten forteller deg `N of M shown · drag to reorder is off while filtering`, så tøm søket først. Og rutenettgrupper støtter aldri dragerekkefølge, fordi posisjonen kommer fra rad- og kolonneaksene i stedet.

Legg tjenesten folk spør mest om, øverst. Besøkende som kom til siden under et driftsavbrudd, slutter som regel å lese etter første skjermbilde.

## Å importere grupper fra CSV

Å bygge et dypt hierarki for hånd er tungt arbeid. Trepunktsmenyen i korttoppen har **Import groups from CSV**, som åpner modalen **Import Groups from CSV**.

Flyten er: **Download CSV Template** for å hente `status-page-groups-template.csv`, fyll den ut, **Choose CSV File**, og så **Preview Import** for å se hva som blir opprettet før noe skrives. Resultatet deler seg i **Groups Imported** og **Some Groups Could Not Be Imported**, så en dårlig rad forsvinner ikke i stillhet.

Bare `name` er påkrevd. De godtatte kolonnene er:

| Kolonne                  | Hva den setter                                          |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | Gruppenavnet. Påkrevd.                                  |
| `parentName`             | Navnet på gruppen denne skal ligge inni.                |
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

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan delene henger sammen.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — logo, favicon, diagramfarger og å legge siden på ditt eget domene.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får beskjed når disse ressursene endrer seg.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på, og forsvinne fra, siden.
