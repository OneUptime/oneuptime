# Triggere

En trigger er den første blokken i en arbeidsflyt — den bestemmer når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én trigger. Du velger mellom fire typer.

## Manuell

Kjør arbeidsflyten på forespørsel ved å klikke **Kjør manuelt** på arbeidsflytsiden. Du kan lime inn en JSON-nyttelast som resten av arbeidsflyten kan lese.

Bra for: ettklikks-automatiseringer du vil ha en knapp for, som "roter denne nøkkelen" eller "send et testvarsel."

**Utdata**: JSON-en du limte inn, eller et tomt objekt hvis du ikke gjorde det.

## Tidsplan

Kjør arbeidsflyten på en gjentakende tidsplan ved hjelp av et cron-uttrykk.

Bra for: nattlig opprydning, timesvis synkronisering, ukentlige rapporter.

**Innstilling**: et cron-uttrykk. Noen vanlige:

- `0 * * * *` — hver time, ved hel time.
- `*/5 * * * *` — hvert 5. minutt.
- `0 9 * * 1` — hver mandag klokken 09:00.

Hvis systemet er kort utilgjengelig, plukkes kjøringen opp så snart det kommer tilbake — du trenger ikke bekymre deg for missede tikk for korte avbrudd.

## Webhook

OneUptime oppretter en unik URL. Alt som treffer den URL-en starter arbeidsflyten. Headerne, spørringsparametrene og kroppen til forespørselen sendes inn.

Bra for: å motta data inn til OneUptime fra et annet verktøy — CI/CD-tilbakekall, varsler fra annen overvåking, registreringer i CRM-en din.

**Utdata**:

- **Request Headers** — alle headerne fra den innkommende forespørselen.
- **Request Query Params** — den tolkede spørringsstrengen.
- **Request Body** — den tolkede kroppen (eller råteksten hvis den ikke er JSON).

URL-en aksepterer både `GET` og `POST`. Den som kaller får en rask bekreftelse — selve arbeidsflyten kjører i bakgrunnen.

Behandle URL-en som et passord. Alle som har den kan starte arbeidsflyten din.

## OneUptime hendelsestriggere

Nesten alt i OneUptime — monitorer, hendelser, varsler, planlagt vedlikehold, statussider, vaktordningspolicyer, team — kan trigge en arbeidsflyt. Hver av dem tilbyr tre hendelser:

- **Ved opprettelse** — utløses når en ny legges til.
- **Ved oppdatering** — utløses når en endres.
- **Ved sletting** — utløses når en slettes.

Slik bygger du "når X skjer i OneUptime, gjør Y" uten å måtte sjekke ting i en løkke.

Hele oppføringen sendes til neste blokk. For eksempel sender triggeren **Hendelse → Ved opprettelse** den nye hendelsen, slik at neste blokk kan lese tittelen, beskrivelsen, alvorlighetsgraden og ethvert annet felt.

### Hendelser team bruker mest

- **Hendelse** — reager når en hendelse åpnes, oppdateres (bekreftet, løst) eller slettes.
- **Varsel** — samme tre for varsler.
- **Monitor** — reager når en monitor legges til, redigeres eller fjernes.
- **Planlagt vedlikehold** — annonser et vedlikeholdsvindu automatisk når det planlegges.
- **Statussideabonnent** — ønsk velkommen til noen som abonnerer på en statusside.
- **Vaktordningspolicy** — synkroniser tidsplanendringer til et annet vaktsystem.

Søk i triggerpaletten etter navn for å finne den du vil ha.

## Hvilken trigger bør jeg bruke?

| Hvis du vil… | Velg |
| --- | --- |
| Klikke en knapp for å kjøre arbeidsflyten | **Manuell** |
| Kjøre på en gjentakende tidsplan | **Tidsplan** |
| La et annet system pushe data inn | **Webhook** |
| Reagere på noe inne i OneUptime | **OneUptime-hendelse** |

En arbeidsflyt kan bare ha én trigger. Hvis du trenger to måter å starte samme automatisering på, bygg den delte logikken i én arbeidsflyt og kall den fra to tynne "wrapper"-arbeidsflyter ved å bruke komponenten **Kjør arbeidsflyt**.

## Hvor du leser videre

- [Komponenter](/docs/workflows/components) — handlingene du legger til etter triggeren.
- [Variabler](/docs/workflows/variables) — å lese trigger-utdata fra senere blokker.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — å bekrefte at triggeren ble utløst.
