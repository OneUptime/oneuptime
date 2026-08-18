# Merkevare og egendefinerte domener

En statusside er den ene OneUptime-flaten kundene dine faktisk ser på, så den bør se ut som din og ligge på ditt eget domene. Begge deler settes opp fra seksjonen **Merkevare** i sidemenyen til en statusside, pluss én innstilling som gjemmer seg i **Avanserte innstillinger**.

Det du bør vite før du starter: merkevaren er delt over sju forskjellige skjermbilder, og delingen går ikke alltid der du ville gjettet. Logoen og omslagsbildet ligger ikke på **Essensiell merkevare** — de ligger på **Topptekst**. Faviconet ligger på **Essensiell merkevare**. Fargene ligger på **Oversiktsside**. Alt annet du måtte tenke på som «temaer», er egendefinert CSS.

Denne siden går gjennom skjermbildene ett for ett, og tar deg så gjennom hele sekvensen med CNAME først og SSL etterpå for å få siden på `status.dittfirma.no`.

## Hvor hver merkevarekontroll ligger

Åpne en statusside, så har sidemenyens seksjon **Merkevare** sju elementer. Her er kartet, så du slipper å lete.

| Side                        | Hva du setter der                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Essensiell merkevare**    | Sidetittel, sidebeskrivelse, søkemotorindeksering, favicon.                                               |
| **Topptekst**               | Logo, omslagsbilde, alt-teksten deres og lenkelinjen i toppteksten.                                       |
| **Bunntekst**               | Opphavsrettslinjen og lenkelinjen i bunnteksten.                                                          |
| **Oversiktsside**           | Beskrivelse av oversikten, stolpefarger i historikkdiagrammet, nedetidsstatuser, samlet oppetidsprosent.  |
| **HTML, CSS og JavaScript** | Topptekst-HTML, bunntekst-HTML, egendefinert CSS, egendefinert JavaScript.                                |
| **Egendefinerte domener**   | Ditt eget domene, CNAME-verifisering og SSL.                                                              |
| **Språk**                   | Standardspråk og språkene som tilbys i velgeren i bunnteksten.                                            |

## Essensiell merkevare

**Statussider → siden din → Merkevare → Essensiell merkevare** (`{id}/branding`) rommer tre kort.

- **Tittel og beskrivelse** — kortet nevner at dette også brukes til SEO. **Rediger** åpner **Sidetittel** (plassholder `Please enter page title here.`) og **Sidebeskrivelse**. Dette er det søkemotorer og lenkeforhåndsvisninger viser, så skriv det for en kunde, ikke for teamet ditt.
- **Search Engine Indexing** — én enkelt bryter, **Allow Search Engines to Index this Status Page**, som i produktet beskrives som å styre om Google og Bing får liste siden i resultatene sine. Den er på som standard. Slår du den av, serveres siden med `noindex, nofollow` i stedet.
- **Favicon** — **Edit Favicon** åpner bildeopplastingen **Favicon**. Dette er det lille ikonet i nettleserfanen.

Bruk det når: siden bare er intern eller fortsatt er under oppsett. Slå av **Allow Search Engines to Index this Status Page** så en halvferdig side ikke begynner å rangere på merkenavnet ditt.

## Skjermbildet for topptekst

**Statussider → siden din → Merkevare → Topptekst** (`{id}/header-style`). Til tross for navnet i sidemenyen er det her de to største merkeressursene dine ligger.

Det første kortet heter **Logo, omslag og favikon**, med en knapp **Edit Images**:

- **Logo** — bildeopplasting, plassholder `Upload logo`.
- **Logo Alt Text** — plassholder `Logo of My Company`. Lar du det stå tomt, brukes statussidens tittel i stedet.
- **Forside** — bildeopplasting, plassholder `Upload cover image`. Dette er det brede banneret bak toppteksten.
- **Cover Image Alt Text** — samme idé for omslaget.

Under det ligger en tabell **Topptekstlenker** («Header Links for your status page»). Hver lenke har en **Tittel** og en **Lenke** (en URL, plassholder `https://link.com`), og radene omorganiseres ved å dra. Uten noe konfigurert leser tabellen «No status header link for this status page.»

Godt til: å peke de besøkende tilbake til markedsføringssiden din, dokumentasjonen din eller en supportportal uten å la dem gjette URL-en.

## Skjermbildet for bunntekst

**Statussider → siden din → Merkevare → Bunntekst** (`{id}/footer-style`) har samme form som **Topptekst**, ett kort og én tabell.

- **Opphavsrettsinformasjon** — **Edit Copyright** åpner ett enkelt felt, **Opphavsrettsinformasjon**, med plassholderen `Acme, Inc.`.
- **Bunntekstlenker** — det samme paret **Tittel** pluss **Lenke**, sortert ved draging, med tommeldingen «No status footer link for this status page.»

Lenker til juridisk informasjon, personvern og vilkår hører hjemme her. Topptekstlenker er for navigasjon; bunntekstlenker er for det som står med liten skrift.

