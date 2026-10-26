# LLM-udbydere

En LLM-udbyder er modellen bag hver AI-funktion i OneUptime: undersøgelser, Spørg AI, udkast og pull requests med rettelser. Denne side viser, hvilken udbyder en funktion bruger, hvordan du tilføjer din egen (OpenAI, Azure OpenAI og Microsoft Foundry, Anthropic, Groq, Mistral, Ollama eller en hvilken som helst OpenAI-kompatibel server), og hvordan du peger OneUptime på en model, du selv kører.

:::cards
- [Hvilken udbyder AI bruger](#hvilken-udbyder-ai-bruger): Projektets standardudbyder, ellers den globale.
- [Selvhostet: uden konfiguration via miljøvariabler](#selvhostet-uden-konfiguration-via-miljøvariabler): Én udbyder til hvert projekt, fra serverens indstillinger.
- [Opsætning af en LLM-udbyder](#opsætning-af-en-llm-udbyder): Føj en udbyder til et projekt, og test den.
- [Valg af en basis-URL til en selvhostet model](#valg-af-en-basis-url-til-en-selvhostet-model): En adresse, som OneUptime-serveren kan nå.
:::

## Hvad en udbyder driver

- **Undersøgelser**: OneUptime AI undersøger nye hændelser og advarsler og slår en årsagsanalyse med kilder op på tidslinjen. Se [AI SRE](/docs/ai/ai-sre).
- **Spørgsmål**: **Ask AI** svarer ud fra dit projekts data, med en kilde til hver påstand. Se [Spørg AI](/docs/ai/ask-ai).
- **Udkast**: **Draft with AI** i noterne til hændelser, advarsler og planlagt vedligeholdelse samt postmortems, skrevet på forespørgsel eller når en hændelse løses.
- **Kode**: pull requests, der retter undtagelser, langsomme spor og de årsager, undersøgelser finder, fra OneUptime eller fra GitHub. Se [Kode](/docs/ai/ai-agent).
- **Alt andet**: triage i AI Insights, AI-trinene i workflows og runbooks samt svar i Slack og Microsoft Teams.

## Hvilken udbyder AI bruger

AI-funktioner bruger projektets standardudbyder. Et projekt uden standardudbyder bruger den globale udbyder, når der er en. Spørg AI kan også skifte en samtale til en anden af projektets udbydere eller til en global.

```mermaid title="Hvilken udbyder en AI-funktion bruger"
flowchart TB
    F["En AI-funktion<br/>har brug for en model"] --> D{"Har projektet<br/>en standard-<br/>udbyder?"}
    D -->|"ja"| P["Projektets<br/>standardudbyder"]
    D -->|"nej"| G{"Er der en global<br/>udbyder?"}
    G -->|"ja"| GP["Den globale udbyder:<br/>AI-kreditter på<br/>OneUptime Cloud"]
    G -->|"nej"| N["Intet kører, og<br/>AI-siderne siger,<br/>at en udbyder mangler"]
```

En udbyder er et projekts standard, når **Indstil som standard** er slået til, hvilket den er for hver ny udbyder. Et projekt, hvor alle udbydere har standard slået fra, falder tilbage på den globale udbyder, som om det ikke havde nogen.

Hver OneUptime AI-regel – AI-regler og postmortem-regler – kan i stedet vælge sin egen udbyder under **Flere felter**: en af projektets udbydere eller en global, som bruges til alt, hvad reglen starter. En regel, der ikke vælger nogen, bruger standardudbyderen, og en valgt udbyder, der ikke længere kan bruges, falder tilbage til den. Se [Hvilken LLM-udbyder en regel bruger](/docs/ai/ai-sre#hvilken-llm-udbyder-en-regel-bruger).

## OneUptime Cloud

På **OneUptime Cloud** kan hvert projekt bruge den globale udbyder uden opsætning. Den er klar til hver AI-funktion og betales af projektets AI-kreditter.

Vil du i stedet bruge dine egne API-nøgler eller en bestemt model, så tilføj en udbyder af din egen som beskrevet nedenfor: du betaler ikke for AI, der kører på din egen udbyder.

Den globale LLM-udbyder betales af projektets AI-kreditter. For at begrænse, hvad AI må bruge hver dag, sæt en **Daglig AI-forbrugsgrænse (USD)** under **Projektindstillinger → AI → AI Features → Yderligere indstillinger**; en **Daglig AI-tokengrænse** dér begrænser tokens hos enhver udbyder, også din egen. Se [projektets egne daglige grænser](/docs/ai/ai-sre#projektets-egne-daglige-grænser).

OneUptime Cloud kan kun nå LLM-endpoints på det offentlige internet. Den kan ikke forbinde til en model på dit private netværk, såsom en selvhostet Ollama- eller vLLM-server. For at bruge en model, du selv kører, så selvhost OneUptime på et netværk, der kan nå den, eller gør modellen tilgængelig på et offentligt endpoint: se [Valg af en basis-URL til en selvhostet model](#valg-af-en-basis-url-til-en-selvhostet-model).

## Selvhostet: uden konfiguration via miljøvariabler

På en selvhostet instans er den hurtigste måde at slå AI til for **alle projekter på én gang** at sætte miljøvariablerne `GLOBAL_LLM_PROVIDER_*` på din OneUptime-server: i `config.env` for Docker Compose eller gennem Helm-værdier. Ved opstart registrerer OneUptime en global LLM-udbyder ud fra dem og holder den opdateret; intet projekt skal sætte noget op, og AI-rettelsesopgaver bruger den også, når et projekt ikke har sin egen udbyder.

| Variabel | Beskrivelse |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Påkrævet for at slå den til. En af `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nøglen: påkrævet for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; ikke nødvendig for Ollama eller en OpenAI-kompatibel server uden nøgle |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Endpointet: påkrævet for Azure OpenAI, Ollama og OpenAI-kompatible servere |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modellen, der skal bruges. Valgfri: står den ikke sat, bruger OneUptime udbyderens standardmodel og på en OpenAI-kompatibel server den første model på serverens liste |
| `GLOBAL_LLM_PROVIDER_NAME` | Et valgfrit visningsnavn, der vises i dashboardet |

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

Synkroniseringen er deklarativ: ændr en variabel, og udbyderen følger med ved næste genstart; fjern `GLOBAL_LLM_PROVIDER_TYPE`, og udbyderen fjernes. Globale udbydere, der er oprettet manuelt i Admin Dashboard, røres aldrig. Et projekt kan stadig tilføje sin egen udbyder under **Projektindstillinger → AI → LLM-udbydere**, og en udbyder, som projektet ejer, går altid forud.

## Understøttede udbydere

| Udbyder | Hvad den bruges til | API-nøgle påkrævet | Basis-URL påkrævet |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 og de andre OpenAI-modeller | Ja | Nej (bruger standarden) |
| **Azure OpenAI / Microsoft Foundry** | Modeller, du udruller i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, Foundry Models og Claude | Ja | Ja |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 og de andre Claude-modeller | Ja | Nej (bruger standarden) |
| **Groq** | Hurtig inferens for Llama, Mixtral og andre åbne modeller | Ja | Nej (bruger standarden) |
| **Mistral** | Mistrals hostede modeller | Ja | Nej (bruger standarden) |
| **Ollama** | Open source-modeller, du selv kører, såsom Llama 3.1, Mistral eller Qwen | Nej | Ja |
| **OpenAI Compatible** | Enhver OpenAI-kompatibel server: vLLM, LocalAI, LM Studio og andre | Nej (valgfri) | Ja |

## Opsætning af en LLM-udbyder

:::steps
### Åbn LLM-udbydere

Gå til **Projektindstillinger → AI → LLM-udbydere** (sidemenuens afsnit **AI** starter sammenfoldet), og klik på **Opret LLM-udbyder**.

### Vælg udbyderen

Under **Udbyder** vælger du din **LLM-udbyder**: et kort for OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama og enhver OpenAI-kompatibel server, hvert med en linje om, hvad det er.

### Forbind den

Under **Forbindelse** spørger formularen kun om det, udbyderen bruger, med sin egen hjælp under hvert felt:

- **API-nøgle**: din API-nøgle, påkrævet for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral og valgfri for en OpenAI-kompatibel server; for Ollama bliver der ikke spurgt om en
- **Basis-URL**: endpointet, påkrævet for Azure OpenAI, Ollama og OpenAI Compatible; for de andre kun for at gå gennem en proxy eller en gateway
- **Modelnavn**: modellen, der skal bruges, såsom `gpt-5.1`, `claude-sonnet-5-5` eller `llama3.1`. Står det tomt, bruger OneUptime udbyderens standardmodel; en OpenAI-kompatibel server har ingen, så OneUptime spørger den, hvilke modeller den leverer, og bruger den første på listen
- **Navn**: udbyderens navn, indtil du skriver dit eget, såsom "Production OpenAI" eller "Local Ollama"
- **Flere felter**, foldet sammen under felterne ovenfor: en **Beskrivelse**, **Indstil som standard**, som er slået til for en ny udbyder, fordi AI-funktioner kun bruger projektets standardudbyder, og **Yderligere parametre**, et valgfrit JSON-objekt med ekstra parametre, der sendes til udbyderen med hver anmodning (for eksempel `{"temperature": 0.2}`)

**Hvem der kan se en udbyder.** Et projekts LLM-udbydere læses kun af de medlemmer, der må læse projektets indstillinger: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** og **Read LLM**. En udbyders **API-nøgle** og **Yderligere parametre** læses kun af projektets ejere og administratorer, fordi parametrene sendes til udbyderen med hver anmodning og kan indeholde et token eller en header ligesom nøglen. De andre medlemmer ser, om der er gemt parametre, men ikke hvilke. Medlemmer, der må redigere en udbyder, kan stadig erstatte dens API-nøgle eller parametre uden at læse dem: i redigeringsformularen starter de felter tomme, og et felt, der lades tomt, beholder det gemte. For at fjerne parametrene skal du gemme `{}`. Kun projektets ejere og administratorer kan ændre en udbyders **Basis-URL**, fordi dens API-nøgle og yderligere parametre sendes til den adresse; de andre medlemmer, der må redigere en udbyder, kan ændre alt andet. Alle, der kan læse en udbyder, kan læse dens **Basis-URL**, så læg aldrig en nøgle, et token eller en adgangskode i den: brug **API-nøgle**. Listen **Globale LLM-udbydere** på samme side, de fælles udbydere, som et projekt falder tilbage på, viser deres navn, beskrivelse og pris til alle, der er logget ind, og intet andet om dem.

### Test den

**Test af en udbyder.** **Test**, på udbyderens side eller i menuen i dens række, sender udbyderen en kort prompt med dens **API-nøgle**, **Modelnavn**, **Basis-URL** og **Yderligere parametre** og fortæller, om den svarede og kaldte et værktøj, hvilket OneUptimes AI-funktioner har brug for. En mislykket test siger først, hvad der skal kontrolleres, og derefter, hvad udbyderen svarede. Den, der må ændre en udbyder, kan teste den: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** og **Edit LLM**. Alle andre, der kan se udbyderen, finder **Test** låst. En global LLM-udbyder testes af en serveradministrator i Admin Dashboard under **Indstillinger → Globale LLM-udbydere**.
:::

## Udbyderspecifik konfiguration

### OpenAI

1. Hent din API-nøgle på [OpenAI Platform](https://platform.openai.com/api-keys)
2. Vælg **OpenAI** som LLM-udbyder
3. Indtast din API-nøgle
4. Vælg et modelnavn:
   - `gpt-5.1` - Anbefalet standard, stærk til værktøjskald og komplekse undersøgelser
   - `gpt-5.1-mini` - Hurtigere og billigere

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Hent din API-nøgle i [Anthropic Console](https://console.anthropic.com/)
2. Vælg **Anthropic** som LLM-udbyder
3. Indtast din API-nøgle
4. Vælg et modelnavn:
   - `claude-sonnet-5-5` - Anbefalet standard, den bedste balance mellem intelligens, hastighed og pris
   - `claude-opus-5-5` - Mere kapabel, til de sværeste undersøgelser
   - `claude-haiku-5-5` - Hurtigst og billigst

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 og alle senere Claude-modeller vælger selv deres sampling og afviser en anmodning, der sætter `temperature`, `top_p` eller `top_k`. OneUptime udelader de indstillinger for disse modeller. Hvis en model alligevel afviser en, sender OneUptime anmodningen igen uden den og husker det for udbyderen.

Claude 5-modeller tænker, før de svarer, og tænkningen tæller med i svarets tokengrænse, så OneUptime giver plads til den. For at få dem til at tænke mindre og svare hurtigere og billigere, sæt `{"output_config": {"effort": "low"}}` i udbyderens **Yderligere parametre**. OneUptime sender de indstillinger, du tilføjer dér, til Anthropic med hver anmodning, undtagen `model`, `messages`, `system`, `tools`, `tool_choice` og `stream`, som den selv sætter.

OneUptime bruger Anthropics prompt-caching. Hvert kald i en undersøgelse eller et svar fra Spørg AI sender systemprompten, værktøjerne og samtalen indtil nu igen, og OneUptime markerer dem til cachen: et kald betaler en tiendedel af prisen eller mindre for det, kaldene før det sendte, og en fjerdedel mere end prisen for det nye, som det skriver til cachen. Hvis en gateway foran Claude afviser cache-markeringerne, sender OneUptime anmodningen igen uden dem og husker det for udbyderen. [Sådan tælles tokens](/docs/ai/ai-sre#sådan-tælles-tokens) forklarer, hvordan tokens fra cachen tæller med i dine grænser.

### Azure OpenAI og Microsoft Foundry

Brug **Azure OpenAI / Microsoft Foundry** til de modeller, du udruller i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, andre Foundry Models og Claude. Indtast en af ressourcens nøgler som **API-nøgle**, udrulningens navn som **Modelnavn** og ressourcens endpoint som **Basis-URL**, såsom `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry og Azure OpenAI](/docs/ai/microsoft-foundry) gennemgår Azure-siden: ressourcen, tilladelser, modeludrulningen, netværkskrav og fejlfinding.

### Ollama (selvhostet)

Ollama kører open source-modeller på dine egne maskiner.

1. Installer Ollama fra [ollama.ai](https://ollama.ai)
2. Hent en model: `ollama pull llama3.1`
3. Sørg for, at Ollama kører, og at OneUptime-serveren kan nå den. En native installation lytter kun på `127.0.0.1`, så start den med `OLLAMA_HOST=0.0.0.0:11434` for at modtage forbindelser fra andre maskiner og containere (det officielle Docker-image `ollama/ollama` gør det allerede)
4. Vælg **Ollama** som LLM-udbyder
5. Indtast basis-URL'en: Ollama-serverens adresse, som OneUptime-serveren når den, såsom `http://ollama:11434` (OneUptime tilføjer selv `/api/chat`). `localhost` virker ikke: se [Valg af en basis-URL til en selvhostet model](#valg-af-en-basis-url-til-en-selvhostet-model)
6. Indtast navnet på den model, du hentede

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Gør kontekstvinduet større.** Medmindre andet er angivet, dimensionerer Ollama en models kontekstvindue efter den GPU-hukommelse, den finder: 4k tokens under 24 GiB, 32k op til 48 GiB og 256k derover (ældre versioner bruger 2.048 eller 4.096 tokens). OneUptimes AI-funktioner er agenter. Hver anmodning bærer deres systemprompt og værktøjsdefinitioner, mere end 10.000 tokens før noget spørgsmål, og en AI-undersøgelse føjer hvert forespørgselsresultat til samtalen undervejs. Når en anmodning ikke længere kan være der, smider Ollama de ældste beskeder væk, og spørgsmålet ryger med. Afhængigt af modellen og Ollama-versionen svarer modellen så uden spørgsmålet eller uden sine værktøjer, eller anmodningen mislykkes med "no user query found in messages" (Qwen 3.8 og senere) eller "the prompt is longer than the context length currently available to the model". OneUptime rapporterer de fejl som "…the request is larger than the model's context window" og kører ikke undersøgelsen igen. Sæt en større `num_ctx` i udbyderens **Yderligere parametre**:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime fletter dette `options`-objekt ind i de indstillinger, den sender til Ollama, så angiv kun de indstillinger, du vil ændre. 65.536 tokens er, hvad Ollama anbefaler til agenter, og det dækker de fleste undersøgelser. En lang undersøgelse kan bruge mere, fordi OneUptime først begynder at forkorte gamle forespørgselsresultater, når samtalen passerer cirka 75.000 tokens: brug 131.072, hvis modellen understøtter det, og din GPU kan rumme det. Et større kontekstvindue kræver mere hukommelse, og `ollama ps` viser den kontekst, hver indlæst model fik. For i stedet at hæve standarden for alle klienter, sæt `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren. Det er den eneste måde, når OneUptime når Ollama gennem dens OpenAI-kompatible `/v1`-API (udbyderen **OpenAI Compatible**), som ignorerer `num_ctx`. For en global udbyder, der er registreret ud fra `GLOBAL_LLM_PROVIDER_*`-variabler, sæt **Yderligere parametre** i Admin Dashboard under **Indstillinger → Globale LLM-udbydere**; synkroniseringen ved opstart lader det felt være.

**Populære Ollama-modeller:**

- `llama3.1` - Metas Llama 3.1-model, den ældste Llama med understøttelse af værktøjskald
- `llama3.3` - Metas Llama 3.3-model
- `qwen2.5` - Alibabas Qwen 2.5-model
- `mistral-nemo` - Mistral AI's Nemo-model

> [!NOTE]
> OneUptimes AI-funktioner er agenter: de læner sig tungt op ad værktøjskald. Brug `llama3.1` eller nyere eller en anden model, der kalder værktøjer. En lille model eller en uden værktøjskald (såsom `llama2` eller den oprindelige `llama3`) svarer dårligt: den kan ikke forespørge dine monitorer, hændelser eller telemetri, så undersøgelser kommer tomme eller opdigtede tilbage.

### Valg af en basis-URL til en selvhostet model

Basis-URL'en for en selvhostet model, hvad enten det er Ollama, vLLM, LM Studio eller en anden OpenAI-kompatibel server, skal være en adresse, som **OneUptime-serveren** kan nå. Din browser forbinder aldrig til den.

**Loopback-adresser afvises altid.** Før den forbinder, kontrollerer OneUptime hver adresse, som basis-URL'ens værtsnavn slås op til. `localhost`, `127.0.0.1`, `[::1]` og `0.0.0.0` samt link-local- og cloud-metadata-adresser som `169.254.169.254` afvises i alle installationer, også selvhostede. Det er med vilje: en udbyders basis-URL må ikke kunne bruges til at nå tjenester på selve OneUptime-serveren. Inde i Docker Compose eller Kubernetes ville `localhost` alligevel være OneUptime-containeren og ikke den maskine, der kører din model.

Brug i stedet en privat adresse eller et internt værtsnavn:

| Hvor modelserveren kører | Basis-URL |
| --- | --- |
| En tjeneste på OneUptimes Docker Compose-netværk (`oneuptime`) | Tjenestens navn, f.eks. `http://ollama:11434` |
| Den samme Kubernetes-klynge som OneUptime | Servicens DNS-navn, f.eks. `http://ollama.<namespace>.svc.cluster.local:11434`, samme mønster som den [medfølgende vLLM](#selvhostet-vllm-på-kubernetes-helm) |
| Selve værtsmaskinen, uden for enhver container | Værtens LAN-IP, f.eks. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` på Docker Desktop |
| En anden maskine på dit netværk | Dens private IP eller interne værtsnavn, f.eks. `http://10.0.0.12:11434` |

OpenAI-kompatible servere følger de samme regler med deres egen port og `/v1`-sti, f.eks. `http://vllm:8000/v1` eller `http://192.168.1.20:1234/v1` for LM Studio. Ligesom en native Ollama-installation lytter LM Studio kun på `127.0.0.1`, indtil du slår **Serve on Local Network** til i dens serverindstillinger.

**Private adresser virker på selvhostede installationer.** En selvhostet OneUptime kan nå private netværksadresser, såsom `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` og IPv6 `fc00::/7`, medmindre du sætter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som afviser dem, sådan som OneUptime Cloud gør. Den indstilling gælder ikke for en global LLM-udbyder, som en administrator konfigurerer (med `GLOBAL_LLM_PROVIDER_*`-variablerne eller i Admin Dashboard) i stedet for et projekt: den kan stadig nå private adresser. Loopback- og link-local-adresser forbliver afvist for alle udbydere.

**OneUptime Cloud (SaaS) kan ikke nå private netværk.** Den afviser private netværksadresser og værtsnavne, der slås op til dem, for alle LLM-udbydere. For at bruge en model, der kører på din egen infrastruktur, skal du enten selvhoste OneUptime på et netværk, der kan nå den, eller gøre modellen tilgængelig på et offentligt endpoint. Beskyt et offentligt endpoint med en API-nøgle: udbyderen **Ollama** sender ingen legitimationsoplysninger, mens **OpenAI Compatible** sender API-nøglen som et bearer-token (Ollama leverer også et OpenAI-kompatibelt API under `/v1`, så den kan stå bag en reverse proxy, der kontrollerer nøglen).

### OpenAI Compatible (vLLM, LocalAI, LM Studio osv.)

Brug udbyderen **OpenAI Compatible** til enhver server, der implementerer OpenAI-API'et `/chat/completions`, men ikke er OpenAI selv, for eksempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. De kører som regel på din egen adresse, ofte uden godkendelse.

1. Start din OpenAI-kompatible server, og notér dens basis-URL (den ender som regel på `/v1`)
2. Vælg **OpenAI Compatible** som LLM-udbyder
3. Indtast **Basis-URL** (påkrævet), f.eks. `http://your-server:8000/v1`. OneUptime-serveren skal kunne nå den, så ikke `localhost`: se [Valg af en basis-URL til en selvhostet model](#valg-af-en-basis-url-til-en-selvhostet-model)
4. Indtast **Modelnavn**, eller lad det stå tomt: så spørger OneUptime din server, hvilke modeller den leverer, og bruger den første på listen, hvilket på vLLM er den model, den leverer. Et navn, du indtaster, skal svare til en model, din server leverer
5. Indtast kun **API-nøgle**, hvis din server beder om en; lad den være tom for en server uden nøgle

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Brug efter gemning udbyderens **Test** til at kontrollere forbindelsen, modelnavnet og basis-URL'en.

### Selvhostet vLLM på Kubernetes (Helm)

Hvis du selvhoster OneUptime med Helm-chartet, kan du køre [vLLM](https://docs.vllm.ai), en OpenAI-kompatibel inferensserver, i din klynge og levere lokale modeller på dine egne GPU'er. Ingen data forlader din infrastruktur.

1. Slå det til i dine Helm-værdier (det kræver NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kør `helm upgrade`, og vent, til vLLM-pod'en er Ready (første start henter modellen)
3. Det var det: vLLM registreres automatisk som global LLM-udbyder ved opstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funktioner virker for alle projekter, også AI-rettelsesopgaver. (Overalt, både i skyen og selvhostet, bruger agentens rettelsesopgaver den globale udbyder, når projektet ikke ejer sin egen udbyder; i skyen faktureres det forbrug som målte AI-tokens. En udbyder, som projektet ejer, går altid forud.)

Hvis du slog automatisk registrering fra (`vllm.globalProvider.enabled: false`), skal du oprette udbyderen manuelt:

1. Vælg **OpenAI Compatible** som LLM-udbyder (vLLM taler OpenAI-API'et)
2. Indtast basis-URL'en i klyngen: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (erstat `cluster.local`, hvis du ændrede `global.clusterDomain`)
3. Indtast modelnavnet: det fulde Hugging Face-model-id (eller `vllm.servedModelName`, hvis du har sat et), eller lad det stå tomt for at bruge den model, vLLM leverer
4. Indtast kun API-nøglen, hvis du har sat `vllm.apiKey`; lad den være tom for en vLLM uden nøgle

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Med fakturering slået til eller med `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` i Helm-værdierne) kan et projekts egen udbyder ikke nå denne adresse i klyngen, som slås op til en privat klynge-IP. Opret i stedet udbyderen i Admin Dashboard under **Indstillinger → Globale LLM-udbydere** med de samme felter: en global LLM-udbyder kan nå den adresse.

Se [Helm-chartets vLLM-guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) om GPU-planlægning, adgangsbegrænsede modeller og tuningmuligheder.

## God praksis

- **Navngiv udbydere tydeligt**, såsom "Production OpenAI" eller "Development Ollama", så en kollega ved, hvilken der er hvilken.
- **Hold nøgler i feltet API-nøgle.** API-nøgler krypteres i hvile, og kun projektets ejere og administratorer læser dem.
- **Test efter hver ændring** med udbyderens **Test**.
- **Hold øje med, hvad AI koster.** Hvert kald står med sine tokens og sin pris under **Projektindstillinger → AI → AI-logs**.

## Fejlfinding

:::details Udbyderen kan ikke nås
- **OpenAI eller Anthropic**: kontrollér, at din API-nøgle er gyldig og har kredit
- **Azure OpenAI / Microsoft Foundry**: fejlen starter med, hvad der skal ændres. [Microsoft Foundry og Azure OpenAI](/docs/ai/microsoft-foundry) forklarer hver fejl, Azure svarer med
- **Ollama**: kontrollér, at Ollama-serveren kører, lytter på en adresse, som OneUptime-serveren kan nå (`OLLAMA_HOST=0.0.0.0:11434` for en native installation), og at basis-URL'en peger på den adresse
- **OpenAI Compatible**: kontrollér, at basis-URL'en ender på `/v1` (eller passer til din server), at modelnavnet, hvis du har indtastet et, svarer til en model, din server leverer, og at du kun har sat en API-nøgle, hvis din server beder om en. Står modelnavnet tomt, og viser serveren ingen modeller på sit `/models`-endepunkt, så indtast et
- **"…points to an address OneUptime is not allowed to connect to"**: basis-URL'en slås op til en afvist adresse: `localhost` eller en anden loopback-adresse eller, på OneUptime Cloud, en privat netværksadresse. (OneUptime Cloud rapporterer i stedet et afvist værtsnavn som "…could not be reached".) Se [Valg af en basis-URL til en selvhostet model](#valg-af-en-basis-url-til-en-selvhostet-model)
- **En firewall**: kontrollér, at dit netværk tillader udgående forbindelser til udbyderens API
:::

:::details Modellen findes ikke
Kontrollér stavningen af modelnavnet. For Ollama skal du først hente modellen med `ollama pull <model-name>`. Nogle modeller er kun tilgængelige i nogle regioner.
:::

:::details Kontekstvinduet er for lille
- **"…the request is larger than the model's context window"**: anmodningen kunne ikke være i modellens kontekstvindue, som regel fordi en AI-undersøgelse har samlet mange beviser. Hæv `num_ctx` i udbyderens **Yderligere parametre** eller `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren; se [Ollama (selvhostet)](#ollama-selvhostet)
- **"no user query found in messages"**: det samme problem, som Qwen rapporterer det. OneUptime sender altid spørgsmålet; Ollama smed det væk for at få resten af anmodningen til at passe
:::

Sidder du stadig fast? Søg efter din fejl i [OneUptimes GitHub-issues](https://github.com/OneUptime/oneuptime/issues), eller kontakt support, hvis din plan omfatter det.

## Næste trin

:::cards
- [Kode](/docs/ai/ai-agent): Pull requests, som din udbyder skriver, og hvor de starter.
- [AI SRE](/docs/ai/ai-sre): Hvad OneUptime AI gør med udbyderen, når den har en.
- [Spørg AI](/docs/ai/ask-ai): Stil dit projekt et spørgsmål, og skift en samtales udbyder.
:::
