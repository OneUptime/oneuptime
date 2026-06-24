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

## Understøttede udbydere

OneUptime understøtter i øjeblikket følgende LLM-udbydere:

| Udbyder       | Beskrivelse                                                             | API-nøgle påkrævet | Base URL påkrævet     |
| ------------- | ----------------------------------------------------------------------- | ------------------ | --------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo og andre OpenAI-modeller                   | Ja                 | Nej (bruger standard) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku og andre Claude-modeller | Ja                 | Nej (bruger standard) |
| **Ollama**    | Selvhostede open source-modeller som Llama 2, Mistral, CodeLlama osv.   | Nej                | Ja                    |

## Opsætning af en LLM-udbyder

### Trin 1: Naviger til LLM-udbyderindstillinger

1. Log ind på dit OneUptime-dashboard
2. Gå til **Projektindstillinger** > **AI** > **LLM-udbydere**
3. Klik på **Opret LLM-udbyder** for at tilføje en ny udbyder

### Trin 2: Konfigurer din udbyder

Udfyld følgende felter:

- **Navn**: Et brugervenligt navn til denne LLM-konfiguration (f.eks. "Produktions-OpenAI", "Lokal Ollama")
- **Beskrivelse** (valgfrit): En beskrivelse til at identificere formålet med denne udbyder
- **LLM-type**: Vælg udbydertype (OpenAI, Anthropic eller Ollama)
- **API-nøgle**: Din API-nøgle (påkrævet for OpenAI og Anthropic)
- **Modelnavn**: Den specifikke model, der skal bruges (f.eks. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **Base URL** (valgfrit): Brugerdefineret API-endpoint-URL (påkrævet for Ollama, valgfrit for andre)

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
2. Hent din ønskede model: `ollama pull llama2`
3. Sørg for, at Ollama kører og er tilgængelig
4. Vælg **Ollama** som LLM-type
5. Indtast Base URL (f.eks. `http://localhost:11434`)
6. Indtast modelnavnet, du hentede

**Eksempelkonfiguration:**

```
Navn: Lokal Ollama
LLM-type: Ollama
Base URL: http://localhost:11434
Modelnavn: llama2
```

**Populære Ollama-modeller:**

- `llama2` – Metas Llama 2-model
- `llama3` – Metas Llama 3-model
- `mistral` – Mistral AIs model
- `codellama` – Kodespecialiseret Llama-model
- `mixtral` – Mistrals mixture of experts-model

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
- **Ollama**: Sørg for, at Ollama-serveren kører, og at Base URL er korrekt
- **Firewall**: Kontroller, at dit netværk tillader udgående forbindelser til udbyderens API

### Model ikke fundet

- Bekræft, at modelnavnet er stavet korrekt
- For Ollama, sørg for, at du har hentet modellen med `ollama pull <model-name>`
- Kontroller, om modellen er tilgængelig i din region (nogle modeller har regionale begrænsninger)

## Har du brug for hjælp?

Hvis du støder på problemer med at opsætte din LLM-udbyder:

1. Tjek [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for kendte problemer
2. Kontakt support, hvis du er på en enterprise-plan
