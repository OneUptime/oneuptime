# Notities, eigenaren en feed

Elk incident verzamelt tijdens het werken eraan een geschreven verslag. Een deel daarvan is voor je klanten — de update die om 02:14 op de statuspagina uitgaat en zegt dat je de foute deploy hebt gevonden. De rest is voor je team — de stacktrace die iemand plakte, de grafiek die eindelijk hout sneed, het besluit om te failoveren.

OneUptime houdt die twee doelgroepen uit elkaar. **Openbare notities** publiceren naar je statuspagina en kunnen abonnees op de hoogte stellen. **Privénotities** (het `IncidentInternalNote`-model) blijven binnen het dashboard. Onder beide ligt de **Incidentfeed**, een alleen-toevoegen-tijdlijn die alles vastlegt wat er met het incident gebeurde, en de lijst **Eigenaren**, die bepaalt wie het te horen krijgt.

Het hangt allemaal aan het linkerzijmenu van het incident: **Notities → Openbare notities**, **Notities → Privénotities**, en **Team → Eigenaren**. De feed staat op de pagina **Overzicht** van het incident.

## Openbare notities versus privénotities

De twee notitietypen zien er in het dashboard vergelijkbaar uit en gedragen zich heel verschillend.

- **Openbare notities** — het `IncidentPublicNote`-model, aan statuspagina's geserveerd als onderdeel van de incidenttijdlijn. Ze dragen een datum **Geplaatst op** die je zelf kunt instellen en een selectievakje **Statuspagina-abonnees op de hoogte stellen**.
- **Privénotities** — het `IncidentInternalNote`-model. Niets in de statuspagina-app leest ze. Ze hebben geen geplaatst-op-veld (de lijst wordt gestempeld en gesorteerd op `createdAt`) en helemaal geen abonneevelden, dus een privénotitie kan nooit een abonneemelding uitlokken.

**Wat "privé" werkelijk betekent.** Het betekent "niet gepubliceerd naar de statuspagina" — niet "beperkt tot een kleinere groep mensen". Beide notitietypen delen dezelfde leesrechten, dus iedereen die het incident kan lezen kan ook de privénotities lezen. Wil je beperken wie een incident überhaupt kan zien, gebruik dan de vlag **Privé-incident** (`isPrivate`) op het incident zelf, die het incident verbergt voor elke statuspagina en het beperkt tot de eigenaarsgebruikers van het incident, de leden van zijn eigenaarsteams, en projectbeheerders en -eigenaren.

**Eigenaren zien beide.** De taak voor eigenaarsmeldingen bevraagt openbare en privénotities samen. Een privénotitie is privé voor je abonnees, niet voor de mensen die reageren.

| Als je wilt…                                                       | Kies                 |
| ------------------------------------------------------------------ | -------------------- |
| Klanten vertellen wat je weet en wanneer je meer weet              | **Openbare notitie** |
| Een update terugdateren die je al ergens anders verstuurde         | **Openbare notitie** |
| Een hypothese, een uitgevoerd commando of een doodlopend spoor vastleggen | **Privénotitie** |
| Een heap dump of een screenshot van een intern dashboard toevoegen | **Privénotitie**     |

## Een openbare notitie plaatsen

Open **Notities → Openbare notities** in het zijmenu van het incident en maak een notitie aan. De kaart legt uit dat wat je hier schrijft op de statuspagina verschijnt; de lege staat meldt dat er tot nu toe geen openbare notities voor dit incident zijn aangemaakt.

| Veld                                              | Doel                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Openbare incidentnotitie**                      | De tekst, in Markdown. Verplicht. Het formulier herinnert je eraan dat de notitie zichtbaar is op je statuspagina en linkt een spiekbriefje. |
| **Bijlagen**                                      | Bestanden die met abonnees op de statuspagina worden gedeeld. Optioneel.                                      |
| **Statuspagina-abonnees op de hoogte stellen**    | Selectievakje, standaard aan. Zet het uit om stilletjes te publiceren.                                        |
| **Geplaatst op**                                  | Verplichte datum en tijd, standaard nu, weergegeven in je huidige tijdzone.                                   |

