# Créer un moniteur

Un moniteur vérifie quelque chose que vous exploitez, comme un site web, une API, un hôte ou un cluster Kubernetes, et vous prévient quand cela cesse de fonctionner. **Créer un moniteur** demande d'abord quoi surveiller, puis quoi vérifier, puis à quelle fréquence. Tout, sauf le type, le nom et ce qu'il faut vérifier, commence avec des valeurs par défaut qui conviennent à la plupart des moniteurs.

Pour un site web ou une API, une configuration guidée vous mène plutôt de son adresse jusqu'à un appel de test : cliquez sur **Configuration guidée** dans la liste vide **Moniteurs**, ou sous **Fonctionnement**. **Créer un moniteur** la propose aussi, dès que vous choisissez **Site web** ou **API**. Voir [Savoir quand votre site web ou votre API tombe](/docs/guides/website-down).

> [!NOTE]
> Pour créer un moniteur, il vous faut le rôle Propriétaire du projet, Administrateur du projet, Membre du projet, Administrateur des moniteurs ou Membre des moniteurs, ou un rôle personnalisé avec l'autorisation Create Monitor.

## Quoi surveiller

La première étape demande quoi surveiller, où le trouver et comment appeler le moniteur.

:::steps
### Ouvrir Créer un moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. Le formulaire s'ouvre sur sa première étape, **Quoi surveiller**.

### Choisir le type de moniteur

La première question est le **Type de moniteur** : que voulez-vous surveiller ?

- Les six types que la plupart des gens créent viennent en premier : **Site web**, **API**, **Ping**, **Port**, **Certificat SSL** et **Requête entrante**, pour les heartbeats des tâches cron et des webhooks.
- **Plus de types de moniteurs** liste tous les autres types sous leur catégorie, comme **Infrastructure** (Kubernetes, Docker, hôte) et **Télémétrie** (journaux, métriques, traces). **Manuel**, un moniteur dont vous définissez vous-même l'état, et **Statut de la sonde**, qui vous prévient quand une sonde se déconnecte, se trouvent sous **Autre**.
- Ou tapez dans le champ de recherche. Il connaît les mots que vous utilisez déjà, comme `k8s`, `postgres`, `heartbeat` ou `tls`, et **Entrée** choisit le premier résultat.

Le type choisi se réduit à une ligne. Cliquez sur **Modifier** pour en choisir un autre ; appuyez sur **Escape** pendant le choix pour garder le type que vous aviez.

### Saisir où le trouver

Un type dont la vérification porte sur une adresse la demande juste après le type : l'**URL du site web** d'un site web ou d'un certificat SSL, l'**URL de l'API** d'une API, l'hôte ou l'adresse IP à pinguer, un hôte et son **Port**, ou un serveur NTP. Le champ montre un exemple. Sous l'adresse d'un site web ou d'une API, **Contourner les caches à chaque vérification** montre comment y mettre une valeur qui change à chaque vérification. Les autres types demandent où regarder à l'étape suivante, comme le domaine d'un moniteur DNS ou la connexion d'une base de données.

### Nommer le moniteur

Renseignez le **Nom**. Après une adresse, il se remplit tout seul, par exemple avec `example.com`, jusqu'à ce que vous en écriviez un vous-même. Il est utilisé dans les alertes et les titres d'incident. **Description** et **Étiquettes** sont facultatifs et attendent sous **Plus de champs**.

Un moniteur **Manuel** n'a besoin de rien de plus, donc **Créer un moniteur** se trouve sur cette étape. Pour tout autre type, cliquez sur **Suivant**.
:::

## Critères

La deuxième étape demande quoi vérifier et décide de ce qui compte comme un problème.

:::steps
### Saisir ce qu'il faut vérifier

Cette étape s'ouvre sur le reste de ce que lit la vérification. Un moniteur d'une adresse l'affiche sous **Cible du moniteur**, avec ce qu'il demande d'autre, comme la méthode de requête d'une API ; les autres types demandent ici un domaine, une requête, un cluster ou un filtre de journaux. Les réglages que la plupart des moniteurs ne changent jamais, comme les délais d'expiration et les nouvelles tentatives, sont repliés sous **Plus de champs**.

Pour un moniteur que des sondes vérifient, **Tester le moniteur** exécute la vérification une fois avant que vous enregistriez, sur une sonde qui vérifie le moniteur : cliquez sur **Exécuter le test**, ou choisissez d'abord une autre sonde sous **Sélectionner la sonde**. **Résultat du test du moniteur** dit à quel critère la réponse correspond et ce qui s'ensuivrait (le statut, l'incident ou l'alerte et qui est prévenu), puis montre ce que la sonde a trouvé.

### Passer en revue les critères

En dessous, les **Critères** décident quand le moniteur change d'état, déclare un incident ou crée une alerte. Un nouveau moniteur commence avec des critères qui conviennent à la plupart des moniteurs, chacun replié sur une ligne qui dit ce qu'il vérifie et ce qu'il fait. Un nouveau moniteur de site web, par exemple, est marqué hors ligne et déclare un incident quand le site ne répond pas ou répond avec un code de statut d'erreur.

