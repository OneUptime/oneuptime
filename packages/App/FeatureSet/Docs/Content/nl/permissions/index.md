# Gebruikers, teams en machtigingen

Alles in OneUptime leeft binnen een **project**. Wie daarin wat mag, komt neer op drie dingen: de **gebruikers** erin, de **teams** waartoe die gebruikers behoren en de **machtigingen** die aan die teams zijn toegekend.

De ene regel die het meeste gedrag verklaart: **gebruikers hebben nooit rechtstreeks machtigingen.** De toegang van een gebruiker is de vereniging van de machtigingen van elk team waartoe hij in dat project behoort. Wilt u veranderen wat iemand mag, dan verandert u zijn teamlidmaatschap of de machtigingen van dat team.

**Eigenaren** zijn iets anders. Een eigenaar is degene die verantwoordelijk is voor één specifieke resource — een monitor, een incident, een dashboard. Eigenaren krijgen meldingen over hun resources, en machtigingen kunnen desgewenst worden ingeperkt tot "alleen wat van mij is".

## Het model in één oogopslag

```text
Project
  └── Team                       ← hier hangen de machtigingen
       ├── Toegestane rechten    ← elk met een bereik: Alle / Eigen / Labels
       ├── Geblokkeerde rechten  ← winnen altijd van toegestane rechten
       └── Teamleden             ← gebruikers die de uitnodiging accepteerden
```

| Begrip | Wat het is |
| --- | --- |
| Gebruiker | Eén OneUptime-account. Eén login, willekeurig veel projecten. |
| Project | De tenantgrens. Monitors, incidenten, teams en data horen bij precies één project. |
| Team | Een benoemde groep binnen een project die de machtigingen draagt. |
| Teamlid | Een gebruiker die voor een team is uitgenodigd en heeft geaccepteerd. |
| Machtiging | Eén mogelijkheid, bijv. `CreateProjectMonitor`, of een rol die er vele bundelt, bijv. `MonitorAdmin`. |
| Bereik | Hoe ver een toegestane machtiging reikt: alle resources, alleen eigen resources of alleen gelabelde. |
| Eigenaar | Een gebruiker of team dat als verantwoordelijke voor één specifieke resource is aangemerkt. |
| Label | Een markering die u op resources plaatst, gebruikt om machtigingen te beperken en om te ordenen. |

## Gebruikers

Een gebruikersaccount is globaal voor de OneUptime-installatie — dezelfde login werkt in elk project waarvoor de gebruiker is uitgenodigd.

Een gebruiker zit "in" een project zodra hij lid is van **minstens één team** erin. Er is geen aparte stap "gebruiker aan project toevoegen": iemand voor een project uitnodigen is iemand voor een team uitnodigen.

- Uitnodigingen maken een openstaand teamlid aan. De gebruiker telt pas als projectlid — en krijgt pas enige machtiging — **nadat hij de uitnodiging heeft geaccepteerd.**
- Een gebruiker uit alle teams van een project verwijderen ontneemt hem de toegang tot dat project.
- Wie een project verlaat, krijgt er geen meldingen meer van. Zijn eigen meldingsmethoden, -regels en -instellingen voor het project verdwijnen met zijn laatste team — e-mail, sms, oproep, WhatsApp, Telegram, push, webhook, Slack en Microsoft Teams, de e-mailsamenvatting en de nog niet verstuurde e-mail, het nummer voor inkomende oproepen en de dienstherinneringen —, zodat opnieuw lid worden met de standaardwaarden begint. Wat hem daarna nog noemt, zoals de gebruiker die een regel voor inkomende oproepen belt of een eigenaar die op een opgelost incident blijft staan, stuurt hem geen meldingen meer: namens een project wordt niets gestuurd naar iemand die er geen lid van is, en een openstaande uitnodiging is nog geen lidmaatschap. Op die plekken staat **Geen lid meer** naast de naam, zodat u er iemand anders kunt neerzetten. Bij iemand die is uitgenodigd en nog niet heeft geaccepteerd, staat in plaats daarvan **Uitnodiging nog niet geaccepteerd**. Als een override iemands meldingen doorstuurt naar iemand die het project heeft verlaten, wordt in plaats daarvan de persoon gealarmeerd voor wie de override geldt. Bij vertrek worden ook de MCP-clients losgekoppeld die de persoon met het project heeft verbonden, en zijn persoonlijke link naar de piketagenda toont vanaf dan een lege agenda. Op OneUptime Cloud bevestigt iemand die via de single sign-on van het project terugkomt dat opnieuw vanuit zijn mailbox.
- Als uw project SSO afdwingt en een gebruiker zich nog niet via de identityprovider heeft geauthenticeerd, geldt hij als niet-geautoriseerde SSO-gebruiker en ziet hij niets tot hij dat doet. Zie [SSO](/docs/identity/sso).
- Met SCIM ingesteld kan uw identityprovider gebruikers en hun teamlidmaatschappen automatisch aanmaken, bijwerken en verwijderen. Zie [SCIM](/docs/identity/scim).

