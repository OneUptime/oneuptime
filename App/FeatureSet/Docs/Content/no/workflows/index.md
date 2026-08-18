# Oversikt over arbeidsflyter

Arbeidsflyter lar deg automatisere oppgaver i OneUptime uten å skrive kode. Legg til noen blokker på et lerret, koble dem sammen, og du har automatisering som kjører hver gang noe skjer — en hendelse åpnes, en tidsplan utløses, eller et annet verktøy sender data til OneUptime.

Tenk på arbeidsflyter som bakgrunnshjelpere for prosjektet ditt: de reagerer på hendelser, snakker med andre verktøy og holder ting stille i synk mens du fokuserer på arbeidet ditt.

## Hva du kan gjøre med arbeidsflyter

- **Koble OneUptime til de andre verktøyene dine** — send hendelser til Slack, opprett Jira-saker, post til en webhook i stacken din.
- **Reager på det som skjer i OneUptime** — når en kritisk hendelse opprettes, varsle vakthavende team og opprett en sak automatisk.
- **Kjør jobber etter en tidsplan** — hvert femte minutt, hver natt, hver mandag morgen.
- **Motta data utenfra** — la andre systemer pushe data inn i OneUptime via en unik URL.
- **Gjenbruk vanlig automatisering** — bygg det én gang, kall det fra en hvilken som helst annen arbeidsflyt.

## Hvordan en arbeidsflyt fungerer

Hver arbeidsflyt har tre deler:

1. **En trigger** — hva som starter arbeidsflyten. Dette kan være en manuell knapp, en tidsplan, en innkommende webhook, eller en hendelse i OneUptime (som en ny hendelse).
2. **Én eller flere komponenter** — hva arbeidsflyten gjør. Send en melding, gjør et HTTP-kall, kjør en rask sjekk, forgren basert på en betingelse.
3. **Koblinger mellom dem** — du tegner linjer fra én blokk til den neste for å bestemme rekkefølgen.

Du bygger alt dette visuelt på et lerret. Ingen koding kreves for de fleste arbeidsflyter, men du kan legge til en snutt med JavaScript når du trenger det.

## Sentrale begreper

| Begrep               | Hva det betyr                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Arbeidsflyt**      | Hele automatiseringen — et navn, et lerret og en bryter for å slå den på eller av.                 |
| **Trigger**          | Den første blokken. Den bestemmer når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én trigger. |
| **Komponent**        | En handlingsblokk — sender en melding, gjør en forespørsel, sjekker en betingelse.                 |
| **Kjøring**          | Én eksekvering av arbeidsflyten. Lagres med tidsstempler og utdata fra hver blokk.                 |
| **Global variabel**  | En verdi (som en API-nøkkel) du lagrer én gang og gjenbruker i en hvilken som helst arbeidsflyt.   |

## Hvor du finner arbeidsflyter i OneUptime

Åpne **Workflows** i venstre navigasjon. Den delen inneholder:

- **Workflows** — listen over arbeidsflytene dine. Opprett en ny eller åpne en eksisterende.
- **Global Variables** — verdier som deles på tvers av alle arbeidsflytene dine.
- **Runs & Logs** — eksekveringshistorikk på tvers av hver arbeidsflyt i prosjektet ditt.

Åpne en enkelt arbeidsflyt, og dens egen venstremeny inneholder:

- **Overview** — navn, beskrivelse, etiketter og **Enabled**-bryteren.
- **Builder** — lerretet hvor du designer arbeidsflyten.
- **Workflow Variables** — verdier avgrenset til denne ene arbeidsflyten.
- **Runs & Logs** — hver kjøring av denne arbeidsflyten, med detaljer.
- **Settings** — webhook-hemmelighet, dupliser og eksporter.

## Bygg din første arbeidsflyt

1. **Create** — velg et utgangspunkt, gi deretter arbeidsflyten din et navn.
2. **Pick a trigger** — manuell, planlagt, webhook, eller en hendelse fra OneUptime.
3. **Add components** — legg til handlinger på lerretet og koble dem sammen.
4. **Turn it on** — slå på **Enabled** fra **Overview**-siden. En deaktivert arbeidsflyt kan ikke kjøre i det hele tatt, ikke engang manuelt.
5. **Test** — klikk **Run Workflow** i Builder og følg med i kjøreloggen.

## Et raskt eksempel

Si at du vil poste i Slack hver gang en kritisk hendelse opprettes:

1. Opprett en arbeidsflyt kalt «Critical incidents to Slack».
2. Velg triggeren **On Create Incident**.
3. Legg til en **If / Else**-blokk. Sett den til å sjekke om hendelsestittelen inneholder «Sev 1».
4. Fra **Yes**-grenen, legg til en **Slack**-blokk. Velg kanalen og skriv meldingen.
5. Slå på arbeidsflyten.

Neste gang noen åpner en hendelse med «Sev 1» i tittelen, lyser Slack opp.

## Hvordan arbeidsflyter passer sammen med resten av OneUptime

- **Monitors** oppdager problemet. **Incidents** registrerer det. **Workflows** reagerer på det.
- **Runbooks** er trinn-for-trinn-veiledninger for mennesker. Arbeidsflyter er automatisering uten oppsyn. Bruk en runbook når et menneske må ta beslutninger; bruk en arbeidsflyt når trinnene er automatiske.
- **Workspace connections** (Slack, Teams) er der arbeidsflyter sender meldingene sine.

## Hvor du kan lese videre

- [Authoring a Workflow](/docs/workflows/authoring) — å bygge på lerretet.
- [Triggers](/docs/workflows/triggers) — de forskjellige måtene en arbeidsflyt kan starte på.
- [Components](/docs/workflows/components) — byggeblokkene du kan legge til.
- [Variables](/docs/workflows/variables) — å bruke verdier på tvers av blokker og arbeidsflyter.
- [Runs & Logs](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
- [Configuration & Safety](/docs/workflows/configuration) — innstillinger verdt å kjenne til.
