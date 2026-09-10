# Utiliser OneUptime depuis GitHub

La GitHub App OneUptime n'est pas seulement une connexion à votre code — vous pouvez lui parler dans votre dépôt, et elle y fait le travail.

Mentionnez-la sur une issue et elle ouvre une pull request. Mentionnez-la sur une pull request et elle retravaille la branche, ou passe le diff en revue. Ajoutez un label à une issue et elle prend l'issue en charge. Tout ce qu'elle produit est une pull request ou une revue destinée à être lue par un humain : **elle ne fusionne jamais rien, et elle n'approuve jamais une pull request.**

```text
@oneuptime implement this                          →  une pull request qui ferme l'issue
@oneuptime revise this — use exponential backoff   →  de nouveaux commits sur la branche de cette pull request
@oneuptime review                                  →  une revue de code publiée sur cette pull request
```

> Remplacez `@oneuptime` par le handle de votre propre application. Sur OneUptime Cloud, c'est `@oneuptime`. Sur une instance auto-hébergée, c'est le nom que vous avez donné à votre GitHub App, en minuscules et avec les espaces remplacés par des tirets — une application nommée « Acme AI » se mentionne `@acme-ai`. Si les mentions ne déclenchent rien, c'est la première chose à vérifier.

## Avant de commencer