Waar u het vindt: **Instellingen → Gebruikers** toont iedereen in het project met de status van de uitnodiging.

## Teams

Teams zijn de weg waarlangs machtigingen bij mensen terechtkomen. Elk nieuw project begint met drie:

| Team | Machtiging | Bewerkbaar |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nee. Heeft altijd minstens één lid. |
| Admin | `ProjectAdmin` | Nee |
| Members | `ProjectMember` | Ja — dit is een startpunt, wijzig het gerust |

De teams **Owners** en **Admin** zijn bewust vergrendeld: hun machtigingen zijn niet te bewerken en de teams kunnen niet worden verwijderd of hernoemd. Dat voorkomt dat een project zichzelf per ongeluk buitensluit. Het Owners-team moet altijd minstens één lid houden.

`ProjectOwner` is het hoogste toegangsniveau: facturatie, het project verwijderen en alles wat een beheerder kan. `ProjectAdmin` dekt alles behalve facturatie en het verwijderen van het project.

SMS, telefoonoproepen, WhatsApp of Telegram voor het project aan- of uitzetten valt onder facturatie, omdat elk bericht geld kost. Alleen `ProjectOwner`, de rol `BillingAdmin` (**Billing Admin**) en de machtiging `ManageProjectBilling` (**Manage Billing**) kunnen die schakelaars wijzigen, onder **Projectinstellingen > Meldingen > Meldingsinstellingen** — niet `ProjectAdmin`.

Het bijvullen van de vooruitbetaalde saldi van het project valt ook onder facturatie. Op OneUptime Cloud worden SMS, telefoonoproepen, WhatsApp en Telegram betaald uit het saldo onder **Projectinstellingen > Meldingen > Meldingsinstellingen**, en AI uit de AI-tegoeden onder **Projectinstellingen > AI > AI-tegoeden**. Alleen een projecteigenaar of iemand met **Manage Billing** kan ze bijvullen of hun **Automatisch bijvullen** wijzigen — een projectbeheerder niet. Een melding over een saldo dat opraakt, noemt wie het kan bijvullen, en alleen die mensen krijgen een werkende knop **Saldo bijvullen** of een link naar de pagina.

Maak zoveel extra teams als u wilt — "Frontend-piket", "Support", "Alleen-lezen auditors" — en geef elk de machtigingen die het nodig heeft.

Waar u het vindt: **Instellingen → Teams**. Open een team om bij **Members** en **Permissions** te komen; **Block Permissions** staan onder **More settings** onderaan de pagina Permissions.

## Machtigingen

Een machtiging is één mogelijkheid. Er zijn twee manieren om ze uit te delen, allebei op het tabblad **Permissions** van het team.

### Rollen

Een rol bundelt een heel productgebied op een van drie niveaus:

