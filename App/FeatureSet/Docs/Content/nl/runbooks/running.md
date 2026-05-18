# Een runbook uitvoeren

Er zijn drie manieren waarop een runbook-uitvoering wordt aangemaakt:

1. **Automatisch via een regel** — zie [Runbook-regels](/docs/runbooks/rules).
2. **Handmatig vanuit de runbook-pagina** — klik op **Nu uitvoeren** op de overzichtspagina van een runbook. Niet gekoppeld aan enig incident, alert of gepland onderhoudsevent.
3. **Handmatig vanuit een entiteitsfeed** — klik op **Runbook uitvoeren** op een incident, alert of gepland onderhoudsevent. De uitvoering wordt aan die entiteit gekoppeld.

## De uitvoeringsweergave

Open een willekeurige uitvoering om de checklist-UI te zien. Elke stap toont:

- **Statuslabel** — Pending, Running, Wacht op jou, Done, Skipped, Failed.
- **Titel en beschrijving** — bij uitvoering gekopieerd uit het runbook.
- **Output** (inklapbaar) — stdout, returnwaarden, HTTP-responses.
- **Foutmelding** als de stap faalde.
- Voor handmatige stappen in `WaitingForUser`: **Markeer als voltooid**- en **Overslaan**-knoppen.

De pagina pollt elke 3 seconden zolang de uitvoering niet terminal is, dus je ziet geautomatiseerde stappen bijna real-time afronden.

## Handmatige en geautomatiseerde stappen afwisselen

De klassieke flow:

1. **Scriptstap**: systeemstatus vastleggen, naar S3 schrijven.
2. **Handmatige stap**: "Klanten informeren via de statuspagina-banner." Responder vinkt af.
3. **HTTP-stap**: DBA pagen via PagerDuty.
4. **Handmatige stap**: "Bevestig dat de secundaire DB nu primary is." Responder vinkt af.
5. **Scriptstap**: stuur het all-clear-Slack-bericht.

Stappen 2 en 4 pauzeren de uitvoering tot ze afgevinkt zijn. Stappen 1, 3, 5 draaien automatisch. De hele run is één uitvoering, één tijdlijn, één bron van waarheid.

## Een run annuleren

Klik op **Uitvoering annuleren** op de uitvoeringspagina. De huidige stap (indien aanwezig) maakt af; volgende stappen starten niet. Status wordt `Cancelled`.

## Output-retentie

Output per stap is beperkt tot **50KB** om te voorkomen dan op hol geslagen scripts de database opblazen. Heb je grotere artefacten nodig, schrijf ze dan vanuit het script naar S3 of een logger en sla de URL op in de returnwaarde.

## Een runbook opnieuw uitvoeren

Een runbook-uitvoering is een eenmalig, onveranderlijk record. Om opnieuw uit te voeren, klik opnieuw op **Nu uitvoeren** — dat maakt een verse uitvoering aan met een verse snapshot van de huidige stappen van het runbook. De originele uitvoering blijft intact voor het audit-spoor.

## Vroegere uitvoeringen vinden

Elk runbook heeft een **Executions**-tabblad met al zijn runs, met filters voor status, datumbereik en bronentiteit. Op een incident, alert of gepland onderhoudsevent toont het **Runbooks**-tabblad de runs die aan die entiteit gekoppeld zijn.
