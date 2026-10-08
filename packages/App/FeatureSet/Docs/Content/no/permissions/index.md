# Brukere, team og tillatelser

Alt i OneUptime lever inne i et **prosjekt**. Hvem som får gjøre hva der, kommer an på tre ting: **brukerne** i prosjektet, **teamene** de tilhører, og **tillatelsene** disse teamene har fått.

Den ene regelen som forklarer det meste: **brukere har aldri tillatelser direkte.** En brukers tilgang er unionen av tillatelsene til alle teamene brukeren tilhører i det prosjektet. Vil du endre hva noen får gjøre, endrer du teammedlemskapet deres eller tillatelsene til det teamet.

**Eiere** er en annen idé. En eier er den som har ansvaret for én bestemt ressurs — en overvåker, en hendelse, et dashbord. Eiere varsles om ressursene sine, og tillatelser kan om ønskelig snevres inn til «bare det jeg eier».

## Modellen i korte trekk

```text
Prosjekt
  └── Team                        ← tillatelsene henger her
       ├── Tillatte rettigheter   ← hver med et omfang: Alle / Eide / Etiketter
       ├── Blokkerte rettigheter  ← vinner alltid over tillatte
       └── Teammedlemmer          ← brukere som har godtatt invitasjonen
```

| Begrep | Hva det er |
| --- | --- |
| Bruker | Én OneUptime-konto. Én innlogging, vilkårlig mange prosjekter. |
| Prosjekt | Tenant-grensen. Overvåkere, hendelser, team og data hører til nøyaktig ett prosjekt. |
| Team | En navngitt gruppe i et prosjekt som bærer tillatelsene. |
| Teammedlem | En bruker som er invitert til et team og har godtatt. |
| Tillatelse | Én enkelt funksjon, f.eks. `CreateProjectMonitor`, eller en rolle som samler mange, f.eks. `MonitorAdmin`. |
| Omfang | Hvor bredt en tillatt rettighet rekker: alle ressurser, bare eide eller bare etiketterte. |
| Eier | En bruker eller et team merket som ansvarlig for én bestemt ressurs. |
| Etikett | En merkelapp du setter på ressurser, brukt til å begrense tillatelser og til å organisere. |

## Brukere

En brukerkonto er global for OneUptime-instansen — den samme innloggingen virker i alle prosjekter brukeren er invitert til.

En bruker er «i» et prosjekt når vedkommende er medlem av **minst ett team** der. Det finnes ikke noe eget steg «legg bruker til prosjekt»: å invitere noen til et prosjekt er å invitere dem til et team.

- Invitasjoner oppretter et ventende teammedlem. Brukeren teller først som prosjektmedlem — og får først noen tillatelse — **etter å ha godtatt invitasjonen.**
- Fjerner du en bruker fra alle team i et prosjekt, mister vedkommende tilgangen til prosjektet.
- Den som forlater et prosjekt, får ikke lenger varslene fra det. Personens egne varslingsmetoder, -regler og -innstillinger for prosjektet fjernes sammen med det siste teamet — e-post, SMS, anrop, WhatsApp, Telegram, push, webhook, Slack og Microsoft Teams, e-postsammendraget og e-posten som ennå ikke er sendt, nummeret for innkommende anrop og vaktpåminnelsene —, så den som blir med igjen, starter fra standardinnstillingene. Det som fortsatt nevner personen, som brukeren en regel for innkommende anrop ringer til eller en eier som beholdes på en løst hendelse, varsler ikke lenger personen: ingenting sendes på vegne av et prosjekt til noen som ikke er medlem, og en ventende invitasjon er ennå ikke et medlemskap. Disse stedene viser **Ikke lenger medlem** ved siden av navnet, slik at du kan sette inn en annen. Den som er invitert og ikke har akseptert ennå, viser i stedet **Invitasjon ikke akseptert ennå**. Hvis en overstyring sender noens varsler videre til en person som har forlatt prosjektet, varsles i stedet den som overstyringen dekker. Å forlate prosjektet kobler også fra MCP-klientene personen har koblet til prosjektet, og personens personlige lenke til vaktkalenderen viser deretter en tom kalender. På OneUptime Cloud bekrefter den som kommer tilbake via prosjektets enkel pålogging (SSO), den på nytt fra e-postkassen sin.
- Krever prosjektet SSO og brukeren ennå ikke har autentisert seg via identitetsleverandøren, behandles vedkommende som uautorisert SSO-bruker og ser ingenting før det er gjort. Se [SSO](/docs/identity/sso).
- Med SCIM satt opp kan identitetsleverandøren opprette, oppdatere og fjerne brukere og teammedlemskap automatisk. Se [SCIM](/docs/identity/scim).

