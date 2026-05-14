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

| Leverantör | Beskrivning | API-nyckel krävs | Bas-URL krävs |
|------------|-------------|------------------|----------------|
| **OpenAI** | GPT-4, GPT-4o, GPT-3.5 Turbo och andra OpenAI-modeller | Ja | Nej (använder standard) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku och andra Claude-modeller | Ja | Nej (använder standard) |
| **Ollama** | Egeninstallerade öppen källkods-modeller som Llama 2, Mistral, CodeLlama etc. | Nej | Ja |

## Konfigurera en LLM-leverantör

### Steg 1: Navigera till inställningar för LLM-leverantörer

1. Logga in på din OneUptime-instrumentpanel
2. Gå till **Projektinställningar** > **AI** > **LLM-leverantörer**
3. Klicka på **Skapa LLM-leverantör** för att lägga till en ny leverantör

### Steg 2: Konfigurera din leverantör

Fyll i följande fält:

- **Namn**: Ett beskrivande namn för denna LLM-konfiguration (t.ex. "Produktions-OpenAI", "Lokal Ollama")
- **Beskrivning** (valfritt): En beskrivning för att hjälpa till att identifiera syftet med denna leverantör
- **LLM-typ**: Välj leverantörstyp (OpenAI, Anthropic eller Ollama)
- **API-nyckel**: Din API-nyckel (krävs för OpenAI och Anthropic)
- **Modellnamn**: Den specifika modell som ska användas (t.ex. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Bas-URL** (valfritt): Anpassad API-slutpunkts-URL (krävs för Ollama, valfritt för andra)

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
- **Brandvägg**: Kontrollera att ditt nätverk tillåter utgående anslutningar till leverantörens API

### Modellen hittas inte

- Verifiera att modellnamnet är stavat korrekt
- För Ollama, se till att du har hämtat modellen med `ollama pull <model-name>`
- Kontrollera om modellen är tillgänglig i din region (vissa modeller har regionala begränsningar)

## Behöver du hjälp?

Om du stöter på problem med att konfigurera din LLM-leverantör:

1. Kontrollera [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) för kända problem
2. Kontakta supporten om du har en företagsplan
