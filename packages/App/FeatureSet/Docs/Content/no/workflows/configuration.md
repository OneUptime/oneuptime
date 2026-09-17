# Konfigurasjon & sikkerhet

Denne siden dekker innstillingene og sikkerhetsgrensene det er verdt å kjenne til før du peker en arbeidsflyt mot ekte trafikk.

## Å slå en arbeidsflyt på eller av

Hver arbeidsflyt har en **Aktivert**-bryter under **Innstillinger**. Er den av, kjører ikke arbeidsflyten — webhook-kall, planlagte tidspunkter og hendelser i OneUptime blir alle ignorert. Nye arbeidsflyter starter deaktivert.

Bruk denne bryteren som din «klar til å gå»-port:

1. Bygg arbeidsflyten.
2. Klikk **Kjør arbeidsflyt** i **Bygger** med realistiske verdier.
3. Sjekk **Logger** — forsikre deg om at hver blokk gikk dit du ventet.
4. Slå på **Aktivert**.

Å slå av en arbeidsflyt stopper ikke kjøringer som allerede er i gang; det hindrer bare nye i å starte.

## Eiere og etiketter

- **Eiere** — brukere og team som står oppført som eiere, får tilgang til arbeidsflyten og kan velge å bli varslet når den feiler. Sett dem under **Innstillinger → Eiere**.
- **Etiketter** — merkelapper for å gruppere arbeidsflyter. Arbeidsflytlisten kan filtreres på etikett, og det gjør et travelt prosjekt langt lettere å navigere i. Nyttig når du har arbeidsflyter organisert etter team, integrasjon eller miljø.
- **Etikettregler** — under **Arbeidsflyter → Innstillinger → Etikettregler** kan du sette etiketter automatisk på nye arbeidsflyter ut fra mønstre i navn eller beskrivelse.
- **Eierregler** — under **Arbeidsflyter → Innstillinger → Eierregler** kan du tildele eiere automatisk til nye arbeidsflyter.

## Hemmeligheter

Merk en global variabel som **hemmelig** hvis den inneholder noe sensitivt. Verdien skjules fra vanlige API- og UI-oppslag etter at du har lagret den, og arbeidsflytloggingen vasker bort den utledede verdien før kjøreloggen lagres.

Bruk hemmelige variabler til:

- API-nøkler til eksterne tjenester.
- Autentiseringstokener.
- Signeringsnøkler for webhooks.
- Alt du ikke vil at noen med kun lesetilgang skal se.

Ikke lim en hemmelighet rett inn i en blokk — verdier som `Authorization: Bearer eyJh...` ender opp synlige både i arbeidsflyten og i loggene. Bruk `{{global.variables.MY_SECRET}}` i stedet.

## Å eksportere og importere arbeidsflyter

Du kan flytte en arbeidsflyt mellom prosjekter, eller mellom en selvhostet installasjon og OneUptime Cloud, som en JSON-fil.

- **Eksport** — åpne arbeidsflyten og bruk **Export Workflow** under **Innstillinger**. Fra arbeidsflytlisten kan du også merke flere arbeidsflyter og eksportere dem til én enkelt fil.
- **Import** — i listen **Arbeidsflyter** klikker du **Import JSON** og velger en fil eksportert fra et hvilket som helst OneUptime-prosjekt.

Filen inneholder arbeidsflytens navn, beskrivelse, av/på-tilstand og grafen dens. Den inneholder med vilje ikke:

- **Den hemmelige webhook-nøkkelen.** En ny genereres når arbeidsflyten opprettes, så en importert arbeidsflyt har en annen webhook-URL. Alt som kaller originalen, må pekes om.
- **Globale variabler.** En blokk som leser `{{global.variables.MY_SECRET}}` beholder referansen, men verdien ligger ikke i filen. Opprett variablene i målprosjektet før du kjører den importerte arbeidsflyten.
- **Eiere og etiketter.** Prosjektets egne etikett- og eierregler kjøres mot den importerte arbeidsflyten, akkurat som om du hadde opprettet den for hånd.

En importert arbeidsflyt opprettes alltid **deaktivert**, selv om den var aktivert der den ble eksportert fra — grafen kan peke på overvåkinger, vaktplaner eller andre arbeidsflyter som ikke finnes i målprosjektet. Se gjennom den, aktiver den, test den med **Kjør arbeidsflyt**, og la den så stå på. Å duplisere en arbeidsflyt oppfører seg likedan, så en kopi begynner aldri å utløses ved siden av originalen før du har fått redigert den.

Fordi grafen reiser ordrett med, følger også alt som er tastet rett inn i en blokk med på lasset. Det er den praktiske grunnen til å holde legitimasjon i hemmelige variabler: eksporterer du en arbeidsflyt med et hardkodet token, gir du det tokenet til hvem enn som mottar filen.

