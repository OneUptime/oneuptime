# Opprette en hendelse

Å erklære en hendelse er øyeblikket OneUptime begynner å føre regnskap. En post opprettes, et nummer stemples på den, vaktpolicyer utløses, og — med mindre du sier noe annet — får statussideabonnentene dine høre om det. Alt annet i hendelsens livssyklus henger på den første skrivingen.

Det er fire måter en hendelse kommer inn i OneUptime på, og de ender alle på samme sted: en rad i `Incident`-tabellen med en alvorlighetsgrad, en gjeldende tilstand og en liste over berørte ressurser. Forskjellen er bare hvem som fyller ut feltene — du klokken tre om natten, en lagret mal, kriteriene til en overvåking, eller din egen kode som kaller API-et.

Denne siden går gjennom alle fire, felt for felt, og dekker deretter hva serveren fyller ut for deg og hva som utløses i det øyeblikket hendelsen finnes.

## Fire måter en hendelse blir erklært på

| Hvis du vil …                                                    | Velg                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Åpne en hendelse for hånd, og fylle ut alt selv                  | Veiviseren **Erklær hendelse**                                              |
| Åpne en tilbakevendende type hendelse med feltene forhåndsutfylt | **Opprett fra mal**                                                         |
| Åpne én automatisk når sjekkene til en overvåking feiler         | Et kriteriefilter med **When filters match, declare an incident.**          |
| Åpne én fra din egen kode, et skript eller et annet verktøy      | `POST /api/incident`                                                        |

Alle fire skriver den samme modellen, så en hendelse åpnet av en probe ser nøyaktig ut som en åpnet for hånd av en som responderer — bortsett fra noen få bokføringskolonner serveren setter på de automatiske.

## Å erklære en for hånd

Åpne **Hendelser → Alle hendelser** og klikk **Erklær hendelse** øverst til høyre i listen **Hendelser**. Det tar deg til et kort med tittelen **Erklær ny hendelse**, som fordeler skjemaet over fem trinn: **Hendelsesdetaljer**, **Berørte ressurser**, **Hendelsesroller**, **Vakt** og **Mer**. Send-knappen til slutt heter også **Erklær hendelse**.

Bare det første trinnet har obligatoriske felt. Hvis du har det travelt, fyll ut **Hendelsesdetaljer** og send inn — du kan knytte til ressurser, tildele roller og legge til vaktpolicyer fra hendelsens egne sider etterpå.

### Trinn 1 — Hendelsesdetaljer

- **Tittel** — obligatorisk. Sammendraget på én linje som alle vil se i listen, i Slack, og (hvis hendelsen er synlig) på statussiden din. Plassholder: `Incident Title`.
- **Beskrivelse** — valgfri, skrevet i Markdown. Dette er feltet som vises på statussiden, så skriv det for kunder heller enn for teamet ditt. Du kan redigere det senere fra **Beskrivelse** i hendelsens sidemeny.
- **Erklært den** — obligatorisk i skjemaet, med nå som standard. Dette er tidsstempelet hver varighet på hendelsen måles fra, så tilbakedater det hvis du registrerer noe som startet tidligere.
- **Hendelsesalvor** — obligatorisk. En av alvorlighetsgradene som er konfigurert for prosjektet ditt; nye prosjekter opprettes med **Critical Incident**, **Major Incident** og **Minor Incident**.
- **Hendelsesstatus** — valgfri. La den være, så havner hendelsen i tilstanden som er flagget `isCreatedState`, som nye prosjekter oppretter som **Identified**. Sett den bare når du registrerer en hendelse som allerede var forbi det punktet.

**Hvis tilstandslisten lager trøbbel.** Hvis prosjektet ditt ikke har noen tilstand som bærer flagget `isCreatedState`, feiler opprettelseskallet og ber deg legge til en opprettet hendelsestilstand fra innstillingene. Det skjer normalt bare i et prosjekt der tilstandene har blitt redigert kraftig — se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

### Trinn 2 — Berørte ressurser

