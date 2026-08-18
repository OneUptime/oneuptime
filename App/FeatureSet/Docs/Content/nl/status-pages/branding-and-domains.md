# Huisstijl & Aangepaste Domeinen

Een statuspagina is het ene OneUptime-oppervlak dat je klanten daadwerkelijk bekijken, dus het moet eruitzien alsof het van jou is en op je eigen domein staan. Beide worden geconfigureerd vanuit de sectie **Huisstijl** in het zijmenu van een statuspagina, plus één instelling die verstopt zit in **Geavanceerde instellingen**.

Wat je moet weten voordat je begint: huisstijl is verspreid over zeven aparte schermen, en die verdeling is niet altijd waar je zou verwachten. Het logo en de omslagafbeelding staan niet op **Essentiële branding** — die staan op **Koptekst**. De favicon staat op **Essentiële branding**. Kleuren staan op **Overzichtspagina**. Al het andere dat je als "theming" zou beschouwen, is Aangepaste CSS.

Deze pagina doorloopt elk scherm stuk voor stuk, en neemt je daarna mee door de volledige CNAME-dan-SSL-reeks om de pagina op `status.jouwbedrijf.com` te zetten.

## Waar elke huisstijlbediening zich bevindt

Open een statuspagina, en de sectie **Huisstijl** van het zijmenu heeft zeven items. Hier is de kaart, zodat je niet meer hoeft te zoeken.

| Pagina                       | Wat je daar instelt                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| **Essentiële branding**      | Paginatitel, paginabeschrijving, indexering door zoekmachines, favicon.                    |
| **Koptekst**                 | Logo, omslagafbeelding, hun alt-tekst, en de koptekst-linkbalk.                            |
| **Voettekst**                 | Copyrightregel en de voettekst-linkbalk.                                                   |
| **Overzichtspagina**          | Overzichtsbeschrijving, balkkleuren van de geschiedenisgrafiek, downtime-statussen, algeheel uptimepercentage. |
| **HTML, CSS & JavaScript**    | Koptekst-HTML, footer-HTML, aangepaste CSS, aangepaste JavaScript.                          |
| **Aangepaste domeinen**       | Je eigen domein, CNAME-verificatie, en SSL.                                                |
| **Talen**                     | Standaardtaal en de talen die worden aangeboden in de footer-schakelaar.                    |

## Essentiële branding

**Statuspagina's → jouw pagina → Huisstijl → Essentiële branding** (`{id}/branding`) bevat drie kaarten.

- **Titel en beschrijving** — de kaart vermeldt dat dit ook wordt gebruikt voor SEO. **Edit** opent **Paginatitel** (placeholder `Please enter page title here.`) en **Paginabeschrijving**. Dit is wat zoekmachines en linkpreviews tonen, dus schrijf het voor een klant, niet voor je team.
- **Search Engine Indexing** — een enkele schakelaar, **Allow Search Engines to Index this Status Page**, in het product beschreven als de bediening of Google en Bing de pagina mogen opnemen in hun resultaten. Deze staat standaard aan. Zet hem uit en de pagina wordt in plaats daarvan geserveerd met `noindex, nofollow`.
- **Favicon** — **Edit Favicon** opent de afbeeldingsupload **Favicon**. Dit is het kleine icoontje in het browsertabblad.

Gebruik dit wanneer: de pagina alleen intern is of nog wordt opgezet. Zet **Allow Search Engines to Index this Status Page** uit zodat een half afgemaakte pagina niet begint te ranken voor je merknaam.

## Het koptekst-scherm

**Statuspagina's → jouw pagina → Huisstijl → Koptekst** (`{id}/header-style`). Ondanks de naam in het zijmenu is dit waar je twee grootste merkactiva staan.

De eerste kaart heet **Logo, Cover and Favicon**, met een knop **Edit Images**:

- **Logo** — afbeeldingsupload, placeholder `Upload logo`.
- **Logo Alt Text** — placeholder `Logo of My Company`. Laat je dit leeg, dan wordt in plaats daarvan de titel van de statuspagina gebruikt.
- **Cover** — afbeeldingsupload, placeholder `Upload cover image`. Dit is de brede banner achter de koptekst.
- **Cover Image Alt Text** — hetzelfde idee voor de omslag.

Daaronder staat een tabel **Header Links** ("Header Links for your status page"). Elke link heeft een **Title** en een **Link** (een URL, placeholder `https://link.com`), en rijen worden versleept om opnieuw te ordenen. Zonder configuratie staat er in de tabel "No status header link for this status page."

Goed voor: bezoekers terugleiden naar je marketingsite, je documentatie, of een supportportaal zonder ze de URL te laten raden.

## Het footer-scherm

**Statuspagina's → jouw pagina → Huisstijl → Voettekst** (`{id}/footer-style`) heeft dezelfde vorm als **Koptekst**, één kaart en één tabel.

- **Copyright Info** — **Edit Copyright** opent één veld, **Copyright Info**, met de placeholder `Acme, Inc.`.
- **Footer Links** — hetzelfde paar **Title** plus **Link**, versleepbaar geordend, met lege melding "No status footer link for this status page."

Juridische links, privacy- en voorwaardenlinks horen hier thuis. Koptekstlinks zijn voor navigatie; footerlinks zijn voor de kleine lettertjes.

## Huisstijl van de overzichtspagina

**Statuspagina's → jouw pagina → Huisstijl → Overzichtspagina** (`{id}/overview-page-branding`) is het enige scherm waar kleuren instelbaar zijn, en het bepaalt ook wat "down" betekent op de grafiek.

- **Overview Page** — **Edit Branding** opent een markdown-veld, **Overview Page Description.**, dat boven de resourcelijst wordt weergegeven. Gebruik het voor een zin context: wat deze pagina behandelt, en waar je terechtkunt voor support.
- **Rules for Bar Colors of History Chart** — een geordende, versleepbare tabel met regels. Elke regel heeft **When uptime % is greater than or equal to** en **Then, use this bar color**; de tabelkolommen luiden `When Uptime Percent >=` en `Then, Bar Color is`. Volgorde is van belang, dus rangschik ze in de volgorde waarin je wilt dat ze worden geëvalueerd.
- **Downtime Monitor Statuses** — **Edit Statuses** opent een multiselect die wordt omschreven als "These monitor statuses are considered as down". Zo bepaal je of, bijvoorbeeld, een degraded-status meetelt tegen de uptime op deze pagina.
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** opent de kleurenkiezer **Default Bar Color**, de kleur die wordt gebruikt wanneer geen enkele regel van toepassing is.
- **Overall Uptime Percent** — **Edit Settings** opent de schakelaar **Show Overall Uptime Percent** en een dropdown **Select Uptime Precision**, die standaard op twee decimalen staat (`99.99% (Two Decimal)`).

**Hoeveel dagen de grafiek beslaat, wordt hier niet ingesteld.** Dat is **Show Uptime History (in days)** op **Statuspagina's → jouw pagina → Advanced → Geavanceerde instellingen** (`{id}/settings`), geldig van 1 tot 90.

## Aangepaste HTML, CSS en JavaScript

**Statuspagina's → jouw pagina → Huisstijl → HTML, CSS & JavaScript** (`{id}/custom-code`) heeft vier onafhankelijk bewerkbare kaarten, ondersteund door de kolommen `headerHTML`, `footerHTML`, `customCSS` en `customJavaScript` op de statuspagina:

- **Header HTML** — placeholder `Insert Custom HTML here.`, geïnjecteerd in de paginakoptekst.
- **Footer HTML** — hetzelfde, voor de footer.
- **Custom CSS** — placeholder `Insert Custom CSS here.`
- **Custom JavaScript** — placeholder `Insert Custom JavaScript here.`

