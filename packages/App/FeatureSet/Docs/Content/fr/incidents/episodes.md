# Épisodes

Un épisode regroupe des incidents liés, ou des alertes liées, pour que votre équipe les traite comme un tout : un seul endroit pour les voir, un seul ensemble de propriétaires, un seul état à reconnaître et à résoudre. Les règles de regroupement ouvrent des épisodes et y ajoutent les incidents et les alertes à mesure qu'ils arrivent (voir [Règles de regroupement des incidents](/docs/incidents/settings#règles-de-regroupement-des-incidents)). Vous pouvez aussi mettre vous-même des incidents dans un épisode, plusieurs à la fois : depuis l'épisode, ou depuis les listes d'incidents.

Tout ce qui est décrit sur cette page fonctionne de la même façon pour les épisodes d'alertes : lisez « alerte » là où il est écrit « incident ». Les épisodes d'incidents se trouvent sous **Incidents → Épisodes**, les épisodes d'alertes sous **Alertes → Épisodes**.

## Ajouter des incidents depuis un épisode

Ouvrez l'épisode, choisissez **Incidents des membres** dans son menu latéral (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`), puis cliquez sur **Ajouter des incidents**. La boîte de dialogue liste les 50 incidents les plus récents que vous pouvez voir et qui ne sont pas encore dans l'épisode, chacun avec son numéro, son titre, son état et sa gravité. Pour en trouver un plus ancien, cherchez par titre ou par numéro : `INC-42`, `42` et `#42` trouvent tous l'incident 42.

