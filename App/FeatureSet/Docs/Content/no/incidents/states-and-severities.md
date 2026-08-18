# Tilstander og alvorlighetsgrader

Hver hendelse bærer to klassifiseringer: en **tilstand** som sier hvor den er i responsen din, og en **alvorlighetsgrad** som sier hvor mye det svir. I dashbordet ser de like ut — begge vises som fargede piller i hendelseslisten, begge er prosjektavgrensede lister du kan gi nytt navn og ny farge. De gjør veldig forskjellige jobber.

Tilstander driver oppførsel. Tre boolske flagg på tilstandsradene avgjør hvilke hendelser som teller som aktive, hvilke knapper som vises i hendelsestoppen, når SLA-klokken stopper, og når hendelsen forsvinner fra statussiden din. Alvorlighetsgrader driver ingenting i seg selv — de er etiketter som beskriver påvirkning, og som andre regler kan treffe på.

Begge listene opprettes når prosjektet ditt opprettes, og begge redigeres under **Hendelser → Innstillinger**. Den seksjonen av sidemenyen for Hendelser er sammenslått som standard, så utvid **Innstillinger** før du leter etter den.

## Tilstander bærer oppførsel, alvorlighetsgrader bærer mening

Modellen `IncidentState` har `name`, `description`, `color` og `order`, pluss tre boolske verdier: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Alt produktet gjør med tilstander henger på disse boolske verdiene og på `order` — aldri på tilstandens navn. Det er derfor du kan gi **Løst** navnet «Lukket» uten at noe knekker: flagget følger med raden.

Modellen `IncidentSeverity` har `name`, `description`, `color` og `order` og ingenting annet. Det finnes ingen flagg. Ingenting i OneUptime behandler **Critical Incident** annerledes enn **Minor Incident** på egen hånd — alvorlighetsgrad betyr noe bare der du peker noe mot den, som treffkriteriet **Hendelse Alvorligheter** på en vaktregel.

Noen raske regler:

- **Velg alvorlighetsgrad for å kommunisere påvirkning** — den vises i hendelseslisten, på hendelsens **Oversikt**, og den er et obligatorisk felt når du erklærer en hendelse.
- **Velg tilstander for å modellere prosessen din** — responstrinnene du faktisk går gjennom, i den rekkefølgen du går gjennom dem.
- **Ikke kod hastegrad inn i tilstander** — en tilstand kalt «Kritisk» ville ikke tilkalt noen. Alvorlighetsgrad pluss en vaktregel gjør det.

## De forhåndsopprettede tilstandene

Tre tilstander opprettes sammen med prosjektet, i denne rekkefølgen. Opprettelsen er idempotent — en tilstand legges bare til når en med det navnet ikke allerede finnes.

| Tilstand         | `order` | Flagg                 | Farge     | Hva det betyr                                       |
| ---------------- | ------- | --------------------- | --------- | --------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Tilstanden nye hendelser havner i.                  |
| **Bekreftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Noen har tatt tak i hendelsen.                      |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Hendelsen er over og slutter å telle som aktiv.     |

Merk deg navnet: den første tilstanden er **Identified**, selv om flere beskrivelser inne i produktet fortsatt kaller den den «opprettede» tilstanden. Når et dokument eller et verktøytips sier «opprettet tilstand», menes den tilstanden som bærer `isCreatedState` — i et ferskt prosjekt er det **Identified**.

## Hva hvert tilstandsflagg faktisk gjør

