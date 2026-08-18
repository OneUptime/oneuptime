# Hendelser – Oversikt

En hendelse i OneUptime er posten teamet ditt samler seg rundt når noe ryker. Den bærer et nummer, en tittel, en alvorlighetsgrad, en gjeldende tilstand, ressursene den påvirker, og alt teamet ditt skriver ned mens dere responderer — notater, rotårsak, utbedringstrinn og en feed som bare kan utvides, over hvem som gjorde hva.

Hendelser er det som gjør en overvåking som slår ut i rødt om til en koordinert respons. Å erklære én tilkaller riktig vaktrotasjon, legger til eiere som varsles om hver endring, starter runbooks, og — hvis du vil — publiserer nedetiden på den offentlige statussiden din slik at kundene slutter å opprette saker for å spørre om dere allerede vet om det.

Du kan erklære en hendelse for hånd klokken tre om natten, eller la en overvåking erklære den for deg i det øyeblikket kriteriene treffer. Uansett er hendelsen det samme objektet, med den samme livssyklusen og det samme sporet av dokumentasjon til slutt.

## Kort oppsummert

- **Funksjon på toppnivå** — **Hendelser** i venstre navigasjon i dashbordet, på `/dashboard/{projectId}/incidents`.
- **Tre forhåndsopprettede tilstander** — **Identified**, **Bekreftet** og **Løst** opprettes for hvert nye prosjekt. Du kan legge til dine egne; de tre forhåndsopprettede kan få nytt navn og ny farge, men aldri slettes.
- **Tre forhåndsopprettede alvorlighetsgrader** — **Critical Incident**, **Major Incident** og **Minor Incident**. Alvorlighetsgrad er en etikett med en farge og en rekkefølge — den har ingen egen oppførsel.
- **Fire veier inn** — veiviseren **Erklær hendelse**, **Opprett fra mal**, en kriterieregel på en overvåking, eller `POST /api/incident`.
- **Nummerert per prosjekt** — hver hendelse får et hendelsesnummer, gjengitt som `#42` som standard eller med ditt eget prefiks, som `INC-42`.
- **To typer notater** — private notater (interne notater) for teamet ditt, offentlige notater for statussideabonnenter.
- **Innstillingene ligger under Hendelser, ikke Prosjektinnstillinger** — tilstander, alvorlighetsgrader, maler, egendefinerte felt og regelmotorene ligger alle på **Hendelser → Innstillinger** og **Hendelser → Regler**.

## Sentrale begreper

En håndfull ord dukker opp på hver eneste side i denne delen. Få disse på plass først.

| Begrep                   | Hva det betyr                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hendelse**             | Selve posten — tittel, beskrivelse, alvorlighetsgrad, gjeldende tilstand, berørte ressurser og alt som skrives på den under responsen.               |
| **Hendelsestilstand**    | Hvor hendelsen er i livssyklusen sin. En prosjektavgrenset rad med et navn, en farge og `order`, pluss flaggene som gir den mening.                  |
| **Hendelsesalvor**       | Hvor ille det er. En prosjektavgrenset rad med et navn, en farge og `order`. Rent en klassifisering — ingenting i produktet behandler én grad spesielt. |
| **Hendelsesnummer**      | En teller per prosjekt vist som `#42`, eller med et prefiks du konfigurerer, som `INC-42`.                                                           |
| **Berørte ressurser**    | Overvåkingene, vertene, Kubernetes-klyngene, Docker-vertene, tjenestene og annen infrastruktur du knytter til hendelsen.                             |
| **Offentlig notat**      | En oppdatering skrevet for lesere og abonnenter på statussiden. Den vises på tidslinjen på statussiden.                                              |
| **Privat notat**         | Et internt notat (modellen `IncidentInternalNote`) for teamet som responderer. Det når aldri en statusside.                                          |
| **Eier**                 | En bruker eller et team som er ansvarlig for hendelsen. Eiere varsles når den opprettes, når notater legges ut, og når tilstanden endres.            |
| **Hendelse Feed**        | Den utvidbare aktivitetstidslinjen på hendelsens **Oversikt**, som registrerer tilstandsendringer, notater, eierendringer, regelkjøringer og varsler. |
| **Tilstandstidslinje**   | Registreringen av hvilken tilstand hendelsen var i, når, og hvor lenge — med abonnentvarselsstatusen for hver overgang.                              |

