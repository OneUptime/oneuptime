# Drop-filter och scrub-regler

Drop-filter och scrub-regler verkar på dina loggar och spans när de kommer in, innan något lagras. Ett drop-filter kastar de poster du aldrig behöver, eller behåller bara ett stickprov av dem. En scrub-regel maskerar personuppgifter och hemligheter, som e-postadresser, kortnummer och lösenord, så att de aldrig når din lagring.

:::cards
- [Var de körs](#var-de-körs): Före pipelines, före lagring.
- [Kassera poster eller ta stickprov](#kassera-poster-eller-ta-stickprov): Välj ut poster och kassera dem eller behåll en andel.
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
- **En roll som ändrar telemetriinställningar.** Project Owner eller Project Admin, eller en anpassad roll med behörighet för det du ändrar, till exempel Create Log Drop Filter eller Create Trace Scrub Rule. Telemetry-rollerna kan se filter och regler, men inte ändra dem.

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
> En kasserad post går inte att få tillbaka. Håll ett filters fråga smal, och håll ett öga på dess **Dropped**-räknare efter att du har skapat det.

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
| **IP-adress** | IPv4-adresser, till exempel `192.168.1.1` |
| **Sensitive Attribute Keys** | Hela värdet av varje attribut vars nyckel ser hemlig ut, till exempel `password`, `token`, `api_key`, `authorization` eller `cookie` |
| **Anpassad regex** | Ditt eget reguljära uttryck, skrivet utan snedstreck eller flaggor, och matchat med hänsyn till skiftläge |

| Rensningsåtgärd | Vad en träff blir |
| --- | --- |
| **Maskera** | `[REDACTED]`, standardvalet |
| **Mask** | Mestadels dold: en e-postadress behåller sin första bokstav och slutet av sin domän, ett kort-, telefon- eller socialförsäkringsnummer sina fyra sista siffror, och en anpassad träff eller ett hemligt värde sitt första och sista tecken. En IP-adress döljs helt. |
| **Hash** | En kort hash av värdet, samma för samma värde varje gång, så att upprepningar fortfarande kan räknas |

Till exempel lagrar en **E-postadress**-regel den här loggkroppen:

```text
Payment failed for jane@example.com
```

som en av dessa, beroende på dess **Rensningsåtgärd**:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:8c87b489]
```

**Fält att rensa** är **Båda (brödtext och attribut)** för en loggregel, om du inte väljer **Endast brödtext** eller **Endast attribut**, och **Alla (namn, attribut och händelser)** för en span-regel, om du inte väljer **Endast span-namn**, **Endast attribut** eller **Endast händelseattribut**. En **Sensitive Attribute Keys**-regel rensar alltid attributvärden, eftersom den läser attributnycklar.

- **Undantag kommer från den rensade posten.** Ett undantag som hittas i en loggpost skapas efter rensningen, och reglerna som rensar span-händelser rensar också de undantag som registrerats på dem.
- **Session Replays rensas också.** Scrub-regler för loggar körs också över Session Replay-inspelningar, utöver den maskering som inspelaren gör i webbläsaren.
- **Regler körs i listans ordning.** Varje regel ser det som reglerna före den lämnade kvar.
- **Ett anpassat mönster tar tid i förhållande till posten.** Det behåller JavaScripts syntax och svar, lookaheads och lookbehinds inräknade, hur det än är skrivet. En bakåtreferens, som `\1`, kan inte köras på det sättet: en regel med en sådan avvisas när du sparar den, liksom ett mönster som är för stort för att köras. Om det skulle krävas att ett långt värde lästes om och om igen för att hitta varje träff, rensar regeln hela värdet. Ett projekts drop-filter, scrub-regler och pipelines delar också en arbetskvot för varje sats det skickar, i förhållande till satsens storlek: när deras mönster behöver mer rensar en anpassad scrub-regel hela värdet, och ett filter som inte kan besvaras gäller inte för posten.

## Se vad ett filter kasserade

Listan **Drop-filter** visar för varje filter dess **Dropped**-räknare och när det senast kasserade något, **Last Dropped**. **Nothing dropped yet** betyder att det aldrig har matchat. Ett filters egen sida visar samma sak under **Aktivitet**, uppdaterat inom en minut efter en kassering. Dess kort **Filtervillkor** visar vad det väljer ut, och där kan du ändra villkoren.

## Felsökning

:::details Ett drop-filter kasserar ingenting
**är lika med**, **är inte lika med** och **är en av** jämför exakt text, inklusive stora och små bokstäver. Allvarlighetsgraderna heter `Information` och `Warning`, inte `INFO` eller `WARN`. Kontrollera att filtret är aktiverat, och vänta en minut efter en ändring.
:::

:::details Loggar som jag väntade mig saknas
Titta på **Dropped**-räknaren och tiden för **Last Dropped** för varje drop-filter. Stäng av **Aktiverad** på det du misstänker, så kommer nästa loggar in igen.
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
