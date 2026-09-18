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

Opprett så mange ekstra team du vil — «Frontend-vakt», «Support», «Skrivebeskyttede revisorer» — og gi hvert av dem tillatelsene det trenger.

Hvor du finner det: **Innstillinger → Team**. Åpne et team for å komme til **Members**, **Permissions** og **Block Permissions**.

## Tillatelser

En tillatelse er én funksjon. Det finnes to måter å dele dem ut på, begge på teamets fane **Permissions**.

### Roller

En rolle samler et helt produktområde på ett av tre nivåer:

- **Admin** — full kontroll over området, inkludert konfigurasjonen (alvorlighetsgrader, tilstander, maler).
- **Member** — det daglige arbeidet: opprette, redigere og slette ressursene, men ikke konfigurere om området.
- **Viewer** — kun lesing.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` og så videre. Roller er nesten alltid riktig valg — de forblir korrekte etter hvert som OneUptime får nye funksjoner, fordi en ny overvåkerrelatert tabell legges inn under de eksisterende overvåkerrollene i stedet for å kreve en ny tildeling fra deg.

Alle {{PERMISSION_ROLE_COUNT}} rollene står i [Tillatelsesreferansen](/docs/permissions/reference).

### Granulære tillatelser

Hver enkelt funksjon kan også tildeles alene — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` og {{PERMISSION_TOTAL_COUNT}} andre. Bruk disse når en rolle er for bred og du må gi nøyaktig én ting.

Det er også nøklene du bruker når du oppretter API-nøkler, og dem API-et og Terraform-provideren forventer.

Hele listen finnes i [Tillatelsesreferansen](/docs/permissions/reference).

### Tillat og blokker

Hvert team har to lister:

- **Permissions** (tillat) — hva dette teamet får gjøre.
- **Block Permissions** — hva dette teamet aldri får gjøre, uansett tillatelse.

**Blokkering vinner alltid.** En blokkering uten etiketter fjerner funksjonen helt for teamet. En blokkering med etiketter fjerner den bare for ressurser med de etikettene — nyttig for «dette teamet kan redigere overvåkere, unntatt dem merket Production».

En tillatelse kan ikke bære begrensningsetiketter i begge listene samtidig; OneUptime avviser den andre med en forklaring.

Fordi en brukers tilgang er unionen på tvers av alle teamene vedkommende er med i, opphever en blokkering i ett team **ikke** en tillatelse i et annet. Blokkeringer begrenser teamet de er satt på. Har noen mer tilgang enn du venter, sjekk alle teamene vedkommende tilhører.

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

Hvor du finner det: **Innstillinger → Etiketter**.

## API-nøkler

API-nøkler får tillatelser direkte på selve nøkkelen — de tilhører ikke team og påvirkes ikke av teammedlemskap.

- Tildel de samme granulære tillatelsene og rollene du ville gitt et team.
- Nøkler støtter **blokkerte tillatelser** og **etikettbegrensninger** på samme måte som team.
- Nøkler støtter **ikke** omfanget Eide. Eierskap løses mot en bruker, og en nøkkel er ikke en bruker — gi derfor nøkler den tilgangen de trenger eksplisitt.

Gi hver integrasjon sin egen nøkkel med det smaleste settet tillatelser som fungerer, slik at du kan trekke tilbake én uten å forstyrre de andre.

Hvor du finner det: **Innstillinger → API-nøkler**. Se også [API-referansen](/docs/api-reference/api-reference).

## Slik avgjør OneUptime om en forespørsel er tillatt

For en innlogget bruker, i rekkefølge:

1. Finn teamene brukeren tilhører i dette prosjektet — bare godtatte invitasjoner teller.
2. Samle alle tillatelsesrader fra disse teamene — tillatte og blokkerte, hver med etiketter og omfang.
3. Sjekk blokkeringslisten først. En treff-blokkering uten etiketter avviser forespørselen umiddelbart.
4. Sjekk tillatelseslisten. Forespørselen trenger minst én tillatelse som måltabellen godtar for denne operasjonen.
5. Bruk omfanget. Tildelinger med omfanget Eide snevrer spørringen inn til eide ressurser; etikettbaserte snevrer inn til treffende etiketter. Er en annen tildeling for samme operasjon bredere, vinner den bredere.
6. Bruk etikettblokkeringer. En blokkering med etiketter avviser forespørselen hvis målressursen bærer én av dem.

Enhver innlogget bruker har i tillegg et lite sett automatiske tillatelser som dekker ting som å lese sin egen profil og sine egne varslingsregler. Dette er ikke administratorrettigheter, og de gir ikke tilgang til andres data.

Løste tillatelser bufres per bruker og prosjekt, og oppdateres når teammedlemskap eller teamtillatelser endres. Endrer du tillatelser og en bruker ikke ser endringen med én gang, be vedkommende laste siden på nytt.

## Oppskrifter

**Et team som bare ser på.** Opprett teamet og legg til rollen `Viewer`, eller de områdespesifikke `*Viewer`-rollene for nøyaktig de områdene teamet skal se.

**Vakthavende som passer sine egne tjenester.** Gi teamet `MonitorAdmin`, `IncidentMember` og `OnCallMember` med omfanget **Eide**, og legg så teamet til som eier av overvåkerne det drifter.

**Innleide holdt unna produksjon.** Gi teamet rollene det trenger med omfanget **Alle**, og legg så til en **blokkert tillatelse** for de sensitive funksjonene, begrenset til etiketten `Production`.

**En CI-pipeline som bare rapporterer utrullinger.** Opprett en API-nøkkel med nøyaktig de granulære tillatelsene den trenger — ingen roller.

**Noen som ikke skal se fakturering.** Ikke legg vedkommende i Owners-teamet. `ProjectAdmin` utelukker allerede fakturering.

## Videre

- [Tillatelsesreferanse](/docs/permissions/reference) — hver rolle og hver granulær tillatelse, generert fra OneUptimes kildekode.
- [SSO](/docs/identity/sso) og [SCIM](/docs/identity/scim) — autentisering og automatisk brukeroppretting.
- [API-referanse](/docs/api-reference/api-reference) — bruk av tillatelser fra API-et.