**Er is geen themakiezer.** OneUptime-statuspagina's hebben geen thema- of merkkleurinstelling: de enige ingebouwde kleurbedieningen waar dan ook zijn **Default Bar Color** en de balkkleurregels van de geschiedenisgrafiek op het scherm **Overzichtspagina**. Lettertypen, achtergrondkleuren, accentkleuren en lay-outaanpassingen lopen allemaal via **Aangepaste CSS** hier. Als je op zoek was naar een "merkkleur"-veld, is dit het antwoord — er is er geen, en dit vak is het ontsnappingsluik.

> Aangepaste JavaScript draait in de browsers van je bezoekers, op een pagina die mensen precies laden wanneer ze bang zijn dat er iets kapot is. Houd het klein, host het waar mogelijk zelf, en test het voordat je erop vertrouwt.

## Taalinstellingen

**Statuspagina's → jouw pagina → Huisstijl → Talen** (`{id}/languages`) heeft twee kaarten, en beide gaan over de taalschakelaar die bezoekers krijgen in de paginafooter.

- **Default Language** — **Edit Default Language** opent een dropdown met elke ondersteunde taal, met inheemse naam en Engelse naam (`Deutsch (German)`). De kaart omschrijft dit als de taal die eerste bezoekers zien; bezoekers kunnen altijd wisselen vanuit de footer. Standaard staat dit op Engels.
- **Enabled Languages** — **Edit Enabled Languages** opent een multiselect, placeholder `All languages`. Laat het leeg en elke ondersteunde taal wordt aangeboden. Kies er een paar en de footer-schakelaar toont alleen die.

Zestien talen worden standaard meegeleverd met OneUptime: Engels, Duits, Frans, Spaans, Italiaans, Portugees, Nederlands, Deens, Noors, Zweeds, Russisch, Japans, Koreaans, Chinees (vereenvoudigd), Chinees (traditioneel) en Hindi.

## Aangepaste domeinen

Standaard is een statuspagina bereikbaar op de preview-URL die wordt getoond op het scherm **Overview**. Om de pagina op je eigen hostnaam te zetten, ga je naar **Statuspagina's → jouw pagina → Huisstijl → Aangepaste domeinen** (`{id}/domains`).

De kaart heet **Custom Domains** en de beschrijving spelt de vereiste direct uit: voeg het CNAME-record van je installatie's statuspagina toe als CNAME voor deze domeinen om dit te laten werken. Zonder configuratie staat er in de tabel "No custom domains found." De tabel heeft twee kolommen, **Domain** en **Status**, en filters voor **Domain**, **CNAME Valid** en **SSL Provisioned**.

### Voordat je begint

Twee voorwaarden, en het overslaan van een van beide is de gebruikelijke reden waarom dit niet werkt:

- **Het bovenliggende domein moet al geverifieerd zijn.** De dropdown **Domain** toont alleen geverifieerde domeinen uit de projectinstellingen — de helptekst van het veld verwijst je naar **Meer → Projectinstellingen → Aangepaste domeinen** om er eerst een toe te voegen.
- **De installatie moet een CNAME-record voor de statuspagina hebben geconfigureerd.** Op self-hosted installaties is dat de omgevingsvariabele `STATUS_PAGE_CNAME_RECORD` in Docker Compose, of `statusPage.cnameRecord` in de Helm `values.yaml`. Zonder dit tonen zowel de modal **Add CNAME** als **Order Free SSL** een bericht "Custom Domains not enabled for this OneUptime installation" in plaats van instructies.

### Het domein toevoegen

Klik op **Create Status Page Domain**. De modal (**Create New Status Page Domain**) heeft twee stappen:

**Basic**

- **Subdomain** — alleen het label, placeholder `status (leave blank for root)`. Voer alleen `status` in, niet de volledige hostnaam. Laat het leeg of vul `@` in om het root-/apex-domein te gebruiken.
- **Domain** — een dropdown met geverifieerde domeinen, placeholder `Select domain`.

**More**

