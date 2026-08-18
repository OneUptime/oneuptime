# Lage en arbeidsflyt

For å opprette en arbeidsflyt, åpne **Workflows** og klikk **Create Workflow**. En veiviser kalt **Create a workflow** leder deg gjennom det: først **Start from** — velg **Start from scratch** eller en av malene — deretter **Name**, og til slutt et **Configure**-trinn, som bare vises når malen du valgte spør om egne innstillinger.

Når den er opprettet, åpne **Builder** i venstremenyen. Det er lerretet hvor du designer arbeidsflyten.

## Lerretet

En arbeidsflyt fra bunnen av åpnes med én stiplet blokk som sier **Please click here to add trigger**. Den blokken er utgangspunktet — klikk på den for å velge en trigger. En arbeidsflyt opprettet fra en mal åpnes med blokkene sine allerede på plass.

Hver arbeidsflyt har nøyaktig én **trigger** øverst. Alt annet er en **component** som gjør noe. Å legge til en ny trigger erstatter den første, og å slette den siste setter den stiplede plassholderen tilbake.

Å legge til blokker:

- **Triggeren** — klikk den stiplede plassholderblokken. Et panel kalt **Add Trigger** åpnes.
- **Alt annet** — klikk **Add Component** i verktøylinjen over lerretet. Det samme panelet åpnes, med tittelen **Add Component**.

Begge panelene kan søkes i — trykk `/` for å hoppe til søkefeltet — og er gruppert etter kategori. Velg én blokk og klikk **Add to Workflow**.

Nye blokker havner alltid på samme sted på lerretet, så en ny kan lande oppå noe du allerede har plassert. Dra den unna; lerretet snapper til et rutenett mens du gjør det. Blokkposisjoner lagres, så neste person ser samme oppsett du forlot.

Endringer lagres automatisk. En pille i verktøylinjen sporer det: **Saving…** mens endringen er underveis, deretter **Saved**, eller **Could not save** hvis det ikke fungerte. Det finnes ingen Lagre-knapp og ikke noe eget publiseringstrinn.

## Hva som er på en blokk

| Felt                            | Hva det gjør                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**)    | Den korte iden vist på blokken, som `log-1`. Slik refererer andre blokker til denne, så å gi den nytt navn ødelegger hver `{{local.components.…}}`-referanse som peker på den. Blokkens overskrift er komponentens eget navn og kan ikke endres. |
| **Settings**                     | Det blokken trenger for å gjøre jobben sin — en URL, en Slack-kanal, en meldingstekst. Valgfrie felt er merket **(Optional)**; alt annet er obligatorisk. Mindre brukte innstillinger ligger bak en **Advanced**-utvidelse. |
| **Input**                        | Prikken på øvre kant, hvor linjer kommer inn fra tidligere blokker. Triggere har ingen — ingenting kjører før dem.                                                                                       |
| **Outputs**                      | Prikkene langs nedre kant, merket rett over dem, hvor linjer går ut til neste blokker. Mange blokker har separate **Success**- og **Error**-utganger slik at du kan håndtere begge tilfellene.            |

## Å koble sammen blokker

Dra fra en prikk på bunnen av én blokk ned til prikken på toppen av den neste. Linjen du tegner bestemmer hva som kjører videre.

- Hvis du kobler fra **Success**, kjører neste blokk bare når den forrige fungerte.
- Hvis du kobler fra **Error**, kjører neste blokk bare når den forrige feilet.
- Hvis du ikke kobler til en utgang, stopper den veien der.

Du kan koble én utgang til flere blokker. Alle sammen kjører — men én etter én, i én enkelt kø, ikke parallelt. Ikke stol på rekkefølgen mellom grener, og ikke regn med at de overlapper i tid. Hver blokk kjører maks én gang per kjøring, så en løkke tilbake til en tidligere blokk kjører den ikke to ganger.

## Å konfigurere en blokk

Klikk en blokk for å åpne innstillingene i en dialog. Hver innstilling har riktig type inndata — tekstfelt, nedtrekksmenyer, kodeeditorer, brytere og så videre. Fyll den ut og klikk **Save**.

Den samme dialogen er hvor du finner:

- **Delete** — fjern denne blokken.
- **Run just this step** — kjør denne ene blokken alene, uten resten av arbeidsflyten. Verdier den skulle ha lest fra andre steg kommer tomme gjennom, og alt den sender, skriver eller sletter skjer faktisk.
- **Documentation**, **Inputs**, **Outputs** og **Returns** — referansekort for hva denne blokken forventer og produserer.

