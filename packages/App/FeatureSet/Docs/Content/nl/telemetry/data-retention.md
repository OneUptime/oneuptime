# Gegevensbewaring

OneUptime bewaart uw logboeken, traces, metrieken en profielen een aantal dagen en verwijdert ze daarna: 15 dagen, tenzij u dat wijzigt. Deze pagina laat zien hoe dat aantal wordt bepaald, hoe u het voor het hele project wijzigt, en hoe u een deel van de telemetrie langer of korter bewaart dan de rest.

:::cards
- [Hoe lang telemetrie wordt bewaard](#hoe-lang-telemetrie-wordt-bewaard): De volgorde waarin OneUptime de instellingen leest.
- [De bewaring van het project wijzigen](#de-bewaring-van-het-project-wijzigen): Eén getal voor al uw telemetrie.
- [Een deel van de telemetrie langer of korter bewaren](#een-deel-van-de-telemetrie-langer-of-korter-bewaren): Per type, ernst, status of service.
- [Wat bewaring kost](#wat-bewaring-kost): Facturering op OneUptime Cloud, schijfruimte bij zelf hosten.
:::

## Hoe lang telemetrie wordt bewaard

Elke logboekregel, span, elk metriekpunt en elk profielmonster krijgt zijn bewaartermijn bij aankomst. OneUptime berekent hoeveel dagen het moet worden bewaard, voorziet het van de datum waarop het verloopt, en verwijdert het na die datum. De meest specifieke instelling wint:

```mermaid title="Welke instelling bepaalt hoe lang een record wordt bewaard"
flowchart TB
    arrive["Een logboekregel,<br/>span of metriekpunt<br/>komt binnen"] --> resource{"Ingesteld op zijn<br/>service of resource?"}
    resource -->|"Nee"| byType{"Ingesteld op het<br/>project voor<br/>dit type?"}
    byType -->|"Nee"| projectDefault["Standaard van het<br/>project: 15 dagen,<br/>tenzij gewijzigd"]
    resource -->|"Ja"| stamped["Voorzien van een<br/>vervaldatum: aankomst<br/>plus de dagen"]
    byType -->|"Ja"| stamped
    projectDefault --> stamped
    stamped --> deleted["Verwijderd na<br/>die datum"]
```

Volledig uitgeschreven leest OneUptime deze instellingen in deze volgorde, en de eerste die is ingesteld, beslist:

| Volgorde | Instelling | Waar ze wordt ingesteld |
| --- | --- | --- |
| 1 | Dagen voor één logboekernst of spanstatus, voor één service of resource | **Bewaring per telemetrietype**, op de pagina **Instellingen** ervan |
| 2 | Dagen voor één soort telemetrie, voor één service of resource | Dezelfde kaart |
| 3 | Dagen voor alles van één service of resource | **Bewaartermijn telemetriegegevens**, op dezelfde pagina |
| 4 | Dagen voor één logboekernst of spanstatus, voor het project | **Bewaring per telemetrietype**, op **Gegevensbewaring** |
| 5 | Dagen voor één soort telemetrie, voor het project | Dezelfde kaart |
| 6 | Dagen voor al het andere | **Standaardbewaring (dagen)**, op **Gegevensbewaring** |

- **Instellingen 1 tot en met 5 zijn bewaringsoverschrijvingen.** Ze maken deel uit van de [Enterprise Edition](/docs/self-hosted/enterprise), en van het Scale-abonnement op OneUptime Cloud. Zonder deze overschrijvingen wordt elk record bewaard volgens de standaard van het project.
- **Een wijziging geldt voor nieuwe telemetrie.** Een record houdt de datum waarmee het is voorzien: een kortere bewaring verwijdert het niet eerder, en een langere bewaart het niet langer. Nieuwe records volgen een wijziging binnen ongeveer vijf minuten.
- **Uitzonderingen volgen waarin ze zijn gevonden.** Een uitzondering wordt even lang bewaard als de span of logboekregel waar ze vandaan komt. Session Replays hebben een eigen bewaring: zie [Andere gegevens met een eigen bewaring](#andere-gegevens-met-een-eigen-bewaring).

## Voordat u begint

- **Een rol die het project wijzigt.** Project Owner of Project Admin wijzigen de bewaring van het project. De bewaring van een service of resource vraagt de rol die de andere instellingen ervan wijzigt.
- **Voor overschrijvingen, de Enterprise Edition of het Scale-abonnement.** Een zelfgehoste installatie heeft een Enterprise-licentie nodig, en een OneUptime Cloud-project het Scale-abonnement of hoger. De standaardbewaring van het project zit in elke editie en elk abonnement.

## De bewaring van het project wijzigen

:::steps
### Gegevensbewaring openen

Ga naar **Projectinstellingen → Telemetrie & APM → Gegevensbewaring**. **Telemetrie & APM** staat in het zijmenu eerst ingeklapt: klik erop om het te openen. De kaart **Bewaartermijn telemetriegegevens** toont de **Standaardbewaring (dagen)**.

### Het aantal dagen instellen

Klik op **Edit Retention Settings**, voer het aantal dagen in, minstens 1, en klik op **Wijzigingen opslaan**.
:::

Het nieuwe getal geldt voor elk record dat vanaf dan binnenkomt en geen eigen overschrijving heeft.

## Een deel van de telemetrie langer of korter bewaren

Overschrijvingen bewaren wat u nodig hebt langer en de rest korter: foutlogboeken een kwartaal, bijvoorbeeld, en debuglogboeken een paar dagen.

### Voor het hele project

Onder de standaard stelt de kaart **Bewaring per telemetrietype** dagen in voor elk soort telemetrie. Klik op **Edit Overrides**, vul de velden in die u nodig hebt, en laat de rest leeg:

| Type | Velden |
| --- | --- |
| Logboeken | **Logs default (days)**, en één veld voor elke logboekernst |
| Traces | **Traces default (days)**, en één veld voor elke spanstatus: Fout, Ok en Niet ingesteld |
| Metrieken | **Metrics default (days)** |
| Profielen | **Profiles default (days)** |

Een leeg veld valt terug op de volgende instelling in de volgorde hierboven, dus een ernstniveau zonder eigen dagen bewaart zijn logboeken volgens de standaard voor logboeken.

### Voor één service of resource

Open de pagina **Instellingen** van de service of resource. De kaart **Bewaartermijn telemetriegegevens** bevat **Telemetriegegevens bewaren gedurende (dagen)**, één getal voor alles wat hij stuurt, en de kaart **Bewaring per telemetrietype** heeft dezelfde velden als die van het project. Laat een veld leeg om de instellingen van het project te gebruiken.

Services, hosts, Kubernetes-clusters, Docker- en Podman-hosts, Docker Swarm-, Proxmox- en Ceph-clusters, opslagarrays, vCenters, databases, serverless functies, cloudresources, RUM-applicaties en IoT-vloten hebben allemaal deze kaarten. Zie de [Servicecatalogus](/docs/telemetry/services#een-service-wijzigen) voor de pagina **Instellingen** van een service.

### Als het abonnement of de licentie geen overschrijvingen meer omvat

- **Op een zelfgehoste installatie** gelden overschrijvingen niet meer zodra de Enterprise-proefperiode of de respijtperiode afloopt zonder licentie. Nieuwe telemetrie wordt bewaard volgens de standaard van het project, de kaarten worden alleen-lezen, en niets wat u hebt ingesteld wordt verwijderd: activeer een licentie en ze gelden weer. Zie [Enterprise Edition](/docs/self-hosted/enterprise#als-een-licentie-verloopt-of-ontbreekt).
- **Op OneUptime Cloud** blijft een overschrijving die een proefperiode liet staan gelden onder het Scale-abonnement. De pagina toont haar onder de upgradekaart, met een knop **Overschrijving verwijderen** die op elk abonnement werkt. Een overschrijving opnieuw instellen vraagt het Scale-abonnement.

## Andere gegevens met een eigen bewaring

| Gegevens | Bewaard gedurende | Waar u dat wijzigt |
| --- | --- | --- |
| Session Replays | 7 dagen, tenzij gewijzigd | Het replaybeleid van de RUM-applicatie: zie [Applicaties beheren](/docs/rum/applications#bewaring-van-sessieherhalingen). |
| Monitorlogboeken, één rij per controle | 1 dag, tenzij gewijzigd | Op een zelfgehoste installatie, **Logbewaring van monitor (dagen)** in het Admin Dashboard |
| Monitormetrieken, en de metrieken die SLO's vastleggen | 30 dagen, tenzij gewijzigd | Op een zelfgehoste installatie, **Metriekbewaring van monitor (dagen)** in het Admin Dashboard |

## Wat bewaring kost

- **Op OneUptime Cloud** wordt telemetrie gefactureerd per opgenomen GB, en de prijs per GB omvat 15 dagen bewaring. Langere bewaring kost naar verhouding meer: 30 dagen kost per GB twee keer zoveel als 15. Kortere bewaring kost naar verhouding minder, maar bewaring korter dan 7 dagen wordt gefactureerd als 7 dagen. **Projectinstellingen → Facturering en facturen → Gebruiksgeschiedenis** toont per dag hoeveel elke service stuurde en hoe lang dat wordt bewaard.
- **Bij zelf hosten** staat telemetrie in ClickHouse, en bewaring vermenigvuldigt de schijfruimte ervan. Zie [Sizing](/docs/installation/sizing#de-bewaartermijn-en-het-effect-op-opslag).

Telemetrie die u niet nodig hebt, kost niets als ze nooit wordt opgeslagen: [Drop-filters en scrub-regels](/docs/telemetry/drop-filters-and-scrub-rules) gooien haar weg zodra ze binnenkomt.

## Problemen oplossen

:::details Ik heb de bewaring verlaagd, maar oude gegevens staan er nog
Een record houdt de vervaldatum waarmee het bij aankomst is voorzien. Records die vóór de wijziging zijn opgeslagen, worden op hun eigen datum verwijderd, en alleen nieuwe records volgen de nieuwe bewaring.
:::

:::details De overschrijvingskaarten tonen een upgradeverzoek
Bewaringsoverschrijvingen vragen de Enterprise Edition op een zelfgehoste installatie, en het Scale-abonnement op OneUptime Cloud. Tot dan wordt alles bewaard volgens de standaard van het project.
:::

:::details Schijfruimte komt een dag nadat gegevens verlopen terug
Verlopen records verschijnen niet meer in zoekopdrachten, grafieken en lijsten zodra ze verlopen. Op schijf worden logboeken en metrieken bij de eerste middernacht daarna verwijderd, dus hun ruimte komt tot een dag later terug.
:::

## Volgende stappen

:::cards
- [Ingestiesleutels](/docs/telemetry/ingestion-keys): Stuur telemetrie naar uw project.
- [Drop-filters en scrub-regels](/docs/telemetry/drop-filters-and-scrub-rules): Houd alleen de telemetrie die u nodig hebt.
- [Servicecatalogus](/docs/telemetry/services): Stel de eigen bewaring van een service in.
- [Enterprise Edition](/docs/self-hosted/enterprise): Wat bewaringsoverschrijvingen meebrengen.
:::
