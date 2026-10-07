# Tilstander og alvorlighetsgrader

Hver hendelse bærer to klassifiseringer: en **tilstand** som sier hvor den er i responsen din, og en **alvorlighetsgrad** som sier hvor vondt det gjør. I dashbordet ligner de på hverandre — begge vises som fargede piller i hendelseslisten, og begge er prosjektavgrensede lister du kan gi nye navn og nye farger. De gjør svært forskjellige jobber.

Tilstander styrer oppførsel. Tre boolske flagg på tilstandsradene avgjør, sammen med rekkefølgen på tilstandene, hvilke hendelser som teller som aktive, hvilke knapper som vises i hendelsestoppen, når SLA-klokken stopper, og når hendelsen faller av statussiden din. Alvorlighetsgrader styrer ingenting av seg selv — de er etiketter som beskriver påvirkning, og som andre regler kan treffe på.

Begge listene opprettes når prosjektet ditt opprettes, og begge redigeres under **Hendelser → Innstillinger**. Den delen av sidemenyen for Hendelser er sammenslått som standard, så utvid **Innstillinger** før du går og leter.

## Tilstander bærer oppførsel, alvorlighetsgrader bærer mening

Modellen `IncidentState` har `name`, `description`, `color` og `order`, pluss tre boolske verdier: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Alt produktet gjør med tilstander, henger på disse boolske verdiene og på `order` — aldri på navnet til tilstanden. Det er derfor du kan gi **Løst** navnet «Lukket» uten at noe knekker: flagget følger med raden.

Modellen `IncidentSeverity` har `name`, `description`, `color` og `order` og ingenting mer. Det finnes ingen flagg. Ingenting i OneUptime behandler **Kritisk hendelse** annerledes enn **Mindre hendelse** på egen hånd — alvorlighetsgrad betyr noe bare der du peker noe mot den, som treffkriteriet **Hendelse Alvorligheter** på en vaktregel.

Noen raske regler:

- **Velg alvorlighetsgrad for å formidle påvirkning** — den vises i hendelseslisten, på hendelsens **Oversikt**, og den er et påkrevd felt når du erklærer en hendelse.
- **Velg tilstander for å modellere prosessen din** — responstrinnene dere faktisk går gjennom, i den rekkefølgen dere går gjennom dem.
- **Ikke kod hastegrad inn i tilstander** — en tilstand som heter «Kritisk» ville ikke tilkalt noen. Alvorlighetsgrad pluss en vaktregel gjør den jobben.

## De forhåndsopprettede tilstandene

Tre tilstander opprettes sammen med prosjektet, i denne rekkefølgen. Opprettelsen er idempotent — en tilstand legges bare til når det ikke allerede finnes en med det navnet.

| Tilstand         | `order` | Flagg                 | Farge     | Hva det betyr                                      |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------- |
| **Identifisert** | `1`     | `isCreatedState`      | `#fd625e` | Tilstanden nye hendelser havner i.                 |
| **Bekreftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Noen har tatt tak i hendelsen.                     |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Hendelsen er over og slutter å telle som aktiv.    |

Merk navnet: den første tilstanden er **Identifisert**, selv om flere beskrivelser inne i produktet fremdeles kaller den den «opprettede» tilstanden. Når et dokument eller et verktøytips sier «opprettet tilstand», menes den tilstanden som bærer `isCreatedState` — i et ferskt prosjekt er det **Identifisert**.

## Hva hvert tilstandsflagg faktisk gjør

| Flagg                 | Formål                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Tilstanden en hendelse får når ingen valgte én. Hvis ingen tilstand i prosjektet bærer dette flagget, feiler opprettelsen av en hendelse med en feil som ber deg legge til en opprettet hendelsestilstand fra innstillingene. |
| `isAcknowledgedState` | Driver knappen **Acknowledge** og statistikkflisen «<tilstandsnavn> etter» på hendelsens **Oversikt**. Ved en tilstandsendring inn i denne tilstanden merkes hendelsens SLA som besvart.              |
| `isResolvedState`     | Markerer prosjektets løste tilstand: den **Løs** flytter en hendelse til, og som statistikkflisen for løsning viser. En hendelse i den, eller i en tilstand etter den, er løst — den forsvinner fra **Aktive hendelser** og fra den aktive delen av en statusside, og SLA-en merkes som løst. |