| Flagg                 | Formål                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isCreatedState`      | Tilstanden en hendelse får når ingen valgte én. Hvis ingen tilstand i prosjektet bærer dette flagget, feiler det å opprette en hendelse med en feil som ber deg legge til en opprettet hendelsestilstand fra innstillingene. |
| `isAcknowledgedState` | Driver knappen **Acknowledge** og statistikkflisen «<tilstandsnavn> om» på hendelsens **Oversikt**. Ved en tilstandsendring inn i denne tilstanden merkes hendelsens SLA som besvart.                  |
| `isResolvedState`     | Driver knappen **Løs** og statistikkflisen for løst, definerer listen **Aktive hendelser**, og er det som fjerner hendelsen fra den aktive delen av en statusside. Merker SLA-en som løst.             |

Bare én tilstand per prosjekt forventes å bære hvert flagg — oppslagene henter én enkelt rad. De tre flaggede tilstandene kan gis nytt navn, ny farge og ny rekkefølge, men innstillingssiden nekter å slette dem og viser en feil som navngir den opprettede, den bekreftede og den løste tilstanden.

Fordi grensesnittet leser tilstandsnavn dynamisk, endrer det å gi en tilstand nytt navn hva du ser overalt — statistikkflisene, titlene på bekreftelsesmodalene og pillen i hendelseslisten følger alle navnet du ga raden.

## Å legge til dine egne tilstander

Gå til **Hendelser → Innstillinger → Hendelsesstatus**. Siden er en sortert liste ordnet etter `order` stigende, og nye tilstander legges til på slutten. Dra en rad for å endre posisjonen.

**Felt på en tilstand:**

- **Navn** — obligatorisk, minst to tegn. Plassholderen foreslår noe som «Investigating».
- **Beskrivelse** — valgfri fritekst som forklarer når en hendelse sitter i denne tilstanden.
- **Farge** — obligatorisk. Valgt fra fargevelgeren; lagres som en heksadesimal verdi som `#fd625e`.

Du kan ikke sette de tre flaggene fra dette skjemaet — de tilhører de forhåndsopprettede radene. En tilstand du legger til er derfor en uflagget tilstand, noe som har to konsekvenser det er verdt å planlegge rundt:

- **Den teller som aktiv.** **Aktive hendelser** er definert som «gjeldende tilstand er ikke den løste tilstanden», så alt du legger til utenom den løste tilstanden holder hendelsen i den aktive listen og i sidemenytelleren.
- **Overgangsknappen dens er generisk.** I stedet for **Acknowledge** eller **Løs** har bekreftelsesmodalen tittelen **Mark Incident as `<state name>`** med en send-knapp **Mark as `<state name>`**.

En vanlig form er å sette inn et triage- eller demperingstrinn mellom den bekreftede og den løste tilstanden — for eksempel å dra en ny «Dempet»-tilstand slik at den ligger etter **Bekreftet** og før **Løst**.

## Rekkefølge er en reell begrensning, ikke en visningspreferanse

Kolonnen `order` håndheves når en tilstandsendring skrives, ikke bare når listen tegnes:

- **Overganger bakover avvises.** Å flytte en hendelse til en tilstand som ligger tidligere i rekkefølgen enn gjeldende tilstand, feiler med en feilmelding som navngir begge tilstandene.
- **Å velge gjeldende tilstand på nytt avvises.** Å sette en hendelse til tilstanden den allerede er i, feiler med «Incident state cannot be same as previous state.»
- **En tilbakedatert rad kan ikke duplisere naboen sin.** Å sette inn en tidslinjerad hvis tilstand er lik raden som følger etter den, avvises også.
- **Knappene i toppen følger de flaggede tilstandenes posisjon i rekkefølgen.** **Acknowledge** og **Løs** tilbys ut fra hvor gjeldende tilstand ligger i den rekkefølgesorterte listen. En egendefinert tilstand plassert *etter* den løste tilstanden vil aldri vise en **Løs**-knapp, fordi det ikke er noe igjen å flytte fremover til.

Så når du legger til en tilstand, plasser den der en hendelse faktisk ville passert gjennom den. Å ordne den feil ser ikke bare rart ut — det gjør overganger umulige.

## De forhåndsopprettede alvorlighetsgradene

Tre alvorlighetsgrader opprettes sammen med prosjektet, i denne rekkefølgen:

- **Critical Incident** (`order` 1, `#b70400`) — problemer som forårsaker svært høy påvirkning på kunder, og som krever umiddelbar respons. En full nedetid eller et datainnbrudd.
- **Major Incident** (`order` 2, `#fd625e`) — betydelig påvirkning, krever vanligvis umiddelbar respons, noen ganger med en omvei som begrenser skaden. Et viktig delsystem som svikter.
- **Minor Incident** (`order` 3, `#ffbf53`) — lav påvirkning, håndteres vanligvis innenfor arbeidstiden, og de fleste kunder merker det neppe. Et lite fall i applikasjonsytelsen.

Alvorlighetsgrad er obligatorisk når du erklærer en hendelse, og den er obligatorisk på hver hendelsesspesifikasjon i en overvåkings kriterier, så hver hendelse — manuell eller automatisk — kommer med én. Se [Opprette en hendelse](/docs/incidents/declaring-incidents) for erklæringsflyten og [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) for den overvåkingsdrevne veien.

