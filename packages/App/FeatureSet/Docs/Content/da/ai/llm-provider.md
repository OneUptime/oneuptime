# LLM-udbydere

OneUptime understøtter integration med forskellige Large Language Model (LLM)-udbydere for at muliggøre AI-drevne funktioner på tværs af platformen. Denne guide hjælper dig med at konfigurere din egen LLM-udbyder.

## Hvad kan LLM-udbydere gøre?

LLM-udbydere i OneUptime hjælper dig med at automatisere og forbedre din incident management-arbejdsgang:

- **Incident-noter**: Generer automatisk detaljerede incident-noter og opdateringer
- **Alert-noter**: Opret meningsfulde alert-beskrivelser og kontekst
- **Notater om planlagt vedligeholdelse**: Generer noter til vedligeholdelsesbegivenheder automatisk
- **Incident-postmortems**: Udkast automatisk til omfattende incident-postmortem-rapporter
- **Kodeforbedringer**: Hvis du forbinder dit koderepository til OneUptime, bruger vi din LLM-udbyder til at analysere telemetridata (logs, traces, metrikker, undtagelser) og foreslå kodeforbedringer

## OneUptime SaaS-brugere

Hvis du bruger **OneUptime SaaS** (skyhosted version), kan du bruge den **Globale LLM-udbyder** som standard uden yderligere konfiguration. Den Globale LLM-udbyder er forudkonfigureret og klar til brug til alle AI-funktioner.

Hvis du foretrækker at bruge dine egne API-nøgler eller en bestemt udbyder, kan du stadig konfigurere en brugerdefineret LLM-udbyder ved at følge instruktionerne nedenfor.

