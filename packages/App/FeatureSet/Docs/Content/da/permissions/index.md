# Brugere, teams og tilladelser

Alt i OneUptime lever inde i et **projekt**. Hvem der må hvad derinde, koger ned til tre ting: **brugerne** i projektet, de **teams** de tilhører, og de **tilladelser**, disse teams har fået.

Den ene regel, der forklarer det meste: **brugere har aldrig tilladelser direkte.** En brugers adgang er foreningen af tilladelserne fra alle de teams, brugeren tilhører i det projekt. Vil du ændre, hvad nogen må, ændrer du deres teammedlemskab eller det pågældende teams tilladelser.

**Ejere** er en anden idé. En ejer er den, der er ansvarlig for én bestemt ressource — en monitor, en hændelse, et dashboard. Ejere får besked om deres ressourcer, og tilladelser kan valgfrit indsnævres til "kun det, jeg ejer".

## Modellen i overblik

```text
Projekt
  └── Team                       ← tilladelser hænger her
       ├── Tilladte rettigheder  ← hver med et omfang: Alle / Ejede / Labels
       ├── Blokerede rettigheder ← vinder altid over tilladte
       └── Teammedlemmer         ← brugere, der har accepteret invitationen
```

| Begreb | Hvad det er |
| --- | --- |
| Bruger | Én OneUptime-konto. Ét login, vilkårligt mange projekter. |
| Projekt | Tenant-grænsen. Monitorer, hændelser, teams og data hører til præcis ét projekt. |
| Team | En navngiven gruppe i et projekt, der bærer tilladelserne. |
| Teammedlem | En bruger, der er inviteret til et team og har accepteret. |
| Tilladelse | Én enkelt funktion, fx `CreateProjectMonitor`, eller en rolle, der samler mange, fx `MonitorAdmin`. |
| Omfang | Hvor bredt en tilladt rettighed rækker: alle ressourcer, kun ejede eller kun labelede. |
| Ejer | En bruger eller et team, der er markeret som ansvarlig for én bestemt ressource. |
| Label | En markering, du sætter på ressourcer, brugt til at begrænse tilladelser og til at organisere. |

## Brugere

En brugerkonto er global for OneUptime-instansen — det samme login virker i alle projekter, brugeren er inviteret til.

En bruger er "i" et projekt, når vedkommende er medlem af **mindst ét team** i det. Der findes ikke et separat trin "tilføj bruger til projekt": at invitere nogen til et projekt er at invitere dem til et team.

- Invitationer opretter et afventende teammedlem. Brugeren tæller først som projektmedlem — og får først nogen tilladelse — **efter at have accepteret invitationen.**
- Fjernes en bruger fra alle teams i et projekt, mistes adgangen til projektet.
- Den, der forlader et projekt, får ikke længere dets notifikationer. Personens egne notifikationsmetoder, -regler og -indstillinger for projektet fjernes sammen med det sidste team — e-mail, SMS, opkald, WhatsApp, Telegram, push, webhook, Slack og Microsoft Teams, e-mailopsamlingen og den endnu ikke sendte e-mail, nummeret til indgående opkald og vagtpåmindelserne —, så en ny tilmelding starter fra standardindstillingerne. Det, der stadig nævner personen, som brugeren en regel for indgående opkald ringer til eller en ejer, der bevares på en løst hændelse, sender ikke længere noget til personen: intet sendes på et projekts vegne til nogen, der ikke er medlem, og en afventende invitation er endnu ikke et medlemskab. Disse steder viser **Ikke længere medlem** ved siden af navnet, så du kan sætte en anden ind. Den, der er inviteret og endnu ikke har accepteret, viser i stedet **Invitation endnu ikke accepteret**. Hvis en override sender nogens kald videre til en person, der har forladt projektet, bliver den person, overriden dækker, kaldt i stedet. At forlade projektet afbryder også de MCP-klienter, personen har forbundet til projektet, og personens personlige link til vagtkalenderen viser derefter en tom kalender. På OneUptime Cloud bekræfter en, der vender tilbage via projektets single sign-on, det igen fra sin mailboks.
- Hvis projektet kræver SSO, og en bruger endnu ikke har godkendt sig via identitetsudbyderen, behandles vedkommende som uautoriseret SSO-bruger og ser intet, før det sker. Se [SSO](/docs/identity/sso).
- Med SCIM opsat kan din identitetsudbyder automatisk oprette, opdatere og fjerne brugere og deres teammedlemskaber. Se [SCIM](/docs/identity/scim).