- **Admin** — wat de Member doet, plus de eigen configuratie van het gebied, zoals ernstniveaus en statussen van incidenten en waarschuwingen, monitorstatussen en onderhoudsstatussen.
- **Member** — het dagelijkse werk: de resources van het gebied aanmaken, wijzigen en verwijderen, met hun notities, eigenaars en sjablonen. Voor statuspagina's en piketdiensten doet de Member alles wat de Admin doet.
- **Viewer** — alleen lezen.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` enzovoort. Rollen zijn bijna altijd wat u wilt — ze blijven kloppen naarmate OneUptime functies toevoegt, omdat een nieuwe monitorgerelateerde tabel bij de bestaande monitorrollen wordt gevoegd in plaats van een nieuwe toekenning van u te vragen.

Workflows en runbooks zijn de uitzondering. Beide voeren code uit in je project — een workflow zijn stappen, een runbook zijn scripts op je Runners —, dus `WorkflowMember` opent workflows en hun uitvoeringen en voert ze met de hand uit, en `RunbookMember` opent runbooks en hun uitvoeringen en voert ze uit: het start een uitvoering, rondt de stappen af of slaat ze over en annuleert haar. Geen van beide maakt, wijzigt of verwijdert wat het uitvoert; `WorkflowAdmin` en `RunbookAdmin` bouwen het. Een rol voert alleen de runbooks uit die zijn bereik bereikt: een `RunbookMember` die beperkt is tot enkele labels voert de runbooks uit die ze dragen. Zie [Workflowconfiguratie](/docs/workflows/configuration) en [Runbookconfiguratie](/docs/runbooks/configuration).

De regels van een gebied (label-, eigenaar-, piket-, groeperings- en herinneringsregels), aangepaste velden, SLA's en geheimen zijn projectconfiguratie: daarvoor is `ProjectAdmin` nodig, welke gebiedsrol iemand ook heeft. Dat geldt ook voor API-sleutels, teams en hun machtigingen, labels, SSO en domeinen — de Settings-rollen zorgen voor de services, probes, infrastructuur en integraties van het project, niet voor wie wat mag.

Facturatie heeft drie eigen rollen. `BillingViewer` leest de facturatie van het project — het abonnement, facturen, gebruik, saldi, AI-tegoed, betaalmethoden en de factuurcontactgegevens — en wijzigt niets. `BillingMember` downloadt daarnaast facturen en wijzigt de factuurcontactgegevens. `BillingAdmin` doet wat `BillingMember` doet en zet sms, telefoongesprekken, WhatsApp en Telegram aan en uit. Het abonnement, betaalmethoden of saldi wijzigen en facturen betalen vraagt `ProjectOwner` of **Manage Billing**; op de facturatiepagina's zijn die knoppen voor alle anderen vergrendeld en staat erbij wie ze mag gebruiken.

Alle {{PERMISSION_ROLE_COUNT}} rollen staan in de [Machtigingsreferentie](/docs/permissions/reference).

### Granulaire machtigingen

Elke afzonderlijke mogelijkheid is ook los toe te kennen — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` en nog {{PERMISSION_TOTAL_COUNT}} andere. Gebruik deze wanneer een rol te breed is en u precies één ding wilt toekennen.

Een toestemming om iets te wijzigen of te verwijderen reikt alleen tot wat u ook mag lezen, dus geef de bijbehorende leestoestemming mee: `EditProjectIncident` wijzigt geen enkel incident zonder `ReadProjectIncident`. Een record dat via een ander record wordt gelezen, zoals een notitie bij een incident, heeft ook een toestemming nodig om dat andere record te lezen: `ReadIncidentInternalNote` bereikt geen enkele notitie zonder een toestemming om incidenten te lezen. De rollen bevatten beide al.

Het zijn ook de sleutels die u gebruikt bij het aanmaken van API-sleutels, en die de API en de Terraform-provider verwachten.

De volledige lijst staat in de [Machtigingsreferentie](/docs/permissions/reference).

### Toestaan en blokkeren

Elk team heeft twee lijsten:

- **Permissions** (toestaan) — wat dit team mag doen.
- **Block Permissions** — wat dit team nooit mag doen, ongeacht enige toestemming.

