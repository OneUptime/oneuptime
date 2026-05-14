# Handmatige Monitor

Handmatige monitoring stelt u in staat monitors te maken waarvan de status volledig handmatig of via de API wordt beheerd. OneUptime voert geen geautomatiseerde controles uit — u beheert de monitorstatus rechtstreeks.

## Overzicht

Handmatige monitors zijn plaatshouders die u zelf bijwerkt. Dit is nuttig voor:

- Integratie met externe monitoringtools die de status bijwerken via de OneUptime API
- Bijhouden van diensten of systemen die niet automatisch kunnen worden bewaakt
- Beheren van incidenten voor componenten zonder geautomatiseerde gezondheidscontroles
- Vertegenwoordigen van afhankelijkheden van derden waarvan u de status handmatig bijhoudt

## Een Handmatige Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Handmatig** als het monitortype
4. Voer een naam en beschrijving in voor de monitor

## Hoe het werkt

Handmatige monitors hebben geen monitoringintervallen, probes of geautomatiseerde criteriaevaluatie. De monitorstatus blijft zoals u deze heeft ingesteld totdat u deze wijzigt.

### Status bijwerken

U kunt de status van een handmatige monitor op twee manieren bijwerken:

- **Dashboard** — Wijzig de monitorstatus rechtstreeks vanuit het OneUptime-dashboard
- **API** — Werk de monitorstatus programmatisch bij via de OneUptime API

### Incidenten en meldingen

U kunt incidenten en meldingen aanmaken voor handmatige monitors, net als bij elk ander monitortype. Hiermee kunt u:

- Uitvaltijd bijhouden voor extern bewaakte diensten
- Incidenten handmatig aanmaken wanneer problemen worden gemeld
- Handmatige monitors op statuspagina's gebruiken om de status aan gebruikers te communiceren

## Wanneer handmatige monitors gebruiken

| Gebruiksscenario | Beschrijving |
|----------|-------------|
| Diensten van derden | De status bijhouden van externe diensten waarvan u afhankelijk bent maar die u niet direct kunt bewaken |
| Fysieke infrastructuur | Hardware of fysieke systemen vertegenwoordigen zonder netwerkmonitoring |
| Bedrijfsprocessen | Niet-technische processen bijhouden die de dienststatus beïnvloeden |
| API-gestuurde status | Externe tools laten de monitorstatus bijwerken via de OneUptime API |
| Statuspagina-plaatshouders | Componenten weergeven op uw statuspagina die buiten OneUptime worden beheerd |
