# Huisstijl en aangepaste domeinen

Een statuspagina is het enige OneUptime-oppervlak waar je klanten echt naar kijken, dus die hoort eruit te zien alsof hij van jou is en op je eigen domein te staan. Allebei regel je vanuit de sectie **Huisstijl** in het zijmenu van een statuspagina, plus één instelling die zich in **Geavanceerde instellingen** verstopt.

Wat je vooraf moet weten: de huisstijl is verdeeld over zeven aparte schermen, en die verdeling ligt niet altijd waar je zou gokken. Het logo en de omslagafbeelding staan niet op **Essentiële branding** — die staan op **Koptekst**. De favicon staat wél op **Essentiële branding**. Kleuren staan op **Overzichtspagina**. Al het andere dat je "theming" zou noemen, gaat via aangepaste CSS.

Deze pagina loopt elk scherm langs en neemt je daarna mee door de volledige CNAME-en-dan-SSL-volgorde om de pagina op `status.jouwbedrijf.nl` te zetten.

## Waar elke huisstijlinstelling staat

Open een statuspagina en de sectie **Huisstijl** in het zijmenu heeft zeven items. Hier is de kaart, zodat je niet meer hoeft te zoeken.

| Pagina                     | Wat je daar instelt                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Essentiële branding**    | Paginatitel, paginabeschrijving, indexering door zoekmachines, favicon.                    |
| **Koptekst**               | Logo, omslagafbeelding, hun alt-teksten, en de linkbalk in de koptekst.                    |
| **Voettekst**              | Copyrightregel en de linkbalk in de voettekst.                                             |
| **Overzichtspagina**       | Beschrijving van het overzicht, balkkleuren van de geschiedenisgrafiek, downtime-statussen, totaal uptimepercentage. |
| **HTML, CSS & JavaScript** | Koptekst-HTML, footer-HTML, aangepaste CSS, aangepaste JavaScript.                         |
| **Aangepaste domeinen**    | Je eigen domein, CNAME-verificatie en SSL.                                                 |
| **Talen**                  | Standaardtaal en de talen die de wisselaar in de voettekst aanbiedt.                       |

## Essentiële branding

**Statuspagina's → jouw pagina → Huisstijl → Essentiële branding** (`{id}/branding`) bevat drie kaarten.

- **Titel en beschrijving** — de kaart vermeldt dat dit ook voor SEO wordt gebruikt. **Bewerken** opent **Paginatitel** (placeholder `Please enter page title here.`) en **Paginabeschrijving**. Dit is wat zoekmachines en linkvoorbeelden tonen, dus schrijf het voor een klant, niet voor je team.
- **Search Engine Indexing** — één schakelaar, **Allow Search Engines to Index this Status Page**, in het product omschreven als de knop die bepaalt of Google en Bing de pagina in hun resultaten mogen opnemen. Standaard aan. Zet je hem uit, dan wordt de pagina geserveerd met `noindex, nofollow`.
- **Favicon** — **Edit Favicon** opent de afbeeldingsupload **Favicon**. Dit is het icoontje in het browsertabblad.

Gebruik het wanneer: de pagina alleen intern is of nog in aanbouw. Zet **Allow Search Engines to Index this Status Page** uit, zodat een halfafgemaakte pagina niet begint te scoren op je merknaam.

## Het scherm Koptekst

**Statuspagina's → jouw pagina → Huisstijl → Koptekst** (`{id}/header-style`). Ondanks de naam in het zijmenu staan hier je twee grootste merkelementen.

De eerste kaart heet **Logo, omslag en favicon**, met een knop **Edit Images**:

- **Logo** — afbeeldingsupload, placeholder `Upload logo`.
- **Logo Alt Text** — placeholder `Logo of My Company`. Laat je dit leeg, dan wordt de titel van de statuspagina gebruikt.
- **Omslag** — afbeeldingsupload, placeholder `Upload cover image`. Dit is de brede banner achter de koptekst.
- **Cover Image Alt Text** — hetzelfde idee voor de omslag.

