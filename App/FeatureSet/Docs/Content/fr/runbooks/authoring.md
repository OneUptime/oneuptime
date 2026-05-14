# Rédiger un runbook

Créez un runbook depuis **Runbooks → Créer un runbook**, puis ouvrez-le et allez dans l'onglet **Étapes**.

## Anatomie d'une étape

Chaque étape comporte :

| Champ | Rôle |
| --- | --- |
| **Titre** | Libellé court affiché dans la liste. Obligatoire. |
| **Description** | Contexte facultatif pour le répondeur. Texte Markdown. |
| **Continuer en cas d'échec** | Si activé, une étape qui échoue n'arrête pas l'exécution — la suivante démarre quand même. |
| **Configuration spécifique au type** | Script, URL, etc. — voir ci-dessous. |

Les étapes s'exécutent **dans l'ordre**. Réorganisez-les avec les flèches haut/bas dans l'éditeur.

## Types d'étapes

### Manuelle

Une case à cocher que le répondeur valide. L'exécution se met en pause à une étape manuelle et reste à `WaitingForManualStep` jusqu'à ce que quelqu'un la marque comme terminée (ou la saute).

À utiliser pour ce que seul un humain peut vérifier : « Le trafic a bien basculé vers la région secondaire selon le tableau de bord du load balancer — confirmé. »

### JavaScript

Un extrait JavaScript exécuté dans un bac à sable `isolated-vm` (pas d'accès au système de fichiers ni au réseau, sauf à fournir une API) — mais le bac à sable vit sur un [Agent de Runbook](/docs/runbooks/agents) dans votre propre infrastructure, pas sur le Worker OneUptime. Configurez un **Agent Tag** sur l'étape pointant vers le ou les agents qui doivent l'exécuter. Si aucun agent avec ce tag n'est en ligne, l'étape attend jusqu'au **claim timeout** (par défaut 2 minutes) puis échoue.

```js
const start = Date.now();
// ... votre logique ...
return { durationMs: Date.now() - start };
```

La valeur retournée est enregistrée dans l'exécution de l'étape. Les sorties `console.log` sont capturées en lignes de log. Délai par défaut : 30 secondes.

### Requête HTTP

Appel HTTP sortant. Configurez la méthode (GET/POST/PUT/PATCH/DELETE/HEAD), l'URL, les en-têtes JSON optionnels et un corps optionnel. Le statut, les en-têtes et le corps de la réponse sont enregistrés (plafonnés à 50 Ko au total).

Utile pour : ouvrir un incident PagerDuty, poster dans Slack, appeler votre propre API admin, etc.

### Bash

Un script bash qui tourne sur un [Agent de Runbook](/docs/runbooks/agents) — un petit processus que vous installez sur un hôte dans votre propre infrastructure. Les étapes Bash ne s'exécutent jamais sur le Worker OneUptime.

Configurez deux choses sur une étape Bash :

- **Agent Tag** — le tag qui identifie le ou les agents qui doivent exécuter cette étape. Tout agent sain du projet portant ce tag réclamera et exécutera le job.
- **Script** — le bash à exécuter. La sortie (stdout + stderr) est capturée jusqu'à 50 Ko ; le processus est tué en cas de timeout.

Si aucun agent portant le tag choisi n'est en ligne lorsque le runbook atteint cette étape, l'étape attend jusqu'au **claim timeout** (par défaut 2 minutes) puis échoue. Ajoutez un agent dans **Runbooks → Agents** avant de dépendre d'une étape Bash.

## Sauvegarde et édition

Cliquez sur **Enregistrer les étapes** pour persister. Les exécutions en cours d'anciennes versions du runbook ne sont pas affectées — elles continuent avec leur snapshot.

## Multiples étapes et gestion d'échec

Par défaut, une étape qui échoue arrête l'exécution et la marque `Failed`. Si vous activez **Continuer en cas d'échec**, l'échec est enregistré mais l'étape suivante s'exécute. C'est pratique pour « essayer ces trois choses, puis notifier ».

## Un exemple complet

Un runbook simple pour « DB primaire injoignable » :

1. **JavaScript** — récupérer l'hôte primaire actuel depuis le service de configuration et le journaliser.
2. **Manuelle** — « Lag de réplication du secondaire inférieur à 5 secondes — confirmé. »
3. **Requête HTTP** — POST vers l'API de votre orchestrateur de bascule.
4. **Manuelle** — « Les écritures vont bien sur le nouveau primaire — confirmé. »
5. **Requête HTTP** — POST sur Slack avec un message « tout est rétabli ».

Le répondeur regarde une étape automatisée se dérouler, valide une étape manuelle, regarde la suivante, et ainsi de suite. La sortie de chaque étape est conservée pour le post-mortem.