Hvor du finder det: **Indstillinger → Brugere** viser alle i projektet og deres invitationsstatus.

## Teams

Teams er vejen, tilladelser tager hen til folk. Hvert nyt projekt starter med tre:

| Team | Tilladelse | Redigerbar |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nej. Har altid mindst ét medlem. |
| Admin | `ProjectAdmin` | Nej |
| Members | `ProjectMember` | Ja — det er et udgangspunkt, ret det frit |

Teamsene **Owners** og **Admin** er bevidst låst: deres tilladelser kan ikke redigeres, og teamsene kan hverken slettes eller omdøbes. Det er dét, der forhindrer, at et projekt ved et uheld låser sig selv ude. Owners-teamet skal altid beholde mindst ét medlem.

`ProjectOwner` er det højeste adgangsniveau: fakturering, sletning af projektet og alt, hvad en administrator kan. `ProjectAdmin` dækker alt undtagen fakturering og sletning af projektet.

At slå SMS, telefonopkald, WhatsApp eller Telegram til eller fra for projektet hører under fakturering, fordi hver besked koster penge. Kun `ProjectOwner`, rollen `BillingAdmin` (**Billing Admin**) og tilladelsen `ManageProjectBilling` (**Manage Billing**) kan slå dem til eller fra, under **Projektindstillinger > Notifikationer > Notifikationsindstillinger** — ikke `ProjectAdmin`.

At genoplade projektets forudbetalte saldi hører også under fakturering. På OneUptime Cloud betales SMS, telefonopkald, WhatsApp og Telegram fra saldoen under **Projektindstillinger > Notifikationer > Notifikationsindstillinger**, og AI fra AI-kreditterne under **Projektindstillinger > AI > AI-kreditter**. Kun en projektejer eller nogen med **Manage Billing** kan genoplade dem eller ændre deres **Automatisk genopfyldning** — en projektadministrator kan ikke. En besked om en saldo, der er ved at løbe tør, nævner, hvem der kan fylde den op, og kun de personer får en knap **Genoplad saldo**, der virker, eller et link til siden.

Opret så mange ekstra teams, du vil — "Frontend-vagt", "Support", "Skrivebeskyttede revisorer" — og giv hvert enkelt de tilladelser, det har brug for.

Hvor du finder det: **Indstillinger → Teams**. Åbn et team for at nå **Members** og **Permissions**; **Block Permissions** ligger under **More settings** nederst på siden Permissions.

## Tilladelser

En tilladelse er én funktion. Der er to måder at uddele dem på, og begge findes på teamets fane **Permissions**.

### Roller

En rolle samler et helt produktområde på ét af tre niveauer:

- **Admin** — fuld kontrol over området, inklusive dets konfiguration (alvorsgrader, tilstande, skabeloner).
- **Member** — det daglige arbejde: oprette, redigere og slette ressourcerne, men ikke omkonfigurere området.
- **Viewer** — kun læsning.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` og så videre. Roller er næsten altid det rigtige valg — de forbliver korrekte, efterhånden som OneUptime får nye funktioner, fordi en ny monitorrelateret tabel lægges ind under de eksisterende monitorroller i stedet for at kræve en ny tildeling fra dig.

Workflows er undtagelsen. Et workflow kører sine trin inde i projektet, så `WorkflowMember` åbner workflows og deres kørsler og kører dem manuelt, men opretter, ændrer eller sletter dem ikke. `WorkflowAdmin` bygger dem. Se [Workflow-konfiguration](/docs/workflows/configuration).

Alle {{PERMISSION_ROLE_COUNT}} roller står i [Tilladelsesreferencen](/docs/permissions/reference).

### Granulære tilladelser

Hver enkelt funktion kan også tildeles alene — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` og {{PERMISSION_TOTAL_COUNT}} andre. Brug dem, når en rolle er for bred, og du skal give præcis én ting.

