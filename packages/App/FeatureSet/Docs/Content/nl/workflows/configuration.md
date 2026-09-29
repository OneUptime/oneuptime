# Workflow-configuratie en veiligheid

Deze pagina behandelt de instellingen en veiligheidsgrenzen die je wilt kennen voordat je een workflow op echt verkeer loslaat.

## Een workflow aan- of uitzetten

Elke workflow heeft een schakelaar **Ingeschakeld** in **Instellingen**. Staat die uit, dan draait de workflow niet — webhook-aanroepen, geplande tijdstippen en OneUptime-gebeurtenissen worden allemaal genegeerd. Nieuwe workflows beginnen uitgeschakeld.

Gebruik deze schakelaar als je "klaar voor gebruik"-poort:

1. Bouw de workflow.
2. Klik op **Workflow uitvoeren** in de **Bouwer**, met realistische waarden.
3. Controleer de **Logboeken** — ga na dat elk blok terechtkwam waar je het verwachtte.
4. Zet **Ingeschakeld** aan.

Een workflow uitzetten stopt geen uitvoeringen die al bezig zijn; het voorkomt alleen dat er nieuwe starten.

## Eigenaren en labels

- **Eigenaren** — gebruikers en teams die als eigenaar staan vermeld, krijgen toegang tot de workflow en kunnen zich aanmelden voor meldingen wanneer hij faalt. Stel ze in onder **Instellingen → Eigenaren**.
- **Labels** — tags om workflows te groeperen. In de workflowlijst kun je op label filteren, wat een druk project een stuk overzichtelijker maakt. Handig wanneer je workflows ordent per team, integratie of omgeving.
- **Labelregels** — onder **Workflows → Instellingen → Labelregels** pas je automatisch labels toe op nieuwe workflows, op basis van patronen in naam of beschrijving.
- **Eigenaarsregels** — onder **Workflows → Instellingen → Eigenaarsregels** wijs je automatisch eigenaren toe aan nieuwe workflows.

## Geheimen

Markeer een globale variabele als **geheim** wanneer er iets gevoeligs in staat. De waarde is na het opslaan verborgen voor gewone uitlezingen via API en UI, en de workflowlogging wist de opgeloste waarde voordat het runlogboek wordt bewaard.

Gebruik geheime variabelen voor:

- API-sleutels voor externe diensten.
- Authenticatietokens.
- Ondertekeningssleutels voor webhooks.
- Alles wat je niet wilt laten zien aan iemand met alleen-lezentoegang.

Plak een geheim niet rechtstreeks in een blok — waarden als `Authorization: Bearer eyJh...` komen zichtbaar in de workflow en in de logboeken terecht. Gebruik in plaats daarvan `{{global.variables.MY_SECRET}}`.

## Workflows exporteren en importeren

Je kunt een workflow als JSON-bestand verplaatsen tussen projecten, of tussen een zelf gehoste installatie en OneUptime Cloud.

- **Exporteren** — open de workflow en gebruik **Export Workflow** onder **Instellingen**. Vanuit de workflowlijst kun je ook meerdere workflows selecteren en samen in één bestand exporteren.
- **Importeren** — klik in de lijst **Workflows** op **Import JSON** en kies een bestand dat uit een willekeurig OneUptime-project is geëxporteerd.

Het bestand bevat de naam, beschrijving, aan/uit-status en de graaf van de workflow. Bewust niet meegenomen:

- **De geheime webhooksleutel.** Er wordt een verse gegenereerd zodra de workflow wordt aangemaakt, dus een geïmporteerde workflow heeft een andere webhook-URL. Alles wat de oorspronkelijke aanriep, moet opnieuw worden gericht.
- **Globale variabelen.** Een blok dat `{{global.variables.MY_SECRET}}` leest, houdt die verwijzing, maar de waarde staat niet in het bestand. Maak de variabelen aan in het doelproject voordat je de geïmporteerde workflow draait.
- **Eigenaren en labels.** De label- en eigenaarsregels van je eigen project draaien over de geïmporteerde workflow, net alsof je hem met de hand had aangemaakt.

Een geïmporteerde workflow wordt altijd **uitgeschakeld** aangemaakt, ook als hij aan stond op de plek waar hij vandaan komt — zijn graaf kan wijzen naar monitoren, piketbeleid of andere workflows die in het doelproject niet bestaan. Bekijk hem na, zet hem aan, test hem met **Workflow uitvoeren**, en laat hem dan pas staan. Een workflow dupliceren werkt hetzelfde, zodat een kopie nooit naast het origineel begint af te gaan voordat jij hem hebt bijgewerkt.

