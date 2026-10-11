# Inzoomen op een tijdsbereik

Sleep over een grafiek om de pagina op dat moment in te zoomen, en dubbelklik om terug te gaan. Deze pagina legt de gebaren uit, hoe een zoom zich gedraagt en welke grafieken wat inzoomen.

:::cards
- [Inzoomen en weer uitzoomen](#inzoomen-en-weer-uitzoomen): De twee gebaren en de knop Reset zoom.
- [Hoe zoomen zich gedraagt](#hoe-zoomen-zich-gedraagt): Geneste zooms, automatisch vernieuwen, klikken en slepen.
- [Waar het werkt](#waar-het-werkt): De pagina's en grafieken waarvan slepen het bereik verandert.
- [Grafieken zonder zoom](#grafieken-zonder-zoom): Stroken, meters en sparklines.
:::

## Inzoomen en weer uitzoomen

Elke tijdreeksgrafiek in OneUptime is ook een tijdsbereikkiezer. Toont een grafiek een piek die u wilt bekijken, dan hoeft u de kiezer niet te openen en geen datums te typen:

:::steps
1. **Sleep over de piek** in een willekeurige grafiek. Het tijdsbereik van de pagina gaat naar het venster dat u hebt getrokken, precies alsof u het in de tijdsbereikkiezer had gekozen. Elke grafiek, en elke tegel of tabel die uit het tijdsbereik van de pagina wordt berekend, vraagt er opnieuw gegevens voor op, zodat u overal hetzelfde moment leest.
2. **Dubbelklik op een willekeurige grafiek** om terug te gaan. De pagina keert terug naar het tijdsbereik dat ze had voordat u begon met inzoomen.
:::

Panelen die de huidige toestand tonen, blijven op nu staan, net als wanneer u zelf een bereik kiest: inventarisaantallen, gezondheid, grootste verbruikers van resources, recente waarschuwingen, openstaande incidenten en alerts, en de live lijsten van een dashboard.

Zolang een zoom actief is, verschijnt naast de tijdsbereikkiezer van de pagina een knop **Reset zoom**. Die doet hetzelfde als dubbelklikken en is de weg terug voor toetsenbordgebruikers en op aanraakschermen.

```mermaid title="Wat slepen, dubbelklikken en de kiezer met het tijdsbereik van de pagina doen"
stateDiagram-v2
    state "Bereik uit de kiezer" as Picked
    state "Ingezoomd venster" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: over een grafiek slepen
    Zoomed --> Zoomed: opnieuw slepen
    Zoomed --> Picked: dubbelklikken of Reset zoom
    Zoomed --> Picked: een bereik kiezen
```

## Hoe zoomen zich gedraagt

- **Zoom zo diep in als u wilt; één reset gaat helemaal terug.** Nadat u van "Past 1 Hour" naar tien minuten en daarna naar één bent ingezoomd, geeft één dubbelklik (of **Reset zoom**) het hele uur terug in plaats van één niveau tegelijk.
- **Elke grafiek kan elke zoom resetten.** Sleep in de CPU-grafiek en dubbelklik in de geheugengrafiek: de pagina is ingezoomd, niet de grafiek.
- **Zelf een bereik kiezen begint opnieuw.** Een voorinstelling of een eigen bereik in de kiezer is een nieuw beginpunt: de zoom is voorbij en **Reset zoom** verdwijnt.
- **Een ingezoomd venster ligt vast.** "Past 30 Minutes" schuift met de klok mee; een zoom is een vast venster en schuift dus niet mee zolang automatisch vernieuwen aan staat. Reset de zoom om weer mee te schuiven.
- **Een zoom loopt nooit voorbij nu.** De nieuwste bucket van een grafiek is meestal nog aan het vullen; een sleepbeweging die daarop eindigt, wordt bij de huidige tijd afgekapt.
- **U kunt de muis buiten de grafiek loslaten**: de sleepbeweging telt toch.
- **U hoeft niet te wachten tot de grafieken geladen zijn om terug te gaan.** Direct na een zoom, terwijl de grafieken het getrokken venster nog ophalen, of wanneer dat venster leeg blijkt, reset een dubbelklik op een grafiek de zoom meteen.
- **Dubbelklikken op een pagina die niet is ingezoomd, doet niets.**

### Klikken en slepen

- **In lijn-, vlak- en staafgrafieken is een gewone klik geen zoom.** Dat geldt voor de meeste grafieken: metriekkaarten en de metriekverkenner, resource-overzichten, SLO's, monitors en elke grafiek op een dashboard. Alleen slepen over buckets heen zoomt in, dus klikken op een punt, een staaf of een legenda-item blijft doen wat het eerder deed. Zolang een zoom actief is, werkt een klik op het tekengebied van een grafiek een ogenblik later, zodat die van de dubbelklik voor resetten kan worden onderscheiden. De tijdlijn van foutpatronen in de logboek-Insights en de Occurrence Trend van een uitzondering zoomen ook alleen in bij slepen.
- **In de volumegrafieken van de verkenners zoomt een klik op één staaf in op die staaf.** De volumegrafieken van de verkenners voor logboeken, traces, uitzonderingen en beveiligingsgebeurtenissen, en de analysegrafieken voor logboeken en traces, zoomen in op de staven waarover u sleept, of op de ene staaf waarop u klikt. Deze grafieken tonen **Click or drag to zoom**.

### Hints bij de grafieken

De meeste grafieken die zoomen, noemen het gebaar boven het tekengebied, **Drag to zoom** of **Click or drag to zoom**, en voegen zolang een zoom actief is de herinnering **double-click to reset** toe. Metriekkaarten, de metriekverkenner en de volumegrafieken van de verkenners tonen de hint altijd. Op de grafiekkaarten van resource-overzichten en SLO's, en op sommige dashboardwidgets, verschijnt hij alleen zolang u naar de kaart wijst of er met Tab in komt.

## Waar het werkt

Zoomen verandert het tijdsbereik van de hele pagina op:

- resource-overzichten en hun Insights-pagina's: Kubernetes-clusters, Docker-, Podman- en Docker Swarm-hosts, hosts en hun processen, services en systemd-units, VMware, Proxmox, Ceph, opslagarrays, databases, cloudresources en serverless-functies;
- services en RUM-applicaties;
- metrieken en verkeer van netwerkapparaten;
- metriekkaarten, inclusief het tabblad Metrieken van een resource en de metrieken van een monitor;
- de metriekverkenner;
- SLO-historiegrafieken;
- logboek-Insights, inclusief de tijdlijn "Wanneer het gebeurde" van een foutpatroon, waarvan het paneel een eigen **Reset zoom** heeft omdat het de kiezer van de pagina bedekt;
- volumegrafieken voor logboeken, traces, uitzonderingen en beveiligingsgebeurtenissen, en de analysegrafieken voor logboeken en traces, die het bereik veranderen van de verkenner waar ze bij horen;
- [dashboards](/docs/dashboards/authoring), waar slepen het bereik van het hele dashboard verandert.

Grafieken met een eigen venster zoomen alleen dat venster in en veranderen dus nooit iets anders op de pagina. Dat geldt voor een metriekvoorbeeld in het formulier van een monitor (de monitor blijft zijn eigen voortschrijdende venster evalueren), de Occurrence Trend van een uitzondering, een grafiek die in een pop-up of in het onderzoekspaneel is geopend, en grafieken in antwoorden van de AI-chat. Dubbelklikken op een ervan, of op de knop **Reset zoom** ervan, zet het eigen venster terug.

De telemetrie-momentopname op de pagina van een incident, alert of episode heeft ook een eigen venster. Slepen in de grafiek ervan (de metriekgrafiek, of de volumegrafiek voor logboeken, traces of uitzonderingen als de momentopname die toont) zoomt de hele momentopname in, zodat de tabbladen Metrieken, Logboeken, Traces en Uitzonderingen allemaal het getrokken stuk tonen. **Reset zoom** naast de badge van de momentopname, of dubbelklikken op die grafiek, zet het venster van de momentopname terug.

## Grafieken zonder zoom

Een paar visualisaties hebben geen tijdas om over te slepen, zijn te klein om op te slepen of tonen altijd een vast eigen venster, en zoomen dus niet:

- beschikbaarheidsstroken (één staaf per dag), die niets fijners dan een dag kunnen tonen;
- aandeel- en verhoudingsbalken, meters en voortgangsbalken;
- flame graphs, servicekaarten en stroomdiagrammen;
- de kleine trend-sparklines in metrieklijsten, waar een klik de metriek opent: open die om een grafiek te krijgen die u kunt inzoomen;
- kleine sparklines met een vast eigen venster, zoals de round-trip-tijd van een netwerkapparaat over het afgelopen uur: hun link **Open metrics** leidt naar grafieken die u kunt inzoomen.

## Volgende stappen

:::cards
- [Een dashboard maken](/docs/dashboards/authoring): Zoomen werkt in elke grafiek van een dashboard.
- [Zoeksyntaxis](/docs/telemetry/search-syntax): De verkenners filteren zodra u het moment hebt gevonden.
- [Metrics-monitor](/docs/monitor/metrics-monitor): Waarschuwen op de metriek die u bekeek.
:::
