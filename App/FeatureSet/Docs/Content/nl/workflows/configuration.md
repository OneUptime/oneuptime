# Workflow-configuratie en veiligheid

Deze pagina behandelt de instellingen en veiligheidslimieten die het waard zijn om te kennen voordat je een workflow op echt verkeer richt.

## Een workflow aan- of uitzetten

Elke workflow heeft een schakelaar **Ingeschakeld** in **Instellingen**. Als hij uit staat, draait de workflow niet — webhookaanroepen, geplande tijdstippen en OneUptime-gebeurtenissen worden allemaal genegeerd. Nieuwe workflows starten uitgeschakeld.

Gebruik deze schakelaar als je "klaar om te gaan"-poort:

1. Bouw de workflow.
2. Klik op **Workflow uitvoeren** in de **Bouwer** met realistische waarden.
3. Bekijk de **Logboeken** — zorg dat elk blok deed wat je verwachtte.
4. Zet **Ingeschakeld** aan.

Een workflow uitzetten stopt runs die al bezig zijn niet; het zorgt er alleen voor dat er geen nieuwe starten.

## Eigenaren en labels

- **Eigenaren** — gebruikers en teams die als eigenaar vermeld staan, krijgen toegang tot de workflow en kunnen zich aanmelden voor meldingen wanneer hij mislukt. Stel ze in onder **Instellingen → Eigenaren**.
- **Labels** — tags om workflows te groeperen. In de workflowlijst kun je filteren op label, wat een druk project een stuk makkelijker doorzoekbaar maakt. Handig wanneer je workflows hebt georganiseerd per team, integratie of omgeving.
- **Labelregels** — onder **Workflows → Instellingen → Labelregels** worden automatisch labels toegepast op nieuwe workflows op basis van naam- of beschrijvingspatronen.
- **Eigenaarsregels** — onder **Workflows → Instellingen → Eigenaarsregels** worden automatisch eigenaren toegewezen aan nieuwe workflows.

## Geheimen

Markeer een globale variabele als **secret** als hij iets gevoeligs bevat. De waarde wordt verborgen bij normale API- en UI-leesacties nadat je hem hebt opgeslagen, en workflow-logging schoont de herleide waarde op voordat het runlogboek wordt opgeslagen.

Gebruik secret-variabelen voor:

- API-sleutels voor externe diensten.
- Authenticatietokens.
- Webhook-ondertekeningssleutels.
- Alles wat je niet zou willen dat iemand met alleen-lezen-toegang kan zien.

Plak een geheim niet rechtstreeks in een blok — waarden zoals `Authorization: Bearer eyJh...` komen dan zichtbaar terecht in de workflow en de logboeken. Gebruik in plaats daarvan `{{global.variables.MY_SECRET}}`.

## Workflows exporteren en importeren

Je kunt een workflow verplaatsen tussen projecten, of tussen een self-hosted installatie en OneUptime Cloud, als een JSON-bestand.

- **Exporteren** — open de workflow en gebruik **Export Workflow** onder **Instellingen**. Vanuit de workflowlijst kun je ook meerdere workflows selecteren en ze naar één bestand exporteren.
- **Importeren** — klik in de lijst **Workflows** op **Import JSON** en kies een bestand dat vanuit een willekeurig OneUptime-project is geëxporteerd.

Het bestand bevat de naam, beschrijving, ingeschakeld-status en de graaf van de workflow. Het bevat bewust niet:

- **De webhook-geheime sleutel.** Er wordt een nieuwe gegenereerd wanneer de workflow wordt aangemaakt, dus een geïmporteerde workflow krijgt een andere webhook-URL. Alles wat de oorspronkelijke aanroept, moet worden omgeleid.
- **Globale variabelen.** Een blok dat `{{global.variables.MY_SECRET}}` leest, behoudt die referentie, maar de waarde staat niet in het bestand. Maak de variabelen aan in het doelproject voordat je de geïmporteerde workflow draait.
- **Eigenaren en labels.** De eigen label- en eigenaarsregels van je project draaien tegen de geïmporteerde workflow, net als wanneer je hem met de hand had aangemaakt.

Een geïmporteerde workflow wordt altijd **uitgeschakeld** aangemaakt, zelfs als hij was ingeschakeld op de plek waar hij vandaan werd geëxporteerd — zijn graaf kan verwijzen naar monitors, piketbeleid of andere workflows die niet bestaan in het doelproject. Bekijk hem, schakel hem in, test hem met **Workflow uitvoeren**, en laat hem dan aan staan. Een workflow dupliceren gedraagt zich hetzelfde, zodat een kopie nooit gelijk met het origineel begint te vuren voordat je hem hebt bewerkt.