Bare én tilstand per prosjekt forventes å bære hvert av flaggene — oppslagene henter én enkelt rad. De tre flaggede tilstandene kan få nytt navn, ny farge og ny plassering, men innstillingssiden nekter å slette dem og viser en feil som navngir den opprettede, den bekreftede og den løste tilstanden.

Fordi grensesnittet leser tilstandsnavn dynamisk, endrer et navnebytte det du ser overalt — statistikkflisene, titlene i bekreftelsesdialogene og pillen i hendelseslisten følger alle navnet du ga raden.

## Å legge til dine egne tilstander

Gå til **Hendelser → Innstillinger → Hendelsesstatus**. Siden er en sortert liste ordnet stigende etter `order`, og en ny tilstand legges rett over den løste tilstanden. Dra en rad for å endre plasseringen.

**Felt på en tilstand:**

- **Navn** — påkrevd, minst to tegn. Plassholderen foreslår noe slikt som «Investigating».
- **Beskrivelse** — valgfri fritekst som forklarer når en hendelse står i denne tilstanden.
- **Farge** — påkrevd. Velges fra fargevelgeren; lagres som en heksverdi, for eksempel `#fd625e`.

Du kan ikke sette de tre flaggene fra dette skjemaet — de hører til de forhåndsopprettede radene. En tilstand du legger til, er derfor en uflagget tilstand, og det har to konsekvenser det er verdt å planlegge rundt:

- **Over den løste tilstanden holder den hendelsen aktiv.** **Aktive hendelser** rommer hendelsene der gjeldende tilstand ligger over den løste tilstanden, så en tilstand du legger til der, holder hendelsen i den aktive listen og i telleren i sidemenyen. En tilstand du drar ned under den løste tilstanden, teller som løst overalt — i de aktive listene, på statussider, i påminnelser og i SLA-en — og å flytte en hendelse dit fra **Løst** er ingen ny løsning.
- **Overgangsknappen dens er generisk.** I stedet for **Acknowledge** eller **Løs** har bekreftelsesdialogen tittelen **Merk hendelse som `<state name>`** med send-knappen **Merk som `<state name>`**.

En vanlig form er å sette inn et triage- eller demperingstrinn mellom den bekreftede og den løste tilstanden — for eksempel å dra en ny «Dempet»-tilstand slik at den ligger etter **Bekreftet** og før **Løst**.

## Rekkefølge er en reell begrensning, ikke en visningspreferanse

Kolonnen `order` håndheves når en tilstandsendring skrives, ikke bare når listen tegnes:

- **Overganger bakover avvises.** Å flytte en hendelse til en tilstand som ligger tidligere i rekkefølgen enn den gjeldende, feiler med en feilmelding som navngir begge tilstandene.
- **Å velge gjeldende tilstand på nytt avvises.** Å sette en hendelse til tilstanden den allerede står i, feiler med «Incident state cannot be same as previous state.»
- **En tilbakedatert rad kan ikke duplisere naboen sin.** Å sette inn en tidslinjerad hvis tilstand er den samme som raden som følger etter, nektes også.
- **Knappene i toppen følger de flaggede tilstandenes plassering i rekkefølgen.** **Acknowledge** og **Løs** tilbys ut fra hvor gjeldende tilstand ligger i den rekkefølgesorterte listen. En egendefinert tilstand plassert *etter* den løste tilstanden vil aldri vise en **Løs**-knapp, fordi det ikke er noe igjen å flytte fremover til.

Så når du legger til en tilstand, plasser den der en hendelse faktisk ville passert gjennom den. Feil rekkefølge ser ikke bare rart ut — den gjør overganger umulige.

## De forhåndsopprettede alvorlighetsgradene

Tre alvorlighetsgrader opprettes sammen med prosjektet, i denne rekkefølgen:

- **Kritisk hendelse** (`order` 1, `#b70400`) — problemer som gir svært stor påvirkning på kundene, og som krever umiddelbar respons. Et fullstendig avbrudd eller et datainnbrudd.
- **Større hendelse** (`order` 2, `#fd625e`) — betydelig påvirkning, som regel med behov for umiddelbar respons, iblant med en omvei som begrenser skaden. Et viktig delsystem som svikter.
- **Mindre hendelse** (`order` 3, `#ffbf53`) — liten påvirkning, håndteres som regel innenfor arbeidstiden, og de fleste kunder merker det neppe. Et lite fall i applikasjonsytelsen.

Alvorlighetsgrad er påkrevd når du erklærer en hendelse, og den er påkrevd på hver hendelsesspesifikasjon i kriteriene til en overvåking, så hver hendelse — manuell eller automatisk — kommer med én. Se [Opprette en hendelse](/docs/incidents/declaring-incidents) for erklæringsflyten og [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating) for den overvåkingsdrevne veien.

## Å redigere alvorlighetsgrader

Gå til **Hendelser → Innstillinger → Hendelsesalvor**. Samme form som tilstandssiden — en liste sortert etter `order`, dra for å endre rekkefølgen, nye alvorlighetsgrader legges bakerst, med **Navn**, **Beskrivelse** og **Farge** i skjemaet.

To forskjeller fra tilstander:

- **Det finnes ingen slettesperre.** Enhver alvorlighetsgrad kan slettes, også de tre forhåndsopprettede.
- **Det finnes ingen flagg å arve.** En ny alvorlighetsgrad oppfører seg nøyaktig som de forhåndsopprettede — den er en etikett med en farge og en plassering.

**En merknad om plassholderne.** Skjemaet for alvorlighetsgrad gjenbruker eksempelteksten fra tilstandsskjemaet ord for ord, så hintene snakker om hendelsestilstander fremfor alvorlighetsgrader. Se bort fra dem og skriv dine egne navn og beskrivelser.

Der alvorlighetsgrad gjør mer enn å beskrive: på **Hendelser → Regler → Vaktregler** er en regels felt **Hendelse Alvorligheter** et treffkriterium. Å liste **Kritisk hendelse** der er måten «tilkall databaseteamet for alt kritisk» blir uttrykt på — vaktpolicyen bor på regelen, ikke på alvorlighetsgraden.

## Å flytte en hendelse gjennom tilstandene

Det finnes fire måter en hendelse endrer tilstand på:

- **Knappene i toppen.** Åpne en hendelse. Er gjeldende tilstand før den bekreftede tilstanden, får du **Bekreft** og **Løs**; er den mellom de to, får du **Løs**. Hver av dem åpner en kort bekreftelse — **Bekreft hendelse** eller **Løs hendelse** — med **Varsle statussideabonnenter** og, foldet sammen under **Legg til et offentlig notat**, det valgfrie feltet **Offentlig notat** og velgeren **Velg notatmal** (når prosjektet har notatmaler). Bekreftelsen stopper også all vakteskalering for hendelsen.
- **Tilstandstidslinjen.** Legg til en rad for hånd fra hendelsens side **Tilstandstidslinje** med **Hendelsesstatus**, **Begynner den** og **Varsle statussideabonnenter**.
- **Masseendring.** Hendelseslisten har masseoperasjonen **Endre tilstand** for å flytte flere hendelser om gangen.
- **Automatisk.** Et overvåkingskriterium med **Løs hendelse automatisk** slått på løser hendelsen sin når kriteriet ikke lenger er oppfylt, og API-et kan oppdatere tilstanden gjennom `/api/incident-state-timeline`.

Hver eneste av disse skriver en tidslinjerad. En tilstandsendring gjør også noen ting du ikke trenger å be om: den poster en oppføring i hendelsesfeeden, tildeler en Incident Commander hvis hendelsen ikke har en ennå, og oppdaterer SLA-klokken. Å gjenåpne en løst hendelse starter en fersk SLA-post fra gjenåpningstidspunktet.

## Hva det gjør å løse en hendelse

En hendelse blir løst når den flyttes fra en tilstand over den løste tilstanden din til den løste tilstanden eller til en tilstand etter den — uansett hvilken av de fire måtene ovenfor som flytter den. Hver løsning:

- **Gir tilbake overvåkingene hendelsen holder.** En hendelse som erklæres åpen, holder overvåkingene sine: den satte dem i sin **Change Monitor Status to**-status, hvis den angir en, og satte, når den ble erklært manuelt, overvåkingen deres på pause. En redigering mens den er åpen — nye overvåkinger eller en endret status — får den også til å holde dem. Løsningen gjenopptar overvåkingen og setter dem tilbake til operativ, med mindre en annen åpen hendelse fortsatt ligger på dem, og deretter holder hendelsen ingenting. En hendelse som ble erklært allerede løst, gir derfor ingenting tilbake, og det gjør heller ikke en ny løsning etter en gjenåpning: en status overvåkingene har fått i mellomtiden — fra probene sine, fra vedlikehold eller satt for hånd — blir stående.
- **Merker SLA-en som løst** og skriver, når OneUptime AIs utkast til etteranalyse er slått på, et utkast til etteranalyse.

Å gå videre fra **Løst** til en tilstand etter den — **Lukket**, for eksempel — er ingen ny løsning: ingenting av dette kjører igjen, og ingen ny SLA starter. En hendelse som ble erklært før OneUptime begynte å registrere dette, gir tilbake overvåkingene sine ved neste løsning, som før.

## Tilstandstidslinjen

Siden **Tilstandstidslinje** i hendelsens sidemeny er revisjonssporet over hver tilstand hendelsen har vært i. Kortet på den siden har tittelen **Statustidslinje**, og det er sortert nyest først.

**Kolonner:**

- **Hendelsesstatus** — en farget pille med tilstandens navn og farge.
- **Begynner den** — når hendelsen gikk inn i denne tilstanden.
- **Slutter den** — når den forlot den. Gjeldende tilstand viser `Currently Active`.
- **Varighet** — tiden tilbrakt i tilstanden, regnet frem til nå for den gjeldende.
- **Abonnentvarselsstatus** — om statussidevarselet for denne endringen ble sendt, hoppet over eller fortsatt venter, med en lenke til **flere detaljer**, og — når utsendelsen feilet — en **Retry**-handling.

**Radhandlinger:**

- **Vis årsak** — åpner en **Rotårsak**-dialog som viser Markdown-teksten som ble registrert med den tilstandsendringen.
- **Vis logger** — åpner en dialog som forklarer hvorfor statusen endret seg, med en visning av **Hendelsestilstandslogg**.

Tidslinjerader kan opprettes og slettes, men ikke redigeres. Å slette feil rad skriver om hendelsens historie, så behandle det som et korrigeringsverktøy heller enn en oppryddingsvane.

## Listen over aktive hendelser

**Hendelser → Aktive hendelser** er listen du følger med på gjennom en vakt. Definisjonen er nøyaktig én betingelse: hendelsens gjeldende tilstand ligger over den løste tilstanden din — den første tilstanden i rekkefølgen som er flagget `isResolvedState`. Ingenting annet regnes med — ikke alvorlighetsgrad, ikke alder, ikke om noen har bekreftet den.

Elementet i sidemenyen bærer en rød teller basert på den samme spørringen, så telleren og listen er alltid enige. Når det ikke er noe å se, sier siden fra.

Den praktiske konsekvensen: en egendefinert tilstand du legger til over den løste tilstanden, holder hendelser i denne listen — «Dempet» er ikke «ferdig» — og en du plasserer etter den, tar dem ut, slik den løste tilstanden gjør. Varsler og episoder følger samme regel med sine egne tilstander, og tellerne i sidemenyen, påminnelser, statussider og mobilappen leser den alle.

## Å fortelle statussideabonnenter om en tilstandsendring

En tilstandsendring kan sende e-post til statussideabonnentene dine, men den går gjennom flere porter. Å forstå dem sparer deg for mye «hvorfor fikk ingen beskjed»-feilsøking.

