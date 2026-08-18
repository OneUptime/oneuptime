# Composants

Les composants sont les briques de base que vous ajoutez après le déclencheur. Chacun fait une chose — envoyer un message, appeler une API, vérifier une condition — et se relie à ce qui vient ensuite.

Cette page est le catalogue. Pour savoir comment les ajouter et les relier sur le canevas, voir [Créer un workflow](/docs/workflows/authoring).

## API

Effectuez une requête HTTP vers n'importe quelle URL.

**Settings** :

- **Method** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — l'adresse à appeler.
- **Headers** — les en-têtes à envoyer.
- **Body** — le corps de la requête pour `POST` / `PUT` / `PATCH`.

**Outputs** :

- **Success** — se déclenche lorsque l'appel a réussi (réponse 2xx). Transmet le statut, les en-têtes et le corps.
- **Error** — se déclenche lors d'une erreur réseau ou d'une réponse non 2xx. Transmet le message d'erreur.

À utiliser pour : toute API externe, vos propres points de terminaison d'administration, ou toute intégration qui n'a pas son propre composant.

## AI

### Generate Text with AI

Génère une réponse textuelle unique à partir d'un prompt et d'un contexte JSON optionnel. Le composant utilise le fournisseur LLM par défaut configuré pour le projet, avec repli sur le fournisseur global de l'installation lorsqu'il est disponible. Les identifiants et points de terminaison du fournisseur sont configurés de manière centralisée ; ce ne sont pas des arguments de workflow.

**Settings** :

- **System Instructions** — indications optionnelles sur le rôle, le ton et les contraintes du modèle.
- **Prompt** — la tâche requise. Elle peut inclure des variables de workflow et des sorties de composants précédents.
- **Context** — JSON optionnel que vous incluez délibérément avec la requête. Il est ajouté après un marqueur explicite de fin de confiance et traité comme une donnée non fiable pour le reste du message.
- **Temperature** — variation de `0` à `1`. La valeur par défaut est `0.2` pour une automatisation prévisible.
- **Maximum Output Tokens** — de `1` à `4096`. La valeur par défaut est `1024`.

Les System Instructions, le Prompt et le Context sérialisé combinés sont limités à 50 000 caractères. La requête au fournisseur a une durée maximale de 60 secondes et n'est tentée qu'une seule fois. Au maximum trois requêtes de workflow AI peuvent s'exécuter simultanément par projet.

**Outputs** :

- **Response** — le texte généré.
- **Provider** et **Model** — la configuration utilisée pour l'appel.
- **Total Tokens** et **Completion Tokens** — l'utilisation rapportée par le fournisseur.
- **LLM Log ID** — l'entrée de journal AI mesurée pour l'appel.
- **Error** — l'erreur de validation, d'accès, de fournisseur, de budget, de facturation ou de délai, lorsqu'elle est présente.

Reliez **Success** aux composants qui doivent utiliser la réponse. Reliez **Error** à un repli, une alerte ou un chemin de journalisation explicite. Le composant effectue une seule requête au modèle, sans définitions d'outils ni champs de capacité natifs du fournisseur : il ne peut ni interroger OneUptime, ni appeler des API, ni modifier les données du projet par lui-même. Hormis les instructions de sécurité fixes du composant propres à OneUptime, seuls les System Instructions, le Prompt et le Context que vous configurez sont envoyés au fournisseur, après résolution des variables de workflow présentes dans ces champs. Le fournisseur/modèle configuré reste une frontière de confiance car un modèle peut disposer de capacités intrinsèques gérées par le fournisseur.

La sortie du modèle est un texte non fiable. Vérifiez-le avant de l'envoyer dans des communications destinées aux clients, et n'utilisez pas un texte AI en texte libre pour autoriser à lui seul des actions de workflow destructrices. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration) pour les détails sur le fournisseur, la sortie réseau, la journalisation et les coûts.

## Webhook (sortant)

Une version plus simple du composant API pour les cas « envoyer et oublier ». Publie un corps JSON vers une URL.

Utilisez **API** si vous avez besoin de lire la réponse. Utilisez **Webhook** si vous voulez simplement envoyer une notification et passer à autre chose.