Daaronder staat een tabel **Koptekstkoppelingen** ("Header Links for your status page"). Elke koppeling heeft een **Titel** en een **Koppeling** (een URL, placeholder `https://link.com`), en rijen herorden je door te slepen. Zonder configuratie leest de tabel "No status header link for this status page."

Goed voor: bezoekers terugsturen naar je marketingsite, je documentatie of een supportportaal, zonder dat ze de URL moeten raden.

## Het scherm Voettekst

**Statuspagina's → jouw pagina → Huisstijl → Voettekst** (`{id}/footer-style`) heeft dezelfde vorm als **Koptekst**: één kaart en één tabel.

- **Copyrightinformatie** — **Edit Copyright** opent één veld, **Copyrightinformatie**, met de placeholder `Acme, Inc.`.
- **Footerlinks** — hetzelfde paar **Titel** plus **Koppeling**, te ordenen met slepen, met als lege melding "No status footer link for this status page."

Links naar juridische informatie, privacy en voorwaarden horen hier. Koptekstkoppelingen zijn voor navigatie; footerlinks zijn voor de kleine lettertjes.

## Huisstijl van de overzichtspagina

**Statuspagina's → jouw pagina → Huisstijl → Overzichtspagina** (`{id}/overview-page-branding`) is het enige scherm waar kleuren instelbaar zijn, en het bepaalt ook wat "down" betekent op de grafiek.

- **Overzichtspagina** — **Edit Branding** opent een markdownveld, **Beschrijving overzichtspagina.**, dat boven de resourcelijst wordt weergegeven. Gebruik het voor één zin context: wat deze pagina dekt en waar je terechtkunt voor support.
- **Rules for Bar Colors of History Chart** — een geordende, sleepbare tabel met regels. Elke regel heeft **When uptime % is greater than or equal to** en **Then, use this bar color**; de tabelkolommen heten `When Uptime Percent >=` en `Then, Bar Color is`. De volgorde telt, dus zet ze zoals je ze geëvalueerd wilt hebben.
- **Downtime-monitorstatussen** — **Edit Statuses** opent een multiselect, omschreven als "These monitor statuses are considered as down". Zo bepaal je of bijvoorbeeld een verminderde status op deze pagina meetelt tegen de uptime.
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** opent de kiezer **Standaard balkkleur**, de kleur die wordt gebruikt wanneer geen enkele regel matcht.
- **Overall Uptime Percent** — **Edit Settings** opent de schakelaar **Totaal uptimepercentage weergeven** en een lijst **Selecteer uptime-precisie**, die standaard op twee decimalen staat (`99.99% (Two Decimal)`).

**Hoeveel dagen de grafiek beslaat, stel je hier niet in.** Dat is **Uptimegeschiedenis weergeven (in dagen)** op **Statuspagina's → jouw pagina → Geavanceerd → Geavanceerde instellingen** (`{id}/settings`), geldig van 1 tot 90.

## Aangepaste HTML, CSS en JavaScript

**Statuspagina's → jouw pagina → Huisstijl → HTML, CSS & JavaScript** (`{id}/custom-code`) heeft vier los bewerkbare kaarten, gevoed door de kolommen `headerHTML`, `footerHTML`, `customCSS` en `customJavaScript` op de statuspagina:

- **Koptekst-HTML** — placeholder `Insert Custom HTML here.`, geïnjecteerd in de koptekst van de pagina.
- **Footer-HTML** — hetzelfde, voor de voettekst.
- **Aangepaste CSS** — placeholder `Insert Custom CSS here.`
- **Aangepaste JavaScript** — placeholder `Insert Custom JavaScript here.`

