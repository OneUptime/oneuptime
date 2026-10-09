# LLM Providers

OneUptime ondersteunt integratie met diverse Large Language Model (LLM)-providers om door AI aangedreven functies door het hele platform in te schakelen. Deze handleiding helpt u uw eigen LLM-provider te configureren.

## Wat kunnen LLM Providers doen?

LLM Providers in OneUptime helpen u uw incidentbeheerworkflow te automatiseren en te verbeteren:

- **Autonome onderzoeken**: Nieuwe incidenten en meldingen automatisch onderzoeken en een oorzaakanalyse met bronvermelding op de tijdlijn plaatsen — zie [AI SRE](/docs/ai/ai-sre)
- **Incidentnotities**: Automatisch gedetailleerde incidentnotities en updates genereren
- **Meldingsnotities**: Betekenisvolle meldingsbeschrijvingen en context aanmaken
- **Notities voor gepland onderhoud**: Automatisch notities voor onderhoudsgebeurtenissen genereren
- **Incidentpostmortems**: Automatisch uitgebreide incidentpostmortemrapporten opstellen
- **Codeverbeteringen**: Als u uw code-repository koppelt aan OneUptime, gebruiken we uw LLM Provider om telemetriegegevens (logs, traces, metrics, uitzonderingen) te analyseren en codeverbeteringen voor te stellen

## Gebruikers van OneUptime SaaS

Als u **OneUptime SaaS** (cloud-gehoste versie) gebruikt, kunt u standaard de **Globale LLM Provider** gebruiken zonder aanvullende configuratie. De Globale LLM Provider is vooraf geconfigureerd en klaar voor gebruik voor alle AI-functies.

Als u liever uw eigen API-sleutels of een specifieke provider gebruikt, kunt u nog steeds een aangepaste LLM Provider configureren aan de hand van de onderstaande instructies.

OneUptime SaaS kan alleen LLM-endpoints op het openbare internet bereiken. Het kan geen verbinding maken met een model in uw privénetwerk, zoals een zelf-gehoste Ollama- of vLLM-server. Om een model te gebruiken dat u zelf draait, host u OneUptime zelf op een netwerk dat het model kan bereiken, of stelt u het model beschikbaar op een openbaar endpoint — zie [Een Basis-URL kiezen voor een zelf-gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model).

## Zelf-gehost: instellen met alleen omgevingsvariabelen

Op een zelf-gehoste instantie schakelt u AI-functies het snelst in voor **alle projecten tegelijk** door de omgevingsvariabelen `GLOBAL_LLM_PROVIDER_*` op uw OneUptime-server in te stellen — in `config.env` bij Docker Compose, of via Helm-waarden. Bij het opstarten registreert OneUptime daarmee een Globale LLM Provider (en houdt die gesynchroniseerd); u hoeft niets per project in het dashboard in te stellen, en AI-hersteltaken gebruiken hem ook wanneer een project geen eigen provider heeft.

| Variabele | Beschrijving |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Vereist om in te schakelen. Een van: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-sleutel — vereist voor OpenAI, Azure OpenAI, Anthropic, Groq en Mistral; niet nodig voor Ollama of OpenAI-compatibele servers zonder sleutel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API-eindpunt — vereist voor Azure OpenAI, Ollama en OpenAI-compatibele servers |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Te gebruiken model (vereist voor OpenAI-compatibele servers, aanbevolen voor de rest) |
| `GLOBAL_LLM_PROVIDER_NAME` | Optionele beschrijvende naam die in het dashboard wordt getoond |

