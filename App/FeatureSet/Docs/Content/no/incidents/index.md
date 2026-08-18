# Hendelser – Oversikt

En hendelse i OneUptime er posten teamet ditt samler seg rundt når noe ryker. Den bærer et nummer, en tittel, en alvorlighetsgrad, en gjeldende tilstand, ressursene den berører, og alt teamet ditt skriver ned mens dere responderer — notater, rotårsak, utbedringstiltak og en feed du bare kan legge til i, over hvem som gjorde hva.

Hendelser er det som gjør en overvåking som slår ut i rødt om til en koordinert respons. Å erklære én tilkaller riktig vaktrotasjon, legger til eiere som varsles om hver endring, starter runbooks og — hvis du vil ha det slik — publiserer avbruddet på den offentlige statussiden din, slik at kundene slutter å opprette saker for å spørre om dere allerede vet.

Du kan erklære en hendelse for hånd klokken tre om natten, eller la en overvåking erklære den for deg i det øyeblikket kriteriene slår til. Uansett er hendelsen det samme objektet, med den samme livssyklusen og det samme sporet av dokumentasjon til slutt.

## Kort oppsummert

- **Toppnivåfunksjon** — **Hendelser** i dashbordets venstre navigasjon, på `/dashboard/{projectId}/incidents`.
- **Tre forhåndsopprettede tilstander** — **Identifisert**, **Bekreftet** og **Løst** opprettes for hvert nye prosjekt. Du kan legge til dine egne; de tre forhåndsopprettede kan få nytt navn og ny farge, men aldri slettes.
- **Tre forhåndsopprettede alvorlighetsgrader** — **Kritisk hendelse**, **Større hendelse** og **Mindre hendelse**. Alvorlighetsgrad er en etikett med en farge og en rekkefølge — den bærer ingen oppførsel i seg selv.
- **Fire veier inn** — veiviseren **Erklær hendelse**, **Opprett fra mal**, en kriterieregel på en overvåking, eller `POST /api/incident`.
- **Nummerert per prosjekt** — hver hendelse får et hendelsesnummer, vist som `#42` som standard eller med ditt eget prefiks, som `INC-42`.
- **To slags notater** — private notater (interne notater) for teamet ditt, offentlige notater for abonnentene på statussiden.
- **Innstillingene bor under Hendelser, ikke Prosjektinnstillinger** — tilstander, alvorlighetsgrader, maler, egendefinerte felt og regelmotorene ligger alle på **Hendelser → Innstillinger** og **Hendelser → Regler**.

## Sentrale begreper

En håndfull ord dukker opp på hver eneste av de andre sidene i denne delen. Få disse på plass først.

| Begrep                 | Hva det betyr                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hendelse**           | Selve posten — tittel, beskrivelse, alvorlighetsgrad, gjeldende tilstand, berørte ressurser og alt som skrives på den underveis i responsen.         |
| **Hendelsesstatus**    | Hvor hendelsen befinner seg i livssyklusen sin. En prosjektavgrenset rad med navn, farge og `order`, pluss flaggene som gir den mening.              |
| **Hendelsesalvor**     | Hvor ille det er. En prosjektavgrenset rad med navn, farge og `order`. Rent en klassifisering — ingenting i produktet behandler én grad spesielt.    |
| **Hendelsesnummer**    | En teller per prosjekt, vist som `#42`, eller med et prefiks du konfigurerer, som `INC-42`.                                                          |
| **Berørte ressurser**  | Overvåkingene, vertene, Kubernetes-klyngene, Docker-vertene, tjenestene og annen infrastruktur du knytter til hendelsen.                             |
| **Offentlig notat**    | En oppdatering skrevet for lesere og abonnenter på statussiden. Den vises på statussidens tidslinje.                                                 |
| **Privat notat**       | Et internt notat (modellen `IncidentInternalNote`) for teamet som responderer. Det når aldri en statusside.                                          |
| **Eier**               | En bruker eller et team som er ansvarlig for hendelsen. Eiere varsles når den opprettes, når notater postes, og når tilstanden endres.               |
| **Hendelse Feed**      | Aktivitetstidslinjen på hendelsens **Oversikt** som bare kan tilføyes, og som registrerer tilstandsendringer, notater, eierendringer, regelkjøringer og varsler. |
| **Tilstandstidslinje** | Registeret over hvilken tilstand hendelsen var i, når, og hvor lenge — med abonnentvarselsstatusen for hver overgang.                                |