**Geplaatst op is het echte tijdstip van de notitie.** Statuspagina's sorteren en tonen openbare notities op `postedAt`, niet op wanneer je ze typte — dus als je de statuspagina bijwerkt met een update die je 40 minuten geleden verstuurde, zet **Geplaatst op** dan op wanneer het echt gebeurde. Komt een notitie via de API binnen zonder, dan stempelt OneUptime de huidige tijd.

De lijst toont wie elke notitie schreef, de **Geplaatst op**, de weergegeven Markdown met zijn bijlagen, en een kolom **Meldingsstatus abonnee**. Je kunt filteren op **Aangemaakt door**, **Notitie** en **Aangemaakt op**.

## Een privénotitie plaatsen

**Notities → Privénotities** is bewust soberder. Er zijn maar twee velden:

- **Privé-incidentnotitie** — Markdown-tekst, verplicht. Het formulier zegt ronduit dat dit privé is voor je team en niet zichtbaar op de statuspagina.
- **Bijlagen** — bestanden bedoeld voor het incidentresponsteam.

Geen **Geplaatst op**, geen abonneeselectievakje — de notitie wordt gestempeld wanneer hij wordt aangemaakt.

## Bijlagen bij notities

Beide notitietypen accepteren bestandsbijlagen via een veld **Bijlagen**, en beide tonen onder de notitietekst een bijlagelijst met per bestand een link **Download attachment**.

Waar ze uiteenlopen is wie het bestand kan ophalen:

- **Bijlagen bij openbare notities** zijn downloadbaar door bezoekers van de statuspagina via een statuspagina-route, samen met de notitie zelf.
- **Bijlagen bij privénotities** zijn alleen bereikbaar via de geauthenticeerde dashboard-API. Er is geen statuspagina-route voor.

Dat maakt bijlagen dezelfde openbaar/privé-beslissing als de notitietekst. Een klantgerichte tijdlijnafbeelding hoort bij een openbare notitie; een configuratiedump bij een privénotitie.

## Een notitie genereren met AI

Beide notitiepagina's hebben een knop **Generate with AI**. Die stuurt het incident naar de AI-provider van je project en zet de gegenereerde Markdown in de notitie-editor, waar je hem bewerkt voordat je opslaat — er wordt niets automatisch gepubliceerd.

- **Generate Public Note with AI** — beschreven als het analyseren van de incidentdata om een klantgerichte notitie te produceren. Sjablonen omvatten **Status Update** en **Resolution Notice**.
- **Generate Private Note with AI** — produceert in plaats daarvan een interne technische notitie. Sjablonen omvatten **Investigation Update** en **Technical Analysis**.

Achter de knop post het dashboard naar `/incident/generate-note-from-ai/{incidentId}` met het gekozen sjabloon en een notitietype van `public` of `internal`.

## Notitiesjablonen

Als je team elke storing dezelfde drie updates schrijft, sla ze dan één keer op. Beide notitiepagina's hebben een knop **Maken op basis van sjabloon** die een kiezer **Notitie aanmaken vanaf sjabloon** opent met een keuzelijst **Selecteer notitiesjabloon**.

Sjablonen worden gedeeld tussen openbare en privénotities: één sjabloonlijst bedient beide, en hetzelfde sjabloon kan in beide soorten notities worden ingevoegd.

Je beheert ze bij **Incidenten → Instellingen → Notitie-sjablonen** — de kaart heet **Public or Private Note Templates for Incidents** en het formulier heeft een stap **Sjablooninformatie** (**Sjabloonnaam** en **Sjabloonbeschrijving**, beide verplicht) en een stap **Notitiedetails** voor de tekst. Klik je op **Maken op basis van sjabloon** voordat je er een hebt aangemaakt, dan vertelt OneUptime je dat er nog geen bestaan; let op: het bericht wijst naar Projectinstellingen, maar de pagina staat feitelijk onder **Incidenten → Instellingen → Notitie-sjablonen**.

## Notities plaatsen vanuit Slack of Microsoft Teams

