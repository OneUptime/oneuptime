# OneUptime AI i Datasikkerhed

OneUptime AI arbejder med det, Datasikkerhed har fundet, uden at se dine data. Den får navne, former, antal og konfiguration, aldrig en værdi fra dine data, en maskeret prøve, en post eller en forbindelsesstreng. Hver funktion kører på dit projekts egen model, også en selvhostet, og hver side, kontrol, scanning og integration i Datasikkerhed virker med AI slået fra.

:::cards
- [Hvad OneUptime AI ser](#hvad-oneuptime-ai-ser): Hvad hver funktion sender, og hvad den aldrig sender.
- [Se det selv](#se-det-selv): Det præcise input, som et af dine problemer ville sende.
- [Din egen model](#din-egen-model): Hver funktion på dit projekts udbyder, Ollama, vLLM eller ethvert OpenAI-kompatibelt endpoint.
- [Sådan måles det](#sådan-måles-det): Hver funktion på faste tilfælde, før hver udgivelse.
:::

## Hvad OneUptime AI ser

Ingen funktion sender nogensinde en model:

- en værdi fra dine data;
- en maskeret prøve, som `j***@e******.com`: en maskeret e-mailadresse bærer stadig et domæne, og et maskeret kort sine sidste fire cifre;
- en post fra din telemetri: en loglinje, et span eller en session;
- en forbindelsesstreng, en nøgle eller en anden hemmelighed.

Datasikkerhed læser selv dine data, i sine scanninger, og gemmer intet af dem. Det, den sender OneUptime AI, bygges ét sted, ud fra en liste over, hvad der må sendes, og en test fejler, når en funktion sender en model noget andet.

| Funktion | Hvad den sender | Kører af sig selv |
| --- | --- | --- |
| **Forklar med AI** | Problemets titel, alvorlighed og beviser, hvorfor dets kontrol er vigtig, og rettelsen til datalagerets cloud; datalagerets navn, type, region og cloud-id, dets følsomhed og navnene på dets datatyper; for et problem i telemetrien, hvor hver slags data blev fundet: attributten, logindholdet eller prompten, det står i | Nej: en person spørger, på et problems side |
| **Ret med AI** | Det, Forklar med AI sender, som en anmodning til kodeagenten, der derefter læser repositoryets egen kode for at foretage ændringen | Nej: en person spørger, i et repository, som vedkommende må ændre under **Kode** |
| **Forslag til felter, som ingen detektor placerede** | Typen af datalager og de datatyper, som AI må nævne; hvert felts navn, navnene på felterne ved siden af og formerne på dets værdier, hvert bogstav som `a` eller `A` og hvert ciffer som `9`; hvor mange værdier der blev læst, og hvor lange de er | Ja: et datalagers indholdsscanning starter dem |
| **Spørg AI** | De datalagre, problemer og adgange, som personen må læse i Datasikkerhed; hvad der blev fundet hvor, hver datatype efter placering, med antal og sikkerhed | Nej: en person stiller et spørgsmål |

**Forklar med AI** og **Spørg AI** læser også først dit teams [AI-kontekst](/docs/ai/ai-context), når der er en: de noter, dit team har skrevet til OneUptime AI om jeres systemer.

### Tekst, som dine systemer skrev, er data

Et datalagers navn, dets cloud-id, dets tags, de beviser, en cloud svarede med, og en attributs nøgle kommer fra dine clouds og din kode, så alle, der kan navngive en bucket eller tagge en ressource, skriver med på det, OneUptime AI læser. OneUptime AI får hver instruktion i sin egen besked, og den tekst i en anden besked, som data:

- hver tekst holdes til en længde og sættes på én linje, og det, der ligner en hemmelighed, en e-mailadresse eller en IP-adresse, udelades;
- tekst, der lyder som instruktioner til en AI, som "ignore previous instructions", markeres, og OneUptime AI får besked på aldrig at følge den;
- et struktureret svar, som feltforslagenes, læses strengt: det objekt, der blev bedt om, eller intet svar.

### Hvad der gemmes

Hvert kalds række i **Projektindstillinger → AI → AI-logs** siger, hvilken funktion der kaldte hvilken model, dens tokens og dens omkostning. Den gemmer aldrig, hvad der blev sendt eller svaret: alle med rollen Projektmedlem eller Seer læser AI-logs, og Datasikkerheds poster er for deres ejere og sikkerhedsrollerne. OneUptimes egen telemetri registrerer heller aldrig, hvad Forklar med AI eller feltforslagene sendte, selv hvor serverens operatør registrerer, hvad andre AI-kald sender.

Når et kald mislykkes, gemmer Forklar med AI og feltforslagene ikke et ord af udbyderens fejl, som kan citere det, der blev sendt. Kodeagenten bag Ret med AI og chatten i Spørg AI gemmer stadig et mislykket kalds udbyderfejl i dets række.

## Se det selv

**Datasikkerhed → Indstillinger → OneUptime AI** viser alt dette for dit projekt:

- **Hvad OneUptime AI ser**: hver funktion, hvad den sender og aldrig sender, hvad der starter den, den model, den kører på, og hvad der gemmes af den. Modellen nævnes for alle, der må læse projektets LLM-udbydere.
- **Vis et eksempel**: det præcise input, som **Forklar med AI** ville sende for dit mest risikable åbne problem, sådan som den ville sende det, med det, som **Ret med AI** ville bede om. Dit projekts AI-kontekst, som kommer først, vises med sin længde. Den viser kun et problem, som du må læse.

**Projektindstillinger → AI → LLM-udbydere** linker til den, for dem, der vælger modellen.

## Din egen model

Hver AI-funktion i Datasikkerhed kører på den model, dit projekt valgte:

- **Forklar med AI** og feltforslagene kører på den udbyder, en AI-regel vælger til opgaven, ellers på dit projekts standard-LLM-udbyder, ellers på serverens egen.
- Kodeagenten i **Ret med AI** kører på den udbyder, en AI-regel vælger, ellers på en af dit projekts egne udbydere, ellers på serverens egen.
- **Spørg AI** kører på den udbyder, der er valgt i chatten, ellers på dit projekts standard.

En selvhostet model kører dem alle: Ollama, vLLM eller ethvert OpenAI-kompatibelt endpoint, du tilføjer under **Projektindstillinger → AI → LLM-udbydere**. På en server uden netværksadgang er den vLLM, der følger med Helm-chartet, serverens egen udbyder, så intet forlader serveren.

### Med AI slået fra

Med **Aktivér AI** slået fra under **Projektindstillinger → AI → AI-funktioner** sender OneUptime AI intet, og Datasikkerhed virker som før: hver side, kontrol, scanning og integration. Der vises ingen AI-knap på et problem, og der spørges ikke om noget felt efter en scanning.

## Sådan måles det

Hver AI-funktion i Datasikkerhed måles på et fast sæt opdigtede tilfælde, bygget sådan som funktionen bygger sit input og bedømt på, hvad et rigtigt svar siger: en forklaring, der nævner rettelsen og intet gentager af det, et datalagers navn bad den sige, den rigtige datatype for hvert felt, en rettelse, der ændrer det, kontrollen kræver, og intet andet, og et svar ud fra det, Spørg AI læste. Tilfældene kører mod en fastlåst model hver nat, ved hver ændring af en AI-prompt i Datasikkerhed og før hver udgivelse, som kræver, at hver funktion når sin tærskel.

For at måle din egen model på de samme tilfælde skal du køre evalueringen fra et checkout af OneUptime, med din models nøgle, hvis den skal bruge en, i `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Næste trin

:::cards
- [Datasikkerhedsintegrationer](/docs/data-security/integrations): Hvad Forklar med AI og Ret med AI gør på et problem.
- [LLM-udbydere](/docs/ai/llm-provider): Tilføj din egen model, også en selvhostet.
- [Følsomme datatyper](/docs/data-security/data-types): Hvordan der foreslås noget for de felter, ingen detektor kunne placere.
- [Datasikkerhedskontroller og problemer](/docs/data-security/checks-and-issues): Hvad hvert problem betyder, og hvordan du retter det.
:::
