# Kjøringer og logger

Hver gang en arbeidsflyt kjører, lagrer OneUptime en oversikt over hva som skjedde — når den kjørte, om den fungerte, og hva hver blokk gjorde. Denne oversikten kalles en **kjøring**. Kjøringer er hvordan du bekrefter at en arbeidsflyt fungerte, feilsøker en som ikke gjorde det, og ser tilbake på tidligere aktivitet.

## Hvor du finner dem

| Side                          | Hva du ser                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Arbeidsflyter → Kjøringer og logger** | Alle kjøringer fra alle arbeidsflyter i prosjektet. Filtrer etter arbeidsflytnavn, status og tidspunkt. |
| **Arbeidsflyt → Kjøringer og logger**  | Bare kjøringene til denne ene arbeidsflyten. Denne har et **Kjøre-ID**-filter i stedet for et arbeidsflytfilter. |
| **En enkelt kjøring**          | Åpnes med **Vis logger**-knappen på en kjøringsrad — selve kjøringsradene er ikke klikkbare.            |

## Kjøringsstatuser

| Status                              | Hva det betyr                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planlagt**                       | Triggeren utløste, og kjøringen står i kø for en runner. Vanligvis en brøkdel av et sekund. En kjøring som fortsatt er planlagt etter 5 minutter, har feilet — ingen tok tak i den. |
| **Kjører**                         | Arbeidsflyten er i gang. Langvarige blokker holder en kjøring i denne tilstanden.                                                                        |
| **Venter**                         | Kjøringen er parkert på en **Sleep**-blokk og gjenopptar av seg selv. Den opptar ingen worker mens den venter.                                            |
| **Executed**                        | Kjøringen nådde slutten uten å feile. (Dette er suksesstilstanden — pillen viser **Executed**, ikke «Success».)                                            |
| **Feil**                           | Kjøringen stoppet fordi en blokk kastet en feil. Brukes også når en kjøring i kø aldri blir tatt tak i, når gjenopptak av en sovende kjøring går tapt, når et schedule-uttrykk ikke kan tolkes, eller når arbeidsflyten deaktiveres midt i en kjøring. |
| **Timeout**                         | Kjøringen varte lenger enn tillatt. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).                                                        |
| **Execution Exceeded Current Plan** | Prosjektet har brukt opp arbeidsflytkjøringene sine for de siste 30 dagene, eller abonnementet er ubetalt. Kjøringen registreres, men blir ikke utført. Kun for OneUptime Cloud. |

En blokk som fører videre til sin **Feil**-utgang — en API-blokk på en 4xx, for eksempel — får ikke kjøringen til å feile. Feilgrenen kjører, og kjøringen ender likevel som **Executed**. Selve steget tegnes fortsatt i rødt, slik at du kan finne det.

## Lese en kjøring

Klikk **Vis logger** på en kjøring for å åpne den. **Workflow Run**-visningen har to faner.

**Trinn** — én rad per blokk som kjørte, i rekkefølge. Hver rad viser blokkens tittel, dens komponent-id, hvor lang tid den brukte, og utgangen den forlot via (`→ success`, `→ error`, `→ yes`). Utvid en rad for to detaljblokker:

- **Received** — innstillingene blokken fikk, etter at alle variabler var løst opp.
- **Returned** — hva den produserte.

Feilede steg er røde og starter utvidet, med feilmeldingen skrevet over **Received**.

**Full Log** — den rå, linje-for-linje-loggen runneren skrev ut, inkludert alt blokkene selv logget. Bruk den når Steps-visningen ikke forklarer feilen.

To detaljer verdt å kjenne til. Komponent-id-en som skrives under hver steg-tittel, er nøyaktig strengen du limer inn i en `{{local.components.<id>.returnValues.…}}`-referanse, noe som gjør dette til den raskeste måten å få en referanse riktig på. Og en kjøring beholder bare sine siste 100 steg — en lang eller gjentatte ganger gjenopptatt kjøring viser et gult varsel der de tidligere ble droppet.

Verdiene som vises, er det blokken så etter at variabler var fylt inn, med to unntak: hemmeligheter og felt blokken merker som sensitive, er sladdet, og svært lange verdier kuttes med «… (truncated)».

