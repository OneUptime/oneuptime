# Notater, eiere og feed

Hver hendelse samler opp et skriftlig spor mens dere jobber med den. Noe av det sporet er for kundene deres — oppdateringen som går ut på statussiden 02:14 og forteller at dere har funnet den dårlige utrullingen. Resten er for teamet — stacksporet noen limte inn, grafen som endelig ga mening, beslutningen om å bytte over.

OneUptime holder de to publikummene fra hverandre. **Offentlige notater** publiseres på statussiden din og kan varsle abonnenter. **Private notater** (modellen `IncidentInternalNote`) blir værende inne i dashbordet. Under begge ligger **Hendelse Feed**, en tidslinje som bare kan tilføyes og som registrerer alt som har skjedd med hendelsen, og listen **Eiere**, som avgjør hvem som får beskjed.

Alt sammen henger i hendelsens sidemeny til venstre: **Notater → Offentlige notater**, **Notater → Private notater** og **Team → Eiere**. Feeden bor på hendelsens side **Oversikt**.

## Offentlige notater kontra private notater

De to notattypene ser like ut i dashbordet og oppfører seg svært forskjellig.

- **Offentlige notater** — modellen `IncidentPublicNote`, som serveres til statussider som del av hendelsestidslinjen. De har en **Lagt ut**-dato du kan sette selv, og en avkrysningsboks **Varsle statussideabonnenter**.
- **Private notater** — modellen `IncidentInternalNote`. Ingenting i statusside-appen leser dem. De har ikke noe lagt-ut-felt (listen stemples og sorteres etter `createdAt`) og ingen abonnentfelt i det hele tatt, så et privat notat kan aldri utløse et abonnentvarsel.

**Hva «privat» faktisk betyr.** Det betyr «ikke publisert på statussiden» — ikke «begrenset til en mindre gruppe mennesker». Begge notattypene deler de samme leserettighetene, så alle som kan lese hendelsen, kan lese de private notatene dens. Trenger du å begrense hvem som i det hele tatt kan se en hendelse, bruker du flagget **Privat hendelse** (`isPrivate`) på selve hendelsen, som skjuler hendelsen fra hver eneste statusside og begrenser den til hendelsens eierbrukere, medlemmene av eierteamene, og prosjektadministratorer og prosjekteiere.

**Eiere ser begge deler.** Jobben som varsler eiere, spør etter offentlige og private notater samlet. Et privat notat er privat fra abonnentene dine, ikke fra dem som responderer.

| Hvis du vil …                                                    | Velg                 |
| ---------------------------------------------------------------- | -------------------- |
| Fortelle kundene hva dere vet og når dere vet mer                | **Offentlig notat**  |
| Tilbakedatere en oppdatering du allerede sendte et annet sted    | **Offentlig notat**  |
| Registrere en hypotese, en kommando du kjørte, eller en blindvei | **Privat notat**     |
| Legge ved en heap-dump eller et skjermbilde av et internt dashbord | **Privat notat**   |

## Å poste et offentlig notat

Åpne **Notater → Offentlige notater** i hendelsens sidemeny og opprett et notat. Kortet forklarer at det du skriver her vises på statussiden; tomtilstanden sier at ingen offentlige notater er opprettet for denne hendelsen så langt.

| Felt                             | Formål                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Offentlig hendelsesnotat**     | Selve teksten, i Markdown. Påkrevd. Skjemaet minner deg om at notatet er synlig på statussiden din, og lenker til et jukselapp. |
| **Vedlegg**                      | Filer som deles med abonnentene på statussiden. Valgfritt.                                                            |
| **Varsle statussideabonnenter**  | Avkrysningsboks, på som standard. Slå den av for å publisere i stillhet.                                              |
| **Lagt ut**                      | Påkrevd dato og klokkeslett, satt til nå som standard, vist i din gjeldende tidssone.                                 |

**Lagt ut er notatets virkelige tidsstempel.** Statussider sorterer og viser offentlige notater etter `postedAt`, ikke etter når du tastet dem inn — så hvis du oppdaterer statussiden om noe du sendte ut for 40 minutter siden, setter du **Lagt ut** til da det faktisk skjedde. Kommer et notat inn via API-et uten et slikt tidspunkt, stempler OneUptime det med tiden nå.

Listen viser hvem som skrev hvert notat, **Lagt ut**, den gjengitte Markdown-teksten med vedleggene sine, og en kolonne **Abonnentvarselsstatus**. Du kan filtrere på **Opprettet av**, **Notat** og **Opprettet den**.

## Å poste et privat notat

**Notater → Private notater** er bevisst enklere. Det er bare to felt:

- **Privat hendelsesnotat** — Markdown-tekst, påkrevd. Skjemaet sier rett ut at dette er privat for teamet ditt og ikke er synlig på statussiden.
- **Vedlegg** — filer ment for teamet som responderer på hendelsen.

