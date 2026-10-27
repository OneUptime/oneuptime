# Runbook-konfiguration & säkerhet

Det här är referensen för driftansvariga och säkerhetsgranskare: var varje sorts steg körs, vilka gränser och tidsgränser ett steg hålls till, vem som får göra vad och hur runbooks är härdade.

:::cards
- [Var varje stegtyp körs](#var-varje-stegtyp-körs): Workern, en Runner eller en person.
- [Gränser för output och tidsgränser](#gränser-för-output-och-tidsgränser): Varje gräns som ett steg hålls till.
- [Behörigheter](#behörigheter): Detaljerade behörigheter, de tre runbook-rollerna och vilka runbooks en roll når.
- [Härdningsanteckningar](#härdningsanteckningar): Sandlåda, nätverksåtkomst och autentisering av Runners.
:::

## Var varje stegtyp körs

```mermaid title="Vilka steg som körs var"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["HTTP request-steg<br/>AI-steg"]
    end
    subgraph yours["Din infrastruktur"]
        runner["Runner"]
        onrunner["JavaScript- och Bash-steg<br/>SSH- och kubectl-steg"]
    end
    person["En person"]
    worker --> onworker
    worker -->|"Manual-steg och<br/>godkännanden"| person
    worker --->|"köar ett jobb<br/>för stegets<br/>Runner"| runner
    runner --> onrunner
```

| Stegtyp | Körs på | Hur |
| --- | --- | --- |
| Manual | En person | Körningen väntar tills någon slutför eller hoppar över steget. |
| JavaScript | En Runner | I en `isolated-vm`-sandlåda. |
| HTTP request | OneUptime Worker | Ett utgående HTTP-anrop. |
| Bash | En Runner | `bash -c <script>`. |
| SSH | En Runner | En SSH-anslutning som kör skriptet med bash på maskinen, inloggad med en hemlig [variabel](/docs/runbooks/variables). |
| kubectl | En Runner | `bash -c <script>`, med `KUBECONFIG` pekande på klustret. |
| AI | OneUptime Worker | Ett anrop till projektets LLM-leverantör. |

## Så skickas Runner-steg ut

JavaScript-, Bash-, SSH- och kubectl-steg **körs aldrig på OneUptime Worker**. De skickas som jobb till en viss [runbook-agent](/docs/runbooks/agents): en liten process som du installerar på en värd i din egen infrastruktur. Ett steg som inte väljer någon går till [projektets standard-Runner](/docs/runbooks/agents#projektets-standard-runner), om det har en; annars går ett JavaScript-steg till de [globala Runners](/docs/runbooks/agents#globala-runners) som OneUptime kör för alla projekt.

Utskicksmodellen:

1. Den som skriver runbook-steget väljer en Runner i listrutan.
2. När steget körs infogar Workern en rad i `RunnerJob` med `targetAgentId` satt till den Runnerns ID, eller till projektets standard-Runners för ett steg som inte valde någon, och statusen `Pending`. Ett JavaScript-steg som inte valde någon får i ett projekt utan standard-Runner som använder globala Runners i stället `runsOnGlobalRunner`.
3. Just den Runnern (och bara den) tar jobbet atomiskt, kör det lokalt — Bash och kubectl via `bash -c <script>`, JavaScript i en `isolated-vm`-sandlåda, SSH genom en anslutning till maskinen, var och en med de variabler den nämner ifyllda — och skickar tillbaka resultatet. Vilken global Runner som helst får ta ett jobb med `runsOnGlobalRunner`.
4. Workern fortsätter runbooket med resultatet.

Det finns inte längre någon miljöflagga `RUNBOOK_BASH_ENABLED`. Om de här stegen fungerar i en installation beror helt på om projektet har en ansluten Runner med **Kör Runbooks** påslaget. Ett JavaScript-steg fungerar också på en global Runner.

## Gränser för output och tidsgränser

| Gräns | Värde | Gäller för |
| --- | --- | --- |
| Output per steg | **50 KB**. Längre output klipps av med en markör. | Varje automatiserat steg |
| Körningstidsgräns | **30 sekunder** som standard | JavaScript-, Bash-, SSH- och kubectl-steg |
| Tidsgräns för begäran | **30 sekunder** som standard | HTTP request-steg |
| Tidsgräns för övertagande | **2 minuter** som standard: hur länge Workern väntar på att den valda Runnern tar jobbet innan det misslyckas | JavaScript-, Bash-, SSH- och kubectl-steg |
| Intervall för tidsgränser | **1 sekund till 1 timme** | Varje tidsgräns |
| Väntan på en person | Ingen gräns | Manual-steg och godkännanden |

Ange tidsgränserna per steg under stegets **Fler fält** på runbookets sida **Steg**; lämna ett fält tomt för att behålla standarden. Ett värde utanför intervallet begränsas när steget körs, så att en felskriven konfiguration varken kan stänga av tidsgränsen eller hålla en Worker-plats upptagen i all oändlighet.

## Behörigheter

Runbook-behörigheter finns i behörighetsgruppen `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — hantera runbook-mallar.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — starta, bocka av, ta bort och läsa körningar.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — hantera regler för automatisk start.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — hantera Runners som kör steg i din egen infrastruktur. (De hette `*RunbookAgent` före namnbytet till Runner; befintliga tilldelningar har migrerats, så inget behöver tilldelas på nytt.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roller) — `RunbookAdmin` bygger runbooks, deras regler och de Runners de körs på, och kör dem. `RunbookMember` öppnar runbooks och deras körningar och kör dem — startar en körning, slutför eller hoppar över dess steg och avbryter den — men skapar, ändrar och tar inte bort något runbook eller någon Runner. `RunbookViewer` läser runbooks och deras körningar och kör ingenting. `RunbookAdmin` samlar alla detaljerade behörigheter ovan.

En roll kör de runbooks som dess omfång når. En tilldelning av `RunbookMember`, `RunbookAdmin` eller `ProjectMember` som är begränsad till vissa etiketter startar och för vidare körningar av de runbooks som har de etiketterna, en som är begränsad till **Owned** körningar av de runbooks som dess team äger, och ett teams blockering av en etikett tar de runbooks ifrån det. `CreateRunbookExecution` och `EditRunbookExecution` gäller körningar, som inte har några etiketter, så de når alla runbooks i projektet. Att godkänna ett åtgärdsförslag som startar ett runbook kontrolleras på samma sätt.

Ett runbooks schema och webhook startar körningar utan att någon är där, så att konfigurera något av dem kräver behörighet att redigera runbooket och att köra det, och detsamma gäller att se dess webhook-URL. Att stänga av dem kräver bara behörighet att redigera det. Se [Runbook-utlösare](/docs/runbooks/triggers#vem-får-konfigurera-utlösare).

Runbook-variabler ligger utanför `RunbookAdmin`, som bara läser dem för att välja dem i de steg den skriver. Att hantera variabler kräver `ProjectOwner` eller `ProjectAdmin`, eller behörigheterna `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` och `ReadRunbookSecret`: runbook-hemligheternas behörigheter, som behöll sina namn när hemligheter blev variabler. Se [Runbook-variabler](/docs/runbooks/variables).

Ägarreglerna och etikettreglerna under **Runbooks → Inställningar** ligger också utanför `RunbookAdmin`. Att hantera dem kräver `ProjectOwner` eller `ProjectAdmin` eller behörigheterna `CreateRunbookOwnerRule` och `CreateRunbookLabelRule` och deras motsvarigheter för redigering, borttagning och läsning.

Hur roller och detaljerade behörigheter samverkar beskrivs under [Användare, team och behörigheter](/docs/permissions/index).

## Kö och worker

Runbook-körningar körs i BullMQ-kön `Runbook`. Varje Worker-process kör upp till 25 körningar samtidigt; antalet är fast i koden och anges inte med en miljövariabel.

När ett manuellt steg bockas av via API:et köas körningen igen för att fortsätta från nästa steg. Den väntar som `Scheduled` tills en Worker tar den igen, och en köad körning misslyckas aldrig för att den väntar.

## Härdningsanteckningar

- **JavaScript, Bash, SSH och kubectl** körs på en Runner-värd som du styr, inte på OneUptime Worker. JavaScript körs i ett eget `isolated-vm`-isolat med 128 MB minne och utan åtkomst till Runnerns filsystem eller processer; det kan göra HTTP-begäranden med `axios`, men begäranden till privata nätverk, loopback- och link-local-adresser avvisas. Bash körs via `bash -c`, med en tidsgräns som upprätthålls på Runnern. Ett JavaScript-steg som inte väljer någon körs på projektets standard-Runner eller, om ingen är angiven, på en global Runner.
- **SSH-steg** loggar bara in när maskinen visar en av de värdnycklar som steget anger. Ett steg som inte anger någon godtar vilken nyckel som helst, och dess utdata nämner den som maskinen visade, så att den kan anges i steget.
- **HTTP-steg** använder en tillåtande statusvalidering, så att ett 4xx- eller 5xx-svar registreras som ett misslyckat steg i stället för att kastas som ett undantag, och den registrerade outputen visar vad motparten faktiskt returnerade. Omdirigeringar följs inte. Workern anropar aldrig loopback- eller link-local-adresser, till exempel en metadataslutpunkt i molnet; på OneUptime Cloud avvisar den även privata nätverksadresser, och en självhostad OneUptime avvisar dem med `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **AI-steg** ser aldrig privata incidentanteckningar eller meddelanden från Slack och Microsoft Teams, och tidigare stegs output genomsöks efter hemligheter, som maskeras innan den når modellen. Inbäddade bilder och långa kodade data utelämnas från prompten. Se [AI](/docs/runbooks/authoring#ai).
- **Globala Runners** kör bara JavaScript-steg, vart och ett i en sandlåda som skapas för steget och slängs efteråt, som bara når offentliga internetadresser, i högst 5 minuter och med högst tre steg från ett och samma projekt åt gången. De får bara de hemliga variabler från stegets eget projekt som är påslagna för globala Runners; den medföljande har sin egen nyckel och inget annat från servern. Se [Globala Runners](/docs/runbooks/agents#globala-runners).
- **Autentisering av Runners** sker med ID och hemlig nyckel, som anges som miljövariabler på Runner-containern. På servern kommer Runnerns gällande identitet från den databasrad som hör till det uppvisade ID:t och nyckeln: en klient kan inte utge sig för att vara en annan Runner, inte ens med en komprometterad nyckel.
- **Hemliga variabler** är krypterade i vila, returneras aldrig av API:t och lämnas bara ut till de Runners de listar, när dessa tar ett steg som nämner dem. En hemlig variabel lämnas också ut till en global Runner som tar ett steg i variabelns eget projekt, när variabeln låter globala Runners använda den. Runnern ersätter varje hemlighet som ett steg fick med `[REDACTED]` i det steget skriver ut, och OneUptime gör det igen innan utdata lagras. Ett HTTP-begäransteg, som OneUptime skickar själv, får varje hemlighet i sitt eget projekt som det nämner, och döljer dem i svaret det registrerar.

## Databastabeller

| Tabell | Vad den innehåller |
| --- | --- |
| `Runbook` | Mallen: namn, slug, beskrivning, `isEnabled`, etiketter och stegen som JSON. |
| `RunbookExecution` | En rad per körning, med de valfria främmande nycklarna `incidentId`, `alertId` och `scheduledMaintenanceId` och en JSON-array `stepExecutions` som fryser stegen och varje stegs tillstånd. |
| `RunbookRule` | Regler för automatisk start, med en diskriminator `triggerEntityType` (Incident, Alert, ScheduledMaintenance), en många-till-många-relation till de runbooks som ska startas, och det de matchar på: en JSON-kolumn `criteria` (villkoren) plus många-till-många-länkar till monitorer, incidentallvarlighetsgrader, larmallvarlighetsgrader, etiketter och monitoretiketter samt mönster för titel, beskrivning, monitornamn och monitorbeskrivning. |
| `Runner` | En rad per installerad Runner: namn, hemlig nyckel, `lastAlive`, `connectionStatus`, värdinformation och funktioner. En global Runner har `isGlobalRunner` satt och inget projekt; projektets standard-Runner har `isProjectDefault` satt. |
| `RunnerJob` | En rad per steg som skickats till en Runner: `targetAgentId` (den Runner som stegets författare valde), stegtyp, skript eller nyttolast, status (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` eller `Cancelled`), tidsfrist för övertagande, lease, output och slutkod. `runsOnGlobalRunner` markerar ett steg som vilken global Runner som helst får ta. |
| `RunbookVariable` | Runbook-variabler: projektets globala och en runbooks egna, som nämner den i `runbookId`; en hemlighets värde krypterat, och de Runners som får ta emot en hemlighet. |

## Drifttips

- **Se till att den Runner du väljer på ett steg är frisk.** Behöver du redundans kör du en Runner till och delar upp dina steg mellan dem, eller har ett reserv-runbook som pekar mot den andra Runnern.
- **Spara URL:er, inte blobbar.** Om ett steg genererar mer än några KB output skriver du den till objektlagring eller din loggstack och returnerar URL:en.
- **Idempotens spelar roll.** Ett HTTP request- eller AI-steg körs igen om Workern startar om mitt i steget och körningen återupptas. Ett steg på en Runner skickas högst en gång per körning, men ett skript kan ha körts delvis före ett fel, och du kanske kör runbooket igen. Utforma steg så att de tål att upprepas.

## Nästa steg

:::cards
- [Runbook-agenter](/docs/runbooks/agents): Installera, driv och felsök Runners.
- [Runbook-variabler](/docs/runbooks/variables): De värden och hemligheter som steg använder, och de Runners som tar emot dem.
- [Användare, team och behörigheter](/docs/permissions/index): Hur roller, etiketter och team avgör vem som kör vad.
:::
