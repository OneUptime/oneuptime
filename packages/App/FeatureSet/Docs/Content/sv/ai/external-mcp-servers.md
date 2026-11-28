# Externa MCP-servrar

OneUptime AI kan använda verktygen på MCP-servrar utanför OneUptime – de som ditt moln, din kodvärd eller ditt eget team kör, till exempel AWS, Azure eller GitHub – i Fråga AI, i sina svar i Slack och Microsoft Teams och medan den utreder och åtgärdar incidenter och larm. Lägg till en server en gång under **Projektinställningar → AI → Externa MCP-servrar**, så använder OneUptime AI den från din nästa fråga och nästa incident.

:::cards
- [Lägg till en server](#lägg-till-en-server): Dess adress, och hur OneUptime loggar in.
- [Vad OneUptime AI gör med en server](#vad-oneuptime-ai-gör-med-en-server): Verktyg som läser i utredningar, de andra i åtgärder.
- [Markera ett verktyg som skrivskyddat](#markera-ett-verktyg-som-skrivskyddat): När servern inte säger något om det, som kAgents inte gör.
- [I Fråga AI](#i-fråga-ai): Be den lista en servers verktyg eller använda ett; en ändring väntar på ditt godkännande.
- [I Slack och Microsoft Teams](#i-slack-och-microsoft-teams): Verktygen som läser, för den som frågade.
- [Välj de servrar en regel får använda](#välj-de-servrar-en-regel-får-använda): Alla, om inte en regel väljer några.
- [Säkerhet](#säkerhet): Vad en server kan och inte kan få OneUptime AI att göra.
:::

Den här sidan handlar om servrar som OneUptime AI ansluter till. Om du i stället vill ansluta en AI-assistent som Claude eller Cursor till OneUptime, se [MCP-server](/docs/ai/mcp-server).

## Innan du börjar

- **OneUptime AI är påslaget** för projektet, med en LLM-leverantör som den kan använda: se [LLM-leverantörer](/docs/ai/llm-provider).
- **Serverns MCP-adress.** Både Streamable HTTP och det äldre HTTP med SSE fungerar: OneUptime tar reda på vilket servern talar när den ansluter.
- **Hur OneUptime loggar in på den:** en API-token, serverns egna headers eller OAuth-klientautentiseringsuppgifter från din identitetsleverantör.
- **En Project Owner eller en Project Admin** lägger till, ändrar, testar och tar bort servrar; Projektmedlemmar och Tittare kan se dem. På OneUptime Cloud krävs Growth-planen eller högre för att lägga till en server.

## Lägg till en server

:::steps
### Öppna Externa MCP-servrar
Gå till **Projektinställningar → AI → Externa MCP-servrar** och klicka på **Skapa Extern MCP-server**.

### Ange var den finns
Ge den ett **Namn**, det som OneUptime AI och de som läser vad den gjorde ser den under, och dess **URL**, till exempel `https://mcp.example.com/mcp`. Under **Fler fält** säger en **Beskrivning** vad servern är till för; OneUptime AI läser den för att välja rätt server.

### Välj hur OneUptime loggar in
Välj ett kort under **Autentisering** och fyll i det som det ber om (se [Autentisering](#autentisering)).

### Se vad OneUptime hittade
När du sparar ansluter OneUptime direkt och dialogrutan **Testa anslutningen** säger vad den hittade: servern, hur den kommunicerar och vart och ett av dess verktyg, märkt med **Endast läsning** eller **Kan ändra saker**. Kunde den inte ansluta säger dialogrutan varför och vad du ska kontrollera.
:::

Listan med servrar visar hur det går för var och en: **Ansluten**, **Kan inte ansluta** (håll pekaren över för orsaken), **Inte kontrollerad ännu** eller **Av**, och hur många verktyg den erbjuder. En servers sida visar dess detaljer, reglaget som låter OneUptime AI använda den och dess **Verktyg**, med **Testa anslutningen** för att ansluta igen och läsa dem på nytt. Ett test anropar inget av serverns verktyg.

## Autentisering

| Autentisering | Vad OneUptime skickar | Vad du fyller i |
| --- | --- | --- |
| **Ingen inloggning** | Ingenting | Ingenting. För en server som inte kräver inloggning, eller som bara ditt nätverk når. |
| **Bearer-token** | `Authorization: Bearer <token>` | **Token** |
| **Anpassade headers** | De headers du anger, med varje begäran | Ett namn och ett värde per header, till exempel `X-API-Key`. Högst 10. |
| **OAuth-klientautentiseringsuppgifter** | En token som den ber din identitetsleverantör om, som bearer-token, och ber om igen innan den löper ut | **Token-URL**, **Klient-ID** och **Klienthemlighet** i ett eget steg; **Omfattning** och **Målgrupp (audience)** under **Fler fält** |

Token, headervärdena och klienthemligheten lagras krypterade och visas aldrig igen, inte ens för dem som sparade dem. En redigering börjar med dem tomma; lämna ett fält tomt för att behålla det som är lagrat. Serverns sida visar namnen på de headers den skickar, aldrig deras värden. Om du ändrar **Autentisering** tas de hemligheter bort som det gamla inloggningssättet använde.

Lägg aldrig en token eller ett lösenord i **URL**: Alla som kan läsa servern läser dess adress, och ett användarnamn eller lösenord i den avvisas.

## Vad OneUptime AI gör med en server

Varje verktyg som en server erbjuder antingen bara läser eller kan ändra något. OneUptime går efter vad servern säger om verktyget (dess `readOnlyHint`): Ett verktyg som servern inte märker som skrivskyddat räknas som ett som kan ändra något, om inte en Projektadministratör markerar det som skrivskyddat (se [Markera ett verktyg som skrivskyddat](#markera-ett-verktyg-som-skrivskyddat)). Vissa servrar märker inget av sina verktyg: Tills någon markerar ett har en utredning inget av deras verktyg att använda, och i Fråga AI väntar varje anrop av ett sådant verktyg på ditt godkännande.

```mermaid title="Vilka verktyg OneUptime AI använder på egen hand, och när"
flowchart TB
    T["Ett verktyg på<br/>din MCP-server"] --> Q{"Läser det<br/>bara?"}
    Q -->|"ja"| R["Används i<br/>utredningar<br/>och åtgärder"]
    Q -->|"nej"| C["Används bara<br/>i åtgärder"]
    C --> A{"Regelns<br/>Godkännande"}
    A -->|"Fråga innan<br/>något åtgärdas"| P["Föreslås, så att<br/>en person kan<br/>godkänna den"]
    A -->|"Åtgärda utan<br/>att fråga"| M["Görs direkt,<br/>via servrarna<br/>som regeln<br/>nämner"]
```

| | Verktyg som bara läser | Verktyg som kan ändra något |
| --- | --- | --- |
| **Utredningar** | Används, tillsammans med OneUptimes egna data | Används aldrig: OneUptime avvisar anropet |
| **Åtgärder** | Används för att ta fram åtgärden | Föreslås för godkännande eller används direkt, så som **Åtgärd** i AI-regeln säger |
| **Fråga AI** | Används när du ber om det | Används när du har godkänt varje anrop |
| **Slack och Microsoft Teams** | Används när du ber om det | Används aldrig: Där finns inget godkännandekort, så OneUptime AI hänvisar dig till Fråga AI |

**I en utredning** listar OneUptime AI verktygen på de servrar den får använda och anropar dem som läser, för att titta på det som OneUptime inte själv ser: ditt molnkonto, en driftsättning, ett ärendesystem. Svaren använder den i sin rotorsaksanalys. Se [AI SRE](/docs/ai/ai-sre).

**I en åtgärd** tar OneUptime AI fram en åtgärd via en server den får använda, när den erbjuder ett verktyg som kan ändra något, efter rotorsaksanalysen när det finns en:

- **Fråga innan något åtgärdas** – varje ändring den skulle göra registreras och skickas ingenstans. Steget **Åtgärd** på incidentens kort **OneUptime AI** sammanfattar dem i en mening, och **Granska och godkänn** listar dem i ordning, var och en med sin server, sitt verktyg och vad den skulle skicka. **Godkänn och kör** gör exakt de ändringarna, i den ordningen, i ditt namn; ett godkännande kräver samma behörighet som att starta en runbook. En ändring som misslyckas stoppar dem efter den.
- **Åtgärda utan att fråga** – OneUptime AI gör ändringarna själv, var och en registrerad innan den skickas. Det gör den bara för en regel som nämner sina MCP-servrar, när ingen annan matchande regel frågar först, inget annat redan åtgärdar incidenten på egen hand (en AI-agent på ett kluster eller en värd, eller en runbook) och regeln inte har gjort det största antal åtgärder den får göra på egen hand på en timme; annars föreslås ändringarna. Utan någon konfigurerad regel, eller med en regel som inte nämner någon MCP-server, föreslås varje ändring.

En åtgärd gör högst 5 ändringar. Sedan bevakar OneUptime incidentens monitorer, som vid varje åtgärd. Inget ångras automatiskt: Ett MCP-verktyg har ingen ångring som OneUptime kan känna till, så en åtgärd som inte fungerade lämnas åt en person, och steget **Åtgärd** visar vad varje server svarade.

För att få OneUptime AI att sluta använda en server stänger du av **Låt OneUptime AI använda den här servern** på dess sida. Den frågar först: Servern används inte längre i någon utredning eller åtgärd, och en föreslagen åtgärd via den kan inte längre godkännas.

## Markera ett verktyg som skrivskyddat

Vissa servrar säger ingenting om huruvida deras verktyg bara läser. kAgents verktygsserver säger ingenting om något av sina verktyg, inte heller om `k8s_get_resources`, så OneUptime AI behandlar vart och ett som ett som kan ändra något. När du vet att ett verktyg bara läser kan en Projektägare eller Projektadministratör markera det som skrivskyddat, och OneUptime AI använder det sedan som ett sådant: i utredningar och åtgärder, i Slack och Microsoft Teams och i Fråga AI utan godkännandekort.

:::steps
### Öppna serverns kort Verktyg
Gå till **Projektinställningar → AI → Externa MCP-servrar** och öppna servern. Dess kort **Verktyg** visar hur många av dess verktyg servern inte säger något om.

### Välj ett verktyg
Klicka på **Markera som skrivskyddat** bredvid det. Dialogrutan visar vad servern säger att verktyget gör och vilka argument det tar emot, och vad det innebär att markera det.

### Markera det
Klicka på **Markera som skrivskyddat** i dialogrutan. Verktyget visar nu **Endast läsning**, tillsammans med vem som markerade det och när.
:::

- **Ett verktyg i taget.** Ingenting markerar flera verktyg på en gång.
- **Bara ett verktyg som servern inte säger något om.** Ett verktyg som servern märker som ett som kan ändra något (`readOnlyHint: false` eller `destructiveHint: true`) kan inte markeras. Vissa MCP-bibliotek skriver det för varje verktyg som deras författare inte har märkt: Det gör mcp-go, så kAgents verktygsserver i version 0.2 säger det om varje verktyg. Från version 0.3 säger den ingenting, och dess verktyg kan markeras.
- **Aldrig ett verktyg som tydligt ändrar saker.** Ett verktyg vars namn säger att det ändrar något (till exempel `delete`, `apply`, `create`, `update` eller `restart`), ett som kör ett kommando som det får och ett med ett argument som kan slå på en ändring (till exempel `should_install` eller `dry_run`) kan inte markeras, och verktygets rad säger varför. De här kontrollerna fångar bara de tydliga fallen: Läs vad ett verktyg gör innan du markerar det.
- **En markering slutar gälla när servern ändrar verktyget.** Den sparar verktygets namn, beskrivning och indataschema så som OneUptime läste dem. OneUptime AI läser verktygen på nytt i varje körning: Om servern har ändrat något av det, till exempel efter en uppgradering, räknas verktyget åter som ett som kan ändra något, tills någon markerar det igen. Dess rad säger att servern har ändrat det, med **Markera igen**. kAgent skriver om beskrivningen av sitt `k8s_generate_resource` varje gång den startar, så en markering av det verktyget upphör att gälla varje gång kAgent startas om.
- **Vem och när registreras.** Varje markerat verktyg visar vem som markerade det och när. Med [granskningsloggar](/docs/configuration/audit-logs) påslagna hamnar markeringen av ett verktyg och borttagningen av en markering i projektets granskningslogg. **Ta bort markeringen** gör att OneUptime AI direkt frågar igen innan den använder verktyget.

Projektmedlemmar och Tittare ser vilka verktyg som är markerade, och av vem.

## I Fråga AI

Fråga AI, och samtalet under en incidents eller ett larms kort **OneUptime AI**, kan använda varje påslagen server, för den som frågar. Frågar du "Vilka verktyg har AWS?" listar OneUptime AI dem, vart och ett märkt med vad det kan göra; ber du den använda ett, med dess server och dess namn, anropar den det och svarar utifrån det som kom tillbaka.

- **Verktyg som bara läser** körs direkt, i alla behörighetslägen: de som servern märker som skrivskyddade och de som en Projektadministratör har markerat.
- **Alla andra verktyg** väntar på dig, även i läget **Kör automatiskt**: Godkännandekortet anger servern och verktyget och visar exakt vad som skickas, och inget når servern förrän du tillåter det. Ett samtal i läget **Skrivskyddad** erbjuder aldrig något sådant verktyg.
- **Dina behörigheter avgör.** Att använda en server kräver samma behörighet som att läsa projektets externa MCP-servrar; att godkänna en ändring via en av dem kräver behörighet att starta runbook-körningar, precis som när du godkänner en åtgärd via MCP-servrar. Ett avvisat anrop säger varför och skickar ingenting.

Servrarna som en AI-regel nämner är de som OneUptime AI använder på egen hand, för det regeln matchar; i Fråga AI väljer du servern.

## I Slack och Microsoft Teams

Även OneUptime AI:s svar i Slack och Microsoft Teams kan använda varje påslagen server, för den som frågade. Fråga "Vilka verktyg har Kubernetes?" eller "Använd Kubernetes-servern för att lista poddarna i shop", med din servers namn, så svarar den utifrån det som serverns verktyg returnerar.

- **Bara verktygen som läser.** De som servern märker som skrivskyddade och de som en Projektadministratör har markerat. En chattapp har inget godkännandekort, så inget annat verktyg används någonsin där: Ber du om ett sådant säger OneUptime AI det och hänvisar till Fråga AI, där du godkänner varje anrop.
- **Som den som frågade.** Svaret körs som det OneUptime-konto som ditt Slack- eller Microsoft Teams-konto är anslutet till, med dess behörigheter: Den vars konto inte får läsa projektets externa MCP-servrar får inga MCP-verktyg. Ett konto som inte är anslutet ombeds ansluta först och får inget svar förrän det är det.
- **Alla i samtalet läser svaret**, med det som servrarnas verktyg returnerade i det. Fråga i ett direktmeddelande om allt som bara du ska se.

## Välj de servrar en regel får använda

Varje AI-regel kan nämna de MCP-servrar som OneUptime AI får använda för det den matchar. Fältet är **MCP-servrar**, under **Fler fält**. Tills du väljer några får OneUptime AI använda alla, och det hopfällda avsnittet säger det.

- **Ingen vald** – alla projektets påslagna servrar.
- **Några valda** – bara de. På en AI-regel som åtgärdar utan att fråga är det också att nämna dess servrar som låter OneUptime AI göra deras ändringar utan att fråga.

När flera regler som utreder matchar får OneUptime AI använda varje server som någon av dem tillåter; om reglerna inte kan läsas använder utredningen ingen MCP-server alls. En utredning som någon startar på en incident eller ett larm som ingen regel matchar får använda alla. Varje matchande regel som åtgärdar tar fram sin egen åtgärd via sina servrar, och de regler som inte nämner någon delar på en åtgärd via alla.

## Säkerhet

- **Det en server skickar tillbaka är data, aldrig instruktioner.** OneUptime AI läser beskrivningarna och svaren från dess verktyg som text utifrån: De ändrar aldrig en regel, ett godkännande eller vad OneUptime AI får göra.
- **Ett verktyg får bara det som det tar emot.** OneUptime skickar till ett verktyg bara de argument som dess schema anger; allt annat som OneUptime AI skrev stannar i OneUptime.
- **Aktivera AI stoppar varje anrop.** När **Aktivera AI** är avstängt skickar OneUptime ingenting till en server: inget anrop från en utredning, en åtgärd, Fråga AI, Slack eller Microsoft Teams, inte ens ett som en person redan har godkänt.
- **Adressen kontrolleras vid varje anslutning.** OneUptime ansluter aldrig till sin egen adress eller en link-local-adress. På OneUptime Cloud avvisar den också privata nätverksadresser: Använd serverns offentliga adress. En egen driftad OneUptime når privata adresser om inte `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` är satt. Den följer inte omdirigeringar.
- **Gränser.** Ett projekt har högst 20 servrar, och OneUptime läser högst 200 verktyg per server. Anslutningen får timeout efter 20 sekunder, listningen av verktyg efter 30 och ett verktygsanrop efter 60. Ett svar större än 2 MB avvisas. En körnings anrop till MCP-servrar räknas in i projektets gränser per körning, när det sätter dem.
- **Varje anrop registreras.** Varje anrop är ett steg i körningen, synligt i dess aktivitet (i Fråga AI bland svarets steg), och varje ändring en åtgärd gör står i steget **Åtgärd** med vad servern svarade. Ett svar i Slack eller Microsoft Teams nämner bland sina källor varje server och varje verktyg som det har läst. Modellanropen bakom dem finns under **Projektinställningar → AI → AI-loggar**.

## Felsökning

:::details Kan inte ansluta, eller testet misslyckas
Dialogrutan **Testa anslutningen** säger vad som gick fel och vad du ska kontrollera: adressen (en privat adress på OneUptime Cloud, en värd som inte svarar), inloggningen (en token eller headers som servern avvisade, eller en token-URL som inte gav någon token) eller en URL som inte är serverns MCP-adress. Rätta serverns inställningar med **Redigera** på dess sida och testa igen.
:::

:::details OneUptime AI använder inte en server
Kontrollera att **Låt OneUptime AI använda den här servern** är påslaget och att serverns verktyg har lästs: Dess kort **Verktyg** listar dem, vart och ett märkt med **Endast läsning** eller **Kan ändra saker**, och **Testa anslutningen** läser dem igen. Ställ sedan frågan "Vilka verktyg har AWS?" i Fråga AI, med din servers namn: Den listar dem, eller säger varför den inte kan nå servern eller inte får använda den. För en utredning kontrollerar du också att regeln som matchade incidenten inte nämner andra servrar under **Fler fält**: En utredning använder bara verktyg märkta med **Endast läsning**, så en server som inte märker något av sina verktyg ger den inga att använda, tills en Projektadministratör markerar dem som bara läser (se [Markera ett verktyg som skrivskyddat](#markera-ett-verktyg-som-skrivskyddat)).
:::

:::details Ett verktyg som jag markerade som skrivskyddat väntar på godkännande igen
Dess server har ändrat det sedan det markerades: Dess rad på kortet **Verktyg** säger det, och **Testa anslutningen** visar vad OneUptime läser nu. Kontrollera vad som har ändrats i dialogrutan som **Markera igen** öppnar, och markera det igen om det fortfarande bara läser. Ett verktyg som dess server nu märker som ett som kan ändra något kan inte markeras igen.
:::

## Nästa steg

:::cards
- [AI SRE](/docs/ai/ai-sre): Hur OneUptime AI utreder och åtgärdar, och reglerna som avgör vilka incidenter.
- [LLM-leverantörer](/docs/ai/llm-provider): Modellen som använder servrarnas verktyg.
- [MCP-server](/docs/ai/mcp-server): Anslut i stället en AI-assistent till OneUptime.
:::