Heb je een werkruimte gekoppeld, dan hoeven responders het kanaal nooit te verlaten. Zowel Slack als Microsoft Teams biedt een notitie-toevoegen-actie die een modaal opent met een keuzelijst voor **Openbare notitie** of **Privénotitie** plus een tekstvak, en het resultaat direct op het incident schrijft.

Twee details die je moet weten:

- **Duplicaatbeveiliging** — elke notitie legt het Slack-bericht vast waar hij vandaan kwam (`postedFromSlackMessageId`, geformatteerd als `channel_id:message_ts`), dus meerdere mensen die op hetzelfde bericht reageren leveren één notitie op, geen vijf.
- **Notities weerkaatsen terug** — beide soorten notities plaatsen duwt ook een bericht in het gekoppelde incidentkanaal, omdat het feed-item van de notitie wordt aangemaakt met werkruimtemelding aan.

## Wanneer een openbare notitie abonnees daadwerkelijk bereikt

Een openbare notitie aanmaken met **Statuspagina-abonnees op de hoogte stellen** aan garandeert op zichzelf niet dat er een e-mail uitgaat. De notitie moet een keten van controles passeren, en elke mislukking legt een specifieke reden vast in plaats van een fout te geven:

1. **Statuspagina-abonnees op de hoogte stellen** moet aan staan. Zo niet, dan wordt de notitie op het moment van aanmaken als overgeslagen gestempeld.
2. De notitie moet bij een incident horen dat nog bestaat.
3. Het incident moet minstens één monitor gekoppeld hebben — zonder monitoren is er geen statuspagina-bron om de notitie naartoe te routeren.
4. De vlag **Zichtbaar op statuspagina** (`isVisibleOnStatusPage`) van het incident moet waar zijn.
5. Elke statuspagina die het incident bereikt moet **Incidenten weergeven** (`showIncidentsOnStatusPage`) aan hebben staan.
6. Elke abonnee moet door zijn eigen voorkeuren komen — niet afgemeld, en geabonneerd op deze bron en op het eventtype `Incident` waar de pagina abonnees laat kiezen.

**Meldingen zijn niet direct.** De taak die ze verstuurt draait eens per minuut, dus reken op ongeveer een minuut tussen het opslaan van de notitie en het vertrekken van de mail. Dat is wat het label **Sending Soon** betekent.

De kolom **Meldingsstatus abonnee** volgt de hele reis:

| Status                       | Betekenis                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| **Notifications skipped.**   | Een van de poorten hierboven ging dicht. De reden is vastgelegd. |
| **Sending Soon**             | In de wachtrij, wachtend op de volgende run van de verzendtaak. |
| **Notifications Being Sent** | De taak werkt de abonneelijst af.                             |
| **Notifications Sent**       | Elke abonneemelding is uitgegaan.                             |
| **Failed**                   | De taak wierp een fout; die is bij de notitie opgeslagen.     |

Klik op **meer details** bij de status om **Statusdetails van melding** te openen. Waar opnieuw versturen zinvol is, heet de knop in die modaal **Retry**, wat de notitie terugzet in de wachtstand zodat de volgende run hem opnieuw oppikt.

Het feitelijke bericht dat abonnees krijgen is per statuspagina en per kanaal getemplatet — e-mail, sms, Slack en Microsoft Teams hebben elk hun eigen sjabloon voor het event **Subscriber Incident Note Created**, met variabelen voor de naam en URL van de statuspagina, de detaillink, de getroffen middelen, de incidenternst en -titel, de notitietekst, en een afmeldlink per abonnee. Zie [Abonnees en aankondigingen](/docs/status-pages/subscribers) voor hoe die sjablonen en kanalen worden geconfigureerd.

## De incidentfeed

De kaart **Incidentfeed** staat onderaan de linkerkolom op de pagina **Overzicht** van het incident. Het is het verhaal van het incident op volgorde: elk item is een icoon, de avatar en naam van wie het veroorzaakte, een relatief tijdstip met de exacte lokale tijd bij hover, en een Markdown-tekst. Items zijn gesorteerd op oudste eerst.

Sommige items dragen extra detail — een eigenaarsmelding somt bijvoorbeeld iedereen op die gemaild is. Die tonen een knop **More Information** die een paneel **More Information** opent.

