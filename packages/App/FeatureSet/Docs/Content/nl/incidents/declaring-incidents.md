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

Open **Incidenten → Alle incidenten** en klik rechtsboven in de lijst **Incidenten** op **Incident melden**. Dat brengt je naar een kaart met de titel **Nieuw incident melden**, die het formulier over vijf stappen verdeelt: **Incidentdetails**, **Getroffen middelen**, **Incidentrollen**, **Bereikbaarheid** en **Meer**. De verzendknop aan het eind heet ook **Incident melden**.

Alleen de eerste stap heeft verplichte velden. Heb je haast, vul dan **Incidentdetails** in en verstuur — middelen koppelen, rollen toewijzen en bereikbaarheidsbeleid toevoegen kan daarna nog vanaf de eigen pagina's van het incident.

### Stap 1 — Incidentdetails

- **Titel** — verplicht. De samenvatting van één regel die iedereen ziet in de lijst, in Slack en (als het incident zichtbaar is) op je statuspagina. Placeholder: `Incident Title`.
- **Beschrijving** — optioneel, geschreven in Markdown. Dit is het veld dat op de statuspagina verschijnt, dus schrijf het voor klanten en niet voor je team. Je kunt het later aanpassen via **Beschrijving** in het zijmenu van het incident.
- **Verklaard op** — verplicht in het formulier, standaard op nu. Vanaf dit tijdstempel wordt elke duur op het incident gemeten, dus zet het terug in de tijd als je iets vastlegt dat eerder begon.
- **Ernst van incident** — verplicht. Een van de ernstniveaus die voor je project zijn ingesteld; nieuwe projecten krijgen **Critical Incident**, **Major Incident** en **Minor Incident**.
- **Status incident** — optioneel. Laat het staan en het incident belandt in de status met de vlag `isCreatedState`, die nieuwe projecten aanmaken als **Identified**. Stel het alleen in wanneer je een incident vastlegt dat dat punt al voorbij was.

**Als de statuskeuzelijst je dwarszit.** Draagt geen enkele status in je project de vlag `isCreatedState`, dan mislukt de aanmaakaanroep met de melding dat je vanuit de instellingen een aangemaakt-status moet toevoegen. Dat gebeurt normaal alleen in een project waarin flink aan de statussen is gesleuteld — zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

### Stap 2 — Getroffen middelen