## De tre tilstandene OneUptime oppretter for hvert prosjekt

Når et prosjekt opprettes, forhåndsoppretter OneUptime nøyaktig tre hendelsestilstander, i denne rekkefølgen:

| Tilstand          | Rekkefølge | Farge              | Hva det betyr                                                             |
| ----------------- | ---------- | ------------------ | ------------------------------------------------------------------------- |
| **Identifisert**  | 1          | Rød (`#fd625e`)    | Tilstanden en helt ny hendelse havner i. Dette er den opprettede tilstanden. |
| **Bekreftet**     | 2          | Gul (`#ffbf53`)    | Noen har tatt tak i hendelsen og jobber med den.                          |
| **Løst**          | 3          | Grønn (`#2ab57d`)  | Hendelsen er over. Å løse den er det som tar den av statussiden din.      |

Navnene er bare etiketter — det som faktisk styrer oppførselen, er tre boolske verdier på tilstandsraden: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Bare én tilstand per prosjekt forventes å bære hvert av flaggene.

Det skillet betyr mer enn det høres ut som:

- `isCreatedState` avgjør hvor en ny hendelse starter. Hvis ingen tilstand velges eksplisitt ved opprettelse, leter OneUptime etter prosjektets opprettede tilstand og bruker den.
- `isAcknowledgedState` og `isResolvedState` styrer knappene **Acknowledge** og **Løs** i hendelsestoppen, de to statistikkflisene på hendelsens **Oversikt**, og telleren **Aktive hendelser** i sidemenyen.
- **Aktive hendelser** er definert utelukkende som «gjeldende tilstand er ikke den løste tilstanden». Enhver egendefinert tilstand du legger til, er derfor aktiv med mindre den er den løste.

**Merk navngivningen.** Den første forhåndsopprettede tilstanden heter **Identifisert**, selv om flere beskrivelser inne i produktet fremdeles kaller den den opprettede tilstanden. Leter du etter «Created» i prosjektets tilstandsliste, er det raden som heter **Identifisert**.

Du kan legge til dine egne tilstander på **Hendelser → Innstillinger → Hendelsesstatus**. Nye tilstander legges bakerst i den sorterte listen, og du kan dra dem for å endre rekkefølgen. De tre flaggede tilstandene kan ikke slettes — OneUptime blokkerer det — men du kan gi dem nytt navn og ny farge, og derfor leser grensesnittet tilstandsnavn dynamisk.

Rekkefølgen håndheves, den er ikke kosmetikk: en hendelse kan ikke flyttes til en tilstand som ligger tidligere i rekkefølgen enn den den står i nå.

Alle detaljene ligger i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

## De tre alvorlighetsgradene OneUptime oppretter for hvert prosjekt

Hvert nye prosjekt får også tre alvorlighetsgrader:

| Alvorlighetsgrad       | Rekkefølge | Farge              | Hva det betyr                                              |
| ---------------------- | ---------- | ------------------ | ---------------------------------------------------------- |
| **Kritisk hendelse**   | 1          | Rødbrun (`#b70400`) | Svært stor kundepåvirkning som krever umiddelbar respons.  |
| **Større hendelse**    | 2          | Rød (`#fd625e`)    | Betydelig påvirkning, krever som regel umiddelbar respons. |
| **Mindre hendelse**    | 3          | Gul (`#ffbf53`)    | Liten påvirkning, håndteres som regel innenfor arbeidstiden. |

De fullstendige forhåndsopprettede beskrivelsene finner du i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

Alvorlighetsgrader har `name`, `description`, `color` og `order` og ingenting mer. Det finnes ingen flagg, og ingen kodesti behandler «Kritisk hendelse» annerledes enn en hvilken som helst annen rad. Alvorlighetsgrad er måten mennesker triagerer på, og den er tilgjengelig som treffkriterium når du skriver vaktregler — men å velge en alvorlighetsgrad tilkaller ingen i seg selv.

Rediger eller legg til alvorlighetsgrader på **Hendelser → Innstillinger → Hendelsesalvor**.

## Livet til en hendelse

### 1. Den blir erklært

