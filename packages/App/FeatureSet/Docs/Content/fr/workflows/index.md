# Présentation des flux de travail

Les flux de travail automatisent le travail dans OneUptime sans code. Vous posez des blocs sur un canevas, vous les reliez, et le flux de travail s'exécute tout seul dès que son déclencheur se produit : un incident est créé, une planification arrive à échéance, un autre outil appelle une URL ou un e-mail arrive. Servez-vous-en pour relier OneUptime au reste de votre infrastructure et pour prendre en charge le suivi de routine pendant que vous traitez le problème lui-même. Pour choisir entre un flux de travail, un runbook, un playbook et une règle IA, consultez [Lequel choisir ?](/docs/introduction/which-one#flux-de-travail-runbook-playbook-ou-règle-ia).

:::cards
- [Créer un flux de travail](/docs/workflows/authoring): Créez un flux de travail, puis ajoutez, reliez et configurez ses blocs sur le canevas.
- [Déclencheurs](/docs/workflows/triggers): Démarrez un flux de travail à la main, selon une planification, depuis un webhook, un e-mail ou un événement OneUptime.
- [Composants](/docs/workflows/components): Tous les blocs que vous pouvez ajouter, des appels d'API aux enregistrements OneUptime.
- [Exécutions](/docs/workflows/runs-and-logs): Voyez ce que chaque exécution a fait, étape par étape.
:::

## Comment fonctionne un flux de travail

Tout flux de travail comporte trois parties :

1. **Un déclencheur** — ce qui démarre le flux de travail : une exécution à la main, une planification, un appel de webhook, un e-mail entrant ou un événement dans OneUptime, comme un nouvel incident. Chaque flux de travail en a exactement un.
2. **Des composants** — ce que fait le flux de travail : envoyer un message, appeler une API, vérifier une condition, créer ou modifier un enregistrement OneUptime.
3. **Des liaisons** — les lignes que vous tracez d'un bloc au suivant. Elles décident de ce qui s'exécute après quoi.

Quand le déclencheur se produit, OneUptime lance une **exécution**. Chaque bloc se termine en prenant l'une de ses sorties, par exemple **Succès** ou **Erreur**, **Oui** ou **Non**, et seuls les blocs reliés à cette sortie s'exécutent ensuite. Quand aucun bloc n'est relié à la sortie prise, ce chemin s'arrête là. L'exécution est enregistrée avec son statut, le chemin suivi et ce que chaque bloc a reçu et renvoyé.

```mermaid title="Ce qui se passe quand un flux de travail s'exécute"
flowchart TB
    subgraph starts["Ce qui lance une exécution"]
        direction LR
        manual["Exécuter le flux de travail"]
        schedule["Planification"]
        webhook["Appel de webhook"]
        email["E-mail entrant"]
        event["Événement OneUptime"]
    end
    starts --> trigger["Bloc déclencheur"]
    trigger --> wired{"Sortie reliée à un bloc ?"}
    wired -->|"Oui"| block["Ce bloc s'exécute"]
    block -->|"prend l'une de ses sorties"| wired
    wired -->|"Non"| saved["Exécution enregistrée avec ses étapes et son journal"]
```

Vous construisez tout cela visuellement, sur un canevas. La plupart des flux de travail ne demandent aucun code ; quand il en faut, un bloc **Exécuter du JavaScript personnalisé** exécute quelques lignes de JavaScript.

## Ce que vous pouvez faire avec les flux de travail

- **Relier OneUptime à vos autres outils** — publier dans Slack, Microsoft Teams, Discord, Telegram, IRC ou Mattermost, créer des tickets Jira, ou envoyer une requête à n'importe quelle API de votre infrastructure.
- **Réagir à ce qui se passe dans OneUptime** — à la création d'un incident, prévenir le bon canal et ouvrir un ticket automatiquement.
- **Exécuter des tâches selon une planification** — toutes les cinq minutes, chaque nuit, chaque lundi matin.
- **Recevoir des données de l'extérieur** — laisser d'autres systèmes démarrer un flux de travail en appelant son URL ou en écrivant à son adresse e-mail.
- **Réutiliser les automatisations courantes** — construisez-la une fois, puis démarrez-la depuis n'importe quel autre flux de travail avec un bloc **Exécuter un autre flux de travail**.

## Termes clés

Les mots utilisés dans tout OneUptime se trouvent dans le [Glossaire](/docs/introduction/glossary).

| Terme                   | Ce que cela désigne                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Flux de travail**            | L'automatisation dans son ensemble : un nom, un canevas de blocs et un interrupteur pour l'activer ou la désactiver. |
| **Déclencheur**         | Le premier bloc. Il décide quand le flux de travail s'exécute. Chaque flux de travail en a exactement un.                          |
| **Composant**           | Tout autre bloc : il envoie un message, lance une requête, vérifie une condition ou modifie un enregistrement.        |
| **Sortie**              | Un point au bas d'un bloc, comme **Succès** ou **Erreur**. Les lignes qui en partent mènent aux blocs suivants.       |
| **Exécution**           | Un passage du flux de travail, enregistré avec son statut, ses horodatages et ce que chaque bloc a fait.                    |
| **Variable globale**    | Une valeur, comme une clé d'API, que vous enregistrez une fois et utilisez dans n'importe quel flux de travail du projet.   |