OneUptime SaaS kan kun nå LLM-endpoints på det offentlige internet. Den kan ikke forbinde til en model på dit private netværk, f.eks. en selvhostet Ollama- eller vLLM-server. Hvis du vil bruge en model, du selv kører, skal du selvhoste OneUptime på et netværk, der kan nå den, eller gøre modellen tilgængelig på et offentligt endpoint — se [Valg af Basis-URL til en selvhostet model](#valg-af-basis-url-til-en-selvhostet-model).

## Selvhostet: opsætning kun med miljøvariabler

På en selvhostet instans er den hurtigste måde at aktivere AI-funktioner for **alle projekter på én gang** at sætte miljøvariablerne `GLOBAL_LLM_PROVIDER_*` på din OneUptime-server — i `config.env` for Docker Compose eller via Helm-værdier. Ved opstart registrerer OneUptime en Global LLM-udbyder ud fra dem (og holder den synkroniseret); der kræves ingen opsætning i dashboardet for hvert enkelt projekt, og AI-fejlrettelsesopgaver bruger den også, når et projekt ikke har sin egen udbyder.

| Variabel | Beskrivelse |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Påkrævet for at aktivere. En af: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nøgle — påkrævet for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; ikke nødvendig for Ollama eller OpenAI-kompatible servere uden nøgle |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API-endpoint — påkrævet for Azure OpenAI, Ollama og OpenAI-kompatible servere |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Den model, der skal bruges (påkrævet for OpenAI-kompatible servere, anbefalet for de øvrige) |
| `GLOBAL_LLM_PROVIDER_NAME` | Valgfrit brugervenligt navn, der vises i dashboardet |

**Eksempel: selvhostet Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# En adresse, som OneUptime-serveren kan nå. Aldrig localhost: se
# "Valg af Basis-URL til en selvhostet model" nedenfor.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Ingen API-nøgle nødvendig — Ollama bruger ingen nøgle.
```

**Eksempel: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

Synkroniseringen er deklarativ: Ændrer du variablerne, opdateres udbyderen ved næste genstart, og fjerner du `GLOBAL_LLM_PROVIDER_TYPE`, slettes den. Globale udbydere, der er oprettet manuelt i Admin Dashboard, røres aldrig. Projekter kan stadig tilføje deres egen udbyder under **Projektindstillinger** > **AI** > **LLM-udbydere** — en udbyder, som projektet selv ejer, har altid forrang for den globale.

## Understøttede udbydere

OneUptime understøtter i øjeblikket følgende LLM-udbydere:

| Udbyder               | Beskrivelse                                                             | API-nøgle påkrævet | Base URL påkrævet     |
| --------------------- | ----------------------------------------------------------------------- | ------------------ | --------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo og andre OpenAI-modeller                   | Ja                 | Nej (bruger standard) |
| **Azure OpenAI**      | OpenAI-modeller hostet på din Azure-deployment                          | Ja                 | Ja                    |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku og andre Claude-modeller | Ja                 | Nej (bruger standard) |
| **Groq**              | Hurtig inferens til Llama, Mixtral og andre åbne modeller               | Ja                 | Nej (bruger standard) |
| **Mistral**           | Mistrals hostede modeller                                               | Ja                 | Nej (bruger standard) |
| **Ollama**            | Selvhostede open source-modeller som Llama 2, Mistral, CodeLlama osv.   | Nej                | Ja                    |
| **OpenAI Compatible** | Enhver OpenAI-kompatibel server (vLLM, LocalAI, LM Studio osv.)         | Nej (valgfrit)     | Ja                    |

## Opsætning af en LLM-udbyder

### Trin 1: Naviger til LLM-udbyderindstillinger

1. Log ind på dit OneUptime-dashboard
2. Gå til **AI-agenter** > **LLM-udbydere**
3. Klik på **Opret LLM-udbyder** for at tilføje en ny udbyder

### Trin 2: Konfigurer din udbyder

Udfyld følgende felter:

- **Navn**: Et brugervenligt navn til denne LLM-konfiguration (f.eks. "Produktions-OpenAI", "Lokal Ollama")
- **Beskrivelse** (valgfrit): En beskrivelse til at identificere formålet med denne udbyder
- **LLM-type**: Vælg udbydertype (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama eller OpenAI Compatible)
- **API-nøgle**: Din API-nøgle (påkrævet for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; valgfrit for Ollama og OpenAI-kompatible servere)
- **Modelnavn**: Den specifikke model, der skal bruges (f.eks. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Basis-URL** (valgfrit): Brugerdefineret API-endpoint-URL (påkrævet for Azure OpenAI, Ollama og OpenAI Compatible; valgfrit for andre)

## Udbyderspecifik konfiguration

### OpenAI

1. Hent din API-nøgle fra [OpenAI Platform](https://platform.openai.com/api-keys)
2. Vælg **OpenAI** som LLM-type
3. Indtast din API-nøgle
4. Vælg et modelnavn:
   - `gpt-4o` – Mest kapabel model, bedst til komplekse opgaver
   - `gpt-4o-mini` – Hurtigere og mere omkostningseffektiv
   - `gpt-4-turbo` – God balance mellem kapacitet og hastighed
   - `gpt-3.5-turbo` – Hurtig og økonomisk

**Eksempelkonfiguration:**

```
Navn: Produktions-OpenAI
LLM-type: OpenAI
API-nøgle: sk-xxxxxxxxxxxxxxxxxxxx
Modelnavn: gpt-4o
```

### Anthropic

1. Hent din API-nøgle fra [Anthropic Console](https://console.anthropic.com/)
2. Vælg **Anthropic** som LLM-type
3. Indtast din API-nøgle
4. Vælg et modelnavn:
   - `claude-3-opus-20240229` – Mest kapabel model
   - `claude-3-sonnet-20240229` – God balance mellem intelligens og hastighed
   - `claude-3-haiku-20240307` – Hurtigste og mest kompakte
   - `claude-3-5-sonnet-20241022` – Seneste Sonnet-model

**Eksempelkonfiguration:**

```
Navn: Produktions-Anthropic
LLM-type: Anthropic
API-nøgle: sk-ant-xxxxxxxxxxxxxxxxxxxx
Modelnavn: claude-3-5-sonnet-20241022
```

### Ollama (selvhostet)

Ollama giver dig mulighed for at køre open source-LLM'er lokalt eller på din egen infrastruktur.

1. Installer Ollama fra [ollama.ai](https://ollama.ai)
2. Hent din ønskede model: `ollama pull llama3.1`
3. Sørg for, at Ollama kører og kan nås fra OneUptime-serveren. En native installation lytter kun på `127.0.0.1`, så start den med `OLLAMA_HOST=0.0.0.0:11434` for at tage imod forbindelser fra andre maskiner og containere (det officielle Docker-image `ollama/ollama` gør det allerede)
4. Vælg **Ollama** som LLM-type
5. Indtast Basis-URL: Ollama-serverens adresse, sådan som OneUptime-serveren når den, f.eks. `http://ollama:11434` (OneUptime tilføjer selv `/api/chat`). `localhost` virker ikke — se [Valg af Basis-URL til en selvhostet model](#valg-af-basis-url-til-en-selvhostet-model)
6. Indtast modelnavnet, du hentede

**Eksempelkonfiguration (Ollama som en tjeneste ved navn `ollama` på OneUptimes Docker Compose-netværk):**

```
Navn: Selvhostet Ollama
LLM-type: Ollama
Base URL: http://ollama:11434
Modelnavn: llama3.1
```

**Øg kontekstvinduet.** Medmindre andet er angivet, kører Ollama en model med et lille kontekstvindue (4096 tokens i nyere versioner, 2048 i ældre) og skærer stiltiende alt fra, der ikke er plads til. OneUptimes AI-funktioner sender deres værktøjsdefinitioner med hver forespørgsel, og de alene kan fylde flere tusinde tokens. Når de bliver skåret fra, kommer der ingen fejl: modellen svarer blot, at den ikke har noget værktøj til spørgsmålet. Angiv en større `num_ctx` i udbyderens **Yderligere parametre**:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime fletter dette `options`-objekt ind i de indstillinger, den sender til Ollama, så angiv kun de indstillinger, du vil ændre. Et større kontekstvindue kræver mere hukommelse, så vælg en størrelse, som din model understøtter, og som din hardware kan klare. Vil du i stedet hæve standarden for alle klienter, så sæt `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren. For en global udbyder, der registreres fra `GLOBAL_LLM_PROVIDER_*`-variabler, skal du udfylde feltet på udbyderen i Admin Dashboard under **Indstillinger** > **Globale LLM-udbydere**; synkroniseringen ved opstart rører ikke det felt.

**Populære Ollama-modeller:**

- `llama3.1` – Metas Llama 3.1-model, den ældste Llama med understøttelse af værktøjskald
- `llama3.3` – Metas Llama 3.3-model
- `qwen2.5` – Alibabas Qwen 2.5-model
- `mistral-nemo` – Mistral AIs Nemo-model

> Bemærk: OneUptimes AI-funktioner er agentiske — de er stærkt afhængige af værktøjskald. Brug `llama3.1` eller nyere (eller en anden model, der understøtter værktøjskald). Små modeller eller modeller uden understøttelse af værktøjskald (f.eks. `llama2` eller den oprindelige `llama3`) giver dårlige resultater: de kan ikke forespørge dine monitorer, hændelser eller telemetri, så undersøgelser kommer tomme eller opdigtede tilbage.

### Valg af Basis-URL til en selvhostet model

Basis-URL'en for en selvhostet model — Ollama, vLLM, LM Studio eller en anden OpenAI-kompatibel server — skal være en adresse, som **OneUptime-serveren** kan nå. Din browser forbinder aldrig til den.

**Loopback-adresser afvises altid.** Før OneUptime forbinder, kontrollerer den hver adresse, som Basis-URL'ens værtsnavn opløses til. `localhost`, `127.0.0.1`, `[::1]` og `0.0.0.0` samt link-local-adresser og cloud-metadata-adresser som `169.254.169.254` afvises i alle installationer, også selvhostede. Det er bevidst: en udbyders Basis-URL må ikke kunne bruges til at nå tjenester på selve OneUptime-serveren. Inde i Docker Compose eller Kubernetes ville `localhost` i øvrigt være OneUptime-containeren, ikke maskinen, der kører din model.

Brug i stedet en privat adresse eller et internt værtsnavn:

| Hvor modelserveren kører | Basis-URL |
| --- | --- |
| En tjeneste på OneUptimes Docker Compose-netværk (`oneuptime`) | Tjenestens navn, f.eks. `http://ollama:11434` |
| Samme Kubernetes-klynge som OneUptime | Servicens DNS-navn, f.eks. `http://ollama.<namespace>.svc.cluster.local:11434` — samme mønster som den [medfølgende vLLM](#selvhostet-vllm-på-kubernetes-helm) |
| Selve værtsmaskinen, uden for alle containere | Værtens LAN-IP, f.eks. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` på Docker Desktop |
| En anden maskine på dit netværk | Dens private IP eller interne værtsnavn, f.eks. `http://10.0.0.12:11434` |

OpenAI-kompatible servere følger de samme regler med deres egen port og `/v1`-sti, f.eks. `http://vllm:8000/v1` eller `http://192.168.1.20:1234/v1` for LM Studio. Ligesom en native Ollama-installation lytter LM Studio kun på `127.0.0.1`, indtil du slår **Serve on Local Network** til i dens serverindstillinger.

**Private adresser virker på selvhostede installationer.** En selvhostet OneUptime kan nå private netværksadresser, f.eks. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` og IPv6 `fc00::/7`, medmindre du sætter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som afviser dem på samme måde som OneUptime Cloud.

**OneUptime Cloud (SaaS) kan ikke nå private netværk.** Den afviser private netværksadresser, og værtsnavne, der opløses til dem, for alle LLM-udbydere. Hvis du vil bruge en model, der kører på din egen infrastruktur, skal du enten selvhoste OneUptime på et netværk, der kan nå den, eller gøre modellen tilgængelig på et offentligt tilgængeligt endpoint. Beskyt et offentligt endpoint med en API-nøgle: udbyderen **Ollama** sender ingen loginoplysninger, mens **OpenAI Compatible** sender API-nøglen som bearer-token (Ollama tilbyder også et OpenAI-kompatibelt API under `/v1`, så den kan stå bag en reverse proxy, der kontrollerer nøglen).

### OpenAI Compatible (vLLM, LocalAI, LM Studio osv.)

Brug udbyderen **OpenAI Compatible** til enhver server, der implementerer OpenAIs `/chat/completions`-API, men som ikke er OpenAI selv — for eksempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. Disse er typisk selvhostede på din egen URL og kører ofte uden autentificering.

1. Start din OpenAI-kompatible server, og notér dens base-URL (den slutter som regel med `/v1`)
2. Vælg **OpenAI Compatible** som LLM-type
3. Indtast **Basis-URL** (påkrævet), f.eks. `http://your-server:8000/v1`. Den skal kunne nås fra OneUptime-serveren, så ikke `localhost` — se [Valg af Basis-URL til en selvhostet model](#valg-af-basis-url-til-en-selvhostet-model)
4. Indtast **Modelnavn** (påkrævet) — det skal matche en model, som din server tilbyder
5. Indtast **API-nøgle** kun hvis din server kræver det; lad den stå tom for nøgleløse servere

**Eksempelkonfiguration (nøgleløs vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tip: Når du har gemt, kan du bruge knappen **Test** på udbyderen for at bekræfte, at forbindelse, modelnavn og base-URL er korrekte.

### Selvhostet vLLM på Kubernetes (Helm)

Hvis du selv-hoster OneUptime med Helm-charten, kan du køre [vLLM](https://docs.vllm.ai) — en OpenAI-kompatibel inferensserver — inde i din klynge og servere lokale modeller på dine egne GPU'er. Ingen data forlader din infrastruktur.

1. Aktivér det i dine Helm-værdier (kræver NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kør `helm upgrade`, og vent på, at vLLM-poden bliver Ready (den første start henter modellen)
3. Det er det — vLLM registreres automatisk som en Global LLM-udbyder ved opstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funktioner fungerer for alle projekter. Bemærk: projektspecifikke AI Agenter kan ikke bruge globale udbydere og skal stadig have en projektspecifik LLM-udbyder.

Hvis du har deaktiveret automatisk registrering (`vllm.globalProvider.enabled: false`), skal du oprette udbyderen manuelt:

1. Vælg **OpenAI Compatible** som LLM-type (vLLM taler OpenAI-API'et)
2. Indtast den klynge-interne Base URL: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (erstat `cluster.local`, hvis du har ændret `global.clusterDomain`)
3. Indtast Modelnavn: det fulde HuggingFace-model-id (eller `vllm.servedModelName`, hvis du har angivet et)
4. Indtast kun API-nøgle, hvis du har angivet `vllm.apiKey`; lad den stå tom for en nøgleløs vLLM

**Eksempelkonfiguration:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Se [Helm-chartens vLLM-guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) for GPU-scheduling, gated modeller og tuning-muligheder.

## Brug af brugerdefinerede Base URLs

Til enterprise-deployments eller ved brug af proxytjenester kan du angive en brugerdefineret Base URL:

- **Azure OpenAI**: Brug din Azure-endpoint-URL
- **OpenAI-kompatible API'er**: Enhver API, der følger OpenAIs API-specifikation
- **Private Ollama-instanser**: Din interne Ollama-servers URL

## Bedste praksis

1. **Brug beskrivende navne**: Navngiv dine udbydere tydeligt (f.eks. "Produktions-GPT-4", "Udviklings-Ollama")
2. **Sikr dine API-nøgler**: API-nøgler er krypteret i hvile, men undgå at dele dem
3. **Test din konfiguration**: Efter opsætning skal du bekræfte, at udbyderen fungerer med AI-funktioner
4. **Overvåg brugen**: Hold styr på API-brugen for at administrere omkostninger

## Fejlfinding

### Forbindelsesproblemer

- **OpenAI/Anthropic**: Bekræft, at din API-nøgle er gyldig og har tilstrækkelig kredit
- **Ollama**: Sørg for, at Ollama-serveren kører, lytter på en adresse, som OneUptime-serveren kan nå (`OLLAMA_HOST=0.0.0.0:11434` for en native installation), og at Basis-URL peger på den adresse
- **OpenAI Compatible**: Sørg for, at Base URL slutter med `/v1` (eller matcher din server), at Modelnavn matcher en model, som din server tilbyder, og angiv kun en API-nøgle, hvis din server kræver det
- **"…points to an address OneUptime is not allowed to connect to"**: Basis-URL opløses til en afvist adresse — `localhost` eller en anden loopback-adresse, eller på OneUptime Cloud en privat netværksadresse. (OneUptime Cloud melder i stedet et afvist værtsnavn som "…could not be reached".) Se [Valg af Basis-URL til en selvhostet model](#valg-af-basis-url-til-en-selvhostet-model)
- **Firewall**: Kontroller, at dit netværk tillader udgående forbindelser til udbyderens API

### Model ikke fundet

- Bekræft, at modelnavnet er stavet korrekt
- For Ollama, sørg for, at du har hentet modellen med `ollama pull <model-name>`
- Kontroller, om modellen er tilgængelig i din region (nogle modeller har regionale begrænsninger)

## Har du brug for hjælp?

Hvis du støder på problemer med at opsætte din LLM-udbyder:

1. Tjek [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kendte problemer
2. Kontakt support, hvis du er på en enterprise-plan
