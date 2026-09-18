# Innstillinger og automatisering

Hendelseskonfigurasjon ligger ikke i prosjektinnstillingene. Den ligger inne i selve hendelsesområdet, under **Hendelser → Innstillinger** og **Hendelser → Regler**, på ruter som begynner med `/dashboard/{projectId}/incidents/settings/`. Har du lett gjennom **Prosjektinnstillinger** etter hendelsesmaler eller egendefinerte felt, er det derfor du ikke fant dem.

Både **Regler**- og **Innstillinger**-seksjonene i sidemenyen for Hendelser er sammenslått som standard, så du må utvide dem før elementene nedenfor dukker opp. Alt her er avgrenset til prosjektet: maler, roller, egendefinerte felt og regler tilhører ett prosjekt og gjelder for hver eneste hendelse som erklæres i det.

Denne siden er oppslagsverket for den konfigurasjonen — hva hver side inneholder, og hva av det som kjører automatisk i det øyeblikket en hendelse opprettes.

## Hvor hendelsesinnstillingene ligger

Åpne **Hendelser** i venstre navigasjon, og utvid så **Innstillinger** nederst i sidemenyen.

| Side                     | Hva du gjør der                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Hendelsesstatus**      | Legg til, gi nytt navn, endre farge på og omorganiser tilstandene en hendelse beveger seg gjennom.      |
| **Hendelsesalvor**       | Legg til, gi nytt navn, endre farge på og omorganiser alvorlighetsgradene.                             |
| **Hendelsesmaler**       | Fyll ut en hel hendelse på forhånd — tittel, beskrivelse, ressurser, vaktpolicyer, eiere, etiketter.    |
| **Notatmaler**           | Gjenbrukbar tekst til offentlige og private notater.                                                   |
| **Postmortem-maler**     | Gjenbrukbare strukturer for etteranalyser.                                                             |
| **Egendefinerte felt**   | Definer ekstra felt som vises på hver hendelse.                                                        |
| **Hendelsesroller**      | Definer rollene du tildeler respondenter, som Incident Commander.                                      |
| **Flere innstillinger**  | Nummerprefiksene for hendelser og hendelsesepisoder.                                                   |

**Hendelsesstatus** og **Hendelsesalvor** er dekket i dybden i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — resten av denne siden tar over fra **Hendelsesmaler**.

Utvider du **Regler**, får du åtte sider til: **Grupperingsregler**, **Vaktregler**, **Eierregler**, **Runbook-regler**, **Personvernregler**, **Etikettregler**, **SLA-regler** og **Reminder Rules**. Dem tar vi lenger ned.

## Hendelsesmaler

En hendelsesmal er et lagret skjelett av en hendelse. I stedet for å skrive inn den samme tittelen, den samme overvåkingslisten og den samme vaktpolicyen hver gang betalingsklyngen vakler, lagrer du det én gang og erklærer ut fra det.

Gå til **Hendelser → Innstillinger → Hendelsesmaler** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet heter **Hendelsesmaler**. Å opprette en tar deg gjennom en veiviser i seks trinn:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**. Disse navngir selve malen; de vises aldri på hendelsen.
- **Hendelsesdetaljer** — **Tittel**, **Beskrivelse** (Markdown), **Hendelsesalvor** og **Innledende hendelsestilstand**. **Innledende hendelsestilstand** er valgfritt og starter tomt; alternativene er listet i tilstandsrekkefølge. Lar du det stå tomt, havner hendelser fra denne malen i prosjektets opprettet-tilstand.
- **Berørte ressurser** — overvåkingene, vertene, klyngene og tjenestene hendelsen skal knyttes til, pluss **Endre overvåkingsstatus til**.
- **Vakt** — **Vaktpolicy**, altså policyene som skal kjøres når en hendelse fra denne malen erklæres.
- **Eiere** — **Eier - Team** og **Eier - Brukere**.
- **Etiketter** — **Etiketter**.

Noen raske regler:

- Mallisten viser bare **Navn** og **Beskrivelse**. Radene kan verken redigeres eller slettes fra listen — åpne en mal (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) for å endre den.
- Maler kan importeres og eksporteres som JSON, så du kan flytte én mellom prosjekter.
- Tomtilstanden leser «Ingen hendelsesmaler funnet.»

### Slik brukes en mal

Det finnes to veier, og de oppfører seg likt.