## Avant de commencer

- **Un forfait qui inclut les flux de travail.** Sur OneUptime Cloud, les flux de travail demandent le forfait **Growth** ou supérieur, et chaque forfait autorise un certain nombre d'exécutions tous les 30 jours — voir [Limites du forfait](/docs/workflows/configuration#limites-du-forfait). Les installations auto-hébergées sans facturation n'ont aucune de ces limites.
- **L'autorisation de construire.** Créer et modifier des flux de travail demande **Administrateur des flux de travail**, **Administrateur du projet** ou **Propriétaire du projet**, ou un rôle personnalisé avec les autorisations correspondantes. Un **Membre des flux de travail** peut ouvrir les flux de travail et les exécuter à la main, mais pas les modifier. Voir [Autorisations](/docs/workflows/configuration#autorisations).

## Où trouver les flux de travail dans OneUptime

Ouvrez **Produits** dans la barre du haut et choisissez **Flux de travail**, sous **Tableaux de bord et automatisation**. Son menu contient :

- **Flux de travail** — la liste de vos flux de travail. Créez-en un ou ouvrez un flux de travail existant.
- **Variables globales** — les valeurs partagées par tous vos flux de travail.
- **Journaux → Exécutions** — l'historique des exécutions de tous les flux de travail de votre projet.
- **Paramètres → Règles d'étiquettes** et **Règles de propriétaire** — étiqueter les nouveaux flux de travail et leur attribuer des propriétaires automatiquement.
- **Avancé → Archivé** — les flux de travail que vous avez archivés. Ils ne s'exécutent jamais et n'apparaissent pas dans la liste ; désarchivez-les d'ici. Voir [Archiver un flux de travail](/docs/workflows/configuration#archiver-un-flux-de-travail).
- **Développeurs** — comment gérer les flux de travail avec Terraform, l'API ou un assistant IA.

Ouvrez un flux de travail en particulier, et son propre menu contient :

- **Vue d'ensemble** — le nom, la description, les étiquettes et l'interrupteur **Activé**.
- **Constructeur** — le canevas sur lequel vous concevez le flux de travail, avec l'interrupteur **Activé** en haut.
- **Variables de flux de travail** — les valeurs propres à ce seul flux de travail.
- **Journaux → Exécutions** — chaque exécution de ce flux de travail, avec ses détails.
- **Propriétaires** — les personnes et les équipes responsables du flux de travail.
- **Développeurs** — comment gérer ce flux de travail avec Terraform, l'API ou un assistant IA.
- **Paramètres** — dupliquer, exporter et archiver.

**Paramètres** se trouve dans la section **Avancé** du menu, avec **Journaux d'audit** et **Supprimer le flux de travail**. **Avancé** et **Développeurs** sont repliés au départ, dans ce menu comme dans tous les autres, pour que les pages que vous utilisez chaque jour viennent en premier. Cliquez sur le nom d'une section pour afficher ses pages. Elle s'ouvre d'elle-même dès que vous êtes sur l'une d'elles.

## Construire votre premier flux de travail

Tout flux de travail se construit de la même façon :

:::steps
1. **Créer** — choisissez un point de départ, puis donnez un nom à votre flux de travail. Voir [Créer un flux de travail](/docs/workflows/authoring).
2. **Choisir un déclencheur** — manuel, planifié, webhook, e-mail entrant ou événement OneUptime. Voir [Déclencheurs](/docs/workflows/triggers).
3. **Ajouter des composants** — posez des actions sur le canevas et reliez-les. Voir [Composants](/docs/workflows/components).
4. **Tester** — cliquez sur **Exécuter le flux de travail** dans le **Constructeur** et suivez l'exécution en direct. Cela fonctionne même tant que le flux de travail est désactivé : c'est une **Exécution de test**.
5. **L'activer** — basculez **Activé** en haut du **Constructeur** quand il est prêt. À partir de là, son déclencheur le lance.
:::

L'exemple ci-dessous suit ces étapes pour un vrai flux de travail.

## Exemple : envoyer les nouveaux incidents à un webhook

Ce flux de travail envoie un résumé JSON de chaque nouvel incident à une URL de votre choix — un outil de tickets, un entrepôt de données, tout ce qui accepte un webhook — et écrit la raison dans le journal de l'exécution quand la requête échoue.

```mermaid title="L'exemple terminé"
flowchart TB
    trigger["À la création : Incident"] -->|"Succès"| post["Appel d'API POST (JSON)"]
    post -->|"Erreur"| log["Journal"]
    post -->|"Succès"| done["L'exécution se termine"]
```

> [!TIP]
> Le modèle **Forward new incidents to another system** construit ce flux de travail pour vous, sans le bloc Log : sans rien sur **Erreur**, une requête qui échoue fait échouer l'exécution, et les **Étapes** de l'exécution disent pourquoi. Vous le trouverez sous **Incidents** quand vous créez un flux de travail.

:::steps
### Créer le flux de travail

