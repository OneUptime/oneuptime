# Bereikbaarheidsschema's

Een bereikbaarheidsschema bepaalt wie op elk moment bereikbaar is. De mensen erin wisselen elkaar af: ieder is een tijd bereikbaar, daarna neemt de volgende het over. Voeg een schema toe aan de escalatieregels van een bereikbaarheidsbeleid, en het beleid roept op dat niveau op wie in het schema bereikbaar is.

## Wie elkaar afwisselen

Als u op de pagina **Bereikbaarheidsschema's** een schema maakt, vraagt het formulier om de **Naam** en **Wie wisselen elkaar af?**. Klik op **Gebruiker toevoegen** en kies de mensen in de volgorde waarin ze elkaar afwisselen: ze zijn om de beurt bereikbaar, en de eerste is bereikbaar zodra het schema is gemaakt. Ze vormen de eerste laag van het schema, **Layer 1**, de klok rond bereikbaar. Het nieuwe schema opent daarna op de pagina **Lagen**, waar u de rotatie kunt wijzigen of meer lagen kunt toevoegen.

**Wie wisselen elkaar af?** is optioneel. Laat u het leeg, dan begint het schema zonder lagen: het maakt niemand bereikbaar tot u een laag toevoegt op de pagina **Lagen**. De vraag wordt alleen gesteld aan wie lagen mag toevoegen.

Al het andere staat onder **Geavanceerd**, ingeklapt tot u het opent:

- **Elke beurt duurt**: **1 dag**, **1 week**, **2 weken** of **1 maand**, en **1 week** tenzij u het wijzigt. Het wordt gevraagd zodra er iemand is gekozen. Ieder is zo lang bereikbaar, daarna neemt de volgende het over, op het tijdstip waarop het schema is gemaakt.
- **Tijdzone**: de tijdzone waarin overdrachtstijden en bereikbaarheidsuren gelden. Die begint op de uwe.
- **Beschrijving** en **Labels**.

Zolang er iemand is gekozen en onder **Geavanceerd** niets is gewijzigd, zegt de ingeklapte kop wat er gaat gebeuren: iedereen is een week bereikbaar, daarna neemt de volgende het over.

## Lagen

De rotatie van een schema bestaat uit lagen, op de pagina **Lagen**. Lagen worden van boven naar beneden gelezen: de hoogste laag waarin iemand bereikbaar is, is de laag die oproept. Zet de hoofdrotatie dus bovenaan en de reservedekking daaronder.

**Laag toevoegen** voegt een laag toe die begint zoals de eerste: vanaf nu bereikbaar, ieder een week, de klok rond. Klap een laag uit om er mensen aan toe te voegen en om te wijzigen wanneer ze begint, hoe vaak ze overdraagt, wanneer ze voor het eerst overdraagt en op welke uren ze bereikbaar is.

## Schema's maken met de API of Terraform

Bereikbaarheidsschema's zijn de resource `/api/on-call-duty-policy-schedule`; hun lagen en de mensen erin zijn de resources `/api/on-call-duty-schedule-layer` en `/api/on-call-duty-schedule-layer-user`.

- Een schema maken met `firstLayerUsers` (een lijst met gebruikers-id's, in de volgorde waarin ze elkaar afwisselen) in de `miscDataProps` geeft het zijn eerste laag, zoals het dashboard doet: **Layer 1**, vanaf nu bereikbaar, de klok rond. `firstLayerRotation` zegt hoe lang elke beurt duurt, als een rotatie zoals `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; zonder is dat een week. Elke gebruiker moet lid zijn van het project en de aanroeper moet lagen mogen maken, anders wordt het schema niet gemaakt.
- Een schema dat zonder deze gegevens wordt gemaakt, heeft zoals voorheen geen lagen; de schemaresource van Terraform stuurt ze niet mee.
- Een laag die zonder `rotation` wordt gemaakt, draagt zoals altijd dagelijks over.