## Hvor lenge en kjøring kan vare

Hvert kjøreforsøk har en frist målt i klokketid. Runneren sjekker den før og etter hver komponent, og merker en kjøring som har gått over tiden med **Timeout** så snart kontrollen kommer tilbake. Komponenter som gjør nettverks- eller skriptarbeid, trenger også sine egne tidsavbrudd, siden runneren ikke kan avbryte vilkårlig komponentkode med makt.

AI-komponenten utleder tidsavbruddet for leverandørforespørselen fra tiden som er igjen av arbeidsflyten, og setter taket på 60 sekunder, slik at det blir en liten margin til logging og opprydding.

## Grense for å kalle andre arbeidsflyter

Komponenten **Execute Workflow** lar én arbeidsflyt kalle en annen. For å hindre utilsiktede løkker der arbeidsflyt A kaller B som kaller A igjen, finnes det et tak på hvor dyp kjeden kan bli. En kjøring som går forbi grensen, avsluttes med en tydelig feil.

Har du et reelt behov for en lang kjede (som en jobb som behandler ett element per kjøring), er det som regel enklere å løkke inne i én enkelt arbeidsflyt med **Custom Code**.

## Webhook-sikkerhet

Webhook-triggere gir deg en unik URL. Alle som kjenner URL-en, kan treffe den. For å beskytte deg mot utilsiktede eller uønskede kall:

- Behandle URL-en som et passord. Ikke del den offentlig, og ikke sjekk den inn i et offentlig repo.
- For sensitive arbeidsflyter: be systemet som kaller om å sende et delt token som header (som `X-Webhook-Token`), og sjekk det med en **Conditions**-blokk før du gjør noe viktig. Lagre det forventede tokenet som en hemmelig variabel.
- For svært sensitive arbeidsflyter: velg heller en OneUptime-hendelsestrigger og et manuelt importsteg framfor en offentlig webhook.

## Utgående nettverkstilgang

API-blokker og andre HTTP-blokker gjør forespørslene sine fra OneUptime. Hoster du selv, må du sørge for at installasjonen din når fram til tjenestene du kaller. Bruker du OneUptime Cloud, er våre utgående IP-områder listet i [IP-adresser](/docs/configuration/ip-addresses), så du kan slippe dem inn på den andre siden.

## AI-komponenter

**Generate Text with AI** sender én forespørsel gjennom OneUptimes konfigurerte LLM-gateway. Den bruker prosjektets standard LLM-leverandør, eller installasjonens globale leverandør når prosjektet ikke har en egen. Konfigurer leverandører under **Prosjektinnstillinger → AI → LLM-leverandører**; legg aldri en leverandørs API-nøkkel eller et vilkårlig modell-endepunkt inn i selve arbeidsflyten.

AI-komponenten har en uttalt grense for hva som forlater systemet:

- OneUptime sender en fast sikkerhetsinstruksjon for komponenten, pluss de utledede verdiene av **System Instructions**, **Prompt** og serialisert **Context**, til den konfigurerte leverandøren. Context legges til etter en eksplisitt markør på slutten av brukermeldingen; den faste instruksjonen sier at alt etter den markøren forblir upålitelige data, selv når det inneholder tagger eller instruksjoner.
- Den legger ikke automatisk ved triggerens nyttelast, arbeidsflythistorikk, utdata fra andre komponenter, prosjektoppføringer, telemetri eller hemmeligheter. Data forlater systemet bare når du selv refererer til dem i ett av de tre feltene.
- Den sender ingen verktøydefinisjoner eller leverandørspesifikke evnefelt. Modellen kan ikke spørre OneUptime, gjøre HTTP-forespørsler eller endre prosjektdata gjennom denne komponenten. Den konfigurerte leverandøren/modellen forblir en tillitsgrense som administrator eier, så installasjoner som krever strengt frakoblet generering, bør velge en modell uten iboende, leverandørstyrt oppslag.
- Ekstra parametere på leverandørnivå er begrenset til en tillatelsesliste over felt som bare finjusterer genereringen. De kan ikke erstatte arbeidsflytens meldinger, legge til verktøy eller leverandørspesifikke websøk/datakilder, aktivere andre modaliteter enn tekst, be om flere alternativer, slå på strømming, la forespørselen bli lagret via leverandørens lagringsflagg, eller heve denne komponentens tak på utdata-tokener. Ukjente framtidige evnefelt forkastes som standard.
- System Instructions, Prompt, Context og genererte Response-verdier sladdes fra denne AI-komponentens egne argument- og returverdioppføringer i den automatiske kjøreloggen for arbeidsflyten. De forblir tilgjengelige for nedstrøms komponenter mens kjøringen pågår. Setter du en av dem inn i en annen komponent, gjelder den komponentens loggingspolicy, og den kan registrere den utledede verdien; behandle slik gjenbruk som en bevisst utlevering. Leverandør- og modellnavn, tokenantall, LLM Log ID og trygge feilmeldinger forblir synlige av hensyn til drift og fakturering. Rå feilmeldinger fra leverandøren holdes utenfor arbeidsflytlogger, LLM-logger, applikasjonslogger og spor, fordi en leverandør kan gjenta innholdet i forespørselen.

