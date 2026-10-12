# Quitter StatusCake

**Importer depuis un autre outil** fait venir vos vérifications StatusCake dans OneUptime en quelques minutes. Avec une clé API StatusCake, OneUptime lit vos vérifications de disponibilité, SSL et heartbeat, vous montre ce qu'il a trouvé et crée ce que vous cochez. Rien ne change dans StatusCake.

:::cards
- [Importer votre compte](#importer-votre-compte-statuscake) : Créez une clé, lisez votre compte et cochez ce qu'il faut importer.
- [Ce qui est importé](#ce-qui-est-importé) : Ce que devient chaque vérification StatusCake dans OneUptime.
- [Terminer la migration](#terminer-la-migration) : Ce qu'il reste à faire une fois l'import terminé.
:::

## Fonctionnement

```mermaid title="D'une clé API StatusCake à un rapport"
flowchart TB
    key["Clé API"] --> read["OneUptime lit<br/>votre compte StatusCake"]
    read --> preview["Vous voyez ce qui a été trouvé<br/>et cochez ce qu'il faut importer"]
    preview --> import["L'import s'exécute<br/>en arrière-plan"]
    import --> report["Un rapport renvoie vers<br/>chaque enregistrement créé"]
```

- **La clé ne sert qu'une fois.** Elle est conservée chiffrée pendant que OneUptime lit votre compte et supprimée dès la fin de la lecture, qu'elle ait réussi ou non. Elle n'est jamais réaffichée ni écrite dans un journal.
- **OneUptime ne fait que lire.** Il n'appelle que l'API de StatusCake : `api.statuscake.com`. Il fait une requête par seconde, ce qui reste dans les 60 par minute que StatusCake accorde à un compte Free. Quand StatusCake lui demande de ralentir, il attend puis réessaie.
- **Rien n'est créé avant que vous lanciez l'import.** L'aperçu indique, pour chaque élément, s'il est nouveau, déjà dans OneUptime (et utilisé tel quel), repris par un import précédent, ou pourquoi il ne peut pas être importé.
- **Relancer l'import ne crée jamais rien en double.** OneUptime retient ce que chaque import a repris, par son identifiant StatusCake. Relancez-le après avoir ajouté des vérifications dans StatusCake : seuls les nouveaux sont créés.

## Avant de commencer

- **Un projet OneUptime, et le droit de créer ce que vous importez.** Les propriétaires et administrateurs du projet peuvent tout importer. Les autres rôles peuvent aussi lancer un import, et importer les types d'enregistrements qu'ils peuvent créer. Le reste est affiché comme non importé, avec la raison.
- **Une clé API StatusCake.** L'import n'écrit jamais dans StatusCake.
- **Un moyen de paiement, sur OneUptime Cloud.** Les moniteurs qui effectuent des vérifications sont facturés à l'usage, même avec l'offre Free : ajoutez-en un dans **Paramètres du projet** > **Facturation** avant l'import. Sans lui, ces moniteurs sont affichés comme non importés.

## Importer votre compte StatusCake

:::steps
### Créer une clé API dans StatusCake
Dans StatusCake, ouvrez le panneau de votre compte et allez dans **API Keys**. Créez une clé nommée `OneUptime import` et copiez-la.

### Ouvrir la page d'import
Dans OneUptime, ouvrez **Paramètres du projet** > **Importer depuis un autre outil** et sélectionnez **StatusCake**.

### Connecter StatusCake
Collez la clé dans **Clé API StatusCake** et sélectionnez **Lire mon compte StatusCake**. Un compte volumineux prend quelques minutes, et vous pouvez quitter la page pendant la lecture.

### Cocher ce qu'il faut importer
L'aperçu liste ce qui a été trouvé, une section par type. Tout ce qui serait créé est coché au départ, sauf les vérifications en pause dans StatusCake, qui sont importées en pause si vous les cochez. Sous chaque élément, OneUptime indique ce qui ne sera pas importé exactement à l'identique.

### Lancer l'import
Sélectionnez **Lancer l'import**. L'import s'exécute en arrière-plan : vous pouvez quitter la page, et le rapport vous y attend.
:::

Le rapport compte ce qui a été créé et non importé, et liste chaque élément avec un lien vers l'enregistrement qu'il est devenu, les échecs en premier. Les imports précédents sont listés sous **Imports précédents** sur la même page.

## Ce qui est importé

| Dans StatusCake | Dans OneUptime | Comment |
| --- | --- | --- |
| Uptime, SSL and heartbeat checks | Moniteurs | Chaque vérification devient un moniteur du même type, avec la même adresse, le même intervalle, le même délai d'attente et le texte qu'une page doit, ou ne doit pas, contenir. |

- **Les vérifications HTTP et HEAD** deviennent des moniteurs de site web, ou des moniteurs d'API quand elles envoient des données ou des en-têtes. StatusCake liste les codes de statut qui déclenchent une alerte : tout autre code compte aussi comme disponible dans OneUptime.
- **Les vérifications ping et TCP** deviennent des moniteurs ping et de port. **Les vérifications SMTP et SSH** deviennent des moniteurs de port sur leur port : OneUptime vérifie que le port répond, pas l'échange qui s'y déroule.
- **Les vérifications DNS** deviennent des moniteurs DNS, auprès du même serveur.
- **Les vérifications SSL** deviennent des moniteurs de certificat SSL qui avertissent aussi tôt que la première alerte. Une vérification de disponibilité avec des alertes SSL en reçoit un aussi.
- **Les vérifications heartbeat** deviennent des moniteurs de requêtes entrantes, qui tombent quand aucune requête n'est arrivée pendant la période. Chacun a une nouvelle adresse dans OneUptime.

Chaque moniteur est vérifié par les sondes de votre projet, comme un moniteur que vous créez vous-même. Un intervalle que OneUptime ne propose pas devient le plus proche qu'il propose, et un délai d'attente de plus d'une minute devient une minute. L'aperçu indique quand l'un ou l'autre change.

## Ce qui n'est pas importé

- **L'historique de disponibilité, les temps de réponse et les incidents.** OneUptime commence à vérifier une fois l'import terminé.
- **Les contacts d'alerte et les intégrations.** Choisissez qui est prévenu dans OneUptime, comme décrit dans [Terminer la migration](#terminer-la-migration).
- **Les mots de passe, et les en-têtes qui peuvent contenir un secret.** Un moniteur qui se connecte, ou qui envoie un en-tête `Authorization`, de cookie ou de jeton, est importé sans lui : ajoutez-le avec un [secret de moniteur](/docs/monitor/monitor-secrets).
- **Les adresses qu'attend une vérification DNS.** Ajoutez-les comme critères dans OneUptime.
- **Les vérifications de vitesse de page, de domaine et de serveur.** OneUptime a sa propre [surveillance de domaine](/docs/monitor/domain-monitor) et sa surveillance de serveur, à configurer à la place.
- **Les fenêtres de maintenance.** L'aperçu les compte : planifiez-les comme maintenance planifiée dans OneUptime.

## Limites

Un import crée au plus 2 000 enregistrements, et au plus 1 000 moniteurs. Tout ce qui dépasse une limite est affiché comme non importé. Relancez l'import pour reprendre le reste.

Sur OneUptime Cloud, les moniteurs qui effectuent des vérifications ont besoin d'un moyen de paiement, et ce pour quoi votre offre n'a plus de place est affiché comme non importé, avec ce qu'il lui faut.

Un aperçu est conservé un jour. Seule la personne qui a lu le compte peut cocher et lancer l'import. Les propriétaires et administrateurs du projet voient la progression et le rapport de chaque import.

## Terminer la migration

:::steps
### Vérifier vos moniteurs
Ouvrez chacun d'eux sous **Moniteurs** et vérifiez ses premiers résultats. Un moniteur heartbeat a une nouvelle adresse : faites pointer dessus la tâche qui l'appelle.

### Choisir qui est prévenu
Ajoutez des propriétaires à vos moniteurs, ou une politique d'astreinte sous **Astreinte** > **Politiques d'astreinte** aux incidents qu'ils ouvrent, pour que les bonnes personnes soient prévenues quand quelque chose tombe en panne.

### Désactiver les vérifications dans StatusCake
Dès que OneUptime vérifie les mêmes choses, mettez-les en pause dans StatusCake pour que personne ne soit prévenu deux fois.
:::

## Dépannage

:::details StatusCake n'a pas accepté la clé API
Vérifiez que vous avez copié la clé entière depuis **API Keys**, et qu'elle n'a pas été supprimée. Sélectionnez ensuite **Réessayer**.
:::

:::details Un moniteur est affiché comme non importé
Il indique pourquoi : un type de moniteur que OneUptime n'a pas, une adresse que OneUptime ne peut pas lire, ou un projet sans place ni moyen de paiement pour lui. Un moniteur que OneUptime exécute déjà, avec le même nom, le même type et la même adresse, est utilisé tel quel.
:::

:::details Certains éléments ne peuvent pas être cochés
Chacun indique pourquoi : un nom que le projet a déjà, quelque chose qu'un import précédent a repris, ou un enregistrement que vous n'avez pas le droit de créer ou que votre offre n'inclut pas.
:::

## Étapes suivantes

:::cards
- [Surveillance de site web](/docs/monitor/website-monitor) : Ce qu'un moniteur de site web vérifie, et comment.
- [Surveillance de certificat SSL](/docs/monitor/ssl-certificate-monitor) : Comment OneUptime avertit avant l'expiration d'un certificat.
- [Quitter Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) : Faire venir vos vérifications depuis Uptime Kuma.
:::
