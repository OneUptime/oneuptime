# Triggere

En trigger er den første blokken i en arbeidsflyt — den bestemmer når arbeidsflyten kjører. Hver arbeidsflyt har nøyaktig én trigger. Du velger mellom fire typer.

## Manuell

Kjør arbeidsflyten på forespørsel ved å klikke **Run Workflow** på **Builder**-siden, fylle ut triggerens felter, og bekrefte med **Run Workflow Manually**. Manuell-triggeren tar imot en JSON-nyttelast som resten av arbeidsflyten kan lese.

Godt egnet til: automatiseringer med ett klikk du vil ha en knapp for, som «roter denne nøkkelen» eller «send et testvarsel».

**Output**: JSON-en du limte inn, eller et tomt objekt hvis du ikke gjorde det.

## Tidsplan

Kjør arbeidsflyten på en gjentakende tidsplan ved hjelp av et cron-uttrykk.

Godt egnet til: nattlig opprydding, timevis synkronisering, ukentlige rapporter.

**Setting**: et cron-uttrykk. Noen vanlige eksempler:

- `0 * * * *` — hver time, på timen.
- `*/5 * * * *` — hvert 5. minutt.
- `0 9 * * 1` — hver mandag klokken 09:00.

Hvis systemet er utilgjengelig en kort stund, blir kjøringen fanget opp så snart det er tilbake — du trenger ikke bekymre deg for tapte tikk ved korte driftsavbrudd.

## Webhook

OneUptime oppretter en unik URL. Alt som treffer den URL-en starter arbeidsflyten. Headerne, spørreparametrene og kroppen i forespørselen sendes med.

Godt egnet til: å motta data inn i OneUptime fra et annet verktøy — CI/CD-tilbakekall, varsler fra annen overvåking, registreringer i CRM-et ditt.

**Output**:

- **Request Headers** — alle headerne fra den innkommende forespørselen.
- **Request Query Params** — den analyserte spørrestrengen.
- **Request Body** — den analyserte kroppen (eller rå tekst hvis den ikke er JSON).

URL-en godtar både `GET` og `POST`. Den som kaller den, får en rask bekreftelse — selve arbeidsflyten kjører i bakgrunnen.

Behandle URL-en som et passord. Alle som har den, kan starte arbeidsflyten din.

## OneUptime-hendelsestriggere

Nesten alt i OneUptime — overvåkinger, hendelser, varsler, planlagt vedlikehold, statussider, vaktordninger, team — kan utløse en arbeidsflyt. Hver enkelt tilbyr tre hendelser:

- **On Create** — utløses når en ny opprettes.
- **On Update** — utløses når en endres.
- **On Delete** — utløses når en slettes.

Slik bygger du «når X skjer i OneUptime, gjør Y» uten å måtte sjekke ting i en løkke.

Hele posten sendes videre til neste blokk. For eksempel sender **Incident → On Create**-triggeren med den nye hendelsen, slik at neste blokk kan lese tittelen, beskrivelsen, alvorlighetsgraden og alle andre felt.

### Hendelser team bruker mest

- **Incident** — reager når en hendelse åpnes, oppdateres (bekreftes, løses), eller slettes.
- **Alert** — de samme tre for varsler.
- **Monitor** — reager når en overvåking legges til, redigeres eller fjernes.
- **Scheduled Maintenance** — annonser et vedlikeholdsvindu automatisk når det planlegges.
- **Status Page Subscriber** — ønsk velkommen til noen som abonnerer på en statusside.
- **On-Call Duty Policy** — synkroniser tidsplanendringer til et annet vaktsystem.

Søk i **Add Trigger**-panelet etter navn for å finne den du vil ha.

## Hvilken trigger bør jeg bruke?

| Hvis du vil…                              | Velg                |
| ------------------------------------------ | -------------------- |
| Klikke en knapp for å kjøre arbeidsflyten  | **Manual**           |
| Kjøre på en gjentakende tidsplan           | **Schedule**         |
| La et annet system pushe data inn          | **Webhook**          |
| Reagere på noe inne i OneUptime            | **OneUptime event**  |

En arbeidsflyt kan bare ha én trigger. Hvis du trenger to måter å starte den samme automatiseringen på, bygg den delte logikken i én arbeidsflyt og kall den fra to tynne «wrapper»-arbeidsflyter ved hjelp av **Execute Workflow**-komponenten.

## Hvor du kan lese videre

- [Components](/docs/workflows/components) — handlingene du legger til etter triggeren.
- [Variables](/docs/workflows/variables) — å lese trigger-output fra senere blokker.
- [Runs & Logs](/docs/workflows/runs-and-logs) — å bekrefte at triggeren din utløste.
