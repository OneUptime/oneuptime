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

Opret så mange ekstra teams, du vil — "Frontend-vagt", "Support", "Skrivebeskyttede revisorer" — og giv hvert enkelt de tilladelser, det har brug for.

Hvor du finder det: **Indstillinger → Teams**. Åbn et team for at nå **Members**, **Permissions** og **Block Permissions**.

## Tilladelser

En tilladelse er én funktion. Der er to måder at uddele dem på, og begge findes på teamets fane **Permissions**.

### Roller

En rolle samler et helt produktområde på ét af tre niveauer:

- **Admin** — fuld kontrol over området, inklusive dets konfiguration (alvorsgrader, tilstande, skabeloner).
- **Member** — det daglige arbejde: oprette, redigere og slette ressourcerne, men ikke omkonfigurere området.
- **Viewer** — kun læsning.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` og så videre. Roller er næsten altid det rigtige valg — de forbliver korrekte, efterhånden som OneUptime får nye funktioner, fordi en ny monitorrelateret tabel lægges ind under de eksisterende monitorroller i stedet for at kræve en ny tildeling fra dig.

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

Da en brugers adgang er foreningen på tværs af alle vedkommendes teams, ophæver en blokering i ét team **ikke** en tilladelse i et andet. Blokeringer begrænser det team, de er sat på. Har nogen mere adgang, end du forventer, så tjek alle de teams, vedkommende tilhører.

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
3. Tjek blokeringslisten først. En matchende blokering uden labels afviser forespørgslen med det samme.
4. Tjek tilladelseslisten. Forespørgslen kræver mindst én tilladelse, som måltabellen accepterer for denne handling.
5. Anvend omfanget. Tildelinger med omfanget Ejede indsnævrer forespørgslen til ejede ressourcer; labelbaserede indsnævrer til matchende labels. Er en anden tildeling for samme handling bredere, vinder den bredere.
6. Anvend labelblokeringer. En blokering med labels afviser forespørgslen, hvis målressourcen bærer et af dem.

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
