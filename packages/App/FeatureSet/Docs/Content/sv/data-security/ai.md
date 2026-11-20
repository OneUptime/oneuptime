# OneUptime AI i Datasäkerhet

OneUptime AI arbetar med det som Datasäkerhet har hittat, utan att se dina data. Den får namn, former, antal och konfiguration, aldrig ett värde från dina data, ett maskerat prov, en post eller en anslutningssträng. Varje funktion körs på ditt projekts egen modell, även en självhostad, och varje sida, kontroll, skanning och integration i Datasäkerhet fungerar med AI avstängd.

:::cards
- [Vad OneUptime AI ser](#vad-oneuptime-ai-ser): Vad varje funktion skickar, och vad den aldrig skickar.
- [Se det själv](#se-det-själv): Den exakta indata som ett av dina problem skulle skicka.
- [Din egen modell](#din-egen-modell): Varje funktion på ditt projekts leverantör, Ollama, vLLM eller valfri OpenAI-kompatibel slutpunkt.
- [Hur det mäts](#hur-det-mäts): Varje funktion på fasta fall, före varje release.
:::

## På egen hand

Med **Arbeta med nya problem** påslaget under **Datasäkerhet → AI**, som det är för nya projekt, arbetar OneUptime AI på egen hand med varje nytt kritiskt eller högt problem. Den skriver problemets analys, som **Förklara med AI** gör och utifrån det den skickar, och lägger den på problemets **Tidslinje**. För ett telemetriproblem föreslår den de rensningsregler som döljer dess data i ny telemetri. Ett förslag väntar på den sidan under **Väntar på dig**, de mest riskfyllda först, med vad som ändras, varför, hur det bevisas och hur det ångras. **Godkänn** gör ändringen med dina egna behörigheter: en rensningsregel kräver behörighet att skapa loggrensningsregler, spårrensningsregler eller pipelineregler för mätvärden. **Avfärda förslaget** säger nej, med en motivering som läggs på problemets tidslinje. Problemets egen kontroll avgör om en ändring fungerade: datalagret kontrolleras igen, och problemet löses när inga av dess data finns kvar.

Som standard frågar OneUptime AI före varje ändring, utom en som bara döljer data, kan ångras och är bevisat säker, och den tar aldrig bort data eller larmar någon utan att fråga. En ändring som den gjorde utan att fråga visas under **Gjort av AI**, med **Ångra**. **Varför AI inte agerade** listar de problem som den tittade på och lät vara, och varför. Varje förslag, godkännande, avfärdande och ångrande finns på problemets och datalagrets **Tidslinje**. Med reglaget av, eller AI avstängd för projektet, fungerar datasäkerhet som vanligt, och **Förklara med AI** och **Åtgärda med AI** fungerar fortfarande när du trycker på dem.

### AI-regler

Under **AI-regler** på **Datasäkerhet → AI** säger en regel vilka problem OneUptime AI arbetar med - efter kontroll eller kontrollgrupp, allvarlighetsgrad, och datalagrets känslighet, typ, leverantör, miljö, etiketter, datakategorier och tjänst - och för varje typ av arbete, **Analysera**, **Begränsa**, **Åtgärd** och **Bedöm**, om den är **Av**, **Föreslå** (den föreslår och väntar på dig) eller **Utan att fråga**. När flera regler matchar ett problem körs en typ av arbete om någon av dem slår på den, och **Föreslå** går före **Utan att fråga**. Varje förslag säger vilken regel som avgjorde det. Utan regel gäller projektets standarder: analysera kritiska och höga problem, och föreslå allt annat.

## Vad OneUptime AI ser

Ingen funktion skickar någonsin till en modell:

- ett värde från dina data;
- ett maskerat prov, som `j***@e******.com`: en maskerad e-postadress bär fortfarande en domän, och ett maskerat kort sina fyra sista siffror;
- en post i din telemetri: en loggrad, ett span eller en session;
- en anslutningssträng, en nyckel eller någon annan hemlighet.

Datasäkerhet läser själv dina data, i sina skanningar, och sparar ingenting av dem. Det som den skickar till OneUptime AI byggs på ett enda ställe, utifrån en lista över vad som får skickas, och ett test misslyckas när en funktion skickar något annat till en modell.

| Funktion | Vad den skickar | Körs av sig själv |
| --- | --- | --- |
| **Förklara med AI** | Problemets titel, allvarlighetsgrad och bevis, varför dess kontroll spelar roll och åtgärden för datalagrets moln; datalagrets namn, typ, region och moln-ID, dess känslighet och namnen på dess datatyper; för ett problem i telemetrin, var varje typ av data hittades: attributet, loggkroppen eller prompten den finns i | Nej: en person frågar, på ett problems sida |
| **Analys av nya problem** | Problemets titel, allvarlighetsgrad och bevis, varför dess kontroll spelar roll och åtgärden för datalagrets moln; datalagrets namn, typ, region och moln-ID, dess känslighet och namnen på dess datatyper; för ett problem i telemetrin, var varje typ av data hittades: attributet, loggkroppen eller prompten den finns i | Ja: ett nytt kritiskt eller högt problem startar den, medan **Arbeta med nya problem** är påslaget |
| **Åtgärda med AI** | Det som Förklara med AI skickar, som en begäran till kodagenten, som sedan läser arkivets egen kod för att göra ändringen | Nej: en person frågar, i ett arkiv som personen får ändra under **Kod** |
| **Förslag för fält som ingen detektor placerade** | Typen av datalager och de datatyper som AI får nämna; varje fälts namn, namnen på fälten bredvid och formerna på dess värden, varje bokstav som `a` eller `A` och varje siffra som `9`; hur många värden som lästes och hur långa de är | Ja: ett datalagers innehållsskanning startar dem |
| **Fråga AI** | De datalager, problem och den åtkomst som personen får läsa i Datasäkerhet; vad som hittades var, varje datatyp efter plats, med antal och konfidens | Nej: en person ställer en fråga |

**Förklara med AI** och **Fråga AI** läser också först ditt teams [AI-kontext](/docs/ai/ai-context), när det finns en: anteckningarna som ditt team har skrivit åt OneUptime AI om era system. **Analys av nya problem** läser den också.

### Text som dina system skrev är data

Ett datalagers namn, dess moln-ID, dess taggar, bevisen som ett moln svarade med och ett attributs nyckel kommer från dina moln och din kod, så alla som kan namnge en bucket eller tagga en resurs skriver med på det som OneUptime AI läser. OneUptime AI får varje instruktion i ett eget meddelande, och den texten i ett andra meddelande, som data:

- varje text hålls till en längd och sätts på en rad, och det som ser ut som en hemlighet, en e-postadress eller en IP-adress utelämnas;
- text som läses som instruktioner till en AI, som ”ignore previous instructions”, markeras, och OneUptime AI uppmanas att aldrig följa den;
- ett strukturerat svar, som fältförslagens, läses strikt: det objekt som begärdes, eller inget svar.

### Vad som sparas

Varje anrops rad i **Projektinställningar → AI → AI-loggar** säger vilken funktion som anropade vilken modell, dess token och dess kostnad. Den sparar aldrig vad som skickades eller besvarades: alla med rollen Projektmedlem eller Tittare läser AI-loggarna, och Datasäkerhets poster är till för deras ägare och säkerhetsrollerna. OneUptimes egen telemetri registrerar inte heller någonsin vad Förklara med AI eller fältförslagen skickade, inte ens där serverns operatör registrerar vad andra AI-anrop skickar.

När ett anrop misslyckas sparar Förklara med AI och fältförslagen inte ett ord av leverantörens fel, som kan citera det som skickades. Kodagenten bakom Åtgärda med AI och chatten i Fråga AI sparar fortfarande ett misslyckat anrops leverantörsfel i dess rad.

## Se det själv

**Datasäkerhet → Inställningar → OneUptime AI** visar allt detta för ditt projekt:

- **Vad OneUptime AI ser**: varje funktion, vad den skickar och aldrig skickar, vad som startar den, modellen som den körs på och vad som sparas av den. Modellen nämns för alla som får läsa projektets LLM-leverantörer.
- **Visa ett exempel**: den exakta indata som **Förklara med AI** skulle skicka för ditt mest riskfyllda öppna problem, så som den skulle skicka den, med det som **Åtgärda med AI** skulle be om. Ditt projekts AI-kontext, som kommer först, visas med sin längd. Den visar bara ett problem som du får läsa.

**Projektinställningar → AI → LLM-leverantörer** länkar hit, för dem som väljer modellen.

## Din egen modell

Varje AI-funktion i Datasäkerhet körs på den modell som ditt projekt valde:

- **Förklara med AI** och fältförslagen körs på den leverantör som en AI-regel väljer för arbetet, annars på ditt projekts standard-LLM-leverantör, annars på serverns egen.
- Kodagenten i **Åtgärda med AI** körs på den leverantör som en AI-regel väljer, annars på en av ditt projekts egna leverantörer, annars på serverns egen.
- **Fråga AI** körs på den leverantör som valts i chatten, annars på ditt projekts standard.

En självhostad modell kör dem alla: Ollama, vLLM eller valfri OpenAI-kompatibel slutpunkt som du lägger till under **Projektinställningar → AI → LLM-leverantörer**. På en server utan nätverksåtkomst är den vLLM som följer med Helm-diagrammet serverns egen leverantör, så ingenting lämnar servern.

### Med AI avstängd

Med **Aktivera AI** avstängt under **Projektinställningar → AI → AI-funktioner** skickar OneUptime AI ingenting, och Datasäkerhet fortsätter att fungera som förut: varje sida, kontroll, skanning och integration. Ingen AI-knapp visas på ett problem, och inget fält efterfrågas efter en skanning.

## Hur det mäts

Varje AI-funktion i Datasäkerhet mäts på en fast uppsättning påhittade fall, byggda så som funktionen bygger sin indata och bedömda efter vad ett rätt svar säger: en förklaring som nämner åtgärden och inte upprepar något som ett datalagers namn sa åt den att säga, rätt datatyp för varje fält, en åtgärd som ändrar det som kontrollen behöver och inget annat, och ett svar utifrån det som Fråga AI läste. Fallen körs mot en fastlåst modell varje natt, vid varje ändring av en AI-prompt i Datasäkerhet och före varje release, som kräver att varje funktion når sin tröskel.

För att mäta din egen modell på samma fall kör du utvärderingen från en utcheckning av OneUptime, med din modells nyckel, om den behöver en, i `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Nästa steg

:::cards
- [Integrationer för Datasäkerhet](/docs/data-security/integrations): Vad Förklara med AI och Åtgärda med AI gör på ett problem.
- [LLM-leverantörer](/docs/ai/llm-provider): Lägg till din egen modell, även en självhostad.
- [Känsliga datatyper](/docs/data-security/data-types): Hur fälten som ingen detektor kunde placera föreslås.
- [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues): Vad varje problem betyder, och hur du åtgärdar det.
:::
