# Branding og brugerdefinerede domæner

En statusside er den ene OneUptime-flade, dine kunder rent faktisk kigger på, så den bør ligne dig og bo på dit eget domæne. Begge dele konfigureres fra **Branding**-sektionen i en statussides sidemenu — plus én indstilling, der gemmer sig i **Avancerede indstillinger**.

Det, du bør vide, før du går i gang: branding er fordelt over syv separate skærme, og fordelingen ligger ikke altid dér, hvor du ville gætte. Logoet og coverbilledet ligger ikke på **Essentiel branding** — de ligger på **Sidehoved**. Faviconet ligger på **Essentiel branding**. Farverne ligger på **Oversigtsside**. Alt andet, du ville kalde "temaer", er Custom CSS.

Denne side går skærmene igennem én for én og tager dig derefter gennem hele CNAME-og-så-SSL-forløbet, der får siden op at køre på `status.ditfirma.dk`.

## Hvor hver brandingkontrol bor

Åbn en statusside, og sidemenuens **Branding**-sektion har syv punkter. Her er kortet, så du kan holde op med at lede.

| Side                        | Hvad du sætter der                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Essentiel branding**      | Sidetitel, sidebeskrivelse, søgemaskineindeksering, favicon.                                            |
| **Sidehoved**               | Logo, coverbillede, deres alt-tekst og linjen med links i sidehovedet.                                  |
| **Sidefod**                 | Copyright-linjen og linjen med links i sidefoden.                                                       |
| **Oversigtsside**           | Oversigtsbeskrivelse, søjlefarver i historikdiagrammet, nedetidsstatusser, samlet oppetidsprocent.      |
| **HTML, CSS og JavaScript** | HTML til sidehoved, HTML til sidefod, brugerdefineret CSS, brugerdefineret JavaScript.                  |
| **Brugerdefinerede domæner** | Dit eget domæne, CNAME-verifikation og SSL.                                                            |
| **Sprog**                   | Standardsproget og de sprog, der tilbydes i sidefodens sprogvælger.                                     |

## Essentiel branding

**Statussider → din side → Branding → Essentiel branding** (`{id}/branding`) rummer tre kort.

- **Titel og beskrivelse** — kortet bemærker, at det også bruges til SEO. **Rediger** åbner **Sidetitel** (pladsholder `Please enter page title here.`) og **Sidebeskrivelse**. Det er dét, søgemaskiner og linkforhåndsvisninger viser, så skriv det til en kunde, ikke til dit eget team.
- **Search Engine Indexing** — én enkelt kontakt, **Allow Search Engines to Index this Status Page**, som produktet beskriver som styrende for, om Google og Bing må vise siden i deres resultater. Den er slået til som standard. Slå den fra, og siden serveres med `noindex, nofollow` i stedet.
- **Favicon** — **Edit Favicon** åbner billedupload til **Favicon**. Det er det lille ikon i browserfanen.

Brug det, når: siden kun er intern eller stadig er under opsætning. Slå **Allow Search Engines to Index this Status Page** fra, så en halvfærdig side ikke begynder at rangere på dit brandnavn.

## Sidehoved-skærmen

**Statussider → din side → Branding → Sidehoved** (`{id}/header-style`). Trods navnet i sidemenuen er det her, dine to største brandaktiver bor.

Det første kort hedder **Logo, cover og favicon** og har en **Edit Images**-knap:

- **Logo** — billedupload, pladsholder `Upload logo`.
- **Logo Alt Text** — pladsholder `Logo of My Company`. Lader du den stå tom, bruges statussidens titel i stedet.
- **Forside** — billedupload, pladsholder `Upload cover image`. Det er det brede banner bag sidehovedet.
- **Cover Image Alt Text** — samme idé for coverbilledet.

Nedenunder ligger en **Header-links**-tabel ("Header-links til din statusside"). Hvert link har en **Titel** og et **Link** (en URL, pladsholder `https://link.com`), og rækker omarrangeres ved at trække i dem. Er der ingen konfigureret, står der "No status header link for this status page."

Godt til: at pege besøgende tilbage mod dit marketingsite, din dokumentation eller en supportportal uden at lade dem gætte URL'en.

## Sidefod-skærmen

**Statussider → din side → Branding → Sidefod** (`{id}/footer-style`) har samme form som **Sidehoved**: ét kort og én tabel.

- **Copyright-information** — **Edit Copyright** åbner ét felt, **Copyright-information**, med pladsholderen `Acme, Inc.`.
- **Sidefodslinks** — det samme par af **Titel** og **Link**, sorteret ved træk, med tommeteksten "No status footer link for this status page."

Links til jura, privatliv og vilkår hører til her. Links i sidehovedet er til navigation; links i sidefoden er til det med småt.

## Branding af oversigtssiden

**Statussider → din side → Branding → Oversigtsside** (`{id}/overview-page-branding`) er den ene skærm, hvor farver kan sættes, og den afgør også, hvad "nede" betyder på diagrammet.

