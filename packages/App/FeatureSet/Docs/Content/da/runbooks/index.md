# Runbooks – Oversigt

Et runbook er en genbrugelig responsprocedure: en ordnet liste af manuelle og automatiserede trin, som du kører på en hændelse, en advarsel eller en planlagt vedligeholdelsesbegivenhed. Det gør tråden "hvad gør vi nu?" til en tjekliste, som alle med vagt kan følge klokken 3 om natten, med scripts, API-kald og godkendelser allerede skrevet. Runbooks er til vagthavende ingeniører, der reagerer på hændelser, og til platformteams, der automatiserer den respons.

:::cards
- [Skriv et runbook](/docs/runbooks/authoring): Opret et runbook, og skriv dets trin.
- [Runbook-regler](/docs/runbooks/rules): Start runbooks ved nye hændelser, advarsler og vedligeholdelsesbegivenheder.
- [Kør et runbook](/docs/runbooks/running): Start en kørsel, fuldfør og godkend dens trin, annuller den.
- [Runbook-udløsere](/docs/runbooks/triggers): Kør et runbook efter en tidsplan, eller fra et andet værktøj via dets webhook-URL.
- [Runbook-variabler](/docs/runbooks/variables): De værter, nøgler, adgangskoder og kubeconfigs, som dine trin bruger ved navn.
- [Runbook-agenter](/docs/runbooks/agents): Installer den Runner, der kører dine scripts i din egen infrastruktur.
:::

## Sådan kører et runbook

```mermaid title="Fra en udløser til et registreret resultat"
flowchart TB
    subgraph triggers["Hvad starter en kørsel"]
        direction LR
        rule["Runbook-regel"]
        manual["Kør runbook på<br/>en begivenhed"]
        runnow["Run Now på<br/>runbooket"]
    end
    rule --> execution["Udførelse: et<br/>øjebliksbillede<br/>af trinnene"]
    manual --> execution
    runnow --> execution
    execution --> worker["OneUptime Worker<br/>tager trinnene<br/>i rækkefølge"]
    worker -->|"Manual-trin<br/>eller godkendelse"| person["Venter på<br/>en person"]
    worker -->|"HTTP- og<br/>AI-trin"| onworker["Kører på Workeren"]
    worker -->|"JavaScript,<br/>Bash, SSH,<br/>kubectl"| runner["Runner i din<br/>infrastruktur"]
    person --> record["Status, output og<br/>fejl registreret"]
    onworker --> record
    runner --> record
    record --> history["Begivenhedens<br/>Runbooks-side<br/>og runbookets<br/>Udførelser"]
```

Hver kørsel er en **udførelse**. Når den starter, kopieres runbookets trin over på den, og OneUptime arbejder sig igennem dem i rækkefølge. Et Manual-trin, eller et trin der kræver godkendelse, sætter kørslen på pause, indtil nogen handler.