**Voorbeeld: zelf-gehoste Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# Een adres dat de OneUptime-server kan bereiken. Nooit localhost: zie
# "Een Basis-URL kiezen voor een zelf-gehost model" hieronder.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Geen API-sleutel nodig — Ollama werkt zonder sleutel.
```

**Voorbeeld: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

De synchronisatie is declaratief: wijzigt u de variabelen, dan wordt de provider bij de volgende herstart bijgewerkt, en verwijdert u `GLOBAL_LLM_PROVIDER_TYPE`, dan wordt hij verwijderd. Globale providers die handmatig in het Admin Dashboard zijn aangemaakt, blijven altijd ongemoeid. Projecten kunnen nog steeds een eigen provider toevoegen onder **Projectinstellingen** > **AI** > **LLM-providers** — een provider van het project zelf gaat altijd voor op de globale.

## Ondersteunde providers

OneUptime ondersteunt momenteel de volgende LLM-providers:

| Provider              | Beschrijving                                                               | API-sleutel vereist | Basis-URL vereist        |
| --------------------- | -------------------------------------------------------------------------- | ------------------- | ------------------------ |
| **OpenAI**            | GPT-5.1 en andere OpenAI-modellen                                          | Ja                  | Nee (gebruikt standaard) |
| **Azure OpenAI**      | OpenAI-modellen gehost op uw Azure-implementatie                           | Ja                  | Ja                       |
| **Anthropic**         | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 en andere Claude-modellen | Ja                  | Nee (gebruikt standaard) |
| **Groq**              | Snelle inferentie voor Llama, Mixtral en andere open modellen              | Ja                  | Nee (gebruikt standaard) |
| **Mistral**           | Door Mistral gehoste modellen                                              | Ja                  | Nee (gebruikt standaard) |
| **Ollama**            | Zelf-gehoste open-source modellen zoals Llama 3.1, Mistral, Qwen, enz.     | Nee                 | Ja                       |
| **OpenAI Compatible** | Elke OpenAI-compatibele server (vLLM, LocalAI, LM Studio, enz.)            | Nee (optioneel)     | Ja                       |

## Een LLM Provider instellen

### Stap 1: Navigeer naar de instellingen van LLM Providers

1. Log in op uw OneUptime-dashboard
2. Ga naar **Projectinstellingen** > **AI** > **LLM-providers**
3. Klik op **LLM-provider aanmaken** om een nieuwe provider toe te voegen

### Stap 2: Configureer uw provider

Vul de volgende velden in:

- **Naam**: Een beschrijvende naam voor deze LLM-configuratie (bijv. "Productie OpenAI", "Lokale Ollama")
- **Beschrijving** (optioneel): Een omschrijving om het doel van deze provider te identificeren
- **LLM-provider**: Selecteer het providertype (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama of OpenAI Compatible)
- **API-sleutel**: Uw API-sleutel (vereist voor OpenAI, Azure OpenAI, Anthropic, Groq en Mistral; optioneel voor Ollama en OpenAI-compatibele servers)
- **Modelnaam**: Het specifieke te gebruiken model (bijv. `gpt-5.1`, `claude-sonnet-5-5`, `llama3.1`)
- **Basis-URL** (optioneel): Aangepaste API-eindpunt-URL (vereist voor Azure OpenAI, Ollama en OpenAI Compatible; optioneel voor anderen)
- **Meer velden**, ingeklapt onder de velden hierboven: **Instellen als standaard**, dat voor een nieuwe provider aan staat omdat AI-functies alleen de standaardprovider van het project gebruiken, en **Extra parameters**, een optioneel JSON-object met extra parameters dat bij elk verzoek naar de provider wordt gestuurd (bijvoorbeeld `{"temperature": 0.2}`)

## Providerspecifieke configuratie

### OpenAI

1. Haal uw API-sleutel op van het [OpenAI Platform](https://platform.openai.com/api-keys)
2. Selecteer **OpenAI** als LLM-provider
3. Voer uw API-sleutel in
4. Kies een modelnaam:
   - `gpt-5.1` - Aanbevolen standaard, sterk in tool calling en complexe onderzoeken
   - `gpt-5.1-mini` - Sneller en kosteneffectiever

**Voorbeeldconfiguratie:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Haal uw API-sleutel op van de [Anthropic Console](https://console.anthropic.com/)
2. Selecteer **Anthropic** als LLM-provider
3. Voer uw API-sleutel in
4. Kies een modelnaam:
   - `claude-sonnet-5-5` - Aanbevolen standaard, beste balans tussen intelligentie, snelheid en kosten
   - `claude-opus-5-5` - Capabeler, voor de moeilijkste onderzoeken
   - `claude-haiku-5-5` - Snelst en meest kosteneffectief

**Voorbeeldconfiguratie:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 en alle latere Claude-modellen kiezen zelf hun sampling en weigeren een verzoek dat `temperature`, `top_p` of `top_k` instelt. OneUptime laat die instellingen voor deze modellen weg. Weigert een model er toch een, dan stuurt OneUptime het verzoek opnieuw zonder die instelling en onthoudt dat voor de provider.

Claude 5-modellen denken na voordat ze antwoorden, en dat nadenken telt mee voor de tokenlimiet van het antwoord, dus OneUptime laat er ruimte voor. Wilt u dat ze minder nadenken, en sneller en goedkoper antwoorden, zet dan `{"output_config": {"effort": "low"}}` in het veld **Extra parameters** van de provider. Wat u daar toevoegt, stuurt OneUptime bij elk verzoek naar Anthropic, behalve `model`, `messages`, `system`, `tools`, `tool_choice` en `stream`, die OneUptime zelf instelt.

### Ollama (Zelf-gehost)

Ollama stelt u in staat open-source LLM's lokaal of op uw eigen infrastructuur te draaien.

1. Installeer Ollama van [ollama.ai](https://ollama.ai)
2. Haal het gewenste model op: `ollama pull llama3.1`
3. Zorg dat Ollama actief is en bereikbaar vanaf de OneUptime-server. Een native installatie luistert alleen op `127.0.0.1`; start Ollama daarom met `OLLAMA_HOST=0.0.0.0:11434` zodat het verbindingen van andere machines en containers accepteert (de officiële Docker-image `ollama/ollama` doet dit al)
4. Selecteer **Ollama** als LLM-provider
5. Voer de Basis-URL in: het adres van de Ollama-server zoals de OneUptime-server die bereikt, bijv. `http://ollama:11434` (OneUptime voegt `/api/chat` zelf toe). `localhost` werkt niet — zie [Een Basis-URL kiezen voor een zelf-gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
6. Voer de modelnaam in die u hebt opgehaald