## Å redigere alvorlighetsgrader

Gå til **Hendelser → Innstillinger → Hendelsesalvor**. Samme form som tilstandssiden — en sortert liste ordnet etter `order`, dra for å endre rekkefølge, nye alvorlighetsgrader legges til på slutten, med **Navn**, **Beskrivelse** og **Farge** i skjemaet.

To forskjeller fra tilstander:

- **Det finnes ingen slettevern.** Enhver alvorlighetsgrad kan slettes, inkludert de tre forhåndsopprettede.
- **Det finnes ingen flagg å arve.** En ny alvorlighetsgrad oppfører seg nøyaktig som de forhåndsopprettede — den er en etikett med en farge og en posisjon.

**En merknad om plassholderne.** Skjemaet for alvorlighetsgrad gjenbruker eksempelteksten fra tilstandsskjemaet ord for ord, så hintene snakker om hendelsestilstander heller enn alvorlighetsgrader. Overse dem og skriv dine egne navn og beskrivelser for alvorlighetsgrader.

Der alvorlighetsgrad gjør mer enn å beskrive: på **Hendelser → Regler → Vaktregler** er en regels felt **Hendelse Alvorligheter** et treffkriterium. Å liste **Critical Incident** der er måten «tilkall databaseteamet for alt kritisk» blir uttrykt på — vaktpolicyen bor på regelen, ikke på alvorlighetsgraden.

## Å flytte en hendelse gjennom tilstandene sine

Det er fire måter en hendelse endrer tilstand på:

- **Knappene i toppen.** Åpne en hendelse. Hvis gjeldende tilstand er før den bekreftede tilstanden, får du **Acknowledge** og **Løs**; hvis den er mellom de to, får du **Løs**. Hver av dem åpner en bekreftelsesmodal — **Acknowledge Incident** eller **Resolve Incident** — som også tilbyr **Velg notatmal**, **Offentlig notat** og **Varsle statussideabonnenter**.
- **Tilstandstidslinjen.** Legg til en rad for hånd fra hendelsens side **Tilstandstidslinje** med **Hendelsesstatus**, **Begynner den** og **Varsle statussideabonnenter**.
- **Masseendring.** Hendelseslisten har masseoperasjonen **Endre tilstand** for å flytte flere hendelser om gangen.
- **Automatisk.** Et overvåkingskriterium med **Løs hendelse automatisk** aktivert løser hendelsen sin når kriteriet ikke lenger er oppfylt, og API-et kan oppdatere tilstanden gjennom `/api/incident-state-timeline`.

Hver eneste av disse skriver en tidslinjerad. En tilstandsendring gjør også noen ting du ikke må be om: den legger en oppføring i hendelsesfeeden, tildeler en Incident Commander hvis hendelsen ikke har en ennå, og oppdaterer SLA-klokken. Å gjenåpne en løst hendelse starter en fersk SLA-registrering fra gjenåpningstidspunktet.

## Tilstandstidslinjen

Hendelsens side **Tilstandstidslinje** i hendelsens sidemeny er revisjonssporet over hver tilstand hendelsen har vært i. Kortet på den siden har tittelen **Statustidslinje**, og det er sortert nyest først.

**Kolonner:**

- **Hendelsesstatus** — en farget pille med tilstandens navn og farge.
- **Begynner den** — når hendelsen gikk inn i denne tilstanden.
- **Slutter den** — når den forlot den. Gjeldende tilstand viser `Currently Active`.
- **Varighet** — tid tilbrakt i tilstanden, regnet til nå for den gjeldende.
- **Abonnentvarselsstatus** — om statussidevarselet for denne endringen ble sendt, hoppet over eller fortsatt venter, med en lenke **flere detaljer**, og — når sendingen feilet — en **Retry**-handling.

**Radhandlinger:**

- **Vis årsak** — åpner en **Rotårsak**-modal som viser markdownen registrert med den tilstandsendringen.
- **Vis logger** — åpner en modal som forklarer hvorfor statusen endret seg, med en visning av **Hendelsestilstandslogg**.

Tidslinjerader kan opprettes og slettes, men ikke redigeres. Å slette feil rad skriver om hendelsens historikk, så behandle det som et korreksjonsverktøy heller enn en oppryddingsvane.

