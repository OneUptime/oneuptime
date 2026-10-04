# Vaktplaner

En vaktplan avgjør hvem som har vakt til enhver tid. Folk bytter på i den: hver har vakt en stund, så tar den neste over. Legg en plan til i eskaleringsreglene i en vaktretningslinje, så varsler retningslinjen den som har vakt i planen når det nivået kjører.

## Hvem som bytter på

Når du oppretter en plan på siden **Vaktplaner**, spør skjemaet om **Navn** og **Hvem bytter på å ha vakt?**. Klikk på **Legg til bruker** og velg personene i den rekkefølgen de bytter på: de har vakt én om gangen, og den første har vakt så snart planen er opprettet. De blir planens første lag, **Layer 1**, med vakt døgnet rundt. Den nye planen åpnes deretter på siden **Lag**, der du kan endre rotasjonen eller legge til flere lag.

**Hvem bytter på å ha vakt?** er valgfritt. Lar du det stå tomt, starter planen uten lag: den setter ingen på vakt før du legger til et lag på siden **Lag**. Spørsmålet stilles bare til dem som kan legge til lag.

Alt annet ligger under **Flere felt**, sammenfoldet til du åpner det:

- **Hver vakt varer**: **1 dag**, **1 uke**, **2 uker** eller **1 måned**, og **1 uke** med mindre du endrer det. Det spørres om så snart noen er valgt. Hver person har vakt så lenge, så tar den neste over, på det klokkeslettet planen ble opprettet.
- **Tidssone**: tidssonen som overleveringstider og vakttimer gjelder i. Den starter på din egen.
- **Beskrivelse** og **Etiketter**.

Så lenge noen er valgt og ingenting under **Flere felt** er endret, sier den sammenfoldede overskriften hva som vil skje: hver person har vakt i en uke, deretter tar den neste over.

## Lag

Rotasjonen i en plan består av lag, på siden **Lag**. Lagene leses ovenfra og ned: det øverste laget med noen på vakt er det som varsler, så legg hovedrotasjonen øverst og reservedekningen under.

**Legg til lag** legger til et lag som starter slik det første gjør: på vakt fra nå, hver person i en uke, døgnet rundt. Utvid et lag for å legge til personer og endre når det starter, hvor ofte det overleverer, når det overleverer første gang og hvilke timer det har vakt.

## Opprett planer med API-et eller Terraform

Vaktplaner er ressursen `/api/on-call-duty-policy-schedule`; lagene deres og personene i dem er ressursene `/api/on-call-duty-schedule-layer` og `/api/on-call-duty-schedule-layer-user`.

- Når en plan opprettes med `firstLayerUsers` (en liste med bruker-ID-er i den rekkefølgen de bytter på) i `miscDataProps`, får den sitt første lag, slik dashbordet gjør: **Layer 1**, på vakt fra nå, døgnet rundt. `firstLayerRotation` sier hvor lenge hver vakt varer, som en rotasjon som `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; uten den en uke. Hver bruker må være medlem av prosjektet, og den som kaller må ha lov til å opprette lag, ellers opprettes ikke planen.
- En plan som opprettes uten dem, har ingen lag, som før; Terraforms planressurs sender dem ikke.
- Et lag som opprettes uten `rotation`, overleverer daglig, slik det alltid har gjort.
