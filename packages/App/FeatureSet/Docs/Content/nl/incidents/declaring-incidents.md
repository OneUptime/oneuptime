# Een incident melden

Een incident melden is het moment waarop OneUptime de score begint bij te houden. Er wordt een dossier aangemaakt, er wordt een nummer op gestempeld, bereikbaarheidsbeleid gaat af en — tenzij je iets anders aangeeft — horen de abonnees van je statuspagina ervan. Al het andere in de incidentlevenscyclus hangt aan die eerste schrijfactie.

Er zijn vier manieren waarop een incident in OneUptime belandt, en ze komen allemaal op dezelfde plek uit: een rij in de tabel `Incident` met een ernst, een huidige status en een lijst getroffen middelen. Het enige verschil is wie de velden invult — jij om drie uur 's nachts, een opgeslagen sjabloon, de criteria van een monitor, of je eigen code die de API aanroept.

Deze pagina loopt alle vier langs, veld voor veld, en behandelt daarna wat de server voor je invult en wat er afgaat zodra het incident bestaat.

## Vier manieren waarop een incident wordt gemeld

| Als je wilt…                                                     | Kies                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Een incident met de hand openen en alles zelf invullen           | De wizard **Incident melden**                                                     |
| Een terugkerend soort incident openen met de velden vooringevuld | **Maken op basis van sjabloon**                                                   |
| Er automatisch een openen wanneer de checks van een monitor falen | Een criteriafilter op een monitor met **When filters match, declare an incident.** |
| Er een openen vanuit je eigen code, een script of een andere tool | `POST /api/incident`                                                              |

Alle vier schrijven hetzelfde model, dus een incident dat door een sonde is geopend ziet er precies zo uit als een incident dat een responder met de hand opende — op een paar administratieve kolommen na die de server op de automatische zet.

## Er een met de hand melden

Open **Incidenten → Alle incidenten** en klik rechtsboven in de lijst **Incidenten** op **Incident melden**. Dan kom je op een kaart met de titel **Nieuw incident melden**, die het formulier over drie stappen verdeelt: **Incidentdetails**, **Getroffen middelen** en **Bereikbaarheid en rollen**, gevolgd door een overzicht om te controleren. Als je project bij het aanmaken naar een aantal van zijn aangepaste incidentvelden vraagt, komt er direct na **Getroffen middelen** een vierde stap, **Details**.

Alleen de eerste stap heeft verplichte velden, plus elk aangepast veld dat je beheerders als **Verplicht bij aanmaken** hebben gemarkeerd. Resources koppelen, bereikbaarheidsbeleid toevoegen en rollen toewijzen kan ook achteraf, vanaf de pagina's van het incident zelf. Elke stap vóór het overzicht heeft een gewone knop **Volgende**, en **Incident melden** staat in het overzicht, de laatste stap.

**Meer velden.** De opties die de meeste incidenten nooit nodig hebben, wachten ingeklapt onder een kop **Meer velden** aan het eind van hun stap; klik erop om ze te openen. Ingeklapt noemt de kop wat erin zit en toont elke ingestelde optie met haar waarde — ingesteld door een sjabloon bijvoorbeeld — en hij gaat vanzelf open als er iets in moet worden verbeterd. Het overzicht toont een ingeklapte optie alleen als die is ingesteld, behalve **Statuspagina-abonnees op de hoogte stellen**, die het altijd toont, met wie er bericht krijgt.

### Stap 1 — Incidentdetails

- **Titel** — verplicht. De samenvatting van één regel die iedereen ziet in de lijst, in Slack en, als het incident zichtbaar is, op je statuspagina.
- **Ernst van incident** — verplicht. Een van de ernstniveaus die voor je project zijn ingesteld.
- **Beschrijving** — optioneel, in Markdown. Dit is wat de statuspagina toont, dus schrijf het voor klanten en niet voor je team.

Onder **Meer velden**:

- **Verklaard op** — begint op het moment dat je de pagina opende. Elke duur van het incident wordt hiervandaan gemeten; zet het terug om een incident vast te leggen dat eerder begon.
- **Initiële status** — optioneel, en in het begin leeg. Leeg gelaten start het incident in de status met de vlag `isCreatedState`, of in de beginstatus van het sjabloon. Kies alleen een latere status om een incident vast te leggen dat al bevestigd of opgelost is.
- **Labels** — optioneel. Labels groeperen verwante incidenten, en een team dat tot labels is beperkt, ziet alleen de incidenten met een van zijn labels.
- **Privé-incident** — standaard uit (`isPrivate`). Een privé-incident is alleen zichtbaar voor zijn eigenaren, projectbeheerders en projecteigenaren, en is op elke statuspagina verborgen.

