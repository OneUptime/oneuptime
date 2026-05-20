# Konfigurasjon & sikkerhet

Denne siden samler innstillingene og sikkerhetsgrensene det er verdt å kjenne til før du peker en arbeidsflyt mot produksjonstrafikk.

## Aktiver / deaktiver

Hver arbeidsflyt har et **isEnabled**-flagg i **Innstillinger**. Deaktiverte arbeidsflyter trigger aldri — modellhendelser, webhooks og planlagte kjøringer ignoreres. Nye arbeidsflyter leveres deaktivert.

Behandle dette som din "klar for prod"-bryter:

1. Bygg arbeidsflyten.
2. Klikk **Kjør manuelt** med en representativ payload.
3. Sjekk **Logger** — bekreft at hver node tok porten du forventet.
4. Slå på **isEnabled**.

Å deaktivere en arbeidsflyt påvirker ikke kjøringer som allerede er i gang; det stopper bare at nye blir opprettet.

## Eierskap og etiketter

- **Eiere** — brukere og team listet som eiere får rettighetsbasert tilgang og (valgfritt) varslinger når arbeidsflyten feiler. Konfigurer under **Innstillinger → Eiere**.
- **Etiketter** — mange-til-mange-tags for å organisere arbeidsflyter. Filtrer arbeidsflyt-listen etter etikett. Nyttig når et prosjekt har dusinvis av arbeidsflyter organisert etter team, integrasjon eller miljø.
- **Etikettregler** — under **Arbeidsflyter → Innstillinger → Etikettregler**, auto-tildel etiketter til nye arbeidsflyter basert på regex-treff i navn eller beskrivelse.
- **Eier-regler** — under **Arbeidsflyter → Innstillinger → Eier-regler**, auto-tildel eiere til nye arbeidsflyter.

## Hemmeligheter

Globale variabler kan merkes som **hemmelige**. Verdien krypteres i hvile, er skrive-bare i UI-et etter lagring, og redigeres ut av kjøringslogger (erstattes med `[REDACTED]`).

Bruk hemmelige variabler til:

- API-nøkler for utgående integrasjoner.
- Bearer-tokens.
- Webhook-signeringsnøkler.
- Enhver verdi en angriper med lesetilgang til en arbeidsflyt ikke burde se.

Ikke lim inn en hemmelighet direkte i en komponents argument — referanser som `Authorization: Bearer eyJh...` dukker opp i arbeidsflyt-JSON-en og i kjøringsloggene i klartekst. Referer `{{variable.MY_SECRET}}` i stedet.

## Kjørings-tidsavbrudd

Hver kjøring har en maksimal varighet. Hvis en kjøring ikke er ferdig innen tidsavbruddet, merkes den `Timeout` og enhver komponent som er i gang avbrytes. Standarden er romslig (minutter, ikke sekunder) — se workerens miljøkonfigurasjon for nøyaktig verdi i din installasjon.

De fleste komponenter har sine egne per-kall-tidsavbrudd inne i kjørings-tidsavbruddet — f.eks. vil API-komponenten gi opp en hengt utgående forespørsel godt før hele kjøringen gjør det.

## Rekursjonsgrense

**Execute Workflow**-komponenten lar én arbeidsflyt kalle en annen. For å forhindre løpske løkker der A kaller B kaller A i det uendelige, sporer workeren kallkjeden og stopper en kjede som overskrider en fast dybde (typisk et lite tall som 5). Den avsluttende kjøringen merkes `Error` med en tydelig melding om rekursjonsgrensen.

Hvis du har et legitimt behov for en lang kjede (f.eks. en rekursiv mappevandring som behandler ett nivå per kjøring), refaktorer den til én enkelt arbeidsflyt som itererer internt via **Custom Code** — det mønsteret er ikke underlagt kjedegrensen.

## Webhook-sikkerhet

Webhook-triggere eksponerer en unik HTTPS-URL. Alle som lærer URL-en kan treffe den. For å forsvare seg mot utilsiktede eller fiendtlige kallere:

- Behandle URL-en som en delt hemmelighet. Ikke lim den inn i offentlig chat eller commit den til et offentlig repo.
- For arbeidsflyter av høy verdi, be det kallende systemet inkludere en delt hemmelighet som en header (f.eks. `X-Webhook-Token`) og valider den i en **Conditions**-node før du gjør noe destruktivt. Definer det forventede tokenet som en hemmelig global variabel.
- For arbeidsflyter av svært høy verdi, foretrekk en modellhendelse-trigger og et manuelt import-trinn fremfor en offentlig webhook.

## Utgående nettverks-egress

API- og andre HTTP-stil-komponenter sender forespørsler fra OneUptimes arbeidsflyt-workers nettverk. Hvis du self-hoster OneUptime, er workerens utgående nettverk ditt ansvar — sørg for at den kan nå tredjeparts-API-ene du kaller. Hvis du bruker OneUptime Cloud, er IP-egress-intervallet vårt publisert i [IP-adresser](/docs/configuration/ip-addresses) slik at du kan tillate det på mottakersiden.

## Tillatelser

Arbeidsflyter er førsteklasses ressurser underlagt prosjektnivå-rollebasert tilgangskontroll:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — de fire CRUD-tillatelsene på arbeidsflyt-maler.
- `RunWorkflow` — nødvendig for å klikke **Kjør manuelt** eller dispatche en arbeidsflyt via API.
- `ReadWorkflowLog` — nødvendig for å se siden **Kjøringer & logger**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — kontroll over listen over globale variabler.

De fleste ingeniører bør ha create/edit/read på arbeidsflyter, men ikke på variabler. Reserver variabel-redigeringstilgang for personene som administrerer prosjektets hemmeligheter.

## Kvoter

OneUptime Cloud begrenser antall kjøringer per måned per prosjekt på mindre planer. Grensen vises på **Project Settings → Billing**. Når du treffer den, avvises nye triggere (og registreres med en "quota exceeded"-årsak på den berørte arbeidsflyten) til neste faktureringssyklus. Self-hosted-installasjoner er ikke underlagt en kvote.

## Hva arbeidsflyter *ikke* er gode på

Noen mønstre der du bør gripe til et annet verktøy:

- **Langvarig beregning** — arbeidsflyter er orientert rundt lim mellom systemer, ikke knusing av store datasett. Kjør tungt arbeid i din egen infrastruktur og bruk en arbeidsflyt til å sette det i gang.
- **Stateful arbeidsflyter som spenner over minutter/timer** — en enkelt kjøring er ment å bli ferdig raskt. Hvis du trenger "gjør A, vent to timer, gjør B," modeller ventetiden som en ekstern planlegger som poster tilbake til en webhook-trigger.
- **Trinn-for-trinn hendelsesrespons med menneskelige sjekkpunkter** — det er hva [Runbooks](/docs/runbooks/index) er til. Bruk en arbeidsflyt hvis det ikke er noe menneske i sløyfen; bruk et runbook hvis det er det.

## Les videre

- [Oversikt over arbeidsflyter](/docs/workflows/index) — det konseptuelle kartet.
- [Komponenter](/docs/workflows/components) — argument-detaljer for hver handling.
- [Runbooks](/docs/runbooks/index) — når du skal bruke et runbook i stedet.
