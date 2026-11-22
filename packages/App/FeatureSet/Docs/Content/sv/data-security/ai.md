# OneUptime AI i Datasäkerhet

OneUptime AI arbetar med det som Datasäkerhet har hittat, utan att se dina data. Den får namn, former, antal och konfiguration, aldrig ett värde från dina data, ett maskerat prov, en post eller en anslutningssträng. Varje funktion körs på ditt projekts egen modell, även en självhostad, och varje sida, kontroll, skanning och integration i Datasäkerhet fungerar med AI avstängd.

:::cards
- [På egen hand](#på-egen-hand): Vad den gör med varje nytt problem, vad som väntar på dig och AI-reglerna.
- [Vad OneUptime AI ser](#vad-oneuptime-ai-ser): Vad varje funktion skickar, och vad den aldrig skickar.
- [Se det själv](#se-det-själv): Den exakta indata som ett av dina problem skulle skicka.
- [Din egen modell](#din-egen-modell): Varje funktion på ditt projekts leverantör, Ollama, vLLM eller valfri OpenAI-kompatibel slutpunkt.
- [Hur det mäts](#hur-det-mäts): Varje funktion på fasta fall, före varje release.
:::

## På egen hand

Med **Arbeta med nya problem** påslaget under **Datasäkerhet → AI**, som det är för nya projekt, arbetar OneUptime AI på egen hand med varje nytt kritiskt eller högt problem. Den skriver analysen av varje sådant problem, och av varje som öppnas igen, som **Analysera problemet** gör och utifrån det som det skickar, innan någon öppnar det, och skriver bara om den när det den bygger på har ändrats. För ett telemetriproblem föreslår den de rensningsregler som döljer dess data i ny telemetri. Ett förslag väntar på den sidan under **Väntar på dig**, de mest riskfyllda först, med vad som ändras, varför, hur det bevisas och hur det ångras. **Godkänn** gör ändringen med dina egna behörigheter: en rensningsregel kräver behörighet att skapa loggrensningsregler, spårrensningsregler eller pipelineregler för mätvärden. **Avfärda förslaget** säger nej, med en motivering som läggs på problemets tidslinje. Problemets egen kontroll avgör om en ändring fungerade: datalagret kontrolleras igen, och problemet löses när inga av dess data finns kvar.

OneUptime AI föreslår också ägare för datalager som saknar ägare, utifrån det som redan pekar på dem: datalagrets molntaggar, tjänsterna som använder det och deras ägare, kodägarna för filen som deklarerar det, vem som ändrade det enligt molnets ändringslogg och vem som lade till det i OneUptime. Den nämner bara ditt eget projekts team och personer, säger hur säker den är och säger var bevisen går isär. Förslaget för ett känsligt datalager kommer med dess problem **Ingen äger detta känsliga datalager**, och andra nya datalager får sitt en gång om dagen och när en molnanslutning läses för första gången. När ägarna till tre eller fler datalager vilar på samma tagg eller samma början på namnet föreslår den också den ägarregel som håller nästa liknande datalager med en ägare, och säger hur många datalager regeln skulle matcha. Förslagen väntar under **Ägare att granska**, på den här sidan och under **Datalager**: **Godkänn** lägger till ägarna med dina egna behörigheter, och de får besked som alla ägare; **Ändra och godkänn** väljer andra ägare först; **Ångra** tar tillbaka exakt de ägare som lades till, och regeln med dem. Att lägga till en ägare ändrar vem som får besked, så det väntar alltid på dig, vad en AI-regel än säger.

Som standard frågar OneUptime AI före varje ändring, utom en som bara döljer data, kan ångras och är bevisat säker, och den tar aldrig bort data eller larmar någon utan att fråga. En ändring som den gjorde utan att fråga visas under **Gjort av AI**, med **Ångra**. **Varför AI inte agerade** listar de problem som den tittade på och lät vara, och varför. Varje förslag, godkännande, avfärdande och ångrande finns på problemets och datalagrets **Tidslinje**. Med reglaget avstängt fungerar Datasäkerhet som vanligt, och **Analysera problemet** och **Åtgärda med AI** fungerar fortfarande när du trycker på dem; med AI avstängt för projektet fungerar ingen av dem.

På ett problems sida visar kortet **OneUptime AI** ovanför **Så åtgärdar du det** analysen och det som föreslogs för problemet, med samma knappar. Datasäkerhetens **Översikt** säger hur många läckor OneUptime AI begränsade den här veckan och hur många förslag som väntar på dig. **Anteckningar för OneUptime AI** räknar vecka för vecka vad ändringarna ledde till: se [Hur bra OneUptime AI klarar sig](/docs/ai/ai-sre#hur-bra-oneuptime-ai-klarar-sig).

### AI-regler

Under **AI-regler** på **Datasäkerhet → AI** säger en regel vilka problem OneUptime AI arbetar med - efter kontroll eller kontrollgrupp, allvarlighetsgrad, och datalagrets känslighet, typ, leverantör, miljö, etiketter, datakategorier och tjänst - och för varje typ av arbete, **Analysera**, **Begränsa**, **Åtgärd** och **Bedöm**, om den är **Av**, **Föreslå** (den föreslår och väntar på dig) eller **Utan att fråga**. När flera regler matchar ett problem körs en typ av arbete om någon av dem slår på den, och **Föreslå** går före **Utan att fråga**. Varje förslag säger vilken regel som avgjorde det. Utan regel gäller projektets standarder: analysera kritiska och höga problem, och föreslå allt annat.

AI-regler hör till hela projektet, som AI-reglerna för incidenter och larm: projektägare och projektadministratörer ändrar dem, liksom alla som har fått behörigheterna för AI-regler. Säkerhetsrollerna ser vad OneUptime AI föreslog och gjorde, men inte reglerna.

## Vad OneUptime AI ser

Ingen funktion skickar någonsin till en modell:

- ett värde från dina data;
- ett maskerat prov, som `j***@e******.com`: en maskerad e-postadress bär fortfarande en domän, och ett maskerat kort sina fyra sista siffror;
- en post i din telemetri: en loggrad, ett span eller en session;
- en anslutningssträng, en nyckel eller någon annan hemlighet.

Datasäkerhet läser själv dina data, i sina skanningar, och sparar ingenting av dem. Det som den skickar till OneUptime AI byggs på ett enda ställe, utifrån en lista över vad som får skickas, och ett test misslyckas när en funktion skickar något annat till en modell.

| Funktion | Vad den skickar | Körs av sig själv |
| --- | --- | --- |
| **Analys på begäran** | Problemets titel, allvarlighetsgrad och bevis, varför dess kontroll spelar roll och stegen som åtgärdar det; lagrets namn, typ, region, taggar och konfiguration, dess känslighet, namnen på dess datatyper och ungefär hur många poster det innehåller; vem som kan nå lagret: varje behörighets identitet, nivå och hur den beviljas, och ungefär när den senast användes, och de tjänster som setts använda det; kopior av dess data i andra lager, dess säkerhetsärenden, den responsåtgärd som åtgärdar problemet, och det repository och de filer som deklarerar det; hur många ägare lagret har, aldrig vilka de är; för ett telemetriproblem, var varje typ av data hittades: attributet, loggtexten eller prompten som den finns i | Nej: en person frågar, på ett problems sida, eller med Förklara med AI via API:et eller MCP-servern |
| **Analys av nya problem** | Problemets titel, allvarlighetsgrad och bevis, varför dess kontroll spelar roll och stegen som åtgärdar det; lagrets namn, typ, region, taggar och konfiguration, dess känslighet, namnen på dess datatyper och ungefär hur många poster det innehåller; vem som kan nå lagret: varje behörighets identitet, nivå och hur den beviljas, och ungefär när den senast användes, och de tjänster som setts använda det; kopior av dess data i andra lager, dess säkerhetsärenden, den responsåtgärd som åtgärdar problemet, och det repository och de filer som deklarerar det; hur många ägare lagret har, aldrig vilka de är; för ett telemetriproblem, var varje typ av data hittades: attributet, loggtexten eller prompten som den finns i | Ja: ett nytt eller återöppnat problem med allvarlighetsgrad Kritisk eller Hög startar den, medan **Arbeta med nya problem** är påslaget |
| **Åtgärda med AI** | Problemet så som dess kontroll såg det, lagrets namn, typ, region och moln-ID, och för ett telemetriproblem var dess data hittades, som en begäran till kodagenten, som sedan läser repositoryts egen kod för att göra ändringen | Nej: en person frågar, i ett repository som personen får ändra i **Code** |
| **Förslag för fält som ingen detektor placerade** | Typen av datalager och de datatyper som AI får nämna; varje fälts namn, namnen på fälten bredvid och formerna på dess värden, varje bokstav som `a` eller `A` och varje siffra som `9`; hur många värden som lästes och hur långa de är | Ja: ett datalagers innehållsskanning startar dem |
| **Fråga AI** | De datalager, problem och den åtkomst som personen får läsa i Datasäkerhet; vad som hittades var, varje datatyp efter plats, med antal och konfidens | Nej: en person ställer en fråga |
| **Ägare för datalager** | Datalagrets namn, typ, leverantör, miljö och känslighet och namnen på dess datatyper; vad som pekar på en ägare: dess molntaggar, tjänsterna som använder det, kodägarna för filen som deklarerar det och ändringarna som gjorts i det; de team som bevisen nämner, med namn, och de personer de nämner, bara som numrerade kandidater, aldrig med namn eller e-postadress | Ja: Ett datalager utan ägare startar den, en gång om dagen för nya datalager och när en molnanslutning läses för första gången, medan **Arbeta med nya problem** är påslaget |

**Förklara med AI** och **Fråga AI** läser också först ditt teams [AI-kontext](/docs/ai/ai-context), när det finns en: anteckningarna som ditt team har skrivit åt OneUptime AI om era system. **Analys av nya problem** läser den också.

### Text som dina system skrev är data

Ett datalagers namn, dess moln-ID, dess taggar, bevisen som ett moln svarade med och ett attributs nyckel kommer från dina moln och din kod, så alla som kan namnge en bucket eller tagga en resurs skriver med på det som OneUptime AI läser. OneUptime AI får varje instruktion i ett eget meddelande, och den texten i ett andra meddelande, som data:

- varje text hålls till en längd och sätts på en rad, och det som ser ut som en hemlighet, en e-postadress eller en IP-adress utelämnas;
- text som läses som instruktioner till en AI, som ”ignore previous instructions”, markeras, och OneUptime AI uppmanas att aldrig följa den;
- ett strukturerat svar, som fältförslagens, läses strikt: det objekt som begärdes, eller inget svar.

### Vad som sparas

Varje anrops rad i **Projektinställningar → AI → AI-loggar** säger vilken funktion som anropade vilken modell, dess token och dess kostnad. Den sparar aldrig vad som skickades eller besvarades: alla med rollen Projektmedlem eller Tittare läser AI-loggarna, och Datasäkerhets poster är till för deras ägare och säkerhetsrollerna. OneUptimes egen telemetri registrerar inte heller någonsin vad Förklara med AI eller fältförslagen skickade, inte ens där serverns operatör registrerar vad andra AI-anrop skickar. Själva analysen sparas på sitt problem, för alla som får läsa problemet, och en rad som bygger på något som en läsare inte får läsa döljs för läsaren.

När ett anrop misslyckas sparar Förklara med AI och fältförslagen inte ett ord av leverantörens fel, som kan citera det som skickades. Kodagenten bakom Åtgärda med AI och chatten i Fråga AI sparar fortfarande ett misslyckat anrops leverantörsfel i dess rad.

Ägarförslagen sparar samma sak som Förklara med AI: Raderna för deras anrop nämner funktionen, modellen, tokens och kostnaden, aldrig vad som skickades eller svarades, och inte ett ord av ett misslyckat anrops fel.

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

Ägarförslagen bedöms på om de nämner den ägare som bevisen pekar på, väljer ingen när de inte pekar på någon, och är osäkra där bevisen går isär.

För att mäta din egen modell på samma fall kör du utvärderingen från en utcheckning av OneUptime, med din modells nyckel, om den behöver en, i `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

I ditt projekt räknar **Bedömningar som stämde** under **Projektinställningar → AI → AI-resultat** hur ofta det som personer beslutade om ett problem som OneUptime AI analyserade gick som dess bedömning sa: åtgärdat eller accepterat när den sa **Verkligt**, accepterat eller markerat som offentligt avsiktligt när den sa **Troligen avsiktligt**, och markerat som inte ett problem när den sa **Troligen ett felaktigt fynd**.

## Nästa steg

:::cards
- [Integrationer för Datasäkerhet](/docs/data-security/integrations): Vad Förklara med AI och Åtgärda med AI gör på ett problem.
- [LLM-leverantörer](/docs/ai/llm-provider): Lägg till din egen modell, även en självhostad.
- [Känsliga datatyper](/docs/data-security/data-types): Hur fälten som ingen detektor kunde placera föreslås.
- [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues): Vad varje problem betyder, och hur du åtgärdar det.
:::