Ingen **Lagt ut**, ingen abonnentavkrysning — notatet stemples når det opprettes.

## Vedlegg på notater

Begge notattypene tar imot filvedlegg gjennom et **Vedlegg**-felt, og begge viser en vedleggsliste under notatteksten med en **Download attachment**-lenke per fil.

Der de skiller lag, er hvem som kan hente filen:

- **Vedlegg på offentlige notater** kan lastes ned av besøkende på statussiden gjennom en statussiderute, sammen med selve notatet.
- **Vedlegg på private notater** er bare tilgjengelige gjennom det autentiserte dashbord-API-et. Det finnes ingen statussiderute for dem.

Det gjør vedlegg til nøyaktig den samme offentlig/privat-avgjørelsen som notatteksten. Et bilde for den kundevendte tidslinjen hører hjemme på et offentlig notat; en konfigurasjonsdump hører hjemme på et privat.

## Å generere et notat med AI

Begge notatsidene har en knapp **Generate with AI**. Den sender hendelsen til prosjektets AI-leverandør og slipper den genererte Markdown-teksten inn i notatredigereren, der du redigerer den før du lagrer — ingenting publiseres automatisk.

- **Generate Public Note with AI** — beskrevet som at den analyserer hendelsesdataene for å produsere et kundevendt notat. Malene inkluderer **Status Update** og **Resolution Notice**.
- **Generate Private Note with AI** — produserer et internt teknisk notat i stedet. Malene inkluderer **Investigation Update** og **Technical Analysis**.

Bak knappen poster dashbordet til `/incident/generate-note-from-ai/{incidentId}` med den valgte malen og en notattype som er enten `public` eller `internal`.

## Notatmaler

Skriver teamet ditt de samme tre oppdateringene ved hvert avbrudd, lagrer dere dem én gang. Begge notatsidene har en knapp **Opprett fra mal** som åpner velgeren **Opprett notat fra mal** med en nedtrekksliste **Velg notatmal**.

Maler deles mellom offentlige og private notater: én enkelt malliste betjener begge, og den samme malen kan settes inn i begge notattypene.

Du forvalter dem på **Hendelser → Innstillinger → Notatmaler** — kortet har tittelen **Maler for offentlige eller private notater for hendelser**, og skjemaet har et trinn **Malinformasjon** (**Malnavn** og **Malbeskrivelse**, begge påkrevd) og et trinn **Notatdetaljer** for selve teksten. Klikker du **Opprett fra mal** før du har opprettet noen, forteller OneUptime deg at ingen finnes ennå; merk at meldingen peker mot Prosjektinnstillinger, mens siden faktisk bor under **Hendelser → Innstillinger → Notatmaler**.

## Å poste notater fra Slack eller Microsoft Teams

Har dere koblet til et arbeidsområde, trenger de som responderer aldri å forlate kanalen. Både Slack og Microsoft Teams har en handling for å legge til notat som åpner en dialog med en nedtrekksliste som tilbyr **Offentlig notat** eller **Privat notat** pluss et tekstfelt, og skriver resultatet rett inn på hendelsen.

To detaljer det er verdt å kjenne til:

- **Beskyttelse mot duplikater** — hvert notat registrerer Slack-meldingen det kom fra (`postedFromSlackMessageId`, formatert `channel_id:message_ts`), så flere personer som reagerer på den samme meldingen gir ett notat, ikke fem.
- **Notater går i retur** — å poste et notat av begge slag pusher også en melding inn i den tilkoblede hendelseskanalen, fordi notatets feed-element opprettes med arbeidsområdevarsling slått på.

## Når et offentlig notat faktisk når abonnentene

Å opprette et offentlig notat med **Varsle statussideabonnenter** på garanterer ikke i seg selv at en e-post går ut. Notatet må gjennom en kjede av sjekker, og hver svikt registrerer en konkret årsak i stedet for å gi en feil:

1. **Varsle statussideabonnenter** må være på. Er den ikke det, stemples notatet som hoppet over i det øyeblikket det opprettes.
2. Notatet må tilhøre en hendelse som fortsatt finnes.
3. Hendelsen må ha minst én overvåking knyttet til seg — uten overvåkinger finnes det ingen statussideressurs å rute notatet til.
4. Hendelsens flagg **Synlig på statussiden** (`isVisibleOnStatusPage`) må være sant.
5. Hver statusside hendelsen når, må ha **Vis hendelser** (`showIncidentsOnStatusPage`) slått på.
6. Hver abonnent må passere sine egne innstillinger — ikke ha avsluttet abonnementet, og være abonnent på denne ressursen og på hendelsestypen `Incident` der siden lar abonnentene velge.

