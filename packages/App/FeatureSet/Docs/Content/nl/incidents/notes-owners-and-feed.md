# Notities, eigenaren en feed

Elk incident verzamelt onderweg een geschreven verslag. Een deel daarvan is voor je klanten — de update die om 02:14 op de statuspagina verschijnt met de mededeling dat je de foute deploy hebt gevonden. De rest is voor je team — de stacktrace die iemand plakte, de grafiek waardoor het kwartje viel, het besluit om over te schakelen.

OneUptime houdt die twee publieken uit elkaar. **Openbare notities** verschijnen op je statuspagina en kunnen abonnees waarschuwen. **Privénotities** (het model `IncidentInternalNote`) blijven binnen het dashboard. Onder beide ligt de **Incidentfeed**, een alleen-toevoegen tijdlijn die alles vastlegt wat er met het incident gebeurde, en de lijst **Eigenaren**, die bepaalt wie het te horen krijgt.

Het staat allemaal in het linkerzijmenu van het incident: **Notities → Openbare notities**, **Notities → Privénotities** en **Team → Eigenaren**. De feed woont op de pagina **Overzicht** van het incident.

## Openbare notities versus privénotities

De twee notitietypen zien er in het dashboard vergelijkbaar uit en gedragen zich heel verschillend.

- **Openbare notities** — het model `IncidentPublicNote`, dat als onderdeel van de incidenttijdlijn aan statuspagina's wordt geserveerd. Ze dragen een datum **Geplaatst op** die je zelf kunt zetten en een vinkje **Statuspagina-abonnees op de hoogte stellen**.
- **Privénotities** — het model `IncidentInternalNote`. Niets in de statuspagina-app leest ze. Ze hebben geen geplaatst-op-veld (de lijst wordt gestempeld en gesorteerd op `createdAt`) en helemaal geen abonneevelden, dus een privénotitie kan nooit een abonneemelding uitlokken.

**Wat "privé" hier echt betekent.** Het betekent "niet gepubliceerd op de statuspagina" — niet "beperkt tot een kleinere groep mensen". Beide notitietypen delen dezelfde leesrechten, dus iedereen die het incident mag lezen mag ook de privénotities lezen. Wil je beperken wie een incident überhaupt ziet, gebruik dan de vlag **Privé-incident** (`isPrivate`) op het incident zelf, die het incident voor elke statuspagina verbergt en het beperkt tot de eigenaargebruikers van het incident, de leden van zijn eigenaarsteams, en projectbeheerders en -eigenaren.

**Eigenaren zien allebei.** De meldtaak voor eigenaren bevraagt openbare en privénotities samen. Een privénotitie is privé voor je abonnees, niet voor de mensen die de respons doen.

| Als je wilt…                                                | Kies                 |
| ----------------------------------------------------------- | -------------------- |
| Klanten vertellen wat je weet en wanneer je meer weet       | **Openbare notitie** |
| Een update terugdateren die je elders al had verstuurd      | **Openbare notitie** |
| Een hypothese, een gedraaid commando of een doodlopend spoor vastleggen | **Privénotitie** |
| Een heap dump of een screenshot van een intern dashboard bijvoegen | **Privénotitie** |

## Een openbare notitie plaatsen

Open **Notities → Openbare notities** in het zijmenu van het incident en maak een notitie aan. De kaart legt uit dat wat je hier schrijft op de statuspagina verschijnt; de lege staat meldt dat er voor dit incident nog geen openbare notities zijn aangemaakt.

| Veld                                            | Waarvoor                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Openbare incidentnotitie**                    | De tekst, in Markdown. Verplicht. Het formulier herinnert je eraan dat de notitie op je statuspagina zichtbaar is en linkt naar een spiekbriefje. |
| **Bijlagen**                                    | Bestanden die op de statuspagina met abonnees worden gedeeld. Optioneel.                                          |
| **Statuspagina-abonnees op de hoogte stellen**  | Vinkje, standaard aan. Zet het uit om stilletjes te publiceren.                                                    |
| **Geplaatst op**                                | Verplichte datum en tijd, standaard nu, getoond in je huidige tijdzone.                                            |

