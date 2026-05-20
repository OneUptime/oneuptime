# Oversikt over arbeidsflyter

Arbeidsflyter er OneUptimes visuelle automatiseringsbygger. Dra en trigger inn på lerretet, koble den til en kjede av handlinger — HTTP-kall, Slack-meldinger, JavaScript-snutter, betingede forgreninger, databaseoppslag — så har du automatisering som kjører hver gang en hendelse i OneUptime (eller i omverdenen) trigges.

Hvis runbooks er sjekklister for mennesker under en hendelse, så er arbeidsflyter bakgrunnsjobber for prosjektet ditt — de kjører uten oppsyn, de reagerer på ting, og de limer OneUptime sammen med resten av stacken din.

## Et raskt overblikk

- **Toppnivåfunksjon** i OneUptime-dashbordet under **Arbeidsflyter**.
- **Tre triggertyper**: Manuell, Tidsplan (cron), Webhook — pluss en **modellhendelse-trigger** som trigges når en hvilken som helst OneUptime-entitet (hendelse, varsel, monitor, statusside osv.) opprettes, oppdateres eller slettes.
- **Visuelt lerret**: dra noder fra en komponentpalett, koble utgangsporter til inngangsporter.
- **Blandet automatisering**: HTTP-forespørsler, Slack / Discord / Microsoft Teams / Telegram-meldinger, egendefinert JavaScript, JSON-parsing, betingelser, e-post, kall til underarbeidsflyter og CRUD-operasjoner på OneUptime-modeller.
- **Globale variabler**: prosjekt-omfattende hemmeligheter og konfigurasjon som du refererer til fra hvilken som helst arbeidsflyt uten å lime inn på nytt.
- **Kjøringer & logger**: hver kjøring registreres med status, tidtaking og output per trinn.

## Hvorfor bruke arbeidsflyter?

De fleste team griper til arbeidsflyter når de vil:

- **Koble OneUptime til et annet system** — poste en hendelse til PagerDuty, speile et varsel inn i Jira, pinge en webhook i stacken din.
- **Reagere på OneUptime-hendelser** — når en `Sev 1`-hendelse åpnes, ringer vakthavende manager *og* oppretter et Linear-ticket *og* låser et feature flag.
- **Planlegge gjentakende jobber** — hvert femte minutt: spørre en intern API og skrive resultatet inn i et eksternt system.
- **Motta data utenfra OneUptime** — en webhook fra et CI-system starter en kjede av OneUptime-oppdateringer.
- **Gjenbruke små biter med lim-logikk** — én arbeidsflyt kaller en annen, så vanlige mønstre lever ett sted.

## Sentrale begreper

| Begrep | Betydning |
| --- | --- |
| **Arbeidsflyt** | Lerretet. En navngitt, gjenbrukbar graf av triggere og komponenter med et `isEnabled`-flagg. |
| **Trigger** | Noden som starter en arbeidsflyt-kjøring. Manuell, Tidsplan, Webhook eller en modellhendelse. Hver arbeidsflyt har nøyaktig én trigger. |
| **Komponent** | En node som gjør arbeid — et HTTP-kall, en Slack-melding, en JavaScript-snutt, en betingelse osv. |
| **Port** | En inngangs- eller utgangskontakt på en node. Komponenter har utgangsporter som `success` og `error`; du kobler en port til neste nodes inngangsport. |
| **Kjøring / Logg** | Én avvikling av en arbeidsflyt. Inneholder tidsstempel, status (Kjører, Vellykket, Mislyktes, Tidsavbrudd), og fanget output fra hver node som kjørte. |
| **Global variabel** | En navngitt verdi (ofte en hemmelighet eller API-nøkkel) som er definert én gang på prosjektnivå og referert til fra enhver arbeidsflyt som `{{variable.NAME}}`. |
| **Lokal variabel** | En verdi som er begrenset til én enkelt arbeidsflyt-kjøring — typisk returverdien til en tidligere node, referert som `{{ComponentId.portName}}`. |

## Hvor arbeidsflyter bor i dashbordet

