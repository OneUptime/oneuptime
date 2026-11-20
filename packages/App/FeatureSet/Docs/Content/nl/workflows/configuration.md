# Workflow-configuratie en veiligheid

Wat je moet weten voordat je een workflow op echt verkeer loslaat: hoe je hem veilig inschakelt, wie wat mag doen, hoe geheimen en URL's privé blijven, wat de stappen van een workflow mogen wijzigen en binnen welke limieten elke uitvoering werkt.

:::cards
- [Live gaan](#een-workflow-aan-of-uitzetten): Test met Workflow uitvoeren terwijl hij uit staat, en zet hem daarna aan.
- [Machtigingen](#machtigingen): De workflowrollen, en de losse machtigingen erachter.
- [Wat stappen mogen](#wat-workflowstappen-mogen): Stappen handelen als Projectbeheerder van het project van de workflow.
- [Limieten](#planlimieten): Uitvoeringen per abonnement, de duur van een uitvoering en aanroepen tussen workflows.
:::

## Een workflow aan- of uitzetten

Elke workflow heeft een schakelaar **Ingeschakeld** bovenaan de **Bouwer** en op de pagina **Overzicht**. Staat hij uit, dan is zijn trigger gepauzeerd — webhook-aanroepen, binnenkomende e-mail, geplande tijden, OneUptime-gebeurtenissen en de **Andere workflow uitvoeren**-stappen van andere workflows starten hem niet. **Workflow uitvoeren** en **Run just this step** wel: een uitvoering die je zelf start terwijl de workflow uit staat, is een **Testrun**. Nieuwe workflows beginnen uitgeschakeld.

Gebruik deze schakelaar als je «klaar voor gebruik»-sein:

:::steps
1. Bouw de workflow.
2. Klik op **Workflow uitvoeren** in de **Bouwer** met realistische waarden, terwijl de workflow nog uit staat. De uitvoering is een **Testrun**: elk blok draait echt, dus richt het eerst op een testkanaal of een testrecord.
3. Open de uitvoering en controleer of elk blok ging waar je verwachtte. Zie [Uitvoeringen](/docs/workflows/runs-and-logs).
4. Zet **Ingeschakeld** aan als hij klaar is: vanaf dan gaat zijn trigger af bij echte gebeurtenissen.
:::

Een workflow uitzetten voorkomt dat zijn trigger nieuwe uitvoeringen start. Een uitvoering die al loopt, maakt haar werk af, maar een uitvoering die zijn trigger startte en die op een **Pauze**-blok wacht, wordt bij het ontwaken geannuleerd. Testruns gaan door. Om er meerdere tegelijk aan of uit te zetten, selecteer je ze in de lijst **Workflows** en kies je **Inschakelen** of **Uitschakelen** onder **Bulkacties**.

## Een workflow archiveren

Archiveer een workflow die je niet meer nodig hebt maar wilt bewaren. Een gearchiveerde workflow:

- **Draait nooit**, door geen enkele trigger. Handmatige uitvoeringen en **Run just this step**, webhook-aanroepen, schema's, OneUptime-gebeurtenissen, binnenkomende e-mail en **Andere workflow uitvoeren**-stappen van andere workflows worden allemaal geweigerd. Een webhook-aanroep van een gearchiveerde workflow krijgt een fout die zegt dat de workflow gearchiveerd is.
- **Stopt wachtende uitvoeringen.** Een uitvoering die in een **Pauze**-stap slaapt, wordt bij het ontwaken geannuleerd, en een uitvoering die in de wachtrij stond maar nog niet was gestart, eindigt met "Workflow was archived before this run started, so it did not run."
- **Verdwijnt uit de lijst met workflows.** Je vindt hem onder **Workflows → Geavanceerd → Gearchiveerd**.
- **Houdt alles.** Zijn stappen, variabelen, eigenaren, labels en uitvoeringsgeschiedenis blijven zoals ze waren.

Om één workflow te archiveren, open je hem, ga je naar **Instellingen** en klik je op **Archiveren**. Om er meerdere te archiveren, selecteer je ze in de lijst **Workflows** en kies je **Archiveren**.

Om een workflow terug te halen, open je **Workflows → Geavanceerd → Gearchiveerd**, selecteer je hem en kies je **Uit het archief halen**, of open je hem en klik je op **Uit het archief halen** in de banner bovenaan zijn pagina's.

Archiveren en de schakelaar **Ingeschakeld** staan los van elkaar. Archiveren raakt de schakelaar niet aan, dus een workflow die aan stond, draait weer zodra hij uit het archief komt, en een die uit stond, blijft uit. De pagina **Gearchiveerd** toont in de kolom **Na uit het archief halen** welke welke is.

Een geëxporteerde workflow neemt zijn gearchiveerde toestand nooit mee, dus een geïmporteerde kopie is nooit gearchiveerd.

## Eigenaren en labels

| Wat                         | Waar                                                       | Wat het doet                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eigenaren**               | De pagina **Eigenaren** van de workflow                    | De gebruikers en teams die verantwoordelijk zijn voor de workflow. Een rol die beperkt is tot wat het eigen team bezit, bereikt de workflows van dat team. |
| **Labels**                  | De pagina **Overzicht** van de workflow                    | Labels om workflows te groeperen, per team, integratie of omgeving. Filter de lijst **Workflows** op label, en beperk een rol tot bepaalde labels.   |
| **Labelregels**             | **Workflows → Instellingen → Labelregels**                 | Label nieuwe workflows automatisch, op basis van patronen in hun naam of beschrijving.                                                              |
| **Eigenaarsregels**         | **Workflows → Instellingen → Eigenaarsregels**             | Wijs automatisch eigenaren toe aan nieuwe workflows.                                                                                                 |

Zie [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules) voor hoe de regels matchen.

## Geheimen

Markeer een variabele als **geheim** als ze iets gevoeligs bevat: haar waarde wordt dan weggepoetst uit de logboeken van uitvoeringen en de stappensporen. Geen enkele variabelewaarde kan na het opslaan worden teruggelezen, geheim of niet, niet in het dashboard en niet via de API, en een variabele die geheim is geworden, blijft geheim.

Gebruik geheime variabelen voor:

- API-sleutels van externe diensten.
- Authenticatietokens.
- Ondertekeningssleutels voor webhooks.
- Alles wat je niet wilt laten zien aan iemand met alleen leestoegang.

Plak geen geheim rechtstreeks in een blok — waarden zoals `Authorization: Bearer eyJh...` worden dan zichtbaar in de workflow en de logboeken. Gebruik in plaats daarvan `{{global.variables.MY_SECRET}}`.

Is het geheim een OAuth-toegangstoken dat verloopt, maak de variabele dan een [OAuth 2.0-variabele](/docs/workflows/variables#oauth-20-variabelen-tokens-die-zichzelf-vernieuwen). OneUptime haalt het token dan op bij je identiteitsprovider en vernieuwt het telkens als een workflow op het punt staat een verlopen token te gebruiken. OAuth 2.0-variabelen zijn altijd geheim, en hun inloggegevens zijn versleuteld in de database.

## Workflows exporteren en importeren

Je kunt een workflow als JSON-bestand verplaatsen tussen projecten, of tussen een zelf gehoste installatie en OneUptime Cloud.

:::tabs
@tab Exporteren
Open de workflow, ga naar **Instellingen** en klik op **Workflow exporteren**. Om meerdere workflows in één bestand te zetten, selecteer je ze in de lijst **Workflows** en kies je **JSON exporteren**.
@tab Importeren
Klik in de lijst **Workflows** op **JSON importeren** en kies een bestand dat is geëxporteerd uit een willekeurig OneUptime-project. Een workflow waarvan het project de naam al heeft, wordt geïmporteerd met "(Imported)" achter de naam.
:::

Het bestand bevat de naam, de beschrijving, de inschakelstatus en de graaf van de workflow. Het bevat bewust niet:

- **De geheime sleutel van de webhook.** Bij het aanmaken van de workflow wordt een nieuwe gegenereerd, dus een geïmporteerde workflow heeft een andere webhook-URL — kopieer die uit de Webhook-trigger van de nieuwe workflow. Alles wat het origineel aanriep, moet worden omgezet.
- **Het adres voor binnenkomende e-mail.** Een geïmporteerde workflow met een Inkomende e-mail-trigger krijgt een eigen adres — kopieer het uit de trigger van de nieuwe workflow. Alles wat het origineel mailde, moet het nieuwe adres krijgen.
- **Globale variabelen.** Een blok dat `{{global.variables.MY_SECRET}}` leest, houdt die verwijzing, maar de waarde staat niet in het bestand. Maak de variabelen aan in het doelproject voordat je de geïmporteerde workflow uitvoert.
- **Eigenaren en labels.** De label- en eigenaarsregels van je project worden op de geïmporteerde workflow toegepast, net alsof je hem met de hand had gemaakt.

Een geïmporteerde workflow wordt altijd **uitgeschakeld** aangemaakt, ook als hij ingeschakeld was waar hij vandaan kwam — zijn graaf kan verwijzen naar monitoren, bereikbaarheidsbeleid of andere workflows die in het doelproject niet bestaan. Bekijk hem, test hem met **Workflow uitvoeren** en zet hem daarna aan. Een workflow dupliceren werkt hetzelfde, zodat een kopie nooit naast het origineel gaat afgaan voordat je hem hebt bewerkt.

Omdat de graaf ongewijzigd meereist, reist alles wat rechtstreeks in een blok is getypt mee. Dat is de praktische reden om inloggegevens in geheime variabelen te bewaren: wie een workflow met een hardgecodeerd token exporteert, geeft dat token aan iedereen die het bestand krijgt.

## Webhookbeveiliging

Webhook-triggers geven je een unieke URL. Iedereen die de URL kent, kan hem aanroepen. Om je te beschermen tegen per ongeluk of ongewenst aanroepen:

- Behandel de URL als een wachtwoord. Deel hem niet openbaar en zet hem niet in een openbare repository. De Webhook-trigger verbergt de geheime sleutel van de URL totdat je op **Tonen** klikt, en **URL kopiëren** kopieert de URL zonder hem te tonen.
- Lekt de URL uit, klik dan op de Webhook-trigger in de **Bouwer** en daarna op **URL opnieuw instellen**. De workflow krijgt een nieuwe URL en de oude werkt meteen niet meer.
- Zegt de trigger dat zijn URL eindigt op de ID van de workflow, stel hem dan opnieuw in. Workflows die zijn gemaakt voordat webhook-URL's een eigen geheime sleutel hadden, gebruiken in plaats daarvan de ID van de workflow, en iedereen die de workflow kan openen, kan die zien.
- Vraag bij gevoelige workflows het aanroepende systeem om een gedeeld token in een header mee te sturen (zoals `X-Webhook-Token`) en controleer dat met een **Als / Anders**-blok voordat er iets belangrijks gebeurt. Sla het verwachte token op als geheime variabele.
- Kies bij heel gevoelige workflows liever een OneUptime-gebeurtenistrigger en een handmatige importstap dan een openbare webhook.

Alleen mensen die de workflow mogen bewerken — **Projecteigenaar**, **Projectbeheerder**, **Workflowbeheerder** of **Edit Workflow** — kunnen de webhook-URL zien of opnieuw instellen. Iedereen met de URL kan de workflow vanaf elke plek starten, zonder in te loggen, dus alle anderen zien een notitie die zegt wie ze kunnen vragen. Dat geldt ook voor een **Workflowlid**, die de workflow handmatig uitvoert vanuit de **Bouwer**.

## Beveiliging van binnenkomende e-mail

De Inkomende e-mail-trigger geeft de workflow een eigen adres, en iedereen die het adres kent, kan ernaar mailen. Het deel vóór de `@` is de geheime sleutel van de workflow, dus behandel het adres als een wachtwoord:

- Publiceer het niet en zet het niet in een openbare repository. De trigger verbergt de sleutel totdat je op **Tonen** klikt, en **Adres kopiëren** kopieert het adres zonder het te tonen.
- Lekt het adres uit, klik dan op de Inkomende e-mail-trigger in de **Bouwer** en daarna op **Adres opnieuw instellen**. De workflow krijgt een nieuw adres, en e-mail naar het oude wordt vanaf dan genegeerd.
- Iedereen kan elke willekeurige afzender op een e-mail zetten, dus **Van** bewijst niet wie hem stuurde. Controleer met een **Als / Anders**-blok iets wat alleen de echte afzender weet — een token in het onderwerp of in een header — voordat een workflow iets belangrijks doet. Sla het verwachte token op als geheime variabele.
- De sleutel wordt afgeschermd in alles wat de uitvoering ontvangt — **Aan**, **CC**, de headers en de bodies —, omdat het logboek van de uitvoering zichtbaar is voor iedereen die de uitvoeringen van de workflow kan lezen.

Alleen mensen die de workflow mogen bewerken — **Projecteigenaar**, **Projectbeheerder**, **Workflowbeheerder** of **Edit Workflow** — kunnen het adres zien of opnieuw instellen. Alle anderen zien een notitie die zegt wie ze kunnen vragen.

## Uitgaande netwerktoegang

API-blokken en andere HTTP-blokken doen hun verzoeken vanuit OneUptime, en het IRC-blok maakt vanuit OneUptime verbinding met de poort van de IRC-server. Host je zelf, zorg er dan voor dat je installatie de diensten kan bereiken die je aanroept. Gebruik je OneUptime Cloud, dan staan onze uitgaande IP-bereiken in [IP-adressen](/docs/configuration/ip-addresses), zodat je ze aan de andere kant kunt toestaan.

Welke adressen een blok mag bereiken, hangt af van het blok:

| Blokken                                                    | Loopback, link-local, cloudmetadata                                           | Privénetwerkadressen                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **API**- en **Mattermost**-blokken, en verzoeken van **Eigen JavaScript uitvoeren** | Geweigerd, tenzij de exacte host in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` staat | Geweigerd, tenzij een beheerder van een zelf gehoste installatie ze toestaat met `ALLOW_PRIVATE_NETWORK_WEBHOOKS` of `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **E-mail versturen**, **IRC** en OAuth 2.0-token-URL's           | Geweigerd                                                                     | Geweigerd in OneUptime Cloud. Toegestaan op een zelf gehoste installatie, tenzij `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` `true` is         |
| Slack, Microsoft Teams, Discord en Telegram                | Geweigerd                                                                     | Geweigerd: elk stuurt alleen naar de adressen van de eigen dienst                                                                         |

Zie [Toegang tot privénetwerken](/docs/self-hosted/private-network-access) voor hoe een beheerder van een zelf gehoste installatie ze openzet.

## AI-componenten

**Tekst genereren met AI** stuurt één verzoek naar een LLM: de standaard-LLM-provider van het project, of de globale provider van de installatie als het project er geen heeft. Stel providers in onder **Projectinstellingen → AI → LLM-providers**, en zet nooit de API-sleutel van een provider of een eigen endpoint in een workflow.

Wat de provider ontvangt, en wat het model ermee kan:

- **Alleen wat jij in het blok zet.** OneUptime stuurt een vaste veiligheidsinstructie en daarna de **Systeeminstructies**, de **Prompt** en de **Context** van het blok, met hun verwijzingen ingevuld. **Context** komt als laatste, na een markering, en de veiligheidsinstructie vertelt het model dat alles na de markering onbetrouwbare gegevens zijn, ook tekst die op instructies lijkt.
- **Verder niets.** De gegevens van de trigger, de geschiedenis van de workflow, de uitvoer van andere blokken, projectrecords, telemetrie en geheimen worden nooit meegestuurd. Ze verlaten OneUptime alleen als je er in een van die drie instellingen naar verwijst.
- **Tekst, en geen tools.** Het model kan OneUptime niet opvragen, geen HTTP-verzoeken doen en geen gegevens wijzigen. Extra parameters van een provider laten alleen een toegestane lijst van velden voor het afstemmen van de generatie door: ze kunnen de berichten niet vervangen, geen tools, webzoekfuncties of andere gegevensbronnen toevoegen, niets anders dan tekst of meerdere antwoorden vragen, niet streamen, de provider het verzoek niet laten bewaren en de uitvoerlimiet van het blok niet verhogen. Velden die OneUptime niet kent, worden weggegooid.
- **Het model kiest je beheerder.** Moet de generatie offline blijven, kies dan een model dat aan de kant van de provider niets uit zichzelf ophaalt.

Wat er wordt gelogd:

- Het logboek van de uitvoering schermt de **Systeeminstructies**, de **Prompt**, de **Context** en de **Antwoord** van het blok af. Latere blokken kunnen ze tijdens de uitvoering wel gebruiken, en een blok waarin je er een invoegt, logt het volgens zijn eigen regels, dus wie er een invoegt, kiest ervoor het daar te tonen.
- De provider, het model, het aantal tokens, de **LLM-logboek-ID** en een veilige foutmelding blijven zichtbaar, voor beheer en facturering. De ruwe fout van een provider blijft uit elk logboek, omdat een provider daarin het verzoek kan herhalen.
- Elke aanroep staat onder **Projectinstellingen → AI → AI-logboeken** met provider, model, status, tokens, kosten en facturering, zonder de prompt, het antwoord of de ruwe fout.

Wat het blok nodig heeft, en wat het kost:

- **AI inschakelen** moet aan staan, onder **Projectinstellingen → AI → AI-functies**. In OneUptime Cloud heeft het project bovendien het abonnement Growth of hoger en een betaald abonnement nodig. Zelf gehoste installaties zonder facturering hebben geen abonnementsdrempel.
- Aanroepen via een betaalde globale provider gebruiken de AI-tegoeden van het project.
- Elke aanroep telt mee voor de [eigen dagelijkse AI-limieten van het project](/docs/ai/ai-sre#de-eigen-daglimieten-van-het-project), als een Projecteigenaar die instelt. Is een limiet bereikt, dan neemt het blok **Fout** zonder het model te benaderen, tot middernacht UTC.

| Limiet                                                       | Waarde                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Systeeminstructies**, **Prompt** en **Context** samen     | 50.000 tekens                                                             |
| **Temperatuur**                                              | Van `0` tot `1`                                                           |
| **Maximaal aantal uitvoertokens**                                    | Van `1` tot `4096`, standaard `1024`                                      |
| Eén verzoek                                                  | Eén poging, hooguit 60 seconden                                           |
| Gelijktijdige aanroepen                                      | 3 per project. Meer nemen **Fout**, en een latere uitvoering kan het opnieuw proberen. |

Fouten in validatie, configuratie, toegang, limieten, tegoed, gelijktijdigheid, provider en time-out nemen allemaal het pad **Fout**, met de reden in **Fout**. Sluit dat pad aan voordat de workflow live gaat.

> [!WARNING]
> Elke waarde waarnaar je verwijst, zijn gegevens die je naar de provider stuurt. Zet geen geheime variabele in de prompt of de context, tenzij de provider is goedgekeurd om haar te ontvangen. Een zelf gehoste lokale provider zoals Ollama houdt verzoeken binnen je eigen infrastructuur; een gehoste provider ontvangt ze onder zijn eigen voorwaarden voor gegevensverwerking.

## Machtigingen

Workflows volgen het rolgebaseerde toegangsbeheer van je project. De drie workflowrollen:

- **Workflowbeheerder** — bouwt workflows: maakt ze, wijzigt ze, voert ze uit en verwijdert ze, en beheert de variabelen die ze gebruiken.
- **Workflowlid** — gebruikt ze: opent workflows en hun uitvoeringen, en voert een workflow handmatig uit met **Workflow uitvoeren**. Een member kan een workflow niet maken, wijzigen of verwijderen, en ook geen losse stap ervan uitvoeren. De **Bouwer** toont hun een workflow zoals hij is, gemarkeerd met **Alleen bekijken**: een stap opent om te lezen, en niets wat ze daar doen wordt opgeslagen.
- **Workflowkijker** — leest workflows en hun uitvoeringen.

**Projecteigenaar** en **Projectbeheerder** kunnen alles wat een Workflowbeheerder kan. **Projectlid** kan workflows maken en verwijderen, maar ze niet wijzigen of uitvoeren.

De losse machtigingen, voor een team of een API-sleutel die precies één ding nodig heeft:

- **Create / Read / Edit / Delete Workflow** — de basismachtigingen op de workflow zelf. Een workflow wijzigen, inclusief hem aan- of uitzetten en archiveren, vereist **Edit Workflow**; **Delete Workflow** verwijdert alleen.
- **Edit Workflow** — is ook wat nodig is om één stap los uit te voeren met **Run just this step**, en om de webhook-URL en het adres voor binnenkomende e-mail van een workflow te zien of opnieuw in te stellen. Een hele workflow handmatig uitvoeren vereist **Edit Workflow**, **Workflowbeheerder** of **Workflowlid**.
- **Read Workflow Log** — nodig om uitvoeringen te bekijken.
- **Create / Read / Edit / Delete Workflow Variables** — globale en workflow-variabelen beheren.

Een handmatige uitvoering bereikt alleen workflows die je kunt openen: een rol die beperkt is tot bepaalde labels, of tot de workflows die je team bezit, voert alleen die uit. Wie een workflow niet kan uitvoeren, ziet **Workflow uitvoeren** grijs, met de reden in de tooltip.

Een workflow die draait als **Projecteigenaar** of als een aangepaste rol, wordt alleen gewijzigd en met de hand uitgevoerd door mensen die die machtigingen zelf hebben; alle anderen kunnen hem in de **Bouwer** alleen bekijken. Zie [Uitvoeren als](#uitvoeren-als).

Geef **Workflowbeheerder** aan de mensen die automatisering bouwen, en **Workflowlid** aan de mensen die haar alleen starten. Bewaar bewerkrechten op variabelen voor de mensen die de geheimen van je project beheren. Zie [Gebruikers, teams en machtigingen](/docs/permissions/index) voor hoe rollen worden toegekend.

## Wat workflowstappen mogen

De stappen die OneUptime-records lezen en wijzigen — de componenten Find, Create, Update en Delete, en de triggers On Create, On Update, On Create or Update en On Delete — handelen als **Projectbeheerder** van het project van de workflow. Wie de workflow ook bouwde, een stap krijgt dezelfde controles als een Projectbeheerder in het dashboard en de API:

- **Alleen het eigen project van de workflow.** Een stap leest en schrijft de records van het project waartoe de workflow behoort en van geen ander, en een Update verplaatst een record nooit naar een ander project.
- **Alleen wat een Project Admin mag.** Een stap kan niet doen wat alleen **Projecteigenaar** en factuur- of projectverwijderingsmachtigingen toestaan, en hij kan niet lezen wie een sonde of een AI-agent heeft gemaakt; dat zien alleen Projecteigenaren.
- **Niet wie toegang heeft.** Met de standaardmachtigingen maakt, wijzigt of verwijdert een stap geen teams, teamleden, teammachtigingen of aangepaste rollen, ook al mag een Projectbeheerder dat. Wie een workflow bouwt, bepaalt wat zijn stappen doen, en dat kan een **Projectlid** zijn, dus een stap die het kon, zou zijn bouwer toegang geven die hij niet heeft gekregen, zoals **Projectbeheerder**. De stap wordt geweigerd, en het logboek van de uitvoering noemt de machtiging die de wijziging vraagt en zegt dat je **Uitvoeren als** kiest in de **Instellingen** van de workflow: een workflow die draait als **Projecteigenaar**, of als een aangepaste rol met die machtiging, mag de wijziging doen (zie [Uitvoeren als](#uitvoeren-als)). Geen stap van een workflow wijzigt API-sleutels, single sign-on of SCIM-instellingen, ongeacht waarmee de workflow draait. Triggers en Find-stappen op deze records werken nog steeds.
- **Niet het lezen van instellingen met inloggegevens.** Een Projectbeheerder mag SMTP-servers, aanbieders voor bellen en sms, SNMP-inloggegevens, videogesprekverbindingen en API-sleutels lezen, maar dat wordt nooit aan een stap uitgeleend, wie de workflow ook bouwde of opsloeg. Een stap kan geen van deze instellingen noemen, zoals de SMTP-server waarmee een statuspagina e-mail verstuurt of de API-sleutel waaraan een machtiging wordt verleend. De stap wordt geweigerd, en zijn uitvoeringslog zegt dat iemand die ze mag lezen (de leesmachtiging van dat soort instelling, of een Projecteigenaar of Projectbeheerder) de wijziging moet doen. Een stap die de instelling houdt die een record al noemt, of haar leegmaakt, wordt niet geweigerd.
- **Geen privé-incidenten, -waarschuwingen en -episodes.** Een Projectbeheerder ziet elk privé-incident, elke privé-waarschuwing en -episode, maar dat wordt nooit aan een stap uitgeleend, wie de workflow ook heeft gebouwd of opgeslagen. Een stap vindt geen privérecord, wijzigt er geen en voegt er niets aan toe, en een workflow start niet op zo'n record of op iets dat erbij hoort, of een gebeurtenis van een record of **Workflow uitvoeren** hem nu start. Wie een workflow bouwt, bepaalt waar wat de stappen lezen naartoe gaat — een webhook, een e-mail, een chat, het uitvoeringslogboek — en dat kan een **Projectlid** zijn dat een privérecord niet mag zien. Zie [Privé-incidenten, -waarschuwingen en -episodes](/docs/permissions/index#privé-incidenten-waarschuwingen-en-episodes).
- **Alleen wat je abonnement bevat.** In OneUptime Cloud wordt een stap die iets aanmaakt of wijzigt wat je abonnement niet bevat, geweigerd met het abonnement dat nodig is, net als in het dashboard. Zelf gehoste installaties zonder facturering hebben geen abonnementslimieten.
- **Niets wat OneUptime voor zichzelf houdt.** Dit wordt iedereen geweigerd, workflows inbegrepen:
  - een feedvermelding bewerken of verwijderen (de feeds van incidenten, waarschuwingen, episodes, monitoren, bereikbaarheidsbeleid en gepland onderhoud);
  - een meldingslogboek schrijven (de logboeken van sms, oproepen, e-mail, WhatsApp, Telegram, pushmeldingen, webhooks en werkruimteberichten);
  - waarden die OneUptime zelf instelt als er dingen gebeuren: of de CNAME van een eigen domein is geverifieerd, de beschermingsschakelaars van een team (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), welke incidentrol de primaire is en of die kan worden verwijderd, of een eigenaar of lid is gewaarschuwd, tijden en aantallen van herinneringen, wie nu en hierna dienst heeft in een rooster, de voortgang van een bereikbaarheidsuitvoering, de huidige burn rate en het error budget van een SLO, een monitor die is gepauzeerd door een incident of een onderhoudsgebeurtenis, het wachtwoordresettoken en de laatste aanmelding van een privégebruiker van een statuspagina, de gegevens die een dienst over zichzelf meldt (versie, runtime, cloud), en de laatste uitvoering van een detectieregel of een dreigingsfeed;
  - een incident melden vanuit een sjabloon door `createdIncidentTemplateId` naar **Incident aanmaken (één record)** te sturen — kies in plaats daarvan het sjabloon onder de instelling **Incidentsjabloon** van de stap: de stap meldt het incident dan vanuit dat sjabloon, als Projectbeheerder, en legt het sjabloon vast;
  - wijzigen bij welk record een record hoort nadat het is aangemaakt, zoals de monitor waarvoor een eigenaarsrij geldt of het incident waarbij een notitie staat.
- **Als niemand.** Een record dat een workflow aanmaakt, noemt geen maker, en het auditlogboek noemt de workflow, met zijn naam van dat moment, als degene die de wijziging deed.

Weigert een controle een stap, dan neemt de stap zijn uitgang **Fout** zonder de geweigerde wijziging te doen, en het logboek van de uitvoering noemt de stap en de reden in gewone woorden, bijvoorbeeld *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Lees het onder de [Uitvoeringen](/docs/workflows/runs-and-logs) van de workflow. Een Create Many-stap maakt zijn records één voor één aan en stopt bij het eerste dat wordt geweigerd: de records die daarvoor zijn aangemaakt, blijven bestaan.

Stappen die met andere systemen praten — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code en Generate Text with AI — lezen of wijzigen geen OneUptime-records, dus hier verandert voor hen niets.

### Uitvoeren als

Standaard draait een workflow met de machtigingen hierboven, en de meeste workflows hebben nooit meer nodig. Heeft er een wel meer nodig, bijvoorbeeld een workflow die elk nieuw team een aangepaste rol geeft, open dan de **Instellingen** ervan, daarna **Meer instellingen**, en kies **"Uitvoeren als" wijzigen**:

- Standaard: de machtigingen hierboven.
- Projecteigenaar: wat een **Projecteigenaar** in dit project mag, inclusief wijzigen wie in een team zit en wat een team mag. Alleen een Projecteigenaar kan dit kiezen.
- Een aangepaste rol: precies wat een van de aangepaste rollen van het project toestaat. Alleen iemand die die rol aan een team zou kunnen geven, kan hem kiezen.

Waarmee de workflow ook draait, een stap leest nooit instellingen met inloggegevens, ziet nooit privé-incidenten, -waarschuwingen of -episodes en wijzigt nooit API-sleutels, single sign-on of SCIM-instellingen. Als hij een team een machtiging of een rol geeft, kan hij alleen geven wat hij zelf heeft, en als hem iets ontbreekt, noemt het logboek van de uitvoering de machtiging.

Een workflow die met meer dan de standaardmachtigingen draait, draait met de machtigingen van wie ze heeft gegeven: de persoon of de API-sleutel van het project die als laatste de instelling **Uitvoeren als** ervan koos, of de stappen of variabelen ervan opsloeg. Zodat niemand er meer mee krijgt dan hij zelf heeft:

- Alleen mensen die die machtigingen hebben, kunnen de workflow of zijn variabelen wijzigen, hem archiveren of verwijderen, hem of een van zijn stappen met de hand uitvoeren, of zijn webhook-URL en inkomende e-mailadres zien. Iedereen die hem mag bewerken, kan hem nog steeds uitschakelen. Gaat hij met meer dan de standaardmachtigingen draaien, of verandert waarmee hij draait, dan krijgt hij een nieuwe webhook-URL en een nieuw inkomend e-mailadres, zodat kopieën van de oude hem niet meer starten.
- Een persoon of een van de API-sleutels van het project kan ze geven, en alleen wat die zelf heeft: de machtigingen van een sleutel, met zijn aangepaste rollen, worden gewogen zoals die van een persoon. De stappen van een workflow en de master-API-sleutel kunnen ze niet geven, en een sleutel opnieuw instellen vraagt elke machtiging die de sleutel heeft.
- Elke uitvoering controleert eerst of wie ze gaf ze nog heeft: een persoon die nog in het project zit, of een sleutel die nog bestaat, niet verlopen is en ze niet kwijt is. Zo niet, dan stopt de uitvoering vóór de eerste stap, en het logboek zegt waarom en wie ze opnieuw kan geven.
- Hij leest de globale variabelen van het project niet, die iedereen kan wijzigen die workflowvariabelen mag bewerken.
- De stap **Andere workflow uitvoeren** van een andere workflow kan hem alleen starten als die workflow met dezelfde of meer machtigingen draait.

Een geëxporteerde, geïmporteerde of gedupliceerde workflow draait met de standaardmachtigingen, waarmee het origineel ook draaide: iemand die meer heeft, kiest de instelling **Uitvoeren als** ervan opnieuw.

Elke uitvoering legt vast waarmee ze draaide en met wiens machtigingen, te zien in het venster van de uitvoering en in een gedownload logboek. Het [auditlogboek](/docs/configuration/audit-logs) legt vast wie de instelling **Uitvoeren als** van een workflow heeft gewijzigd, een persoon of een API-sleutel bij naam, en elke wijziging die een stap van een workflow maakt, zegt waarmee de stap draaide en met wiens machtigingen. De filters **Workflow uitgevoerd als** en **Machtigingen van de workflow gegeven door** van het auditlogboek vinden die wijzigingen.

Een aangepaste rol verwijderen waarmee workflows draaien, zou ze stoppen, dus het verwijderen somt ze op en vraagt waarmee ze voortaan draaien: **Standaardmachtigingen** of een andere aangepaste rol die u een team zou kunnen geven. Wie geen workflows mag bewerken, kan de rol pas verwijderen als hun instelling "Uitvoeren als" is gewijzigd. Via de API wordt het verwijderen van zo'n rol geweigerd, tenzij het verzoek zegt waarmee ze in plaats daarvan draaien: `miscDataProps` met `workflowsRunAs` op `Default`, of op `CustomRole` met de id van de rol in `workflowsRunAsCustomRoleId`. Zet in Terraform `workflows_run_as_on_delete` op de `oneuptime_custom_role`, en `workflows_run_as_custom_role_id_on_delete` voor een andere rol, en pas dat toe voordat u de rol vernietigt. Voeg met de CLI `--workflows-run-as Default`, of `--workflows-run-as CustomRole` met `--workflows-run-as-custom-role-id`, toe aan `oneuptime custom-role delete`. De pagina van de rol somt de workflows die met haar draaien op onder **Workflows die als deze rol draaien**.

## Planlimieten

In OneUptime Cloud hebben workflows het abonnement Growth of hoger nodig, en elk abonnement staat een aantal uitvoeringen per 30 dagen toe:

| Abonnement | Uitvoeringen in de laatste 30 dagen |
| ---------- | ----------------------------------- |
| Growth     | 500                                 |
| Scale      | 2.000                               |
| Enterprise | Geen praktische limiet              |

Het venster schuift mee: elke uitvoering die het project vastlegt, handmatig of door een trigger, telt 30 dagen mee. Bij de abonnementen Growth en Scale toont de pagina **Workflows** een kaart **Workflow-uitvoeringen** met hoeveel het project er heeft gebruikt. Is de limiet bereikt, dan worden nieuwe uitvoeringen vastgelegd met de status **Uitvoering overschrijdt huidig abonnement** en niet uitgevoerd, en hetzelfde gebeurt zolang het abonnement niet is betaald. Zelf gehoste installaties zonder facturering hebben geen limiet. Bij een abonnement dat geen workflows uitvoert, zeggen de **Bouwer** en de pagina **Workflows** dat, met een link om te upgraden.

## Hoe lang een run mag duren

| Limiet                                                       | Standaard          | Instelling bij zelf hosten      |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Een uitvoering, vanaf de start of vanaf het ontwaken na een **Pauze** | 2 minuten  | `WORKFLOW_TIMEOUT_IN_MS`        |
| Een **Eigen JavaScript uitvoeren**-blok                           | 5 seconden         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Een **Pauze**-blok                                           | Hooguit 30 dagen   | —                               |

De uitvoerder controleert de deadline vóór en na elk blok en markeert een uitvoering die te laat is als **Time-out** zodra hij weer aan zet is. Hij kan een blok niet halverwege onderbreken, dus blokken die op het netwerk wachten, hebben eigen tijdslimieten: een verzoek van Generate Text with AI geeft het na hooguit 60 seconden op, en een OAuth 2.0-tokenverzoek na 20. Wachten op een **Pauze**-blok telt niet mee voor de tijd van een uitvoering: de uitvoering wordt opzijgezet en krijgt bij het ontwaken weer 2 verse minuten.

## Limiet op het aanroepen van andere workflows

Met het component **Andere workflow uitvoeren** kan de ene workflow een andere starten. Om lussen te voorkomen waarin workflow A B start, die A weer start, wordt een keten van workflows die elkaar starten geweigerd als die zou terugkeren naar een workflow die er al in zit, of dieper zou gaan dan 10 workflows. Het **Andere workflow uitvoeren**-blok neemt dan zijn uitgang **Fout**, en de fout toont de keten.

Heb je echt een lange keten nodig (zoals een taak die per uitvoering één item verwerkt), dan is het meestal eenvoudiger om binnen één workflow een lus te maken met **Eigen JavaScript uitvoeren**.

## Wanneer workflows niet het juiste gereedschap zijn

Een paar gevallen waarin je beter iets anders kunt gebruiken:

- **Zware berekeningen of grote datasets** — workflows zijn bedoeld voor licht koppelwerk, niet voor rekenwerk. Voer zwaar werk uit in je eigen infrastructuur en laat een workflow het starten.
- **Langlopend actief rekenwerk** — een uitvoering heeft standaard 2 minuten. Gebruik voor passief wachten zoals «doe A, wacht twee uur, doe B» het component **Pauze**; dat zet de uitvoering opzij en hervat haar later zonder een worker bezet te houden.
- **Stapsgewijze incidentrespons met mensen erbij** — daarvoor zijn [Runbooks](/docs/runbooks/index). Workflows zijn voor automatisering zonder toezicht.

## Volgende stappen

:::cards
- [Workflows – Overzicht](/docs/workflows/index): Het grote geheel, en een eerste workflow van begin tot eind.
- [Componenten](/docs/workflows/components): Wat elk blok nodig heeft, teruggeeft en mag bereiken.
- [Runbooks](/docs/runbooks/index): Als mensen onderweg de beslissingen moeten nemen.
:::