Hvor du finner det: **Innstillinger → Brukere** viser alle i prosjektet og invitasjonsstatusen deres.

## Team

Team er veien tillatelsene tar til folk. Hvert nye prosjekt starter med tre:

| Team | Tillatelse | Redigerbart |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nei. Har alltid minst ett medlem. |
| Admin | `ProjectAdmin` | Nei |
| Members | `ProjectMember` | Ja — dette er et utgangspunkt, endre det fritt |

Teamene **Owners** og **Admin** er bevisst låst: tillatelsene deres kan ikke redigeres, og teamene kan verken slettes eller endre navn. Det er dette som hindrer at et prosjekt låser seg selv ute ved et uhell. Owners-teamet må alltid beholde minst ett medlem.

`ProjectOwner` er det høyeste tilgangsnivået: fakturering, sletting av prosjektet og alt en administrator kan gjøre. `ProjectAdmin` dekker alt bortsett fra fakturering og sletting av prosjektet.

Å slå SMS, telefonanrop, WhatsApp eller Telegram av eller på for prosjektet regnes som fakturering, fordi hver melding koster penger. Bare `ProjectOwner`, rollen `BillingAdmin` (**Billing Admin**) og tillatelsen `ManageProjectBilling` (**Manage Billing**) kan endre disse bryterne, under **Prosjektinnstillinger > Varsler > Varselinnstillinger** — ikke `ProjectAdmin`.

Å fylle på prosjektets forhåndsbetalte saldoer regnes også som fakturering. På OneUptime Cloud betales SMS, telefonanrop, WhatsApp og Telegram fra saldoen under **Prosjektinnstillinger > Varsler > Varselinnstillinger**, og KI fra AI-kredittene under **Prosjektinnstillinger > KI > AI-kreditter**. Bare en prosjekteier eller noen med **Manage Billing** kan fylle dem på eller endre **Automatisk påfylling** for dem — ikke en prosjektadministrator. En melding om en saldo som er i ferd med å gå tom, sier hvem som kan fylle den på, og bare de personene får en knapp **Fyll på saldo** som virker, eller en lenke til siden.

Opprett så mange ekstra team du vil — «Frontend-vakt», «Support», «Skrivebeskyttede revisorer» — og gi hvert av dem tillatelsene det trenger.

Hvor du finner det: **Innstillinger → Team**. Åpne et team for å komme til **Members** og **Permissions**; **Block Permissions** ligger under **More settings** nederst på Permissions-siden.

## Tillatelser

En tillatelse er én funksjon. Det finnes to måter å dele dem ut på, begge på teamets fane **Permissions**.

### Roller

En rolle samler et helt produktområde på ett av tre nivåer:

