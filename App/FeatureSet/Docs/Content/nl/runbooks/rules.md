# Runbook-regels

Runbook-regels koppelen runbooks automatisch zodra een **incident**, **alert** of **gepland onderhoudsevent** wordt aangemaakt. Ze worden beheerd vanuit het Settings-menu van elke entiteit:

- Incidents → Settings → **Runbook Rules**
- Alerts → Settings → **Runbook Rules**
- Scheduled Maintenance → Settings → **Runbook Rules**

Alle drie de pagina's bewerken hetzelfde onderliggende regelmodel — ze zijn alleen gefilterd om enkel regels voor dat entiteitstype te tonen.

## Anatomie van een regel

| Veld | Doel |
| --- | --- |
| **Naam** | Kort, leesbaar label. Verschijnt in audit-logs. |
| **Beschrijving** | Optionele context voor teamleden. |
| **Ingeschakeld** | Schakelaar om een regel te pauzeren zonder te verwijderen. |
| **Titelpatroon** | Hoofdletterongevoelige regex die wordt afgespeeld op de titel van de entiteit. Leeg = elke titel matcht. |
| **Beschrijvingpatroon** | Hoofdletterongevoelige regex die wordt afgespeeld op de beschrijving van de entiteit. Leeg = elke beschrijving matcht. |
| **Te starten runbooks** | Eén of meer runbooks die starten wanneer de regel afgaat. |

## Match-semantiek

Een regel matcht wanneer **alle gespecificeerde criteria slagen**. Lege criteria worden overgeslagen, dus:

- Een regel zonder ingestelde patronen draait bij elk event van zijn type (een globale "altijd draaien"-regel).
- Een regel met alleen een titelpatroon gaat af bij events waarvan de titel die regex matcht.
- Meerdere regels kunnen op hetzelfde event matchen — elke match gaat af, en de unie van hun runbooks draait (elk runbook krijgt zijn eigen uitvoering).

## Voorbeeld: DB-failover voor database-incidenten

```
Name:           Start DB-failover voor DB-incidenten
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB-failover playbook, DBA-team informeren]
```

Dit zal elke keer twee runbook-uitvoeringen aanmaken wanneer een incident met "db", "database", "postgres", enz. in de titel wordt aangemaakt.

## Voorbeeld: Always-run hygiëne-regel

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (leeg)
Description Pattern:  (leeg)
Runbooks:             [Pre-incident-status vastleggen]
```

Gaat af bij elk incident — handig voor het vastleggen van snapshots van de systeemstatus, pagina-metrics, enz.

## Wat er gebeurt wanneer een regel afgaat

1. Het runbook wordt geladen.
2. Zijn stappen worden naar een nieuwe runbook-uitvoering **gesnapshot**.
3. De uitvoering wordt in de queue van de runbook-queue-worker gezet.
4. De uitvoering wordt gekoppeld aan de bron-entiteit — hij verschijnt op de pagina van het incident, het alert of het geplande onderhoudsevent en op de Executions-lijst van het runbook.

Je ziet alle door regels getriggerde runs onder **Runbooks → Executions**, gefilterd op status, runbook of datum.

## Uitgeschakelde runbooks

Als een regel verwijst naar een runbook met `isEnabled = false`, matcht de regel nog steeds maar wordt de runbook-uitvoering overgeslagen. Schakel het runbook weer in om te hervatten.

## Een regel testen

Voordat je in productie op een regel leunt, maak een test-incident (of -alert) met een titel die het patroon matcht en bevestig dat de verwachte runbooks afgaan. Regels worden geëvalueerd op het moment van aanmaken — het later bewerken van de incidenttitel triggert regels niet opnieuw.
