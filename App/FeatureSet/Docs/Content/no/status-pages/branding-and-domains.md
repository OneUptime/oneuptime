# Merkevare og egendefinerte domener

En statusside er den ene OneUptime-flaten kundene dine faktisk ser på, så den bør se ut som om den tilhører deg og bo på ditt eget domene. Begge deler konfigureres fra seksjonen **Merkevare** i sidemenyen til en statusside, pluss én innstilling som gjemmer seg i **Avanserte innstillinger**.

Det du bør vite før du begynner: merkevare er fordelt over sju separate skjermbilder, og fordelingen er ikke alltid der du ville gjettet. Logoen og forsidebildet er ikke på **Essensiell merkevare** — de er på **Topptekst**. Faviconet er på **Essensiell merkevare**. Farger er på **Oversiktsside**. Alt annet du kanskje tenker på som «tematisering» er Egendefinert CSS.

Denne siden går gjennom hvert skjermbilde etter tur, og tar deg deretter gjennom hele CNAME-så-SSL-sekvensen for å sette siden på `status.yourcompany.com`.

## Hvor hver merkevarekontroll bor

Åpne en statusside, så har sidemenyens seksjon **Merkevare** sju elementer. Her er kartet, så du slutter å lete.

| Side                       | Hva du setter der                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Essensiell merkevare**   | Sidetittel, sidebeskrivelse, søkemotorindeksering, favicon.                                |
| **Topptekst**              | Logo, forsidebilde, alt-teksten deres, og lenkelinjen i toppteksten.                       |
| **Bunntekst**              | Opphavsrettslinjen og lenkelinjen i bunnteksten.                                           |
| **Oversiktsside**          | Oversiktsbeskrivelse, stolpefarger i historikkdiagrammet, nedetidsstatuser, samlet oppetidsprosent. |
| **HTML, CSS og JavaScript** | Topptekst-HTML, bunntekst-HTML, egendefinert CSS, egendefinert JavaScript.                 |
| **Egendefinerte domener**  | Ditt eget domene, CNAME-verifisering og SSL.                                               |
| **Språk**                  | Standardspråk og språkene som tilbys i velgeren i bunnteksten.                             |

## Essensiell merkevare

**Statussider → siden din → Merkevare → Essensiell merkevare** (`{id}/branding`) rommer tre kort.

- **Tittel og beskrivelse** — kortet påpeker at dette også brukes til SEO. **Rediger** åpner **Sidetittel** (plassholder `Please enter page title here.`) og **Sidebeskrivelse**. Dette er hva søkemotorer og lenkeforhåndsvisninger viser, så skriv det for en kunde, ikke for teamet ditt.
- **Search Engine Indexing** — én enkelt bryter, **Allow Search Engines to Index this Status Page**, beskrevet i produktet som å styre om Google og Bing kan liste siden i resultatene sine. Den er på som standard. Slå den av, så serveres siden med `noindex, nofollow` i stedet.
- **Favicon** — **Edit Favicon** åpner bildeopplastingen **Favicon**. Dette er det lille ikonet i nettleserfanen.

Bruk det når: siden bare er intern eller fortsatt settes opp. Slå **Allow Search Engines to Index this Status Page** av så en halvferdig side ikke begynner å rangere på merkenavnet ditt.

## Toppteksts-skjermbildet

**Statussider → siden din → Merkevare → Topptekst** (`{id}/header-style`). Til tross for navnet i sidemenyen er det her de to største merkevareressursene dine bor.

Det første kortet har tittelen **Logo, omslag og favikon**, med en knapp **Edit Images**:

- **Logo** — bildeopplasting, plassholder `Upload logo`.
- **Logo Alt Text** — plassholder `Logo of My Company`. Hvis du lar den stå tom, brukes statussidens tittel i stedet.
- **Forside** — bildeopplasting, plassholder `Upload cover image`. Dette er det brede banneret bak toppteksten.
- **Cover Image Alt Text** — den samme idéen for forsidebildet.

Under det er en tabell **Topptekstlenker** («Header Links for your status page»). Hver lenke har en **Tittel** og en **Lenke** (en URL, plassholder `https://link.com`), og rader omordnes ved å dra. Uten noen konfigurert leser tabellen «No status header link for this status page.»

Bra for: å peke besøkende tilbake til markedsføringssiden din, dokumentasjonen din eller en supportportal uten å få dem til å gjette URL-en.

## Bunnteksts-skjermbildet

**Statussider → siden din → Merkevare → Bunntekst** (`{id}/footer-style`) har samme form som **Topptekst**, ett kort og én tabell.

- **Opphavsrettsinformasjon** — **Edit Copyright** åpner ett enkelt felt, **Opphavsrettsinformasjon**, med plassholderen `Acme, Inc.`.
- **Bunntekstlenker** — det samme paret **Tittel** pluss **Lenke**, dragsortert, tom melding «No status footer link for this status page.»

Lenker til juridisk informasjon, personvern og vilkår hører hjemme her. Topptekstlenker er for navigasjon; bunntekstlenker er for det som står med liten skrift.