Ouvrez **Flux de travail** et cliquez sur **Créer un flux de travail**. Cliquez sur **Partir de zéro**, nommez le flux de travail `Send new incidents to a webhook`, puis cliquez sur **Créer un flux de travail**.

Le nouveau flux de travail s'ouvre dans le **Constructeur**, désactivé.

### Ajouter le déclencheur

Cliquez sur le bloc en pointillés **Choisissez ce qui démarre ce flux de travail**, puis cliquez sur **À la création : Incident** sous **Populaires** dans le panneau **Ajouter un déclencheur**.

Le déclencheur prend la place du bloc en pointillés. L'ID qui y figure, `incident-on-create-1`, est le nom par lequel les blocs suivants s'y réfèrent.

### Choisir les champs de l'incident

Cliquez sur le déclencheur. **Champs à transmettre** commence avec le titre : cliquez sur **Ajouter un champ**, cochez la description et tout autre champ que la requête doit transporter, puis cliquez sur **Enregistrer**.

Le déclencheur transmet le nouvel incident avec ces champs. Un champ que vous ne sélectionnez pas arrive vide.

### Ajouter le bloc API

Cliquez sur **Ajouter un composant**, puis sur **Appel d'API POST (JSON)** sous **Populaires**. Faites glisser depuis le point **Succès** du déclencheur jusqu'au point supérieur du nouveau bloc.

### Remplir la requête

Cliquez sur le bloc API, qui affiche **Click to set up**. Saisissez votre point de terminaison dans **URL**. Dans **Corps de la requête**, écrivez le JSON à envoyer, en utilisant **{ }** pour insérer les champs de l'incident là où vous en avez besoin, puis cliquez sur **Enregistrer**.

```json title="Request Body"
{
  "id": "{{local.components.incident-on-create-1.returnValues.model._id}}",
  "title": "{{local.components.incident-on-create-1.returnValues.model.title}}",
  "description": "{{local.components.incident-on-create-1.returnValues.model.description}}"
}
```

Chaque référence `{{…}}` est remplacée par la valeur de l'incident quand le flux de travail s'exécute. La syntaxe est décrite dans [Variables](/docs/workflows/variables).

### Intercepter les échecs

Cliquez sur **Ajouter un composant**, puis sur **Journal**. Reliez-y le point **Erreur** du bloc API, puis réglez la **Valeur** du bloc Log sur `Could not send the incident: {{local.components.api-post-1.returnValues.error}}`.

Une requête qui échoue — une URL injoignable, ou une réponse qui n'est pas en 2xx — prend désormais ce chemin, et le journal de l'exécution dit pourquoi.

### Le tester

Cliquez sur **Exécuter le flux de travail** et choisissez un incident de ce projet sous **Incident** : les plus récents sont listés, et saisir son numéro ou une partie de son titre en trouve un autre. Cliquez sur **Exécuter le flux de travail manuellement** et confirmez avec **Exécuter**. Le flux de travail est toujours désactivé : c'est donc une **Exécution de test**, et la requête est vraiment envoyée.

Un panneau **Exécution du flux de travail** s'ouvre et suit l'exécution. Ouvrez l'étape **Appel d'API POST (JSON)** pour voir le corps qu'elle a envoyé et la réponse qu'elle a reçue.

### L'activer

Basculez **Activé** en haut du **Constructeur**.
:::

Désormais, chaque nouvel incident du projet lance une exécution. Vous les retrouvez toutes dans les [Exécutions](/docs/workflows/runs-and-logs) du flux de travail.

> [!NOTE]
> La requête part de OneUptime. Sur OneUptime Cloud, l'URL doit être joignable depuis Internet. Une installation auto-hébergée refuse les adresses de réseau privé, sauf si un administrateur les autorise — voir [Accès réseau sortant](/docs/workflows/configuration#accès-réseau-sortant).

## Comment les flux de travail s'intègrent au reste de OneUptime

- Les **moniteurs** repèrent le problème. Les **incidents** et les **alertes** l'enregistrent. Les **flux de travail** y réagissent.
- Les **runbooks** sont des procédures de réponse que votre équipe déroule lors d'un incident, d'une alerte ou d'un événement de maintenance : étapes manuelles, approbations et scripts, avec des personnes dans la boucle. Les flux de travail s'exécutent sans surveillance. Utilisez un [runbook](/docs/runbooks/index) quand une personne doit prendre des décisions en cours de route, et un flux de travail quand chaque étape est automatique.
- Les **connexions d'espace de travail** relient un projet à Slack et à Microsoft Teams pour les canaux d'incident et les notifications. Les blocs Slack et Microsoft Teams des flux de travail ne s'en servent pas : chaque bloc publie via sa propre URL de webhook entrant.

## Étapes suivantes

:::cards
- [Créer un flux de travail](/docs/workflows/authoring): Travaillez avec le canevas, les blocs et leurs paramètres.
- [Variables](/docs/workflows/variables): Transmettez des données entre les blocs et gardez les secrets hors de vos flux de travail.
- [Configuration et sécurité](/docs/workflows/configuration): Autorisations, limites et sécurité avant la mise en production.
:::
