# Vilken ska jag använda?

Vissa saker i OneUptime liknar varandra. Den här sidan ställer varje uppsättning sida vid sida, med vad var och en är till för, så att du väljer rätt från början. Varje tabell får plats på en skärm, och dess första kolumn öppnar sidan som går igenom det valet i detalj.

:::cards
- [Incident, larm eller ett annat slags problem?](#incident-larm-eller-ett-annat-slags-problem): Vad ett problem blir i OneUptime.
- [Arbetsflöde, runbook, playbook eller AI-regel?](#arbetsflöde-runbook-playbook-eller-ai-regel): Vad du ska automatisera med.
- [Monitorgrupp, tjänst eller etikett?](#monitorgrupp-tjänst-eller-etikett): Hur du grupperar det du övervakar.
- [Sond, agent, collector eller Runner?](#sond-agent-collector-eller-runner): Vad du ska installera, och nyckeln som var och en tar.
- [Instrumentpanel, offentlig instrumentpanel eller statussida?](#instrumentpanel-offentlig-instrumentpanel-eller-statussida): Vad du ska dela, och med vem.
:::

## Incident, larm eller ett annat slags problem?

De flesta problem är en incident eller ett larm: välj efter vem problemet drabbar. De andra är poster som OneUptime håller åt dig, och var och en av dem kan leda till en incident eller ett larm.

| Post | Vad det är | Använd det när |
| --- | --- | --- |
| [Incident](/docs/incidents/index) | Ett problem som drabbar dina användare. Den kan larma den som har jour och visas på dina statussidor. | Kunderna märker det, eller kommer snart att göra det: ett avbrott, en fördröjning, en kassa som inte fungerar. |
| [Larm](/docs/alerts/index) | Ett problem för ditt team. Det kan larma den som har jour, men det visas aldrig på en statussida. | Ditt team bör agera innan användarna märker något: en disk som håller på att bli full, ett certifikat som snart går ut. |
| [Episod](/docs/incidents/episodes) | En grupp relaterade incidenter, eller relaterade larm, som hanteras som en. | En och samma orsak gav upphov till många incidenter eller larm. Grupperingsregler öppnar episoder åt dig. |
| [Undantag](/docs/telemetry/exceptions) | Varje förekomst av ett fel som din kod kastar, grupperade, med stackspårningen. | Du vill rätta en bugg. En undantagsmonitor kan skapa ett larm eller en incident när felen plötsligt ökar. |
| [AI-insikt](/docs/ai/ai-sre#insikter-proaktiv-upptäckt) | Ett problem som OneUptime hittade i din telemetri innan något larmade, till exempel en topp i felloggarna. | Du vill ha tidiga varningar. En insikt larmar aldrig någon och öppnar aldrig en incident: den väntar i en inkorg. |
| [Säkerhetsärende](/docs/telemetry/security-cases) | Ett hot som är värt att undersöka, med varje detektion om samma användare, värd eller adress samlad i det. | Ditt säkerhetsteam utreder. **Deklarera incident** på ett ärende öppnar en incident när användare drabbas. |

Ett larm kan kopplas till incidenten som det visade sig höra till, så du förlorar ingenting på att börja med ett larm.

## Arbetsflöde, runbook, playbook eller AI-regel?

Alla fyra kan köras av sig själva. Välj efter vad de agerar på och vem som skrev stegen.

| Verktyg | Vad det gör | Använd det när |
| --- | --- | --- |
| [Arbetsflöde](/docs/workflows/index) | Block på en rityta som körs när deras utlösare aktiveras: en incident skapas, ett schema infaller, ett annat verktyg anropar en URL. | Du vill koppla OneUptime till andra verktyg, eller agera på dess poster, utan att skriva kod. |
| [Runbook](/docs/runbooks/index) | Din insatsrutin som steg, från manuella checklistor till skript, HTTP-förfrågningar och kubectl, som körs på en incident, ett larm eller en underhållshändelse. | De som hanterar incidenter ska följa samma steg varje gång. Runbook-regler startar ett runbook på de incidenter som matchar. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Steg som svarar på ett säkerhetsärende: bevara bevisen, larma den som har jour, stäng av en användare. | Ditt säkerhetsteam svarar på samma slags hot på samma sätt varje gång. |
| [AI-regel](/docs/ai/ai-sre#vilka-incidenter-som-utreds-och-åtgärdas) | Avgör vilka nya incidenter och larm som OneUptime AI undersöker och åtgärdar, och om den frågar först. | OneUptime AI ska bara arbeta med vissa incidenter, eller åtgärda utan att fråga. Utan någon regel undersöker den varenda en. |

## Monitorgrupp, tjänst eller etikett?

Alla tre samlar ihop saker, för olika läsare. De fungerar också tillsammans: en tjänsts monitorer kan utgöra en monitorgrupp, och alla kan bära samma etikett.

| Val | Vad det är | Använd det när |
| --- | --- | --- |
| [Monitorgrupp](/docs/monitor/monitor-groups) | Flera monitorer sammanslagna till en status, den sämsta bland dem, med en egen upptid. | Kunderna ska se en rad på en statussida för något som består av flera monitorer, till exempel Checkout. |
| [Tjänst](/docs/telemetry/services) | En applikation som OneUptime hittade i din telemetri, med dess loggar, spår, mätvärden, incidenter och ägare på en sida. | Du vill ha allt om en applikation på ett ställe. Den dyker upp av sig själv utifrån sitt `service.name`. |
| [Etikett](/docs/configuration/label-and-owner-rules) | Ett märke som du sätter på monitorer och de flesta andra poster. En post kan ha många. | Du vill filtrera listor, begränsa ett teams behörigheter eller välja ut poster i regler. |

Monitorgrupper är avstängda från början: slå på dem under **Projektinställningar → Avancerad → Funktionsflaggor**.

## Sond, agent, collector eller Runner?

Det mesta i OneUptime kräver inget installerat: installera något bara för att nå det som OneUptime inte kan se utifrån. Var och en ansluter utåt, med en egen sorts nyckel.

| Installation | Vad den gör | Installera den när | Nyckel den tar |
| --- | --- | --- | --- |
| [Anpassad sond](/docs/probe/custom-probe) | Kör dina monitorers kontroller inifrån ditt nätverk. | Det du kontrollerar ligger bakom din brandvägg. OneUptimes egna sonder kontrollerar det som är offentligt. | Sitt eget sond-ID och sin egen nyckel |
| [Infrastrukturagent](/docs/monitor/server-monitor) | Rapporterar en maskins CPU, minne, diskar och processer till en Server / VM-monitor. | Du vill ha en monitor för en server, med kriterier på dess värden. | Monitorns hemliga nyckel |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Skickar en maskins mätvärden, loggar och processer. **Lägg till värd** installerar den med ett kommando. | Du vill ha en maskin under **Värdar**, med dess telemetri. | En intagningsnyckel |
| [Kubernetes-agent](/docs/telemetry/kubernetes-agent) | Samlar in ett klusters mätvärden, händelser, loggar och spår. Du installerar den med Helm. | Du kör Kubernetes. | En intagningsnyckel |
| [Runner](/docs/runbooks/agents) | Kör runbook-steg, till exempel Bash, SSH och kubectl, inne i din infrastruktur. | Dina runbooks behöver nå dina egna värdar och kluster. | Sitt eget Runner-ID och sin egen nyckel |

### Intagningsnyckel eller API-nyckel?

| Nyckel | Vad den låter dig göra | Var du skapar den |
| --- | --- | --- |
| [Intagningsnyckel](/docs/telemetry/ingestion-keys) | Skicka telemetri till projektet, och inget annat. | **Projektinställningar → Telemetri och APM → Intagningsnycklar** |
| [API-nyckel](/docs/permissions/index#api-nycklar) | Läsa och ändra projektet via API:t, CLI:t, Terraform eller en AI-assistent, med de behörigheter som du ger den. | **Projektinställningar → Avancerad → API-nycklar** |

Ingen av dem fungerar i den andras ställe.

## Instrumentpanel, offentlig instrumentpanel eller statussida?

Välj efter vem som ska se den.

| Dela | Vem som ser den | Använd den när |
| --- | --- | --- |
| [Instrumentpanel](/docs/dashboards/index) | Personer som loggar in i ditt projekt. | Ditt team följer diagram och listor: en jourskärm, ett teams egen vy. |
| [Offentlig instrumentpanel](/docs/dashboards/sharing) | Alla med länken, om du inte lägger till ett lösenord, begränsar den till vissa IP-adresser eller lägger den på din egen domän. | Personer utanför projektet ska se dina diagram, till exempel en partner eller en skärm på väggen. |
| [Statussida](/docs/status-pages/index) | Dina kunder, offentligt, eller bara de privata användare som du släpper in. | Kunderna vill veta om dina tjänster fungerar, och få besked om incidenter och underhåll. |

En statussida talar i incidenter och i namnen som du ger dina monitorer; en instrumentpanel visar siffrorna bakom dem.

## Nästa steg

:::cards
- [Ordlista](/docs/introduction/glossary): Varje ord som OneUptime använder, med en eller två meningar.
- [Grundbegrepp](/docs/introduction/core-concepts): Hur delarna hänger ihop, på en sida.
- [Snabbstart](/docs/introduction/quickstart): En monitor, ett jourlarm och en statussida på femton minuter.
:::
