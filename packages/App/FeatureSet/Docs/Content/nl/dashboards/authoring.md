# Een dashboard maken

Om een dashboard te maken, open je **Producten → Dashboards** en klik je op **Dashboard aanmaken**. Het dialoogvenster **Een dashboard aanmaken** vraagt hoe je wilt beginnen, en daarna om een naam. **Vanaf nul beginnen** geeft je een leeg dashboard; een sjabloon maakt zijn widgets, en vaak zijn variabelen, voor je aan en vult zijn naam in (genummerd, zoals "Kubernetes Dashboard 2", als het project er al een heeft). Klik op **Dashboard aanmaken** en het nieuwe dashboard opent. Een leeg dashboard opent op zijn canvas, met een knop **Widget toevoegen** voor de eerste widget.

:::cards
- [Het dashboard maken](#het-dashboard-maken): Vanaf nul beginnen of met een sjabloon.
- [Bewerken en opslaan](#bewerken-en-opslaan): Er verandert voor niemand iets totdat je op Wijzigingen opslaan klikt.
- [Een widget toevoegen](#een-widget-toevoegen): Kies hem uit de catalogus, stel hem in en zet hem op zijn plek.
- [Inzoomen op een piek](#inzoomen-op-een-piek): Sleep over een grafiek om het hele dashboard op dat moment te lezen.
:::

## Voordat je begint

Projecteigenaren en -beheerders kunnen elk dashboard maken en bewerken. Alle anderen hebben een teammachtiging nodig: `CreateDashboard` om dashboards te maken en `EditDashboard` om ze te wijzigen. Projectleden en kijkers kunnen dashboards lezen zonder een van beide. Wie een dashboard niet mag bewerken, opent toch het menu **⋯**, waar **Dashboard bewerken** vergrendeld is en zegt welke machtiging nodig is.

## Het dashboard maken

:::steps
### Kies hoe je begint

Open **Producten → Dashboards** en klik op **Dashboard aanmaken**. Het dialoogvenster **Een dashboard aanmaken** opent op **Vanaf nul beginnen**, een leeg dashboard voor je eigen widgets. Daaronder toont **Of begin met een sjabloon** zes sjablonen onder **Aanbevolen**.

### Kies een sjabloon

Klik op een sjabloon om te zien wat het toevoegt: zijn widgets, genoemd zoals **Widget toevoegen** ze noemt, en de variabelen waarmee je het in zijn werkbalk beperkt. Voor de andere kies je een categorie naast het zoekvak, of **Alle sjablonen**, of typ je in **Sjablonen zoeken…**: elk woord dat je typt moet overeenkomen. Klik dan op **Dit sjabloon gebruiken**, of dubbelklik op het sjabloon. In het zoekvak kiezen de pijltjestoetsen een sjabloon en gebruikt **Enter** het.

### Geef het dashboard een naam

De naam van een sjabloon is al ingevuld, genummerd voorbij de namen die het project al heeft. **Vanaf nul beginnen** laat hem leeg: typ er een. De beschrijving is optioneel, ingeklapt onder **Meer velden**, en je kunt haar later toevoegen op de pagina **Overzicht** van het dashboard. **Terug** brengt je terug naar de sjablonen zoals je ze verliet.

### Maak het aan

Klik op **Dashboard aanmaken**. Het nieuwe dashboard opent: meteen met de widgets van een sjabloon, of met een leeg canvas met **Widget toevoegen** erop.
:::

De sjablonen, per categorie waaronder de kiezer ze toont:

| Categorie | Sjablonen |
| --- | --- |
| Bewaking en APM | Monitor Dashboard, Metrics Dashboard, Real User Monitoring Dashboard, SLO Dashboard |
| Incidentrespons | Incident Dashboard, Alert Dashboard |
| Infrastructuur | Kubernetes Dashboard, Kubernetes Cost Dashboard, Hosts Dashboard, Proxmox Dashboard, VMware Dashboard, Ceph Dashboard, Storage Array Dashboard, Docker Swarm Dashboard, Network Dashboard |

**Aanbevolen** bevat Monitor Dashboard, Incident Dashboard, Alert Dashboard, Kubernetes Dashboard, Hosts Dashboard en Metrics Dashboard. Een sjabloon is een beginpunt, geen koppeling: zodra het dashboard is gemaakt, pas je het aan zoals je wilt. Het sjabloon werkt het later niet meer bij.

## Bewerken en opslaan

Een dashboard opent in leesmodus. Om het te wijzigen, open je het menu **⋯** in de werkbalk en kies je **Dashboard bewerken**. De werkbalk toont **Bewerken** naast de naam, en vervangt het tijdsbereik en de andere bedieningselementen door **Widget toevoegen**, **Variabelen**, **Annuleren** en **Wijzigingen opslaan**, met daaronder een rij voor de **Standaardperiode** en **Standaard automatisch vernieuwen** van het dashboard.

```mermaid title="Van een dashboard lezen naar het wijzigen, en terug"
flowchart TB
    view["Leesmodus: het<br/>dashboard opent hier"] -->|"⋯ → Edit Dashboard"| edit["Bewerkmodus: widgets<br/>toevoegen, wijzigen,<br/>verplaatsen en schalen"]
    edit -->|"Wijzigingen opslaan"| saved["Iedereen ziet<br/>de wijzigingen"]
    edit -->|"Annuleren, dan<br/>Wijzigingen verwerpen"| dropped["Er verandert niets"]
    saved --> back["Terug in<br/>leesmodus"]
    dropped --> back
```

Je wijzigingen zijn alleen van jou totdat je ze opslaat. Tijdens het bewerken wordt niets opgeslagen, dus anderen zien het dashboard zoals het was.

- **Wijzigingen opslaan** slaat de widgets, hun plaatsen en formaten, de variabelen, en de standaardperiode en het standaard automatisch vernieuwen in één keer op, en gaat terug naar leesmodus. Als het opslaan wordt geweigerd, bijvoorbeeld omdat je intussen de machtiging bent kwijtgeraakt, blijf je in bewerkmodus met je wijzigingen en staat de reden boven het raster.
- **Annuleren** vraagt het eerst, omdat het je wijzigingen weggooit: **Wijzigingen verwerpen** gaat terug naar het dashboard zoals het was opgeslagen, en **Doorgaan met bewerken** brengt je terug naar je werk.

Tijdens het bewerken pauzeert het automatisch vernieuwen, en gaat een ingezoomd tijdsbereik terug naar het bereik dat je had gekozen.

## Een widget toevoegen

:::steps
### Open de widgetcatalogus

Klik op **Widget toevoegen**: in de werkbalk tijdens het bewerken, of op het canvas van een leeg dashboard. De catalogus groepeert zijn widgets naar wat ze tonen. Typ in het zoekvak om er een te vinden op naam of doel ("error budget", "pods"), en druk op Enter om het eerste resultaat toe te voegen.

### Kies een widget

Klik erop. De widget komt op de eerste vrije plek in het raster waar hij past, en zijn instellingen openen.

### Stel in wat hij toont

Het instellingenvenster toont een **Live Preview** van de widget boven de instellingen, en de preview volgt elke wijziging die je maakt. Kies wat de widget leest (een metrics-query, een filter, een tekst) en hoe hij eruitziet, en klik dan op **Klaar**.

### Zet hem op zijn plek

Sleep de widget om hem te verplaatsen, en sleep aan zijn randen of hoeken om het formaat te wijzigen. Zie [Widgets op het raster](#widgets-op-het-raster).
:::

[Dashboard-widgets](/docs/dashboards/widgets) beschrijft elke widget en zijn instellingen.

## Widgets op het raster

Het canvas is een raster van twaalf kolommen breed. Widgets klikken erop vast, en de pagina groeit naar beneden naarmate je rijen toevoegt. Terwijl je een widget sleept, toont een gestippelde omtrek waar hij terechtkomt, met zijn kolom en rij; terwijl je het formaat van een widget wijzigt, toont de omtrek zijn formaat in rastereenheden. Widgets die in de weg staan, schuiven opzij, zodat twee widgets nooit overlappen.

Elk soort widget heeft een kleinste formaat, zodat wat hij tekent leesbaar blijft: een grafiek is minstens zes kolommen breed en drie rijen hoog, terwijl één getal in één cel past.

Om een widget later te wijzigen, klik je er tijdens het bewerken op. Zijn instellingen openen opnieuw, met onderaan twee extra knoppen:

- **Duplicate Widget** voegt een kopie toe, met dezelfde instellingen, op de eerste vrije plek.
- **Widget verwijderen** verwijdert hem, zodra je het bevestigt.

## Tijdsbereik en automatisch vernieuwen

In leesmodus bepaalt de tijdsbereikkiezer van de werkbalk het venster dat elke grafiek-, getal-, log- en tracewidget leest. Kies een voorinstelling, van de afgelopen 5 minuten tot de afgelopen 3 maanden, of een eigen begin en einde. Het dashboard opent op zijn standaardperiode: het afgelopen uur, tenzij iemand die het bewerkt een andere instelt.

Lijsten met incidenten, waarschuwingen, monitors en resources tonen hun huidige toestand, wat het tijdsbereik ook is.

Naast het tijdsbereik leest het menu voor automatisch vernieuwen elke widget opnieuw elke 5 seconden, 10 seconden, 30 seconden, 1 minuut, 5 minuten of 15 minuten, met een aftelling tot de volgende vernieuwing. Laat het uit staan terwijl je onderzoek doet, zodat het beeld stil blijft staan. Het dashboard opent met zijn standaard automatisch vernieuwen: uit, tenzij iemand die het bewerkt iets anders instelt.

De tijdsbereikkiezer, de variabelen en automatisch vernieuwen verschijnen zodra het dashboard een widget heeft.

### De standaardwaarden van het dashboard

Terwijl je het dashboard bewerkt, bepaalt de rij onder de knoppen van de werkbalk waarmee iedereen het opent: **Standaardperiode**, een voorinstelling van de afgelopen 5 minuten tot de afgelopen 3 maanden, en **Standaard automatisch vernieuwen**. **Wijzigingen opslaan** slaat ze op met de rest van het dashboard, voor je team en voor de bezoekers van de openbare link. Een eigen begin en einde kunnen geen standaard zijn: het dashboard zou voorgoed op dat moment blijven staan. De rij verschijnt zodra het dashboard een widget heeft.

Dashboards die vóór deze instellingen zijn opgeslagen, openen op het afgelopen uur, met het automatisch vernieuwen dat ze hadden. Via de API en Terraform staan beide in de `dashboardViewConfig` van het dashboard: `timeRange`, een voorinstelling zoals de API-referentie die schrijft, bijvoorbeeld `Past 1 Day`, en `refreshInterval`, bijvoorbeeld `1m`. Elke andere waarde wordt geweigerd.

### Je eigen keuzes

Het tijdsbereik en het automatisch vernieuwen die je in leesmodus kiest, zijn alleen van jou, en je browser onthoudt ze per dashboard: herladen, je browser opnieuw starten of een wandscherm dat herstart opent het dashboard zoals je het achterliet. Alleen een voorinstelling wordt onthouden. Een eigen bereik of een zoom blijft tot je de pagina verlaat, zodat het dashboard nooit op een moment in het verleden blijft hangen.

De eerste keuze van elke kiezer noemt de standaard van het dashboard, zoals in Standaard (Past 1 Day). Kies die om terug te gaan naar de standaard: je browser vergeet je keuze, en het dashboard volgt weer zijn standaard, ook als iemand die later wijzigt. Als je zelf nieuwe standaardwaarden opslaat, zie je ze meteen.

### Inzoomen op een piek

Je hoeft de tijdsbereikkiezer er niet bij te pakken om naar een piek te kijken. Sleep over het interessante stuk van een lijn- of vlakgrafiek en het **hele dashboard** gaat naar dat venster, net alsof je het in de tijdsbereikkiezer had gekozen: elke widget die het tijdsbereik gebruikt, voert zijn query tegelijk opnieuw uit, zodat je één moment over het hele dashboard leest in plaats van één grafiek op een andere schaal dan zijn buren. Live lijsten blijven tonen wat er nu gebeurt, zoals altijd.

**Dubbelklik op een willekeurige grafiek** om het ongedaan te maken: het dashboard gaat terug naar het bereik dat het had voordat je begon in te zoomen, hoe vaak je ook verder bent ingezoomd. Zolang er een zoom actief is, verschijnt er een knop **Zoom herstellen** naast de tijdsbereikkiezer, en dubbelklikken op een dashboard dat niet is ingezoomd, doet niets.

Een ingezoomd venster ligt vast, dus het schuift niet meer mee terwijl automatisch vernieuwen aan staat; dat is bewust, want een venster dat midden in een onderzoek onder je wegschuift, zou erger zijn. Reset de zoom om het weer mee te laten schuiven.

Inzoomen werkt alleen in leesmodus; in bewerkmodus verplaatst en schaalt slepen de widgets. Staafdiagrammen zoomen op dezelfde manier in (sleep over de staven), en dubbelklikken op een ervan reset het dashboard zoals elke andere grafiek. Alleen slepen zoomt in: een gewone klik op een grafiek verandert nooit het tijdsbereik van het dashboard. Dezelfde gebaren werken op de grafieken in heel OneUptime; zie [Inzoomen op een tijdsbereik](/docs/telemetry/charts-and-time-ranges).

## Volledig scherm

**⋯ → Volledig scherm** toont de widgets van het dashboard op het hele scherm, voor een scherm aan de muur of een vergadering. Druk op Esc om het te verlaten.

## Tips voor dashboards die goed blijven

- **Eén onderwerp per dashboard.** Een paar gerichte dashboards zijn beter dan één pagina met alles wat je bewaakt.
- **Zet de belangrijkste widget bovenaan.** Mensen lezen van boven naar beneden, dus laat het eerste wat ze zien antwoord geven op "is dit gezond?"
- **Geef de secties een naam met Tekst-widgets.** Een korte kop om de paar rijen ("Latentie", "Fouten", "Capaciteit") maakt de pagina makkelijk te scannen, zelfs van de andere kant van de kamer.
- **Gebruik variabelen in plaats van kopieën.** Sta je op het punt hetzelfde dashboard te bouwen voor een tweede service, voeg dan een variabele `service` toe. Zie [Dashboard-variabelen en filters](/docs/dashboards/variables).
- **Maak een kopie voor een grote wijziging.** **Dashboard dupliceren**, op de pagina **Instellingen** van het dashboard, maakt een veilige kopie om je ideeën op uit te proberen.

## Volgende stappen

:::cards
- [Dashboard-widgets](/docs/dashboards/widgets): Elke widget, zijn instellingen, en welke je kiest.
- [Dashboard-variabelen en filters](/docs/dashboards/variables): Eén dashboard voor elke service, host of klant.
- [Delen en publieke dashboards](/docs/dashboards/sharing): Deel het dashboard buiten je team.
- [Dashboard-configuratie en machtigingen](/docs/dashboards/configuration): Eigenaren, labels, archiveren en wie wat mag.
:::