Omdat de graaf letterlijk meereist, reist alles wat rechtstreeks in een blok is getypt mee. Dat is de praktische reden om referenties in secret-variabelen te bewaren: een workflow met een hardcoded token exporteren geeft dat token aan wie het bestand ook ontvangt.

## Hoe lang een run mag duren

Elke uitvoeringspoging heeft een wall-clock-deadline. De runner controleert dit voor en na elk component en markeert een verlopen run als **Timeout** zodra de controle terugkeert. Componenten die netwerk- of scriptwerk uitvoeren, hebben ook hun eigen timeouts nodig, omdat de runner willekeurige componentcode niet gedwongen kan onderbreken.

Het AI-component leidt zijn timeout voor de providerverzoek af van de resterende workflowtijd en begrenst die op 60 seconden, met een kleine marge voor logging en opruiming.

## Limiet op het aanroepen van andere workflows

Met het component **Execute Workflow** kan de ene workflow een andere aanroepen. Om te voorkomen dat er per ongeluk lussen ontstaan waarbij workflow A workflow B aanroept die opnieuw A aanroept, geldt er een limiet op hoe diep de keten mag gaan. Een run die deze limiet overschrijdt, eindigt met een duidelijke foutmelding.

Als je een echte behoefte hebt aan een lange keten (zoals een taak die per run één item verwerkt), is het meestal eenvoudiger om binnen één workflow te lussen met **Custom Code**.

## Webhookbeveiliging

Webhook-triggers geven je een unieke URL. Iedereen die de URL kent, kan hem raken. Om te beschermen tegen onbedoelde of ongewenste aanroepers:

- Behandel de URL als een wachtwoord. Deel hem niet publiekelijk en commit hem niet naar een publieke repo.
- Vraag voor gevoelige workflows aan het aanroepende systeem om een gedeeld token als header mee te sturen (zoals `X-Webhook-Token`) en controleer dat met een blok **Conditions** voordat er iets belangrijks gebeurt. Sla het verwachte token op als een secret-variabele.
- Geef voor zeer gevoelige workflows de voorkeur aan een OneUptime-gebeurtenistrigger en een handmatige importstap boven een publieke webhook.

## Uitgaande netwerktoegang

API- en andere HTTP-blokken doen hun aanvragen vanuit OneUptime. Als je self-hosted, zorg dan dat je installatie bij de diensten kan die je aanroept. Als je OneUptime Cloud gebruikt, staan onze uitgaande IP-bereiken vermeld in [IP-adressen](/docs/configuration/ip-addresses), zodat je ze aan de andere kant kunt toestaan.

## AI-componenten

**Generate Text with AI** stuurt één verzoek via OneUptime's geconfigureerde LLM-gateway. Het gebruikt de standaard-LLM-provider van het project, of de globale provider van de installatie wanneer het project er geen heeft. Configureer providers onder **Project Settings → AI → LLM-providers**; plaats nooit een provider-API-sleutel of een willekeurig model-eindpunt in de workflow zelf.

Het AI-component heeft een expliciete uitgaande grens:

- OneUptime stuurt een vaste componentveiligheidsinstructie plus de herleide **System Instructions**, **Prompt** en geserialiseerde **Context** naar de geconfigureerde provider. Context wordt toegevoegd na een expliciete markering aan het einde van het gebruikersbericht; de vaste instructie zegt dat alles na die markering onvertrouwde gegevens blijft, zelfs als het tags of instructies bevat.
- Het voegt niet automatisch de triggerpayload, workflowgeschiedenis, uitvoer van andere componenten, projectrecords, telemetrie of geheimen toe. Gegevens verlaten het systeem alleen wanneer je ernaar verwijst in een van die drie invoervelden.
- Het stuurt geen tooldefinities of provider-native capability-velden mee. Het model kan OneUptime niet bevragen, geen HTTP-verzoeken doen, en geen projectgegevens wijzigen via dit component. De geconfigureerde provider/model blijft een vertrouwensgrens voor beheerders, dus installaties die strikt offline generatie vereisen, moeten een model kiezen zonder intrinsieke provider-beheerde retrieval.
- Extra parameters op providerniveau zijn beperkt tot een toelaatlijst van generatie-specifieke tuning-velden. Ze kunnen de workflowberichten niet vervangen, geen tools of provider-native websearch-/gegevensbronnen toevoegen, geen niet-tekstuele modaliteiten inschakelen, geen meerdere keuzes aanvragen, geen streaming inschakelen, het verzoek niet vasthouden via providerbewaarvlaggen, of de output-tokenlimiet van dit component niet verhogen. Onbekende toekomstige capability-velden worden standaard weggelaten.
- **System Instructions**, **Prompt**, **Context** en gegenereerde **Response**-waarden worden geredigeerd uit de eigen argument- en retourwaarde-vermeldingen van dit AI-component in het automatische workflow-uitvoeringslogboek. Ze blijven beschikbaar voor downstream-componenten terwijl de run draait. Als je er een invoegt in een ander component, geldt het loggingbeleid van dat component en kan het de herleide waarde vastleggen; behandel hergebruik als een expliciete openbaarmaking. Provider-/modelnamen, tokenaantallen, het LLM Log ID en veilige foutmeldingen blijven zichtbaar voor operaties en facturering. Ruwe providerfoutberichten worden uitgesloten van workflowlogboeken, LLM-logboeken, applicatielogboeken en traces, omdat een provider de inhoud van het verzoek kan echoën.

