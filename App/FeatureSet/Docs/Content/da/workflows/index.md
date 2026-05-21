# Workflows – Oversigt

Workflows lader dig automatisere opgaver i OneUptime uden at skrive kode. Træk og slip nogle få blokke ud på et lærred, forbind dem med hinanden, og du har en automatisering, der kører, når der sker noget — en hændelse åbner, en tidsplan udløses, eller et andet værktøj sender data til OneUptime.

Tænk på workflows som baggrundshjælpere til dit projekt: de reagerer på events, taler med andre værktøjer, og holder stille og roligt tingene synkroniseret, mens du fokuserer på dit arbejde.

## Hvad du kan med workflows

- **Forbind OneUptime med dine andre værktøjer** — send hændelser til Slack, opret Jira-tickets, kald en webhook i din stack.
- **Reagér på det, der sker i OneUptime** — når en kritisk hændelse oprettes, så underret vagtteamet og opret automatisk en ticket.
- **Kør job på en tidsplan** — hvert femte minut, hver nat, hver mandag morgen.
- **Modtag data udefra** — lad andre systemer skubbe data ind i OneUptime via en unik URL.
- **Genbrug almindelig automatisering** — byg den én gang, kald den fra ethvert andet workflow.

## Sådan virker et workflow

Hvert workflow har tre dele:

1. **En trigger** — det, der starter workflowet. Det kan være en manuel knap, en tidsplan, en indkommende webhook eller en event i OneUptime (såsom en ny hændelse).
2. **En eller flere komponenter** — det, workflowet gør. Send en besked, foretag et HTTP-kald, kør et hurtigt tjek, forgren ud fra en betingelse.
3. **Forbindelser mellem dem** — du tegner linjer fra én blok til den næste for at bestemme rækkefølgen.

Du bygger det hele visuelt på et lærred. Ingen kodning krævet til de fleste workflows, men du kan dryppe en JavaScript-snippet ind, når du har brug for det.

## Nøglebegreber

| Begreb | Betydning |
| --- | --- |
| **Workflow** | Hele automatiseringen — et navn, et lærred og en kontakt til at tænde eller slukke for det. |
| **Trigger** | Den første blok. Den bestemmer, hvornår workflowet kører. Hvert workflow har præcis én trigger. |
| **Komponent** | En handlingsblok — sender en besked, foretager en forespørgsel, tjekker en betingelse. |
| **Kørsel** | Én afvikling af workflowet. Gemmes med tidsstempler og output fra hver blok. |
| **Global variabel** | En værdi (såsom en API-nøgle), du gemmer én gang og genbruger i ethvert workflow. |

## Hvor du finder workflows i OneUptime

Åbn **Workflows** i venstre navigation. Derfra:

- **Workflows** — din liste over workflows. Opret et nyt, eller åbn et eksisterende.
- **Builder-fane** — lærredet, hvor du designer workflowet.
- **Logs-fane** — hver kørsel af dette workflow, med detaljer.
- **Settings-fane** — navn, beskrivelse, ejere, labels, aktivér/deaktivér.
- **Global Variables** — værdier delt på tværs af alle dine workflows.
- **Runs & Logs** — afviklingshistorik på tværs af hvert workflow i dit projekt.

## Byg dit første workflow

1. **Opret** — giv dit workflow et navn og en kort beskrivelse.
2. **Vælg en trigger** — manuel, planlagt, webhook eller en event fra OneUptime.
3. **Tilføj komponenter** — træk handlinger ud på lærredet og forbind dem.
4. **Test** — klik **Run Manually** og se, hvad der sker i logfilerne.
5. **Tænd for det** — slå **Enabled**-kontakten til i Settings, når du er klar.

## Et hurtigt eksempel

Lad os sige, at du vil poste i Slack, hver gang en kritisk hændelse oprettes:

1. Opret et workflow kaldet "Kritiske hændelser til Slack."
2. Vælg triggeren **Incident → On Create**.
3. Tilføj en **Conditions**-blok. Indstil den til at tjekke, om hændelsens titel indeholder "Sev 1."
4. Fra **Yes**-grenen tilføjer du en **Slack**-blok. Vælg kanalen og skriv beskeden.
5. Tænd for workflowet.

Næste gang nogen åbner en hændelse med "Sev 1" i titlen, lyser Slack op.

## Hvordan workflows passer ind i resten af OneUptime

- **Monitorer** opdager problemet. **Hændelser** registrerer det. **Workflows** reagerer på det.
- **Runbooks** er trin-for-trin-guides til mennesker. Workflows er ubemandet automatisering. Brug en runbook, når et menneske skal træffe beslutninger; brug et workflow, når trinnene er automatiske.
- **Workspace-forbindelser** (Slack, Teams) er der, hvor workflows sender deres beskeder.

## Læs videre

- [Opbygning af et workflow](/docs/workflows/authoring) — at bygge på lærredet.
- [Triggere](/docs/workflows/triggers) — de forskellige måder, et workflow kan starte på.
- [Komponenter](/docs/workflows/components) — de byggesten, du kan tilføje.
- [Variabler](/docs/workflows/variables) — brug af værdier på tværs af blokke og workflows.
- [Kørsler & logfiler](/docs/workflows/runs-and-logs) — tjek hvad der skete.
- [Konfiguration & sikkerhed](/docs/workflows/configuration) — indstillinger, der er værd at kende.
