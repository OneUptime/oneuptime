# Runbook-konfiguration & sikkerhed

Dette er referencen for driftsfolk og sikkerhedsgennemgang: hvor hver slags trin kører, hvilke grænser og timeouts et trin holdes til, hvem der må hvad, og hvordan runbooks er hærdet.

:::cards
- [Hvor hver trintype kører](#hvor-hver-trintype-kører): Workeren, en Runner eller en person.
- [Outputgrænser og timeouts](#outputgrænser-og-timeouts): Hver grænse, et trin holdes til.
- [Tilladelser](#tilladelser): Detaljerede tilladelser, de tre runbook-roller, og hvilke runbooks en rolle når.
- [Hærdningsnoter](#hærdningsnoter): Sandkasse, netværksadgang og godkendelse af Runners.
:::

## Hvor hver trintype kører

```mermaid title="Hvilke trin der kører hvor"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["HTTP request-trin<br/>AI-trin"]
    end
    subgraph yours["Din infrastruktur"]
        runner["Runner"]
        onrunner["JavaScript- og Bash-trin<br/>SSH- og kubectl-trin"]
    end
    person["En person"]
    worker --> onworker
    worker -->|"Manual-trin og<br/>godkendelser"| person
    worker --->|"sætter et<br/>job i kø<br/>til trinnets<br/>Runner"| runner
    runner --> onrunner
```

| Trintype | Kører på | Hvordan |
| --- | --- | --- |
| Manual | En person | Kørslen venter, indtil nogen fuldfører trinnet eller springer det over. |
| JavaScript | En Runner | I en `isolated-vm`-sandkasse. |
| HTTP request | OneUptime Worker | Et udgående HTTP-kald. |
| Bash | En Runner | `bash -c <script>`. |
| SSH | En Runner | En SSH-forbindelse, der kører scriptet med bash på maskinen, logget ind med en hemmelig [variabel](/docs/runbooks/variables). |
| kubectl | En Runner | `bash -c <script>`, med `KUBECONFIG` pegende på klyngen. |
| AI | OneUptime Worker | Et kald til projektets LLM-udbyder. |

## Sådan sendes Runner-trin ud

JavaScript-, Bash-, SSH- og kubectl-trin **kører aldrig på OneUptime Worker**. De sendes som jobs til en bestemt [runbook-agent](/docs/runbooks/agents): en lille proces, du installerer på en vært i din egen infrastruktur. Et trin, der ikke vælger nogen, går til [projektets standard-Runner](/docs/runbooks/agents#projektets-standard-runner), hvis det har en; ellers går et JavaScript-trin til de [globale Runnere](/docs/runbooks/agents#globale-runnere), som OneUptime kører for alle projekter.

Udsendelsesmodellen:

1. Den, der skriver runbook-trinnet, vælger en Runner på rullelisten.
2. Når trinnet kører, indsætter Workeren en række i `RunnerJob` med `targetAgentId` sat til den Runners ID, eller til projektets standard-Runners for et trin, der ikke valgte nogen, og status `Pending`. Et JavaScript-trin, der ikke valgte nogen, får i et projekt uden standard-Runner, der bruger globale Runnere, i stedet `runsOnGlobalRunner`.
3. Netop den Runner (og kun den) overtager jobbet atomisk, kører det lokalt — Bash og kubectl via `bash -c <script>`, JavaScript i en `isolated-vm`-sandkasse, SSH gennem en forbindelse til maskinen, hver med de variabler, den nævner, indsat — og sender resultatet tilbage. Enhver global Runner må overtage et job med `runsOnGlobalRunner`.
4. Workeren fortsætter runbooket med resultatet.

Der findes ikke længere et miljøflag `RUNBOOK_BASH_ENABLED`. Om disse trin virker i en installation, afhænger alene af, om projektet har en forbundet Runner med **Kører runbooks** slået til. Et JavaScript-trin virker også på en global Runner.

## Outputgrænser og timeouts

| Grænse | Værdi | Gælder for |
| --- | --- | --- |
| Output pr. trin | **50 KB**. Længere output skæres af med en markør. | Hvert automatiseret trin |
| Udførelsestimeout | **30 sekunder** som standard | JavaScript-, Bash-, SSH- og kubectl-trin |
| Anmodningstimeout | **30 sekunder** som standard | HTTP request-trin |
| Overtagelsestimeout | **2 minutter** som standard: hvor længe Workeren venter på, at den valgte Runner overtager jobbet, før det fejles | JavaScript-, Bash-, SSH- og kubectl-trin |
| Timeoutinterval | **1 sekund til 1 time** | Hver timeout |
| Venter på en person | Ingen grænse | Manual-trin og godkendelser |

Angiv timeouts pr. trin under trinnets **Flere felter** på runbookets side **Trin**; lad et felt være tomt for at beholde standarden. En værdi uden for intervallet begrænses, når trinnet kører, så en fejlindtastet konfiguration hverken kan slå timeouten fra eller holde en Worker-plads optaget i det uendelige.

## Tilladelser

Runbook-tilladelser ligger i tilladelsesgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — administrer runbook-skabeloner.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — start, afkryds, slet og læs udførelser.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — administrer regler for automatisk start.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — administrer Runners, der kører trin i din egen infrastruktur. (De hed `*RunbookAgent` før omdøbningen til Runner; eksisterende tildelinger er migreret, så intet skal tildeles igen.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — `RunbookAdmin` bygger runbooks, deres regler og de Runners, de kører på, og kører dem. `RunbookMember` åbner runbooks og deres kørsler og kører dem — starter en kørsel, fuldfører eller springer dens trin over og annullerer den — men opretter, ændrer og sletter intet runbook og ingen Runner. `RunbookViewer` læser runbooks og deres kørsler og kører intet. `RunbookAdmin` samler alle de detaljerede tilladelser ovenfor.

En rolle kører de runbooks, dens omfang når. En tildeling af `RunbookMember`, `RunbookAdmin` eller `ProjectMember`, der er begrænset til bestemte etiketter, starter og fører kørsler videre for de runbooks, der har de etiketter, en tildeling begrænset til **Owned** for de runbooks, dens team ejer, og et teams blokering af en etiket tager de runbooks fra det. `CreateRunbookExecution` og `EditRunbookExecution` handler om kørsler, som ikke har etiketter, så de når alle runbooks i projektet. At godkende et afhjælpningsforslag, der starter et runbook, kontrolleres på samme måde.

Et runbooks tidsplan og webhook starter kørsler, uden at nogen er til stede, så det kræver tilladelse til at redigere runbooket og til at køre det at sætte en af dem op, og det samme gælder for at se dets webhook-URL. At slå dem fra kræver kun tilladelse til at redigere det. Se [Runbook-udløsere](/docs/runbooks/triggers#hvem-må-sætte-udløsere-op).

Runbook-variabler ligger uden for `RunbookAdmin`, som kun læser dem for at vælge dem i de trin, den skriver. At administrere variabler kræver `ProjectOwner` eller `ProjectAdmin` eller tilladelserne `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` og `ReadRunbookSecret`: runbook-hemmelighedernes tilladelser, som beholdt deres navne, da hemmeligheder blev til variabler. Se [Runbook-variabler](/docs/runbooks/variables).

Ejerreglerne og etiketreglerne under **Runbooks → Indstillinger** ligger også uden for `RunbookAdmin`. At administrere dem kræver `ProjectOwner` eller `ProjectAdmin` eller tilladelserne `CreateRunbookOwnerRule` og `CreateRunbookLabelRule` og deres modstykker til redigering, sletning og læsning.

Hvordan roller og detaljerede tilladelser spiller sammen, kan du læse under [Brugere, teams og tilladelser](/docs/permissions/index).

## Kø og worker

Runbook-udførelser kører i BullMQ-køen `Runbook`. Hver Worker-proces kører op til 25 udførelser ad gangen; tallet er fastlagt i koden og angives ikke med en miljøvariabel.

Når et manuelt trin afkrydses via API'et, sættes udførelsen i kø igen for at fortsætte fra næste trin. Den venter som `Scheduled`, indtil en Worker tager den igen, og en udførelse i kø fejles aldrig, fordi den venter.

## Hærdningsnoter

- **JavaScript, Bash, SSH og kubectl** kører på en Runner-vært, du kontrollerer, ikke på OneUptime Worker. JavaScript kører i sit eget `isolated-vm`-isolat med 128 MB hukommelse og uden adgang til Runnerens filsystem eller processer; det kan sende HTTP-anmodninger med `axios`, men anmodninger til private netværk, loopback- og link-local-adresser afvises. Bash kører via `bash -c`, med en timeout, der håndhæves på Runneren. Et JavaScript-trin, der ikke vælger nogen, kører på projektets standard-Runner eller, hvis der ikke er angivet en, på en global Runner.
- **SSH-trin** logger kun ind, når maskinen præsenterer en af de værtsnøgler, trinnet angiver. Et trin, der ikke angiver nogen, accepterer enhver nøgle, og dets output nævner den, maskinen præsenterede, så den kan angives i trinnet.
- **HTTP-trin** bruger en tilladende statusvalidering, så et 4xx- eller 5xx-svar registreres som et mislykket trin i stedet for at blive kastet som en undtagelse, og det registrerede output viser, hvad modparten faktisk returnerede. Omdirigeringer følges ikke. Workeren kalder aldrig loopback- eller link-local-adresser, f.eks. et cloud-metadataendpoint; på OneUptime Cloud afviser den også private netværksadresser, og en selvhostet OneUptime afviser dem med `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **AI-trin** ser aldrig private hændelsesnoter eller beskeder fra Slack og Microsoft Teams, og tidligere trins output gennemsøges for hemmeligheder, som sløres, før det når modellen. Indlejrede billeder og lange kodede data udelades af prompten. Se [AI](/docs/runbooks/authoring#ai).
- **Globale Runnere** kører kun JavaScript-trin, hvert i en sandkasse, der oprettes til trinnet og smides væk bagefter, som kun når offentlige internetadresser, i højst 5 minutter og med højst tre trin fra ét projekt ad gangen. De får kun de hemmelige variabler fra trinnets eget projekt, der er slået til for globale Runnere; den medfølgende har sin egen nøgle og intet andet fra serveren. Se [Globale Runnere](/docs/runbooks/agents#globale-runnere).
- **Godkendelse af Runners** sker med ID og hemmelig nøgle, sat som miljøvariabler på Runner-containeren. På serveren kommer Runnerens gældende identitet fra den databaserække, der hører til det fremviste ID og den fremviste nøgle: en klient kan ikke udgive sig for at være en anden Runner, heller ikke med en kompromitteret nøgle.
- **Hemmelige variabler** er krypteret i hvile, returneres aldrig af API'et og udleveres kun til de Runnere, de viser, når de overtager et trin, der nævner dem. En hemmelig variabel udleveres også til en global Runner, der overtager et trin i variablens eget projekt, når variablen lader globale Runnere bruge den. Runneren erstatter hver hemmelighed, et trin fik, med `[REDACTED]` i det, trinnet udskriver, og OneUptime gør det igen, før det gemmer outputtet. Et HTTP-anmodningstrin, som OneUptime selv sender, får hver hemmelighed i sit eget projekt, som det nævner, og skjuler dem i det svar, det registrerer.

## Databasetabeller

| Tabel | Hvad den indeholder |
| --- | --- |
| `Runbook` | Skabelonen: navn, slug, beskrivelse, `isEnabled`, etiketter og trinnene som JSON. |
| `RunbookExecution` | Én række pr. kørsel med de valgfrie fremmednøgler `incidentId`, `alertId` og `scheduledMaintenanceId` og et JSON-array `stepExecutions`, der fastholder trinnene og hvert trins tilstand. |
| `RunbookRule` | Regler for automatisk start med en diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance), en mange-til-mange-relation til de runbooks, der skal startes, og det, de matcher på: en JSON-kolonne `criteria` (betingelserne) plus mange-til-mange-links til monitorer, hændelsesalvorligheder, advarselsalvorligheder, etiketter og monitoretiketter samt mønstre for titel, beskrivelse, monitornavn og monitorbeskrivelse. |
| `Runner` | Én række pr. installeret Runner: navn, hemmelig nøgle, `lastAlive`, `connectionStatus`, værtsoplysninger og funktioner. En global Runner har `isGlobalRunner` sat og intet projekt; projektets standard-Runner har `isProjectDefault` sat. |
| `RunnerJob` | Én række pr. trin sendt til en Runner: `targetAgentId` (den Runner, trinnets forfatter valgte), trintype, script eller nyttelast, status (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` eller `Cancelled`), overtagelsesfrist, lease, output og exitkode. `runsOnGlobalRunner` markerer et trin, som enhver global Runner må overtage. |
| `RunbookVariable` | Runbook-variabler: projektets globale og et runbooks egne, som nævner det i `runbookId`; en hemmeligheds værdi krypteret, og de Runnere, der må modtage en hemmelighed. |

## Driftstips

- **Sørg for, at den Runner, du vælger på et trin, er sund.** Har du brug for redundans, så kør en Runner til og fordel dine trin mellem dem, eller hav et reserve-runbook, der peger på den anden Runner.
- **Gem URL'er, ikke blobs.** Giver et trin mere end et par KB output, så skriv det til objektlagring eller din logstak, og returner URL'en.
- **Idempotens betyder noget.** Et HTTP request- eller AI-trin kører igen, hvis Workeren genstarter midt i trinnet, og kørslen genoptages. Et trin på en Runner sendes højst én gang pr. udførelse, men et script kan have kørt delvist før en fejl, og du kører måske runbooket igen. Design trin, så de tåler at blive gentaget.

## Næste skridt

:::cards
- [Runbook-agenter](/docs/runbooks/agents): Installer, drift og fejlfind Runners.
- [Runbook-variabler](/docs/runbooks/variables): De værdier og hemmeligheder, trin bruger, og de Runnere, der modtager dem.
- [Brugere, teams og tilladelser](/docs/permissions/index): Hvordan roller, etiketter og teams afgør, hvem der kører hvad.
:::