Varsling bes om per tidslinjerad med **Varsle statussideabonnenter** (`shouldStatusPageSubscribersBeNotified`), avkrysningsboksen i dialogen for tilstandsendring og i det manuelle tidslinjeskjemaet. Når den er av, lagres raden med status «hoppet over» og en forklaring. Når den er på, køes raden og en bakgrunnsjobb plukker den opp — jobben kjører hvert minutt, så leveringen er rask, men ikke øyeblikkelig.

**Den køede raden hoppes deretter over når noe av dette gjelder:**

- **Den nye tilstanden er den opprettede tilstanden.** Abonnentene fikk allerede beskjed da hendelsen ble erklært, så den første tidslinjeraden sender bevisst ikke en melding nummer to.
- **Hendelsen har ingen overvåkinger knyttet til seg.** Uten ressurser finnes det ingen statusside å plassere hendelsen på.
- **Hendelsen er ikke synlig på statussiden** (`isVisibleOnStatusPage` er av).
- **Statussiden har hendelser slått av** (`showIncidentsOnStatusPage` er av). Denne gjelder per statusside — andre sider som viser den samme overvåkingen får fortsatt varsel.

**Én ting til som endrer utfallet.** Skriver du et **Offentlig notat** i dialogen for tilstandsendring, merkes tidslinjeraden som allerede varslet i stedet for å køes. Det er selve notatet som når abonnentene, så de får én melding i stedet for to. Den meldingen nevner den nye tilstanden på hver kanal, slik tilstandsendringsmeldingen ville ha gjort: for eksempel `[Resolved Incident] <title>` i e-postens emne og `**Status:** Resolved` i Slack og Microsoft Teams. Notatet krever tillatelse til å opprette offentlige notater: uten den tilbyr dialogen ikke notatet, og en tilstandsendring sendt med et notat avvises, så tilstanden forblir uendret. Hendelsestypen bak den rene tilstandsendringsmeldingen er `Subscriber Incident State Changed`.

Varsler, varselepisoder og hendelsesepisoder tilbyr i stedet et privat notat ved et tilstandsskifte (**Legg til et privat notat**), og det virker på samme måte: notatet krever sin egen tillatelse (**Create Alert Internal Note**, **Create Alert Episode Internal Note** eller **Create Incident Episode Internal Note** i en egendefinert rolle; de innebygde varsel-, hendelses- og prosjektrollene har dem), og et tilstandsskifte sendt med et privat notat av noen uten den, avvises helt, så tilstanden forblir uendret.

For hvem som mottar disse og hvordan malene velges, se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers).

## Å holde en hendelse borte fra statussiden

Tre separate ting avgjør om en hendelse i det hele tatt vises på den offentlige siden, og alle tre må være sanne:

- **Vis hendelser** (`showIncidentsOnStatusPage`) på selve statussiden.
- **Synlig på statussiden** (`isVisibleOnStatusPage`) på hendelsen — en bryter på hendelsens side **Innstillinger**. Den er sann som standard og finnes ikke i erklæringsveiviseren; et overvåkingskriterium kan sette den med **Vis hendelse på statussiden**.
- **Gjeldende tilstand ligger over den løste tilstanden.** Det er dette som fjerner en hendelse fra den aktive delen: statussidespørringen henter hendelser der gjeldende tilstand ligger over den løste tilstanden din, så den løste tilstanden og enhver tilstand etter den fjerner hendelsen. Du arkiverer eller lukker ingenting — du løser den, og den flytter seg over i historikken.

**Private hendelser vises aldri.** Å slå på **Privat hendelse** skjuler hendelsen fra hver eneste statusside, uansett bryterne over, og begrenser den til eierne pluss prosjektadministratorer og prosjekteiere.

Hvor mye løst historikk siden beholder, er en innstilling på statussiden, ikke på hendelsen. Se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) for hvordan overvåkingene på siden avgjør hvilke hendelser som i det hele tatt vises.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hvordan hendelsesområdet henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — erklæringsveiviseren, malene og API-et.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed) — offentlige notater, private notater og aktivitetsfeeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — maler, egendefinerte felt, regler og arbeidsflyt-triggere.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvem som får e-postene en tilstandsendring sender.
- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside viser, og for hvem.
- [Oversikt over arbeidsflyter](/docs/workflows/index) — å reagere på tilstandsendringer med automatisering.
