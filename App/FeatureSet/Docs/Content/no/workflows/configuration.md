# Konfigurasjon & sikkerhet

Denne siden dekker innstillingene og sikkerhetsgrensene det er verdt å kjenne til før du peker en arbeidsflyt mot ekte trafikk.

## Å slå en arbeidsflyt på eller av

Hver arbeidsflyt har en **Enabled**-bryter i **Settings**. Når den er av, kjører ikke arbeidsflyten — webhook-kall, planlagte tidspunkter og OneUptime-hendelser ignoreres alle sammen. Nye arbeidsflyter starter deaktiverte.

Bruk denne bryteren som din «klar til å gå»-sperre:

1. Bygg arbeidsflyten.
2. Klikk **Run Workflow** i **Builder** med realistiske verdier.
3. Sjekk **Logs** — sørg for at hver blokk gjorde det du forventet.
4. Slå **Enabled** på.

Å slå av en arbeidsflyt stopper ikke kjøringer som allerede pågår; det stopper bare nye fra å starte.

## Eiere og etiketter

- **Owners** — brukere og team oppført som eiere får tilgang til arbeidsflyten og kan velge å motta varsler når den feiler. Sett dem under **Settings → Owners**.
- **Labels** — etiketter for å gruppere arbeidsflyter. Arbeidsflytlisten lar deg filtrere på etikett, noe som gjør et travelt prosjekt mye lettere å navigere i. Nyttig når du har arbeidsflyter organisert etter team, integrasjon eller miljø.
- **Label rules** — under **Workflows → Settings → Label Rules**, bruk automatisk etiketter på nye arbeidsflyter basert på mønstre i navn eller beskrivelse.
- **Owner rules** — under **Workflows → Settings → Owner Rules**, tildel automatisk eiere til nye arbeidsflyter.

## Hemmeligheter

Merk en global variabel som en **secret** hvis den inneholder noe sensitivt. Verdien skjules fra vanlige API- og UI-lesinger etter at du har lagret den, og arbeidsflytloggingen fjerner den utledede verdien før kjøreloggen lagres.

Bruk hemmelige variabler for:

- API-nøkler for eksterne tjenester.
- Autentiseringstokener.
- Signeringsnøkler for webhooker.
- Alt du ikke ønsker at noen med lesetilgang skal kunne se.

Ikke lim en hemmelighet direkte inn i en blokk — verdier som `Authorization: Bearer eyJh...` ender opp synlige i arbeidsflyten og loggene. Bruk `{{global.variables.MY_SECRET}}` i stedet.

## Eksportere og importere arbeidsflyter

Du kan flytte en arbeidsflyt mellom prosjekter, eller mellom en selvhostet installasjon og OneUptime Cloud, som en JSON-fil.

- **Export** — åpne arbeidsflyten og bruk **Export Workflow** under **Settings**. Fra arbeidsflytlisten kan du også velge flere arbeidsflyter og eksportere dem til én enkelt fil.
- **Import** — på **Workflows**-listen, klikk **Import JSON** og velg en fil eksportert fra et hvilket som helst OneUptime-prosjekt.

Filen inneholder arbeidsflytens navn, beskrivelse, aktivert-status og grafen dens. Den inneholder bevisst ikke:

- **Webhook-hemmeligheten.** En ny genereres når arbeidsflyten opprettes, så en importert arbeidsflyt får en annen webhook-URL. Alt som kaller den opprinnelige må omdirigeres.
- **Globale variabler.** En blokk som leser `{{global.variables.MY_SECRET}}` beholder den referansen, men verdien er ikke i filen. Opprett variablene i målprosjektet før du kjører den importerte arbeidsflyten.
- **Eiere og etiketter.** Ditt eget prosjekts etikett- og eierregler kjører mot den importerte arbeidsflyten, på samme måte som om du hadde opprettet den for hånd.

En importert arbeidsflyt opprettes alltid **deaktivert**, selv om den var aktivert der den ble eksportert fra — grafen dens kan peke på overvåkinger, vaktordninger eller andre arbeidsflyter som ikke finnes i målprosjektet. Se gjennom den, aktiver den, test den med **Run Workflow**, og la den så stå på. Å duplisere en arbeidsflyt fungerer på samme måte, så en kopi begynner aldri å kjøre sammen med originalen før du har redigert den.

Fordi grafen følger med ordrett, følger alt som er skrevet direkte inn i en blokk med. Det er den praktiske grunnen til å holde legitimasjon i hemmelige variabler: å eksportere en arbeidsflyt med et hardkodet token gir det tokenet til den som mottar filen.

## Hvor lenge en kjøring kan ta

