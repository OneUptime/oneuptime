# Workflow-konfiguration & sikkerhed

Denne side samler de indstillinger og sikkerhedsgrænser, der er værd at kende, før du peger et workflow mod produktionstrafik.

## Aktivér / deaktivér

Hvert workflow har et **isEnabled**-flag i **Settings**. Deaktiverede workflows udløses aldrig — model-events, webhooks og planlagte kørsler ignoreres. Nye workflows leveres deaktiverede.

Behandl dette som din "klar til produktion"-kontakt:

1. Byg workflowet.
2. Klik **Run Manually** med en repræsentativ payload.
3. Tjek **Logs** — bekræft, at hver node tog den port, du forventede.
4. Slå **isEnabled** til.

At deaktivere et workflow påvirker ikke kørsler, der allerede er i gang; det stopper kun nye fra at blive oprettet.

## Ejerskab og labels

- **Ejere** — brugere og teams listet som ejere får permission-baseret adgang og (valgfrit) notifikationer, når workflowet fejler. Konfigurér under **Settings → Owners**.
- **Labels** — many-to-many-tags til at organisere workflows. Filtrér workflow-listen på label. Nyttigt, når et projekt har snesevis af workflows organiseret pr. team, pr. integration eller pr. miljø.
- **Label-regler** — under **Workflows → Settings → Label Rules** kan du auto-anvende labels på nye workflows baseret på regex-match på navn eller beskrivelse.
- **Ejer-regler** — under **Workflows → Settings → Owner Rules** kan du auto-tildele ejere til nye workflows.

## Hemmeligheder

Globale variabler kan markeres som **hemmelige**. Værdien er krypteret at rest, write-only i UI'et efter gem og redigeres bort fra kørselslogfiler (erstattet med `[REDACTED]`).

Brug hemmelige variabler til:

- API-nøgler til udgående integrationer.
- Bearer-tokens.
- Webhook-signeringsnøgler.
- Enhver værdi, en angriber med læseadgang til et workflow ikke bør se.

Indsæt ikke en hemmelighed direkte i en komponents argument — referencer som `Authorization: Bearer eyJh...` dukker op i workflow-JSON'en og i kørselslogfilerne i klartekst. Referér i stedet `{{variable.MY_SECRET}}`.

## Kørsels-timeout

Hver kørsel har en maksimal varighed. Hvis en kørsel ikke er afsluttet inden for timeouten, markeres den `Timeout`, og enhver igangværende komponent annulleres. Standarden er generøs (minutter, ikke sekunder) — se workerens miljøkonfiguration for den nøjagtige værdi i din installation.

De fleste komponenter har deres egne pr.-kald-timeouts inde i kørsels-timeouten — f.eks. opgiver API-komponenten en hængende udgående anmodning et godt stykke før, hele kørslen gør.

## Rekursionsgrænse

Komponenten **Execute Workflow** lader ét workflow kalde et andet. For at forhindre løbske løkker, hvor A kalder B kalder A i det uendelige, sporer workeren kald-kæden og stopper en kæde, der overskrider en fast dybde (typisk et lille tal som 5). Den afsluttende kørsel markeres `Error` med en klar besked om rekursionsgrænsen.

Hvis du har et legitimt behov for en lang kæde (f.eks. en rekursiv folder-walk, der behandler ét niveau pr. kørsel), så refaktorér det til et enkelt workflow, der itererer internt via **Custom Code** — det mønster er ikke underlagt kæde-grænsen.

## Webhook-sikkerhed

Webhook-triggere eksponerer en unik HTTPS-URL. Enhver, der lærer URL'en, kan ramme den. For at forsvare mod uheld eller fjendtlige kaldere:

- Behandl URL'en som en delt hemmelighed. Indsæt den ikke i offentlig chat eller commit den til et offentligt repo.
- For højværdi-workflows: bed det kaldende system om at inkludere en delt hemmelighed som en header (f.eks. `X-Webhook-Token`) og validér den i en **Conditions**-node, før du gør noget destruktivt. Definér det forventede token som en hemmelig global variabel.
- For meget højværdi-workflows: foretræk en model-event-trigger og et manuelt import-trin i stedet for en offentlig webhook.

## Udgående netværkstrafik

API- og andre HTTP-stil-komponenter sender anmodninger fra OneUptime Workflow Workerens netværk. Hvis du selv-hoster OneUptime, er workerens udgående netværk dit anliggende — sørg for, at den kan nå de tredjeparts-API'er, du kalder. Hvis du bruger OneUptime Cloud, er vores IP-egress-range publiceret under [IP-adresser](/docs/configuration/ip-addresses), så du kan lave allowlist på modtagersiden.

## Tilladelser

Workflows er førsteklasses ressourcer underlagt projekt-niveau rollebaseret adgangskontrol:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — de fire CRUD-tilladelser på workflow-skabeloner.
- `RunWorkflow` — kræves for at klikke **Run Manually** eller for at sende et workflow via API.
- `ReadWorkflowLog` — kræves for at se siden **Runs & Logs**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — kontrol over listen af globale variabler.

De fleste ingeniører bør have create/edit/read på workflows, men ikke på variabler. Reservér variabel-redigeringsadgang til de personer, der administrerer projektets hemmeligheder.

## Kvoter

OneUptime Cloud begrænser antallet af kørsler pr. måned pr. projekt på mindre planer. Loftet vises på **Project Settings → Billing**. Når du rammer det, afvises nye triggere (og registreres med en "quota exceeded"-årsag på det berørte workflow) indtil næste faktureringscyklus. Selv-hostede installationer er ikke underlagt en kvote.

## Hvad workflows *ikke* er gode til

Et par mønstre, hvor du bør gribe til et andet værktøj:

- **Langvarig beregning** — workflows er orienteret omkring limning mellem systemer, ikke om at knuse store datasæt. Kør tungt arbejde i din egen infrastruktur, og brug et workflow til at sætte det i gang.
- **Stateful workflows der strækker sig over minutter/timer** — en enkelt kørsel er tænkt til at afslutte hurtigt. Hvis du har brug for "gør A, vent så to timer, gør så B", så modellér ventetiden som en ekstern scheduler, der poster tilbage til en webhook-trigger.
- **Step-by-step incident-respons med menneskelige tjekpunkter** — det er, hvad [Runbooks](/docs/runbooks/index) er til. Brug et workflow, hvis der ikke er noget menneske i løkken; brug et runbook, hvis der er.

## Læs videre

- [Workflows – Oversigt](/docs/workflows/index) — det konceptuelle kort.
- [Workflow-komponenter](/docs/workflows/components) — argumentdetaljer for hver handling.
- [Runbooks](/docs/runbooks/index) — hvornår du skal bruge et runbook i stedet.
