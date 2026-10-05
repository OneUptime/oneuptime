# LLM-leverandører

OneUptime støtter integrasjon med ulike leverandører av store språkmodeller (LLM) for å aktivere AI-drevne funksjoner i hele plattformen. Denne veiledningen hjelper deg med å konfigurere din egen LLM-leverandør.

## Hva kan LLM-leverandører gjøre?

LLM-leverandører i OneUptime hjelper deg med å automatisere og forbedre arbeidsflyten for hendelseshåndtering:

- **Hendelsesnotater**: Generer automatisk detaljerte hendelsesnotater og oppdateringer
- **Varselnotater**: Opprett meningsfulle varselbeskrivelser og kontekst
- **Planlagt vedlikeholdsnotater**: Generer notater for vedlikeholdshendelser automatisk
- **Hendelsespostmortem**: Skriv automatisk utkast til omfattende postmortem-rapporter for hendelser
- **Kodeforbedringer**: Hvis du kobler kodelageret ditt til OneUptime, vil vi bruke LLM-leverandøren din til å analysere telemetridata (logger, spor, metrikker, unntak) og foreslå kodeforbedringer

## OneUptime SaaS-brukere

Hvis du bruker **OneUptime SaaS** (skybasert versjon), kan du bruke den **globale LLM-leverandøren** som standard uten ytterligere konfigurasjon. Den globale LLM-leverandøren er forhåndskonfigurert og klar til bruk for alle AI-funksjoner.

Hvis du foretrekker å bruke egne API-nøkler eller en spesifikk leverandør, kan du likevel konfigurere en egendefinert LLM-leverandør ved å følge instruksjonene nedenfor.

