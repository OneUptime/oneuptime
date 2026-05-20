# Opprette en arbeidsflyt

Opprett en arbeidsflyt under **Arbeidsflyter → Opprett arbeidsflyt**, gi den et navn og en valgfri beskrivelse, og åpne så **Builder**-fanen for å begynne å slippe noder på lerretet.

## Lerretet

Builder er en zoombar, pannerbar graf. Du legger til noder fra en komponentpalett, kobler dem med kanter og konfigurerer hver nodes argumenter i et sidepanel. En lagringsindikator i toppen forteller deg om siste redigering er persistert.

En arbeidsflyt starter alltid med nøyaktig én **trigger**-node. Triggere har ingen inngangsport — det er der utførelsen begynner. Alt nedstrøms er en **komponent**.

## Anatomien til en node

Hver node har:

| Felt | Formål |
| --- | --- |
| **Tittel** | Etiketten som vises på lerretet. Defaulter til komponentnavnet; overskriv det for å gjøre komplekse arbeidsflyter lettere å lese. |
| **Argumenter** | Konfigurasjonen komponenten trenger for å gjøre jobben sin — en URL, en Slack-kanal, en JavaScript-snutt osv. Nødvendige argumenter er merket med en stjerne. |
| **Inngangsporter** | Kontakter på venstre side av noden der innkommende kanter lander. Komponenter har én inngangsport som heter `in`; triggere har ingen. |
| **Utgangsporter** | Kontakter på høyre side der utgående kanter starter. Komponenter definerer porter som `success`, `error`, `yes`, `no`. |
| **Returverdier** | Data noden produserer — payload til utgangsportene. Nedstrømsnoder refererer til disse som `{{NodeId.fieldName}}`. |

## Koble noder

Dra fra en utgangsport til en nedstrømsnodes inngangsport for å opprette en kant. En kant fra `success` kjører den grenen bare når oppstrømsnoden lyktes; en kant fra `error` kjører bare når den feilet. Hvis du ikke kobler en port, ender den grenen ganske enkelt.

Du kan forgrene utover: én utgangsport kan mate flere nedstrømsnoder, og de kjører alle parallelt fra det punktet.

## Konfigurere argumenter

Klikk på en node for å åpne sidepanelet. Hvert argument har en typebasert editor:

- **Tekst / URL / E-post / Tall / Passord** — en enkeltlinjes input.
- **JSON** — en JSON-editor med syntaksuthevelse og valideringsindikator.
- **JavaScript** — en kodeeditor for snutter brukt av **Custom Code**-komponenten.
- **Markdown / HTML** — rikt formatert body for e-post- og meldingskomponenter.
- **CronTab** — et tidsplanuttrykk (brukt av Schedule-triggeren).
- **Boolean** — en bryter.
- **Select / Query** — nedtrekksmenyer for felt som tar et fast sett med verdier eller en modell-stil spørring.

Ethvert tekstfelt aksepterer variabelinterpolering — se [Variabler](/docs/workflows/variables) for reglene.

## En minimal første arbeidsflyt

Den raskeste måten å bli kjent med lerretet:

1. Slipp en **Manual**-trigger.
2. Slipp en **Log**-komponent (under **Utils**). Koble triggerens utgangsport til Log-komponentens inngangsport.
3. I Log-komponentens argument, skriv `Hello from {{Manual.JSON.name}}`.
4. Lagre og aktiver arbeidsflyten.
5. Klikk **Kjør manuelt**, lim inn `{ "name": "Ada" }` som input, og send inn.
6. Åpne **Logger**-fanen. Siste kjøring viser Log-nodens fangede output: `Hello from Ada`.

Den rundturen — dra, koble, konfigurere, kjøre, inspisere — er rytmen i å skrive enhver arbeidsflyt.

## Lagre, aktivere og teste i produksjon

Arbeidsflyter lagres som en JSON-graf i `Workflow.graph`-kolonnen. Builder lagrer mens du redigerer; lagringsindikatoren i toppen viser når siste endring har truffet serveren. Det finnes ikke noe eget "publiser"-trinn.

Men: en arbeidsflyt trigger triggeren sin bare når **isEnabled** er på. Nye arbeidsflyter leveres deaktivert. Behandle det flagget som din "klar for prod"-bryter — bygg, klikk **Kjør manuelt** for å tørrkjøre med en eksempel-payload, se på **Logger**, og slå deretter Enable på.

Hvis du må sette en arbeidsflyt på pause uten å slette den (f.eks. under en urelatert hendelse), slå av **isEnabled** i **Innstillinger**. Eksisterende pågående kjøringer fortsetter; ingen nye starter.

## Omarrangere og omorganisere

- Dra en node for å flytte den. Posisjonen lagres i grafen slik at den neste personen som åpner lerretet ser samme oppsett.
- Høyreklikk på en kant for å slette den; høyreklikk en node for slette- og dupliser-alternativer.
- For brede arbeidsflyter, legg dem ut fra venstre til høyre slik at utførelsesretningen matcher leseretningen din.

## Les videre

- [Triggere](/docs/workflows/triggers) — de fire trigger-familiene og hva hver eksponerer som returverdier.
- [Komponenter](/docs/workflows/components) — den fullstendige katalogen og argumentene deres.
- [Variabler](/docs/workflows/variables) — hvordan referere data mellom noder og fra globale variabler.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — hvordan feilsøke en arbeidsflyt som oppfører seg feil.