**Blokkeren wint altijd.** Een blokkade zonder labels haalt die mogelijkheid volledig weg bij het team. Een blokkade met labels haalt hem alleen weg voor resources met die labels — handig voor "dit team mag monitors bewerken, behalve de monitors met het label Production".

Een machtiging kan niet in beide lijsten tegelijk beperkingslabels dragen; OneUptime weigert de tweede met een uitleg.

De toestemmingen van een gebruiker tellen op over al zijn teams, maar een blokkade geldt voor alles wat de gebruiker doet: een blokkade zonder labels in het ene team haalt de mogelijkheid weg, ook als een ander team hem toestaat, en een blokkade geeft nooit iets. Heeft iemand minder toegang dan u verwacht, zoek dan in elk van zijn teams naar een blokkade; heeft hij meer, zoek dan in elk team naar een toestemming.

## Bereik: hoe ver een toegestane machtiging reikt

Elke toegestane machtiging krijgt een bereik, dat u kiest bij het toevoegen:

| Bereik | Betekenis |
| --- | --- |
| Alle resources in het project | De standaard. De machtiging geldt voor elke passende resource. |
| Eigendom van dit team of zijn leden | De machtiging geldt alleen voor resources waarbij dit team, of de handelende gebruiker, als eigenaar staat vermeld. |
| Beperken met labels (geavanceerd) | De machtiging geldt alleen voor resources met minstens één van de gekozen labels. |

**Eigen** is de eenvoudigste manier om een model van "je zorgt voor je eigen diensten" te bouwen: geef een team `MonitorAdmin` met bereik Eigen en maak dat team vervolgens eigenaar van de monitors waarvoor het verantwoordelijk is. Het perkt alleen resources in die daadwerkelijk eigenaren kunnen hebben — monitors, incidenten, dashboards, services en dergelijke. Projectconfiguratie (incidentstatussen, labels, de teams zelf) heeft geen eigenaar, dus daar gedraagt een rol met bereik Eigen zich gewoon normaal.

**Labels** is de handmatiger variant van hetzelfde idee: markeer resources en ken vervolgens machtigingen toe die tot die markeringen beperkt zijn.

Sommige rollen zijn per definitie projectbreed en bieden helemaal geen bereik, omdat ze inperken niets zou betekenen — "Billing Admin, maar alleen voor de facturatie die van mij is" beschrijft niets:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Eigenaren

Een eigenaar is een gebruiker of team dat aan één specifieke resource is gekoppeld. De meeste resources die iets voorstellen dat u beheert — monitors, incidenten, waarschuwingen, gepland onderhoud, piketregelingen, dashboards, services, statuspagina's, workflows, runbooks en SLO's — hebben een tabblad **Owners**.

Eigenaren doen twee dingen:

1. **Melden.** Eigenaren zijn degenen die OneUptime waarschuwt wanneer er iets met de resource gebeurt — een monitor valt uit, er wordt een incident aangemaakt, een SLO begint zijn foutbudget op te maken.
2. **Toegang, als u daarom vraagt.** Eigendom is waartegen het bereik Eigen wordt opgelost. Een gebruiker past als hij persoonlijk eigenaar is, of als een van zijn teams eigenaar is.

Eigendom op zich verleent niets. Eigenaar van een monitor zijn geeft geen bewerkrecht, tenzij een van uw teams ook een monitormachtiging heeft. Eigendom perkt toegang in; het verruimt die nooit.

## Labels

Labels zijn projectbrede markeringen die u aan resources hangt. Ze dienen twee doelen: filteren en groeperen in het dashboard, en het beperken van machtigingen zoals hierboven beschreven.

Aan een labelbeperking is voldaan als de resource **minstens één** van de labels van de machtiging draagt. Een resource zonder labels voldoet aan geen enkele labelbeperkte machtiging.