- **Admin** — det Member gjør, pluss områdets egen konfigurasjon, som alvorlighetsgrader og tilstander for hendelser og varsler, monitorstatuser og vedlikeholdstilstander.
- **Member** — det daglige arbeidet: opprette, endre og slette områdets ressurser med notater, eiere og maler. For statussider og vakt kan Member alt Admin kan.
- **Viewer** — kun lesing.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` og så videre. Roller er nesten alltid riktig valg — de forblir korrekte etter hvert som OneUptime får nye funksjoner, fordi en ny overvåkerrelatert tabell legges inn under de eksisterende overvåkerrollene i stedet for å kreve en ny tildeling fra deg.

Arbeidsflyter og runbooks er unntaket. Begge kjører kode i prosjektet ditt — en arbeidsflyt trinnene sine, en runbook skriptene sine på Runnerne dine —, så `WorkflowMember` åpner arbeidsflyter og kjøringene deres og kjører dem manuelt, og `RunbookMember` åpner runbooks og kjøringene deres og kjører dem: den starter en kjøring, fullfører eller hopper over trinnene og avbryter den. Ingen av dem oppretter, endrer eller sletter det de kjører; `WorkflowAdmin` og `RunbookAdmin` bygger dem. En rolle kjører bare runbookene omfanget dens når: en `RunbookMember` som er begrenset til noen etiketter, kjører runbookene som har dem. Se [Arbeidsflytkonfigurasjon](/docs/workflows/configuration) og [Runbook-konfigurasjon](/docs/runbooks/configuration).

Et områdes regler (etikett-, eier-, vakt-, grupperings- og påminnelsesregler), egendefinerte felt, SLA-er og hemmeligheter er prosjektkonfigurasjon: de krever `ProjectAdmin`, uansett hvilken områderolle man har. Det samme gjelder API-nøkler, team og tillatelsene deres, etiketter, SSO og domener — Settings-rollene tar seg av prosjektets tjenester, prober, infrastruktur og integrasjoner, ikke hvem som får gjøre hva.

Fakturering har tre egne roller. `BillingViewer` leser prosjektets fakturering — planen og abonnementet, fakturaer, bruk, saldoer, AI-kreditter, betalingsmetoder og kontaktopplysningene for fakturering — og endrer ingenting. `BillingMember` laster i tillegg ned fakturaer og endrer kontaktopplysningene for fakturering. `BillingAdmin` gjør det `BillingMember` gjør, og slår SMS, telefonsamtaler, WhatsApp og Telegram av og på. Å endre planen, betalingsmetoder eller saldoer og å betale fakturaer krever `ProjectOwner` eller **Manage Billing**; på faktureringssidene er disse knappene låst for alle andre og forteller hvem som kan bruke dem.

Alle {{PERMISSION_ROLE_COUNT}} rollene står i [Tillatelsesreferansen](/docs/permissions/reference).

### Granulære tillatelser

Hver enkelt funksjon kan også tildeles alene — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` og {{PERMISSION_TOTAL_COUNT}} andre. Bruk disse når en rolle er for bred og du må gi nøyaktig én ting.

En tillatelse til å endre eller slette noe når bare det du også har lov til å lese, så gi den tilsvarende lesetillatelsen sammen med den: `EditProjectIncident` endrer ingen hendelse uten `ReadProjectIncident`. En post som leses gjennom en annen, for eksempel et notat på en hendelse, trenger også en tillatelse til å lese den andre posten: `ReadIncidentInternalNote` når ingen notater uten en tillatelse til å lese hendelser, og `CreateIncidentInternalNote` legger bare til et notat på en hendelse du har lov til å lese. Rollene har begge allerede.

Det er også nøklene du bruker når du oppretter API-nøkler, og dem API-et og Terraform-provideren forventer.

Hele listen finnes i [Tillatelsesreferansen](/docs/permissions/reference).

### Tillat og blokker

Hvert team har to lister:

- **Permissions** (tillat) — hva dette teamet får gjøre.
- **Block Permissions** — hva dette teamet aldri får gjøre, uansett tillatelse.

**Blokkering vinner alltid.** En blokkering uten etiketter fjerner funksjonen helt for teamet. En blokkering med etiketter fjerner den bare for ressurser med de etikettene — nyttig for «dette teamet kan redigere overvåkere, unntatt dem merket Production».

En tillatelse kan ikke bære begrensningsetiketter i begge listene samtidig; OneUptime avviser den andre med en forklaring.

En brukers tillatelser legges sammen på tvers av alle teamene vedkommende er med i, men en blokkering gjelder alt brukeren gjør: en blokkering uten etiketter i ett team fjerner funksjonen også der et annet team tillater den, og en blokkering gir aldri noe. Har noen mindre tilgang enn du venter, se etter en blokkering i hvert av teamene deres; har de mer, se etter en tillatelse i hvert team.

### Endre en tilstand

En hendelse, et varsel, en varsel- eller hendelsesepisode og et planlagt vedlikehold endrer tilstand, og en monitor endrer status, ved en ny rad på tilstandstidslinjen sin. Å kvittere, løse, endre tilstand, siden med tilstandstidslinjen, API-et og arbeidsflyter legger alle til en slik rad. Det krever tidslinjens egen tillatelse til å opprette, sammen med en tillatelse til å lese posten den endrer:

| For å endre tilstanden til | Kreves |
| --- | --- |
| En hendelse | **Create Incident State Timeline** |
| Et varsel | **Create Alert State Timeline** |
| En varselepisode | **Create Alert Episode State Timeline** |
| En hendelsesepisode | **Create Incident Episode State Timeline** |
| Et planlagt vedlikehold | **Create Scheduled Maintenance State Timeline** |
| En monitor (statusen) | **Create Monitor Status Timeline** |

