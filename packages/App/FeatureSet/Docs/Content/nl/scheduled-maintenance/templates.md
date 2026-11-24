# Sjablonen en terugkerende gebeurtenissen

Een sjabloon voor gepland onderhoud bewaart een gebeurtenis die je vaak plant: haar titel en beschrijving, de monitoren die ze pauzeert, de statuspagina's waarop ze verschijnt en wie bericht krijgt. Gebruik er een om het formulier met één klik in te vullen, of maak het terugkerend, zodat OneUptime de gebeurtenis voor je plant, elke week, elke maand of met elke tussenpoos die je kiest.

:::cards
- [Een sjabloon maken](#een-sjabloon-maken): De stappen van het formulier, met een naam vooraan en een planning aan het eind.
- [Een sjabloon gebruiken](#een-sjabloon-gebruiken): Een nieuwe gebeurtenis ermee invullen.
- [Terugkerende gebeurtenissen](#terugkerende-gebeurtenissen): Laat OneUptime de gebeurtenis zelf plannen.
- [Een sjabloon wijzigen of stoppen](#een-sjabloon-wijzigen-of-stoppen): Bewerken, de planning pauzeren of verwijderen.
:::

## Hoe het werkt

Een sjabloon is een vertrekpunt. Een gebeurtenis die ermee is gemaakt, is een kopie met eigen waarden: als je het sjabloon later wijzigt, veranderen alleen de gebeurtenissen die daarna worden gemaakt.

```mermaid title="Twee manieren waarop een sjabloon een gebeurtenis wordt"
flowchart TB
    template["Een sjabloon<br/>in Onderhoudssjablonen"] --> byhand["Maken op basis<br/>van sjabloon<br/>vult het formulier in"]
    template --> schedule["Terugkerend aan<br/>elke minuut gecontroleerd"]
    byhand --> event["Een nieuwe gebeurtenis<br/>in Gepland"]
    schedule --> event
```

## Voordat je begint

- **Je abonnement.** In OneUptime Cloud vragen sjablonen het abonnement **Growth** of hoger.
- **Je rol.** Een sjabloon maken vraagt **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Onderhoudsbeheerder** of **Onderhoudslid**, of een aangepaste rol die sjablonen voor gepland onderhoud mag maken.

## Een sjabloon maken

:::steps
### De sjablonen openen

Ga naar **Gepland onderhoud → Instellingen → Onderhoudssjablonen**. **Instellingen** is in het zijmenu eerst ingeklapt: klap het eerst uit. Klik op **Sjabloon voor gepland onderhoud aanmaken**.

### Het sjabloon een naam geven

Geef het onder **Sjablooninformatie** een **Sjabloonnaam** en een **Sjabloonbeschrijving**, zodat je team weet wanneer het te gebruiken. Beide zijn verplicht.

### De gebeurtenis beschrijven

Vul onder **Onderhoudsgegevens** de **Titel** en de **Beschrijving** in waarmee elke gebeurtenis ervan begint. **Eigenaren** en **Labels** wachten onder **Meer velden**.

### Kiezen wat het raakt

Kies onder **Getroffen middelen** de **Monitoren**, de **Monitorstatus wijzigen naar** voor hen, eventuele **Andere getroffen resources**, de statuspagina's onder **Gebeurtenis weergeven op deze statuspagina's** en de **Meldingen aan abonnees**.

### Beslissen of het terugkeert

Laat onder **Terugkerend** de schakelaar **Terugkerende gebeurtenis** uit voor een sjabloon dat je met de hand gebruikt, of zet hem aan, kies hoe vaak het terugkeert en zijn **Tijdzone**, en stel de tijden van de eerste gebeurtenis in onder **Eerste gebeurtenis**. Klik op **Volgende** om de controle na te lopen en maak dan het sjabloon.
:::

Een sjabloon vraagt om **Monitorstatus wijzigen naar**, ook als het geen monitoren noemt: de status geldt ook voor de monitoren die je toevoegt wanneer je er een gebeurtenis mee plant. Onder **Andere getroffen resources** neemt een sjabloon hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services aan.

## Wat een sjabloon invult

| Deel van de gebeurtenis                           | Maken op basis van sjabloon          | Een terugkerende gebeurtenis    |
| ------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **Titel** en **Beschrijving**                     | Ingevuld, en je kunt ze wijzigen     | Gekopieerd                      |
| **Monitoren** en **Monitorstatus wijzigen naar**  | Ingevuld                             | Gekopieerd                      |
| **Andere getroffen resources**                    | Ingevuld                             | Gekopieerd                      |
| De statuspagina's en **Meldingen aan abonnees**   | Ingevuld                             | Gekopieerd                      |
| **Eigenaren** en **Labels**                       | Ingevuld                             | Gekopieerd                      |
| **Begint op** en **Eindigt op**                   | Het volgende hele uur, voor een uur  | Berekend uit de planning        |

## Een sjabloon gebruiken

:::steps
### Het sjabloon kiezen

Klik op **Gepland onderhoud → Alle onderhoudsgebeurtenissen** op **Maken op basis van sjabloon** en kies een sjabloon onder **Selecteer sjabloon voor gepland onderhoud**.

### Het formulier nalopen

Klik op **Maken op basis van sjabloon**. Het formulier opent met de antwoorden van het sjabloon al ingevuld. Stel het venster in en wijzig wat deze gebeurtenis nodig heeft.

### De gebeurtenis maken

Loop de stappen door met **Volgende** en klik dan in de controle op **Onderhoudsgebeurtenis aanmaken**.
:::

Als het project nog geen sjabloon heeft, zegt **Maken op basis van sjabloon** dat en verwijst het naar **Onderhoudssjablonen**.

## Terugkerende gebeurtenissen

Een terugkerend sjabloon maakt de gebeurtenis volgens een planning aan. Je legt vast hoe vaak het terugkeert, welke tijdzone het aanhoudt, en wanneer de eerste gebeurtenis wordt gemaakt, wanneer ze begint en wanneer ze eindigt; elke volgende gebeurtenis is de eerste, hele intervallen verschoven in de kalender van die tijdzone, op dezelfde tijden van de dag.

| Veld                                     | Wat het betekent                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Terugkerende gebeurtenis**             | Zet de planning aan.                                                                                |
| **Hoe vaak wilt u dat deze gebeurtenis zich herhaalt?** | Een getal en een eenheid: uren, dagen, weken, maanden of jaren.                      |
| **Tijdzone**                             | De tijdzone waarin de gebeurtenissen hun tijd van de dag houden. Een nieuw sjabloon begint met de jouwe. |
| **Eerste gebeurtenis gepland op**        | Wanneer OneUptime de eerste gebeurtenis maakt, en dus wanneer haar abonnees horen dat ze gepland is. |
| **Eerste gebeurtenis begint om**         | Wanneer de eerste gebeurtenis begint.                                                               |
| **Eerste gebeurtenis eindigt om**        | Wanneer de eerste gebeurtenis eindigt.                                                              |

De eerste drie staan in de stap **Terugkerend**. De tijden van de eerste gebeurtenis staan in de stap **Eerste gebeurtenis**, die verschijnt zodra **Terugkerende gebeurtenis** aan staat.

Bijvoorbeeld een wekelijks venster waarvan de eerste gebeurtenis op een maandag wordt gemaakt voor de zaterdag erna:

| Gebeurtenis  | Gemaakt            | Begint             | Eindigt            |
| ------------ | ------------------ | ------------------ | ------------------ |
| De eerste    | `2030-06-03 09:00` | `2030-06-08 02:00` | `2030-06-08 04:00` |
| De tweede    | `2030-06-10 09:00` | `2030-06-15 02:00` | `2030-06-15 04:00` |

Elke gebeurtenis houdt de tijden van de dag van de eerste gebeurtenis in de tijdzone van het sjabloon, ook als de klok wordt verzet voor de zomertijd: een venster van 02:00 tot 04:00 in Berlijn ligt daar in de zomer en in de winter van 02:00 tot 04:00. Een paar dagen lopen zo:

- **Een dag die de maand niet heeft.** Een maandelijkse gebeurtenis op de 29e, 30e of 31e valt op de laatste dag van een kortere maand, zoals 30 april of 28 februari, en weer op haar eigen dag in de maanden die die dag hebben. Een jaarlijkse gebeurtenis op 29 februari valt in andere jaren op 28 februari.
- **De nacht waarin de klok vooruit gaat.** Een tijd die die nacht niet bestaat, zoals 02:30 als 02:00 naar 03:00 springt, schuift met de sprong op, naar 03:30. Een gebeurtenis waarvan het begin daardoor voorbij haar einde schuift, houdt de lengte van de eerste gebeurtenis.
- **De nacht waarin de klok terug gaat.** Een tijd die die nacht twee keer voorkomt, zoals 01:30 in New York, is de eerste van de twee.
- **Om de paar uur.** Uren worden geteld zoals ze verstrijken, dus een sjabloon dat om de paar uur terugkeert, schuift een uur op de klok als die wordt verzet.
- **Een tijdzone zonder zomertijd.** Een tijdzone die de klok niet meer verzet, zoals die van Brits-Columbia (America/Vancouver) sinds november 2026, houdt hetzelfde verschil, dus er verschuift niets.

Een sjabloon dat is gemaakt voordat sjablonen een tijdzone hadden, toont **UTC**, de tijdzone waarin de gebeurtenissen tot dan toe werden berekend. Kies de tijdzone waarin de tijden bedoeld waren, en vanaf de volgende gebeurtenis houdt elke gebeurtenis daar de tijd van de dag van de eerste gebeurtenis.

Zet **Eerste gebeurtenis gepland op** zo ver vóór het begin als je wilt dat je klanten van het werk horen. Alle drie de tijden moeten in de toekomst liggen wanneer je het sjabloon maakt, de gebeurtenis moet worden gemaakt voordat ze begint en eindigt, en ze moet beginnen voordat ze eindigt; het formulier zegt welke regel een tijd overtreedt.

Een taak controleert de terugkerende sjablonen elke minuut. Wanneer de volgende tijd van een sjabloon aanbreekt, maakt ze de gebeurtenis en schuift ze die tijd op naar de volgende gebeurtenis van de planning. De sjabloonlijst toont die tijd in haar kolom **Terugkerende gebeurtenis**, en **Nee** voor een sjabloon dat niet terugkeert. Een gebeurtenis die door de planning is gemaakt, is als elke andere: haar regels draaien, haar eigenaren worden toegevoegd en haar abonnees horen dat ze gepland is.

## Een sjabloon wijzigen of stoppen

Open een sjabloon uit de lijst om de pagina ervan te zien:

- **Sjabloondetails voor gepland onderhoud** toont waarmee nieuwe gebeurtenissen beginnen. Het **Bewerken** ervan loopt door **Sjablooninformatie**, **Onderhoudsgegevens**, **Statuspagina's** en **Terugkerend**, en daarna **Eerste gebeurtenis** voor een sjabloon dat terugkeert.
- **Getroffen resources** bevat de **Monitoren**, hun **Monitorstatus wijzigen naar** en de **Andere getroffen resources**, met een eigen **Bewerken**.
- **Eigenaren** toont de personen en teams van wie elke gebeurtenis is die ermee wordt gepland.

Wijzigingen gelden voor de gebeurtenissen die worden gemaakt nadat je ze opslaat; gebeurtenissen die al bestaan, houden hun eigen waarden. Om een planning te stoppen, zet je **Terugkerende gebeurtenis** uit in **Bewerken**, of verwijder je het sjabloon. Een uitgezet sjabloon houdt zijn planning: zet je het weer aan, dan gaat het verder op de volgende tijd van de planning en slaat het de tijden over waarin het uit stond. Als je een sjabloon verwijdert, blijven de gebeurtenissen die het heeft gemaakt bestaan.

## Probleemoplossing

:::details Bij het maken van een terugkerend sjabloon staat er dat een tijd in de toekomst moet liggen
Alle drie de eerste tijden moeten bij het maken na het huidige moment liggen. Schuif ze naar voren: de planning gaat daarna verder vanaf de eerste gebeurtenis.
:::

:::details Een terugkerend sjabloon heeft geen gebeurtenis gemaakt
Controleer of **Terugkerende gebeurtenis** nog aanstaat, en kijk naar de tijd in de kolom **Terugkerende gebeurtenis** van de lijst: de gebeurtenis wordt dan gemaakt, niet op haar begin. De taak draait elke minuut, dus wacht een minuut.
:::

:::details Gebeurtenissen uit een terugkerend sjabloon zijn na het verzetten van de klok een uur te vroeg of te laat
Open het sjabloon en controleer zijn **Tijdzone**: de gebeurtenissen houden de tijd van de dag van de eerste gebeurtenis in die tijdzone. Een sjabloon dat is gemaakt voordat sjablonen een tijdzone hadden, toont **UTC**: kies de tijdzone waarin de tijden bedoeld waren. Gebeurtenissen die al zijn gemaakt, houden hun tijden.
:::

:::details Een gebeurtenis van een sjabloon mist een resource die ik had gekozen
Onder **Andere getroffen resources** neemt een sjabloon hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services aan. Voeg andere soorten resources aan de gebeurtenis zelf toe, met **Bewerken** op haar kaart **Getroffen resources**.
:::

## Volgende stappen

:::cards
- [Onderhoudsgebeurtenissen maken](/docs/scheduled-maintenance/creating-events): Het formulier dat een sjabloon invult.
- [Onderhoudsstatussen](/docs/scheduled-maintenance/states): Hoe elke gebeurtenis verdergaat zodra ze is gemaakt.
- [Onderhoudsregels en instellingen](/docs/scheduled-maintenance/settings): Elke nieuwe gebeurtenis automatisch eigenaren en labels geven.
- [Gepland onderhoud – Overzicht](/docs/scheduled-maintenance/index): Waar sjablonen passen in de rest van het onderhoud.
:::