- **Oversigtsside** — **Edit Branding** åbner et markdown-felt, **Beskrivelse af oversigtsside.**, som vises over ressourcelisten. Brug det til en sætning kontekst: hvad denne side dækker, og hvor man går hen efter support.
- **Rules for Bar Colors of History Chart** — en ordnet tabel af regler, du kan trække rundt på. Hver regel har **Når oppetid % er større end eller lig med** og **Brug så denne søjlefarve**; tabellens kolonner hedder `When Uptime Percent >=` og `Then, Bar Color is`. Rækkefølgen betyder noget, så stil dem op, som du vil have dem evalueret.
- **Nedetidsovervågningsstatusser** — **Edit Statuses** åbner en multivælger beskrevet som "These monitor statuses are considered as down". Det er sådan, du afgør, om for eksempel en forringet status tæller imod oppetiden på denne side.
- **Standardbjælkefarve for historikdiagrammet** — **Edit Default Bar Color** åbner vælgeren **Standardbjælkefarve**, altså den farve der bruges, når ingen regel matcher.
- **Samlet oppetidsprocent** — **Edit Settings** åbner kontakten **Vis samlet oppetidsprocent** og rullelisten **Vælg oppetidspræcision**, som er to decimaler som standard (`99.99% (Two Decimal)`).

**Hvor mange dage diagrammet dækker, sættes ikke her.** Det er **Vis oppetidshistorik (i dage)** på **Statussider → din side → Avanceret → Avancerede indstillinger** (`{id}/settings`), gyldig fra 1 til 90.

## Brugerdefineret HTML, CSS og JavaScript

**Statussider → din side → Branding → HTML, CSS og JavaScript** (`{id}/custom-code`) har fire kort, der kan redigeres uafhængigt af hinanden, understøttet af kolonnerne `headerHTML`, `footerHTML`, `customCSS` og `customJavaScript` på statussiden:

> Aktiv brugerdefineret HTML, CSS og JavaScript leveres kun på et verificeret brugerdefineret domæne. Det er deaktiveret på standardadressen `/status-page/:id`, fordi URL'en har samme oprindelse som den del af OneUptime, hvor brugerne er logget ind.

- **Header-HTML** — pladsholder `Insert Custom HTML here.`, injiceres i sidens sidehoved.
- **Sidefods-HTML** — det samme, til sidefoden.
- **Brugerdefineret CSS** — pladsholder `Insert Custom CSS here.`
- **Brugerdefineret JavaScript** — pladsholder `Insert Custom JavaScript here.`

**Der findes ingen temavælger.** OneUptime-statussider har hverken tema- eller brandfarveindstilling: de eneste indbyggede farvekontroller nogen steder er **Standardbjælkefarve** og reglerne for søjlefarver på **Oversigtsside**-skærmen. Skrifttyper, baggrundsfarver, accentfarver og layoutjusteringer går alle gennem **Brugerdefineret CSS** her. Har du ledt efter et "brandfarve"-felt, er det svaret: det findes ikke, og denne boks er nødudgangen.

> Brugerdefineret JavaScript kører i dine besøgendes browsere på en side, folk åbner præcis når de er bange for, at noget er gået i stykker. Hold det småt, hold det selv-hostet hvor du kan, og test det, før du læner dig op ad det.

## Sprogindstillinger

**Statussider → din side → Branding → Sprog** (`{id}/languages`) har to kort, og begge handler om den sprogvælger, besøgende får i sidefoden.

- **Standardsprog** — **Edit Default Language** åbner en rulleliste, der viser hvert understøttet sprog med både sit eget navn og sit engelske navn (`Deutsch (German)`). Kortet beskriver det som det sprog, førstegangsbesøgende ser; besøgende kan altid skifte fra sidefoden. Standard er engelsk.
- **Aktiverede sprog** — **Edit Enabled Languages** åbner en multivælger, pladsholder `All languages`. Lad den stå tom, og alle understøttede sprog tilbydes. Vælg nogle få, og sidefodens vælger viser kun dem.

Seksten sprog følger med OneUptime: engelsk, tysk, fransk, spansk, italiensk, portugisisk, hollandsk, dansk, norsk, svensk, russisk, japansk, koreansk, kinesisk (forenklet), kinesisk (traditionelt) og hindi.

## Brugerdefinerede domæner

Som standard kan en statusside nås på den preview-URL, der vises på dens **Oversigt**-skærm. For at få den op på dit eget værtsnavn går du til **Statussider → din side → Branding → Brugerdefinerede domæner** (`{id}/domains`).

Kortet hedder **Brugerdefinerede domæner**, og dets beskrivelse siger kravet lige ud: tilføj din installations CNAME-post til statussider som CNAME for disse domæner, for at det virker. Er intet konfigureret, står der "No custom domains found." i tabellen. Tabellen har to kolonner, **Domæne** og **Status**, og filtre for **Domæne**, **CNAME gyldig** og **SSL provisioneret**.

### Før du går i gang

To forudsætninger — og at springe en af dem over er den sædvanlige grund til, at det ikke virker:

- **Det overordnede domæne skal allerede være verificeret.** Rullelisten **Domæne** viser kun verificerede domæner fra projektindstillingerne — feltets egen hjælpetekst peger dig mod **Mere → Projektindstillinger → Brugerdefinerede domæner** for at tilføje et først.
- **Installationen skal have en CNAME-post til statussider konfigureret.** I selv-hostede installationer er det miljøvariablen `STATUS_PAGE_CNAME_RECORD` i Docker Compose eller `statusPage.cnameRecord` i Helm-filen `values.yaml`. Uden den viser både **Tilføj CNAME**- og **Bestil gratis SSL**-modalen beskeden "Custom Domains not enabled for this OneUptime installation" i stedet for en vejledning.

### At tilføje domænet

Klik **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har to trin:

**Grundlæggende**

- **Underdomæne** — kun selve labelen, pladsholder `status (leave blank for root)`. Skriv bare `status`, ikke hele værtsnavnet. Lad den stå tom eller skriv `@` for at bruge rod-/apex-domænet.
- **Domæne** — en rulleliste over verificerede domæner, pladsholder `Vælg domæne`.

**Mere**

- **Upload brugerdefineret certifikat** — en kontakt, slået fra som standard. Lad den være slået fra, så bestiller OneUptime et gratis certifikat til dig. Slå den til, og du får felterne **Certifikat** og **Privat certifikatnøgle** til dit eget PEM-materiale.

## At verificere CNAME'en

Så længe domænet er uverificeret, viser rækken en **Tilføj CNAME**-handling. Den åbner en modal med titlen **Tilføj CNAME**, som giver dig præcis det, du skal indsætte hos din DNS-udbyder:

- **Posttype** — `CNAME`
- **Navn** — det fulde domæne, du lige har oprettet, for eksempel `status.ditfirma.dk`
- **Indhold** — din installations CNAME-post til statussider

Modalen bemærker, at automatisk verifikation kan tage op til 24 timer, når posten først er på plads. Det behøver du ikke vente på: modalens indsend-knap hedder **Bekræft CNAME** og tjekker posten med det samme.

Opret DNS-posten først, og klik så **Bekræft CNAME**. Klikker du, før posten findes, fejler det bare.

## At bestille et SSL-certifikat

Når CNAME'en er verificeret — og kun hvis du ikke har uploadet dit eget certifikat — dukker handlingen **Bestil gratis SSL** op på rækken. Dens modal, **Order Free SSL Certificate for this Status Page**, forklarer, at OneUptime bruger LetsEncrypt, at processen er sikker og gratis, og at provisioneringen tager nogle timer, efter bestillingen er lagt. Indsend-knappen hedder **Bestil gratis SSL**.

**De angivne tider er ikke enige på tværs af skærmene**, så læg ikke for meget i noget enkelt tal: bestillingsmodalen siger tre timer, **Status**-kolonnen siger én time, og et brugerdefineret certifikat siger tredive minutter. Læs dem alle som "kom tilbage senere i dag", og kontakt support, hvis der ikke er sket noget til den tid.

Når først certifikatet er provisioneret, forlænges det automatisk. Der er ikke noget tilbagevendende, du skal gøre.

## At læse domænets Status-kolonne

Kolonnen **Status** er hele opsætningens tilstandsmaskine i én celle. Hver besked fortæller dig enten, hvad du skal gøre nu, eller at du er færdig.

| Hvad Status-kolonnen siger                            | Hvad det betyder                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME'en er ikke verificeret endnu. Tilføj posten, og klik så **Bekræft CNAME**.               |
| Action Required: Please order SSL certificate.        | CNAME'en er verificeret, men intet certifikat er bestilt. Klik **Bestil gratis SSL**.          |
| No action is required, allow 30 minutes to provision. | Du uploadede et brugerdefineret certifikat, og det er ved at blive installeret.                |
| No action is required, this will be provisioned soon. | Det gratis certifikat er bestilt og undervejs. Kontakt support, hvis det aldrig lander.        |
| Certificate Provisioned. No action required.          | Færdig. OneUptime forlænger certifikatet automatisk.                                           |

Bliver en række hængende på "Action Required: Please add your CNAME record." længe efter, du oprettede DNS-posten, så tjek, at postens navn er det fulde domæne, og at dens indhold matcher din installations CNAME-post præcist.

## Drevet af OneUptime

Linjen "Powered by OneUptime" er ikke en indstilling i branding-sektionen. Den bor på **Statussider → din side → Avanceret → Avancerede indstillinger** (`{id}/settings`), i kortet **Drevet af OneUptime-branding**, som én enkelt kontakt: **Skjul "Powered By OneUptime"-branding**. **Edit Settings** åbner den, ligesom på ethvert andet kort på den side.

## Hvor du kan læse videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan brikkerne passer sammen.
- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — at vælge, hvad besøgende faktisk ser på siden.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — abonnenter via e-mail, SMS, Slack og webhook, plus meddelelser.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at optræde på siden og forsvinde igen.
