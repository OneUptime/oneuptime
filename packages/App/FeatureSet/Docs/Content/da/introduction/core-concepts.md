# Grundbegreber

OneUptime har mange produkter, men de hviler på en håndfuld idéer: projekter, monitorer, hændelser og advarsler, vagter, statussider og telemetri. Omkring dem findes det, du overvåger, det, du installerer, og de regler, der handler for dig. Denne side forklarer hver idé med få sætninger, viser, hvordan de hænger sammen, og linker til de sider, der dækker dem i detaljer. Læs den én gang, så bliver alle andre sider i dokumentationen lettere at læse. Se [Ordliste](/docs/introduction/glossary) for ét ord ad gangen, og [Hvilken skal jeg bruge?](/docs/introduction/which-one) for at vælge mellem to ting, der ligner hinanden.

:::cards
- [Projekter og personer](#projekter-og-personer): Hvor alt ligger, og hvem der må hvad.
- [Monitorer og sonder](#monitorer-og-sonder): Hvordan OneUptime opdager, at noget er galt.
- [Hændelser og advarsler](#hændelser-og-advarsler): Den post, dit team arbejder ud fra.
- [Vagt](#vagt): Hvem der tilkaldes, hvordan, og hvem der er den næste.
:::

## Sådan hænger delene sammen

Et problem bevæger sig i én retning gennem OneUptime. Sonder og din egen telemetri føder monitorer. En monitors kriterier afgør, hvornår noget er galt, og hvad der åbnes: en hændelse, en advarsel eller begge. Vagtpolitikker tilkalder personer om dem, og statussider fortæller dine kunder om hændelser.

```mermaid title="Hvordan et problem bevæger sig gennem OneUptime"
flowchart TB
    probes["Sonder tjekker"] --> monitors["Monitorer"]
    telemetry["Applikationer og agenter<br/>sender telemetri"] --> monitors
    monitors -->|"erklærer"| incident["Hændelse"]
    monitors -->|"opretter"| alert["Advarsel"]
    incident --> policy["Vagtpolitik"]
    alert --> policy
    incident --> statuspage["Statusside"]
    policy --> person["Den, der har vagt"]
    statuspage --> subscribers["Abonnenter"]
```

## Projekter og personer

Et **projekt** rummer alt: monitorer, hændelser, vagtpolitikker, statussider, telemetri og indstillinger. De fleste virksomheder har brug for ét, og nogle har ét pr. miljø eller forretningsenhed. Intet, du opretter i ét projekt, kan ses i et andet.

Din **konto** er adskilt fra dine projekter. Én konto, med én e-mail og én adgangskode, kan høre til så mange projekter, du vil; skift mellem dem med projektvælgeren øverst til venstre. Se [Din konto](/docs/introduction/your-account).

Personer er med i et projekt gennem **teams**, og et teams tilladelser afgør, hvad dets medlemmer må. Hvert nyt projekt starter med tre teams: Owners, med dig i, Admin og Members. På OneUptime Cloud har hvert projekt sin egen plan.

:::cards
- [Brugere, teams og tilladelser](/docs/permissions/index): Invitér personer, og bestem, hvad de må.
:::

## Monitorer og sonder

En **monitor** tjekker én ting, du kører, og afgør, om den virker. De fleste monitorer tjekkes af **sonder**: maskiner, der kører tjekket efter en tidsplan, for eksempel ved at hente en side, kalde et API, pinge en vært eller forespørge en database. OneUptime Cloud kører sonder i flere regioner, en selvhostet installation kører sine egne, og du kan tilføje brugerdefinerede sonder i dit netværk. Andre monitorer læser i stedet det, du sender: telemetrien fra dine applikationer, eller de data, en agent rapporterer fra dine servere, Kubernetes-klynger og øvrige infrastruktur.

En monitors **kriterier** afgør, hvad hvert resultat betyder. De tjekkes i rækkefølge, og det første, der passer, kan ændre monitorens status, erklære en hændelse, oprette en advarsel eller alle tre. Hvert nyt projekt har tre monitorstatusser: **I drift**, **Forringet** og **Offline**.

:::cards
- [Opret en monitor](/docs/monitor/create-monitor): Vælg en type, sig hvad der skal tjekkes, og hvor ofte.
- [Brugerdefinerede probes](/docs/probe/custom-probe): Tjek det, kun dit eget netværk kan nå.
:::

## Det, du overvåger

En monitor tjekker én ting. Omkring dine monitorer fører OneUptime en oversigt over det, du kører, og du møder disse poster i menuen:

- En **monitorgruppe** samler flere monitorer i én status, så en statusside kan vise noget, der består af mange dele, for eksempel Checkout, som én række.
- En **tjeneste** er en applikation eller microservice, du kører. OneUptime tilføjer den, første gang dens telemetri ankommer, og samler dens logs, traces, metrikker, undtagelser og hændelser på én side.
- **Værter**, klynger i **Kubernetes** og resten af **Infrastruktur** er de maskiner og platforme, du kører, og de udfyldes af de agenter, du installerer.
- **Inventar** er én liste over det hele: tjenester, værter, klynger, enheder, cloudressourcer og de ting, der slet ikke sender telemetri.

De mødes der, hvor et problem viser sig. En tjenestes monitorer kan samles i en monitorgruppe, et SLO måler dem, og når én af dem fejler, erklærer den en hændelse. Hændelsen opfører tjenesten blandt de ressourcer, den påvirker, og statussiden viser gruppen og hændelsen.

```mermaid title="Én tjeneste, hvad der overvåger den, og hvor den vises"
flowchart TB
    service["Tjeneste: Checkout"] -->|"overvåges af"| monitors["Dens monitorer"]
    monitors --> group["Monitorgruppe"]
    monitors --> slo["SLO"]
    monitors -->|"erklærer"| incident["Hændelse"]
    group --> statuspage["Statusside"]
    incident --> statuspage
```

:::cards
- [Monitorgrupper](/docs/monitor/monitor-groups): Saml flere monitorer i én status.
- [Tjenester](/docs/telemetry/services): Hver applikation, du kører, med sin egen side.
- [Inventar – Oversigt](/docs/inventory/overview): Alt, hvad OneUptime ved om dit miljø.
:::

## Pålidelighedsmål

Et **SLO** (service level objective) er et pålidelighedsmål for det, du overvåger, for eksempel tilgængelig 99,9 % af tiden over 30 dage. OneUptime måler det ud fra dets monitorer hvert 5. minut. Den nedetid, målet tillader, er dets fejlbudget: med meget tilbage kan du tage chancer, og med lidt tilbage sætter du tempoet ned og investerer i stabilitet.

:::cards
- [SLO'er – Oversigt](/docs/slo/introduction): Sæt et mål, og se, hvor meget af budgettet der er tilbage.
:::

## Hændelser og advarsler

Begge registrerer et problem, og begge kan tilkalde den, der har vagt. Forskellen er, hvem problemet rammer.

| | Hændelse | Advarsel |
| --- | --- | --- |
| **Hvad det er** | Et problem, der rammer dine brugere, for eksempel et nedbrud eller en opbremsning | Et problem, dit team bør se på, før brugerne bliver ramt |
| **På statussider** | Kan vises, og giver abonnenter besked | Aldrig |
| **Startstatusser** | **Identificeret**, **Bekræftet**, **Løst** | **Identificeret**, **Bekræftet**, **Løst** |
| **Startalvorligheder** | Critical Incident, Major Incident, Minor Incident | **Høj**, **Lav** |

At bekræfte en siger, at nogen tager sig af den, og forhindrer dens vagtpolitikker i at tilkalde det næste niveau. At løse den afslutter den. Du kan tilføje dine egne statusser og alvorligheder og knytte advarsler til den hændelse, de viste sig at høre til.

En **episode** samler relaterede hændelser, eller relaterede advarsler, så dit team arbejder med dem som én. Grupperingsregler afgør, hvad der hører sammen.

:::cards
- [Hændelser – Oversigt](/docs/incidents/index): Hvordan hændelser erklæres, håndteres og løses.
- [Advarsler – Oversigt](/docs/alerts/index): Hvor advarsler kommer fra, og hvordan episoder grupperer dem.
- [Tilknyttede advarsler](/docs/incidents/linked-alerts): Knyt de advarsler, et nedbrud udløste, til dets hændelse.
:::

## Vagt

En **vagtpolitik** afgør, hvem der tilkaldes om en hændelse eller advarsel, og hvem der er den næste, hvis ingen reagerer. Dens **eskaleringsregler** er dens niveauer: hver tilkalder sine personer og venter så på, at nogen bekræfter, før det næste niveau tilkaldes. Et niveau kan tilkalde personer, teams eller en **vagtplan**, en rotation, der til enhver tid ved, hvem der har vagt.

Hvordan hver person kontaktes, bestemmer vedkommende selv. I **Brugerindstillinger** gemmer hver person de måder, OneUptime kan kontakte dem på, for eksempel e-mail, SMS, opkald, push-notifikationer, Slack eller Microsoft Teams, og hvilke der bruges ved et tilkald.

:::cards
- [Vagt – Oversigt](/docs/on-call/index): Hvordan et tilkald når frem, og hvor hver del findes.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Tilkald personer niveau for niveau, indtil nogen reagerer.
- [Vagtplaner](/docs/on-call/schedules): Rotationer, lag og vagtskifter.
- [Sådan når OneUptime dig](/docs/notifications/index): De metoder, regler og indstillinger, der afgør, hvordan hver person nås.
:::

## Statussider og vedligeholdelse

En **statusside** viser dine kunder, om dine tjenester virker. Du vælger, hvilke monitorer den viser, under navne, dine kunder forstår. Mens en hændelse på en af de monitorer er aktiv, viser siden den, og dens **abonnenter** får besked via e-mail, SMS, Slack, Microsoft Teams eller webhook. En statusside kan være offentlig eller privat for dem, du lukker ind.

**Planlagt vedligeholdelse** annoncerer planlagt arbejde på forhånd. En begivenhed går gennem **Planlagt**, **Igangværende**, **Afsluttet** og **Fuldført**, og de statussider, du viser den på, fortæller besøgende og abonnenter om den.

:::cards
- [Statussider – Oversigt](/docs/status-pages/index): Opret en statusside, og bestem, hvad den viser.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers): Hvem der får besked, og hvornår.
- [Planlagt vedligeholdelse – Oversigt](/docs/scheduled-maintenance/index): Hvordan en begivenhed forløber, og hvad den sætter på pause.
:::

## Telemetri

**Telemetri** er det, dine systemer sender til OneUptime: logs, metrikker, traces, undtagelser og profiler. Applikationer sender den med OpenTelemetry, og OneUptimes agenter sender den fra værter, Kubernetes-klynger, Docker-værter og øvrig infrastruktur. Hver afsender bruger en **indtagelsesnøgle**, oprettet under **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**. Du søger i telemetrien, viser den på dashboards og holder øje med den med telemetrimonitorer, der åbner hændelser og advarsler som enhver anden monitor. I menuen åbner **Protokoller**, **Metrikker**, **Spor**, **Profiler** og **Undtagelser** hver sin slags; **AI / LLM** følger din AI's samtaler, **Dataobservabilitet** holder øje med tabellerne i dine databaser, og **Topologi** kortlægger, hvordan det hele hænger sammen.

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send logs, metrikker og traces fra dine applikationer.
- [Log-monitor](/docs/monitor/logs-monitor): Få besked, når et mønster dukker op i dine logs.
:::

## Sikkerhed

**Sikkerhedshændelser** gemmer sikkerhedsbegivenhederne fra dine logs, dine sikkerhedsværktøjer og alt andet, du sender. Dens detektionsregler gør det, de finder, til sikkerhedssager, som dit team behandler i en kø, og som playbooks reagerer på. **Datasikkerhed** finder de følsomme data i dine buckets, databaser og din telemetri, og hvad der er galt med måden, de opbevares på.

:::cards
- [Kom godt i gang med sikkerhed](/docs/telemetry/security-getting-started): Find trusler i de data, du allerede har.
- [Oversigt over Datasikkerhed](/docs/data-security/index): Find dine følsomme data, og ret måden, de opbevares på.
:::

## Det, du installerer, og nøglerne

Det meste af OneUptime kræver ingen installation. Du installerer kun noget for at nå det, OneUptime ikke kan se udefra, og hver del forbinder ud til OneUptime med en nøgle:

- En brugerdefineret sonde kører monitorernes tjek inde i dit netværk med sit eget sonde-ID og sin egen nøgle.
- **OpenTelemetry Collector**, Kubernetes-agenten og Docker-agenten sender telemetri med en **indtagelsesnøgle**. Infrastrukturagenten bag en Server / VM-monitor sender med den monitors hemmelige nøgle.
- En **Runner** kører runbook-trin inde i din infrastruktur med sit eget Runner-ID og sin egen nøgle.

En indtagelsesnøgle sender kun telemetri ind. En **API-nøgle** er den anden slags: den lader et script, CLI'en, Terraform eller en AI-assistent læse og ændre dit projekt med de tilladelser, du giver den. Ingen af dem virker i stedet for den anden.

:::cards
- [Hvilken skal jeg bruge?](/docs/introduction/which-one#sonde-agent-collector-eller-runner): Hvad du skal installere, og den nøgle, hver af dem bruger.
- [Indtagelsesnøgler](/docs/telemetry/ingestion-keys): Opret, afgræns og roter de nøgler, der sender telemetri.
:::

## Automatisering og AI

- **Arbejdsgange** udfører handlinger, når der sker noget, for eksempel en besked i Slack, når en hændelse erklæres.
- **Runbooks** gør en beredskabsprocedure til trin, dit team kan køre manuelt eller automatisk.
- **OneUptime AI** undersøger nye hændelser og advarsler og poster det, den fandt, på deres tidslinje, og **Spørg AI** besvarer spørgsmål om dit projekt. Et nyt projekt starter med AI slået til; kontakten **Aktivér AI** under **Projektindstillinger → AI → AI-funktioner** slår det hele fra.

:::cards
- [Workflows – Oversigt](/docs/workflows/index): Automatisér handlinger med triggere og komponenter.
- [AI SRE](/docs/ai/ai-sre): Hvordan OneUptime AI undersøger hændelser og advarsler.
:::

## Etiketter og ejere

**Etiketter** er mærker, du sætter på monitorer, hændelser, statussider og de fleste andre ressourcer, så du kan filtrere og gruppere dem. Et teams tilladelser kan begrænses til ressourcer med bestemte etiketter. **Ejere** er de personer og teams, der er ansvarlige for én ressource: de får besked, når der sker noget med den. Etiketregler og ejerregler tilføjer etiketter og ejere til nye ressourcer for dig.

:::cards
- [Etiket- og ejerregler](/docs/configuration/label-and-owner-rules): Giv nye ressourcer etiketter og ejere automatisk.
:::

## Regeltyperne

Mange ting i OneUptime kaldes en regel. Hver af dem træffer én beslutning for dig, når noget nyt ankommer, og de findes i nogle få familier. De fleste af dem ligger under **Regler** i sidemenuerne for **Hændelser** og **Advarsler**.

| Hvad den afgør | Regler |
| --- | --- |
| Hvem der tilkaldes | **Vagtregler** vælger de vagtpolitikker, en ny hændelse eller advarsel kører, og en politiks **Eskaleringsregler** tilkalder niveau for niveau |
| Hvem der ejer den, og hvordan den mærkes | **Ejerregler**, **Etiketregler** og **Privatlivsregler** |
| Hvad der hører sammen | **Grupperingsregler** åbner episoder og føjer til dem |
| Hvad der kører på den | **Runbook-regler** starter runbooks, og **AI-regler** afgør, hvad OneUptime AI undersøger og retter |
| Hvornår der skal følges op | **SLA-regler** følger svar- og løsningstider, og **Påmindelsesregler** minder ejerne om den, mens den er åben |

En monitors egne regler er dens kriterier. Vagtreglerne under **Brugerindstillinger** er noget helt andet: de er hver persons egne og afgør, hvordan et tilkald når frem til den person.

:::cards
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings#regler-der-kører-når-en-hændelse-oprettes): De regler, der kører, når en hændelse oprettes, i rækkefølge.
- [Sådan når man mig](/docs/notifications/on-call-rules): Hvordan et tilkald når frem til dig.
:::

## Næste trin

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Brug idéerne i praksis på femten minutter.
- [Ordliste](/docs/introduction/glossary): Hvert ord, OneUptime bruger, forklaret med en sætning eller to.
- [Hvilken skal jeg bruge?](/docs/introduction/which-one): Hændelse eller advarsel, arbejdsgang eller runbook, og de andre ting, der ligner hinanden.
- [Hændelser – Oversigt](/docs/incidents/index): Hvad der sker, efter at en monitor erklærer en hændelse.
:::
