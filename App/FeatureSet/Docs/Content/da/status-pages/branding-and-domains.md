# Branding og brugerdefinerede domæner

En statusside er den ene OneUptime-flade, dine kunder faktisk kigger på, så den bør se ud, som om den tilhører dig, og bo på dit eget domæne. Begge dele konfigureres fra sektionen **Branding** i en statussides sidemenu, plus én indstilling der gemmer sig i **Avancerede indstillinger**.

Det, du skal vide, før du går i gang: branding er fordelt over syv separate skærme, og fordelingen er ikke altid, hvor du ville gætte. Logoet og coverbilledet er ikke på **Essentiel branding** — de er på **Sidehoved**. Faviconen er på **Essentiel branding**. Farver er på **Oversigtsside**. Alt andet, du måtte tænke på som "temaer", er Brugerdefineret CSS.

Denne side gennemgår hver skærm efter tur og fører dig derefter gennem hele CNAME-så-SSL-sekvensen til at sætte siden på `status.dinvirksomhed.dk`.

## Hvor hver brandingkontrol bor

Åbn en statusside, og sidemenuens sektion **Branding** har syv punkter. Her er kortet, så du holder op med at lede.

| Side                          | Hvad du sætter der                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Essentiel branding**        | Sidetitel, sidebeskrivelse, søgemaskineindeksering, favicon.                                 |
| **Sidehoved**                 | Logo, coverbillede, deres alt-tekst og linkbjælken i sidehovedet.                            |
| **Sidefod**                   | Copyright-linje og linkbjælken i sidefoden.                                                  |
| **Oversigtsside**             | Oversigtsbeskrivelse, søjlefarver i historikdiagrammet, nedetidsstatusser, samlet oppetidsprocent. |
| **HTML, CSS og JavaScript**   | Header-HTML, sidefods-HTML, brugerdefineret CSS, brugerdefineret JavaScript.                 |
| **Brugerdefinerede domæner**  | Dit eget domæne, CNAME-verifikation og SSL.                                                  |
| **Sprog**                     | Standardsprog og de sprog, der tilbydes i sidefodens vælger.                                 |

## Essentiel branding

**Statussider → din side → Branding → Essentiel branding** (`{id}/branding`) rummer tre kort.

- **Titel og beskrivelse** — kortet bemærker, at dette også bruges til SEO. **Rediger** åbner **Sidetitel** (pladsholder `Please enter page title here.`) og **Sidebeskrivelse**. Dette er, hvad søgemaskiner og link-previews viser, så skriv det til en kunde, ikke til dit team.
- **Search Engine Indexing** — en enkelt kontakt, **Allow Search Engines to Index this Status Page**, beskrevet i produktet som at styre, om Google og Bing må vise siden i deres resultater. Den er slået til som standard. Slå den fra, og siden serveres med `noindex, nofollow` i stedet.
- **Favicon** — **Edit Favicon** åbner billedupload til **Favicon**. Dette er det lille ikon i browserfanen.

Brug det, når: siden kun er intern eller stadig er ved at blive sat op. Slå **Allow Search Engines to Index this Status Page** fra, så en halvfærdig side ikke begynder at rangere på dit brandnavn.

## Skærmen Sidehoved

**Statussider → din side → Branding → Sidehoved** (`{id}/header-style`). På trods af navnet i sidemenuen er det her, dine to største brandaktiver bor.

Det første kort hedder **Logo, cover og favicon**, med en knap **Edit Images**:

- **Logo** — billedupload, pladsholder `Upload logo`.
- **Logo Alt Text** — pladsholder `Logo of My Company`. Hvis du lader den stå tom, bruges statussidens titel i stedet.
- **Forside** — billedupload, pladsholder `Upload cover image`. Dette er det brede banner bag sidehovedet.
- **Cover Image Alt Text** — samme idé for coveret.

Under det er en tabel **Header-links** ("Header Links for your status page"). Hvert link har en **Titel** og et **Link** (en URL, pladsholder `https://link.com`), og rækker omarrangeres ved at trække. Uden noget konfigureret lyder tabellen "No status header link for this status page."

Godt til: at pege besøgende tilbage til dit marketingwebsted, din dokumentation eller en supportportal uden at få dem til at gætte URL'en.

## Skærmen Sidefod

**Statussider → din side → Branding → Sidefod** (`{id}/footer-style`) har samme form som **Sidehoved**, ét kort og én tabel.

- **Copyright-information** — **Edit Copyright** åbner et enkelt felt, **Copyright-information**, med pladsholderen `Acme, Inc.`.
- **Sidefodslinks** — det samme par af **Titel** plus **Link**, træk-sorteret, tom besked "No status footer link for this status page."

Links til jura, privatliv og betingelser hører til her. Header-links er til navigation; sidefodslinks er til det med småt.

## Branding af oversigtssiden