Det er også de nøgler, du bruger, når du opretter API-nøgler, og dem API'et og Terraform-provideren forventer.

Den fulde liste findes i [Tilladelsesreferencen](/docs/permissions/reference).

### Tillad og blokér

Hvert team har to lister:

- **Permissions** (tillad) — hvad dette team må.
- **Block Permissions** — hvad dette team aldrig må, uanset enhver tilladelse.

**Blokering vinder altid.** En blokering uden labels fjerner funktionen helt for teamet. En blokering med labels fjerner den kun for ressourcer med de labels — nyttigt til "dette team må redigere monitorer, undtagen dem med labelet Production".

En tilladelse kan ikke bære begrænsningslabels i begge lister samtidig; OneUptime afviser den anden med en forklaring.

En brugers tilladelser lægges sammen på tværs af alle vedkommendes teams, men en blokering gælder alt, hvad brugeren gør: en blokering uden labels i ét team fjerner funktionen, også hvor et andet team tillader den, og en blokering giver aldrig noget. Har nogen mindre adgang, end du forventer, så kig efter en blokering i hvert af vedkommendes teams; har de mere, så kig efter en tilladelse i hvert team.

## Omfang: hvor langt en tilladt rettighed rækker

Enhver tilladt rettighed tildeles med et omfang, som du vælger, når du tilføjer den:

| Omfang | Betydning |
| --- | --- |
| Alle ressourcer i projektet | Standarden. Tilladelsen gælder for enhver matchende ressource. |
| Ejet af dette team eller dets medlemmer | Tilladelsen gælder kun ressourcer, hvor dette team eller den handlende bruger står som ejer. |
| Begræns efter labels (avanceret) | Tilladelsen gælder kun ressourcer med mindst ét af de valgte labels. |

**Ejede** er den enkleste vej til en model, hvor "man passer sine egne tjenester": giv et team `MonitorAdmin` med omfanget Ejede, og gør derefter teamet til ejer af de monitorer, det har ansvaret for. Det indsnævrer kun ressourcer, der faktisk kan have ejere — monitorer, hændelser, dashboards, tjenester og lignende. Projektkonfiguration (hændelsestilstande, labels, selve teamsene) har ingen ejer, så dér opfører en rolle med omfanget Ejede sig helt normalt.

**Labels** er den mere manuelle udgave af samme idé: markér ressourcer, og tildel så tilladelser begrænset til de markeringer.

Nogle roller er projektomfattende per definition og tilbyder slet ikke et omfang, fordi det ville være meningsløst at indsnævre dem — "Billing Admin, men kun for den fakturering, jeg ejer" beskriver ingenting:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Ejere

En ejer er en bruger eller et team knyttet til én bestemt ressource. De fleste ressourcer, der repræsenterer noget, du driver — monitorer, hændelser, alarmer, planlagt vedligeholdelse, vagtpolitikker, dashboards, tjenester, statussider, workflows, runbooks og SLO'er — har en fane **Owners**.

Ejere har to opgaver:

1. **Notifikation.** Ejere er dem, OneUptime giver besked, når der sker noget med ressourcen — en monitor går ned, en hændelse oprettes, en SLO begynder at bruge af sit fejlbudget.
2. **Adgang, når du beder om det.** Ejerskab er dét, omfanget Ejede opløses imod. En bruger matcher, hvis vedkommende personligt er ejer, eller hvis et af brugerens teams er ejer.

