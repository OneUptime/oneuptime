# Oversikt over arbeidsflyter

Arbeidsflyter lar deg automatisere oppgaver i OneUptime uten å skrive kode. Legg noen blokker på et lerret, koble dem sammen, og du har automatikk som kjører hver gang noe skjer — en hendelse åpnes, en tidsplan utløses, eller et annet verktøy sender data til OneUptime.

Tenk på arbeidsflyter som bakgrunnshjelpere for prosjektet ditt: de reagerer på hendelser, snakker med andre verktøy og holder ting i synk i det stille mens du konsentrerer deg om ditt eget.

## Hva du kan gjøre med arbeidsflyter

- **Koble OneUptime til de andre verktøyene dine** — send hendelser til Slack, opprett Jira-saker, post til en webhook i din egen stack.
- **Reager på det som skjer i OneUptime** — når en kritisk hendelse opprettes, varsle vaktlaget og opprett en sak automatisk.
- **Kjør jobber etter en tidsplan** — hvert femte minutt, hver natt, hver mandag morgen.
- **Ta imot data utenfra** — la andre systemer sende data inn i OneUptime gjennom en unik URL.
- **Gjenbruk vanlig automatikk** — bygg den én gang, og kall den fra en hvilken som helst annen arbeidsflyt.

## Slik fungerer en arbeidsflyt

Hver arbeidsflyt har tre deler:

1. **En trigger** — det som starter arbeidsflyten. Det kan være en knapp du trykker på, en tidsplan, en innkommende webhook, eller noe som skjer i OneUptime (som en ny hendelse).
2. **Én eller flere komponenter** — det arbeidsflyten gjør. Sender en melding, gjør et HTTP-kall, kjører en rask sjekk, forgrener seg på en betingelse.
3. **Koblingene mellom dem** — du tegner linjer fra én blokk til den neste for å bestemme rekkefølgen.

Alt dette bygger du visuelt på et lerret. De fleste arbeidsflyter krever ingen koding, men du kan legge til en snutt JavaScript når du trenger det.

## Sentrale begreper

| Begrep              | Hva det betyr                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Arbeidsflyt**     | Hele automatikken — et navn, et lerret og en bryter for å slå den på eller av.               |
| **Trigger**         | Den første blokken. Den avgjør når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én.  |
| **Komponent**       | En handlingsblokk — sender en melding, gjør en forespørsel, sjekker en betingelse.           |
| **Kjøring**         | Én utførelse av arbeidsflyten. Lagres med tidsstempler og utdata fra hver blokk.             |
| **Global variabel** | En verdi (som en API-nøkkel) du lagrer én gang og gjenbruker i alle arbeidsflyter.           |

## Hvor du finner arbeidsflyter i OneUptime

Åpne **Arbeidsflyter** i venstre navigasjon. Den seksjonen rommer:

- **Arbeidsflyter** — listen din over arbeidsflyter. Opprett en ny eller åpne en du har.
- **Globale variabler** — verdier som deles på tvers av alle arbeidsflytene dine.
- **Kjøringer og logger** — kjørehistorikk på tvers av hver arbeidsflyt i prosjektet.

Åpner du én arbeidsflyt, rommer dens egen venstremeny:

- **Oversikt** — navn, beskrivelse, etiketter og bryteren **Aktivert**.
- **Bygger** — lerretet der du utformer arbeidsflyten.
- **Arbeidsflytvariabler** — verdier som bare gjelder denne ene arbeidsflyten.
- **Kjøringer og logger** — hver kjøring av denne arbeidsflyten, med detaljer.
- **Innstillinger** — webhook-hemmelighet, duplisering og eksport.

## Bygg din første arbeidsflyt

1. **Opprett** — velg et utgangspunkt, og gi arbeidsflyten et navn.
2. **Velg en trigger** — manuell, planlagt, webhook eller noe som skjer i OneUptime.
3. **Legg til komponenter** — legg handlinger på lerretet og koble dem sammen.
4. **Slå den på** — skru på **Aktivert** fra siden **Oversikt**. En deaktivert arbeidsflyt kan ikke kjøre i det hele tatt, ikke engang manuelt.
5. **Test** — klikk **Kjør arbeidsflyt** i byggeren og følg med i kjøreloggen.

## Et lite eksempel

Si at du vil poste i Slack hver gang det opprettes en kritisk hendelse:

1. Opprett en arbeidsflyt som heter «Kritiske hendelser til Slack».
2. Velg triggeren **On Create Incident**.
3. Legg til en **If / Else**-blokk. Sett den til å sjekke om hendelsestittelen inneholder «Sev 1».
4. Fra grenen **Yes** legger du til en **Slack**-blokk. Velg kanalen og skriv meldingen.
5. Slå på arbeidsflyten.

Neste gang noen åpner en hendelse med «Sev 1» i tittelen, lyser Slack opp.

## Hvordan arbeidsflyter henger sammen med resten av OneUptime

- **Monitorer** oppdager problemet. **Hendelser** dokumenterer det. **Arbeidsflyter** reagerer på det.
- **Runbooks** er trinnvise veiledninger for mennesker. Arbeidsflyter er ubemannet automatikk. Bruk et runbook når et menneske må ta avgjørelser; bruk en arbeidsflyt når stegene er automatiske.
- **Arbeidsområdetilkoblinger** (Slack, Teams) er dit arbeidsflytene sender meldingene sine.

## Hvor du leser videre

- [Opprette en arbeidsflyt](/docs/workflows/authoring) — å bygge på lerretet.
- [Arbeidsflyt-triggere](/docs/workflows/triggers) — de forskjellige måtene en arbeidsflyt kan starte på.
- [Arbeidsflyt-komponenter](/docs/workflows/components) — byggeklossene du kan legge til.
- [Arbeidsflyt-variabler](/docs/workflows/variables) — å bruke verdier på tvers av blokker og arbeidsflyter.
- [Arbeidsflyt-kjøringer & logger](/docs/workflows/runs-and-logs) — å sjekke hva som skjedde.
- [Arbeidsflyt-konfigurasjon & sikkerhet](/docs/workflows/configuration) — innstillinger det er verdt å kjenne til.
