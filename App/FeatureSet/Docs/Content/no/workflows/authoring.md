# Lage en arbeidsflyt

For å opprette en arbeidsflyt, åpne **Arbeidsflyter → Opprett arbeidsflyt**, gi den et navn, og klikk inn på **Bygger**-fanen. Du vil se et tomt lerret hvor du skal bygge automatiseringen.

## Lerretet

Byggeren er et dra-og-slipp-lerret. Du legger til blokker fra paletten på siden, kobler dem sammen med linjer, og klikker på hver blokk for å konfigurere hva den gjør. Endringer lagres automatisk — du ser en indikator øverst når de er lagret.

Hver arbeidsflyt starter med én **trigger** i begynnelsen. Alt annet er en **komponent** som gjør noe.

## Hva som finnes på en blokk

| Felt | Hva det gjør |
| --- | --- |
| **Tittel** | Navnet som vises på lerretet. Gi det nytt navn for å gjøre komplekse arbeidsflyter lettere å lese. |
| **Innstillinger** | Hva blokken trenger for å gjøre jobben sin — en URL, en Slack-kanal, en meldingstekst, osv. Obligatoriske felter er markert med en stjerne. |
| **Inngang** | Prikken til venstre der linjer kommer inn fra tidligere blokker. |
| **Utganger** | Prikkene til høyre der linjer går ut til de neste blokkene. Mange blokker har separate utganger for **suksess** og **feil** slik at du kan håndtere begge tilfeller. |

## Koble blokker sammen

Dra fra utgangsprikken på en blokk til inngangsprikken på den neste blokken. Linjen du tegner bestemmer hva som kjører neste.

- Hvis du kobler fra **suksess**, kjører den neste blokken bare når den tidligere fungerte.
- Hvis du kobler fra **feil**, kjører den neste blokken bare når den tidligere feilet.
- Hvis du ikke kobler til en utgang, stopper den banen bare.

Du kan koble én utgang til flere blokker. De kjører alle samtidig fra det punktet.

## Konfigurere en blokk

Klikk på en blokk for å åpne innstillingene dens på siden. Hver innstilling har riktig type input — tekstfelt, nedtrekkslister, kodeeditorer, brytere og så videre.

De fleste tekstfelter aksepterer variabler — det er slik data flyter fra én blokk til den neste. Se [Variabler](/docs/workflows/variables) for syntaksen.

## Din første arbeidsflyt

Den raskeste måten å bli kjent med lerretet på:

1. Dra en **Manuell** trigger inn på lerretet.
2. Dra en **Log**-komponent (under **Utils**) ved siden av. Koble triggeren til Log-komponenten.
3. I meldingsfeltet til Log-blokken, skriv `Hello from {{Manual.JSON.name}}`.
4. Lagre og slå på arbeidsflyten.
5. Klikk **Kjør manuelt**, lim inn `{ "name": "Ada" }` som input, og send inn.
6. Åpne **Logger**-fanen. Den siste kjøringen viser `Hello from Ada`.

Den syklusen — dra, koble, konfigurere, kjøre, sjekke loggen — er hvordan du bygger hver arbeidsflyt.

## Lagre og slå på

Lerretet lagrer mens du arbeider. Det er ingen separat "publiser"-steg.

Men en arbeidsflyt kjører faktisk bare når **Aktivert** er på i Innstillinger. Nye arbeidsflyter starter som deaktivert. Bruk denne bryteren som sikkerhetsnett — bygg den, test med **Kjør manuelt**, sjekk loggene, og slå den så på.

For å sette en arbeidsflyt på pause uten å slette den, slå **Aktivert** av. Kjøringer som allerede er i gang fullføres; ingen nye starter.

## Rydde opp

- Dra blokker for å flytte dem. Layouten lagres slik at neste person ser samme oppsett.
- Høyreklikk en linje for å slette den. Høyreklikk en blokk for å slette eller duplisere den.
- For brede arbeidsflyter, legg dem ut fra venstre til høyre slik at de leses i retningen de kjører.

## Hvor du leser videre

- [Triggere](/docs/workflows/triggers) — de fire måtene en arbeidsflyt kan starte på.
- [Komponenter](/docs/workflows/components) — hver blokk du kan legge til.
- [Variabler](/docs/workflows/variables) — å flytte data mellom blokker.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