## De tre tilstandene OneUptime oppretter for hvert prosjekt

Når et prosjekt opprettes, oppretter OneUptime nøyaktig tre hendelsestilstander, i denne rekkefølgen:

| Tilstand         | Rekkefølge | Farge              | Hva det betyr                                                                |
| ---------------- | ---------- | ------------------ | ---------------------------------------------------------------------------- |
| **Identified**   | 1          | Rød (`#fd625e`)    | Tilstanden en helt ny hendelse havner i. Dette er den opprettede tilstanden. |
| **Bekreftet**    | 2          | Gul (`#ffbf53`)    | Noen har tatt tak i hendelsen og jobber med den.                            |
| **Løst**         | 3          | Grønn (`#2ab57d`)  | Hendelsen er over. Det er å løse den som fjerner den fra statussiden din.   |

Navnene er bare etiketter — det som faktisk styrer oppførselen er tre boolske verdier på tilstandsraden: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Bare én tilstand per prosjekt forventes å bære hvert av flaggene.

Det skillet betyr mer enn det høres ut som:

- `isCreatedState` avgjør hvor en ny hendelse starter. Hvis ingen tilstand er eksplisitt valgt ved opprettelse, ser OneUptime etter prosjektets opprettede tilstand og bruker den.
- `isAcknowledgedState` og `isResolvedState` styrer knappene **Acknowledge** og **Løs** i hendelsestoppen, de to statistikkflisene på hendelsens **Oversikt**, og telleren **Aktive hendelser** i sidemenyen.
- **Aktive hendelser** er definert utelukkende som «gjeldende tilstand er ikke den løste tilstanden». Enhver egendefinert tilstand du legger til, er derfor aktiv med mindre den er den løste.

**Merk deg navngivningen.** Den første forhåndsopprettede tilstanden heter **Identified**, selv om flere beskrivelser inne i produktet fortsatt kaller den den opprettede tilstanden. Hvis du leter etter «Created» i prosjektets tilstandsliste, er det raden som heter **Identified**.

Du kan legge til dine egne tilstander på **Hendelser → Innstillinger → Hendelsesstatus**. Nye tilstander legges til på slutten av den sorterte listen, og du kan dra for å endre rekkefølgen. De tre flaggede tilstandene kan ikke slettes — OneUptime blokkerer det — men du kan gi dem nytt navn og ny farge, som er grunnen til at grensesnittet leser tilstandsnavn dynamisk.

Rekkefølgen håndheves, den er ikke kosmetisk: en hendelse kan ikke flyttes til en tilstand som ligger tidligere i rekkefølgen enn den nåværende.

Full detalj finner du i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

## De tre alvorlighetsgradene OneUptime oppretter for hvert prosjekt

Hvert nye prosjekt får også tre alvorlighetsgrader:

| Alvorlighetsgrad      | Rekkefølge | Farge                | Hva det betyr                                                    |
| --------------------- | ---------- | -------------------- | ---------------------------------------------------------------- |
| **Critical Incident** | 1          | Vinrød (`#b70400`)   | Svært høy kundepåvirkning, krever umiddelbar respons.           |
| **Major Incident**    | 2          | Rød (`#fd625e`)      | Betydelig påvirkning, krever vanligvis umiddelbar respons.      |
| **Minor Incident**    | 3          | Gul (`#ffbf53`)      | Lav påvirkning, håndteres vanligvis i arbeidstiden.             |

De fullstendige forhåndsopprettede beskrivelsene finner du i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

Alvorlighetsgrader har `name`, `description`, `color` og `order` og ingenting annet. Det finnes ingen flagg, og ingen kodesti behandler «Critical Incident» annerledes enn en hvilken som helst annen rad. Alvorlighetsgrad er måten mennesker triagerer på, og den er tilgjengelig som treffkriterium når du skriver vaktregler — men å velge en alvorlighetsgrad tilkaller ikke i seg selv noen.

Rediger eller legg til alvorlighetsgrader på **Hendelser → Innstillinger → Hendelsesalvor**.

## En hendelses liv

### 1. Den blir erklært

Fire ruter fører til det samme objektet:

