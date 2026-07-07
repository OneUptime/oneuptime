# LLM Providers

OneUptime ondersteunt integratie met diverse Large Language Model (LLM)-providers om door AI aangedreven functies door het hele platform in te schakelen. Deze handleiding helpt u uw eigen LLM-provider te configureren.

## Wat kunnen LLM Providers doen?

LLM Providers in OneUptime helpen u uw incidentbeheerworkflow te automatiseren en te verbeteren:

- **Incidentnotities**: Automatisch gedetailleerde incidentnotities en updates genereren
- **Meldingsnotities**: Betekenisvolle meldingsbeschrijvingen en context aanmaken
- **Notities voor gepland onderhoud**: Automatisch notities voor onderhoudsgebeurtenissen genereren
- **Incidentpostmortems**: Automatisch uitgebreide incidentpostmortemrapporten opstellen
- **Codeverbeteringen**: Als u uw code-repository koppelt aan OneUptime, gebruiken we uw LLM Provider om telemetriegegevens (logs, traces, metrics, uitzonderingen) te analyseren en codeverbeteringen voor te stellen

## Gebruikers van OneUptime SaaS

Als u **OneUptime SaaS** (cloud-gehoste versie) gebruikt, kunt u standaard de **Globale LLM Provider** gebruiken zonder aanvullende configuratie. De Globale LLM Provider is vooraf geconfigureerd en klaar voor gebruik voor alle AI-functies.

Als u liever uw eigen API-sleutels of een specifieke provider gebruikt, kunt u nog steeds een aangepaste LLM Provider configureren aan de hand van de onderstaande instructies.

## Ondersteunde providers

OneUptime ondersteunt momenteel de volgende LLM-providers:

| Provider              | Beschrijving                                                              | API-sleutel vereist | Basis-URL vereist        |
| --------------------- | ------------------------------------------------------------------------- | ------------------- | ------------------------ |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo en andere OpenAI-modellen                    | Ja                  | Nee (gebruikt standaard) |
| **Azure OpenAI**      | OpenAI-modellen gehost op uw Azure-implementatie                          | Ja                  | Ja                       |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku en andere Claude-modellen  | Ja                  | Nee (gebruikt standaard) |
| **Groq**              | Snelle inferentie voor Llama, Mixtral en andere open modellen             | Ja                  | Nee (gebruikt standaard) |
| **Mistral**           | Door Mistral gehoste modellen                                             | Ja                  | Nee (gebruikt standaard) |
| **Ollama**            | Zelf-gehoste open-source modellen zoals Llama 2, Mistral, CodeLlama, enz. | Nee                 | Ja                       |
| **OpenAI Compatible** | Elke OpenAI-compatibele server (vLLM, LocalAI, LM Studio, enz.)           | Nee (optioneel)     | Ja                       |

## Een LLM Provider instellen

### Stap 1: Navigeer naar de instellingen van LLM Providers

1. Log in op uw OneUptime-dashboard
2. Ga naar **AI Agenten** > **LLM Providers**
3. Klik op **LLM Provider aanmaken** om een nieuwe provider toe te voegen

### Stap 2: Configureer uw provider

Vul de volgende velden in:

- **Naam**: Een beschrijvende naam voor deze LLM-configuratie (bijv. "Productie OpenAI", "Lokale Ollama")
- **Beschrijving** (optioneel): Een omschrijving om het doel van deze provider te identificeren
- **LLM Type**: Selecteer het providertype (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama of OpenAI Compatible)
- **API-sleutel**: Uw API-sleutel (vereist voor OpenAI, Azure OpenAI, Anthropic, Groq en Mistral; optioneel voor Ollama en OpenAI-compatibele servers)
- **Modelnaam**: Het specifieke te gebruiken model (bijv. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Basis-URL** (optioneel): Aangepaste API-eindpunt-URL (vereist voor Azure OpenAI, Ollama en OpenAI Compatible; optioneel voor anderen)

## Providerspecifieke configuratie

### OpenAI

1. Haal uw API-sleutel op van het [OpenAI Platform](https://platform.openai.com/api-keys)
2. Selecteer **OpenAI** als het LLM Type
3. Voer uw API-sleutel in
4. Kies een modelnaam:
   - `gpt-4o` - Meest capabele model, het beste voor complexe taken
   - `gpt-4o-mini` - Sneller en kosteneffectiever
   - `gpt-4-turbo` - Goede balans tussen capaciteit en snelheid
   - `gpt-3.5-turbo` - Snel en economisch

**Voorbeeldconfiguratie:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Haal uw API-sleutel op van de [Anthropic Console](https://console.anthropic.com/)
2. Selecteer **Anthropic** als het LLM Type
3. Voer uw API-sleutel in
4. Kies een modelnaam:
   - `claude-3-opus-20240229` - Meest capabele model
   - `claude-3-sonnet-20240229` - Goede balans tussen intelligentie en snelheid
   - `claude-3-haiku-20240307` - Snelst en meest compact
   - `claude-3-5-sonnet-20241022` - Nieuwste Sonnet-model

**Voorbeeldconfiguratie:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (Zelf-gehost)

Ollama stelt u in staat open-source LLM's lokaal of op uw eigen infrastructuur te draaien.

1. Installeer Ollama van [ollama.ai](https://ollama.ai)
2. Haal het gewenste model op: `ollama pull llama2`
3. Zorg dat Ollama actief en bereikbaar is
4. Selecteer **Ollama** als het LLM Type
5. Voer de Basis-URL in (bijv. `http://localhost:11434`)
6. Voer de modelnaam in die u hebt opgehaald

**Voorbeeldconfiguratie:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Populaire Ollama-modellen:**

- `llama2` - Meta's Llama 2-model
- `llama3` - Meta's Llama 3-model
- `mistral` - Mistral AI's model
- `codellama` - Op code gespecialiseerd Llama-model
- `mixtral` - Mistral's mixture-of-experts model

### OpenAI Compatible (vLLM, LocalAI, LM Studio, enz.)

Gebruik de **OpenAI Compatible**-provider voor elke server die de OpenAI `/chat/completions` API implementeert maar niet OpenAI zelf is — bijvoorbeeld [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) of text-generation-webui. Deze zijn doorgaans zelf-gehost op uw eigen URL en draaien vaak zonder authenticatie.

1. Start uw OpenAI-compatibele server en noteer de basis-URL (deze eindigt meestal op `/v1`)
2. Selecteer **OpenAI Compatible** als het LLM Type
3. Voer de **Basis-URL** in (vereist), bijv. `http://your-server:8000/v1`
4. Voer de **Modelnaam** in (vereist) — deze moet overeenkomen met een model dat uw server aanbiedt
5. Voer de **API-sleutel** alleen in als uw server dit vereist; laat deze leeg voor sleutelloze servers

**Voorbeeldconfiguratie (sleutelloze vLLM):**

```
Name: Self-Hosted vLLM
LLM Type: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tip: Gebruik na het opslaan de knop **Test** op de provider om te bevestigen dat de verbinding, modelnaam en basis-URL correct zijn.

### Zelf-gehoste vLLM op Kubernetes (Helm)

Als u OneUptime zelf host met de Helm-chart, kunt u [vLLM](https://docs.vllm.ai) — een OpenAI-compatibele inferentieserver — binnen uw cluster draaien en lokale modellen op uw eigen GPU's aanbieden. Er verlaat geen data uw infrastructuur.

1. Schakel het in uw Helm-waarden in (vereist NVIDIA GPU-nodes):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Voer `helm upgrade` uit en wacht tot de vLLM-pod Ready wordt (bij de eerste start wordt het model gedownload)
3. Dat is alles — vLLM wordt bij het opstarten automatisch geregistreerd als Globale LLM Provider (`vllm.globalProvider.enabled`, standaard `true`), zodat AI-functies voor alle projecten werken. Let op: project-gebonden AI Agenten kunnen geen globale providers gebruiken en hebben nog steeds een project-specifieke LLM Provider nodig.

Als u automatische registratie hebt uitgeschakeld (`vllm.globalProvider.enabled: false`), maak de provider dan handmatig aan:

1. Selecteer **OpenAI Compatible** als het LLM Type (vLLM spreekt de OpenAI API)
2. Voer de in-cluster Basis-URL in: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
3. Voer de Modelnaam in: het volledige HuggingFace-model-id (of `vllm.servedModelName` als u dat hebt ingesteld)
4. Voer de API-sleutel alleen in als u `vllm.apiKey` hebt ingesteld; laat deze leeg voor een sleutelloze vLLM

**Voorbeeldconfiguratie:**

```
Name: In-Cluster vLLM
LLM Type: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Zie de [Helm chart README](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm) voor GPU-planning, gated models en tuning-opties.

## Aangepaste Basis-URL's gebruiken

Voor enterprise-implementaties of bij gebruik van proxyservices kunt u een aangepaste Basis-URL opgeven:

- **Azure OpenAI**: Gebruik uw Azure-eindpunt-URL
- **OpenAI-compatibele API's**: Elke API die de OpenAI API-specificatie volgt
- **Privé Ollama-instanties**: De URL van uw interne Ollama-server

## Best practices

1. **Gebruik beschrijvende namen**: Benoem uw providers duidelijk (bijv. "Productie GPT-4", "Ontwikkeling Ollama")
2. **Beveilig uw API-sleutels**: API-sleutels worden versleuteld opgeslagen, maar deel ze nooit
3. **Test uw configuratie**: Controleer na het instellen of de provider werkt met AI-functies
4. **Houd het gebruik bij**: Volg het API-gebruik om kosten te beheren

## Probleemoplossing

### Verbindingsproblemen

- **OpenAI/Anthropic**: Controleer of uw API-sleutel geldig is en voldoende tegoed heeft
- **Ollama**: Zorg dat de Ollama-server actief is en dat de Basis-URL correct is
- **OpenAI Compatible**: Zorg dat de Basis-URL eindigt op `/v1` (of overeenkomt met uw server), dat de Modelnaam overeenkomt met een model dat uw server aanbiedt, en stel alleen een API-sleutel in als uw server dit vereist
- **Firewall**: Controleer of uw netwerk uitgaande verbindingen naar de API van de provider toestaat

### Model niet gevonden

- Controleer of de modelnaam correct is gespeld
- Zorg bij Ollama dat u het model hebt opgehaald met `ollama pull <model-name>`
- Controleer of het model beschikbaar is in uw regio (sommige modellen hebben regionale beperkingen)

## Hulp nodig?

Als u problemen ondervindt bij het instellen van uw LLM-provider:

1. Controleer de [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) voor bekende problemen
2. Neem contact op met ondersteuning als u een enterprise-abonnement heeft
