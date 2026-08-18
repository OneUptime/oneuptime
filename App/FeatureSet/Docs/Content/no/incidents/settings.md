# Innstillinger og automatisering

Hendelseskonfigurasjon bor ikke i Prosjektinnstillinger. Den bor inne i selve hendelsesproduktområdet, under **Hendelser → Innstillinger** og **Hendelser → Regler**, på ruter som begynner med `/dashboard/{projectId}/incidents/settings/`. Hvis du har lett gjennom **Prosjektinnstillinger** etter hendelsesmaler eller egendefinerte felt, er det derfor du ikke fant dem.

Både seksjonen **Regler** og seksjonen **Innstillinger** i sidemenyen for Hendelser er sammenslått som standard, så du må utvide dem før elementene under dukker opp. Alt her er prosjektavgrenset: maler, roller, egendefinerte felt og regler tilhører ett prosjekt og gjelder hver hendelse som erklæres i det.

Denne siden er referansen for den konfigurasjonen — hva hver side rommer, og hva av det som kjører automatisk i det øyeblikket en hendelse opprettes.

## Hvor hendelsesinnstillingene bor

Åpne **Hendelser** i venstre navigasjon, og utvid deretter **Innstillinger** nederst i sidemenyen.

| Side                       | Hva du gjør der                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Hendelsesstatus**        | Legg til, gi nytt navn, endre farge og endre rekkefølge på tilstandene en hendelse beveger seg gjennom. |
| **Hendelsesalvor**         | Legg til, gi nytt navn, endre farge og endre rekkefølge på alvorlighetsgrader.                     |
| **Hendelsesmaler**         | Forhåndsutfyll en hel hendelse — tittel, beskrivelse, ressurser, vaktpolicyer, eiere, etiketter.    |
| **Notatmaler**             | Gjenbrukbar tekst for offentlige og private notater.                                               |
| **Postmortem-maler**       | Gjenbrukbare strukturer for etteranalyser.                                                          |
| **Egendefinerte felt**     | Definer ekstra felt som vises på hver hendelse.                                                    |
| **Hendelsesroller**        | Definer rollene du tildeler de som responderer, som Incident Commander.                            |
| **Flere innstillinger**    | Nummerprefiksene for hendelse og hendelsesepisode.                                                 |

**Hendelsesstatus** og **Hendelsesalvor** dekkes i dybden i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — resten av denne siden tar over fra **Hendelsesmaler**.

Utvid **Regler**, så får du åtte sider til: **Grupperingsregler**, **Vaktregler**, **Eierregler**, **Runbook-regler**, **Personvernregler**, **Etikettregler**, **SLA-regler** og **Reminder Rules**. Disse dekkes lenger ned.

## Hendelsesmaler

En hendelsesmal er et lagret skjelett av en hendelse. I stedet for å skrive inn den samme tittelen, den samme overvåkingslisten og den samme vaktpolicyen hver gang betalingsklyngen vakler, lagrer du det én gang og erklærer fra det.

Gå til **Hendelser → Innstillinger → Hendelsesmaler** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet har tittelen **Hendelsesmaler**. Å opprette én tar deg gjennom en seks-trinns veiviser:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**. Disse navngir selve malen; de vises aldri på hendelsen.
- **Hendelsesdetaljer** — **Tittel**, **Beskrivelse** (Markdown), **Hendelsesalvor** og **Innledende hendelsestilstand**. **Innledende hendelsestilstand** er valgfri og starter tom; alternativene listes i tilstandsrekkefølge. La den stå tom, så havner hendelser fra denne malen i prosjektets opprettede tilstand.
- **Berørte ressurser** — overvåkingene, vertene, klyngene og tjenestene hendelsen skal knyttes til, pluss **Endre overvåkingsstatus til**.
- **Vakt** — **Vaktpolicy**, policyene som skal kjøres når en hendelse opprettet fra denne malen erklæres.
- **Eiere** — **Eier - Team** og **Eier - Brukere**.
- **Etiketter** — **Etiketter**.

Noen raske regler:

- Mallisten viser bare **Navn** og **Beskrivelse**. Rader kan ikke redigeres eller slettes fra listen — åpne en mal (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) for å endre den.
- Maler støtter JSON-import og -eksport, så du kan flytte én mellom prosjekter.
- Tomtilstanden sier «No incident templates found.»

### Hvordan en mal blir tatt i bruk

Det finnes to veier, og de oppfører seg likt.