- **For hånd** — fra hendelseslisten, klikk **Erklær hendelse**. Det åpner veiviseren **Erklær ny hendelse**, som er fem trinn lang: **Hendelsesdetaljer**, **Berørte ressurser**, **Hendelsesroller**, **Vakt**, **Mer**.
- **Fra en mal** — klikk **Opprett fra mal** og velg en lagret **Hendelse Mal**. Maler forhåndsutfyller tittel, beskrivelse, alvorlighetsgrad, innledende tilstand, ressurser, vaktpolicyer, eiere og etiketter.
- **Fra en overvåking** — en kriterieregel på en overvåking med bryteren «erklær en hendelse» slått på oppretter hendelsen automatisk i det øyeblikket filtrene treffer. Titler og beskrivelser der støtter `{{variable}}`-maler.
- **Over API-et** — `POST /api/incident` med en API-nøkkel. Serveren fyller inn `declaredAt`, den opprettede tilstanden og hendelsesnummeret for deg.

Se [Opprette en hendelse](/docs/incidents/declaring-incidents) for gjennomgangen felt for felt.

### 2. De rette folkene får vite om det

Ved opprettelse kjører OneUptime automatiseringen du har konfigurert: etikettregler, vaktregler, eierregler og runbook-regler. Alle vaktpolicyer som er knyttet til hendelsen — manuelt, fra en mal, eller flettet inn av en treffende vaktregel — kjøres parallelt.

Eiere varsles med e-post, SMS, telefon, push og WhatsApp, avhengig av hver enkelt brukers egne varslingsinnstillinger. Hvis en hendelse ikke har noen eiere i det hele tatt, faller varselet tilbake til prosjekteierne i stedet for å forsvinne.

Hvis hendelsen er synlig på en statusside og abonnentvarsler er aktivert, får abonnentene også beskjed. Varsler er cron-drevne og kjører hvert minutt, så forvent opptil rundt et minutts forsinkelse heller enn øyeblikkelig utsending.

### 3. Teamet ditt jobber med den

De som responderer bekrefter hendelsen, knytter til berørte ressurser, kjører runbooks, tildeler hendelsesroller og skriver ned ting etter hvert som de lærer dem — private notater for teamet, offentlige notater for kundene, pluss sidene **Rotårsak** og **Utbedring** når bildet blir klarere. Alt de gjør havner i **Hendelse Feed** på siden **Oversikt**.

### 4. Den blir løst

Å klikke **Løs** flytter hendelsen til den løste tilstanden, stempler tilstandstidslinjen, stopper varighetsklokken og fjerner hendelsen fra den aktive delen av enhver statusside den ble vist på. Ingenting annet må endres for at det skal skje — det er flagget for løst tilstand statussidespørringen ser på.

Etter det kan du skrive en etteranalyse og, om du vil, publisere den på statussiden.

## Hvor hendelser bor i dashbordet

Åpne **Hendelser** i venstre navigasjon. Sidemenyen er organisert i seksjoner:

| Seksjon           | Hva du gjør der                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Oversikt**      | **Alle hendelser** og **Aktive hendelser** — sistnevnte har en rød teller med antall hendelser som ikke er i den løste tilstanden.                                           |
| **Episoder**      | Hendelsesepisoder, en egen grupperingsfunksjon med sine egne sider.                                                                                                          |
| **KI**            | **Undersøkelse** og **Utbedring** — innstillinger for automatisk undersøkelse og automatisk utbedring.                                                                       |
| **Arbeidsområde** | **Slack**- og **Microsoft Teams**-tilkoblinger for hendelser.                                                                                                                |
| **Regler**        | Regelmotorene: **Grupperingsregler**, **Vaktregler**, **Eierregler**, **Runbook-regler**, **Personvernregler**, **Etikettregler**, **SLA-regler**, **Reminder Rules**.       |
| **Innstillinger** | **Hendelsesstatus**, **Hendelsesalvor**, **Hendelsesmaler**, **Notatmaler**, **Postmortem-maler**, **Egendefinerte felt**, **Hendelsesroller**, **Flere innstillinger**.     |

**Regler** og **Innstillinger** er sammenslått som standard — utvid dem for å finne sidene resten av denne dokumentasjonen viser til. Hendelseskonfigurasjon ligger ikke under Prosjektinnstillinger; alt sammen bor her.