**Voorbeeldconfiguratie (Ollama als service met de naam `ollama` op het Docker Compose-netwerk van OneUptime):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Vergroot het contextvenster.** Tenzij anders ingesteld, bepaalt Ollama de grootte van het contextvenster van een model aan de hand van het GPU-geheugen dat het aantreft: 4k tokens onder 24 GiB, 32k tot 48 GiB en 256k daarboven (oudere versies gebruiken 2048 of 4096 tokens). De AI-functies van OneUptime zijn agents. Elk verzoek bevat hun systeemprompt en tooldefinities, samen al meer dan 10.000 tokens voordat er een vraag bij komt, en een AI-onderzoek voegt gaandeweg elk queryresultaat aan het gesprek toe. Past een verzoek niet meer, dan laat Ollama de oudste berichten vallen, en daarmee verdwijnt ook de vraag. Afhankelijk van het model en de Ollama-versie antwoordt het model dan zonder de vraag of zonder zijn tools, of mislukt het verzoek met "no user query found in messages" (Qwen 3.8 en later) of "the prompt is longer than the context length currently available to the model". OneUptime meldt die fouten als "…the request is larger than the model's context window" en voert het onderzoek niet opnieuw uit. Stel een grotere `num_ctx` in bij **Extra parameters** van de provider:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime voegt dit `options`-object samen met de opties die het naar Ollama stuurt, dus vermeld alleen de instellingen die u wilt wijzigen. 65.536 tokens is wat Ollama aanbeveelt voor agents, en dat volstaat voor de meeste onderzoeken. Een lang onderzoek kan meer gebruiken, omdat OneUptime pas oude queryresultaten begint in te korten zodra het gesprek ongeveer 75.000 tokens overschrijdt: gebruik 131.072 als het model dat ondersteunt en uw GPU het aankan. Een groter contextvenster vraagt meer geheugen, en `ollama ps` toont welke context elk geladen model heeft gekregen. Wilt u in plaats daarvan de standaardwaarde voor alle clients verhogen, stel dan `OLLAMA_CONTEXT_LENGTH` in op de Ollama-server. Dat is de enige manier wanneer OneUptime Ollama bereikt via de OpenAI-compatibele API onder `/v1` (de provider **OpenAI Compatible**), die `num_ctx` negeert. Voor een globale provider die vanuit `GLOBAL_LLM_PROVIDER_*`-variabelen wordt geregistreerd, stelt u **Extra parameters** in het Admin Dashboard in onder **Instellingen** > **Globale LLM-providers**; de synchronisatie bij het opstarten laat dat veld ongemoeid.

