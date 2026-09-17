# Workflows – Oversigt

Workflows lader dig automatisere opgaver i OneUptime uden at skrive kode. Sæt et par blokke på et lærred, forbind dem, og så har du automatik, der kører, når noget sker — en hændelse åbnes, en tidsplan udløses, eller et andet værktøj sender data til OneUptime.

Tænk på workflows som baggrundshjælpere til dit projekt: de reagerer på begivenheder, taler med andre værktøjer og holder stille og roligt tingene i sync, mens du koncentrerer dig om dit arbejde.

## Hvad du kan bruge workflows til

- **Forbind OneUptime med dine andre værktøjer** — send hændelser til Slack, opret Jira-sager, kald en webhook i din egen stak.
- **Reagér på det, der sker i OneUptime** — når en kritisk hændelse oprettes, så underret vagtholdet og opret automatisk en sag.
- **Kør jobs på en tidsplan** — hvert femte minut, hver nat, hver mandag morgen.
- **Modtag data udefra** — lad andre systemer skubbe data ind i OneUptime via en unik URL.
- **Genbrug den automatik, du bruger tit** — byg den én gang, og kald den fra et hvilket som helst andet workflow.

## Sådan virker et workflow

Ethvert workflow består af tre dele:

1. **En trigger** — det, der starter workflowet. Det kan være en knap, du trykker på, en tidsplan, en indgående webhook eller en begivenhed i OneUptime (for eksempel en ny hændelse).
2. **En eller flere komponenter** — det, workflowet gør. Send en besked, foretag et HTTP-kald, kør et hurtigt tjek, forgren efter en betingelse.
3. **Forbindelser mellem dem** — du tegner linjer fra én blok til den næste og bestemmer dermed rækkefølgen.

Det hele bygger du visuelt på et lærred. De fleste workflows kræver ingen kode, men du kan tilføje et stykke JavaScript, når du får brug for det.

## Nøglebegreber

| Begreb              | Hvad det betyder                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Workflow**        | Hele automatikken — et navn, et lærred og en kontakt til at tænde og slukke.                |
| **Trigger**         | Den første blok. Den afgør, hvornår workflowet kører. Hvert workflow har præcis én trigger. |
| **Komponent**       | En handlingsblok — sender en besked, foretager en anmodning, tjekker en betingelse.         |
| **Kørsel**          | Én eksekvering af workflowet. Gemmes med tidsstempler og output fra hver blok.              |
| **Global variabel** | En værdi (for eksempel en API-nøgle), du gemmer én gang og genbruger i ethvert workflow.    |

## Hvor du finder workflows i OneUptime

Åbn **Arbejdsgange** i venstre navigation. Den sektion rummer:

- **Arbejdsgange** — din liste over workflows. Opret et nyt, eller åbn et eksisterende.
- **Globale variabler** — værdier, der deles på tværs af alle dine workflows.
- **Kørsler og logs** — eksekveringshistorik for hvert eneste workflow i dit projekt.

Åbner du et enkelt workflow, rummer dets egen venstremenu:

- **Oversigt** — navn, beskrivelse, etiketter og kontakten **Aktiveret**.
- **Bygger** — lærredet, hvor du designer workflowet.
- **Arbejdsgangsvariabler** — værdier, der kun gælder dette ene workflow.
- **Kørsler og logs** — hver kørsel af dette workflow, med detaljer.
- **Indstillinger** — webhook-hemmelighed, dublering og eksport.

## Byg dit første workflow

1. **Opret** — vælg et udgangspunkt, og giv så dit workflow et navn.
2. **Vælg en trigger** — manuel, planlagt, webhook eller en begivenhed fra OneUptime.
3. **Tilføj komponenter** — sæt handlinger på lærredet, og forbind dem.
4. **Tænd for det** — slå **Aktiveret** til på siden **Oversigt**. Et deaktiveret workflow kan slet ikke køre, heller ikke manuelt.
5. **Test** — klik **Kør arbejdsgang** i byggeren, og hold øje med kørselsloggen.

## Et hurtigt eksempel

Lad os sige, at du vil skrive i Slack, hver gang der oprettes en kritisk hændelse:

1. Opret et workflow, der hedder "Kritiske hændelser til Slack".
2. Vælg triggeren **On Create Incident**.
3. Tilføj en **If / Else**-blok. Sæt den til at tjekke, om hændelsens titel indeholder "Sev 1".
4. Tilføj en **Slack**-blok fra grenen **Yes**. Vælg kanalen, og skriv beskeden.
5. Tænd for workflowet.

Næste gang nogen åbner en hændelse med "Sev 1" i titlen, lyser Slack op.

## Hvordan workflows spiller sammen med resten af OneUptime

- **Monitorer** opdager problemet. **Hændelser** registrerer det. **Workflows** reagerer på det.
- **Runbooks** er trin-for-trin-vejledninger til mennesker. Workflows er automatik uden opsyn. Brug et runbook, når et menneske skal træffe beslutninger; brug et workflow, når trinnene er givet på forhånd.
- **Workspace-forbindelser** (Slack, Teams) er der, hvor workflows sender deres beskeder hen.

## Hvor du kan læse videre

- [Opret et workflow](/docs/workflows/authoring) — sådan bygger du på lærredet.
- [Workflow-triggere](/docs/workflows/triggers) — de forskellige måder et workflow kan starte på.
- [Workflow-komponenter](/docs/workflows/components) — de byggesten, du kan tilføje.
- [Workflow-variabler](/docs/workflows/variables) — sådan bruger du værdier på tværs af blokke og workflows.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — sådan tjekker du, hvad der skete.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — indstillinger, det er værd at kende.