Posten får deretter den nye tilstanden fra OneUptime selv, sammen med det som hører til, for eksempel når en episode ble løst, eller når et vedlikehold neste gang minner abonnentene sine på det. En endring krever altså ikke i tillegg en tillatelse til å redigere posten: en egendefinert rolle med **Create Incident State Timeline**, men uten **Edit Incident**, endrer en hendelses tilstand. Vil du hindre et team i å endre tilstander, blokker tidslinjens tillatelse til å opprette; en blokkering av **Edit Incident** lar tilstandsendringer være. Etiketter, eiere og private poster snevrer inn tidslinjens tillatelse til å opprette slik de snevrer inn enhver annen, gjennom posten den endrer tilstanden til: se reglene for omfang nedenfor.

Bare tilstanden skrives for deg. Et notat som sendes med en endring, sendes som deg og krever notatets egen tillatelse, som beskrevet i [Tilstander og alvorlighetsgrader](/docs/incidents/states-and-severities). Å kvittere for en hendelses varsler mens du erklærer den, krever fortsatt også **Edit Alert**: se [Koblede varsler](/docs/incidents/linked-alerts).

## Omfang: hvor langt en tillatt rettighet rekker

Enhver tillatt rettighet gis med et omfang, som du velger når du legger den til:

| Omfang | Betydning |
| --- | --- |
| Alle ressurser i prosjektet | Standardvalget. Tillatelsen gjelder alle ressurser som passer. |
| Eid av dette teamet eller medlemmene | Tillatelsen gjelder bare ressurser der dette teamet, eller brukeren som handler, står som eier. |
| Begrens etter etiketter (avansert) | Tillatelsen gjelder bare ressurser med minst én av de valgte etikettene. |

**Eide** er den enkleste veien til en modell der «du passer dine egne tjenester»: gi et team `MonitorAdmin` med omfanget Eide, og gjør deretter teamet til eier av overvåkerne det har ansvar for. Det snevrer bare inn ressurser som faktisk kan ha eiere — overvåkere, hendelser, dashbord, tjenester og lignende. Prosjektkonfigurasjon (hendelsestilstander, etiketter, teamene selv) har ingen eier, så der oppfører en rolle med omfanget Eide seg helt normalt.

**Etiketter** er den mer manuelle varianten av samme idé: merk ressurser, og gi så tillatelser begrenset til de merkelappene.

Noen roller er prosjektomfattende per definisjon og tilbyr ikke noe omfang i det hele tatt, fordi det ville være meningsløst å snevre dem inn — «Billing Admin, men bare for faktureringen jeg eier» beskriver ingenting:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Eiere

En eier er en bruker eller et team knyttet til én bestemt ressurs. De fleste ressurser som representerer noe du drifter — overvåkere, hendelser, varsler, planlagt vedlikehold, vaktordninger, dashbord, tjenester, statussider, arbeidsflyter, runbooks og SLO-er — har en fane **Owners**.

Eiere har to oppgaver:

1. **Varsling.** Eiere er dem OneUptime sier fra til når noe skjer med ressursen — en overvåker går ned, en hendelse opprettes, en SLO begynner å bruke av feilbudsjettet sitt.
2. **Tilgang, når du ber om det.** Eierskap er det omfanget Eide løses mot. En bruker passer hvis vedkommende personlig er eier, eller hvis et av brukerens team er eier.

Eierskap alene gir ingenting. Å eie en overvåker gir ikke rett til å redigere den med mindre et av teamene dine også har en overvåkertillatelse. Eierskap snevrer inn tilgang; det utvider den aldri.

## Etiketter

Etiketter er prosjektomfattende merkelapper du setter på ressurser. De har to formål: filtrering og gruppering i dashbordet, og begrensning av tillatelser som beskrevet over.

En etikettbegrensning er oppfylt hvis ressursen bærer **minst én** av tillatelsens etiketter. En ressurs helt uten etiketter oppfyller ingen etikettbegrenset tillatelse.

