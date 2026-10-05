# Opprette en hendelse

Å erklære en hendelse er øyeblikket der OneUptime begynner å føre regnskap. En post opprettes, et nummer stemples på den, vaktpolicyer utløses, og — med mindre du sier noe annet — får abonnentene på statussiden din vite om det. Alt annet i hendelseslivssyklusen henger på den første skrivingen.

Det finnes fire måter en hendelse kommer inn i OneUptime på, og de ender alle på samme sted: en rad i tabellen `Incident` med en alvorlighetsgrad, en gjeldende tilstand og en liste over berørte ressurser. Det eneste som skiller dem, er hvem som fyller ut feltene — du klokken tre om natten, en lagret mal, kriteriene til en overvåking, eller din egen kode som kaller API-et.

Denne siden går gjennom alle fire, felt for felt, og dekker deretter hva serveren fyller inn for deg og hva som utløses i det øyeblikket hendelsen finnes.

## Fire måter en hendelse blir erklært på

| Hvis du vil …                                                       | Velg                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Åpne en hendelse for hånd og fylle ut alt selv                      | Veiviseren **Erklær hendelse**                                              |
| Åpne en tilbakevendende type hendelse med feltene ferdig utfylt     | **Opprett fra mal**                                                         |
| Åpne én automatisk når sjekkene til en overvåking svikter           | Et overvåkingskriteriefilter med **Når filtre samsvarer, erklær en hendelse.** |
| Åpne én fra din egen kode, et skript eller et annet verktøy         | `POST /api/incident`                                                        |

Alle fire skriver til den samme modellen, så en hendelse åpnet av en sonde ser nøyaktig ut som en åpnet for hånd av en som responderer — bortsett fra noen få regnskapskolonner serveren setter på de automatiske.

## Å erklære én for hånd

Åpne **Hendelser → Alle hendelser**, og klikk på **Erklær hendelse** øverst til høyre i listen **Hendelser**. Da kommer du til et kort med tittelen **Erklær ny hendelse**, som fordeler skjemaet over tre trinn: **Hendelsesdetaljer**, **Berørte ressurser** og **Vakt og roller**, og deretter et sammendrag å gå gjennom. Når prosjektet ditt spør etter noen av sine egendefinerte hendelsesfelt ved opprettelse, kommer et fjerde trinn, **Detaljer**, rett etter **Berørte ressurser**.

Bare det første trinnet har obligatoriske felt, i tillegg til alle egendefinerte felt administratorene har merket som **Påkrevd ved opprettelse**. Du kan også knytte til ressurser, legge til vaktpolicyer og tildele roller etterpå, fra hendelsens egne sider. Hvert trinn før sammendraget har en vanlig **Neste**, og **Erklær hendelse** ligger i sammendraget, det siste trinnet.

**Flere felt.** Innstillingene de fleste hendelser aldri trenger, venter sammenfoldet under overskriften **Flere felt** på slutten av trinnet sitt; klikk på den for å åpne dem. Sammenfoldet nevner overskriften hva den inneholder, og viser hver innstilling som er satt, med verdien — satt av en mal, for eksempel — og den åpner seg selv når noe i den må rettes. Sammendraget viser bare en sammenfoldet innstilling når den er satt, unntatt **Varsle statussideabonnenter**, som det alltid viser, med hvem som blir varslet.

### Trinn 1 — Hendelsesdetaljer

- **Tittel** — påkrevd. Sammendraget på én linje som alle ser i listen, i Slack og, hvis hendelsen er synlig, på statussiden din.
- **Hendelsesalvor** — påkrevd. En av alvorlighetsgradene som er konfigurert for prosjektet ditt.
- **Beskrivelse** — valgfri, skrevet i Markdown. Det er dette statussiden viser, så skriv den for kundene og ikke for teamet ditt.

Under **Flere felt**:

- **Erklært den** — starter i det øyeblikket du åpnet siden. All varighet på hendelsen måles herfra; tilbakedater den for å registrere en hendelse som begynte tidligere.
- **Innledende tilstand** — valgfri, og tom til å begynne med. Står den tom, starter hendelsen i tilstanden med flagget `isCreatedState`, eller i malens innledende tilstand. Velg bare en senere tilstand for å registrere en hendelse som allerede er kvittert eller løst.
- **Etiketter** — valgfri. Etiketter samler relaterte hendelser, og et team som er begrenset til etiketter, ser bare hendelsene som bærer en av etikettene deres.
- **Privat hendelse** — av som standard (`isPrivate`). En privat hendelse er bare synlig for eierne sine, prosjektadministratorer og prosjekteiere, og er skjult på alle statussider.