- **Fra dashbordet** — knappen **Opprett fra mal** i hendelseslisten åpner en velger **Velg hendelsesmal**, og erklæringssiden leser malen fra spørringsstrengparameteren `incidentTemplateId`, og forhåndsutfyller så skjemaet med malen pluss eierteamene og eierbrukerne dens.
- **Fra API-et** — send `createdIncidentTemplateId` på `POST /api/incident`, så fyller serveren hendelsen fra malen.

Det viktige er flettereglen: **en mal fyller bare et felt du lot være udefinert**. Tittel, beskrivelse, hendelsesalvor, innledende hendelsestilstand, overvåkingsstatusen bak **Endre overvåkingsstatus til**, overvåkinger, verter, Kubernetes-klynger, Docker-verter, Podman-verter, tjenester, vaktpolicyer og etiketter kopieres fra malen kun når den som kaller eller skjemaet ikke oppga noe. Alt du setter eksplisitt, vinner alltid.

**Dialogen for tomtilstanden peker feil sted.** Hvis du ikke har noen maler ennå, viser knappen **Opprett fra mal** en dialog **No Incident Templates**. Teksten peker mot Prosjektinnstillinger, men knappen ruter til **Hendelser → Innstillinger → Hendelsesmaler** — det er den virkelige plasseringen.

## Notatmaler

Notatmaler gir de som responderer ferdigskrevet tekst for hendelsesoppdateringer, slik at en statussideoppdatering klokken tre om natten ikke må skrives fra bunnen av av noen som er halvveis våken.

Gå til **Hendelser → Innstillinger → Notatmaler** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet har tittelen **Maler for offentlige eller private notater for hendelser** — ett bibliotek betjener begge notattyper. Opprettelsesskjemaet har to trinn:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**, begge obligatoriske.
- **Notatdetaljer** — selve notatteksten, i Markdown, obligatorisk.

Som med hendelsesmaler opprettes og vises rader heller enn å redigeres direkte i listen; åpne en mal for å endre den.

Notatmaler dukker opp der du faktisk trenger dem: bekreftelsesdialogene **Acknowledge Incident** og **Resolve Incident** tilbyr begge **Velg notatmal** ved siden av feltet **Offentlig notat**. Se [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) for hvordan offentlige og private notater skiller seg.

## Maler for etteranalyse

En mal for etteranalyse er skjelettet til oppsummeringen du produserer etter en hendelse — overskriftene dine, spørsmålene dine, de faste punktene dine — slik at hver gjennomgang i prosjektet følger den samme formen.

Gå til **Hendelser → Innstillinger → Postmortem-maler** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet har tittelen **Postmortem-maler**. Opprettelsesskjemaet har to trinn:

- **Malinformasjon** — **Malnavn** og **Malbeskrivelse**, begge obligatoriske.
- **Detaljer om etteranalyse** — **Mal for etteranalyse**, selve teksten, i Markdown, obligatorisk.

Du tar en i bruk fra hendelsen, ikke fra innstillingene. Åpne en hendelse, velg **Etteranalyse** i sidemenyen dens (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), og bruk **Bruk mal**. Det åpner en dialog **Bruk obduksjonsmal** med en nedtrekksliste **Velg mal**; å velge én laster malteksten inn i redigereren **Notat om etteranalyse**, der du redigerer den før du lagrer. Hendelsesepisoder har den samme siden **Etteranalyse** og henter fra det samme malbiblioteket.

## Egendefinerte felt

Egendefinerte felt lar deg bære dine egne metadata på hver hendelse — et internt tjenestenavn, en referanse til en endringssak, et kundenivå.

Gå til **Hendelser → Innstillinger → Egendefinerte felt** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Siden har tittelen **Egendefinerte hendelsesfelt**. Hver definisjon har:

- **Feltnavn** — obligatorisk, minst to tegn. Plassholderen foreslår et slug-lignende navn som `internal-service`.
- **Feltbeskrivelse** — valgfri.
- **Felttype** — obligatorisk. Denne velger hvordan data legges inn. Nedtrekkstyper trenger også at alternativene listes opp.
- **Nedtrekksalternativer** — verdiene som vises i nedtrekkslisten, hver med en valgfri farge.