## Slack

Publiez un message dans un canal Slack.

**Settings** :

- **Channel** — le nom du canal. Le bot doit déjà être présent dans ce canal.
- **Message** — le texte à envoyer. Prend en charge le formatage Slack.

Connectez d'abord Slack à votre projet sous **Project Settings → Workspace → Slack**. Voir [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Publiez un message dans un canal Microsoft Teams.

**Settings** :

- **Team and channel** — l'endroit où publier.
- **Message** — le texte à envoyer.

Voir [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) pour la configuration.

## Discord

Publiez un message dans un canal Discord via une URL de webhook entrant.

## Telegram

Envoyez un message à un chat Telegram à l'aide d'un jeton de bot et d'un identifiant de chat.

## Email

Envoyez un e-mail via OneUptime.

**Settings** :

- **To** — l'adresse e-mail du destinataire.
- **Subject** — l'objet de l'e-mail.
- **Body** — le message en Markdown ou en HTML.

L'e-mail est envoyé depuis l'expéditeur configuré pour votre projet — voir [SMTP](/docs/emails/smtp).

## Custom Code

Exécutez un petit morceau de JavaScript lorsque vous avez besoin de quelque chose que les autres blocs ne peuvent pas faire.

**Settings** :

- **Code** — votre JavaScript. La dernière valeur (ou ce que vous renvoyez depuis une fonction async) devient la sortie du bloc.
- **Arguments** — des valeurs nommées que vous pouvez transmettre.

**Outputs** : success (votre valeur de retour) et error (toute exception).

À utiliser pour : remettre en forme des données entre deux systèmes, faire un petit calcul, tout ce qui ne mérite pas son propre bloc. Pour des scripts plus lourds, utilisez plutôt un [Runbook](/docs/runbooks/index).

## JSON

Convertissez entre texte et JSON.

- **JSON → Text** — transforme un objet JSON en chaîne. Utile quand le bloc suivant attend du texte.
- **Text → JSON** — analyse une chaîne en objet JSON. Utile quand quelque chose est arrivé sous forme de texte et que vous devez lire un champ.

## Conditions

Crée un embranchement en fonction d'une comparaison. Dans le panneau **Add Component**, ce bloc s'appelle **If / Else**, sous la catégorie Conditions.

**Settings** :

- **Left value** — généralement une valeur provenant d'un bloc précédent.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — la valeur à comparer.

**Outputs** : **Yes** et **No**. Reliez les blocs suivants à la branche de votre choix.

## Delay

Met le workflow en pause pendant une durée donnée avant de continuer. Utile lorsque vous devez laisser à un autre système le temps de rattraper son retard.

## Log

Écrit une ligne dans le journal d'exécution. Aucun effet externe — cela apparaît simplement dans les journaux du workflow pour que vous puissiez les lire. Pratique pour le débogage.

## Execute Workflow

Appelle un autre workflow depuis celui-ci. Le workflow appelé s'exécute de son côté — votre workflow continue sans attendre qu'il se termine.

Utilisez ceci pour partager une logique commune. Construisez un workflow « publier dans le canal d'incident » une seule fois, puis appelez-le depuis tout autre workflow qui a besoin de notifier ce canal.

Une limite de sécurité empêche les workflows de s'appeler entre eux en boucle. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration).

## Composants de données OneUptime

Pour chaque type d'enregistrement dans OneUptime (monitors, incidents, alertes, status pages, politiques d'astreinte et bien d'autres), le panneau **Add Component** propose ces composants — recherchez par le nom du type. Chaque titre est généré à partir du type d'enregistrement, donc l'ensemble Monitor donne :

- **Find One Monitor** — lire un enregistrement correspondant à la requête.
- **Find Many Monitors** — lire une liste d'enregistrements correspondant à la requête.
- **Create One Monitor** — ajouter un enregistrement à partir d'un objet JSON.
- **Create Many Monitors** — ajouter plusieurs enregistrements à partir d'un tableau JSON.
- **Update One Monitor** — appliquer la charge utile d'écriture à un enregistrement correspondant.
- **Update Many Monitors** — appliquer la charge utile d'écriture aux enregistrements correspondants, jusqu'à Limit.
- **Delete One Monitor** — supprimer un enregistrement correspondant.
- **Delete Many Monitors** — supprimer les enregistrements correspondants, jusqu'à Limit.