De fleste tekstfelt godtar variabler — det er slik data flyter fra én blokk til den neste. I stedet for å skrive syntaksen for hånd, bruk verdivelgeren i editoren: den bygger en korrekt referanse ut fra blokken og feltet du velger. Se [Variables](/docs/workflows/variables).

## Sjekker mens du bygger

Builder sjekker hele grafen hver gang du endrer den, og rapporterer det den finner i en pille i verktøylinjen. Klikk pillen for å åpne **Problems with this workflow**, som lister hvert problem og hopper deg til blokken som er ansvarlig. Blokker med et problem bærer også et rødt merke på lerretet.

Den fanger opp feilene som ellers er usynlige helt til en kjøring går galt — ingen trigger, to blokker som deler en id, et punktum inni en id, en blokk ingenting kobler til, en obligatorisk innstilling som står tom, feilformet JSON, mellomrom inni `{{ }}`, og referanser til et steg eller en returverdi som ikke finnes.

Én ting den ikke kan sjekke: om et variabelnavn finnes. Et omdøpt variabelnavn vises først i kjøreloggen.

## Din første arbeidsflyt

Den raskeste måten å bli kjent med lerretet på:

1. Klikk den stiplede plassholderblokken, velg **Manual** i **Add Trigger**-panelet, og klikk **Add to Workflow**.
2. Klikk **Add Component**, velg **Log** (under **Utils**), og klikk **Add to Workflow**. Dra den nye blokken unna triggeren, koble deretter triggerens **Execute**-prikk ned til Log-blokkens input-prikk.
3. Åpne Log-blokken og sett **Value** til `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` er triggerens **Identifier**, vist på triggerblokken — sjekk at den stemmer.
4. Gå til **Overview**, klikk **Edit Workflow** på **Workflow Details**-kortet, og slå **Enabled** på. En deaktivert arbeidsflyt kan ikke kjøres i det hele tatt, ikke engang for hånd.
5. Tilbake i **Builder**, klikk **Run Workflow**, legg `{ "name": "Ada" }` i **JSON**-feltet, klikk **Run Workflow Manually**, og bekreft med **Run**.
6. Et **Workflow Run**-panel åpnes av seg selv og følger kjøringen. Loggen viser `Value:` etterfulgt av `Hello from Ada`.

Den syklusen — legg til, koble, konfigurer, kjør, les loggen — er hvordan du bygger hver arbeidsflyt.

## Å slå den på

Nye arbeidsflyter starter deaktiverte, og det gjør også enhver arbeidsflyt du dupliserer eller importerer.

**Enabled**-bryteren er på arbeidsflytens **Overview**-side, i **Workflow Details**-kortet — ikke på Settings-siden. Det samme kortet viser gjeldende status som en grønn **Enabled**- eller rød **Disabled**-pille.

En deaktivert arbeidsflyt kan ikke kjøre i det hele tatt. Manuelle kjøringer avvises med «This workflow is not enabled» akkurat som utløste kjøringer, så rekkefølgen er: aktiver den, test den med **Run Workflow**, les kjøreloggen, og slå **Enabled** av igjen hvis du ikke er klar for at triggeren skal utløses. For å teste én enkelt blokk uten å kjøre hele arbeidsflyten, bruk **Run just this step** i den blokkens innstillinger.

For å pause en arbeidsflyt uten å slette den, slå **Enabled** av. Ingen nye kjøringer starter. En kjøring som er midt i eksekvering fullføres, men en som er parkert på en **Sleep**-blokk avbrytes når den våkner og registreres som en feil.

## Rydding

- Dra blokker for å flytte dem. Oppsettet lagres.
- For å slette en linje, dra en av endene av prikken og slipp den på tomt lerret.
- For å slette en blokk, klikk den og bruk **Delete** nederst i innstillingsdialogen. Å velge en blokk eller en linje og trykke Backspace fjerner den også.
- Det finnes ingen måte å duplisere én enkelt blokk på. **Duplicate Workflow** på arbeidsflytens **Settings**-side kopierer hele greia, og kopien havner deaktivert.
- Stable blokker fra topp til bunn slik at de leses i retningen de kjører — innganger er på øvre kant, utganger på nedre, så flyten går naturlig nedover.

## Hvor du kan lese videre

- [Triggers](/docs/workflows/triggers) — de fire måtene en arbeidsflyt kan starte på.
- [Components](/docs/workflows/components) — hver blokk du kan legge til.
- [Variables](/docs/workflows/variables) — å flytte data mellom blokker.
- [Runs & Logs](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