Een record zonder eigen labels, zoals de notitie bij een incident, een aankondiging op een statuspagina of een AI-inzicht over een service, draagt de labels van de records waar het bij hoort of over gaat. Een machtiging die tot labels is beperkt bereikt het als een van die records een van haar labels draagt, en een blokkade met labels neemt het weg als een van hen een geblokkeerd label draagt, bij lezen, wijzigen en verwijderen gelijk. Een record dat over geen van hen gaat, zoals een AI-inzicht over geen enkele service, hoort bij het project: een labelbeperking beperkt het niet, en een blokkade met labels neemt het niet weg.

Waar u het vindt: **Instellingen → Labels**.

## Telemetrie

Logs, traces, metrics, uitzonderingen, profielen en sessieherhalingen horen bij de resource die ze verstuurde: een dienst, een host, een Kubernetes-cluster, een monitor, een RUM-applicatie en dergelijke. Een telemetriemachtiging leest zo ver als haar bereik reikt:

- **Alle resources** leest de telemetrie van elke resource in het project.
- **Eigen** leest de telemetrie van de resources die u of een van uw teams bezit, en telemetrie die geen resource noemt.
- **Labels** leest de telemetrie van de resources die een van de labels van de machtiging dragen.

Een blokkade met labels op een telemetriemachtiging laat de telemetrie weg van de resources die die labels dragen, wat u verder ook hebt. Dat geldt overal waar telemetrie wordt gelezen: de verkenners met hun grafieken, filters en attribuutlijsten, exports, sessieherhalingen en wat de AI-assistent voor u leest. De lijst met metricnamen toont de metrics die een dienst meldt die u mag lezen, en de metrics die geen enkele dienst meldt, zoals host- en clustermetrics. Mag u ook de telemetrie van andere soorten resources lezen, zoals hosts of clusters, dan toont de lijst alle metricnamen.

Het verwijderen van telemetrie blijft bij dezelfde resources: een verwijdering bereikt de rijen van de resources die zowel uw toestemming om het signaal te lezen als uw toestemming om het te verwijderen bereiken, min de resources die een blokkade met labels op een van beide weghaalt, en gebeurt in één project tegelijk.

Monitorlogs, SLO-geschiedenis, netwerkstromen en Kubernetes-kostenverdelingen worden op dezelfde manier gelezen, via de monitor, de SLO, het netwerkapparaat of het cluster waar ze bij horen: Eigen en Labels bereiken de rijen van de records die u mag lezen, en een blokkade met labels laat de rijen weg van de records die die labels dragen. Het auditlogboek en de threat-intelligence-indicatoren worden projectbreed gelezen door wie ze mag lezen.

## API-sleutels

API-sleutels krijgen machtigingen rechtstreeks op de sleutel zelf — ze horen niet bij teams en worden niet beïnvloed door teamlidmaatschap.

- Ken dezelfde granulaire machtigingen en rollen toe die u aan een team zou geven.
- Sleutels ondersteunen **geblokkeerde machtigingen** en **labelbeperkingen**, net als teams.
- Sleutels ondersteunen het bereik Eigen **niet**. Eigendom wordt tegen een gebruiker opgelost en een sleutel is geen gebruiker; geef sleutels dus expliciet de toegang die ze nodig hebben.

Geef elke integratie een eigen sleutel met de smalste set machtigingen die werkt, zodat u er één kunt intrekken zonder de andere te verstoren.

Waar u het vindt: **Instellingen → API-sleutels**. Zie ook de [API-referentie](/docs/api-reference/api-reference).

## Hoe OneUptime bepaalt of een verzoek is toegestaan

Voor een ingelogde gebruiker, op volgorde:

1. Zoek de teams waartoe de gebruiker in dit project behoort, waarbij alleen geaccepteerde uitnodigingen meetellen. Een verzoek bereikt alleen de records van dit project: een record van een ander project, genoemd met zijn id of in een filter, wordt behandeld alsof het niet bestaat.
2. Verzamel elke machtigingsregel van die teams — toestaan en blokkeren, elk met labels en bereik.
3. Controleer eerst de blokkadelijst. Een blokkade zonder labels op een machtiging die de doeltabel voor deze bewerking accepteert, wijst het verzoek meteen af, in welk team die ook staat.
4. Controleer de toestaanlijst. Het verzoek heeft minstens één machtiging nodig die de doeltabel voor deze bewerking accepteert. Bij een operationele resource — een monitor, een incident, een dashboard en dergelijke — telt ook de bijpassende machtiging **All Operational Resources** (Create, Read, Edit of Delete), tenzij die zelf geblokkeerd is.
5. Pas het bereik toe. Toekenningen met bereik Eigen beperken de query tot resources in eigendom; die met labels beperken tot passende labels. Is een andere toekenning voor dezelfde bewerking breder, dan wint de bredere. Een record zonder eigen labels, zoals een notitie bij een incident, past bij een toekenning met labels als een van de records waar het bij hoort een van de labels van de toekenning draagt. Een **All Operational Resources**-toestemming die tot labels is beperkt, beperkt op dezelfde manier: ze bereikt de operationele resources die een van haar labels dragen, zoals de eigen toestemming van de resource met dezelfde labels zou doen.
6. Pas labelblokkades toe. Een blokkade met labels wijst het verzoek af als de doelresource er één draagt. Heeft een record geen eigen labels, zoals een notitie bij een incident of een aankondiging op een statuspagina, dan laat een blokkade met labels het record weg bij lezen, wijzigen en verwijderen als een record waar het bij hoort een van die labels draagt. Een lijst met records uit al uw projecten tegelijk, zoals de incidenten op uw startpagina, beperkt de records van elk project met uw blokkades en toekenningen in dat project. Een blokkade met labels op een **All Operational Resources**-toestemming haalt de resources met die labels weg uit wat die toestemming toekent.
7. Beperk wijzigingen en verwijderingen tot wat u mag lezen. Een wijziging of verwijdering wordt beperkt door uw leestoestemmingen en door de toestemming voor de wijziging: een record dat u niet mag lezen — buiten uw labels of eigenaren, of met een label dat een blokkade op lezen wegneemt — mag u ook niet wijzigen of verwijderen, en een blokkade zonder labels op het lezen van een soort record neemt ook het wijzigen en verwijderen ervan weg. Een record dat via een ander record wordt gelezen, zoals een notitie bij een incident of een aankondiging op een statuspagina, wordt alleen bereikt via een record dat u mag lezen: zonder toestemming om incidenten te lezen bereikt een toestemming voor notities geen enkele notitie, en een blokkade met labels op het lezen van incidenten laat de notities weg van de incidenten die ze dragen. Een wijziging of verwijdering van één record, genoemd bij zijn ID, die niets bereikt, krijgt hetzelfde antwoord als een record dat niet bestaat (`404`) wanneer u het niet mag lezen, en wordt geweigerd wanneer u het wel mag lezen maar niet mag wijzigen. Heeft uw toestemming om incidenten te lezen het bereik Eigen, dan bereikt een toestemming voor notities alleen de notities van de incidenten waarvan u of een van uw teams eigenaar is. Het lezen van één record bij zijn ID krijgt op dezelfde manier `404` als antwoord wanneer het record niet bestaat of u het niet mag lezen.

Elk veld van een record wordt gelezen met de eigen leesmachtiging van dat record: een machtiging voor een ander soort record opent het nooit. Sommige velden zijn bewust beperkter. Geheimen worden alleen gelezen door wie het record mag bewerken of beheren waar ze bij horen, zoals de sleutels voor inkomende verzoeken en inkomende e-mail van een monitor en zijn serveragentsleutel, of de webhook- en e-mailsleutels van een workflow. De opname van een sessieherhaling bekijken vraagt **Watch Session Replays**, niet alleen **List Session Replays**. Telemetrie wordt per signaal gelezen: **Read Telemetry Service Log** leest logs, **Read Telemetry Service Traces** leest traces en **Read Telemetry Service Metrics** leest metrics, metriekgrafieken inbegrepen.