Behandel elke referentie-variabele als gegevens die je bewust naar de provider stuurt. Voeg met name geen secret-globale variabele toe aan de prompt of context, tenzij die openbaarmaking noodzakelijk is en de provider goedgekeurd is om ze te ontvangen. Een self-hosted lokale provider zoals Ollama kan het verzoek binnen je eigen infrastructuur houden; een gehoste provider ontvangt het verzoek onder de gegevensverwerkingsvoorwaarden van die provider.

Elke aanroep wordt vastgelegd in **Project Settings → AI → AI Logs**, inclusief provider, model, status, tokens, kosten en factureringsinformatie. Previews van prompt en response, en ruwe providerfoutdetails, worden niet opgeslagen in het AI-logboek. Aanroepen via een gehoste globale provider met kosten verbruiken het AI-tegoed van het project. Workflow-AI telt ook mee voor het dagelijkse autonome AI-tokenbudget van het project; wanneer het budget op is, neemt het component zijn pad **Error** zonder het model te benaderen. Project-AI moet ingeschakeld zijn. Op OneUptime Cloud moet het abonnement betaald zijn en is het Growth-plan (of een plan met Growth-functies) vereist; self-hosted installaties met facturering uitgeschakeld hebben deze planbeperking niet.

Ingebouwde grenzen houden onbemande aanroepen eindig: **System Instructions**, **Prompt** en geserialiseerde **Context** zijn samen begrensd op 50.000 tekens; **Temperature** moet tussen `0` en `1` liggen; **Maximum Output Tokens** moet tussen `1` en `4096` liggen (standaard `1024`); en het providerverzoek wordt één keer geprobeerd en verloopt na maximaal 60 seconden. Er draaien maximaal drie workflow-AI-aanroepen tegelijk per project; extra aanroepen nemen het pad **Error** en kunnen opnieuw worden geprobeerd door een latere workflowrun. Validatie-, configuratie-, toegangs-, budget-, tegoed-, gelijktijdigheids-, provider- en timeoutfouten nemen allemaal het pad **Error** en vullen de uitvoer **Error** in. Verbind dat pad voordat je een productieworkflow inschakelt.

## Machtigingen

Workflows respecteren de rolgebaseerde toegangscontrole van je project. De relevante machtigingen:

- **Create / Read / Edit / Delete Workflow** — de basismachtigingen op de workflow zelf.
- **Run Workflow** — nodig om een workflow met de hand uit te voeren of er een via de API te triggeren.
- **Read Workflow Log** — nodig om runs te bekijken.
- **Read / Create / Edit / Delete Workflow Variable** — controle over de lijst met globale variabelen.

De meeste engineers zouden create/edit/read op workflows moeten hebben, maar niet op variabelen. Bewaar bewerkingstoegang tot variabelen voor de mensen die de geheimen van je project beheren.

## Planlimieten

OneUptime Cloud begrenst het aantal runs per maand op kleinere plannen. Je huidige limiet staat vermeld onder **Project Settings → Billing**. Wanneer je die bereikt, worden nieuwe triggers geweigerd tot de volgende factureringscyclus. Self-hosted installaties hebben deze limiet niet.

## Wanneer workflows niet het juiste gereedschap zijn

Een paar gevallen waarin je beter iets anders kunt gebruiken:

- **Zware berekeningen of grote datasets** — workflows zijn ontworpen voor licht koppelwerk, niet voor rekenkracht. Voer zwaar werk uit in je eigen infrastructuur en laat een workflow het aftrappen.
- **Langlopende actieve berekeningen** — een enkele uitvoeringspoging is bedoeld om snel klaar te zijn. Gebruik voor een passieve vertraging zoals "doe A, wacht twee uur, doe B" het component **Sleep**; dat bewaart de run en hervat hem later zonder een worker te bezetten.
- **Stapsgewijze incidentrespons met mensen in de lus** — daar zijn [Runbooks](/docs/runbooks/index) voor. Workflows zijn voor onbemande automatisering.

## Waar je verder kunt lezen

- [Workflows – Overzicht](/docs/workflows/index) — het grote plaatje.
- [Workflow-componenten](/docs/workflows/components) — referentie blok voor blok.
- [Runbooks](/docs/runbooks/index) — wanneer je in plaats daarvan een runbook gebruikt.
