# Konfiguration & sikkerhed

Denne side dækker de indstillinger og sikkerhedsgrænser, der er værd at kende, før du peger et workflow mod rigtig trafik.

## Tænd eller sluk for et workflow

Hvert workflow har en **Enabled**-kontakt i **Settings**. Når den er slået fra, kører workflowet ikke — webhook-kald, planlagte tidspunkter og OneUptime-events bliver alle ignoreret. Nye workflows starter deaktiverede.

Brug denne kontakt som din "klar til drift"-port:

1. Byg workflowet.
2. Klik **Run Manually** med en realistisk payload.
3. Tjek **Logs** — sørg for, at hver blok gik, hvor du forventede.
4. Slå **Enabled** til.

At slå et workflow fra stopper ikke kørsler, der allerede er i gang; det stopper bare nye fra at starte.

## Ejere og labels

- **Owners** — brugere og teams, der er angivet som ejere, får adgang til workflowet og kan tilmelde sig notifikationer, når det fejler. Sæt dem under **Settings → Owners**.
- **Labels** — tags til gruppering af workflows. Workflow-listen lader dig filtrere efter label, hvilket gør et travlt projekt meget lettere at navigere. Nyttigt, når du har workflows organiseret efter team, integration eller miljø.
- **Label rules** — under **Workflows → Settings → Label Rules** kan du automatisk anvende labels på nye workflows baseret på navne- eller beskrivelsesmønstre.
- **Owner rules** — under **Workflows → Settings → Owner Rules** kan du automatisk tildele ejere til nye workflows.

## Hemmeligheder

Markér en global variabel som **secret**, hvis den indeholder noget følsomt. Værdien krypteres, skjules i UI'et efter du gemmer, og skjules i kørselslogfilerne (vist som `[REDACTED]`).

Brug hemmelige variabler til:

- API-nøgler til eksterne tjenester.
- Autentificeringstokens.
- Webhook-signaturnøgler.
- Alt, du ikke ville have, at nogen med read-only-adgang skulle se.

Indsæt ikke en hemmelighed direkte i en blok — værdier som `Authorization: Bearer eyJh...` ender som synlige i workflowet og logfilerne. Brug `{{variable.MY_SECRET}}` i stedet.

## Hvor lang tid en kørsel kan tage

Hver kørsel har en maksimal længde. Hvis en kørsel ikke er færdig i tide, markeres den **Timeout**, og blokken i gang annulleres. Standarden er rundhåndet — lang nok til normale HTTP-kald og kæder af blokke.

Individuelle blokke har deres egne tidsgrænser inden i den — for eksempel giver en API-blok op på en hængende udgående anmodning et godt stykke før hele kørslen gør.

## Grænse for at kalde andre workflows

Komponenten **Execute Workflow** lader ét workflow kalde et andet. For at forhindre utilsigtede løkker, hvor workflow A kalder B, der kalder A igen, er der et loft på, hvor dybt kæden kan gå. En kørsel, der går forbi grænsen, ender med en klar fejl.

Hvis du har et reelt behov for en lang kæde (såsom et job, der behandler ét element pr. kørsel), er det som regel enklere at loope inden i et enkelt workflow ved hjælp af **Custom Code**.

## Webhook-sikkerhed

Webhook-triggere giver dig en unik URL. Enhver, der kender URL'en, kan ramme den. For at beskytte mod utilsigtede eller uønskede kaldere:

- Behandl URL'en som en adgangskode. Del den ikke offentligt, og commit den ikke til et offentligt repo.
- Til følsomme workflows: bed det kaldende system om at sende et delt token som en header (såsom `X-Webhook-Token`), og tjek det med en **Conditions**-blok, før du gør noget vigtigt. Gem det forventede token som en hemmelig variabel.
- Til meget følsomme workflows: foretræk en OneUptime event-trigger og et manuelt import-skridt frem for en offentlig webhook.

## Udgående netværksadgang

API- og andre HTTP-blokke laver deres anmodninger fra OneUptime. Hvis du selv-hoster, så sørg for, at din installation kan nå de tjenester, du kalder. Hvis du bruger OneUptime Cloud, er vores udgående IP-områder angivet i [IP-adresser](/docs/configuration/ip-addresses), så du kan tillade dem på den anden side.

## Tilladelser

Workflows respekterer dit projekts rollebaserede adgangskontrol. De relevante tilladelser:

- **Create / Read / Edit / Delete Workflow** — de grundlæggende tilladelser på selve workflowet.
- **Run Workflow** — krævet for at klikke **Run Manually** eller udløse et workflow via API.
- **Read Workflow Log** — krævet for at se kørsler.
- **Read / Create / Edit / Delete Workflow Variable** — kontrol over listen af globale variabler.

De fleste ingeniører bør have create/edit/read på workflows, men ikke på variabler. Gem variabel-redigeringsadgang til dem, der administrerer dit projekts hemmeligheder.

## Plan-grænser

OneUptime Cloud begrænser antallet af kørsler pr. måned på mindre planer. Din aktuelle grænse vises under **Project Settings → Billing**. Når du når den, afvises nye triggere indtil næste faktureringscyklus. Selv-hostede installationer har ikke denne grænse.

## Når workflows ikke er det rette værktøj

Et par tilfælde, hvor du bør gribe til noget andet:

- **Tung beregning eller store datasæt** — workflows er designet til let limarbejde, ikke talknusning. Kør tungt arbejde i din egen infrastruktur, og lad et workflow sætte det i gang.
- **Langvarige processer, der spænder over timer** — en enkelt kørsel er ment til at afsluttes hurtigt. Hvis du har brug for at "gøre A, vente to timer, gøre B", så brug en ekstern scheduler, der sender en webhook tilbage til OneUptime, når det er tid.
- **Trin-for-trin hændelsesrespons med mennesker i loopet** — det er, hvad [Runbooks](/docs/runbooks/index) er til. Workflows er til ubemandet automatisering.

## Læs videre

- [Workflows – Oversigt](/docs/workflows/index) — det store billede.
- [Komponenter](/docs/workflows/components) — blok-for-blok-reference.
- [Runbooks](/docs/runbooks/index) — hvornår en runbook skal bruges i stedet.
