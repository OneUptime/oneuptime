# Hvilken skal jeg bruge?

Nogle ting i OneUptime ligner hinanden. Denne side stiller hvert sæt op side om side med det, hver enkelt er beregnet til, så du vælger den rigtige første gang. Hver tabel kan ses på én skærm, og dens første kolonne åbner den side, der dækker det valg i detaljer.

:::cards
- [Hændelse, advarsel eller en anden slags problem?](#hændelse-advarsel-eller-en-anden-slags-problem): Hvad et problem bliver til i OneUptime.
- [Arbejdsgang, runbook, playbook eller AI-regel?](#arbejdsgang-runbook-playbook-eller-ai-regel): Hvad du skal automatisere med.
- [Monitorgruppe, tjeneste eller etiket?](#monitorgruppe-tjeneste-eller-etiket): Hvordan du grupperer det, du overvåger.
- [Sonde, agent, collector eller Runner?](#sonde-agent-collector-eller-runner): Hvad du skal installere, og den nøgle, hver af dem bruger.
- [Dashboard, offentligt dashboard eller statusside?](#dashboard-offentligt-dashboard-eller-statusside): Hvad du skal dele, og med hvem.
:::

## Hændelse, advarsel eller en anden slags problem?

De fleste problemer er en hændelse eller en advarsel: vælg ud fra, hvem problemet rammer. De andre er poster, OneUptime fører for dig, og hver af dem kan føre til en hændelse eller en advarsel.

| Post | Hvad det er | Brug det, når |
| --- | --- | --- |
| [Hændelse](/docs/incidents/index) | Et problem, der rammer dine brugere. Den kan tilkalde den, der har vagt, og vises på dine statussider. | Kunderne opdager det nu eller snart: et nedbrud, en opbremsning, en betaling, der fejler. |
| [Advarsel](/docs/alerts/index) | Et problem for dit team. Den kan tilkalde den, der har vagt, men vises aldrig på en statusside. | Dit team bør handle, før brugerne opdager det: en disk, der er ved at blive fuld, et certifikat, der snart udløber. |
| [Episode](/docs/incidents/episodes) | En gruppe relaterede hændelser, eller relaterede advarsler, der håndteres som én. | Én årsag udløste mange hændelser eller advarsler. Grupperingsregler åbner episoder for dig. |
| [Undtagelse](/docs/telemetry/exceptions) | Hver forekomst af én fejl, din kode kaster, samlet og med dens stack trace. | Du vil rette en fejl. En undtagelsesmonitor kan oprette en advarsel eller en hændelse, når antallet af fejl stiger brat. |
| [AI-indsigt](/docs/ai/ai-sre#indsigter-proaktiv-detektion) | Et problem, OneUptime fandt i din telemetri, før noget tilkaldte nogen, for eksempel en spids i fejllogs. | Du vil have et tidligt varsel. En indsigt tilkalder aldrig nogen og åbner aldrig en hændelse: den venter i en indbakke. |
| [Sikkerhedssag](/docs/telemetry/security-cases) | Én trussel, der er værd at undersøge, med alle detektioner om den samme bruger, vært eller adresse samlet i den. | Dit sikkerhedsteam undersøger. **Erklær hændelse** på en sag åbner en hændelse, når brugere er ramt. |

En advarsel kan knyttes til den hændelse, den viste sig at være en del af, så du mister intet ved at starte med en advarsel.

## Arbejdsgang, runbook, playbook eller AI-regel?

Alle fire kan køre af sig selv. Vælg ud fra, hvad de handler på, og hvem der skrev trinene.

| Værktøj | Hvad det gør | Brug det, når |
| --- | --- | --- |
| [Arbejdsgang](/docs/workflows/index) | Blokke på et lærred, der kører, når deres trigger udløses: en hændelse oprettes, en tidsplan er nået, et andet værktøj kalder en URL. | Du vil forbinde OneUptime med andre værktøjer eller handle på dets poster uden at skrive kode. |
| [Runbook](/docs/runbooks/index) | Din responsprocedure som trin, fra manuelle tjeklister til scripts, HTTP-anmodninger og kubectl, kørt på en hændelse, en advarsel eller en vedligeholdelsesbegivenhed. | De vagthavende skal følge de samme trin hver gang. Runbook-regler starter et runbook på de hændelser, der passer. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Trin, der reagerer på en sikkerhedssag: sikre beviserne, tilkalde den, der har vagt, suspendere en bruger. | Dit sikkerhedsteam reagerer på den samme slags trussel på samme måde hver gang. |
| [AI-regel](/docs/ai/ai-sre#hvilke-hændelser-der-undersøges-og-rettes) | Afgør, hvilke nye hændelser og advarsler OneUptime AI undersøger og retter, og om den spørger først. | OneUptime AI skal kun arbejde på nogle hændelser eller rette uden at spørge. Uden en regel undersøger den hver eneste. |

## Monitorgruppe, tjeneste eller etiket?

Alle tre samler ting, men for forskellige læsere. De fungerer også sammen: en tjenestes monitorer kan udgøre én monitorgruppe, og de kan alle bære den samme etiket.

| Valg | Hvad det er | Brug det, når |
| --- | --- | --- |
| [Monitorgruppe](/docs/monitor/monitor-groups) | Flere monitorer samlet i én status, den værste blandt dem, med sin egen oppetid. | Kunderne skal se én række på en statusside for noget, der består af flere monitorer, for eksempel Checkout. |
| [Tjeneste](/docs/telemetry/services) | En applikation, OneUptime fandt i din telemetri, med dens logs, traces, metrikker, hændelser og ejere på én side. | Du vil have alt om én applikation samlet ét sted. Den dukker op af sig selv ud fra sin `service.name`. |
| [Etiket](/docs/configuration/label-and-owner-rules) | Et mærke, du sætter på monitorer og de fleste andre poster. En post kan have mange. | Du vil filtrere lister, begrænse et teams tilladelser eller udvælge poster i regler. |

Monitorgrupper er slået fra fra start: slå dem til under **Projektindstillinger → Avanceret → Funktionsflag**.

## Sonde, agent, collector eller Runner?

Det meste af OneUptime kræver ingen installation: installer kun noget for at nå det, OneUptime ikke kan se udefra. Hver enkelt forbinder ud med en nøgle af sin egen slags.

| Installation | Hvad den gør | Installer den, når | Nøgle, den bruger |
| --- | --- | --- | --- |
| [Brugerdefineret sonde](/docs/probe/custom-probe) | Kører dine monitorers tjek inde fra dit netværk. | Det, du tjekker, er bag din firewall. OneUptimes egne sonder tjekker det, der er offentligt. | Sit eget sonde-ID og sin egen nøgle |
| [Infrastrukturagent](/docs/monitor/server-monitor) | Rapporterer én maskines CPU, hukommelse, diske og processer til en Server / VM-monitor. | Du vil have én monitor for én server med kriterier på dens tal. | Monitorens hemmelige nøgle |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Sender en maskines metrikker, logs og processer. **Tilføj vært** installerer den med én kommando. | Du vil have en maskine under **Værter** med dens telemetri. | En indtagelsesnøgle |
| [Kubernetes-agent](/docs/telemetry/kubernetes-agent) | Indsamler en klynges metrikker, begivenheder, logs og traces. Du installerer den med Helm. | Du kører Kubernetes. | En indtagelsesnøgle |
| [Runner](/docs/runbooks/agents) | Kører runbook-trin, for eksempel Bash, SSH og kubectl, inde i din infrastruktur. | Dine runbooks skal kunne nå dine egne værter og klynger. | Sit eget Runner-ID og sin egen nøgle |

### Indtagelsesnøgle eller API-nøgle?

| Nøgle | Hvad den lader dig gøre | Hvor du opretter den |
| --- | --- | --- |
| [Indtagelsesnøgle](/docs/telemetry/ingestion-keys) | Sende telemetri ind i projektet og intet andet. | **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler** |
| [API-nøgle](/docs/permissions/index#api-nøgler) | Læse og ændre projektet via API'et, CLI'en, Terraform eller en AI-assistent med de tilladelser, du giver den. | **Projektindstillinger → Avanceret → API-nøgler** |

Ingen af dem virker i stedet for den anden.

## Dashboard, offentligt dashboard eller statusside?

Vælg ud fra, hvem der skal se det.

| Deling | Hvem ser det | Brug det, når |
| --- | --- | --- |
| [Dashboard](/docs/dashboards/index) | Personer, der logger ind i dit projekt. | Dit team holder øje med diagrammer og lister: en vagtskærm, et teams egen visning. |
| [Offentligt dashboard](/docs/dashboards/sharing) | Alle med linket, medmindre du tilføjer en adgangskode, begrænser det til bestemte IP-adresser eller hoster det på dit eget domæne. | Personer uden for projektet skal kunne se dine diagrammer, for eksempel en partner eller en skærm på væggen. |
| [Statusside](/docs/status-pages/index) | Dine kunder, offentligt, eller kun de private brugere, du lukker ind. | Kunderne vil vide, om dine tjenester virker, og have besked om hændelser og vedligeholdelse. |

En statusside taler i hændelser og i de navne, du giver dine monitorer; et dashboard viser tallene bag dem.

## Næste trin

:::cards
- [Ordliste](/docs/introduction/glossary): Hvert ord, OneUptime bruger, forklaret med en sætning eller to.
- [Grundbegreber](/docs/introduction/core-concepts): Hvordan delene hænger sammen, på én side.
- [Hurtigstart](/docs/introduction/quickstart): En monitor, et tilkald og en statusside på femten minutter.
:::