- **Upload Custom Certificate** — een schakelaar, standaard uit. Laat hem uit en OneUptime bestelt gratis een certificaat voor je. Zet hem aan en je krijgt de velden **Certificate** en **Certificate Private Key** voor je eigen PEM-materiaal.

## De CNAME verifiëren

Zolang het domein niet geverifieerd is, toont de rij een actie **Add CNAME**. Deze opent een modal getiteld **Add CNAME** die je precies geeft wat je in je DNS-provider moet plakken:

- **Record Type** — `CNAME`
- **Name** — het volledige domein dat je zojuist hebt aangemaakt, bijvoorbeeld `status.jouwbedrijf.com`
- **Content** — het CNAME-record van de statuspagina van je installatie

De modal vermeldt dat, zodra het record is geplaatst, automatische verificatie tot 24 uur kan duren. Je hoeft daar niet op te wachten: de submitknop van de modal is **Verify CNAME**, die het record op verzoek controleert.

Maak eerst het DNS-record aan, klik daarna op **Verify CNAME**. Erop klikken voordat het record bestaat mislukt gewoon.

## Een SSL-certificaat bestellen

Zodra de CNAME is geverifieerd — en alleen als je niet zelf een certificaat hebt geüpload — verschijnt op de rij een actie **Order Free SSL**. De bijbehorende modal, **Order Free SSL Certificate for this Status Page**, legt uit dat OneUptime LetsEncrypt gebruikt, dat het proces veilig en gratis is, en dat provisioning enkele uren duurt nadat de bestelling is geplaatst. De submitknop is **Order Free SSL**.

**De vermelde tijden verschillen tussen schermen**, dus lees niet te veel in één enkel getal: de bestelmodal zegt drie uur, de kolom **Status** zegt één uur, en een aangepast certificaat zegt dertig minuten. Behandel ze allemaal als "kom later vandaag terug", en neem contact op met support als er tegen die tijd nog niets is gebeurd.

Eenmaal geprovisioneerd, is vernieuwing automatisch. Er is niets terugkerends dat je nog hoeft te doen.

## De kolom Status van het domein lezen

De kolom **Status** is de hele setup-statusmachine in één cel. Elk bericht vertelt je wat de volgende stap is, of dat je klaar bent.

| Wat de kolom Status zegt                               | Wat het betekent                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.         | De CNAME is nog niet geverifieerd. Voeg het record toe en klik op **Verify CNAME**. |
| Action Required: Please order SSL certificate.          | CNAME is geverifieerd maar er is geen certificaat besteld. Klik op **Order Free SSL**. |
| No action is required, allow 30 minutes to provision.   | Je hebt een aangepast certificaat geüpload en het wordt geïnstalleerd.               |
| No action is required, this will be provisioned soon.   | Het gratis certificaat is besteld en onderweg. Neem contact op met support als het nooit aankomt. |
| Certificate Provisioned. No action required.             | Klaar. OneUptime vernieuwt het certificaat automatisch.                             |

Als een rij lang na het aanmaken van het DNS-item nog steeds "Action Required: Please add your CNAME record." toont, controleer dan of de naam van het record het volledige domein is en of de inhoud precies overeenkomt met het CNAME-record van je installatie.

## Powered by OneUptime

De regel "Powered by OneUptime" is geen instelling in de huisstijl-sectie. Deze staat op **Statuspagina's → jouw pagina → Advanced → Geavanceerde instellingen** (`{id}/settings`), in de kaart **Powered By OneUptime Branding**, als één enkele schakelaar: **Hide Powered By OneUptime Branding**. **Edit Settings** opent hem, zoals elke andere kaart op die pagina.

## Waar je hierna kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe de onderdelen samenhangen.
- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — kiezen wat bezoekers daadwerkelijk op de pagina zien.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — e-mail-, SMS-, Slack- en webhookabonnees, plus aankondigingen.
- [Public API](/docs/status-pages/public-api) — statuspaginagegevens programmatisch uitlezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op de pagina laat verschijnen en verdwijnen.
