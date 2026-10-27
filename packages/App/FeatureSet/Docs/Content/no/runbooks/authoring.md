# Skrive et runbook

Du skriver et runbook som en ordnet liste med trinn på siden **Trinn**. Denne siden viser hvordan du oppretter et runbook, hvordan du setter opp hver av de sju trinntypene, og hvordan feil og godkjenninger endrer forløpet til en kjøring.

:::cards
- [Opprett et runbook](#opprett-et-runbook): Fra et tomt runbook til lagrede trinn.
- [Trinntyper](#trinntyper): Manual, JavaScript, HTTP request, Bash, SSH, kubectl og AI.
- [Feilhåndtering og godkjenninger](#feilhåndtering-og-godkjenninger): Hva som skjer når et trinn feiler eller venter på godkjenning.
- [Et gjennomgått eksempel](#et-gjennomgått-eksempel): En database-failover i fem trinn.
:::

## Før du begynner

- **En rolle som skriver runbooks.** Project Owner, Project Admin og Runbook Admin oppretter runbooks og lagrer trinnene deres. Med detaljerte tillatelser trenger du **Create Runbook** og **Edit Runbook**. Se [Tillatelser](/docs/runbooks/configuration#tillatelser).
- **En Runner, for Bash-, SSH- og kubectl-trinn.** Disse trinnene kjører på en [Runner](/docs/runbooks/agents) i din egen infrastruktur, aldri på OneUptime Worker. Installer en først. Et trinn som ikke velger noen Runner, kjører på [prosjektets standard-Runner](/docs/runbooks/agents#prosjektets-standard-runner), hvis du har angitt en; ellers kjører et JavaScript-trinn på en [global Runner](/docs/runbooks/agents#globale-runnere).
- **En hemmelig variabel, for SSH- og kubectl-trinn.** Nøkkelen, passordet eller kubeconfigen et trinn logger på med, er en hemmelig [runbook-variabel](/docs/runbooks/variables). Project Owner og Project Admin oppretter variabler, og Runbook Admin velger dem i trinnene den skriver. Et kubectl-trinn kan i stedet bruke Runnerens egen tilgang.
- **En LLM-leverandør, for AI-trinn.** Se [LLM-leverandører](/docs/ai/llm-provider).

## Opprett et runbook

:::steps
### Åpne Runbooks

Åpne **Produkter → Runbooks**. Runbooks ligger i gruppen **Dashbord og automatisering**.

### Opprett runbooket

Klikk **Opprett Runbook**, skriv inn et **Navn** og eventuelt en **Beskrivelse** av hva runbooket er til. Under **Flere felt** ligger bryteren **Aktivert**, som er slått på som standard, og **Etiketter**. Det nye runbooket åpnes på siden **Trinn**.

### Legg til trinn

Under **Kom i gang med runbooken din** velger du typen for det første trinnet; under det siste trinnet tilbyr **Legg til et trinn til** de samme sju typene. Hvert trinn åpnes med **Tittel** og det typen trenger; resten, som **Beskrivelse** og tidsavbrudd, er brettet sammen under **Flere felt**. Når runbooket har et trinn, legger **Legg til trinn** øverst på kortet til et Manual-trinn.

### Sett trinnene i rekkefølge

Trinn kjører **i rekkefølge**. Du endrer rekkefølgen ved å dra et trinn i håndtaket til venstre i overskriften; med tastaturet setter du fokus på håndtaket, trykker mellomrom, flytter trinnet med piltastene og trykker mellomrom igjen.

### Lagre trinnene

Klikk **Lagre trinn**. Inntil du gjør det, viser redigeringsverktøyet **Ulagrede endringer**. Når de er lagret, ser du **Lagret**, og runbooket er klart til å [kjøres](/docs/runbooks/running).
:::

## Hvordan et trinn er bygd opp

Hvert trinn har disse feltene. Et automatisert trinn viser **Tittel** og innstillingene for typen, og bretter resten sammen under **Flere felt**, som viser hva av det som er satt:

| Felt | Formål |
| --- | --- |
| **Tittel** | En kort etikett som vises i trinnlisten og ved hver kjøring. |
| **Beskrivelse** | Valgfri kontekst for den som håndterer hendelsen, i Markdown, under **Flere felt**. På et Manual-trinn er det **Instruksjoner** personen leser og følger, vist under tittelen. |
| **Fortsett ved feil** | Bare automatiserte trinn. Når den er slått på, stopper ikke et trinn som feiler kjøringen: neste trinn kjører likevel. |
| **Krev godkjenning** | Bare automatiserte trinn. Når den er slått på, stopper kjøringen før dette trinnet til noen godkjenner det, og først da kjøres det. Bryteren heter **Krev godkjenning før dette trinnet kjøres**, og trinnets overskrift viser **Krever godkjenning**. |
| Typespesifikke innstillinger | Skriptet, URL-en, Runneren, en hemmelig variabel eller prompten. Se [Trinntyper](#trinntyper). |

## Trinntyper

| Type | Kjører på | Krever |
| --- | --- | --- |
| [Manual](#manual) | En person | Ingenting |
| [JavaScript](#javascript) | En Runner | En Runner |
| [HTTP request](#http-request) | OneUptime Worker | Ingenting |
| [Bash](#bash) | En Runner | En Runner |
| [SSH](#ssh) | En Runner | En Runner og en hemmelig variabel å logge på med |
| [kubectl](#kubectl) | En Runner | En Runner og en kubeconfig-variabel eller Runnerens egen tilgang |
| [AI](#ai) | OneUptime Worker | En LLM-leverandør |

I hvert automatisert trinn nedenfor inneholder trinnets **Flere felt** først **Runner**, for et trinn som kjører på en, deretter **Krev godkjenning** og **Fortsett ved feil**, deretter trinnets egne innstillinger - headerne til et HTTP-kall, porten, passordfrasen for nøkkelen og vertsnøkkelen til et SSH-trinn, leverandøren og kontekstbryterne til et AI-trinn - og til slutt **Beskrivelse** og tidsavbruddene. Sammenslått nevner det Runneren til trinnet, så du ser hvor et trinn kjører uten å åpne det.

### Manual

Et sjekklistepunkt for en person: trinnets **Instruksjoner** sier hva som skal gjøres eller sjekkes. Kjøringen tar pause når den når et Manual-trinn, og blir værende i `WaitingForManualStep` (**Venter på deg**) til noen klikker **Marker som ferdig** eller **Hopp over**. En kjøring som venter på en person, utløper aldri. Et Manual-trinn har ingen godkjenningsbryter: det stopper allerede kjøringen for en person.

Bruk det til det bare et menneske kan kontrollere eller gjøre: "Bekreft i lastbalansererens dashbord at trafikken er flyttet til den sekundære regionen."

### JavaScript

Et stykke JavaScript som kjører i en `isolated-vm`-sandkasse på en [runbook-agent](/docs/runbooks/agents), ikke på OneUptime Worker: på en av dine egne, eller på en [global Runner](/docs/runbooks/agents#globale-runnere) når trinnet ikke velger noen.

| Felt | Hva det gjør | Standard |
| --- | --- | --- |
| **Runner** | Under **Flere felt**. Runneren som kjører trinnet: **Global Runner** eller en av dine egne. Bare Runneren du velger, kan ta jobben; enhver global Runner kan ta et trinn på **Global Runner**. | [Prosjektets standard-Runner](/docs/runbooks/agents#prosjektets-standard-runner), hvis du har angitt en; ellers **Global Runner**, når det finnes en |
| **Skript** | JavaScript-koden som skal kjøre. Returner en verdi med `return` for å registrere den; hver linje fra `console.log` registreres også. En kastet feil får trinnet til å feile. | — |
| **Tidsavbrudd for kjøring** | Hvor lenge Runneren lar koden kjøre før den river ned sandkassen. En global Runner lar den kjøre i høyst 5 minutter. | 30 sekunder |
| **Tidsavbrudd for overtakelse** | Hvor lenge Workeren venter på at Runneren tar jobben. | 2 minutter |

```javascript
const start = Date.now();
// ... your logic ...
console.log("replica lag checked");
return { durationMs: Date.now() - start };
```

Sandkassen har 128 MB minne og ingen tilgang til filsystemet eller prosesser. Den kan sende HTTP-forespørsler med `axios`, men bare til offentlige adresser: en forespørsel til et privat nettverk, til Runnerens egen vert eller til et metadataendepunkt i skyen avvises. Bruk et [Bash](#bash)-trinn med `curl` for å nå en tjeneste i nettverket ditt.

### HTTP request

Et utgående HTTP-kall, gjort av OneUptime Worker. Ingen Runner trengs.

| Felt | Hva det gjør | Standard |
| --- | --- | --- |
| **Metode** | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` eller `HEAD`. | `GET` |
| **URL** | Endepunktet som skal kalles. | Tom |
| **Overskrifter (JSON)** | Under **Flere felt**. Et JSON-objekt, for eksempel `{ "Authorization": "Bearer ..." }`. Headere som ikke er gyldig JSON, får trinnet til å feile. | Ingen |
| **Brødtekst** | Vises for `POST`, `PUT`, `PATCH` og `DELETE`. Sendes som JSON når den kan leses som JSON, ellers som tekst. | Ingen |
| **Tidsavbrudd for forespørsel** | Hvor lenge det ventes på svar fra endepunktet før trinnet feiler. | 30 sekunder |

Trinnet lykkes ved et `2xx`- eller `3xx`-svar og feiler ved alt annet, med `HTTP <status>` som feil. Omdirigeringer følges ikke. Svarets status, headere og body registreres, opptil 50 KB.

> [!NOTE]
> Workeren kaller aldri loopback- eller link-local-adresser, for eksempel et metadataendepunkt i skyen. På OneUptime Cloud kaller den bare offentlige adresser. En selvhostet OneUptime når også private nettverk, med mindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`. Bruk et [Bash](#bash)-trinn med `curl` for å kalle en tjeneste i nettverket ditt fra OneUptime Cloud.

Nyttig til: å åpne en PagerDuty-hendelse, poste til en Slack-webhook, kalle API-et til skyleverandøren din eller ditt eget offentlige API.

> [!TIP]
> Hold tokener utenfor trinnet. Lagre dem som hemmelige [runbook-variabler](/docs/runbooks/variables), og skriv `{{global.variables.NAME}}` der verdien skal stå, i URL-en, headerne eller bodyen. OneUptime sender forespørselen selv, så det setter også inn hemmeligheter, og svaret trinnet registrerer viser `[REDACTED]` i stedet. I JSON-headere eller en JSON-body settes en verdi inn i strengen sin, så et anførselstegn eller et linjeskift i den ikke ødelegger JSON-en.

### Bash

Et bash-skript som kjøres med `bash -c <script>` på en [runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. Bash kjører aldri på OneUptime Worker.

| Felt | Hva det gjør | Standard |
| --- | --- | --- |
| **Runner** | Under **Flere felt**. Runneren som kjører trinnet. Bare den Runneren kan ta jobben. Globale Runnere kjører bare JavaScript-trinn. | Prosjektets standard-Runner, hvis du har angitt en |
| **Bash-skript** | Skriptet. Output (stdout og stderr) registreres opptil 50 KB, og en exitkode som ikke er null, får trinnet til å feile. | — |
| **Tidsavbrudd for kjøring** | Hvor lenge Runneren lar skriptet kjøre før den dreper det med `SIGKILL`. Øk den for trinn som med god grunn tar minutter. | 30 sekunder |
| **Tidsavbrudd for overtakelse** | Hvor lenge Workeren venter på at Runneren tar jobben. | 2 minutter |

Skriptet kjører i Runnerens container med verktøyene imaget leveres med, som `curl`, `wget` og `ssh`-klienten, og med nettverkstilgangen til verten det kjører på. For eksempel for å sjekke en tjeneste som bare nettverket ditt kan nå:

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

Hvis den valgte Runneren er frakoblet når kjøringen når dette trinnet, venter trinnet opptil **claim timeout** (2 minutter som standard) og feiler deretter på grunn av tidsavbrudd. Legg til en agent under **Runbooks → Runbook-agenter** før du regner med et Bash-trinn.

> [!TIP]
> Hold passord og tokener utenfor skriptet. Lagre dem som hemmelige [runbook-variabler](/docs/runbooks/variables), og skriv `{{global.variables.NAME}}` der verdien skal stå: Runneren mottar skriptet med verdien satt inn, og trinnets utdata viser `[REDACTED]` i stedet.

### SSH

Logg på en maskin over SSH og kjør et bash-skript der. Runneren åpner forbindelsen, så maskinen må bare kunne nås fra Runneren, og nøkkelen eller passordet trinnet logger på med, er en hemmelig [runbook-variabel](/docs/runbooks/variables) som aldri skrives i trinnet.

| Felt | Hva det gjør |
| --- | --- |
| **Runner** | Under **Flere felt**. Runneren som åpner forbindelsen. Den må kunne nå maskinen over nettverket. Et trinn som ikke velger noen, kjører på prosjektets standard-Runner. |
| **SSH til** | Brukeren og maskinen, slik du ville skrevet dem etter `ssh`: `deploy@10.0.4.21`. |
| **Logg på med** | Den hemmelige variabelen som holder den private nøkkelen eller passordet; verdien viser hvilken det er. Bare hemmelige variabler tilbys, og trinnet sier fra når Runneren ikke får bruke den valgte. |
| **Bash-skript** | Kjører med `bash` på maskinen som brukeren trinnet logger på som. Utdata fanges opp til 50 KB, og en avslutningskode som ikke er null, får trinnet til å feile. |
| **Port** | Under **Flere felt**. 22 når den står tom. |
| **Passordfrase for nøkkelen** | Under **Flere felt**. Den hemmelige variabelen som holder passordfrasen til en nøkkel som har en. |
| **Vertsnøkkel** | Under **Flere felt**. Maskinens SHA256-fingeravtrykk eller den offentlige nøkkelen slik `ssh-keyscan` skriver den ut, én per linje. Trinnet logger bare på når maskinen legger fram en av dem. Står den tom, godtas enhver nøkkel, og trinnets utdata nevner den maskinen la fram. |
| **Tidsavbrudd for kjøring** | Dekker tilkobling, pålogging og kjøring av skriptet samlet, slik at et skript som henger, ikke kan holde trinnet åpent. Standard 30 sekunder. |
| **Tidsavbrudd for overtakelse** | Hvor lenge Workeren venter på at Runneren tar jobben. Standard 2 minutter. |

For eksempel for å starte en tjeneste på nytt og vise at den kom opp igjen:

```bash
sudo systemctl restart nginx
systemctl status nginx --no-pager
```

Oppgi maskinens vertsnøkkel så trinnet logger på akkurat den maskinen og ingen annen: `ssh-keyscan 10.0.4.21` skriver ut de offentlige nøklene, og `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` på selve maskinen fingeravtrykket. Et trinn som oppgir en, feiler på en Runner som er for gammel til å sjekke den, og sier at Runneren må oppdateres.

### kubectl

Kjør kubectl-kommandoer mot en klynge. Skriptet kjører med bash på Runneren, som har med `kubectl`, med `KUBECONFIG` pekende på klyngen: enhver kubectl-kommando virker, og det samme gjør all bash rundt.

| Felt | Hva det gjør |
| --- | --- |
| **Runner** | Under **Flere felt**. Runneren som kjører kubectl. Den må kunne nå klyngens API-server. Et trinn som ikke velger noen, kjører på prosjektets standard-Runner. |
| **Kubeconfig** | Den hemmelige variabelen som holder klyngens kubeconfig, eller **Runnerens egen tilgang**: Runnerens egen kubeconfig, eller tjenestekontoen når den kjører i klyngen. Runneren skriver en kubeconfig til en fil bare den kan lese, og fjerner den når skriptet avsluttes. |
| **Skript** | kubectl-kommandoene. Utdata fanges opp til 50 KB, og en avslutningskode som ikke er null, får trinnet til å feile. |
| **Tidsavbrudd for kjøring** | Hvor lenge Runneren lar skriptet kjøre før den stopper det med `SIGKILL`. Standard 30 sekunder. |
| **Tidsavbrudd for overtakelse** | Hvor lenge Workeren venter på at Runneren tar jobben. Standard 2 minutter. |

For eksempel for å starte en deployment på nytt og vente til de nye podene er klare:

```bash
kubectl rollout restart deployment/checkout-api --namespace checkout
kubectl rollout status deployment/checkout-api --namespace checkout --timeout=120s
```

**Eksempler – klikk for å sette inn**, under hvert skript, setter inn vanlige skript som disse. Gi kubeconfigens bruker bare det skriptene dine gjør: en Role i namespacene de jobber i, med verbene de bruker. Hvis API-serveren avviser en kommando, står kubectls egen melding i trinnets utdata, så en tillatelsesfeil forteller deg hvilken role binding du må utvide.

### AI

Be AI om å analysere, oppsummere eller bestemme noe midt i kjøringen. Svaret blir trinnets output på kjøringen. AI-trinn kjører på OneUptime Worker; ingen Runner trengs.

| Felt | Hva det gjør |
| --- | --- |
| **Prompt** | Hva AI-en skal gjøre. For eksempel: "Gå gjennom outputen fra de forrige trinnene, og si om det er trygt å fortsette med utbedringen." |
| **LLM-leverandør** | Valgfritt. **Prosjektstandard** bruker prosjektets standardleverandør. Fest en leverandør når trinnet trenger en bestemt modell, for eksempel en selvhostet modell for data som ikke skal forlate nettverket ditt. Se [LLM-leverandører](/docs/ai/llm-provider). |
| **Ta med kontekst fra forrige trinn** | Når den er slått på, ser AI-en alt om trinnene som kjørte før dette: tittel, type, status, output og feilmeldinger. Den får opptil 4 000 tegn av hvert trinns output. |
| **Ta med utløserkontekst** | Når den er slått på, ser AI-en hva som startet kjøringen: den tilknyttede hendelsen, varselet eller den planlagte vedlikeholdshendelsen (beskrivelse, alvorlighetsgrad, nåværende tilstand, berørte monitorer, rotårsak, tilstandstidslinje og offentlige notater), eller hvem som kjørte runbooket manuelt. |

For å holde et menneske i løkken slår du på **Krev godkjenning** på trinnet etter et AI-trinn: AI-en analyserer, en person leser svaret, og det utbedrende trinnet kjører først når personen godkjenner det.

**Hva AI-en aldri ser.** Svaret fra et AI-trinn lagres som trinnoutput på kjøringen, og kjøringer kan leses av alle med lesetilgang til runbooks, et bredere publikum enn hendelsens. Derfor utelater utløserkonteksten **private interne notater** og **kanalmeldinger fra Slack og Microsoft Teams**. Outputen fra tidligere trinn skannes etter hemmeligheter (tokens, nøkler, påloggingsinformasjon), som maskeres før den sendes til modellen. Innebygde bilder og lange kodede data, for eksempel et skjermbilde limt inn i beskrivelsen av en hendelse, utelates også, med et kort notat i stedet.

AI-trinn måles og faktureres som enhver annen AI-funksjon. Trinnet feiler med en melding som sier hvorfor, når det ikke har noen prompt, når AI-funksjoner er slått av for prosjektet, når ingen LLM-leverandør er tilgjengelig, eller når den festede leverandøren ikke lenger er tilgjengelig for prosjektet. Slå på **Fortsett ved feil** hvis resten av runbooket fortsatt skal kjøre.

## Feilhåndtering og godkjenninger

```mermaid title="Hva som skjer ved et automatisert trinn"
flowchart TB
    reach["Kjøringen når et<br/>automatisert trinn"] --> approval{"Krev godkjenning slått på?"}
    approval -->|"ja"| wait["Kjøringen venter på at<br/>en person godkjenner"]
    wait -->|"godkjent"| run["Trinnet kjører"]
    approval -->|"nei"| run
    wait -->|"hoppet over"| next["Neste trinn"]
    run --> ok{"Lyktes det?"}
    ok -->|"ja"| next
    ok -->|"nei"| cont{"Fortsett ved<br/>feil slått på?"}
    cont -->|"ja"| next
    cont -->|"nei"| failed["Kjøringen stopper<br/>som mislykket"]
```

Som standard stopper et trinn som feiler kjøringen og markerer den som `Failed`, med trinnets feil som årsak. Med **Fortsett ved feil** slått på registreres feilen, og neste trinn kjører, noe som passer for runbooks av typen "prøv disse tre tingene, og varsle så".

**Krev godkjenning** gjelder før et trinn kjører, uansett hva som skjedde før det: kjøringen venter til noen klikker **Godkjenn og kjør**, og trinnet kjører, eller **Hopp over**, og det kjører aldri. Slå det på for trinnet som endrer noe - omstarten, failoveren, nedskaleringen - slik at en person først ser på hva trinnene før det fant. Godkjenningen hører til trinnet, så flytter du trinnet, flytter den med.

:::note
Gjennom API-et og Terraform er bryteren et trinns felt `requireApprovalBeforeRunning`. Et trinns felt `requireApproval`, som runbooks skrev før godkjenninger flyttet til trinnet de vokter, virker fortsatt og betyr det det betydde: en godkjenning etter det trinnet. OneUptime leser det som en godkjenning før neste trinn eller, etter det siste trinnet, som et Manual-trinn til slutt med tittelen **Approve the result**.
:::

## Lagre og redigere

Endringer i trinnene trer i kraft når du klikker **Lagre trinn**. Hver kjøring arbeider ut fra øyeblikksbildet som ble tatt da den startet, så pågående kjøringer beholder trinnene de startet med, og redigering skriver aldri om historikken for tidligere kjøringer.

## Et gjennomgått eksempel

Et runbook for "DB primary unreachable":

| # | Type | Hva det gjør |
| --- | --- | --- |
| 1 | JavaScript | Hent den nåværende primære verten fra konfigurasjonstjenesten din, og logg den. |
| 2 | Manual | "Bekreft at replikeringsforsinkelsen på den sekundære er under 5 sekunder." |
| 3 | HTTP request | `POST` til API-et til failover-orkestratoren din. |
| 4 | Manual | "Kontroller at skrivinger nå går til den nye primære." |
| 5 | HTTP request | `POST` en avblåsningsmelding til en Slack-webhook. |

Den som håndterer hendelsen, ser trinn 1 kjøre, krysser av trinn 2, ser trinn 3 kjøre, krysser av trinn 4, og kjøringen avsluttes med trinn 5. Outputen fra hvert trinn registreres til postmortem.

## Neste steg

:::cards
- [Kjøre et runbook](/docs/runbooks/running): Start en kjøring, og fullfør, godkjenn eller hopp over trinnene.
- [Runbook-regler](/docs/runbooks/rules): Start dette runbooket automatisk ved hendelser som treffer.
- [Runbook-agenter](/docs/runbooks/agents): Installer Runneren som skripttrinnene dine trenger.
- [Runbook-variabler](/docs/runbooks/variables): Hold verter, nøkler, passord og kubeconfiger utenfor trinnene dine.
:::
