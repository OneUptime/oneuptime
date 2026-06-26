# Kør et runbook

Der er tre måder, hvorpå en runbook-kørsel oprettes:

1. **Automatisk via en regel** — se [Runbook-regler](/docs/runbooks/rules).
2. **Manuelt fra runbook-siden** — klik **Kør nu** på et runbook's oversigtsside. Ikke knyttet til nogen hændelse, alarm eller planlagt vedligehold.
3. **Manuelt fra et entitets-feed** — klik **Kør runbook** på en hændelse, alarm eller planlagt vedligehold. Kørslen knyttes til den entitet.

## Kørselsvisningen

Åbn en hvilken som helst kørsel for at se dens tjeklisten i UI'en. Hvert trin viser:

- **Status-mærkat** — Pending, Running, Venter på dig, Færdig, Sprunget over, Fejlede.
- **Titel og beskrivelse** — kopieret fra runbook'et på kørselstidspunktet.
- **Output** (kan foldes ud) — stdout, returværdier, HTTP-svar.
- **Fejlmeddelelse** hvis trinnet fejlede.
- For manuelle trin i `WaitingForUser`: knapperne **Marker som færdig** og **Spring over**.

Siden poller hver 3. sekund, mens kørslen ikke er terminal, så du ser automatiserede trin afsluttes næsten i realtid.

## Flette manuelle og automatiserede trin

Den klassiske flow:

1. **Script-trin**: fang systemtilstand, skriv til S3.
2. **Manuelt trin**: "Underret kunder via statussidens banner." Responderen tikker det af.
3. **HTTP-trin**: tilkald DBA'en via PagerDuty.
4. **Manuelt trin**: "Bekræft at sekundær DB nu er primary." Responderen tikker det af.
5. **Script-trin**: send "alt klart"-Slack-besked.

Trin 2 og 4 pauser kørslen, indtil de tikkes af. Trin 1, 3, 5 kører automatisk. Hele kørslen er én eksekvering, én tidslinje, én sandhedskilde.

## Annullér en kørsel

Klik **Annullér kørsel** på kørselsiden. Det aktuelle trin (hvis et) afsluttes; efterfølgende trin starter ikke. Status bliver `Cancelled`.

## Output-tilbageholdelse

Output per trin er begrænset til **50 KB** for at hindre løbske scripts i at oppuste databasen. Har du brug for større artefakter, så skriv dem til S3 eller en logger fra scriptet og gem URL'en i returværdien.

## Kør et runbook igen

En runbook-kørsel er en engangshandling, en uforanderlig record. For at køre igen, klik **Kør nu** endnu en gang — det opretter en frisk kørsel med et frisk snapshot af runbook'ets aktuelle trin. Den oprindelige kørsel forbliver intakt til revisionssporet.

## Find tidligere kørsler

Hvert runbook har en **Kørsler**-fane, der lister alle dets kørsler, med filtre for status, datointerval og kilde-entitet. Fra en hændelse, alarm eller planlagt vedligehold viser **Runbooks**-fanen kørsler knyttet til den entitet.
