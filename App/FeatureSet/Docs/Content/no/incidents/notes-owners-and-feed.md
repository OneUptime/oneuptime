# Notater, eiere og feed

Hver hendelse samler opp en skriftlig historikk mens du jobber med den. Deler av den historikken er for kundene dine — oppdateringen som går ut på statussiden klokken 02:14 og sier at dere har funnet den dårlige deployen. Resten er for teamet ditt — stakksporet noen limte inn, grafen som endelig ga mening, beslutningen om å feile over.

OneUptime holder de to publikummene fra hverandre. **Offentlige notater** publiseres til statussiden din og kan varsle abonnenter. **Private notater** (modellen `IncidentInternalNote`) blir værende inne i dashbordet. Under begge ligger **Hendelse Feed**, en utvidbar tidslinje som registrerer alt som har skjedd med hendelsen, og listen **Eiere**, som avgjør hvem som får beskjed.

Alt sammen henger på hendelsens venstre sidemeny: **Notater → Offentlige notater**, **Notater → Private notater**, og **Team → Eiere**. Feeden bor på hendelsens side **Oversikt**.

## Offentlige notater kontra private notater

De to notattypene ser like ut i dashbordet og oppfører seg svært forskjellig.

- **Offentlige notater** — modellen `IncidentPublicNote`, som serveres til statussider som en del av hendelsens tidslinje. De bærer en **Lagt ut**-dato du kan sette selv og en avkrysningsboks **Varsle statussideabonnenter**.
- **Private notater** — modellen `IncidentInternalNote`. Ingenting i statusside-appen leser dem. De har ikke noe lagt ut-felt (listen stemples og sorteres etter `createdAt`) og ingen abonnentfelt i det hele tatt, så et privat notat kan aldri utløse et abonnentvarsel.

**Hva «privat» faktisk betyr.** Det betyr «ikke publisert til statussiden» — ikke «begrenset til en mindre gruppe mennesker». Begge notattypene deler de samme leserettighetene, så alle som kan lese hendelsen kan lese de private notatene dens. Hvis du trenger å begrense hvem som kan se en hendelse overhodet, bruk flagget **Privat hendelse** (`isPrivate`) på selve hendelsen, som skjuler hendelsen fra hver eneste statusside og begrenser den til hendelsens eierbrukere, medlemmene av eierteamene, og prosjektadministratorer og -eiere.

**Eiere ser begge deler.** Jobben for eiervarsler spør etter offentlige og private notater samlet. Et privat notat er privat fra abonnentene dine, ikke fra de som responderer.

| Hvis du vil …                                                    | Velg                 |
| ---------------------------------------------------------------- | -------------------- |
| Fortelle kunder hva du vet og når du vet mer                     | **Offentlig notat**  |
| Tilbakedatere en oppdatering du allerede sendte et annet sted    | **Offentlig notat**  |
| Registrere en hypotese, en kommando du kjørte, eller et blindspor | **Privat notat**     |
| Legge ved et heap-dump eller et skjermbilde fra et internt dashbord | **Privat notat**   |

## Å legge ut et offentlig notat

Åpne **Notater → Offentlige notater** i hendelsens sidemeny og opprett et notat. Kortet forklarer at det du skriver her vises på statussiden; tomtilstanden sier at ingen offentlige notater er opprettet for denne hendelsen så langt.

| Felt                              | Formål                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Offentlig hendelsesnotat**      | Selve teksten, i Markdown. Obligatorisk. Skjemaet minner deg om at notatet er synlig på statussiden din og lenker til et jukseark. |
| **Vedlegg**                       | Filer som deles med abonnenter på statussiden. Valgfritt.                                                          |
| **Varsle statussideabonnenter**   | Avkrysningsboks, på som standard. Slå den av for å publisere stille.                                               |
| **Lagt ut**                       | Obligatorisk dato og klokkeslett, med nå som standard, vist i din gjeldende tidssone.                              |

**Lagt ut er notatets virkelige tidsstempel.** Statussider sorterer og viser offentlige notater etter `postedAt`, ikke etter når du skrev dem — så hvis du oppdaterer statussiden i etterkant om noe du sendte for 40 minutter siden, sett **Lagt ut** til da det faktisk skjedde. Hvis et notat kommer inn via API-et uten et slikt tidspunkt, stempler OneUptime nåværende tid.

Listen viser hvem som skrev hvert notat, dets **Lagt ut**, den gjengitte markdownen med vedleggene, og en kolonne **Abonnentvarselsstatus**. Du kan filtrere på **Opprettet av**, **Notat** og **Opprettet den**.

## Å legge ut et privat notat

**Notater → Private notater** er bevisst enklere. Det finnes bare to felt:

- **Privat hendelsesnotat** — Markdown-tekst, obligatorisk. Skjemaet sier rett ut at dette er privat for teamet ditt og ikke synlig på statussiden.
- **Vedlegg** — filer ment for teamet som responderer på hendelsen.

Ingen **Lagt ut**, ingen avkrysningsboks for abonnenter — notatet stemples når det opprettes.

## Vedlegg på notater

Begge notattypene tar imot filvedlegg gjennom et **Vedlegg**-felt, og begge viser en vedleggsliste under notatteksten med en **Download attachment**-lenke per fil.

Der de skiller lag, er hvem som kan hente filen:

- **Vedlegg på offentlige notater** kan lastes ned av besøkende på statussiden gjennom en statussiderute, sammen med selve notatet.
- **Vedlegg på private notater** er kun tilgjengelige gjennom det autentiserte dashbord-API-et. Det finnes ingen statussiderute for dem.

Det gjør vedlegg til den samme offentlig/privat-beslutningen som notatteksten. Et kundevendt tidslinjebilde hører til på et offentlig notat; et konfigurasjonsdump på et privat.

## Å generere et notat med AI

Begge notatsidene har en knapp **Generate with AI**. Den sender hendelsen til prosjektets AI-leverandør og slipper den genererte markdownen inn i notatredigereren, der du redigerer den før du lagrer — ingenting publiseres automatisk.

- **Generate Public Note with AI** — beskrevet som å analysere hendelsesdataene for å produsere et kundevendt notat. Malene inkluderer **Status Update** og **Resolution Notice**.
- **Generate Private Note with AI** — produserer i stedet et internt teknisk notat. Malene inkluderer **Investigation Update** og **Technical Analysis**.

Bak knappen poster dashbordet til `/incident/generate-note-from-ai/{incidentId}` med den valgte malen og en notattype `public` eller `internal`.

## Notatmaler

Hvis teamet ditt skriver de samme tre oppdateringene ved hver nedetid, lagre dem én gang. Begge notatsidene har en knapp **Opprett fra mal** som åpner en velger **Opprett notat fra mal** med en nedtrekksliste **Velg notatmal**.

Maler deles mellom offentlige og private notater: én enkelt malliste betjener begge, og den samme malen kan settes inn i begge typer notat.

Du administrerer dem på **Hendelser → Innstillinger → Notatmaler** — kortet har tittelen **Maler for offentlige eller private notater for hendelser** og skjemaet har et trinn **Malinformasjon** (**Malnavn** og **Malbeskrivelse**, begge obligatoriske) og et trinn **Notatdetaljer** for teksten. Hvis du klikker **Opprett fra mal** før du har opprettet noen, forteller OneUptime deg at ingen finnes ennå; merk at meldingen peker mot Prosjektinnstillinger, men siden bor faktisk under **Hendelser → Innstillinger → Notatmaler**.

## Å legge ut notater fra Slack eller Microsoft Teams

Hvis du har koblet til et arbeidsområde, trenger de som responderer aldri å forlate kanalen. Både Slack og Microsoft Teams eksponerer en legg-til-notat-handling som åpner en modal med en nedtrekksliste som tilbyr **Offentlig notat** eller **Privat notat** pluss et tekstfelt, og skriver resultatet rett inn på hendelsen.

To detaljer verdt å kjenne til:

- **Duplikatbeskyttelse** — hvert notat registrerer Slack-meldingen det kom fra (`postedFromSlackMessageId`, formatert `channel_id:message_ts`), så flere som reagerer på den samme meldingen produserer ett notat, ikke fem.
- **Notater går i retur** — å legge ut begge typer notat sender også en melding inn i den tilkoblede hendelseskanalen, fordi notatets feed-element opprettes med arbeidsområdevarsling aktivert.

## Når et offentlig notat faktisk når abonnentene

Å opprette et offentlig notat med **Varsle statussideabonnenter** på garanterer ikke i seg selv at en e-post går ut. Notatet må klarere en kjede av sjekker, og hver feil registrerer en spesifikk grunn i stedet for å gi en feilmelding:

1. **Varsle statussideabonnenter** må være på. Hvis den ikke er det, stemples notatet som hoppet over i det øyeblikket det opprettes.
2. Notatet må tilhøre en hendelse som fortsatt finnes.
3. Hendelsen må ha minst én overvåking knyttet til seg — uten overvåkinger finnes det ingen statussideressurs å rute notatet til.
4. Hendelsens flagg **Synlig på statussiden** (`isVisibleOnStatusPage`) må være sant.
5. Hver statusside hendelsen når, må ha **Vis hendelser** (`showIncidentsOnStatusPage`) slått på.
6. Hver abonnent må passere sine egne preferanser — ikke avmeldt, og abonnert på denne ressursen og på hendelsestypen `Incident` der siden lar abonnenter velge.