**Als de statuskeuzelijst je dwarszit.** Draagt geen enkele status in je project de vlag `isCreatedState`, dan mislukt de aanmaakaanroep met de melding dat je vanuit de instellingen een aangemaakt-status moet toevoegen. Dat gebeurt normaal alleen in een project waarin flink aan de statussen is gesleuteld — zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

### Stap 2 — Getroffen middelen

De monitoren komen eerst, apart: statuspagina's zien een incident via zijn monitoren, en de status waarnaar de monitoren gaan staat er direct onder.

- **Monitoren** — een zoekveld dat de monitoren koppelt die het incident raakt (`monitors`). Een statuspagina toont het incident, en informeert haar abonnees, als ze een van deze monitoren vermeldt.
- **Monitorstatus wijzigen naar** — optioneel, en pas zichtbaar zodra er minstens één monitor is gekozen. Zet elke monitor van het incident op een monitorstatus, zodat het incident melden en de monitoren als verstoord markeren één handeling is. De status van een sjabloon verschijnt zodra je een monitor kiest; zonder gekozen monitor wordt er geen status opgeslagen.
- **Andere getroffen resources** — een tweede zoekveld voor al het andere dat het incident raakt: hosts, Kubernetes-clusters, Docker- en Podman-hosts, Proxmox-, Ceph- en Docker Swarm-clusters, vCenters, storage-arrays, IoT-vloten, databases en services. Het zijn aparte relaties van het incident (`hosts`, `kubernetesClusters`, `services` en meer).

De kaart **Getroffen resources** van het incident vraagt het op dezelfde manier als je die later bewerkt.

Onder **Meer velden**:

- **Beperken tot deze statuspagina's** — optioneel. Leeg gelaten verschijnt het incident op elke statuspagina die zijn monitoren vermeldt, en informeert het hun abonnees; met gekozen pagina's alleen op die pagina's daarvan. Zie [Eén statuspagina per doelgroep](/docs/status-pages/one-status-page-per-audience).
- **Statuspagina-abonnees op de hoogte stellen** — selectievakje, standaard aan (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Eronder, en nog eens in het overzicht, toont het formulier welke statuspagina's bericht krijgen en hoeveel abonnees elk heeft; in het overzicht toont **Melding bekijken** de e-mail die ze krijgen. Zet het uit voor interne ruis die je toch wilt vastleggen.

**Koppel monitoren, ook als het overbodig voelt.** De verbinding tussen een incident en een statuspagina loopt via de monitoren van het incident: een statuspagina toont een incident wanneer een van haar bronnen ook een monitor van het incident is. Een statuswijzigingsmelding aan abonnees wordt zonder meer overgeslagen wanneer er geen monitoren aan het incident hangen. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).

### Stap 3 — Bereikbaarheid en rollen

- **Bereikbaarheidsbeleid** — een meervoudige keuze van het bereikbaarheidsbeleid dat wordt uitgevoerd wanneer dit incident wordt aangemaakt (`onCallDutyPolicies`).
- **Incidentrollen toewijzen** — wie welke rol neemt die je project definieert. Een rol gemarkeerd als **Primair** die je leeg laat, is van jou: je neemt hem wanneer het incident wordt gemeld.

Dit is de enige plek waar bereikbaarheidsbeleid rechtstreeks aan een incident wordt gekoppeld. Ernstniveaus dragen geen bereikbaarheidsbeleid — ernst is een label, en het beïnvloedt paging alleen als *matchcriterium* binnen een bereikbaarheidsregel. Regels die je instelt onder **Incidenten → Regels → Bereikbaarheidsregels** leggen hun beleid bovenop wat je hier kiest; wat uiteindelijk draait is de ontdubbelde vereniging van beide.

De rollen zelf stel je in onder **Incidenten → Instellingen → Incidentrollen**. Een nieuw project heeft er één, Incident Commander; voeg daar toe wat je proces verder nodig heeft.

De vlag **Should be visible on status page?** (`isVisibleOnStatusPage`) staat niet in de wizard; hij staat standaard aan. Wijzig hem achteraf via **Instellingen** in het zijmenu van het incident, waar hij **Zichtbaar op statuspagina** heet.

## Melden vanuit een sjabloon

Meld je steeds hetzelfde soort incident — dezelfde titelvorm, dezelfde ernst, hetzelfde bereikbaarheidsbeleid — sla het dan één keer op als sjabloon.

Klik op **Maken op basis van sjabloon** (de omlijnde knop naast **Incident melden**) en er opent een dialoogvenster **Incident aanmaken op basis van sjabloon**, met een keuzelijst **Selecteer incidentsjabloon**. Kies een sjabloon en het aanmaakformulier opent vooringevuld; je kunt vóór het versturen nog alles wijzigen. Heeft je project nog geen sjablonen, dan krijg je in plaats daarvan een dialoogvenster **No Incident Templates**, met een knop **Create Template** die je naar **Incidenten → Instellingen → Incident-sjablonen** brengt.