**Populaire Ollama-modellen:**

- `llama3.1` - Meta's Llama 3.1-model, de oudste Llama met ondersteuning voor tool calling
- `llama3.3` - Meta's Llama 3.3-model
- `qwen2.5` - Alibaba's Qwen 2.5-model
- `mistral-nemo` - Mistral AI's Nemo-model

> Opmerking: de AI-functies van OneUptime zijn agentisch — ze leunen sterk op tool calling. Gebruik `llama3.1` of nieuwer (of een ander model dat tool calling ondersteunt). Kleine modellen of modellen zonder tool calling (bijv. `llama2`, de oorspronkelijke `llama3`) leveren slechte resultaten: ze kunnen uw monitors, incidenten of telemetrie niet opvragen, waardoor onderzoeken leeg of verzonnen terugkomen.

### Een Basis-URL kiezen voor een zelf-gehost model

De Basis-URL van een zelf-gehost model — Ollama, vLLM, LM Studio of een andere OpenAI-compatibele server — moet een adres zijn dat de **OneUptime-server** kan bereiken. Uw browser maakt er nooit verbinding mee.

**Loopback-adressen worden altijd geweigerd.** Voordat OneUptime verbinding maakt, controleert het elk adres waarnaar de hostnaam van de Basis-URL wordt omgezet. `localhost`, `127.0.0.1`, `[::1]` en `0.0.0.0`, evenals link-local-adressen en cloud-metadata-adressen zoals `169.254.169.254`, worden in elke installatie geweigerd, ook bij zelf-hosting. Dat is zo ontworpen: via de Basis-URL van een provider mogen geen services op de OneUptime-server zelf bereikbaar zijn. Binnen Docker Compose of Kubernetes zou `localhost` bovendien de OneUptime-container zijn, niet de machine waarop uw model draait.

Gebruik in plaats daarvan een privéadres of een interne hostnaam:

| Waar de modelserver draait | Basis-URL |
| --- | --- |
| Een service op het Docker Compose-netwerk van OneUptime (`oneuptime`) | De servicenaam, bijv. `http://ollama:11434` |
| Hetzelfde Kubernetes-cluster als OneUptime | De DNS-naam van de Service, bijv. `http://ollama.<namespace>.svc.cluster.local:11434` — hetzelfde patroon als de [meegeleverde vLLM](#zelf-gehoste-vllm-op-kubernetes-helm) |
| De hostmachine zelf, buiten elke container | Het LAN-IP-adres van de host, bijv. `http://192.168.1.20:11434`, of `http://host.docker.internal:11434` met Docker Desktop |
| Een andere machine in uw netwerk | Het privé-IP-adres of de interne hostnaam daarvan, bijv. `http://10.0.0.12:11434` |

OpenAI-compatibele servers volgen dezelfde regels met hun eigen poort en `/v1`-pad, bijv. `http://vllm:8000/v1`, of `http://192.168.1.20:1234/v1` voor LM Studio. Net als een native Ollama-installatie luistert LM Studio alleen op `127.0.0.1` totdat u **Serve on Local Network** inschakelt in de serverinstellingen.

**Privéadressen werken bij zelf-gehoste installaties.** Een zelf-gehoste OneUptime kan privénetwerkadressen bereiken, zoals `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` en IPv6 `fc00::/7`, tenzij u `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` instelt, waarmee ze net als in OneUptime Cloud worden geweigerd. Die instelling geldt niet voor een Globale LLM Provider: die configureert een beheerder (met de `GLOBAL_LLM_PROVIDER_*`-variabelen of in het Admin Dashboard), niet een project, dus hij kan privéadressen nog steeds bereiken. Loopback- en link-local-adressen blijven voor elke provider geweigerd.

**OneUptime Cloud (SaaS) kan geen privénetwerken bereiken.** Het weigert privénetwerkadressen, en hostnamen die daarnaar worden omgezet, voor elke LLM-provider. Om een model te gebruiken dat op uw eigen infrastructuur draait, host u OneUptime zelf op een netwerk dat het model kan bereiken, of stelt u het model beschikbaar op een openbaar bereikbaar endpoint. Bescherm een openbaar endpoint met een API-sleutel: de provider **Ollama** stuurt geen inloggegevens mee, terwijl **OpenAI Compatible** de API-sleutel als bearer-token meestuurt (Ollama biedt onder `/v1` ook een OpenAI-compatibele API, zodat het achter een reverse proxy kan staan die de sleutel controleert).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, enz.)

