# LLM-leverantörer

En LLM-leverantör är modellen bakom varje AI-funktion i OneUptime: utredningar, Fråga AI, utkast och pull requests med åtgärder. Den här sidan visar vilken leverantör en funktion använder, hur du lägger till din egen (OpenAI, Azure OpenAI och Microsoft Foundry, Anthropic, Groq, Mistral, Ollama eller valfri OpenAI-kompatibel server) och hur du pekar OneUptime mot en modell som du kör själv.

:::cards
- [Vilken leverantör AI använder](#vilken-leverantör-ai-använder): Projektets standardleverantör, annars den globala.
- [Självhostat: utan konfiguration via miljövariabler](#självhostat-utan-konfiguration-via-miljövariabler): En leverantör för varje projekt, från serverns inställningar.
- [Konfigurera en LLM-leverantör](#konfigurera-en-llm-leverantör): Lägg till en leverantör i ett projekt och testa den.
- [Välja en bas-URL för en självhostad modell](#välja-en-bas-url-för-en-självhostad-modell): En adress som OneUptime-servern kan nå.
:::

## Vad en leverantör driver

- **Utredningar**: OneUptime AI utreder nya incidenter och larm och publicerar en grundorsaksanalys med källor på tidslinjen. Se [AI SRE](/docs/ai/ai-sre).
- **Frågor**: **Ask AI** svarar utifrån projektets data, med en källa för varje påstående. Se [Fråga AI](/docs/ai/ask-ai).
- **Utkast**: **Draft with AI** i anteckningarna för incidenter, larm och planerat underhåll, samt postmortems, skrivna på begäran eller när en incident löses.
- **Kod**: pull requests som åtgärdar undantag, långsamma spår och de orsaker som utredningar hittar, från OneUptime eller från GitHub. Se [Kod](/docs/ai/ai-agent).
- **Allt annat**: triage i AI Insights, AI-stegen i arbetsflöden och runbooks, och svar i Slack och Microsoft Teams.

## Vilken leverantör AI använder

AI-funktioner använder projektets standardleverantör. Ett projekt utan standardleverantör använder den globala leverantören, när det finns en. Fråga AI kan också byta en konversation till en annan av projektets leverantörer, eller till en global.

```mermaid title="Vilken leverantör en AI-funktion använder"
flowchart TB
    F["En AI-funktion<br/>behöver en modell"] --> D{"Har projektet<br/>en standard-<br/>leverantör?"}
    D -->|"ja"| P["Projektets<br/>standardleverantör"]
    D -->|"nej"| G{"Finns det<br/>en global<br/>leverantör?"}
    G -->|"ja"| GP["Den globala<br/>leverantören:<br/>AI-krediter på<br/>OneUptime Cloud"]
    G -->|"nej"| N["Inget körs, och<br/>AI-sidorna<br/>säger att<br/>en leverantör<br/>saknas"]
```

En leverantör är ett projekts standard när **Ange som standard** är påslaget, vilket det är för varje ny leverantör. Ett projekt där alla leverantörer har standard avslaget faller tillbaka på den globala leverantören, som om det inte hade någon.

Varje OneUptime AI-regel – AI-regler och regler för efteranalys – kan i stället välja en egen leverantör under **Fler fält**: en av projektets leverantörer eller en global, som används för allt som regeln startar. En regel som inte väljer någon använder standardleverantören, och en vald leverantör som inte längre kan användas faller tillbaka på den. Se [Vilken LLM-leverantör en regel använder](/docs/ai/ai-sre#vilken-llm-leverantör-en-regel-använder).

## OneUptime Cloud

På **OneUptime Cloud** kan varje projekt använda den globala leverantören utan någon konfiguration. Den är redo för varje AI-funktion och betalas med projektets AI-krediter.

Vill du i stället använda dina egna API-nycklar eller en viss modell lägger du till en egen leverantör enligt nedan: du debiteras inte för AI som körs på din egen leverantör.

Den globala LLM-leverantören betalas med projektets AI-krediter. För att begränsa vad AI får kosta varje dag anger du en **Daglig gräns för AI-kostnad (USD)** under **Projektinställningar → AI → AI Features → Fler inställningar**; en **Daglig AI-tokengräns** där begränsar tokens hos alla leverantörer, din egen inräknad. Se [projektets egna dagliga gränser](/docs/ai/ai-sre#projektets-egna-dagliga-gränser).

OneUptime Cloud kan bara nå LLM-slutpunkter på det publika internet. Det kan inte ansluta till en modell i ditt privata nätverk, till exempel en självhostad Ollama- eller vLLM-server. För att använda en modell som du kör själv självhostar du OneUptime i ett nätverk som kan nå den, eller exponerar modellen på en publik slutpunkt: se [Välja en bas-URL för en självhostad modell](#välja-en-bas-url-för-en-självhostad-modell).

## Självhostat: utan konfiguration via miljövariabler

På en självhostad instans är det snabbaste sättet att slå på AI för **alla projekt på en gång** att sätta miljövariablerna `GLOBAL_LLM_PROVIDER_*` på din OneUptime-server: i `config.env` för Docker Compose, eller via Helm-värden. Vid uppstart registrerar OneUptime en global LLM-leverantör från dem och håller den i takt; inget projekt behöver konfigurera något, och AI-åtgärdsuppgifter använder den också när ett projekt saknar egen leverantör.

| Variabel | Beskrivning |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Krävs för att slå på den. En av `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nyckeln: krävs för OpenAI, Azure OpenAI, Anthropic, Groq och Mistral; behövs inte för Ollama eller en OpenAI-kompatibel server utan nyckel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Slutpunkten: krävs för Azure OpenAI, Ollama och OpenAI-kompatibla servrar |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modellen som ska användas. Valfritt: utan den använder OneUptime leverantörens standardmodell och på en OpenAI-kompatibel server den första modellen i serverns lista |
| `GLOBAL_LLM_PROVIDER_NAME` | Ett valfritt visningsnamn som visas i instrumentpanelen |

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

Synkroniseringen är deklarativ: ändra en variabel så följer leverantören med vid nästa omstart; ta bort `GLOBAL_LLM_PROVIDER_TYPE` så tas leverantören bort. Globala leverantörer som skapats manuellt i Admin Dashboard rörs aldrig. Ett projekt kan fortfarande lägga till en egen leverantör under **Projektinställningar → AI → LLM-leverantörer**, och en leverantör som projektet äger går alltid först.

## Leverantörer som stöds

| Leverantör | Vad den är till för | API-nyckel krävs | Bas-URL krävs |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 och de andra OpenAI-modellerna | Ja | Nej (använder standardvärdet) |
| **Azure OpenAI / Microsoft Foundry** | Modeller som du distribuerar i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, Foundry Models och Claude | Ja | Ja |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 och de andra Claude-modellerna | Ja | Nej (använder standardvärdet) |
| **Groq** | Snabb inferens för Llama, Mixtral och andra öppna modeller | Ja | Nej (använder standardvärdet) |
| **Mistral** | Mistrals hostade modeller | Ja | Nej (använder standardvärdet) |
| **Ollama** | Modeller med öppen källkod som du kör själv, till exempel Llama 3.1, Mistral eller Qwen | Nej | Ja |
| **OpenAI Compatible** | Valfri OpenAI-kompatibel server: vLLM, LocalAI, LM Studio och andra | Nej (valfri) | Ja |

## Konfigurera en LLM-leverantör

:::steps
### Öppna LLM-leverantörer

Gå till **Projektinställningar → AI → LLM-leverantörer** (sidomenyns avsnitt **AI** är hopfällt från början) och klicka på **Skapa LLM-leverantör**.

### Välj leverantören

Under **Leverantör** väljer du din **LLM-leverantör**: ett kort för OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama och alla OpenAI-kompatibla servrar, vart och ett med en rad om vad det är.

### Anslut den

Under **Anslutning** frågar formuläret bara efter det som leverantören använder, med egen hjälp under varje fält:

- **API-nyckel**: din API-nyckel, krävs för OpenAI, Azure OpenAI, Anthropic, Groq och Mistral och valfri för en OpenAI-kompatibel server; för Ollama efterfrågas ingen
- **Bas-URL**: slutpunkten, krävs för Azure OpenAI, Ollama och OpenAI Compatible; för de andra bara för att gå via en proxy eller en gateway
- **Modellnamn**: modellen som ska användas, till exempel `gpt-5.1`, `claude-sonnet-5-5` eller `llama3.1`. Lämnas det tomt använder OneUptime leverantörens standardmodell; en OpenAI-kompatibel server har ingen, så OneUptime frågar den vilka modeller den tillhandahåller och använder den första i listan
- **Namn**: leverantörens namn tills du skriver ett eget, till exempel "Production OpenAI" eller "Local Ollama"
- **Fler fält**, hopfällt under fälten ovan: en **Beskrivning**, **Ange som standard**, som är påslaget för en ny leverantör eftersom AI-funktioner bara använder projektets standardleverantör, och **Ytterligare parametrar**, ett valfritt JSON-objekt med extra parametrar som skickas till leverantören med varje begäran (till exempel `{"temperature": 0.2}`)

**Vem som kan se en leverantör.** Ett projekts LLM-leverantörer läses bara av de medlemmar som får läsa projektets inställningar: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** och **Read LLM**. En leverantörs **API-nyckel** och **Ytterligare parametrar** läses bara av projektets ägare och administratörer, eftersom parametrarna skickas till leverantören med varje begäran och kan innehålla en token eller en header precis som nyckeln. De andra medlemmarna ser om det finns sparade parametrar, men inte vilka. Medlemmar som får redigera en leverantör kan fortfarande ersätta dess API-nyckel eller parametrar utan att läsa dem: i redigeringsformuläret är de fälten tomma från början, och ett fält som lämnas tomt behåller det sparade. För att ta bort parametrarna sparar du `{}`. Bara projektets ägare och administratörer kan ändra en leverantörs **Bas-URL**, eftersom dess API-nyckel och ytterligare parametrar skickas till den adressen; de andra medlemmarna som får redigera en leverantör kan ändra allt annat. Alla som kan läsa en leverantör kan läsa dess **Bas-URL**, så lägg aldrig en nyckel, en token eller ett lösenord i den: använd **API-nyckel**. Listan **Globala LLM-leverantörer** på samma sida, de delade leverantörer som ett projekt faller tillbaka på, visar deras namn, beskrivning och pris för alla som är inloggade, och inget annat om dem.

### Testa den

**Testa en leverantör.** **Testa**, på leverantörens sida eller i menyn på dess rad, skickar en kort prompt till leverantören med dess **API-nyckel**, **Modellnamn**, **Bas-URL** och **Ytterligare parametrar**, och säger om den svarade och anropade ett verktyg, vilket OneUptimes AI-funktioner behöver. Ett misslyckat test säger först vad du ska kontrollera och sedan vad leverantören svarade. Den som får ändra en leverantör kan testa den: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** och **Edit LLM**. Alla andra som kan se leverantören hittar **Testa** låst. En global LLM-leverantör testas av en serveradministratör, i Admin Dashboard under **Inställningar → Globala LLM-leverantörer**.
:::

## Leverantörsspecifik konfiguration

### OpenAI

1. Hämta din API-nyckel från [OpenAI Platform](https://platform.openai.com/api-keys)
2. Välj **OpenAI** som LLM-leverantör
3. Ange din API-nyckel
4. Välj ett modellnamn:
   - `gpt-5.1` - Rekommenderat standardval, stark på verktygsanrop och komplexa utredningar
   - `gpt-5.1-mini` - Snabbare och mer kostnadseffektiv

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Hämta din API-nyckel från [Anthropic Console](https://console.anthropic.com/)
2. Välj **Anthropic** som LLM-leverantör
3. Ange din API-nyckel
4. Välj ett modellnamn:
   - `claude-sonnet-5-5` - Rekommenderat standardval, den bästa balansen mellan intelligens, hastighet och kostnad
   - `claude-opus-5-5` - Mer kapabel, för de svåraste utredningarna
   - `claude-haiku-5-5` - Snabbast och mest kostnadseffektiv

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 och alla senare Claude-modeller väljer sin egen sampling och avvisar en begäran som sätter `temperature`, `top_p` eller `top_k`. OneUptime utelämnar de inställningarna för dessa modeller. Om en modell ändå avvisar någon av dem skickar OneUptime begäran igen utan den och kommer ihåg det för leverantören.

Claude 5-modeller tänker innan de svarar, och tänkandet räknas in i svarets tokengräns, så OneUptime lämnar utrymme för det. För att få dem att tänka mindre och svara snabbare och billigare sätter du `{"output_config": {"effort": "low"}}` i leverantörens **Ytterligare parametrar**. OneUptime skickar de inställningar du lägger till där till Anthropic med varje begäran, utom `model`, `messages`, `system`, `tools`, `tool_choice` och `stream`, som den sätter själv.

OneUptime använder Anthropics promptcachning. Varje anrop i en utredning eller ett svar från Fråga AI skickar systemprompten, verktygen och konversationen hittills igen, och OneUptime markerar dem för cachen: ett anrop betalar en tiondel av priset eller mindre för det som anropen före det skickade, och en fjärdedel mer än priset för det som är nytt, som det skriver till cachen. Om en gateway framför Claude avvisar cachemarkeringarna skickar OneUptime begäran igen utan dem och kommer ihåg det för leverantören. [Så räknas tokens](/docs/ai/ai-sre#så-räknas-tokens) förklarar hur tokens från cachen räknas mot dina gränser.

### Azure OpenAI och Microsoft Foundry

Använd **Azure OpenAI / Microsoft Foundry** för de modeller som du distribuerar i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, andra Foundry Models och Claude. Ange en av resursens nycklar som **API-nyckel**, distributionens namn som **Modellnamn** och resursens slutpunkt som **Bas-URL**, till exempel `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry och Azure OpenAI](/docs/ai/microsoft-foundry) går igenom Azure-sidan: resursen, behörigheter, modelldistributionen, nätverkskrav och felsökning.

### Ollama (självhostat)

Ollama kör modeller med öppen källkod på dina egna maskiner.

1. Installera Ollama från [ollama.ai](https://ollama.ai)
2. Hämta en modell: `ollama pull llama3.1`
3. Se till att Ollama körs och att OneUptime-servern kan nå den. En inbyggd installation lyssnar bara på `127.0.0.1`, så starta den med `OLLAMA_HOST=0.0.0.0:11434` för att ta emot anslutningar från andra maskiner och containrar (den officiella Docker-avbildningen `ollama/ollama` gör redan det)
4. Välj **Ollama** som LLM-leverantör
5. Ange bas-URL:en: Ollama-serverns adress så som OneUptime-servern når den, till exempel `http://ollama:11434` (OneUptime lägger själv till `/api/chat`). `localhost` fungerar inte: se [Välja en bas-URL för en självhostad modell](#välja-en-bas-url-för-en-självhostad-modell)
6. Ange namnet på modellen du hämtade

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Gör kontextfönstret större.** Om inget annat anges dimensionerar Ollama en modells kontextfönster efter det GPU-minne den hittar: 4k tokens under 24 GiB, 32k upp till 48 GiB och 256k över det (äldre versioner använder 2 048 eller 4 096 tokens). OneUptimes AI-funktioner är agenter. Varje begäran bär deras systemprompt och verktygsdefinitioner, mer än 10 000 tokens före någon fråga, och en AI-utredning lägger till varje frågeresultat i konversationen allteftersom. När en begäran inte längre får plats kastar Ollama de äldsta meddelandena, och frågan försvinner med dem. Beroende på modell och Ollama-version svarar modellen då utan frågan eller utan sina verktyg, eller så misslyckas begäran med "no user query found in messages" (Qwen 3.8 och senare) eller "the prompt is longer than the context length currently available to the model". OneUptime rapporterar de felen som "…the request is larger than the model's context window" och kör inte utredningen igen. Sätt en större `num_ctx` i leverantörens **Ytterligare parametrar**:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime slår ihop det här `options`-objektet med de alternativ den skickar till Ollama, så ange bara de inställningar du vill ändra. 65 536 tokens är vad Ollama rekommenderar för agenter, och det täcker de flesta utredningar. En lång utredning kan använda mer, eftersom OneUptime börjar korta gamla frågeresultat först när konversationen passerar ungefär 75 000 tokens: använd 131 072 om modellen stöder det och din GPU klarar det. Ett större kontextfönster kräver mer minne, och `ollama ps` visar den kontext varje inläst modell fick. För att i stället höja standardvärdet för alla klienter sätter du `OLLAMA_CONTEXT_LENGTH` på Ollama-servern. Det är det enda sättet när OneUptime når Ollama via dess OpenAI-kompatibla `/v1`-API (leverantören **OpenAI Compatible**), som ignorerar `num_ctx`. För en global leverantör som registrerats från `GLOBAL_LLM_PROVIDER_*`-variablerna sätter du **Ytterligare parametrar** i Admin Dashboard under **Inställningar → Globala LLM-leverantörer**; synkroniseringen vid uppstart lämnar det fältet i fred.

**Populära Ollama-modeller:**

- `llama3.1` - Metas Llama 3.1-modell, den äldsta Llama med stöd för verktygsanrop
- `llama3.3` - Metas Llama 3.3-modell
- `qwen2.5` - Alibabas Qwen 2.5-modell
- `mistral-nemo` - Mistral AI:s Nemo-modell

> [!NOTE]
> OneUptimes AI-funktioner är agenter: de lutar sig tungt mot verktygsanrop. Använd `llama3.1` eller nyare, eller en annan modell som anropar verktyg. En liten modell, eller en utan verktygsanrop (till exempel `llama2` eller den ursprungliga `llama3`), svarar dåligt: den kan inte fråga dina monitorer, incidenter eller din telemetri, så utredningar kommer tillbaka tomma eller påhittade.

### Välja en bas-URL för en självhostad modell

Bas-URL:en för en självhostad modell, oavsett om det är Ollama, vLLM, LM Studio eller någon annan OpenAI-kompatibel server, måste vara en adress som **OneUptime-servern** kan nå. Din webbläsare ansluter aldrig till den.

**Loopback-adresser avvisas alltid.** Innan den ansluter kontrollerar OneUptime varje adress som bas-URL:ens värdnamn slås upp till. `localhost`, `127.0.0.1`, `[::1]` och `0.0.0.0`, liksom link-local- och molnmetadataadresser som `169.254.169.254`, avvisas i alla installationer, även självhostade. Det är avsiktligt: en leverantörs bas-URL får inte kunna användas för att nå tjänster på själva OneUptime-servern. Inuti Docker Compose eller Kubernetes skulle `localhost` ändå vara OneUptime-containern, inte maskinen som kör din modell.

Använd i stället en privat adress eller ett internt värdnamn:

| Var modellservern körs | Bas-URL |
| --- | --- |
| En tjänst i OneUptimes Docker Compose-nätverk (`oneuptime`) | Tjänstens namn, t.ex. `http://ollama:11434` |
| Samma Kubernetes-kluster som OneUptime | Servicens DNS-namn, t.ex. `http://ollama.<namespace>.svc.cluster.local:11434`, samma mönster som den [medföljande vLLM](#självhostad-vllm-på-kubernetes-helm) |
| Själva värdmaskinen, utanför alla containrar | Värdens LAN-IP, t.ex. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` på Docker Desktop |
| En annan maskin i ditt nätverk | Dess privata IP eller interna värdnamn, t.ex. `http://10.0.0.12:11434` |

OpenAI-kompatibla servrar följer samma regler med sin egen port och `/v1`-sökväg, t.ex. `http://vllm:8000/v1`, eller `http://192.168.1.20:1234/v1` för LM Studio. Precis som en inbyggd Ollama-installation lyssnar LM Studio bara på `127.0.0.1` tills du slår på **Serve on Local Network** i dess serverinställningar.

**Privata adresser fungerar på självhostade installationer.** En självhostad OneUptime kan nå privata nätverksadresser, till exempel `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` och IPv6 `fc00::/7`, om du inte sätter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som avvisar dem på samma sätt som OneUptime Cloud. Den inställningen gäller inte för en global LLM-leverantör, som en administratör konfigurerar (med `GLOBAL_LLM_PROVIDER_*`-variablerna eller i Admin Dashboard) i stället för ett projekt: den kan fortfarande nå privata adresser. Loopback- och link-local-adresser förblir avvisade för alla leverantörer.

**OneUptime Cloud (SaaS) kan inte nå privata nätverk.** Det avvisar privata nätverksadresser, och värdnamn som slås upp till dem, för alla LLM-leverantörer. För att använda en modell som körs på din egen infrastruktur självhostar du antingen OneUptime i ett nätverk som kan nå den, eller exponerar modellen på en publikt nåbar slutpunkt. Skydda en publik slutpunkt med en API-nyckel: leverantören **Ollama** skickar inga inloggningsuppgifter, medan **OpenAI Compatible** skickar API-nyckeln som en bearer-token (Ollama tillhandahåller också ett OpenAI-kompatibelt API under `/v1`, så den kan stå bakom en omvänd proxy som kontrollerar nyckeln).

### OpenAI Compatible (vLLM, LocalAI, LM Studio m.fl.)

Använd leverantören **OpenAI Compatible** för alla servrar som implementerar OpenAI-API:t `/chat/completions` men inte är OpenAI självt, till exempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. De körs oftast på din egen adress, ofta utan autentisering.

1. Starta din OpenAI-kompatibla server och anteckna dess bas-URL (den slutar oftast på `/v1`)
2. Välj **OpenAI Compatible** som LLM-leverantör
3. Ange **Bas-URL** (krävs), t.ex. `http://your-server:8000/v1`. OneUptime-servern måste kunna nå den, alltså inte `localhost`: se [Välja en bas-URL för en självhostad modell](#välja-en-bas-url-för-en-självhostad-modell)
4. Ange **Modellnamn** eller lämna det tomt: då frågar OneUptime din server vilka modeller den tillhandahåller och använder den första i listan, vilket på vLLM är modellen den tillhandahåller. Ett namn du anger måste matcha en modell som din server tillhandahåller
5. Ange bara **API-nyckel** om din server ber om en; lämna den tom för en server utan nyckel

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Använd efter sparandet leverantörens **Testa** för att kontrollera anslutningen, modellnamnet och bas-URL:en.

### Självhostad vLLM på Kubernetes (Helm)

Om du självhostar OneUptime med Helm-chartet kan du köra [vLLM](https://docs.vllm.ai), en OpenAI-kompatibel inferensserver, i ditt kluster och tillhandahålla lokala modeller på dina egna GPU:er. Ingen data lämnar din infrastruktur.

1. Slå på det i dina Helm-värden (det kräver NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kör `helm upgrade` och vänta tills vLLM-podden är Ready (första starten laddar ned modellen)
3. Klart: vLLM registreras automatiskt som global LLM-leverantör vid uppstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funktioner fungerar för alla projekt, även AI-åtgärdsuppgifter. (Överallt, i molnet och självhostat, använder agentens åtgärdsuppgifter den globala leverantören när projektet inte äger någon egen leverantör; i molnet faktureras den användningen som uppmätta AI-tokens. En leverantör som projektet äger går alltid först.)

Om du har stängt av automatisk registrering (`vllm.globalProvider.enabled: false`) skapar du leverantören manuellt:

1. Välj **OpenAI Compatible** som LLM-leverantör (vLLM talar OpenAI-API:t)
2. Ange bas-URL:en inom klustret: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (ersätt `cluster.local` om du har ändrat `global.clusterDomain`)
3. Ange modellnamnet: det fullständiga Hugging Face-modell-id:t (eller `vllm.servedModelName` om du har satt ett), eller lämna det tomt för att använda modellen som vLLM tillhandahåller
4. Ange bara API-nyckeln om du har satt `vllm.apiKey`; lämna den tom för en vLLM utan nyckel

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Med fakturering påslagen, eller med `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` i Helm-värdena), kan ett projekts egen leverantör inte nå den här adressen inom klustret, som slås upp till en privat kluster-IP. Skapa i stället leverantören i Admin Dashboard under **Inställningar → Globala LLM-leverantörer**, med samma fält: en global LLM-leverantör kan nå den adressen.

Se [Helm-chartets vLLM-guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) för GPU-schemaläggning, åtkomstbegränsade modeller och justeringsalternativ.

## God praxis

- **Namnge leverantörer tydligt**, till exempel "Production OpenAI" eller "Development Ollama", så att en kollega vet vilken som är vilken.
- **Håll nycklar i fältet API-nyckel.** API-nycklar krypteras i vila, och bara projektets ägare och administratörer läser dem.
- **Testa efter varje ändring**, med leverantörens **Testa**.
- **Håll koll på vad AI kostar.** Varje anrop listas med sina tokens och sin kostnad under **Projektinställningar → AI → AI-loggar**.

## Felsökning

:::details Leverantören kan inte nås
- **OpenAI eller Anthropic**: kontrollera att din API-nyckel är giltig och har krediter
- **Azure OpenAI / Microsoft Foundry**: felet börjar med vad som ska ändras. [Microsoft Foundry och Azure OpenAI](/docs/ai/microsoft-foundry) förklarar varje fel som Azure svarar med
- **Ollama**: kontrollera att Ollama-servern körs, lyssnar på en adress som OneUptime-servern kan nå (`OLLAMA_HOST=0.0.0.0:11434` för en inbyggd installation) och att bas-URL:en pekar på den adressen
- **OpenAI Compatible**: kontrollera att bas-URL:en slutar på `/v1` (eller matchar din server), att modellnamnet, om du har angett ett, matchar en modell som din server tillhandahåller och att du bara har satt en API-nyckel om din server ber om en. Om modellnamnet är tomt och servern inte listar några modeller på sin `/models`-slutpunkt måste du ange ett
- **"…points to an address OneUptime is not allowed to connect to"**: bas-URL:en slås upp till en avvisad adress: `localhost` eller en annan loopback-adress, eller, på OneUptime Cloud, en privat nätverksadress. (OneUptime Cloud rapporterar i stället ett avvisat värdnamn som "…could not be reached".) Se [Välja en bas-URL för en självhostad modell](#välja-en-bas-url-för-en-självhostad-modell)
- **En brandvägg**: kontrollera att ditt nätverk tillåter utgående anslutningar till leverantörens API
:::

:::details Modellen hittas inte
Kontrollera stavningen av modellnamnet. För Ollama hämtar du först modellen med `ollama pull <model-name>`. Vissa modeller finns bara i vissa regioner.
:::

:::details Kontextfönstret är för litet
- **"…the request is larger than the model's context window"**: begäran fick inte plats i modellens kontextfönster, oftast för att en AI-utredning har samlat mycket bevis. Höj `num_ctx` i leverantörens **Ytterligare parametrar**, eller `OLLAMA_CONTEXT_LENGTH` på Ollama-servern; se [Ollama (självhostat)](#ollama-självhostat)
- **"no user query found in messages"**: samma problem, så som Qwen rapporterar det. OneUptime skickar alltid frågan; Ollama kastade den för att resten av begäran skulle få plats
:::

Sitter du fortfarande fast? Sök efter ditt fel bland [OneUptimes GitHub-issues](https://github.com/OneUptime/oneuptime/issues), eller kontakta supporten om din plan omfattar det.

## Nästa steg

:::cards
- [Kod](/docs/ai/ai-agent): Pull requests som din leverantör skriver, och var de startar.
- [AI SRE](/docs/ai/ai-sre): Vad OneUptime AI gör med leverantören när den har en.
- [Fråga AI](/docs/ai/ask-ai): Ställ en fråga till ditt projekt, och byt leverantör för en konversation.
:::
