# Episodes

Een episode bundelt samenhangende incidenten, of samenhangende waarschuwingen, zodat uw team ze als één geheel afhandelt: één plek om ze te zien, één groep eigenaren, één status om te bevestigen en op te lossen. Groeperingsregels openen episodes en voegen er incidenten en waarschuwingen aan toe zodra die binnenkomen (zie [Groeperingsregels voor incidenten](/docs/incidents/settings#groeperingsregels-voor-incidenten)). U kunt ook zelf incidenten aan een episode toevoegen, meerdere tegelijk: vanuit de episode of vanuit de incidentenlijsten.

Alles op deze pagina werkt op dezelfde manier voor waarschuwingsepisodes: lees "waarschuwing" waar "incident" staat. Incidentepisodes staan onder **Incidenten → Episoden**, waarschuwingsepisodes onder **Waarschuwingen → Episoden**.

## Incidenten toevoegen vanuit een episode

Open de episode, kies **Lidincidenten** in het zijmenu (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) en klik op **Incidenten toevoegen**. Het venster toont de 50 nieuwste incidenten die u kunt zien en die nog niet in de episode zitten, elk met nummer, titel, status en ernst. Zoek op titel of nummer om een ouder incident te vinden: `INC-42`, `42` en `#42` vinden allemaal incident 42.

- Vink er zoveel aan als u nodig hebt, tot 100 tegelijk. De knop telt ze: **3 Incidenten toevoegen**.
- Een incident dat al in een andere episode zit, meldt dat onder zijn titel, met het nummer van die episode. Voegt u het hier toe, dan blijft het daar ook: een incident kan in meer dan één episode zitten.
- Kunnen sommige niet worden toegevoegd, dan blijft het venster open en toont het ze met de reden; de rest wordt toegevoegd.

## Incidenten toevoegen vanuit de incidentenlijsten

Selecteer incidenten in de lijst **Incidenten**, of in een andere lijst met incidenten zoals die van een monitor, en open **Bulkacties**:

| Actie | Wat ze doet |
| --- | --- |
| **Aan bestaande episode toevoegen** | Kies één episode. Lopende episodes staan eerst, de nieuwste bovenaan, daarna de onlangs opgeloste; zoek op titel of nummer om een andere te vinden. Voordat u toevoegt, meldt het venster hoeveel van de geselecteerde incidenten al in die episode zitten, die blijven zoals ze zijn, en hoeveel in een andere episode zitten, waar ze blijven. |
| **Aan nieuwe episode toevoegen** | Maakt een episode aan met de geselecteerde incidenten erin. Er wordt alleen om een titel en een ernst gevraagd, beide ingevuld op basis van het ernstigste geselecteerde incident; de titel van een privé-incident wordt nooit overgenomen. Eigenaren, dienstbeleid en notities voegt u toe op de pagina van de episode. |

Beide nemen tot 100 geselecteerde incidenten. Het resultaat meldt hoeveel er zijn toegevoegd, hoeveel er al in de episode zaten en welke niet zijn toegevoegd en waarom, met een link die de episode opent.

## Wat toevoegen doet

- **Eén item in de feed van de episode** noemt elk toegevoegd incident: de eerste 20 met nummer en titel, daarna hoeveel er nog meer zijn. Het wordt één keer in het Slack- of Microsoft Teams-kanaal van de episode geplaatst, niet één keer per incident. Een privé-incident wordt alleen bij zijn nummer genoemd.
- **De eigen feed van elk incident** meldt aan welke episode het is toegevoegd.
- **De ernst van de episode** wordt verhoogd tot die van het ernstigste incident dat aan een bestaande episode wordt toegevoegd, en nooit verlaagd. Een nieuwe episode begint met de ernst die u kiest.
- **Een opgeloste episode blijft opgelost.** Toevoegen heropent haar niet, en toevoegen verandert nooit de status van een incident.
- **De eigenaren van de episode krijgen bericht** dat er incidenten zijn toegevoegd, net als wanneer er één los wordt toegevoegd. Wordt de episode met de incidenten aangemaakt, dan dekt haar eigen melding van het aanmaken ze.

## Een incident eruit halen

Onder **Lidincidenten** haalt **Verwijderen** op een rij, of op de geselecteerde rijen via **Bulkacties**, het incident alleen uit deze episode. Het incident zelf wordt niet verwijderd en blijft in elke andere episode waarin het zit.

## Wie mag toevoegen

Toevoegen vereist de machtiging om incidenten aan een episode toe te voegen. De rollen Project Owner, Project Admin, Project Member, Incident Admin en Incident Member hebben die, net als een eigen rol met Create Incident Episode Member. U kunt alleen incidenten toevoegen die u kunt zien: een privé-incident kan alleen worden toegevoegd door zijn eigenaren en door de eigenaren en beheerders van het project. Aan nieuwe episode toevoegen vereist ook de machtiging om een episode aan te maken. Als u een actie niet kunt gebruiken, is ze vergrendeld en noemt haar tooltip de machtiging die ontbreekt.

## Met de API

Voeg meerdere incidenten in één verzoek aan een episode toe:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

Het antwoord noemt elk verzonden incident precies één keer: toegevoegd, al in de episode, of niet toegevoegd en waarom. Een verzoek met meer dan 100 ID's wordt geweigerd.

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

Voor waarschuwingen stuurt u `alertEpisodeId` en `alertIds` naar `/api/alert-episode-member/add-alerts`. Om een episode met incidenten erin aan te maken, stuurt u hun ID's mee met het verzoek dat de episode aanmaakt, `POST /api/incident-episode`, als `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; voor een waarschuwingsepisode `POST /api/alert-episode` met `alertIdsToAdd`. Als een ervan niet kan worden toegevoegd, wordt er geen episode aangemaakt.
