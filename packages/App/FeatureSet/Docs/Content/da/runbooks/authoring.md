# Skriv et runbook

Du skriver et runbook som en ordnet liste af trin på dets side **Trin**. Denne side viser, hvordan du opretter et runbook, hvordan du sætter hver af de syv trintyper op, og hvordan fejl og godkendelser ændrer en kørsels forløb.

:::cards
- [Opret et runbook](#opret-et-runbook): Fra et tomt runbook til gemte trin.
- [Trintyper](#trintyper): Manual, JavaScript, HTTP request, Bash, SSH, kubectl og AI.
- [Fejlhåndtering og godkendelser](#fejlhåndtering-og-godkendelser): Hvad der sker, når et trin fejler eller venter på godkendelse.
- [Et gennemgået eksempel](#et-gennemgået-eksempel): En database-failover i fem trin.
:::

## Før du går i gang

- **En rolle, der skriver runbooks.** Project Owner, Project Admin og Runbook Admin opretter runbooks og gemmer deres trin. Med detaljerede tilladelser skal du have **Create Runbook** og **Edit Runbook**. Se [Tilladelser](/docs/runbooks/configuration#tilladelser).
- **En Runner, til Bash-, SSH- og kubectl-trin.** Disse trin kører på en [Runner](/docs/runbooks/agents) i din egen infrastruktur, aldrig på OneUptime Worker. Installer en først. Et trin, der ikke vælger nogen Runner, kører på [projektets standard-Runner](/docs/runbooks/agents#projektets-standard-runner), hvis du har angivet en; ellers kører et JavaScript-trin på en [global Runner](/docs/runbooks/agents#globale-runnere).
- **En hemmelig variabel, til SSH- og kubectl-trin.** Den nøgle, adgangskode eller kubeconfig, som et trin logger ind med, er en hemmelig [runbook-variabel](/docs/runbooks/variables). Project Owner og Project Admin opretter variabler, og Runbook Admin vælger dem i de trin, den skriver. Et kubectl-trin kan i stedet bruge Runnerens egen adgang.
- **En LLM-udbyder, til AI-trin.** Se [LLM-udbydere](/docs/ai/llm-provider).

## Opret et runbook

:::steps
### Åbn Runbooks

Åbn **Produkter → Runbooks**. Runbooks ligger i gruppen **Dashboards og automatisering**.

### Opret runbooket

Klik på **Opret Runbook**, angiv et **Navn** og eventuelt en **Beskrivelse** af, hvad runbooket er til. Under **Flere felter** ligger kontakten **Aktiveret**, der er slået til som standard, og **Etiketter**. Det nye runbook åbner på sin side **Trin**.

### Tilføj trin

Under **Kom i gang med din runbook** vælger du typen af det første trin; under det sidste trin tilbyder **Tilføj endnu et trin** de samme syv typer. Hvert trin åbner med sin **Titel** og det, dets type kræver; resten, f.eks. dets **Beskrivelse** og timeouts, er foldet sammen under **Flere felter**. Når runbooket har et trin, tilføjer **Tilføj trin** øverst på kortet et Manual-trin.

### Sæt trinnene i rækkefølge

Trin kører **i rækkefølge**. Du ændrer rækkefølgen ved at trække et trin i grebet til venstre i dets overskrift; med tastaturet sætter du fokus på grebet, trykker på mellemrum, flytter trinnet med piletasterne og trykker på mellemrum igen.

### Gem trinnene

Klik på **Gem trin**. Indtil du gør det, viser editoren **Ikke-gemte ændringer**. Når de er gemt, ser du **Gemt**, og runbooket er klar til at [køre](/docs/runbooks/running).
:::

## Et trins opbygning

Hvert trin har disse felter. Et automatiseret trin viser sin **Titel** og indstillingerne for sin type og folder resten sammen under **Flere felter**, som viser, hvad af det der er sat:

| Felt | Formål |
| --- | --- |
| **Titel** | En kort betegnelse, der vises på trinlisten og ved hver kørsel. |
| **Beskrivelse** | Valgfri kontekst til den, der reagerer, i Markdown, under **Flere felter**. På et Manual-trin er det de **Instruktioner**, personen læser og følger, vist under titlen. |
| **Fortsæt ved fejl** | Kun automatiserede trin. Når den er slået til, stopper et fejlende trin ikke kørslen: det næste trin kører alligevel. |
| **Kræv godkendelse** | Kun automatiserede trin. Når den er slået til, stopper kørslen før dette trin, indtil nogen godkender det, og først derefter kører det. Kontakten hedder **Kræv godkendelse før kørsel af dette trin**, og trinnets overskrift viser **Kræver godkendelse**. |
| Typespecifikke indstillinger | Scriptet, URL'en, Runneren, en hemmelig variabel eller prompten. Se [Trintyper](#trintyper). |

## Trintyper

| Type | Kører på | Kræver |
| --- | --- | --- |
| [Manual](#manual) | En person | Intet |
| [JavaScript](#javascript) | En Runner | En Runner |
| [HTTP request](#http-request) | OneUptime Worker | Intet |
| [Bash](#bash) | En Runner | En Runner |
| [SSH](#ssh) | En Runner | En Runner og en hemmelig variabel at logge ind med |
| [kubectl](#kubectl) | En Runner | En Runner og en kubeconfig-variabel eller Runnerens egen adgang |
| [AI](#ai) | OneUptime Worker | En LLM-udbyder |

I hvert automatiseret trin nedenfor rummer trinnets **Flere felter** først dets **Runner**, for et trin, der kører på en, derefter **Kræv godkendelse** og **Fortsæt ved fejl**, derefter trinnets egne indstillinger - et HTTP-kalds headers, et SSH-trins port og nøglens adgangsfrase, et AI-trins udbyder og kontekstkontakter - og til sidst **Beskrivelse** og timeouts. Sammenfoldet nævner det trinnets Runner, så du kan se, hvor et trin kører, uden at åbne det.

### Manual

Et tjeklistepunkt til en person: trinnets **Instruktioner** siger, hvad der skal gøres eller tjekkes. Kørslen holder pause, når den når et Manual-trin, og bliver i `WaitingForManualStep` (**Venter på dig**), indtil nogen klikker på **Marker som færdig** eller **Spring over**. En kørsel, der venter på en person, udløber aldrig. Et Manual-trin har ingen godkendelseskontakt: det stopper allerede kørslen for en person.

Brug det til det, kun et menneske kan kontrollere eller gøre: "Bekræft i load balancerens dashboard, at trafikken er flyttet til den sekundære region."

### JavaScript

Et stykke JavaScript, der kører i en `isolated-vm`-sandkasse på en [runbook-agent](/docs/runbooks/agents), ikke på OneUptime Worker: på en af dine egne, eller på en [global Runner](/docs/runbooks/agents#globale-runnere), når trinnet ikke vælger nogen.

| Felt | Hvad det gør | Standard |
| --- | --- | --- |
| **Runner** | Under **Flere felter**. Den Runner, der kører trinnet: **Global Runner** eller en af dine egne. Kun den Runner, du vælger, må overtage jobbet; enhver global Runner må overtage et trin på **Global Runner**. | [Projektets standard-Runner](/docs/runbooks/agents#projektets-standard-runner), hvis du har angivet en; ellers **Global Runner**, når der er en |
| **Script** | Det JavaScript, der skal køre. Returner en værdi med `return` for at registrere den; hver linje fra `console.log` registreres også. En kastet fejl får trinnet til at fejle. | — |
| **Timeout for kørsel** | Hvor længe Runneren lader stykket køre, før den river sandkassen ned. En global Runner lader det køre i højst 5 minutter. | 30 sekunder |
| **Timeout for overtagelse** | Hvor længe Workeren venter på, at Runneren overtager jobbet. | 2 minutter |

```javascript
const start = Date.now();
// ... your logic ...
console.log("replica lag checked");
return { durationMs: Date.now() - start };
```

Sandkassen har 128 MB hukommelse og ingen adgang til filsystemet eller processer. Den kan foretage HTTP-anmodninger med `axios`, men kun til offentlige adresser: en anmodning til et privat netværk, til Runnerens egen vært eller til et cloud-metadataendpoint afvises. Brug et [Bash](#bash)-trin med `curl` for at nå en tjeneste i dit netværk.

### HTTP request

Et udgående HTTP-kald, foretaget af OneUptime Worker. Der kræves ingen Runner.

| Felt | Hvad det gør | Standard |
| --- | --- | --- |
| **Metode** | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` eller `HEAD`. | `GET` |
| **URL** | Det endpoint, der skal kaldes. | Tom |
| **Headere (JSON)** | Under **Flere felter**. Et JSON-objekt, f.eks. `{ "Authorization": "Bearer ..." }`. Headers, der ikke er gyldig JSON, får trinnet til at fejle. | Ingen |
| **Brødtekst** | Vises for `POST`, `PUT`, `PATCH` og `DELETE`. Sendes som JSON, når den kan læses som JSON, og ellers som tekst. | Ingen |
| **Timeout for anmodning** | Hvor længe der ventes på endpointets svar, før trinnet fejler. | 30 sekunder |

Trinnet lykkes ved et `2xx`- eller `3xx`-svar og fejler ved alt andet med `HTTP <status>` som fejl. Omdirigeringer følges ikke. Svarets status, headers og body registreres, op til 50 KB.

> [!NOTE]
> Workeren kalder aldrig loopback- eller link-local-adresser, f.eks. et cloud-metadataendpoint. På OneUptime Cloud kalder den kun offentlige adresser. En selvhostet OneUptime når også private netværk, medmindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`. Brug et [Bash](#bash)-trin med `curl` for at kalde en tjeneste i dit netværk fra OneUptime Cloud.

Nyttigt til: at åbne en PagerDuty-hændelse, sende til en Slack-webhook, kalde din cloududbyders eller dit eget offentlige API.

### Bash

Et bash-script, der køres med `bash -c <script>` på en [runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. Bash kører aldrig på OneUptime Worker.

| Felt | Hvad det gør | Standard |
| --- | --- | --- |
| **Runner** | Under **Flere felter**. Den Runner, der kører trinnet. Kun den Runner må overtage jobbet. Globale Runnere kører kun JavaScript-trin. | Projektets standard-Runner, hvis du har angivet en |
| **Bash-script** | Scriptet. Output (stdout og stderr) registreres op til 50 KB, og en exitkode forskellig fra nul får trinnet til at fejle. | — |
| **Timeout for kørsel** | Hvor længe Runneren lader scriptet køre, før den dræber det med `SIGKILL`. Hæv den for trin, der med god grund tager minutter. | 30 sekunder |
| **Timeout for overtagelse** | Hvor længe Workeren venter på, at Runneren overtager jobbet. | 2 minutter |

Scriptet kører i Runnerens container med de værktøjer, dens image leveres med, f.eks. `curl`, `wget` og `ssh`-klienten, og med netværksadgangen fra den vært, det kører på. For eksempel for at kontrollere en tjeneste, som kun dit netværk kan nå:

```bash
set -euo pipefail
HTTP_CODE=$(curl -s -o /tmp/resp.txt -w "%{http_code}" "http://payments.internal:8080/health")
echo "HTTP $HTTP_CODE"
cat /tmp/resp.txt
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Health check failed"
  exit 1
fi
```

Hvis den valgte Runner er offline, når kørslen når dette trin, venter trinnet op til **claim timeout** (2 minutter som standard) og fejler derefter på grund af timeout. Tilføj en agent under **Runbooks → Runbook-agenter**, før du regner med et Bash-trin.

> [!TIP]
> Hold adgangskoder og tokens ude af scriptet. Gem dem som hemmelige [runbook-variabler](/docs/runbooks/variables), og skriv `{{global.variables.NAME}}`, hvor værdien skal stå: Runneren modtager scriptet med værdien indsat, og trinnets output viser `[REDACTED]` i stedet.

### SSH

Log ind på en maskine over SSH, og kør et bash-script der. Runneren åbner forbindelsen, så maskinen skal kun kunne nås fra Runneren, og den nøgle eller adgangskode, trinnet logger ind med, er en hemmelig [runbook-variabel](/docs/runbooks/variables), der aldrig skrives i trinnet.

| Felt | Hvad det gør |
| --- | --- |
| **Runner** | Under **Flere felter**. Den Runner, der åbner forbindelsen. Den skal kunne nå maskinen over netværket. Et trin, der ikke vælger nogen, kører på projektets standard-Runner. |
| **SSH til** | Brugeren og maskinen, som du ville skrive dem efter `ssh`: `deploy@10.0.4.21`. |
| **Log ind med** | Den hemmelige variabel, der indeholder den private nøgle eller adgangskoden; værdien viser, hvilken det er. Kun hemmelige variabler tilbydes, og trinnet siger til, når dets Runner ikke må bruge den valgte. |
| **Bash-script** | Kører med `bash` på maskinen som den bruger, trinnet logger ind som. Output gemmes op til 50 KB, og en exitkode, der ikke er nul, får trinnet til at fejle. |
| **Port** | Under **Flere felter**. 22, når den er tom. |
| **Nøglens adgangsfrase** | Under **Flere felter**. Den hemmelige variabel, der indeholder adgangsfrasen til en nøgle, der har en. |
| **Timeout for kørsel** | Dækker forbindelse, login og kørsel af scriptet tilsammen, så et script, der hænger, ikke kan holde trinnet åbent. Standard 30 sekunder. |
| **Timeout for overtagelse** | Hvor længe Workeren venter på, at Runneren overtager jobbet. Standard 2 minutter. |

For eksempel for at genstarte en tjeneste og vise, at den kørte op igen:

```bash
sudo systemctl restart nginx
systemctl status nginx --no-pager
```

### kubectl

Kør kubectl-kommandoer mod en klynge. Scriptet kører med bash på Runneren, som leveres med `kubectl`, med `KUBECONFIG` pegende på klyngen: enhver kubectl-kommando virker, og det gør al bash omkring den også.

| Felt | Hvad det gør |
| --- | --- |
| **Runner** | Under **Flere felter**. Den Runner, der kører kubectl. Den skal kunne nå klyngens API-server. Et trin, der ikke vælger nogen, kører på projektets standard-Runner. |
| **Kubeconfig** | Den hemmelige variabel, der indeholder klyngens kubeconfig, eller **Runnerens egen adgang**: Runnerens egen kubeconfig eller dens tjenestekonto, når den kører i klyngen. Runneren skriver en kubeconfig til en fil, som kun den kan læse, og fjerner den, når scriptet slutter. |
| **Script** | kubectl-kommandoerne. Output gemmes op til 50 KB, og en exitkode, der ikke er nul, får trinnet til at fejle. |
| **Timeout for kørsel** | Hvor længe Runneren lader scriptet køre, før den stopper det med `SIGKILL`. Standard 30 sekunder. |
| **Timeout for overtagelse** | Hvor længe Workeren venter på, at Runneren overtager jobbet. Standard 2 minutter. |

For eksempel for at genstarte en deployment og vente, til dens nye pods er klar:

```bash
kubectl rollout restart deployment/checkout-api --namespace checkout
kubectl rollout status deployment/checkout-api --namespace checkout --timeout=120s
```

**Eksempler – klik for at indsætte**, under hvert script, indsætter almindelige scripts som disse. Giv kubeconfig'ens bruger kun det, dine scripts gør: en Role i de namespaces, de arbejder i, med de verber, de bruger. Hvis API-serveren afviser en kommando, står kubectls egen besked i trinnets output, så en tilladelsesfejl fortæller dig, hvilken role binding du skal udvide.

### AI

Bed AI om at analysere, opsummere eller beslutte noget midt i kørslen. Svaret bliver trinnets output på udførelsen. AI-trin kører på OneUptime Worker; der kræves ingen Runner.

| Felt | Hvad det gør |
| --- | --- |
| **Prompt** | Hvad AI'en skal gøre. For eksempel: "Gennemgå outputtet fra de foregående trin, og sig, om det er sikkert at fortsætte med afhjælpningen." |
| **LLM-udbyder** | Valgfri. **Projektstandard** bruger projektets standardudbyder. Fastlæg en udbyder, når trinnet har brug for en bestemt model, f.eks. en selvhostet model til data, der ikke må forlade dit netværk. Se [LLM-udbydere](/docs/ai/llm-provider). |
| **Medtag kontekst fra forrige trin** | Når den er slået til, ser AI'en alt om de trin, der kørte før dette: titel, type, status, output og fejlmeddelelser. Den får op til 4.000 tegn af hvert trins output. |
| **Medtag udløserkontekst** | Når den er slået til, ser AI'en, hvad der startede kørslen: den tilknyttede hændelse, advarsel eller planlagte vedligeholdelsesbegivenhed (beskrivelse, alvorlighed, nuværende tilstand, berørte monitorer, grundårsag, tilstandstidslinje og offentlige noter), eller hvem der kørte runbooket manuelt. |

For at holde et menneske med i løkken slår du **Kræv godkendelse** til på trinnet efter et AI-trin: AI'en analyserer, en person læser svaret, og det afhjælpende trin kører først, når personen godkender det.

**Hvad AI'en aldrig ser.** Et AI-trins svar gemmes som trinoutput på udførelsen, og udførelser kan læses af alle med læsetilladelse til runbooks, et bredere publikum end hændelsens. Derfor udelader udløserkonteksten **private interne noter** og **kanalbeskeder fra Slack og Microsoft Teams**. Outputtet fra tidligere trin scannes for hemmeligheder (tokens, nøgler, loginoplysninger), som maskeres, før det sendes til modellen. Indlejrede billeder og lange kodede data, f.eks. et skærmbillede indsat i en hændelses beskrivelse, udelades også med en kort note i stedet.

AI-trin måles og faktureres som enhver anden AI-funktion. Trinnet fejler med en meddelelse, der siger hvorfor, når det ikke har nogen prompt, når AI-funktioner er slået fra for projektet, når ingen LLM-udbyder er tilgængelig, eller når den fastlagte udbyder ikke længere er tilgængelig for projektet. Slå **Fortsæt ved fejl** til, hvis resten af runbooket stadig skal køre.

## Fejlhåndtering og godkendelser

```mermaid title="Hvad der sker ved et automatiseret trin"
flowchart TB
    reach["Kørslen når et<br/>automatiseret trin"] --> approval{"Kræv godkendelse<br/>slået til?"}
    approval -->|"ja"| wait["Kørslen venter på, at<br/>en person godkender"]
    wait -->|"godkendt"| run["Trinnet kører"]
    approval -->|"nej"| run
    wait -->|"sprunget over"| next["Næste trin"]
    run --> ok{"Lykkedes?"}
    ok -->|"ja"| next
    ok -->|"nej"| cont{"Fortsæt ved<br/>fejl slået til?"}
    cont -->|"ja"| next
    cont -->|"nej"| failed["Kørslen stopper<br/>som mislykket"]
```

Som standard standser et fejlende trin kørslen og markerer udførelsen som `Failed` med trinnets fejl som årsag. Med **Fortsæt ved fejl** slået til registreres fejlen, og det næste trin kører, hvilket passer til runbooks af typen "prøv disse tre ting, og giv så besked".

**Kræv godkendelse** gælder, før et trin kører, uanset hvad der skete før det: kørslen venter, indtil nogen klikker på **Godkend og kør**, og trinnet kører, eller på **Spring over**, og det kører aldrig. Slå det til for det trin, der ændrer noget - genstarten, failoveren, nedskaleringen - så en person først ser, hvad trinnene før det fandt. Godkendelsen hører til trinnet, så når du flytter trinnet, flytter den med.

:::note
Gennem API'et og Terraform er kontakten et trins felt `requireApprovalBeforeRunning`. Et trins felt `requireApproval`, som runbooks skrev, før godkendelser flyttede til det trin, de beskytter, virker stadig og betyder det, det betød: en godkendelse efter det trin. OneUptime læser det som en godkendelse før det næste trin eller, efter det sidste trin, som et Manual-trin til sidst med titlen **Approve the result**.
:::

## Gem og rediger

Ændringer af trinnene træder i kraft, når du klikker på **Gem trin**. Hver kørsel arbejder ud fra det øjebliksbillede, der blev taget, da den startede, så igangværende udførelser beholder de trin, de startede med, og redigering omskriver aldrig historikken for tidligere kørsler.

## Et gennemgået eksempel

Et runbook til "DB primary unreachable":

| # | Type | Hvad det gør |
| --- | --- | --- |
| 1 | JavaScript | Hent den nuværende primære vært fra din konfigurationstjeneste, og log den. |
| 2 | Manual | "Bekræft, at replikeringsforsinkelsen på den sekundære er under 5 sekunder." |
| 3 | HTTP request | `POST` til din failover-orkestrators API. |
| 4 | Manual | "Kontrollér, at skrivninger nu går til den nye primære." |
| 5 | HTTP request | `POST` af en afblæsningsbesked til en Slack-webhook. |

Den, der reagerer, ser trin 1 køre, afkrydser trin 2, ser trin 3 køre, afkrydser trin 4, og kørslen slutter med trin 5. Hvert trins output registreres til postmortem.

## Næste skridt

:::cards
- [Kør et runbook](/docs/runbooks/running): Start en kørsel, og fuldfør, godkend eller spring dens trin over.
- [Runbook-regler](/docs/runbooks/rules): Start dette runbook automatisk ved matchende hændelser.
- [Runbook-agenter](/docs/runbooks/agents): Installer den Runner, dine scripttrin har brug for.
- [Runbook-variabler](/docs/runbooks/variables): Hold værter, nøgler, adgangskoder og kubeconfigs ude af dine trin.
:::