Hvert kjøringsforsøk har en absolutt tidsfrist. Kjøremotoren sjekker den før og etter hver komponent og markerer en forsinket kjøring som **Timeout** så snart kontrollen returnerer. Komponenter som utfører nettverks- eller skriptarbeid trenger også sine egne tidsavbrudd, fordi kjøremotoren ikke kan tvangsavbryte vilkårlig komponentkode.

AI-komponenten utleder sin leverandørforespørsel-tidsavbrudd fra gjenværende arbeidsflyttid og setter et tak på 60 sekunder, med litt margin til logging og opprydding.

## Grense for å kalle andre arbeidsflyter

**Execute Workflow**-komponenten lar én arbeidsflyt kalle en annen. For å hindre utilsiktede løkker der arbeidsflyt A kaller B som kaller A igjen, er det et tak på hvor dyp kjeden kan bli. En kjøring som går forbi grensen, avsluttes med en tydelig feilmelding.

Hvis du har et reelt behov for en lang kjede (som en jobb som behandler ett element per kjøring), er det vanligvis enklere å loope inne i en enkelt arbeidsflyt med **Custom Code**.

## Webhook-sikkerhet

Webhook-triggere gir deg en unik URL. Alle som kjenner URL-en kan treffe den. For å beskytte mot utilsiktede eller uønskede kallere:

- Behandle URL-en som et passord. Ikke del den offentlig eller commit den til et offentlig repo.
- For sensitive arbeidsflyter, be det kallende systemet sende et delt token som en header (som `X-Webhook-Token`) og sjekk det med en **Conditions**-blokk før du gjør noe viktig. Lagre det forventede tokenet som en hemmelig variabel.
- For svært sensitive arbeidsflyter, foretrekk en OneUptime-hendelsestrigger og et manuelt importtrinn fremfor en offentlig webhook.

## Utgående nettverkstilgang

API- og andre HTTP-blokker gjør forespørslene sine fra OneUptime. Hvis du selvhoster, sørg for at installasjonen din kan nå tjenestene du kaller. Hvis du bruker OneUptime Cloud, er våre utgående IP-områder listet i [IP Addresses](/docs/configuration/ip-addresses) slik at du kan tillate dem på den andre siden.

## AI-komponenter

**Generate Text with AI** sender én forespørsel gjennom OneUptimes konfigurerte LLM-gateway. Den bruker prosjektets standard LLM-leverandør, eller installasjonens globale leverandør når prosjektet ikke har en egen. Konfigurer leverandører under **Project Settings → AI → LLM Providers**; legg aldri inn en leverandørs API-nøkkel eller et vilkårlig modell-endepunkt i selve arbeidsflyten.

AI-komponenten har en eksplisitt utgangsgrense:

- OneUptime sender en fast komponent-sikkerhetsinstruksjon pluss de utledede feltene **System Instructions**, **Prompt** og serialisert **Context** til den konfigurerte leverandøren. Context legges til etter en eksplisitt markør på slutten av brukermeldingen; den faste instruksjonen sier at alt etter den markøren forblir upålitelig data selv om det inneholder tagger eller instruksjoner.
- Den legger ikke automatisk ved trigger-nyttelasten, arbeidsflythistorikk, andre komponenters output, prosjektposter, telemetri eller hemmeligheter. Data forlater bare når du refererer til det i ett av de tre feltene.
- Den sender ingen verktøydefinisjoner eller leverandørspesifikke kapabilitetsfelt. Modellen kan ikke spørre OneUptime, gjøre HTTP-forespørsler eller endre prosjektdata gjennom denne komponenten. Den konfigurerte leverandøren/modellen forblir en tillitsgrense administratoren styrer, så installasjoner som krever strengt frakoblet generering, bør velge en modell uten iboende leverandørstyrt henting.
- Ekstra parametere på leverandørnivå er begrenset til en tillatelsesliste med kun genereringsrelaterte innstillingsfelt. De kan ikke erstatte arbeidsflytmeldingene, legge til verktøy eller leverandørspesifikt websøk/datakilder, aktivere andre modaliteter enn tekst, be om flere valg, aktivere strømming, beholde forespørselen gjennom leverandørens lagringsflagg, eller heve denne komponentens tak for output-tokener. Ukjente fremtidige kapabilitetsfelt fjernes som standard.
- System Instructions, Prompt, Context og genererte Response-verdier sladdes fra denne AI-komponentens egne argument- og returverdi-oppføringer i den automatiske arbeidsflyt-kjøreloggen. De forblir tilgjengelige for nedstrøms komponenter mens kjøringen pågår. Hvis du setter en av dem inn i en annen komponent, gjelder den komponentens loggingspolicy, og den kan registrere den utledede verdien; behandle gjenbruk som en eksplisitt utlevering. Leverandør-/modellnavn, tokenantall, LLM Log ID og trygge feilmeldinger forblir synlige for drift og fakturering. Rå feilmeldinger fra leverandøren er ekskludert fra arbeidsflytlogger, LLM-logger, applikasjonslogger og spor fordi en leverandør kan gjenta forespørselsinnhold.

