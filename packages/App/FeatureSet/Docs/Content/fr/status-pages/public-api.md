# API publique

Chaque page de statut répond à un petit ensemble de points de terminaison JSON en lecture seule : sa vue d'ensemble, sa disponibilité, ses incidents, ses épisodes, ses événements de maintenance planifiée et ses annonces. Ce sont les points de terminaison que la page de statut charge elle-même : ils renvoient donc exactement ce que voit un visiteur, et une page publique n'a besoin d'aucune clé d'API. Utilisez-les pour afficher votre statut dans votre propre application, un chatbot ou un écran mural.

:::cards
- [Points de terminaison](#points-de-terminaison): Un point de terminaison pour chaque chose que montre la page.
- [Lire la vue d'ensemble](#lire-la-vue-densemble): Toute la page en une requête, avec curl, Node.js et Python.
- [Disponibilité sur une période](#disponibilité-sur-une-période): La disponibilité par ressource et par groupe, sur 90 jours au plus.
- [Erreurs](#erreurs): Ce que signifie chaque code de statut.
:::

## Comment une requête reçoit sa réponse

Chaque requête désigne la page de statut par son ID ou par l'un de ses domaines personnalisés. OneUptime trouve la page, applique les mêmes règles d'accès que celles que rencontre un visiteur, et répond en JSON.

```mermaid title="Comment une requête à l'API d'une page de statut reçoit sa réponse"
flowchart TB
    R["Requête avec l'ID<br/>ou le domaine d'une<br/>page de statut"] --> F{"ID bien formé<br/>ou domaine<br/>vérifié ?"}
    F -->|"Oui"| A{"Page<br/>archivée ?"}
    F -->|"Non"| E404["404: Status Page<br/>not found"]
    A -->|"Non"| IP{"La liste d'IP<br/>autorisées laisse<br/>passer l'appelant ?"}
    A -->|"Oui"| E404
    IP -->|"Oui"| P{"La page est<br/>publique ?"}
    IP -->|"Non"| E403["403 : adresse IP<br/>bloquée"]
    P -->|"Non"| S{"Connecté, ou<br/>déverrouillé avec<br/>le mot de passe ?"}
    P -->|"Oui"| OK["200 avec du JSON"]
    S -->|"Oui"| OK
    S -->|"Non"| E401["401 : non<br/>authentifié"]
```

Une page privée ne répond qu'à un navigateur qui s'y est connecté, ou qui l'a déverrouillée avec son mot de passe : l'API lit la même session que la page. Pour un script, utilisez une page publique. Voir [Restreindre qui peut voir la page](/docs/status-pages/index#restreindre-qui-peut-voir-la-page).

Un ID bien formé qui n'appartient à aucune page de statut suit le même chemin qu'une page privée, et reçoit la réponse `401`. Si une page publique répond `401`, vérifiez l'ID.

## Avant de commencer

- **L'ID de la page de statut.** Ouvrez la page dans le tableau de bord (**Pages de statut → Toutes les pages de statut**, puis la page). La carte **Détails de la page de statut** de sa **Vue d'ensemble** affiche l'**ID de la page de statut**.
- **L'URL de base.** Chaque point de terminaison ci-dessous se trouve sous `/status-page-api` :

| Où tourne la page | URL de base |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| OneUptime auto-hébergé | `https://<your-oneuptime-host>/status-page-api` |
| Un domaine personnalisé de la page | `https://status.example.com/status-page-api` |

Partout où un chemin ci-dessous indique `{statusPageIdOrDomain}`, vous pouvez envoyer l'ID de la page ou l'un de ses domaines personnalisés vérifiés, comme `status.example.com`. Le point de terminaison de disponibilité n'accepte que l'ID, et répond `401` à un domaine.

## Points de terminaison

| Point de terminaison | Méthodes | Renvoie |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Tout ce que montre la vue d'ensemble : le statut global, les ressources et les groupes, les incidents et épisodes actifs, la maintenance planifiée, les annonces en cours et les données des barres de disponibilité. |
| `/uptime/{statusPageId}` | `POST` | Les pourcentages de disponibilité par ressource et par groupe, sur une période. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | Les incidents que la page liste, avec leurs notes publiques et leurs changements d'état. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Un incident. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | Les épisodes d'incidents que la page liste. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Un épisode. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | Les événements de maintenance planifiée que la page liste, avec leurs notes publiques et leurs changements d'état. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Un événement de maintenance planifiée. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | Les annonces que la page liste. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Une annonce. |

Les points de terminaison suivent les réglages propres à la page, dans la carte **Ce que montre votre page de statut** (voir [Choisir ce qui s'affiche sur la page](/docs/status-pages/index#choisir-ce-qui-saffiche-sur-la-page)) :

- Une liste désactivée refuse son point de terminaison, par exemple avec `Incidents are not enabled on this status page.`
- Chaque liste remonte aussi loin que son réglage **Afficher … jours d'historique** (14 par défaut). La liste des incidents comprend aussi chaque incident qui n'est pas encore résolu, et celle de la maintenance planifiée chaque événement à venir ou en cours.
- Par son ID, un incident, un épisode, un événement ou une annonce est renvoyé quel que soit son âge : un lien vers un élément plus ancien continue donc de fonctionner. Un élément que la page ne montre pas du tout, comme un incident sur un moniteur absent de la page, revient sous forme de liste vide, et un épisode sous forme de `404`.

**Quels incidents une page renvoie.** Le point de terminaison des incidents renvoie les incidents sur les moniteurs de la page, moins ceux limités à d'autres pages de statut, et moins chaque incident non limité à cette page si la page ne montre que les incidents qui lui sont réservés (voir [Une page de statut par public](/docs/status-pages/one-status-page-per-audience)). Les pages auxquelles un incident est limité ne figurent jamais dans la réponse.

## Lire la vue d'ensemble

La vue d'ensemble, c'est une requête pour toute la page. Ce sont les mêmes données que celles que dessine la page de statut, et elles ont au plus 15 secondes.

:::tabs
@tab curl
```bash
curl https://oneuptime.com/status-page-api/overview/YOUR_STATUS_PAGE_ID
```
@tab Node.js
```javascript title="status.mjs"
// Node.js 18 or later: fetch is built in. Run with `node status.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/overview/${statusPageId}`,
);
const body = await response.json();

if (!response.ok) {
  throw new Error(`${response.status}: ${body.error}`);
}

console.log(body.overallStatus?.name); // "Operational"
```
@tab Python
```python title="status.py"
# Python 3, standard library only. Run with `python3 status.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/overview/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    overview = json.load(response)

print((overview.get("overallStatus") or {}).get("name"))  # Operational
```
:::

Le statut global est le pire statut actuel des moniteurs et groupes de moniteurs de la page, celui qui a la priorité la plus élevée. Un statut de moniteur ressemble à ceci :

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### Ce que renvoie la vue d'ensemble

| Clé | Ce qu'elle contient |
| --- | ------------- |
| `overallStatus` | Le statut global de la page, un statut de moniteur comme ci-dessus. Une page qui ne contient rien reçoit le statut du projet de la priorité la plus basse. |
| `statusPage` | Les réglages publics de la page : son titre, sa description, sa personnalisation et ce qu'elle montre. |
| `statusPageResources` | Chaque ressource : son nom d'affichage, sa description, son groupe, son moniteur ou groupe de moniteurs, et ses options d'affichage. |
| `resourceGroups` | Les groupes, avec `parentStatusPageGroupId` pour les groupes imbriqués. |
| `monitorStatuses` | Chaque statut de moniteur du projet, de la priorité la plus basse à la plus élevée. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | Le statut actuel de chaque groupe de moniteurs de la page, et les moniteurs qu'il contient. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | Ce à partir de quoi les barres de disponibilité sont dessinées, et les règles de couleur des barres de la page. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | Les incidents non résolus que la page montre, leurs notes publiques et leurs changements d'état, et les états d'incident du projet. |
| `timelineIncidents` | Les incidents de la fenêtre des barres de disponibilité, résolus compris, pour les infobulles des barres. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | La même chose pour les épisodes d'incidents. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | Les événements de maintenance planifiée à venir ou en cours, leurs notes publiques et leurs changements d'état. |
| `activeAnnouncements` | Les annonces affichées en ce moment : commencées, et pas encore terminées. |

## Disponibilité sur une période

`POST /uptime/{statusPageId}` renvoie la disponibilité de chaque ressource et de chaque groupe de la page entre deux dates. Les deux dates sont facultatives :

| Champ | Par défaut | Remarques |
| ----- | ------- | ----- |
| `startDate` | Il y a 14 jours | Une date et une heure ISO 8601. |
| `endDate` | Maintenant | Ne doit pas précéder `startDate`. La période peut couvrir au plus 90 jours. |

:::tabs
@tab curl
```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/YOUR_STATUS_PAGE_ID \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}'
```
@tab Node.js
```javascript title="uptime.mjs"
// Node.js 18 or later. Run with `node uptime.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/uptime/${statusPageId}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: "2026-09-01T00:00:00Z",
      endDate: "2026-09-30T23:59:59Z",
    }),
  },
);
const uptime = await response.json();

for (const group of uptime.groupUptimes) {
  console.log(group.statusPageGroupName, group.uptimePercent);
}
```
@tab Python
```python title="uptime.py"
# Python 3, standard library only. Run with `python3 uptime.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"

request = urllib.request.Request(
    f"https://oneuptime.com/status-page-api/uptime/{STATUS_PAGE_ID}",
    data=json.dumps(
        {"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}
    ).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request, timeout=10) as response:
    uptime = json.load(response)

for group in uptime["groupUptimes"]:
    print(group["statusPageGroupName"], group["uptimePercent"])
```
:::

La réponse :

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Checkout API",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "groupUptimes": [
    {
      "statusPageGroupId": {
        "_type": "ObjectID",
        "value": "df7632c4-c5c0-453c-88bf-9ee3d68d45f2"
      },
      "parentStatusPageGroupId": null,
      "uptimePercent": 99.98,
      "statusPageResourceUptimes": [
        {
          "statusPageResourceId": {
            "_type": "ObjectID",
            "value": "8175534f-aa77-456c-ad5b-b8e7b85876aa"
          },
          "uptimePercent": 99.98,
          "statusPageResourceName": "Web app",
          "currentStatus": {
            "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
            "name": "Operational",
            "color": { "_type": "Color", "value": "#2ab57d" },
            "isOperationalState": true,
            "priority": 1
          }
        }
      ],
      "statusPageGroupName": "Web",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "startDate": "2026-09-01T00:00:00.000Z",
  "endDate": "2026-09-30T23:59:59.000Z"
}
```

| Clé | Ce qu'elle contient |
| --- | ------------- |
| `statusPageResourceUptimes` | Les ressources hors de tout groupe, celles que les visiteurs voient en haut de la page. |
| `groupUptimes` | Une entrée par groupe. `uptimePercent` et `currentStatus` d'un groupe couvrent chaque ressource en dessous de lui, groupes imbriqués compris ; son `statusPageResourceUptimes` ne liste que les ressources qui sont directement dedans. Reconstruisez l'arborescence avec `parentStatusPageGroupId`. |
| `uptimePercent` | Arrondi à la précision propre de la ressource ou du groupe. `null` quand la ressource ou le groupe n'affiche pas de pourcentage de disponibilité. |
| `currentStatus` | `null` quand la ressource ou le groupe n'affiche pas son statut actuel. |

Le temps compte comme indisponibilité quand son statut de moniteur fait partie des statuts **Compte comme indisponibilité** de la page.

## Incidents, épisodes, maintenance et annonces

Les points de terminaison de liste répondent à `GET` comme à `POST` ; ceux d'un seul élément et ceux des épisodes répondent à `POST`.

:::tabs
@tab curl
```bash
# The incidents the page lists
curl https://oneuptime.com/status-page-api/incidents/YOUR_STATUS_PAGE_ID

# One scheduled maintenance event
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance-events/YOUR_STATUS_PAGE_ID/EVENT_ID
```
@tab Node.js
```javascript title="incidents.mjs"
// Node.js 18 or later. Run with `node incidents.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/incidents/${statusPageId}`,
);
const { incidents } = await response.json();

for (const incident of incidents) {
  console.log(incident.title, incident.currentIncidentState?.name);
}
```
@tab Python
```python title="incidents.py"
# Python 3, standard library only. Run with `python3 incidents.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/incidents/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    incidents = json.load(response)["incidents"]

for incident in incidents:
    print(incident["title"], (incident.get("currentIncidentState") or {}).get("name"))
```
:::

| Point de terminaison | Clés de la réponse |
| -------- | -------------------- |
| Incidents | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Épisodes | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Événements de maintenance planifiée | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Annonces | `announcements`, `statusPageResources`, `monitorsInGroup` |

Une requête pour un seul élément répond avec les mêmes clés, qui contiennent cet unique enregistrement.

## Erreurs

Une erreur répond avec un code de statut et un corps JSON qui en donne la raison :

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Statut | Quand |
| ------ | ---- |
| `400` | La requête demande quelque chose que la page ne montre pas, comme une liste désactivée, ou la période de disponibilité dépasse 90 jours ou se termine avant de commencer. |
| `401` | La page est privée, et la requête n'a ni session connectée ni mot de passe pour elle. Un ID bien formé qui n'appartient à aucune page de statut reçoit aussi `401`. |
| `403` | La liste d'IP autorisées de la page ne contient pas l'adresse de l'appelant. |
| `404` | L'ID est mal formé, aucun domaine personnalisé vérifié ne correspond, ou la page est archivée. Un épisode que la page ne montre pas reçoit aussi `404`. |

## Autres façons de lire une page de statut

- **RSS.** Chaque page de statut sert `/rss`, un flux de ses incidents, annonces et événements de maintenance planifiée. Voir [Le badge intégrable et le flux RSS](/docs/status-pages/index#le-badge-intégrable-et-le-flux-rss).
- **llms.txt.** À côté de `/rss`, chaque page de statut sert `/llms.txt`, qui oriente les agents d'IA vers le flux RSS et le JSON de la vue d'ensemble.
- **MCP.** Les agents d'IA peuvent lire la page via le serveur MCP de OneUptime à l'adresse `https://oneuptime.com/mcp`, sans clé d'API, en passant l'ID ou le domaine de la page dans `statusPageIdOrDomain`. Il est activé par défaut ; désactivez-le avec **Activer le serveur MCP** sous **IA → MCP** dans le menu latéral de la page. Voir [Serveur MCP](/docs/ai/mcp-server).
- **L'API REST.** Pour créer ou modifier des pages de statut, des ressources, des abonnés et des annonces, utilisez l'[API OneUptime](/docs/api-reference/api-reference) avec une clé d'API.

## Étapes suivantes

:::cards
- [Vue d'ensemble des pages de statut](/docs/status-pages/index): Ce que montre une page de statut, et qui peut la voir.
- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups): Les ressources et les groupes que renvoient ces points de terminaison.
- [Une page de statut par public](/docs/status-pages/one-status-page-per-audience): Pourquoi une page liste un incident qu'une autre ne liste pas.
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains): Servir la page, et ces points de terminaison, sur votre propre domaine.
:::
