# Vagtplaner

En vagtplan bestemmer, hvem der har vagt på et givet tidspunkt. Folk skiftes i den: hver har vagt et stykke tid, derefter overtager den næste. Føj en plan til eskaleringsreglerne i en vagtpolitik, så tilkalder politikken den, der har vagt i planen, når det niveau kører.

## Hvem der skiftes

Når du opretter en plan på siden **Vagtplaner**, spørger formularen om dens **Navn** og **Hvem skiftes til at have vagt?**. Klik på **Tilføj bruger**, og vælg personerne i den rækkefølge, de skiftes: de har vagt én ad gangen, og den første har vagt, så snart planen er oprettet. De bliver planens første lag, **Layer 1**, med vagt døgnet rundt. Den nye plan åbner derefter på sin side **Lag**, hvor du kan ændre rotationen eller tilføje flere lag.

**Hvem skiftes til at have vagt?** er valgfrit. Lader du det stå tomt, starter planen uden lag: den sætter ingen på vagt, før du tilføjer et lag på dens side **Lag**. Spørgsmålet stilles kun til dem, der må tilføje lag.

Alt andet ligger under **Flere felter**, foldet sammen, indtil du åbner det:

- **Hver tørn varer**: **1 dag**, **1 uge**, **2 uger** eller **1 måned**, og **1 uge**, medmindre du ændrer det. Der spørges om det, så snart nogen er valgt. Hver person har vagt så længe, derefter overtager den næste, på det klokkeslæt, planen blev oprettet.
- **Tidszone**: den tidszone, som overdragelsestider og vagttimer gælder i. Den starter som din egen.
- **Beskrivelse** og **Etiketter**.

Så længe nogen er valgt, og intet under **Flere felter** er ændret, siger den sammenfoldede overskrift, hvad der vil ske: hver person har vagt i en uge, hvorefter den næste overtager.

## Lag

En plans rotation består af lag på dens side **Lag**. Lagene læses oppefra og ned: det øverste lag med en person på vagt er det, der tilkalder, så læg hovedrotationen øverst og reservedækningen under den.

**Tilføj lag** tilføjer et lag, der starter som det første: på vagt fra nu af, hver person i en uge, døgnet rundt. Fold et lag ud for at tilføje personer og ændre, hvornår det starter, hvor ofte det overdrager, hvornår det overdrager første gang, og hvilke timer det har vagt.

## Opret planer med API'et eller Terraform

Vagtplaner er ressourcen `/api/on-call-duty-policy-schedule`; deres lag og personerne i dem er ressourcerne `/api/on-call-duty-schedule-layer` og `/api/on-call-duty-schedule-layer-user`.

- Når en plan oprettes med `firstLayerUsers` (en liste af bruger-id'er i den rækkefølge, de skiftes) i sine `miscDataProps`, får den sit første lag, som i dashboardet: **Layer 1**, på vagt fra nu af, døgnet rundt. `firstLayerRotation` angiver, hvor længe hver tørn varer, som en rotation som `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; uden den en uge. Hver bruger skal være medlem af projektet, og den, der kalder, skal have lov til at oprette lag, ellers oprettes planen ikke.
- En plan, der oprettes uden dem, har ingen lag, som før; Terraforms planressource sender dem ikke.
- Et lag, der oprettes uden `rotation`, overdrager dagligt, som det altid har gjort.
