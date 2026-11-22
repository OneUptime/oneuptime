# OneUptime AI i Datasikkerhed

OneUptime AI arbejder med det, Datasikkerhed har fundet, uden at se dine data. Den får navne, former, antal og konfiguration, aldrig en værdi fra dine data, en maskeret prøve, en post eller en forbindelsesstreng. Hver funktion kører på dit projekts egen model, også en selvhostet, og hver side, kontrol, scanning og integration i Datasikkerhed virker med AI slået fra.

:::cards
- [Af sig selv](#af-sig-selv): Hvad den gør med hvert nyt problem, hvad der venter på dig, og AI-reglerne.
- [Hvad OneUptime AI ser](#hvad-oneuptime-ai-ser): Hvad hver funktion sender, og hvad den aldrig sender.
- [Se det selv](#se-det-selv): Det præcise input, som et af dine problemer ville sende.
- [Din egen model](#din-egen-model): Hver funktion på dit projekts udbyder, Ollama, vLLM eller ethvert OpenAI-kompatibelt endpoint.
- [Sådan måles det](#sådan-måles-det): Hver funktion på faste tilfælde, før hver udgivelse.
:::

## Af sig selv

Med **Arbejd med nye problemer** slået til under **Datasikkerhed → AI**, som det er for nye projekter, arbejder OneUptime AI af sig selv med hvert nyt kritisk eller højt problem. Den skriver analysen af hvert sådant problem, og af hvert, der genåbnes, som **Analysér problem** gør og ud fra det, den sender, før nogen åbner det, og skriver den kun igen, når det, den bygger på, er ændret. For et telemetriproblem foreslår den de rensningsregler, der skjuler dets data i ny telemetri. Et forslag venter på den side under **Venter på dig**, de mest risikable først, med hvad der ændres, hvorfor, hvordan det bevises, og hvordan det fortrydes. **Godkend** foretager ændringen med dine egne tilladelser: en rensningsregel kræver tilladelse til at oprette logrensningsregler, trace-rensningsregler eller metrik-pipelineregler. **Afvis forslaget** siger nej, med en begrundelse, der kommer på problemets tidslinje. Problemets egen kontrol afgør, om en ændring virkede: datalageret kontrolleres igen, og problemet løses, når ingen af dets data er tilbage.

OneUptime AI foreslår også ejere til datalagre, der ikke har nogen, ud fra det, der allerede peger på dem: datalagerets cloudmærker, de tjenester, der bruger det, og deres ejere, kodeejerne af filen, der erklærer det, hvem der ændrede det ifølge cloudens ændringslog, og hvem der tilføjede det til OneUptime. Den nævner kun dit eget projekts teams og personer, siger, hvor sikker den er, og siger, hvor beviserne er uenige. Forslaget til et følsomt datalager kommer med dets problem **Ingen ejer dette følsomme datalager**, og andre nye datalagre får deres én gang om dagen, og når en cloudforbindelse læses første gang. Når ejerne af tre eller flere datalagre hviler på det samme mærke eller den samme begyndelse af deres navne, foreslår den også den ejerregel, der holder det næste lignende datalager med en ejer, og siger, hvor mange datalagre reglen ville matche. Forslagene venter under **Ejere til gennemgang**, på denne side og under **Datalagre**: **Godkend** tilføjer ejerne med dine egne tilladelser, og de får besked som enhver ejer; **Ændr og godkend** vælger andre ejere først; **Fortryd** tager præcis de tilføjede ejere tilbage, og reglen med dem. At tilføje en ejer ændrer, hvem der får besked, så det venter altid på dig, uanset hvad en AI-regel siger.

Som standard spørger OneUptime AI før hver ændring, undtagen en, der kun skjuler data, kan fortrydes og er bevist sikker, og den sletter aldrig data eller tilkalder nogen uden at spørge. En ændring, den har foretaget uden at spørge, står under **Udført af AI**, med **Fortryd**. **Hvorfor AI ikke handlede** viser de problemer, den har set på og ladet være, og hvorfor. Hvert forslag, hver godkendelse, afvisning og fortrydelse står på problemets og datalagerets **Tidslinje**. Med kontakten slået fra fungerer Datasikkerhed som altid, og **Analysér problem** og **Ret med AI** virker stadig, når du trykker på dem; med AI slået fra for projektet virker ingen af dem.

På et problems side viser kortet **OneUptime AI** over **Sådan rettes det** analysen og det, der blev foreslået for problemet, med de samme knapper. Datasikkerhedens **Oversigt** siger, hvor mange lækager OneUptime AI inddæmmede i denne uge, og hvor mange forslag der venter på dig. **Noter til OneUptime AI** tæller uge for uge, hvad der kom ud af dens ændringer: se [Hvor godt OneUptime AI klarer sig](/docs/ai/ai-sre#hvor-godt-oneuptime-ai-klarer-sig).

### AI-regler

Under **AI-regler** på **Datasikkerhed → AI** siger en regel, hvilke problemer OneUptime AI arbejder med - efter deres kontrol eller kontrolgruppe, alvorlighed og datalagerets følsomhed, type, udbyder, miljø, etiketter, datakategorier og tjeneste - og for hver slags arbejde, **Analysér**, **Inddæm**, **Rettelse** og **Vurdér**, om den er **Fra**, **Foreslå** (den foreslår og venter på dig) eller **Uden at spørge**. Når flere regler passer til et problem, kører en slags arbejde, hvis en af dem slår det til, og **Foreslå** går forud for **Uden at spørge**. Hvert forslag siger, hvilken regel der afgjorde det. Uden regel gælder projektets standarder: analysér kritiske og høje problemer, og foreslå alt andet.

AI-regler hører til hele projektet, ligesom AI-reglerne for hændelser og alarmer: Projektejere og Projektadministratorer ændrer dem, og det gør alle, der har fået tilladelserne til AI-regler. Sikkerhedsrollerne ser, hvad OneUptime AI foreslog og gjorde, men ikke reglerne.

## Hvad OneUptime AI ser

Ingen funktion sender nogensinde en model:

- en værdi fra dine data;
- en maskeret prøve, som `j***@e******.com`: en maskeret e-mailadresse bærer stadig et domæne, og et maskeret kort sine sidste fire cifre;
- en post fra din telemetri: en loglinje, et span eller en session;
- en forbindelsesstreng, en nøgle eller en anden hemmelighed.

Datasikkerhed læser selv dine data, i sine scanninger, og gemmer intet af dem. Det, den sender OneUptime AI, bygges ét sted, ud fra en liste over, hvad der må sendes, og en test fejler, når en funktion sender en model noget andet.

| Funktion | Hvad den sender | Kører af sig selv |
| --- | --- | --- |
| **Analyse efter anmodning** | Problemets titel, alvorlighed og bevis, hvorfor dets kontrol betyder noget, og de trin, der retter det; lagerets navn, type, region, tags og konfiguration, dets følsomhed, navnene på dets datatyper og omtrent hvor mange poster det indeholder; hvem der kan nå lageret: hver tildelings identitet, niveau og hvordan den er givet, og omtrent hvornår den sidst blev brugt, og de tjenester, der er set bruge det; kopier af dets data i andre lagre, dets sikkerhedssager, den reaktionshandling, der retter problemet, og det repository og de filer, der erklærer det; hvor mange ejere lageret har, aldrig hvem de er; for et telemetriproblem, hvor hver slags data blev fundet: attributten, logteksten eller prompten, det står i | Nej: en person spørger, på et problems side, eller med Forklar med AI gennem API'et eller MCP-serveren |
| **Analyse af nye problemer** | Problemets titel, alvorlighed og bevis, hvorfor dets kontrol betyder noget, og de trin, der retter det; lagerets navn, type, region, tags og konfiguration, dets følsomhed, navnene på dets datatyper og omtrent hvor mange poster det indeholder; hvem der kan nå lageret: hver tildelings identitet, niveau og hvordan den er givet, og omtrent hvornår den sidst blev brugt, og de tjenester, der er set bruge det; kopier af dets data i andre lagre, dets sikkerhedssager, den reaktionshandling, der retter problemet, og det repository og de filer, der erklærer det; hvor mange ejere lageret har, aldrig hvem de er; for et telemetriproblem, hvor hver slags data blev fundet: attributten, logteksten eller prompten, det står i | Ja: et nyt eller genåbnet problem med alvorlighed Kritisk eller Høj starter den, mens **Arbejd med nye problemer** er slået til |
| **Ret med AI** | Problemet, som dets kontrol så det, lagerets navn, type, region og cloud-ID, og for et telemetriproblem, hvor dets data blev fundet, som en anmodning til kodeagenten, der derefter læser repositoryets egen kode for at foretage ændringen | Nej: en person spørger, i et repository, personen må ændre i **Code** |
| **Forslag til felter, som ingen detektor placerede** | Typen af datalager og de datatyper, som AI må nævne; hvert felts navn, navnene på felterne ved siden af og formerne på dets værdier, hvert bogstav som `a` eller `A` og hvert ciffer som `9`; hvor mange værdier der blev læst, og hvor lange de er | Ja: et datalagers indholdsscanning starter dem |
| **Spørg AI** | De datalagre, problemer og adgange, som personen må læse i Datasikkerhed; hvad der blev fundet hvor, hver datatype efter placering, med antal og sikkerhed | Nej: en person stiller et spørgsmål |
| **Ejere af datalagre** | Datalagerets navn, type, udbyder, miljø og følsomhed og navnene på dets datatyper; hvad der peger på en ejer: dets cloudmærker, de tjenester, der bruger det, kodeejerne af filen, der erklærer det, og de ændringer, der er foretaget i det; de teams, som beviserne nævner, ved navn, og de personer, de nævner, kun som nummererede kandidater, aldrig ved navn eller e-mailadresse | Ja: Et datalager uden ejere starter den, én gang om dagen for nye datalagre, og når en cloudforbindelse læses første gang, mens **Arbejd med nye problemer** er slået til |

**Forklar med AI** og **Spørg AI** læser også først dit teams [AI-kontekst](/docs/ai/ai-context), når der er en: de noter, dit team har skrevet til OneUptime AI om jeres systemer. **Analyse af nye problemer** læser den også.

### Tekst, som dine systemer skrev, er data

Et datalagers navn, dets cloud-id, dets tags, de beviser, en cloud svarede med, og en attributs nøgle kommer fra dine clouds og din kode, så alle, der kan navngive en bucket eller tagge en ressource, skriver med på det, OneUptime AI læser. OneUptime AI får hver instruktion i sin egen besked, og den tekst i en anden besked, som data:

- hver tekst holdes til en længde og sættes på én linje, og det, der ligner en hemmelighed, en e-mailadresse eller en IP-adresse, udelades;
- tekst, der lyder som instruktioner til en AI, som "ignore previous instructions", markeres, og OneUptime AI får besked på aldrig at følge den;
- et struktureret svar, som feltforslagenes, læses strengt: det objekt, der blev bedt om, eller intet svar.

### Hvad der gemmes

Hvert kalds række i **Projektindstillinger → AI → AI-logs** siger, hvilken funktion der kaldte hvilken model, dens tokens og dens omkostning. Den gemmer aldrig, hvad der blev sendt eller svaret: alle med rollen Projektmedlem eller Seer læser AI-logs, og Datasikkerheds poster er for deres ejere og sikkerhedsrollerne. OneUptimes egen telemetri registrerer heller aldrig, hvad Forklar med AI eller feltforslagene sendte, selv hvor serverens operatør registrerer, hvad andre AI-kald sender. Selve analysen gemmes på dens problem for alle, der må læse problemet, og en linje, der bygger på noget, en læser ikke må læse, skjules for læseren.

Når et kald mislykkes, gemmer Forklar med AI og feltforslagene ikke et ord af udbyderens fejl, som kan citere det, der blev sendt. Kodeagenten bag Ret med AI og chatten i Spørg AI gemmer stadig et mislykket kalds udbyderfejl i dets række.

Ejerforslagene gemmer det samme som Forklar med AI: Deres kalds rækker nævner funktionen, modellen, tokens og omkostningen, aldrig hvad der blev sendt eller svaret, og ikke et ord af et mislykket kalds fejl.

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

Ejerforslagene bedømmes på, om de nævner den ejer, beviserne peger på, vælger ingen, når de ikke peger på nogen, og er usikre, hvor beviserne er uenige.

For at måle din egen model på de samme tilfælde skal du køre evalueringen fra et checkout af OneUptime, med din models nøgle, hvis den skal bruge en, i `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

I dit projekt tæller **Vurderinger bekræftet** under **Projektindstillinger → AI → AI-resultater**, hvor ofte det, folk besluttede om et problem, OneUptime AI analyserede, gik, som dens vurdering sagde: rettet eller accepteret, når den sagde **Reelt**, accepteret eller markeret som offentlig med vilje, når den sagde **Sandsynligvis med vilje**, og markeret som ikke et problem, når den sagde **Sandsynligvis et forkert fund**.

## Næste trin

:::cards
- [Datasikkerhedsintegrationer](/docs/data-security/integrations): Hvad Forklar med AI og Ret med AI gør på et problem.
- [LLM-udbydere](/docs/ai/llm-provider): Tilføj din egen model, også en selvhostet.
- [Følsomme datatyper](/docs/data-security/data-types): Hvordan der foreslås noget for de felter, ingen detektor kunne placere.
- [Datasikkerhedskontroller og problemer](/docs/data-security/checks-and-issues): Hvad hvert problem betyder, og hvordan du retter det.
:::