## Listen Aktive hendelser

**Hendelser → Aktive hendelser** er listen du følger med på gjennom et vaktskift. Definisjonen er nøyaktig én betingelse: hendelsens gjeldende tilstand er en tilstand der `isResolvedState` er usann. Ingenting annet vurderes — ikke alvorlighetsgrad, ikke alder, ikke om noen har bekreftet den.

Elementet i sidemenyen bærer en rød teller som bruker den samme spørringen, så telleren og listen er alltid enige. Når det ikke er noe å se, sier siden det.

Den praktiske konsekvensen: enhver egendefinert tilstand du legger til, holder hendelser i denne listen. Det er som regel det du vil — «Dempet» er ikke «ferdig» — men det betyr at telleren først nullstilles når hendelser faktisk når den løste tilstanden.

## Å fortelle statussideabonnenter om en tilstandsendring

En tilstandsendring kan sende e-post til statussideabonnentene dine, men den går gjennom flere porter. Å forstå dem sparer mye «hvorfor ble ingen varslet»-feilsøking.

Varsling bes om per tidslinjerad med **Varsle statussideabonnenter** (`shouldStatusPageSubscribersBeNotified`), avkrysningsboksen på modalen for tilstandsendring og på det manuelle tidslinjeskjemaet. Når den er av, lagres raden med en hoppet over-status og en forklaring. Når den er på, settes raden i kø og en bakgrunnsjobb plukker den opp — jobben kjører hvert minutt, så leveringen er rask, men ikke øyeblikkelig.

**Raden i kø hoppes så over når noe av dette gjelder:**

- **Den nye tilstanden er den opprettede tilstanden.** Abonnentene fikk allerede beskjed da hendelsen ble erklært, så den første tidslinjeraden sender bevisst ikke en melding nummer to.
- **Hendelsen har ingen overvåkinger knyttet til seg.** Uten ressurser finnes det ingen statusside å tilordne hendelsen til.
- **Hendelsen er ikke synlig på statussiden** (`isVisibleOnStatusPage` er av).
- **Statussiden har hendelser slått av** (`showIncidentsOnStatusPage` er av). Denne gjelder per statusside — andre sider som viser den samme overvåkingen blir fortsatt varslet.

**Én ting til som endrer utfallet.** Hvis du skriver et **Offentlig notat** inn i modalen for tilstandsendring, merkes tidslinjeraden som allerede varslet i stedet for å settes i kø. Selve notatet er det som når abonnentene, så de får én melding i stedet for to. Hendelsestypen bak den rene tilstandsendringsmeldingen er `Subscriber Incident State Changed`.

For hvem som mottar disse og hvordan malene velges, se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers).

## Å holde en hendelse borte fra statussiden

Tre separate ting avgjør om en hendelse er på den offentlige siden i det hele tatt, og alle tre må være sanne:

- **Vis hendelser** (`showIncidentsOnStatusPage`) på selve statussiden.
- **Synlig på statussiden** (`isVisibleOnStatusPage`) på hendelsen — en bryter på hendelsens side **Innstillinger**. Den er som standard sann og er ikke med i erklæringsveiviseren; et overvåkingskriterium kan sette den med **Vis hendelse på statussiden**.
- **Gjeldende tilstand er ikke den løste tilstanden.** Dette er det som fjerner en hendelse fra den aktive delen: statussidespørringen henter hendelser hvis gjeldende tilstand er en hvilken som helst uløst tilstand. Du arkiverer eller lukker ingenting — du løser det, og det flyttes inn i historikken.

**Private hendelser vises aldri.** Å slå på **Privat hendelse** skjuler hendelsen fra hver eneste statusside, uansett bryterne over, og begrenser den til eierne pluss prosjektadministratorer og -eiere.

Hvor mye løst historikk siden beholder, er en statussideinnstilling, ikke en hendelsesinnstilling. Se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) for hvordan overvåkingene på siden avgjør hvilke hendelser som vises i det hele tatt.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesfunksjonsområdet henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — erklæringsveiviseren, maler og API-et.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige notater, private notater og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, regler og arbeidsflyt-triggere.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får e-postene en tilstandsendring sender.
- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside viser og til hvem.
- [Oversikt over arbeidsflyter](/docs/workflows/index) — å reagere på tilstandsendringer med automatisering.