**Varsler er ikke øyeblikkelige.** Jobben som sender dem, kjører én gang i minuttet, så forvent opptil rundt et minutt mellom at du lagrer notatet og at posten forlater. Det er det etiketten **Sending Soon** betyr.

Kolonnen **Abonnentvarselsstatus** sporer hele reisen:

| Status                       | Hva det betyr                                            |
| ---------------------------- | -------------------------------------------------------- |
| **Notifications skipped.**   | En av portene over var lukket. Grunnen registreres.      |
| **Sending Soon**             | I kø, venter på neste kjøring av sendejobben.            |
| **Notifications Being Sent** | Jobben arbeider seg gjennom abonnentlisten.              |
| **Varsler sendt**            | Hvert abonnentvarsel gikk ut.                            |
| **Mislyktes**                | Jobben feilet; feilen lagres med notatet.                |

Klikk **flere detaljer** på statusen for å åpne **Detaljer om varselstatus**. Der en ny sending gir mening, er knappen i den modalen **Retry**, som setter notatet tilbake i ventetilstand slik at neste kjøring plukker det opp igjen.

Selve meldingen abonnentene får, er maldrevet per statusside og per kanal — e-post, SMS, Slack og Microsoft Teams har hver sin mal for hendelsen **Subscriber Incident Note Created**, med variabler for statussidens navn og URL, detaljlenken, de berørte ressursene, hendelsens alvorlighetsgrad og tittel, notatteksten, og en avmeldingslenke per abonnent. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) for hvordan de malene og kanalene konfigureres.

## Hendelsesfeeden

Kortet **Hendelse Feed** ligger nederst i venstre kolonne på hendelsens side **Oversikt**. Det er historien om hendelsen i rekkefølge: hvert element er et ikon, avataren og navnet til den som forårsaket det, et relativt tidsstempel med den eksakte lokale tiden når du holder musepekeren over, og en Markdown-tekst. Elementene er sortert eldst først.

Noen elementer bærer ekstra detaljer — et eiervarsel lister for eksempel opp alle som fikk e-post. De viser en knapp **More Information** som åpner et panel **More Information**.

Kortets topptekst har også en meny **Handlinger** så du kan handle uten å forlate tidslinjen:

- **Execute Runbook** — start et [runbook](/docs/runbooks/index) mot denne hendelsen.
- **Kjør vakttjenesteretningslinje** — tilkall en policy på forespørsel.
- **Add Public Note** — de samme fire feltene som siden Offentlige notater, i en modal.
- **Legg til privat notat** — kun notattekst og vedlegg.

Ved siden av den henter **Oppdater** feeden på nytt.

**Feeden kan bare utvides, og den er ikke revisjonsloggen din.** API-et tillater å opprette og lese feed-elementer, men ikke å oppdatere eller slette dem, så ingen kan i det stille skrive om historikken til en hendelse. Den er heller ikke permanent: på fakturerte installasjoner fjernes feed-rader eldre enn tre år. For en varig registrering av hvem som endret hva, bruk **Revisjon → Revisjonslogger** i hendelsens sidemeny.

## Hva feeden registrerer

Feed-elementer skrives av hendelsestjenesten selv, av begge notattjenestene, av tilstandstidslinjen, av eier- og medlemsendringer, av regelmotorene, av vaktkjøring, av kjørerne for AI-undersøkelse og etteranalyse, og av cron-jobbene for varsling. Hendelsestypene dekker:

- **Selve hendelsen** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notater og oppsummeringer** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Mennesker** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Varsler** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Hver type får sitt eget ikon, så du kan skanne en lang feed og plukke ut tilstandsendringene fra støyen. AI-generert rotårsaksanalyse merkes tydelig og gjengis i en begrenset Markdown-modus.

Feeder respekterer hendelsens personvern: for private hendelser filtreres feed-lesinger på samme måte som hendelsen selv.

## Eiere

Eiere er personene og teamene som er ansvarlige for en hendelse. De er varslingsmålet for alt som skjer med den — og de er grunnen til at en hendelse ikke går ubemerket hen mens alle antar at noen andre er på saken.

Åpne **Team → Eiere** i hendelsens sidemeny. Kortet **Eiere** viser en teller og beskriver eiere som personene og teamene som er ansvarlige for denne hendelsen og som varsles om endringer, med en løpende telling som «2 personer · 1 team». Eiere vises som overlappende avatarer; å holde musepekeren over én viser personens e-post eller merker oppføringen som et **Team**.