- Cochez-en autant qu'il vous faut, jusqu'à 100 à la fois. Le bouton les compte : **Ajouter 3 éléments (Incidents)**.
- Un incident qui est déjà dans un autre épisode le signale sous son titre, avec le numéro de cet épisode. L'ajouter ici le laisse aussi là-bas : un incident peut faire partie de plusieurs épisodes. Dans un projet où un incident ne peut faire partie que d'un seul épisode, il ne peut pas être choisi : voir [Un seul épisode par incident](#un-seul-épisode-par-incident).
- Si certains ne peuvent pas être ajoutés, la boîte de dialogue reste ouverte et les liste avec la raison ; les autres sont ajoutés.

## Ajouter des incidents depuis les listes d'incidents

Sélectionnez des incidents dans la liste **Incidents**, ou dans toute autre liste d'incidents comme celle d'un moniteur, puis ouvrez **Actions groupées** :

| Action | Ce qu'elle fait |
| --- | --- |
| **Ajouter à un épisode existant** | Choisissez un épisode. Les épisodes en cours viennent d'abord, du plus récent au plus ancien, puis ceux résolus récemment ; cherchez par titre ou par numéro pour en trouver un autre. Avant l'ajout, la boîte de dialogue indique combien des incidents sélectionnés sont déjà dans cet épisode, et restent tels quels, et combien sont dans un autre épisode, où ils restent. |
| **Ajouter à un nouvel épisode** | Crée un épisode qui contient les incidents sélectionnés. Elle ne demande qu'un titre et une gravité, tous deux remplis d'après l'incident sélectionné le plus grave ; le titre d'un incident privé n'est jamais repris. Ajoutez propriétaires, politiques d'astreinte et notes sur la page de l'épisode. |

Les deux acceptent jusqu'à 100 incidents sélectionnés. Le résultat indique combien ont été ajoutés, combien étaient déjà dans l'épisode, et lesquels n'ont pas été ajoutés et pourquoi, avec un lien qui ouvre l'épisode.

## Ce que fait l'ajout

- **Une seule entrée dans le fil de l'épisode** nomme chaque incident ajouté : les 20 premiers par numéro et titre, puis combien d'autres. Elle est publiée une seule fois dans le canal Slack ou Microsoft Teams de l'épisode, et non une fois par incident. Un incident privé n'est désigné que par son numéro.
- **Le fil de chaque incident** indique à quel épisode il a été ajouté.
- **La gravité de l'épisode** est relevée au niveau de l'incident le plus grave ajouté à un épisode existant, et n'est jamais abaissée. Un nouvel épisode commence avec la gravité que vous choisissez.
- **Un épisode résolu reste résolu.** Y ajouter des incidents ne le rouvre pas, et l'ajout ne change jamais l'état d'un incident.
- **Les propriétaires de l'épisode sont prévenus** que des incidents ont été ajoutés, comme lorsqu'un seul est ajouté. Quand l'épisode est créé avec eux, sa propre notification de création les couvre.

## Retirer un incident

Dans **Incidents des membres**, **Supprimer** sur une ligne, ou sur les lignes sélectionnées depuis **Actions groupées**, retire l'incident de cet épisode uniquement. L'incident lui-même n'est pas supprimé, et il reste dans tout autre épisode dont il fait partie.

## Un seul épisode par incident

Un incident peut faire partie de plusieurs épisodes à la fois. Pour que chaque incident fasse partie d'un seul épisode au plus, activez **Un incident ne peut faire partie que d'un seul épisode** dans **Incidents → Paramètres → Appartenance aux épisodes**. Pour les alertes, l'interrupteur s'appelle **Une alerte ne peut faire partie que d'un seul épisode**, dans **Alertes → Paramètres → Appartenance aux épisodes**. Les deux sont désactivés tant que vous ne les activez pas, et seuls les Project Owners et les Project Admins peuvent les changer.

Tant qu'il est activé, un incident qui fait partie d'un épisode n'est ajouté à aucun autre :

- **Ajouter des incidents** ne liste que les incidents qui ne font partie d'aucun épisode. Une recherche trouve aussi les autres, mais un incident qui fait partie d'un autre épisode ne peut pas être coché, et le signale.
- **Ajouter à un épisode existant** indique combien des incidents sélectionnés font partie d'un autre épisode, et n'ajoute que les autres. Quand tous font déjà partie d'un épisode, la boîte de dialogue indique qu'il n'y a rien à ajouter.
- **Ajouter à un nouvel épisode** laisse de côté les incidents sélectionnés qui font déjà partie d'un épisode, et indique combien. Quand c'est le cas de tous, elle indique qu'il n'y a rien à ajouter.
- Les **Règles de regroupement** laissent un incident qui fait déjà partie d'un épisode là où il est.
- **L'API, les workflows et Terraform** suivent la même règle : l'ajout d'un incident qui fait partie d'un autre épisode est refusé, avec la raison.

L'activer ne retire aucun incident d'un épisode : un incident qui fait déjà partie de plusieurs y reste. Pour déplacer un incident, retirez-le avec **Supprimer** sur la page **Incidents des membres** de son épisode, puis ajoutez-le à l'autre épisode.

## Qui peut ajouter

Ajouter demande la permission d'ajouter des incidents à un épisode, que possèdent les rôles Project Owner, Project Admin, Project Member, Incident Admin et Incident Member, ainsi qu'un rôle personnalisé avec Create Incident Episode Member. Vous ne pouvez ajouter que des incidents que vous voyez : un incident privé ne peut être ajouté que par ses propriétaires et par les propriétaires et administrateurs du projet. Ajouter à un nouvel épisode demande aussi la permission de créer un épisode. Quand vous ne pouvez pas utiliser une action, elle est verrouillée, et son info-bulle nomme la permission qui manque.

## Avec l'API

Ajouter plusieurs incidents à un épisode en une seule requête :

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

La réponse nomme chaque incident envoyé, une seule fois : ajouté, déjà dans l'épisode, ou non ajouté et pourquoi. Une requête de plus de 100 identifiants est refusée.

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

Dans un projet où un incident ne peut faire partie que d'un seul épisode, un incident qui fait partie d'un autre épisode revient dans `notAdded`, avec `Already in another episode. An incident can be in only one episode in this project.` comme raison.

Pour les alertes, envoyez `alertEpisodeId` et `alertIds` à `/api/alert-episode-member/add-alerts`. Pour créer un épisode qui contient des incidents, envoyez leurs identifiants avec la requête de création de l'épisode, `POST /api/incident-episode`, sous la forme `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }` ; pour un épisode d'alertes, `POST /api/alert-episode` avec `alertIdsToAdd`. Si l'un d'eux ne peut pas être ajouté, aucun épisode n'est créé.
