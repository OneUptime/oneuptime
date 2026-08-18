# Composants

Les composants sont les briques que vous ajoutez après le déclencheur. Chacun fait une seule chose — envoyer un message, appeler une API, vérifier une condition — et se relie à ce qui vient ensuite.

Cette page est le catalogue. Pour savoir comment les ajouter et les relier sur le canevas, voir [Créer un workflow](/docs/workflows/authoring).

## API

Effectuer une requête HTTP vers n'importe quelle URL.

**Paramètres** :

- **Method** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — l'adresse à appeler.
- **Headers** — les en-têtes à envoyer.
- **Body** — le corps de la requête pour `POST` / `PUT` / `PATCH`.

**Sorties** :

- **Succès** — part quand l'appel a fonctionné (réponse 2xx). Transmet le statut, les en-têtes et le corps.
- **Erreur** — part en cas d'échec réseau ou de réponse non 2xx. Transmet le message d'erreur.

À utiliser pour : n'importe quelle API externe, vos propres points de terminaison d'administration, ou toute intégration qui n'a pas son propre composant.

## AI

### Generate Text with AI

Générer une réponse texte unique à partir d'un prompt et d'un contexte JSON facultatif. Le composant utilise le fournisseur LLM par défaut configuré pour le projet, et se rabat sur le fournisseur global de l'installation lorsqu'il y en a un. Les identifiants et les points de terminaison des fournisseurs sont configurés de façon centralisée ; ce ne sont pas des arguments du workflow.

**Paramètres** :

- **System Instructions** — des consignes facultatives sur le rôle, le ton et les contraintes du modèle.
- **Prompt** — la tâche demandée, obligatoire. Elle peut contenir des variables de workflow et des sorties de composants antérieurs.
- **Context** — du JSON facultatif que vous joignez délibérément à la requête. Il est ajouté après un marqueur explicite de fin de message et traité comme une donnée non fiable dans tout le reste du message.
- **Temperature** — la variation, de `0` à `1`. La valeur par défaut est `0.2`, pour une automatisation prévisible.
- **Maximum Output Tokens** — de `1` à `4096`. La valeur par défaut est `1024`.

Les System Instructions, le Prompt et le Context sérialisé sont limités à 50 000 caractères au total. La requête au fournisseur a une durée maximale de 60 secondes et n'est tentée qu'une seule fois. Au maximum trois requêtes IA de workflow s'exécutent simultanément par projet.

**Sorties** :

- **Response** — le texte généré.
- **Provider** et **Model** — la configuration utilisée pour l'appel.
- **Total Tokens** et **Completion Tokens** — la consommation rapportée par le fournisseur.
- **LLM Log ID** — l'entrée du journal IA facturée pour cet appel.
- **Erreur** — l'erreur de validation, d'accès, de fournisseur, de budget, de facturation ou de délai, lorsqu'il y en a une.

Reliez **Succès** aux composants censés se servir de la réponse. Reliez **Erreur** à un chemin de repli, d'alerte ou de journalisation explicite. Le composant effectue une seule requête au modèle, sans définition d'outil ni champ de capacité natif du fournisseur : il ne peut ni interroger OneUptime, ni appeler des API, ni modifier les données du projet de lui-même. En dehors des consignes de sécurité fixes que OneUptime attache au composant, seuls les System Instructions, le Prompt et le Context que vous configurez sont envoyés au fournisseur, une fois les variables de workflow de ces champs résolues. Le fournisseur et le modèle configurés restent une frontière de confiance, car un modèle peut disposer de capacités intrinsèques gérées par le fournisseur.

La sortie du modèle est du texte non fiable. Relisez-la avant d'envoyer des communications destinées à vos clients, et n'autorisez jamais une action destructrice du workflow sur la seule foi d'un texte libre produit par l'IA. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration) pour les détails de fournisseur, de sortie de données, de journalisation et de coût.

## Webhook (sortant)

Une version simplifiée du composant API pour les cas « on envoie et on oublie ». Publie un corps JSON vers une URL.

Utilisez **API** si vous avez besoin de lire la réponse. Utilisez **Webhook** si vous voulez seulement envoyer une notification et passer à la suite.

