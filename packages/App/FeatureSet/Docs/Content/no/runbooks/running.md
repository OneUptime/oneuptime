# Kjøre et runbook

Hver gang et runbook kjøres, blir det en **kjøring**: et øyeblikksbilde av runbookets trinn som gås gjennom i rekkefølge, med status og output registrert for hvert trinn. Denne siden er for dem som håndterer hendelser, starter kjøringer og fører dem videre: hvordan en kjøring starter, hva kjøringssiden viser, og hvordan du fullfører, godkjenner, hopper over og avbryter trinn.

:::cards
- [Start en kjøring](#start-en-kjøring): Fra en hendelse, et varsel eller en begivenhet, eller fra selve runbooket.
- [Kjøringsvisningen](#kjøringsvisningen): Hva hvert trinn viser mens en kjøring pågår.
- [Fullfør, godkjenn og hopp over trinn](#fullfør-godkjenn-og-hopp-over-trinn): Hvilket trinn som tar imot en beslutning, og når.
- [Feilsøking](#feilsøking): Kjøringer som ikke starter eller ikke blir ferdige.
:::

## Slik beveger en kjøring seg

```mermaid title="Tilstandene til en runbook-kjøring"
stateDiagram-v2
    state "Planlagt" as Scheduled
    state "Kjører" as Running
    state "Venter på deg" as WaitingForManualStep
    state "Fullført" as Completed
    state "Mislyktes" as Failed
    state "Avbrutt" as Cancelled
    [*] --> Scheduled: kjøring startet
    Scheduled --> Running: en Worker<br/>tar den
    Running --> WaitingForManualStep: Manual-trinn<br/>eller godkjenning
    WaitingForManualStep --> Scheduled: fullført,<br/>godkjent eller<br/>hoppet over
    Running --> Completed: alle trinn<br/>ferdige
    Running --> Failed: et trinn feiler
    Scheduled --> Cancelled: Avbryt kjøring
    Running --> Cancelled: Avbryt kjøring
    WaitingForManualStep --> Cancelled: Avbryt kjøring
    Completed --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

En ny kjøring er **Planlagt** til en Worker tar den og markerer den som **Kjører**. Den tar pause som **Venter på deg** ved et Manual-trinn, eller før et trinn som krever godkjenning, og går tilbake i køen så snart noen handler. En kjøring som venter på en person, utløper aldri. Den avsluttes som **Fullført**, **Mislyktes** eller **Avbrutt**.

## Start en kjøring

Det finnes fem måter en runbook-kjøring opprettes på:

1. **Automatisk via en regel**: en [runbook-regel](/docs/runbooks/rules) starter den når en hendelse, et varsel eller en planlagt vedlikeholdshendelse som treffer, opprettes. En AI-regel kan også starte en; se [AI SRE](/docs/ai/ai-sre).
2. **Manuelt fra en begivenhet**: klikk **Kjør runbook** på en hendelse, et varsel eller en planlagt vedlikeholdshendelse. Kjøringen knyttes til den begivenheten.
3. **Manuelt fra runbookets side**: klikk **Kjør nå** på siden **Oversikt** for et runbook. Kjøringen knyttes ikke til noen hendelse, noe varsel eller noen planlagt vedlikeholdshendelse.
4. **Etter en tidsplan**: runbookets tidsplan starter den på faste tidspunkter. Se [Kjør etter en tidsplan](/docs/runbooks/triggers#kjør-etter-en-tidsplan).
5. **Fra et annet verktøy**: en `POST` til runbookets webhook-URL starter den, med verdiene kallet sender. Se [Kall webhooken](/docs/runbooks/triggers#kall-webhooken).

Slik starter du en manuelt:

:::tabs
@tab Fra en begivenhet
1. Åpne hendelsen, varselet eller den planlagte vedlikeholdshendelsen, og gå til siden **Runbooks**.
2. Klikk **Kjør runbook**. Dialogen **Kjør en runbook** viser prosjektets runbooks som er slått på.
3. Klikk **Kjør** ved runbooket. Kjøringen vises i begivenhetens liste: klikk **Vis** for å åpne den.
@tab Fra runbooket
1. Åpne runbooket fra **Runbooks**.
2. Klikk **Kjør nå** på **Oversikt**.
3. Kjøringssiden åpnes.
:::

For å starte en kjøring trenger du Project Owner, Project Admin, Project Member, Runbook Admin eller Runbook Member, eller tillatelsen **Create Runbook Execution**. Runbook Viewer og Viewer ser **Kjør nå** låst, med begrunnelsen. Se [Tillatelser](/docs/runbooks/configuration#tillatelser).

## Kjøringsvisningen

Åpne en kjøring for å se sjekklisten. Øverst på siden vises kjøringens **Status**, **Fremdrift** (ferdige trinn av alle trinn), **Startet** (når den begynte) og **Utløst av** (hva som startet den). Hvert trinn viser:

- **Statusmerke** — Venter, Kjører, Venter på deg, Venter på godkjenning, Ferdig, Hoppet over, Mislyktes eller Avbrutt.
- **Tittel og beskrivelse** — kopiert fra runbooket da kjøringen startet.
- **Output** (kan felles sammen) — stdout, returverdier, HTTP-svar eller svaret fra AI-en.
- **Feilmelding**, hvis trinnet feilet.
- På trinnet kjøringen venter på: **Marker som ferdig** (et Manual-trinn) eller **Godkjenn og kjør** (et trinn med **Krev godkjenning**, som ikke har kjørt ennå) og **Hopp over**.
- **Godkjent av** på et trinn som ventet på godkjenning, når det har kjørt.
- Mens kjøringen har pause, **Hopp over** på senere automatiserte trinn som ikke krever godkjenning.

Mens kjøringen pågår, oppdaterer siden seg selv hvert 30. sekund. Klikk **Oppdater** for å se den nyeste tilstanden med en gang.

## Fullfør, godkjenn og hopp over trinn

Bare trinnet kjøringen venter på, kan fullføres, godkjennes eller hoppes over slik at kjøringen fortsetter. Et Manual-trinn eller et trinn med **Krev godkjenning** kan ikke krysses av eller hoppes over før kjøringen når det: jobben deres er å stoppe kjøringen, så de tar først imot en beslutning når kjøringen er der. Et trinn med **Krev godkjenning** venter før det kjører, så les først hva trinnene før det fant: **Godkjenn og kjør** kjører det, **Hopp over** hindrer at det kjører, og uansett fortsetter kjøringen. En kjøring som startet før godkjenninger flyttet til trinnet de vokter, venter i stedet etter et slikt trinn, når det har kjørt: **Godkjenn og fortsett** lar den kjøringen fortsette.

Mens kjøringen har pause, kan du også hoppe over et senere automatisert trinn som ikke krever godkjenning, slik at det ikke kjører når kjøringen fortsetter. Kjøringen har fortsatt pause ved trinnet som venter på deg. Du kan ikke hoppe over mens trinn kjører: vent til kjøringen tar pause, eller avbryt den. Hvert trinn registrerer hvem som fullførte det eller hoppet over det.

| Trinnet | Fullfør eller godkjenn | Hopp over |
| --- | --- | --- |
| Det kjøringen venter på | Ja | Ja |
| Et senere automatisert trinn uten **Krev godkjenning** | Nei | Ja, mens kjøringen har pause |
| Et senere Manual-trinn, eller et med **Krev godkjenning** | Nei | Nei |
| Ethvert trinn mens trinn kjører | Nei | Nei |

Å fullføre, godkjenne, hoppe over og avbryte krever de samme rollene som å starte en kjøring, eller tillatelsen **Edit Runbook Execution**.

## Flett manuelle og automatiserte trinn

Det klassiske forløpet:

| # | Trinn | Hva som skjer |
| --- | --- | --- |
| 1 | Bash: registrer systemets tilstand | Kjører på sin Runner så snart kjøringen starter. |
| 2 | Manual: "Varsle kundene med banneret på statussiden." | Kjøringen tar pause til noen klikker **Marker som ferdig**. |
| 3 | HTTP request: tilkall DBA-en via PagerDuty | Kjører på Workeren. |
| 4 | Manual: "Bekreft at den sekundære databasen nå er primær." | Kjøringen tar pause igjen. |
| 5 | HTTP request: send avblåsningen til en Slack-webhook | Kjører, og kjøringen er **Fullført**. |

Trinn 2 og 4 setter kjøringen på pause til noen krysser dem av. Trinn 1, 3 og 5 kjører automatisk. Hele kjøringen er én kjøring, én tidslinje og én kilde til sannhet.

## Avbryt en kjøring

Klikk **Avbryt kjøring** på kjøringssiden. Statusen blir `Cancelled`, og ingen senere trinn starter. Et trinn som allerede kjører, avbrytes ikke, men resultatet registreres ikke: trinnet forblir `Cancelled`. Jobber som fortsatt venter på en Runner, avbrytes; en Runner som allerede kjører et skript, gjør det ferdig, men resultatet godtas ikke.

## Grenser for output

Output per trinn er begrenset til **50 KB**, slik at et løpsk skript ikke blåser opp databasen. Lengre output kuttes med en markør. Trenger du større artefakter, skriver du dem fra skriptet til objektlagring eller et loggsystem og legger URL-en i outputen.

## Kjør et runbook på nytt

En kjøring er en engangs, uforanderlig post. Klikk **Kjør igjen** på en avsluttet kjøring, eller **Kjør nå** på runbooket, for å kjøre det på nytt. Begge oppretter en ny kjøring ut fra runbookets nåværende trinn, ikke knyttet til noen begivenhet. Bruk **Kjør runbook** på hendelsens side **Runbooks** for å kjøre det på nytt på en hendelse. Den opprinnelige kjøringen forblir uendret for revisjonssporet.

## Finn tidligere kjøringer

| Hvor | Hva den viser |
| --- | --- |
| **Logger → Kjøringer** for et runbook | Alle kjøringer av det runbooket, med filtre for status og startdato og en kolonne **Utløst av**. |
| **Runbooks → Kjøringer** | Alle kjøringer av alle runbooks i prosjektet. |
| Siden **Runbooks** for en hendelse, et varsel eller en begivenhet | Kjøringene som er knyttet til den. Begivenhetens oversikt viser dem også så snart det finnes noen. |

## Feilsøking

:::details Run Now er låst
Rollen din leser runbooks, men kjører dem ikke: knappen sier "Du har ikke tillatelse til å starte runbook-kjøringer i dette prosjektet." Be om Runbook Member eller tillatelsen **Create Runbook Execution**.
:::

:::details Oppstart av en kjøring feiler med "Runbook is disabled" eller "Runbook has no steps to run"
Runbookets bryter **Kjør dette runbooket** er slått av på siden **Innstillinger**, eller det har ingen lagrede trinn. Slå bryteren på, eller legg til trinn, og klikk **Lagre trinn**. **Oversikt** sier hvilken, med **Slå på runbook** eller **Legg til trinn**.
:::

:::details Et trinn feilet fordi det mangler en Runner
Meldingen lyder for eksempel "This Bash step has no Runner. Bash steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners." Trinnet ble lagret uten **Runner**, og prosjektet har ingen [standard-Runner](/docs/runbooks/agents#prosjektets-standard-runner). Et JavaScript-trinn trenger bare sin egen Runner når ingen [global Runner](/docs/runbooks/agents#globale-runnere) kan kjøre det. Åpne runbookets **Trinn**, velg trinnets Runner under **Flere felt**, klikk **Lagre trinn**, og kjør runbooket på nytt.
:::

:::details Et trinn feilet fordi det nevner variabler det ikke kan bruke
Meldingen begynner med "This step names variables it cannot use, so it was not run:" og forteller for hver variabel hva som er galt og hvor det rettes: det finnes ingen variabel med det navnet, hemmeligheten har ingen verdi, eller trinnets Runner får ikke bruke den. Opprett variabelen eller rett navnet i trinnet, eller la Runneren bruke hemmeligheten, og kjør så runbooken på nytt. Se [Runbook-variabler](/docs/runbooks/variables).
:::

:::details Et trinn feilet fordi ingen runbook-agent tok det
Meldingen lyder "No runbook agent picked up this step before the wait window expired." Trinnets Runner tok ikke jobben innenfor sin claim timeout. Kontroller under **Runbooks → Runbook-agenter** at Runneren er **Tilkoblet** og at **Kjører runbooks** er slått på. Se [Runbook-agenter](/docs/runbooks/agents#feilsøking). Et trinn på en global Runner melder i stedet "No global Runner picked up this step before the wait window expired.": Kjør runbooket på nytt, øk trinnets claim timeout, eller velg en av dine egne Runnere.
:::

:::details Kjøringen har ventet i timevis
En kjøring som venter på en person, utløper aldri. Åpne den, og handle på trinnet som viser **Venter på deg** eller **Venter på godkjenning**, eller klikk **Avbryt kjøring**.
:::

:::details Et trinn sier at det kanskje har kjørt delvis
OneUptime Worker-en som kjørte trinnet, startet på nytt eller sluttet å svare, og kjøringen ble markert som mislykket i stedet for å bli hengende. Kontroller målsystemet før du kjører runbooket på nytt.
:::

## Neste steg

:::cards
- [Skrive et runbook](/docs/runbooks/authoring): Legg til Manual-trinn og godkjenninger der en person må bestemme.
- [Runbook-regler](/docs/runbooks/rules): Start kjøringer automatisk ved nye hendelser.
- [Runbook-agenter](/docs/runbooks/agents): Hold Runnerne som trinnene dine trenger, tilkoblet.
:::