**Varsler er ikke øyeblikkelige.** Jobben som sender dem, kjører én gang i minuttet, så regn med opptil omtrent ett minutt mellom at du lagrer notatet og at posten går ut. Det er det etiketten **Sending Soon** betyr.

Kolonnen **Abonnentvarselsstatus** følger hele reisen:

| Status                       | Hva det betyr                                            |
| ---------------------------- | -------------------------------------------------------- |
| **Notifications skipped.**   | En av portene over var lukket. Årsaken registreres.      |
| **Sending Soon**             | I kø, venter på neste kjøring av sendejobben.            |
| **Notifications Being Sent** | Jobben arbeider seg gjennom abonnentlisten.              |
| **Varsler sendt**            | Alle abonnentvarsler gikk ut.                            |
| **Mislyktes**                | Jobben feilet; feilen er lagret sammen med notatet.      |

Klikk **flere detaljer** på statusen for å åpne **Detaljer om varselstatus**. Der en ny utsendelse gir mening, heter knappen i den dialogen **Retry**, og den setter notatet tilbake i ventetilstand slik at neste kjøring plukker det opp igjen.

Selve meldingen abonnentene får, males per statusside og per kanal — e-post, SMS, Slack og Microsoft Teams har hver sin mal for hendelsen **Subscriber Incident Note Created**, med variabler for statussidens navn og URL, detaljlenken, de berørte ressursene, hendelsens alvorlighetsgrad og tittel, notatteksten, og en avmeldingslenke per abonnent. Se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) for hvordan de malene og kanalene settes opp.

## Hendelsesfeeden

Kortet **Hendelse Feed** ligger nederst i venstre kolonne på hendelsens side **Oversikt**. Det er historien om hendelsen i rekkefølge: hvert element er et ikon, avataren og navnet til den som forårsaket det, et relativt tidsstempel med den eksakte lokale tiden når du holder musepekeren over, og en Markdown-tekst. Elementene er sortert eldst først.

Enkelte elementer bærer ekstra detaljer — et eiervarsel lister for eksempel opp alle som fikk e-post. De viser en knapp **More Information** som åpner et panel **More Information**.

Korthodet har også en meny **Handlinger**, slik at du kan handle uten å forlate tidslinjen:

- **Execute Runbook** — start en [runbook](/docs/runbooks/index) mot denne hendelsen.
- **Kjør vakttjenesteretningslinje** — tilkall en policy på forespørsel.
- **Add Public Note** — de samme fire feltene som på siden Offentlige notater, i en dialog.
- **Legg til privat notat** — bare notattekst og vedlegg.

Ved siden av den henter **Oppdater** feeden på nytt.

**Feeden kan bare tilføyes, og den er ikke revisjonsloggen din.** API-et tillater å opprette og lese feed-elementer, men ikke å oppdatere eller slette dem, så ingen kan stille og rolig skrive om historien til en hendelse. Den er heller ikke permanent: på betalte installasjoner fjernes feed-rader som er eldre enn tre år. For et varig register over hvem som endret hva, bruk **Revisjon → Revisjonslogger** i hendelsens sidemeny.

## Hva feeden registrerer

Feed-elementer skrives av hendelsestjenesten selv, av begge notattjenestene, av tilstandstidslinjen, av eier- og medlemsendringer, av regelmotorene, av vaktkjøringen, av AI-undersøkelsen og etteranalysekjøringen, og av cron-jobbene for varsling. Hendelsestypene dekker:

- **Selve hendelsen** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notater og oppsummeringer** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Mennesker** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Varsler** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Hver type får sitt eget ikon, så du kan skumme en lang feed og plukke ut tilstandsendringene fra skravlingen. AI-generert rotårsaksanalyse merkes tydelig og vises i en begrenset Markdown-modus.

Feeder respekterer hendelsens personvern: for private hendelser filtreres feed-lesinger på samme måte som hendelsen selv.

## Eiere

Eiere er menneskene og teamene som er ansvarlige for en hendelse. De er varslingsmålet for alt som skjer med den — og de er grunnen til at en hendelse ikke går ubemerket hen mens alle antar at noen andre er på saken.

Åpne **Team → Eiere** i hendelsens sidemeny. Kortet **Eiere** viser en teller og beskriver eiere som menneskene og teamene som er ansvarlige for denne hendelsen og som varsles om endringer, med en løpende opptelling som «2 personer · 1 team». Eiere vises som overlappende avatarer; holder du musepekeren over en, ser du personens e-post eller at oppføringen er merket som **Team**.

- Klikk **Legg til eier** for å åpne en velger med et søkefelt for personer eller team.
- Klikk fjerne-kontrollen på en avatar for å åpne bekreftelsen **Fjern eier**, og deretter **Fjern**.
- Uten eiere ennå sier kortet fra og inviterer deg til å legge til en kollega eller et team, slik at de varsles om endringer.