En post uten egne etiketter, for eksempel et notat på en hendelse, en kunngjøring på en statusside eller en AI-innsikt om en tjeneste, bærer etikettene til postene den hører til eller handler om. En tillatelse begrenset til etiketter når den når en av de postene bærer en av tillatelsens etiketter, og en blokkering med etiketter fjerner den når en av dem bærer en blokkert etikett, ved lesing, endring og sletting likt. En post som ikke handler om noen av dem, for eksempel en AI-innsikt som ikke handler om noen tjeneste, hører til prosjektet: en etikettbegrensning avgrenser den ikke, og en blokkering med etiketter fjerner den ikke.

Hvor du finner det: **Innstillinger → Etiketter**.

## Telemetri

Logger, sporinger, metrikker, unntak, profiler og øktavspillinger hører til ressursen som sendte dem: en tjeneste, en vert, en Kubernetes-klynge, en monitor, en RUM-applikasjon og lignende. En telemetritillatelse leser så langt omfanget rekker:

- **Alle ressurser** leser telemetrien til alle ressursene i prosjektet.
- **Eide** leser telemetrien til ressursene du eller et av teamene dine eier, og telemetri som ikke nevner noen ressurs.
- **Etiketter** leser telemetrien til ressursene som bærer en av tillatelsens etiketter.

En blokkering med etiketter på en telemetritillatelse utelater telemetrien til ressursene som bærer de etikettene, uansett hva annet du har. Det gjelder overalt der telemetri leses: utforskerne med sine diagrammer, filtre og attributtlister, eksporter, øktavspillinger og det AI-assistenten leser for deg. Listen over metrikknavn viser metrikkene som en tjeneste du kan lese rapporterer, og metrikkene ingen tjeneste rapporterer, for eksempel verts- og klyngemetrikker. Kan du også lese telemetrien til andre typer ressurser, for eksempel verter eller klynger, viser den alle metrikknavn.

Sletting av telemetri holder seg til de samme ressursene: en sletting når radene fra ressursene som både tillatelsen din til å lese signalet og tillatelsen din til å slette det når, minus dem en blokkering med etiketter på en av dem fjerner, og den gjøres i ett prosjekt om gangen.

Monitorlogger, SLO-historikk, nettverksflyter og kostnadsfordelinger for Kubernetes leses på samme måte, gjennom monitoren, SLO-en, nettverksenheten eller klyngen de hører til: Eide og Etiketter når radene til postene du kan lese, og en blokkering med etiketter utelater radene til postene som bærer de etikettene. Revisjonsloggen og trusseletterretningsindikatorene leses i hele prosjektet av den som kan lese dem.

## API-nøkler

API-nøkler får tillatelser direkte på selve nøkkelen — de tilhører ikke team og påvirkes ikke av teammedlemskap.

- Tildel de samme granulære tillatelsene og rollene du ville gitt et team.
- Nøkler støtter **blokkerte tillatelser** og **etikettbegrensninger** på samme måte som team.
- Nøkler støtter **ikke** omfanget Eide. Eierskap løses mot en bruker, og en nøkkel er ikke en bruker — gi derfor nøkler den tilgangen de trenger eksplisitt.

Gi hver integrasjon sin egen nøkkel med det smaleste settet tillatelser som fungerer, slik at du kan trekke tilbake én uten å forstyrre de andre.

Hvor du finner det: **Innstillinger → API-nøkler**. Se også [API-referansen](/docs/api-reference/api-reference).

## Slik avgjør OneUptime om en forespørsel er tillatt

For en innlogget bruker, i rekkefølge:

