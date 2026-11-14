# Spørg AI

Spørg AI er OneUptimes chat over dit projekts data. Spørg om logs, traces, metrikker, undtagelser, hændelser, advarsler, monitorer, vagtordning, statussider, SLO'er, runbooks eller workflows: chatten forespørger dit projekt live, underbygger hver påstand med en kilde og handler for dig, når du tillader det.

:::cards
- [Åbn Spørg AI](#åbn-spørg-ai): Fra topbjælken, tastaturet, et diagram eller produktmenuen.
- [Hvad den kan se](#hvad-den-kan-se): De data, den læser for at svare dig.
- [Handlinger og tilladelsestilstande](#handlinger-og-tilladelsestilstande): Vælg, om den må handle, og hvornår den spørger først.
- [Handlinger udføres som dig](#handlinger-udføres-som-dig): Dine tilladelser, dit navn på hver ændring.
:::

## Sådan svarer Spørg AI

Spørg AI svarer kun ud fra det, dens værktøjer returnerer: den kører forespørgsler mod dit projekt i stedet for at svare ud fra hukommelsen. Hvert faktum i et svar har en kildechip, der viser forespørgslen bag det og åbner de data, den læste. Når du beder den ændre noget, afgør samtalens tilladelsestilstand, om den spørger dig først. Før dit spørgsmål læser den projektets [AI-kontekst](/docs/ai/ai-context): det, dit team har skrevet ned til OneUptime AI om jeres egne systemer.

```mermaid title="Fra et spørgsmål til et underbygget svar"
flowchart TB
    Q["Dit spørgsmål,<br/>med den side,<br/>du står på"] --> A["Spørg AI"]
    A -->|"læseværktøjer"| D["Dit projekts data,<br/>forespurgt live"]
    D --> R["Et svar med en<br/>kilde for hver<br/>påstand"]
    A -->|"en handling"| M{"Tilladelses-<br/>tilstanden"}
    M -->|"Ask to act"| C["Et godkendelseskort:<br/>du tillader eller<br/>springer over"]
    M -->|"Auto-run"| X["Den kører,<br/>som dig"]
    C -->|"tilladt"| X
```

I tilstanden **Skrivebeskyttet** tilbydes modellen aldrig handlingerne, så samtalen kun læser.

## Spørgsmål om OneUptime

Spørg AI svarer også på spørgsmål om selve OneUptime: "Hvordan får jeg en sms, når mit site er nede?", "Hvad er en episode?", "Hvor tilføjer jeg et ekstra telefonnummer?". Svarene kommer fra denne dokumentation, den kopi din OneUptime selv leverer, så det virker uden internetadgang og sender intet nye steder hen. Den læser en side på dit sprog, når siden er oversat, angiver side og afsnit for hvert trin og siger, at dokumentationen ikke dækker noget, i stedet for at gætte.

Et svar på "hvordan gør jeg" slutter med en knap, der åbner den side i dit projekt, hvor du gør det, fx **Opret monitor** eller **Notifikationsmetoder**. Den åbner kun sider, OneUptime har: dem, Søg (`Ctrl` + `K`) finder.

## Åbn Spørg AI

| Hvor | Hvordan |
| --- | --- |
| Enhver side | Klik på **Spørg AI** i topbjælken, eller tryk `Ctrl` + `I` (`Cmd` + `I` på en Mac). Mens du skriver i et tekstfelt eller en editor, forbliver tasterne editorens genvej til kursiv. |
| Kommandopaletten | Tryk `Ctrl` + `K` (`Cmd` + `K` på en Mac), og vælg **Spørg AI**. |
| Et fejlmønster i logs eller et diagrams fund | Klik på **Forklar med AI**: Spørg AI åbner med beviserne som et spørgsmål, du kan redigere, før du sender det. |
| Produktmenuen | Åbn **Produkter → AI → Chat**. Spørg AI åbner ved siden af den side, du var på. Hver samtale har sin egen adresse, så du kan bogmærke den og vende tilbage til den. |

Spørg AI åbner i siden af vinduet, og siden gør plads til den: intet er skjult bag den, så du kan arbejde videre på siden, gå til andre sider og spørge igen. Træk i kanten for at gøre den bredere eller smallere. Tryk på `Esc` i den, eller klik på **Spørg AI** igen, for at give siden hele vinduet tilbage. Mens den er åben, går `Ctrl` + `I` (`Cmd` + `I` på en Mac) fra siden til feltet, du skriver i, og lukker den derfra. Samtalen bliver, hvor du forlod den: åbn Spørg AI igen for at fortsætte. Lukker du den, mens den stadig svarer, siger en påmindelse i hjørnet, hvornår svaret er klar, og åbner det. På en tablet eller en telefon, hvor der ikke er plads til begge, åbner den over siden, og på en telefon fylder den hele skærmen.

På en hændelse eller en advarsel har kortet **OneUptime AI** sin egen samtale, **Spørg OneUptime AI**, som deles af alle, der kan se hændelsen eller advarslen: se [Tal med OneUptime AI om hændelsen](/docs/ai/ai-sre#tal-med-oneuptime-ai-om-hændelsen).

## Hvad den kan se

Spørg AI læser dit projekt med dine egne tilladelser, så den ser det, du må se, og intet mere.

| Område | Hvad Spørg AI læser |
| --- | --- |
| Telemetri | Logsøgning og histogrammer, trace-aggregeringer og span-træer, metrikker, undtagelser, sikkerhedshændelser, real user monitoring og Web Vitals, nylige ændringer og anomalitjek mod indlærte baselines. |
| Infrastruktur | Hosts, Docker, Podman, Kubernetes, Docker Swarm, Proxmox, VMware vCenter, Ceph, lagersystemer, serverless-funktioner, cloudmiljøer, IoT-flåder og netværksenheder: hvad der er i inventaret, deres rapporterede forbindelsestilstand, metriktrends, antal logs pr. alvorlighed og resuméer af trace-operationer. En forespørgsel dækker både telemetri, der nævner en tjeneste, og telemetri, der nævner en infrastrukturressource. |
| Hændelseshåndtering | Hændelser og advarsler med tilstandsfiltre ("hvad er aktivt lige nu?"), deres aktivitetstidslinjer (tilstandsskift, interne og offentlige noter, feedet) og ejere samt en søgning i tidligere hændelser for at genbruge, hvordan de blev løst. |
| Vagter | Hvem der har vagt nu, politikker og eskaleringskæder, og om de seneste udkald blev leveret og kvitteret. |
| AI'ens eget arbejde | Resultaterne af AI SRE-undersøgelser og AI-indsigter, så "hvad fandt AI'en?" besvares ud fra den offentliggjorte analyse i stedet for at blive udledt igen. |
| Platform | Monitorer (med statusfiltre), planlagt vedligeholdelse, statussider og deres meddelelser, SLO'er, runbooks, workflow-kørsler, probernes sundhed, teams og koden i forbundne repositories på GitHub, GitLab, Forgejo, Gitea og Azure DevOps (se [Hvad AI læser i et Git-repositorie](/docs/ai/ai-agent#hvad-ai-læser-i-et-git-repositorie)). |

## Sidekontekst

Spørg AI ved, hvilken side du åbnede den fra. På en hændelsesside betyder "hvorfor skete det?" netop den hændelse: indtastningsfeltet viser en chip med sidens emne, og de spørgsmål, den foreslår, er sidens egne. Fjern chippen for at spørge om hele projektet i stedet, og tilføj den igen på samme måde. Åbn Spørg AI på en anden side, så følger konteksten med. Samtalen husker også sit første emne på serveren, så et opfølgende spørgsmål dage senere stadig forstår "denne hændelse".

På en hændelse, en advarsel, en monitor eller en planlagt vedligeholdelse følger spørgsmålene også, hvor den post står, læst hver gang Spørg AI åbnes på den. En løst hændelse spørger, hvordan responsen gik, og hvad der ville forhindre, at den sker igen, en løst advarsel, om den var et reelt problem, og hvor ofte advarsler som den bliver udløst, og en monitor, der ikke er i drift, spørger hvorfor. En vedligeholdelse, der ikke er startet, spørger, om dens monitorer er sunde, før den starter, og en, der er slut, om de er tilbage til normal.

Infrastrukturlister og ressourcesider tilbyder spørgsmål til den slags ressource, du ser på. Åbn en Kubernetes-klynge og spørg "Hvilke metrikker har ændret sig de seneste 24 timer?", eller åbn en Docker-host og spørg "Opsummér logalvorlighed og trace-fejl de seneste seks timer." Bevislinks fører tilbage til ressourcens side. Læsninger respekterer dine tilladelser til projekt, ressourcer og telemetri, inklusive begrænsninger på ejerskab og labels.

På en underside registrerer konteksten også den pod, container, VM, proces eller anden underressource, du valgte. Infrastrukturværktøjerne læser den overordnede ressources telemetri; de kan ikke måle én underressource ud fra dens navn alene. Spørg AI siger det og gætter ikke på et Kubernetes-namespace, som siden ikke angiver. En forbindelsestilstand er ikke en workloads sundhed, og manglende telemetri betyder ikke, at en ressource er sund.

## Kommandoer på din infrastruktur

Åbnet på siden for en ressource, hvis AI-agent er forbundet (en vært, en Docker- eller Podman-vært, et Docker Swarm-cluster, et Proxmox-cluster, et VMware vCenter, et Ceph-cluster, en databaseserver eller et Kubernetes-cluster), kører Spørg AI kommandoer på den gennem den agent, når du beder om det: "kør `uptime` på denne vært" eller "vis de sidste 100 linjer af `journalctl -u nginx`". Den svarer med det, der kom tilbage, med kildehenvisning ligesom al anden dokumentation. Åbnet på en hændelse eller en advarsel når den de ressourcer, der er knyttet til den.

- Den kører kun de skrivebeskyttede kommandoer, som en AI-undersøgelse må køre på den slags ressource (se [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents)), så mange som svaret kræver, kontrolleret af OneUptime og igen af agenten, i alle tilladelsestilstande. En ændring gennem agenten, for eksempel at genstarte en tjeneste, kører aldrig fra Spørg AI: den giver dig i stedet den præcise kommando, og agenten foretager kun ændringer, når OneUptime AI udbedrer en hændelse eller advarsel, efter ressourcens egne indstillinger for rettelser. Spørg AI's egne handlinger, for eksempel at køre en runbook, følger samtalens tilladelsestilstand, som beskrevet nedenfor.
- Den når kun de ressourcer, du må se, og kun mens AI-undersøgelse er slået til for ressourcen.
- Når den ikke kan køre en kommando der (ingen agent er forbundet, agenten er offline, eller AI-undersøgelse er slået fra for ressourcen), siger den det sammen med, hvad der skal ændres, og svarer i stedet ud fra dit projekts data.

## Handlinger og tilladelsestilstande

Hver samtale har en tilladelsestilstand, som du vælger i indtastningsfeltet ved siden af tekstboksen:

| Tilstand | Hvad der sker |
| --- | --- |
| **Spørg før handling** | Standard. Spørg AI foreslår hver handling på et godkendelseskort, og intet kører, før du vælger **Tillad** eller **Spring over** for den, eller **Afvis alle**. |
| **Kør automatisk** | Handlinger kører, så snart modellen beder om dem, stadig begrænset til det, din rolle må. Brug den med omtanke. |
| **Skrivebeskyttet** | Handlingerne tilbydes slet ikke modellen: Spørg AI kan kun læse. |

Hvad Spørg AI kan gøre, når en tilstand tillader det:

- Oprette en hændelse eller en advarsel, kvittere for eller løse hændelser og advarsler og ændre en hændelses alvorlighed.
- Knytte en hændelse eller en advarsel til den infrastruktur og de tjenester, den drejer sig om. En hændelse eller en advarsel, den opretter på en ressources side, fx en værts, knyttes til den ressource, og godkendelseskortet nævner, hvad hver handling knytter til. OneUptime AI undersøger og retter det, en hændelse eller advarsel er knyttet til.
- Registrere et problem, som nogen allerede tager sig af, eller som allerede er overstået: en hændelse eller en advarsel, den opretter, kan starte bekræftet eller løst og tilkalder så ingen. Godkendelseskortet siger hvilken. Se [Erklæret allerede bekræftet eller løst](/docs/incidents/declaring-incidents#erklæret-allerede-bekræftet-eller-løst).
- Skrive en intern note på en hændelse eller en advarsel. Interne noter vises aldrig på en statusside.
- Offentliggøre en statusopdatering på en hændelse. Det er en særskilt handling, fordi den giver statussidens abonnenter besked.
- Kalde en vagtpolitik ud, køre en runbook eller starte en AI-undersøgelse af en hændelse eller advarsel.
- Sætte ting op ud fra én sætning: en monitor for et website eller en API, hvem der kaldes ud, en statusside og de monitorer, den viser, alt sammen på ét godkendelseskort. Se [Sæt ting op](#sæt-ting-op).
- Foreslå en kodeændring: committe til en ny branch i et repository på GitHub, GitLab, Forgejo eller Gitea og åbne en pull request (en merge request på GitLab). Den skriver aldrig til standardbranchen eller en beskyttet branch, så en person stadig merger ændringen. Ask AI skriver hver fil hel ud fra filen, som den sidst læste den, og læser et repositorys hovedbranch, medmindre den bliver bedt om en anden. Er en fil blevet ændret på branchen, efter at Ask AI læste den, nævner kortet den, før du godkender committet eller pull requesten, for eksempel "Denne fil blev ændret på fix/login, efter at AI læste den, og AI's version fortryder den ændring: src/billing/charge.ts." Kortet nævner også en fil, som Ask AI kun har læst på en anden branch, hvor den er anderledes, en fil, som Ask AI aldrig har læst, men erstatter, og en fil, som OneUptime ikke kunne kontrollere. Ask AI læser en lang fil en del ad gangen, så kortet nævner også en fil, som Ask AI kun har læst en del af, for eksempel "AI læste kun en del af denne fil, og AI's version erstatter hele filen: src/billing/charge.ts." Når Ask AI har læst hele filen, i én læsning eller flere, siger kortet intet om den. Et senere svar har de tidligere svars ord, ikke de filer, de læste, så kortet nævner også en fil, som Ask AI kun har læst i et tidligere svar, for eksempel "AI læste denne fil i et tidligere svar og har ikke længere dens tekst, og AI's version erstatter hele filen: src/billing/charge.ts." Et meget langt svar udelader også sine ældste resultater for at holde sig inden for det, modellen kan rumme på én gang, så kortet nævner også en fil, som Ask AI læste tidligere i samme svar, hvis det resultat blev udeladt, for eksempel "AI læste denne fil tidligere i dette svar og har ikke længere dens tekst, og AI's version erstatter hele filen: src/billing/charge.ts." Hvis Ask AI har læst filen i flere dele og ikke længere har dem alle, siger kortet også det, for eksempel "AI læste denne fil og har ikke længere en del af dens tekst, og AI's version erstatter hele filen: src/billing/charge.ts." Når Ask AI læser filen igen i det svar, der ændrer den, siger kortet intet om den. En ny fil tæller aldrig med. Vil du bevare det, en anden har ændret, så spring handlingen over og bed Ask AI om at læse filerne igen. I Kør automatisk, hvor ingen godkender handlinger, laver Ask AI ikke en sådan ændring: den læser filerne igen og laver sin ændring på dem, som de er nu. Ændres en fil, mens kortet venter på dig, ændrer godkendelsen intet, og Ask AI foreslår ændringen igen. En pull request, du alligevel godkender, nævner filerne i sin beskrivelse for den, der gennemgår den. Ask AI får aldrig vist værdier, der ligner hemmeligheder eller persondata, såsom IP-adresser, e-mailadresser og nøgler: den læser en pladsholder som `[redacted-ip]` i stedet. Derfor nævner kortet også en fil, som Ask AI's version skriver sådanne pladsholdere ind i, for eksempel "Værdier, der ligner hemmeligheder eller persondata, blev skjult for AI, og AI's version af denne fil skriver pladsholdere i stedet for dem: config/servers.ts." En pladsholder, som filen på branchen allerede har, tæller ikke. Ask AI kan ikke skrive de værdier tilbage, så i Kør automatisk laver den ikke den ændring, men fortæller dig i stedet, hvad du skal ændre.

Bed om en hændelse, når brugere er berørt, og om en advarsel, når noget først kræver dit teams opmærksomhed, fx en værts hukommelse, der bliver ved med at stige. Begge oprettes én gang og overvåger intet: For at blive advaret, hver gang en værts hukommelse kommer over 75 %, skal du oprette en [værts-monitor](/docs/monitor/host-monitor#færdige-advarselsskabeloner) ud fra dens hukommelsesskabelon med 75 % som tærskel. Spørg AI sætter kun monitorer for websites og API'er op (se [Sæt ting op](#sæt-ting-op)). Bliver den bedt om en anden slags, siger den det, tjekker den aktuelle værdi og tilbyder at oprette en advarsel, hvis den allerede er over.

## Handlinger udføres som dig

Enhver handling, Spørg AI udfører, sker som dig: den foretager den samme ændring, som dashboardet foretager for samme handling, med dine egne tilladelser i projektet, og ændringen tilskrives dig. Kvitteres en hændelse fra chatten, opstår det samme tilstandsskift som fra hændelsens tilstandspanel, så hændelsens tidslinje og feed viser, at du ændrede dens tilstand. Et udkald sendt fra chatten viser dig som den, der udløste det.

- **Hvad hver handling kræver.** Den tilladelse, dashboardet kræver for samme ændring. At oprette en hændelse eller en advarsel kræver tilladelse til at oprette dem: en rolle, der må, eller **Create Incident** eller **Create Alert** i en brugerdefineret rolle. At kvittere for eller løse en hændelse kræver tilladelse til at ændre dens tilstand: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Hændelsesadministrator** og **Hændelsesmedlem**, eller **Create Incident State Timeline** i en brugerdefineret rolle; en advarsel kræver samme tilladelse for advarsler (**Create Alert State Timeline**). At oprette en hændelse eller en advarsel, der starter bekræftet eller løst, kræver begge dele: tilladelse til at oprette den og tilladelse til at ændre dens tilstand. At kalde en vagtpolitik ud kræver tilladelse til at udføre den (**Execute On-Call Policies**), og at køre en runbook kræver tilladelse til at starte runbook-kørsler: en rolle, der kører runbooks, for de runbooks, dens labels når, eller **Create Runbook Execution** i en brugerdefineret rolle, som når alle projektets runbooks. At ændre en hændelses alvorlighed, starte en AI-undersøgelse af en hændelse eller advarsel og skrive kode til et forbundet repository kræver tilladelse til at ændre den hændelse, advarsel eller det repository. En handling, du ikke må udføre, afvises, og AI'en fortæller dig, hvilken tilladelse den kræver. Har du tilladelsen, men et team, du er med i, blokerer den, fortæller AI'en dig det i stedet: en blokering på visse labels afviser handlingen i Spørg AI for alle poster, ikke kun for poster med de labels.
- **Hvilke poster.** Dem, du må ændre, som overalt i OneUptime: med en rolle, der er begrænset til visse labels eller til de poster, du ejer, ændrer en handling på enhver anden post intet. En runbook kører kun, når din tilladelse til at starte runbook-kørsler når den. I OneUptime Cloud afvises en handling, som projektets abonnement ikke omfatter, med det abonnement, den kræver.
- **Når en handling afvises.** Intet ændres, og AI'en siger klart, at handlingen ikke blev udført, og hvorfor, i stedet for at prøve igen. Blandt svarets trin siger handlingens eget, at den ikke blev udført, og hvorfor: din rolle tillader det ikke, et team, du er med i, blokerer det, eller projektets abonnement omfatter det ikke.
- **Slack, Microsoft Teams og AI-undersøgelser.** AI'ens svar i Slack og Microsoft Teams og autonome AI-undersøgelser læser kun: de udfører ingen af disse handlinger. Bedt om en ændring der siger AI'en, hvordan du laver den fra chatten: `/oneuptime incident` erklærer en hændelse, `/oneuptime incident 42` viser hændelse 42 med dens knapper, `/oneuptime page` tilkalder nogen (i Microsoft Teams de samme ord skrevet til OneUptime-botten), og knapperne på OneUptimes beskeder handler også som dig (se [Slack](/docs/workspace-connections/slack#handl-på-hændelser-advarsler-og-begivenheder-fra-slack) og [Microsoft Teams](/docs/workspace-connections/microsoft-teams#handl-på-hændelser-advarsler-og-begivenheder-fra-microsoft-teams)). For enhver anden ændring linker den til Spørg AI, som foreslår ændringen, så du kan godkende den. Spurgt i en hændelses eller en advarsels egen kanal tager den den hændelse eller advarsel som den, du mener.

## Sæt ting op

Spørg AI sætter ud fra én sætning det op, som de guidede opsætninger sætter op: "Overvåg example.com hvert minut, og send mig en sms, hvis det er nede."

- **Én plan, én godkendelse.** Spørg AI foreslår hver del på ét godkendelseskort, hver med almindelige ord: en monitor for et website eller en API, projektets første vagtpolitik, en statusside og de monitorer, den viser. Kortet slutter med "Intet andet ændres." Vælg **Spring over** ved enhver del, du ikke vil have, og kør resten. Intet oprettes før.
- **Spørger altid.** Opsætningen venter på din godkendelse i alle tilstande, også **Kør automatisk**, fordi den opretter ting, der kalder folk ud, og som dine kunder ser. **Skrivebeskyttet** tilbyder den ikke.
- **De guidede opsætningers poster.** Monitoren er den, **Vide, når mit website eller API er nede** opretter for den samme adresse: standardværdierne fra Opret monitor, der åbner en hændelse, når adressen ikke svarer eller svarer med en fejl, tjekket hvert 5. minut, medmindre du beder om et andet af Opret monitors intervaller. Den er din, så du får en e-mail, når dens status ændrer sig. Statussiden er den, **Udgiv en statusside** opretter: offentlig, så snart den er oprettet, og den viser hver monitors status, oppetid og historik.
- **Hvem der kaldes ud.** I et projekt, der endnu ikke kalder nogen ud, foreslår Spørg AI projektets første vagtpolitik, "Default on-call policy", der kalder dig, og de medlemmer og teams, du nævner, ud ved hver ny hændelse og hver ny advarsel. Et projekt, der allerede kalder folk ud, beholder sine egne vagtpolitikker og vagtregler, og Spørg AI siger det i stedet for at oprette endnu en.
- **Hvad der mangler.** Spørg AI tilføjer aldrig et telefonnummer eller mobilappen: Du tilføjer og bekræfter dem selv under **Brugerindstillinger → Notifikationsmetoder**. Beder du om sms'er uden et bekræftet nummer, siger kortet det, og svaret linker til siden. En del, Spørg AI ikke kan oprette, foreslås ikke, fx når din rolle ikke tillader det, adressen ikke er en adresse, eller monitorerne ikke findes: Svaret siger, hvad der skal til.
- **Hvad hver del kræver.** En monitor kræver tilladelse til at oprette monitorer. Udkald kræver tilladelse til at oprette vagtpolitikker, deres eskaleringsregler og vagtregler for hændelser og advarsler. En statusside kræver tilladelse til at oprette statussider og tilføje monitorer til dem. Projektets abonnementsgrænser gælder, som i de guidede opsætninger.
- **Test det bagefter.** Når planen er kørt, åbner hvert kort det, der blev oprettet, og **Test denne politik** (eller **Send mig et testkald**, for en monitor alene) under svaret sender et testkald, som du kvitterer for fra beskeden. Fejler en del, siger svaret, hvad der blev oprettet, og hvad der ikke blev.
- **Hvem der får besked.** Spørg "hvem får besked, når example.com er nede?", og Spørg AI svarer ud fra den samme kæde, som monitorens side viser, og nævner hvert brud.

## Styr en samtale

- **Stop den.** Mens Spørg AI arbejder, bliver send-knappen til en stopknap. Stop en kørsel når som helst, og spørg straks om noget andet.
- **Følg dens arbejde.** Mens den svarer, siger én linje, hvad den gør nu, for eksempel søger i logs. Klik på antallet af trin ved siden af for at se hvert trin.
- **Vælg modellen.** Når dit projekt kan bruge mere end én LLM-udbyder, viser udbydervælgeren i indtastningsfeltet dit projekts LLM-udbydere og de globale, med standarden markeret. En ny samtale bruger standarden.
- **Bedøm et svar.** **Godt svar** og **Dårligt svar** gemmes sammen med beskeden, så svarenes kvalitet kan måles over tid.
- **Se prisen.** Under hvert svar åbner kilderne sig i de forespørgsler, det kørte, og kilderne til det nyeste svar siger også, hvor mange forespørgsler det kørte, dets tokens og dets pris. Hver kildechip i et svar åbner dataene bag den.
- **Gem en kopi.** **Download samtale** gemmer tråden med **Download som Markdown**, til at læse eller indsætte i en sag, eller **Download som PDF**, til at give videre.
- **Fortsæt, hvor du slap.** **Alle samtaler**, i Spørg AI's topbjælke, viser dine samtaler, nyeste først, så du kan åbne dem igen eller slette dem. Starten på en ny samtale viser de seneste tre.

## Krav

- **En LLM-udbyder.** Spørg AI bruger projektets standard-LLM-udbyder (se [LLM-udbydere](/docs/ai/llm-provider)). I OneUptime Cloud virker den med det samme med den globale udbyder, betalt af projektets AI-kreditter; en selvhostet installation konfigurerer en udbyder eller miljøvariablerne for den globale udbyder. Svarene er kun så gode som modellen: en lille selvhostet model uden pålidelige værktøjskald svarer dårligt.
- **Growth-abonnementet, i OneUptime Cloud.** Et projekt på et lavere abonnement ser, at AI ikke er med i abonnementet, med et link til **Projektindstillinger → Fakturering og fakturaer → Fakturering**.
- **AI slået til for projektet.** **Aktivér AI** på **Projektindstillinger → AI → AI-funktioner** slår alle projektets AI-funktioner fra, Spørg AI inklusive. Den er slået til, medmindre nogen har slået den fra.

Spørg AI tæller med i projektets egne daglige AI-grænser, når projektet sætter dem (Projektindstillinger → AI → AI Features → Yderligere indstillinger): når en er nået, viser Spørg AI en sætning om, hvilken grænse der blev nået, at OneUptime AI starter igen ved midnat UTC, og hvem der kan hæve eller fjerne grænsen. Projektets ejere får en e-mail, første gang en grænse nås hver dag. De daglige grænser for hændelser og advarsler stopper aldrig Spørg AI. Se [projektets egne daglige grænser](/docs/ai/ai-sre#projektets-egne-daglige-grænser).

## Fejlfinding

:::details Spørg AI siger, at AI ikke er tilgængelig
Spørg AI siger hvorfor, før du skriver: projektets abonnement omfatter ikke AI, **Aktivér AI** er slået fra, eller projektet har ingen LLM-udbyder. Hver besked linker til den side, hvor det ændres.
:::

:::details En handling blev afvist
Spørg AI siger, hvilken tilladelse handlingen kræver, eller hvilket team der blokerer den. Bed en, der må foretage ændringen, eller bed en projektejer give din rolle tilladelsen. Intet blev ændret.
:::

:::details Svarene er vage eller bruger aldrig data
Tjek modellen bag udbyderen. Spørg AI har brug for en model, der kalder værktøjer pålideligt; små lokale modeller svarer ofte uden at køre en eneste forespørgsel. Se [LLM-udbydere](/docs/ai/llm-provider).
:::

## Næste trin

:::cards
- [AI SRE](/docs/ai/ai-sre): Lad OneUptime AI undersøge hver ny hændelse og advarsel.
- [LLM-udbydere](/docs/ai/llm-provider): Vælg den model, Spørg AI og de andre AI-funktioner bruger.
- [MCP-server](/docs/ai/mcp-server): Spørg om OneUptime fra Claude, Cursor eller VS Code i stedet.
:::