Cliquez sur un critère pour l'ouvrir et le modifier. **Ajouter un critère** en ajoute un, ouvert et prêt à remplir. Pour changer l'ordre, faites glisser un critère par la poignée à sa gauche.

Un moniteur de journaux, de traces, d'exceptions ou de métriques demande plutôt de quoi il doit vous informer, et configure une seule règle en termes simples : ce qu'il faut surveiller, **Quand alerter** et **Ce qui se passe**, avec un graphique de ce que la règle aurait détecté. Voir [Surveillance des journaux](/docs/monitor/logs-monitor#créer-un-moniteur-de-journaux).

### Passer à l'étape suivante

Cliquez sur **Suivant**. Rien sur cette étape n'est signalé comme manquant avant que vous cliquiez sur **Suivant**.
:::

### Comment les critères sont évalués

Le résultat de chaque vérification passe par les critères de haut en bas, et le premier qui correspond décide de ce qui se passe. Ce critère peut changer l'état du moniteur, déclarer un incident, créer une alerte, ou toute combinaison des trois. Quand aucun ne correspond, le moniteur affiche son **État du moniteur par défaut**, défini sous **Plus de champs** sous les critères (**Opérationnel**, sauf si vous en choisissez un autre).

```mermaid title="D'une vérification à un état, un incident ou une alerte"
flowchart TB
    check["Résultat d'une vérification"] --> criteria{"Premier critère<br/>qui correspond"}
    criteria -->|"Aucun ne correspond"| fallback["État du moniteur par défaut"]
    criteria -->|"Un correspond"| actions
    subgraph actions["Ce que fait ce critère"]
        direction LR
        status["Changer l'état"]
        incident["Déclarer<br/>un incident"]
        alert["Créer<br/>une alerte"]
    end
```

Les incidents et les alertes réglés pour se résoudre automatiquement, comme ceux des critères par défaut, se résolvent d'eux-mêmes dès que leur critère ne correspond plus. Un moniteur vérifié par plusieurs sondes ne change que lorsque ses sondes sont d'accord : par défaut, chaque sonde activée et connectée doit arriver au même résultat. Pour en exiger moins, réglez **Accord des sondes** sur la page **Configuration → Sondes et intervalle** du moniteur. Pour tout ce qu'un critère peut contenir, et les statuts qu'un moniteur peut afficher, voir [Critères et statuts](/docs/monitor/criteria-and-statuses).

## Sondes et intervalle

Les moniteurs que des sondes vérifient se terminent par cette étape : Site web, API, Ping, IP, Port, Certificat SSL, DNS, DNSSEC, NTP, Domaine, Requête SQL, Santé de la base de données, Moniteur synthétique, Code JavaScript personnalisé et Page de statut externe. Les **Sondes** sont les machines qui exécutent les vérifications, et les sondes par défaut de votre projet sont déjà sélectionnées. L'**Intervalle de surveillance** commence à **Toutes les 5 minutes**.

:::steps
### Choisir les sondes

Gardez les **Sondes** sélectionnées ou choisissez-en d'autres. Un moniteur sans sonde n'est jamais vérifié. Pour vérifier quelque chose sur un réseau privé, exécutez une [sonde personnalisée](/docs/probe/custom-probe) dans ce réseau et choisissez-la ici.

### Choisir la fréquence des vérifications

Choisissez un **Intervalle de surveillance**, de **Chaque minute** à **Chaque semaine**. Les moniteurs Moniteur synthétique, Code JavaScript personnalisé et Certificat SSL se voient proposer des intervalles de 5 minutes ou plus.

### Créer le moniteur

Cliquez sur **Créer un moniteur**. La page du nouveau moniteur s'ouvre. Pour changer ses sondes ou son intervalle plus tard, ouvrez **Configuration → Sondes et intervalle** sur cette page.
:::

Tous les autres types, sauf Manuel, sont créés depuis l'étape **Critères**.

## Partir d'un modèle ou d'un lien

Un modèle de moniteur, et les liens qui créent un moniteur ailleurs dans OneUptime (sur un graphique de métriques, un équipement réseau ou une règle de détection), ouvrent **Créer un moniteur** avec le type choisi et le reste rempli. Cliquez sur **Modifier** pour choisir un autre type. Le formulaire d'un modèle utilise le même sélecteur de type : voir [Modèles de moniteur](/docs/monitor/monitor-templates).

Chaque type de moniteur a sa propre page, avec ses réglages, ses critères par défaut et des exemples. De bons points de départ :

:::cards
- [Surveillance de site web](/docs/monitor/website-monitor): Vérifier qu'une page se charge, et ce qu'elle répond.
- [Surveillance d'API](/docs/monitor/api-monitor): Appeler un point de terminaison avec une méthode, des en-têtes et un corps.
- [Critères et statuts](/docs/monitor/criteria-and-statuses): Ce qui définit le statut de chaque moniteur.
- [Modèles de moniteur](/docs/monitor/monitor-templates): Créer de nombreux moniteurs à partir d'une configuration et les garder alignés.
- [Groupes de moniteurs](/docs/monitor/monitor-groups): Regrouper plusieurs moniteurs en un seul statut.
- [Incidents](/docs/incidents/index): Ce qui se passe après qu'un moniteur a déclaré un incident.
:::
