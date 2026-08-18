# Oprettelse af en arbejdsgang

For at oprette en arbejdsgang, åbn **Workflows**, og klik på **Create Workflow**. En guide kaldet **Create a workflow** fører dig gennem det: først **Start from** — vælg **Start from scratch** eller en af skabelonerne — så **Name**, og til sidst et **Configure**-trin, som kun vises, når den skabelon, du valgte, beder om sine egne indstillinger.

Når den er oprettet, åbn **Builder** i venstre menu. Det er lærredet, hvor du designer arbejdsgangen.

## Lærredet

En arbejdsgang oprettet fra bunden åbner med én stiplet blok, der siger **Please click here to add trigger**. Den blok er udgangspunktet — klik på den for at vælge en trigger. En arbejdsgang oprettet fra en skabelon åbner med sine blokke allerede på plads.

Hver arbejdsgang har præcis én **trigger** øverst. Alt andet er en **komponent**, der gør noget. At tilføje en anden trigger erstatter den første, og at slette den sidste sætter den stiplede pladsholder tilbage.

Tilføjelse af blokke:

- **Triggeren** — klik på den stiplede pladsholderblok. Et panel med titlen **Add Trigger** åbnes.
- **Alt andet** — klik på **Add Component** i værktøjslinjen over lærredet. Det samme panel åbnes, denne gang med titlen **Add Component**.

Begge paneler kan søges i — tryk `/` for at springe til søgefeltet — og er grupperet efter kategori. Vælg én blok, og klik på **Add to Workflow**.

Nye blokke lander altid samme sted på lærredet, så en ny kan lande oven på noget, du allerede har placeret. Træk den fri; lærredet snapper til et gitter, mens du gør det. Blokkenes positioner gemmes, så den næste person ser den samme opstilling, du efterlod.

Ændringer gemmes automatisk. En pille i værktøjslinjen holder styr på det: **Saving…**, mens ændringen er undervejs, derefter **Saved**, eller **Could not save**, hvis det ikke lykkedes. Der er ingen Gem-knap og intet separat udgivelsestrin.

## Hvad er på en blok

| Felt                            | Hvad det gør                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**)    | Det korte id, der vises på blokken, som `log-1`. Det er sådan andre blokke refererer til denne, så omdøbning af det ødelægger hver `{{local.components.…}}`-reference, der peger på det. Blokkens overskrift er komponentens eget navn og kan ikke ændres. |
| **Settings**                     | Det, blokken har brug for til sit job — en URL, en Slack-kanal, en beskedtekst. Valgfrie felter er mærket **(Optional)**; alt andet er påkrævet. Mindre brugte indstillinger sidder bag et **Advanced**-udfoldningspanel. |
| **Input**                        | Prikken på blokkens øverste kant, hvor linjer kommer ind fra tidligere blokke. Triggere har ingen — intet kører før dem.                                                                                    |
| **Outputs**                      | Prikkerne langs blokkens nederste kant, mærket lige over dem, hvor linjer går ud til de næste blokke. Mange blokke har separate **Success**- og **Error**-outputs, så du kan håndtere begge tilfælde.      |

## At forbinde blokke

Træk fra en prik på bunden af én blok ned til prikken øverst på den næste. Den linje, du tegner, bestemmer, hvad der kører derefter.

- Hvis du forbinder fra **Success**, kører den næste blok kun, når den forrige lykkedes.
- Hvis du forbinder fra **Error**, kører den næste blok kun, når den forrige fejlede.
- Hvis du ikke forbinder et output, stopper den sti bare.

Du kan forbinde ét output til flere blokke. De kører alle — men én ad gangen, i en enkelt kø, ikke parallelt. Stol ikke på rækkefølgen mellem grene, og regn ikke med, at de overlapper i tid. Hver blok kører højst én gang per kørsel, så en løkke tilbage til en tidligere blok kører den ikke to gange.

## Konfiguration af en blok

Klik på en blok for at åbne dens indstillinger i en dialog. Hver indstilling har den rette slags input — tekstfelter, dropdowns, kodeeditorer, kontakter og så videre. Udfyld den, og klik på **Save**.

Den samme dialog er, hvor du finder:

- **Delete** — fjern denne blok.
- **Run just this step** — kør denne ene blok alene, uden resten af arbejdsgangen. Værdier, den ellers ville have læst fra andre trin, kommer igennem tomme, og alt, den sender, skriver eller sletter, sker for alvor.
- **Documentation**, **Inputs**, **Outputs** og **Returns** — referencekort for, hvad denne blok forventer og producerer.