**Er is geen themakiezer.** OneUptime-statuspagina's hebben geen instelling voor thema of merkkleur: de enige ingebouwde kleurinstellingen zijn **Standaard balkkleur** en de balkkleurregels op het scherm **Overzichtspagina**. Lettertypen, achtergrondkleuren, accentkleuren en aanpassingen aan de indeling lopen allemaal via **Aangepaste CSS** hier. Zocht je naar een veld voor je merkkleur: dat bestaat niet, en dit vak is de nooduitgang.

> Aangepaste JavaScript draait in de browsers van je bezoekers, op een pagina die mensen juist laden wanneer ze bang zijn dat er iets stuk is. Houd het klein, host het zelf waar dat kan, en test het voordat je erop vertrouwt.

## Taalinstellingen

**Statuspagina's → jouw pagina → Huisstijl → Talen** (`{id}/languages`) heeft twee kaarten, en beide gaan over de taalwisselaar die bezoekers in de voettekst krijgen.

- **Standaardtaal** — **Edit Default Language** opent een vervolgkeuzelijst met elke ondersteunde taal in de eigen naam en de Engelse naam (`Deutsch (German)`). De kaart omschrijft het als de taal die nieuwe bezoekers zien; bezoekers kunnen altijd wisselen via de voettekst. Standaard Engels.
- **Ingeschakelde talen** — **Edit Enabled Languages** opent een multiselect, placeholder `All languages`. Laat je die leeg, dan wordt elke ondersteunde taal aangeboden. Kies je er een paar, dan toont de wisselaar in de voettekst alleen die.

OneUptime wordt geleverd met zestien talen: Engels, Duits, Frans, Spaans, Italiaans, Portugees, Nederlands, Deens, Noors, Zweeds, Russisch, Japans, Koreaans, Chinees (vereenvoudigd), Chinees (traditioneel) en Hindi.

## Aangepaste domeinen

Standaard is een statuspagina bereikbaar op de preview-URL die op het scherm **Overzicht** staat. Wil je hem op je eigen hostnaam zetten, ga dan naar **Statuspagina's → jouw pagina → Huisstijl → Aangepaste domeinen** (`{id}/domains`).

De kaart heet **Aangepaste domeinen** en de beschrijving zegt de voorwaarde recht voor zijn raap: voeg het statuspagina-CNAME-record van je installatie toe als CNAME voor deze domeinen, anders werkt het niet. Zonder configuratie leest de tabel "No custom domains found." De tabel heeft twee kolommen, **Domein** en **Status**, en filters voor **Domein**, **CNAME geldig** en **SSL geprovisioneerd**.

### Voordat je begint

Twee voorwaarden, en een ervan overslaan is de gebruikelijke reden dat dit niet werkt:

- **Het bovenliggende domein moet al geverifieerd zijn.** De lijst **Domein** toont alleen geverifieerde domeinen uit de projectinstellingen — de helptekst van het veld verwijst je naar **Meer → Projectinstellingen → Aangepaste domeinen** om er eerst een toe te voegen.
- **De installatie moet een statuspagina-CNAME-record hebben.** Op zelf gehoste deployments is dat de omgevingsvariabele `STATUS_PAGE_CNAME_RECORD` in Docker Compose, of `statusPage.cnameRecord` in de Helm-`values.yaml`. Zonder dat tonen de modals **CNAME toevoegen** en **Gratis SSL bestellen** de melding "Custom Domains not enabled for this OneUptime installation" in plaats van instructies.

### Het domein toevoegen

Klik op **Create Status Page Domain**. De modal (**Create New Status Page Domain**) heeft twee stappen:

**Basis**

- **Subdomein** — alleen het label, placeholder `status (leave blank for root)`. Vul alleen `status` in, niet de hele hostnaam. Laat het leeg of vul `@` in om het root- of apexdomein te gebruiken.
- **Domein** — een lijst met geverifieerde domeinen, placeholder `Select domain`.

**Meer**

- **Aangepast certificaat uploaden** — een schakelaar, standaard uit. Laat je hem uit, dan bestelt OneUptime een gratis certificaat voor je. Zet je hem aan, dan krijg je de velden **Certificaat** en **Privésleutel van certificaat** voor je eigen PEM-materiaal.

