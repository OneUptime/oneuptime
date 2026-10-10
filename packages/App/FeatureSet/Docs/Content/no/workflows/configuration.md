# Arbeidsflyt-konfigurasjon & sikkerhet

Dette bør du vite før du retter en arbeidsflyt mot ekte trafikk: hvordan du slår den trygt på, hvem som kan gjøre hva, hvordan hemmeligheter og URL-er forblir private, hva trinnene i en arbeidsflyt kan endre, og grensene hver kjøring arbeider innenfor.

:::cards
- [Gå live](#å-slå-en-arbeidsflyt-på-eller-av): Test med Kjør arbeidsflyt, og la deretter arbeidsflyten stå på.
- [Tillatelser](#tillatelser): Arbeidsflytrollene og de enkelte tillatelsene bak dem.
- [Hva trinn kan gjøre](#hva-arbeidsflyttrinn-kan-gjøre): Trinn handler som Project Admin i prosjektet til arbeidsflyten.
- [Grenser](#plangrenser): Kjøringer per plan, kjøretid og kall mellom arbeidsflyter.
:::

## Å slå en arbeidsflyt på eller av

Hver arbeidsflyt har en bryter, **Aktivert**, øverst i **Bygger** og på siden **Oversikt**. Når den er av, kjører ikke arbeidsflyten — webhook-kall, innkommende e-post, planlagte tidspunkter og OneUptime-begivenheter ignoreres alle, og det samme gjør **Kjør arbeidsflyt** og **Run just this step**. Nye arbeidsflyter starter deaktivert.

Bruk denne bryteren som «klar til bruk»-porten din:

:::steps
1. Bygg arbeidsflyten.
2. Klikk på **Kjør arbeidsflyt** i **Bygger** med realistiske verdier. En deaktivert arbeidsflyt kan ikke kjøre, heller ikke manuelt, så Bygger ber deg slå den på først: klikk på **Slå på og kjør**.
3. Åpne kjøringen, og sjekk at hver blokk gikk dit du forventet. Se [Kjøringer](/docs/workflows/runs-and-logs).
4. La **Aktivert** stå på hvis den er klar. Er den ikke det, slår du den av til den er det: mens den er på, utløses triggeren ved ekte begivenheter.
:::

Å slå av en arbeidsflyt hindrer nye kjøringer i å starte. En kjøring som allerede pågår, gjør seg ferdig, men en kjøring som venter ved en **Sleep**-blokk, avbrytes når den våkner.

## Å arkivere en arbeidsflyt

Arkiver en arbeidsflyt du ikke lenger trenger, men vil beholde. En arkivert arbeidsflyt:

- **Kjører aldri**, fra noen trigger. Manuelle kjøringer og **Run just this step**, webhook-kall, tidsplaner, OneUptime-begivenheter, innkommende e-post og **Execute Workflow**-trinn i andre arbeidsflyter avvises alle. Et webhook-kall til en arkivert arbeidsflyt får en feil som sier at arbeidsflyten er arkivert.
- **Stopper kjøringer som venter.** En kjøring som sover i et **Sleep**-trinn, avbrytes når den våkner, og en kjøring som sto i kø, men ennå ikke hadde startet, slutter med "Workflow was archived before this run started, so it did not run."
- **Forsvinner fra listen over arbeidsflyter.** Du finner den under **Arbeidsflyter → Avansert → Arkivert**.
- **Beholder alt.** Trinnene, variablene, eierne, etikettene og kjøringshistorikken forblir som de var.

For å arkivere én arbeidsflyt åpner du den, går til **Innstillinger** og klikker på **Arkiver**. For å arkivere flere merker du dem i listen **Arbeidsflyter** og velger **Arkiver**.

For å hente en arbeidsflyt tilbake åpner du **Arbeidsflyter → Avansert → Arkivert**, merker den og velger **Fjern fra arkiv**, eller du åpner den og klikker på **Fjern fra arkiv** i banneret øverst på sidene dens.

Arkivering og bryteren **Aktivert** er to forskjellige ting. Arkivering rører ikke bryteren, så en arbeidsflyt som var på, kjører igjen så snart den fjernes fra arkivet, og en som var av, forblir av. Siden **Arkivert** viser i kolonnen **When Unarchived** hvilken som er hvilken.

En eksportert arbeidsflyt tar aldri med seg den arkiverte tilstanden, så en importert kopi er aldri arkivert.

## Eiere og etiketter

| Hva               | Hvor                                              | Hva det gjør                                                                                                                                              |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eiere**         | Siden **Eiere** til arbeidsflyten                 | Brukerne og teamene som er ansvarlige for arbeidsflyten. En rolle som er begrenset til det teamet eier, når arbeidsflytene det teamet eier.               |
| **Etiketter**     | Siden **Oversikt** til arbeidsflyten              | Merkelapper for å gruppere arbeidsflyter etter team, integrasjon eller miljø. Filtrer listen **Arbeidsflyter** på etikett, og begrens en rolle til bestemte etiketter. |
| **Etikettregler** | **Arbeidsflyter → Innstillinger → Etikettregler** | Sett etiketter på nye arbeidsflyter automatisk, ut fra mønstre i navnet eller beskrivelsen.                                                               |
| **Eierregler**    | **Arbeidsflyter → Innstillinger → Eierregler**    | Tildel eiere til nye arbeidsflyter automatisk.                                                                                                            |

Se [Etikett- og eierregler](/docs/configuration/label-and-owner-rules) for hvordan reglene samsvarer.

## Hemmeligheter

Merk en variabel som **hemmelig** hvis den inneholder noe sensitivt: verdien renses da ut av kjøringslogger og trinnspor. Ingen variabelverdi kan leses tilbake når den er lagret, hemmelig eller ikke, verken i dashbordet eller via API-et, og når en variabel først er hemmelig, forblir den hemmelig.

Bruk hemmelige variabler til:

- API-nøkler til eksterne tjenester.
- Autentiseringstokener.
- Signeringsnøkler for webhooker.
- Alt du ikke vil at noen med bare lesetilgang skal se.

Ikke lim inn en hemmelighet direkte i en blokk — verdier som `Authorization: Bearer eyJh...` blir synlige i arbeidsflyten og i loggene. Bruk `{{global.variables.MY_SECRET}}` i stedet.

Er hemmeligheten et OAuth-tilgangstoken som utløper, gjør du variabelen til en [OAuth 2.0-variabel](/docs/workflows/variables#oauth-20-variabler-tokener-som-fornyer-seg-selv). OneUptime henter da tokenet fra identitetsleverandøren din og fornyer det hver gang en arbeidsflyt er i ferd med å bruke et utløpt token. OAuth 2.0-variabler er alltid hemmelige, og påloggingsinformasjonen deres er kryptert i databasen.

## Å eksportere og importere arbeidsflyter

Du kan flytte en arbeidsflyt mellom prosjekter, eller mellom en selvhostet installasjon og OneUptime Cloud, som en JSON-fil.

:::tabs
@tab Eksport
Åpne arbeidsflyten, gå til **Innstillinger**, og klikk på **Eksporter Arbeidsflyt**. For å legge flere arbeidsflyter i én fil merker du dem i listen **Arbeidsflyter** og velger **Eksporter JSON**.
@tab Import
Klikk på **Import JSON** i listen **Arbeidsflyter**, og velg en fil som er eksportert fra et hvilket som helst OneUptime-prosjekt. En arbeidsflyt med et navn prosjektet allerede har, importeres med "(Imported)" etter navnet.
:::

Filen inneholder navnet, beskrivelsen, aktiveringstilstanden og grafen til arbeidsflyten. Den inneholder med vilje ikke:

- **Den hemmelige nøkkelen til webhooken.** En ny genereres når arbeidsflyten opprettes, så en importert arbeidsflyt har en annen webhook-URL — kopier den fra Webhook-triggeren til den nye arbeidsflyten. Alt som kalte originalen, må pekes om.
- **Adressen for innkommende e-post.** En importert arbeidsflyt med en Incoming Email-trigger får sin egen adresse — kopier den fra triggeren til den nye arbeidsflyten. Alt som sendte e-post til originalen, må få den nye adressen.
- **Globale variabler.** En blokk som leser `{{global.variables.MY_SECRET}}`, beholder den referansen, men verdien er ikke i filen. Opprett variablene i målprosjektet før du kjører den importerte arbeidsflyten.
- **Eiere og etiketter.** Prosjektets egne etikett- og eierregler kjører mot den importerte arbeidsflyten, akkurat som om du hadde opprettet den manuelt.

En importert arbeidsflyt opprettes alltid **deaktivert**, selv om den var aktivert der den ble eksportert fra — grafen kan peke på monitorer, vaktpolicyer eller andre arbeidsflyter som ikke finnes i målprosjektet. Gå gjennom den, aktiver den, test den med **Kjør arbeidsflyt**, og la den så stå på. Duplisering av en arbeidsflyt oppfører seg på samme måte, slik at en kopi aldri begynner å kjøre ved siden av originalen før du har redigert den.

Fordi grafen følger med uendret, følger alt som er skrevet rett inn i en blokk, også med. Det er den praktiske grunnen til å holde påloggingsinformasjon i hemmelige variabler: eksporterer du en arbeidsflyt med et hardkodet token, gir du det tokenet til den som får filen.

## Webhook-sikkerhet

Webhook-triggere gir deg en unik URL. Alle som kjenner URL-en, kan kalle den. Slik beskytter du deg mot utilsiktede eller uønskede kall:

- Behandle URL-en som et passord. Ikke del den offentlig, og ikke legg den i et offentlig repo. Webhook-triggeren skjuler den hemmelige nøkkelen i URL-en til du klikker på **Vis**, og **Kopier URL** kopierer URL-en uten å vise den.
- Lekker URL-en, klikker du på Webhook-triggeren i **Bygger** og deretter på **Tilbakestill URL**. Arbeidsflyten får en ny URL, og den gamle slutter å virke med en gang.
- Sier triggeren at URL-en ender på ID-en til arbeidsflyten, tilbakestiller du den. Arbeidsflyter som ble opprettet før webhook-URL-er fikk sin egen hemmelige nøkkel, bruker i stedet ID-en til arbeidsflyten, og den kan alle som kan åpne arbeidsflyten, se.
- For sensitive arbeidsflyter ber du systemet som kaller, sende et delt token som header (som `X-Webhook-Token`), og sjekker det med en **If / Else**-blokk før noe viktig skjer. Lagre det forventede tokenet som en hemmelig variabel.
- For svært sensitive arbeidsflyter er en OneUptime-begivenhetstrigger og et manuelt importtrinn å foretrekke fremfor en offentlig webhook.

Bare personer som kan redigere arbeidsflyten — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller tilbakestille webhook-URL-en. Alle med URL-en kan starte arbeidsflyten hvor som helst fra, uten å logge inn, så alle andre ser en merknad om hvem de kan spørre i stedet. Det gjelder også en **Workflow Member**, som kjører arbeidsflyten manuelt fra **Bygger**.

## Sikkerhet for innkommende e-post

Incoming Email-triggeren gir arbeidsflyten sin egen adresse, og alle som kjenner adressen, kan sende e-post til den. Delen før `@` er den hemmelige nøkkelen til arbeidsflyten, så behandle adressen som et passord:

- Ikke publiser den, og ikke legg den i et offentlig repo. Triggeren skjuler nøkkelen til du klikker på **Vis**, og **Kopier adresse** kopierer adressen uten å vise den.
- Lekker adressen, klikker du på Incoming Email-triggeren i **Bygger** og deretter på **Tilbakestill adresse**. Arbeidsflyten får en ny adresse, og e-post til den gamle ignoreres fra da av.
- Hvem som helst kan sette en hvilken som helst avsender på en e-post, så **From** beviser ikke hvem som sendte den. Før en arbeidsflyt gjør noe viktig, sjekker du noe bare den ekte avsenderen vet — et token i emnet eller i en header — med en **If / Else**-blokk. Lagre det forventede tokenet som en hemmelig variabel.
- Nøkkelen skjules i alt kjøringen mottar — **To**, **CC**, headerne og innholdet — fordi loggen til kjøringen er synlig for alle som kan lese kjøringene til arbeidsflyten.

Bare personer som kan redigere arbeidsflyten — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller tilbakestille adressen. Alle andre ser en merknad om hvem de kan spørre.

## Utgående nettverkstilgang

API-blokker og andre HTTP-blokker sender forespørslene sine fra OneUptime, og IRC-blokken kobler seg fra OneUptime til porten på IRC-serveren. Hoster du selv, må du sørge for at installasjonen din kan nå tjenestene du kaller. Bruker du OneUptime Cloud, står de utgående IP-områdene våre i [IP-adresser](/docs/configuration/ip-addresses), slik at du kan tillate dem i den andre enden.

Hvilke adresser en blokk kan nå, avhenger av blokken:

| Blokker                                                        | Loopback, link-local, skymetadata                                            | Private nettverksadresser                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**-blokker og forespørsler fra **Run Custom JavaScript** | Avvises, med mindre den nøyaktige verten står i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Avvises, med mindre en administrator av en selvhostet installasjon tillater dem med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** og OAuth 2.0-token-URL-er             | Avvises                                                                      | Avvises i OneUptime Cloud. Tillatt på en selvhostet installasjon, med mindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`                     |
| Slack, Microsoft Teams, Discord og Telegram                    | Avvises                                                                      | Avvises: hver sender bare til adressene til sin egen tjeneste                                                                                     |

Se [Tilgang til private nettverk](/docs/self-hosted/private-network-access) for hvordan en administrator av en selvhostet installasjon åpner for dem.

## AI-komponenter

**Generate Text with AI** sender én forespørsel til en LLM: prosjektets standard-LLM-leverandør, eller installasjonens globale leverandør når prosjektet ikke har noen. Sett opp leverandører under **Prosjektinnstillinger → KI → LLM-leverandører**, og legg aldri API-nøkkelen til en leverandør eller et eget endepunkt i en arbeidsflyt.

Hva leverandøren mottar, og hva modellen kan gjøre med det:

- **Bare det du legger i blokken.** OneUptime sender en fast sikkerhetsinstruksjon og deretter blokkens **System Instructions**, **Prompt** og **Context**, med referansene fylt ut. **Context** kommer sist, etter en markør, og sikkerhetsinstruksjonen forteller modellen at alt etter markøren er upålitelige data, også tekst som ser ut som instruksjoner.
- **Ingenting annet.** Dataene fra triggeren, historikken til arbeidsflyten, utdata fra andre blokker, prosjektposter, telemetri og hemmeligheter legges aldri ved. De forlater bare OneUptime når du viser til dem i en av de tre innstillingene.
- **Tekst, og ingen verktøy.** Modellen kan ikke spørre OneUptime, gjøre HTTP-forespørsler eller endre data. Ekstra parametere fra en leverandør slipper bare gjennom en tillatelsesliste med felt som kun justerer genereringen: de kan ikke erstatte meldingene, legge til verktøy, nettsøk eller andre datakilder, be om noe annet enn tekst eller om flere svar, strømme, la leverandøren beholde forespørselen eller heve grensen for utdata i blokken. Felt OneUptime ikke kjenner, forkastes.
- **Modellen er administratorens valg.** Må genereringen holde seg frakoblet, velger du en modell som ikke henter noe på egen hånd hos leverandøren.

Hva som logges:

- Loggen til kjøringen skjuler blokkens **System Instructions**, **Prompt**, **Context** og **Response**. Senere blokker kan fortsatt bruke dem under kjøringen, og en blokk du setter en av dem inn i, logger den etter sine egne regler, så å sette en inn er et valg om å vise den.
- Leverandøren, modellen, antall tokener, **LLM Log ID** og en trygg feilmelding forblir synlige, for drift og fakturering. Den rå feilen fra en leverandør holdes utenfor alle logger, fordi en leverandør kan gjenta forespørselen i den.
- Hvert kall står under **Prosjektinnstillinger → KI → AI-logger** med leverandør, modell, status, tokener, kostnad og fakturering, uten prompten, svaret eller den rå feilen.

Hva blokken krever, og hva den koster:

- **Aktiver AI** må være slått på under **Prosjektinnstillinger → KI → AI Features**. I OneUptime Cloud må prosjektet også ha planen Growth eller høyere og et betalt abonnement. Selvhostede installasjoner uten fakturering har ikke noe plankrav.
- Kall gjennom en global leverandør med kostnad bruker prosjektets AI-kreditter.
- Hvert kall teller mot [prosjektets egne daglige AI-grenser](/docs/ai/ai-sre#the-projects-own-daily-limits), når en prosjekteier setter dem. Når en grense er nådd, tar blokken **Error** uten å kontakte modellen, frem til midnatt UTC.

| Grense                                                        | Verdi                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **System Instructions**, **Prompt** og **Context** til sammen | 50 000 tegn                                                              |
| **Temperature**                                               | Fra `0` til `1`                                                          |
| **Maximum Output Tokens**                                     | Fra `1` til `4096`, `1024` som standard                                  |
| Én forespørsel                                                | Forsøkes én gang, i høyst 60 sekunder                                    |
| Kall samtidig                                                 | 3 per prosjekt. Flere tar **Error**, og en senere kjøring kan prøve igjen. |

Feil i validering, konfigurasjon, tilgang, grenser, kreditt, samtidighet, leverandør og tidsavbrudd tar alle veien **Error**, med årsaken i **Error**. Koble til den veien før arbeidsflyten går live.

> [!WARNING]
> Hver verdi du viser til, er data du sender til leverandøren. Ikke legg en hemmelig variabel i prompten eller konteksten med mindre leverandøren er godkjent for å motta den. En selvhostet lokal leverandør som Ollama holder forespørsler innenfor din egen infrastruktur; en hostet leverandør mottar dem under sine egne vilkår for databehandling.

## Tillatelser

Arbeidsflyter følger den rollebaserte tilgangskontrollen i prosjektet ditt. De tre arbeidsflytrollene:

- **Workflow Admin** — bygger arbeidsflyter: oppretter, endrer, kjører og sletter dem, og administrerer variablene de bruker.
- **Workflow Member** — bruker dem: åpner arbeidsflyter og kjøringene deres, og kjører en arbeidsflyt manuelt med **Kjør arbeidsflyt**. Et medlem kan ikke opprette, endre eller slette en arbeidsflyt, eller kjøre ett av trinnene for seg.
- **Workflow Viewer** — leser arbeidsflyter og kjøringene deres.

**Project Owner** og **Project Admin** kan alt en Workflow Admin kan. **Project Member** kan opprette og slette arbeidsflyter, men ikke endre eller kjøre dem.

De enkelte tillatelsene, for et team eller en API-nøkkel som trenger nøyaktig én ting:

- **Create / Read / Edit / Delete Workflow** — de grunnleggende tillatelsene på selve arbeidsflyten. Å endre en arbeidsflyt, også å slå den på eller av og å arkivere den, krever **Edit Workflow**; **Delete Workflow** sletter bare.
- **Edit Workflow** — er også det som skal til for å kjøre ett trinn for seg med **Run just this step**, og for å se eller tilbakestille webhook-URL-en og adressen for innkommende e-post til en arbeidsflyt. Å kjøre en hel arbeidsflyt manuelt krever **Edit Workflow**, **Workflow Admin** eller **Workflow Member**.
- **Read Workflow Log** — nødvendig for å se kjøringer.
- **Create / Read / Edit / Delete Workflow Variables** — administrasjon av globale variabler og arbeidsflytvariabler.

En manuell kjøring når bare arbeidsflyter du kan åpne: en rolle som er begrenset til bestemte etiketter, eller til arbeidsflytene teamet ditt eier, kjører bare dem. Den som ikke kan kjøre en arbeidsflyt, ser **Kjør arbeidsflyt** nedtonet, med årsaken i verktøytipset.

Gi dem som bygger automatisering, **Workflow Admin**, og dem som bare starter den, **Workflow Member**. Hold redigeringstilgang til variabler for dem som administrerer hemmelighetene i prosjektet. Se [Brukere, team og tillatelser](/docs/permissions/index) for hvordan roller tildeles.

## Hva arbeidsflyttrinn kan gjøre

Trinnene som leser og endrer OneUptime-poster — komponentene Find, Create, Update og Delete, og triggerne On Create, On Update og On Delete — handler som en **Project Admin** i prosjektet til arbeidsflyten. Uansett hvem som bygde arbeidsflyten, møter et trinn de samme kontrollene som en Project Admin møter i dashbordet og API-et:

- **Bare arbeidsflytens eget prosjekt.** Et trinn leser og skriver postene i prosjektet arbeidsflyten hører til, og ingen andre, og en Update flytter aldri en post til et annet prosjekt.
- **Bare det en Project Admin har lov til.** Et trinn kan bare gi de team- og API-nøkkeltillatelsene en Project Admin selv har, så det kan ikke dele ut **Project Owner**-, fakturerings- eller prosjektslettingstillatelser, og det kan ikke legge noen til i et team der tillatelsene går lenger enn en Project Admins, som eierteamet. Et trinn kan ikke lese hvem som opprettet en probe eller en AI-agent, noe bare prosjekteiere ser.
- **Ikke lesing av runbook-påloggingsinformasjon.** En Project Admin har lov til å lese runbook-påloggingsinformasjon, men det lånes ikke ut til et trinn. Der en endring krever den lesingen — å la OneUptime AI kjøre kommandoene sine uten å spørre, å slå på **Kjører AI-utbedringskommandoer** for en Runner, å tildele SSH-påloggingsinformasjon til en Runner som kjører kommandoene til OneUptime AI, eller å navngi runbook-påloggingsinformasjon, som i trinnene til en runbook —, spørres det i stedet om personen som sist lagret trinnene i arbeidsflyten, og trinnet avvises med mindre den personen har lov til å lese runbook-påloggingsinformasjon (**Read Runbook Credential**, eller en Project Owner eller Project Admin). OneUptime registrerer den personen når noen oppretter arbeidsflyten, og hver gang noen lagrer trinnene; å gi arbeidsflyten nytt navn, endre etikettene eller slå den på eller av beholder hvem som sist lagret trinnene. Lagres trinnene med en API-nøkkel, registreres ingen, så trinnene i arbeidsflyten kan ikke gjøre disse endringene før en person lagrer dem.
- **Bare det planen din inkluderer.** I OneUptime Cloud avvises et trinn som oppretter eller endrer noe planen din ikke inkluderer, med planen det krever, akkurat som i dashbordet. Selvhostede installasjoner uten fakturering har ingen plangrenser.
- **Ingenting OneUptime holder for seg selv.** Dette avvises for alle, arbeidsflyter inkludert:
  - å redigere eller slette en feedoppføring (feedene til hendelser, varsler, episoder, monitorer, vaktpolicyer og planlagt vedlikehold);
  - å skrive en varslingslogg (loggene for SMS, anrop, e-post, WhatsApp, Telegram, push, webhooker og arbeidsområdemeldinger);
  - verdier OneUptime setter etter hvert som ting skjer: om CNAME-en til et egendefinert domene er verifisert, beskyttelsesbryterne til et team (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), hvilken hendelsesrolle som er den primære, og om den kan slettes, om en eier eller et medlem har fått varsel, tidspunkter og antall for påminnelser, hvem som har vakt i en vaktplan nå og som neste, fremdriften i en vaktkjøring, den nåværende burn raten og error budgeten til en SLO, en monitor som er satt på pause av en hendelse eller et vedlikehold, tokenet for tilbakestilling av passord og siste pålogging for en privat statussidebruker, opplysningene en tjeneste rapporterer om seg selv (versjon, runtime, sky), og siste kjøring av en deteksjonsregel eller en trusselfeed;
  - å erklære en hendelse ut fra en mal ved å sende `createdIncidentTemplateId` til **Create One Incident** — velg i stedet malen under trinnets innstilling **Incident Template**: trinnet erklærer da hendelsen ut fra den, som Project Admin, og registrerer malen;
  - å endre hvilken post en post hører til etter at den er opprettet, som monitoren en eierrad gjelder, eller hendelsen et notat står på.
- **Som ingen person.** En post som en arbeidsflyt oppretter, har ingen oppretter, og revisjonsloggen oppgir arbeidsflyten, med navnet den hadde da, som den som gjorde endringen.

Når en kontroll avviser et trinn, tar trinnet utgangen **Error** uten å gjøre den avviste endringen, og loggen til kjøringen nevner trinnet og årsaken med vanlige ord, for eksempel *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Les den under [Kjøringer](/docs/workflows/runs-and-logs) for arbeidsflyten. Et Create Many-trinn oppretter postene sine én om gangen og stopper ved den første som avvises: postene det opprettet før den, beholdes.

Trinn som snakker med andre systemer — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code og Generate Text with AI — leser eller endrer ikke OneUptime-poster, så ingenting av dette endrer noe for dem.

## Plangrenser

I OneUptime Cloud krever arbeidsflyter planen Growth eller høyere, og hver plan tillater et antall kjøringer i løpet av 30 dager:

| Plan       | Kjøringer de siste 30 dagene |
| ---------- | ---------------------------- |
| Growth     | 500                          |
| Scale      | 2000                         |
| Enterprise | Ingen praktisk grense        |

Vinduet glir: hver kjøring prosjektet registrerer, manuelt eller fra en trigger, teller i 30 dager. På planene Growth og Scale viser siden **Arbeidsflyter** et kort **Arbeidsflytkjøringer** med hvor mange prosjektet har brukt. Når grensen er nådd, registreres nye kjøringer med statusen **Execution Exceeded Current Plan** og utføres ikke, og det samme skjer mens abonnementet er ubetalt. Selvhostede installasjoner uten fakturering har ingen grense.

## Hvor lenge en kjøring kan vare

| Grense                                                            | Standard       | Innstilling ved selvhosting     |
| ----------------------------------------------------------------- | -------------- | ------------------------------- |
| En kjøring, fra starten eller fra den våkner etter en **Sleep**    | 2 minutter     | `WORKFLOW_TIMEOUT_IN_MS`        |
| En **Run Custom JavaScript**-blokk                                | 5 sekunder     | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| En **Sleep**-blokk                                                | Høyst 30 dager | —                               |

Kjøreren sjekker fristen før og etter hver blokk, og merker en kjøring som har gått over tiden, som **Timeout** så snart kontrollen kommer tilbake. Den kan ikke avbryte en blokk midtveis, så blokker som venter på nettverket, har sine egne tidsgrenser: en forespørsel fra Generate Text with AI gir opp etter høyst 60 sekunder, og en OAuth 2.0-tokenforespørsel etter 20. Ventetid ved en **Sleep**-blokk teller ikke med i tiden til en kjøring: kjøringen legges til side og får 2 nye minutter når den våkner.

## Grense for å kalle andre arbeidsflyter

Komponenten **Execute Workflow** lar én arbeidsflyt starte en annen. For å hindre løkker der arbeidsflyt A starter B, som starter A igjen, avvises en kjede av arbeidsflyter som starter hverandre, når den ville gått tilbake til en arbeidsflyt som allerede er i den, eller gått dypere enn 10 arbeidsflyter. Blokken **Execute Workflow** tar da utgangen **Error**, og feilen viser kjeden.

Har du et reelt behov for en lang kjede (som en jobb som behandler ett element per kjøring), er det vanligvis enklere å gå i løkke inne i én enkelt arbeidsflyt med **Run Custom JavaScript**.

## Når arbeidsflyter ikke er riktig verktøy

Noen tilfeller der du bør gripe til noe annet:

- **Tunge beregninger eller store datasett** — arbeidsflyter er laget for lett limarbeid, ikke tallknusing. Kjør tungt arbeid i din egen infrastruktur, og la en arbeidsflyt sette det i gang.
- **Langvarig aktiv beregning** — en kjøring har 2 minutter som standard. For en passiv pause som «gjør A, vent to timer, gjør B» bruker du komponenten **Sleep**; den legger kjøringen til side og gjenopptar den senere uten å oppta en worker.
- **Trinnvis hendelseshåndtering med mennesker involvert** — det er det [Runbooks](/docs/runbooks/index) er til. Arbeidsflyter er for automatisering uten tilsyn.

## Neste trinn

:::cards
- [Oversikt over arbeidsflyter](/docs/workflows/index): Det store bildet, og en første arbeidsflyt fra start til slutt.
- [Komponenter](/docs/workflows/components): Hva hver blokk trenger, returnerer og kan nå.
- [Runbooks](/docs/runbooks/index): Når folk må ta beslutningene underveis.
:::