De fleste tekstfelter accepterer variabler — sådan flyder data fra én blok til den næste. Fremfor at skrive syntaksen selv, brug værdivælgeren i editoren: den bygger en korrekt reference ud fra den blok og det felt, du vælger. Se [Variabler](/docs/workflows/variables).

## Tjek, mens du bygger

Builderen tjekker hele grafen, hver gang du ændrer den, og rapporterer, hvad den finder, i en pille i værktøjslinjen. Klik på pillen for at åbne **Problems with this workflow**, som lister hvert problem og hopper til den ansvarlige blok. Blokke med et problem bærer også et rødt mærke på lærredet.

Den fanger de fejl, der ellers er usynlige, indtil en kørsel går galt — ingen trigger, to blokke der deler et id, en prik inde i et id, en blok intet forbinder til, en påkrævet indstilling efterladt tom, ugyldig JSON, mellemrum inde i `{{ }}`, og referencer til et trin eller en returværdi, der ikke findes.

Én ting, den ikke kan tjekke: om et variabelnavn findes. En omdøbt variabel viser sig kun i kørselsloggen.

## Din første arbejdsgang

Den hurtigste måde at føle lærredet efter:

1. Klik på den stiplede pladsholderblok, vælg **Manual** i panelet **Add Trigger**, og klik på **Add to Workflow**.
2. Klik på **Add Component**, vælg **Log** (under **Utils**), og klik på **Add to Workflow**. Træk den nye blok fri af triggeren, og forbind derefter triggerens **Execute**-prik ned til Log-blokkens inputprik.
3. Åbn Log-blokken, og sæt dens **Value** til `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` er triggerens **Identifier**, vist på triggerblokken — tjek, at den matcher.
4. Gå til **Overview**, klik på **Edit Workflow** på kortet **Workflow Details**, og slå **Enabled** til. En deaktiveret arbejdsgang kan slet ikke køres, heller ikke manuelt.
5. Tilbage i **Builder**, klik på **Run Workflow**, sæt `{ "name": "Ada" }` i feltet **JSON**, klik på **Run Workflow Manually**, og bekræft med **Run**.
6. Et **Workflow Run**-panel åbner af sig selv og følger kørslen. Loggen viser `Value:` efterfulgt af `Hello from Ada`.

Den cyklus — tilføj, forbind, konfigurér, kør, læs loggen — er, hvordan du vil bygge hver arbejdsgang.

## Sådan slår du den til

Nye arbejdsgange starter deaktiverede, og det gør enhver arbejdsgang, du duplikerer eller importerer, også.

Kontakten **Enabled** sidder på arbejdsgangens side **Overview**, på kortet **Workflow Details** — ikke på siden Settings. Det samme kort viser den aktuelle status som en grøn **Enabled**- eller rød **Disabled**-pille.

En deaktiveret arbejdsgang kan slet ikke køre. Manuelle kørsler afvises med "This workflow is not enabled" ligesom udløste kørsler, så rækkefølgen er: aktivér den, test den med **Run Workflow**, læs kørselsloggen, og slå **Enabled** fra igen, hvis du ikke er klar til, at dens trigger skal udløses. For at teste én blok uden at køre hele arbejdsgangen, brug **Run just this step** i den blokkens indstillinger.

For at sætte en arbejdsgang på pause uden at slette den, slå **Enabled** fra. Ingen nye kørsler starter. En kørsel, der er midt i udførelsen, færdiggøres, men én, der er parkeret på en **Sleep**-blok, annulleres, når den vågner, og registreres som en fejl.

## Ryd op

- Træk blokke for at flytte dem. Layoutet gemmes.
- For at slette en linje, træk en af dens ender væk fra prikken, og slip den på tomt lærred.
- For at slette en blok, klik på den, og brug **Delete** nederst i dens indstillingsdialog. At vælge en blok eller en linje og trykke Backspace fjerner den også.
- Der er ingen måde at duplikere en enkelt blok på. **Duplicate Workflow** på arbejdsgangens side **Settings** kopierer hele den, og kopien lander deaktiveret.
- Stak blokke fra top til bund, så de læses i den retning, de kører — inputs er på den øverste kant, outputs på den nederste, så flowet naturligt går nedad.

## Hvor du kan læse videre

- [Triggers](/docs/workflows/triggers) — de fire måder, en arbejdsgang kan starte på.
- [Komponenter](/docs/workflows/components) — hver blok, du kan tilføje.
- [Variabler](/docs/workflows/variables) — flytning af data mellem blokke.
- [Kørsler og logs](/docs/workflows/runs-and-logs) — tjek hvad der skete.