- Klikk **Legg til eier** for å åpne en velger med et søkefelt for personer eller team.
- Klikk fjern-kontrollen på en avatar for å åpne bekreftelsen **Fjern eier**, deretter **Fjern**.
- Uten eiere ennå sier kortet det og inviterer deg til å legge til en kollega eller et team slik at de varsles om endringer.

Eierbrukere og eierteam er separate poster — å legge til et team gjør hvert medlem av det teamet til eier for varslingsformål uten å liste dem opp enkeltvis.

## Hvordan eiere blir tildelt

Det er fire ruter inn på eierlisten:

- **Fra en hendelsesmal** — maler bærer feltene **Eier - Team** og **Eier - Brukere**, beskrevet som teamene og brukerne som eier hendelsen og som varsles når den opprettes eller oppdateres. Å opprette en hendelse fra malen forhåndsutfyller dem. Se [Opprette en hendelse](/docs/incidents/declaring-incidents).
- **Fra Eierregler for hendelse** — treffende regler legger til eiere automatisk ved opprettelse.
- **Ved opprettelse gjennom API-et** — eierbrukere og -team som sendes med opprettelseskallet legges til umiddelbart, med et flagg som styrer om de får «du ble lagt til»-e-posten.
- **For hånd** — kontrollen **Legg til eier** på siden **Eiere**, når som helst under hendelsen.

Å legge til den samme personen to ganger er trygt; eiere som allerede er tildelt, dupliseres ikke.

## Eierregler for hendelse

**Eierregler for hendelse** tildeler eierbrukere og -team automatisk når treffende hendelser opprettes — rutingslaget som gjør at en databasehendelse havner hos databaseteamet uten at noen tenker på det. Du finner dem sammen med resten av hendelsesautomatiseringen som dekkes i [Hendelsesinnstillinger og automatisering](/docs/incidents/settings).

Regelskjemaet har tre trinn — **Grunnleggende informasjon**, **Treffkriterier** og **Eiere** — og eiertrinnet rommer to seksjoner:

- **Eiere å tildele** — velg **Eierteam** og **Eierbrukere**. Når regelen treffer, legges hver valgte bruker og hvert valgt team til som eier, og allerede tildelte eiere dupliseres ikke.
- **Arv eiere** — tildel eiere fra beslektede entiteter i stedet for å navngi dem. **Arv eiere fra overvåkere** gjør hver eier av hendelsens overvåkinger til eier av hendelsen, og **Arv eiere fra verter**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** og **… From Services** gjør det samme for de ressursene.

En bryter **Varsle eiere** styrer om folk får vite om det. La den stå på for reell ruting; slå den av for å legge til eiere stille — nyttig når en regel er en bokføringsbekvemmelighet heller enn en tilkalling.

Hver regelkjøring skrives til hendelsesfeeden, så du kan alltid se om en person ble lagt til av en regel eller av et menneske.

## Hva eiere blir varslet om

Fem jobber varsler eiere, hver av dem kjørende én gang i minuttet:

- **Hendelse opprettet** — emne `[New Incident {number}] - {title}`.
- **Et notat ble lagt ut** — for både offentlige *og* private notater, emne `[Update Incident {number}] - {title}`.
- **Hendelsestilstanden endret seg** — se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).
- **Du ble lagt til som eier** — emne `You have been added as the owner of Incident {number} - {title}`.
- **Fortsatt uløst** — en påminnelse drevet av hendelsens neste påminnelsestidspunkt, emne `[Reminder] Incident {number} is still {state} - {title}`.

Hvert varsel bygges for e-post, SMS, taleoppringing, push og WhatsApp og overleveres til brukerens varslingsinnstillinger, som avgjør hva som faktisk sendes. Hver mottaker kan slå av hver av disse hver for seg — innstillingene per bruker er formulert som å sende deg varsler om hendelse opprettet, notat lagt ut, tilstand endret, eier lagt til, medlem tildelt, og påminnelse om fortsatt åpen. Noen som bare vil ha en telefonoppringing for tilstandsendringer, kan få nøyaktig det.

**Hendelser uten eiere er ikke stille.** Hvis en hendelse ikke har noen eiere i det hele tatt, faller varslingsjobbene tilbake til prosjektets eiere, så ingenting går tapt. Hver person som varsles legges også til i det tilhørende feed-elementet, så du kan i etterkant se nøyaktig hvem som fikk beskjed og på hvilken adresse.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hva en hendelse er og hvordan bitene henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — å opprette hendelser for hånd, fra maler og fra overvåkinger.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — tilstandsmaskinen som driver halve feeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — eierregler, notatmaler og resten av automatiseringen.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvor offentlige notater ender opp og hvem som mottar dem.
- [Statussider – Oversikt](/docs/status-pages/index) — den kundevendte siden av en hendelse.