- **Getroffen middelen** — één zoekveld dat monitoren, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services koppelt. Onder de motorkap zijn dat losse relaties op het incident (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` en meer), maar het formulier vouwt ze samen tot één kiezer.
- **Change Monitor Status to** — optioneel. Kiest een monitorstatus die wordt toegepast op elke monitor die aan dit incident hangt, zodat het incident melden en de monitoren op verslechterd zetten één handeling is in plaats van twee.

**Koppel monitoren, ook als het overbodig voelt.** De verbinding tussen een incident en een statuspagina loopt via de monitoren van het incident: een statuspagina toont een incident wanneer een van haar bronnen ook een monitor van het incident is. Een statuswijzigingsmelding aan abonnees wordt zonder meer overgeslagen wanneer er geen monitoren aan het incident hangen. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).

### Stap 3 — Incidentrollen

- **Incidentrollen toewijzen** — wijs teamleden toe aan de rollen die je project definieert. Sommige rollen accepteren meer dan één gebruiker.

De rollen zelf stel je in onder **Incidenten → Instellingen → Incidentrollen**, waar je bepaalt welke rollen tijdens de respons kunnen worden toegewezen — Incident Commander, Responder, en wat jouw proces verder nodig heeft. Sla je deze stap over, dan wordt bij de eerste statuswijziging automatisch een Incident Commander aangewezen als nog niemand die rol heeft.

### Stap 4 — Bereikbaarheid

- **Bereikbaarheidsbeleid** — een meervoudige keuze van het bereikbaarheidsbeleid dat wordt uitgevoerd wanneer dit incident wordt aangemaakt. Dit komt overeen met `onCallDutyPolicies` op het incident.

Dit is de enige plek waar bereikbaarheidsbeleid rechtstreeks aan een incident wordt gekoppeld. Ernstniveaus dragen geen bereikbaarheidsbeleid — ernst is een label, en het beïnvloedt paging alleen als *matchcriterium* binnen een bereikbaarheidsregel. Regels die je instelt onder **Incidenten → Regels → Bereikbaarheidsregels** leggen hun beleid bovenop wat je hier kiest; wat uiteindelijk draait is de ontdubbelde vereniging van beide.

### Stap 5 — Meer

- **Labels** — optioneel en een geavanceerde functie: teamleden met toegang tot deze labels zijn degenen die bij het incident kunnen.
- **Statuspagina-abonnees op de hoogte stellen** — vinkje, standaard aan. Bepaalt of abonnees een e-mail krijgen over het aanmaken van het incident (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Zet het uit voor interne ruis die je toch wilt vastleggen.
- **Privé-incident** — vinkje, standaard uit (`isPrivate`). Een privé-incident is alleen zichtbaar voor zijn eigenaargebruikers, de leden van zijn eigenaarsteams, projectbeheerders en projecteigenaren — en het blijft verborgen voor elke statuspagina, ongeacht welke andere instelling ook. De incidentenlijst markeert deze met een rode pil **Private**.

De vlag **Should be visible on status page?** (`isVisibleOnStatusPage`) staat niet in de wizard; hij staat standaard aan. Wijzig hem achteraf via **Instellingen** in het zijmenu van het incident, waar hij **Zichtbaar op statuspagina** heet.

## Melden vanuit een sjabloon

Meld je steeds hetzelfde soort incident — dezelfde titelvorm, dezelfde ernst, hetzelfde bereikbaarheidsbeleid — sla het dan één keer op als sjabloon.

Klik op **Maken op basis van sjabloon** (de omlijnde knop naast **Incident melden**) en er opent een dialoogvenster **Incident aanmaken op basis van sjabloon**, met een keuzelijst **Selecteer incidentsjabloon**. Kies een sjabloon en het aanmaakformulier opent vooringevuld; je kunt vóór het versturen nog alles wijzigen. Heeft je project nog geen sjablonen, dan krijg je in plaats daarvan een dialoogvenster **No Incident Templates**, met een knop **Create Template** die je naar **Incidenten → Instellingen → Incident-sjablonen** brengt.

Sjablonen bouw je met een eigen zesstapswizard — **Sjablooninformatie**, **Incidentdetails**, **Getroffen middelen**, **Bereikbaarheid**, **Eigenaren**, **Labels** — met deze velden:

| Veld                         | Waarvoor                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| **Sjabloonnaam**             | Hoe het sjabloon in de kiezer herkenbaar is.                 |
| **Sjabloonbeschrijving**     | Een notitie aan jezelf over wanneer je ernaar grijpt.        |
| **Titel**                    | De titel die op het incident wordt vooringevuld.             |
| **Beschrijving**             | Markdown-beschrijving die op het incident wordt ingevuld.    |
| **Ernst van incident**       | Ernst die op het incident wordt vooringevuld.                |
| **Initiële incidentstatus**  | De status waarin incidenten uit dit sjabloon starten.        |
| **Getroffen middelen**       | Monitoren, hosts, clusters en services om te koppelen.       |
| **Change Monitor Status to** | Monitorstatus die op de gekoppelde monitoren wordt gezet.    |
| **Bereikbaarheidsbeleid**    | Beleid dat draait wanneer het incident wordt aangemaakt.     |
| **Eigenaar - Teams**         | Teams die incidenten uit dit sjabloon bezitten.              |
| **Eigenaar - Gebruikers**    | Gebruikers die incidenten uit dit sjabloon bezitten.         |
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
- **Geavanceerde opties → Incident automatisch oplossen** (lost het incident automatisch op zodra de criteria niet meer matchen), **Incident weergeven op statuspagina**, **Privé-incident** en **Herstelnotities**.

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

Om dat te wijzigen ga je naar **Incidenten → Instellingen → Meer instellingen**. De kaart **Nummervoorvoegsel** heeft een veld **Voorvoegsel incidentnummer** (maximaal 20 tekens, placeholder `INC-`) — stel het in en hetzelfde incident verschijnt als `INC-42`. Laat het leeg om de standaard `#` te houden. Op dezelfde kaart staat ook **Nummervoorvoegsel voor incident-episode** voor de nummering van episoden.

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