Le même ensemble vous donne trois déclencheurs — **On Create Monitor**, **On Update Monitor** et **On Delete Monitor**. Voir [Triggers](/docs/workflows/triggers).

Un type ne propose que les composants que son modèle autorise. Un type en lecture seule n'a que les deux composants Find et rien d'autre, donc si vous ne trouvez pas **Delete One Monitor** dans le panneau, ce type ne le permet pas.

C'est ainsi qu'un workflow peut lire et modifier les données OneUptime. Par exemple : un webhook depuis votre outil CI peut utiliser **Create One Incident** pour ouvrir un incident avec les détails de l'échec.

## Travailler avec les enregistrements

Chaque champ d'un composant de données est indexé sur les noms de **colonne** propres à l'enregistrement — les mêmes noms que ceux utilisés par l'API, pas les libellés du formulaire du tableau de bord. La colonne d'ID est `_id`. L'orthographe `id` est acceptée comme alias partout où vous pouvez saisir un nom de colonne, mais `_id` est ce qu'un enregistrement renvoie, donc c'est ce qu'il faut lire en sortie :

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** détermine quels enregistrements le composant traite. Les clés sont des colonnes, les valeurs sont ce qu'il faut faire correspondre :

```json
{ "monitorType": "Website", "isEnabled": true }
```

Une requête est toujours limitée au projet dans lequel le workflow s'exécute. Vous ne pouvez pas atteindre les enregistrements d'un autre projet, et vous n'avez pas besoin d'ajouter vous-même le projet à la requête.

**JSON Object** sur Create One, **JSON Array** sur Create Many, et **Data (JSON Object)** sur les composants Update portent les champs à écrire, indexés de la même façon :

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Une clé qui n'est pas une colonne est ignorée plutôt que rejetée — le journal d'exécution nomme celles qui ont été abandonnées, donc vérifiez-le là quand un champ ne prend pas effet. **Select Fields**, sur les composants Find et les déclencheurs, utilise les mêmes clés de colonne avec des valeurs `true` : `{"_id": true, "name": true}`.

**Skip** et **Limit** sont deux champs numériques sur Find Many, Update Many et Delete Many — `Skip: 0` avec `Limit: 100` prend les cent premiers résultats. Limit vaut `10` par défaut, et sur Update Many et Delete Many il plafonne le nombre d'enregistrements réellement écrits, pas seulement le nombre renvoyé. Ainsi `Items Deleted: 10` signifie que dix enregistrements ont été supprimés, pas que dix ont correspondu. Augmentez Limit lorsque vous voulez modifier plus de dix enregistrements.

**Success** et **Error** indiquent si la requête s'est exécutée, pas ce qu'elle a trouvé. Une requête ne trouvant rien renvoie `0` et passe quand même par Success — ce n'est pas un échec. Pour créer un embranchement selon qu'un résultat a été trouvé, lisez le nombre renvoyé dans un bloc **If / Else**.

## Quel composant dois-je utiliser ?

Quelques règles rapides :

- S'il existe un bloc dédié à ce que vous voulez (Slack, Email, un enregistrement OneUptime), utilisez-le — vous bénéficiez d'une meilleure gestion des erreurs et de journaux plus clairs.
- Pour toute autre API externe, utilisez **API**.
- Pour résumer, classer ou rédiger un texte à partir de données de workflow explicitement sélectionnées, utilisez **Generate Text with AI**.
- Pour remettre en forme des données entre blocs, utilisez **Custom Code** ou **JSON**.
- Pour effectuer des actions différentes selon une valeur, utilisez **Conditions**.

## Pour aller plus loin

- [Variables de workflow](/docs/workflows/variables) — faire circuler les données entre les blocs.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce que chaque bloc a fait lors d'une exécution.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — limites, propriétaires et secrets.