## De CNAME verifiëren

Zolang het domein niet geverifieerd is, toont de rij een actie **CNAME toevoegen**. Die opent een modal **CNAME toevoegen** die je precies geeft wat je bij je DNS-provider moet plakken:

- **Recordtype** — `CNAME`
- **Naam** — het volledige domein dat je zojuist aanmaakte, bijvoorbeeld `status.jouwbedrijf.nl`
- **Inhoud** — het statuspagina-CNAME-record van je installatie

De modal vermeldt dat automatische verificatie tot 24 uur kan duren zodra het record staat. Daar hoef je niet op te wachten: de verzendknop van de modal is **CNAME verifiëren**, die het record direct controleert.

Maak eerst het DNS-record aan en klik daarna op **CNAME verifiëren**. Klik je voordat het record bestaat, dan mislukt het gewoon.

## Een SSL-certificaat bestellen

Zodra de CNAME is geverifieerd — en alleen als je geen eigen certificaat hebt geüpload — verschijnt er een actie **Gratis SSL bestellen** op de rij. De bijbehorende modal, **Order Free SSL Certificate for this Status Page**, legt uit dat OneUptime LetsEncrypt gebruikt, dat het proces veilig en gratis is, en dat provisioning een paar uur duurt nadat de bestelling is geplaatst. De verzendknop is **Gratis SSL bestellen**.

**De genoemde doorlooptijden spreken elkaar tegen tussen schermen**, dus hecht niet te veel waarde aan één getal: de bestelmodal zegt drie uur, de kolom **Status** zegt één uur, en bij een eigen certificaat staat dertig minuten. Lees ze allemaal als "kom later vandaag terug", en neem contact op met support als er tegen die tijd nog niets is gebeurd.

Eenmaal geprovisioneerd verloopt de verlenging automatisch. Er is niets terugkerends dat jij moet doen.

## De kolom Status van het domein lezen

De kolom **Status** is de hele setup-toestandsmachine in één cel. Elk bericht vertelt je wat de volgende stap is, of dat je klaar bent.

| Wat de kolom Status zegt                              | Wat het betekent                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | De CNAME is nog niet geverifieerd. Voeg het record toe en klik op **CNAME verifiëren**. |
| Action Required: Please order SSL certificate.        | De CNAME is geverifieerd maar er is nog geen certificaat besteld. Klik op **Gratis SSL bestellen**. |
| No action is required, allow 30 minutes to provision. | Je hebt een eigen certificaat geüpload en het wordt geïnstalleerd.                 |
| No action is required, this will be provisioned soon. | Het gratis certificaat is besteld en onderweg. Neem contact op met support als het nooit aankomt. |
| Certificate Provisioned. No action required.          | Klaar. OneUptime verlengt het certificaat automatisch.                            |

Blijft een rij lang nadat je het DNS-item aanmaakte op "Action Required: Please add your CNAME record." staan, controleer dan of de naam van het record het volledige domein is en of de inhoud exact overeenkomt met het CNAME-record van je installatie.

## Powered by OneUptime

De regel "Powered by OneUptime" is geen instelling uit de huisstijlsectie. Die staat op **Statuspagina's → jouw pagina → Geavanceerd → Geavanceerde instellingen** (`{id}/settings`), in de kaart **Aangedreven door OneUptime-branding**, als één schakelaar: **Verberg 'Powered By OneUptime'-branding**. **Edit Settings** opent hem, net als bij elke andere kaart op die pagina.

## Waar je hierna kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe de onderdelen samenhangen.
- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — kiezen wat bezoekers daadwerkelijk op de pagina zien.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — abonnees via e-mail, sms, Slack en webhook, plus aankondigingen.
- [Publieke API](/docs/status-pages/public-api) — statuspaginadata programmatisch uitlezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op de pagina zet en er weer af haalt.
