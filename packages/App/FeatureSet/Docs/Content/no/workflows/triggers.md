# Triggere

En trigger er den første blokken i en arbeidsflyt — den avgjør når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én trigger. Du velger mellom fire typer.

## Manuell

Kjør arbeidsflyten når du selv vil, ved å klikke **Kjør arbeidsflyt** på siden **Bygger**, fylle ut feltene til triggeren og bekrefte med **Run Workflow Manually**. Manual-triggeren tar imot en JSON-nyttelast som resten av arbeidsflyten kan lese.

Bra for: automatikk du vil ha en knapp for, som «roter denne nøkkelen» eller «send et testvarsel».

**Utdata**: JSON-en du limte inn, eller et tomt objekt hvis du ikke limte inn noe.

## Tidsplan

Kjør arbeidsflyten etter en gjentakende tidsplan ved hjelp av et cron-uttrykk.

Bra for: nattlig opprydding, synkronisering hver time, ukentlige rapporter.

**Innstilling**: et cron-uttrykk. Noen vanlige:

- `0 * * * *` — hver time, på hel time.
- `*/5 * * * *` — hvert 5. minutt.
- `0 9 * * 1` — hver mandag klokken 09.00.

Er systemet kortvarig utilgjengelig, plukkes kjøringen opp så snart det er oppe igjen — du trenger ikke bekymre deg for tapte tikk ved korte avbrudd.

## Webhook

OneUptime lager en unik URL. Alt som treffer den URL-en starter arbeidsflyten. Headerne, spørringsparametrene og kroppen i forespørselen sendes med inn.

Bra for: å ta imot data i OneUptime fra et annet verktøy — tilbakekall fra CI/CD, varsler fra annen overvåking, nye registreringer i CRM-et ditt.

**Utdata**:

- **Forespørselshoder** — alle headerne fra den innkommende forespørselen.
- **Request Query Params** — den tolkede spørringsstrengen.
- **Forespørselstekst** — den tolkede kroppen (eller råteksten hvis den ikke er JSON).

URL-en tar imot både `GET` og `POST`. Den som kaller, får en kjapp bekreftelse — selve arbeidsflyten kjører i bakgrunnen.

Behandle URL-en som et passord. Alle som har den, kan starte arbeidsflyten din.

## OneUptime-hendelsestriggere

Nesten alt i OneUptime — overvåkinger, hendelser, varsler, planlagt vedlikehold, statussider, vaktplaner, team — kan utløse en arbeidsflyt. Hver av dem tilbyr tre hendelser:

- **On Create** — utløses når en ny legges til.
- **On Update** — utløses når en endres.
- **On Delete** — utløses når en slettes.

Slik bygger du «når X skjer i OneUptime, gjør Y» uten å måtte sjekke ting i en løkke.

Hele oppføringen sendes videre til neste blokk. Triggeren **Hendelse → On Create** sender for eksempel med den nye hendelsen, slik at neste blokk kan lese tittelen, beskrivelsen, alvorlighetsgraden og alle andre felt.

### Hendelser team bruker mest

- **Hendelse** — reager når en hendelse åpnes, endres (kvitteres, løses) eller slettes.
- **Varsel** — de samme tre for varsler.
- **Overvåking** — reager når en overvåking legges til, redigeres eller fjernes.
- **Planlagt vedlikehold** — kunngjør et vedlikeholdsvindu automatisk når det planlegges.
- **Statusside Abonnent** — ønsk velkommen den som abonnerer på en statusside.
- **On-Call Duty Policy** — synkroniser endringer i vaktplanen til et annet vaktsystem.

Søk etter navn i **Add Trigger**-panelet for å finne den du er ute etter.

## Hvilken trigger bør jeg bruke?

| Hvis du vil…                        | Velg                |
| ----------------------------------- | ------------------- |
| Klikke en knapp for å kjøre den     | **Manual**          |
| Kjøre etter en gjentakende tidsplan | **Schedule**        |
| La et annet system sende data inn   | **Webhook**         |
| Reagere på noe inne i OneUptime     | **OneUptime event** |

En arbeidsflyt kan bare ha én trigger. Trenger du to måter å starte den samme automatikken på, legger du den felles logikken i én arbeidsflyt og kaller den fra to tynne «innpaknings»-arbeidsflyter med komponenten **Execute Workflow**.

## Hvor du leser videre

- [Arbeidsflyt-komponenter](/docs/workflows/components) — handlingene du legger til etter triggeren.
- [Arbeidsflyt-variabler](/docs/workflows/variables) — å lese utdata fra triggeren i senere blokker.
- [Arbeidsflyt-kjøringer & logger](/docs/workflows/runs-and-logs) — å bekrefte at triggeren utløste.