De kaartkop heeft ook een menu **Acties** zodat je kunt handelen zonder de tijdlijn te verlaten:

- **Execute Runbook** — start een [runbook](/docs/runbooks/index) tegen dit incident.
- **Bereikbaarheidsdienstbeleid uitvoeren** — page een beleid op aanvraag.
- **Add Public Note** — dezelfde vier velden als de pagina Openbare notities, in een modaal.
- **Privénotitie toevoegen** — alleen notitietekst en bijlagen.

Ernaast haalt **Vernieuwen** de feed opnieuw op.

**De feed is alleen-toevoegen, en het is niet je auditlogboek.** De API staat het aanmaken en lezen van feed-items toe, maar niet het bijwerken of verwijderen, dus niemand kan stilletjes de geschiedenis van een incident herschrijven. Permanent is het ook niet: op betaalde installaties worden feedrijen ouder dan drie jaar verwijderd. Voor een duurzaam verslag van wie wat veranderde, gebruik **Audit → Auditlogboeken** in het zijmenu van het incident.

## Wat de feed vastlegt

Feed-items worden geschreven door de incidentservice zelf, door beide notitieservices, door de statustijdlijn, door eigenaars- en lidmaatschapswijzigingen, door de regel-engines, door bereikbaarheidsuitvoering, door de AI-onderzoeks- en postmortem-runners, en door de meldings-cronjobs. De eventtypen omvatten:

- **Het incident zelf** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notities en verslagen** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Mensen** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Meldingen** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Elk type krijgt zijn eigen icoon, zodat je een lange feed kunt scannen en de statuswijzigingen uit het geroezemoes kunt pikken. Door AI gegenereerde hoofdoorzaakanalyse is duidelijk gemarkeerd en wordt in een beperkte Markdown-modus weergegeven.

Feeds respecteren incidentprivacy: voor privé-incidenten worden feedleesacties op dezelfde manier gefilterd als het incident zelf.

## Eigenaren

Eigenaren zijn de mensen en teams die verantwoordelijk zijn voor een incident. Zij zijn het meldingsdoel voor alles wat ermee gebeurt — en zij zijn de reden dat een incident niet onopgemerkt blijft terwijl iedereen aanneemt dat iemand anders eraan werkt.

Open **Team → Eigenaren** in het zijmenu van het incident. De kaart **Eigenaren** toont een tellerbadge en beschrijft eigenaren als de mensen en teams die verantwoordelijk zijn voor dit incident en die over wijzigingen bericht krijgen, met een lopende telling als "2 mensen · 1 team". Eigenaren verschijnen als overlappende avatars; over een avatar hoveren toont het e-mailadres van de persoon of markeert het item als **Team**.

- Klik op **Eigenaar toevoegen** om een kiezer met een zoekvak voor mensen of teams te openen.
- Klik op het verwijderbesturingselement op een avatar om de bevestiging **Eigenaar verwijderen** te openen, en daarna **Verwijderen**.
- Zijn er nog geen eigenaren, dan zegt de kaart dat en nodigt hij je uit een teamgenoot of een team toe te voegen zodat die bericht krijgen over wijzigingen.

Eigenaarsgebruikers en eigenaarsteams zijn aparte records — een team toevoegen maakt elk lid van dat team eigenaar voor meldingsdoeleinden zonder ze afzonderlijk op te sommen.

## Hoe eigenaren worden toegewezen

Er zijn vier routes naar de eigenarenlijst:

- **Vanuit een incident-sjabloon** — sjablonen dragen velden **Eigenaar - Teams** en **Eigenaar - Gebruikers**, beschreven als de teams en gebruikers die eigenaar zijn van het incident en die bericht krijgen wanneer het wordt aangemaakt of bijgewerkt. Een incident aanmaken vanuit het sjabloon vult ze vooraf in. Zie [Een incident melden](/docs/incidents/declaring-incidents).
- **Vanuit incident-eigenaarsregels** — matchende regels voegen bij het aanmaken automatisch eigenaren toe.
- **Bij aanmaak via de API** — eigenaarsgebruikers en -teams die met de aanmaakaanroep worden meegestuurd worden meteen toegevoegd, met een vlag die bepaalt of ze de "je bent toegevoegd"-e-mail krijgen.
- **Met de hand** — het besturingselement **Eigenaar toevoegen** op de pagina **Eigenaren**, op elk moment tijdens het incident.

