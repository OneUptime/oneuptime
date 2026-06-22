# Runbook-regler

Runbook-regler kopplar runbooks automatiskt när en **incident**, ett **larm** eller en **planerad underhållshändelse** skapas. De hanteras från Settings-menyn på varje entitet:

- Incidents → Settings → **Runbook Rules**
- Alerts → Settings → **Runbook Rules**
- Scheduled Maintenance → Settings → **Runbook Rules**

Alla tre sidorna redigerar samma underliggande regelmodell — de är bara filtrerade för att visa endast regler för den entitetstypen.

## Anatomin av en regel

| Fält                    | Syfte                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Namn**                | Kort, mänsklig etikett. Visas i audit-loggar.                                                                |
| **Beskrivning**         | Valfri kontext för kollegor.                                                                                 |
| **Aktiverad**           | Växel för att pausa en regel utan att radera den.                                                            |
| **Titelmönster**        | Skiftlägesokänslig regex som matchas mot entitetens titel. Tom = matchar vilken titel som helst.             |
| **Beskrivningsmönster** | Skiftlägesokänslig regex som matchas mot entitetens beskrivning. Tom = matchar vilken beskrivning som helst. |
| **Runbooks att starta** | Ett eller flera runbooks som lanseras när regeln utlöses.                                                    |

## Matchningssemantik

En regel matchar när **alla angivna kriterier passar**. Tomma kriterier hoppas över, så:

- En regel utan satta mönster körs på varje event av sin typ (en global "kör alltid"-regel).
- En regel med bara ett titelmönster utlöses på event vars titel matchar den regexen.
- Flera regler kan matcha samma event — varje match utlöses, och unionen av deras runbooks körs (varje runbook får sin egen körning).

## Exempel: DB-failover för databasincidenter

```
Name:           Starta DB-failover för DB-incidenter
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB-failover playbook, Notifiera DBA-team]
```

Detta kommer att skapa två runbook-körningar varje gång en incident med "db", "database", "postgres", etc. i titeln skapas.

## Exempel: Always-run-hygienregel

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (tomt)
Description Pattern:  (tomt)
Runbooks:             [Fånga pre-incident-tillstånd]
```

Utlöses på varje incident — användbart för att fånga snapshots av systemtillstånd, sidmätvärden, etc.

## Vad som händer när en regel utlöses

1. Runbooket laddas.
2. Dess steg **snapshot:as** in på en ny runbook-körning.
3. Körningen läggs i Runbook-köns worker.
4. Körningen länkas till käll-entiteten — den dyker upp på incidentens, larmets eller den planerade underhållshändelsens sida och på runbookets Executions-lista.

Du kan se alla regelutlösta körningar under **Runbooks → Executions**, filtrerade efter status, runbook eller datum.

## Inaktiverade runbooks

Om en regel refererar till ett runbook med `isEnabled = false` matchar regeln fortfarande, men runbook-körningen hoppas över. Återaktivera runbooket för att återuppta.

## Testa en regel

Innan du lutar dig mot en regel i produktion, skapa en testincident (eller ett testlarm) med en titel som matchar mönstret och bekräfta att de förväntade runbooks:en utlöses. Regler utvärderas i ögonblicket de skapas — att redigera en incidents titel senare triggar inte om regler.