1. Finn teamene brukeren tilhører i dette prosjektet — bare godtatte invitasjoner teller. En forespørsel når bare postene i dette prosjektet: en post i et annet prosjekt, angitt med sin id eller i et filter, behandles som om den ikke fantes.
2. Samle alle tillatelsesrader fra disse teamene — tillatte og blokkerte, hver med etiketter og omfang.
3. Sjekk blokkeringslisten først. En blokkering uten etiketter på en hvilken som helst tillatelse måltabellen godtar for denne operasjonen, avviser forespørselen umiddelbart, uansett hvilket team den er satt på.
4. Sjekk tillatelseslisten. Forespørselen trenger minst én tillatelse som måltabellen godtar for denne operasjonen. For en driftsressurs — en overvåker, en hendelse, et dashbord og lignende — teller også den tilsvarende **All Operational Resources**-tillatelsen (Create, Read, Edit eller Delete), med mindre den selv er blokkert.
5. Bruk omfanget. Tildelinger med omfanget Eide snevrer spørringen inn til eide ressurser; etikettbaserte snevrer inn til treffende etiketter. Er en annen tildeling for samme operasjon bredere, vinner den bredere. En post uten egne etiketter, for eksempel et notat på en hendelse, oppfyller en etikettbasert tildeling når en av postene den hører til, bærer en av tildelingens etiketter. En **All Operational Resources**-tillatelse begrenset til etiketter snevrer inn på samme måte: den når driftsressursene som bærer en av etikettene dens, slik ressursens egen tillatelse begrenset til de samme etikettene ville gjort. En oppretting avgrenses på samme måte: en tillatelse til å opprette statussider begrenset til etiketter oppretter bare statussider som bærer en av etikettene dens, og en tillatelse til å opprette notater på hendelser begrenset til etiketter legger bare til notater på hendelser som bærer en av dem, med mindre en annen tillatelse for opprettingen når hele prosjektet; en oppretting utenfor dem avvises med en melding som nevner etikettene den tillater. En tillatelse til å opprette med omfanget Eide oppretter en ressurs med egne eiere, for eksempel en overvåker eller en statusside, bare for en person, som blir eieren, og et notat bare på en hendelse som du eller et av teamene dine eier.
6. Bruk etikettblokkeringer. En blokkering med etiketter avviser forespørselen hvis målressursen bærer én av dem. Når en post ikke har egne etiketter, for eksempel et notat på en hendelse eller en kunngjøring på en statusside, utelater en blokkering med etiketter posten ved lesing, endring og sletting hvis en post den hører til, bærer en av de etikettene. En liste med poster fra alle prosjektene dine på én gang, for eksempel hendelsene på startsiden din, avgrenser hvert prosjekts poster med blokkeringene og tildelingene dine i det prosjektet. En blokkering med etiketter på en **All Operational Resources**-tillatelse fjerner ressursene som bærer de etikettene, fra det tillatelsen gir. En blokkering med etiketter på en tillatelse til å opprette avviser en ny post som bærer en av etikettene dens eller, for en post uten egne etiketter, hører til en post som bærer en av dem.
7. Hold endringer og slettinger til det du har lov til å lese. En endring eller sletting avgrenses av lesetillatelsene dine i tillegg til tillatelsen for endringen: en post du ikke har lov til å lese — utenfor etikettene eller eierne dine, eller med en etikett som en blokkering av lesing tar bort — er ikke en du kan endre eller slette, og en blokkering uten etiketter av lesing av en type post tar også bort endring og sletting av den. En post som leses gjennom en annen, for eksempel et notat på en hendelse eller en kunngjøring på en statusside, nås bare gjennom en post du har lov til å lese: uten tillatelse til å lese hendelser når en tillatelse for notater ingen notater, og en blokkering med etiketter av lesing av hendelser utelater notatene på hendelsene som bærer dem. En endring eller sletting av én post, angitt med ID-en, som ikke når noe, besvares som om posten ikke fantes (`404`) når du ikke har lov til å lese den, og avvises når du har lov til å lese den, men ikke endre den. Er tillatelsen din til å lese hendelser begrenset til omfanget Eide, når en tillatelse for notater bare notatene på hendelsene som du eller et av teamene dine eier. En slik post opprettes også bare under en post du har lov til å lese: et notat bare på en hendelse du har lov til å lese, og en kunngjøring bare på statussider du har lov til å lese, hver eneste av dem; å angi en post du ikke har lov til å lese, avvises som om den ikke fantes. En endring følger samme regel: en post som flyttes under en annen, for eksempel en kunngjøring som settes på en annen statusside, kommer bare under en post du har lov til å lese, og det den allerede hører under, blir som det er. Postene en oppretting eller en endring lister opp, for eksempel overvåkerne til en hendelse eller tjenestene til et varsel, holdes til tillatelsen din til å lese dem når du har en, og alltid til en blokkering med etiketter av lesing av dem: en post utenfor dem avvises som om den ikke fantes, mens en post som listen allerede har, blir stående. En lesing av én post ut fra ID-en besvares med `404` på samme måte når posten ikke finnes eller du ikke har lov til å lese den.