**Geplaatst op is het echte tijdstempel van de notitie.** Statuspagina's sorteren en tonen openbare notities op `postedAt`, niet op wanneer je ze typte — dus als je de statuspagina bijpraat over een update die je 40 minuten geleden stuurde, zet **Geplaatst op** dan op het moment waarop het echt gebeurde. Komt een notitie zonder tijdstempel via de API binnen, dan stempelt OneUptime de huidige tijd.

De lijst toont wie elke notitie schreef, de **Geplaatst op**, de gerenderde Markdown met de bijlagen, en een kolom **Meldingsstatus abonnee**. Je kunt filteren op **Aangemaakt door**, **Notitie** en **Aangemaakt op**.

## Een privénotitie plaatsen

**Notities → Privénotities** is bewust soberder. Er zijn maar twee velden:

- **Privé-incidentnotitie** — Markdown-tekst, verplicht. Het formulier zegt ronduit dat dit privé is voor je team en niet zichtbaar op de statuspagina.
- **Bijlagen** — bestanden bedoeld voor het incident-respondteam.

Geen **Geplaatst op**, geen abonneevinkje — de notitie wordt gestempeld op het moment dat hij wordt aangemaakt.

## Bijlagen bij notities

Beide notitietypen accepteren bestandsbijlagen via een veld **Bijlagen**, en beide tonen onder de notitietekst een bijlagenlijst met per bestand een link **Download attachment**.

Waar ze uiteenlopen is wie het bestand mag ophalen:

- **Bijlagen bij openbare notities** zijn via een statuspagina-route te downloaden door bezoekers van de statuspagina, samen met de notitie zelf.
- **Bijlagen bij privénotities** zijn alleen bereikbaar via de geauthenticeerde dashboard-API. Er is geen statuspagina-route voor.

Daarmee zijn bijlagen dezelfde openbaar-of-privé-keuze als de notitietekst. Een afbeelding voor de klanttijdlijn hoort bij een openbare notitie; een configdump bij een privénotitie.

## Een notitie met AI genereren

Beide notitiepagina's hebben een knop **Generate with AI**. Die stuurt het incident naar de AI-provider van je project en zet de gegenereerde Markdown in de notitie-editor, waar je hem bewerkt voordat je opslaat — er wordt niets automatisch gepubliceerd.

- **Generate Public Note with AI** — beschreven als het analyseren van de incidentgegevens om een notitie voor klanten te maken. Sjablonen zijn onder meer **Status Update** en **Resolution Notice**.
- **Generate Private Note with AI** — maakt in plaats daarvan een interne technische notitie. Sjablonen zijn onder meer **Investigation Update** en **Technical Analysis**.

Achter de knop post het dashboard naar `/incident/generate-note-from-ai/{incidentId}` met het gekozen sjabloon en een notitietype `public` of `internal`.

## Notitiesjablonen

Schrijft je team elke storing dezelfde drie updates, sla ze dan één keer op. Beide notitiepagina's hebben een knop **Maken op basis van sjabloon** die een kiezer **Notitie aanmaken vanaf sjabloon** opent met een keuzelijst **Selecteer notitiesjabloon**.

Sjablonen worden gedeeld tussen openbare en privénotities: één sjabloonlijst bedient beide, en hetzelfde sjabloon kan in elk van beide soorten notities worden ingevoegd.

Je beheert ze onder **Incidenten → Instellingen → Notitie-sjablonen** — de kaart heet **Public or Private Note Templates for Incidents** en het formulier heeft een stap **Sjablooninformatie** (**Sjabloonnaam** en **Sjabloonbeschrijving**, allebei verplicht) en een stap **Notitiedetails** voor de tekst. Klik je op **Maken op basis van sjabloon** voordat je er een hebt gemaakt, dan meldt OneUptime dat er nog geen bestaan; let op dat die melding naar Projectinstellingen wijst, terwijl de pagina in werkelijkheid onder **Incidenten → Instellingen → Notitie-sjablonen** staat.

## Notities plaatsen vanuit Slack of Microsoft Teams