## Merkevare for oversiktssiden

**Statussider → siden din → Merkevare → Oversiktsside** (`{id}/overview-page-branding`) er det ene skjermbildet der farger kan konfigureres, og det avgjør også hva «nede» betyr på diagrammet.

- **Oversiktsside** — **Edit Branding** åpner et markdown-felt, **Beskrivelse av oversiktsside**, som vises over ressurslisten. Bruk det til en setning med kontekst: hva denne siden dekker, og hvor man går for support.
- **Rules for Bar Colors of History Chart** — en sortert, dragsorterbar tabell med regler. Hver regel har **Når oppetid % er større enn eller lik** og **Bruk så denne stolpefargen**; tabellkolonnene leser `When Uptime Percent >=` og `Then, Bar Color is`. Rekkefølgen betyr noe, så ordne dem slik du vil at de skal evalueres.
- **Overvåkerstatuser for nedetid** — **Edit Statuses** åpner et flervalg beskrevet som «These monitor statuses are considered as down». Slik bestemmer du om for eksempel en forringet status skal telle mot oppetiden på denne siden.
- **Standard stolpefarge for historikkdiagrammet** — **Edit Default Bar Color** åpner velgeren **Standard stolpefarge**, fargen som brukes når ingen regel treffer.
- **Samlet oppetidsprosent** — **Edit Settings** åpner bryteren **Vis samlet oppetidsprosent** og en nedtrekksliste **Velg presisjon for oppetid**, som er som standard to desimaler (`99.99% (Two Decimal)`).

**Hvor mange dager diagrammet dekker settes ikke her.** Det er **Vis oppetidshistorikk (i dager)** på **Statussider → siden din → Avansert → Avanserte innstillinger** (`{id}/settings`), gyldig fra 1 til 90.

## Egendefinert HTML, CSS og JavaScript

**Statussider → siden din → Merkevare → HTML, CSS og JavaScript** (`{id}/custom-code`) har fire kort som kan redigeres uavhengig av hverandre, støttet av kolonnene `headerHTML`, `footerHTML`, `customCSS` og `customJavaScript` på statussiden:

- **Topptekst-HTML** — plassholder `Insert Custom HTML here.`, injisert i sidens topptekst.
- **Bunntekst-HTML** — det samme, for bunnteksten.
- **Egendefinert CSS** — plassholder `Insert Custom CSS here.`
- **Egendefinert JavaScript** — plassholder `Insert Custom JavaScript here.`

**Det finnes ingen temavelger.** OneUptime-statussider har ingen tema- eller merkevarefargeinnstilling: de eneste innebygde fargekontrollene noe sted er **Standard stolpefarge** og reglene for stolpefarge i historikkdiagrammet på skjermbildet **Oversiktsside**. Skrifttyper, bakgrunnsfarger, aksentfarger og layoutjusteringer går alle gjennom **Egendefinert CSS** her. Hvis du har lett etter et «merkevarefarge»-felt, er dette svaret — det finnes ikke, og denne boksen er nødutgangen.

> Egendefinert JavaScript kjører i nettleserne til de besøkende på en side folk laster inn nettopp når de er bekymret for at noe er ødelagt. Hold det lite, hold det selvhostet der du kan, og test det før du stoler på det.

## Språkinnstillinger

**Statussider → siden din → Merkevare → Språk** (`{id}/languages`) har to kort, og begge handler om språkvelgeren de besøkende får i sidens bunntekst.

- **Standardspråk** — **Edit Default Language** åpner en nedtrekksliste som lister hvert støttede språk med morsmålsnavn og engelsk navn (`Deutsch (German)`). Kortet beskriver det som språket førstegangsbesøkende ser; besøkende kan alltid bytte fra bunnteksten. Standarden er engelsk.
- **Aktiverte språk** — **Edit Enabled Languages** åpner et flervalg, plassholder `All languages`. La det stå tomt, så tilbys hvert støttede språk. Velg noen få, så lister velgeren i bunnteksten bare disse.

Seksten språk følger med OneUptime: engelsk, tysk, fransk, spansk, italiensk, portugisisk, nederlandsk, dansk, norsk, svensk, russisk, japansk, koreansk, kinesisk (forenklet), kinesisk (tradisjonell) og hindi.

## Egendefinerte domener

Som standard er en statusside tilgjengelig på forhåndsvisnings-URL-en som vises på skjermbildet **Oversikt**. For å sette den på ditt eget vertsnavn, gå til **Statussider → siden din → Merkevare → Egendefinerte domener** (`{id}/domains`).

Kortet har tittelen **Egendefinerte domener**, og beskrivelsen staver ut kravet direkte: legg til installasjonens statusside-CNAME-post som CNAME for disse domenene for at dette skal virke. Uten noe konfigurert leser tabellen «No custom domains found.» Tabellen har to kolonner, **Domene** og **Status**, og filtre for **Domene**, **CNAME gyldig** og **SSL klargjort**.

### Før du begynner

To forutsetninger, og å hoppe over én av dem er den vanligste grunnen til at dette ikke virker:

