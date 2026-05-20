# Kjøringer & logger

Hver gang en arbeidsflyts trigger trigges, oppretter OneUptime en **kjøring** — en post over én utførelse med tidtaking, status og output per node. Kjøringer er hvordan du bekrefter at en arbeidsflyt fungerte, hvordan du feilsøker en som ikke gjorde det, og hvordan du skriver en postmortem når en automatisering oppfører seg feil.

## Hvor du finner dem

| Side | Omfang |
| --- | --- |
| **Arbeidsflyter → Kjøringer & logger** | Prosjekt-omfattende. Hver kjøring av hver arbeidsflyt. Filtrer etter arbeidsflyt, status og tidsperiode. |
| **Logger-fanen på en arbeidsflyt** | Bare kjøringene av denne arbeidsflyten. |
| **En kjørings detaljside** | Én utførelse, utvidet med output per node og eventuelle feilmeldinger. |

## Kjøringsstatuser

| Status | Betydning |
| --- | --- |
| **Scheduled** | Triggeren trigget og kjøringen er køet, men workeren har ikke plukket den opp ennå. Vanligvis brøkdelen av et sekund. |
| **Running** | Workeren går for øyeblikket gjennom grafen. Langvarige komponenter (trege HTTP-kall, tilsiktede forsinkelser) holder en kjøring i denne tilstanden. |
| **Success** | Hver node som kjørte fullførte uten feil. (En arbeidsflyt som tok en `error`-gren med vilje er fortsatt `Success` totalt — selve arbeidsflyten feilet ikke.) |
| **Error** | En node feilet og det var ingen `error`-port koblet for å håndtere det. Kjøringen stoppet ved den noden. |
| **Timeout** | Kjøringen overskred per-kjøring-tidsavbruddet. Se [Konfigurasjon & sikkerhet](/docs/workflows/configuration). |

## Lese en kjøring

Klikk en kjøring fra listen for å åpne detaljsiden. Du ser:

- **Header** — triggeren som trigget, start- og slutt-tidsstempel, total varighet, status.
- **Nodeliste** — hver node som ble utført i rekkefølge, hver med sine fangede argumenter, sin returverdi og sin valgte utgangsport.
- **Feil** — hvis en node feilet, feilmeldingen og (når tilgjengelig) stack-trace.

De fangede argumentene viser *post-interpolering*-verdier — altså de eksakte strengene noden så etter at variabler ble løst opp. Dette er den mest nyttige feilsøkingsvisningen: hvis en Slack-melding inneholder den bokstavelige teksten `{{Incident.title}}`, vet du at variabelreferansen ikke ble løst.

## Vanlige feilsøkingsmønstre

### "Arbeidsflyten min trigget ikke."

1. Bekreft at arbeidsflyten er **aktivert** i **Innstillinger**. Nye arbeidsflyter leveres deaktivert.
2. For en modellhendelse-trigger: bekreft at hendelsen faktisk skjedde. Åpne entiteten (hendelsen, varselet, monitoren) og se på historikken.
3. For en webhook-trigger: bekreft at det eksterne systemet treffer riktig URL. Mange verktøy logger utgående webhook-leveringer — sjekk der.
4. For en tidsplan-trigger: bekreft at cron-uttrykket evaluerer til den tiden du forventer. Bruk en cron-parser om du er i tvil.

Hvis triggeren trigget men ingen kjøring dukker opp, sjekk prosjektets kjøringskvote under **Project Settings → Billing**.

### "Den kjører, men en nedstrømsnode kjører aldri."

En node som ikke kjører er vanligvis et koblingsproblem. Åpne lerretet og sjekk:

- Er oppstrømsnodens utgangsport faktisk koblet til denne nodens inngangsport?
- Tok oppstrømsnoden en annen port (f.eks. `error` i stedet for `success`, eller `no` i stedet for `yes`)? Se på kjøringsdetaljen for å se hvilken port den valgte.

### "En variabel kommer gjennom tom."

Åpne kjøringsdetaljen og se på den feilende nodens fangede argumenter. Hvis du ser den bokstavelige `{{NodeId.field}}`-teksten, ble ikke referansen løst — sannsynligvis en skrivefeil i `NodeId` eller `field`. Hvis du ser en tom streng, kjørte oppstrømsnoden men produserte ikke det feltet.

### "Det fungerer manuelt, men ikke fra triggeren."

Bruk **Kjør manuelt** med en JSON-payload som speiler det den ekte triggeren publiserer. Sammenlign så de fangede argumentene i den manuelle kjøringen mot produksjonskjøringen side om side — forskjellen ligger vanligvis i et enkelt feltnavn eller type.

## Kjøre en arbeidsflyt på nytt

Det finnes ingen "prøv på nytt"-knapp — som design kjører OneUptime aldri en gammel kjøring på nytt, fordi de utgående sideeffektene (Slack-meldinger, API-kall) kanskje ikke er idempotente. Hvis du vil gjøre arbeidet på nytt, fiks arbeidsflyten og la neste ekte trigger trigge den.

For manuelle arbeidsflyter, bare klikk **Kjør manuelt** med samme payload.

## Loggoppbevaring

Kjøringer beholdes på prosjektet på ubestemt tid. Hvis du må rydde opp i støyende arbeidsflyter med høyt volum (f.eks. en feilsøkings-arbeidsflyt som trigges hvert minutt), deaktiver eller slett dem — det finnes ingen per-arbeidsflyt oppbevaringsbryter.

## Les videre

- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — tidsavbrudd, rekursjonsgrenser, redigering av hemmeligheter.
- [Variabler](/docs/workflows/variables) — syntaksen interpolerte argumenter bruker.
- [Komponenter](/docs/workflows/components) — returverdi-feltene hver komponent publiserer.
