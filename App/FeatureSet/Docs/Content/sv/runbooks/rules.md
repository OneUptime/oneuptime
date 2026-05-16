# Runbook-regler

Runbook-regler kopplar automatiskt runbooks när en **incident**, ett **larm** eller en **planerad underhållshändelse** skapas. De hanteras från Inställningar-menyn på varje entitet:

- Incidenter → Inställningar → **Runbook-regler**
- Larm → Inställningar → **Runbook-regler**
- Planerat underhåll → Inställningar → **Runbook-regler**

Alla tre sidor redigerar samma underliggande regelmodell — de är bara filtrerade så att endast regler för respektive entitetstyp visas.

## Anatomi av en regel

| Fält | Syfte |
| --- | --- |
| **Namn** | Kort, läsbar etikett. Visas i revisionsloggar. |
| **Beskrivning** | Frivillig kontext för kollegor. |
| **Aktiverad** | Brytare för att pausa en regel utan att ta bort den. |
| **Titelmönster** | Versalokänslig regex mot entitetens titel. Tomt = alla titlar matchar. |
| **Beskrivningsmönster** | Versalokänslig regex mot entitetens beskrivning. Tomt = alla beskrivningar matchar. |
| **Runbooks att starta** | Ett eller flera runbooks som lanseras när regeln utlöses. |

## Match-semantik

En regel matchar när **alla angivna kriterier uppfylls**. Tomma kriterier hoppas över:

- En regel utan mönster körs på varje händelse av sin typ (global "kör alltid"-regel).
- En regel med enbart titelmönster utlöses på händelser där titeln matchar regex'et.
- Flera regler kan matcha samma händelse — varje match utlöses, och unionen av deras runbooks körs (varje runbook får sin egen körning).

## Exempel: DB-failover vid databasincidenter

```
Namn:            Starta DB-failover vid DB-incidenter
Utlösare:        Incident
Titelmönster:    (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:        [DB-failover playbook, Meddela DBA-team]
```

Detta skapar två runbook-körningar varje gång en incident med "db", "database", "postgres" osv. i titeln skapas.

## Exempel: always-on hygienregel

```
Namn:                  Pre-flight vid varje incident
Utlösare:              Incident
Titelmönster:          (tomt)
Beskrivningsmönster:   (tomt)
Runbooks:              [Fånga förincident-tillstånd]
```

Utlöses vid varje incident — användbart för att fånga systemtillstånd, sidmätvärden osv.

## Vad händer när en regel utlöses

1. Runbooken laddas.
2. Stegen kopieras som **snapshot** in i en ny runbook-körning.
3. Körningen läggs i Runbook-workerns kö.
4. Körningen kopplas till källentiteten — den syns på sidan för incidenten, larmet eller underhållet och i runbookens körningslista.

Du ser alla regelutlösta körningar under **Runbooks → Körningar**, filtrerbara på status, runbook eller datum.

## Inaktiverade runbooks

Om en regel refererar ett runbook med `isEnabled = false` matchar regeln fortfarande, men körningen hoppas över. Aktivera runbooken igen för att återuppta.

## Testa en regel

Innan du förlitar dig på en regel i produktion skapar du en testincident (eller test-larm) med en titel som matchar mönstret och bekräftar att förväntade runbooks utlöses. Regler utvärderas vid skapandet — att redigera en incidents titel senare återutlöser inte regler.