Selve hendelseslisten viser **Hendelsesnummer**, **Tittel**, **Tilstand**, **Alvorlighetsgrad**, **Berørte ressurser**, **Erklært**, **Varighet**, **Etiketter** og **Eiere**, med en masseoperasjon **Endre tilstand** for å lukke flere om gangen.

## Hva hver side på en hendelse viser

Åpne en hendelse, og du får en sidemeny til venstre, gruppert slik:

- **Oversikt** — kortet **Hendelsesdetaljer** (tittel, alvorlighetsgrad, etiketter, hendelsesnummer, erklært den, erklært av, vaktpolicyer), et kort med **Berørte ressurser**, og **Hendelse Feed**. Over dem, statistikkfliser for tid til bekreftelse, tid til løsning og total **Varighet**.
- **Tilstandstidslinje** — hver tilstand hendelsen har vært i, med **Begynner den**, **Slutter den**, **Varighet** og abonnentvarselsstatusen for hver overgang. **Vis årsak** og **Vis logger** forklarer hvorfor hver endring skjedde.
- **SLA** — SLA-sporing for denne hendelsen.
- **Beskrivelse**, **Rotårsak**, **Utbedring** — tre markdown-sider. Beskrivelsen er den som vises på statussiden din.
- **Runbooks** — runbook-kjøringer knyttet til denne hendelsen.
- **Etteranalyse** — oppsummeringen, som du eventuelt kan publisere på statussiden.
- **Roller**, **Vaktutførelser**, **Eiere** — hvem som er på saken, hvilke policyer som utløste, og hvem som varsles.
- **Varsellogger**, **AI-logger**, **Revisjonslogger** — hva som ble sendt og hva som ble endret.
- **Private notater** og **Offentlige notater** — under seksjonen **Notater** i sidemenyen.
- **Egendefinerte felt**, **Innstillinger**, **Slett hendelse** — under **Avansert**. Siden **Innstillinger** rommer **Synlig på statussiden**, **Privat hendelse** og kortet **Reminders**.

[Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) dekker samarbeidssidene i dybden.

## Hvordan hendelser passer sammen med resten av OneUptime

- **Overvåkinger oppdager problemet; hendelser registrerer det.** En kriterieregel på en overvåking kan erklære en hendelse automatisk, og forhåndsutfylle tittel, alvorlighetsgrad, vaktpolicyer, eiere, etiketter og utbedringsnotater. Se [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) for variablene som er tilgjengelige der.
- **Vaktpolicyer står for tilkallingen.** Knytt til policyer på trinnet **Vakt** i erklæringsveiviseren, på en mal, eller gjennom **Hendelser → Regler → Vaktregler**. Hver regel som treffer, utløses — settet som kjøres er unionen av alle treff pluss alt som er knyttet til direkte, uten duplikater.
- **Runbooks forteller folk hva de skal gjøre.** Runbook-regler knytter til en prosedyre automatisk når en treffende hendelse opprettes, og de som responderer kan starte en for hånd fra hendelsen. Se [Runbooks – Oversikt](/docs/runbooks/index).
- **Statussider forteller kundene om det.** En hendelse vises i den aktive listen på en statusside når siden har hendelser aktivert, hendelsen er merket som synlig på statussiden, og gjeldende tilstand ikke er den løste tilstanden. Private hendelser er alltid skjult fra hver eneste statusside. Se [Statussider – Oversikt](/docs/status-pages/index).
- **Arbeidsflyter automatiserer rundt den.** Triggerne **On Create Incident**, **On Update Incident** og **On Delete Incident** lar deg bygge no-code-automatisering oppå hendelseslivssyklusen. Se [Oversikt over arbeidsflyter](/docs/workflows/index).

## Hvor du leser videre

- [Opprette en hendelse](/docs/incidents/declaring-incidents) — veiviseren, maler, overvåkingskriterier og API-et.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — tilstandsflaggene, egendefinerte tilstander og klassifisering av alvorlighetsgrad.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige og private notater, eiere, og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, nummerprefikser og regelmotorene.
- [Statussider – Oversikt](/docs/status-pages/index) — hvordan hendelser når kundene dine.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som varsles når en hendelse flytter seg.
