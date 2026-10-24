# LLM-leverandører

En LLM-leverandør er modellen bak hver AI-funksjon i OneUptime: undersøkelser, Spør AI, utkast og pull requests med rettinger. Denne siden viser hvilken leverandør en funksjon bruker, hvordan du legger til din egen (OpenAI, Azure OpenAI og Microsoft Foundry, Anthropic, Groq, Mistral, Ollama eller en hvilken som helst OpenAI-kompatibel server) og hvordan du peker OneUptime mot en modell du kjører selv.

:::cards
- [Hvilken leverandør AI bruker](#hvilken-leverandør-ai-bruker): Prosjektets standardleverandør, ellers den globale.
- [Selvhostet: uten konfigurasjon via miljøvariabler](#selvhostet-uten-konfigurasjon-via-miljøvariabler): Én leverandør for hvert prosjekt, fra serverens innstillinger.
- [Sette opp en LLM-leverandør](#sette-opp-en-llm-leverandør): Legg til en leverandør i et prosjekt, og test den.
- [Velge en basis-URL for en selvhostet modell](#velge-en-basis-url-for-en-selvhostet-modell): En adresse som OneUptime-serveren kan nå.
:::

## Hva en leverandør driver

- **Undersøkelser**: OneUptime AI undersøker nye hendelser og varsler og legger ut en rotårsaksanalyse med kilder på tidslinjen. Se [AI SRE](/docs/ai/ai-sre).
- **Spørsmål**: **Ask AI** svarer ut fra dataene i prosjektet ditt, med en kilde for hver påstand. Se [Spør AI](/docs/ai/ask-ai).
- **Utkast**: **Draft with AI** i notatene til hendelser, varsler og planlagt vedlikehold, og postmortems, skrevet på forespørsel eller når en hendelse løses.
- **Kode**: pull requests som retter unntak, trege spor og årsakene undersøkelser finner, fra OneUptime eller fra GitHub. Se [Kode](/docs/ai/ai-agent).
- **Alt annet**: triage i AI Insights, AI-stegene i arbeidsflyter og runbooks, og svar i Slack og Microsoft Teams.

## Hvilken leverandør AI bruker

AI-funksjoner bruker prosjektets standardleverandør. Et prosjekt uten standardleverandør bruker den globale leverandøren, når det finnes en. Spør AI kan også bytte en samtale til en annen av prosjektets leverandører, eller til en global.

```mermaid title="Hvilken leverandør en AI-funksjon bruker"
flowchart TB
    F["En AI-funksjon<br/>trenger en modell"] --> D{"Har prosjektet<br/>en standard-<br/>leverandør?"}
    D -->|"ja"| P["Prosjektets<br/>standardleverandør"]
    D -->|"nei"| G{"Finnes det<br/>en global<br/>leverandør?"}
    G -->|"ja"| GP["Den globale<br/>leverandøren:<br/>AI-kreditter på<br/>OneUptime Cloud"]
    G -->|"nei"| N["Ingenting<br/>kjører, og<br/>AI-sidene sier at<br/>en leverandør<br/>mangler"]
```

En leverandør er et prosjekts standard når **Angi som standard** er slått på, noe den er for hver ny leverandør. Et prosjekt der alle leverandørene har standard slått av, faller tilbake på den globale leverandøren, som om det ikke hadde noen.

Hver OneUptime AI-regel – AI-regler og etteranalyseregler – kan i stedet velge sin egen leverandør under **Flere felt**: en av prosjektets leverandører eller en global, som brukes for alt regelen starter. En regel som ikke velger noen, bruker standardleverandøren, og en valgt leverandør som ikke lenger kan brukes, faller tilbake til den. Se [Hvilken LLM-leverandør en regel bruker](/docs/ai/ai-sre#hvilken-llm-leverandør-en-regel-bruker).

## OneUptime Cloud

På **OneUptime Cloud** kan hvert prosjekt bruke den globale leverandøren uten oppsett. Den er klar for hver AI-funksjon og betales fra prosjektets AI-kreditter.

Vil du heller bruke dine egne API-nøkler eller en bestemt modell, legger du til en egen leverandør som beskrevet nedenfor: du betaler ikke for AI som kjører på din egen leverandør.

Den globale LLM-leverandøren betales fra prosjektets AI-kreditter. For å begrense hva AI kan bruke hver dag, sett en **Daglig grense for AI-forbruk (USD)** under **Prosjektinnstillinger → KI → AI Features → Flere innstillinger**; en **Daglig AI-tokengrense** samme sted begrenser tokens hos alle leverandører, også din egen. Se [prosjektets egne daglige grenser](/docs/ai/ai-sre#prosjektets-egne-daglige-grenser).

OneUptime Cloud kan bare nå LLM-endepunkter på det offentlige internett. Det kan ikke koble til en modell på ditt private nettverk, for eksempel en selvhostet Ollama- eller vLLM-server. For å bruke en modell du kjører selv, selvhoster du OneUptime på et nettverk som kan nå den, eller gjør modellen tilgjengelig på et offentlig endepunkt: se [Velge en basis-URL for en selvhostet modell](#velge-en-basis-url-for-en-selvhostet-modell).

## Selvhostet: uten konfigurasjon via miljøvariabler

På en selvhostet instans er den raskeste måten å slå på AI for **alle prosjekter på én gang** å sette miljøvariablene `GLOBAL_LLM_PROVIDER_*` på OneUptime-serveren din: i `config.env` for Docker Compose, eller gjennom Helm-verdier. Ved oppstart registrerer OneUptime en global LLM-leverandør fra dem og holder den oppdatert; ingen prosjekter trenger å sette opp noe, og AI-rettingsoppgaver bruker den også når et prosjekt ikke har sin egen leverandør.

| Variabel | Beskrivelse |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Påkrevd for å slå den på. En av `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nøkkelen: påkrevd for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; ikke nødvendig for Ollama eller en OpenAI-kompatibel server uten nøkkel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Endepunktet: påkrevd for Azure OpenAI, Ollama og OpenAI-kompatible servere |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modellen som skal brukes: påkrevd for OpenAI-kompatible servere, anbefalt for de andre |
| `GLOBAL_LLM_PROVIDER_NAME` | Et valgfritt visningsnavn, vist i dashbordet |

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

Synkroniseringen er deklarativ: endre en variabel, så følger leverandøren med ved neste omstart; fjern `GLOBAL_LLM_PROVIDER_TYPE`, så fjernes leverandøren. Globale leverandører som er opprettet manuelt i Admin Dashboard, blir aldri rørt. Et prosjekt kan fortsatt legge til sin egen leverandør under **Prosjektinnstillinger → KI → LLM-leverandører**, og en leverandør som prosjektet eier, går alltid foran.

## Støttede leverandører

| Leverandør | Hva den er for | API-nøkkel påkrevd | Basis-URL påkrevd |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 og de andre OpenAI-modellene | Ja | Nei (bruker standarden) |
| **Azure OpenAI / Microsoft Foundry** | Modeller du ruller ut i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, Foundry Models og Claude | Ja | Ja |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 og de andre Claude-modellene | Ja | Nei (bruker standarden) |
| **Groq** | Rask inferens for Llama, Mixtral og andre åpne modeller | Ja | Nei (bruker standarden) |
| **Mistral** | Mistrals hostede modeller | Ja | Nei (bruker standarden) |
| **Ollama** | Modeller med åpen kildekode som du kjører selv, for eksempel Llama 3.1, Mistral eller Qwen | Nei | Ja |
| **OpenAI Compatible** | Enhver OpenAI-kompatibel server: vLLM, LocalAI, LM Studio og andre | Nei (valgfri) | Ja |

## Sette opp en LLM-leverandør

:::steps
### Åpne LLM-leverandører

Gå til **Prosjektinnstillinger → KI → LLM-leverandører** (sidemenyens del **KI** starter sammenslått), og klikk **Opprett LLM-leverandør**.

### Velg leverandøren

Under **Leverandør** velger du din **LLM-leverandør**: ett kort for OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama og enhver OpenAI-kompatibel server, hvert med en linje om hva det er.

### Koble den til

Under **Tilkobling** spør skjemaet bare om det leverandøren bruker, med egen hjelp under hvert felt:

- **API-nøkkel**: API-nøkkelen din, påkrevd for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral og valgfri for en OpenAI-kompatibel server; for Ollama blir det ikke spurt om noen
- **Basis-URL**: endepunktet, påkrevd for Azure OpenAI, Ollama og OpenAI Compatible; for de andre bare for å gå via en proxy eller en gateway
- **Modellnavn**: modellen som skal brukes, for eksempel `gpt-5.1`, `claude-sonnet-5-5` eller `llama3.1`. Står det tomt, bruker OneUptime leverandørens standardmodell, unntatt på en OpenAI-kompatibel server, som trenger en
- **Navn**: leverandørens navn til du skriver ditt eget, for eksempel "Production OpenAI" eller "Local Ollama"
- **Flere felt**, slått sammen under feltene over: en **Beskrivelse**, **Angi som standard**, som er på for en ny leverandør fordi AI-funksjoner bare bruker prosjektets standardleverandør, og **Ekstra parametere**, et valgfritt JSON-objekt med ekstra parametere som sendes til leverandøren med hver forespørsel (for eksempel `{"temperature": 0.2}`)

**Hvem som kan se en leverandør.** Et prosjekts LLM-leverandører leses bare av de medlemmene som kan lese prosjektets innstillinger: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** og **Read LLM**. En leverandørs **API-nøkkel** og **Ekstra parametere** leses bare av prosjektets eiere og administratorer, fordi parameterne sendes til leverandøren med hver forespørsel og kan inneholde et token eller en header akkurat som nøkkelen. De andre medlemmene ser om det er lagret parametere, men ikke hvilke. Medlemmer som kan redigere en leverandør, kan fortsatt erstatte API-nøkkelen eller parameterne uten å lese dem: i redigeringsskjemaet starter de feltene tomme, og et felt som står tomt, beholder det som er lagret. For å fjerne parameterne lagrer du `{}`. Bare prosjektets eiere og administratorer kan endre en leverandørs **Basis-URL**, fordi API-nøkkelen og de ekstra parameterne sendes til den adressen; de andre medlemmene som kan redigere en leverandør, kan endre alt annet. Alle som kan lese en leverandør, kan lese dens **Basis-URL**, så legg aldri en nøkkel, et token eller et passord i den: bruk **API-nøkkel**. Listen **Globale LLM-leverandører** på samme side, de delte leverandørene et prosjekt faller tilbake på, viser navn, beskrivelse og pris til alle som er logget inn, og ingenting annet om dem.

### Test den

**Teste en leverandør.** **Test**, på leverandørens side eller i menyen på raden, sender leverandøren en kort prompt med dens **API-nøkkel**, **Modellnavn**, **Basis-URL** og **Ekstra parametere**, og sier om den svarte og kalte et verktøy, noe OneUptimes AI-funksjoner trenger. En mislykket test sier først hva du bør sjekke, deretter hva leverandøren svarte. Den som kan endre en leverandør, kan teste den: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** og **Edit LLM**. Alle andre som kan se leverandøren, finner **Test** låst. En global LLM-leverandør testes av en serveradministrator, i Admin Dashboard under **Innstillinger → Globale LLM-leverandører**.
:::

## Leverandørspesifikk konfigurasjon

### OpenAI

1. Hent API-nøkkelen din fra [OpenAI Platform](https://platform.openai.com/api-keys)
2. Velg **OpenAI** som LLM-leverandør
3. Skriv inn API-nøkkelen din
4. Velg et modellnavn:
   - `gpt-5.1` - Anbefalt standard, sterk på verktøykall og komplekse undersøkelser
   - `gpt-5.1-mini` - Raskere og rimeligere

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Hent API-nøkkelen din fra [Anthropic Console](https://console.anthropic.com/)
2. Velg **Anthropic** som LLM-leverandør
3. Skriv inn API-nøkkelen din
4. Velg et modellnavn:
   - `claude-sonnet-5-5` - Anbefalt standard, den beste balansen mellom intelligens, hastighet og kostnad
   - `claude-opus-5-5` - Mer kapabel, for de vanskeligste undersøkelsene
   - `claude-haiku-5-5` - Raskest og rimeligst

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 og alle senere Claude-modeller velger sin egen sampling og avviser en forespørsel som setter `temperature`, `top_p` eller `top_k`. OneUptime utelater de innstillingene for disse modellene. Hvis en modell likevel avviser en av dem, sender OneUptime forespørselen på nytt uten den og husker det for leverandøren.

Claude 5-modeller tenker før de svarer, og tenkingen teller med i svarets tokengrense, så OneUptime gir plass til den. For å få dem til å tenke mindre og svare raskere og billigere, sett `{"output_config": {"effort": "low"}}` i leverandørens **Ekstra parametere**. OneUptime sender innstillingene du legger til der, til Anthropic med hver forespørsel, unntatt `model`, `messages`, `system`, `tools`, `tool_choice` og `stream`, som den setter selv.

OneUptime bruker prompt-cachingen til Anthropic. Hvert kall i en undersøkelse eller et svar fra Spør AI sender systemprompten, verktøyene og samtalen så langt på nytt, og OneUptime merker dem for cachen: et kall betaler en tidel av prisen eller mindre for det kallene før det sendte, og en fjerdedel mer enn prisen for det som er nytt, som det skriver til cachen. Hvis en gateway foran Claude avviser cache-merkene, sender OneUptime forespørselen på nytt uten dem og husker det for leverandøren. [Slik telles tokener](/docs/ai/ai-sre#slik-telles-tokener) forklarer hvordan tokener fra cachen teller mot grensene dine.

### Azure OpenAI og Microsoft Foundry

Bruk **Azure OpenAI / Microsoft Foundry** for modellene du ruller ut i Microsoft Foundry eller Azure OpenAI: OpenAI-modeller, andre Foundry Models og Claude. Skriv inn en av ressursens nøkler som **API-nøkkel**, utrullingens navn som **Modellnavn** og ressursens endepunkt som **Basis-URL**, for eksempel `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry og Azure OpenAI](/docs/ai/microsoft-foundry) går gjennom Azure-siden: ressursen, tillatelser, modellutrullingen, nettverkskrav og feilsøking.

### Ollama (selvhostet)

Ollama kjører modeller med åpen kildekode på dine egne maskiner.

1. Installer Ollama fra [ollama.ai](https://ollama.ai)
2. Hent en modell: `ollama pull llama3.1`
3. Sørg for at Ollama kjører og at OneUptime-serveren kan nå den. En native installasjon lytter bare på `127.0.0.1`, så start den med `OLLAMA_HOST=0.0.0.0:11434` for å ta imot tilkoblinger fra andre maskiner og containere (det offisielle Docker-imaget `ollama/ollama` gjør allerede dette)
4. Velg **Ollama** som LLM-leverandør
5. Skriv inn basis-URL-en: adressen til Ollama-serveren slik OneUptime-serveren når den, for eksempel `http://ollama:11434` (OneUptime legger selv til `/api/chat`). `localhost` fungerer ikke: se [Velge en basis-URL for en selvhostet modell](#velge-en-basis-url-for-en-selvhostet-modell)
6. Skriv inn navnet på modellen du hentet

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Gjør kontekstvinduet større.** Med mindre noe annet er angitt, dimensjonerer Ollama en modells kontekstvindu etter GPU-minnet den finner: 4k tokens under 24 GiB, 32k opptil 48 GiB og 256k over det (eldre versjoner bruker 2 048 eller 4 096 tokens). OneUptimes AI-funksjoner er agenter. Hver forespørsel bærer systemprompten og verktøydefinisjonene deres, mer enn 10 000 tokens før noe spørsmål, og en AI-undersøkelse legger hvert spørreresultat til samtalen underveis. Når en forespørsel ikke lenger får plass, kaster Ollama de eldste meldingene, og spørsmålet forsvinner med dem. Avhengig av modellen og Ollama-versjonen svarer modellen da uten spørsmålet eller uten verktøyene sine, eller forespørselen feiler med "no user query found in messages" (Qwen 3.8 og senere) eller "the prompt is longer than the context length currently available to the model". OneUptime rapporterer de feilene som "…the request is larger than the model's context window" og kjører ikke undersøkelsen på nytt. Sett en større `num_ctx` i leverandørens **Ekstra parametere**:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime slår dette `options`-objektet sammen med alternativene den sender til Ollama, så oppgi bare innstillingene du vil endre. 65 536 tokens er det Ollama anbefaler for agenter, og det dekker de fleste undersøkelser. En lang undersøkelse kan bruke mer, fordi OneUptime først begynner å forkorte gamle spørreresultater når samtalen passerer omtrent 75 000 tokens: bruk 131 072 hvis modellen støtter det og GPU-en din har plass til det. Et større kontekstvindu krever mer minne, og `ollama ps` viser konteksten hver lastet modell fikk. For heller å heve standarden for alle klienter, sett `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren. Det er den eneste måten når OneUptime når Ollama gjennom det OpenAI-kompatible `/v1`-API-et (leverandøren **OpenAI Compatible**), som ignorerer `num_ctx`. For en global leverandør som er registrert fra `GLOBAL_LLM_PROVIDER_*`-variablene, setter du **Ekstra parametere** i Admin Dashboard under **Innstillinger → Globale LLM-leverandører**; synkroniseringen ved oppstart lar det feltet være.

**Populære Ollama-modeller:**

- `llama3.1` - Metas Llama 3.1-modell, den eldste Llama med støtte for verktøykall
- `llama3.3` - Metas Llama 3.3-modell
- `qwen2.5` - Alibabas Qwen 2.5-modell
- `mistral-nemo` - Mistral AIs Nemo-modell

> [!NOTE]
> OneUptimes AI-funksjoner er agenter: de lener seg tungt på verktøykall. Bruk `llama3.1` eller nyere, eller en annen modell som kaller verktøy. En liten modell, eller en uten verktøykall (for eksempel `llama2` eller den opprinnelige `llama3`), svarer dårlig: den kan ikke spørre mot monitorene, hendelsene eller telemetrien din, så undersøkelser kommer tilbake tomme eller oppdiktede.

### Velge en basis-URL for en selvhostet modell

Basis-URL-en til en selvhostet modell, enten det er Ollama, vLLM, LM Studio eller en annen OpenAI-kompatibel server, må være en adresse som **OneUptime-serveren** kan nå. Nettleseren din kobler aldri til den.

**Loopback-adresser avvises alltid.** Før den kobler til, sjekker OneUptime hver adresse som vertsnavnet i basis-URL-en slås opp til. `localhost`, `127.0.0.1`, `[::1]` og `0.0.0.0`, samt link-local- og skymetadata-adresser som `169.254.169.254`, avvises i alle installasjoner, også selvhostede. Det er med vilje: en leverandørs basis-URL skal ikke kunne brukes til å nå tjenester på selve OneUptime-serveren. Inne i Docker Compose eller Kubernetes ville `localhost` uansett være OneUptime-containeren, ikke maskinen som kjører modellen din.

Bruk heller en privat adresse eller et internt vertsnavn:

| Hvor modellserveren kjører | Basis-URL |
| --- | --- |
| En tjeneste på OneUptimes Docker Compose-nettverk (`oneuptime`) | Tjenestenavnet, f.eks. `http://ollama:11434` |
| Den samme Kubernetes-klyngen som OneUptime | Servicens DNS-navn, f.eks. `http://ollama.<namespace>.svc.cluster.local:11434`, samme mønster som den [medfølgende vLLM](#selvhostet-vllm-på-kubernetes-helm) |
| Selve vertsmaskinen, utenfor enhver container | Vertens LAN-IP, f.eks. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` på Docker Desktop |
| En annen maskin på nettverket ditt | Dens private IP eller interne vertsnavn, f.eks. `http://10.0.0.12:11434` |

OpenAI-kompatible servere følger de samme reglene med sin egen port og `/v1`-sti, f.eks. `http://vllm:8000/v1`, eller `http://192.168.1.20:1234/v1` for LM Studio. Akkurat som en native Ollama-installasjon lytter LM Studio bare på `127.0.0.1` til du slår på **Serve on Local Network** i serverinnstillingene.

**Private adresser fungerer på selvhostede installasjoner.** En selvhostet OneUptime kan nå private nettverksadresser, for eksempel `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` og IPv6 `fc00::/7`, med mindre du setter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som avviser dem slik OneUptime Cloud gjør. Den innstillingen gjelder ikke for en global LLM-leverandør, som en administrator konfigurerer (med `GLOBAL_LLM_PROVIDER_*`-variablene eller i Admin Dashboard) i stedet for et prosjekt: den kan fortsatt nå private adresser. Loopback- og link-local-adresser forblir avvist for alle leverandører.

**OneUptime Cloud (SaaS) kan ikke nå private nettverk.** Det avviser private nettverksadresser, og vertsnavn som slås opp til dem, for alle LLM-leverandører. For å bruke en modell som kjører på din egen infrastruktur, selvhoster du enten OneUptime på et nettverk som kan nå den, eller gjør modellen tilgjengelig på et offentlig tilgjengelig endepunkt. Beskytt et offentlig endepunkt med en API-nøkkel: leverandøren **Ollama** sender ingen påloggingsdetaljer, mens **OpenAI Compatible** sender API-nøkkelen som et bearer-token (Ollama tilbyr også et OpenAI-kompatibelt API under `/v1`, så den kan stå bak en reverse proxy som sjekker nøkkelen).

### OpenAI Compatible (vLLM, LocalAI, LM Studio osv.)

Bruk leverandøren **OpenAI Compatible** for enhver server som implementerer OpenAI-API-et `/chat/completions`, men ikke er OpenAI selv, for eksempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. Disse kjører som regel på din egen adresse, ofte uten autentisering.

1. Start den OpenAI-kompatible serveren din og noter basis-URL-en (den slutter som regel på `/v1`)
2. Velg **OpenAI Compatible** som LLM-leverandør
3. Skriv inn **Basis-URL** (påkrevd), f.eks. `http://your-server:8000/v1`. OneUptime-serveren må kunne nå den, så ikke `localhost`: se [Velge en basis-URL for en selvhostet modell](#velge-en-basis-url-for-en-selvhostet-modell)
4. Skriv inn **Modellnavn** (påkrevd): det må samsvare med en modell serveren din leverer
5. Skriv bare inn **API-nøkkel** hvis serveren din ber om en; la den stå tom for en server uten nøkkel

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Bruk etter lagring leverandørens **Test** for å sjekke tilkoblingen, modellnavnet og basis-URL-en.

### Selvhostet vLLM på Kubernetes (Helm)

Hvis du selvhoster OneUptime med Helm-chartet, kan du kjøre [vLLM](https://docs.vllm.ai), en OpenAI-kompatibel inferensserver, i klyngen din og levere lokale modeller på dine egne GPU-er. Ingen data forlater infrastrukturen din.

1. Slå det på i Helm-verdiene dine (det krever NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kjør `helm upgrade` og vent til vLLM-poden er Ready (første oppstart laster ned modellen)
3. Det var det: vLLM registreres automatisk som global LLM-leverandør ved oppstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funksjoner virker for alle prosjekter, også AI-rettingsoppgaver. (Overalt, både i skyen og selvhostet, bruker agentens rettingsoppgaver den globale leverandøren når prosjektet ikke eier sin egen leverandør; i skyen faktureres den bruken som målte AI-tokens. En leverandør som prosjektet eier, går alltid foran.)

Hvis du slo av automatisk registrering (`vllm.globalProvider.enabled: false`), oppretter du leverandøren manuelt:

1. Velg **OpenAI Compatible** som LLM-leverandør (vLLM snakker OpenAI-API-et)
2. Skriv inn basis-URL-en i klyngen: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (erstatt `cluster.local` hvis du har endret `global.clusterDomain`)
3. Skriv inn modellnavnet: den fullstendige Hugging Face-modell-ID-en (eller `vllm.servedModelName` hvis du har satt en)
4. Skriv bare inn API-nøkkelen hvis du har satt `vllm.apiKey`; la den stå tom for en vLLM uten nøkkel

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Med fakturering slått på, eller med `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` i Helm-verdiene), kan et prosjekts egen leverandør ikke nå denne adressen i klyngen, som slås opp til en privat klynge-IP. Opprett i stedet leverandøren i Admin Dashboard under **Innstillinger → Globale LLM-leverandører**, med de samme feltene: en global LLM-leverandør kan nå den adressen.

Se [Helm-chartets vLLM-veiledning](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) for GPU-planlegging, modeller med begrenset tilgang og innstillingsmuligheter.

## God praksis

- **Gi leverandørene tydelige navn**, for eksempel "Production OpenAI" eller "Development Ollama", så en kollega vet hvilken som er hvilken.
- **Hold nøkler i feltet API-nøkkel.** API-nøkler krypteres ved lagring, og bare prosjektets eiere og administratorer leser dem.
- **Test etter hver endring**, med leverandørens **Test**.
- **Følg med på hva AI koster.** Hvert kall står med sine tokens og sin kostnad under **Prosjektinnstillinger → KI → AI-logger**.

## Feilsøking

:::details Leverandøren kan ikke nås
- **OpenAI eller Anthropic**: sjekk at API-nøkkelen din er gyldig og har kreditter
- **Azure OpenAI / Microsoft Foundry**: feilen starter med hva som må endres. [Microsoft Foundry og Azure OpenAI](/docs/ai/microsoft-foundry) forklarer hver feil Azure svarer med
- **Ollama**: sjekk at Ollama-serveren kjører, lytter på en adresse OneUptime-serveren kan nå (`OLLAMA_HOST=0.0.0.0:11434` for en native installasjon), og at basis-URL-en peker til den adressen
- **OpenAI Compatible**: sjekk at basis-URL-en slutter på `/v1` (eller passer til serveren din), at modellnavnet samsvarer med en modell serveren din leverer, og at du bare har satt en API-nøkkel hvis serveren din ber om en
- **"…points to an address OneUptime is not allowed to connect to"**: basis-URL-en slås opp til en avvist adresse: `localhost` eller en annen loopback-adresse, eller, på OneUptime Cloud, en privat nettverksadresse. (OneUptime Cloud rapporterer i stedet et avvist vertsnavn som "…could not be reached".) Se [Velge en basis-URL for en selvhostet modell](#velge-en-basis-url-for-en-selvhostet-modell)
- **En brannmur**: sjekk at nettverket ditt tillater utgående tilkoblinger til leverandørens API
:::

:::details Modellen blir ikke funnet
Sjekk stavemåten på modellnavnet. For Ollama henter du først modellen med `ollama pull <model-name>`. Noen modeller er bare tilgjengelige i noen regioner.
:::

:::details Kontekstvinduet er for lite
- **"…the request is larger than the model's context window"**: forespørselen fikk ikke plass i modellens kontekstvindu, som regel fordi en AI-undersøkelse har samlet mye bevis. Øk `num_ctx` i leverandørens **Ekstra parametere**, eller `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren; se [Ollama (selvhostet)](#ollama-selvhostet)
- **"no user query found in messages"**: det samme problemet, slik Qwen rapporterer det. OneUptime sender alltid spørsmålet; Ollama kastet det for at resten av forespørselen skulle få plass
:::

Står du fortsatt fast? Søk etter feilen din i [OneUptimes GitHub-issues](https://github.com/OneUptime/oneuptime/issues), eller kontakt support hvis planen din inkluderer det.

## Neste steg

:::cards
- [Kode](/docs/ai/ai-agent): Pull requests som leverandøren din skriver, og hvor de starter.
- [AI SRE](/docs/ai/ai-sre): Hva OneUptime AI gjør med leverandøren når den har en.
- [Spør AI](/docs/ai/ask-ai): Still prosjektet ditt et spørsmål, og bytt leverandør for en samtale.
:::