Å starte en kjøring fra **Bygger** åpner denne samme visningen mens den allerede følger kjøringen, slik at du kan se det skje i stedet for å måtte lete opp kjøringen etterpå.

## Vanlig feilsøking

### «Arbeidsflyten min kjørte ikke.»

1. Sjekk at arbeidsflyten er **Aktivert** på sin **Oversikt**-side. Nye arbeidsflyter starter deaktivert, og en deaktivert arbeidsflyt avviser alle kjøringer — inkludert manuelle.
2. For en OneUptime-hendelsestrigger: bekreft at hendelsen faktisk skjedde. Åpne posten og sjekk historikken.
3. For en webhook-trigger: bekreft at det andre systemet sender til riktig URL. De fleste verktøy logger når de sender en webhook — sjekk der.
4. For en schedule-trigger: bekreft at cron-uttrykket stemmer med tidspunktet du forventer.

Hvis kjøringen *faktisk* dukker opp med statusen **Execution Exceeded Current Plan**, har prosjektet brukt opp alle arbeidsflytkjøringene sine for de siste 30 dagene, eller abonnementet er ubetalt. Kjøringens logg oppgir antallet og planens grense. Dette gjelder kun for OneUptime Cloud.

### «Et senere blokk kjørte aldri.»

En blokk som ikke kjører, er vanligvis et koblingsproblem. Åpne **Bygger** og sjekk:

- Er den tidligere blokkens utgang koblet til denne blokkens inngang?
- Tok den tidligere blokken en annen utgang enn du forventet — **Feil** i stedet for **Suksess**, eller **No** i stedet for **Yes**? Steps-fanen viser hvilken den tok.

### «En variabel kom gjennom tom.»

Åpne kjøringen og se på det feilede stegets **Received**-blokk.

- Hvis du ser den bokstavelige teksten `{{local.components.…}}`, ble ikke referansen løst opp. Vanligvis er det en skrivefeil i komponent-id-en eller retur­verdi-id-en — husk at det er blokkens **Identifier**, ikke navnet som vises på den. Sjekk også stavemåten på selve `local.components`: `{{local.componets.api-get-1.returnValues.response-body}}` sendes som bokstavelig tekst, og kjøringen rapporterer likevel **Executed**.
- Hvis du ser en tom streng, kjørte den tidligere blokken, men produserte ikke det feltet.

**Full Log**-fanen inneholder en advarselslinje som navngir enhver referanse som ikke ble løst opp, noe som vanligvis er den raskeste måten å finne den på.

### «Det fungerer når jeg kjører det manuelt, men ikke fra triggeren.»

Åpne **Bygger**, klikk **Kjør arbeidsflyt**, og fyll inn triggerens felter med verdier som ligner det den ekte triggeren sender. Sammenlign så den kjøringens **Received**-verdier med den ekte kjøringens, side om side. Forskjellen er vanligvis ett enkelt feltnavn eller en enkelt felttype.

## Kjøre en arbeidsflyt på nytt

Det finnes ingen «prøv denne kjøringen på nytt»-knapp. Vi kjører ikke gamle eksekveringer på nytt automatisk fordi bivirkningene — Slack-meldinger, API-kall, saker — kanskje ikke er trygge å gjenta. For å gjøre arbeidet om igjen, fiks arbeidsflyten og la neste ekte trigger utløse den, eller åpne **Bygger** og klikk **Kjør arbeidsflyt** med de samme verdiene.

## Hvor lenge oppbevares kjøringer?

På OneUptime Cloud oppbevares kjøringer i **30 dager** og slettes deretter — det er derfor begge kjøringslistene beskriver seg selv som å dekke de siste 30 dagene. Selvhostede installasjoner beholder kjøringer til du sletter dem; hvis en arbeidsflyt kjører svært ofte og roter til historikken din, deaktiver eller slett den for å slutte å legge til støy.

Kjøringer registrert før steg-sporing ble lagt til, har ikke noe **Trinn**-innhold og viser bare sin **Full Log**.

## Hvor du leser videre

- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — tidsavbrudd, rekursjonsgrenser, skjulte hemmeligheter.
- [Variabler](/docs/workflows/variables) — variabelsyntaksen som brukes i blokkene dine.
- [Komponenter](/docs/workflows/components) — hva hver blokk produserer.