Behandle hver variabel du refererer til, som data du bevisst sender til leverandøren. Sett særlig ikke en hemmelig global variabel inn i prompten eller konteksten med mindre den utleveringen er nødvendig og leverandøren er godkjent for å motta den. En selvhostet lokal leverandør som Ollama kan holde forespørselen inne i din egen infrastruktur; en skybasert leverandør mottar forespørselen under sine egne databehandlingsvilkår.

Hvert kall registreres under **Prosjektinnstillinger → AI → AI-logger**, med leverandør, modell, status, tokener, kostnad og faktureringsinformasjon. Forhåndsvisninger av prompt og svar samt rå feildetaljer fra leverandøren lagres ikke i AI-loggen. Kall gjennom en global leverandør med kostnad trekker på prosjektets AI-kredittsaldo. AI i arbeidsflyter teller også mot prosjektets daglige tokenbudsjett for autonom AI; når budsjettet er brukt opp, tar komponenten **Error**-veien uten å kontakte modellen. AI må være aktivert for prosjektet. På OneUptime Cloud må abonnementet være betalt, og Growth-planen (eller en plan som inkluderer Growth-funksjonene) kreves; selvhostede installasjoner med fakturering avslått har ikke denne plansperren.

Innebygde grenser holder ubemannede kall endelige: System Instructions, Prompt og serialisert Context er begrenset til 50 000 tegn til sammen; Temperature må ligge fra `0` til og med `1`; Maximum Output Tokens må ligge fra `1` til og med `4096` (standard `1024`); og leverandørforespørselen forsøkes én gang og gir opp etter maksimalt 60 sekunder. Ikke mer enn tre AI-kall fra arbeidsflyter kjører samtidig per prosjekt; kall utover det tar **Error**-veien og kan prøves igjen av en senere kjøring. Feil i validering, konfigurasjon, tilgang, budsjett, saldo, samtidighet, leverandør og tidsavbrudd tar alle **Error**-veien og fyller **Error**-utdataen. Koble opp den veien før du aktiverer en arbeidsflyt i produksjon.

## Tillatelser

Arbeidsflyter respekterer prosjektets rollebaserte tilgangsstyring. De relevante tillatelsene:

- **Create / Read / Edit / Delete Workflow** — de grunnleggende tillatelsene på selve arbeidsflyten.
- **Run Workflow** — nødvendig for å kjøre en arbeidsflyt for hånd eller utløse en via API.
- **Read Workflow Log** — nødvendig for å se kjøringer.
- **Read / Create / Edit / Delete Workflow Variable** — kontroll over listen med globale variabler.

De fleste utviklere bør ha opprett/rediger/les på arbeidsflyter, men ikke på variabler. Spar redigeringstilgang på variabler til dem som forvalter prosjektets hemmeligheter.

## Plangrenser

OneUptime Cloud setter tak på antall kjøringer per måned på de mindre planene. Din nåværende grense står under **Prosjektinnstillinger → Fakturering**. Når du treffer den, avvises nye triggere fram til neste faktureringssyklus. Selvhostede installasjoner har ikke denne grensen.

## Når arbeidsflyter ikke er riktig verktøy

Noen tilfeller der du bør gripe etter noe annet:

- **Tung beregning eller store datamengder** — arbeidsflyter er laget for lett limarbeid, ikke tallknusing. Kjør det tunge i din egen infrastruktur, og la en arbeidsflyt sparke det i gang.
- **Langvarig, aktiv beregning** — ett kjøreforsøk er ment å bli ferdig raskt. For en passiv pause som «gjør A, vent to timer, gjør B», bruk komponenten **Sleep**; den lagrer kjøringen og gjenopptar den senere uten å legge beslag på en arbeider.
- **Trinnvis hendelseshåndtering med mennesker involvert** — det er det [Runbooks](/docs/runbooks/index) er til for. Arbeidsflyter er for ubemannet automatikk.

## Hvor du leser videre

- [Oversikt over arbeidsflyter](/docs/workflows/index) — det store bildet.
- [Arbeidsflyt-komponenter](/docs/workflows/components) — referanse blokk for blokk.
- [Runbooks – Oversikt](/docs/runbooks/index) — når du heller bør bruke et runbook.