Sjablonen bouw je met een eigen wizard — **Sjablooninformatie**, **Incidentdetails**, **Getroffen middelen**, **Bereikbaarheid** — plus stappen voor aangepaste velden als je project die heeft. Eigenaren en labels staan onder **Meer velden** aan het eind van **Incidentdetails**. **Getroffen middelen** vraagt zoals het meldformulier — **Monitoren**, dan **Monitorstatus wijzigen naar**, dan **Andere getroffen resources**, met **Beperken tot deze statuspagina's** onder **Meer velden** — alleen vraagt een sjabloon altijd om de monitorstatus: die geldt ook voor de monitoren die worden gekozen wanneer er een incident vanuit het sjabloon wordt gemeld. Dit zijn de velden:

| Veld                         | Waarvoor                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| **Sjabloonnaam**             | Hoe het sjabloon in de kiezer herkenbaar is.                 |
| **Sjabloonbeschrijving**     | Een notitie aan jezelf over wanneer je ernaar grijpt.        |
| **Titel**                    | De titel die op het incident wordt vooringevuld.             |
| **Beschrijving**             | Markdown-beschrijving die op het incident wordt ingevuld.    |
| **Ernst van incident**       | Ernst die op het incident wordt vooringevuld.                |
| **Initiële incidentstatus**  | De status waarin incidenten uit dit sjabloon starten.        |
| **Monitoren** | Monitoren om te koppelen. |
| **Monitorstatus wijzigen naar** | Monitorstatus voor de monitoren van het incident, ook die bij het melden worden gekozen. |
| **Andere getroffen resources** | Hosts, clusters en services om te koppelen. |
| **Beperken tot deze statuspagina's** | Statuspagina's waartoe het incident is beperkt. |
| **Bereikbaarheidsbeleid**    | Beleid dat draait wanneer het incident wordt aangemaakt.     |
| **Eigenaren** | Personen en teams die eigenaar zijn van incidenten uit dit sjabloon, gekozen uit één lijst. |
| **Labels**                   | Labels die op het incident worden gezet.                     |

Een paar snelle regels:

- Sjablonen zijn niet te bewerken vanuit de sjabloonlijst — je maakt er een aan en opent hem daarna om hem te wijzigen.
- Een sjabloon vult alleen een veld dat je leeg liet. Op de aanmaakpagina wordt het sjabloon toegepast als voorinvulling die je kunt overschrijven; in de API vult de server een veld alleen vanuit het sjabloon als het verzoek dat veld op `undefined` liet. Wat de aanroeper meestuurt wint altijd.

## Automatisch melden vanuit monitorcriteria

De meeste incidenten zouden niet door een mens getypt hoeven worden. Zet in de criteria-editor van een monitor de schakelaar **When filters match, declare an incident.** aan en er verschijnt een sectie **Incident maken** met een knop **Incident toevoegen** — één criteriafilter kan meer dan één incident melden.

Elk item heeft:

- **Incidenttitel** — ondersteunt templating; de placeholder suggereert iets als `{{monitorName}} is down`.
- **Ernst** — verplicht.
- **Incidentbeschrijving** — ook getemplatet.
- **Bereikbaarheid → Bereikbaarheidsbeleid** — beleid dat draait wanneer dit incident wordt aangemaakt.
- **Incidentrollen** — teamleden vooraf aan rollen toewijzen.
- **Eigendom & labels → Eigenaarsteams**, **Eigenaarsgebruikers**, **Labels**.
- **Meer velden → Incident automatisch oplossen** (lost het incident automatisch op zodra de criteria niet meer matchen), **Incident weergeven op statuspagina**, **Privé-incident** en **Herstelnotities**.

Voor de volledige lijst met `{{variable}}`-placeholders die je in de titel, beschrijving en herstelnotities kunt gebruiken, zie [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating).

Incidenten die zo ontstaan worden door de server gemarkeerd: `isCreatedAutomatically` wordt gezet, `createdCriteriaId` legt vast welk criteriafilter afging, en `createdByProbe` welke sonde het zag. Verder gedragen ze zich precies als een met de hand gemeld incident.

## Melden via de API

Het incidentmodel biedt een standaard CRUD-endpoint, dus `POST /api/incident` maakt er een aan. Authenticeer met een API-sleutel die je genereert onder **Projectinstellingen → API-sleutels**, meegestuurd in de header `apikey` — de sleutel identificeert het project, dus je hoeft geen project-id apart mee te geven.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Handige velden in de request body:

- `title` — het enige veld dat je echt moet meegeven.
- `declaredAt` — hier optioneel, ook al is het in het formulier verplicht. Laat je het weg, dan gebruikt de server het huidige tijdstip.
- `incidentSeverityId` en `currentIncidentStateId` — de server controleert dat beide bij hetzelfde project horen als de API-sleutel, en weigert het verzoek als dat niet zo is. Dezelfde controle geldt voor de monitorstatus achter **Change Monitor Status to**.
- `createdIncidentTemplateId` — pas een opgeslagen sjabloon toe. Elk veld dat je weglaat wordt uit het sjabloon gevuld; elk veld dat je meestuurt blijft zoals het is.

Verwante endpoints zijn `/api/incident-state`, `/api/incident-severity` en `/api/incident-state-timeline`. De gegenereerde [API-referentie](/reference) bevat de exacte request- en responsvormen van elk, inclusief hoe relatievelden zoals monitoren worden uitgedrukt.

## Incidentnummers en voorvoegsels

Elk incident krijgt een oplopend nummer uit een teller per project, dat de server bij het aanmaken toekent. Twee kolommen houden het vast: `incidentNumber` (het kale getal) en `incidentNumberWithPrefix` (wat je daadwerkelijk ziet). Zonder ingesteld voorvoegsel is de weergavewaarde `#42`.

Om dat te wijzigen ga je naar **Incidenten → Instellingen → Nummervoorvoegsel** en klik je op **Bijwerken**. Het veld **Voorvoegsel incidentnummer** toont het nummer terwijl je typt: met `INC-` wordt het `INC-42`. Laat het leeg om de standaard `#` te houden. Een nieuw voorvoegsel geldt voor incidenten die na het opslaan worden gemeld; bestaande incidenten houden hun nummer. Hetzelfde dialoogvenster bevat ook **Nummervoorvoegsel voor incident-episode** voor de nummering van episoden.

Het nummer staat in de eerste kolom van de incidentenlijst, linkt naar het incident, en verschijnt als **Incidentnummer** op het **Overzicht** van het incident.

## Wat er gebeurt zodra een incident is gemeld

De aanmaakaanroep doet meer dan een rij wegschrijven. In deze volgorde:

1. **De server vult de gaten.** `declaredAt` valt terug op nu, de huidige status valt terug op de `isCreatedState`-status van het project, en het incidentnummer plus het nummer met voorvoegsel worden uit de projectteller toegekend.
2. **Een sjabloon wordt toegepast**, als `createdIncidentTemplateId` is meegegeven — waarbij alleen velden worden gevuld die de aanroeper op undefined liet.
3. **Privacyregels draaien** en markeren het incident als privé wanneer een matchende regel dat zegt. Dit is de eerste regelmotor die draait, zodat alles daarna de juiste privacy-instelling ziet.
4. **Eigenaarsregels draaien** en voegen de eigenaargebruikers en -teams toe die matchende regels noemen.
5. **Labelregels draaien** en voegen labels toe die bij het incident passen.
6. **Bereikbaarheidsregels draaien.** Elke ingeschakelde regel onder **Incidenten → Regels → Bereikbaarheidsregels** waarvan de criteria matchen voegt haar beleid toe aan het incident. Er is geen prioriteitsvolgorde en geen kortsluiting — alle matchende regels gaan af en het beleid wordt ontdubbeld.
7. **Runbook-regels draaien** en koppelen en starten matchende runbooks. Zie [Runbooks](/docs/runbooks/index).
8. **Bereikbaarheidsbeleid wordt uitgevoerd.** Elk beleid op het incident — gekozen in de wizard, geërfd van een sjabloon of toegevoegd door een regel — draait parallel met het gebeurtenistype `IncidentCreated`. Faalt één beleid, dan stopt dat de andere niet.
9. **Abonnees worden in de wachtrij gezet**, als **Statuspagina-abonnees op de hoogte stellen** aan bleef staan en het incident zichtbaar is op de statuspagina. Bezorging gebeurt door een achtergrondtaak, niet direct binnen je verzoek.
10. **Workflows gaan af.** De trigger **On Create Incident** start elke workflow die erop is gebouwd. Zie [Workflows – Overzicht](/docs/workflows/index).

Vanaf dat moment is het incident live: het telt mee voor de badge **Actieve incidenten** in het zijmenu Incidenten (elke status zonder de vlag `isResolvedState` telt als actief), het verschijnt op de statuspagina's die een van zijn monitoren tonen, en zijn **Statustijdlijn** begint mee te schrijven.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe het incidentmodel in elkaar past.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat de statusvlaggen doen en hoe je er zelf toevoegt.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare notities, privénotities, eigenaren en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, rollen, regels en workflow-triggers.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie er hoort over het incident dat je zojuist meldde.
- [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) — de variabelen die automatisch gemelde incidenten kunnen gebruiken.