Gebruik de **OpenAI Compatible**-provider voor elke server die de OpenAI `/chat/completions` API implementeert maar niet OpenAI zelf is — bijvoorbeeld [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) of text-generation-webui. Deze zijn doorgaans zelf-gehost op uw eigen URL en draaien vaak zonder authenticatie.

1. Start uw OpenAI-compatibele server en noteer de basis-URL (deze eindigt meestal op `/v1`)
2. Selecteer **OpenAI Compatible** als LLM-provider
3. Voer de **Basis-URL** in (vereist), bijv. `http://your-server:8000/v1`. Deze moet bereikbaar zijn vanaf de OneUptime-server, dus niet `localhost` — zie [Een Basis-URL kiezen voor een zelf-gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
4. Voer de **Modelnaam** in (vereist) — deze moet overeenkomen met een model dat uw server aanbiedt
5. Voer de **API-sleutel** alleen in als uw server dit vereist; laat deze leeg voor sleutelloze servers

**Voorbeeldconfiguratie (sleutelloze vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tip: Gebruik na het opslaan de knop **Testen** op de provider om te bevestigen dat de verbinding, modelnaam en basis-URL correct zijn.

### Zelf-gehoste vLLM op Kubernetes (Helm)

Als u OneUptime zelf host met de Helm-chart, kunt u [vLLM](https://docs.vllm.ai) — een OpenAI-compatibele inferentieserver — binnen uw cluster draaien en lokale modellen op uw eigen GPU's aanbieden. Er verlaat geen data uw infrastructuur.

1. Schakel het in uw Helm-waarden in (vereist NVIDIA GPU-nodes):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Voer `helm upgrade` uit en wacht tot de vLLM-pod Ready wordt (bij de eerste start wordt het model gedownload)
3. Dat is alles — vLLM wordt bij het opstarten automatisch geregistreerd als Globale LLM Provider (`vllm.globalProvider.enabled`, standaard `true`), zodat AI-functies voor alle projecten werken, ook AI-hersteltaken. (Overal — in de cloud en zelf-gehost — gebruiken de hersteltaken van de agent de globale provider wanneer het project geen eigen provider heeft; in de cloud wordt dat gebruik gefactureerd als gemeten AI-tokens. Een provider van het project zelf gaat altijd voor.)

Als u automatische registratie hebt uitgeschakeld (`vllm.globalProvider.enabled: false`), maak de provider dan handmatig aan:

1. Selecteer **OpenAI Compatible** als LLM-provider (vLLM spreekt de OpenAI API)
2. Voer de in-cluster Basis-URL in: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (vervang `cluster.local` als u `global.clusterDomain` hebt gewijzigd)
3. Voer de Modelnaam in: het volledige HuggingFace-model-id (of `vllm.servedModelName` als u dat hebt ingesteld)
4. Voer de API-sleutel alleen in als u `vllm.apiKey` hebt ingesteld; laat deze leeg voor een sleutelloze vLLM

**Voorbeeldconfiguratie:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Met facturering ingeschakeld, of met `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` in de Helm-waarden), kan de eigen provider van een project dit adres binnen het cluster niet bereiken, omdat het naar een privé-IP-adres van het cluster wordt omgezet. Maak de provider in plaats daarvan met dezelfde velden aan in het Admin Dashboard onder **Instellingen** > **Globale LLM-providers**: een Globale LLM Provider kan dat adres wel bereiken.

Zie de [vLLM-gids van de Helm chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) voor GPU-planning, gated models en tuning-opties.

## Aangepaste Basis-URL's gebruiken

Voor enterprise-implementaties of bij gebruik van proxyservices kunt u een aangepaste Basis-URL opgeven:

- **Azure OpenAI**: Gebruik uw Azure-eindpunt-URL
- **OpenAI-compatibele API's**: Elke API die de OpenAI API-specificatie volgt
- **Privé Ollama-instanties**: De URL van uw interne Ollama-server

## Best practices

1. **Gebruik beschrijvende namen**: Benoem uw providers duidelijk (bijv. "Productie OpenAI", "Ontwikkeling Ollama")
2. **Beveilig uw API-sleutels**: API-sleutels worden versleuteld opgeslagen, maar deel ze nooit
3. **Test uw configuratie**: Controleer na het instellen of de provider werkt met AI-functies
4. **Houd het gebruik bij**: Volg het API-gebruik om kosten te beheren

## Probleemoplossing

### Verbindingsproblemen

- **OpenAI/Anthropic**: Controleer of uw API-sleutel geldig is en voldoende tegoed heeft
- **Ollama**: Zorg dat de Ollama-server actief is, luistert op een adres dat de OneUptime-server kan bereiken (`OLLAMA_HOST=0.0.0.0:11434` bij een native installatie), en dat de Basis-URL naar dat adres wijst
- **OpenAI Compatible**: Zorg dat de Basis-URL eindigt op `/v1` (of overeenkomt met uw server), dat de Modelnaam overeenkomt met een model dat uw server aanbiedt, en stel alleen een API-sleutel in als uw server dit vereist
- **"…points to an address OneUptime is not allowed to connect to"**: de Basis-URL wordt omgezet naar een geweigerd adres — `localhost` of een ander loopback-adres, of op OneUptime Cloud een privénetwerkadres. (OneUptime Cloud meldt een geweigerde hostnaam in plaats daarvan als "…could not be reached".) Zie [Een Basis-URL kiezen voor een zelf-gehost model](#een-basis-url-kiezen-voor-een-zelf-gehost-model)
- **Firewall**: Controleer of uw netwerk uitgaande verbindingen naar de API van de provider toestaat

### Model niet gevonden

- Controleer of de modelnaam correct is gespeld
- Zorg bij Ollama dat u het model hebt opgehaald met `ollama pull <model-name>`
- Controleer of het model beschikbaar is in uw regio (sommige modellen hebben regionale beperkingen)

### Contextvenster te klein

- **"…the request is larger than the model's context window"**: het verzoek paste niet in het contextvenster van het model, meestal omdat een AI-onderzoek veel bewijs heeft verzameld. Verhoog `num_ctx` bij **Extra parameters** van de provider, of `OLLAMA_CONTEXT_LENGTH` op de Ollama-server; zie [Ollama (Zelf-gehost)](#ollama-zelf-gehost)
- **"no user query found in messages"**: hetzelfde probleem, zoals Qwen het meldt. OneUptime stuurt de vraag altijd mee; Ollama heeft hem laten vallen om de rest van het verzoek te laten passen

## Hulp nodig?

Als u problemen ondervindt bij het instellen van uw LLM-provider:

1. Controleer de [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) voor bekende problemen
2. Neem contact op met ondersteuning als u een enterprise-abonnement heeft