Heb je een werkruimte gekoppeld, dan hoeven responders het kanaal nooit te verlaten. Zowel Slack als Microsoft Teams biedt een notitie-actie die een dialoog opent met een keuzelijst **Openbare notitie** of **Privénotitie** plus een tekstvak, en het resultaat rechtstreeks op het incident schrijft.

Twee details die het weten waard zijn:

- **Dubbelbescherming** — elke notitie legt vast uit welk Slack-bericht hij kwam (`postedFromSlackMessageId`, opgemaakt als `channel_id:message_ts`), zodat meerdere mensen die op hetzelfde bericht reageren één notitie opleveren en geen vijf.
- **Notities komen terug** — elk van beide soorten notities plaatsen duwt ook een bericht in het gekoppelde incidentkanaal, omdat het feed-item van de notitie met werkruimtemelding aan wordt aangemaakt.

## Wanneer een openbare notitie abonnees echt bereikt

Een openbare notitie aanmaken met **Statuspagina-abonnees op de hoogte stellen** aan garandeert op zichzelf nog geen e-mail. De notitie moet een reeks controles doorstaan, en elke afwijzing legt een specifieke reden vast in plaats van een fout te geven:

1. **Statuspagina-abonnees op de hoogte stellen** moet aan staan. Zo niet, dan wordt de notitie bij het aanmaken meteen als overgeslagen gestempeld.
2. De notitie moet bij een incident horen dat nog bestaat.
3. Aan het incident moet minstens één monitor hangen — zonder monitoren is er geen statuspagina-bron om de notitie naartoe te routeren.
4. De vlag **Zichtbaar op statuspagina** (`isVisibleOnStatusPage`) van het incident moet waar zijn.
5. Elke statuspagina die het incident bereikt moet **Incidenten weergeven** (`showIncidentsOnStatusPage`) aan hebben staan.
6. Elke abonnee moet door zijn eigen voorkeuren komen — niet uitgeschreven, en geabonneerd op deze bron en op het gebeurtenistype `Incident`, waar de pagina abonnees die keuze geeft.

**Meldingen zijn niet ogenblikkelijk.** De taak die ze verstuurt draait één keer per minuut, dus reken op tot ongeveer een minuut tussen het opslaan van de notitie en het vertrekken van de mail. Dat is wat het label **Sending Soon** betekent.

De kolom **Meldingsstatus abonnee** volgt de hele reis:

| Status                       | Wat het betekent                                                |
| ---------------------------- | --------------------------------------------------------------- |
| **Notifications skipped.**   | Een van de poorten hierboven ging dicht. De reden is vastgelegd. |
| **Sending Soon**             | In de wachtrij, wachtend op de volgende ronde van de verzendtaak. |
| **Notifications Being Sent** | De taak werkt de abonneelijst af.                                |
| **Notifications Sent**       | Elke abonneemelding is de deur uit.                              |
| **Failed**                   | De taak liep vast; de fout is bij de notitie opgeslagen.         |

Klik op **meer details** bij de status om **Statusdetails van melding** te openen. Waar opnieuw versturen zin heeft, heet de knop in die dialoog **Retry**, die de notitie terugzet op wachtend zodat de volgende ronde hem weer oppakt.

Het bericht dat abonnees daadwerkelijk krijgen wordt per statuspagina en per kanaal getemplatet — e-mail, sms, Slack en Microsoft Teams hebben elk hun eigen sjabloon voor de gebeurtenis **Subscriber Incident Note Created**, met variabelen voor de naam en URL van de statuspagina, de detaillink, de getroffen middelen, de incidenternst en -titel, de notitietekst, en een uitschrijflink per abonnee. Zie [Abonnees en aankondigingen](/docs/status-pages/subscribers) voor hoe die sjablonen en kanalen worden ingesteld.

## De incidentfeed

De kaart **Incidentfeed** staat onderaan de linkerkolom op de pagina **Overzicht** van het incident. Het is het verhaal van het incident op volgorde: elk item is een pictogram, de avatar en naam van wie het veroorzaakte, een relatief tijdstempel met de exacte lokale tijd bij hover, en een Markdown-tekst. Items staan oudste eerst.

Sommige items dragen extra detail — een eigenaarsmelding somt bijvoorbeeld iedereen op die mail kreeg. Die tonen een knop **More Information** die een paneel **More Information** opent.

