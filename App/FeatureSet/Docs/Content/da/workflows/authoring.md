# Opret et workflow

Opret et workflow under **Workflows → Create Workflow**, giv det et navn og en valgfri beskrivelse, og åbn så **Builder**-fanen for at begynde at lægge noder ud på lærredet.

## Lærredet

Builderen er en zoom- og panorerbar graf. Du tilføjer noder fra en komponentpalet, forbinder dem med kanter og konfigurerer hver nodes argumenter i et sidepanel. En gem-indikator i toppen fortæller dig, om din seneste ændring er gemt.

Et workflow starter altid med præcis én **trigger**-node. Triggere har ingen input-port — det er her, eksekveringen begynder. Alt nedstrøms er en **komponent**.

## En nodes anatomi

Hver node har:

| Felt | Formål |
| --- | --- |
| **Titel** | Den etiket, der vises på lærredet. Standardværdien er komponentnavnet; override den for at gøre komplekse workflows lettere at læse. |
| **Argumenter** | Den konfiguration, komponenten har brug for til at udføre sit job — en URL, en Slack-kanal, en JavaScript-snippet osv. Påkrævede argumenter er markeret med en asterisk. |
| **Input-porte** | Stik i venstre side af noden, hvor indkommende kanter lander. Komponenter har én input-port kaldet `in`; triggere har ingen. |
| **Output-porte** | Stik i højre side, hvor udgående kanter starter. Komponenter definerer porte som `success`, `error`, `yes`, `no`. |
| **Returværdier** | Data, noden producerer — payloads på dens output-porte. Nedstrøms noder refererer til disse som `{{NodeId.fieldName}}`. |

## Forbind noder

Træk fra en output-port til en nedstrøms nodes input-port for at skabe en kant. En kant fra `success` kører kun den gren, når den opstrøms node lykkedes; en kant fra `error` kører kun, når den fejlede. Hvis du ikke forbinder en port, ender den gren simpelthen der.

Du kan forgrene ud: én output-port kan fodre flere nedstrøms noder, og de kører alle parallelt fra det punkt.

## Konfigurér argumenter

Klik på en node for at åbne dens sidepanel. Hvert argument har en typet editor:

- **Tekst / URL / E-mail / Tal / Adgangskode** — en enkeltlinje-input.
- **JSON** — en JSON-editor med syntax highlighting og valideringsindikator.
- **JavaScript** — en kodeeditor til snippets, der bruges af komponenten **Custom Code**.
- **Markdown / HTML** — rich-text-bodies til e-mail- og beskedkomponenter.
- **CronTab** — et tidsplansudtryk (bruges af Schedule-triggeren).
- **Boolean** — en kontakt.
- **Select / Query** — drop-downs til felter, der tager et fast sæt værdier eller en modelstil-forespørgsel.

Ethvert tekstfelt accepterer variabelinterpolation — se [Workflow-variabler](/docs/workflows/variables) for reglerne.

## Et minimalt første workflow

Den hurtigste måde at få en fornemmelse for lærredet:

1. Læg en **Manual**-trigger.
2. Læg en **Log**-komponent (under **Utils**). Forbind triggerens output-port til Log-komponentens input-port.
3. I Log-komponentens argument skriver du `Hello from {{Manual.JSON.name}}`.
4. Gem og aktivér workflowet.
5. Klik **Run Manually**, indsæt `{ "name": "Ada" }` som input, og afsend.
6. Åbn **Logs**-fanen. Den seneste kørsel viser Log-nodens opfangede output: `Hello from Ada`.

Det rundkørselsmønster — træk, forbind, konfigurér, kør, inspicér — er rytmen i at oprette ethvert workflow.

## Gem, aktivér og test i produktion

Workflows gemmes som en JSON-graf i kolonnen `Workflow.graph`. Builderen gemmer mens du redigerer; gem-indikatoren i toppen viser, hvornår den seneste ændring er nået serveren. Der er ikke et separat "publicér"-trin.

Men: et workflow udløser kun sin trigger, når **isEnabled** er slået til. Nye workflows leveres deaktiverede. Behandl det flag som din "klar til produktion"-kontakt — byg, klik **Run Manually** for at lave en prøvetur med en sample-payload, kig på **Logs**, og slå derefter Enable til.

Hvis du har brug for at pause et workflow uden at slette det (f.eks. under en urelateret hændelse), så slå **isEnabled** fra i **Settings**. Eksisterende igangværende kørsler fortsætter; ingen nye starter.

## Omorden og omstrukturér

- Træk en node for at flytte den. Positionen gemmes i grafen, så den næste, der åbner lærredet, ser samme layout.
- Højreklik på en kant for at slette den; højreklik på en node for slet- og duplikér-muligheder.
- I brede workflows: læg dem fra venstre mod højre, så eksekveringsretningen følger din læseretning.

## Læs videre

- [Workflow-triggere](/docs/workflows/triggers) — de fire triggerfamilier, og hvad hver enkelt eksponerer som returværdier.
- [Workflow-komponenter](/docs/workflows/components) — det fulde katalog og deres argumenter.
- [Workflow-variabler](/docs/workflows/variables) — hvordan du refererer data mellem noder og fra globale variabler.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — sådan fejlfinder du et workflow, der ikke opfører sig som forventet.
