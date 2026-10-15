# Episoder

En episode samler relaterede hændelser, eller relaterede advarsler, så dit team arbejder med dem som én: ét sted at se dem, én gruppe ejere, én status at kvittere for og løse. Grupperingsregler åbner episoder og føjer hændelser og advarsler til dem, efterhånden som de kommer (se [Grupperingsregler for hændelser](/docs/incidents/settings#grupperingsregler-for-hændelser)). Du kan også selv lægge hændelser i en episode, flere ad gangen: fra episoden eller fra hændelseslisterne.

Alt på denne side virker på samme måde for advarselsepisoder: læs "advarsel", hvor der står "hændelse". Hændelsesepisoder ligger under **Hændelser → Episoder**, advarselsepisoder under **Advarsler → Episoder**.

## Tilføj hændelser fra en episode

Åbn episoden, vælg **Medlemshændelser** i sidemenuen (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`), og klik på **Tilføj hændelser**. Dialogen viser de 50 nyeste hændelser, du kan se, og som endnu ikke er i episoden, hver med nummer, titel, status og alvorlighed. Søg efter titel eller nummer for at finde en ældre: `INC-42`, `42` og `#42` finder alle hændelse 42.

- Sæt flueben ved så mange, du har brug for, op til 100 ad gangen. Knappen tæller dem: **Tilføj 3 Hændelser**.
- En hændelse, der allerede er i en anden episode, siger det under sin titel med den episodes nummer. Tilføjer du den her, bliver den også dér: en hændelse kan være i mere end én episode.
- Kan nogle ikke tilføjes, forbliver dialogen åben og viser dem med årsagen; resten tilføjes.

## Tilføj hændelser fra hændelseslisterne

Vælg hændelser på listen **Hændelser**, eller på en hvilken som helst anden liste med hændelser, f.eks. en monitors, og åbn **Massehandlinger**:

| Handling | Hvad den gør |
| --- | --- |
| **Tilføj til eksisterende episode** | Vælg én episode. Igangværende episoder kommer først, de nyeste øverst, derefter dem, der er løst for nylig; søg efter titel eller nummer for at finde en anden. Før du tilføjer, siger dialogen, hvor mange af de valgte hændelser der allerede er i den episode, og som forbliver, som de er, og hvor mange der er i en anden episode, hvor de bliver. |
| **Tilføj til ny episode** | Opretter en episode med de valgte hændelser i. Den spørger kun om en titel og en alvorlighed, begge udfyldt ud fra den mest alvorlige valgte hændelse; titlen på en privat hændelse kopieres aldrig. Tilføj ejere, vagtpolitikker og noter på episodens egen side. |

Begge tager op til 100 valgte hændelser. Resultatet siger, hvor mange der blev tilføjet, hvor mange der allerede var i episoden, og hvilke der ikke blev tilføjet og hvorfor, med et link, der åbner episoden.

## Hvad tilføjelse gør

- **Én post i episodens feed** nævner hver tilføjet hændelse: de første 20 med nummer og titel, derefter hvor mange flere. Den sendes én gang til episodens Slack- eller Microsoft Teams-kanal, ikke én gang pr. hændelse. En privat hændelse nævnes kun med sit nummer.
- **Hver hændelses eget feed** siger, hvilken episode den blev føjet til.
- **Episodens alvorlighed** hæves til den mest alvorlige hændelse, der føjes til en eksisterende episode, og sænkes aldrig. En ny episode starter med den alvorlighed, du vælger.
- **En løst episode forbliver løst.** At tilføje til den genåbner den ikke, og tilføjelse ændrer aldrig en hændelses status.
- **Episodens ejere får besked** om, at der er tilføjet hændelser, ligesom når én tilføjes alene. Når episoden oprettes med dem, dækker dens egen besked om oprettelsen dem.

## Tag en hændelse ud

Under **Medlemshændelser** tager **Fjern** på en række, eller på de valgte rækker fra **Massehandlinger**, hændelsen ud af denne episode alene. Selve hændelsen slettes ikke, og den bliver i alle andre episoder, den er i.

## Hvem kan tilføje

Tilføjelse kræver tilladelse til at føje hændelser til en episode, som rollerne Project Owner, Project Admin, Project Member, Incident Admin og Incident Member har, ligesom en brugerdefineret rolle med Create Incident Episode Member. Du kan kun tilføje hændelser, du kan se: en privat hændelse kan kun tilføjes af sine ejere og af projektets ejere og administratorer. Tilføj til ny episode kræver også tilladelse til at oprette en episode. Når du ikke kan bruge en handling, er den låst, og dens værktøjstip nævner den tilladelse, der mangler.

## Med API'et

Føj flere hændelser til en episode i én anmodning:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

Svaret nævner hver sendt hændelse præcis én gang: tilføjet, allerede i episoden eller ikke tilføjet og hvorfor. En anmodning med mere end 100 id'er afvises.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

For advarsler sender du `alertEpisodeId` og `alertIds` til `/api/alert-episode-member/add-alerts`. For at oprette en episode med hændelser i sender du deres id'er med den anmodning, der opretter episoden, `POST /api/incident-episode`, som `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; for en advarselsepisode `POST /api/alert-episode` med `alertIdsToAdd`. Kan en af dem ikke tilføjes, oprettes der ingen episode.