Omdat de graaf letterlijk meereist, reist alles wat rechtstreeks in een blok is getypt met hem mee. Dat is de praktische reden om inloggegevens in geheime variabelen te bewaren: een workflow exporteren met een hardgecodeerd token geeft dat token weg aan wie het bestand ontvangt.

## Hoe lang een run mag duren

Elke uitvoeringspoging heeft een harde deadline op de klok. De runner controleert die vóór en na elk component en markeert een run die eroverheen gaat als **Timeout** zodra de besturing terugkeert. Componenten die netwerk- of scriptwerk doen, hebben daarnaast hun eigen time-outs nodig, omdat de runner willekeurige componentcode niet met geweld kan onderbreken.

Het AI-component leidt de time-out voor het providerverzoek af uit de resterende workflowtijd en begrenst die op 60 seconden, met een kleine marge voor logging en opruimen.

## Limiet op het aanroepen van andere workflows

Met het component **Execute Workflow** roept de ene workflow de andere aan. Om te voorkomen dat er per ongeluk lussen ontstaan waarin workflow A B aanroept die weer A aanroept, zit er een grens op de diepte van de keten. Een run die daaroverheen gaat, eindigt met een duidelijke foutmelding.

Heb je echt een lange keten nodig (zoals een taak die per run één item verwerkt), dan is het meestal eenvoudiger om binnen één workflow te lussen met **Custom Code**.

## Webhookbeveiliging

Webhook-triggers geven je een unieke URL. Iedereen die die URL kent, kan hem aanroepen. Om je te beschermen tegen onbedoelde of ongewenste aanroepers:

- Behandel de URL als een wachtwoord. Deel hem niet publiekelijk en commit hem niet naar een publieke repo.
- Vraag bij gevoelige workflows het aanroepende systeem om een gedeeld token als header mee te sturen (zoals `X-Webhook-Token`) en controleer dat met een blok **Conditions** voordat je iets belangrijks doet. Bewaar het verwachte token als geheime variabele.
- Kies bij zeer gevoelige workflows liever een OneUptime-gebeurtenistrigger met een handmatige importstap dan een publieke webhook.

## Uitgaande netwerktoegang

API-blokken en andere HTTP-blokken doen hun verzoeken vanuit OneUptime. Host je zelf, zorg dan dat je installatie de diensten kan bereiken die je aanroept. Gebruik je OneUptime Cloud, dan staan onze uitgaande IP-reeksen in [IP-adressen](/docs/configuration/ip-addresses), zodat je ze aan de andere kant kunt toelaten.

## AI-componenten

**Generate Text with AI** stuurt één verzoek via de geconfigureerde LLM-gateway van OneUptime. Het gebruikt de standaard-LLM-provider van het project, of de globale provider van de installatie wanneer het project er geen heeft. Providers stel je in onder **Projectinstellingen → AI → LLM-providers**; zet nooit een API-sleutel van een provider of een willekeurig model-endpoint in de workflow zelf.

Het AI-component heeft een expliciete uitgaande grens:

- OneUptime stuurt een vaste veiligheidsinstructie voor het component, plus de opgeloste **System Instructions**, **Prompt** en geserialiseerde **Context**, naar de geconfigureerde provider. De context wordt achter een expliciete markering aan het eind van het gebruikersbericht geplakt; de vaste instructie zegt dat alles na die markering onbetrouwbare data blijft, ook wanneer er tags of instructies in staan.
- Het hangt er niet automatisch de triggerpayload, de workflowgeschiedenis, uitvoer van andere componenten, projectrecords, telemetrie of geheimen aan. Data vertrekt alleen wanneer je ernaar verwijst in een van die drie invoervelden.
- Het stuurt geen tooldefinities of provider-eigen capability-velden mee. Het model kan via dit component OneUptime niet bevragen, geen HTTP-verzoeken doen en geen projectdata wijzigen. De ingestelde provider en het ingestelde model blijven een vertrouwensgrens van de beheerder, dus installaties die strikt offline generatie eisen, kiezen een model zonder eigen, door de provider beheerde retrieval.
- Aanvullende parameters op providerniveau zijn beperkt tot een allowlist van afstelvelden die alleen de generatie raken. Ze kunnen de workflowberichten niet vervangen, geen tools of provider-eigen websearch of databronnen toevoegen, geen niet-tekstuele modaliteiten inschakelen, niet om meerdere alternatieven vragen, geen streaming aanzetten, het verzoek niet laten bewaren via opslagvlaggen van de provider, en de limiet op uitvoertokens van dit component niet verhogen. Onbekende, toekomstige capability-velden vallen standaard weg.
- De waarden van System Instructions, Prompt, Context en de gegenereerde Response worden weggelakt uit de eigen argument- en retourwaarde-items van dit AI-component in het automatische workflow-uitvoeringslogboek. Tijdens de run blijven ze beschikbaar voor componenten verderop. Zet je er een in een ander component, dan geldt het loggingbeleid van dát component en kan de opgeloste waarde alsnog worden vastgelegd; beschouw hergebruik als een expliciete openbaarmaking. Provider- en modelnamen, tokenaantallen, de LLM Log ID en veilige foutmeldingen blijven zichtbaar voor beheer en facturering. Ruwe foutbodies van de provider blijven buiten workflowlogboeken, LLM-logboeken, applicatielogboeken en traces, omdat een provider inhoud van het verzoek kan terugkaatsen.