Hvert felt i en post leses med postens egen lesetillatelse: en tillatelse for en annen type post åpner det aldri. Noen felt er bevisst snevrere. Hemmeligheter leses bare av personer som kan redigere eller administrere posten de hører til, for eksempel en monitors nøkler for innkommende forespørsler og innkommende e-post og dens serveragentnøkkel, eller et arbeidsflyts webhook- og e-postnøkler. Å se opptaket av en øktavspilling krever **Watch Session Replays**, ikke bare **List Session Replays**. Telemetri leses signal for signal: **Read Telemetry Service Log** leser logger, **Read Telemetry Service Traces** leser sporinger, og **Read Telemetry Service Metrics** leser metrikker, metrikkdiagrammer inkludert.

Felt følger samme regel. En blokkering uten etiketter på tillatelsen til et felt fjerner feltet, og for en driftsressurs åpner den tilsvarende **All Operational Resources**-tillatelsen hvert felt som alle som kan lese eller endre posten, kan åpne — men ikke et felt som er bevisst snevrere, som en hemmelig nøkkel.

Den samme regelen avgjør alt annet som spør om du har en tillatelse: handlinger som ikke er en enkel lesing eller skriving — å legge til SMS-, samtale- eller AI-kreditt, betale en faktura eller teste en varslingsregel — og knappene OneUptime viser. En knapp du ikke får bruke, vises låst og sier hvorfor; er en blokkering i et av teamene dine årsaken, navngir den den blokkerte tillatelsen.

Liveoppdateringer følger den samme regelen. Når en post opprettes, endres eller slettes, gir OneUptime beskjed til de åpne sidene til personene som får lese posten, og ingen andre. Det som begrenser hva du får lese, begrenser også liveoppdateringene dine: etiketter, eiere, en blokkering med etiketter, en privat hendelse eller en annens AI-samtale. Når en endring tar fra deg tilgangen til en post, for eksempel når den gjøres privat, får de åpne sidene dine også beskjed, slik at de slutter å vise den. En endring i tillatelsene dine, en blokkering eller at du ikke lenger er master admin, når de åpne sidene dine med en gang.

Liveoppdateringer slutter også med påloggingen som startet dem. Når du logger ut, endrer passordet ditt eller blir blokkert, stopper liveoppdateringene på de åpne sidene dine med en gang. En åpen side fornyer påloggingen sin hvert 15. minutt og fortsetter deretter med liveoppdateringene; kan påloggingen ikke fornyes, sender siden deg til påloggingssiden. Et prosjekt som krever SSO, gir bare liveoppdateringer til sider som er pålogget med SSO, akkurat som med alt annet.

Enhver innlogget bruker har i tillegg et lite sett automatiske tillatelser som dekker ting som å lese sin egen profil og sine egne varslingsregler. Dette er ikke administratorrettigheter, og de gir ikke tilgang til andres data.

Løste tillatelser bufres per bruker og prosjekt, og oppdateres når teammedlemskap eller teamtillatelser endres. Endrer du tillatelser og en bruker ikke ser endringen med én gang, be vedkommende laste siden på nytt.

## Oppskrifter

**Et team som bare ser på.** Opprett teamet og legg til rollen `Viewer`, eller de områdespesifikke `*Viewer`-rollene for nøyaktig de områdene teamet skal se.

**Vakthavende som passer sine egne tjenester.** Gi teamet `MonitorAdmin`, `IncidentMember` og `OnCallMember` med omfanget **Eide**, og legg så teamet til som eier av overvåkerne det drifter.

**Innleide holdt unna produksjon.** Gi teamet rollene det trenger med omfanget **Alle**, og legg så til en **blokkert tillatelse** for de sensitive funksjonene, begrenset til etiketten `Production`.

**En CI-pipeline som bare rapporterer utrullinger.** Opprett en API-nøkkel med nøyaktig de granulære tillatelsene den trenger — ingen roller.

**Noen som ikke skal endre fakturering eller se fakturaer.** Gi vedkommende `ProjectMember`, ikke `ProjectAdmin`: en prosjektadministrator kan ikke endre planen, betalingsmetoder eller saldoer, men leser og laster ned fakturaer. Skal noen lese faktureringssidene uten å endre noe, gi vedkommende `BillingViewer`.

## Videre

- [Tillatelsesreferanse](/docs/permissions/reference) — hver rolle og hver granulær tillatelse, generert fra OneUptimes kildekode.
- [SSO](/docs/identity/sso) og [SCIM](/docs/identity/scim) — autentisering og automatisk brukeroppretting.
- [API-referanse](/docs/api-reference/api-reference) — bruk av tillatelser fra API-et.