De kaartkop heeft ook een menu **Acties**, zodat je kunt handelen zonder de tijdlijn te verlaten:

- **Execute Runbook** — start een [runbook](/docs/runbooks/index) op dit incident.
- **Bereikbaarheidsdienstbeleid uitvoeren** — een beleid op verzoek pagen.
- **Add Public Note** — dezelfde vier velden als de pagina Openbare notities, in een dialoog.
- **Privénotitie toevoegen** — alleen notitietekst en bijlagen.

Ernaast haalt **Vernieuwen** de feed opnieuw op.

**De feed is alleen-toevoegen, en het is niet je auditlogboek.** De API staat toe feed-items aan te maken en te lezen, maar niet bij te werken of te verwijderen, dus niemand kan stilletjes de geschiedenis van een incident herschrijven. Permanent is hij ook niet: op betaalde installaties worden feed-rijen ouder dan drie jaar verwijderd. Voor een duurzaam verslag van wie wat wijzigde gebruik je **Audit → Auditlogboeken** in het zijmenu van het incident.

## Wat de feed vastlegt

Feed-items worden geschreven door de incidentservice zelf, door beide notitieservices, door de statustijdlijn, door eigenaars- en lidmaatschapswijzigingen, door de regelmotoren, door bereikbaarheidsuitvoeringen, door de AI-onderzoeks- en postmortem-runners, en door de meldingscronjobs. De gebeurtenistypen omvatten:

- **Het incident zelf** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notities en terugblikken** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Mensen** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Meldingen** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisering** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Elk type krijgt zijn eigen pictogram, zodat je een lange feed kunt scannen en de statuswijzigingen uit het geroezemoes pikt. Door AI gegenereerde hoofdoorzaakanalyse wordt duidelijk gemarkeerd en in een beperkte Markdown-modus weergegeven.

Feeds respecteren incidentprivacy: bij privé-incidenten worden feed-leesacties op dezelfde manier gefilterd als het incident zelf.

## Eigenaren

Eigenaren zijn de mensen en teams die verantwoordelijk zijn voor een incident. Zij zijn het meldingsdoel voor alles wat ermee gebeurt — en zij zijn de reden dat een incident niet onopgemerkt blijft terwijl iedereen aanneemt dat iemand anders erop zit.

Open **Team → Eigenaren** in het zijmenu van het incident. De kaart **Eigenaren** toont een tellerbadge en omschrijft eigenaren als de mensen en teams die verantwoordelijk zijn voor dit incident en die bericht krijgen over wijzigingen, met een lopende telling als "2 mensen · 1 team". Eigenaren verschijnen als overlappende avatars; hover je over een avatar, dan zie je het e-mailadres van de persoon of de aanduiding **Team**.

- Klik op **Eigenaar toevoegen** om een kiezer met een zoekveld voor mensen of teams te openen.
- Klik op het verwijderelement op een avatar om de bevestiging **Eigenaar verwijderen** te openen en daarna op **Verwijderen**.
- Zijn er nog geen eigenaren, dan zegt de kaart dat en nodigt hij je uit een teamgenoot of een team toe te voegen, zodat ze bericht krijgen over wijzigingen.

Eigenaargebruikers en eigenaarsteams zijn aparte records — een team toevoegen maakt elk lid van dat team eigenaar voor meldingsdoeleinden zonder dat je ze stuk voor stuk opsomt.

## Hoe eigenaren worden toegewezen

Er zijn vier routes naar de eigenarenlijst:

- **Vanuit een incident-sjabloon** — sjablonen dragen velden **Eigenaar - Teams** en **Eigenaar - Gebruikers**, omschreven als de teams en gebruikers die het incident bezitten en bericht krijgen wanneer het wordt aangemaakt of bijgewerkt. Een incident uit het sjabloon aanmaken vult ze vooraf in. Zie [Een incident melden](/docs/incidents/declaring-incidents).
- **Vanuit eigenaarsregels voor incidenten** — matchende regels voegen bij het aanmaken automatisch eigenaren toe.
- **Bij het aanmaken via de API** — eigenaargebruikers en -teams die je met de aanmaakaanroep meestuurt worden meteen toegevoegd, met een vlag die bepaalt of ze de "je bent toegevoegd"-mail krijgen.
- **Met de hand** — het element **Eigenaar toevoegen** op de pagina **Eigenaren**, op elk moment tijdens het incident.

