# Episoder

En episode samler relaterte hendelser, eller relaterte varsler, slik at teamet ditt jobber med dem som én: ett sted å se dem, én gruppe eiere, én status å bekrefte og løse. Grupperingsregler åpner episoder og legger til hendelser og varsler etter hvert som de kommer (se [Grupperingsregler for hendelser](/docs/incidents/settings#grupperingsregler-for-hendelser)). Du kan også selv legge hendelser i en episode, flere om gangen: fra episoden eller fra hendelseslistene.

Alt på denne siden fungerer på samme måte for varselepisoder: les «varsel» der det står «hendelse». Hendelsesepisoder ligger under **Hendelser → Episoder**, varselepisoder under **Varsler → Episoder**.

## Legge til hendelser fra en episode

Åpne episoden, velg **Medlemshendelser** i sidemenyen (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`), og klikk **Legg til hendelser**. Dialogen viser de 50 nyeste hendelsene du kan se og som ennå ikke er i episoden, hver med nummer, tittel, status og alvorlighetsgrad. Søk etter tittel eller nummer for å finne en eldre: `INC-42`, `42` og `#42` finner alle hendelse 42.

- Huk av så mange du trenger, opptil 100 om gangen. Knappen teller dem: **Legg til 3 Hendelser**.
- En hendelse som allerede er i en annen episode, sier det under tittelen sin, med nummeret til den episoden. Legger du den til her, blir den værende der også: en hendelse kan være i mer enn én episode.
- Kan noen ikke legges til, forblir dialogen åpen og viser dem med årsaken; resten legges til.

## Legge til hendelser fra hendelseslistene

Velg hendelser i listen **Hendelser**, eller i en hvilken som helst annen liste med hendelser, for eksempel en monitors, og åpne **Massehandlinger**:

| Handling | Hva den gjør |
| --- | --- |
| **Legg til i eksisterende episode** | Velg én episode. Pågående episoder kommer først, de nyeste øverst, deretter de som er løst nylig; søk etter tittel eller nummer for å finne en annen. Før du legger til, sier dialogen hvor mange av de valgte hendelsene som allerede er i den episoden, og som blir som de er, og hvor mange som er i en annen episode, der de blir værende. |
| **Legg til i ny episode** | Oppretter en episode med de valgte hendelsene i. Den spør bare om en tittel og en alvorlighetsgrad, begge fylt ut fra den mest alvorlige valgte hendelsen; tittelen på en privat hendelse kopieres aldri. Legg til eiere, vaktpolicyer og notater på episodens egen side. |

Begge tar opptil 100 valgte hendelser. Resultatet sier hvor mange som ble lagt til, hvor mange som allerede var i episoden, og hvilke som ikke ble lagt til og hvorfor, med en lenke som åpner episoden.

## Hva det å legge til gjør

- **Én oppføring i episodens feed** nevner hver hendelse som ble lagt til: de første 20 med nummer og tittel, deretter hvor mange flere. Den legges ut én gang i episodens Slack- eller Microsoft Teams-kanal, ikke én gang per hendelse. En privat hendelse nevnes bare med nummeret sitt.
- **Hver hendelses egen feed** sier hvilken episode den ble lagt til i.
- **Episodens alvorlighetsgrad** heves til den mest alvorlige hendelsen som legges til i en eksisterende episode, og senkes aldri. En ny episode starter med alvorlighetsgraden du velger.
- **En løst episode forblir løst.** Å legge til i den gjenåpner den ikke, og det endrer aldri statusen til en hendelse.
- **Episodens eiere får beskjed** om at hendelser ble lagt til, slik de får når én legges til alene. Når episoden opprettes med dem, dekker dens egen varsling om opprettelsen dem.

## Ta ut en hendelse

Under **Medlemshendelser** tar **Fjern** på en rad, eller på de valgte radene fra **Massehandlinger**, hendelsen ut av bare denne episoden. Selve hendelsen slettes ikke, og den blir værende i alle andre episoder den er i.

## Hvem kan legge til

Å legge til krever tillatelse til å legge hendelser til en episode, som rollene Project Owner, Project Admin, Project Member, Incident Admin og Incident Member har, i likhet med en egendefinert rolle med Create Incident Episode Member. Du kan bare legge til hendelser du kan se: en privat hendelse kan bare legges til av eierne sine og av prosjektets eiere og administratorer. Legg til i ny episode krever også tillatelse til å opprette en episode. Når du ikke kan bruke en handling, er den låst, og verktøytipset nevner tillatelsen som mangler.

## Med API-et

Legg flere hendelser til en episode i én forespørsel:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

Svaret nevner hver hendelse som ble sendt, nøyaktig én gang: lagt til, allerede i episoden, eller ikke lagt til og hvorfor. En forespørsel med mer enn 100 ID-er avvises.

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

For varsler sender du `alertEpisodeId` og `alertIds` til `/api/alert-episode-member/add-alerts`. For å opprette en episode med hendelser i sender du ID-ene deres med forespørselen som oppretter episoden, `POST /api/incident-episode`, som `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; for en varselepisode `POST /api/alert-episode` med `alertIdsToAdd`. Kan en av dem ikke legges til, opprettes ingen episode.
