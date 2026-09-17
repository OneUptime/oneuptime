# Kjøringer og logger

Hver gang en arbeidsflyt kjører, lagrer OneUptime en oversikt over hva som skjedde — når den kjørte, om det gikk bra, og hva hver blokk gjorde. Den oversikten kalles en **kjøring**. Kjøringer er slik du bekrefter at en arbeidsflyt virket, feilsøker en som ikke gjorde det, og ser tilbake på tidligere aktivitet.

## Hvor du finner dem

| Side                                     | Hva du ser                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Arbeidsflyter → Kjøringer og logger**  | Alle kjøringer fra alle arbeidsflyter i prosjektet. Filtrer på arbeidsflytnavn, status og tid.      |
| **Arbeidsflyt → Kjøringer og logger**    | Bare kjøringene til denne ene arbeidsflyten. Her får du et **Kjøre-ID**-filter i stedet for et arbeidsflytfilter. |
| **En enkelt kjøring**                    | Åpnes med knappen **Vis logger** på en kjøringsrad — selve radene er ikke klikkbare.                 |

## Kjøringsstatuser

| Status                             | Hva den betyr                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planlagt**                       | Triggeren fyrte, og kjøringen står i kø for en kjører. Vanligvis en brøkdel av et sekund. En kjøring som fortsatt er planlagt etter 5 minutter, er mislykket — ingen plukket den opp. |
| **Kjører**                         | Arbeidsflyten er i gang. Blokker som tar lang tid, holder kjøringen i denne tilstanden.                                                                    |
| **Venter**                         | Kjøringen står parkert på en **Sleep**-blokk og gjenopptas av seg selv. Den legger ikke beslag på noen arbeider mens den venter.                           |
| **Executed**                       | Kjøringen nådde slutten uten å feile. (Dette er suksesstilstanden — pillen sier **Executed**, ikke «Success».)                                             |
| **Feil**                           | Kjøringen stoppet fordi en blokk utløste en feil. Brukes også når en kjøring i kø aldri blir plukket opp, når gjenopptakelsen av en sovende kjøring går tapt, når et tidsplanuttrykk ikke lar seg tolke, eller når arbeidsflyten deaktiveres midt i kjøringen. |
| **Timeout**                        | Kjøringen tok lengre tid enn tillatt. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).                                                       |
| **Execution Exceeded Current Plan** | Prosjektet har brukt opp arbeidsflytkjøringene sine for de siste 30 dagene, eller abonnementet er ubetalt. Kjøringen registreres, men utføres ikke. Gjelder bare OneUptime Cloud. |

En blokk som gir stafettpinnen videre til **Feil**-utgangen sin — en API-blokk på en 4xx, for eksempel — får ikke kjøringen til å feile. Feilgrenen kjører, og kjøringen ender likevel som **Executed**. Selve trinnet tegnes fortsatt i rødt så du finner det igjen.

## Å lese en kjøring

Klikk **Vis logger** på en kjøring for å åpne den. Visningen **Workflow Run** har to faner.

**Trinn** — én rad per blokk som kjørte, i rekkefølge. Hver rad viser blokkens tittel, komponent-iden, hvor lang tid den tok, og hvilken utgang den forlot via (`→ success`, `→ error`, `→ yes`). Utvid en rad for to bolker med detaljer:

- **Received** — innstillingene blokken fikk, etter at alle variabler var løst opp.
- **Returned** — det den produserte.

Trinn som feilet, er røde og starter utvidet, med feilmeldingen skrevet ut over **Received**.

**Full Log** — den rå linje-for-linje-loggen kjøreren skrev ut, inkludert alt blokkene selv logget. Bruk den når Trinn-visningen ikke forklarer feilen.

To detaljer er verdt å kjenne til. Komponent-iden som står under hver trinntittel, er nøyaktig den strengen du skal lime inn i en `{{local.components.<id>.returnValues.…}}`-referanse, og det gjør dette til den raskeste måten å få en referanse riktig på. Og en kjøring beholder bare de siste 100 trinnene sine — en lang eller gjentatt gjenopptatt kjøring viser en gul merknad der de tidligere lå.

Verdiene du ser, er det blokken så etter at variablene var fylt inn, med to unntak: hemmeligheter og felt blokken merker som sensitive er sladdet, og svært lange verdier kuttes av med «… (truncated)».