HTTP- og AI-trin kører på OneUptime Worker. Bash-, SSH- og kubectl-trin kører på en [Runner](/docs/runbooks/agents), som du installerer i din egen infrastruktur, så de scripts aldrig kører på OneUptimes servere. Et JavaScript-trin kører også på en af dine Runnere eller, hvis det ikke vælger nogen, og projektet ikke har nogen [standard-Runner](/docs/runbooks/agents#projektets-standard-runner), på en [global Runner](/docs/runbooks/agents#globale-runnere), i en sandkasse, der kun når internettet. Hvert trins status, output og fejlmeddelelse registreres på udførelsen, som bliver ved den hændelse, advarsel eller begivenhed, den kørte for.

## Centrale begreber

| Begreb | Betydning |
| --- | --- |
| **Runbook** | Skabelonen. En navngivet, genbrugelig procedure med en ordnet liste af trin og en kontakt **Kør dette runbook**. |
| **Trin** | Ét punkt i et runbook. Det har en type (Manual, JavaScript, HTTP request, Bash, SSH, kubectl eller AI), en titel, en beskrivelse og typespecifikke indstillinger. |
| **Runbook-regel** | En regel, der automatisk knytter et eller flere runbooks til hændelser, advarsler eller planlagte vedligeholdelsesbegivenheder, der opfylder dens betingelser: deres monitorer, alvorlighed, etiketter, monitoretiketter, titel eller beskrivelse. |
| **Udførelse** | Én kørsel af et runbook. Oprettes, når en regel udløses, når nogen klikker på **Kør runbook** på en begivenhed, eller når nogen klikker på **Kør nu** på selve runbooket. Den rummer et øjebliksbillede af trinnene og hvert trins status og output. |
| **Øjebliksbillede** | Den fastfrosne kopi af runbookets trin, der ligger på hver udførelse. Du kan redigere runbooket senere uden at omskrive historikken for tidligere kørsler. |
| **Runner** | En lille agent, du kører på en vært i din egen infrastruktur. Den kører de JavaScript-, Bash-, SSH- og kubectl-trin, der nævner den. Kaldes også en runbook-agent. En global Runner, en af dem, OneUptime kører for alle projekter, kører de JavaScript-trin, der ikke nævner nogen, medmindre projektet har en standard-Runner. |
| **Variabel** | En værdi, som trin bruger ved navn, f.eks. en vært eller en URL: `{{global.variables.NAME}}` for en af projektets, som alle runbooks kan bruge, eller `{{local.variables.NAME}}` for en af runbookets egne. |
| **Hemmelighed** | En variabel, hvis værdi er krypteret i hvile, aldrig vises igen og skjules i det, trin udskriver, f.eks. en SSH-nøgle, en adgangskode, en kubeconfig eller et API-token. Kun udleveret til de Runnere, du lader bruge den; globale Runnere får den kun, hvis du giver dem lov. |

## Trintyper

Vælg den type, der passer til hvert trin. [Skriv et runbook](/docs/runbooks/authoring) beskriver hver types indstillinger.

| Trintype | Kører på | Brug den, når… | Eksempel |
| --- | --- | --- | --- |
| **Manual** | En person | Et menneske skal kontrollere noget, træffe en vurdering eller handle, hvor OneUptime ikke kan. | "Bekræft, at trafikken er flyttet til den sekundære region." |
| **JavaScript** | En Runner | Du har brug for en lille, afgrænset beregning i en sandkasse. | Beregn replikaforsinkelsen, og afgør, om du skal fortsætte. |
| **HTTP request** | OneUptime Worker | Du kalder et eksisterende API: en cloududbyder, PagerDuty, en Slack-webhook, din egen tjeneste. | `POST` til din failover-orkestrator. |
| **Bash** | En Runner | Du har brug for shell-kommandoer på din egen infrastruktur. | Kør et gendannelsesscript, eller kald med `curl` en tjeneste, som kun dit netværk når. |
| **SSH** | En Runner | Du har brug for et bash-script på en fjernmaskine, logget ind med en hemmelig variabel. | Genstart en tjeneste på en webserver. |
| **kubectl** | En Runner | Du har brug for kubectl-kommandoer mod en klynge. | Genstart `checkout-api` i `production`, og vent derefter på dens nye pods. |
| **AI** | OneUptime Worker | Du vil have en analyse, et resumé eller en vurdering midt i kørslen fra dit projekts LLM-udbyder. | "Gennemgå diagnosticeringen ovenfor. Er det sikkert at lave failover?" |

Et runbook kan blande dem alle. Styrken ved runbooks er at flette menneskelige kontroller sammen med automatisering og AI-analyse.

## Hvad starter en kørsel

| Hvordan | Hvor | Udførelsen knyttes til |
| --- | --- | --- |
| En runbook-regel | **Hændelser**, **Advarsler** eller **Planlagt vedligeholdelse** → **Regler** → **Runbook-regler** | Den nye hændelse, advarsel eller begivenhed |
| **Kør runbook** | Siden **Runbooks** for en hændelse, en advarsel eller en planlagt vedligeholdelsesbegivenhed | Den begivenhed |
| **Kør nu** | Runbookets side **Oversigt** | Intet: en ad hoc-kørsel |
| En AI-regel | Se [AI SRE](/docs/ai/ai-sre) | Hændelsen eller advarslen |
| Runbookets tidsplan | Runbookets side **Udløsere**, se [Runbook-udløsere](/docs/runbooks/triggers#kør-efter-en-tidsplan) | Intet: en kørsel uden opsyn |
| Et kald til runbookets webhook-URL | Runbookets side **Udløsere**, se [Runbook-udløsere](/docs/runbooks/triggers#kald-webhooken) | Intet: kørslen gemmer de værdier, kaldet sendte |

Et runbook, hvis kontakt **Kør dette runbook** er slået fra på siden **Indstillinger**, startes ikke af nogen af disse. Kørsler, der allerede er startet, fortsætter.

## Hvor runbooks ligger i dashboardet

Runbooks ligger under **Produkter**, i gruppen **Dashboards og automatisering**.

| Side | Hvad du gør der |
| --- | --- |
| **Produkter → Runbooks** | Gennemse, opret og åbn runbooks. |
| Et runbooks **Trin** | Skriv og omarranger dets trin, og vælg så **Gem trin**. |
| Et runbooks **Oversigt** | Se den seneste kørsel og resultaterne, og klik på **Kør nu**. |
| Et runbooks **Udførelser** | Alle kørsler af dette runbook, filtreret efter status eller startdato. |
| Et runbooks **Udløsere** | Kør det efter en [tidsplan](/docs/runbooks/triggers#kør-efter-en-tidsplan), eller fra et andet værktøj via dets [webhook-URL](/docs/runbooks/triggers#kald-webhooken). |
| Et runbooks **Variabler** | Administrer de [variabler](/docs/runbooks/variables), som kun det runbooks trin bruger. |
| Et runbooks **Ejere** | Tilføj de personer og teams, der er ansvarlige for det. |
| Et runbooks **Indstillinger** | Slå **Kør dette runbook** fra uden at slette runbooket. |
| **Runbooks → Udførelser** | Alle kørsler af alle runbooks i projektet. |
| **Runbooks → Runbook-agenter** | Installer de [Runners](/docs/runbooks/agents), som dine runbook-trin kører på. |
| **Runbooks → Indstillinger** | Administrer under **Globale variabler** de variabler, som alle runbooks kan [bruge](/docs/runbooks/variables), samt de **Ejerregler** og **Etiketregler**, der tilføjer ejere og etiketter til nye runbooks. |
| **Hændelser / Advarsler / Planlagt vedligeholdelse → Regler → Runbook-regler** | Opret de regler, der starter runbooks automatisk. |
| En hændelse, advarsel eller vedligeholdelsesbegivenhed → **Runbooks** | Se de kørsler, der er knyttet til den, og klik på **Kør runbook** for at starte en. |

Et runbooks egen sidemenu grupperer dets sider sådan. Kun **Grundlæggende** er åbent fra start: klik på en sektions titel for at åbne den. En sektion åbner af sig selv på enhver side i den.

| Sektion | Sider |
| --- | --- |
| **Grundlæggende** | **Oversigt**, **Trin** |
| **Protokoller** | **Udførelser** |
| **Ejere** | **Ejere** |
| **Indstillinger** | **Udløsere**, **Variabler**, **Indstillinger** |
| **Udvikler** | **Terraform**, **API**, **AI-assistenter** |
| **Avanceret** | **Auditlogs**, **Slet runbook** |

## Et gennemgået eksempel

Antag, at hver hændelse med "db-primary" i titlen skal starte et database-failover-runbook med fem trin.

:::steps
### Opret runbooket

Under **Runbooks** klikker du på **Opret Runbook** og kalder det "DB primary failover". Det åbner på **Trin**: tilføj disse trin, og klik så på **Gem trin**:

| # | Type | Titel |
| --- | --- | --- |
| 1 | JavaScript | Registrer replikaforsinkelsen før failover |
| 2 | Manual | Bekræft i DBA-dashboardet, at replikaen er sund |
| 3 | HTTP request | `POST` til failover-orkestratoren |
| 4 | Manual | Kontrollér, at skrivninger går til den nye primære |
| 5 | HTTP request | Send afblæsningen til `#db-incidents` i Slack |

### Tilføj en regel

Under **Hændelser → Regler → Runbook-regler** opretter du en regel med én betingelse og det runbook, der skal startes:

```text
Conditions:  Incident Title starts with db-primary
Runbooks:    [DB primary failover]
```

### Lad det køre

En monitor åbner hændelsen `INC-4821 · db-primary connection timeout`. Reglen matcher, og en udførelse starter:

- Trin 1 (JavaScript) kører på den Runner, du valgte til det. Returværdien, f.eks. `{ lagMs: 412 }`, registreres. Et trin, der ikke vælger nogen Runner, kører på projektets standard-Runner eller, hvis der ikke er angivet en, på en global Runner.
- Trin 2 (Manual) sætter kørslen på pause, som viser **Venter på dig**. Den vagthavende tjekker dashboardet og klikker på **Marker som færdig**.
- Trin 3 (HTTP request) kører, og svaret på `POST` registreres.
- Trin 4 (Manual) sætter kørslen på pause igen, indtil nogen fuldfører det.
- Trin 5 (HTTP request) kører, og udførelsen er **Fuldført**.

### Gennemgå den

Udførelsen bliver på hændelsens side **Runbooks**. Når du skriver postmortem, er hvert trins output, fejl og timing ét klik væk.
:::

## Almindelige anvendelser

- **Database-failover**: registrer tilstanden med JavaScript, bed den vagthavende DBA om at bekræfte replikaens tilstand (Manual), kald orkestratoren (HTTP request), bekræft DNS (Manual), send afblæsningen (HTTP request).
- **Tømning af cache**: én HTTP-anmodning, og derefter et Manual-trin "bekræft, at cache-hitraten er ved at komme sig".
- **Hændelse med kundepåvirkning**: Manual "send en opdatering på statussiden", en HTTP-anmodning for at give supportteamet besked, JavaScript for at hente listen over berørte konti.
- **Forhåndstjek før planlagt vedligeholdelse**: tag et øjebliksbillede af metrikker, bekræft ændringsvinduet med interessenterne (Manual), slå vedligeholdelsestilstand til på load balanceren (HTTP request).
- **Diagnosticer, og ret så**: et Bash-trin indsamler diagnosticering, et AI-trin læser den og anbefaler en rettelse, og et kubectl-trin med **Kræv godkendelse** genstarter arbejdsbelastningen, først når en person har godkendt det.
- **Hygiejne, der altid kører**: en regel uden betingelser, der registrerer systemets tilstand ved hver hændelse til postmortem.

## Sådan passer runbooks ind i resten af OneUptime

- **Monitorer** åbner hændelser og advarsler, og **runbook-regler** gør dem til runbook-udførelser: opdag, udløs, reager, registrer.
- **[Vagtpolitikker](/docs/on-call/schedules)** afgør, hvem der tilkaldes. Runbooks afgør, hvad den person gør, når vedkommende er vågen.
- **[Workspace-forbindelser](/docs/workspace-connections/slack)** som Slack og Microsoft Teams er naturlige mål for HTTP-anmodningstrin, der sender opdateringer.
- **[Statussider](/docs/status-pages/index)** opdateres ofte som et Manual-trin i et kunderettet runbook.

## Næste skridt

:::cards
- [Skriv et runbook](/docs/runbooks/authoring): Opret dit første runbook og dets trin.
- [Runbook-agenter](/docs/runbooks/agents): Installer en Runner, før du skriver et Bash-, SSH- eller kubectl-trin.
- [Runbook-regler](/docs/runbooks/rules): Start runbooks automatisk, når der oprettes hændelser.
- [Runbook-konfiguration & sikkerhed](/docs/runbooks/configuration): Grænser, timeouts, tilladelser og hærdning.
:::
