# Runbook-regler

Runbook-regler knytter automatisk runbooks, når en **hændelse**, en **alarm** eller en **planlagt vedligeholdshændelse** oprettes. De håndteres fra hver entitets indstillingsmenu:

- Hændelser → Indstillinger → **Runbook-regler**
- Alarmer → Indstillinger → **Runbook-regler**
- Planlagt vedligehold → Indstillinger → **Runbook-regler**

Alle tre sider redigerer den samme underliggende regelmodel — de er bare filtreret, så de kun viser regler for den pågældende entitetstype.

## Anatomi af en regel

| Felt                          | Formål                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **Navn**                      | Kort, læsbart label. Vises i revisionslogs.                                              |
| **Beskrivelse**               | Valgfri kontekst til kolleger.                                                           |
| **Aktiveret**                 | Slå til/fra for at suspendere en regel uden at slette den.                               |
| **Titelmønster**              | Case-uafhængigt regex matchet mod entitetens titel. Tom = match alle titler.             |
| **Beskrivelsesmønster**       | Case-uafhængigt regex matchet mod entitetens beskrivelse. Tom = match alle beskrivelser. |
| **Runbooks der skal startes** | Et eller flere runbooks der startes, når reglen udløses.                                 |

## Match-semantik

En regel matcher, når **alle angivne kriterier opfyldes**. Tomme kriterier springes over, så:

- En regel uden satte mønstre kører ved hver hændelse af sin type (en global "kør altid"-regel).
- En regel med kun et titelmønster udløses på hændelser, hvis titel matcher det regex.
- Flere regler kan matche den samme hændelse — hver match udløses, og foreningen af deres runbooks kører (hvert runbook får sin egen kørsel).

## Eksempel: DB-failover for databasehændelser

```
Navn:                  Start DB-failover ved DB-hændelser
Trigger:               Hændelse
Titelmønster:          (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:              [DB failover playbook, Notify DBA team]
```

Dette opretter to runbook-kørsler hver gang en hændelse med "db", "database", "postgres" osv. i titlen oprettes.

## Eksempel: Always-on hygiejneregel

```
Navn:                  Always-on pre-flight check
Trigger:               Hændelse
Titelmønster:          (tom)
Beskrivelsesmønster:   (tom)
Runbooks:              [Capture pre-incident state]
```

Udløses på hver hændelse — nyttig til at fange systemtilstands-snapshots, side-metrics osv.

## Hvad der sker, når en regel udløses

1. Runbook'et indlæses.
2. Dens trin **snapshottes** ind på en ny runbook-kørsel.
3. Kørslen lægges i kø til Runbook-kø-workeren.
4. Kørslen linkes til kilde-entiteten — den dukker op på hændelsens, alarmens eller den planlagte vedligeholdsbegivenheds side og på runbook'ets kørselsliste.

Du kan se alle regel-udløste kørsler under **Runbooks → Kørsler**, filtreret på status, runbook eller dato.

## Deaktiverede runbooks

Hvis en regel refererer til et runbook med `isEnabled = false`, matcher reglen stadig, men runbook-kørslen springes over. Genaktivér runbook'et for at fortsætte.

## Test en regel

Før du forlader dig på en regel i produktion, opret en testhændelse (eller alarm) med en titel der matcher mønsteret, og bekræft at de forventede runbooks udløses. Regler evalueres i øjeblikket for oprettelse — at redigere en hændelses titel bagefter udløser ikke reglerne igen.
