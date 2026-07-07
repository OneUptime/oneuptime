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

## Leverantörer som stöds

OneUptime stöder för närvarande följande LLM-leverantörer:

| Leverantör            | Beskrivning                                                                   | API-nyckel krävs | Bas-URL krävs           |
| --------------------- | ----------------------------------------------------------------------------- | ---------------- | ----------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo och andra OpenAI-modeller                        | Ja               | Nej (använder standard) |
| **Azure OpenAI**      | OpenAI-modeller som är hostade i din Azure-driftsättning                      | Ja               | Ja                      |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku och andra Claude-modeller      | Ja               | Nej (använder standard) |
| **Groq**              | Snabb inferens för Llama, Mixtral och andra öppna modeller                    | Ja               | Nej (använder standard) |
| **Mistral**           | Mistrals hostade modeller                                                     | Ja               | Nej (använder standard) |
| **Ollama**            | Egeninstallerade öppen källkods-modeller som Llama 2, Mistral, CodeLlama etc. | Nej              | Ja                      |
| **OpenAI Compatible** | Valfri OpenAI-kompatibel server (vLLM, LocalAI, LM Studio etc.)               | Nej (valfritt)   | Ja                      |

## Konfigurera en LLM-leverantör

### Steg 1: Navigera till inställningar för LLM-leverantörer

1. Logga in på din OneUptime-instrumentpanel
2. Gå till **AI-agenter** > **LLM-leverantörer**
3. Klicka på **Skapa LLM-leverantör** för att lägga till en ny leverantör

### Steg 2: Konfigurera din leverantör

Fyll i följande fält:

- **Namn**: Ett beskrivande namn för denna LLM-konfiguration (t.ex. "Produktions-OpenAI", "Lokal Ollama")
- **Beskrivning** (valfritt): En beskrivning för att hjälpa till att identifiera syftet med denna leverantör
- **LLM-typ**: Välj leverantörstyp (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama eller OpenAI Compatible)
- **API-nyckel**: Din API-nyckel (krävs för OpenAI, Azure OpenAI, Anthropic, Groq och Mistral; valfritt för Ollama och OpenAI-kompatibla servrar)
- **Modellnamn**: Den specifika modell som ska användas (t.ex. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Bas-URL** (valfritt): Anpassad API-slutpunkts-URL (krävs för Azure OpenAI, Ollama och OpenAI Compatible; valfritt för andra)

## Leverantörsspecifik konfiguration

### OpenAI

1. Hämta din API-nyckel från [OpenAI Platform](https://platform.openai.com/api-keys)
2. Välj **OpenAI** som LLM-typ
3. Ange din API-nyckel
4. Välj ett modellnamn:
   - `gpt-4o` – Mest kapabel modell, bäst för komplexa uppgifter
   - `gpt-4o-mini` – Snabbare och mer kostnadseffektiv
   - `gpt-4-turbo` – Bra balans mellan kapacitet och hastighet
   - `gpt-3.5-turbo` – Snabb och ekonomisk

**Exempelkonfiguration:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Hämta din API-nyckel från [Anthropic Console](https://console.anthropic.com/)
2. Välj **Anthropic** som LLM-typ
3. Ange din API-nyckel
4. Välj ett modellnamn:
   - `claude-3-opus-20240229` – Mest kapabel modell
   - `claude-3-sonnet-20240229` – Bra balans mellan intelligens och hastighet
   - `claude-3-haiku-20240307` – Snabbast och mest kompakt
   - `claude-3-5-sonnet-20241022` – Senaste Sonnet-modellen

**Exempelkonfiguration:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (egeninstallerad)

Ollama låter dig köra öppen källkods-LLM:er lokalt eller i din egen infrastruktur.

1. Installera Ollama från [ollama.ai](https://ollama.ai)
2. Hämta din önskade modell: `ollama pull llama2`
3. Se till att Ollama körs och är tillgänglig
4. Välj **Ollama** som LLM-typ
5. Ange Bas-URL:en (t.ex. `http://localhost:11434`)
6. Ange modellnamnet du hämtade

**Exempelkonfiguration:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Populära Ollama-modeller:**

- `llama2` – Metas Llama 2-modell
- `llama3` – Metas Llama 3-modell
- `mistral` – Mistral AIs modell
- `codellama` – Kodspecialiserad Llama-modell
- `mixtral` – Mistrals mixture of experts-modell

### OpenAI Compatible (vLLM, LocalAI, LM Studio etc.)

Använd leverantören **OpenAI Compatible** för alla servrar som implementerar OpenAIs `/chat/completions`-API men som inte är OpenAI själva — till exempel [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) eller text-generation-webui. Dessa är vanligtvis egeninstallerade på din egen URL och körs ofta utan autentisering.

1. Starta din OpenAI-kompatibla server och notera dess bas-URL (den slutar oftast på `/v1`)
2. Välj **OpenAI Compatible** som LLM-typ
3. Ange **Bas-URL** (krävs), t.ex. `http://your-server:8000/v1`
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

> Tips: Efter att du sparat, använd knappen **Test** på leverantören för att bekräfta att anslutningen, modellnamnet och bas-URL:en är korrekta.

### Egeninstallerad vLLM på Kubernetes (Helm)

Om du kör OneUptime själv med Helm-chartet kan du köra [vLLM](https://docs.vllm.ai) — en OpenAI-kompatibel inferensserver — i ditt kluster och betjäna lokala modeller på dina egna GPU:er. Ingen data lämnar din infrastruktur.

1. Aktivera det i dina Helm-värden (kräver NVIDIA GPU-noder):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Kör `helm upgrade` och vänta tills vLLM-poden blir Ready (första starten laddar ner modellen)
3. Det är allt — vLLM registreras automatiskt som en global LLM-leverantör vid uppstart (`vllm.globalProvider.enabled`, standard `true`), så AI-funktioner fungerar för alla projekt. Observera: projektspecifika AI-agenter kan inte använda globala leverantörer och behöver fortfarande en projektspecifik LLM-leverantör.

Om du inaktiverade automatisk registrering (`vllm.globalProvider.enabled: false`) skapar du leverantören manuellt:

1. Välj **OpenAI Compatible** som LLM-typ (vLLM talar OpenAI-API:et)
2. Ange bas-URL:en i klustret: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
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

Se [Helm chart-README:n](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm) för GPU-schemaläggning, spärrade modeller och inställningsalternativ.

## Använda anpassade Bas-URL:er

För företagsdistributioner eller när du använder proxytjänster kan du ange en anpassad Bas-URL:

- **Azure OpenAI**: Använd din Azure-slutpunkts-URL
- **OpenAI-kompatibla API:er**: Valfritt API som följer OpenAIs API-specifikation
- **Privata Ollama-instanser**: Din interna Ollama-servers URL

## Bästa praxis

1. **Använd beskrivande namn**: Namnge dina leverantörer tydligt (t.ex. "Produktion GPT-4", "Utveckling Ollama")
2. **Skydda dina API-nycklar**: API-nycklar krypteras i vila, men dela dem inte
3. **Testa din konfiguration**: Verifiera att leverantören fungerar med AI-funktioner efter konfiguration
4. **Övervaka användning**: Håll koll på API-användningen för att hantera kostnader

## Felsökning

### Anslutningsproblem

- **OpenAI/Anthropic**: Verifiera att din API-nyckel är giltig och har tillräckliga krediter
- **Ollama**: Se till att Ollama-servern körs och att Bas-URL:en är korrekt
- **OpenAI Compatible**: Kontrollera att Bas-URL:en slutar på `/v1` (eller matchar din server), att Modellnamnet matchar en modell som din server exponerar, och ange endast en API-nyckel om din server kräver det
- **Brandvägg**: Kontrollera att ditt nätverk tillåter utgående anslutningar till leverantörens API

### Modellen hittas inte

- Verifiera att modellnamnet är stavat korrekt
- För Ollama, se till att du har hämtat modellen med `ollama pull <model-name>`
- Kontrollera om modellen är tillgänglig i din region (vissa modeller har regionala begränsningar)

## Behöver du hjälp?

Om du stöter på problem med att konfigurera din LLM-leverantör:

1. Kontrollera [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) för kända problem
2. Kontakta supporten om du har en företagsplan