| Side | Hva du gjør der |
| --- | --- |
| **Arbeidsflyter** | Bla, opprette og søke i arbeidsflyt-maler. |
| **Builder-fanen på en arbeidsflyt** | Drag-and-drop-lerretet. Legg til noder, koble porter, konfigurer argumenter. |
| **Logger-fanen på en arbeidsflyt** | Hver kjøring av denne arbeidsflyten med filtre for status og tidsperiode. Klikk en kjøring for å se output per node. |
| **Innstillinger-fanen på en arbeidsflyt** | Gi nytt navn, aktivere/deaktivere, endre beskrivelse, administrere etiketter, slette. |
| **Arbeidsflyter → Globale variabler** | Definer prosjekt-omfattende verdier som refereres fra enhver arbeidsflyt. Marker en verdi som hemmelig for å skjule den fra UI-et etter lagring. |
| **Arbeidsflyter → Kjøringer & logger** | Prosjekt-omfattende kjøringshistorikk på tvers av alle arbeidsflyter. |

## Livssyklusen til en arbeidsflyt

1. **Skriv** — Opprett en arbeidsflyt, slipp en trigger på lerretet, dra inn komponentene du trenger, koble dem og konfigurer hver enkelt.
2. **Aktiver** — Arbeidsflyter leveres deaktivert. Slå på bryteren i Innstillinger når du er sikker på at koblingene er riktige.
3. **Trigg** — Manuell: klikk **Kjør manuelt** med valgfri JSON-payload. Tidsplan: cron trigges. Webhook: et eksternt system `POST`-er til arbeidsflyt-URL-en. Modellhendelse: noen (eller en annen arbeidsflyt) oppretter/oppdaterer/sletter en monitor, hendelse, varsel osv.
4. **Kjør** — Arbeidsflyt-workeren går gjennom grafen i rekkefølge. Hver komponent leser argumentene sine (literal-verdier eller interpolerte variabler), gjør jobben sin, skriver returverdien sin og velger en utgangsport. Neste node trigges.
5. **Revider** — Kjøringen dukker opp i **Logger**. Status, total varighet, output per komponent og eventuelle feil beholdes i prosjektets levetid.

## Et gjennomarbeidet eksempel

Mål: når en hendelse opprettes med `Sev 1` i tittelen, post i en Slack-kanal og åpne et ticket i det interne admin-verktøyet ditt.

**1. Opprett en arbeidsflyt** som heter "Sev 1 fan-out."

**2. Slipp en trigger.** Velg **Incident → On Create**-triggeren fra paletten. Triggeren eksponerer den nye hendelsen som returverdi.

**3. Slipp en Conditional-komponent.** Koble triggerens utgangsport til dens inngang. Sett betingelsen: `{{Incident.title}}` *inneholder* `Sev 1`.

**4. Fra Conditionalens `yes`-port, slipp en Slack-komponent.** Kanal: `#incident-room`. Meldingstekst: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Fra samme `yes`-port (parallelt), slipp en API-komponent.** `POST` til `https://admin.internal/incidents`. Body: et lite JSON-objekt bygget fra hendelsen.

**6. Aktiver arbeidsflyten.** Åpne en hendelse med tittel "Sev 1 — checkout 500s" i en annen fane. Innen få sekunder kommer Slack-meldingen, og en ny kjøring dukker opp under **Logger** med hver nodes output fanget.

## Hvordan arbeidsflyter passer inn i resten av OneUptime

- **Monitorer** oppdager problemer; **hendelser/varsler** registrerer dem; **arbeidsflyter** reagerer på dem — poster meldinger, åpner ticket, setter i gang automatisering.
- **Runbooks** er responsprosedyrer for mennesker (med valgfrie skript-trinn). Arbeidsflyter er bakgrunnsautomatisering uten oppsyn. De er komplementære — et runbook-trinn kan `POST`-e til en webhook-trigger på en arbeidsflyt.
- **Workspace-koblinger** (Slack, Microsoft Teams) er typiske destinasjoner for arbeidsflyt-varslinger.
- **Dashbord** er skrivebeskyttede visninger; arbeidsflyter er skrivedelen — de oppdaterer OneUptime-tilstand, kaller eksterne API-er og flytter data rundt.

## Les videre

- [Opprette en arbeidsflyt](/docs/workflows/authoring) — bygge en arbeidsflyt på lerretet, konfigurere noder, koble porter.
- [Triggere](/docs/workflows/triggers) — Manuell, Tidsplan, Webhook og modellhendelse-triggere i detalj.
- [Komponenter](/docs/workflows/components) — katalogen over handlinger og hvordan du konfigurerer hver enkelt.
- [Variabler](/docs/workflows/variables) — globale variabler, lokale variabler og hvordan interpolering fungerer.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — lese kjøringshistorikk, feilsøke feil.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — aktivere/deaktivere, eierskap, etiketter, hemmeligheter, rekursjonsgrenser.
