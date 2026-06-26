# Kjøringer & logger

Hver gang en arbeidsflyt kjører, lagrer OneUptime et register over hva som skjedde — når den kjørte, om den fungerte, og hva hver blokk gjorde. Det registeret kalles en **kjøring**. Kjøringer er hvordan du bekrefter at en arbeidsflyt fungerte, feilsøker en som ikke gjorde det, og ser tilbake på tidligere aktivitet.

## Hvor du finner dem

| Side                                   | Hva du ser                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Arbeidsflyter → Kjøringer & logger** | Hver kjøring fra hver arbeidsflyt i prosjektet. Filtrer etter arbeidsflyt, status og tid. |
| **Arbeidsflyt → Logger-fanen**         | Bare kjøringene av denne ene arbeidsflyten.                                               |
| **En enkelt kjøring**                  | Én eksekvering, med utdata fra hver blokk.                                                |

## Kjøringsstatuser

| Status          | Hva det betyr                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planlagt**    | Triggeren ble utløst og kjøringen er i ferd med å starte. Tar vanligvis bare en brøkdel av et sekund.                                        |
| **Kjører**      | Arbeidsflyten er i gang. Langvarige blokker holder en kjøring i denne tilstanden.                                                            |
| **Suksess**     | Hver blokk som kjørte ble ferdig uten feil. (Å ta en **feil**-gren med vilje regnes fortsatt som suksess — selve arbeidsflyten feilet ikke.) |
| **Feil**        | En blokk feilet og det var ingen **feil**-bane koblet til for å håndtere det. Kjøringen stoppet der.                                         |
| **Tidsavbrudd** | Kjøringen kjørte lenger enn tillatt. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration).                                          |

## Lese en kjøring

Klikk på en hvilken som helst kjøring for å åpne detaljene. Du vil se:

- **Header** — triggeren, start- og sluttid, total varighet og status.
- **Blokkliste** — hver blokk som kjørte, i rekkefølge. Hver enkelt viser verdiene den fikk, utdata, og hvilken bane den tok.
- **Feil** — hvis en blokk feilet, feilmeldingen og (når tilgjengelig) flere detaljer.

Verdiene som vises er nøyaktig det blokken så — etter at alle variabler ble fylt inn. Dette er den mest nyttige feilsøkingsvisningen: hvis en Slack-melding viser den bokstavelige teksten `{{Incident.title}}` i stedet for den faktiske tittelen, vet du at variabelen ikke ble løst opp.

## Vanlig feilsøking

### "Arbeidsflyten min kjørte ikke."

1. Sørg for at arbeidsflyten er **aktivert** i Innstillinger. Nye arbeidsflyter starter deaktivert.
2. For en OneUptime-hendelsestrigger: bekreft at hendelsen faktisk skjedde. Åpne oppføringen og sjekk historikken.
3. For en webhook-trigger: bekreft at det andre systemet sender til riktig URL. De fleste verktøy logger når de sender en webhook — sjekk der.
4. For en tidsplan-trigger: bekreft at cron-uttrykket matcher tidspunktet du forventer.

Hvis triggeren ble utløst, men ingen kjøring dukker opp, sjekk kjøringskvoten din under **Prosjektinnstillinger → Fakturering**.

### "En senere blokk kjørte aldri."

En blokk som ikke kjører er vanligvis et koblingsproblem. Åpne lerretet og sjekk:

- Er den tidligere blokkens utgang koblet til denne blokkens inngang?
- Tok den tidligere blokken en annen utgang enn du forventet (for eksempel **feil** i stedet for **suksess**, eller **Nei** i stedet for **Ja**)? Kjøringsdetaljen viser hvilken bane som ble tatt.

### "En variabel kom gjennom som tom."

Åpne kjøringen og se på verdiene til den feilende blokken.

- Hvis du ser den bokstavelige teksten `{{BlockName.field}}`, ble ikke referansen løst — sannsynligvis en skrivefeil i blokkens navn eller feltnavn.
- Hvis du ser en tom streng, kjørte den tidligere blokken, men produserte ikke det feltet.

### "Det fungerer når jeg kjører det manuelt, men ikke fra triggeren."

Bruk **Kjør manuelt** med en JSON-nyttelast som ser ut som det den ekte triggeren sender. Sammenlign så verdiene i den manuelle kjøringen med den ekte kjøringen side om side. Forskjellen er vanligvis ett enkelt feltnavn eller datatype.

## Kjøre en arbeidsflyt på nytt

Det finnes ingen "prøv denne kjøringen på nytt"-knapp. Vi kjører ikke gamle eksekveringer på nytt automatisk fordi bivirkningene (Slack-meldinger, API-kall, saker) kanskje ikke er trygge å gjenta. For å gjøre arbeidet om igjen, fiks arbeidsflyten og la den neste ekte triggeren utløse den.

For manuelle arbeidsflyter, klikk bare **Kjør manuelt** med samme nyttelast.

## Hvor lenge oppbevares kjøringer?

Kjøringer oppbevares på ubestemt tid for prosjektet. Hvis en arbeidsflyt kjører veldig ofte og roter til historikken din (som en feilsøkings-arbeidsflyt som utløses hvert minutt), deaktiver eller slett den for å slutte å legge til støy.

## Hvor du leser videre

- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — tidsavbrudd, rekursjonsgrenser, skjulte hemmeligheter.
- [Variabler](/docs/workflows/variables) — variabelsyntaksen som brukes i blokkene dine.
- [Komponenter](/docs/workflows/components) — hva hver blokk produserer.