Dezelfde persoon twee keer toevoegen kan geen kwaad; al toegewezen eigenaren worden niet gedupliceerd.

## Eigenaarsregels voor incidenten

**Eigenaarsregels** wijzen automatisch eigenaargebruikers en -teams toe wanneer matchende incidenten worden aangemaakt — de routeerlaag die ervoor zorgt dat een database-incident bij het databaseteam belandt zonder dat iemand erover hoeft na te denken. Je vindt ze bij de rest van de incidentautomatisering, behandeld in [Incidentinstellingen en automatisering](/docs/incidents/settings).

Het regelformulier heeft drie stappen — **Basisinformatie**, **Overeenkomstcriteria** en **Eigenaren** — en de eigenarenstap bevat twee secties:

- **Toe te wijzen eigenaren** — kies **Eigenaarsteams** en **Eigenaarsgebruikers**. Wanneer de regel matcht, wordt elke geselecteerde gebruiker en elk geselecteerd team als eigenaar toegevoegd, en al toegewezen eigenaren worden niet gedupliceerd.
- **Eigenaren overnemen** — wijs eigenaren toe vanuit verwante entiteiten in plaats van ze te benoemen. **Inherit Owners From Monitors** maakt elke eigenaar van de monitoren van het incident ook eigenaar van het incident, en **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** en **… From Services** doen hetzelfde voor die middelen.

Een schakelaar **Eigenaren op de hoogte stellen** bepaalt of mensen het te horen krijgen. Laat hem aan voor echte routering; zet hem uit om stilletjes eigenaren toe te voegen — handig wanneer een regel administratief gemak is in plaats van een page.

Elke regeluitvoering wordt naar de incidentfeed geschreven, dus je kunt altijd zien of iemand door een regel of door een mens is toegevoegd.

## Waarover eigenaren bericht krijgen

Vijf taken stellen eigenaren op de hoogte, elk draaiend per minuut:

- **Incident aangemaakt** — onderwerp `[New Incident {number}] - {title}`.
- **Er is een notitie geplaatst** — voor openbare *en* privénotities, onderwerp `[Update Incident {number}] - {title}`.
- **De incidentstatus wijzigde** — zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).
- **Je bent als eigenaar toegevoegd** — onderwerp `You have been added as the owner of Incident {number} - {title}`.
- **Nog steeds onopgelost** — een herinnering gestuurd door het volgende herinneringsmoment van het incident, onderwerp `[Reminder] Incident {number} is still {state} - {title}`.

Elke melding wordt gebouwd voor e-mail, sms, telefoon, push en WhatsApp en overgedragen aan de meldingsinstellingen van de gebruiker, die bepalen wat er daadwerkelijk vertrekt. Elke ontvanger kan deze stuk voor stuk uitzetten — de instellingen per gebruiker zijn geformuleerd als het sturen van de meldingen voor incident aangemaakt, notitie geplaatst, status gewijzigd, eigenaar toegevoegd, lid toegewezen en de herinnering bij een openstaand incident. Wie alleen gebeld wil worden bij statuswijzigingen kan precies dat krijgen.

**Incidenten zonder eigenaar zijn niet stil.** Heeft een incident helemaal geen eigenaren, dan vallen de meldtaken terug op de eigenaren van het project, zodat er niets op de grond valt. Iedereen die bericht krijgt wordt ook aan het bijbehorende feed-item toegevoegd, zodat je achteraf precies ziet wie is geïnformeerd en op welk adres.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — wat een incident is en hoe de onderdelen samenhangen.
- [Een incident melden](/docs/incidents/declaring-incidents) — incidenten aanmaken met de hand, vanuit sjablonen en vanuit monitoren.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de statusmachine die de helft van de feed aanstuurt.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — eigenaarsregels, notitiesjablonen en de rest van de automatisering.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — waar openbare notities belanden en wie ze ontvangt.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — de kant van een incident die de klant ziet.