Starter du en kjøring fra **Bygger**, åpnes denne samme visningen og følger kjøringen med en gang, så du kan se det skje i stedet for å lete den opp etterpå.

## Vanlig feilsøking

### «Arbeidsflyten min kjørte ikke.»

1. Kontroller at arbeidsflyten er **Aktivert** på **Oversikt**-siden sin. Nye arbeidsflyter starter deaktivert, og en deaktivert arbeidsflyt avviser enhver kjøring — også de manuelle.
2. For en OneUptime-hendelsestrigger: bekreft at hendelsen faktisk fant sted. Åpne posten og sjekk historikken.
3. For en webhook-trigger: bekreft at det andre systemet sender til riktig URL. De fleste verktøy logger når de sender en webhook — sjekk der.
4. For en tidsplantrigger: bekreft at cron-uttrykket treffer tidspunktet du forventer.

Dukker kjøringen *faktisk* opp med statusen **Execution Exceeded Current Plan**, har prosjektet brukt opp alle arbeidsflytkjøringene sine for de siste 30 dagene, eller abonnementet er ubetalt. Loggen til kjøringen oppgir antallet og grensen i planen din. Dette gjelder bare OneUptime Cloud.

### «En senere blokk kjørte aldri.»

En blokk som ikke kjører, skyldes som regel en koblingsfeil. Åpne **Bygger** og sjekk:

- Er utgangen på den forrige blokken koblet til inngangen på denne?
- Tok den forrige blokken en annen utgang enn du trodde — **Feil** i stedet for **Suksess**, eller **Nei** i stedet for **Ja**? Trinn-fanen viser hvilken den tok.

### «En variabel kom inn tom.»

Åpne kjøringen og se på **Received**-bolken til trinnet som feilet.

- Ser du selve teksten `{{local.components.…}}`, ble ikke referansen løst opp. Som regel er det en skrivefeil i komponent-iden eller returverdi-iden — husk at det er blokkens **Identifier**, ikke navnet som vises på den. Sjekk stavemåten på `local.components` også: `{{local.componets.api-get-1.returnValues.response-body}}` sendes som ren tekst, og kjøringen rapporterer likevel **Executed**.
- Ser du en tom streng, kjørte den forrige blokken, men produserte ikke det feltet.

Fanen **Full Log** har en advarselslinje som navngir enhver referanse som ikke ble løst opp, og det er som regel den raskeste veien til å finne den.

### «Det virker når jeg kjører den for hånd, men ikke fra triggeren.»

Åpne **Bygger**, klikk **Kjør arbeidsflyt**, og fyll triggerens felt med verdier som ligner på det den ekte triggeren sender. Sammenlign så **Received**-verdiene fra den kjøringen med den ekte kjøringens, side om side. Forskjellen er nesten alltid ett feltnavn eller én datatype.

## Å kjøre en arbeidsflyt på nytt

Det finnes ingen «kjør denne på nytt»-knapp. Vi kjører ikke gamle utførelser om igjen automatisk, fordi bivirkningene — Slack-meldinger, API-kall, saker — ikke nødvendigvis er trygge å gjenta. Vil du gjøre jobben om igjen, retter du arbeidsflyten og lar neste ekte trigger fyre den, eller du åpner **Bygger** og klikker **Kjør arbeidsflyt** med de samme verdiene.

## Hvor lenge tas kjøringer vare på?

På OneUptime Cloud beholdes kjøringer i **30 dager** og slettes så — det er derfor begge kjøringslistene beskriver seg selv som at de dekker de siste 30 dagene. Selvhostede installasjoner beholder kjøringer til du sletter dem; kjører en arbeidsflyt svært ofte og fyller opp historikken din, kan du deaktivere eller slette den for å stoppe støyen.

Kjøringer som ble registrert før trinnsporing kom, har ikke noe **Trinn**-innhold og viser bare sin **Full Log**.

## Hvor du leser videre

- [Arbeidsflyt-konfigurasjon & sikkerhet](/docs/workflows/configuration) — tidsavbrudd, rekursjonsgrenser, skjulte hemmeligheter.
- [Arbeidsflyt-variabler](/docs/workflows/variables) — variabelsyntaksen du bruker i blokkene dine.
- [Arbeidsflyt-komponenter](/docs/workflows/components) — hva hver blokk produserer.
