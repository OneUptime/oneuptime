# LLM-leverantörer

OneUptime stöder integration med olika leverantörer av stora språkmodeller (LLM) för att möjliggöra AI-drivna funktioner på plattformen. Den här guiden hjälper dig att konfigurera din egen LLM-leverantör.

## Vad kan LLM-leverantörer göra?

LLM-leverantörer i OneUptime hjälper dig att automatisera och förbättra ditt arbetsflöde för incidenthantering:

- **Incidentanteckningar**: Generera automatiskt detaljerade incidentanteckningar och uppdateringar
- **Varningsanteckningar**: Skapa meningsfulla varningsbeskrivningar och sammanhang
- **Anteckningar för planerat underhåll**: Generera anteckningar för underhållshändelser automatiskt
- **Incidentpostmortem**: Skriv automatiskt ut omfattande incidentpostmortem-rapporter
- **Kodförbättringar**: Om du ansluter ditt kodrepositorie till OneUptime, använder vi din LLM-leverantör för att analysera telemetridata (loggar, spårningar, mätvärden, undantag) och föreslå kodförbättringar

## OneUptime SaaS-användare

Om du använder **OneUptime SaaS** (molnhanterad version) kan du använda den **globala LLM-leverantören** som standard utan någon ytterligare konfiguration. Den globala LLM-leverantören är förkonfigurerad och redo att använda för alla AI-funktioner.

Om du föredrar att använda dina egna API-nycklar eller en specifik leverantör, kan du fortfarande konfigurera en anpassad LLM-leverantör enligt instruktionerna nedan.