Velden volgen dezelfde regel. Een blokkade zonder labels op de machtiging van een veld haalt dat veld weg, en bij een operationele resource opent de bijpassende machtiging **All Operational Resources** elk veld dat iedereen mag openen die het record mag lezen of wijzigen — maar niet een veld dat bewust beperkter is, zoals een geheime sleutel.

Dezelfde regel beslist over al het andere dat vraagt of u een machtiging heeft: acties die geen gewone lees- of schrijfactie zijn — sms-, bel- of AI-tegoed toevoegen, een factuur betalen of een meldingsregel testen — en de knoppen die OneUptime toont. Een knop die u niet mag gebruiken wordt vergrendeld getoond en zegt waarom; is een blokkade in een van uw teams de reden, dan noemt hij de geblokkeerde machtiging.

Live-updates volgen dezelfde regel. Wordt een record aangemaakt, gewijzigd of verwijderd, dan meldt OneUptime dat aan de geopende pagina's van de mensen die dat record mogen lezen, en aan niemand anders. Wat beperkt wat u mag lezen, beperkt ook uw live-updates: labels, eigenaren, een blokkade met labels, een privé-incident of het AI-gesprek van iemand anders. Neemt een wijziging u de toegang tot een record af, bijvoorbeeld doordat het privé wordt gemaakt, dan krijgen uw geopende pagina's daar ook bericht van, zodat ze het niet meer tonen. Een wijziging van uw machtigingen, een blokkade of het verlies van uw rechten als master-admin bereikt uw geopende pagina's meteen.

Live-updates eindigen ook met de aanmelding waarmee ze zijn gestart. Afmelden, uw wachtwoord wijzigen of geblokkeerd worden stopt de live-updates van uw geopende pagina's meteen. Een geopende pagina vernieuwt haar aanmelding elke 15 minuten en hervat daarna haar live-updates; lukt het vernieuwen niet, dan brengt ze u naar de aanmeldpagina. Een project dat SSO vereist, stuurt live-updates alleen naar pagina's die met SSO zijn aangemeld, net als voor al het andere.

Elke ingelogde gebruiker heeft daarnaast een kleine set automatische machtigingen voor zaken als het lezen van zijn eigen profiel en zijn eigen meldingsregels. Dat zijn geen beheerdersrechten en ze ontsluiten niemand anders' gegevens.

Opgeloste machtigingen worden per gebruiker en project gecachet en vernieuwd wanneer teamlidmaatschap of teammachtigingen wijzigen. Ziet een gebruiker een wijziging niet meteen, laat hem dan herladen.

## Recepten

**Een team dat alleen meekijkt.** Maak het team en voeg de rol `Viewer` toe, of de `*Viewer`-rollen per gebied voor precies de gebieden die het mag zien.

**Piketengineers die hun eigen diensten beheren.** Geef het team `MonitorAdmin`, `IncidentMember` en `OnCallMember` met bereik **Eigen** en voeg het team toe als eigenaar van de monitors die het draait.

**Externen uit de productie houden.** Geef het team de nodige rollen met bereik **Alle** en voeg daarna een **geblokkeerde machtiging** toe voor de gevoelige mogelijkheden, beperkt tot het label `Production`.

**Een CI-pijplijn die alleen deploys meldt.** Maak een API-sleutel met precies de granulaire machtigingen die nodig zijn — geen rollen.

**Iemand die de facturatie niet mag wijzigen en geen facturen mag zien.** Geef hem `ProjectMember`, niet `ProjectAdmin`: een projectbeheerder kan het abonnement, betaalmethoden en saldi niet wijzigen, maar leest en downloadt wel facturen. Wil je dat iemand de facturatiepagina's leest zonder iets te wijzigen, geef hem dan `BillingViewer`.

## Verder

- [Machtigingsreferentie](/docs/permissions/reference) — elke rol en elke granulaire machtiging, gegenereerd uit de OneUptime-broncode.
- [SSO](/docs/identity/sso) en [SCIM](/docs/identity/scim) — authenticatie en automatische gebruikersinrichting.
- [API-referentie](/docs/api-reference/api-reference) — machtigingen gebruiken vanaf de API.