Definisjonene bor i sin egen modell; verdiene bor på selve hendelsen i kolonnen `customFields`. På en enkelt hendelse fyller du dem ut fra **Egendefinerte felt** i hendelsens sidemeny (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Ett hull verdt å kjenne til.** Definisjoner av egendefinerte hendelsesfelt er den eneste delen av hendelsesfamilien uten arbeidsflyt-triggere — se arbeidsflytseksjonen under.

## Hendelsesroller

Hendelsesroller er de navngitte jobbene du tildeler folk under en respons. Definer dem på **Hendelser → Innstillinger → Hendelsesroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortbeskrivelsen gir Incident Commander og Responder som eksempler.

Roller er kun definisjoner. Du tildeler folk til dem per hendelse — erklæringsveiviseren har et trinn **Hendelsesroller** med et felt **Tildel hendelsesroller**, og hver hendelse har en side **Roller** i sidemenyen sin.

## Nummerprefikser

Hver hendelse får et nummer. Som standard vises det som `#42`. Hvis teamet ditt sier «INC-42» høyt, få produktet til å si det også.

Gå til **Hendelser → Innstillinger → Flere innstillinger** (`/dashboard/{projectId}/incidents/settings/more`). Kortet er **Tallprefiks** og rommer to felt på prosjektet:

- **Nummerprefiks for hendelse** — opptil 20 tegn, plassholder `INC-`. Sett det, så vises hendelse `#42` som `INC-42`.
- **Nummerprefiks for hendelsesepisode** — den samme idéen for numre på hendelsesepisoder, plassholder `IE-`.

La begge stå tomme for å beholde standardprefikset `#`; feltet som ikke er satt viser `# (default)`. Lagre med **Oppdater**. Den prefiksede verdien lagres på hendelsen som `incidentNumberWithPrefix`, som er det hendelseslisten og hendelsestoppen gjengir.

## Regler som kjører når en hendelse opprettes

**Hendelser → Regler** rommer åtte regelmotorer. De gjør alle den samme jobben — se på en hendelse i det øyeblikket den opprettes, og handle hvis den treffer — men de skiller seg i hva de gjør og i hvordan flere treffende regler løses opp.

- **Grupperingsregler** — grupperer beslektede hendelser i episoder. Regler evalueres i prioritetsrekkefølge; lavere prioritetsnumre går først.
- **Vaktregler** — kjører vaktpolicyer for treffende hendelser. Dekkes i detalj under.
- **Eierregler** — tildeler eiere automatisk.
- **Runbook-regler** — starter et [runbook](/docs/runbooks/index) når en hendelse treffer.
- **Personvernregler** — avgjør om en treffende hendelse er privat.
- **Etikettregler** — setter etiketter automatisk.
- **SLA-regler** — sporer respons- og løsningstider. Regler evalueres i rekkefølge; lavere rekkefølgenumre går først.
- **Reminder Rules** — minner hendelseseiere periodisk på mens en hendelse fortsatt er åpen. Regler evalueres i rekkefølge, og den første regelen som treffer, vinner.

**Rekkefølgesemantikken er ikke enhetlig.** Grupperingsregler, SLA-regler og Reminder Rules evalueres i rekkefølge. Vaktregler gjør det ikke — hver regel som treffer, utløses. Ikke anta at én modell gjelder alle åtte.

Sidene **Vaktregler**, **Eierregler**, **Etikettregler** og **Personvernregler** har faner — en fane **Incident Rules** og en fane **Episode Rules**, hver med sin egen tabell. Konfigurer fanen **Incident Rules** med mindre du spesifikt mener episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** og **Reminder Rules** er enkelttabeller.

## Vaktregler for hendelser

**Hendelser → Regler → Vaktregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) er der du gjør tilkalling automatisk. Kortet, **Hendelsesvaktregler**, beskriver regler som automatisk kjører vaktpolicyer når treffende hendelser opprettes. Siden har to faner: **Incident Rules** og **Episode Rules**.

Opprettelsesskjemaet har tre trinn:

- **Grunnleggende informasjon** — **Navn** (plassholderen foreslår noe som å tilkalle databaseteamet for enhver DB-hendelse), **Beskrivelse**, og en bryter **Aktivert**. Listen viser en grønn **Aktivert**- eller rød **Deaktivert**-pille per regel.
- **Treffkriterier** — **Monitorer**, **Hendelse Alvorligheter**, **Hendelsesetiketter**, **Overvåkingsetiketter**, pluss felt for regulære uttrykk uten skille mellom store og små bokstaver for hendelsestittel, hendelsesbeskrivelse, overvåkingsnavn og overvåkingsbeskrivelse.
- **Vaktretningslinjer** — policyene denne regelen kjører.

### Hvordan treff løses opp

Reglene siden selv leveres med, er verdt å ta innover seg:

- En regel treffer bare når **alle** kriteriene du fylte ut, går gjennom. Kriterier du lot stå tomme, hoppes over, de feiler ikke.
- Innenfor ett enkelt listekriterium — **Monitorer**, **Hendelse Alvorligheter**, **Hendelsesetiketter**, **Overvåkingsetiketter** — er treff «en av».
- Mønsterfeltene er regulære uttrykk uten skille mellom store og små bokstaver.
- **Alle regler som treffer, utløses.** Det finnes ingen prioritet og ingen kortslutning.
- Settet med policyer som faktisk kjøres, er unionen av policyene til hver treffende regel pluss eventuelle policyer knyttet til hendelsen manuelt eller av en mal, deduplisert slik at hver policy kjøres høyst én gang.

Alvorlighetsgrad er et treffkriterium her og ingen andre steder. Det finnes ikke noe vaktfelt på en hendelsesalvorlighetsgrad — å velge «Critical Incident» tilkaller ikke i seg selv noen. Hvis du vil at alvorlighetsgrad skal drive tilkalling, skriv en vaktregel som treffer på den.

## Å knytte vaktpolicyer til direkte

Regler er ikke den eneste veien. Hver hendelse bærer sin egen liste over vaktpolicyer, eksponert som feltet **Vaktpolicy** på trinnet **Vakt** i erklæringsveiviseren og på trinnet **Vakt** i en hendelsesmal. Feltbeskrivelsen sier det rett ut: dette er vaktpolicyene som skal kjøres når denne hendelsen opprettes.

Når en hendelse opprettes, kjører OneUptime etikettregler, deretter vaktregler (som fletter sine treffende policyer inn i hendelsens liste), deretter runbook-regler — og hvis den resulterende listen ikke er tom, kjøres hver policy i den. Kjøringene går parallelt og gjøres opp uavhengig av hverandre, så at én policy feiler stopper ikke de andre. Hver kjøring merkes med hendelsen som utløste den og med varslingshendelsestypen for hendelse opprettet.

For å se hva som skjedde, åpne hendelsen og velg **Vaktutførelser** i sidemenyen dens (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Å drive hendelser fra arbeidsflyter

Arbeidsflyt-triggere for hendelser er ikke håndskrevne — OneUptime genererer dem fra datamodellene, så hver modell i hendelsesfamilien får komponentene **On Create X**, **On Update X** og **On Delete X**, navngitt etter modellens entallsnavn. De tre viktigste er **On Create Incident**, **On Update Incident** og **On Delete Incident**, og de bor i kategorien **Hendelse** i **Legg til komponent**-panelet på `/dashboard/{projectId}/workflows`.

Den samme genereringen gir deg triggere for selve konfigurasjonen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** og flere. Hver modell får også tilsvarende handlingskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** og deres flerradsvarianter — så en trigger og en handling med lignende navn ligger side om side i samme kategori. **On Create Incident** starter en arbeidsflyt; **Create One Incident** oppretter en hendelse.

Noen detaljer som betyr noe når du kobler disse sammen:

- **On Update X** tar et valgfritt argument **Listen on** som begrenser triggeren til oppdateringer som berører bestemte felt. La det stå tomt for å utløses ved enhver endring. Hvis en oppdatering kommer inn uten en registrering av hvilke felt som endret seg, hoppes filteret over og arbeidsflyten kjører uansett.
- **On Create X** og **On Update X** tar begge et obligatorisk argument **Select Fields**; **On Delete X** tar ingen argumenter.
- Alle tre eksponerer én enkelt ut-port **Suksess**, og hver av dem tar imot et ID-argument slik at du kan kjøre arbeidsflyten for hånd mot én post.
- Navn kommer fra modellens entallsnavn, ikke tabellnavnet — som er grunnen til at du ser **On Create Incident Team Owner** og **On Create Incident User Owner** heller enn tabellformede navn.
- Det finnes ingen triggere for definisjoner av egendefinerte hendelsesfelt. Den modellen er det ene medlemmet av hendelsesfamilien med arbeidsflyter deaktivert.

For å bygge resten av arbeidsflyten, se [Opprette en arbeidsflyt](/docs/workflows/authoring) og [Variabler](/docs/workflows/variables).

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesfunksjonen henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — erklæringsveiviseren, maler og API-et.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — innstillingssidene for tilstand og alvorlighetsgrad og hva flaggene gjør.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — hvor notatmaler blir brukt.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får høre om en hendelse utenfor teamet ditt.
- [Oversikt over arbeidsflyter](/docs/workflows/index) — å automatisere oppå hendelsestriggere.
- [Runbooks – Oversikt](/docs/runbooks/index) — prosedyrene runbook-regler knytter til.
