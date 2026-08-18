# Een incident melden

Een incident melden is het moment waarop OneUptime de score begint bij te houden. Er wordt een record aangemaakt, er wordt een nummer op gestempeld, bereikbaarheidsbeleid gaat af, en — tenzij je iets anders aangeeft — horen de abonnees van je statuspagina ervan. Al het andere in de incidentlevenscyclus hangt aan die eerste schrijfactie.

Er zijn vier manieren waarop een incident in OneUptime terechtkomt, en ze eindigen allemaal op dezelfde plek: een rij in de `Incident`-tabel met een ernst, een huidige status en een lijst van getroffen middelen. Het verschil zit alleen in wie de velden invult — jij om 3 uur 's nachts, een opgeslagen sjabloon, de criteria van een monitor, of je eigen code die de API aanroept.

Deze pagina loopt alle vier langs, veld voor veld, en behandelt daarna wat de server voor je invult en wat er afgaat zodra het incident bestaat.

## Vier manieren waarop een incident wordt gemeld

| Als je wilt…                                                       | Kies                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Een incident met de hand openen en alles zelf invullen             | De wizard **Incident melden**                                                 |
| Een terugkerend soort incident openen met vooraf ingevulde velden  | **Maken op basis van sjabloon**                                               |
| Er automatisch een openen wanneer de checks van een monitor falen  | Een monitor-criteriafilter met **When filters match, declare an incident.**   |
| Er een openen vanuit je eigen code, een script of een andere tool  | `POST /api/incident`                                                          |

Alle vier schrijven hetzelfde model, dus een incident dat door een probe is geopend ziet er precies zo uit als een incident dat een responder met de hand opende — op een paar administratieve kolommen na die de server op automatische incidenten zet.

## Er een met de hand melden

Open **Incidenten → Alle incidenten** en klik rechtsboven in de lijst **Incidenten** op **Incident melden**. Dat brengt je naar een kaart met de titel **Nieuw incident melden**, die het formulier over vijf stappen verdeelt: **Incidentdetails**, **Getroffen middelen**, **Incidentrollen**, **Bereikbaarheid** en **Meer**. De verzendknop aan het eind leest ook **Incident melden**.

Alleen de eerste stap heeft verplichte velden. Heb je haast, vul dan **Incidentdetails** in en verstuur — je kunt daarna vanaf de eigen pagina's van het incident middelen koppelen, rollen toewijzen en bereikbaarheidsbeleid toevoegen.

### Stap 1 — Incidentdetails

- **Titel** — verplicht. De samenvatting van één regel die iedereen ziet in de lijst, in Slack, en (als het incident zichtbaar is) op je statuspagina. Placeholder: `Incident Title`.
- **Beschrijving** — optioneel, geschreven in Markdown. Dit is het veld dat op de statuspagina verschijnt, dus schrijf het voor klanten in plaats van voor je team. Je kunt het later bewerken via **Beschrijving** in het zijmenu van het incident.
- **Verklaard op** — verplicht in het formulier, standaard nu. Dit is het tijdstip waarvandaan elke duur op het incident wordt gemeten, dus zet het terug in de tijd als je iets vastlegt dat eerder begon.
- **Ernst van incident** — verplicht. Een van de ernstniveaus die voor je project zijn geconfigureerd; nieuwe projecten worden aangemaakt met **Critical Incident**, **Major Incident** en **Minor Incident**.
- **Status incident** — optioneel. Laat het staan en het incident belandt in de status met de vlag `isCreatedState`, die nieuwe projecten aanmaken als **Identified**. Stel het alleen in wanneer je een incident vastlegt dat dat punt al voorbij was.

**Als de statuskeuzelijst je problemen geeft.** Als je project geen status heeft die de vlag `isCreatedState` draagt, mislukt de aanmaakaanroep en krijg je te horen dat je vanuit de instellingen een aangemaakt-incidentstatus moet toevoegen. Dat gebeurt normaal alleen bij een project waarvan de statussen flink zijn bewerkt — zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

### Stap 2 — Getroffen middelen

