# Runbook-regler

Runbook-regler knytter automatisk runbooks, når en **hændelse**, **alarm** eller **planlagt vedligeholdshændelse** oprettes. De styres fra Indstillinger-menuen på hver entitet:

- Hændelser → Indstillinger → **Runbook-regler**
- Alarmer → Indstillinger → **Runbook-regler**
- Planlagt vedligehold → Indstillinger → **Runbook-regler**

Alle tre sider redigerer den samme underliggende regelmodel — de er bare filtreret, så kun regler for den pågældende entitetstype vises.

## Anatomien af en regel

| Felt | Formål |
| --- | --- |
| **Navn** | Kort, læsbar betegnelse. Vises i revisionslogs. |
| **Beskrivelse** | Valgfri kontekst til kolleger. |
| **Aktiv** | Skift til at pause en regel uden at slette den. |
| **Titelmønster** | Regex uden bogstavsforskel mod entitetens titel. Tom = enhver titel matcher. |
| **Beskrivelsesmønster** | Regex uden bogstavsforskel mod entitetens beskrivelse. Tom = enhver beskrivelse matcher. |
| **Runbooks at starte** | Et eller flere runbooks, der startes, når reglen udløses. |

## Match-semantik

En regel matcher, når **alle angivne kriterier opfyldes**. Tomme kriterier springes over:

- En regel uden mønstre kører på hver hændelse af sin type (global "kør altid"-regel).
- En regel med kun et titelmønster udløses på hændelser, hvis titel matcher regex'et.
- Flere regler kan matche samme hændelse — hver match udløses, og foreningen af deres runbooks kører (hvert runbook får sin egen kørsel).

## Eksempel: DB-failover for databasehændelser

```
Navn:             Start DB-failover ved DB-hændelser
Udløser:          Hændelse
Titelmønster:     (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:         [DB-failover playbook, Underret DBA-team]
```

Dette opretter to runbook-kørsler hver gang en hændelse med "db", "database", "postgres" osv. i titlen oprettes.

## Eksempel: always-on hygiejneregel

```
Navn:                  Pre-flight ved hver hændelse
Udløser:               Hændelse
Titelmønster:          (tom)
Beskrivelsesmønster:   (tom)
Runbooks:              [Fang før-hændelsestilstand]
```

Udløses på hver hændelse — nyttigt til at fange systemtilstande, sidemetrics osv.

## Hvad sker, når en regel udløses

1. Runbook'et indlæses.
2. Dets trin kopieres som **snapshot** ind på en ny runbook-kørsel.
3. Kørslen sættes i Runbook-workerens kø.
4. Kørslen knyttes til kildeentiteten — den vises på siden for hændelsen, alarmen eller vedligeholdet, og i runbook'ets kørselsliste.

Du ser alle regel-udløste kørsler under **Runbooks → Kørsler**, filtrerbar på status, runbook eller dato.

## Deaktiverede runbooks

Henviser en regel til et runbook med `isEnabled = false`, matcher reglen stadig, men kørslen springes over. Aktivér runbook'et igen for at fortsætte.

## Test en regel

Inden du satser på en regel i produktion, opretter du en testhændelse (eller alarm) med en titel, der matcher mønsteret, og bekræfter at de forventede runbooks udløses. Regler evalueres ved oprettelse — at ændre en hændelses titel senere genudløser ikke regler.
