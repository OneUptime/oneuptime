# LLM-providers

Een LLM-provider is het model achter elke AI-functie in OneUptime: onderzoeken, AI vragen, concepten en pull requests met een fix. Deze pagina laat zien welke provider een functie gebruikt, hoe je er zelf een toevoegt (OpenAI, Azure OpenAI en Microsoft Foundry, Anthropic, Groq, Mistral, Ollama of een willekeurige OpenAI-compatibele server) en hoe je OneUptime naar een model laat wijzen dat je zelf draait.

:::cards
- [Welke provider de AI gebruikt](#welke-provider-de-ai-gebruikt): De standaardprovider van het project, anders de globale.
- [Zelf gehost: zonder configuratie via omgevingsvariabelen](#zelf-gehost-zonder-configuratie-via-omgevingsvariabelen): Eén provider voor elk project, uit de instellingen van de server.
- [Een LLM-provider instellen](#een-llm-provider-instellen): Voeg een provider toe aan een project en test hem.
- [Een basis-URL kiezen voor een zelf gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model): Een adres dat de OneUptime-server kan bereiken.
:::

## Wat een provider aandrijft

- **Onderzoeken**: OneUptime AI onderzoekt nieuwe incidenten en waarschuwingen en plaatst een onderbouwde analyse van de hoofdoorzaak op de tijdlijn. Zie [AI SRE](/docs/ai/ai-sre).
- **Vragen**: **Ask AI** antwoordt uit de gegevens van je project, met een bron bij elke bewering. Zie [AI vragen](/docs/ai/ask-ai).
- **Concepten**: **Concept met AI** in de notities van incidenten, waarschuwingen en gepland onderhoud, en postmortems, opgesteld op verzoek of wanneer een incident wordt opgelost.
- **Code**: pull requests die uitzonderingen, trage traces en de oorzaken die onderzoeken vinden herstellen, vanuit OneUptime of vanuit GitHub. Zie [Code](/docs/ai/ai-agent).
- **Al het andere**: de triage van AI Insights, de AI-stappen van workflows en runbooks, en antwoorden in Slack en Microsoft Teams.

## Welke provider de AI gebruikt

AI-functies gebruiken de standaardprovider van het project. Een project zonder standaardprovider gebruikt de globale provider, als die er is. AI vragen kan een gesprek ook overzetten naar een andere provider van het project, of naar een globale.

```mermaid title="Welke provider een AI-functie gebruikt"
flowchart TB
    F["Een AI-functie<br/>heeft een<br/>model nodig"] --> D{"Heeft het project<br/>een standaard-<br/>provider?"}
    D -->|"ja"| P["De standaardprovider<br/>van het project"]
    D -->|"nee"| G{"Is er een globale<br/>provider?"}
    G -->|"ja"| GP["De globale<br/>provider:<br/>AI-tegoed op<br/>OneUptime Cloud"]
    G -->|"nee"| N["Er draait<br/>niets, en<br/>de AI-pagina's<br/>melden<br/>dat er een<br/>provider<br/>ontbreekt"]
```

Een provider is de standaard van een project wanneer **Instellen als standaard** aan staat, wat voor elke nieuwe provider zo is. Een project waarvan bij alle providers de standaard uit staat, valt terug op de globale provider, alsof het er geen had.

Elke OneUptime AI-regel – AI-regels en postmortem-regels – kan in plaats daarvan onder **Meer velden** een eigen provider kiezen: een van de providers van het project of een globale, die wordt gebruikt voor alles wat de regel start. Een regel die er geen kiest, gebruikt de standaardprovider, en een gekozen provider die niet meer gebruikt kan worden, valt daarop terug. Zie [Welke LLM-provider een regel gebruikt](/docs/ai/ai-sre#welke-llm-provider-een-regel-gebruikt).

## OneUptime Cloud

Op **OneUptime Cloud** kan elk project de globale provider zonder instellen gebruiken. Hij is klaar voor elke AI-functie en wordt betaald uit het AI-tegoed van het project.

Wil je in plaats daarvan je eigen API-sleutels of een bepaald model gebruiken, voeg dan zoals hieronder een eigen provider toe: AI die op je eigen provider draait, wordt je niet in rekening gebracht.

De globale LLM-provider wordt betaald uit het AI-tegoed van het project. Om te begrenzen wat AI per dag mag uitgeven, stel je een **Dagelijkse AI-uitgavenlimiet (USD)** in onder **Projectinstellingen → AI → AI Features → Meer instellingen**; een **Dagelijkse AI-tokenlimiet** daar begrenst tokens bij elke provider, ook je eigen. Zie [de eigen dagelijkse limieten van het project](/docs/ai/ai-sre#de-eigen-daglimieten-van-het-project).

OneUptime Cloud kan alleen LLM-endpoints op het openbare internet bereiken. Het kan geen verbinding maken met een model in je privénetwerk, zoals een zelf gehoste Ollama- of vLLM-server. Wil je een model gebruiken dat je zelf draait, host OneUptime dan zelf in een netwerk dat het kan bereiken, of stel het model beschikbaar op een openbaar endpoint: zie [Een basis-URL kiezen voor een zelf gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model).

## Zelf gehost: zonder configuratie via omgevingsvariabelen

Op een zelf gehoste instantie zet je AI het snelst aan voor **alle projecten tegelijk** door de omgevingsvariabelen `GLOBAL_LLM_PROVIDER_*` op je OneUptime-server in te stellen: in `config.env` voor Docker Compose, of via Helm-waarden. Bij het opstarten registreert OneUptime daaruit een globale LLM-provider en houdt die bij; geen enkel project hoeft iets in te stellen, en AI-hersteltaken gebruiken hem ook als een project geen eigen provider heeft.

| Variabele | Beschrijving |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Nodig om hem aan te zetten. Een van `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | De API-sleutel: nodig voor OpenAI, Azure OpenAI, Anthropic, Groq en Mistral; niet nodig voor Ollama of een OpenAI-compatibele server zonder sleutel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Het endpoint: nodig voor Azure OpenAI, Ollama en OpenAI-compatibele servers |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Het model dat gebruikt wordt: nodig voor OpenAI-compatibele servers, aanbevolen voor de andere |
| `GLOBAL_LLM_PROVIDER_NAME` | Een optionele weergavenaam, getoond in het dashboard |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

De synchronisatie is declaratief: wijzig een variabele en de provider volgt bij de volgende herstart; verwijder `GLOBAL_LLM_PROVIDER_TYPE` en de provider wordt verwijderd. Globale providers die met de hand in het Admin Dashboard zijn aangemaakt, worden nooit aangeraakt. Een project kan nog steeds een eigen provider toevoegen onder **Projectinstellingen → AI → LLM-providers**, en een provider die van het project is, gaat altijd voor.

## Ondersteunde providers

| Provider | Waarvoor hij is | API-sleutel nodig | Basis-URL nodig |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 en de andere OpenAI-modellen | Ja | Nee (gebruikt de standaard) |
| **Azure OpenAI / Microsoft Foundry** | Modellen die je uitrolt in Microsoft Foundry of Azure OpenAI: OpenAI-modellen, Foundry Models en Claude | Ja | Ja |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 en de andere Claude-modellen | Ja | Nee (gebruikt de standaard) |
| **Groq** | Snelle inferentie voor Llama, Mixtral en andere open modellen | Ja | Nee (gebruikt de standaard) |
| **Mistral** | De gehoste modellen van Mistral | Ja | Nee (gebruikt de standaard) |
| **Ollama** | Opensourcemodellen die je zelf draait, zoals Llama 3.1, Mistral of Qwen | Nee | Ja |
| **OpenAI Compatible** | Elke OpenAI-compatibele server: vLLM, LocalAI, LM Studio en andere | Nee (optioneel) | Ja |

## Een LLM-provider instellen

:::steps
### Open LLM-providers

Ga naar **Projectinstellingen → AI → LLM-providers** (de sectie **AI** van het zijmenu is eerst ingeklapt) en klik op **LLM-provider aanmaken**.

### Kies de provider

Kies onder **Provider** je **LLM-provider**: een kaart voor OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama en elke OpenAI-compatibele server, elk met een regel over wat het is.

### Verbind hem

Onder **Verbinding** vraagt het formulier alleen wat die provider gebruikt, met eigen hulp onder elk veld:

- **API-sleutel**: je API-sleutel, nodig voor OpenAI, Azure OpenAI, Anthropic, Groq en Mistral en optioneel voor een OpenAI-compatibele server; voor Ollama wordt er geen gevraagd
- **Basis-URL**: het endpoint, nodig voor Azure OpenAI, Ollama en OpenAI Compatible; voor de andere alleen om via een proxy of gateway te gaan
- **Modelnaam**: het model dat gebruikt wordt, zoals `gpt-5.1`, `claude-sonnet-5-5` of `llama3.1`. Leeg gelaten gebruikt OneUptime het standaardmodel van de provider, behalve bij een OpenAI-compatibele server, die er een nodig heeft
- **Naam**: de naam van de provider totdat je zelf een naam typt, zoals "Production OpenAI" of "Local Ollama"
- **Meer velden**, ingeklapt onder de velden hierboven: een **Beschrijving**, **Instellen als standaard**, dat aan staat voor een nieuwe provider omdat AI-functies alleen de standaardprovider van het project gebruiken, en **Extra parameters**, een optioneel JSON-object met extra parameters dat bij elk verzoek naar de provider wordt gestuurd (bijvoorbeeld `{"temperature": 0.2}`)

**Wie een provider kan zien.** De LLM-providers van een project worden alleen gelezen door de leden die de instellingen van het project mogen lezen: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Kijker**, **Instellingenbeheerder**, **Instellingenlid**, **Instellingenkijker** en **Read LLM**. De **API-sleutel** en de **Extra parameters** van een provider worden alleen gelezen door de eigenaren en beheerders van het project, omdat de parameters bij elk verzoek naar de provider worden gestuurd en net als de sleutel een token of een header kunnen bevatten. De andere leden zien of er parameters zijn opgeslagen, niet welke. Leden die een provider mogen bewerken, kunnen de API-sleutel of de parameters nog steeds vervangen zonder ze te lezen: in het bewerkformulier zijn die velden eerst leeg, en een veld leeg laten behoudt wat er is opgeslagen. Om de parameters te verwijderen, sla je `{}` op. Alleen eigenaren en beheerders van het project kunnen de **Basis-URL** van een provider wijzigen, omdat de API-sleutel en de extra parameters naar dat adres worden gestuurd; de andere leden die een provider mogen bewerken, kunnen al het andere wijzigen. Iedereen die een provider kan lezen, kan de **Basis-URL** lezen, zet er dus nooit een sleutel, een token of een wachtwoord in: gebruik de **API-sleutel**. De lijst **Globale LLM-providers** op dezelfde pagina, de gedeelde providers waarop een project terugvalt, toont hun naam, beschrijving en prijs aan iedereen die is aangemeld, en verder niets over hen.

### Test hem

**Een provider testen.** **Testen**, op de pagina van de provider of in het menu van zijn rij, stuurt de provider een korte prompt met zijn **API-sleutel**, **Modelnaam**, **Basis-URL** en **Extra parameters**, en zegt of hij antwoordde en een tool aanriep, wat de AI-functies van OneUptime nodig hebben. Een mislukte test zegt eerst wat je moet controleren en daarna wat de provider antwoordde. Wie een provider mag wijzigen, kan hem testen: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Instellingenbeheerder**, **Instellingenlid** en **Edit LLM**. Alle anderen die de provider kunnen zien, vinden **Testen** vergrendeld. Een globale LLM-provider wordt getest door een serverbeheerder, in het Admin Dashboard onder **Instellingen → Globale LLM-providers**.
:::

## Configuratie per provider

### OpenAI

1. Haal je API-sleutel op bij [OpenAI Platform](https://platform.openai.com/api-keys)
2. Kies **OpenAI** als LLM-provider
3. Voer je API-sleutel in
4. Kies een modelnaam:
   - `gpt-5.1` - Aanbevolen standaard, sterk in tool calling en complexe onderzoeken
   - `gpt-5.1-mini` - Sneller en voordeliger

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Haal je API-sleutel op in de [Anthropic Console](https://console.anthropic.com/)
2. Kies **Anthropic** als LLM-provider
3. Voer je API-sleutel in
4. Kies een modelnaam:
   - `claude-sonnet-5-5` - Aanbevolen standaard, de beste balans tussen intelligentie, snelheid en kosten
   - `claude-opus-5-5` - Capabeler, voor de moeilijkste onderzoeken
   - `claude-haiku-5-5` - Het snelst en het voordeligst

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 en alle latere Claude-modellen kiezen hun eigen sampling en weigeren een verzoek dat `temperature`, `top_p` of `top_k` instelt. OneUptime laat die instellingen voor deze modellen weg. Weigert een model er toch een, dan stuurt OneUptime het verzoek opnieuw zonder die instelling en onthoudt dat voor de provider.

Claude 5-modellen denken na voordat ze antwoorden, en dat nadenken telt mee voor de tokenlimiet van het antwoord, dus OneUptime laat er ruimte voor. Wil je dat ze minder nadenken en sneller en goedkoper antwoorden, stel dan `{"output_config": {"effort": "low"}}` in bij de **Extra parameters** van de provider. OneUptime stuurt de instellingen die je daar toevoegt bij elk verzoek naar Anthropic, behalve `model`, `messages`, `system`, `tools`, `tool_choice` en `stream`, die het zelf instelt.

OneUptime gebruikt de promptcaching van Anthropic. Elke aanroep van een onderzoek of een antwoord van AI vragen stuurt de systeemprompt, de tools en het gesprek tot dan toe opnieuw, en OneUptime markeert ze voor de cache: een aanroep betaalt een tiende van de prijs of minder voor wat de aanroepen ervoor stuurden, en een kwart meer dan de prijs voor wat nieuw is, dat hij in de cache schrijft. Als een gateway vóór Claude de cachemarkeringen weigert, stuurt OneUptime het verzoek opnieuw zonder ze en onthoudt dat voor de provider. [Hoe tokens worden geteld](/docs/ai/ai-sre#hoe-tokens-worden-geteld) legt uit hoe tokens uit de cache meetellen voor je limieten.

### Azure OpenAI en Microsoft Foundry

Gebruik **Azure OpenAI / Microsoft Foundry** voor de modellen die je uitrolt in Microsoft Foundry of Azure OpenAI: OpenAI-modellen, andere Foundry Models en Claude. Voer een van de sleutels van de resource in als **API-sleutel**, de naam van de deployment als **Modelnaam** en het endpoint van de resource als **Basis-URL**, zoals `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry en Azure OpenAI](/docs/ai/microsoft-foundry) loopt de Azure-kant door: de resource, machtigingen, de modeldeployment, netwerkvereisten en probleemoplossing.

### Ollama (zelf gehost)

Ollama draait opensourcemodellen op je eigen machines.

1. Installeer Ollama vanaf [ollama.ai](https://ollama.ai)
2. Haal een model op: `ollama pull llama3.1`
3. Zorg dat Ollama draait en dat de OneUptime-server het kan bereiken. Een native installatie luistert alleen op `127.0.0.1`, dus start het met `OLLAMA_HOST=0.0.0.0:11434` om verbindingen van andere machines en containers te accepteren (de officiële Docker-image `ollama/ollama` doet dat al)
4. Kies **Ollama** als LLM-provider
5. Voer de basis-URL in: het adres van de Ollama-server zoals de OneUptime-server het bereikt, zoals `http://ollama:11434` (OneUptime voegt `/api/chat` zelf toe). `localhost` werkt niet: zie [Een basis-URL kiezen voor een zelf gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
6. Voer de modelnaam in die je hebt opgehaald

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Vergroot het contextvenster.** Tenzij anders aangegeven, bepaalt Ollama het contextvenster van een model aan de hand van het GPU-geheugen dat het vindt: 4k tokens onder 24 GiB, 32k tot 48 GiB en 256k daarboven (oudere versies gebruiken 2.048 of 4.096 tokens). De AI-functies van OneUptime zijn agents. Elk verzoek bevat hun systeemprompt en tooldefinities, meer dan 10.000 tokens vóór welke vraag dan ook, en een AI-onderzoek voegt elk queryresultaat onderweg aan het gesprek toe. Past een verzoek niet meer, dan laat Ollama de oudste berichten vallen, en de vraag gaat mee. Afhankelijk van het model en de Ollama-versie antwoordt het model dan zonder de vraag of zonder zijn tools, of mislukt het verzoek met "no user query found in messages" (Qwen 3.8 en later) of "the prompt is longer than the context length currently available to the model". OneUptime meldt die fouten als "…the request is larger than the model's context window" en voert het onderzoek niet opnieuw uit. Stel een grotere `num_ctx` in bij de **Extra parameters** van de provider:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime voegt dit `options`-object samen met de opties die het naar Ollama stuurt, dus noem alleen de instellingen die je wilt wijzigen. 65.536 tokens is wat Ollama aanbeveelt voor agents, en dat dekt de meeste onderzoeken. Een lang onderzoek kan meer gebruiken, omdat OneUptime oude queryresultaten pas begint in te korten als het gesprek ongeveer 75.000 tokens passeert: gebruik 131.072 als het model dat ondersteunt en je GPU het aankan. Een groter contextvenster vraagt meer geheugen, en `ollama ps` toont de context die elk geladen model kreeg. Wil je in plaats daarvan de standaard voor elke client verhogen, stel dan `OLLAMA_CONTEXT_LENGTH` in op de Ollama-server. Dat is de enige manier wanneer OneUptime Ollama bereikt via de OpenAI-compatibele `/v1`-API (de provider **OpenAI Compatible**), die `num_ctx` negeert. Voor een globale provider die is geregistreerd uit de `GLOBAL_LLM_PROVIDER_*`-variabelen stel je **Extra parameters** in in het Admin Dashboard onder **Instellingen → Globale LLM-providers**; de synchronisatie bij het opstarten laat dat veld met rust.

**Populaire Ollama-modellen:**

- `llama3.1` - Het Llama 3.1-model van Meta, de oudste Llama met ondersteuning voor tool calling
- `llama3.3` - Het Llama 3.3-model van Meta
- `qwen2.5` - Het Qwen 2.5-model van Alibaba
- `mistral-nemo` - Het Nemo-model van Mistral AI

> [!NOTE]
> De AI-functies van OneUptime zijn agents: ze leunen zwaar op tool calling. Gebruik `llama3.1` of nieuwer, of een ander model dat tools aanroept. Een klein model, of een model zonder tool calling (zoals `llama2` of de oorspronkelijke `llama3`), antwoordt slecht: het kan je monitoren, incidenten of telemetrie niet bevragen, zodat onderzoeken leeg of verzonnen terugkomen.

### Een basis-URL kiezen voor een zelf gehost model

De basis-URL van een zelf gehost model, of het nu Ollama, vLLM, LM Studio of een andere OpenAI-compatibele server is, moet een adres zijn dat de **OneUptime-server** kan bereiken. Je browser maakt er nooit verbinding mee.

**Loopback-adressen worden altijd geweigerd.** Voordat OneUptime verbinding maakt, controleert het elk adres waarnaar de hostnaam van de basis-URL verwijst. `localhost`, `127.0.0.1`, `[::1]` en `0.0.0.0`, en ook link-local- en cloudmetadata-adressen zoals `169.254.169.254`, worden in elke installatie geweigerd, ook bij zelf hosten. Dat is bewust: de basis-URL van een provider mag niet bruikbaar zijn om diensten op de OneUptime-server zelf te bereiken. Binnen Docker Compose of Kubernetes zou `localhost` toch al de OneUptime-container zijn, niet de machine waarop je model draait.

Gebruik in plaats daarvan een privéadres of een interne hostnaam:

| Waar de modelserver draait | Basis-URL |
| --- | --- |
| Een service op het Docker Compose-netwerk van OneUptime (`oneuptime`) | De servicenaam, bijv. `http://ollama:11434` |
| Hetzelfde Kubernetes-cluster als OneUptime | De DNS-naam van de Service, bijv. `http://ollama.<namespace>.svc.cluster.local:11434`, hetzelfde patroon als de [meegeleverde vLLM](#zelf-gehoste-vllm-op-kubernetes-helm) |
| De hostmachine zelf, buiten elke container | Het LAN-IP-adres van de host, bijv. `http://192.168.1.20:11434`, of `http://host.docker.internal:11434` op Docker Desktop |
| Een andere machine in je netwerk | Het privé-IP-adres of de interne hostnaam ervan, bijv. `http://10.0.0.12:11434` |

OpenAI-compatibele servers volgen dezelfde regels met hun eigen poort en `/v1`-pad, bijv. `http://vllm:8000/v1`, of `http://192.168.1.20:1234/v1` voor LM Studio. Net als een native Ollama-installatie luistert LM Studio alleen op `127.0.0.1` totdat je **Serve on Local Network** aanzet in de serverinstellingen.

**Privéadressen werken bij zelf gehoste installaties.** Een zelf gehoste OneUptime kan privénetwerkadressen bereiken, zoals `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` en IPv6 `fc00::/7`, tenzij je `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` instelt, wat ze weigert zoals OneUptime Cloud dat doet. Die instelling geldt niet voor een globale LLM-provider, die een beheerder configureert (met de `GLOBAL_LLM_PROVIDER_*`-variabelen of in het Admin Dashboard) in plaats van een project: die kan privéadressen nog steeds bereiken. Loopback- en link-local-adressen blijven voor elke provider geweigerd.

**OneUptime Cloud (SaaS) kan geen privénetwerken bereiken.** Het weigert privénetwerkadressen, en hostnamen die daarnaar verwijzen, voor elke LLM-provider. Wil je een model gebruiken dat op je eigen infrastructuur draait, host OneUptime dan zelf in een netwerk dat het kan bereiken, of stel het model beschikbaar op een openbaar bereikbaar endpoint. Bescherm een openbaar endpoint met een API-sleutel: de provider **Ollama** stuurt geen inloggegevens, terwijl **OpenAI Compatible** de API-sleutel als bearer-token stuurt (Ollama biedt onder `/v1` ook een OpenAI-compatibele API, zodat het achter een reverse proxy kan staan die de sleutel controleert).

### OpenAI Compatible (vLLM, LocalAI, LM Studio enzovoort)

Gebruik de provider **OpenAI Compatible** voor elke server die de OpenAI-API `/chat/completions` implementeert maar niet OpenAI zelf is, bijvoorbeeld [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) of text-generation-webui. Die draaien meestal op je eigen adres, vaak zonder authenticatie.

1. Start je OpenAI-compatibele server en noteer de basis-URL (die eindigt meestal op `/v1`)
2. Kies **OpenAI Compatible** als LLM-provider
3. Voer de **Basis-URL** in (verplicht), bijv. `http://your-server:8000/v1`. De OneUptime-server moet hem kunnen bereiken, dus niet `localhost`: zie [Een basis-URL kiezen voor een zelf gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
4. Voer de **Modelnaam** in (verplicht): die moet overeenkomen met een model dat je server aanbiedt
5. Voer de **API-sleutel** alleen in als je server erom vraagt; laat hem leeg voor een server zonder sleutel

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Gebruik na het opslaan **Testen** bij de provider om de verbinding, de modelnaam en de basis-URL te controleren.

### Zelf gehoste vLLM op Kubernetes (Helm)

Als je OneUptime zelf host met de Helm-chart, kun je [vLLM](https://docs.vllm.ai), een OpenAI-compatibele inferentieserver, in je cluster draaien en lokale modellen op je eigen GPU's aanbieden. Er verlaat geen data je infrastructuur.

1. Zet het aan in je Helm-waarden (het heeft NVIDIA-GPU-nodes nodig):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Voer `helm upgrade` uit en wacht tot de vLLM-pod Ready is (bij de eerste start wordt het model gedownload)
3. Dat is alles: vLLM wordt bij het opstarten automatisch geregistreerd als globale LLM-provider (`vllm.globalProvider.enabled`, standaard `true`), zodat AI-functies voor alle projecten werken, ook AI-hersteltaken. (Overal, in de cloud en zelf gehost, gebruiken hersteltaken van de agent de globale provider als het project geen eigen provider heeft; in de cloud wordt dat gebruik gefactureerd als gemeten AI-tokens. Een provider die van het project is, gaat altijd voor.)

Als je de automatische registratie hebt uitgezet (`vllm.globalProvider.enabled: false`), maak de provider dan met de hand aan:

1. Kies **OpenAI Compatible** als LLM-provider (vLLM spreekt de OpenAI-API)
2. Voer de basis-URL binnen het cluster in: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (vervang `cluster.local` als je `global.clusterDomain` hebt gewijzigd)
3. Voer de modelnaam in: de volledige Hugging Face-model-id (of `vllm.servedModelName` als je die hebt ingesteld)
4. Voer de API-sleutel alleen in als je `vllm.apiKey` hebt ingesteld; laat hem leeg voor een vLLM zonder sleutel

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Met facturering aan, of met `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in de Helm-waarden), kan de eigen provider van een project dit adres binnen het cluster niet bereiken, omdat het naar een privé-cluster-IP verwijst. Maak de provider in plaats daarvan aan in het Admin Dashboard onder **Instellingen → Globale LLM-providers**, met dezelfde velden: een globale LLM-provider kan dat adres wel bereiken.

Zie de [vLLM-handleiding van de Helm-chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) voor GPU-planning, afgeschermde modellen en afstemopties.

## Goede gewoonten

- **Geef providers duidelijke namen**, zoals "Production OpenAI" of "Development Ollama", zodat een teamgenoot weet welke welke is.
- **Bewaar sleutels in het veld API-sleutel.** API-sleutels worden versleuteld opgeslagen, en alleen eigenaren en beheerders van het project lezen ze.
- **Test na elke wijziging**, met **Testen** bij de provider.
- **Houd in de gaten wat AI kost.** Elke aanroep staat met zijn tokens en kosten onder **Projectinstellingen → AI → AI-logboeken**.

## Problemen oplossen

:::details De provider is niet bereikbaar
- **OpenAI of Anthropic**: controleer of je API-sleutel geldig is en tegoed heeft
- **Azure OpenAI / Microsoft Foundry**: de fout begint met wat je moet wijzigen. [Microsoft Foundry en Azure OpenAI](/docs/ai/microsoft-foundry) legt elke fout uit waarmee Azure antwoordt
- **Ollama**: controleer of de Ollama-server draait, luistert op een adres dat de OneUptime-server kan bereiken (`OLLAMA_HOST=0.0.0.0:11434` bij een native installatie), en of de basis-URL naar dat adres wijst
- **OpenAI Compatible**: controleer of de basis-URL eindigt op `/v1` (of bij je server past), of de modelnaam overeenkomt met een model dat je server aanbiedt, en of je alleen een API-sleutel hebt ingesteld als je server erom vraagt
- **"…points to an address OneUptime is not allowed to connect to"**: de basis-URL verwijst naar een geweigerd adres: `localhost` of een ander loopback-adres, of, op OneUptime Cloud, een privénetwerkadres. (OneUptime Cloud meldt een geweigerde hostnaam in plaats daarvan als "…could not be reached".) Zie [Een basis-URL kiezen voor een zelf gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
- **Een firewall**: controleer of je netwerk uitgaande verbindingen naar de API van de provider toestaat
:::

:::details Het model wordt niet gevonden
Controleer de spelling van de modelnaam. Haal bij Ollama het model eerst op met `ollama pull <model-name>`. Sommige modellen zijn alleen in sommige regio's beschikbaar.
:::

:::details Het contextvenster is te klein
- **"…the request is larger than the model's context window"**: het verzoek paste niet in het contextvenster van het model, meestal omdat een AI-onderzoek veel bewijs heeft verzameld. Verhoog `num_ctx` bij de **Extra parameters** van de provider, of `OLLAMA_CONTEXT_LENGTH` op de Ollama-server; zie [Ollama (zelf gehost)](#ollama-zelf-gehost)
- **"no user query found in messages"**: hetzelfde probleem, zoals Qwen het meldt. OneUptime stuurt de vraag altijd mee; Ollama heeft hem laten vallen om de rest van het verzoek te laten passen
:::

Kom je er nog steeds niet uit? Zoek je fout op in de [GitHub-issues van OneUptime](https://github.com/OneUptime/oneuptime/issues), of neem contact op met support als je abonnement dat omvat.

## Volgende stappen

:::cards
- [Code](/docs/ai/ai-agent): Pull requests die je provider schrijft, en waar ze starten.
- [AI SRE](/docs/ai/ai-sre): Wat OneUptime AI met de provider doet zodra het er een heeft.
- [AI vragen](/docs/ai/ask-ai): Stel je project een vraag, en wissel van provider in een gesprek.
:::