OneUptime SaaS kan bare nå LLM-endepunkter på det offentlige internettet. Den kan ikke koble til en modell på det private nettverket ditt, for eksempel en selvhostet Ollama- eller vLLM-server. For å bruke en modell du kjører selv, kan du selvhoste OneUptime på et nettverk som når den, eller eksponere modellen på et offentlig endepunkt — se [Velge basis-URL for en selvhostet modell](#velge-basis-url-for-en-selvhostet-modell).

## Selvhostet: oppsett med bare miljøvariabler

På en selvhostet instans er den raskeste måten å aktivere AI-funksjoner for **alle prosjekter på én gang** å angi miljøvariablene `GLOBAL_LLM_PROVIDER_*` på OneUptime-serveren din — i `config.env` for Docker Compose, eller via Helm-verdier. Ved oppstart registrerer OneUptime en global LLM-leverandør fra dem (og holder den synkronisert); du trenger ikke noe oppsett i dashbordet for hvert prosjekt, og AI-feilrettingsoppgaver bruker den også når et prosjekt ikke har sin egen leverandør.

| Variabel | Beskrivelse |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Påkrevd for å aktivere. Én av: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nøkkel — påkrevd for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; ikke nødvendig for Ollama eller OpenAI-kompatible servere uten nøkkel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API-endepunkt — påkrevd for Azure OpenAI, Ollama og OpenAI-kompatible servere |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modellen som skal brukes (påkrevd for OpenAI-kompatible servere, anbefalt ellers) |
| `GLOBAL_LLM_PROVIDER_NAME` | Valgfritt vennlig navn som vises i dashbordet |

**Eksempel: selvhostet Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# En adresse OneUptime-serveren kan nå. Aldri localhost: se
# "Velge basis-URL for en selvhostet modell" nedenfor.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Ingen API-nøkkel nødvendig — Ollama bruker ingen nøkkel.
```

**Eksempel: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

Synkroniseringen er deklarativ: Endrer du variablene, oppdateres leverandøren ved neste omstart, og fjerner du `GLOBAL_LLM_PROVIDER_TYPE`, slettes den. Globale leverandører som er opprettet manuelt i Admin Dashboard, blir aldri rørt. Prosjekter kan fortsatt legge til sin egen leverandør under **Prosjektinnstillinger** > **KI** > **LLM-leverandører** — en leverandør som prosjektet selv eier, har alltid forrang foran den globale.

## Støttede leverandører

OneUptime støtter for øyeblikket følgende LLM-leverandører:

| Leverandør            | Beskrivelse                                                              | API-nøkkel påkrevd | Basis-URL påkrevd     |
| --------------------- | ------------------------------------------------------------------------ | ------------------ | --------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo og andre OpenAI-modeller                    | Ja                 | Nei (bruker standard) |
| **Azure OpenAI**      | OpenAI-modeller hostet på din Azure-distribusjon                         | Ja                 | Ja                    |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku og andre Claude-modeller  | Ja                 | Nei (bruker standard) |
| **Groq**              | Rask inferens for Llama, Mixtral og andre åpne modeller                  | Ja                 | Nei (bruker standard) |
| **Mistral**           | Mistrals hostede modeller                                                | Ja                 | Nei (bruker standard) |
| **Ollama**            | Selvhostede åpen kildekode-modeller som Llama 2, Mistral, CodeLlama osv. | Nei                | Ja                    |
| **OpenAI-kompatibel** | Enhver OpenAI-kompatibel server (vLLM, LocalAI, LM Studio osv.)          | Nei (valgfritt)    | Ja                    |

## Konfigurere en LLM-leverandør

### Trinn 1: Naviger til innstillinger for LLM-leverandører

1. Logg inn på OneUptime-dashbordet ditt
2. Gå til **AI-agenter** > **LLM-leverandører**
3. Klikk **Opprett LLM-leverandør** for å legge til en ny leverandør

### Trinn 2: Konfigurer leverandøren din

Fyll inn følgende felt:

- **Navn**: Et vennlig navn for denne LLM-konfigurasjonen (f.eks. "Produksjon OpenAI", "Lokal Ollama")
- **Beskrivelse** (valgfritt): En beskrivelse som hjelper å identifisere formålet med denne leverandøren
- **LLM-leverandør**: Velg leverandørtype (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama eller OpenAI-kompatibel)
- **API-nøkkel**: API-nøkkelen din (påkrevd for OpenAI, Azure OpenAI, Anthropic, Groq og Mistral; valgfritt for Ollama og OpenAI-kompatible servere)
- **Modellnavn**: Den spesifikke modellen som skal brukes (f.eks. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Basis-URL** (valgfritt): Egendefinert API-endepunkt-URL (påkrevd for Azure OpenAI, Ollama og OpenAI-kompatibel; valgfritt for andre)
- **Flere felt**, slått sammen under feltene over: **Angi som standard**, som er slått på for en ny leverandør fordi AI-funksjoner bare bruker prosjektets standardleverandør, og **Ekstra parametere**, et valgfritt JSON-objekt med ekstra parametere som sendes til leverandøren med hver forespørsel (for eksempel `{"temperature": 0.2}`)

## Leverandørspesifikk konfigurasjon

### OpenAI

1. Hent API-nøkkelen din fra [OpenAI Platform](https://platform.openai.com/api-keys)
2. Velg **OpenAI** som LLM-leverandør
3. Skriv inn API-nøkkelen
4. Velg et modellnavn:
   - `gpt-4o` – Den mest kapable modellen, best for komplekse oppgaver
   - `gpt-4o-mini` – Raskere og mer kostnadseffektiv
   - `gpt-4-turbo` – God balanse mellom kapasitet og hastighet
   - `gpt-3.5-turbo` – Rask og økonomisk

**Eksempelkonfigurasjon:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Hent API-nøkkelen din fra [Anthropic Console](https://console.anthropic.com/)
2. Velg **Anthropic** som LLM-leverandør
3. Skriv inn API-nøkkelen
4. Velg et modellnavn:
   - `claude-3-opus-20240229` – Den mest kapable modellen
   - `claude-3-sonnet-20240229` – God balanse mellom intelligens og hastighet
   - `claude-3-haiku-20240307` – Raskest og mest kompakt
   - `claude-3-5-sonnet-20241022` – Nyeste Sonnet-modell

**Eksempelkonfigurasjon:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (selvhostet)

Ollama lar deg kjøre åpen kildekode-LLM-er lokalt eller på din egen infrastruktur.

1. Installer Ollama fra [ollama.ai](https://ollama.ai)
2. Hent ønsket modell: `ollama pull llama3.1`
3. Sørg for at Ollama kjører og kan nås fra OneUptime-serveren. En native installasjon lytter bare på `127.0.0.1`, så start den med `OLLAMA_HOST=0.0.0.0:11434` for å ta imot tilkoblinger fra andre maskiner og containere (det offisielle Docker-imaget `ollama/ollama` gjør dette allerede)
4. Velg **Ollama** som LLM-leverandør
5. Skriv inn basis-URL-en: adressen til Ollama-serveren slik OneUptime-serveren når den, f.eks. `http://ollama:11434` (OneUptime legger selv til `/api/chat`). `localhost` fungerer ikke — se [Velge basis-URL for en selvhostet modell](#velge-basis-url-for-en-selvhostet-modell)
6. Skriv inn modellnavnet du hentet

**Eksempelkonfigurasjon (Ollama som en tjeneste med navnet `ollama` på OneUptimes Docker Compose-nettverk):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Øk kontekstvinduet.** Med mindre annet er angitt, kjører Ollama en modell med et lite kontekstvindu (4096 tokens i nyere versjoner, 2048 i eldre) og kutter stille bort alt som ikke får plass. OneUptimes AI-funksjoner sender verktøydefinisjonene sine med hver forespørsel, og de alene kan utgjøre flere tusen tokens. Når de blir kuttet, kommer det ingen feil: modellen svarer bare at den ikke har noe verktøy for spørsmålet. Angi en større `num_ctx` i leverandørens **Ekstra parametere**:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime fletter dette `options`-objektet inn i alternativene det sender til Ollama, så oppgi bare innstillingene du vil endre. Et større kontekstvindu krever mer minne, så velg en størrelse modellen din støtter og maskinvaren din tåler. For heller å heve standardverdien for alle klienter, angir du `OLLAMA_CONTEXT_LENGTH` på Ollama-serveren. For en global leverandør som registreres fra `GLOBAL_LLM_PROVIDER_*`-variabler, angir du feltet i Admin Dashboard under **Innstillinger** > **Globale LLM-leverandører**; synkroniseringen ved oppstart rører ikke det feltet.

**Populære Ollama-modeller:**

- `llama3.1` – Metas Llama 3.1-modell, den eldste Llama-modellen med støtte for verktøykall
- `llama3.3` – Metas Llama 3.3-modell
- `qwen2.5` – Alibabas Qwen 2.5-modell
- `mistral-nemo` – Mistral AIs Nemo-modell

> Merk: OneUptimes AI-funksjoner er agentiske — de er sterkt avhengige av verktøykall. Bruk `llama3.1` eller nyere (eller en annen modell med støtte for verktøykall). Små modeller eller modeller uten støtte for verktøykall (f.eks. `llama2`, den opprinnelige `llama3`) gir dårlige resultater: de kan ikke spørre monitorene, hendelsene eller telemetrien din, så undersøkelser kommer tomme eller oppdiktede tilbake.

### Velge basis-URL for en selvhostet modell

Basis-URL-en til en selvhostet modell — Ollama, vLLM, LM Studio eller en annen OpenAI-kompatibel server — må være en adresse som **OneUptime-serveren** kan nå. Nettleseren din kobler aldri til den.

**Loopback-adresser avvises alltid.** Før OneUptime kobler til, sjekker den hver adresse som vertsnavnet i basis-URL-en løses opp til. `localhost`, `127.0.0.1`, `[::1]` og `0.0.0.0`, samt link-local-adresser og skymetadata-adresser som `169.254.169.254`, avvises i alle installasjoner, også selvhostede. Dette er med vilje: en leverandørs basis-URL skal ikke kunne brukes til å nå tjenester på selve OneUptime-serveren. Inne i Docker Compose eller Kubernetes ville `localhost` dessuten være OneUptime-containeren, ikke maskinen som kjører modellen din.

Bruk i stedet en privat adresse eller et internt vertsnavn:

| Hvor modellserveren kjører | Basis-URL |
| --- | --- |
| En tjeneste på OneUptimes Docker Compose-nettverk (`oneuptime`) | Tjenestenavnet, f.eks. `http://ollama:11434` |
| Samme Kubernetes-klynge som OneUptime | DNS-navnet til Service-en, f.eks. `http://ollama.<namespace>.svc.cluster.local:11434` — samme mønster som den [medfølgende vLLM-en](#selvhostet-vllm-på-kubernetes-helm) |
| Selve vertsmaskinen, utenfor alle containere | Vertens LAN-IP, f.eks. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` på Docker Desktop |
| En annen maskin på nettverket ditt | Dens private IP eller interne vertsnavn, f.eks. `http://10.0.0.12:11434` |

OpenAI-kompatible servere følger de samme reglene med sin egen port og `/v1`-sti, f.eks. `http://vllm:8000/v1`, eller `http://192.168.1.20:1234/v1` for LM Studio. I likhet med en native Ollama-installasjon lytter LM Studio bare på `127.0.0.1` til du slår på **Serve on Local Network** i serverinnstillingene.

**Private adresser fungerer på selvhostede installasjoner.** En selvhostet OneUptime kan nå private nettverksadresser, som `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` og IPv6 `fc00::/7`, med mindre du setter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som avviser dem slik OneUptime Cloud gjør.

**OneUptime Cloud (SaaS) kan ikke nå private nettverk.** Den avviser private nettverksadresser, og vertsnavn som løses opp til dem, for alle LLM-leverandører. For å bruke en modell som kjører på din egen infrastruktur, må du enten selvhoste OneUptime på et nettverk som når den, eller eksponere modellen på et offentlig tilgjengelig endepunkt. Beskytt et offentlig endepunkt med en API-nøkkel: leverandøren **Ollama** sender ingen påloggingsinformasjon, mens **OpenAI-kompatibel** sender API-nøkkelen som bearer-token (Ollama tilbyr også et OpenAI-kompatibelt API under `/v1`, så den kan stå bak en omvendt proxy som sjekker nøkkelen).

### OpenAI-kompatibel (vLLM, LocalAI, LM Studio osv.)

Bruk leverandøren **OpenAI-kompatibel** for enhver server som implementerer OpenAIs `/chat/completions`-API, men som ikke er OpenAI selv — for eksempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. Disse er som regel selvhostet på din egen URL og kjører ofte uten autentisering.

1. Start din OpenAI-kompatible server og noter basis-URL-en (den ender vanligvis på `/v1`)
2. Velg **OpenAI-kompatibel** som LLM-leverandør
3. Skriv inn **basis-URL-en** (påkrevd), f.eks. `http://your-server:8000/v1`. Den må kunne nås fra OneUptime-serveren, så ikke `localhost` — se [Velge basis-URL for en selvhostet modell](#velge-basis-url-for-en-selvhostet-modell)
4. Skriv inn **modellnavnet** (påkrevd) — det må samsvare med en modell serveren din eksponerer
5. Skriv inn **API-nøkkelen** bare hvis serveren din krever det; la den stå tom for serverne uten nøkkel

**Eksempelkonfigurasjon (vLLM uten nøkkel):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tips: Etter lagring kan du bruke **Test**-knappen på leverandøren for å bekrefte at tilkoblingen, modellnavnet og basis-URL-en er riktige.

### Selvhostet vLLM på Kubernetes (Helm)

Hvis du selvhoster OneUptime med Helm-chartet, kan du kjøre [vLLM](https://docs.vllm.ai) — en OpenAI-kompatibel inferensserver — inne i klyngen din og betjene lokale modeller på dine egne GPU-er. Ingen data forlater infrastrukturen din.

1. Aktiver det i Helm-verdiene dine (krever NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kjør `helm upgrade` og vent til vLLM-poden blir klar (den første oppstarten laster ned modellen)
3. Det er alt — vLLM registreres automatisk som en global LLM-leverandør ved oppstart (`vllm.globalProvider.enabled`, standard `true`), slik at AI-funksjoner fungerer for alle prosjekter. Merk: prosjektspesifikke AI-agenter kan ikke bruke globale leverandører og trenger fortsatt en prosjektspesifikk LLM-leverandør.

Hvis du deaktiverte automatisk registrering (`vllm.globalProvider.enabled: false`), opprett leverandøren manuelt:

1. Velg **OpenAI-kompatibel** som LLM-leverandør (vLLM snakker OpenAI-APIet)
2. Skriv inn basis-URL-en i klyngen: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (bytt ut `cluster.local` hvis du har endret `global.clusterDomain`)
3. Skriv inn modellnavnet: den fullstendige HuggingFace-modell-IDen (eller `vllm.servedModelName` hvis du satte en)
4. Skriv inn API-nøkkelen bare hvis du satte `vllm.apiKey`; la den stå tom for en vLLM uten nøkkel

**Eksempelkonfigurasjon:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Se [vLLM-veiledningen for Helm-chartet](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) for GPU-planlegging, sperrede modeller og justeringsalternativer.

## Bruke egendefinerte basis-URL-er

For bedriftsdistribusjoner eller ved bruk av proxytjenester kan du angi en egendefinert basis-URL:

- **Azure OpenAI**: Bruk Azure-endepunkt-URL-en din
- **OpenAI-kompatible API-er**: Alle API-er som følger OpenAIs API-spesifikasjon
- **Private Ollama-instanser**: URL-en til din interne Ollama-server

## Beste praksiser

1. **Bruk beskrivende navn**: Navngi leverandørene dine tydelig (f.eks. "Production GPT-4", "Development Ollama")
2. **Sikre API-nøklene dine**: API-nøkler er kryptert i hvile, men unngå å dele dem
3. **Test konfigurasjonen din**: Etter oppsett, verifiser at leverandøren fungerer med AI-funksjoner
4. **Overvåk bruk**: Hold oversikt over API-bruk for å styre kostnader

## Feilsøking

### Tilkoblingsproblemer

- **OpenAI/Anthropic**: Verifiser at API-nøkkelen er gyldig og har tilstrekkelige kreditter
- **Ollama**: Sørg for at Ollama-serveren kjører, lytter på en adresse som OneUptime-serveren kan nå (`OLLAMA_HOST=0.0.0.0:11434` for en native installasjon), og at basis-URL-en peker til den adressen
- **OpenAI-kompatibel**: Sørg for at basis-URL-en ender på `/v1` (eller samsvarer med serveren din), at modellnavnet samsvarer med en modell serveren din eksponerer, og angi kun en API-nøkkel hvis serveren din krever det
- **"…points to an address OneUptime is not allowed to connect to"**: basis-URL-en løses opp til en avvist adresse — `localhost` eller en annen loopback-adresse, eller på OneUptime Cloud en privat nettverksadresse. (OneUptime Cloud rapporterer i stedet et avvist vertsnavn som "…could not be reached".) Se [Velge basis-URL for en selvhostet modell](#velge-basis-url-for-en-selvhostet-modell)
- **Brannmur**: Kontroller at nettverket tillater utgående tilkoblinger til leverandørens API

### Modell ikke funnet

- Verifiser at modellnavnet er stavet korrekt
- For Ollama, sørg for at du har hentet modellen med `ollama pull <model-name>`
- Sjekk om modellen er tilgjengelig i din region (noen modeller har regionale begrensninger)

## Trenger du hjelp?

Hvis du støter på problemer med å konfigurere LLM-leverandøren din:

1. Sjekk [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kjente problemer
2. Kontakt support hvis du har en enterprise-plan