- **Fra dashbordet** — knappen **Opprett fra mal** i hendelseslisten åpner velgeren **Velg hendelsesmal**, og erklæringssiden leser malen fra spørrestrengparameteren `incidentTemplateId` og fyller så ut skjemaet med malen sammen med eierteamene og eierbrukerne dens.
- **Fra API-et** — send med `createdIncidentTemplateId` på `POST /api/incident`, så fyller serveren hendelsen fra malen.

Det viktige er sammenslåingsregelen: **en mal fyller bare felt du lot være udefinert**. Tittel, beskrivelse, hendelsesalvor, innledende hendelsestilstand, overvåkingsstatusen bak **Endre overvåkingsstatus til**, overvåkinger, verter, Kubernetes-klynger, Docker-verter, Podman-verter, tjenester, vaktpolicyer og etiketter kopieres fra malen kun når kalleren eller skjemaet ikke oppga noe. Alt du setter eksplisitt, vinner alltid.

**Dialogen for tomtilstanden peker på feil sted.** Har du ingen maler ennå, viser knappen **Opprett fra mal** en dialog som heter **No Incident Templates**. Teksten peker på prosjektinnstillingene, men knappen ruter til **Hendelser → Innstillinger → Hendelsesmaler** — og det er den ekte plasseringen.

## Notatmaler

Notatmaler gir respondentene ferdigskrevet tekst til hendelsesoppdateringer, slik at en statussideoppdatering klokken tre om natten ikke skrives fra bunnen av noen som er halvveis våken.

Gå til **Hendelser → Innstillinger → Notatmaler** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet heter **Public or Private Note Templates for Incidents** — ett bibliotek betjener begge notattypene. Opprettelsesskjemaet har to trinn:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**, begge påkrevd.
- **Notatdetaljer** — selve notatteksten, i Markdown, påkrevd.

Som med hendelsesmaler opprettes og vises radene i stedet for å redigeres direkte i listen; åpne en mal for å endre den.

Notatmaler dukker opp der du faktisk trenger dem: bekreftelsesdialogene **Acknowledge Incident** og **Resolve Incident** tilbyr begge **Velg notatmal** ved siden av feltet **Offentlig notat**. Se [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) for hvordan offentlige og private notater skiller seg fra hverandre.

## Postmortem-maler

En postmortem-mal er skjelettet til rapporten du skriver etter en hendelse — overskriftene dine, spørsmålene dine, de faste punktene dine — slik at hver gjennomgang i prosjektet følger samme form.

Gå til **Hendelser → Innstillinger → Postmortem-maler** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet heter **Postmortem-maler**. Opprettelsesskjemaet har to trinn:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**, begge påkrevd.
- **Detaljer om etteranalyse** — **Mal for etteranalyse**, altså selve teksten, i Markdown, påkrevd.

Du tar en mal i bruk fra hendelsen, ikke fra innstillingene. Åpne en hendelse, velg **Etteranalyse** i sidemenyen dens (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), og bruk **Bruk mal**. Det åpner dialogen **Bruk obduksjonsmal** med en nedtrekksliste **Velg mal**; velger du én, lastes maltekst inn i redigeringsfeltet **Notat om etteranalyse**, der du redigerer den før du lagrer. Hendelsesepisoder har den samme **Etteranalyse**-siden og henter fra det samme malbiblioteket.

## Egendefinerte felt

Egendefinerte felt lar deg bære dine egne metadata på hver hendelse — et internt tjenestenavn, en referanse til en endringssak, et kundenivå.

Gå til **Hendelser → Innstillinger → Egendefinerte felt** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Siden heter **Egendefinerte hendelsesfelt**. Hver definisjon har:

- **Feltnavn** — påkrevd, minst to tegn. Plassholderen foreslår et slug-aktig navn som `internal-service`.
- **Feltbeskrivelse** — valgfritt.
- **Felttype** — påkrevd. Den bestemmer hvordan data legges inn. Nedtrekkstyper trenger også at alternativene listes opp.
- **Nedtrekksalternativer** — verdiene som vises i nedtrekkslisten, hver med en valgfri farge.