Ejerskab i sig selv giver ingenting. At eje en monitor giver ikke ret til at redigere den, medmindre et af dine teams også har en monitortilladelse. Ejerskab indsnævrer adgang; det udvider den aldrig.

## Labels

Labels er projektdækkende markeringer, du sætter på ressourcer. De tjener to formål: filtrering og gruppering i dashboardet samt begrænsning af tilladelser som beskrevet ovenfor.

En labelbegrænsning er opfyldt, hvis ressourcen bærer **mindst ét** af tilladelsens labels. En ressource helt uden labels opfylder ingen labelbegrænset tilladelse.

Hvor du finder det: **Indstillinger → Labels**.

## Telemetri

Logs, traces, metrics, undtagelser, profiler og sessionsafspilninger hører til den ressource, der sendte dem: en tjeneste, en vært, en Kubernetes-klynge, en monitor, en RUM-applikation og lignende. En telemetritilladelse læser så langt, som dens omfang rækker:

- **Alle ressourcer** læser telemetrien fra alle ressourcer i projektet.
- **Ejede** læser telemetrien fra de ressourcer, du eller et af dine teams ejer, og telemetri, der ikke nævner nogen ressource.
- **Labels** læser telemetrien fra de ressourcer, der bærer et af tilladelsens labels.

En blokering med labels på en telemetritilladelse udelader telemetrien fra de ressourcer, der bærer de labels, uanset hvad du ellers har. Det gælder overalt, hvor telemetri læses: stifinderne og deres diagrammer, filtre og attributlister, eksporter, sessionsafspilninger og det, AI-assistenten læser for dig. Listen over metriknavne viser de metrics, som en tjeneste, du må læse, rapporterer, og de metrics, som ingen tjeneste rapporterer, f.eks. værts- og klyngemetrics. Må du også læse telemetri fra andre slags ressourcer, f.eks. værter eller klynger, viser den alle metriknavne.

## API-nøgler

API-nøgler får tilladelser direkte på selve nøglen — de tilhører ikke teams og påvirkes ikke af teammedlemskab.

- Tildel de samme granulære tilladelser og roller, du ville give et team.
- Nøgler understøtter **blokerede tilladelser** og **labelbegrænsninger** ligesom teams.
- Nøgler understøtter **ikke** omfanget Ejede. Ejerskab opløses mod en bruger, og en nøgle er ikke en bruger — giv derfor nøgler den nødvendige adgang eksplicit.

Giv hver integration sin egen nøgle med det snævreste sæt tilladelser, der virker, så du kan tilbagekalde én uden at forstyrre de andre.

Hvor du finder det: **Indstillinger → API-nøgler**. Se også [API-referencen](/docs/api-reference/api-reference).

## Sådan afgør OneUptime, om en forespørgsel er tilladt

For en logget ind bruger, i rækkefølge:

1. Find de teams, brugeren tilhører i dette projekt — kun accepterede invitationer tæller.
2. Saml alle tilladelsesrækker fra de teams — tilladte og blokerede, hver med labels og omfang.
3. Tjek blokeringslisten først. En blokering uden labels på en hvilken som helst tilladelse, som måltabellen accepterer for denne handling, afviser forespørgslen med det samme, uanset hvilket team den er sat på.
4. Tjek tilladelseslisten. Forespørgslen kræver mindst én tilladelse, som måltabellen accepterer for denne handling. For en driftsressource — en monitor, en hændelse, et dashboard og lignende — tæller den tilsvarende **All Operational Resources**-tilladelse (Create, Read, Edit eller Delete) også, medmindre den selv er blokeret.
5. Anvend omfanget. Tildelinger med omfanget Ejede indsnævrer forespørgslen til ejede ressourcer; labelbaserede indsnævrer til matchende labels. Er en anden tildeling for samme handling bredere, vinder den bredere.
6. Anvend labelblokeringer. En blokering med labels afviser forespørgslen, hvis målressourcen bærer et af dem. Når en post ikke har egne labels, f.eks. en note på en hændelse eller en meddelelse på en statusside, udelader en blokering med labels på at læse den posten, hvis en post, den hører til, bærer et af de labels.