Dezelfde persoon twee keer toevoegen is veilig; al toegewezen eigenaren worden niet gedupliceerd.

## Incident-eigenaarsregels

**Eigenaarsregels** wijzen automatisch eigenaarsgebruikers en -teams toe wanneer matchende incidenten worden aangemaakt — de routeringslaag die ervoor zorgt dat een database-incident bij het databaseteam belandt zonder dat iemand erover nadenkt. Je vindt ze bij de rest van de incidentautomatisering, behandeld in [Incidentinstellingen en automatisering](/docs/incidents/settings).

Het regelformulier heeft drie stappen — **Basisinformatie**, **Overeenkomstcriteria** en **Eigenaren** — en de eigenarenstap bevat twee secties:

- **Toe te wijzen eigenaren** — kies **Eigenaarsteams** en **Eigenaarsgebruikers**. Wanneer de regel matcht, wordt elke geselecteerde gebruiker en elk geselecteerd team als eigenaar toegevoegd, en al toegewezen eigenaren worden niet gedupliceerd.
- **Eigenaren overnemen** — wijs eigenaren toe vanuit gerelateerde entiteiten in plaats van ze te noemen. **Inherit Owners From Monitors** maakt elke eigenaar van de monitoren van het incident eigenaar van het incident, en **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** en **… From Services** doen hetzelfde voor die middelen.

Een schakelaar **Eigenaren op de hoogte stellen** bepaalt of mensen het te weten komen. Laat hem aan voor echte routering; zet hem uit om eigenaren stil toe te voegen — handig wanneer een regel een administratief gemak is in plaats van een page.

Elke regeluitvoering wordt naar de incidentfeed geschreven, zodat je altijd kunt zien of een persoon door een regel of door een mens is toegevoegd.

## Waar eigenaren bericht over krijgen

Vijf taken stellen eigenaren op de hoogte, elk eens per minuut draaiend:

- **Incident aangemaakt** — onderwerp `[New Incident {number}] - {title}`.
- **Er is een notitie geplaatst** — voor openbare *en* privénotities, onderwerp `[Update Incident {number}] - {title}`.
- **De incidentstatus is gewijzigd** — zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).
- **Je bent als eigenaar toegevoegd** — onderwerp `You have been added as the owner of Incident {number} - {title}`.
- **Nog onopgelost** — een herinnering gestuurd door het volgende-herinneringstijdstip van het incident, onderwerp `[Reminder] Incident {number} is still {state} - {title}`.

Elke melding wordt gebouwd voor e-mail, sms, spraakoproep, push en WhatsApp en overgedragen aan de meldingsinstellingen van de gebruiker, die bepalen wat er daadwerkelijk verstuurd wordt. Elke ontvanger kan elk van deze afzonderlijk uitzetten — de instellingen per gebruiker zijn geformuleerd als het je sturen van de meldingen over incident aangemaakt, notitie geplaatst, status gewijzigd, eigenaar toegevoegd, lid toegewezen, en de nog-open-herinnering. Iemand die alleen een telefoontje wil bij statuswijzigingen kan precies dat krijgen.

**Incidenten zonder eigenaar zijn niet stil.** Heeft een incident helemaal geen eigenaren, dan vallen de meldingstaken terug op de eigenaren van het project, zodat er niets op de grond valt. Elke persoon die bericht kreeg wordt ook toegevoegd aan het bijbehorende feed-item, zodat je achteraf precies kunt zien wie is ingelicht en op welk adres.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — wat een incident is en hoe de stukken in elkaar passen.
- [Een incident melden](/docs/incidents/declaring-incidents) — incidenten aanmaken met de hand, vanuit sjablonen, en vanuit monitoren.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de statusmachine die de helft van de feed stuurt.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — eigenaarsregels, notitiesjablonen, en de rest van de automatisering.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — waar openbare notities belanden en wie ze ontvangt.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — de klantgerichte kant van een incident.
