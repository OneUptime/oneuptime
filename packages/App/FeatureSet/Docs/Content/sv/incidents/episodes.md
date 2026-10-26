# Episoder

En episod samlar relaterade incidenter, eller relaterade larm, så att ditt team hanterar dem som en: ett ställe att se dem, en uppsättning ägare, en status att bekräfta och lösa. Grupperingsregler öppnar episoder och lägger till incidenter och larm i dem allt eftersom de kommer in (se [Grupperingsregler för incidenter](/docs/incidents/settings#grupperingsregler-för-incidenter)). Du kan också själv lägga incidenter i en episod, flera åt gången: från episoden eller från incidentlistorna.

Allt på den här sidan fungerar likadant för larmepisoder: läs ”larm” där det står ”incident”. Incidentepisoder finns under **Incidenter → Episoder**, larmepisoder under **Larm → Episoder**.

## Lägga till incidenter från en episod

Öppna episoden, välj **Medlemsincidenter** i sidomenyn (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) och klicka på **Lägg till incidenter**. Dialogen listar de 50 senaste incidenterna som du kan se och som ännu inte finns i episoden, var och en med nummer, titel, status och allvarlighetsgrad. Sök på titel eller nummer för att hitta en äldre: `INC-42`, `42` och `#42` hittar alla incident 42.

- Markera så många du behöver, upp till 100 åt gången. Knappen räknar dem: **Lägg till 3 Incidenter**.
- En incident som redan finns i en annan episod säger det under sin titel, med den episodens nummer. Lägger du till den här finns den kvar där också: en incident kan finnas i mer än en episod. I ett projekt där en incident bara kan ingå i en episod går den inte att välja: se [En episod per incident](#en-episod-per-incident).
- Om några inte kan läggas till förblir dialogen öppen och listar dem med orsaken; resten läggs till.

## Lägga till incidenter från incidentlistorna

Markera incidenter i listan **Incidenter**, eller i någon annan lista med incidenter som en monitors, och öppna **Massåtgärder**:

| Åtgärd | Vad den gör |
| --- | --- |
| **Lägg till i befintlig episod** | Välj en episod. Pågående episoder kommer först, de nyaste överst, sedan de som nyligen lösts; sök på titel eller nummer för att hitta någon annan. Innan du lägger till säger dialogen hur många av de markerade incidenterna som redan finns i den episoden, och som lämnas som de är, och hur många som finns i en annan episod, där de stannar kvar. |
| **Lägg till i ny episod** | Skapar en episod med de markerade incidenterna i. Den frågar bara efter en titel och en allvarlighetsgrad, båda ifyllda utifrån den allvarligaste markerade incidenten; titeln på en privat incident kopieras aldrig. Lägg till ägare, jourpolicyer och anteckningar på episodens egen sida. |

Båda tar upp till 100 markerade incidenter. Resultatet säger hur många som lades till, hur många som redan fanns i episoden och vilka som inte lades till och varför, med en länk som öppnar episoden.

## Vad tillägget gör

- **En post i episodens flöde** nämner varje tillagd incident: de första 20 med nummer och titel, sedan hur många till. Den publiceras en gång i episodens Slack- eller Microsoft Teams-kanal, inte en gång per incident. En privat incident nämns bara med sitt nummer.
- **Varje incidents eget flöde** säger vilken episod den lades till i.
- **Episodens allvarlighetsgrad** höjs till den allvarligaste incident som läggs till i en befintlig episod, och sänks aldrig. En ny episod börjar med den allvarlighetsgrad du väljer.
- **En löst episod förblir löst.** Att lägga till i den öppnar inte den igen, och ett tillägg ändrar aldrig en incidents status.
- **Episodens ägare får veta** att incidenter har lagts till, precis som när en läggs till ensam. När episoden skapas med dem täcker dess egen avisering om att den skapats dem.

## Ta ut en incident

Under **Medlemsincidenter** tar **Ta bort** på en rad, eller på de markerade raderna från **Massåtgärder**, ut incidenten ur just den här episoden. Själva incidenten tas inte bort, och den finns kvar i alla andra episoder den finns i.

## En episod per incident

En incident kan finnas i flera episoder samtidigt. För att hålla varje incident i högst en episod slår du på **En incident kan bara ingå i en episod** under **Incidenter → Inställningar → Medlemskap i episoder**. För larm heter reglaget **Ett larm kan bara ingå i en episod**, under **Larm → Inställningar → Medlemskap i episoder**. Båda är avslagna tills du slår på dem, och bara Project Owners och Project Admins kan ändra dem.

Så länge det är påslaget läggs en incident som finns i en episod inte till i någon annan:

- **Lägg till incidenter** listar bara de incidenter som inte finns i någon episod. En sökning hittar även de andra, men en incident som finns i en annan episod går inte att kryssa i, och säger det.
- **Lägg till i befintlig episod** säger hur många av de valda incidenterna som finns i en annan episod, och lägger bara till resten. Finns alla redan i en episod säger dialogen att det inte finns något att lägga till.
- **Lägg till i ny episod** utelämnar de valda incidenter som redan finns i en episod, och säger hur många. Gäller det alla säger den att det inte finns något att lägga till.
- **Grupperingsregler** låter en incident som redan finns i en episod stanna där den är.
- **API:t, arbetsflöden och Terraform** följer samma regel: att lägga till en incident som finns i en annan episod avvisas, med skälet.

Att slå på det tar inte ut någon incident ur en episod: en incident som redan finns i flera stannar i dem. För att flytta en incident tar du ut den med **Ta bort** på sidan **Medlemsincidenter** i dess episod och lägger sedan till den i den andra episoden.

## Vem kan lägga till

Att lägga till kräver behörighet att lägga till incidenter i en episod, vilket rollerna Project Owner, Project Admin, Project Member, Incident Admin och Incident Member har, liksom en anpassad roll med Create Incident Episode Member. Du kan bara lägga till incidenter som du kan se: en privat incident kan bara läggas till av sina ägare och av projektets ägare och administratörer. Lägg till i ny episod kräver också behörighet att skapa en episod. När du inte kan använda en åtgärd är den låst, och dess verktygstips nämner behörigheten som saknas.

## Med API:et

Lägg till flera incidenter i en episod i en enda förfrågan:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

Svaret nämner varje skickad incident exakt en gång: tillagd, redan i episoden, eller inte tillagd och varför. En förfrågan med fler än 100 id:n avvisas.

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

I ett projekt där en incident bara kan ingå i en episod kommer en incident som finns i en annan episod tillbaka under `notAdded` med `Already in another episode. An incident can be in only one episode in this project.` som skäl.

För larm skickar du `alertEpisodeId` och `alertIds` till `/api/alert-episode-member/add-alerts`. För att skapa en episod med incidenter i skickar du deras id:n med förfrågan som skapar episoden, `POST /api/incident-episode`, som `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; för en larmepisod `POST /api/alert-episode` med `alertIdsToAdd`. Om någon av dem inte kan läggas till skapas ingen episod.