Fire veier fører til det samme objektet:

- **For hånd** — klikk **Erklær hendelse** i hendelseslisten. Det åpner veiviseren **Erklær ny hendelse**, fem trinn lang: **Hendelsesdetaljer**, **Berørte ressurser**, **Hendelsesroller**, **Vakt**, **Mer**.
- **Fra en mal** — klikk **Opprett fra mal** og velg en lagret **Hendelsesmal**. Maler forhåndsutfyller tittel, beskrivelse, alvorlighetsgrad, innledende tilstand, ressurser, vaktpolicyer, eiere og etiketter.
- **Fra en overvåking** — en kriterieregel på en overvåking der bryteren «erklær en hendelse» er slått på, oppretter hendelsen automatisk i det øyeblikket filtrene slår til. Titler og beskrivelser der støtter maler med `{{variable}}`.
- **Over API-et** — `POST /api/incident` med en API-nøkkel. Serveren fyller inn `declaredAt`, den opprettede tilstanden og hendelsesnummeret for deg.

Se [Opprette en hendelse](/docs/incidents/declaring-incidents) for gjennomgangen felt for felt.

### 2. De rette folkene får vite det

Ved opprettelse kjører OneUptime automatiseringen du har satt opp: etikettregler, vaktregler, eierregler og runbook-regler. Alle vaktpolicyer som er knyttet til hendelsen — manuelt, fra en mal, eller flettet inn av en vaktregel som slår til — kjøres parallelt.

Eiere varsles via e-post, SMS, telefon, push og WhatsApp, avhengig av hver enkelt brukers egne varslingsinnstillinger. Har en hendelse ingen eiere i det hele tatt, faller varselet tilbake på prosjekteierne i stedet for å bli forkastet.

Er hendelsen synlig på en statusside og abonnentvarsler er slått på, får abonnentene også beskjed. Varslene er cron-drevne og kjører hvert minutt, så regn med opptil omtrent ett minutts forsinkelse fremfor en umiddelbar utsendelse.

### 3. Teamet ditt jobber med den

De som responderer, bekrefter hendelsen, knytter til berørte ressurser, kjører runbooks, tildeler hendelsesroller og skriver ned ting etter hvert som de forstår dem — private notater for teamet, offentlige notater for kundene, pluss sidene **Rotårsak** og **Utbedring** når bildet klarner. Alt de gjør, havner i **Hendelse Feed** på siden **Oversikt**.

### 4. Den blir løst

Å klikke **Løs** flytter hendelsen til den løste tilstanden, stempler tilstandstidslinjen, stopper varighetsklokken og fjerner hendelsen fra den aktive delen av enhver statusside den vistes på. Ingenting annet trenger å endres for at det skal skje — det er flagget for løst tilstand statussidespørringen ser på.

Etterpå kan du skrive en etteranalyse og eventuelt publisere den på statussiden.

## Hvor hendelser bor i dashbordet

Åpne **Hendelser** i venstre navigasjon. Sidemenyen er organisert i seksjoner:

| Seksjon           | Hva du gjør der                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Oversikt**      | **Alle hendelser** og **Aktive hendelser** — den siste bærer en rød teller med antall hendelser som ikke er i den løste tilstanden.                                        |
| **Episoder**      | Hendelsesepisoder, en egen grupperingsfunksjon med sine egne sider.                                                                                                        |
| **KI**            | **Undersøkelse** og **Utbedring** — innstillinger for automatisk undersøkelse og automatisk utbedring.                                                                     |
| **Arbeidsområde** | **Slack**- og **Microsoft Teams**-tilkoblinger for hendelser.                                                                                                              |
| **Regler**        | Regelmotorene: **Grupperingsregler**, **Vaktregler**, **Eierregler**, **Runbook-regler**, **Personvernregler**, **Etikettregler**, **SLA-regler**, **Reminder Rules**.      |
| **Innstillinger** | **Hendelsesstatus**, **Hendelsesalvor**, **Hendelsesmaler**, **Notatmaler**, **Postmortem-maler**, **Egendefinerte felt**, **Hendelsesroller**, **Flere innstillinger**.   |

**Regler** og **Innstillinger** er sammenslått som standard — utvid dem for å finne sidene resten av denne dokumentasjonen viser til. Hendelseskonfigurasjon ligger ikke under Prosjektinnstillinger; alt sammen bor her.

