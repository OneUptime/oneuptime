# Ingestiebudgetten

Een ingestiebudget begrenst hoeveel telemetrie een project per dag verstuurt, zodat één luidruchtige service of een op hol geslagen logboeklus uw opslag niet kan vullen. De instantiebeheerder stelt voor elk signaal een dagbudget in, voor elk project of voor één project, en iedereen die een ingestiesleutel bewerkt, kan de sleutel een kleiner eigen budget geven. Elk budget kan ook een snelheidslimiet per seconde hebben.

:::cards
- [Hoe budgetten werken](#hoe-budgetten-werken): Drie niveaus, geteld terwijl de telemetrie binnenkomt.
- [De standaardbudgetten van elk project instellen](#de-standaardbudgetten-van-elk-project-instellen): In de instellingen van het Admin Dashboard.
- [Een ingestiesleutel een eigen budget geven](#een-ingestiesleutel-een-eigen-budget-geven): Een deel van het budget van het project.
- [Waarschuwen op een budget](#waarschuwen-op-een-budget): Voordat het op is, en wanneer het op is.
:::

## Hoe budgetten werken

Telemetrie wordt geteld terwijl ze binnenkomt: tegen het budget van haar project voor haar signaal, en tegen dat van haar ingestiesleutel als de sleutel er een heeft. Zodra een dagbudget op is, wordt dat signaal geweigerd tot het budget wordt gereset.

```mermaid title="Wat OneUptime controleert voordat het telemetrie opslaat"
flowchart TB
    request["Telemetrie komt binnen<br/>met een<br/>ingestiesleutel"] --> budget{"Budget van vandaag<br/>op?"}
    budget -->|"Ja"| refused["Geweigerd met 403<br/>tot de reset"]
    budget -->|"Nee"| rate{"Sneller dan de<br/>snelheidslimiet?"}
    rate -->|"Ja"| throttled["Geweigerd met 429:<br/>de afzender probeert<br/>het opnieuw"]
    rate -->|"Nee"| counted["Geteld, daarna<br/>opgeslagen"]
```

- **Drie niveaus.** De standaard van de instantie geldt voor elk project. De instantiebeheerder kan één project in plaats daarvan een eigen budget geven, of helemaal geen limiet. Het budget van een sleutel is alleen een onderverdeling van dat van zijn project: het kan kleiner zijn, nooit groter.
- **Vijf signalen.** Logboeken, traces, metrieken, profielen en beveiligingsgebeurtenissen hebben elk een eigen budget. Sessieherhalingen hebben eigen limieten: zie [Sessieherhaling](/docs/telemetry/session-replay).
- **Bytes worden gedecomprimeerd geteld.** Een verzoek telt de grootte van zijn body na decompressie, dus comprimeren verandert niet wat het telt. Een GB is 1024³ bytes, en een MB 1024² bytes.
- **Wat binnenkomt telt, niet wat wordt opgeslagen.** Telemetrie die een [drop-filter](/docs/telemetry/drop-filters-and-scrub-rules) later verwijdert, telt toch mee, dus een budget kan meer aangeven dan de pagina [Telemetriegebruik](/docs/telemetry/usage), die telt wat is opgeslagen.
- **Het laatste verzoek wordt in zijn geheel opgeslagen.** Een verzoek dat binnenkomt terwijl een budget nog ruimte heeft, wordt volledig opgeslagen, dus een opgebruikt budget kan iets boven 100% uitkomen.
- **Niets wordt beperkt tot er een budget is ingesteld.** Elke installatie begint zonder budgetten, en een project zonder budget wordt helemaal niet geteld.
- **Wijzigingen bereiken elke server binnen een minuut.**
- **Telemetrie wordt geaccepteerd als ze niet kan worden geteld.** De budgetten worden in Valkey geteld. Zolang Valkey niet bereikbaar is, slaat OneUptime telemetrie op zonder ze te tellen in plaats van ze te weigeren, en de budgetpagina's melden dat.

## Voordat u begint

- **Voor de budgetten van de instantie en van een project: het Admin Dashboard.** Op een zelfgehoste installatie stelt alleen de instantiebeheerder ze in. De eigenaren en beheerders van een project zien de budgetten ervan, maar kunnen ze niet wijzigen.
- **Voor het eigen budget van een sleutel: een rol die ingestiesleutels bewerkt.** Project Owner of Project Admin, of een aangepaste rol met de machtiging Edit Ingestion Key.
- **Om de budgetten te zien: een rol die het gebruik van het project ziet.** De rollen die de pagina [Telemetriegebruik](/docs/telemetry/usage) zien, zien daar ook de budgetten.

## De standaardbudgetten van elk project instellen

:::steps
### Ingestiebudgetten openen

Ga in het Admin Dashboard naar **Instellingen → Telemetrie → Ingestiebudgetten**. **Telemetrie** staat in het zijmenu eerst ingeklapt: klik erop om het te openen.

### De dagbudgetten instellen

Klik op de kaart **Standaard dagbudgetten** op **Standaard dagbudgetten bewerken**, vul voor elk signaal dat u wilt beperken een aantal GB in, zoals **Logboeken (GB per dag)**, en klik op **Wijzigingen opslaan**. Laat een signaal leeg voor geen limiet.

### De snelheidslimieten instellen, als u ze nodig hebt

Klik op de kaart **Standaard snelheidslimieten** op **Standaard snelheidslimieten bewerken** en vul voor een signaal een aantal MB per seconde in, zoals **Logboeken (MB per seconde)**. Een snelheidslimiet voorkomt dat één piek het budget van een dag in enkele minuten opmaakt.
:::

De kaart **Waarschuwing en reset** bevat de waarschuwingsdrempel en het tijdstip waarop de budgetdag wordt gereset: zie [De waarschuwing en de reset](#de-waarschuwing-en-de-reset).

## De budgetten van één project instellen

:::steps
### Het project openen

Ga in het Admin Dashboard naar **Projecten**, klik op het project en klik in het zijmenu ervan op **Ingestiebudgetten**. De pagina opent met wat het project vandaag van zijn budgetten heeft gebruikt.

### Zijn dagbudgetten instellen

Klik op de kaart **Dagbudgetten voor dit project** op **Dagbudgetten bewerken**. Vul voor een signaal een aantal GB in in plaats van de instantiestandaard, of 0 voor helemaal geen limiet. Laat een signaal leeg om de instantiestandaard te behouden.

### Zijn snelheidslimieten instellen

Klik op de kaart **Snelheidslimieten voor dit project** op **Snelheidslimieten bewerken** en stel ze op dezelfde manier in: een aantal MB per seconde, 0 voor geen limiet, of leeg voor de instantiestandaard.
:::

De leden van het project zien deze budgetten op hun pagina [Telemetriegebruik](/docs/telemetry/usage), alleen-lezen.

## Een ingestiesleutel een eigen budget geven

Het budget van een sleutel is een deel van dat van zijn project: een afzender die zijn eigen sleutel overspoelt, stopt bij het budget van de sleutel, terwijl de andere sleutels van het project blijven verzenden.

:::steps
### De sleutel openen

Ga naar **Projectinstellingen → Telemetrie & APM → Ingestiesleutels** en klik op de sleutel. **Telemetrie & APM** staat in het zijmenu eerst ingeklapt: klik erop om het te openen.

### Zijn budgetten instellen

Klik op de kaart **Ingestiebudgetten** op **Ingestiebudgetten bewerken**. Vul in de stap **Dagbudgetten** voor elk signaal dat u wilt beperken een aantal GB per dag in, en in de stap **Snelheidslimieten** een aantal MB per seconde. Laat een signaal leeg als de sleutel er geen eigen budget voor krijgt.

### De budgetten opslaan

Klik op **Wijzigingen opslaan**. Het budget van een sleutel kan niet hoger zijn dan dat van zijn project: OneUptime weigert het en zegt wat het maximum is.
:::

- **Beide budgetten tellen.** Telemetrie die met de sleutel wordt verzonden, telt tegen het budget van de sleutel en dat van het project, en het budget dat het eerst op is, weigert haar.
- **Een verlaagd projectbudget geldt ook voor de sleutel.** Wanneer het budget van het project onder dat van een sleutel wordt verlaagd, wordt de sleutel aan dat van het project gehouden.

## Wat afzenders zien

| Wanneer | Via HTTP | Via OTLP/gRPC | Wat de afzender doet |
| --- | --- | --- | --- |
| Een dagbudget is op | `403` | `RESOURCE_EXHAUSTED` | Laat de batch vallen: opnieuw proberen helpt niet vóór de reset |
| Een snelheidslimiet wordt overschreden | `429` met `Retry-After` | `RESOURCE_EXHAUSTED` met een wachttijd voor een nieuwe poging | Probeert de batch opnieuw na de wachttijd |

Elke weigering zegt waarom. Via OTLP/HTTP is de body een `google.rpc.Status`, in protobuf of JSON, zoals het verzoek werd verzonden, dus het log van de afzender toont een reden zoals:

```text
This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.
```

- **Andere HTTP-afzenders krijgen JSON.** Fluent Bit, Fluentd, syslog en de andere HTTP-endpoints krijgen `error`, `message` en `resetsAt`, en bij een snelheidslimiet ook `retryAfterSeconds`.
- **MQTT en cloudstreams kunnen het niet te horen krijgen.** Telemetrie die via MQTT of uit de stream van een cloudprovider binnenkomt, wordt verworpen zodra het budget ervan op is. Er geldt geen snelheidslimiet voor: ze zou niet opnieuw kunnen worden verzonden.
- **Weigeringen worden geteld.** Wat een opgebruikt budget weigert of verwerpt, wordt geteld als verworpen, en elk verzoek dat een snelheidslimiet weigert als beperkt: zie [Het gebruik en de verworpen gegevens van vandaag bekijken](#het-gebruik-en-de-verworpen-gegevens-van-vandaag-bekijken).

## De waarschuwing en de reset

- **De waarschuwing.** Wanneer een dagbudget de waarschuwingsdrempel passeert, 80% tenzij de instantiebeheerder dat wijzigt, krijgen de eigenaren van het project een e-mail, en tonen de explorers een banner boven de gegevens van dat signaal. Ze krijgen nog een e-mail wanneer het budget op is. Elk budget verstuurt elke e-mail hooguit één keer per dag.
- **De reset.** Elke budgetdag begint opnieuw om 00:00 UTC, tenzij de instantiebeheerder dat wijzigt. De kaart **Waarschuwing en reset** stelt **Waarschuwingsdrempel (%)** in, van 1 tot 99, **Resettijd**, als HH:MM, en **Tijdzone van de reset**: klik op **Waarschuwing en reset bewerken**.
- **Zomertijd.** De reset volgt de klok van de tijdzone, dus de budgetdag waarop de klok wordt verzet, is een uur korter of langer. Een resettijd die de klok overslaat, valt even lang na de sprong.
- **Een gewijzigde reset begint een nieuwe dag.** Het wijzigen van de resettijd of de tijdzone begint meteen een nieuwe budgetdag, waarin nog niets is geteld.

## Het gebruik en de verworpen gegevens van vandaag bekijken

Ga naar **Projectinstellingen → Telemetrie & APM → Gebruik**. Zolang er een budget of een snelheidslimiet voor het project is ingesteld, opent de pagina met de kaart **Ingestiebudgetten**, en staan de sleutels met een eigen budget op de kaart **Budgetten van ingestiesleutels**:

| Kolom | Wat die toont |
| --- | --- |
| **Signaal** | Het signaal waarvoor de rij geldt. |
| **Vandaag gebruikt** | Wat er sinds het begin van de budgetdag is geteld, en welk deel van het budget dat is. |
| **Dagbudget** | Het budget dat geldt, en waar het is ingesteld: **Instantiestandaard**, **Ingesteld voor dit project** of **Eigen budget van deze sleutel**. |
| **Snelheidslimiet** | De snelheidslimiet die geldt. |
| **Verworpen** | Wat is geweigerd of verworpen omdat het budget op was. |
| **Beperkt** | Hoeveel verzoeken de snelheidslimiet heeft geweigerd. |
| **Status** | **Binnen budget**, **Waarschuwing bereikt** of **Opgebruikt**, **Geen dagbudget** voor een signaal met alleen een snelheidslimiet, en **Onbekend** zolang de tellingen niet kunnen worden gelezen. |

- **Op de pagina van een sleutel** toont de kaart **Budgetgebruik van vandaag** wat de sleutel van zijn eigen budgetten heeft gebruikt.
- **In de explorers** meldt een banner boven de gegevens van logboeken, traces, metrieken, profielen en beveiligingsgebeurtenissen wanneer het budget van dat signaal zijn waarschuwing voorbij is of op is, met **Budgetten bekijken** om de pagina Gebruik te openen.
- **In het Admin Dashboard** toont de pagina **Ingestiebudgetten** van een project dezelfde cijfers.

## Waarschuwen op een budget

Elke 5 minuten schrijft OneUptime de cijfers van de dag van elk budget als metrieken van het project, en een [metrics-monitor](/docs/monitor/metrics-monitor) waarschuwt erop zoals op elke andere metriek:

| Metriek | Eenheid | Wat het bevat |
| --- | --- | --- |
| `oneuptime.telemetry.budget.used.bytes` | `By` | De bytes die sinds het begin van de budgetdag tegen het dagbudget zijn geteld. |
| `oneuptime.telemetry.budget.used.percent` | `%` | Hetzelfde, als percentage van het dagbudget. Bij 100 of meer wordt het signaal geweigerd tot de reset. |
| `oneuptime.telemetry.budget.dropped.bytes` | `By` | De bytes die sinds het begin van de budgetdag zijn geweigerd of verworpen omdat het budget op was. |
| `oneuptime.telemetry.budget.throttled.requests` | `{request}` | De verzoeken die de snelheidslimiet sinds het begin van de budgetdag heeft geweigerd. |

Elk punt heeft deze attributen:

| Attribuut | Waarde |
| --- | --- |
| `projectId` | De ID van het project. |
| `signal` | `logs`, `traces`, `metrics`, `profiles` of `security-events`. |
| `scope` | `project`, of `ingestion-key` voor het eigen budget van een sleutel. |
| `ingestionKeyId` | De ID van de sleutel, voor het eigen budget van een sleutel. |
| `ingestionKeyName` | De naam van de sleutel toen het punt werd geschreven, voor het eigen budget van een sleutel. |

Om bij 90% van het logboekbudget van het project te worden gewaarschuwd, maakt u een metrics-monitor op `oneuptime.telemetry.budget.used.percent`, gefilterd op `signal` `logs` en `scope` `project`, die waarschuwt wanneer het maximum boven 90 ligt:

- **Aggregeer met het maximum.** Elk cijfer groeit alleen tijdens een budgetdag.
- **Gebruik een venster van 15 minuten of meer.** Er wordt elke 5 minuten een punt geschreven, en een venster zonder punt lost de waarschuwing op.
- **Verwacht gaten, geen nullen.** Er wordt niets geschreven voor een cijfer dat 0 is, of zolang de tellingen niet kunnen worden gelezen.
- **Ze kosten niets.** Deze metrieken tellen niet mee voor een budget of als telemetriegebruik, en worden net zo lang bewaard als monitormetrieken: 30 dagen, tenzij de instantiebeheerder dat wijzigt. Metrieknamen die beginnen met `oneuptime.telemetry.budget.` zijn voor hen gereserveerd: metrieken die uw applicaties onder zo'n naam versturen, worden verworpen.

## Problemen oplossen

:::details Een collector logt 403 voor zijn exports
Het dagbudget van het project of de sleutel voor dat signaal is op, en de collector verwerpt wat hij niet kan verzenden tot het budget wordt gereset. Bekijk **Vandaag gebruikt** op de pagina Gebruik. Vraag de instantiebeheerder het budget van het project te verhogen, of verstuur minder: een drop-filter helpt hier niet, omdat die telemetrie verwijdert nadat ze is geteld.
:::

:::details Een collector logt 429 en probeert het opnieuw
Hij verstuurt sneller dan een snelheidslimiet toestaat. Hij probeert het opnieuw na de wachttijd van `Retry-After`, dus er gaat niets verloren, tenzij zijn wachtrij volloopt. Verhoog de snelheidslimiet, of spreid het verzenden gelijkmatiger.
:::

:::details Vandaag gebruikt is meer dan de pagina Telemetriegebruik toont
Een budget telt telemetrie terwijl ze binnenkomt, gedecomprimeerd, inclusief wat drop-filters later verwijderen. De pagina Gebruik telt wat is opgeslagen, de dag erna.
:::

:::details De budgetten melden dat de tellingen van vandaag niet konden worden gelezen
OneUptime kan Valkey niet bereiken, waar de budgetten worden geteld. Tot dat weer lukt, wordt telemetrie opgeslagen zonder te worden geteld, en wordt geen enkel budget afgedwongen.
:::

## Volgende stappen

:::cards
- [Telemetriegebruik](/docs/telemetry/usage): Bekijk wat elk project en elke service verstuurt.
- [Drop-filters en scrub-regels](/docs/telemetry/drop-filters-and-scrub-rules): Sla de telemetrie die u niet nodig hebt niet meer op.
- [Ingestiesleutels](/docs/telemetry/ingestion-keys): Een sleutel voor elke afzender, zodat elk een budget kan hebben.
- [Metrics-monitor](/docs/monitor/metrics-monitor): Waarschuw op de budgetmetrieken.
:::