OneUptime SaaS kan bara nå LLM-slutpunkter på det öppna internet. Den kan inte ansluta till en modell i ditt privata nätverk, till exempel en egeninstallerad Ollama- eller vLLM-server. Om du vill använda en modell som du kör själv kan du installera OneUptime själv i ett nätverk som når den, eller exponera modellen på en offentlig slutpunkt — se [Välja Bas-URL för en egeninstallerad modell](#välja-bas-url-för-en-egeninstallerad-modell).

## Egeninstallerad: konfiguration med bara miljövariabler

På en egeninstallerad instans är det snabbaste sättet att aktivera AI-funktioner för **alla projekt på en gång** att ange miljövariablerna `GLOBAL_LLM_PROVIDER_*` på din OneUptime-server — i `config.env` för Docker Compose eller via Helm-värden. Vid start registrerar OneUptime en global LLM-leverantör utifrån dem (och håller den synkroniserad); ingen konfiguration i instrumentpanelen behövs för varje projekt, och AI-korrigeringsuppgifter använder den också när ett projekt saknar en egen leverantör.

| Variabel | Beskrivning |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Krävs för att aktivera. En av: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API-nyckel — krävs för OpenAI, Azure OpenAI, Anthropic, Groq och Mistral; behövs inte för Ollama eller OpenAI-kompatibla servrar utan nyckel |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API-slutpunkt — krävs för Azure OpenAI, Ollama och OpenAI-kompatibla servrar |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modell att använda (krävs för OpenAI-kompatibla servrar, rekommenderas annars) |
| `GLOBAL_LLM_PROVIDER_NAME` | Valfritt beskrivande namn som visas i instrumentpanelen |

**Exempel: egeninstallerad Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# En adress som OneUptime-servern kan nå. Aldrig localhost: se
# "Välja Bas-URL för en egeninstallerad modell" nedan.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Ingen API-nyckel behövs — Ollama används utan nyckel.
```

**Exempel: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

Synkroniseringen är deklarativ: ändrar du variablerna uppdateras leverantören vid nästa omstart, och tar du bort `GLOBAL_LLM_PROVIDER_TYPE` raderas den. Globala leverantörer som skapats manuellt i Admin Dashboard rörs aldrig. Projekt kan fortfarande lägga till en egen leverantör under **Projektinställningar** > **AI** > **LLM-leverantörer** — en leverantör som projektet själv äger har alltid företräde framför den globala.

## Leverantörer som stöds

OneUptime stöder för närvarande följande LLM-leverantörer:

| Leverantör            | Beskrivning                                                                | API-nyckel krävs | Bas-URL krävs           |
| --------------------- | -------------------------------------------------------------------------- | ---------------- | ----------------------- |
| **OpenAI**            | GPT-5.1 och andra OpenAI-modeller                                          | Ja               | Nej (använder standard) |
| **Azure OpenAI**      | OpenAI-modeller som är hostade i din Azure-driftsättning                   | Ja               | Ja                      |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5 och andra Claude-modeller | Ja               | Nej (använder standard) |
| **Groq**              | Snabb inferens för Llama, Mixtral och andra öppna modeller                 | Ja               | Nej (använder standard) |
| **Mistral**           | Mistrals hostade modeller                                                  | Ja               | Nej (använder standard) |
| **Ollama**            | Egeninstallerade öppen källkods-modeller som Llama 3.1, Mistral, Qwen etc. | Nej              | Ja                      |
| **OpenAI Compatible** | Valfri OpenAI-kompatibel server (vLLM, LocalAI, LM Studio etc.)            | Nej (valfritt)   | Ja                      |

## Konfigurera en LLM-leverantör

### Steg 1: Navigera till inställningar för LLM-leverantörer

1. Logga in på din OneUptime-instrumentpanel
2. Gå till **Projektinställningar** > **AI** > **LLM-leverantörer**
3. Klicka på **Skapa LLM-leverantör** för att lägga till en ny leverantör

### Steg 2: Konfigurera din leverantör

Fyll i följande fält:

- **Namn**: Ett beskrivande namn för denna LLM-konfiguration (t.ex. "Produktions-OpenAI", "Lokal Ollama")
- **Beskrivning** (valfritt): En beskrivning för att hjälpa till att identifiera syftet med denna leverantör
- **LLM-leverantör**: Välj leverantörstyp (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama eller OpenAI Compatible)
- **API-nyckel**: Din API-nyckel (krävs för OpenAI, Azure OpenAI, Anthropic, Groq och Mistral; valfritt för Ollama och OpenAI-kompatibla servrar)
- **Modellnamn**: Den specifika modell som ska användas (t.ex. `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **Bas-URL** (valfritt): Anpassad API-slutpunkts-URL (krävs för Azure OpenAI, Ollama och OpenAI Compatible; valfritt för andra)
- **Fler fält**, ihopfälld under fälten ovan: **Ange som standard**, som är påslaget för en ny leverantör eftersom AI-funktioner bara använder projektets standardleverantör, och **Ytterligare parametrar**, ett valfritt JSON-objekt med extra parametrar som skickas till leverantören med varje begäran (till exempel `{"temperature": 0.2}`)

## Leverantörsspecifik konfiguration

### OpenAI

1. Hämta din API-nyckel från [OpenAI Platform](https://platform.openai.com/api-keys)
2. Välj **OpenAI** som LLM-leverantör
3. Ange din API-nyckel
4. Välj ett modellnamn:
   - `gpt-5.1` – Rekommenderad standard, stark på verktygsanrop och komplexa utredningar
   - `gpt-5.1-mini` – Snabbare och mer kostnadseffektiv

**Exempelkonfiguration:**

```
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
   - `claude-sonnet-5` – Rekommenderad standard, bästa balansen mellan intelligens, hastighet och kostnad
   - `claude-opus-5` – Mest kapabel modell, för de svåraste utredningarna
   - `claude-haiku-4-5` – Snabbast och mest kostnadseffektiv

**Exempelkonfiguration:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5
```

### Ollama (egeninstallerad)

Ollama låter dig köra öppen källkods-LLM:er lokalt eller i din egen infrastruktur.

1. Installera Ollama från [ollama.ai](https://ollama.ai)
2. Hämta din önskade modell: `ollama pull llama3.1`
3. Se till att Ollama körs och kan nås från OneUptime-servern. En installation direkt på maskinen lyssnar bara på `127.0.0.1`, så starta den med `OLLAMA_HOST=0.0.0.0:11434` för att ta emot anslutningar från andra maskiner och containrar (den officiella Docker-avbildningen `ollama/ollama` gör redan det)
4. Välj **Ollama** som LLM-leverantör
5. Ange Bas-URL:en: Ollama-serverns adress så som OneUptime-servern når den, t.ex. `http://ollama:11434` (OneUptime lägger själv till `/api/chat`). `localhost` fungerar inte — se [Välja Bas-URL för en egeninstallerad modell](#välja-bas-url-för-en-egeninstallerad-modell)
6. Ange modellnamnet du hämtade

**Exempelkonfiguration (Ollama som en tjänst med namnet `ollama` i OneUptimes Docker Compose-nätverk):**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Öka kontextfönstret.** Om inget annat anges kör Ollama en modell med ett litet kontextfönster (4096 tokens i aktuella versioner, 2048 i äldre) och klipper tyst bort allt som inte får plats. OneUptimes AI-funktioner skickar sina verktygsdefinitioner med varje förfrågan, och enbart de kan uppta flera tusen tokens. När de klipps bort visas inget fel: modellen svarar bara att den inte har något verktyg för frågan. Ange ett större `num_ctx` i leverantörens **Ytterligare parametrar**:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime slår ihop det här `options`-objektet med de alternativ som skickas till Ollama, så ange bara de inställningar du vill ändra. Ett större kontextfönster kräver mer minne, så välj en storlek som din modell stöder och din hårdvara klarar. Vill du i stället höja standardvärdet för alla klienter anger du `OLLAMA_CONTEXT_LENGTH` på Ollama-servern. För en global leverantör som registreras från `GLOBAL_LLM_PROVIDER_*`-variabler anger du fältet i Admin Dashboard under **Inställningar** > **Globala LLM-leverantörer**; synkroniseringen vid start rör inte det fältet.

**Populära Ollama-modeller:**

- `llama3.1` – Metas Llama 3.1-modell, den äldsta Llama-modellen med stöd för verktygsanrop
- `llama3.3` – Metas Llama 3.3-modell
- `qwen2.5` – Alibabas Qwen 2.5-modell
- `mistral-nemo` – Mistral AI:s Nemo-modell

> Obs! OneUptimes AI-funktioner är agentiska — de förlitar sig i hög grad på verktygsanrop. Använd `llama3.1` eller senare (eller en annan modell med stöd för verktygsanrop). Små modeller eller modeller utan stöd för verktygsanrop (t.ex. `llama2`, den ursprungliga `llama3`) ger dåliga resultat: de kan inte fråga dina monitorer, incidenter eller din telemetri, så utredningar kommer tillbaka tomma eller påhittade.

### Välja Bas-URL för en egeninstallerad modell

Bas-URL:en för en egeninstallerad modell — Ollama, vLLM, LM Studio eller någon annan OpenAI-kompatibel server — måste vara en adress som **OneUptime-servern** kan nå. Din webbläsare ansluter aldrig till den.

**Loopback-adresser avvisas alltid.** Innan OneUptime ansluter kontrollerar den varje adress som värdnamnet i Bas-URL:en slås upp till. `localhost`, `127.0.0.1`, `[::1]` och `0.0.0.0`, liksom link-local-adresser och molnens metadataadresser som `169.254.169.254`, avvisas i alla installationer, även egeninstallerade. Det är avsiktligt: en leverantörs Bas-URL får inte kunna användas för att nå tjänster på själva OneUptime-servern. Inuti Docker Compose eller Kubernetes skulle `localhost` dessutom vara OneUptime-containern, inte maskinen som kör din modell.

Använd i stället en privat adress eller ett internt värdnamn:

| Var modellservern körs | Bas-URL |
| --- | --- |
| En tjänst i OneUptimes Docker Compose-nätverk (`oneuptime`) | Tjänstens namn, t.ex. `http://ollama:11434` |
| Samma Kubernetes-kluster som OneUptime | Servicens DNS-namn, t.ex. `http://ollama.<namespace>.svc.cluster.local:11434` — samma mönster som den [medföljande vLLM](#egeninstallerad-vllm-på-kubernetes-helm) |
| Själva värdmaskinen, utanför alla containrar | Värdens LAN-IP, t.ex. `http://192.168.1.20:11434`, eller `http://host.docker.internal:11434` i Docker Desktop |
| En annan maskin i ditt nätverk | Dess privata IP eller interna värdnamn, t.ex. `http://10.0.0.12:11434` |

OpenAI-kompatibla servrar följer samma regler med sin egen port och `/v1`-sökväg, t.ex. `http://vllm:8000/v1`, eller `http://192.168.1.20:1234/v1` för LM Studio. Precis som en Ollama-installation direkt på maskinen lyssnar LM Studio bara på `127.0.0.1` tills du slår på **Serve on Local Network** i dess serverinställningar.

**Privata adresser fungerar i egeninstallerade miljöer.** En egeninstallerad OneUptime kan nå privata nätverksadresser, till exempel `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` och IPv6 `fc00::/7`, såvida du inte sätter `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, som avvisar dem på samma sätt som OneUptime Cloud.

**OneUptime Cloud (SaaS) kan inte nå privata nätverk.** Den avvisar privata nätverksadresser, och värdnamn som slås upp till sådana, för alla LLM-leverantörer. För att använda en modell som körs i din egen infrastruktur kan du antingen installera OneUptime själv i ett nätverk som når den, eller exponera modellen på en offentligt nåbar slutpunkt. Skydda en offentlig slutpunkt med en API-nyckel: leverantören **Ollama** skickar inga inloggningsuppgifter, medan **OpenAI Compatible** skickar API-nyckeln som bearer-token (Ollama erbjuder också ett OpenAI-kompatibelt API under `/v1`, så det kan stå bakom en omvänd proxy som kontrollerar nyckeln).

### OpenAI Compatible (vLLM, LocalAI, LM Studio etc.)

Använd leverantören **OpenAI Compatible** för alla servrar som implementerar OpenAIs `/chat/completions`-API men som inte är OpenAI själva — till exempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. Dessa är vanligtvis egeninstallerade på din egen URL och körs ofta utan autentisering.

1. Starta din OpenAI-kompatibla server och notera dess bas-URL (den slutar oftast på `/v1`)
2. Välj **OpenAI Compatible** som LLM-leverantör
3. Ange **Bas-URL** (krävs), t.ex. `http://your-server:8000/v1`. Den måste kunna nås från OneUptime-servern, alltså inte `localhost` — se [Välja Bas-URL för en egeninstallerad modell](#välja-bas-url-för-en-egeninstallerad-modell)
4. Ange **Modellnamn** (krävs) — det måste matcha en modell som din server exponerar
5. Ange **API-nyckel** endast om din server kräver det; lämna fältet tomt för nyckelfria servrar

**Exempelkonfiguration (nyckelfri vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Tips: Efter att du sparat, använd knappen **Testa** på leverantören för att bekräfta att anslutningen, modellnamnet och bas-URL:en är korrekta.

### Egeninstallerad vLLM på Kubernetes (Helm)

Om du kör OneUptime själv med Helm-chartet kan du köra [vLLM](https://docs.vllm.ai) — en OpenAI-kompatibel inferensserver — i ditt kluster och betjäna lokala modeller på dina egna GPU:er. Ingen data lämnar din infrastruktur.

1. Aktivera det i dina Helm-värden (kräver NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kör `helm upgrade` och vänta tills vLLM-poden blir Ready (första starten laddar ner modellen)
3. Det är allt — vLLM registreras automatiskt som en global LLM-leverantör vid uppstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funktioner fungerar för alla projekt, även AI-korrigeringsuppgifter. (Överallt — i molnet och egeninstallerat — använder agentens korrigeringsuppgifter den globala leverantören när projektet inte äger en egen leverantör; i molnet faktureras den användningen som uppmätta AI-tokens. En leverantör som projektet själv äger har alltid företräde.)

Om du inaktiverade automatisk registrering (`vllm.globalProvider.enabled: false`) skapar du leverantören manuellt:

1. Välj **OpenAI Compatible** som LLM-leverantör (vLLM talar OpenAI-API:et)
2. Ange bas-URL:en i klustret: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (byt ut `cluster.local` om du har ändrat `global.clusterDomain`)
3. Ange modellnamnet: det fullständiga HuggingFace-modell-id:t (eller `vllm.servedModelName` om du angett ett sådant)
4. Ange API-nyckeln endast om du satt `vllm.apiKey`; lämna den tom för en nyckelfri vLLM

**Exempelkonfiguration:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Se [Helm-chartens vLLM-guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) för GPU-schemaläggning, spärrade modeller och inställningsalternativ.

## Använda anpassade Bas-URL:er

För företagsdistributioner eller när du använder proxytjänster kan du ange en anpassad Bas-URL:

- **Azure OpenAI**: Använd din Azure-slutpunkts-URL
- **OpenAI-kompatibla API:er**: Valfritt API som följer OpenAIs API-specifikation
- **Privata Ollama-instanser**: Din interna Ollama-servers URL

## Bästa praxis

1. **Använd beskrivande namn**: Namnge dina leverantörer tydligt (t.ex. "Produktion OpenAI", "Utveckling Ollama")
2. **Skydda dina API-nycklar**: API-nycklar krypteras i vila, men dela dem inte
3. **Testa din konfiguration**: Verifiera att leverantören fungerar med AI-funktioner efter konfiguration
4. **Övervaka användning**: Håll koll på API-användningen för att hantera kostnader

## Felsökning

### Anslutningsproblem

- **OpenAI/Anthropic**: Verifiera att din API-nyckel är giltig och har tillräckliga krediter
- **Ollama**: Se till att Ollama-servern körs, lyssnar på en adress som OneUptime-servern kan nå (`OLLAMA_HOST=0.0.0.0:11434` för en installation direkt på maskinen), och att Bas-URL:en pekar på den adressen
- **OpenAI Compatible**: Kontrollera att Bas-URL:en slutar på `/v1` (eller matchar din server), att Modellnamnet matchar en modell som din server exponerar, och ange endast en API-nyckel om din server kräver det
- **"…points to an address OneUptime is not allowed to connect to"**: Bas-URL:en slås upp till en avvisad adress — `localhost` eller en annan loopback-adress, eller i OneUptime Cloud en privat nätverksadress. (OneUptime Cloud rapporterar i stället ett avvisat värdnamn som "…could not be reached".) Se [Välja Bas-URL för en egeninstallerad modell](#välja-bas-url-för-en-egeninstallerad-modell)
- **Brandvägg**: Kontrollera att ditt nätverk tillåter utgående anslutningar till leverantörens API

### Modellen hittas inte

- Verifiera att modellnamnet är stavat korrekt
- För Ollama, se till att du har hämtat modellen med `ollama pull <model-name>`
- Kontrollera om modellen är tillgänglig i din region (vissa modeller har regionala begränsningar)

## Behöver du hjälp?

Om du stöter på problem med att konfigurera din LLM-leverantör:

1. Kontrollera [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) för kända problem
2. Kontakta supporten om du har en företagsplan
