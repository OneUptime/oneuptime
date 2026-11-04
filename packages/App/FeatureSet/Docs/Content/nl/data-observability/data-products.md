# Dataproducten

De mensen die gegevens gebruiken - analisten, finance, directie, AI-agents - denken in wat ze gebruiken: "de tabellen van het omzetdashboard", niet in databases. Een **dataproduct** geeft die tabellen een naam, met een eigenaar, afnemers en een actualiteits-SLA, en vertelt iedereen die ervan afhankelijk is of de gegevens van vandaag binnen zijn.

## Een dataproduct aanmaken

Maak onder **Data Observability > Dataproducten** een dataproduct aan: geef het een naam, kies de tabellen, en geef het een SLA met een van de volgende twee, of met allebei:

- **Bijgewerkt vóór een tijdstip van de dag (UTC):** de gegevens van elke dag komen die dag binnen, vóór dat tijdstip. Vanaf dat tijdstip moet elke tabel die dag zijn gewijzigd; tot dan geldt de load van gisteren. Een load die altijd een half uur te laat is, is elke dag dat halve uur te laat.
- **Een maximale leeftijd:** de laatste wijziging van geen enkele tabel mag ouder zijn dan dit.

Elke vijf minuten worden de tabellen van elk product getoetst aan de SLA ervan. Het product is **Te laat** wanneer een van de tabellen te laat is, en de stand van zijn gegevens is die van de oudste laatste wijziging onder de tabellen. Het schrijft `oneuptime.data.product.late_tables` en `oneuptime.data.product.data_age`, zodat je de actualiteit van alle producten naast elkaar in een grafiek kunt zetten.

## Op statuspagina's

Bij het opslaan van een product wordt er ook een **monitor** voor gemaakt, op jouw naam en met jouw machtigingen. De monitor staat op Verminderd zolang een tabel te laat is, en opent een incident en een waarschuwing op het minst ernstige niveau van je project, die vanzelf worden opgelost. Voeg hem als resource toe aan een statuspagina, privé of openbaar: afnemers die zich abonneren, horen wanneer het product te laat is, en wanneer het weer actueel is. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).

## Als SLO

Bij het opslaan van een product wordt er ook een **SLO** over zijn monitor gemaakt: het deel van de tijd dat de gegevens op tijd zijn, afgezet tegen het doel van het product over 30 dagen, met de waarschuwingen voor snelle en trage verbruikssnelheid waarmee elke SLO begint. Zie [SLO's](/docs/slo/introduction). Als je het product verwijdert, worden zijn monitor en zijn SLO ook verwijderd.

## De badge "data as of"

Elk product heeft een **badge** die zegt van wanneer zijn gegevens zijn, groen zolang ze op tijd zijn en oranje met "late" zodra dat niet meer zo is. Sluit hem in een BI-dashboard, een wikipagina of een README in vanuit het **Overzicht** van het product:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

De link vereist geen aanmelding, dus behandel hem als een gedeelde link. **Badgelink opnieuw instellen** maakt een nieuwe aan en trekt de oude in.

## Volgende stappen

:::cards
- [Gezondheid van tabellen](/docs/data-observability/table-health): Hoe de actualiteit van elke tabel wordt geleerd.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Laat AI-agents de tabellen van een product controleren voordat ze die gebruiken.
:::
