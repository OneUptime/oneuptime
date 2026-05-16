# Runbook-regels

Runbook-regels koppelen runbooks automatisch zodra een **incident**, **alert** of **gepland onderhoudsevent** wordt aangemaakt. Ze worden beheerd vanuit het instellingenmenu van elke entiteit:

- Incidenten → Instellingen → **Runbook-regels**
- Alerts → Instellingen → **Runbook-regels**
- Gepland onderhoud → Instellingen → **Runbook-regels**

Alle drie de pagina's bewerken hetzelfde onderliggende regelmodel — ze zijn alleen gefilterd zodat je enkel de regels voor dat entiteitstype ziet.

## Anatomie van een regel

| Veld | Doel |
| --- | --- |
| **Naam** | Korte, leesbare aanduiding. Verschijnt in auditlogs. |
| **Beschrijving** | Optionele context voor teamgenoten. |
| **Ingeschakeld** | Schakelaar om een regel te pauzeren zonder hem te verwijderen. |
| **Titelpatroon** | Hoofdletterongevoelige regex tegen de titel van de entiteit. Leeg = elke titel matcht. |
| **Beschrijvingspatroon** | Hoofdletterongevoelige regex tegen de beschrijving van de entiteit. Leeg = elke beschrijving matcht. |
| **Runbooks om te starten** | Eén of meer runbooks die worden gestart als de regel afgaat. |

## Match-semantiek

Een regel matcht zodra **alle opgegeven criteria slagen**. Lege criteria worden overgeslagen:

- Een regel zonder patronen draait bij elk event van dat type (globale "altijd uitvoeren"-regel).
- Een regel met alleen een titelpatroon vuurt bij events waarvan de titel op de regex matcht.
- Meerdere regels kunnen op hetzelfde event matchen — elke match vuurt en de unie van hun runbooks draait (elk runbook krijgt zijn eigen uitvoering).

## Voorbeeld: DB-failover bij database-incidenten

```
Naam:           DB-failover starten bij DB-incidenten
Trigger:        Incident
Titelpatroon:   (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB-failover playbook, DBA-team informeren]
```

Dit maakt twee runbook-uitvoeringen elke keer dat een incident met "db", "database", "postgres" enz. in de titel wordt aangemaakt.

## Voorbeeld: altijd-actieve hygiëne-regel

```
Naam:                        Pre-flight check bij elk incident
Trigger:                     Incident
Titelpatroon:                (leeg)
Beschrijvingspatroon:        (leeg)
Runbooks:                    [Pre-incident toestand vastleggen]
```

Vuurt bij elk incident — handig om systeemtoestanden, paginametrics enz. vast te leggen.

## Wat er gebeurt wanneer een regel afgaat

1. Het runbook wordt geladen.
2. Zijn stappen worden als **snapshot** naar een nieuwe runbook-uitvoering gekopieerd.
3. De uitvoering wordt in de Runbook-worker-queue gezet.
4. De uitvoering wordt aan de bron-entiteit gekoppeld — hij verschijnt op de pagina van het incident, de alert of het onderhoud, en in de uitvoeringenlijst van het runbook.

Je ziet alle door regels getriggerde runs onder **Runbooks → Uitvoeringen**, filterbaar op status, runbook of datum.

## Uitgeschakelde runbooks

Verwijst een regel naar een runbook met `isEnabled = false`, dan matcht de regel nog steeds maar de uitvoering wordt overgeslagen. Schakel het runbook weer in om door te gaan.

## Een regel testen

Voordat je in productie op een regel vertrouwt, maak je een testincident (of -alert) met een titel die op het patroon matcht en controleer je of de verwachte runbooks afgaan. Regels worden geëvalueerd op het moment van aanmaken — een titel later bewerken triggert de regels niet opnieuw.
