# Workflow-kørsler & logfiler

Hver gang et workflows trigger udløses, opretter OneUptime en **kørsel** — en optegnelse over én eksekvering med tidsforbrug, status og output pr. node. Kørsler er sådan, du bekræfter, at et workflow virkede, sådan du fejlfinder et, der ikke gjorde, og sådan du skriver en postmortem, når en automatisering opfører sig forkert.

## Hvor du finder dem

| Side | Omfang |
| --- | --- |
| **Workflows → Runs & Logs** | Projektomfattende. Hver kørsel af hvert workflow. Filtrér på workflow, status og tidsinterval. |
| **Et workflows Logs-fane** | Kun kørslerne af dette workflow. |
| **En kørsels detalje-side** | Én eksekvering, udfoldet med output pr. node og eventuelle fejlmeddelelser. |

## Kørselsstatusser

| Status | Betydning |
| --- | --- |
| **Scheduled** | Triggeren er udløst, og kørslen er i kø, men workeren har ikke samlet den op endnu. Som regel en brøkdel af et sekund. |
| **Running** | Workeren går i øjeblikket grafen igennem. Langvarige komponenter (langsomme HTTP-kald, bevidste forsinkelser) holder en kørsel i denne tilstand. |
| **Success** | Hver node, der kørte, sluttede uden fejl. (Et workflow, der bevidst tog en `error`-gren, er stadig `Success` overall — selve workflowet fejlede ikke.) |
| **Error** | En node fejlede, og der var ingen `error`-port forbundet til at håndtere den. Kørslen stoppede ved den node. |
| **Timeout** | Kørslen overskred timeout pr. kørsel. Se [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration). |

## Læs en kørsel

Klik en kørsel fra listen for at åbne dens detalje-side. Du ser:

- **Header** — den trigger, der udløste, start- og sluttidsstempel, samlet varighed, status.
- **Nodeliste** — hver node, der eksekverede, i rækkefølge, hver med dens opfangede argumenter, dens returværdi og den valgte output-port.
- **Fejl** — hvis en node fejlede, fejlmeddelelsen og (hvor tilgængelig) stack tracen.

De opfangede argumenter viser *post-interpolations*-værdier — altså de præcise strenge, noden så, efter at variabler blev løst op. Det er den enkelt mest nyttige fejlsøgningsvisning: hvis en Slack-besked har den literal-tekst `{{Incident.title}}` i sig, ved du, at variabel-referencen ikke kunne løses.

## Almindelige fejlsøgningsmønstre

### "Mit workflow blev ikke udløst."

1. Bekræft, at workflowet er **aktiveret** i **Settings**. Nye workflows leveres deaktiverede.
2. For en model-event-trigger: bekræft, at eventen rent faktisk skete. Åbn entiteten (hændelsen, alarmen, monitoren) og kig i dens historik.
3. For en webhook-trigger: bekræft, at det eksterne system rammer den rigtige URL. Mange værktøjer logger udgående webhook-levering — tjek der.
4. For en tidsplan-trigger: bekræft, at cron-udtrykket evaluerer til det tidspunkt, du forventer. Brug en cron-parser, hvis du er i tvivl.

Hvis triggeren udløstes, men ingen kørsel dukker op, så tjek projektets kørselskvote under **Project Settings → Billing**.

### "Det kører, men en nedstrøms node eksekverer aldrig."

En node, der ikke kører, er som regel et koblingsproblem. Åbn lærredet og tjek:

- Er den opstrøms nodes output-port faktisk forbundet til denne nodes input-port?
- Tog den opstrøms node en anden port (f.eks. `error` i stedet for `success`, eller `no` i stedet for `yes`)? Kig på kørselsdetaljen for at se, hvilken port den valgte.

### "En variabel kommer ind som tom."

Åbn kørselsdetaljen og kig på den fejlende nodes opfangede argumenter. Hvis du ser den literal-tekst `{{NodeId.field}}`, blev referencen ikke løst op — sandsynligvis en tastefejl i `NodeId` eller `field`. Hvis du ser en tom streng, kørte den opstrøms node, men producerede ikke det felt.

### "Det virker manuelt, men ikke fra triggeren."

Brug **Run Manually** med en JSON-payload, der spejler, hvad den rigtige trigger publicerer. Sammenlign så de opfangede argumenter i den manuelle kørsel og produktionskørslen side om side — forskellen ligger som regel i et enkelt feltnavn eller en type.

## Genkør et workflow

Der er ingen "prøv kørslen igen"-knap — by design re-eksekverer OneUptime aldrig en gammel kørsel, fordi de udgående sideeffekter (Slack-beskeder, API-kald) muligvis ikke er idempotente. Hvis du vil gentage arbejdet, så ret workflowet og lad næste rigtige trigger udløse det.

For manuelle workflows: klik blot **Run Manually** med samme payload.

## Log-bevaring

Kørsler bevares på ubestemt tid på projektet. Hvis du har brug for at rydde op i højvolumens støjende workflows (f.eks. et debug-workflow, der udløses hvert minut), så deaktivér eller slet dem — der er ingen bevaringskontakt pr. workflow.

## Læs videre

- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — timeouts, rekursionsgrænser, redigering af hemmeligheder.
- [Workflow-variabler](/docs/workflows/variables) — syntaksen, interpolerede argumenter bruger.
- [Workflow-komponenter](/docs/workflows/components) — returværdi-felterne, hver komponent publicerer.
