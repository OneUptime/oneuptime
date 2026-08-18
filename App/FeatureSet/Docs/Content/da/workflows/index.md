# Arbejdsgange – Oversigt

Arbejdsgange lader dig automatisere opgaver i OneUptime uden at skrive kode. Tilføj nogle få blokke på et lærred, forbind dem, og du har en automatisering, der kører, når som helst noget sker — en hændelse åbnes, en tidsplan udløses, eller et andet værktøj sender data til OneUptime.

Tænk på arbejdsgange som baggrundshjælpere for dit projekt: de reagerer på hændelser, taler med andre værktøjer og holder tingene synkroniseret i det stille, mens du fokuserer på dit arbejde.

## Hvad du kan gøre med arbejdsgange

- **Forbind OneUptime til dine andre værktøjer** — send hændelser til Slack, opret Jira-sager, post til en webhook i din stack.
- **Reagér på det, der sker i OneUptime** — når en kritisk hændelse oprettes, giv vagtholdet besked og opret automatisk en sag.
- **Kør job på en tidsplan** — hvert femte minut, hver nat, hver mandag morgen.
- **Modtag data udefra** — lad andre systemer sende data ind i OneUptime gennem en unik URL.
- **Genbrug fælles automatisering** — byg den én gang, kald den fra enhver anden arbejdsgang.

## Sådan virker en arbejdsgang

Hver arbejdsgang har tre dele:

1. **En trigger** — det, der starter arbejdsgangen. Det kan være en manuel knap, en tidsplan, en indgående webhook eller en hændelse i OneUptime (som en ny hændelse).
2. **En eller flere komponenter** — det, arbejdsgangen gør. Send en besked, foretag et HTTP-kald, kør et hurtigt tjek, forgren baseret på en betingelse.
3. **Forbindelser mellem dem** — du trækker linjer fra én blok til den næste for at bestemme rækkefølgen.

Du bygger alt dette visuelt på et lærred. Ingen kodning kræves til de fleste arbejdsgange, selvom du kan tilføje et lille stykke JavaScript, når du har brug for det.

## Nøglebegreber

| Begreb                  | Hvad det betyder                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Arbejdsgang**          | Hele automatiseringen — et navn, et lærred og en kontakt til at slå den til eller fra.          |
| **Trigger**              | Den første blok. Den bestemmer, hvornår arbejdsgangen kører. Hver arbejdsgang har præcis én trigger. |
| **Komponent**            | En handlingsblok — sender en besked, foretager en forespørgsel, tjekker en betingelse.          |
| **Kørsel**               | Én eksekvering af arbejdsgangen. Gemt med tidsstempler og output fra hver blok.                 |
| **Global variabel**      | En værdi (som en API-nøgle), du gemmer én gang og genbruger i enhver arbejdsgang.               |

## Sådan finder du arbejdsgange i OneUptime

Åbn **Workflows** i venstre navigation. Det afsnit indeholder:

- **Workflows** — din liste over arbejdsgange. Opret en ny eller åbn en eksisterende.
- **Global Variables** — værdier delt på tværs af alle dine arbejdsgange.
- **Runs & Logs** — udførelseshistorik på tværs af alle arbejdsgange i dit projekt.

Åbn en enkelt arbejdsgang, og dens egen venstre menu indeholder:

- **Overview** — navn, beskrivelse, etiketter og kontakten **Enabled**.
- **Builder** — lærredet, hvor du designer arbejdsgangen.
- **Workflow Variables** — værdier afgrænset til denne ene arbejdsgang.
- **Runs & Logs** — hver kørsel af denne arbejdsgang, med detaljer.
- **Settings** — webhook-hemmelighed, dublér og eksportér.

## Byg din første arbejdsgang

1. **Create** — vælg et udgangspunkt, og giv derefter din arbejdsgang et navn.
2. **Vælg en trigger** — manuel, planlagt, webhook eller en hændelse fra OneUptime.
3. **Tilføj komponenter** — tilføj handlinger til lærredet og forbind dem.
4. **Slå den til** — slå **Enabled** til på siden **Overview**. En deaktiveret arbejdsgang kan slet ikke køre, heller ikke manuelt.
5. **Test** — klik på **Run Workflow** i **Builder**, og følg med i kørselsloggen.

## Et hurtigt eksempel

Sig, du vil poste i Slack, hver gang en kritisk hændelse oprettes:

1. Opret en arbejdsgang kaldet "Critical incidents to Slack."
2. Vælg triggeren **On Create Incident**.
3. Tilføj en **If / Else**-blok. Sæt den til at tjekke, om hændelsens titel indeholder "Sev 1."
4. Fra grenen **Yes**, tilføj en **Slack**-blok. Vælg kanalen og skriv beskeden.
5. Slå arbejdsgangen til.

Næste gang nogen åbner en hændelse med "Sev 1" i titlen, lyser Slack op.

## Sådan passer arbejdsgange ind i resten af OneUptime

- **Overvågninger** opdager problemet. **Hændelser** registrerer det. **Arbejdsgange** reagerer på det.
- **Runbooks** er trin-for-trin-guider til mennesker. Arbejdsgange er ubemandet automatisering. Brug et runbook, når et menneske skal træffe beslutninger; brug en arbejdsgang, når trinnene er automatiske.
- **Arbejdsområdeforbindelser** (Slack, Teams) er, hvor arbejdsgange sender deres beskeder.

## Hvor du kan læse videre

- [Oprettelse af en arbejdsgang](/docs/workflows/authoring) — bygning på lærredet.
- [Triggers](/docs/workflows/triggers) — de forskellige måder, en arbejdsgang kan starte på.
- [Komponenter](/docs/workflows/components) — de byggeklodser, du kan tilføje.
- [Variabler](/docs/workflows/variables) — brug af værdier på tværs af blokke og arbejdsgange.
- [Kørsler og logs](/docs/workflows/runs-and-logs) — tjek hvad der skete.
- [Konfiguration og sikkerhed](/docs/workflows/configuration) — indstillinger, der er værd at kende.
