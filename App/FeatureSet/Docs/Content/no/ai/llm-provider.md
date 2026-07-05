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

## Støttede leverandører

OneUptime støtter for øyeblikket følgende LLM-leverandører:

| Leverandør    | Beskrivelse                                                              | API-nøkkel påkrevd | Basis-URL påkrevd     |
| ------------- | ------------------------------------------------------------------------ | ------------------ | --------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo og andre OpenAI-modeller                    | Ja                 | Nei (bruker standard) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku og andre Claude-modeller  | Ja                 | Nei (bruker standard) |
| **Ollama**    | Selvhostede åpen kildekode-modeller som Llama 2, Mistral, CodeLlama osv. | Nei                | Ja                    |

## Konfigurere en LLM-leverandør

### Trinn 1: Naviger til innstillinger for LLM-leverandører

1. Logg inn på OneUptime-dashbordet ditt
2. Gå til **AI-agenter** > **LLM-leverandører**
3. Klikk **Opprett LLM-leverandør** for å legge til en ny leverandør

### Trinn 2: Konfigurer leverandøren din

Fyll inn følgende felt:

- **Navn**: Et vennlig navn for denne LLM-konfigurasjonen (f.eks. "Produksjon OpenAI", "Lokal Ollama")
- **Beskrivelse** (valgfritt): En beskrivelse som hjelper å identifisere formålet med denne leverandøren
- **LLM-type**: Velg leverandørtype (OpenAI, Anthropic eller Ollama)
- **API-nøkkel**: API-nøkkelen din (påkrevd for OpenAI og Anthropic)
- **Modellnavn**: Den spesifikke modellen som skal brukes (f.eks. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Basis-URL** (valgfritt): Egendefinert API-endepunkt-URL (påkrevd for Ollama, valgfritt for andre)

## Leverandørspesifikk konfigurasjon

### OpenAI

1. Hent API-nøkkelen din fra [OpenAI Platform](https://platform.openai.com/api-keys)
2. Velg **OpenAI** som LLM-type
3. Skriv inn API-nøkkelen
4. Velg et modellnavn:
   - `gpt-4o` – Den mest kapable modellen, best for komplekse oppgaver
   - `gpt-4o-mini` – Raskere og mer kostnadseffektiv
   - `gpt-4-turbo` – God balanse mellom kapasitet og hastighet
   - `gpt-3.5-turbo` – Rask og økonomisk

**Eksempelkonfigurasjon:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Hent API-nøkkelen din fra [Anthropic Console](https://console.anthropic.com/)
2. Velg **Anthropic** som LLM-type
3. Skriv inn API-nøkkelen
4. Velg et modellnavn:
   - `claude-3-opus-20240229` – Den mest kapable modellen
   - `claude-3-sonnet-20240229` – God balanse mellom intelligens og hastighet
   - `claude-3-haiku-20240307` – Raskest og mest kompakt
   - `claude-3-5-sonnet-20241022` – Nyeste Sonnet-modell

**Eksempelkonfigurasjon:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (selvhostet)

Ollama lar deg kjøre åpen kildekode-LLM-er lokalt eller på din egen infrastruktur.

1. Installer Ollama fra [ollama.ai](https://ollama.ai)
2. Hent ønsket modell: `ollama pull llama2`
3. Sørg for at Ollama kjører og er tilgjengelig
4. Velg **Ollama** som LLM-type
5. Skriv inn basis-URL-en (f.eks. `http://localhost:11434`)
6. Skriv inn modellnavnet du hentet

**Eksempelkonfigurasjon:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Populære Ollama-modeller:**

- `llama2` – Metas Llama 2-modell
- `llama3` – Metas Llama 3-modell
- `mistral` – Mistral AIs modell
- `codellama` – Kodespesialisert Llama-modell
- `mixtral` – Mistrals mixture of experts-modell

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
- **Ollama**: Sørg for at Ollama-serveren kjører og at basis-URL-en er riktig
- **Brannmur**: Kontroller at nettverket tillater utgående tilkoblinger til leverandørens API

### Modell ikke funnet

- Verifiser at modellnavnet er stavet korrekt
- For Ollama, sørg for at du har hentet modellen med `ollama pull <model-name>`
- Sjekk om modellen er tilgjengelig i din region (noen modeller har regionale begrensninger)

## Trenger du hjelp?

Hvis du støter på problemer med å konfigurere LLM-leverandøren din:

1. Sjekk [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kjente problemer
2. Kontakt support hvis du har en enterprise-plan
