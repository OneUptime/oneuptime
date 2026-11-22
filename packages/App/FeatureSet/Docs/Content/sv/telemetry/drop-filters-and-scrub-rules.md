# Drop-filter och scrub-regler

Drop-filter och scrub-regler verkar på dina loggar och spans när de kommer in, innan något lagras. Ett drop-filter kastar de poster du aldrig behöver, eller behåller bara ett stickprov av dem. En scrub-regel maskerar personuppgifter och hemligheter, som e-postadresser, kortnummer och lösenord, så att de aldrig når din lagring.

:::cards
- [Var de körs](#var-de-körs): Före pipelines, före lagring.
- [Kassera poster eller ta stickprov](#kassera-poster-eller-ta-stickprov): Välj ut poster och kassera dem eller behåll en andel.
- [Vad ett filter skulle ta](#vad-ett-filter-skulle-ta): Vad som läser posterna, innan du sparar det.
- [Rensa känsliga data](#rensa-känsliga-data): Maskera, dölj delvis eller hasha det ett mönster hittar.
- [Se vad ett filter kasserade](#se-vad-ett-filter-kasserade): Räknare på varje filter.
:::

## Var de körs

Loggar har sina under **Loggar → Inställningar**, och spans under **Spår → Inställningar**. När en post kommer in kör OneUptime dem i den här ordningen:

```mermaid title="Vad som händer med en loggpost eller ett span när den kommer in"
flowchart TB
    arrive["En loggpost eller<br/>ett span kommer in"] --> drop{"Kasserar ett<br/>drop-filter den?"}
    drop -->|"Ja"| gone["Kasserad:<br/>aldrig lagrad"]
    drop -->|"Nej"| scrub["Scrub-regler<br/>maskerar det<br/>de hittar"]
    scrub --> pipelines["Pipelines ändrar<br/>posten"]
    pipelines --> stored["Lagrad, redo<br/>att sökas i"]
```

- **De verkar bara på nya poster.** En regel som du skapar eller ändrar gäller för poster som kommer in ungefär en minut senare. Poster som redan är lagrade ändras inte.
- **En kasserad post är borta.** Ingen sökning, graf, övervakning eller inspelningsregel ser den någonsin, och inget undantag skapas från den. På OneUptime Cloud faktureras den inte heller.
- **Varje lista körs i ordning.** Dra raderna i en lista för att ändra ordningen. Bara aktiverade filter och regler körs.

Drop-filter och scrub-regler för loggar gäller lika för loggar från OpenTelemetry, Syslog, Fluent Bit och Fluentd. [Loggpipelines](/docs/telemetry/log-pipelines) förklarar steget efter dem.

## Innan du börjar

- **Loggar eller spans som kommer in.** Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- **En roll som ändrar telemetriinställningar.** Projektägare eller Projektadministratör, eller en anpassad roll med behörighet för det du ändrar, till exempel Create Log Drop Filter eller Create Trace Scrub Rule. Telemetry-rollerna kan se filter och regler, men inte ändra dem.

## Kassera poster eller ta stickprov

:::steps
### Öppna drop-filter

Gå till **Loggar → Inställningar → Drop-filter**, eller till **Spår → Inställningar → Drop-filter** för spans.

### Välj ut posterna

Klicka på **Skapa Logg Drop Filter**, eller på **Skapa Spår-droppfilter** för spans. Under **Matcha** ger du filtret ett **Namn** och bygger sedan dess **Filterfråga**: ett fält, en operator och ett värde för varje villkor, och om **Alla villkor** eller **Minst ett villkor** måste matcha. Klicka på **Nästa**.

### Välj åtgärden

Under **Åtgärd** behåller du **Kassera** för att kasta varje matchande post, eller väljer **Stickprov** och anger den **Stickprovsprocent** som ska behållas, från 1 till 99. Skapa sedan filtret.
:::

Filtret börjar kassera inom en minut. För att spara det utan att kassera något ännu stänger du av **Aktiverad** under **Avancerad** innan du skapar det.

> [!WARNING]
> En kasserad post går inte att få tillbaka. Håll ett filters fråga smal, och håll ett öga på dess **Kasserade**-räknare efter att du har skapat det.

Ett filter kan testa de här fälten, och vilket attribut som helst med **Custom Attribute...**:

| Poster | Fält |
| --- | --- |
| Loggar | **Allvarlighetsgrad**, **Loggkropp**, **Tjänste-ID** |
| Spans | **Span-namn**, **Span-typ**, **Status**, **Statusmeddelande**, **Tjänste-ID**, **Har undantag**, **Är rotspann** |

| Operator | Matchar |
| --- | --- |
| **är lika med** | Det exakta värdet, med sina stora och små bokstäver: `Debug` matchar, `DEBUG` gör det inte. |
| **är inte lika med** | Allt utom det exakta värdet. |
| **innehåller** | Värdet var som helst i fältet, oavsett skiftläge. Ett `%` i värdet är ett jokertecken. |
| **är en av** | Ett av en lista med exakta värden, åtskilda med kommatecken. |

**Preview query** visar frågan som villkoren bildar. Den här kasserar en hälsokontrolls felsökningsrader:

```text
severityText = 'Debug' AND body LIKE 'healthcheck'
```

Stickprov avgörs post för post: med en **Stickprovsprocent** på 10 behålls ungefär en av tio matchande poster. Filtren körs i listans ordning, och det första som kasserar en post avgör; en post som ett stickprov behåller går vidare till nästa filter.

## Vad ett filter skulle ta

En kasserad post är borta för allt som läser den, så medan du skriver ett drop-filter säger dess formulär vad det skulle ta, en stund efter att du slutat skriva: i steget **Matcha** under **Filterfråga**, och i steget **Åtgärd** under åtgärden. En rad säger den viktigaste effekten, och **Visa detaljer** säger resten:

- **Hur mycket det matchar.** Hur många av de poster som lagrades det senaste dygnet som matchar: det filtret håller borta från din lagring och från din faktura. Det räknas på det som lagrades, efter att scrub-regler och pipelines ändrat det, och bara över de tjänster vars poster du kan läsa. En räkning som tar längre tid än 10 sekunder stoppas, och formuläret säger det.
- **Vad Säkerhetshändelser skulle förlora.** Där [Säkerhetshändelser](/docs/telemetry/security-events) läser dina loggar med kortet **Dina loggar**, eller dina spans, säger formuläret hur många av de matchande posterna den läste: de inloggningar, attacker och brandväggsposter den gör till händelser. Ett filter med **Stickprov** nämner också de regler som utlöses vid ett antal, och vad det gör med dem att filtret bara behåller sin andel: vid 10 % behöver en regel som utlöses vid 10 misslyckade inloggningar på fem minuter ungefär 100, så den utlöses mycket mer sällan, eller aldrig.
- **Vad mer som läser samma poster.** De monitorer, SLO:er, instrumentpaneler med sina widgets, inspelningsregler och sparade vyer vars frågor kan ta med en post som filtret tar. En fråga läser dem när den läser samma sorts post, från en tjänst som filtret kan ta från, och inget den låser till ett exakt värde utesluter filtret: ett filter för loggar på nivån **Felsökning** lämnar en monitor för fel i fred, och ett filter för en tjänst lämnar en annan tjänsts SLO i fred. Allt formuläret inte kan utesluta, som en sökning i loggkroppen, räknas som att läsa dem. Var och en är en länk, och de du inte kan öppna räknas, men namnges aldrig.

När något läser det ett filter tar, ber formuläret dig bekräfta när du skapar filtret, aktiverar det eller ändrar frågan eller åtgärden för ett filter som är aktivt. Du kan ändå spara filtret: du tillfrågas bara för att du ska kunna bestämma dig med vetskap om det. Ett filter som inget läser sparas utan att du tillfrågas.

Via API:t ställs ingen fråga, eftersom ett skript eller Terraform inte har någon som kan svara. Ett filter som skapas eller ändras via API:t sparas, och när det tar något som andra läser har svaret headern `X-OneUptime-Write-Warning`, som säger det i antal, och som Terraform-providern visar som en varning. För att fråga först skickar du filtrets `filterQuery`, `action` och `samplePercentage` till `POST /api/telemetry/logs/drop-filter-impact`, eller till `/api/telemetry/traces/drop-filter-impact` för spans: svaret innehåller allt formuläret visar.

De OpenStack-filter som OneUptime lägger till i ett projekt behåller varje rad som Säkerhetshändelser läser, så länge de är som OneUptime skapade dem. Ändrar du ett av dem kasserar det allt det matchar, som ett eget filter.

## Rensa känsliga data

:::steps
### Öppna scrub-regler

Gå till **Loggar → Inställningar → Scrub-regler**, eller till **Spår → Inställningar → Scrub-regler** för spans.

### Välj vad som ska hittas

Klicka på **Skapa Logg Scrub Regel**, eller på **Skapa Trace Scrub Regel** för spans, och välj en **Mönstertyp**. Regeln får namn efter den, till exempel **Rensa e-postadresser**, tills du skriver ett eget namn. För **Anpassad regex** anger du också **Anpassat regex-mönster**.

### Välj hur det ska rensas

Under **Avancerad** väljer du **Rensningsåtgärd** och **Fält att rensa**, eller låter dem vara som de är: en ny regel ersätter varje träff med `[REDACTED]`, var den än finns i posten. Skapa sedan regeln.
:::

| Mönstertyp | Vad den hittar |
| --- | --- |
| **E-postadress** | E-postadresser, till exempel `jane@example.com` |
| **Kreditkortsnummer** | Sexton siffror i grupper om fyra, till exempel `4111 1111 1111 1111` |
| **Personnummer (Social Security Number)** | Amerikanska socialförsäkringsnummer, till exempel `123-45-6789` |
| **Telefonnummer** | Nordamerikanska telefonnummer, till exempel `555-123-4567` |
| **IP-adress** | Offentliga IPv4- och IPv6-adresser, till exempel `203.0.113.7` eller `2001:db8::1`, men inte privata, loopback- eller länklokala adresser |
| **Känsliga attributnycklar** | Hela värdet av varje attribut vars nyckel ser hemlig ut, till exempel `password`, `token`, `api_key`, `authorization` eller `cookie` |
| **Anpassad regex** | Ditt eget reguljära uttryck, skrivet utan snedstreck eller flaggor, och matchat med hänsyn till skiftläge |

| Rensningsåtgärd | Vad en träff blir |
| --- | --- |
| **Maskera** | `[REDACTED]`, standardvalet |
| **Mask** | Mestadels dold: en e-postadress behåller sin första bokstav och slutet av sin domän, ett kort-, telefon- eller socialförsäkringsnummer sina fyra sista siffror, och en anpassad träff eller ett hemligt värde sitt första och sista tecken. En IP-adress döljs helt. |
| **Hash** | En token som är unik för ditt projekt, samma för samma värde varje gång, så att upprepningar fortfarande kan räknas, men ingen kan räkna ut värdet |

Till exempel lagrar en **E-postadress**-regel den här loggkroppen:

```text
Payment failed for jane@example.com
```

som en av dessa, beroende på dess **Rensningsåtgärd**:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:5e29db14e508e09a]
```

**Fält att rensa** är **Båda (brödtext och attribut)** för en loggregel, om du inte väljer **Endast brödtext** eller **Endast attribut**, och **Alla (namn, attribut och händelser)** för en span-regel, om du inte väljer **Endast span-namn**, **Endast attribut** eller **Endast händelseattribut**. Attributen på ett spans länkar rensas tillsammans med spanets egna attribut, och **Alla (namn, attribut och händelser)** rensar också ett spans statusmeddelande och namnen på dess händelser. En **Känsliga attributnycklar**-regel läser nycklar och rensar därför alltid värdena under dem: i attribut och i en loggposts JSON-brödtext.

- **En regel kan gälla för en tjänst.** Välj tjänsten under **Avancerad** i **Endast för en tjänst**: regeln rensar den tjänstens poster, och andra tjänsters förblir som de är. Lämnas fältet tomt rensar den alla tjänsters poster. Kolumnen **Omfattning** i listan säger vilken.
- **Formuläret säger vad en regel skulle ändra för andra.** Innan du skapar en regel, och när du aktiverar en, visar OneUptime vad som läser värdena den skulle dölja: monitorer, instrumentpaneler, sparade vyer, inspelningsregler och SLO:er, var och en som en länk, och vad [Säkerhetshändelser](/docs/telemetry/security-events) skulle förlora. En monitor som filtrerar på ett dolt värde hittar det inte längre. Regeln sparas oavsett.
- **En IP-adressregel döljer de adresser som är personuppgifter.** Det är offentliga IPv4- och IPv6-adresser, hur de än skrivs: förkortade, som `2001:db8::1`, inom hakparenteser med en port, som `[2001:db8::1]:443`, som behåller hakparenteserna och porten, med en zon, som `2001:db8::2%eth0`, som behåller zonen, eller en IPv4-adress skriven som IPv6, som `::ffff:203.0.113.7`, som döljs helt. Den behåller privata, loopback- och länklokala adresser, till exempel `10.0.0.12`, `127.0.0.1` och `fe80::1`, och molnets metadataadress `169.254.169.254` i en begärans URL, där [Säkerhetshändelser](/docs/telemetry/security-events) letar efter förfalskade begäranden från servern. För att också dölja interna adresser lägger du till en regel med **Anpassad regex** för dem, till exempel `\b(?:\d{1,3}\.){3}\d{1,3}\b` för alla IPv4-adresser.
- **En hash-token är ditt projekts egen.** Den skapas med en nyckel som hör till ditt projekt, härledd från installationens `ENCRYPTION_SECRET`, så att samma värde har en annan token i ett annat projekt, och ingen som läser en token kan räkna ut värdet eller hasha en gissning för att jämföra. En IP-adress har en token hur den än skrivs: `::ffff:203.0.113.7` och `203.0.113.7` delar en. Poster som sparades innan tokens hade en nyckel innehåller tokens på 8 tecken, till exempel `[HASHED:8c87b489]`, som skiljer sig från dagens på 16 tecken: sök efter båda tills de posterna når slutet av sin lagringstid. Att ändra `ENCRYPTION_SECRET` ändrar alla tokens, och i en egen installation är tokens bara så hemliga som den.
- **Säkerhetshändelser kan fortfarande namnge en hashad IP-adress.** När [Säkerhetshändelser](/docs/telemetry/security-events) läser dina loggar eller spårningar sparar en IP-adressregel som hashar också varje adress den döljer bredvid dess token, i ett lager som bara Säkerhetshändelsers skanningar läser: ingen sida, sökning, export, API eller AI-verktyg kan läsa det. Så en attack från en adress som dina loggar bara visar som en token namnger ändå adressen, och dess ärende säger vilken adress som ska blockeras. Varje adress sparas till 30 dagar efter att den senast sågs. En regel som raderar eller maskerar adressen sparar ingenting, så Säkerhetshändelser säger då att en scrub-regel dolde adressen, som den gör för en token som är äldre än 30 dagar eller skapad innan tokens hade en nyckel.
- **Listor och nästlade värden läses också.** En regel läser varje text i en lista, en lista av listor eller en nyckel-värde-lista, till exempel värdena i en HTTP-header, och behåller värdets form: tal och sant eller falskt förblir som de är. En **Känsliga attributnycklar**-regel läser också nycklarna inuti ett värde, så `password` inuti en nyckel-värde-lista döljs också. Brödtexten i en loggpost som skickas som en map eller en lista lagras som sin JSON-text, och en **Känsliga attributnycklar**-regel läser nycklarna i den, som i en brödtext skriven som JSON. En mönsterregel håller en sådan brödtext som JSON, och även ett attribut skrivet som JSON, till exempel meddelandena i ett AI-anrop: Den läser texten så som ditt program skrev den, med en escape-sekvens som `\n` läst som den radbrytning den står för, och ersätter det den hittar bara inuti dess texter och tal.
- **JSON i en text läses också.** En text som själv är JSON, till exempel ett attribut `http.request.body` som innehåller `{"password":"hunter2"}`, eller `log`-raden i en Fluentd-post inuti en loggposts brödtext, läses som JSON, upp till 4 nivåer av JSON inuti varandra, och djupare som text. En **Känsliga attributnycklar**-regel döljer värdena under de nycklar i den som ser hemliga ut, och inget annat: Dess tal, mellanslag och andra texter förblir som ditt program skrev dem. En text som bara liknar JSON, till exempel `{token}`, lämnas som den är.
- **Ett värde som är för stort för att läsas element för element läses som text.** Ett värde som är nästlat mer än 32 nivåer djupt, eller som skulle ta en post över 10 000 värden i dess listor och maps, läses och lagras som sin JSON-text. En mönsterregel rensar det den hittar i den texten, och en **Känsliga attributnycklar**-regel döljer hela värdet när ett ord som `password` eller `token` förekommer i det. I en loggposts brödtext, och i JSON i en text, läses bara delen bortom dessa gränser som text: Resten läses fortfarande nyckel för nyckel.
- **Undantag kommer från den rensade posten.** Ett undantag som hittas i en loggpost skapas efter rensningen, och reglerna som rensar span-händelser rensar också de undantag som registrerats på dem. Varje undantag grupperas fortfarande efter vad det sa före rensningen, så en ny regel gör aldrig ett undantag du redan har till ett nytt och utlöser inte **Nytt undantag** för det igen. När en regel döljer en del av det som ett nytt undantag grupperas efter skapas dess fingeravtryck med en nyckel som hör till ditt projekt, som en hash-token, så att ingen kan räkna ut det som doldes.
- **En syslog-rads råa kopior döljer det som reglerna dolde i dess delar.** Syslog behåller den strukturerade datan i en RFC 5424-rad som den kom i `syslog.structured.raw`, och syslog som skickas över HTTP behåller hela raden i `syslog.raw`. Varje kopia sätts ihop på nytt av det som reglerna lämnade kvar av headerns fält, varje parameter i den strukturerade datan och meddelandet, och reglerna läser den sedan som de läser vilket attribut som helst. Så ett lösenord som en **Känsliga attributnycklar**-regel döljer i `syslog.structured.auth_1.password`, eller en adress som en **Endast brödtext**-regel döljer i meddelandet, är dolt även i kopiorna, skrivet som RFC 5424 skriver ett värde: `password="[REDACTED\]"`. En rad som reglerna inte ändrar något i behåller sina kopior som den kom.
- **En posts sessions-ID behålls.** En **Känsliga attributnycklar**-regel döljer en inloggningssession, till exempel en `session_id`, en `sessionid` eller en cookie, men behåller `session.id` när den innehåller den session som loggposten eller spannet hör till: det slumpmässiga ID som [Session Replay](/docs/telemetry/session-replay) arkiverar posten under, och som posten ändå behåller som sin session. Konversations-ID:t för ett AI-anrop behålls på samma sätt. Skicka inte en inloggningssessions hemlighet som `session.id`.
- **Session Replays rensas också.** Scrub-regler för loggar som gäller för alla tjänster körs också över Session Replay-inspelningar, utöver den maskering som inspelaren gör i webbläsaren.
- **Regler körs i listans ordning.** Varje regel ser det som reglerna före den lämnade kvar.
- **Ett anpassat mönster tar tid i förhållande till posten.** Det behåller JavaScripts syntax och svar, lookaheads och lookbehinds inräknade, hur det än är skrivet. En bakåtreferens, som `\1`, kan inte köras på det sättet: en regel med en sådan avvisas när du sparar den, liksom ett mönster som är för stort för att köras. Om det skulle krävas att ett långt värde lästes om och om igen för att hitta varje träff, rensar regeln hela värdet. Ett projekts drop-filter, scrub-regler och pipelines delar också en arbetskvot för varje sats det skickar, i förhållande till satsens storlek och tillräcklig för att dussintals anpassade mönster ska kunna läsa varje värde. När deras mönster behöver mer rensar en anpassad scrub-regel hela värdet, och ett filter som inte kan besvaras gäller inte för posten.

## Se vad ett filter kasserade

Listan **Drop-filter** visar för varje filter dess **Kasserade**-räknare och när det senast kasserade något, **Last Dropped**. **Nothing dropped yet** betyder att det aldrig har matchat. Ett filters egen sida visar samma sak under **Aktivitet**, uppdaterat inom en minut efter en kassering. Dess kort **Filtervillkor** visar vad det väljer ut, och där kan du ändra villkoren.

## Felsökning

:::details Ett drop-filter kasserar ingenting
**är lika med**, **är inte lika med** och **är en av** jämför exakt text, inklusive stora och små bokstäver. Allvarlighetsgraderna heter `Information` och `Warning`, inte `INFO` eller `WARN`. Kontrollera att filtret är aktiverat, och vänta en minut efter en ändring.
:::

:::details Loggar som jag väntade mig saknas
Titta på **Kasserade**-räknaren och tiden för **Last Dropped** för varje drop-filter. Stäng av **Aktiverad** på det du misstänker, så kommer nästa loggar in igen.
:::

:::details En anpassad scrub-regel säger Rensar ingenting
Dess mönster är tomt, inte ett giltigt reguljärt uttryck eller kan inte köras, till exempel för att det har en bakåtreferens som `\1`, så den rensar ingenting. Redigera regeln och ge den ett mönster som matchar minst ett tecken.
:::

:::details Gamla poster visar fortfarande data som en ny regel rensar
Scrub-regler verkar när poster kommer in. Poster som lagrades före regeln behåller det de hade tills deras lagringstid tar slut. Se [Datalagring](/docs/telemetry/data-retention).
:::

## Nästa steg

:::cards
- [Loggpipelines](/docs/telemetry/log-pipelines): Tolka och berika de loggar du behåller.
- [Loggutforskare](/docs/telemetry/logs-explorer): Sök i det som lagrades.
- [Spårutforskare](/docs/telemetry/traces-explorer): Följ de spans du behåller.
- [Datalagring](/docs/telemetry/data-retention): Bestäm hur länge de sparas.
:::