## Merkevare på oversiktssiden

**Statussider → siden din → Merkevare → Oversiktsside** (`{id}/overview-page-branding`) er det ene skjermbildet der farger kan settes, og det avgjør også hva «nede» betyr i diagrammet.

- **Oversiktsside** — **Edit Branding** åpner et markdown-felt, **Beskrivelse av oversiktsside.**, som vises over ressurslisten. Bruk det til én setning med kontekst: hva denne siden dekker, og hvor man går for å få hjelp.
- **Rules for Bar Colors of History Chart** — en sortert tabell med regler du kan dra om på. Hver regel har **When uptime % is greater than or equal to** og **Then, use this bar color**; tabellkolonnene leser `When Uptime Percent >=` og `Then, Bar Color is`. Rekkefølgen betyr noe, så still dem opp slik du vil at de skal evalueres.
- **Overvåkerstatuser for nedetid** — **Edit Statuses** åpner et flervalg beskrevet som «These monitor statuses are considered as down». Det er slik du bestemmer om for eksempel en redusert status skal telle mot oppetiden på denne siden.
- **Standard stolpefarge for historikkdiagrammet** — **Edit Default Bar Color** åpner fargevelgeren **Standard stolpefarge**, altså fargen som brukes når ingen regel treffer.
- **Samlet oppetidsprosent** — **Edit Settings** åpner bryteren **Vis samlet oppetidsprosent** og nedtrekkslisten **Velg presisjon for oppetid**, som er to desimaler som standard (`99.99% (Two Decimal)`).

**Hvor mange dager diagrammet dekker, settes ikke her.** Det er **Vis oppetidshistorikk (i dager)** på **Statussider → siden din → Avansert → Avanserte innstillinger** (`{id}/settings`), gyldig fra 1 til 90.

## Egendefinert HTML, CSS og JavaScript

**Statussider → siden din → Merkevare → HTML, CSS og JavaScript** (`{id}/custom-code`) har fire kort som redigeres uavhengig av hverandre, og som ligger på kolonnene `headerHTML`, `footerHTML`, `customCSS` og `customJavaScript` på statussiden:

- **Topptekst-HTML** — plassholder `Insert Custom HTML here.`, injisert i sidens topptekst.
- **Bunntekst-HTML** — det samme, for bunnteksten.
- **Egendefinert CSS** — plassholder `Insert Custom CSS here.`
- **Egendefinert JavaScript** — plassholder `Insert Custom JavaScript here.`

**Det finnes ingen temavelger.** OneUptime-statussider har ingen tema- eller merkefargeinnstilling: de eneste innebygde fargekontrollene noe sted er **Standard stolpefarge** og reglene for stolpefarge i historikkdiagrammet på skjermbildet **Oversiktsside**. Skrifter, bakgrunnsfarger, aksentfarger og justeringer av oppsettet går alle gjennom **Egendefinert CSS** her. Har du lett etter et felt for «merkefarge», er dette svaret — det finnes ikke, og denne boksen er nødutgangen.

> Egendefinert JavaScript kjører i nettleserne til de besøkende, på en side folk laster nettopp når de er bekymret for at noe er ødelagt. Hold det lite, hold det selvhostet der du kan, og test det før du stoler på det.

## Språkinnstillinger

**Statussider → siden din → Merkevare → Språk** (`{id}/languages`) har to kort, og begge handler om språkvelgeren de besøkende får i bunnteksten på siden.

- **Standardspråk** — **Edit Default Language** åpner en nedtrekksliste som viser hvert støttet språk med både innfødt navn og engelsk navn (`Deutsch (German)`). Kortet beskriver det som språket førstegangsbesøkende ser; de besøkende kan alltid bytte fra bunnteksten. Standarden er engelsk.
- **Aktiverte språk** — **Edit Enabled Languages** åpner et flervalg, plassholder `All languages`. La det stå tomt, så tilbys hvert støttet språk. Velg noen få, så lister velgeren i bunnteksten bare disse.

Seksten språk følger med OneUptime: engelsk, tysk, fransk, spansk, italiensk, portugisisk, nederlandsk, dansk, norsk, svensk, russisk, japansk, koreansk, kinesisk (forenklet), kinesisk (tradisjonell) og hindi.

## Egendefinerte domener

Som standard nås en statusside på forhåndsvisnings-URL-en som vises på skjermbildet **Oversikt**. For å legge den på ditt eget vertsnavn går du til **Statussider → siden din → Merkevare → Egendefinerte domener** (`{id}/domains`).

Kortet heter **Egendefinerte domener**, og beskrivelsen stiller kravet rett ut: legg til CNAME-posten for statussider i din installasjon som CNAME for disse domenene for at dette skal virke. Uten noe konfigurert leser tabellen «No custom domains found.» Tabellen har to kolonner, **Domene** og **Status**, og filtre for **Domene**, **CNAME gyldig** og **SSL klargjort**.

### Før du begynner

To forutsetninger, og å hoppe over én av dem er den vanlige grunnen til at dette ikke virker:

- **Foreldredomenet må allerede være verifisert.** Nedtrekkslisten **Domene** lister bare verifiserte domener fra prosjektinnstillingene — feltets egen hjelpetekst peker deg mot **Mer → Prosjektinnstillinger → Egendefinerte domener** for å legge til ett først.
- **Installasjonen må ha en CNAME-post for statussider konfigurert.** På selvhostede installasjoner er det miljøvariabelen `STATUS_PAGE_CNAME_RECORD` i Docker Compose, eller `statusPage.cnameRecord` i Helm-filen `values.yaml`. Uten den viser både **Legg til CNAME**- og **Bestill gratis SSL**-modalene meldingen «Custom Domains not enabled for this OneUptime installation» i stedet for instruksjoner.

### Å legge til domenet

Klikk **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har to trinn:

**Grunnleggende**

- **Underdomene** — bare etiketten, plassholder `status (leave blank for root)`. Skriv inn bare `status`, ikke hele vertsnavnet. La det stå tomt eller skriv `@` for å bruke rot-/apex-domenet.
- **Domene** — en nedtrekksliste over verifiserte domener, plassholder `Select domain`.

**Mer**

- **Last opp tilpasset sertifikat** — en bryter, av som standard. La den stå av, så bestiller OneUptime et gratis sertifikat for deg. Slår du den på, får du feltene **Sertifikat** og **Sertifikatets private nøkkel** for ditt eget PEM-materiale.

## Å verifisere CNAME-en

Mens domenet er uverifisert, viser raden en handling **Legg til CNAME**. Den åpner en modal med tittelen **Legg til CNAME** som gir deg nøyaktig det du skal lime inn hos DNS-leverandøren din:

- **Posttype** — `CNAME`
- **Navn** — hele domenet du nettopp opprettet, for eksempel `status.dittfirma.no`
- **Innhold** — CNAME-posten for statussider i din installasjon

Modalen nevner at når posten først er på plass, kan automatisk verifisering ta opptil 24 timer. Du trenger ikke vente på det: modalens send-knapp er **Verifiser CNAME**, som sjekker posten på forespørsel.

Opprett DNS-posten først, og klikk så **Verifiser CNAME**. Å klikke før posten finnes, feiler bare.

## Å bestille et SSL-sertifikat

Når CNAME-en er verifisert — og bare hvis du ikke lastet opp ditt eget sertifikat — dukker en handling **Bestill gratis SSL** opp på raden. Modalen dens, **Order Free SSL Certificate for this Status Page**, forklarer at OneUptime bruker LetsEncrypt, at prosessen er sikker og gratis, og at klargjøring tar noen timer etter at bestillingen er lagt inn. Send-knappen er **Bestill gratis SSL**.

**De oppgitte tidene er ikke enige med hverandre på tvers av skjermbildene**, så ikke legg for mye i noe enkelt tall: bestillingsmodalen sier tre timer, kolonnen **Status** sier én time, og et eget sertifikat sier tretti minutter. Behandle alle som «kom tilbake senere i dag», og ta kontakt med support hvis ingenting har skjedd innen da.

Når sertifikatet først er klargjort, fornyes det automatisk. Det er ingenting løpende du må gjøre.

## Å lese Status-kolonnen på domenet

Kolonnen **Status** er hele oppsettets tilstandsmaskin i én celle. Hver melding forteller deg enten hva du skal gjøre videre, eller at du er ferdig.

| Hva Status-kolonnen sier                              | Hva det betyr                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME-en er ikke verifisert ennå. Legg til posten, og så **Verifiser CNAME**.      |
| Action Required: Please order SSL certificate.        | CNAME-en er verifisert, men ingen sertifikat er bestilt. Klikk **Bestill gratis SSL**. |
| No action is required, allow 30 minutes to provision. | Du lastet opp et eget sertifikat, og det er under installasjon.                    |
| No action is required, this will be provisioned soon. | Det gratis sertifikatet er bestilt og underveis. Kontakt support hvis det aldri kommer. |
| Certificate Provisioned. No action required.          | Ferdig. OneUptime fornyer sertifikatet automatisk.                                 |

Blir en rad stående på «Action Required: Please add your CNAME record.» lenge etter at du opprettet DNS-oppføringen, sjekk at postens navn er hele domenet, og at innholdet stemmer nøyaktig med CNAME-posten til installasjonen din.

## Powered by OneUptime

Linjen «Powered by OneUptime» er ikke en innstilling i merkevareseksjonen. Den bor på **Statussider → siden din → Avansert → Avanserte innstillinger** (`{id}/settings`), i kortet **Drevet av OneUptime-merkevarebygging**, som én enkelt bryter: **Skjul «Powered By OneUptime»-merkevarebygging**. **Edit Settings** åpner den, som på hvert annet kort på den siden.

## Hvor du leser videre

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan delene henger sammen.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — å velge hva de besøkende faktisk ser på siden.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — abonnenter på e-post, SMS, Slack og webhook, pluss kunngjøringer.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på og forsvinne fra siden.