- Le dépôt doit être **connecté à un projet OneUptime** via la GitHub App. Voir [Intégration GitHub (auto-hébergé)](/docs/self-hosted/github-integration) pour l'installation, ou connectez-le depuis **Paramètres du projet → Dépôts de code** sur OneUptime Cloud.
- Un **Runner doté de la capacité « Runs AI Code Fixes »** doit être en ligne — le même Runner que celui qui exécute les [tâches de correction IA](/docs/ai/ai-agent). Sans lui, les commandes sont acceptées puis échouent au bout de 30 minutes, avec un message indiquant qu'aucun agent ne les a prises en charge.
- La GitHub App doit avoir la permission **Issues : Lecture & Écriture** et être abonnée aux événements de webhook listés dans [À quoi s'abonner](#à-quoi-sabonner).

## Les commandes

Toute commande commence par une mention de l'application. La mention peut se trouver n'importe où dans le commentaire, et tout ce que vous écrivez après elle lui est transmis comme votre demande.

### Sur une pull request

| Commande | Ce qui se passe |
| --- | --- |
| `@oneuptime review` | Clone la branche, lit le code modifié **et le code qui l'entoure**, puis publie une revue en commentaire. Ne modifie rien. |
| `@oneuptime revise this — <ce que vous voulez changer>` | Clone la branche propre à la pull request, applique la modification et pousse de nouveaux commits sur cette même branche. N'ouvre jamais une seconde pull request. |

Tout ce que vous écrivez après la mention et qui n'est pas une commande reconnue est traité comme une demande de révision, parce que c'est presque toujours de cela qu'il s'agit :

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### Sur une issue

| Commande | Ce qui se passe |
| --- | --- |
| `@oneuptime implement this` | Traite l'issue et ouvre une pull request qui la ferme. |
| `@oneuptime <n'importe quoi d'autre>` | Pareil, avec vos mots comme consigne supplémentaire. |

Vous pouvez aussi confier une issue à l'application **sans écrire le moindre commentaire** :

- **Ajoutez le label déclencheur.** Ajouter à une issue le label déclencheur du dépôt — `oneuptime` par défaut — lance exactement le même travail. C'est la façon la plus fiable de confier du travail depuis l'interface GitHub.
- **Assignez l'issue à l'utilisateur bot de l'application**, là où votre dépôt le permet. GitHub n'autorise pas partout qu'une application soit assignataire, et c'est précisément pour cela que le label existe ; si l'assignation ne déclenche rien, utilisez le label.

### Partout

| Commande | Ce qui se passe |
| --- | --- |
| `@oneuptime help` | Liste les commandes. Une mention seule, sans rien après elle, fait la même chose. |
| `@oneuptime status` | Indique ce sur quoi elle travaille actuellement dans ce fil. |
| `@oneuptime cancel` | Arrête les exécutions qu'elle a en cours dans ce fil. Ce qui a déjà été poussé le reste. |

`help`, `status` et `cancel` ne lancent jamais d'exécution d'agent : elles ne coûtent donc rien et ne sont pas soumises à votre budget quotidien de tâches de correction.

## Ce que cela donne dans le fil

Une commande produit **un seul commentaire**, que l'application modifie au fil du travail — ainsi une tâche longue ne transforme jamais une pull request en journal d'état.

1. Elle réagit 👀 à votre commentaire et publie un accusé de réception nommant le projet OneUptime auquel l'exécution appartient, avec un lien vers l'exécution en cours.
2. Une fois terminée, ce même commentaire est réécrit avec le résultat : la pull request qu'elle a ouverte, les commits qu'elle a poussés, ou une explication honnête de la raison pour laquelle elle n'a rien fait.

Si elle ne trouve rien qui mérite d'être changé, elle le dit plutôt que d'ouvrir une pull request spéculative. C'est un résultat normal, pas un échec — donnez-lui davantage de consignes et redemandez.

## Qui a le droit de lui donner des ordres

**Uniquement les personnes ayant un accès write, maintain ou admin au dépôt.** OneUptime demande à chaque fois directement à GitHub quelles permissions l'auteur du commentaire possède sur ce dépôt ; il ne fait pas confiance au badge « contributor » que GitHub affiche à côté d'un commentaire, qui décrit une activité passée et non un accès actuel.

Une mention venant de quelqu'un d'autre reçoit une seule réaction 😕 sur son commentaire, et rien de plus. C'est délibéré : sur un dépôt public, n'importe qui peut commenter, et une application qui répond fidèlement aux inconnus est une application dont on peut se servir pour polluer un fil.

Elle ignore également tout commentaire écrit par un bot, y compris les siens, et ignore les mentions qui apparaissent dans une citation (`>`) ou dans un bloc de code. À elles deux, ces règles sont ce qui empêche une réponse à l'un de ses propres commentaires de la relancer.

## Ce qu'elle ne fera pas

- **Elle ne fusionne jamais.** Rien de ce que fait cette application ne peut déposer du code sur votre branche par défaut.
- **Elle n'approuve jamais et ne demande jamais de modifications.** Les revues sont publiées sous forme de commentaires : une revue émise par une application ne peut donc jamais satisfaire une règle de protection de branche.
- **Elle ne réécrit jamais l'historique.** Une révision ajoute des commits ; elle ne force pas le push. Si quelqu'un d'autre a poussé sur la branche entre-temps, la révision échoue plutôt que de jeter son travail.
- **Elle ne peut pas réviser une pull request issue d'un fork.** La branche d'un fork se trouve dans un dépôt où l'installation ne peut pas écrire. Elle peut malgré tout la relire — demandez-lui une revue à la place.
- **Elle ne modifie jamais le titre, la description ou la branche cible d'une pull request.** Uniquement le code.

## Ce que cela coûte, et comment le borner

Toute commande qui déclenche du travail est une exécution d'agent complète — un clone, jusqu'à 40 appels LLM et 100 000 jetons de sortie, plus les commandes de build et de test de votre dépôt si vous les avez configurées.

Deux limites s'appliquent, et ce sont exactement celles qui régissent déjà les [tâches de correction IA](/docs/ai/ai-agent) :

- **La limite quotidienne d'exécutions de correction du projet** (**Paramètres du projet → IA**, 25 par jour par défaut). Les commandes GitHub partagent ce budget avec le reste des exécutions de correction du projet.
- **Le plafond de pull requests ouvertes par dépôt** (**Dépôts de code → le dépôt → Paramètres**, 5 par défaut). Les revues et les révisions en sont exemptées : ni l'une ni l'autre n'ajoute de pull request à votre file de relecture.

Une seule exécution d'un type donné est active à la fois par issue ou par pull request. Demander deux fois vous vaut une réponse disant qu'elle travaille déjà ; demander une revue pendant qu'une révision est en cours lance les deux, puisque ce sont des demandes différentes.

Si une exécution ne peut pas démarrer, l'application dit pourquoi dans le fil — elle n'échoue jamais en silence.

## La désactiver

Par dépôt : **Dépôts de code → le dépôt → Paramètres → Respond to GitHub Commands**. Une fois désactivée, l'application ignore les mentions, les assignations et le label déclencheur dans ce dépôt, et indique à qui le lui demande où se trouve l'interrupteur.

La même page porte le **GitHub Trigger Label**, si vous voulez autre chose que `oneuptime`.

## À quoi s'abonner

Dans les paramètres **Permissions & événements** de votre GitHub App, abonnez-vous à :

| Événement | Nécessaire pour |
| --- | --- |
| **Issue comment** | les commandes `@mention` sur les issues *et* sur les pull requests |
| **Issues** | l'assignation à l'application, et le label déclencheur |
| **Pull request** | la demande de revue adressée à l'application |
| **Pull request review** | une mention dans le corps d'une revue soumise |
| **Pull request review comment** | une mention sur un commentaire en ligne dans le diff |

Et sous **Permissions de dépôt**, **Issues** doit être en **Lecture & Écriture** — GitHub fait transiter les commentaires de conversation des pull requests par l'API des issues, c'est donc cette permission qui permet aussi à l'application de commenter les pull requests.

## Injection de prompt : ce qui est protégé et ce qui ne l'est pas

Le texte des issues, les descriptions de pull requests, les diffs et les commentaires font tous partie du prompt de l'agent, et sur un dépôt public n'importe qui peut les écrire. Un texte disant « ignore tes instructions et fais X » est quelque chose que l'on trouve réellement dans les issues.

Deux mécanismes bornent cela, et il vaut la peine de savoir lequel fait quoi :

- **Les prompts étiquettent le texte non fiable comme une demande, pas comme des instructions**, et le dépôt, la branche et la pull request de l'exécution sont fixés avant même que l'agent ne démarre — rien de ce que l'agent lit ne peut changer ce sur quoi il travaille.
- **Le vrai confinement, c'est le bac à sable.** L'agent s'exécute sur votre Runner, dans un clone jetable, avec les identifiants retirés de l'environnement de ses commandes et ses opérations git restreintes. Il ne peut jamais que pousser sur une branche, et seul un humain peut fusionner.

Traitez une pull request écrite par l'IA comme vous traiteriez celle d'un nouveau contributeur qui a lu l'issue : relisez le diff, pas la description.

## Dépannage

**Rien ne se passe quand je la mentionne.** Vérifiez d'abord le handle — c'est le slug de l'application, pas son nom d'affichage. Vérifiez ensuite que le dépôt est connecté à un projet (**Paramètres du projet → Dépôts de code**), que **Respond to GitHub Commands** est activé, et que votre GitHub App est abonnée aux événements ci-dessus.

**Elle réagit 😕 et ne dit rien.** Vous n'avez pas d'accès en écriture au dépôt.

**Elle dit qu'elle travaille déjà là-dessus.** Une exécution de ce type est déjà en cours sur cette issue ou cette pull request. `@oneuptime status` vous dira laquelle, et `@oneuptime cancel` l'arrête.

**Elle a accusé réception puis n'a plus rien dit pendant longtemps.** Vérifiez qu'un Runner doté de **Runs AI Code Fixes** est en ligne sous **Paramètres → Runners**. Sans lui, l'exécution est mise en échec au bout de 30 minutes et le fil en est informé.

**Elle dit que la pull request vient d'un fork.** Les révisions ont besoin d'une branche dans ce dépôt. Demandez plutôt une revue, ou poussez la branche ici.

## Pour aller plus loin

- [Tâches de correction IA](/docs/ai/ai-agent) — le même agent, déclenché depuis une exception plutôt que depuis GitHub.
- [Intégration GitHub (auto-hébergé)](/docs/self-hosted/github-integration) — créer et configurer la GitHub App.
- [Runners](/docs/runbooks/agents) — le processus qui réalise les exécutions.