Definisjonene bor i sin egen modell; verdiene bor på selve hendelsen i kolonnen `customFields`. På en enkelt hendelse fyller du dem ut fra **Egendefinerte felt** i hendelsens sidemeny (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Ett hull verdt å kjenne til.** Definisjoner av egendefinerte hendelsesfelt er den eneste delen av hendelsesfamilien uten arbeidsflyt-triggere — se arbeidsflytdelen nedenfor.

## Hendelsesroller

Hendelsesroller er de navngitte jobbene du tildeler folk under en respons. Definer dem under **Hendelser → Innstillinger → Hendelsesroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortbeskrivelsen bruker Incident Commander og Responder som eksempler.

Roller er kun definisjoner. Du tildeler folk til dem per hendelse — erklæringsveiviseren har et trinn **Hendelsesroller** med feltet **Tildel hendelsesroller**, og hver hendelse har en side **Roller** i sidemenyen sin.

## Nummerprefikser

Hver hendelse får et nummer. Som standard vises det som `#42`. Sier teamet ditt «INC-42» høyt, la produktet si det samme.

Gå til **Hendelser → Innstillinger → Flere innstillinger** (`/dashboard/{projectId}/incidents/settings/more`). Kortet heter **Tallprefiks** og rommer to felt på prosjektet:

- **Nummerprefiks for hendelse** — opptil 20 tegn, plassholder `INC-`. Sett det, og hendelse `#42` vises som `INC-42`.
- **Nummerprefiks for hendelsesepisode** — samme idé for nummer på hendelsesepisoder, plassholder `IE-`.

La ett av dem stå tomt for å beholde standardprefikset `#`; feltet som ikke er satt, vises som `# (default)`. Lagre med **Oppdater**. Verdien med prefiks lagres på hendelsen som `incidentNumberWithPrefix`, og det er den hendelseslisten og hendelsestoppen viser.

## Regler som kjører når en hendelse opprettes

**Hendelser → Regler** rommer åtte regelmotorer. De gjør alle den samme jobben — se på en hendelse i det øyeblikket den opprettes, og handle hvis den treffer — men de skiller seg i hva de gjør og i hvordan flere treffende regler løses opp.

- **Grupperingsregler** — grupper beslektede hendelser i episoder. Reglene evalueres i prioritert rekkefølge; lavere prioritetstall går først.
- **Vaktregler** — kjør vaktpolicyer for hendelser som treffer. Dekket i detalj nedenfor.
- **Eierregler** — tildel eiere automatisk.
- **Runbook-regler** — start en [runbook](/docs/runbooks/index) når en hendelse treffer.
- **Personvernregler** — avgjør om en hendelse som treffer, er privat.
- **Etikettregler** — sett på etiketter automatisk.
- **SLA-regler** — spor tid til respons og tid til løsning. Reglene evalueres i rekkefølge; lavere rekkefølgetall går først.
- **Reminder Rules** — påminn hendelseseierne med jevne mellomrom så lenge en hendelse fortsatt er åpen. Reglene evalueres i rekkefølge, og den første som treffer, vinner.

**Rekkefølgesemantikken er ikke lik overalt.** **Grupperingsregler**, **SLA-regler** og **Reminder Rules** evalueres i rekkefølge. **Vaktregler** gjør det ikke — hver regel som treffer, utløses. Ikke gå ut fra at én modell gjelder for alle åtte.

Sidene **Vaktregler**, **Eierregler**, **Etikettregler** og **Personvernregler** har faner — en fane **Incident Rules** og en fane **Episode Rules**, hver med sin egen tabell. Konfigurer fanen **Incident Rules** med mindre du spesifikt mener episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** og **Reminder Rules** er enkle tabeller.

## Vaktregler for hendelser

**Hendelser → Regler → Vaktregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) er der du gjør tilkalling automatisk. Kortet, **Hendelsesvaktregler**, beskriver regler som automatisk kjører vaktpolicyer når hendelser som treffer, opprettes. Siden har to faner: **Incident Rules** og **Episode Rules**.

Opprettelsesskjemaet har tre trinn:

- **Grunnleggende informasjon** — **Navn** (plassholderen foreslår noe som å tilkalle databaseteamet ved enhver DB-hendelse), **Beskrivelse** og en bryter **Aktivert**. Listen viser en grønn **Aktivert**- eller rød **Deaktivert**-pille per regel.
- **Treffkriterier** — **Monitorer**, **Hendelse Alvorligheter**, **Hendelsesetiketter**, **Overvåkingsetiketter**, pluss felt for regulære uttrykk uten skille på store og små bokstaver for hendelsestittel, hendelsesbeskrivelse, overvåkingsnavn og overvåkingsbeskrivelse.
- **Vaktretningslinjer** — policyene denne regelen kjører.

### Hvordan treff løses opp

Reglene som siden selv leveres med, er verdt å ha under huden:

- En regel treffer bare når **alle** kriteriene du fylte ut, går gjennom. Kriterier du lot stå tomme, hoppes over — de teller ikke som bom.
- Innenfor ett enkelt listekriterium — **Monitorer**, **Hendelse Alvorligheter**, **Hendelsesetiketter**, **Overvåkingsetiketter** — er treff «minst én av».
- Mønsterfeltene er regulære uttrykk uten skille på store og små bokstaver.
- **Alle regler som treffer, utløses.** Det finnes ingen prioritet og ingen kortslutning.
- Settet med policyer som faktisk kjøres, er unionen av policyene til hver regel som treffer, pluss eventuelle policyer som er knyttet til hendelsen manuelt eller av en mal, avduplisert slik at hver policy kjører høyst én gang.

Alvorlighetsgrad er et treffkriterium her og ingen andre steder. Det finnes ikke noe vaktfelt på en hendelsesalvorlighetsgrad — å velge «Kritisk hendelse» tilkaller ikke noen i seg selv. Vil du at alvorlighetsgrad skal styre tilkalling, skriv en vaktregel som treffer på den.

## Å knytte vaktpolicyer til direkte

Regler er ikke eneste vei. Hver hendelse bærer sin egen liste over vaktpolicyer, som vises som feltet **Vaktpolicy** på trinnet **Vakt** i erklæringsveiviseren og på trinnet **Vakt** i en hendelsesmal. Feltbeskrivelsen sier det rett ut: dette er vaktpolicyene som skal kjøres når denne hendelsen opprettes.

Når en hendelse opprettes, kjører OneUptime etikettregler, så vaktregler (som slår policyene sine sammen inn i hendelsens liste), så runbook-regler — og er den resulterende listen ikke tom, kjøres hver policy i den. Kjøringene går parallelt og gjøres opp uavhengig av hverandre, så én policy som feiler, stopper ikke de andre. Hver kjøring merkes med hendelsen som utløste den og med varslingshendelsestypen for opprettet hendelse.

For å se hva som skjedde, åpne hendelsen og velg **Vaktutførelser** i sidemenyen dens (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Å styre hendelser fra arbeidsflyter

Arbeidsflyt-triggere for hendelser er ikke håndskrevne — OneUptime genererer dem fra datamodellene, så hver modell i hendelsesfamilien får komponentene **On Create X**, **On Update X** og **On Delete X**, navngitt etter modellens entallsnavn. De tre viktigste er **On Create Incident**, **On Update Incident** og **On Delete Incident**, og du finner dem under kategorien **Incident** i panelet **Legg til komponent** på `/dashboard/{projectId}/workflows`.

Den samme genereringen gir deg triggere for selve konfigurasjonen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** og flere. Hver modell får også tilsvarende handlingskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** og flerradsvariantene deres — så en trigger og en handling med like navn ligger side om side i samme kategori. **On Create Incident** starter en arbeidsflyt; **Create One Incident** oppretter en hendelse.

Noen detaljer som betyr noe når du kobler dette sammen:

- **On Update X** tar et valgfritt argument **Listen on** som snevrer triggeren inn til oppdateringer som berører bestemte felt. La det stå tomt for å utløses ved enhver endring. Kommer en oppdatering uten oversikt over hvilke felt som endret seg, hoppes filteret over og arbeidsflyten kjører likevel.
- **On Create X** og **On Update X** tar begge et påkrevd argument **Select Fields**; **On Delete X** tar ingen argumenter.
- Alle tre eksponerer én enkelt **Success**-utport, og hver av dem tar imot et ID-argument så du kan kjøre arbeidsflyten manuelt mot én post.
- Navnene kommer fra modellens entallsnavn, ikke fra tabellnavnet — det er derfor du ser **On Create Incident Team Owner** og **On Create Incident User Owner** i stedet for tabellformede navn.
- Det finnes ingen triggere for definisjoner av egendefinerte hendelsesfelt. Den modellen er det ene medlemmet av hendelsesfamilien med arbeidsflyter slått av.

For å bygge resten av arbeidsflyten, se [Opprette en arbeidsflyt](/docs/workflows/authoring) og [Arbeidsflyt-variabler](/docs/workflows/variables).

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesfunksjonen henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — erklæringsveiviseren, malene og API-et.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — innstillingssidene for tilstand og alvorlighetsgrad, og hva flaggene gjør.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — der notatmalene faktisk brukes.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som hører om en hendelse utenfor teamet ditt.
- [Oversikt over arbeidsflyter](/docs/workflows/index) — automatisering oppå hendelsestriggere.
- [Runbooks – Oversikt](/docs/runbooks/index) — prosedyrene runbook-regler knytter til.
