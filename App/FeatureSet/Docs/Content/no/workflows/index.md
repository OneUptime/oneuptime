# Oversikt over arbeidsflyter

Arbeidsflyter lar deg automatisere oppgaver i OneUptime uten å skrive kode. Dra og slipp noen blokker på et lerret, koble dem sammen, og du har automatisering som kjører hver gang noe skjer — en hendelse åpnes, en tidsplan utløses, eller et annet verktøy sender data til OneUptime.

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

Du bygger alt dette visuelt på et lerret. Ingen koding kreves for de fleste arbeidsflyter, men du kan slippe inn en snutt med JavaScript når du trenger det.

## Sentrale begreper

| Begrep              | Betydning                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **Arbeidsflyt**     | Hele automatiseringen — et navn, et lerret og en bryter for å slå den på eller av.                    |
| **Trigger**         | Den første blokken. Den bestemmer når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én trigger. |
| **Komponent**       | En handlingsblokk — sender en melding, gjør en forespørsel, sjekker en betingelse.                    |
| **Kjøring**         | Én eksekvering av arbeidsflyten. Lagres med tidsstempler og utdata fra hver blokk.                    |
| **Global variabel** | En verdi (som en API-nøkkel) du lagrer én gang og gjenbruker i en hvilken som helst arbeidsflyt.      |

## Hvor du finner arbeidsflyter i OneUptime

Åpne **Arbeidsflyter** i venstre navigasjon. Derfra:

- **Arbeidsflyter** — listen over arbeidsflytene dine. Opprett en ny eller åpne en eksisterende.
- **Bygger-fanen** — lerretet hvor du designer arbeidsflyten.
- **Logger-fanen** — hver kjøring av denne arbeidsflyten, med detaljer.
- **Innstillinger-fanen** — navn, beskrivelse, eiere, etiketter, aktiver/deaktiver.
- **Globale variabler** — verdier som deles på tvers av alle arbeidsflytene dine.
- **Kjøringer & logger** — eksekveringshistorikk på tvers av hver arbeidsflyt i prosjektet ditt.

## Bygge din første arbeidsflyt

1. **Opprett** — gi arbeidsflyten din et navn og en kort beskrivelse.
2. **Velg en trigger** — manuell, planlagt, webhook eller en hendelse fra OneUptime.
3. **Legg til komponenter** — dra handlinger inn på lerretet og koble dem sammen.
4. **Test** — klikk **Kjør manuelt** og se hva som skjer i loggene.
5. **Slå den på** — vri på **Aktivert**-bryteren i Innstillinger når du er klar.

## Et raskt eksempel

Si at du vil poste i Slack hver gang en kritisk hendelse opprettes:

1. Opprett en arbeidsflyt kalt "Kritiske hendelser til Slack."
2. Velg triggeren **Hendelse → Ved opprettelse**.
3. Legg til en **Betingelser**-blokk. Sett den til å sjekke om hendelsestittelen inneholder "Sev 1."
4. Fra **Ja**-grenen, legg til en **Slack**-blokk. Velg kanalen og skriv meldingen.
5. Slå på arbeidsflyten.

Neste gang noen åpner en hendelse med "Sev 1" i tittelen, lyser Slack opp.

## Hvordan arbeidsflyter passer sammen med resten av OneUptime

- **Monitorer** oppdager problemet. **Hendelser** registrerer det. **Arbeidsflyter** reagerer på det.
- **Runbooks** er trinn-for-trinn-veiledninger for mennesker. Arbeidsflyter er automatisering uten oppsyn. Bruk en runbook når et menneske må ta beslutninger; bruk en arbeidsflyt når trinnene er automatiske.
- **Arbeidsområdekoblinger** (Slack, Teams) er der arbeidsflyter sender meldingene sine.

## Hvor du leser videre

- [Lage en arbeidsflyt](/docs/workflows/authoring) — å bygge på lerretet.
- [Triggere](/docs/workflows/triggers) — de forskjellige måtene en arbeidsflyt kan starte på.
- [Komponenter](/docs/workflows/components) — byggeblokkene du kan legge til.
- [Variabler](/docs/workflows/variables) — å bruke verdier på tvers av blokker og arbeidsflyter.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — innstillinger verdt å kjenne til.
