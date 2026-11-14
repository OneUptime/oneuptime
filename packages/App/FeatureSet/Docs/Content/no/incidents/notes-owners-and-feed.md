# Hendelsesnotater, eiere og feed

Hver hendelse samler en skriftlig oversikt mens du jobber med den: oppdateringer til kundene dine, arbeidsnotater til teamet ditt og en aktivitetsfeed over alt som skjedde. Denne siden dekker hvordan du skriver offentlige og private notater, hvem hvert av dem når, hendelsens feed og eierne som får beskjed om hver endring.

:::cards
- [Publiser et offentlig notat](#publiser-et-offentlig-notat): Fortell kundene hva du vet, på statussiden og med et varsel.
- [Når abonnentene får beskjed](#når-et-offentlig-notat-faktisk-når-abonnentene): Kontrollene et offentlig notat passerer, og merket.
- [Hendelsens feed](#hendelsens-feed): Tidslinjen over alt som skjedde.
- [Eiere](#eiere): Hvem som har ansvaret, og hva de får vite.
:::

## Slik fungerer det

Noe av det du skriver, er til kundene dine — oppdateringen som går ut på statussiden klokken 02:14 og sier at du har funnet den dårlige utrullingen. Resten er til teamet ditt — stakksporet noen limte inn, grafen som endelig ga mening, beslutningen om å bytte over. OneUptime holder de to målgruppene adskilt og registrerer begge på hendelsen.

```mermaid title="Hvem som leser det du skriver på en hendelse"
flowchart TB
    subgraph write["Det du skriver"]
        direction LR
        public["Offentlig notat"]
        private["Privat notat"]
    end
    public --> page["Statusside<br/>og abonnenter"]
    public --> owners["Hendelsens eiere"]
    private --> owners
    public --> feed["Hendelse Feed"]
    private --> feed
```

**Offentlige notater** publiseres på statussiden din og kan gi abonnentene beskjed. **Private notater** (modellen `IncidentInternalNote`) blir værende inne i dashbordet. Under begge ligger **Hendelsesfeed**, en tidslinje du bare kan legge til i, som registrerer alt som skjedde med hendelsen, og listen **Eiere**, som avgjør hvem som får beskjed.

Alt henger på hendelsens sidemeny: **Notater → Offentlige notater**, **Notater → Private notater** og **Team → Eiere**. Feeden ligger på hendelsens side **Oversikt**.

## Offentlige notater mot private notater

De to typene notater ser like ut i dashbordet og oppfører seg svært forskjellig.

|                          | Offentlig notat                                                     | Privat notat                                                    |
| ------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Modell                   | `IncidentPublicNote`                                                | `IncidentInternalNote`                                          |
| Vises på statussider     | Ja, som en del av hendelsens tidslinje                              | Aldri — ingenting i statussideappen leser dem                   |
| Publiseringstidspunkt    | `postedAt`, som du kan sette selv                                   | Ingen: stemplet og sortert etter `createdAt`                    |
| Gir abonnenter beskjed   | Når **Varsle abonnentene på statussiden** er slått på                  | Aldri: det har ingen felt for abonnenter i det hele tatt        |
| Vedlegg tilgjengelige for | Statussidens besøkende, via en rute på statussiden                 | Bare det autentiserte dashbord-API-et                           |
| Gir eiere beskjed        | Ja                                                                  | Ja                                                              |

**Hva "privat" faktisk betyr.** Det betyr "ikke publisert på statussiden" — ikke "begrenset til en mindre gruppe personer". De innebygde rollene som kan lese en hendelse, leser begge typer notater, så alle som kan lese hendelsen, kan vanligvis også lese de private notatene; i en egendefinert rolle er det separate tillatelser, **Read Incident Status Page Note** og **Read Incident Internal Note**. Må du begrense hvem som i det hele tatt kan se en hendelse, bruker du flagget **Privat hendelse** (`isPrivate`) på selve hendelsen, som skjuler hendelsen for alle statussider og begrenser den til brukerne som eier den, medlemmene av teamene som eier den, og prosjektadministratorer og prosjekteiere. En privat hendelse tar ingen offentlige notater i det hele tatt: se [Private hendelser tar bare private notater](#private-hendelser-tar-bare-private-notater).

**Eierne ser begge.** Jobben som gir eierne beskjed, henter offentlige og private notater sammen. Et privat notat er privat for abonnentene dine, ikke for dem som responderer.

| Hvis du vil …                                          | Velg             |
| ------------------------------------------------------ | ---------------- |
| Fortelle kundene hva du vet, og når du vet mer         | **Offentlig notat** |
| Tilbakedatere en oppdatering du allerede har sendt et annet sted | **Offentlig notat** |
| Registrere en hypotese, en kommando du kjørte, eller en blindvei | **Privat notat** |
| Legge ved en heap dump eller et skjermbilde av et internt dashbord | **Privat notat** |

## Publiser et offentlig notat

:::steps
### Åpne de offentlige notatene

Åpne hendelsen, og velg **Notater → Offentlige notater** i sidemenyen. Redigeringsverktøyet over notatene sier hvem som leser notatet før du publiserer det: **Public · Visible on your status page**.

### Skriv oppdateringen

Skriv notatet i Markdown, eller start fra en av **Maler** eller fra **Utkast med KI**. Legg til filer med **Legg ved** hvis abonnentene skal se dem.

### Bestem hvem som får beskjed

La **Varsle abonnentene på statussiden** være avkrysset for å gi abonnentene beskjed, eller fjern haken for å publisere stille. **Varsler** under den viser hvilke statussider notatet når, og **Forhåndsvisning** viser e-posten de får.

### Publiser det

Klikk på **Publiser oppdatering**, eller trykk Ctrl+Enter (⌘+Enter på en Mac). Notatet vises øverst i listen, med et merke som følger varselet.
:::

Det samme redigeringsverktøyet åpner i en dialog fra **Legg til offentlig notat** i menyen **Handlinger** i hendelsens feed (se [Hendelsens feed](#hendelsens-feed)), så et notat skrives på samme måte fra begge steder.

| Element                            | Formål                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Notatet                            | Teksten, i Markdown. Påkrevd.                                                                                                                 |
| **Maler**                          | Setter en av notatmalene dine inn i notatet, etter det du allerede har skrevet. Se [Notatmaler](#notatmaler).                             |
| **Utkast med KI**                  | Skriver et utkast til notatet ut fra hendelsen, som du redigerer. Se [Generer et notat med KI](#generer-et-notat-med-ki).                    |
| **Legg ved**                         | Filer som deles med abonnentene på statussiden. Valgfritt.                                                                                    |
| **Publisert nå**                     | Når notatet sier at det ble publisert: øyeblikket du publiserer det, med mindre du velger et tidligere tidspunkt her, i din gjeldende tidssone. |
| **Varsle abonnentene på statussiden** | Avkrysningsboks. Slått på som standard, med mindre hendelsen ble erklært uten å gi abonnentene beskjed — da starter den slått av. Slå den av for å publisere stille. |

**Stille hendelser forblir stille.** Ble en hendelse erklært med **Varsle statussideabonnenter** slått av (eller som en privat hendelse), har abonnentene aldri fått beskjed om den, så et offentlig notat bør ikke være det første de hører. På en slik hendelse starter avkrysningsboksen slått av, med en linje under som forklarer hvorfor. Du kan fortsatt krysse av for å gi abonnentene beskjed om det notatet. Notater som publiseres uten et uttrykkelig valg, følger samme regel: notater fra Slack og Microsoft Teams, arbeidsflyter og API-forespørsler som utelater `shouldStatusPageSubscribersBeNotifiedOnNoteCreated`. En uttrykkelig `true` eller `false` beholdes alltid. Offentlige notater på [planlagte vedlikeholdshendelser](/docs/status-pages/subscribers#planlagte-vedlikeholdshendelser) og [hendelsesepisoder](/docs/status-pages/subscribers#hendelsesepisoder) følger en lignende regel, basert på om hendelsen eller episoden selv ga abonnentene beskjed da den ble opprettet. En privat hendelse eller episode tar ingen offentlige notater i det hele tatt.

**Se hvem notatet når.** Mens **Varsle abonnentene på statussiden** er avkrysset, viser en linje **Varsler** under den statussidene notatet går til, med et «opptil»-antall abonnenter per kanal, og sidene som viser hendelsens monitorer, men ikke får beskjed, med årsaken. Får ingen beskjed, viser den ingenting, med mindre hendelsen er skjult for statussider eller statussideomfanget er årsaken. Den følger hendelsens statussideomfang, så et notat på en hendelse som er begrenset til to lokasjonssider, sier at det når de to. Se [Én statusside per målgruppe](/docs/status-pages/one-status-page-per-audience).

**Se hva de får.** Ved siden av den samme avkrysningsboksen viser **Forhåndsvisning** e-posten abonnentene på hver av de statussidene får for notatet du skriver, og hvilken mal den bruker og hvorfor. Den forblir grå til notatet har litt tekst. **Send test til meg** sender den e-posten til e-postadressen til din egen konto, og til ingen andre. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers#forhåndsvis-e-posten-før-den-sendes).

> [!TIP]
> **Publiseringstidspunktet er notatets egentlige tidsstempel.** Statussider sorterer og viser offentlige notater etter `postedAt`, ikke etter når du skrev dem — så hvis du oppdaterer statussiden med en oppdatering du sendte for 40 minutter siden, velger du **Publisert nå** og setter når det faktisk skjedde. Kommer et notat inn via API-et (`/api/incident-public-note`) uten et tidspunkt, stempler OneUptime gjeldende tidspunkt.

Hvert notat viser hvem som skrev det, publiseringstidspunktet, den gjengitte Markdown-en med vedleggene og, i overskriften, hvordan det står til med varselet til abonnentene. **Søk i notater…** finner notater etter hva de sier, og feeden kan leses med de nyeste eller de eldste først. Lenker til andre nettsteder og til vedlegg åpnes i en ny fane. Linjer som begynner med `>`, vises som et sitat; start det med en egen linje, `> [!NOTE]`, `> [!TIP]` eller `> [!WARNING]`, for å vise det som en uthevet boks i stedet.

## Publiser et privat notat

**Notater → Private notater** er bevisst enklere. Det er det samme redigeringsverktøyet, som sier **Privat · Bare de som kan se denne hendelsen, kan lese det**, med notatet, **Maler**, **Utkast med KI** og **Legg ved** for filer, som bare de som kan lese notatet, kan åpne. **Legg til privat notat** i menyen **Handlinger** i hendelsens feed åpner det i en dialog. Via API-et er private notater `/api/incident-internal-note`.

Ikke noe publiseringstidspunkt, ingen avkrysningsboks for abonnenter — notatet stemples når det opprettes.

Begge typer notater skrives i Markdown-redigeringsverktøyet, som nester listepunkter med **Øk innrykk** og **Reduser innrykk** — eller Tab og Shift+Tab — og beholder listene, lenkene og formateringen fra det du limer inn fra Word, Google Docs eller en annen OneUptime-side. Ctrl+Z angrer et innrykk, og i visuell modus også blokkene og innlimingene redigeringsverktøyet satte inn, i rekkefølge med det du skrev. En kodeblokk som kopieres fra et notat, limes inn igjen som en kodeblokk, og et ord som kopieres ut av en, som innebygd kode. Se [Opprette en hendelse](/docs/incidents/declaring-incidents#trinn-1-hendelsesdetaljer).

## Private hendelser tar bare private notater

En privat hendelse er ikke på noen statusside og gir ingen abonnenter beskjed (se [Hold en hendelse borte fra statussiden](/docs/incidents/states-and-severities#hold-en-hendelse-borte-fra-statussiden)), så et offentlig notat på den ville ikke nå noen av dem det ble skrevet for. OneUptime tilbyr derfor ikke noe:

- **Siden med offentlige notater** sier "Denne hendelsen er privat, så det kan ikke legges til offentlige notater på den. Bruk et privat notat." der redigeringsfeltet var, med knappen **Legg til privat notat**, som åpner de private notatene. **Legg til offentlig notat** i feedens meny **Handlinger** er låst og sier det samme.
- **Når tilstanden endres**, bretter dialogen et privat notat inn under **Legg til et privat notat** i stedet for det offentlige, og spør ikke om abonnenter. Massehandlingen **Endre tilstand** legger notatet sitt til som et privat notat på hver private hendelse den flytter, og gir ingen beskjed om dem.
- **I Slack og Microsoft Teams** lagrer en 📣 eller 📢 på en melding i kanalen meldingen som et privat notat, og bekreftelsen sier hvorfor.
- **Gjennom API-et, arbeidsflyter og OneUptime AI** avvises et offentlig notat på den med den samme setningen, og en tilstandsendring sendt med et slikt notat avvises i sin helhet, så tilstanden ikke endres. En SLA-regels påminnelser om offentlige notater venter til den er offentlig igjen; de private påminnelsene publiseres som vanlig.

Offentlige notater som ble publisert før hendelsen ble gjort privat, blir værende. Du kan fortsatt lese, redigere og slette dem, men ingenting tilbyr å gi abonnenter beskjed om dem. Gjør hendelsen offentlig igjen, så vises de på statussidene igjen, og nye offentlige notater kan legges til. Hendelsesepisoder fungerer på samme måte.

## Vedlegg på notater

Begge typer notater tar imot vedlegg via redigeringsverktøyets knapp **Legg ved**, og begge viser en liste over vedlegg under notatets tekst med en lenke **Download attachment** per fil.

Der de skiller lag, er hvem som kan hente filen:

- **Vedlegg på offentlige notater** kan lastes ned av statussidens besøkende via en rute på statussiden, sammen med selve notatet.
- **Vedlegg på private notater** kan bare nås via det autentiserte dashbord-API-et. Det finnes ingen rute på statussiden for dem.

Det gjør vedlegg til det samme valget mellom offentlig og privat som notatets tekst. Et bilde til tidslinjen som kundene ser, hører hjemme på et offentlig notat; en konfigurasjonsdump på et privat.

Bilder følger det samme valget. Et bilde du limer inn eller drar inn i et notat, eller legger til med **Last opp bilde**, lagres i hendelsens prosjekt og vises inne i notatet, og hvem som kan se det, følger notatet:

- **I et privat notat** — eller i et offentlig notat før det er publisert — vises et bilde bare for prosjektets medlemmer, pålogget slik prosjektet krever. Alle andre som åpner adressen, ser ingenting, som om det ikke fantes noe bilde der.
- **I et offentlig notat** vises et bilde for alle som kan se notatet: på statussiden og i e-postene abonnentene får. Et offentlig notat vises med hendelsen sin, aldri uten: mens hendelsen er skjult for statussider eller privat, vises bildene i notatene også bare for prosjektets medlemmer.

Hver opplasting starter privat, fra dashbordet og fra API-et. Et bilde kan bare ses av alle så lenge noe statussidene dine viser, har det i seg: et offentlig notat mens hendelsen, episoden eller den planlagte vedlikeholdshendelsen vises på statussider, en kunngjøring fra tidspunktet den begynner å vises, hendelsens beskrivelse mens hendelsen er **Synlig på statussiden** og ikke privat, etteranalysen når den også er publisert der, beskrivelsen av en episode eller en planlagt vedlikeholdshendelse mens den vises på statussider (aldri mens episoden er privat), og statussidens egne beskrivelser av oversikt, grupper og ressurser. Når det opphører — hendelsen skjules eller gjøres privat, bildet redigeres ut, notatet eller hendelsen slettes — er bildet privat igjen, med mindre noe annet statussidene dine viser, fortsatt har det i seg. Beskrivelsen og takkemeldingen til et skjema viser bildene sine for alle på samme måte, mens skjemaet tar imot innsendinger.

Å lese et notat via API-et, Terraform eller en arbeidsflyt viser bare vedleggene leseren kan åpne: filer fra notatets prosjekt og offentlige filer. Et vedlegg som et notat nevner fra et annet prosjekt, utelates fra listen, som om notatet ikke hadde det.

## Generer et notat med KI

Redigeringsverktøyet har en knapp **Utkast med KI**, på begge notatsidene og i feedens dialoger **Legg til offentlig notat** og **Legg til privat notat**. Den sender hendelsen til prosjektets KI-leverandør og setter den genererte Markdown-en inn i notatet, der du redigerer den før du publiserer — ingenting publiseres automatisk.

| Dialog                             | Hva den skriver                                                      | Maler                                                             |
| ---------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Lag offentlig notat med AI**   | Et notat til kundene, ut fra en analyse av hendelsens data.          | **Status Update**, **Resolution Notice**, **Maintenance Update**  |
| **Lag privat notat med AI**  | Et internt teknisk notat.                                            | **Investigation Update**, **Technical Analysis**, **Shift Handoff** |

Bak knappen sender dashbordet en forespørsel til `/incident/generate-note-from-ai/{incidentId}` med den valgte malen og en notattype `public` eller `internal`.

Det som sendes, er hendelsens tekst. Et bilde eller en fil som er innebygd i den — et skjermbilde limt inn i beskrivelsen for eksempel — erstattes av en kort merknad som `[image omitted: PNG, 340 KB]`, og hvert tekstfelt kortes ned til 16 000 tegn, slik at én stor innliming aldri fortrenger resten. Selve hendelsen beholder bildene sine.

## Notatmaler

Skriver teamet ditt de samme tre oppdateringene ved hvert avbrudd, lagrer du dem én gang. Redigeringsverktøyets meny **Maler** viser dem, på begge notatsidene og i feedens notatdialoger, og velger du en, settes den inn i notatet.

Maler deles mellom offentlige og private notater: én liste over maler dekker begge, og den samme malen kan settes inn i begge typer notater.

Plassholdere i en mal — `{{incident.title}}`, `{{incident.state}}`, `{{incident.customFields.impact}}` og de andre som er oppført under [Notatmaler](/docs/incidents/settings#notatmaler) — fylles ut med hendelsens gjeldende verdier når du velger den, både på notatsidene og i dialogene **Bekreft** og **Løs**. Det du allerede hadde skrevet, endres aldri, og en plassholder uten verdi blir stående slik den er skrevet.

> [!IMPORTANT]
> Les det utfylte notatet før du publiserer et offentlig: `{{incident.affectedStatusPages}}` nevner hver statusside hendelsen når, og abonnentene på alle sammen leser det.

Du administrerer dem under **Hendelser → Innstillinger → Notatmaler** — kortet heter **Maler for offentlige eller private notater for hendelser**, og skjemaet er én side: **Malnavn** og **Malbeskrivelse**, begge påkrevd, og deretter teksten. Før du har noen, sier menyen **Maler** det og lenker dit.

## Publiser notater fra Slack eller Microsoft Teams

Har du koblet til et arbeidsområde, trenger de som responderer, aldri å forlate kanalen. Både Slack og Microsoft Teams har en handling for å legge til et notat som åpner en dialog med en nedtrekksliste **Note Type** — **Public Note** (publisert på statussiden) eller **Private Note** (bare de som kan se hendelsen, kan lese det) — og et tekstfelt **Note**, og som skriver resultatet rett på hendelsen. På en privat hendelse spør den ikke om **Note Type** og legger til et privat notat: se [Private hendelser tar bare private notater](#private-hendelser-tar-bare-private-notater).

Tre detaljer det er verdt å kjenne til:

- **Beskyttelse mot duplikater** — hvert notat registrerer Slack-meldingen det kom fra (`postedFromSlackMessageId`, i formatet `channel_id:message_ts`), så flere personer som reagerer på den samme meldingen, gir ett notat, ikke fem.
- **Notater kommer tilbake** — å publisere begge typer notater sender også en melding inn i den tilkoblede hendelseskanalen, fordi notatets feedoppføring opprettes med varsling til arbeidsområdet slått på. Et offentlig notat som venter på godkjenning, sendes dit når det er publisert: se [Godkjenning av offentlige notater](#godkjenning-av-offentlige-notater).
- **Publisert som den som spurte** — et notat fra dialogen eller fra en reaksjon publiseres med den personens OneUptime-tillatelser, så det krever vedkommendes tillatelse til å publisere den typen notat på hendelsen. Avvises det, får vedkommende vite hvorfor — i en direktemelding i Slack, og i samtalen i Microsoft Teams (i meldingens tråd, for en reaksjon) — og ingenting publiseres.

## Når et offentlig notat faktisk når abonnentene

Å opprette et offentlig notat med **Varsle statussideabonnenter** slått på garanterer ikke i seg selv at en e-post går ut. Notatet må gjennom en kjede av kontroller, og hver feil registrerer en bestemt årsak i stedet for å gi en feil:

```mermaid title="Kontrollene et offentlig notat passerer før abonnentene får høre om det"
flowchart TB
    note["Offentlig notat publisert"] --> box{"Varselboksen slått på?"}
    box -->|Nei| skipped["Abonnenter ikke varslet"]
    box -->|Ja| incident{"Hendelse på statussider?"}
    incident -->|Nei| skipped
    incident -->|Ja| pages{"Side innenfor omfanget?"}
    pages -->|Nei| skipped
    pages -->|Ja| prefs{"Abonnent påmeldt?"}
    prefs -->|Ja| sent["Melding sendt"]
```

1. **Varsle statussideabonnenter** må være slått på. Er den ikke det, stemples notatet som hoppet over i det øyeblikket det opprettes. Den starter slått av på hendelser som ble erklært uten å gi abonnentene beskjed.
2. Notatet må høre til en hendelse som fortsatt finnes.
3. Hendelsen må ha minst én monitor knyttet til seg — uten monitorer finnes det ingen ressurs på en statusside å sende notatet til.
4. Hendelsens flagg **Synlig på statussiden** (`isVisibleOnStatusPage`) må være sant, og hendelsen må ikke være privat (`isPrivate`). En privat hendelse er skjult for alle statussider, uansett hva flagget sier — se [Hold en hendelse borte fra statussiden](/docs/incidents/states-and-severities#hold-en-hendelse-borte-fra-statussiden).
5. Hver statusside hendelsen når, må ha **Vis hendelser** (`showIncidentsOnStatusPage`) slått på. Sidene den når, er de som viser monitorene, snevret inn til sidene hendelsen er begrenset til, hvis det finnes noen. En hendelse som ikke er begrenset til noen side, hopper over sidene som bare viser hendelser som er begrenset til dem. Se [Én statusside per målgruppe](/docs/status-pages/one-status-page-per-audience).
6. Hver abonnent må komme gjennom sine egne preferanser — ikke avmeldt, og påmeldt denne ressursen og hendelsestypen `Incident` der siden lar abonnentene velge.

> [!NOTE]
> **Varsler er ikke umiddelbare.** Jobben som sender dem, kjører én gang i minuttet, så regn med opptil omtrent ett minutt mellom lagring av notatet og at e-posten går. Det er det **Varsler abonnentene snart** betyr på et notat, og **Sending Soon** på hendelsens egne varsler.

Overskriften til et offentlig notat følger hele reisen med et merke. Klikk på det for varselets statusmelding, som sier hva som skjedde:

| Merke                          | Hva det betyr                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Abonnentene er ikke varslet**   | Ingenting ble sendt: notatet ble publisert med **Varsle statussideabonnenter** uten hake, eller en av portene ovenfor stengte. Årsaken er registrert. |
| **Varsler abonnentene snart** | I kø, venter på neste kjøring av sendejobben.                                                                                                     |
| **Varsler abonnentene**      | Jobben arbeider seg gjennom listen over abonnenter.                                                                                               |
| **Abonnentene er varslet**       | Meldingen til hver abonnent ble sendt. Statusmeldingen viser per statusside hvor mange som gikk på hver kanal.                                    |
| **Varsling mislyktes**        | Ikke alle abonnentene fikk den sendt, eller jobben stoppet med en feil. Statusmeldingen sier hvilken.                                             |

**Sendt betyr sendt.** Jobben venter på hver melding: en e-post eller en SMS teller som sendt når e-postserveren eller SMS-leverandøren har tatt imot den, og en melding til Slack, Microsoft Teams eller en webhook når den andre siden har svart. En melding som avvises, gir en feil eller ikke får svar innen 4 minutter, teller som feilet, og én feil setter merket til **Varsling mislyktes**; de andre abonnentene får den fortsatt sendt. Statusmeldingen lyder da for eksempel `Not every subscriber was sent this notification: 2 of 61 messages failed. Site 03: 41 email sent. Site 07: 16 email, 2 SMS sent; 2 email failed.` "Sendt" er så langt OneUptime kan se: en e-postserver kan fortsatt returnere en e-post senere.

:::details Store sider og lange sendinger
Abonnentene til en statusside leses 10 000 om gangen til alle er nådd, og 20 meldinger er underveis samtidig. Ett varsel slutter å starte nye meldinger etter 20 minutter: det som ikke ble nådd innen da, listes opp, og varselet merkes som **Varsling mislyktes**. En sending som ble avbrutt underveis — serveren startet på nytt eller sluttet å svare — merkes også som **Varsling mislyktes**, med en melding som begynner med `Interrupted:`, når den har stått på **Varsler abonnentene** i 40 minutter, slik at den aldri blir hengende for alltid. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers#sjekk-hva-som-ble-sendt).
:::

### Send varselet for et notat på nytt

Klikk på varselmerket til et notat for å se hva som skjedde. Et notat der varselet feilet, tilbyr **Prøv varsel på nytt**, og et der varselet gikk ut, tilbyr **Send varsel på nytt**. Begge spør først: bekreftelsen viser statussidene notatet ville nådd nå, med et «opptil»-antall per kanal, eller sier at det ikke ville nådd noen, og sier hva som skjer. Begge setter notatet tilbake i ventende tilstand slik at neste kjøring plukker det opp, og sender det til hver statusside hendelsen når nå, også til abonnentene som allerede har fått det. Har du endret sidene hendelsen er begrenset til siden notatet ble publisert, går det til sidene den er begrenset til nå. Et notat som ble publisert med **Varsle statussideabonnenter** uten hake, tilbyr ingen av dem, fordi det aldri var ment å bli sendt, og ingen av dem tilbys mens et varsel fortsatt står i kø eller blir sendt. Offentlige notater på planlagte vedlikeholdshendelser og hendelsesepisoder beholder bare **Prøv varsel på nytt** etter en feil.

Å sende varselet for et notat på nytt forteller hver abonnent hva notatet sier, slik publiseringen gjorde, så det krever tillatelsen til å publisere offentlige notater som gir abonnentene beskjed, i tillegg til tillatelsen til å redigere offentlige notater. Via API-et er det den samme oppdateringen dashbordet gjør, som setter `subscriberNotificationStatusOnNoteCreated` tilbake til `Pending`; den avvises for en kaller uten de tillatelsene, for et notat som ble publisert uten å gi abonnentene beskjed, og mens varselet for notatet blir sendt.

:::details Hvordan hendelsens varsel 'opprettet' fortsetter
Bare hendelsens varsel 'opprettet' fortsetter der det stoppet: det holder rede på statussidene det er sendt fullt ut til, og **Prøv på nytt** på hendelsens **Oversikt** hopper over dem. Det registreres per statusside, ikke per abonnent, så en side det stoppet midt i, får det sendt fullt ut på nytt, også abonnentene på den siden som allerede har fått det. Bekreftelsen for **Prøv på nytt** tilbyr **Send det på nytt til alle statussider, også sidene som allerede er nådd**, som gjør det til **Send på nytt til alle sider**, og **Send på nytt** etter et vellykket utfall sender det til hver side igjen. Se [Én statusside per målgruppe](/docs/status-pages/one-status-page-per-audience#å-legge-til-statussider).
:::

### Rediger et offentlig notat

**Å redigere et offentlig notat skjer stille, med mindre du ber om noe annet.** Notatets redigeringsskjema har en avkrysningsboks **Varsle abonnenter om denne oppdateringen**, uten hake hver gang. Kryss av for en endring abonnentene trenger å vite om, så får de det redigerte notatet, merket som en oppdatering; notatet viser da et andre merke for oppdateringen ved siden av det opprinnelige, med sitt eget **Prøv varsel på nytt** etter en feil:

| Merke for oppdateringen        | Hva det betyr                                       |
| ------------------------------ | --------------------------------------------------- |
| **Oppdatering i kø**           | Venter på neste kjøring av sendejobben.             |
| **Sender oppdatering**         | Jobben arbeider seg gjennom listen over abonnenter. |
| **Oppdatering sendt**          | Hver abonnent fikk det redigerte notatet sendt.     |
| **Oppdatering mislyktes**      | Ikke alle abonnentene fikk det sendt.               |
| **Oppdatering ikke sendt**     | En av portene ovenfor stoppet den.                  |

En sendt oppdatering tilbys ikke igjen: rediger notatet med avkrysningsboksen avkrysset for å sende den nyeste teksten, eller send selve notatet på nytt. Er det opprinnelige varselet ikke sendt ennå, går det ingen separat oppdatering ut — det opprinnelige tar med seg redigeringen. Blir det sendt akkurat da, venter oppdateringen til det er ferdig, og går deretter ut. Avkrysningsboksen og oppdateringens **Prøv varsel på nytt** krever de samme tillatelsene som å sende varselet for notatet på nytt; uten dem kan du fortsatt redigere notatet uten å gi noen beskjed. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers#varsle-abonnenter-om-en-redigering).

Den faktiske meldingen abonnentene får, bygges med en mal per statusside og per kanal — e-post, SMS, Slack og Microsoft Teams har hver sin mal for hendelsen **Subscriber Incident Note Created**, med variabler for statussidens navn og URL, lenken til detaljene, de berørte ressursene, hendelsens alvorlighetsgrad og tittel, notatets tekst, hendelsens etiketter, berørte statussider og egendefinerte felt, og en avmeldingslenke per abonnent. Standardmeldingene per e-post, i Slack og i Microsoft Teams viser også hendelsens egendefinerte felt som er merket med **Ta med i abonnentvarsler**, med gjeldende verdier. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) for hvordan de malene og kanalene settes opp.

## Godkjenning av offentlige notater

Et prosjekt kan få de offentlige notatene sine godkjent før kundene leser dem, slik at noen sjekker en oppdatering, for eksempel om et sikkerhetsbrudd, før den går ut. Godkjenning er slått av til en prosjekteier eller -administrator slår den på og velger hvem som godkjenner: under **Hendelser → Innstillinger → Godkjenning av offentlige notater** for hendelser og hendelsesepisoder, og under **Planlagt vedlikehold → Innstillinger → Godkjenning av offentlige notater** for planlagte vedlikeholdshendelser. Se [Godkjenning av offentlige notater](/docs/incidents/settings#godkjenning-av-offentlige-notater).

Mens den er slått på, sier redigeringsverktøyet at notatet publiseres når det er godkjent, og nevner hvem som godkjenner det, og **Publiser oppdatering** blir til **Send til godkjenning**. Notatet lagres med merket **Venter på godkjenning** og viser under det hvem som kan godkjenne det, og ved flere trinn hvilket det venter på. Til det er godkjent, gjelder dette for et notat:

- det vises ikke på noen statusside, og ikke i noen av RSS- og Atom-feedene deres;
- det varsler ingen abonnenter: varselet sendes når det publiseres, hvis **Varsle abonnentene på statussiden** var krysset av. Se [Offentlige notater som venter på godkjenning](/docs/status-pages/subscribers#offentlige-notater-som-venter-på-godkjenning);
- det publiseres ikke i hendelsens Slack-, Microsoft Teams- eller Mattermost-kanaler, og eierne får først vite om det når det er publisert;
- det starter ingen arbeidsflyt og holdes utenfor det OneUptime AI leser, så det aldri dukker opp i et utkast til notat;
- bildene vises bare for prosjektets medlemmer.

Hvert nye offentlige notat venter, uansett hvor det skrives: i dashbordet, gjennom API-et, av en arbeidsflyt eller OneUptime AI, fra Slack, Microsoft Teams eller Mattermost, av en SLA-regels påminnelse eller sammen med et tilstandsskifte.

**Godkjenne og avvise.** Personene som trinnet et notat venter på, nevner, og medlemmene av teamene det nevner, ser **Godkjenn** og **Avvis** på notatet, og får vite at det venter gjennom varslingsinnstillingene de har valgt: se [Godkjenning av offentlige notater](/docs/notifications/notification-settings#godkjenning-av-offentlige-notater). På det siste trinnet heter **Godkjenn** i stedet **Godkjenn og publiser**, og notatet publiseres med en gang, datert til øyeblikket det publiseres, med mindre tidspunktet ble valgt da det ble skrevet. Når det er publisert, har det merket **Godkjent** og en linje som nevner hvem som godkjente det, og oppføringen i feeden og meldingen i hendelsens kanaler slutter med de samme navnene. **Avvis** spør **Hvorfor avviser du det?**, og den som skrev notatet, ser begrunnelsen. Ingen godkjenner eller avviser et notat de selv har sendt, ingen godkjenner to trinn av det samme notatet, og en API-nøkkel godkjenner ingenting: godkjennere er mennesker.

**Send det på nytt.** Et avvist notat holdes unna statussider, merket **Avvist**. Den som kan redigere det, kan endre det eller sende det som det er med **Send til godkjenning på nytt**; i begge tilfeller begynner godkjenningen på nytt fra det første trinnet. Å redigere et notat som fortsatt venter, starter også godkjenningen på nytt: en godkjenning gjelder ordene den fikk lagt fram.

**Rediger et publisert notat.** En redigering venter også. Redigeringsskjemaet sier det, og **Send redigering til godkjenning** lagrer den. Statussider fortsetter å vise notatet slik det ble godkjent, notatet viser redigeringen under **Foreslått redigering**, merket **Redigering venter på godkjenning** eller, når den er avvist, **Redigering avvist**, og **Trekk tilbake redigering** forkaster den. Filene på et publisert notat kan ikke endres mens godkjenning er slått på: publiser heller et nytt notat med filene. En redigering som sendes mens noen tar stilling til notatet, lagres ikke: last inn siden på nytt, og gjør den igjen.

**Slå av godkjenning.** Fra da av publiseres nye notater så snart de legges inn. Et notat som fortsatt ventet eller ble avvist, tilbyr **Publiser nå** til dem som kan redigere det, som publiserer det som det er, uten godkjenning, og feeden sier fra om det.

**Fra Slack, Microsoft Teams og Mattermost.** Skjemaet for å legge til et notat sier at et offentlig notat publiseres på statussiden når det er godkjent. Den som sender et, får vite at det er sendt til godkjenning, og hvem det venter på: i en melding bare vedkommende ser i Slack og Mattermost, og i samtalen i Microsoft Teams. Et notat som lagres fra en 📣- eller 📢-reaksjon, sier det samme i bekreftelsen sin. Kanalen hører om notatet når det publiseres.

**Godkjenne fra Slack, Microsoft Teams og Mattermost.** Godkjennere som slår på Slack, Microsoft Teams eller Mattermost for **Godkjenning av offentlige notater** under **Brukerinnstillinger → Varselinnstillinger**, får notatet der, i en direktemelding fra OneUptime: hvem som sendte det, hvilket trinn det venter på, og knapper for å godkjenne det, avvise det eller åpne det i OneUptime. Et trykk avgjør som OneUptime-kontoen chatkontoen deres er koblet til, etter de samme reglene som knappene på notatet, og en avvisning krever en begrunnelse der også. Bare de ser svaret. Hvis noen andre avgjorde først, eller notatet eller trinnene endret seg etter at meldingen ble sendt, avgjøres ingenting, og svaret sier hva som skjedde. Når notatet er avgjort, endres meldingen til hver godkjenner om det, så den sier hva som skjedde, og bare lenken til OneUptime er igjen. Når godkjenningstrinnene endres mens det venter, endres meldingene om et trinn det ikke lenger venter på, på samme måte, og det samme gjør meldingen til alle som trinnet ikke lenger spør; de det nå venter på, får en egen melding med knappene. Se [Slack](/docs/workspace-connections/slack), [Microsoft Teams](/docs/workspace-connections/microsoft-teams) og [Mattermost](/docs/workspace-connections/mattermost).

Feeden registrerer hvert trinn som en oppføring av typen `PublicNoteApproval`: et notat sendt til godkjenning, godkjent eller avvist, en tilbaketrukket redigering eller et notat publisert uten godkjenning. Disse oppføringene publiseres ikke i chattekanaler; det publiserte notatet gjør det.

## Hendelsens feed

Kortet **Hendelsesfeed** står nederst i venstre kolonne på hendelsens side **Oversikt**. Det er hendelsens historie som en tidslinje. Hver dag har en overskrift med datoen sin, sier når det er i dag eller i går, og nevner tidssonen tidene står i: den fra brukerinnstillingene dine, ellers nettleserens. Hver oppføring viser klokkeslettet den skjedde, med mindre oppføringen over skjedde i samme minutt, og i den siste timen også hvor lenge siden; pek på klokkeslettet for full dato og tid. Ved siden av klokkeslettet står ikonet for oppføringens type og en setning som begynner med avataren og navnet til den som forårsaket den. Det noen har skrevet, som et notat eller en rotårsak, står for seg selv i et kort under setningen. Tre eller flere oppføringer av samme type på rad innen fem minutter, som vaktoppdateringer, varsler til eiere eller abonnenter eller regler som kjørte, brettes sammen under den første, bak en knapp som viser resten. Som standard står de nyeste oppføringene øverst.

Noen oppføringer har ekstra detaljer — et varsel til eierne viser for eksempel alle som fikk e-post, og et varsel til abonnentene viser hver statusside det gikk til, med antallet sendte og feilede meldinger på hver kanal og emnet e-posten gikk ut med, etterfulgt, når det sendte noen, av verdiene i egendefinerte felt det satte inn i en melding, under **Custom fields sent**. Disse detaljene brettes ut under oppføringen: **Vis hvem som ble varslet** på et varsel til eierne, **Vis hele rapporten** på rotårsaken en KI-undersøkelse la ut, og **Vis detaljer** på de andre. **Skjul detaljer** bretter dem sammen igjen.

Kortets overskrift har også en meny **Handlinger**, så du kan handle uten å forlate tidslinjen:

- **Kjør runbook** — start et [runbook](/docs/runbooks/index) for denne hendelsen.
- **Kjør vakttjenesteretningslinje** — tilkall en policy ved behov. En arkivert policy tilkaller ingen: kjøringsloggen på hendelsen sier at den ikke ble kjørt fordi policyen er arkivert. Slå på **Tilkall dem som observatører** for i stedet å holde personene i policyen orientert: Svaret deres sier bare at de har sett tilkallingen, og hendelsen blir ikke bekreftet.
- **Legg til offentlig notat** — redigeringsverktøyet fra siden **Offentlige notater**, i en dialog: skriv notatet, og deretter **Publiser oppdatering**. Maler, **Utkast med KI**, vedlegg, **Varsle abonnentene på statussiden** med hvem det når, og **Forhåndsvisning** er der alle sammen. Notatet publiseres nå; for å tilbakedatere det velger du **Publisert nå**.
- **Legg til privat notat** — redigeringsverktøyet fra siden **Private notater**, i en dialog: skriv notatet, og deretter **Legg til notat**.

Begge notathandlingene er låst, med navnet på den manglende tillatelsen, for noen som ikke kan skrive notater. Når et notat er publisert, lukkes dialogen, og feeden viser det.

Alt annet ligger bak knappen **⋯** ved siden av, den samme knappen **Flere alternativer** som overskriften på et tabellkort har, slik at overskriften viser så få knapper som mulig:

- **Nyeste først** / **Eldste først** — rekkefølgen feeden leses i. En hake markerer den som brukes, og nettleseren husker valget for feeden til hver hendelse.
- **Filtrer etter hendelsestype** — en dialog med feedens hendelsestyper, hver med ikonet oppføringene har, og et søkefelt når listen er lang. Kryss av for dem som skal vises, og velg **Bruk filtre**; uten noe avkrysset vises hver hendelsestype. Mens feeden er filtrert, sier en boks over den hvor mange hendelsestyper den viser, med et merke for hver, **Rediger filtre** og **Tøm filtre**. Filteret lagres ikke: forlat hendelsen, så viser feeden alt igjen.
- **Oppdater** — henter feeden på nytt.

> [!NOTE]
> **Feeden kan bare legges til i, og den er ikke revisjonsloggen din.** API-et tillater å opprette og lese feedoppføringer, men ikke å oppdatere eller slette dem, så ingen kan stille omskrive historikken til en hendelse. Den er heller ikke permanent: på installasjoner med fakturering fjernes feedrader som er eldre enn tre år. For en varig oversikt over hvem som endret hva, bruker du **Avansert → Revisjonslogger** i hendelsens sidemeny.

## Hva feeden registrerer

Feedoppføringer skrives av selve hendelsestjenesten, av begge notattjenestene, av tilstandstidslinjen, av endringer i eiere og medlemmer, av tilknytting og frakobling av varsler, av regelmotorene, av vaktens kjøring, av kjøringene av KI-undersøkelsen og etteranalysen og av cronjobbene for varsler. Hendelsestypene dekker:

- **Selve hendelsen** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`. En oppføring `IncidentUpdated` registrerer hva en redigering endret: tittelen, beskrivelsen, rotårsaken, utbedringsnotatene, etikettene, alvorlighetsgraden, monitorene og statusen som ble satt på dem, og statussidene som ble lagt til i eller fjernet fra hendelsens omfang. Den har en linje for hver verdi som endret seg, og ingen for en verdi som ble lagret slik den var, så å lagre et kort uten endringer, eller en API-klient eller en arbeidsflyt som skriver hendelsen tilbake slik den er, legger ikke til noen oppføring i det hele tatt. Tekst som leses likt, er lik (linjeskift og mellomrommene rundt den unntatt), og etiketter er det samme settet i enhver rekkefølge; en verdi som ble tømt, leses som fjernet, og å fjerne alle etiketter som "All labels removed.". Et varsels oppføringer **Alert updated** fungerer på samme måte.
- **Notater og rapporter** — `PublicNote`, `PublicNoteApproval`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`. En oppføring `PostmortemNote` skrives når notatet i etteranalysen endres, ikke hver gang etteranalysen lagres.
- **Personer** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved` og `ChannelMemberAdded`, vist som **Kanalmedlem lagt til**, for noen som er lagt til i hendelsens Slack- eller Mattermost-kanal fra siden dens. Se [Hvem som er i kanalen til en post](/docs/workspace-connections/slack#hvem-som-er-i-kanalen-til-en-post).
- **Tilknyttede varsler** — `AlertLinked` og `AlertUnlinked`, vist som **Varsel tilknyttet** og **Varsel frakoblet**.
- **Varsler** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.
- **Videosamtaler** — `VideoCallStarted`, `VideoCallFailed`, `VideoCallTranscriptAdded` og `VideoCallSummary`: en samtale som ble startet for hendelsen, med lenken for å bli med, årsaken til at en leverandør ikke kunne starte en, en samtales transkripsjon, lagt til av noen eller lest fra leverandøren, eller det OneUptime AI leste i den, som også publiseres i hendelsens kanaler. Se [Videosamtaler](/docs/workspace-connections/video-calls).

Vaktoppføringene forteller hvordan hver varsling gikk. Oppføringen for en varsling nevner kanalene varslene ble sendt via: "On-call policy Payments paged Nitin Kumar via push notification and email at Level 1 of 3." Et varsel som personens egne vaktregler sender senere, for eksempel et anrop ti minutter etter, får en egen oppføring ("… paged Nitin Kumar again via phone call …"), og det gjør også et som ikke kunne sendes ("… could not page Nitin Kumar via SMS …"). Det gjør også et anrop personen ikke tok, når Twilio melder at det ringte ut eller traff en opptatt linje: "Nitin Kumar did not answer the phone call from on-call policy Payments at Level 1 of 3." Hver kanal nevnes én gang per varsling, så en push som gjentas til noen svarer, legger ikke til en linje hvert minutt. Et svar nevner varselet det kom fra: "Nitin Kumar acknowledged the page from on-call policy Payments at Level 1 of 3 via phone call." En varsling som ble kvittert på en annen måte, for eksempel i selve OneUptime eller i appen OneUptime On-Call, nevner ingen kanal. Feeden sier aldri hvorfor et varsel ikke kunne sendes, fordi en leverandørs begrunnelse kan inneholde et telefonnummer eller en e-postadresse: hendelsens **Varsellogger** og personens egne **Vaktlogger** viser hvorfor.

Hver type får sitt eget ikon, så du kan skumme en lang feed og plukke ut tilstandsendringene fra pratet. KI-generert analyse av rotårsaken merkes særskilt og gjengis i en begrenset Markdown-modus. Oppføringen **Hendelse opprettet**, oppføringen som registrerer en ny tittel, og oppføringene for å gå inn i eller ut av en episode viser en tittel nøyaktig slik den er skrevet: de escaper `\`, `[`, `]`, `*`, `_`, `~`, backticks og \< i den, så en tittel ikke kan bli et bilde, rå HTML, en Slack-omtale som \<!here\>, en lenke der teksten skjuler hvor den går, eller fet, kursiv eller kode. En adresse i en tittel vises fortsatt som en lenke til den samme adressen.

Hver oppføring nevner hvem som gjorde endringen: personen, med bildet sitt, eller, for en endring som ble gjort med en API-nøkkel for prosjektet, som en hendelse Jira Automation åpner via API-et eller et notat et skript publiserer, nøkkelen, med navnet den hadde da og merket **API-nøkkel**, slik revisjonsloggen navngir den. En endring OneUptime gjorde selv, via en regel eller en varseljobb, nevner ingen. Meldingen som legges ut i hendelsens Slack- og Microsoft Teams-kanaler, begynner med den samme personen eller nøkkelen, aldri med personen oppføringen handler om; den som har koblet til kontoen sin der, nevnes slik det arbeidsområdet kjenner vedkommende. Når en arbeidsflyt eller en monitor gir noen en rolle, nevner oppføringen arbeidsflyten eller monitoren, og den som gir seg selv en rolle, står som den som tok den. Hver persons navn lenker til siden deres under **Brukere**.

Å knytte til et varsel registreres også på varselet. Varsler har sin egen feed, der den samme endringen vises som **Tilknyttet hendelse** (`LinkedToIncident`) eller **Frakoblet hendelse** (`UnlinkedFromIncident`), med hendelsens navn. Bare hendelsens oppføringer **Varsel tilknyttet** og **Varsel frakoblet** publiseres i Slack og Microsoft Teams, så hver tilknytting kunngjøres én gang. En hendelse som erklæres fra varsler, får én oppføring **Varsel tilknyttet** som nevner alle sammen i stedet for én per varsel, og tittelen på et privat varsel eller en privat hendelse utelates fra oppføringen på den andre siden. Se [Koblede varsler](/docs/incidents/linked-alerts).

Feeder respekterer hendelsens personvern: for private hendelser filtreres feeden på samme måte som hendelsen.

## Eiere

Eiere er personene og teamene som har ansvaret for en hendelse. De er mottakerne av varslene om alt som skjer med den — og de er grunnen til at en hendelse ikke går ubemerket hen mens alle tror at noen andre tar seg av den.

Åpne **Team → Eiere** i hendelsens sidemeny. Kortet **Eiere** viser et merke med et antall og beskriver eiere som personene og teamene som har ansvaret for denne hendelsen og får beskjed om endringer, med en løpende opptelling som "2 people · 1 team". Eiere vises som overlappende avatarer; holder du musen over en, vises personens e-postadresse, eller oppføringen merkes som et **Team**. Hendelsens **Oversikt** nevner også eierne i toppen, team først: opptil tre, deretter en lenke til resten på denne siden. Så lenge hendelsen er åpen, åpner **Legg til** under dem den samme listen som **Legg til eier** på denne siden, rett i toppen: klikk på en person eller et team for å gjøre dem til eier — toppen nevner dem med en gang, og listen holdes åpen for den neste. Så lenge en åpen hendelse ikke har eiere, står **Legg til** på deres plass og åpner den samme listen; en løst hendelse viser **Ingen**.

- Klikk på **Legg til eier** for å åpne en velger med et søkefelt for personer eller team.
- Klikk på fjerningselementet på en avatar for å åpne bekreftelsen **Fjern eier**, og deretter på **Fjern**.
- Finnes det ingen eiere ennå, sier kortet det og inviterer deg til å legge til en kollega eller et team, slik at de får beskjed om endringer.

Brukere som eier og team som eier, er separate poster — å legge til et team gjør hvert medlem av teamet til eier når det gjelder varsler, uten å liste dem opp enkeltvis. Via API-et er de `/api/incident-owner-user` og `/api/incident-owner-team`.

Bare prosjektets egne team og medlemmer kan være eiere. Velgeren tilbyr bare dem, og eiere som legges til via API-et, Terraform eller en arbeidsflyt, holdes til det samme: et team fra et annet prosjekt, eller noen som ikke er medlem av prosjektet, avvises.

## Hvordan eiere tildeles

Det er fem veier inn på listen over eiere:

- **Ved erklæring** — den som erklærer en hendelse, blir eier, og **Eiere** under **Flere felt** i **Erklær hendelse** legger til flere: hvert team personen er medlem av, er ett klikk unna under feltet. Se [Hvem som eier den](/docs/incidents/declaring-incidents#hvem-som-eier-den).
- **Fra en hendelsesmal** — maler har et felt **Eiere**: personene og teamene som eier hendelsen og får beskjed når den opprettes eller oppdateres, valgt fra den samme listen som **Legg til eier**. Å opprette en hendelse fra malen forhåndsutfyller dem, og de legges til når hendelsens Slack- og Microsoft Teams-kanaler finnes, slik at en varselregel som inviterer hendelsens eiere til en ny kanal, også inviterer dem. Dashbordet, og trinnet **Create One Incident** i en arbeidsflyt med en valgt **Incident Template**, legger dem til uten varselet «du er lagt til»; et [skjema](/docs/forms/on-submit) med en mal gir dem beskjed og holder hendelsens varsel **Hendelse opprettet** tilbake til de er lagt til. Se [Opprette en hendelse](/docs/incidents/declaring-incidents).
- **Fra Eierregler for hendelse** — samsvarende regler legger til eiere automatisk ved opprettelsen, og igjen når alvorlighetsgraden eller etikettene til hendelsen endres.
- **Ved opprettelse via API-et** — brukere og team som oppgis som eiere med opprettelseskallet, legges til på samme måte, når kanalene finnes, og uten varselet «du er lagt til».
- **By hand** — elementet **Legg til eier** på siden **Eiere**, når som helst under hendelsen, eller **Legg til** under eierne i toppen av **Oversikt** så lenge den er åpen.

Å legge til den samme personen to ganger er trygt; eiere som allerede er tildelt, dupliseres ikke.

## Eierregler for hendelser

**Eierregler for hendelse** tildeler automatisk brukere og team som eiere når samsvarende hendelser opprettes — rutingslaget som gjør at en databasehendelse havner hos databaseteamet uten at noen trenger å tenke på det. Du finner dem under **Hendelser → Regler → Eierregler**, og resten av automatiseringen av hendelser dekkes i [Hendelsesinnstillinger og automatisering](/docs/incidents/settings).

Regelskjemaet har to trinn — **Treff**, betingelsene en hendelse må oppfylle, og deretter **Eiere**, det regelen legger til:

- **Eiere** — **Legg til eier** åpner én liste med personer og team; klikk på hver for å legge den til, og fjern et valg med **×** på merket. Når regelen samsvarer, legges hver valgt person og hvert valgt team til som eier, og eiere som allerede er tildelt, dupliseres ikke.
- **Arv eiere**, brettet sammen under **Eiere** — tildel eiere fra relaterte enheter i stedet for å nevne dem. **Arv eiere fra overvåkere** gjør hver eier av hendelsens monitorer til eier av hendelsen, og **Arv eiere fra verter**, **Arv eiere fra Kubernetes-klynger**, **Arv eiere fra Docker-verter**, **Inherit Owners From Podman Hosts** og **Arv eiere fra tjenester** gjør det samme for de ressursene. Sist i seksjonen lister **Oppretterens team** opp team: når den som erklærer en samsvarende hendelse, er med i et av dem, blir det teamet også eier. Se [Oppretterens team](/docs/configuration/label-and-owner-rules#oppretterens-team).

En ny regel må legge til noen: velg minst én eier, slå på en bryter under **Arv eiere**, eller legg til et team under **Oppretterens team**. API-et og Terraform avviser også en ny regel som ikke legger til noen. **Navn** fylles ut fra eierne du velger — eller, på en regel som bare arver, fra bryterne (_Inherit owners from monitors_) — til du skriver et eget navn. Å redigere en regel krever aldri eiere, så en eldre regel som ikke legger til noe, kan fortsatt få nytt navn eller slås av; listen merker den med **Legger ikke til noe**. Se [Etikett- og eierregler](/docs/configuration/label-and-owner-rules).

**Varsle eiere**, under **Flere felt**, styrer om folk får vite det. La den være slått på for ekte ruting; slå den av for å legge til eiere stille — nyttig når en regel er en administrativ bekvemmelighet og ikke en tilkalling.

Hver kjøring av en regel skrives i hendelsens feed, så du alltid kan se om en person ble lagt til av en regel eller av et menneske.

Regler kjører når en hendelse opprettes, og igjen hver gang alvorlighetsgraden eller etikettene endres mens den er åpen. En hendelse som heves til en alvorlighetsgrad som en regel samsvarer med, eller får en etikett som en regel samsvarer med, får den regelens eiere med en gang, varslet slik regelen sier, og feeden forteller at regelen nå samsvarer med den, og hvorfor: Slik overtar et team en hendelse når det viser seg at den rammer hele organisasjonen. Eiere fjernes aldri når hendelsen ikke lenger samsvarer.

## Hva eierne får beskjed om

Fem jobber gir eierne beskjed, og hver kjører én gang i minuttet:

| Varsel                     | Når                                                          | Emne på e-posten                                               |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| **Hendelse opprettet**     | Hendelsen erklæres.                                          | `[New Incident {number}] - {title}`                            |
| **Et notat ble publisert** | Et offentlig *eller* privat notat publiseres.                | `[Update Incident {number}] - {title}`                         |
| **Tilstanden endret seg**  | Hendelsen går til en annen tilstand.                         | `[{State} Incident {number}] - {title}`                        |
| **Du ble lagt til**        | Du legges til som eier.                                      | `You have been added as the owner of Incident {number} - {title}` |
| **Fortsatt ikke løst**     | En påminnelse, styrt av tidspunktet for hendelsens neste påminnelse. | `[Reminder] Incident {number} is still {state} - {title}` |

Hvert varsel går ut på kanalene personen har slått på under **Brukerinnstillinger → Varselinnstillinger** — e-post, SMS, taleanrop, push, WhatsApp, Telegram, Slack, Microsoft Teams, Mattermost eller webhook — som avgjør hva som faktisk sendes. Hver mottaker kan slå av hvert av dem enkeltvis — innstillingene per bruker handler om å sende deg varslene om opprettet hendelse, publisert notat, endret tilstand, lagt til eier, tildelt medlem og påminnelse om at den fortsatt er åpen. Noen som bare vil ha et anrop ved tilstandsendringer, kan få nøyaktig det. Se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) for hva en tilstandsendring betyr.

**Hendelser uten eier er ikke tause.** Har en hendelse ingen eiere i det hele tatt, faller varseljobbene tilbake på prosjektets eiere, så ingenting går tapt. Varselet **Hendelse opprettet** for en hendelse som er meldt via et skjema der malen har eiere, venter i stedet på de eierne. Hver person som får beskjed, legges også til i den tilhørende feedoppføringen, så du i ettertid kan se nøyaktig hvem som fikk beskjed, og på hvilken adresse.

## Neste steg

:::cards
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings): Eierregler, notatmaler og resten av automatiseringen.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers): Hvor offentlige notater havner, og hvem som mottar dem.
- [Én statusside per målgruppe](/docs/status-pages/one-status-page-per-audience): Hvilke statussider notatene til en hendelse når.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities): Tilstandsmaskinen som driver halvparten av feeden.
:::
