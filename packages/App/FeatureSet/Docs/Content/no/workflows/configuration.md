# Arbeidsflyt-konfigurasjon & sikkerhet

Dette bør du vite før du retter en arbeidsflyt mot ekte trafikk: hvordan du slår den trygt på, hvem som kan gjøre hva, hvordan hemmeligheter og URL-er forblir private, hva trinnene i en arbeidsflyt kan endre, og grensene hver kjøring arbeider innenfor.

:::cards
- [Gå live](#å-slå-en-arbeidsflyt-på-eller-av): Test med Kjør arbeidsflyt mens den er av, og slå den deretter på.
- [Tillatelser](#tillatelser): Arbeidsflytrollene og de enkelte tillatelsene bak dem.
- [Hva trinn kan gjøre](#hva-arbeidsflyttrinn-kan-gjøre): Trinn handler som Prosjektadministrator i prosjektet til arbeidsflyten.
- [Grenser](#plangrenser): Kjøringer per plan, kjøretid og kall mellom arbeidsflyter.
:::

## Å slå en arbeidsflyt på eller av

Hver arbeidsflyt har en bryter, **Aktivert**, øverst i **Bygger** og på siden **Oversikt**. Når den er av, er triggeren satt på pause — webhook-kall, innkommende e-post, planlagte tidspunkter, OneUptime-begivenheter og andre arbeidsflyters **Kjør en annen arbeidsflyt**-trinn starter den ikke. **Kjør arbeidsflyt** og **Run just this step** gjør det: en kjøring du starter selv mens arbeidsflyten er av, er en **Testkjøring**. Nye arbeidsflyter starter deaktivert.

Bruk denne bryteren som «klar til bruk»-porten din:

:::steps
1. Bygg arbeidsflyten.
2. Klikk på **Kjør arbeidsflyt** i **Bygger** med realistiske verdier, mens arbeidsflyten fortsatt er av. Kjøringen er en **Testkjøring**: hver blokk kjører på ekte, så pek den først mot en testkanal eller en testpost.
3. Åpne kjøringen, og sjekk at hver blokk gikk dit du forventet. Se [Kjøringer](/docs/workflows/runs-and-logs).
4. Slå på **Aktivert** når den er klar: fra da av utløses triggeren ved ekte begivenheter.
:::

Å slå av en arbeidsflyt hindrer triggeren i å starte nye kjøringer. En kjøring som allerede pågår, gjør seg ferdig, men en kjøring som triggeren startet, og som venter ved en **Pause**-blokk, avbrytes når den våkner. Testkjøringer fortsetter. For å slå flere på eller av samtidig merker du dem i listen **Arbeidsflyter** og velger **Aktiver** eller **Deaktiver** under **Massehandlinger**.

## Å arkivere en arbeidsflyt

Arkiver en arbeidsflyt du ikke lenger trenger, men vil beholde. En arkivert arbeidsflyt:

- **Kjører aldri**, fra noen trigger. Manuelle kjøringer og **Run just this step**, webhook-kall, tidsplaner, OneUptime-begivenheter, innkommende e-post og **Kjør en annen arbeidsflyt**-trinn i andre arbeidsflyter avvises alle. Et webhook-kall til en arkivert arbeidsflyt får en feil som sier at arbeidsflyten er arkivert.
- **Stopper kjøringer som venter.** En kjøring som sover i et **Pause**-trinn, avbrytes når den våkner, og en kjøring som sto i kø, men ennå ikke hadde startet, slutter med "Workflow was archived before this run started, so it did not run."
- **Forsvinner fra listen over arbeidsflyter.** Du finner den under **Arbeidsflyter → Avansert → Arkivert**.
- **Beholder alt.** Trinnene, variablene, eierne, etikettene og kjøringshistorikken forblir som de var.

For å arkivere én arbeidsflyt åpner du den, går til **Innstillinger** og klikker på **Arkiver**. For å arkivere flere merker du dem i listen **Arbeidsflyter** og velger **Arkiver**.

For å hente en arbeidsflyt tilbake åpner du **Arbeidsflyter → Avansert → Arkivert**, merker den og velger **Fjern fra arkivet**, eller du åpner den og klikker på **Fjern fra arkivet** i banneret øverst på sidene dens.

Arkivering og bryteren **Aktivert** er to forskjellige ting. Arkivering rører ikke bryteren, så en arbeidsflyt som var på, kjører igjen så snart den fjernes fra arkivet, og en som var av, forblir av. Siden **Arkivert** viser i kolonnen **Når den fjernes fra arkivet** hvilken som er hvilken.

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
Klikk på **Importer JSON** i listen **Arbeidsflyter**, og velg en fil som er eksportert fra et hvilket som helst OneUptime-prosjekt. En arbeidsflyt med et navn prosjektet allerede har, importeres med "(Imported)" etter navnet.
:::

Filen inneholder navnet, beskrivelsen, aktiveringstilstanden og grafen til arbeidsflyten. Den inneholder med vilje ikke:

- **Den hemmelige nøkkelen til webhooken.** En ny genereres når arbeidsflyten opprettes, så en importert arbeidsflyt har en annen webhook-URL — kopier den fra Webhook-triggeren til den nye arbeidsflyten. Alt som kalte originalen, må pekes om.
- **Adressen for innkommende e-post.** En importert arbeidsflyt med en Innkommende e-post-trigger får sin egen adresse — kopier den fra triggeren til den nye arbeidsflyten. Alt som sendte e-post til originalen, må få den nye adressen.
- **Globale variabler.** En blokk som leser `{{global.variables.MY_SECRET}}`, beholder den referansen, men verdien er ikke i filen. Opprett variablene i målprosjektet før du kjører den importerte arbeidsflyten.
- **Eiere og etiketter.** Prosjektets egne etikett- og eierregler kjører mot den importerte arbeidsflyten, akkurat som om du hadde opprettet den manuelt.

En importert arbeidsflyt opprettes alltid **deaktivert**, selv om den var aktivert der den ble eksportert fra — grafen kan peke på monitorer, vaktpolicyer eller andre arbeidsflyter som ikke finnes i målprosjektet. Gå gjennom den, test den med **Kjør arbeidsflyt**, og slå den så på. Duplisering av en arbeidsflyt oppfører seg på samme måte, slik at en kopi aldri begynner å kjøre ved siden av originalen før du har redigert den.

Fordi grafen følger med uendret, følger alt som er skrevet rett inn i en blokk, også med. Det er den praktiske grunnen til å holde påloggingsinformasjon i hemmelige variabler: eksporterer du en arbeidsflyt med et hardkodet token, gir du det tokenet til den som får filen.

## Webhook-sikkerhet

Webhook-triggere gir deg en unik URL. Alle som kjenner URL-en, kan kalle den. Slik beskytter du deg mot utilsiktede eller uønskede kall:

- Behandle URL-en som et passord. Ikke del den offentlig, og ikke legg den i et offentlig repo. Webhook-triggeren skjuler den hemmelige nøkkelen i URL-en til du klikker på **Vis**, og **Kopier URL** kopierer URL-en uten å vise den.
- Lekker URL-en, klikker du på Webhook-triggeren i **Bygger** og deretter på **Tilbakestill URL**. Arbeidsflyten får en ny URL, og den gamle slutter å virke med en gang.
- Sier triggeren at URL-en ender på ID-en til arbeidsflyten, tilbakestiller du den. Arbeidsflyter som ble opprettet før webhook-URL-er fikk sin egen hemmelige nøkkel, bruker i stedet ID-en til arbeidsflyten, og den kan alle som kan åpne arbeidsflyten, se.
- For sensitive arbeidsflyter ber du systemet som kaller, sende et delt token som header (som `X-Webhook-Token`), og sjekker det med en **Hvis / Ellers**-blokk før noe viktig skjer. Lagre det forventede tokenet som en hemmelig variabel.
- For svært sensitive arbeidsflyter er en OneUptime-begivenhetstrigger og et manuelt importtrinn å foretrekke fremfor en offentlig webhook.

Bare personer som kan redigere arbeidsflyten — **Prosjekteier**, **Prosjektadministrator**, **Arbeidsflytadministrator** eller **Edit Workflow** — kan se eller tilbakestille webhook-URL-en. Alle med URL-en kan starte arbeidsflyten hvor som helst fra, uten å logge inn, så alle andre ser en merknad om hvem de kan spørre i stedet. Det gjelder også en **Arbeidsflytmedlem**, som kjører arbeidsflyten manuelt fra **Bygger**.

## Sikkerhet for innkommende e-post

Innkommende e-post-triggeren gir arbeidsflyten sin egen adresse, og alle som kjenner adressen, kan sende e-post til den. Delen før `@` er den hemmelige nøkkelen til arbeidsflyten, så behandle adressen som et passord:

- Ikke publiser den, og ikke legg den i et offentlig repo. Triggeren skjuler nøkkelen til du klikker på **Vis**, og **Kopier adresse** kopierer adressen uten å vise den.
- Lekker adressen, klikker du på Innkommende e-post-triggeren i **Bygger** og deretter på **Tilbakestill adresse**. Arbeidsflyten får en ny adresse, og e-post til den gamle ignoreres fra da av.
- Hvem som helst kan sette en hvilken som helst avsender på en e-post, så **Fra** beviser ikke hvem som sendte den. Før en arbeidsflyt gjør noe viktig, sjekker du noe bare den ekte avsenderen vet — et token i emnet eller i en header — med en **Hvis / Ellers**-blokk. Lagre det forventede tokenet som en hemmelig variabel.
- Nøkkelen skjules i alt kjøringen mottar — **Til**, **CC**, headerne og innholdet — fordi loggen til kjøringen er synlig for alle som kan lese kjøringene til arbeidsflyten.

Bare personer som kan redigere arbeidsflyten — **Prosjekteier**, **Prosjektadministrator**, **Arbeidsflytadministrator** eller **Edit Workflow** — kan se eller tilbakestille adressen. Alle andre ser en merknad om hvem de kan spørre.

## Utgående nettverkstilgang

API-blokker og andre HTTP-blokker sender forespørslene sine fra OneUptime, og IRC-blokken kobler seg fra OneUptime til porten på IRC-serveren. Hoster du selv, må du sørge for at installasjonen din kan nå tjenestene du kaller. Bruker du OneUptime Cloud, står de utgående IP-områdene våre i [IP-adresser](/docs/configuration/ip-addresses), slik at du kan tillate dem i den andre enden.

Hvilke adresser en blokk kan nå, avhenger av blokken:

| Blokker                                                        | Loopback, link-local, skymetadata                                            | Private nettverksadresser                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**- og **Mattermost**-blokker samt forespørsler fra **Kjør egen JavaScript** | Avvises, med mindre den nøyaktige verten står i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Avvises, med mindre en administrator av en selvhostet installasjon tillater dem med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send e-post**, **IRC** og OAuth 2.0-token-URL-er             | Avvises                                                                      | Avvises i OneUptime Cloud. Tillatt på en selvhostet installasjon, med mindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`                     |
| Slack, Microsoft Teams, Discord og Telegram                    | Avvises                                                                      | Avvises: hver sender bare til adressene til sin egen tjeneste                                                                                     |

Se [Tilgang til private nettverk](/docs/self-hosted/private-network-access) for hvordan en administrator av en selvhostet installasjon åpner for dem.

## AI-komponenter

**Generer tekst med AI** sender én forespørsel til en LLM: prosjektets standard-LLM-leverandør, eller installasjonens globale leverandør når prosjektet ikke har noen. Sett opp leverandører under **Prosjektinnstillinger → KI → LLM-leverandører**, og legg aldri API-nøkkelen til en leverandør eller et eget endepunkt i en arbeidsflyt.

Hva leverandøren mottar, og hva modellen kan gjøre med det:

- **Bare det du legger i blokken.** OneUptime sender en fast sikkerhetsinstruksjon og deretter blokkens **Systeminstruksjoner**, **Prompt** og **Kontekst**, med referansene fylt ut. **Kontekst** kommer sist, etter en markør, og sikkerhetsinstruksjonen forteller modellen at alt etter markøren er upålitelige data, også tekst som ser ut som instruksjoner.
- **Ingenting annet.** Dataene fra triggeren, historikken til arbeidsflyten, utdata fra andre blokker, prosjektposter, telemetri og hemmeligheter legges aldri ved. De forlater bare OneUptime når du viser til dem i en av de tre innstillingene.
- **Tekst, og ingen verktøy.** Modellen kan ikke spørre OneUptime, gjøre HTTP-forespørsler eller endre data. Ekstra parametere fra en leverandør slipper bare gjennom en tillatelsesliste med felt som kun justerer genereringen: de kan ikke erstatte meldingene, legge til verktøy, nettsøk eller andre datakilder, be om noe annet enn tekst eller om flere svar, strømme, la leverandøren beholde forespørselen eller heve grensen for utdata i blokken. Felt OneUptime ikke kjenner, forkastes.
- **Modellen er administratorens valg.** Må genereringen holde seg offline, velger du en modell som ikke henter noe på egen hånd hos leverandøren.

Hva som logges:

- Loggen til kjøringen skjuler blokkens **Systeminstruksjoner**, **Prompt**, **Kontekst** og **Svar**. Senere blokker kan fortsatt bruke dem under kjøringen, og en blokk du setter en av dem inn i, logger den etter sine egne regler, så å sette en inn er et valg om å vise den.
- Leverandøren, modellen, antall tokener, **LLM-logg-ID** og en trygg feilmelding forblir synlige, for drift og fakturering. Den rå feilen fra en leverandør holdes utenfor alle logger, fordi en leverandør kan gjenta forespørselen i den.
- Hvert kall står under **Prosjektinnstillinger → KI → AI-logger** med leverandør, modell, status, tokener, kostnad og fakturering, uten prompten, svaret eller den rå feilen.

Hva blokken krever, og hva den koster:

- **Aktiver AI** må være slått på under **Prosjektinnstillinger → KI → AI-funksjoner**. I OneUptime Cloud må prosjektet også ha planen Growth eller høyere og et betalt abonnement. Selvhostede installasjoner uten fakturering har ikke noe plankrav.
- Kall gjennom en global leverandør med kostnad bruker prosjektets AI-kreditter.
- Hvert kall teller mot [prosjektets egne daglige AI-grenser](/docs/ai/ai-sre#prosjektets-egne-daglige-grenser), når en Prosjekteier setter dem. Når en grense er nådd, tar blokken **Feil** uten å kontakte modellen, frem til midnatt UTC.

| Grense                                                        | Verdi                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Systeminstruksjoner**, **Prompt** og **Kontekst** til sammen | 50 000 tegn                                                              |
| **Temperatur**                                               | Fra `0` til `1`                                                          |
| **Maksimalt antall utdatatokener**                                     | Fra `1` til `4096`, `1024` som standard                                  |
| Én forespørsel                                                | Forsøkes én gang, i høyst 60 sekunder                                    |
| Kall samtidig                                                 | 3 per prosjekt. Flere tar **Feil**, og en senere kjøring kan prøve igjen. |

Feil i validering, konfigurasjon, tilgang, grenser, kreditt, samtidighet, leverandør og tidsavbrudd tar alle veien **Feil**, med årsaken i **Feil**. Koble til den veien før arbeidsflyten går live.

> [!WARNING]
> Hver verdi du viser til, er data du sender til leverandøren. Ikke legg en hemmelig variabel i prompten eller konteksten med mindre leverandøren er godkjent for å motta den. En selvhostet lokal leverandør som Ollama holder forespørsler innenfor din egen infrastruktur; en hostet leverandør mottar dem under sine egne vilkår for databehandling.

## Tillatelser

Arbeidsflyter følger den rollebaserte tilgangskontrollen i prosjektet ditt. De tre arbeidsflytrollene:

- **Arbeidsflytadministrator** — bygger arbeidsflyter: oppretter, endrer, kjører og sletter dem, og administrerer variablene de bruker.
- **Arbeidsflytmedlem** — bruker dem: åpner arbeidsflyter og kjøringene deres, og kjører en arbeidsflyt manuelt med **Kjør arbeidsflyt**. Et medlem kan ikke opprette, endre eller slette en arbeidsflyt, eller kjøre ett av trinnene for seg. **Bygger** viser dem en arbeidsflyt slik den er, merket **Kun visning**: Et trinn åpnes for å leses, og ingenting de gjør der, lagres.
- **Arbeidsflytleser** — leser arbeidsflyter og kjøringene deres.

**Prosjekteier** og **Prosjektadministrator** kan alt en Arbeidsflytadministrator kan. **Prosjektmedlem** kan opprette og slette arbeidsflyter, men ikke endre eller kjøre dem.

De enkelte tillatelsene, for et team eller en API-nøkkel som trenger nøyaktig én ting:

- **Create / Read / Edit / Delete Workflow** — de grunnleggende tillatelsene på selve arbeidsflyten. Å endre en arbeidsflyt, også å slå den på eller av og å arkivere den, krever **Edit Workflow**; **Delete Workflow** sletter bare.
- **Edit Workflow** — er også det som skal til for å kjøre ett trinn for seg med **Run just this step**, og for å se eller tilbakestille webhook-URL-en og adressen for innkommende e-post til en arbeidsflyt. Å kjøre en hel arbeidsflyt manuelt krever **Edit Workflow**, **Arbeidsflytadministrator** eller **Arbeidsflytmedlem**.
- **Read Workflow Log** — nødvendig for å se kjøringer.
- **Create / Read / Edit / Delete Workflow Variables** — administrasjon av globale variabler og arbeidsflytvariabler.

En manuell kjøring når bare arbeidsflyter du kan åpne: en rolle som er begrenset til bestemte etiketter, eller til arbeidsflytene teamet ditt eier, kjører bare dem. Den som ikke kan kjøre en arbeidsflyt, ser **Kjør arbeidsflyt** nedtonet, med årsaken i verktøytipset.

En arbeidsflyt som kjører som **Prosjekteier** eller som en egendefinert rolle, endres og kjøres manuelt bare av personer som selv har de tillatelsene; alle andre kan bare se den i **Bygger**. Se [Run As](#run-as).

Gi dem som bygger automatisering, **Arbeidsflytadministrator**, og dem som bare starter den, **Arbeidsflytmedlem**. Hold redigeringstilgang til variabler for dem som administrerer hemmelighetene i prosjektet. Se [Brukere, team og tillatelser](/docs/permissions/index) for hvordan roller tildeles.

## Hva arbeidsflyttrinn kan gjøre

Trinnene som leser og endrer OneUptime-poster — komponentene Find, Create, Update og Delete, og triggerne On Create, On Update, On Create or Update og On Delete — handler som en **Prosjektadministrator** i prosjektet til arbeidsflyten. Uansett hvem som bygde arbeidsflyten, møter et trinn de samme kontrollene som en Prosjektadministrator møter i dashbordet og API-et:

- **Bare arbeidsflytens eget prosjekt.** Et trinn leser og skriver postene i prosjektet arbeidsflyten hører til, og ingen andre, og en Update flytter aldri en post til et annet prosjekt.
- **Bare det en Project Admin har lov til.** Et trinn kan ikke gjøre det bare **Prosjekteier** og tillatelser for fakturering eller prosjektsletting gir lov til, og det kan ikke lese hvem som opprettet en sonde eller en AI-agent, noe bare Prosjekteiere ser.
- **Ikke hvem som har tilgang.** Med standardtillatelsene oppretter, endrer og sletter et trinn ikke team, teammedlemmer, teamtillatelser eller egendefinerte roller, selv om en Prosjektadministrator har lov til det. Den som bygger en arbeidsflyt, bestemmer hva trinnene gjør, og det kan være en **Prosjektmedlem**, så et trinn som kunne det, ville gitt den som bygde den, tilgang vedkommende ikke har fått, som **Prosjektadministrator**. Trinnet avvises, og loggen til kjøringen nevner tillatelsen endringen krever, og sier at du skal velge **Run As** i arbeidsflytens **Innstillinger**: en arbeidsflyt som kjører som **Prosjekteier**, eller som en egendefinert rolle med den tillatelsen, kan gjøre endringen (se [Run As](#run-as)). Ingen trinn i en arbeidsflyt endrer API-nøkler, single sign-on eller SCIM-innstillinger, uansett hva arbeidsflyten kjører som. Triggere og Find-trinn på disse postene virker fortsatt.
- **Ikke lesing av innstillinger som inneholder påloggingsinformasjon.** En Prosjektadministrator har lov til å lese SMTP-servere, leverandører for anrop og SMS, SNMP-påloggingsinformasjon, videosamtaletilkoblinger og API-nøkler, men det lånes aldri ut til et trinn, uansett hvem som bygde eller lagret arbeidsflyten. Et trinn kan ikke angi noen av disse innstillingene, som SMTP-serveren en statusside sender e-post med, eller API-nøkkelen en tillatelse gis til. Trinnet avvises, og kjøreloggen sier at en person som kan lese dem (lesetillatelsen for den typen innstilling, eller en Prosjekteier eller Prosjektadministrator), må gjøre endringen. Et trinn som beholder innstillingen en post allerede angir, eller tømmer den, avvises ikke.
- **Ikke private hendelser, varsler og episoder.** En Prosjektadministrator ser enhver privat hendelse, hvert privat varsel og hver private episode, men det lånes aldri ut til et trinn, uansett hvem som bygde eller lagret arbeidsflyten. Et trinn finner ingen private poster, endrer ingen og legger ikke til noe i en, og en arbeidsflyt starter ikke på en slik post eller på noe som hører til den, enten en hendelse på en post eller **Kjør arbeidsflyt** starter den. Den som bygger en arbeidsflyt, bestemmer hvor det trinnene leser, sendes — en webhook, en e-post, en chat, kjøreloggen — og det kan være et **Prosjektmedlem** som ikke får se en privat post. Se [Private hendelser, varsler og episoder](/docs/permissions/index#private-hendelser-varsler-og-episoder).
- **Bare det planen din inkluderer.** I OneUptime Cloud avvises et trinn som oppretter eller endrer noe planen din ikke inkluderer, med planen det krever, akkurat som i dashbordet. Selvhostede installasjoner uten fakturering har ingen plangrenser.
- **Ingenting OneUptime holder for seg selv.** Dette avvises for alle, arbeidsflyter inkludert:
  - å redigere eller slette en feedoppføring (feedene til hendelser, varsler, episoder, monitorer, vaktpolicyer og planlagt vedlikehold);
  - å skrive en varslingslogg (loggene for SMS, anrop, e-post, WhatsApp, Telegram, push, webhooker og arbeidsområdemeldinger);
  - verdier OneUptime setter etter hvert som ting skjer: om CNAME-en til et egendefinert domene er verifisert, beskyttelsesbryterne til et team (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), hvilken hendelsesrolle som er den primære, og om den kan slettes, om en eier eller et medlem har fått varsel, tidspunkter og antall for påminnelser, hvem som har vakt i en vaktplan nå og som neste, fremdriften i en vaktkjøring, den nåværende burn raten og error budgeten til en SLO, en monitor som er satt på pause av en hendelse eller en vedlikeholdshendelse, tokenet for tilbakestilling av passord og siste pålogging for en privat statussidebruker, opplysningene en tjeneste rapporterer om seg selv (versjon, runtime, sky), og siste kjøring av en deteksjonsregel eller en trusselfeed;
  - å erklære en hendelse ut fra en mal ved å sende `createdIncidentTemplateId` til **Opprett Hendelse (én post)** — velg i stedet malen under trinnets innstilling **Hendelsesmal**: trinnet erklærer da hendelsen ut fra den, som Prosjektadministrator, og registrerer malen;
  - å endre hvilken post en post hører til etter at den er opprettet, som monitoren en eierrad gjelder, eller hendelsen et notat står på.
- **Som ingen person.** En post som en arbeidsflyt oppretter, har ingen oppretter, og revisjonsloggen oppgir arbeidsflyten, med navnet den hadde da, som den som gjorde endringen.

Når en kontroll avviser et trinn, tar trinnet utgangen **Feil** uten å gjøre den avviste endringen, og loggen til kjøringen nevner trinnet og årsaken med vanlige ord, for eksempel *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Les den under [Kjøringer](/docs/workflows/runs-and-logs) for arbeidsflyten. Et Create Many-trinn oppretter postene sine én om gangen og stopper ved den første som avvises: postene det opprettet før den, beholdes.

Trinn som snakker med andre systemer — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code og Generate Text with AI — leser eller endrer ikke OneUptime-poster, så ingenting av dette endrer noe for dem.

### Run As

Som standard kjører en arbeidsflyt med tillatelsene ovenfor, og de fleste arbeidsflyter trenger aldri mer. Når en gjør det – for eksempel en arbeidsflyt som gir hvert nytt team en egendefinert rolle –, åpner du **Innstillinger** for den, deretter **Flere innstillinger**, og velger **Change Run As**:

- Standard: tillatelsene ovenfor.
- Prosjekteier: det en **Prosjekteier** kan gjøre i dette prosjektet, inkludert å endre hvem som er med i et team og hva et team kan gjøre. Bare en Prosjekteier kan velge det.
- En egendefinert rolle: nøyaktig det en av prosjektets egendefinerte roller tillater. Bare den som kunne gitt et team den rollen, kan velge den.

Uansett hva arbeidsflyten kjører som, leser et trinn aldri innstillinger som inneholder påloggingsinformasjon, ser aldri private hendelser, varsler eller episoder og endrer aldri API-nøkler, single sign-on eller SCIM-innstillinger. Når det gir et team en tillatelse eller en rolle, kan det bare gi det det selv har, og mangler det noe, nevner loggen til kjøringen tillatelsen.

En arbeidsflyt som kjører med mer enn standardtillatelsene, kjører med tillatelsene til den som ga den dem: personen eller API-nøkkelen i prosjektet som sist valgte **Run As** for den, eller lagret trinnene eller variablene dens. Slik at ingen får mer gjennom den enn de selv har:

- Bare personer som har de tillatelsene, kan endre den eller variablene dens, arkivere eller slette den, kjøre den eller ett av trinnene dens manuelt, eller se webhook-URL-en og den innkommende e-postadressen dens. Alle som kan redigere den, kan fortsatt slå den av. Når den begynner å kjøre med mer enn standardtillatelsene, eller det endres hva den kjører som, får den en ny webhook-URL og en ny innkommende e-postadresse, så kopier av de gamle ikke lenger starter den.
- En person eller en av prosjektets API-nøkler kan gi dem, og bare det de selv har: tillatelsene til en nøkkel, med de egendefinerte rollene dens, veies som en persons. Trinnene i en arbeidsflyt og master-API-nøkkelen kan ikke gi dem, og å tilbakestille en nøkkel krever alle tillatelsene nøkkelen har.
- Hver kjøring sjekker først at den som ga dem, fortsatt har dem: en person som fortsatt er i prosjektet, eller en nøkkel som fortsatt finnes, ikke har utløpt og ikke har mistet dem. Hvis ikke, stopper kjøringen før det første trinnet, og loggen sier hvorfor og hvem som kan gi dem på nytt.
- Den leser ikke prosjektets globale variabler, som alle som kan redigere arbeidsflytvariabler, kan endre.
- Et **Kjør en annen arbeidsflyt**-trinn i en annen arbeidsflyt kan bare starte den hvis den arbeidsflyten kjører med de samme tillatelsene eller flere.

En eksportert, importert eller duplisert arbeidsflyt kjører med standardtillatelsene, uansett hva originalen kjørte som: den som har mer, velger **Run As** for den på nytt.

Hver kjøring registrerer hva den kjørte som og med hvems tillatelser, vist i vinduet til kjøringen og i en nedlastet logg. [Revisjonsloggen](/docs/configuration/audit-logs) registrerer hvem som endret **Run As** for en arbeidsflyt, en person eller en API-nøkkel med navn, og hver endring et trinn i en arbeidsflyt gjør, sier hva trinnet kjørte som og med hvems tillatelser. Revisjonsloggens filtre **Arbeidsflyt kjørt som** og **Arbeidsflytens tillatelser gitt av** finner disse endringene.

Å slette en egendefinert rolle som arbeidsflyter kjører som, ville stoppe dem, så slettingen viser dem og spør hva de skal kjøre som fra nå av: **Standardtillatelser** eller en annen egendefinert rolle du kunne gi et team. Den som ikke kan redigere arbeidsflyter, kan ikke slette rollen før Run As for dem er endret. Via API-et avvises sletting av en slik rolle med mindre forespørselen sier hva de skal kjøre som i stedet: `miscDataProps` med `workflowsRunAs` satt til `Default`, eller til `CustomRole` med rollens id i `workflowsRunAsCustomRoleId`.

## Plangrenser

I OneUptime Cloud krever arbeidsflyter planen Growth eller høyere, og hver plan tillater et antall kjøringer i løpet av 30 dager:

| Plan       | Kjøringer de siste 30 dagene |
| ---------- | ---------------------------- |
| Growth     | 500                          |
| Scale      | 2000                         |
| Enterprise | Ingen praktisk grense        |

Vinduet glir: hver kjøring prosjektet registrerer, manuelt eller fra en trigger, teller i 30 dager. På planene Growth og Scale viser siden **Arbeidsflyter** et kort **Arbeidsflytkjøringer** med hvor mange prosjektet har brukt. Når grensen er nådd, registreres nye kjøringer med statusen **Utførelse overskred gjeldende abonnement** og utføres ikke, og det samme skjer mens abonnementet er ubetalt. Selvhostede installasjoner uten fakturering har ingen grense. På en plan som ikke kjører arbeidsflyter, sier **Bygger** og siden **Arbeidsflyter** det, med en lenke for å oppgradere.

## Hvor lenge en kjøring kan vare

| Grense                                                            | Standard       | Innstilling ved selvhosting     |
| ----------------------------------------------------------------- | -------------- | ------------------------------- |
| En kjøring, fra starten eller fra den våkner etter en **Pause**    | 2 minutter     | `WORKFLOW_TIMEOUT_IN_MS`        |
| En **Kjør egen JavaScript**-blokk                                | 5 sekunder     | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| En **Pause**-blokk                                                | Høyst 30 dager | —                               |

Kjøreren sjekker fristen før og etter hver blokk, og merker en kjøring som har gått over tiden, som **Tidsavbrudd** så snart kontrollen kommer tilbake. Den kan ikke avbryte en blokk midtveis, så blokker som venter på nettverket, har sine egne tidsgrenser: en forespørsel fra Generate Text with AI gir opp etter høyst 60 sekunder, og en OAuth 2.0-tokenforespørsel etter 20. Ventetid ved en **Pause**-blokk teller ikke med i tiden til en kjøring: kjøringen legges til side og får 2 nye minutter når den våkner.

## Grense for å kalle andre arbeidsflyter

Komponenten **Kjør en annen arbeidsflyt** lar én arbeidsflyt starte en annen. For å hindre løkker der arbeidsflyt A starter B, som starter A igjen, avvises en kjede av arbeidsflyter som starter hverandre, når den ville gått tilbake til en arbeidsflyt som allerede er i den, eller gått dypere enn 10 arbeidsflyter. Blokken **Kjør en annen arbeidsflyt** tar da utgangen **Feil**, og feilen viser kjeden.

Har du et reelt behov for en lang kjede (som en jobb som behandler ett element per kjøring), er det vanligvis enklere å gå i løkke inne i én enkelt arbeidsflyt med **Kjør egen JavaScript**.

## Når arbeidsflyter ikke er riktig verktøy

Noen tilfeller der du bør gripe til noe annet:

- **Tunge beregninger eller store datasett** — arbeidsflyter er laget for lett limarbeid, ikke tallknusing. Kjør tungt arbeid i din egen infrastruktur, og la en arbeidsflyt sette det i gang.
- **Langvarig aktiv beregning** — en kjøring har 2 minutter som standard. For en passiv pause som «gjør A, vent to timer, gjør B» bruker du komponenten **Pause**; den legger kjøringen til side og gjenopptar den senere uten å oppta en worker.
- **Trinnvis hendelseshåndtering med mennesker involvert** — det er det [Runbooks](/docs/runbooks/index) er til. Arbeidsflyter er for automatisering uten tilsyn.

## Neste trinn

:::cards
- [Oversikt over arbeidsflyter](/docs/workflows/index): Det store bildet, og en første arbeidsflyt fra start til slutt.
- [Komponenter](/docs/workflows/components): Hva hver blokk trenger, returnerer og kan nå.
- [Runbooks](/docs/runbooks/index): Når folk må ta beslutningene underveis.
:::
