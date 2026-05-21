# Opbygning af et workflow

For at oprette et workflow åbner du **Workflows → Create Workflow**, giver det et navn og klikker dig ind på fanen **Builder**. Du ser et blankt lærred, hvor du bygger automatiseringen.

## Lærredet

Builderen er et træk-og-slip-lærred. Du tilføjer blokke fra paletten i siden, forbinder dem med linjer, og klikker på hver blok for at konfigurere, hvad den gør. Ændringer gemmes automatisk — du ser en indikator øverst, når de er gemt.

Hvert workflow starter med én **trigger** i begyndelsen. Alt andet er en **komponent**, der gør noget.

## Hvad der er på en blok

| Felt | Hvad det gør |
| --- | --- |
| **Title** | Det navn, der vises på lærredet. Omdøb det for at gøre komplekse workflows lettere at læse. |
| **Settings** | Det, blokken har brug for til at udføre sit arbejde — en URL, en Slack-kanal, en beskedtekst osv. Påkrævede felter er markeret med en asterisk. |
| **Input** | Prikken til venstre, hvor linjer kommer ind fra tidligere blokke. |
| **Outputs** | Prikkerne til højre, hvor linjer går ud til de næste blokke. Mange blokke har separate **success**- og **error**-output, så du kan håndtere begge tilfælde. |

## Forbind blokke

Træk fra en bloks output-prik til den næste bloks input-prik. Den linje, du tegner, bestemmer, hvad der kører bagefter.

- Hvis du forbinder fra **success**, kører den næste blok kun, når den tidligere lykkedes.
- Hvis du forbinder fra **error**, kører den næste blok kun, når den tidligere fejlede.
- Hvis du ikke forbinder et output, stopper den sti bare.

Du kan forbinde ét output til flere blokke. De kører alle samtidig fra det punkt.

## Konfigurér en blok

Klik på en blok for at åbne dens indstillinger i siden. Hver indstilling har den rigtige slags input — tekstfelter, dropdowns, kode-editorer, kontakter og så videre.

De fleste tekstfelter accepterer variabler — det er sådan, data flyder fra én blok til den næste. Se [Variabler](/docs/workflows/variables) for syntaks.

## Dit første workflow

Den hurtigste måde at fornemme lærredet på:

1. Træk en **Manual**-trigger ud på lærredet.
2. Træk en **Log**-komponent (under **Utils**) ved siden af. Forbind triggeren til Log-komponenten.
3. Skriv `Hello from {{Manual.JSON.name}}` i Log-blokkens beskedfelt.
4. Gem og tænd for workflowet.
5. Klik **Run Manually**, indsæt `{ "name": "Ada" }` som input, og indsend.
6. Åbn fanen **Logs**. Den nyeste kørsel viser `Hello from Ada`.

Den cyklus — træk, forbind, konfigurér, kør, tjek loggen — er sådan, du bygger hvert workflow.

## Gem og tænd

Lærredet gemmer, mens du arbejder. Der er ikke noget separat "publicer"-skridt.

Men et workflow kører kun rigtigt, når **Enabled** er slået til i Settings. Nye workflows starter deaktiverede. Brug den kontakt som dit sikkerhedsnet — byg det, test med **Run Manually**, tjek logfilerne, og tænd så for det.

For at sætte et workflow på pause uden at slette det skal du slå **Enabled** fra. Kørsler, der allerede er i gang, afsluttes; ingen nye starter.

## Hold orden

- Træk blokke for at flytte dem. Layoutet gemmes, så den næste person ser samme arrangement.
- Højreklik på en linje for at slette den. Højreklik på en blok for at slette eller duplikere den.
- Til brede workflows: læg dem ud fra venstre mod højre, så de læses i den retning, de kører.

## Læs videre

- [Triggere](/docs/workflows/triggers) — de fire måder, et workflow kan starte på.
- [Komponenter](/docs/workflows/components) — hver blok, du kan tilføje.
- [Variabler](/docs/workflows/variables) — flytning af data mellem blokke.
- [Kørsler & logfiler](/docs/workflows/runs-and-logs) — tjek hvad der skete.