Behandle hver refererte variabel som data du bevisst sender til leverandøren. Sett spesielt aldri en hemmelig global variabel inn i prompten eller konteksten med mindre den utleveringen er nødvendig og leverandøren er godkjent for å motta den. En selvhostet lokal leverandør som Ollama kan holde forespørselen inne i din egen infrastruktur; en hostet leverandør mottar forespørselen under den leverandørens vilkår for databehandling.

Hvert kall registreres under **Project Settings → AI → AI Logs**, inkludert leverandør, modell, status, tokener, kostnad og faktureringsinformasjon. Forhåndsvisninger av prompt og svar samt rå feildetaljer fra leverandøren lagres ikke i AI-loggen. Kall gjennom en kostnadsbelagt global leverandør trekker fra prosjektets AI-kredittsaldo. Workflow AI teller også mot prosjektets daglige budsjett for autonome AI-tokener; når budsjettet er brukt opp, tar komponenten sin **Error**-vei uten å kontakte modellen. Project AI må være aktivert. På OneUptime Cloud må abonnementet være betalt, og Growth-planen (eller en plan som inkluderer Growth-funksjoner) kreves; selvhostede installasjoner med fakturering deaktivert har ikke denne plansperren.

Innebygde grenser holder ubetjente kall endelige: System Instructions, Prompt og serialisert Context er begrenset til 50 000 tegn samlet; Temperature må være fra `0` til `1`; Maximum Output Tokens må være fra `1` til `4096` (standard `1024`); og leverandørforespørselen forsøkes én gang og får tidsavbrudd etter maksimalt 60 sekunder. Maks tre workflow-AI-kall kjører samtidig per prosjekt; ytterligere kall tar **Error**-veien og kan gjøres på nytt av en senere arbeidsflytkjøring. Validerings-, konfigurasjons-, tilgangs-, budsjett-, saldo-, samtidighets-, leverandør- og tidsavbruddsfeil tar alle **Error**-veien og fyller ut **Error**-outputen. Koble til den veien før du aktiverer en produksjonsarbeidsflyt.

## Tillatelser

Arbeidsflyter respekterer prosjektets rollebaserte tilgangskontroll. De relevante tillatelsene:

- **Create / Read / Edit / Delete Workflow** — de grunnleggende tillatelsene på selve arbeidsflyten.
- **Run Workflow** — nødvendig for å kjøre en arbeidsflyt for hånd eller utløse en via API.
- **Read Workflow Log** — nødvendig for å se kjøringer.
- **Read / Create / Edit / Delete Workflow Variable** — kontroll over listen over globale variabler.

De fleste ingeniører bør ha create/edit/read på arbeidsflyter, men ikke på variabler. Behold redigeringstilgang til variabler for de som forvalter prosjektets hemmeligheter.

## Plangrenser

OneUptime Cloud setter et tak på antall kjøringer per måned på mindre planer. Din nåværende grense vises under **Project Settings → Billing**. Når du når den, avvises nye triggere til neste faktureringssyklus. Selvhostede installasjoner har ikke denne grensen.

## Når arbeidsflyter ikke er riktig verktøy

Noen tilfeller hvor du bør gripe til noe annet:

- **Tung beregning eller store datasett** — arbeidsflyter er designet for lett limarbeid, ikke tallknusing. Kjør tungt arbeid i din egen infrastruktur og la en arbeidsflyt utløse det.
- **Langvarig aktiv beregning** — ett kjøringsforsøk er ment å fullføres raskt. For en passiv forsinkelse som «gjør A, vent to timer, gjør B», bruk **Sleep**-komponenten; den lagrer kjøringen og gjenopptar den senere uten å oppta en arbeider.
- **Trinn-for-trinn hendelsesrespons med mennesker i loopen** — det er det [Runbooks](/docs/runbooks/index) er til for. Arbeidsflyter er for automatisering uten oppsyn.

## Hvor du kan lese videre

- [Workflows Overview](/docs/workflows/index) — det store bildet.
- [Components](/docs/workflows/components) — referanse blokk for blokk.
- [Runbooks](/docs/runbooks/index) — når du skal bruke en runbook i stedet.
