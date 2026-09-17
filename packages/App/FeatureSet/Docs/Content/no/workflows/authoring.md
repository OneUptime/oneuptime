# Opprette en arbeidsflyt

For å lage en arbeidsflyt åpner du **Arbeidsflyter** og klikker **Opprett arbeidsflyt**. En veiviser som heter **Create a workflow** tar deg gjennom det: først **Start from** — velg **Start from scratch** eller en av malene — så **Navn**, og til slutt et **Konfigurer**-trinn, som bare dukker opp når malen du valgte ber om egne innstillinger.

Så snart den er opprettet, åpner du **Bygger** i venstremenyen. Der ligger lerretet du utformer arbeidsflyten på.

## Lerretet

En arbeidsflyt du bygger fra bunnen, åpner med én stiplet blokk der det står **Please click here to add trigger**. Den blokken er startpunktet — klikk på den for å velge en trigger. En arbeidsflyt laget fra en mal åpner med blokkene allerede på plass.

Hver arbeidsflyt har nøyaktig én **trigger** øverst. Alt annet er en **komponent** som gjør noe. Legger du til en trigger til, erstatter den den forrige, og sletter du den siste, kommer den stiplede plassholderen tilbake.

Slik legger du til blokker:

- **Triggeren** — klikk på den stiplede plassholderblokken. Et panel med tittelen **Add Trigger** åpnes.
- **Alt annet** — klikk **Legg til komponent** i verktøylinjen over lerretet. Det samme panelet åpnes, nå med tittelen **Legg til komponent**.

Du kan søke i begge panelene — trykk `/` for å hoppe til søkefeltet — og innholdet er gruppert etter kategori. Velg én blokk og klikk **Add to Workflow**.

Nye blokker havner alltid på samme punkt på lerretet, så en ny kan lande oppå noe du allerede har plassert. Dra den unna; lerretet snapper til et rutenett underveis. Blokkposisjonene lagres, så neste person ser det samme oppsettet som du forlot.

Endringer lagres automatisk. En pille i verktøylinjen holder rede på det: **Saving…** mens endringen er underveis, deretter **Lagret** — eller **Kunne ikke lagre** hvis det ikke gikk. Det finnes ingen lagreknapp og ingen egen publiseringsjobb.

## Hva en blokk består av

| Felt                             | Hva det gjør                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**)    | Den korte iden som vises på blokken, som `log-1`. Det er slik andre blokker refererer til denne, så et navnebytte ødelegger hver eneste `{{local.components.…}}`-referanse som peker hit. Overskriften på blokken er komponentens eget navn og kan ikke endres. |
| **Innstillinger**                | Det blokken trenger for å gjøre jobben sin — en URL, en Slack-kanal, en meldingstekst. Valgfrie felt er merket **(Optional)**; alt annet er obligatorisk. Innstillinger som brukes sjeldnere, ligger bak et **Avansert**-panel. |
| **Input**                        | Prikken på overkanten, der linjene fra tidligere blokker kommer inn. Triggere har den ikke — ingenting kjører før dem.                                                                                       |
| **Outputs**                      | Prikkene langs underkanten, med etiketter rett over seg, der linjene går videre til neste blokker. Mange blokker har separate **Suksess**- og **Feil**-utganger, så du kan håndtere begge utfall.            |

## Å koble sammen blokker

Dra fra en prikk nederst på én blokk ned til prikken på overkanten av den neste. Linjen du tegner, avgjør hva som kjører etterpå.

- Kobler du fra **Suksess**, kjører den neste blokken bare når den forrige gikk bra.
- Kobler du fra **Feil**, kjører den neste blokken bare når den forrige feilet.
- Lar du en utgang stå ukoblet, stopper den grenen der.

Du kan koble én utgang til flere blokker. Alle kjører — men etter hverandre, i én kø, ikke parallelt. Ikke stol på rekkefølgen mellom grener, og regn ikke med at de overlapper i tid. Hver blokk kjører maksimalt én gang per kjøring, så en sløyfe tilbake til en tidligere blokk kjører den ikke på nytt.

## Å konfigurere en blokk

Klikk på en blokk for å åpne innstillingene i en dialog. Hver innstilling har den inndatatypen som passer — tekstfelt, nedtrekkslister, kodeeditorer, brytere og så videre. Fyll ut og klikk **Lagre**.

I den samme dialogen finner du også:

- **Slett** — fjern denne blokken.
- **Run just this step** — kjør denne ene blokken alene, uten resten av arbeidsflyten. Verdier den ville lest fra andre trinn, kommer inn tomme, og alt den sender, skriver eller sletter skjer på ordentlig.
- **Dokumentasjon**, **Inputs**, **Outputs** og **Returns** — oppslagskort for hva blokken forventer og hva den produserer.

