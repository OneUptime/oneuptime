# Runbook-regler

Runbook-regler kobler automatisk runbooks til når en **hendelse**, et **varsel** eller en **planlagt vedlikeholdshendelse** opprettes. De styres fra Innstillinger-menyen på hver entitet:

- Hendelser → Innstillinger → **Runbook-regler**
- Varsler → Innstillinger → **Runbook-regler**
- Planlagt vedlikehold → Innstillinger → **Runbook-regler**

Alle tre sider redigerer samme underliggende regelmodell — de er bare filtrert til kun å vise regler for den aktuelle entitetstypen.

## Anatomien til en regel

| Felt | Hensikt |
| --- | --- |
| **Navn** | Kort, leselig etikett. Vises i revisjonslogger. |
| **Beskrivelse** | Valgfri kontekst til kolleger. |
| **Aktivert** | Bryter for å pause en regel uten å slette den. |
| **Tittelmønster** | Regex uten bokstavssensitivitet mot entitetens tittel. Tom = enhver tittel matcher. |
| **Beskrivelsesmønster** | Regex uten bokstavssensitivitet mot entitetens beskrivelse. Tom = enhver beskrivelse matcher. |
| **Runbooks som skal starte** | Ett eller flere runbooks som lanseres når regelen utløses. |

## Match-semantikk

En regel matcher når **alle angitte kriterier er oppfylt**. Tomme kriterier hoppes over:

- En regel uten mønstre kjører på hver hendelse av sin type (global "kjør alltid"-regel).
- En regel kun med et tittelmønster utløses på hendelser der tittelen matcher regex'et.
- Flere regler kan matche samme hendelse — hver match utløses, og foreningen av deres runbooks kjører (hver runbook får sin egen kjøring).

## Eksempel: DB-failover for databasehendelser

```
Navn:           Start DB-failover ved DB-hendelser
Utløser:        Hendelse
Tittelmønster:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB-failover playbook, Varsle DBA-team]
```

Dette skaper to runbook-kjøringer hver gang en hendelse med "db", "database", "postgres" osv. i tittelen opprettes.

## Eksempel: always-on hygiene-regel

```
Navn:                   Pre-flight ved hver hendelse
Utløser:                Hendelse
Tittelmønster:          (tom)
Beskrivelsesmønster:    (tom)
Runbooks:               [Fang før-hendelses-tilstand]
```

Utløses ved hver hendelse — nyttig for å fange systemtilstand, sidemetrikker osv.

## Hva skjer når en regel utløses

1. Runbook'et lastes inn.
2. Trinnene kopieres som **snapshot** inn på en ny runbook-kjøring.
3. Kjøringen settes i Runbook-workerens kø.
4. Kjøringen kobles til kildeentiteten — den vises på siden for hendelsen, varselet eller vedlikeholdet, og i runbook'ets kjøringsliste.

Du ser alle regel-utløste kjøringer under **Runbooks → Kjøringer**, filtrerbart på status, runbook eller dato.

## Deaktiverte runbooks

Refererer en regel et runbook med `isEnabled = false`, matcher regelen fortsatt, men kjøringen hoppes over. Aktiver runbook'et igjen for å fortsette.

## Test en regel

Før du satser på en regel i produksjon, oppretter du en testhendelse (eller varsel) med en tittel som matcher mønsteret, og bekrefter at forventede runbooks utløses. Regler evalueres ved opprettelse — å redigere en hendelses tittel senere utløser ikke reglene på nytt.
