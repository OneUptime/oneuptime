# Een runbook uitvoeren

Er zijn drie manieren waarop een runbook-uitvoering ontstaat:

1. **Automatisch via een regel** — zie [Runbook-regels](/docs/runbooks/rules).
2. **Handmatig vanaf de runbook-pagina** — klik **Nu uitvoeren** op het overzicht van een runbook. Niet gekoppeld aan een incident, alert of onderhoud.
3. **Handmatig vanaf een entiteits-feed** — klik **Runbook uitvoeren** op een incident, alert of gepland onderhoudsevent. De uitvoering is aan die entiteit gekoppeld.

## De uitvoeringsweergave

Open een uitvoering om de checklist-UI te zien. Elke stap toont:

- **Status** — In wacht, Bezig, Wacht op jou, Klaar, Overgeslagen, Mislukt.
- **Titel en beschrijving** — gekopieerd uit het runbook op het moment van uitvoering.
- **Uitvoer** (in te klappen) — stdout, retourwaarden, HTTP-responsen.
- **Foutmelding** als de stap mislukt is.
- Voor handmatige stappen in `WaitingForUser`: knoppen **Markeer als klaar** en **Overslaan**.

Zolang de uitvoering niet terminaal is, ververst de pagina elke 3 seconden, dus zie je geautomatiseerde stappen vrijwel realtime afronden.

## Handmatige en geautomatiseerde stappen mengen

De klassieke flow:

1. **Script-stap**: systeemtoestand vastleggen, naar S3 schrijven.
2. **Handmatige stap**: "Klanten via de statuspagina-banner informeren." Responder vinkt af.
3. **HTTP-stap**: DBA piepen via PagerDuty.
4. **Handmatige stap**: "Bevestig dat de secundaire DB primary is." Responder vinkt af.
5. **Script-stap**: "alles weer veilig"-bericht in Slack sturen.

Stappen 2 en 4 pauzeren de uitvoering tot het afvinken. Stappen 1, 3, 5 draaien automatisch. De hele run is één uitvoering, één tijdlijn, één bron van waarheid.

## Een uitvoering annuleren

Klik **Uitvoering annuleren** op de pagina. De huidige stap (indien aanwezig) wordt afgerond; volgende stappen starten niet. De status wordt `Cancelled`.

## Behoud van uitvoer

De uitvoer per stap is gelimiteerd op **50 KB** om te voorkomen dat op hol geslagen scripts de database opblazen. Heb je grotere artefacten nodig, schrijf ze dan vanuit het script naar S3 of een logger en bewaar de URL in de retourwaarde.

## Een runbook opnieuw uitvoeren

Een uitvoering is een eenmalig, onveranderlijk record. Voor een herhaling klik je nogmaals **Nu uitvoeren** — dat maakt een verse uitvoering met een nieuwe snapshot van de huidige stappen. De oorspronkelijke uitvoering blijft intact voor het auditspoor.

## Eerdere uitvoeringen vinden

Elk runbook heeft een tabblad **Uitvoeringen** met al zijn runs, te filteren op status, datumbereik en bron-entiteit. Op een incident, alert of onderhoud toont het **Runbooks**-tabblad de runs die aan die entiteit hangen.