- **Berørte ressurser** — et enkelt søkefelt som knytter til overvåkinger, verter, Kubernetes-klynger, Docker-verter, Podman-verter og tjenester. Under panseret er dette separate relasjoner på hendelsen (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` og flere), men skjemaet slår dem sammen til én velger.
- **Endre overvåkingsstatus til** — valgfri. Velger en overvåkingsstatus som settes på hver overvåking knyttet til denne hendelsen, slik at det å erklære hendelsen og merke overvåkingene som forringet blir én handling i stedet for to.

**Knytt til overvåkinger selv når det føles overflødig.** Koblingen mellom en hendelse og en statusside går gjennom hendelsens overvåkinger: en statusside viser en hendelse når en av ressursene dens er en av hendelsens overvåkinger. Et varsel om tilstandsendring til abonnenter hoppes over helt når hendelsen ikke har noen overvåkinger knyttet til seg. Se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).

### Trinn 3 — Hendelsesroller

- **Tildel hendelsesroller** — tildel teammedlemmer til rollene prosjektet ditt definerer. Noen roller tar imot mer enn én bruker.

Selve rollene konfigureres på **Hendelser → Innstillinger → Hendelsesroller**, der du definerer rollene som kan tildeles under responsen — Incident Commander, Responder, og hva enn prosessen din trenger. Hvis du hopper over dette trinnet, tildeles en Incident Commander automatisk ved første tilstandsendring hvis ingen har rollen ennå.

### Trinn 4 — Vakt

- **Vaktpolicy** — et flervalg over vaktpolicyene som skal kjøres når denne hendelsen opprettes. Dette tilordnes `onCallDutyPolicies` på hendelsen.

Dette er det eneste stedet en vaktpolicy knyttes direkte til en hendelse. Alvorlighetsgrader bærer ikke en vaktpolicy — alvorlighetsgrad er en etikett, og den påvirker tilkalling kun som *treffkriterium* inne i en vaktregel. Regler konfigurert på **Hendelser → Regler → Vaktregler** legger sine policyer på toppen av det du velger her; det endelige settet som kjøres er unionen av begge, uten duplikater.

### Trinn 5 — Mer

- **Etiketter** — valgfritt og en avansert funksjon: teammedlemmer med tilgang til disse etikettene er de som får tilgang til hendelsen.
- **Varsle statussideabonnenter** — avkrysningsboks, på som standard. Styrer om abonnenter får e-post om at hendelsen er opprettet (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Slå den av for intern støy du fortsatt vil ha registrert.
- **Privat hendelse** — avkrysningsboks, av som standard (`isPrivate`). En privat hendelse er kun synlig for eierbrukerne, medlemmene av eierteamene, prosjektadministratorer og prosjekteiere — og den er skjult fra hver eneste statusside, uansett andre innstillinger. Hendelseslisten merker disse med en rød **Private**-pille.

Flagget **Should be visible on status page?** (`isVisibleOnStatusPage`) er ikke med i veiviseren; det er som standard sant. Endre det etterpå fra **Innstillinger** i hendelsens sidemeny, der det er merket **Synlig på statussiden**.

## Å erklære fra en mal

Hvis du stadig erklærer den samme typen hendelse — det samme tittelmønsteret, den samme alvorlighetsgraden, den samme vaktpolicyen — lagre den én gang som en mal.

Klikk **Opprett fra mal** (omrissknappen ved siden av **Erklær hendelse**), så åpnes en modal for **Opprett hendelse fra mal**, med en nedtrekksliste **Velg hendelsesmal**. Velg en mal, så åpnes opprettelsesskjemaet forhåndsutfylt; du kan fortsatt endre hva som helst før du sender inn. Hvis prosjektet ditt ikke har noen maler ennå, får du i stedet en modal **No Incident Templates**, med en knapp **Create Template** som tar deg til **Hendelser → Innstillinger → Hendelsesmaler**.

Maler bygges med sin egen seks-trinns veiviser — **Malinformasjon**, **Hendelsesdetaljer**, **Berørte ressurser**, **Vakt**, **Eiere**, **Etiketter** — med disse feltene:

| Felt                                | Formål                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| **Malnavn**                         | Hvordan malen identifiseres i velgeren.                 |
| **Malbeskrivelse**                  | En notis til deg selv om når du bør gripe til den.      |
| **Tittel**                          | Tittelen som forhåndsutfylles på hendelsen.             |
| **Beskrivelse**                     | Markdown-beskrivelse forhåndsutfylt på hendelsen.       |
| **Hendelsesalvor**                  | Alvorlighetsgrad forhåndsutfylt på hendelsen.           |
| **Innledende hendelsestilstand**    | Tilstanden hendelser fra denne malen starter i.         |
| **Berørte ressurser**               | Overvåkinger, verter, klynger og tjenester å knytte til. |
| **Endre overvåkingsstatus til**     | Overvåkingsstatus å sette på de tilknyttede overvåkingene. |
| **Vaktpolicy**                      | Policyer som skal kjøres når hendelsen opprettes.       |
| **Eier - Team**                     | Team som eier hendelser opprettet fra denne malen.      |
| **Eier - Brukere**                  | Brukere som eier hendelser opprettet fra denne malen.   |
| **Etiketter**                       | Etiketter som settes på hendelsen.                      |

Noen raske regler:

- Maler kan ikke redigeres fra mallisten — du oppretter én, og åpner den så for å endre den.
- En mal fyller bare et felt du lot stå tomt. På opprettelsessiden brukes malen som en forhåndsutfylling du kan overskrive; over API-et fyller serveren et felt fra malen kun når forespørselen lot det feltet være `undefined`. Det den som kaller sendte inn, vinner alltid.

## Å erklære automatisk fra overvåkingskriterier

De fleste hendelser bør ikke trenge et menneske til å skrive dem inn. I kriterieredigereren til en overvåking, slå på bryteren **When filters match, declare an incident.** så dukker en seksjon **Opprett hendelse** opp med en knapp **Legg til hendelse** — ett kriteriefilter kan erklære mer enn én hendelse.

Hver oppføring har:

- **Hendelsestittel** — støtter maler; plassholderen foreslår noe som `{{monitorName}} is down`.
- **Alvorlighetsgrad** — obligatorisk.
- **Hendelsesbeskrivelse** — også maldrevet.
- **Vakt → Vaktretningslinjer** — policyer som kjøres når denne hendelsen opprettes.
- **Hendelsesroller** — tildel teammedlemmer til roller på forhånd.
- **Eierskap og etiketter → Eierteam**, **Eierbrukere**, **Etiketter**.
- **Avanserte alternativer → Løs hendelse automatisk** (løser hendelsen automatisk når kriteriene ikke lenger treffer), **Vis hendelse på statussiden**, **Privat hendelse** og **Utbedringsnotater**.

For den fulle listen over `{{variable}}`-plassholdere du kan bruke i tittel, beskrivelse og utbedringsnotater, se [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating).

Hendelser opprettet på denne måten merkes av serveren: `isCreatedAutomatically` settes, `createdCriteriaId` registrerer hvilket kriteriefilter som utløste, og `createdByProbe` registrerer hvilken probe som så det. Alt annet ved dem oppfører seg nøyaktig som en hendelse erklært for hånd.

## Å erklære gjennom API-et

Hendelsesmodellen eksponerer et standard CRUD-endepunkt, så `POST /api/incident` oppretter én. Autentiser med en API-nøkkel generert på **Prosjektinnstillinger → API-nøkler**, sendt i `apikey`-headeren — nøkkelen identifiserer prosjektet, så du trenger ikke å sende med en prosjekt-id separat.

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

- `title` — det eneste feltet du egentlig må oppgi.
- `declaredAt` — valgfritt her, selv om skjemaet krever det. Utelat det, så bruker serveren nåværende tidspunkt.
- `incidentSeverityId` og `currentIncidentStateId` — serveren sjekker at begge tilhører det samme prosjektet som API-nøkkelen, og avviser forespørselen hvis de ikke gjør det. Den samme sjekken gjelder overvåkingsstatusen bak **Endre overvåkingsstatus til**.
- `createdIncidentTemplateId` — bruk en lagret mal. Ethvert felt du utelater fylles fra malen; ethvert felt du sender beholdes som det er.

Beslektede endepunkter er `/api/incident-state`, `/api/incident-severity` og `/api/incident-state-timeline`. Den genererte [API-referansen](/reference) har de eksakte forespørsels- og svarformene for hvert av dem, inkludert hvordan relasjonsfelt som overvåkinger uttrykkes.

## Hendelsesnumre og prefikser

Hver hendelse får et fortløpende nummer fra en teller per prosjekt, tildelt av serveren ved opprettelse. To kolonner holder på det: `incidentNumber` (det rå heltallet) og `incidentNumberWithPrefix` (det du faktisk ser). Uten et prefiks konfigurert er visningsverdien `#42`.

For å endre det, gå til **Hendelser → Innstillinger → Flere innstillinger**. Kortet **Tallprefiks** har et felt **Nummerprefiks for hendelse** (opptil 20 tegn, plassholder `INC-`) — sett det, så vises den samme hendelsen som `INC-42`. La det stå tomt for å beholde standarden `#`. Kortet bærer også **Nummerprefiks for hendelsesepisode** for episodenummerering.

Nummeret vises som første kolonne i hendelseslisten, lenker til hendelsen, og dukker opp som **Hendelsesnummer** på hendelsens **Oversikt**.

## Hva som skjer i det øyeblikket en hendelse erklæres

Opprettelseskallet gjør mer enn å skrive en rad. I rekkefølge:

1. **Serveren fyller hullene.** `declaredAt` settes til nå, gjeldende tilstand settes til prosjektets `isCreatedState`-tilstand, og hendelsesnummeret og det prefiksede nummeret tildeles fra prosjekttelleren.
2. **En mal brukes**, hvis `createdIncidentTemplateId` ble oppgitt — og fyller kun felt den som kalte lot være udefinerte.
3. **Personvernregler kjører**, og merker hendelsen som privat når en treffende regel sier det. Dette er den første regelmotoren som kjører, så alt etter den ser riktig personverninnstilling.
4. **Eierregler kjører**, og legger til eierbrukerne og -teamene som treffende regler navngir.
5. **Etikettregler kjører**, og legger til etiketter som treffer hendelsen.
6. **Vaktregler kjører.** Hver aktiverte regel på **Hendelser → Regler → Vaktregler** hvis kriterier treffer, legger sine policyer til hendelsen. Det finnes ingen prioritetsrekkefølge og ingen kortslutning — alle treffende regler utløses, og policyene dedupliseres.
7. **Runbook-regler kjører**, og knytter til og starter treffende runbooks. Se [Runbooks](/docs/runbooks/index).
8. **Vaktpolicyer kjøres.** Hver policy på hendelsen — valgt i veiviseren, arvet fra en mal, eller lagt til av en regel — kjøres parallelt med hendelsestypen `IncidentCreated`. At én policy feiler stopper ikke de andre.
9. **Abonnenter settes i kø**, hvis **Varsle statussideabonnenter** ble stående på og hendelsen er synlig på statussiden. Levering håndteres av en bakgrunnsjobb, ikke i selve forespørselen din.
10. **Arbeidsflyter utløses.** Triggeren **On Create Incident** starter enhver arbeidsflyt bygget på den. Se [Oversikt over arbeidsflyter](/docs/workflows/index).

Derfra er hendelsen i live: den teller mot telleren **Aktive hendelser** i sidemenyen for Hendelser (enhver tilstand som ikke er flagget `isResolvedState` teller som aktiv), den vises på statussidene som bærer en av overvåkingene dens, og **Tilstandstidslinje** begynner å registrere.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesmodellen henger sammen.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva tilstandsflaggene gjør og hvordan du legger til dine egne.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige notater, private notater, eiere og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, roller, regler og arbeidsflyt-triggere.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får høre om hendelsen du nettopp erklærte.
- [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) — variablene som er tilgjengelige for automatisk erklærte hendelser.