**Hvis nedtrekkslisten for tilstand lager trøbbel.** Hvis prosjektet ditt ikke har noen tilstand som bærer flagget `isCreatedState`, feiler opprettelseskallet og ber deg legge til en opprettet hendelsestilstand fra innstillingene. Det skjer normalt bare i et prosjekt der tilstandene er redigert kraftig — se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

### Trinn 2 — Berørte ressurser

Monitorene kommer først, for seg selv: statussider ser en hendelse gjennom monitorene dens, og statusen monitorene endres til, står rett under dem.

- **Monitorer** — et søkefelt som knytter til monitorene hendelsen påvirker (`monitors`). En statusside viser hendelsen, og varsler abonnentene sine, når den viser en av disse monitorene.
- **Endre overvåkingsstatus til** — valgfri, og vises først når minst én monitor er valgt. Setter hver monitor i hendelsen til en overvåkingsstatus, slik at det å erklære hendelsen og merke monitorene som redusert er én handling. En mals status vises så snart du velger en monitor; uten valgt monitor lagres ingen status.
- **Andre berørte ressurser** — et andre søkefelt for alt annet hendelsen påvirker: verter, Kubernetes-klynger, Docker- og Podman-verter, Proxmox-, Ceph- og Docker Swarm-klynger, vCentre, IoT-flåter, databaser og tjenester. Det er separate relasjoner på hendelsen (`hosts`, `kubernetesClusters`, `services` med flere).

Hendelsens kort **Berørte ressurser** spør på samme måte når du redigerer det senere.

Under **Flere felt**:

- **Begrens til disse statussidene** — valgfri. Står den tom, vises hendelsen på alle statussider som viser monitorene dens, og varsler abonnentene deres; med valgte sider bare på dem blant dem. Se [Én statusside per målgruppe](/docs/status-pages/one-status-page-per-audience).
- **Varsle statussideabonnenter** — avkrysningsboks, på som standard (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Under den, og igjen i sammendraget, viser skjemaet hvilke statussider som blir varslet og hvor mange abonnenter hver har; i sammendraget viser **Forhåndsvis varsel** e-posten de får. Slå den av for intern støy du likevel vil ha registrert.

**Knytt til overvåkinger selv når det føles overflødig.** Koblingen mellom en hendelse og en statusside går gjennom hendelsens overvåkinger: en statusside viser en hendelse når en av sidens ressurser er en av hendelsens overvåkinger. Et varsel til abonnenter om en tilstandsendring hoppes rett og slett over når hendelsen ikke har noen overvåkinger knyttet til seg. Se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).

### Trinn 3 — Vakt og roller

- **Vaktpolicy** — et flervalg av vaktpolicyene som kjøres når denne hendelsen opprettes (`onCallDutyPolicies`).
- **Tildel hendelsesroller** — hvem som tar hver rolle prosjektet ditt definerer. En rolle merket **Primær** som du lar stå tom, er din: du tar den når hendelsen erklæres.

Dette er det eneste stedet en vaktpolicy knyttes direkte til en hendelse. Alvorlighetsgrader bærer ingen vaktpolicy — alvorlighetsgrad er en etikett, og den påvirker tilkalling bare som *treffkriterium* inne i en vaktregel. Regler satt opp på **Hendelser → Regler → Vaktregler** legger sine policyer oppå det du velger her; settet som til slutt kjøres, er unionen av begge, uten duplikater.

Selve rollene konfigureres under **Hendelser → Innstillinger → Hendelsesroller**. Et nytt prosjekt har én, Incident Commander; legg til der det prosessen din ellers trenger.

Flagget **Should be visible on status page?** (`isVisibleOnStatusPage`) finnes ikke i veiviseren; det er sant som standard. Endre det etterpå fra **Innstillinger** i hendelsens sidemeny, der det heter **Synlig på statussiden**.

## Å erklære fra en mal

Hvis du stadig erklærer den samme typen hendelse — samme tittelmønster, samme alvorlighetsgrad, samme vaktpolicy — lagrer du den én gang som en mal.

Klikk **Opprett fra mal** (omrissknappen ved siden av **Erklær hendelse**), så åpnes dialogen **Opprett hendelse fra mal** med en nedtrekksliste **Velg hendelsesmal**. Velg en mal, så åpnes opprettelsesskjemaet ferdig utfylt; du kan fortsatt endre hva som helst før du sender inn. Har prosjektet ditt ingen maler ennå, får du i stedet dialogen **No Incident Templates**, med en knapp **Create Template** som tar deg til **Hendelser → Innstillinger → Hendelsesmaler**.