**Statussider → din side → Branding → Oversigtsside** (`{id}/overview-page-branding`) er den ene skærm, hvor farver kan konfigureres, og den bestemmer også, hvad "nede" betyder i diagrammet.

- **Oversigtsside** — **Edit Branding** åbner et markdown-felt, **Beskrivelse af oversigtsside.**, som vises over ressourcelisten. Brug det til en sætning med kontekst: hvad denne side dækker, og hvor man går hen for support.
- **Rules for Bar Colors of History Chart** — en ordnet, træk-sorterbar tabel af regler. Hver regel har **Når oppetid % er større end eller lig med** og **Brug så denne søjlefarve**; tabellens kolonner lyder `When Uptime Percent >=` og `Then, Bar Color is`. Rækkefølgen betyder noget, så arrangér dem, som du vil have dem evalueret.
- **Nedetidsovervågningsstatusser** — **Edit Statuses** åbner et multivalg beskrevet som "These monitor statuses are considered as down". Dette er, hvordan du beslutter, om for eksempel en forringet status tæller imod oppetiden på denne side.
- **Standardbjælkefarve for historikdiagrammet** — **Edit Default Bar Color** åbner vælgeren **Standardbjælkefarve**, den farve der bruges, når ingen regel matcher.
- **Samlet oppetidsprocent** — **Edit Settings** åbner kontakten **Vis samlet oppetidsprocent** og en rullemenu **Vælg oppetidspræcision**, som har standard to decimaler (`99.99% (Two Decimal)`).

**Hvor mange dage diagrammet dækker, sættes ikke her.** Det er **Vis oppetidshistorik (i dage)** på **Statussider → din side → Avanceret → Avancerede indstillinger** (`{id}/settings`), gyldigt fra 1 til 90.

## Brugerdefineret HTML, CSS og JavaScript

**Statussider → din side → Branding → HTML, CSS og JavaScript** (`{id}/custom-code`) har fire uafhængigt redigerbare kort, understøttet af kolonnerne `headerHTML`, `footerHTML`, `customCSS` og `customJavaScript` på statussiden:

- **Header-HTML** — pladsholder `Insert Custom HTML here.`, indsat i sidens sidehoved.
- **Sidefods-HTML** — det samme, til sidefoden.
- **Brugerdefineret CSS** — pladsholder `Insert Custom CSS here.`
- **Brugerdefineret JavaScript** — pladsholder `Insert Custom JavaScript here.`

**Der er ingen temavælger.** OneUptime-statussider har ingen tema- eller brandfarveindstilling: de eneste indbyggede farvekontroller nogen steder er **Standardbjælkefarve** og reglerne for historikdiagrammets søjlefarver på skærmen **Oversigtsside**. Skrifttyper, baggrundsfarver, accentfarver og layoutjusteringer går alle gennem **Brugerdefineret CSS** her. Hvis du har ledt efter et "brandfarve"-felt, er dette svaret — der findes ikke et, og denne boks er nødudgangen.

> Brugerdefineret JavaScript kører i dine besøgendes browsere på en side, folk indlæser præcis når de er bekymrede for, at noget er i stykker. Hold det lille, hold det selv-hostet hvor du kan, og test det, før du læner dig op ad det.

## Sprogindstillinger

**Statussider → din side → Branding → Sprog** (`{id}/languages`) har to kort, og begge handler om den sprogvælger, besøgende får i sidens sidefod.

- **Standardsprog** — **Edit Default Language** åbner en rullemenu, der lister hvert understøttet sprog ved dets eget navn og dets engelske navn (`Deutsch (German)`). Kortet beskriver det som det sprog, førstegangsbesøgende ser; besøgende kan altid skifte fra sidefoden. Standarden er engelsk.
- **Aktiverede sprog** — **Edit Enabled Languages** åbner et multivalg, pladsholder `All languages`. Lad det stå tomt, og hvert understøttet sprog tilbydes. Vælg nogle få, og sidefodens vælger lister kun dem.

Seksten sprog følger med OneUptime: engelsk, tysk, fransk, spansk, italiensk, portugisisk, hollandsk, dansk, norsk, svensk, russisk, japansk, koreansk, kinesisk (forenklet), kinesisk (traditionelt) og hindi.

## Brugerdefinerede domæner

Som standard kan en statusside nås på den preview-URL, der vises på dens skærm **Oversigt**. For at sætte den på dit eget værtsnavn skal du gå til **Statussider → din side → Branding → Brugerdefinerede domæner** (`{id}/domains`).

Kortet hedder **Brugerdefinerede domæner**, og dets beskrivelse siger kravet direkte: tilføj din installations CNAME-post for statussider som CNAME for disse domæner, for at det virker. Uden noget konfigureret lyder tabellen "No custom domains found." Tabellen har to kolonner, **Domæne** og **Status**, og filtre for **Domæne**, **CNAME gyldig** og **SSL provisioneret**.

### Før du går i gang

To forudsætninger, og at springe en af dem over er den sædvanlige grund til, at dette ikke virker:

- **Det overordnede domæne skal allerede være verificeret.** Rullemenuen **Domæne** lister kun verificerede domæner fra projektindstillingerne — feltets egen hjælpetekst peger dig mod **Mere → Projektindstillinger → Brugerdefinerede domæner** for at tilføje et først.
- **Installationen skal have en CNAME-post for statussider konfigureret.** På selv-hostede udrulninger er det miljøvariablen `STATUS_PAGE_CNAME_RECORD` i Docker Compose, eller `statusPage.cnameRecord` i Helm-filen `values.yaml`. Uden den viser både modalen **Tilføj CNAME** og modalen **Bestil gratis SSL** en besked om, at "Custom Domains not enabled for this OneUptime installation", i stedet for instruktioner.

### At tilføje domænet

Klik **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har to trin:

**Grundlæggende**

- **Underdomæne** — kun labelen, pladsholder `status (leave blank for root)`. Indtast blot `status`, ikke hele værtsnavnet. Lad den stå tom eller indtast `@` for at bruge rod-/apex-domænet.
- **Domæne** — en rullemenu over verificerede domæner, pladsholder `Select domain`.

**Mere**

- **Upload brugerdefineret certifikat** — en kontakt, slået fra som standard. Lad den være slået fra, og OneUptime bestiller et gratis certifikat for dig. Slå den til, og du får felterne **Certifikat** og **Privat certifikatnøgle** til dit eget PEM-materiale.

## At verificere CNAME'en

Mens domænet er uverificeret, viser rækken en handling **Tilføj CNAME**. Den åbner en modal med titlen **Tilføj CNAME**, som giver dig præcis det, du skal indsætte hos din DNS-udbyder:

- **Posttype** — `CNAME`
- **Navn** — det fulde domæne, du lige har oprettet, for eksempel `status.dinvirksomhed.dk`
- **Indhold** — din installations CNAME-post for statussider

Modalen bemærker, at når posten er på plads, kan automatisk verifikation tage op til 24 timer. Du behøver ikke vente på det: modalens indsend-knap er **Bekræft CNAME**, som tjekker posten on demand.

Opret DNS-posten først, og klik derefter **Bekræft CNAME**. At klikke på den, før posten findes, fejler bare.

## At bestille et SSL-certifikat

Når CNAME'en er verificeret — og kun hvis du ikke uploadede dit eget certifikat — dukker en handling **Bestil gratis SSL** op på rækken. Dens modal, **Order Free SSL Certificate for this Status Page**, forklarer, at OneUptime bruger LetsEncrypt, at processen er sikker og gratis, og at provisionering tager nogle timer efter bestillingen. Indsend-knappen er **Bestil gratis SSL**.

**De angivne tidsangivelser er uenige på tværs af skærme**, så læg ikke for meget i noget enkelt tal: bestillingsmodalen siger tre timer, kolonnen **Status** siger én time, og et brugerdefineret certifikat siger tredive minutter. Behandl dem alle som "kom tilbage senere i dag", og kontakt support, hvis der ikke er sket noget til den tid.

Når først den er provisioneret, er fornyelse automatisk. Der er intet tilbagevendende, du skal gøre.

## At læse domænets Status-kolonne

Kolonnen **Status** er hele opsætningens tilstandsmaskine i én celle. Hver besked fortæller dig enten, hvad du skal gøre nu, eller at du er færdig.

| Hvad Status-kolonnen siger                            | Betydning                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME'en er ikke verificeret endnu. Tilføj posten, og derefter **Bekræft CNAME**.  |
| Action Required: Please order SSL certificate.        | CNAME er verificeret, men intet certifikat er bestilt. Klik **Bestil gratis SSL**. |
| No action is required, allow 30 minutes to provision. | Du uploadede et brugerdefineret certifikat, og det er ved at blive installeret.    |
| No action is required, this will be provisioned soon. | Det gratis certifikat er bestilt og undervejs. Kontakt support, hvis det aldrig lander. |
| Certificate Provisioned. No action required.          | Færdig. OneUptime fornyer certifikatet automatisk.                                 |

Hvis en række bliver stående på "Action Required: Please add your CNAME record." længe efter, du oprettede DNS-posten, så tjek at postens navn er det fulde domæne, og at dens indhold matcher din installations CNAME-post præcist.

## Powered by OneUptime

Linjen "Powered by OneUptime" er ikke en indstilling i brandingsektionen. Den bor på **Statussider → din side → Avanceret → Avancerede indstillinger** (`{id}/settings`), i kortet **Drevet af OneUptime-branding**, som en enkelt kontakt: **Skjul "Powered By OneUptime"-branding**. **Edit Settings** åbner den, ligesom hvert andet kort på den side.

## Læs videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan delene passer sammen.
- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — at vælge hvad besøgende faktisk ser på siden.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — abonnenter via e-mail, SMS, Slack og webhook, plus meddelelser.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at optræde på og forsvinde fra siden.