- **Getroffen middelen** — één zoekvak dat monitoren, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services koppelt. Onder de motorkap zijn dit aparte relaties op het incident (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` en meer), maar het formulier vouwt ze samen tot één kiezer.
- **Change Monitor Status to** — optioneel. Kiest een monitorstatus die wordt toegepast op elke monitor die aan dit incident hangt, zodat het incident melden en de monitoren als verslechterd markeren één actie is in plaats van twee.

**Koppel monitoren ook als het overbodig voelt.** De link tussen een incident en een statuspagina loopt via de monitoren van het incident: een statuspagina toont een incident wanneer een van zijn middelen een van de monitoren van het incident is. Een statuswijzigingsmelding aan abonnees wordt regelrecht overgeslagen wanneer het incident geen monitoren gekoppeld heeft. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).

### Stap 3 — Incidentrollen

- **Incidentrollen toewijzen** — wijs teamleden toe aan de rollen die je project definieert. Sommige rollen accepteren meer dan één gebruiker.

De rollen zelf configureer je bij **Incidenten → Instellingen → Incidentrollen**, waar je de rollen definieert die tijdens de respons kunnen worden toegewezen — Incident Commander, Responder, en wat je proces verder nodig heeft. Sla je deze stap over, dan wordt bij de eerste statuswijziging automatisch een Incident Commander toegewezen als nog niemand die rol heeft.

### Stap 4 — Bereikbaarheid

- **Bereikbaarheidsbeleid** — een meervoudige selectie van de piketbeleidsregels die moeten worden uitgevoerd wanneer dit incident wordt aangemaakt. Dit mapt op `onCallDutyPolicies` op het incident.

Dit is de enige plek waar een bereikbaarheidsbeleid rechtstreeks aan een incident wordt gekoppeld. Ernstniveaus dragen geen bereikbaarheidsbeleid — ernst is een label, en het beïnvloedt paging alleen als *matchcriterium* binnen een bereikbaarheidsregel. Regels die je configureert bij **Incidenten → Regels → Bereikbaarheidsregels** voegen hun beleidsregels toe bovenop wat je hier kiest; de uiteindelijke set die draait is de ontdubbelde vereniging van beide.

### Stap 5 — Meer

- **Labels** — optioneel en een geavanceerde functie: teamleden met toegang tot deze labels zijn degenen die toegang hebben tot het incident.
- **Statuspagina-abonnees op de hoogte stellen** — selectievakje, standaard aan. Bepaalt of abonnees een e-mail krijgen over het aanmaken van het incident (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Zet het uit voor interne ruis die je toch wilt vastleggen.
- **Privé-incident** — selectievakje, standaard uit (`isPrivate`). Een privé-incident is alleen zichtbaar voor de eigenaarsgebruikers, de leden van de eigenaarsteams, projectbeheerders en projecteigenaren — en het is verborgen voor elke statuspagina, ongeacht welke andere instelling ook. De incidentenlijst markeert deze met een rode **Private**-pil.

De vlag **Should be visible on status page?** (`isVisibleOnStatusPage`) staat niet in de wizard; hij staat standaard op waar. Wijzig hem achteraf via **Instellingen** in het zijmenu van het incident, waar hij **Zichtbaar op statuspagina** heet.

## Melden vanuit een sjabloon

Als je steeds hetzelfde soort incident meldt — hetzelfde titelpatroon, dezelfde ernst, hetzelfde bereikbaarheidsbeleid — sla het dan één keer op als sjabloon.

Klik op **Maken op basis van sjabloon** (de omlijnde knop naast **Incident melden**) en er opent een modaal **Incident aanmaken op basis van sjabloon**, met een keuzelijst **Selecteer incidentsjabloon**. Kies een sjabloon en het aanmaakformulier opent vooraf ingevuld; je kunt nog steeds alles wijzigen voordat je verstuurt. Heeft je project nog geen sjablonen, dan krijg je in plaats daarvan een modaal **No Incident Templates**, met een knop **Create Template** die je naar **Incidenten → Instellingen → Incident-sjablonen** brengt.

Sjablonen worden gebouwd met hun eigen zesstapswizard — **Sjablooninformatie**, **Incidentdetails**, **Getroffen middelen**, **Bereikbaarheid**, **Eigenaren**, **Labels** — met deze velden:

| Veld                           | Doel                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| **Sjabloonnaam**               | Hoe het sjabloon in de kiezer wordt aangeduid.                |
| **Sjabloonbeschrijving**       | Een notitie aan je toekomstige zelf over wanneer je ernaar grijpt. |
| **Titel**                      | De titel die vooraf op het incident wordt ingevuld.           |
| **Beschrijving**               | Markdown-beschrijving die vooraf op het incident wordt ingevuld. |
| **Ernst van incident**         | Ernst die vooraf op het incident wordt ingevuld.              |
| **Initiële incidentstatus**    | De status waarin incidenten uit dit sjabloon beginnen.        |
| **Getroffen middelen**         | Monitoren, hosts, clusters en services om te koppelen.        |
| **Change Monitor Status to**   | Monitorstatus om toe te passen op de gekoppelde monitoren.    |
| **Bereikbaarheidsbeleid**      | Beleidsregels die worden uitgevoerd wanneer het incident wordt aangemaakt. |
| **Eigenaar - Teams**           | Teams die eigenaar zijn van incidenten uit dit sjabloon.      |
| **Eigenaar - Gebruikers**      | Gebruikers die eigenaar zijn van incidenten uit dit sjabloon. |
| **Labels**                     | Labels die op het incident worden toegepast.                  |

Een paar snelle regels:

- Sjablonen zijn niet bewerkbaar vanuit de sjabloonlijst — je maakt er een, en opent hem daarna om hem te wijzigen.
- Een sjabloon vult alleen een veld in dat je leeg hebt gelaten. Op de aanmaakpagina wordt het sjabloon toegepast als een voorinvulling die je kunt overschrijven; via de API vult de server een veld alleen uit het sjabloon wanneer het verzoek dat veld op `undefined` liet. Wat de aanroeper meestuurt wint altijd.

## Automatisch melden vanuit monitor-criteria

De meeste incidenten zouden geen mens moeten vereisen die ze intypt. Zet in de criteria-editor van een monitor de schakelaar **When filters match, declare an incident.** aan en er verschijnt een sectie **Create Incident** met een knop **Add Incident** — één criteriafilter kan meer dan één incident melden.

Elk item heeft:

- **Incidenttitel** — ondersteunt templating; de placeholder suggereert iets als `{{monitorName}} is down`.
- **Ernst** — verplicht.
- **Incidentbeschrijving** — ook getemplatet.
- **Bereikbaarheid → Bereikbaarheidsbeleid** — beleidsregels die worden uitgevoerd wanneer dit incident wordt aangemaakt.
- **Incidentrollen** — wijs teamleden vooraf toe aan rollen.
- **Ownership & Labels → Eigenaarsteams**, **Eigenaarsgebruikers**, **Labels**.
- **Advanced Options → Incident automatisch oplossen** (lost het incident automatisch op wanneer de criteria niet langer matchen), **Incident weergeven op statuspagina**, **Privé-incident** en **Herstelnotities**.

Voor de volledige lijst van `{{variable}}`-placeholders die je in de titel, beschrijving en herstelnotities kunt gebruiken, zie [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating).

Incidenten die zo worden aangemaakt worden door de server getagd: `isCreatedAutomatically` wordt gezet, `createdCriteriaId` legt vast welk criteriafilter afging, en `createdByProbe` legt vast welke probe het zag. Al het andere eraan gedraagt zich precies als bij een met de hand gemeld incident.

## Melden via de API

Het incidentmodel biedt een standaard CRUD-endpoint, dus `POST /api/incident` maakt er een aan. Authenticeer met een API-sleutel die je genereert bij **Projectinstellingen → API-sleutels**, verstuurd in de `apikey`-header — de sleutel identificeert het project, dus je hoeft geen project-id apart mee te geven.

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

Handige velden op de request body:

- `title` — het enige veld dat je echt moet meesturen.
- `declaredAt` — hier optioneel, ook al vereist het formulier het. Laat het weg en de server gebruikt de huidige tijd.
- `incidentSeverityId` en `currentIncidentStateId` — de server controleert of beide tot hetzelfde project behoren als de API-sleutel, en weigert het verzoek als dat niet zo is. Dezelfde controle geldt voor de monitorstatus achter **Change Monitor Status to**.
- `createdIncidentTemplateId` — pas een opgeslagen sjabloon toe. Elk veld dat je weglaat wordt uit het sjabloon gevuld; elk veld dat je meestuurt blijft zoals het is.

Verwante endpoints zijn `/api/incident-state`, `/api/incident-severity` en `/api/incident-state-timeline`. De gegenereerde [API-referentie](/reference) bevat de exacte request- en responsvormen voor elk daarvan, inclusief hoe relatievelden zoals monitoren worden uitgedrukt.

## Incidentnummers en voorvoegsels

Elk incident krijgt een volgnummer uit een teller per project, toegekend door de server bij aanmaak. Twee kolommen houden het vast: `incidentNumber` (het ruwe getal) en `incidentNumberWithPrefix` (wat je daadwerkelijk ziet). Zonder geconfigureerd voorvoegsel is de weergavewaarde `#42`.

Om dat te wijzigen, ga naar **Incidenten → Instellingen → Meer instellingen**. De kaart **Nummervoorvoegsel** heeft een veld **Voorvoegsel incidentnummer** (maximaal 20 tekens, placeholder `INC-`) — stel het in en hetzelfde incident verschijnt als `INC-42`. Laat het leeg om de standaard `#` te houden. De kaart bevat ook **Nummervoorvoegsel voor incident-episode** voor episodenummering.

Het nummer verschijnt als de eerste kolom van de incidentenlijst, linkt naar het incident, en duikt op als **Incidentnummer** op het **Overzicht** van het incident.

## Wat er gebeurt op het moment dat een incident wordt gemeld

De aanmaakaanroep doet meer dan een rij wegschrijven. Op volgorde:

1. **De server vult de gaten.** `declaredAt` valt terug op nu, de huidige status valt terug op de `isCreatedState`-status van het project, en het incidentnummer en het nummer met voorvoegsel worden toegekend vanuit de projectteller.
2. **Een sjabloon wordt toegepast**, als `createdIncidentTemplateId` is meegestuurd — waarbij alleen velden worden gevuld die de aanroeper op undefined liet.
3. **Privacyregels draaien**, en markeren het incident als privé wanneer een matchende regel dat zegt. Dit is de eerste regel-engine die draait, zodat alles daarna de juiste privacy-instelling ziet.
4. **Eigenaarsregels draaien**, en voegen de eigenaarsgebruikers en -teams toe die matchende regels noemen.
5. **Labelregels draaien**, en voegen labels toe die bij het incident passen.
6. **Bereikbaarheidsregels draaien.** Elke ingeschakelde regel bij **Incidenten → Regels → Bereikbaarheidsregels** waarvan de criteria matchen voegt zijn beleidsregels toe aan het incident. Er is geen prioriteitsvolgorde en geen short-circuit — alle matchende regels gaan af en de beleidsregels worden ontdubbeld.
7. **Runbook-regels draaien**, en koppelen en starten matchende runbooks. Zie [Runbooks](/docs/runbooks/index).
8. **Bereikbaarheidsbeleid wordt uitgevoerd.** Elk beleid op het incident — gekozen in de wizard, overgenomen uit een sjabloon, of toegevoegd door een regel — wordt parallel uitgevoerd met het eventtype `IncidentCreated`. Eén falend beleid stopt de andere niet.
9. **Abonnees worden in de wachtrij gezet**, als **Statuspagina-abonnees op de hoogte stellen** aan bleef en het incident zichtbaar is op de statuspagina. De bezorging wordt afgehandeld door een achtergrondtaak, niet inline met je verzoek.
10. **Workflows gaan af.** De trigger **On Create Incident** start elke workflow die erop is gebouwd. Zie [Workflows – Overzicht](/docs/workflows/index).

Vanaf daar is het incident live: het telt mee voor de badge **Actieve incidenten** in het zijmenu Incidenten (elke status zonder de vlag `isResolvedState` telt als actief), het verschijnt op de statuspagina's die een van zijn monitoren dragen, en zijn **Statustijdlijn** begint mee te schrijven.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe het incidentmodel in elkaar past.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat de statusvlaggen doen en hoe je er zelf toevoegt.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare notities, privénotities, eigenaren en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, rollen, regels en workflow-triggers.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie hoort over het incident dat je zojuist meldde.
- [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) — de variabelen die beschikbaar zijn voor automatisch gemelde incidenten.