Maler bygges med sin egen veiviser — **Malinformasjon**, **Hendelsesdetaljer**, **Berørte ressurser**, **Vakt** — pluss trinn for egendefinerte felt når prosjektet ditt har slike. Eiere og etiketter ligger under **Flere felt** på slutten av **Hendelsesdetaljer**. **Berørte ressurser** spør som erklæringsskjemaet — **Monitorer**, så **Endre overvåkingsstatus til**, så **Andre berørte ressurser**, med **Begrens til disse statussidene** under **Flere felt** — bortsett fra at en mal alltid spør etter overvåkingsstatus: den gjelder også monitorene som velges når en hendelse erklæres fra malen. Dette er feltene:

| Felt                             | Formål                                                 |
| -------------------------------- | ------------------------------------------------------ |
| **Malnavn**                      | Hvordan malen identifiseres i velgeren.                |
| **Malbeskrivelse**               | Et notat til deg selv om når du bør gripe etter den.   |
| **Tittel**                       | Tittelen som forhåndsutfylles på hendelsen.            |
| **Beskrivelse**                  | Markdown-beskrivelse som forhåndsutfylles på hendelsen. |
| **Hendelsesalvor**               | Alvorlighetsgrad som forhåndsutfylles på hendelsen.    |
| **Innledende hendelsestilstand** | Tilstanden hendelser fra denne malen starter i.        |
| **Monitorer** | Monitorer som skal knyttes til. |
| **Endre overvåkingsstatus til** | Overvåkingsstatus for hendelsens monitorer, også dem som velges ved erklæringen. |
| **Andre berørte ressurser** | Verter, klynger og tjenester som skal knyttes til. |
| **Begrens til disse statussidene** | Statussider hendelsen er begrenset til. |
| **Vaktpolicy**                   | Policyer som kjøres når hendelsen opprettes.           |
| **Eiere** | Personer og team som eier hendelser opprettet fra denne malen, valgt fra én liste. |
| **Etiketter**                    | Etiketter som settes på hendelsen.                     |

Noen raske regler:

- Maler kan ikke redigeres fra mallisten — du oppretter én, og åpner den så for å endre den.
- En mal fyller bare et felt du lot stå tomt. På opprettelsessiden brukes malen som en forhåndsutfylling du kan overskrive; på API-et fyller serveren et felt fra malen kun når forespørselen lot feltet stå `undefined`. Det den som kaller oppgir, vinner alltid.

## Å erklære automatisk fra overvåkingskriterier

De fleste hendelser bør ikke trenge et menneske som taster dem inn. I kriterieredigereren til en overvåking slår du på bryteren **Når filtre samsvarer, erklær en hendelse.**, og en seksjon **Opprett hendelse** dukker opp med en knapp **Legg til hendelse** — ett kriteriefilter kan erklære mer enn én hendelse.

Hver oppføring har:

- **Hendelsestittel** — støtter maler; plassholderen foreslår noe slikt som `{{monitorName}} is down`.
- **Alvorlighetsgrad** — påkrevd.
- **Hendelsesbeskrivelse** — også med malstøtte.
- **Vakt → Vaktretningslinjer** — policyer som kjøres når denne hendelsen opprettes.
- **Hendelsesroller** — tildel teammedlemmer til roller på forhånd.
- **Eierskap og etiketter → Eierteam**, **Eierbrukere**, **Etiketter**.
- **Flere felt → Løs hendelse automatisk** (løser hendelsen automatisk når kriteriene slutter å slå til), **Vis hendelse på statussiden**, **Privat hendelse** og **Utbedringsnotater**.

For den fullstendige listen over `{{variable}}`-plassholdere du kan bruke i tittel, beskrivelse og utbedringsnotater, se [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating).

Hendelser opprettet på denne måten merkes av serveren: `isCreatedAutomatically` settes, `createdCriteriaId` registrerer hvilket kriteriefilter som utløste, og `createdByProbe` registrerer hvilken sonde som så det. Alt annet ved dem oppfører seg nøyaktig som en hendelse erklært for hånd.

## Å erklære gjennom API-et

Hendelsesmodellen eksponerer et vanlig CRUD-endepunkt, så `POST /api/incident` oppretter én. Autentiser med en API-nøkkel generert på **Prosjektinnstillinger → API-nøkler**, sendt i `apikey`-headeren — nøkkelen identifiserer prosjektet, så du trenger ikke sende en prosjekt-ID i tillegg.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Nyttige felt i forespørselskroppen:

- `title` — det eneste feltet du faktisk må oppgi.
- `declaredAt` — valgfritt her, selv om skjemaet krever det. Utelat det, så bruker serveren tidspunktet nå.
- `incidentSeverityId` og `currentIncidentStateId` — serveren sjekker at begge tilhører det samme prosjektet som API-nøkkelen, og avviser forespørselen hvis de ikke gjør det. Den samme sjekken gjelder overvåkingsstatusen bak **Endre overvåkingsstatus til**.
- `createdIncidentTemplateId` — ta i bruk en lagret mal. Alle felt du utelater, fylles fra malen; alle felt du sender, beholdes som de er.

Beslektede endepunkter er `/api/incident-state`, `/api/incident-severity` og `/api/incident-state-timeline`. Den genererte [API-referansen](/reference) har de eksakte forespørsels- og svarformene for hvert av dem, inkludert hvordan relasjonsfelt som overvåkinger uttrykkes.

## Hendelsesnumre og prefikser

Hver hendelse får et løpenummer fra en teller per prosjekt, tildelt av serveren ved opprettelse. To kolonner holder det: `incidentNumber` (heltallet) og `incidentNumberWithPrefix` (det du faktisk ser). Uten et konfigurert prefiks er visningsverdien `#42`.

For å endre det går du til **Hendelser → Innstillinger → Nummerprefiks** og klikker **Oppdater**. Feltet **Nummerprefiks for hendelse** viser nummeret mens du skriver: `INC-` gir `INC-42`. La det stå tomt for å beholde standarden `#`. Et nytt prefiks gjelder hendelser som erklæres etter at du har lagret; eksisterende hendelser beholder numrene sine. Den samme dialogen har også **Nummerprefiks for hendelsesepisode** for episodenummerering.

Nummeret vises som den første kolonnen i hendelseslisten, lenker til hendelsen, og dukker opp som **Hendelsesnummer** på hendelsens **Oversikt**.

## Hva som skjer i det øyeblikket en hendelse erklæres

Opprettelseskallet gjør mer enn å skrive en rad. I rekkefølge:

1. **Serveren fyller hullene.** `declaredAt` settes til nå, gjeldende tilstand settes til prosjektets `isCreatedState`-tilstand, og hendelsesnummeret og det prefiksede nummeret tildeles fra prosjekttelleren.
2. **En mal tas i bruk**, hvis `createdIncidentTemplateId` ble oppgitt — den fyller bare felt den som kalte lot stå udefinert.
3. **Personvernregler kjører**, og merker hendelsen som privat når en regel som treffer sier det. Dette er den første regelmotoren som kjører, slik at alt etterpå ser den riktige personverninnstillingen.
4. **Eierregler kjører**, og legger til eierbrukerne og -teamene som reglene som treffer navngir.
5. **Etikettregler kjører**, og legger til etikettene som passer hendelsen.
6. **Vaktregler kjører.** Hver aktivert regel på **Hendelser → Regler → Vaktregler** hvis kriterier treffer, legger sine policyer på hendelsen. Det finnes ingen prioritetsrekkefølge og ingen kortslutning — alle regler som treffer utløses, og policyene dedupliseres.
7. **Runbook-regler kjører**, og knytter til og starter runbooks som treffer. Se [Runbooks](/docs/runbooks/index).
8. **Vaktpolicyer kjøres.** Hver policy på hendelsen — valgt i veiviseren, arvet fra en mal, eller lagt til av en regel — kjøres parallelt med hendelsestypen `IncidentCreated`. At én policy feiler, stopper ikke de andre.
9. **Abonnenter køes**, hvis **Varsle statussideabonnenter** ble stående på og hendelsen er synlig på statussiden. Utsendelsen håndteres av en bakgrunnsjobb, ikke inline med forespørselen din.
10. **Arbeidsflyter utløses.** Triggeren **On Create Incident** starter enhver arbeidsflyt som er bygget på den. Se [Oversikt over arbeidsflyter](/docs/workflows/index).

Derfra er hendelsen i live: den teller mot telleren **Aktive hendelser** i sidemenyen for Hendelser (enhver tilstand som ikke er flagget `isResolvedState` teller som aktiv), den vises på statussidene som bærer en av overvåkingene dens, og **Tilstandstidslinje** begynner å registrere.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesmodellen henger sammen.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva tilstandsflaggene gjør, og hvordan du legger til dine egne.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige notater, private notater, eiere og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, roller, regler og arbeidsflyt-triggere.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får høre om hendelsen du nettopp erklærte.
- [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) — variablene som er tilgjengelige for automatisk erklærte hendelser.