Selve hendelseslisten viser **Hendelsesnummer**, **Tittel**, **Tilstand**, **Alvorlighetsgrad**, **Berørte ressurser**, **Erklært**, **Varighet**, **Etiketter** og **Eiere**, med masseoperasjonen **Endre tilstand** for å lukke flere om gangen.

## Hva hver side på en hendelse viser

Åpne en hendelse, så får du en sidemeny til venstre, gruppert slik:

- **Oversikt** — kortet **Hendelsesdetaljer** (tittel, alvorlighetsgrad, etiketter, hendelsesnummer, erklært den, erklært av, vaktpolicyer), et kort med **Berørte ressurser**, og **Hendelse Feed**. Over dem ligger statistikkfliser for tid til bekreftelse, tid til løsning og total **Varighet**.
- **Tilstandstidslinje** — hver tilstand hendelsen har vært i, med **Begynner den**, **Slutter den**, **Varighet** og abonnentvarselsstatusen for hver overgang. **Vis årsak** og **Vis logger** forklarer hvorfor hver endring skjedde.
- **SLA** — SLA-oppfølging for denne hendelsen.
- **Beskrivelse**, **Rotårsak**, **Utbedring** — tre Markdown-sider. Beskrivelsen er den som vises på statussiden din.
- **Runbooks** — runbook-kjøringer knyttet til denne hendelsen.
- **Etteranalyse** — oppsummeringen, som du eventuelt kan publisere på statussiden.
- **Roller**, **Vaktutførelser**, **Eiere** — hvem som er på saken, hvilke policyer som utløste, og hvem som varsles.
- **Varsellogger**, **AI-logger**, **Revisjonslogger** — hva som ble sendt, og hva som ble endret.
- **Offentlige notater** og **Private notater** — under seksjonen **Notater** i sidemenyen.
- **Egendefinerte felt**, **Innstillinger**, **Slett hendelse** — under **Avansert**. Siden **Innstillinger** rommer **Synlig på statussiden**, **Privat hendelse** og kortet **Reminders**.

[Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) dekker samarbeidssidene i dybden.

## Hvordan hendelser henger sammen med resten av OneUptime

- **Overvåkinger oppdager problemet; hendelser dokumenterer det.** En kriterieregel på en overvåking kan erklære en hendelse automatisk og forhåndsutfylle tittel, alvorlighetsgrad, vaktpolicyer, eiere, etiketter og utbedringsnotater. Se [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) for variablene du har tilgjengelig der.
- **Vaktpolicyer står for tilkallingen.** Knytt til policyer på trinnet **Vakt** i erklæringsveiviseren, på en mal, eller via **Hendelser → Regler → Vaktregler**. Hver regel som treffer, utløses — settet som kjøres, er unionen av alle treff pluss alt du har knyttet til direkte, uten duplikater.
- **Runbooks forteller folk hva de skal gjøre.** Runbook-regler knytter til en prosedyre automatisk når en hendelse som treffer opprettes, og de som responderer kan starte en for hånd fra hendelsen. Se [Runbooks – Oversikt](/docs/runbooks/index).
- **Statussider forteller kundene.** En hendelse vises i en statussides aktive liste når siden har hendelser slått på, hendelsen er merket som synlig på statussiden, og gjeldende tilstand ikke er den løste tilstanden. Private hendelser er alltid skjult fra hver eneste statusside. Se [Statussider – Oversikt](/docs/status-pages/index).
- **Arbeidsflyter automatiserer rundt den.** Triggerne **On Create Incident**, **On Update Incident** og **On Delete Incident** lar deg bygge kodefri automatisering oppå hendelseslivssyklusen. Se [Oversikt over arbeidsflyter](/docs/workflows/index).

## Hvor du leser videre

- [Opprette en hendelse](/docs/incidents/declaring-incidents) — veiviseren, malene, overvåkingskriteriene og API-et.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — tilstandsflaggene, egendefinerte tilstander og klassifisering av alvorlighetsgrad.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige og private notater, eiere og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, nummerprefikser og regelmotorene.
- [Statussider – Oversikt](/docs/status-pages/index) — hvordan hendelser når kundene dine.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som varsles når en hendelse flytter seg.