De fleste tekstfelt tar imot variabler — det er slik data flyter fra én blokk til den neste. Fremfor å skrive syntaksen for hånd bør du bruke verdivelgeren i editoren: den bygger en korrekt referanse ut fra blokken og feltet du velger. Se [Arbeidsflyt-variabler](/docs/workflows/variables).

## Kontroller mens du bygger

Byggeren sjekker hele grafen hver gang du endrer noe, og rapporterer det den finner i en pille i verktøylinjen. Klikk på pillen for å åpne **Problems with this workflow**, som lister opp hvert problem og hopper til blokken som er skyld i det. Blokker med problemer får også et rødt merke på lerretet.

Den fanger opp feilene som ellers er usynlige helt til en kjøring går galt — ingen trigger, to blokker som deler en id, et punktum inni en id, en blokk ingenting kobler til, en obligatorisk innstilling som står tom, feilformet JSON, mellomrom inni `{{ }}`, og referanser til et trinn eller en returverdi som ikke finnes.

Én ting den ikke får sjekket: om et variabelnavn finnes. En variabel som har byttet navn, dukker først opp i kjøreloggen.

## Din første arbeidsflyt

Den raskeste måten å bli kjent med lerretet på:

1. Klikk på den stiplede plassholderblokken, velg **Manual** i **Add Trigger**-panelet, og klikk **Add to Workflow**.
2. Klikk **Legg til komponent**, velg **Log** (under **Utils**), og klikk **Add to Workflow**. Dra den nye blokken unna triggeren, og koble deretter triggerens **Execute**-prikk ned til inndataprikken på Log-blokken.
3. Åpne Log-blokken og sett **Verdi** til `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` er triggerens **Identifier**, som står på triggerblokken — sjekk at den stemmer.
4. Gå til **Oversikt**, klikk **Rediger arbeidsflyt** på kortet **Arbeidsflytdetaljer**, og slå på **Aktivert**. En deaktivert arbeidsflyt kan ikke kjøres i det hele tatt, ikke engang for hånd.
5. Tilbake i **Bygger** klikker du **Kjør arbeidsflyt**, legger `{ "name": "Ada" }` i **JSON**-feltet, klikker **Run Workflow Manually** og bekrefter med **Run**.
6. Et **Workflow Run**-panel åpner seg av seg selv og følger kjøringen. Loggen viser `Value:` etterfulgt av `Hello from Ada`.

Den runden — legg til, koble, konfigurer, kjør, les loggen — er slik du bygger hver eneste arbeidsflyt.

## Å slå den på

Nye arbeidsflyter starter deaktivert, og det samme gjør enhver arbeidsflyt du dupliserer eller importerer.

Bryteren **Aktivert** ligger på arbeidsflytens **Oversikt**-side, i kortet **Arbeidsflytdetaljer** — ikke på innstillingssiden. Det samme kortet viser gjeldende tilstand som en grønn **Aktivert**- eller rød **Deaktivert**-pille.

En deaktivert arbeidsflyt kan ikke kjøre i det hele tatt. Manuelle kjøringer avvises med «This workflow is not enabled» akkurat som utløste kjøringer, så rekkefølgen er: slå den på, test den med **Kjør arbeidsflyt**, les kjøreloggen, og slå **Aktivert** av igjen hvis du ikke er klar for at triggeren skal fyre. Vil du teste én enkelt blokk uten å kjøre hele greia, bruker du **Run just this step** i innstillingene til den blokken.

Vil du sette en arbeidsflyt på pause uten å slette den, slår du av **Aktivert**. Ingen nye kjøringer starter. En kjøring som er midt i utførelsen, blir ferdig, men en som står parkert på en **Sleep**-blokk, avbrytes når den våkner og føres opp som en feil.

## Rydding

- Dra i blokker for å flytte dem. Oppsettet lagres.
- Vil du slette en linje, drar du en av endene av prikken og slipper den på tomt lerret.
- Vil du slette en blokk, klikker du på den og bruker **Slett** nederst i innstillingsdialogen. Du kan også markere en blokk eller en linje og trykke Backspace.
- Det finnes ingen måte å duplisere én enkelt blokk på. **Duplicate Workflow** på arbeidsflytens **Innstillinger**-side kopierer det hele, og kopien lander deaktivert.
- Stable blokkene ovenfra og ned så de leses i den retningen de kjører — inndata ligger på overkanten og utdata på underkanten, så flyten går naturlig nedover.

## Hvor du leser videre

- [Arbeidsflyt-triggere](/docs/workflows/triggers) — de fire måtene en arbeidsflyt kan starte på.
- [Arbeidsflyt-komponenter](/docs/workflows/components) — hver blokk du kan legge til.
- [Arbeidsflyt-variabler](/docs/workflows/variables) — å flytte data mellom blokker.
- [Arbeidsflyt-kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