Beschouw elke variabele waarnaar je verwijst als data die je bewust naar de provider stuurt. Zet in het bijzonder geen geheime globale variabele in de prompt of de context, tenzij die openbaarmaking nodig is en de provider hem mag ontvangen. Een zelf gehoste, lokale provider zoals Ollama kan het verzoek binnen je eigen infrastructuur houden; een gehoste provider ontvangt het verzoek onder de gegevensverwerkingsvoorwaarden van die provider.

Elke aanroep wordt vastgelegd in **Projectinstellingen → AI → AI-logboeken**, inclusief provider, model, status, tokens, kosten en factureringsgegevens. Previews van prompt en antwoord en ruwe foutdetails van de provider worden niet in het AI-logboek bewaard. Aanroepen via een betaalde globale provider verbruiken het AI-tegoed van het project. Workflow-AI telt ook mee voor het dagelijkse budget aan autonome AI-tokens van het project; is dat budget op, dan neemt het component het pad **Error** zonder het model te benaderen. AI moet aanstaan voor het project. Op OneUptime Cloud moet het abonnement betaald zijn en is het Growth-plan (of een plan dat de Growth-functies bevat) vereist; zelf gehoste installaties met facturering uitgeschakeld kennen deze planbeperking niet.

Ingebouwde grenzen houden onbemande aanroepen eindig: System Instructions, Prompt en geserialiseerde Context zijn samen begrensd op 50.000 tekens; Temperature moet van `0` tot en met `1` lopen; Maximum Output Tokens moet van `1` tot en met `4096` lopen (standaard `1024`); en het providerverzoek wordt één keer geprobeerd en verloopt na hoogstens 60 seconden. Er draaien nooit meer dan drie workflow-AI-aanroepen tegelijk per project; extra aanroepen nemen het pad **Error** en kunnen door een latere workflowrun opnieuw worden geprobeerd. Fouten in validatie, configuratie, toegang, budget, saldo, gelijktijdigheid, provider en time-out nemen allemaal het pad **Error** en vullen de uitvoer **Error**. Verbind dat pad voordat je een productieworkflow inschakelt.

## Machtigingen

Workflows respecteren de rolgebaseerde toegangscontrole van je project. De relevante machtigingen:

- **Create / Read / Edit / Delete Workflow** — de basisrechten op de workflow zelf.
- **Run Workflow** — nodig om een workflow met de hand uit te voeren of er via de API een te triggeren.
- **Read Workflow Log** — nodig om runs te bekijken.
- **Read / Create / Edit / Delete Workflow Variable** — zeggenschap over de lijst met globale variabelen.

De meeste engineers hebben create/edit/read op workflows nodig, maar niet op variabelen. Houd bewerkrechten op variabelen bij de mensen die de geheimen van je project beheren.

## Planlimieten

OneUptime Cloud begrenst op kleinere abonnementen het aantal runs per maand. Je huidige limiet staat onder **Projectinstellingen → Facturering**. Bereik je die, dan worden nieuwe triggers geweigerd tot de volgende factuurperiode. Zelf gehoste installaties kennen deze limiet niet.

## Wanneer workflows niet het juiste gereedschap zijn

Een paar gevallen waarin je beter naar iets anders grijpt:

- **Zwaar rekenwerk of grote datasets** — workflows zijn bedoeld als licht lijmwerk, niet om te rekenen. Draai zwaar werk in je eigen infrastructuur en laat een workflow het aftrappen.
- **Langlopend actief rekenwerk** — één uitvoeringspoging hoort snel klaar te zijn. Voor passief wachten zoals "doe A, wacht twee uur, doe B" gebruik je het component **Sleep**; dat bewaart de run en hervat hem later zonder een worker bezet te houden.
- **Stap-voor-stap incidentafhandeling met mensen in de lus** — daar zijn [Runbooks](/docs/runbooks/index) voor. Workflows zijn voor onbemande automatisering.

## Waar je verder kunt lezen

- [Workflows – Overzicht](/docs/workflows/index) — het grote plaatje.
- [Workflow-componenten](/docs/workflows/components) — referentie blok voor blok.
- [Runbooks – Overzicht](/docs/runbooks/index) — wanneer je beter een runbook gebruikt.