## Slack

Publier un message dans un canal Slack.

**Paramètres** :

- **Canal** — le nom du canal. Le bot doit déjà s'y trouver.
- **Message** — le texte à envoyer. La mise en forme Slack est prise en charge.

Connectez d'abord Slack à votre projet sous **Project Settings → Workspace → Slack**. Voir [Connexion d'espace de travail Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publier un message dans un canal Microsoft Teams.

**Paramètres** :

- **Team and channel** — où publier.
- **Message** — le texte à envoyer.

Voir [Connexion d'espace de travail Microsoft Teams](/docs/workspace-connections/microsoft-teams) pour la configuration.

## Discord

Publier un message dans un canal Discord via une URL de webhook entrant.

## Telegram

Envoyer un message dans une conversation Telegram à l'aide d'un jeton de bot et d'un identifiant de conversation.

## Email

Envoyer un e-mail via OneUptime.

**Paramètres** :

- **À** — l'adresse e-mail du destinataire.
- **Objet** — la ligne d'objet.
- **Body** — le message, en Markdown ou en HTML.

L'e-mail part depuis l'expéditeur configuré pour votre projet — voir [SMTP](/docs/emails/smtp).

## Custom Code

Exécuter un petit bout de JavaScript quand vous avez besoin de quelque chose que les autres blocs ne savent pas faire.

**Paramètres** :

- **Code** — votre JavaScript. La dernière valeur (ou ce que renvoie votre fonction asynchrone) devient la sortie du bloc.
- **Arguments** — des valeurs nommées que vous pouvez lui passer.

**Sorties** : succès (votre valeur de retour) et erreur (toute exception).

À utiliser pour : remodeler des données entre deux systèmes, faire un petit calcul, tout ce qui ne mérite pas son propre bloc. Pour du script plus lourd, utilisez plutôt un [Runbook](/docs/runbooks/index).

## JSON

Convertir entre texte et JSON.

- **JSON → Text** — transformer un objet JSON en chaîne. Pratique quand le bloc suivant attend du texte.
- **Text → JSON** — analyser une chaîne pour en faire un objet JSON. Pratique quand quelque chose est arrivé sous forme de texte et que vous devez en lire un champ.

## Conditions

Créer un embranchement à partir d'une comparaison. Dans le panneau **Ajouter un composant**, ce bloc s'appelle **If / Else**, dans la catégorie Conditions.

**Paramètres** :

- **Left value** — en général une valeur venue d'un bloc antérieur.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — ce à quoi comparer.

**Sorties** : **Oui** et **Non**. Reliez les blocs suivants à la branche de votre choix.

## Delay

Mettre le workflow en pause pendant une durée définie avant de continuer. Pratique quand vous devez laisser à un autre système le temps de se mettre à jour.

## Log

Écrire une ligne dans le journal d'exécution. Aucun effet à l'extérieur — cela apparaît simplement dans les journaux du workflow, pour votre lecture. Bien commode pour déboguer.

## Execute Workflow

Appeler un autre workflow depuis celui-ci. Le workflow appelé s'exécute de son côté — le vôtre continue sans attendre qu'il se termine.

Servez-vous-en pour mutualiser une logique commune. Construisez une fois un workflow « publier dans le canal d'incident », puis appelez-le depuis n'importe quel autre workflow qui doit prévenir ce canal.

Une limite de sécurité empêche les workflows de s'appeler indéfiniment en boucle. Voir [Configuration et sécurité des workflows](/docs/workflows/configuration).

## Composants de données OneUptime

Pour chaque type d'enregistrement dans OneUptime (moniteurs, incidents, alertes, pages de statut, politiques d'astreinte, et bien d'autres), le panneau **Ajouter un composant** propose les composants suivants — cherchez par le nom du type. Chaque titre est engendré à partir du type d'enregistrement ; pour les moniteurs, cela donne :

- **Find One Monitor** — lire un enregistrement correspondant à la requête.
- **Find Many Monitors** — lire la liste des enregistrements correspondant à la requête.
- **Create One Monitor** — ajouter un enregistrement à partir d'un objet JSON.
- **Create Many Monitors** — ajouter plusieurs enregistrements à partir d'un tableau JSON.
- **Update One Monitor** — appliquer les données d'écriture à un enregistrement correspondant.
- **Update Many Monitors** — appliquer les données d'écriture aux enregistrements correspondants, dans la limite de Limit.
- **Delete One Monitor** — supprimer un enregistrement correspondant.
- **Delete Many Monitors** — supprimer les enregistrements correspondants, dans la limite de Limit.

Le même ensemble vous donne trois déclencheurs — **On Create Monitor**, **On Update Monitor** et **On Delete Monitor**. Voir [Déclencheurs de workflow](/docs/workflows/triggers).

Un type n'offre que les composants que son modèle autorise. Un type en lecture seule a les deux composants Find et rien d'autre : si vous ne trouvez pas **Delete One Monitor** dans le panneau, c'est que ce type ne le permet pas.

C'est ainsi qu'un workflow lit et modifie les données de OneUptime. Par exemple : un webhook venu de votre outil de CI peut utiliser **Create One Incident** pour ouvrir un incident avec le détail de l'échec.

## Travailler avec les enregistrements

Chaque champ d'un composant de données s'appuie sur les noms de **colonnes** de l'enregistrement — les mêmes noms que ceux de l'API, pas les libellés du formulaire dans le tableau de bord. La colonne d'identifiant est `_id`. L'écriture `id` est acceptée comme alias partout où vous pouvez saisir un nom de colonne, mais c'est `_id` que renvoie un enregistrement : c'est donc ce qu'il faut lire en sortie :

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** décide sur quels enregistrements le composant agit. Les clés sont des colonnes, les valeurs sont ce qu'il faut faire correspondre :

```json
{ "monitorType": "Website", "isEnabled": true }
```

Une requête est toujours limitée au projet dans lequel le workflow s'exécute. Vous ne pouvez pas atteindre les enregistrements d'un autre projet, et vous n'avez pas à ajouter le projet à la requête vous-même.

**JSON Object** sur Create One, **JSON Array** sur Create Many et **Data (JSON Object)** sur les composants Update portent les champs à écrire, indexés de la même façon :

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Une clé qui n'est pas une colonne est ignorée plutôt que rejetée — le journal d'exécution nomme celles qu'il a laissées de côté, allez donc y regarder quand un champ n'arrive pas. **Select Fields**, sur les composants Find et sur les déclencheurs, utilise les mêmes clés de colonne avec la valeur `true` : `{"_id": true, "name": true}`.

**Skip** et **Limit** sont deux champs numériques sur Find Many, Update Many et Delete Many — `Skip: 0` avec `Limit: 100` prend les cent premières correspondances. Limit vaut `10` par défaut, et sur Update Many et Delete Many il plafonne le nombre d'enregistrements réellement écrits, pas seulement le nombre de ceux qui remontent. Ainsi, `Items Deleted: 10` signifie que dix enregistrements ont été supprimés, pas que dix correspondaient. Relevez Limit quand vous comptez en modifier plus de dix.

**Succès** et **Erreur** disent si la requête a abouti, pas ce qu'elle a trouvé. Une requête qui ne correspond à rien renvoie `0` et repart quand même par Succès — ce n'est pas un échec. Pour créer un embranchement selon qu'il y a eu des correspondances ou non, lisez le décompte renvoyé dans un bloc **If / Else**.

## Quel composant utiliser ?

Quelques règles rapides :

- S'il existe un bloc dédié à ce que vous voulez faire (Slack, Email, un enregistrement OneUptime), prenez-le — vous y gagnez une meilleure gestion des erreurs et des journaux plus clairs.
- Pour toute autre API externe, utilisez **API**.
- Pour résumer, classer ou rédiger un texte à partir de données de workflow explicitement sélectionnées, utilisez **Generate Text with AI**.
- Pour remodeler des données entre deux blocs, utilisez **Custom Code** ou **JSON**.
- Pour agir différemment selon une valeur, utilisez **Conditions**.

## Où lire ensuite

- [Variables de workflow](/docs/workflows/variables) — faire passer les données d'un bloc à l'autre.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce qu'a fait chaque bloc lors d'une exécution.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — limites, propriétaires et secrets.