Hvert felt i en post læses med postens egen læsetilladelse: en tilladelse til en anden slags post åbner det aldrig. Nogle felter er bevidst snævrere. Hemmeligheder læses kun af personer, der må redigere eller administrere den post, de hører til, f.eks. en monitors nøgler til indgående anmodninger og indgående e-mail og dens serveragentnøgle eller et workflows webhook- og e-mailnøgler. At se optagelsen af en sessionsafspilning kræver **Watch Session Replays**, ikke kun **List Session Replays**. Telemetri læses signal for signal: **Read Telemetry Service Log** læser logs, **Read Telemetry Service Traces** læser traces, og **Read Telemetry Service Metrics** læser metrics, metrikdiagrammer inklusive.

Felter følger samme regel. En blokering uden labels på et felts tilladelse fjerner feltet, og for en driftsressource åbner den tilsvarende **All Operational Resources**-tilladelse hvert felt, som alle, der må læse eller ændre posten, må åbne — men ikke et felt, der bevidst er snævrere, som en hemmelig nøgle.

Samme regel afgør alt andet, der spørger, om du har en tilladelse: handlinger, der ikke er en simpel læsning eller skrivning — at tilføje SMS-, opkalds- eller AI-kredit, betale en faktura eller teste en notifikationsregel — og de knapper, OneUptime viser. En knap, du ikke må bruge, vises låst og siger hvorfor; er en blokering i et af dine teams grunden, nævner den den blokerede tilladelse.

Liveopdateringer følger samme regel. Når en post oprettes, ændres eller slettes, giver OneUptime besked til de åbne sider hos de personer, der må læse posten, og ingen andre. Det, der begrænser, hvad du må læse, begrænser også dine liveopdateringer: labels, ejere, en blokering med labels, en privat hændelse eller en andens AI-samtale. Når en ændring tager en post fra dig, for eksempel når den gøres privat, får dine åbne sider også besked, så de holder op med at vise den. En ændring af dine tilladelser når dine åbne sider inden for 30 sekunder.

Enhver logget ind bruger har derudover et lille sæt automatiske tilladelser, der dækker ting som at læse sin egen profil og sine egne notifikationsregler. Det er ikke administratorrettigheder, og de giver ikke adgang til andres data.

Opløste tilladelser caches pr. bruger og projekt og opdateres, når teammedlemskab eller teamtilladelser ændres. Ændrer du tilladelser, og en bruger ikke ser ændringen med det samme, så bed vedkommende genindlæse.

## Opskrifter

**Et team, der kun kigger med.** Opret teamet og tilføj rollen `Viewer`, eller de områdespecifikke `*Viewer`-roller for netop de områder, teamet skal se.

**Vagthavende, der passer deres egne tjenester.** Giv teamet `MonitorAdmin`, `IncidentMember` og `OnCallMember` med omfanget **Ejede**, og tilføj derefter teamet som ejer af de monitorer, det driver.

**Eksterne holdt væk fra produktion.** Giv teamet de nødvendige roller med omfanget **Alle**, og tilføj derefter en **blokeret tilladelse** for de følsomme funktioner, begrænset til labelet `Production`.

**En CI-pipeline, der kun rapporterer deployments.** Opret en API-nøgle med netop de granulære tilladelser, den har brug for — ingen roller.

**En, der ikke skal se fakturering.** Tilføj vedkommende ikke til Owners-teamet. `ProjectAdmin` udelukker allerede fakturering.

## Videre

- [Tilladelsesreference](/docs/permissions/reference) — hver rolle og hver granulær tilladelse, genereret fra OneUptimes kildekode.
- [SSO](/docs/identity/sso) og [SCIM](/docs/identity/scim) — godkendelse og automatisk brugeroprettelse.
- [API-reference](/docs/api-reference/api-reference) — brug af tilladelser fra API'et.
