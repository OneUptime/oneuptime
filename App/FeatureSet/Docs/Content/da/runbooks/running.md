# Kør et runbook

Der er tre måder, en runbook-kørsel kan opstå:

1. **Automatisk via en regel** — se [Runbook-regler](/docs/runbooks/rules).
2. **Manuelt fra runbook'ets side** — klik **Kør nu** på et runbook'ets oversigt. Ikke knyttet til nogen hændelse, alarm eller vedligehold.
3. **Manuelt fra en entitets-feed** — klik **Kør runbook** på en hændelse, alarm eller planlagt vedligeholdshændelse. Kørslen er knyttet til den entitet.

## Kørselsvisningen

Åbn en hvilken som helst kørsel for at se tjekliste-UI'en. Hvert trin viser:

- **Status** — Afventer, Kører, Venter på dig, Færdig, Sprunget over, Fejlet.
- **Titel og beskrivelse** — kopieret fra runbook'et ved udførelsen.
- **Output** (kan foldes ud) — stdout, returværdier, HTTP-svar.
- **Fejlmeddelelse**, hvis trinnet fejlede.
- For manuelle trin i `WaitingForUser`: knapperne **Markér som færdig** og **Spring over**.

Mens kørslen ikke er afsluttende, opdaterer siden hver 3. sekund, så du ser automatiserede trin afslutte næsten i realtid.

## Vekslen mellem manuelle og automatiserede trin

Det klassiske flow:

1. **Script-trin**: fang systemtilstand, skriv til S3.
2. **Manuelt trin**: "Underret kunder via banner på statussiden." Responderen tikker af.
3. **HTTP-trin**: tilkald DBA via PagerDuty.
4. **Manuelt trin**: "Bekræft at sekundær DB nu er primær." Responderen tikker af.
5. **Script-trin**: send "alt klart"-besked i Slack.

Trin 2 og 4 sætter kørslen på pause indtil afkrydsning. Trin 1, 3, 5 kører automatisk. Hele forløbet er én kørsel, én tidslinje, én kilde til sandhed.

## Afbryd en kørsel

Klik **Afbryd kørsel** på siden. Det aktuelle trin (hvis nogen) afsluttes; efterfølgende trin starter ikke. Statussen bliver `Cancelled`.

## Bevaring af output

Output per trin er begrænset til **50 KB** for at forhindre løbske scripts i at sprænge databasen. Har du brug for større artefakter, skriv dem fra scriptet til S3 eller en logger og gem URL'en i returværdien.

## Kør et runbook igen

En kørsel er en engangs- og uforanderlig optagelse. For at gentage klikker du **Kør nu** igen — det skaber en frisk kørsel med et nyt snapshot af runbook'ets aktuelle trin. Den oprindelige kørsel forbliver intakt til revisionssporet.

## Find tidligere kørsler

Hvert runbook har en fane **Kørsler**, der lister alle dets kørsler med filtre for status, datointerval og kildeentitet. På en hændelse, alarm eller vedligehold viser fanen **Runbooks** kørsler knyttet til den entitet.
