# Ordlista

Varje ord som OneUptime använder, förklarat med en eller två meningar, med de andra namn det går under och sidan som går igenom det i detalj. Orden är grupperade i den ordning du stöter på dem: den första gruppen är flödet som varje projekt kör, och den sista är orden som betyder mer än en sak.

:::cards
- [Börja här](#börja-här): Flödet som varje projekt kör, från en monitor till den som har jour och en statussida.
- [Det du övervakar](#det-du-övervakar): Tjänster, värdar, kluster, moln och målen som du håller dem till.
- [Arbeta med ett problem](#arbeta-med-ett-problem): Statusar, allvarlighetsgrader, ägare och etiketter, och de andra slagen av problem.
- [Telemetri och instrumentpaneler](#telemetri-och-instrumentpaneler): Det som dina system skickar, och var du tittar på det.
- [Automatisering och AI](#automatisering-och-ai): Det som körs av sig självt, och vad OneUptime AI gör.
- [Det du installerar, och nycklarna](#det-du-installerar-och-nycklarna): Agenterna som du kör, och nyckeln som var och en tar.
- [Ord med mer än en betydelse](#ord-med-mer-än-en-betydelse): Regel, roll, resurs, inställningar och de andra orden med flera uppgifter.
:::

## Börja här

### Projekt

Där allt du sätter upp finns: monitorer, incidenter, jour, statussidor, telemetri och inställningar. Inget i ett projekt syns i ett annat, och de flesta företag behöver bara ett.

Se [Grundbegrepp](/docs/introduction/core-concepts#projekt-och-personer).

### Konto

Du själv: e-postadressen och lösenordet som du loggar in med, ditt namn, din tidszon och ditt språk. Ett konto kan tillhöra hur många projekt som helst.

Se [Ditt konto](/docs/introduction/your-account).

### Team

En grupp personer i ett projekt, vars behörigheter avgör vad medlemmarna får göra. Varje nytt projekt börjar med tre team: Owners, Admin och Members. Bjud in personer under **Användare** och gruppera dem under **Team**.

Se [Användare, team och behörigheter](/docs/permissions/index).

### Övervakning

Kontrollerar en sak som du kör, till exempel en webbplats, ett API, en server eller ett Kubernetes-kluster, och avgör om den fungerar. När dess kriterier matchar ändrar den sin status och kan deklarera en incident eller skapa ett larm.

Se [Skapa en monitor](/docs/monitor/create-monitor).

### Kriterier

En monitors regler: vad varje kontrollresultat betyder. De kontrolleras i ordning, och det första som matchar kan ändra monitorns status, deklarera en incident, skapa ett larm eller alla tre.

Kallas även: **Övervakningskriterier**, **Monitorkriterier**, **Monitor Steps**. Se [Kriterier och statusar](/docs/monitor/criteria-and-statuses).

### Monitorstatus

Vad en monitor är just nu. Varje nytt projekt har tre monitorstatusar, **Fungerar**, **Försämrad** och **Offline**, och du kan lägga till egna.

Se [Kriterier och statusar](/docs/monitor/criteria-and-statuses).

### Sond

En maskin som kör monitorernas kontroller enligt ett schema: den hämtar en sida, anropar ett API eller pingar en värd. OneUptime Cloud kör sonder i flera regioner, och en anpassad sond som du kör i ditt eget nätverk kontrollerar det som bara det nätverket når.

Kallas även: **Anpassade probes**. Se [Anpassade probes](/docs/probe/custom-probe).

### Incident

Ett problem som drabbar dina användare, till exempel ett avbrott eller en fördröjning, och posten som ditt team arbetar utifrån medan det pågår. Den kan larma den som har jour och visas på dina statussidor.

Se [Incidenter – Översikt](/docs/incidents/index).

### Larm

Ett problem som ditt team bör titta på innan användarna märker något, till exempel en disk som håller på att bli full eller ett certifikat som snart går ut. Det kan larma den som har jour, men det visas aldrig på en statussida.

Se [Larm – Översikt](/docs/alerts/index).

### Episod

En grupp relaterade incidenter, eller relaterade larm, som ditt team hanterar som en, med en uppsättning ägare och en status. Grupperingsregler avgör vad som hör till varje episod.

Kallas även: **Incidentepisod**, **Larmepisod**. Se [Episoder](/docs/incidents/episodes).

### Jourpolicy

Avgör vem som larmas om en incident, ett larm eller en episod, och vem som står på tur om ingen bekräftar. Dess nivåer är eskaleringsregler.

Kallas även: **Jourtjänst**, **On-Call Duty Policy**, **Beredskap**, `OnCallDutyPolicy`. Se [Jourpolicyer](/docs/on-call/policies).

### Eskaleringsregel

En nivå i en jourpolicy: vem som larmas, och hur länge man väntar på att någon bekräftar innan nästa nivå larmas. En nivå kan larma personer, team eller ett jourschema.

Se [Eskaleringsregler](/docs/on-call/escalation-rules).

### Jourschema

Vem som har jour vid varje tidpunkt: personer turas om, och var och en lämnar över till nästa. En eskaleringsregel som larmar ett schema larmar den som har jour i det.

Kallas även: **Rotation**, **Jourschema för jourpolicy**. Se [Jourscheman](/docs/on-call/schedules).

### Lager

En rotation i ett jourschema: vilka som turas om, hur ofta jouren lämnas över och vilka timmar lagret täcker. Det översta lagret där någon har jour är det som larmar, så huvudrotationen ligger överst och reservtäckningen under den.

Se [Jourscheman](/docs/on-call/schedules#lager).

### Aviseringsmetod

En adress där OneUptime får nå dig i ett projekt: en e-postadress, ett telefonnummer för SMS eller samtal, ditt Slack- eller Microsoft Teams-konto, eller OneUptime-appen i din telefon. Var och en lägger till sina egna under **Användarinställningar**.

Se [Aviseringsmetoder](/docs/notifications/notification-methods).

### Så når man mig

Dina egna regler för att bli larmad: vilka av dina aviseringsmetoder ett larm prövar, och efter hur lång tid. En stege täcker varje incident, larm och episod, och en allvarlighetsgrad kan ha egna regler. Var och en ställer in sina egna under **Användarinställningar**.

Kallas även: **Personliga jourregler**. Se [Så når man mig](/docs/notifications/on-call-rules).

### Statussida

En sida som visar dina kunder om dina tjänster fungerar, och vilka incidenter och vilket underhåll som påverkar dem. Den kan vara offentlig, eller privat för dem du släpper in.

Se [Statussidor – Översikt](/docs/status-pages/index).

### Prenumerant

Någon som följer en statussida via e-post, SMS, Slack, Microsoft Teams eller webhook, och får besked när en incident eller ett underhåll på den börjar, ändras och avslutas.

Se [Prenumeranter och meddelanden](/docs/status-pages/subscribers).

### Schemalagt underhåll

Planerat arbete som meddelas i förväg. Varje underhållshändelse går igenom underhållsstatusarna **Schemalagd**, **Pågående**, **Avslutad** och **Slutförd**, och statussidorna som den visas på berättar om den för besökare och prenumeranter.

Kallas även: **Schemalagd underhållshändelse**, **Planerad händelse**, **Händelse**. Se [Schemalagt underhåll – Översikt](/docs/scheduled-maintenance/index).

### Telemetri

Det som dina system skickar till OneUptime: loggar, mätvärden, spår, undantag och profiler. Appar skickar den med OpenTelemetry, och OneUptimes agenter skickar den från värdar, kluster och övrig infrastruktur, var och en med en intagningsnyckel.

Se [OpenTelemetry](/docs/telemetry/open-telemetry).

## Det du övervakar

### Monitorgrupp

Flera monitorer sammanslagna till en status, den sämsta bland dem, med en egen upptid. En statussida kan visa hela gruppen som en rad. Slå på monitorgrupper under **Projektinställningar → Avancerad → Funktionsflaggor**.

Se [Monitorgrupper](/docs/monitor/monitor-groups).

### Tjänst

En applikation eller mikrotjänst som du kör. OneUptime lägger till den första gången dess telemetri kommer in, med namnet från dess `service.name`, och samlar dess loggar, spår, mätvärden, undantag, incidenter och ägare på en sida.

Kallas även: **Tjänstekatalog**, **Telemetritjänst**. Se [Tjänster](/docs/telemetry/services).

### Värd

En Linux-, Windows- eller macOS-maskin som skickar sina mätvärden, processer, loggar och tjänststatusar via OpenTelemetry Collector. **Lägg till värd** installerar collectorn med ett kommando, och OneUptime håller dess konfiguration uppdaterad.

Se [Värdar](/docs/telemetry/hosts).

### Kubernetes

Dina Kubernetes-kluster, med deras noder, poddar, arbetslaster, händelser och loggar, som skickas av Kubernetes-agenten som du installerar med Helm.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### Infrastruktur

Menyns grupp med maskinerna och plattformarna som du kör: Värdar, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Lagringsarrayer, Nätverk och IoT. En agent eller en anslutning fyller var och en, och var och en visar hur varje maskin, kluster eller enhet i den mår.

Se [Värdar](/docs/telemetry/hosts).

### Nätverk

Dina switchar, routrar, brandväggar, åtkomstpunkter och allt annat som har en adress i ditt nätverk, oavsett om det talar SNMP eller inte.

Se [Nätverksenhets-övervakning](/docs/monitor/network-device-monitor).

### Moln

Dina AWS-konton, Azure-prenumerationer och Google Cloud-projekt, anslutna från instrumentpanelen. OneUptime listar varje resurs i dem, läser deras viktigaste mätvärden och registrerar vad som ändrats i dem.

Se [Anslut ett molnkonto](/docs/telemetry/cloud-accounts).

### Appplattformar

Apparna som du kör på hanterade plattformar som Amazon ECS och Fargate, Google Cloud Run och Azure App Service. Varje plats där de körs är en molnmiljö, som OneUptime skapar första gången dess telemetri kommer in.

Kallas även: **Molnmiljö**. Se [Molnmiljöer](/docs/telemetry/cloud-environments).

### Serverlös

Dina serverlösa funktioner, till exempel AWS Lambda, Google Cloud Functions och Azure Functions, listade med sina spår, loggar och mätvärden så snart deras OpenTelemetry-data kommer in.

Kallas även: **Serverlösa funktioner**. Se [Serverlösa funktioner](/docs/telemetry/serverless-functions).

### Databaser

Varje databas som dina applikationer frågar, sammanställd från dina spår, databasens egna mätvärden och de andra källor som OneUptime kan läsa, med hur dess motor mår.

Se [Databaser](/docs/telemetry/databases).

### Köer

Meddelandeköerna och ämnena som dina tjänster använder, till exempel Apache Kafka, RabbitMQ och Amazon SQS, utifrån dina spår och dina brokers mätvärden.

Se [Köer](/docs/telemetry/queues).

### Övervakning av verkliga användare

Det som verkliga personer upplever i dina webb- och mobilappar: sidladdningar, förfrågningar, fel och Core Web Vitals, rapporterat av appen själv i stället för av en sond.

Se [RUM – Översikt](/docs/rum/index).

### Inventarie

En lista över allt som OneUptime vet om din miljö: tjänster, värdar, Kubernetes-objekt, virtuella maskiner, nätverksenheter, molnresurser och de saker som inte skickar någon telemetri alls. Det mesta fylls i av sig självt.

Se [Inventarie – Översikt](/docs/inventory/overview).

### Topologi

En karta över hur dina system hänger ihop, vilka tjänster som anropar vilka och vad som körs var, ritad utifrån telemetrin som du redan skickar.

Se [Topologi](/docs/telemetry/topology).

### SLO

Ett tillförlitlighetsmål för det du övervakar, till exempel tillgängligt 99,9 % av tiden under 30 dagar. OneUptime mäter varje SLO mot dess monitorer var 5:e minut.

Kallas även: **Service Level Objective**. Se [SLO:er – Översikt](/docs/slo/introduction).

### Felbudget

Den nedtid som ett SLO:s mål tillåter: vid 99,9 % under 30 dagar är det 43 minuter och 12 sekunder. Med gott om marginal kvar kan du ta risker; med lite kvar bör du sakta ner och satsa på stabilitet.

Se [Felbudgetar](/docs/slo/error-budget).

## Arbeta med ett problem

### Tillstånd

Var en incident eller ett larm befinner sig i er insats. Varje nytt projekt börjar med **Identifierad**, **Bekräftad** och **Löst**: att bekräfta säger att någon tar hand om det och hindrar att nästa eskaleringsnivå larmas, och att lösa stänger det.

Kallas även: **Incidentstatus**, **Larmstatus**. Se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

### Allvarlighetsgrad

Hur mycket en incident eller ett larm spelar roll. Ett nytt projekt börjar med Critical Incident, Major Incident och Minor Incident för incidenter, och **Hög** och **Låg** för larm; byt namn på dem, ge dem nya färger eller lägg till egna.

Kallas även: **Incidentallvar**, **Larmallvar**. Se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

### Ägare

En person eller ett team som ansvarar för en post, till exempel en monitor, en incident eller en statussida. Ägare får besked när något händer med det de äger.

Se [Etikett- och ägarregler](/docs/configuration/label-and-owner-rules).

### Etikett

Ett märke, till exempel Production eller Checkout, som du sätter på monitorer, incidenter, statussidor och de flesta andra poster för att filtrera och gruppera dem. Ett teams behörigheter kan begränsas till posterna med vissa etiketter.

Se [Etikett- och ägarregler](/docs/configuration/label-and-owner-rules).

### Undantag

Ett fel som din kod kastar. OneUptime grupperar varje förekomst av samma fel i ett undantag, med dess stackspårning, dess trend och förfrågningarna som det inträffade i.

Kallas även: **Undantagsspårning**, `/telemetry-exception`. Se [Undantag](/docs/telemetry/exceptions).

### AI-insikter

Problem som OneUptime hittar i din telemetri innan något larmar: nya undantag och undantag som plötsligt ökar, toppar av felloggar, långsammare spår, mätvärden som glider iväg och driftsättningar som gjorde saker sämre. Insikter larmar aldrig någon och öppnar aldrig incidenter; de väntar i en inkorg tills någon tittar. Sidan **Insikter** i en produkts eller en posts AI-avsnitt visar vad OneUptime AI har lärt sig där.

Kallas även: **Insikter**. Se [AI SRE](/docs/ai/ai-sre#insikter-proaktiv-upptäckt).

### Säkerhetshändelser

OneUptimes SIEM: säkerhetshändelserna från dina loggar, dina säkerhetsverktyg och allt annat som du skickar, lagrade i ett och samma format bredvid din telemetri, med detektionsregler som hittar hot i dem.

Kallas även: **SIEM**. Se [Säkerhetshändelser (SIEM)](/docs/telemetry/security-events).

### Säkerhetsärende

En sak som är värd att undersöka, från detektionsregler, hotunderrättelser eller en ansluten säkerhetsprodukt, med varje detektion om samma användare, värd eller adress samlad i den. Analytiker hanterar ärenden i en kö, och playbooks svarar på dem.

Kallas även: **Ärende**. Se [Säkerhetsärenden och playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetri och instrumentpaneler

### Loggar

Raderna som dina tjänster, värdar och agenter skriver, som du söker i med Loggutforskaren och håller koll på med en loggmonitor.

Se [Loggutforskare](/docs/telemetry/logs-explorer).

### Mätvärden

Talen som dina tjänster och din infrastruktur rapporterar över tid, till exempel antal förfrågningar, latens, CPU och ködjup.

Se [Måttutforskare](/docs/telemetry/metrics-explorer).

### Spår

Vägen som en förfrågan tar genom dina tjänster, steg för steg. Varje steg är ett span, med sin tidsåtgång och sitt resultat.

Se [Spårutforskare](/docs/telemetry/traces-explorer).

### Profiler

Hur din applikation använder CPU-tid och minne, funktion för funktion, skickat av en profilerare som skickar till OneUptimes Pyroscope-kompatibla API.

Kallas även: **Prestandaprofiler**, **Kontinuerlig profilering**. Se [Profiler](/docs/telemetry/profiles).

### AI / LLM

Konversationerna som dina AI-appar och agenter för: varje modellanrop, med dess tokens, kostnad, latens, prompt och svar, byggt utifrån de OpenTelemetry-spans som din app skickar.

Kallas även: **AI / LLM-observability**. Se [AI- / LLM-observerbarhet](/docs/telemetry/ai-llm-observability).

### Dataobserverbarhet

Håller koll på tabellerna i dina databaser och datalager, och säger till när deras data är sena, saknas eller är fel, och vilken körning, driftsättning eller tabell som ligger bakom.

Se [Översikt över Dataobserverbarhet](/docs/data-observability/index).

### Datasäkerhet

Hittar de känsliga data som ditt företag sparar, i molnbuckets, databaser, datalager och telemetrin som du skickar, och säger vad som är fel med hur de förvaras.

Se [Översikt över Datasäkerhet](/docs/data-security/index).

### Instrumentpanel

En sida med widgetar som du ordnar själv: diagram över dina mätvärden, loggar och spår, listor över incidenter och monitorer, dina SLO:er och mer. En instrumentpanel är privat för ditt projekt tills du delar den.

Se [Översikt över instrumentpaneler](/docs/dashboards/index).

### Public Dashboard

En instrumentpanel som delas via en offentlig länk, för personer som inte loggar in i ditt projekt. Skydda den med ett lösenord, begränsa den till vissa IP-adresser eller lägg den på din egen domän.

Se [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing).

## Automatisering och AI

### Arbetsflöde

En automatisering utan kod: block på en rityta som körs när deras utlösare aktiveras, till exempel ett inlägg i Slack när en incident deklareras, eller ett anrop till ett annat verktyg.

Se [Översikt över arbetsflöden](/docs/workflows/index).

### Runbook

En återanvändbar insatsrutin: manuella och automatiska steg som ditt team kör på en incident, ett larm eller en underhållshändelse, för hand eller när en runbook-regel matchar.

Se [Runbooks – Översikt](/docs/runbooks/index).

### Playbook

Stegen som svarar på ett säkerhetsärende, till exempel att bevara bevisen, larma den som har jour eller stänga av en användare, och som körs av sig själva eller med ett klick.

Kallas även: **Säkerhetsplaybook**. Se [Säkerhetsärenden och playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### AI-regel

Avgör vilka nya incidenter eller larm som OneUptime AI undersöker och åtgärdar, och hur. Utan någon AI-regel undersöker den varenda en, så de flesta projekt behöver ingen.

Kallas även: **Regel för automatisk åtgärd**. Se [AI SRE](/docs/ai/ai-sre#vilka-incidenter-som-utreds-och-åtgärdas).

### OneUptime AI

OneUptimes AI-driftingenjör (site reliability engineer): den undersöker varje ny incident och varje nytt larm i hela din telemetri och lägger ut vad den hittade på deras tidslinje. Reglaget **Aktivera AI** i **Projektinställningar** stänger av allt.

Kallas även: **AI SRE**. Se [AI SRE](/docs/ai/ai-sre).

### Fråga AI

En chatt om ditt projekts data. Den frågar dina loggar, spår, mätvärden, incidenter, monitorer och mer, och svarar med en källhänvisning för varje påstående.

Kallas även: **Chatt**. Se [Fråga AI](/docs/ai/ask-ai).

### Kod

Där du ber OneUptime AI att arbeta i dina kodförråd, på samma sätt som du skulle be en kodagent: rätta en bugg, skriva tester eller göra en ändring, och få tillbaka en pull request.

Kallas även: **Uppgifter**. Se [Kod](/docs/ai/ai-agent).

### Formulär

En sida som alla med länken kan fylla i, utan konto. Varje inskickat svar skapar en incident, för en problemrapport, eller en underhållshändelse, för en ändringsbegäran.

Se [Formulär – översikt](/docs/forms/index).

## Det du installerar, och nycklarna

### Infrastrukturagent

Tjänsten `oneuptime-infrastructure-agent` bakom en Server / VM-monitor: den rapporterar en maskins CPU, minne, diskar och processer var 30:e sekund, signerat med monitorns hemliga nyckel.

Se [Server- / VM-övervakning](/docs/monitor/server-monitor).

### Kubernetes-agent

Ett Helm-chart som samlar in ett klusters mätvärden, händelser och poddloggar och, med eBPF, dess spår, och skickar dem med en intagningsnyckel.

Se [Kubernetes-agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

Agenten med öppen källkod som tar emot, bearbetar och skickar telemetri. **Lägg till värd** installerar den på en maskin, Docker-agenten är en sådan, och dina egna collectorer skickar till OneUptime med en intagningsnyckel.

Kallas även: **Insamlare**. Se [Värdar](/docs/telemetry/hosts) och [OpenTelemetry-collector på värden](/docs/telemetry/host-otel-collector).

### Runner

En liten process som du kör i din egen infrastruktur och som kör JavaScript-, Bash-, SSH- och kubectl-stegen i dina runbooks. Den ansluter utåt till OneUptime med sitt eget Runner-ID och sin egen nyckel.

Kallas även: **Runbook-agenter**. Se [Runbook-agenter](/docs/runbooks/agents).

### Intagningsnyckel

Nyckeln som låter något skicka telemetri till ditt projekt: appar med OpenTelemetry, collectorer och agenter. Den skickas i headern `x-oneuptime-token`, och en API-nyckel för projektet fungerar inte i dess ställe.

Kallas även: **Telemetri Ingestion Key**, `oneuptime.apiKey`. Se [Intagningsnycklar](/docs/telemetry/ingestion-keys).

### API-nyckel

En nyckel som låter ett skript, CLI:t, Terraform eller en AI-assistent läsa och ändra ditt projekt via API:t, med de behörigheter som du ger den. Skapa en under **Projektinställningar → Avancerad → API-nycklar**.

Se [Användare, team och behörigheter](/docs/permissions/index#api-nycklar).

## Ord med mer än en betydelse

### Regel

Många saker i OneUptime är regler, och var och en fattar ett beslut åt dig: vem som larmas (**Jourregler**, **Eskaleringsregler**), vem som äger och märker nya poster (**Ägarregler**, **Etikettregler**), vad som hör ihop (**Grupperingsregler**) och vad OneUptime AI gör (**AI-regler**). En monitors egna regler är dess kriterier.

Se [Grundbegrepp](/docs/introduction/core-concepts#olika-slags-regler).

### Roll

Fyra olika saker: behörigheterna som ett team ger, till exempel Project Owner eller Project Admin; en **Anpassad roll** som du sätter ihop av behörigheter; en **Incidentroll**, den roll någon har i en incident; och en **Network Device Role**, vad en enhet i ditt nätverk gör.

Se [Användare, team och behörigheter](/docs/permissions/index).

### Resurs

Oftast den infrastruktur som OneUptime registrerar, till exempel värdar, kluster, databaser och molnresurser. En incidents **Berörda resurser** är monitorerna och infrastrukturen som den berör, en statussidas resurser är monitorerna och grupperna som den visar, och OpenTelemetrys resursattribut säger var telemetrin kom ifrån.

Se [Inventarie – Översikt](/docs/inventory/overview).

### Inställningar

Varje nivå har sina egna: **Projektinställningar** för hela projektet, **Användarinställningar** för hur OneUptime når dig, och en produkts egna **Inställningar** i dess sidomeny, till exempel incidentstatusar och mallar under **Incidenter**. En självhostad servers inställningar finns i Admin Dashboard.

Se [Projektinställningar](/docs/configuration/project-settings).

### Policy

Oftast en **Jourpolicy**: vem som larmas, och vem som står på tur. En policy för inkommande samtal ger ditt team ett telefonnummer som ringer den som har jour, och en felbudgetpolicy skriver ner vad ditt team gör när ett SLO:s budget håller på att ta slut.

Se [Jourpolicyer](/docs/on-call/policies).

### Mall

En sparad utgångspunkt: en monitormall skapar monitorer, incident- och larmmallar fyller i nya poster, antecknings- och efteranalysmallar startar det du skriver, och instrumentpanelsmallar bygger en instrumentpanels widgetar.

Se [Monitormallar](/docs/monitor/monitor-templates).

### Arbetsyta

En Slack- eller Microsoft Teams-arbetsyta som du ansluter till OneUptime under **Arbetsyteanslutningar**, för att lägga ut uppdateringar i dina kanaler och agera på incidenter från chatten. Det som vissa andra verktyg kallar en arbetsyta är ett projekt i OneUptime.

Se [Slack](/docs/workspace-connections/slack).

### Agent

Ett program som du installerar och som rapporterar till OneUptime eller agerar åt det: infrastruktur-, Kubernetes- och Docker-agenterna skickar det de samlar in, en Runner kör runbook-steg, och en AI-agent låter OneUptime AI titta in i ett kluster eller en värd. Uppgifterna som du ger **Kod** är AI-agentuppgifter.

Se [Vilken ska jag använda?](/docs/introduction/which-one#sond-agent-collector-eller-runner).

### Jourregler

Under **Incidenter** och **Larm** väljer jourregler vilka jourpolicyer en ny incident eller ett nytt larm kör. En persons egna regler för hur ett larm når fram hette också jourregler: De heter nu **Så når man mig**, under **Användarinställningar**.

Se [Incidentinställningar och automatisering](/docs/incidents/settings#jourregler-för-incidenter) och [Så når man mig](/docs/notifications/on-call-rules).

### Aviseringsinställningar

Under **Användarinställningar**: vilka uppdateringar som når dig om det du äger, och i vilka kanaler. Projektets reglage för SMS och samtal, dess meddelandesaldo och dess egen SMTP och Twilio hette också aviseringsinställningar: De heter nu **Aviseringskanaler**, under **Projektinställningar**.

Se [Aviseringsinställningar](/docs/notifications/notification-settings).

## Nästa steg

:::cards
- [Vilken ska jag använda?](/docs/introduction/which-one): Incident eller larm, arbetsflöde eller runbook, och de andra sakerna som liknar varandra, sida vid sida.
- [Grundbegrepp](/docs/introduction/core-concepts): Hur delarna hänger ihop, på en sida.
- [Snabbstart](/docs/introduction/quickstart): Använd orden i praktiken på femton minuter.
:::