Eierbrukere og eierteam er separate poster — å legge til et team gjør hvert medlem av det teamet til eier med tanke på varsling, uten å liste dem opp enkeltvis.

## Hvordan eiere blir tildelt

Det er fire veier inn på eierlisten:

- **Fra en hendelsesmal** — maler bærer feltene **Eier - Team** og **Eier - Brukere**, beskrevet som teamene og brukerne som eier hendelsen og som varsles når den opprettes eller oppdateres. Å opprette en hendelse fra malen forhåndsutfyller dem. Se [Opprette en hendelse](/docs/incidents/declaring-incidents).
- **Fra Eierregler for hendelse** — regler som treffer legger til eiere automatisk ved opprettelse.
- **Ved opprettelse gjennom API-et** — eierbrukere og -team som sendes med opprettelseskallet legges til med én gang, med et flagg som styrer om de får e-posten om at de ble lagt til.
- **For hånd** — kontrollen **Legg til eier** på siden **Eiere**, når som helst i løpet av hendelsen.

Å legge til den samme personen to ganger er trygt; eiere som allerede er tildelt, dupliseres ikke.

## Eierregler for hendelse

**Eierregler for hendelse** tildeler eierbrukere og -team automatisk når hendelser som treffer opprettes — rutingslaget som gjør at en databasehendelse havner hos databaseteamet uten at noen må tenke på det. Du finner dem sammen med resten av hendelsesautomatiseringen som dekkes i [Hendelsesinnstillinger og automatisering](/docs/incidents/settings).

Regelskjemaet har tre trinn — **Grunnleggende informasjon**, **Treffkriterier** og **Eiere** — og eiertrinnet rommer to seksjoner:

- **Eiere å tildele** — velg **Eierteam** og **Eierbrukere**. Når regelen treffer, legges hver valgt bruker og hvert valgt team til som eier, og eiere som allerede er tildelt dupliseres ikke.
- **Arv eiere** — tildel eiere fra beslektede enheter i stedet for å navngi dem. **Arv eiere fra overvåkere** gjør hver eier av hendelsens overvåkinger til eier av hendelsen, og **Arv eiere fra verter**, **… fra Kubernetes-klynger**, **… fra Docker-verter**, **… fra Podman-verter** og **… fra tjenester** gjør det samme for de ressursene.

En bryter **Varsle eiere** styrer om folk får vite om det. La den stå på for reell ruting; slå den av for å legge til eiere i stillhet — nyttig når en regel er en regnskapsbekvemmelighet heller enn en tilkalling.

Hver regelkjøring skrives til hendelsesfeeden, så du kan alltid se om en person ble lagt til av en regel eller av et menneske.

## Hva eiere blir varslet om

Fem jobber varsler eiere, hver av dem kjørende én gang i minuttet:

- **Hendelse opprettet** — emne `[New Incident {number}] - {title}`.
- **Et notat ble postet** — for offentlige *og* private notater, emne `[Update Incident {number}] - {title}`.
- **Hendelsens tilstand endret seg** — se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).
- **Du ble lagt til som eier** — emne `You have been added as the owner of Incident {number} - {title}`.
- **Fortsatt uløst** — en påminnelse styrt av hendelsens neste påminnelsestidspunkt, emne `[Reminder] Incident {number} is still {state} - {title}`.

Hvert varsel bygges for e-post, SMS, taleanrop, push og WhatsApp og overleveres til brukerens varslingsinnstillinger, som avgjør hva som faktisk sendes. Hver mottaker kan slå av hver enkelt av disse individuelt — innstillingene per bruker er formulert som at de sender deg varsler om hendelse opprettet, notat postet, tilstand endret, eier lagt til, medlem tildelt, og påminnelse om fortsatt åpen. Noen som bare vil ha en telefon ved tilstandsendringer, kan få nøyaktig det.

**Eierløse hendelser er ikke stille.** Har en hendelse ingen eiere i det hele tatt, faller varslingsjobbene tilbake på prosjektets eiere, så ingenting mistes på veien. Hver person som varsles legges også til på det tilhørende feed-elementet, slik at du etterpå kan se nøyaktig hvem som fikk beskjed, og på hvilken adresse.

## Hvor du leser videre

- [Hendelser – Oversikt](/docs/incidents/index) — hva en hendelse er, og hvordan delene henger sammen.
- [Opprette en hendelse](/docs/incidents/declaring-incidents) — å opprette hendelser for hånd, fra maler og fra overvåkinger.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — tilstandsmaskinen som driver halve feeden.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — eierregler, notatmaler og resten av automatiseringen.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — hvor offentlige notater ender opp, og hvem som mottar dem.
- [Statussider – Oversikt](/docs/status-pages/index) — den kundevendte siden av en hendelse.