- **Foreldredomenet må allerede være verifisert.** Nedtrekkslisten **Domene** lister bare verifiserte domener fra prosjektinnstillingene — feltets egen hjelpetekst peker deg mot **Mer → Prosjektinnstillinger → Egendefinerte domener** for å legge til ett først.
- **Installasjonen må ha en statusside-CNAME-post konfigurert.** På selv-hostede oppsett er det miljøvariabelen `STATUS_PAGE_CNAME_RECORD` i Docker Compose, eller `statusPage.cnameRecord` i Helm-filen `values.yaml`. Uten den viser både modalene **Legg til CNAME** og **Bestill gratis SSL** en melding om «Custom Domains not enabled for this OneUptime installation» i stedet for instruksjoner.

### Å legge til domenet

Klikk **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har to trinn:

**Grunnleggende**

- **Underdomene** — bare etiketten, plassholder `status (leave blank for root)`. Skriv bare `status`, ikke hele vertsnavnet. La den stå tom eller skriv `@` for å bruke rot-/apex-domenet.
- **Domene** — en nedtrekksliste over verifiserte domener, plassholder `Select domain`.

**Mer**

- **Last opp tilpasset sertifikat** — en bryter, av som standard. La den være av, så bestiller OneUptime et gratis sertifikat for deg. Slå den på, så får du feltene **Sertifikat** og **Sertifikatets private nøkkel** for ditt eget PEM-materiale.

## Å verifisere CNAME-en

Mens domenet er uverifisert, viser raden en handling **Legg til CNAME**. Den åpner en modal med tittelen **Legg til CNAME** som gir deg nøyaktig det du skal lime inn hos DNS-leverandøren din:

- **Posttype** — `CNAME`
- **Navn** — hele domenet du nettopp opprettet, for eksempel `status.yourcompany.com`
- **Innhold** — installasjonens statusside-CNAME-post

Modalen påpeker at når posten er på plass, kan automatisk verifisering ta opptil 24 timer. Du trenger ikke å vente på det: modalens send-knapp er **Verifiser CNAME**, som sjekker posten på forespørsel.

Opprett DNS-posten først, og klikk deretter **Verifiser CNAME**. Å klikke den før posten finnes, feiler bare.

## Å bestille et SSL-sertifikat

Når CNAME-en er verifisert — og kun hvis du ikke lastet opp ditt eget sertifikat — dukker en handling **Bestill gratis SSL** opp på raden. Modalen dens, **Order Free SSL Certificate for this Status Page**, forklarer at OneUptime bruker LetsEncrypt, at prosessen er sikker og gratis, og at klargjøring tar noen timer etter at bestillingen er lagt inn. Send-knappen er **Bestill gratis SSL**.

**De oppgitte tidsangivelsene er uenige på tvers av skjermbilder**, så ikke legg for mye i noe enkelt tall: bestillingsmodalen sier tre timer, kolonnen **Status** sier én time, og et tilpasset sertifikat sier tretti minutter. Behandle dem alle som «kom tilbake senere i dag», og kontakt support hvis ingenting har skjedd innen da.

Når det først er klargjort, er fornyelsen automatisk. Det er ingenting tilbakevendende du må gjøre.

## Å lese domenets Status-kolonne

Kolonnen **Status** er hele oppsett-tilstandsmaskinen i én celle. Hver melding forteller deg enten hva du skal gjøre videre, eller at du er ferdig.

| Hva Status-kolonnen sier                              | Hva det betyr                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME-en er ikke verifisert ennå. Legg til posten, og deretter **Verifiser CNAME**. |
| Action Required: Please order SSL certificate.        | CNAME er verifisert, men ingen sertifikat er bestilt. Klikk **Bestill gratis SSL**. |
| No action is required, allow 30 minutes to provision. | Du lastet opp et tilpasset sertifikat, og det installeres nå.                     |
| No action is required, this will be provisioned soon. | Gratissertifikatet er bestilt og underveis. Kontakt support hvis det aldri lander. |
| Certificate Provisioned. No action required.          | Ferdig. OneUptime fornyer sertifikatet automatisk.                                |

Hvis en rad blir stående på «Action Required: Please add your CNAME record.» lenge etter at du opprettet DNS-oppføringen, sjekk at postens navn er hele domenet og at innholdet samsvarer nøyaktig med installasjonens CNAME-post.

## Powered by OneUptime

Linjen «Powered by OneUptime» er ikke en innstilling i merkevareseksjonen. Den bor på **Statussider → siden din → Avansert → Avanserte innstillinger** (`{id}/settings`), i kortet **Drevet av OneUptime-merkevarebygging**, som én enkelt bryter: **Skjul «Powered By OneUptime»-merkevarebygging**. **Edit Settings** åpner den, som på hvert annet kort på den siden.

## Hvor du leser videre

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan bitene henger sammen.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — å velge hva de besøkende faktisk ser på siden.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — abonnenter på e-post, SMS, Slack og webhook, pluss kunngjøringer.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på og forsvinne fra siden.
