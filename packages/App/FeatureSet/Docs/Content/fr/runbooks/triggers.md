# Déclencheurs de runbook

Un runbook peut démarrer de lui-même : selon une planification, ou quand un autre outil appelle son URL de webhook. Utilisez une planification pour les tâches de routine, comme un nettoyage nocturne ou une vérification hebdomadaire des certificats, et le webhook pour démarrer un runbook depuis un système d'alerte, un pipeline CI ou un script. Les deux se configurent sur la page **Déclencheurs** du runbook.

:::cards
- [Exécuter selon une planification](#exécuter-selon-une-planification): Toutes les quelques minutes, chaque jour, certains jours de la semaine, ou une expression cron.
- [Appeler le webhook](#appeler-le-webhook): Démarrer une exécution avec une requête POST vers l'URL du runbook.
- [Valeurs envoyées par un appel au webhook](#valeurs-envoyées-par-un-appel-au-webhook): Comment les étapes lisent le JSON qu'un appelant envoie.
- [Dépannage](#dépannage): Une planification qui ne s'exécute pas, un appel refusé.
:::

## Comment un déclencheur démarre une exécution

```mermaid title="D'une planification ou d'un appel au webhook à une exécution"
flowchart TB
    subgraph starts["Ce qui démarre l'exécution"]
        direction LR
        schedule["La planification<br/>: une heure arrive"]
        webhook["Le webhook : un<br/>POST vers son URL"]
    end
    schedule --> checks["Le runbook est activé<br/>et a des étapes"]
    webhook --> checks
    checks --> execution["Exécution, marquée<br/>Schedule ou Webhook"]
    execution --> worker["Le Worker OneUptime<br/>exécute les étapes"]
```

Un déclencheur démarre une exécution comme le fait **Exécuter maintenant** : l'exécution porte sur les étapes actuelles du runbook et n'est rattachée à aucun incident, aucune alerte ni aucun événement de maintenance planifiée. Chaque exécution enregistre ce qui l'a démarrée. Les **Exécutions** du runbook et **Runbooks → Exécutions** l'affichent sous **Déclenché par**, avec l'heure prévue d'une exécution planifiée ou l'adresse qui a appelé le webhook, et les deux listes peuvent être filtrées sur ce critère.

## Avant de commencer

- Un runbook avec au moins une étape, dont l'interrupteur **Exécuter ce runbook** est activé, sur sa page **Paramètres**.
- L'autorisation de modifier le runbook et de l'exécuter. Voir [Qui peut configurer les déclencheurs](#qui-peut-configurer-les-déclencheurs).

## Exécuter selon une planification

:::steps
### Ouvrir la page Déclencheurs du runbook
Ouvrez le runbook depuis **Runbooks** et cliquez sur **Paramètres → Déclencheurs** dans son menu latéral. **Paramètres** est replié au départ : cliquez dessus pour afficher **Déclencheurs**.

### Configurer la planification
Cliquez sur **Configurer la planification**. Sous **Quand il s'exécute**, choisissez une option de **Répéter** et ce qu'elle demande. La boîte de dialogue énonce la planification en une phrase, comme « S'exécute chaque jour de semaine à 09:00 », et liste ses prochaines exécutions au fil de vos modifications.

### Vérifier le fuseau horaire
**Fuseau horaire** commence par le vôtre. Les heures de la planification se lisent sur l'horloge de ce fuseau.

### L'enregistrer
Cliquez sur **Enregistrer la planification**. La planification est activée, et la carte l'affiche en une phrase avec ses **Prochaines exécutions**.
:::

| **Répéter** | Ce que vous choisissez | Exemple |
| --- | --- | --- |
| **Toutes les quelques minutes** | **Toutes les** : 1, 2, 3, 4, 5, 6, 10, 12, 15, 20 ou 30 minutes | Toutes les 15 minutes |
| **Toutes les quelques heures** | **Toutes les** : 1, 2, 3, 4, 6, 8 ou 12 heures, et **Minutes après l'heure** | Toutes les 2 heures à :30 |
| **Tous les jours** | **Heure** | Tous les jours à 09:00 |
| **Certains jours** | **Ces jours-là**, avec **Jours de semaine** et **Tous les jours** comme raccourcis, et **Heure** | Chaque jour de semaine à 09:00 |
| **Personnalisé (expression cron)** | **Expression cron** | `0 2 1 * *` : 02:00 le 1er de chaque mois |

Une expression cron a cinq champs : minute, heure, jour du mois, mois et jour de la semaine. Les runbooks s'exécutent au plus une fois par minute, il n'y a donc pas de champ des secondes. La boîte de dialogue explique une expression qu'elle ne sait pas lire, ou qui ne s'exécute jamais, comme `0 0 31 2 *`, et n'enregistre rien tant qu'elle ne peut pas s'exécuter.

La carte affiche ensuite la planification, ses trois prochaines exécutions sur l'horloge du fuseau, ce qu'elle fait quand une exécution est encore en cours ou qu'une heure a été manquée, et la **Dernière exécution planifiée** avec **Voir l'exécution**. **Modifier la planification** ouvre la même boîte de dialogue, et l'interrupteur **Exécuter selon cette planification** met la planification en pause sans la perdre.

### Si une exécution est encore en cours

Une exécution est encore en cours tant qu'elle est en file d'attente, en cours d'exécution ou en attente qu'une personne termine ou approuve une étape, quelle que soit la façon dont elle a démarré. Le réglage **Si une exécution est encore en cours** de la planification, replié sous **Plus de champs** dans la boîte de dialogue, décide de ce que fait une heure qui arrive à ce moment-là :

| Réglage | Ce qui se passe |
| --- | --- |
| **Ignorer cette heure** (par défaut) | Rien ne démarre. La planification attend sa prochaine heure. |
| **L'exécuter dès qu'elle se termine** | Une exécution attend et démarre quand l'exécution en cours se termine. Les autres heures qui arrivent entre-temps ne démarrent rien. |

### Si OneUptime a manqué une heure

Si OneUptime était arrêté ou en cours de mise à jour à une heure planifiée, l'heure est manquée dès qu'elle a plus de 5 minutes de retard. **Si OneUptime a manqué une heure** décide de ce qui se passe au retour de OneUptime :

| Réglage | Ce qui se passe |
| --- | --- |
| **L'exécuter une fois au retour de OneUptime** (par défaut) | Une exécution démarre, quel que soit le nombre d'heures manquées, marquée « Exécutée une fois pour rattraper les heures manquées par OneUptime ». |
| **Ignorer les heures manquées** | Rien ne démarre jusqu'à la prochaine heure. |

Les heures qui passent pendant que la planification ou le runbook est désactivé ne sont pas manquées : réactiver l'un ou l'autre reprend à partir de la prochaine heure.

### Fuseaux horaires et heure d'été

Les heures se lisent toute l'année sur l'horloge du fuseau. Une planification à 09:00 en Europe/London s'exécute à 09:00 heure de Londres en hiver comme en été. La nuit où l'on avance les horloges, une heure qui n'existe pas cette nuit-là s'exécute une heure plus tard sur l'horloge. Quand on recule les horloges et qu'une heure revient deux fois, une planification qui s'exécute toutes les heures s'exécute dans les deux, et toute autre planification une seule fois, à la première.

## Appeler le webhook

:::steps
### Activer le webhook
Sur la page **Déclencheurs** du runbook, activez **Exécuter quand cette URL est appelée**. Le runbook reçoit sa propre URL.

### Copier l'URL
L'**URL du webhook** est masquée : cliquez sur **Afficher** pour la voir, ou sur **Copier l'URL** pour la copier en entier. **Essayer** propose une commande `curl` pour commencer.

### L'appeler depuis votre outil
Envoyez une requête `POST` à l'URL, avec un objet JSON comme corps, ou sans corps :

```bash
curl -X POST "https://oneuptime.com/runbook/webhook/RUNBOOK_ID/SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "web-1", "reason": "Disk almost full"}'
```

### Vérifier l'exécution
La réponse nomme l'exécution démarrée : `{"runbookExecutionId": "...", "status": "Scheduled"}`. L'exécution figure dans les **Exécutions** du runbook, où **Déclenché par** indique **Webhook**, et sa page montre ce que l'appel a envoyé sous **Entrées**.
:::

**Envoyer une requête de test** envoie un `POST` avec un corps que vous écrivez à l'URL, comme le ferait un autre outil, et renvoie vers l'exécution démarrée. C'est une véritable exécution du runbook.

### Ce que répond un appel

| Réponse | Quand |
| --- | --- |
| `200` | L'exécution a démarré. Le corps la nomme. |
| `400` | Le corps n'est pas un objet JSON, est imbriqué sur plus de 32 niveaux ou contient un caractère NUL, ou le runbook n'a pas d'étapes. |
| `403` | Le webhook ou le runbook est désactivé. |
| `404` | Aucun webhook de runbook ne répond à cette URL : l'ID du runbook ou la clé est erroné, ou l'URL a été réinitialisée. |
| `405` | La requête est un `GET`. Un `GET` ne démarre jamais d'exécution, si bien qu'un aperçu de lien dans une messagerie ne peut pas l'exécuter par accident. |
| `413` | Le corps dépasse 64 Ko. |
| `429` | Le webhook a démarré 30 exécutions dans la dernière minute, 10 de ses exécutions sont encore en cours, ou une adresse a fait plus de 120 appels aux webhooks de runbook en une minute, ou les adresses d'un même /64 IPv6 plus de 1200 ensemble. L'en-tête `Retry-After` indique quand réessayer, quand c'est possible. |
| `503` | OneUptime ne peut pas compter les appels pour le moment. Réessayez dans une minute. |

Un appel refusé ne démarre rien, et son corps dit pourquoi en une phrase, par exemple "This runbook is turned off, so it was not started. Turn it on with Run this runbook, under the runbook's Settings."

### Garder l'URL privée

L'URL contient la clé secrète du runbook : quiconque la possède peut démarrer le runbook. La clé compte 43 caractères aléatoires, elle est comparée en temps constant, et une clé erronée reçoit la même réponse que s'il n'existait aucun runbook de ce type.

Si l'URL fuit, cliquez sur **Réinitialiser l'URL**. Le runbook reçoit une nouvelle URL, et l'ancienne cesse aussitôt de fonctionner : donnez la nouvelle à chaque outil qui l'appelle. Désactiver puis réactiver le webhook conserve la même URL.

## Valeurs envoyées par un appel au webhook

Les valeurs de premier niveau du corps deviennent les entrées de l'exécution. Elles parviennent aux étapes sous forme de données, jamais sous forme de texte collé dans un script ou une commande :

| Type d'étape | Comment elle lit les entrées |
| --- | --- |
| Bash et kubectl | Des variables d'environnement : une `ONEUPTIME_INPUT_<NAME>` pour chaque valeur de premier niveau, `ONEUPTIME_INPUTS` avec l'objet entier en JSON, et `ONEUPTIME_TRIGGER` avec ce qui a démarré l'exécution, comme `Webhook` ou `Schedule`. |
| JavaScript | `args.inputs`, l'objet tel qu'envoyé, et `args.trigger`. |
| AI | Dans son prompt, marquées comme données venant de l'extérieur de OneUptime, quand **Inclure le contexte du déclencheur** est activé. |
| HTTP request et SSH | Pas du tout. Leur URL, leur script et leur cible sont ceux écrits dans le runbook, et rien de ce qu'envoie un appelant ne les modifie. |

Le nom d'une variable est le nom de la valeur en majuscules, chaque caractère autre qu'une lettre ou un chiffre étant écrit `_` : `host-name` devient `ONEUPTIME_INPUT_HOST_NAME`. Le texte est transmis tel quel, les nombres et `true` ou `false` tels qu'écrits, et les objets et listes en JSON. Une étape reçoit au plus 100 de ces variables, et un nom de plus de 100 caractères n'en devient aucune ; chaque valeur reste dans `ONEUPTIME_INPUTS`. Chaque nom commence par `ONEUPTIME_`, si bien qu'un appelant ne peut définir ni `PATH` ni aucune autre variable que lit le Runner.

C'est l'appelant qui décide de ces valeurs : vérifiez-les avant d'agir en conséquence :

```bash
set -euo pipefail
case "$ONEUPTIME_INPUT_HOST" in
  web-1|web-2|web-3) ;;
  *) echo "Unknown host: $ONEUPTIME_INPUT_HOST"; exit 1 ;;
esac
curl -fsS -X POST "http://$ONEUPTIME_INPUT_HOST.internal:8080/restart"
```

```javascript
const host = args.inputs.host;
if (!["web-1", "web-2", "web-3"].includes(host)) {
  throw new Error(`Unknown host: ${host}`);
}
console.log(`Started by ${args.trigger} for ${host}`);
return { host };
```

## Qui peut configurer les déclencheurs

Une planification ou un webhook démarre des exécutions sans personne présente ; en configurer un demande donc l'autorisation de modifier le runbook et de l'exécuter : Project Owner, Project Admin ou Runbook Admin, ou **Edit Runbook** associé à Project Member, Runbook Member ou **Create Runbook Execution**. Les libellés auxquels un rôle est limité comptent, comme pour **Exécuter maintenant**. Voir ou réinitialiser l'URL du webhook demande la même chose.

Désactiver une planification ou un webhook ne démarre rien et ne demande donc que l'autorisation de modifier le runbook. Une personne qui peut modifier le runbook sans pouvoir l'exécuter voit la page **Déclencheurs** avec **Configurer la planification** verrouillé, et apprend qui peut voir l'URL du webhook.

## Dépannage

:::details Rien ne s'exécute selon la planification
Le runbook est désactivé ou n'a pas d'étapes : la carte dit lequel. Activez **Exécuter ce runbook** sur la page **Paramètres** du runbook, ou ajoutez des étapes sur sa page **Étapes**. Si la carte indique que la planification est en pause, activez **Exécuter selon cette planification**.
:::

:::details Une heure planifiée n'a rien démarré
Une exécution était encore en cours et la planification ignore ces heures-là, ou OneUptime a manqué l'heure et la planification ignore les heures manquées. Voir [Si une exécution est encore en cours](#si-une-exécution-est-encore-en-cours) et [Si OneUptime a manqué une heure](#si-oneuptime-a-manqué-une-heure).
:::

:::details L'enregistrement d'une planification échoue avec "You do not have permission to set up this runbook's schedule or webhook."
Configurer un déclencheur demande l'autorisation d'exécuter le runbook en plus de celle de le modifier. Demandez Runbook Admin, ou Runbook Member ou **Create Runbook Execution** en plus de **Edit Runbook**.
:::

:::details Un appel reçoit la réponse "No runbook webhook answers at this URL."
L'URL a été réinitialisée ou mal copiée. Copiez-la de nouveau depuis la page **Déclencheurs** du runbook.
:::

:::details Un appel reçoit la réponse "This runbook's webhook is turned off, so the runbook was not started."
Activez **Exécuter quand cette URL est appelée** sur la page **Déclencheurs** du runbook. L'URL est la même qu'avant.
:::

## Étapes suivantes

:::cards
- [Exécuter un runbook](/docs/runbooks/running): Ce qu'affiche une exécution, et comment la faire avancer.
- [Rédiger un runbook](/docs/runbooks/authoring): Écrire les étapes qu'un déclencheur exécute.
- [Configuration & sécurité des runbooks](/docs/runbooks/configuration): Limites, autorisations et durcissement.
:::
