# Surveillance des journaux

Un moniteur de journaux compte, sur une fenêtre de temps, les journaux que vos services envoient à OneUptime et qui correspondent à vos filtres – texte, gravité, service, attributs. Quand ce nombre remplit vos critères, il change le statut du moniteur, crée une alerte ou déclare un incident. Servez-vous-en pour repérer les pics d'erreurs, un message d'échec précis ou un service qui a cessé d'écrire des journaux.

:::cards
- [Créer le moniteur](#créer-un-moniteur-de-journaux): Choisir les journaux à compter et quand alerter.
- [Comment il est évalué](#comment-il-est-évalué): La fenêtre de temps, le décompte et le cycle d'une minute.
- [Critères](#critères): Seuils, détection d'anomalies et valeurs par défaut.
- [Alertes par groupe](#alertes-par-groupe-group-by): Une alerte par tunnel, utilisateur ou interface.
:::

## Fonctionnement

```mermaid title="Chaque minute, un moniteur de journaux compte et vérifie"
flowchart TB
    App["Vos services"] -->|OpenTelemetry| Store[("Journaux dans OneUptime")]
    Store --> Count["Compter les journaux correspondants<br/>dans la fenêtre de temps"]
    Count --> Check{"Critères remplis ?"}
    Check -->|"Première correspondance"| Act["Changer le statut,<br/>alerte ou incident"]
    Check -->|Aucun| Default["Statut par défaut"]
```

Chaque minute, OneUptime compte les journaux qui correspondent aux filtres du moniteur et sont arrivés dans sa fenêtre de temps. Il compare ce nombre aux critères du moniteur de haut en bas, et le premier critère qui correspond décide de ce qui se passe. Si aucun ne correspond, le moniteur revient à son statut par défaut.

## Avant de commencer

- Vos services envoient des journaux à OneUptime via OpenTelemetry (ou une autre source de journaux qu'OneUptime ingère). Voir [OpenTelemetry](/docs/telemetry/open-telemetry).
- Pour filtrer ou regrouper sur une valeur contenue dans la ligne de journal, comme un nom de tunnel ou d'utilisateur, transformez-la d'abord en attribut avec un [pipeline de journaux](/docs/telemetry/log-pipelines).

## Créer un moniteur de journaux

:::steps
### Commencer un nouveau moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. Ou bien, dans l'explorateur de journaux, recherchez les journaux dont vous voulez être informé et cliquez sur **Créer un moniteur** dans sa barre d'outils : le nouveau moniteur surveille d'emblée la recherche, les gravités, les services et les attributs de l'explorateur.

### Choisir Logs

Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **Journaux** sous **Télémétrie**, ou tapez `logs` dans le champ de recherche. Saisissez un **Nom**, puis cliquez sur **Suivant**.

### Choisir ce dont le moniteur vous informe

Sous **De quoi ce moniteur doit-il vous informer ?**, choisissez **Trop d'erreurs**, **Un message apparaît** ou **Les journaux s'arrêtent**. Chaque choix remplit les journaux à surveiller et la règle, que vous pouvez modifier plus bas. Choisissez **Autre chose** pour les configurer vous-même.

### Choisir les journaux à compter

Dans **Journaux à surveiller**, renseignez **Gravité du journal** et **Le message contient**. Un filtre laissé vide correspond à tous les journaux. **Journaux correspondants**, sous les filtres, montre les journaux qu'ils sélectionnent en ce moment.

### Affiner (facultatif)

Ouvrez **Plus de champs** pour filtrer par service de télémétrie, entité d'infrastructure ou attribut. Pour obtenir une alerte par tunnel, utilisateur ou interface plutôt qu'une seule pour tout le moniteur, ajoutez l'attribut dans **Group by Attributes** – voir [Alertes par groupe](#alertes-par-groupe-group-by).

### Dire quand alerter

Dans **Quand alerter**, choisissez une **Condition**, le **Nombre de journaux** et une **Fenêtre de temps**. La phrase en dessous redit la règle en termes simples. Le graphique sous cette phrase compte les journaux correspondants dans chaque fenêtre au cours des dernières heures, trace le nombre de la règle sous forme de ligne et indique combien de fois la règle aurait alerté. Son bouton propose un nombre que la règle n'aurait pas dépassé sur cette période.

### Choisir ce qui se passe

Dans **Ce qui se passe**, choisissez **Créer une alerte**, **Déclarer un incident** ou **Les deux**, puis donnez-lui un titre et une gravité. Tant que la règle correspond, le moniteur affiche le statut indiqué sous **Plus de champs** ; quand elle ne correspond plus, le moniteur revient à son statut par défaut et l'alerte ou l'incident se résout de lui-même.

### Créer le moniteur

Cliquez sur **Créer un moniteur**. Le moniteur s'ouvre sur sa page **Vue d'ensemble**, et sa première évaluation a lieu dans la minute.
:::

## Ce qu'il interroge

| Champ | Ce qu'il sélectionne | Par défaut |
| --- | --- | --- |
| **Gravité du journal** | Les journaux ayant l'une des gravités choisies. | Vide : toutes les gravités |
| **Le message contient** | Les journaux dont le corps contient ce texte, sans tenir compte de la casse. | Vide : tous les journaux |
| **Fenêtre de temps** (dans **Quand alerter**) | Les journaux des 5 dernières secondes jusqu'aux 24 dernières heures. | **Dernières 5 minutes** |
| **Group by Attributes** | Pas un filtre : compte séparément chaque combinaison de valeurs de ces attributs. | Vide : un seul décompte |
| **Résolu par attributs** | Pas un filtre : le journal qui résout un groupe. Apparaît dès que **Group by Attributes** a un attribut ; voir [Résolu par un journal](#résolu-par-un-journal). | Vide : un groupe se résout quand ses journaux s'arrêtent |
| **Filtrer par service de télémétrie** (sous **Plus de champs**) | Les journaux de l'un des services choisis. | Vide : tous les services |
| **Filtrer par entité d'infrastructure** (sous **Plus de champs**) | Les journaux de l'un des hôtes, pods, conteneurs et autres entités choisis. | Vide : toutes les entités |
| **Filtrer par attributs** (sous **Plus de champs**) | Les journaux dont les attributs remplissent chaque condition. Chaque condition a son propre opérateur, comme « égal à » ou « contient ». | Vide : aucune condition |

Tous les filtres que vous définissez doivent correspondre pour qu'un journal soit compté.

### Gravité des journaux

Chaque journal est enregistré avec l'une de sept gravités. Pour les journaux OpenTelemetry, elle provient du numéro de gravité du journal ; choisissez donc la gravité, pas le texte affiché par votre logger :

| Gravité | Numéros de gravité OpenTelemetry |
| --- | --- |
| **Trace** | 1–4 |
| **Débogage** | 5–8 |
| **Information** | 9–12 |
| **Warning** | 13–16 |
| **Erreur** | 17–20 |
| **Fatal** | 21–24 |
| **Non spécifié** | Tout le reste |

## Comment il est évalué

- **Chaque minute.** Un moniteur de journaux n'est pas vérifié par des sondes ; il n'a donc pas d'intervalle à régler ni de page **Sondes et intervalle**.
- **Un seul nombre par évaluation.** Le moniteur compte les journaux qui correspondent à chaque filtre et sont arrivés dans la **Fenêtre de temps** précédant l'évaluation. Avec **Dernières 5 minutes**, chaque évaluation remonte cinq minutes en arrière, si bien que les fenêtres d'évaluations successives se chevauchent.
- **Aucun journal, c'est un décompte de 0.** Un service qui cesse d'écrire des journaux produit 0, ce que recherche **Les journaux s'arrêtent**.
- **L'indisponibilité d'OneUptime lui-même n'est pas un silence.** Tant que la fenêtre de temps contient une période où OneUptime lui-même ne recevait pas de données – il redémarrait, était mis à jour ou rattrapait un retard –, la vérification attend : le statut ne change pas, et aucun incident ni aucune alerte n'est ouvert ni résolu. Voir [Quand OneUptime ne reçoit pas de données](/docs/monitor/when-oneuptime-is-not-receiving).
- **Les critères de haut en bas.** Le premier critère qui correspond décide ; placez donc le plus grave en premier. Un moniteur regroupé fonctionne autrement : il vérifie chaque critère pour chaque groupe – voir [L'évaluation des critères diffère](#lévaluation-des-critères-diffère).

Chaque changement de statut est enregistré, avec sa raison, dans la **Chronologie de statut** du moniteur.

## Critères

Les critères d'un moniteur de journaux ont un seul **Type de filtre** : **Log Count**, le nombre de journaux qui ont correspondu dans la fenêtre. **Quand alerter** configure un critère, dont la **Condition** est **Plus de**, **Au moins**, **Moins de**, **Au plus**, **Exactement**, **Anormalement haut**, **Anormalement bas** ou **Anormalement haut ou bas**. Pour plusieurs critères, ou un critère avec plus d'un filtre, cliquez sur **Modifier en critères personnalisés** sous **Plus de champs** dans **Ce qui se passe** : chaque critère y a une **Condition de filtre** et, pour une condition de seuil, une **Valeur**.

| Condition de filtre | Correspond quand le nombre de journaux est… |
| --- | --- |
| **Supérieur à** | au-dessus de la valeur |
| **Supérieur ou égal à** | égal ou supérieur à la valeur |
| **Inférieur à** | en dessous de la valeur |
| **Inférieur ou égal à** | égal ou inférieur à la valeur |
| **Égal à** | exactement la valeur |
| **Anomalously High** | au-dessus de la plage attendue pour cette heure de la semaine |
| **Anomalously Low** | en dessous de cette plage |
| **Anomalous** | hors de cette plage, dans un sens ou dans l'autre |

Les conditions d'anomalie ne prennent pas de **Valeur**. Choisissez une **Sensibilité** – Faible, Moyen (la valeur par défaut) ou Élevé – et, dans les critères personnalisés, une **Fenêtre de référence** de 14 (la valeur par défaut), 28, 60 ou 90 jours. OneUptime convertit le décompte en taux par minute et le compare à la même heure de la semaine sur cette fenêtre. La référence ne couvre que les services et les gravités du moniteur : ses filtres de texte et d'attributs n'en font pas partie. Tant que cette heure de la semaine n'a pas assez d'historique, le critère est encore en apprentissage et ne se déclenche pas.

Un moniteur de journaux créé dans « Créer un moniteur » commence avec la règle correspondant à ce que vous avez choisi sous **De quoi ce moniteur doit-il vous informer ?** :

| Choix | Règle | Ce qui se passe |
| --- | --- | --- |
| **Trop d'erreurs** | **Gravité du journal** **Erreur** et **Fatal**, **Plus de** `10` sur **Dernières 5 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Un message apparaît** | **Plus de** `0` sur **Dernières 5 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Les journaux s'arrêtent** | **Exactement** `0` sur **Dernières 10 minutes** | Déclare un incident, qui se résout de lui-même |

Un moniteur de journaux créé via l'API ou Terraform sans critères commence avec ces critères :

| Critère | Filtre | Effet |
| --- | --- | --- |
| Check if … is offline | **Log Count** **Égal à** `0` | Passe le moniteur hors ligne et déclare un incident, résolu automatiquement |
| Check if … is online | **Log Count** **Supérieur à** `0` | Passe le moniteur en ligne |

## Exemple : un pic d'erreurs

Vous voulez un incident quand le service checkout journalise plus de 50 erreurs en cinq minutes :

- **Gravité du journal** : **Erreur**
- **Fenêtre de temps** : **Dernières 5 minutes**
- **Filtrer par service de télémétrie** : `checkout`
- **Quand alerter** : **Plus de** `50`
- **Ce qui se passe** : **Déclarer un incident**

Quatre évaluations successives :

| Heure | Journaux d'erreur des 5 dernières minutes | La règle correspond ? | Ce qui se passe |
| --- | --- | --- | --- |
| 10:00 | 12 | Non | Le moniteur est en ligne. |
| 10:01 | 64 | Oui | Le moniteur passe hors ligne et un incident est déclaré. |
| 10:02 | 81 | Oui | Toujours hors ligne. L'incident est déjà ouvert, donc aucun second n'est déclaré. |
| 10:06 | 9 | Non | Le moniteur est de nouveau en ligne, et l'incident se résout de lui-même parce que **Résoudre automatiquement l'incident** est activé. |

Comme les fenêtres se chevauchent, une seule rafale d'erreurs maintient le décompte élevé jusqu'à cinq minutes après sa fin. Utilisez une fenêtre plus courte pour un moniteur qui doit se rétablir plus vite.

## Alertes par groupe (Group By)

**Group by Attributes** divise le décompte d'un moniteur de journaux en un décompte par combinaison distincte de valeurs d'attributs – un par tunnel IPsec, par utilisateur VPN, par interface de pare-feu – et évalue les critères pour chaque groupe séparément. C'est l'équivalent, pour les journaux, du [Group By](/docs/monitor/metrics-monitor#alertes-par-série-group-by) d'un moniteur de métriques.

### Une alerte par groupe

Sans Group By, un moniteur qui surveille les tunnels IPsec interrompus n'est qu'un seul décompte pour tout le moniteur et lève **une seule alerte pour tout le moniteur**. Tant que cette alerte est ouverte, la chute d'un second tunnel ne produit rien de nouveau : le moniteur alerte déjà.

Avec Group By sur le nom du tunnel, l'interruption du tunnel `HQ-Branch1` ouvre sa propre alerte, et l'interruption du tunnel `Branch2` dix minutes plus tard ouvre une **seconde alerte, distincte**, à côté.

```mermaid title="Sans et avec Group By"
flowchart TB
    subgraph Without["Sans Group By"]
        direction TB
        A1["HQ-Branch1 tombe"] --> M1["Un seul décompte"]
        B1["Branch2 tombe"] --> M1
        M1 --> X1["Une seule alerte"]
    end
    subgraph With["Regroupé par con_name"]
        direction TB
        A2["HQ-Branch1 tombe"] --> X2["Alerte pour HQ-Branch1"]
        B2["Branch2 tombe"] --> Y2["Alerte pour Branch2"]
    end
    Without ~~~ With
```

### Résolution indépendante

L'alerte ou l'incident de chaque groupe se résout de son côté. Dès qu'un groupe ne remplit plus les critères – `HQ-Branch1` ne journalise plus d'interruption dans la fenêtre de temps –, son alerte se résout, tandis que celle de `Branch2` reste ouverte jusqu'à ce que `Branch2` s'arrête aussi. Le rétablissement d'un groupe ne ferme jamais l'alerte d'un autre.

Un moniteur de journaux voit des événements, pas un état : l'alerte d'un groupe se résout dès que ce groupe n'a rien journalisé qui remplisse les critères pendant toute une fenêtre de temps, que le tunnel soit revenu ou non – sauf si le moniteur nomme le journal qui dit qu'il est revenu, comme ci-dessous.

### Résolu par un journal

Un équipement qui signale un tunnel tombé signale en général son retour. **Résolu par attributs** nomme ce journal : une fois ce champ renseigné, l'alerte ou l'incident d'un groupe reste ouvert jusqu'à ce qu'un journal portant ces attributs arrive pour le même groupe, au lieu de se résoudre quand les journaux du groupe s'arrêtent.

Prenez un moniteur qui compte les journaux avec `event.name` = `vpn.tunnel_down`, regroupés par `event.device` et `vpn.tunnel.name`, avec **Résolu par attributs** réglé sur `event.name` = `vpn.tunnel_up`. La chute du tunnel `HQ-Branch1` ouvre son alerte. L'alerte reste ouverte toute la nuit, bien que le pare-feu ne journalise plus rien au sujet du tunnel, et se résout quand le pare-feu signale `HQ-Branch1` rétabli. Si le tunnel tombe de nouveau, une nouvelle alerte s'ouvre.

- Le champ apparaît dès que **Group by Attributes** a un attribut. Il accepte jusqu'à 10 attributs, et un journal de résolution les porte tous.
- Un journal de résolution appartient à un groupe quand il a les valeurs du groupe pour les attributs de regroupement : les deux sortes de journaux doivent donc porter ces attributs.
- Les services de télémétrie et la fenêtre de temps du moniteur s'appliquent aussi aux journaux de résolution. Ses filtres de texte et de gravité, non : ils décrivent le problème.
- Un groupe dont le journal le plus récent est un journal de résolution est fermé. Un groupe qui a de nouveau journalisé le problème après lui reste ouvert.
- Vous pouvez toujours résoudre une alerte vous-même.

[Événements réseau](/docs/monitor/network-events) crée ces moniteurs pour vous, en un clic par alerte.

### Exemple : une alerte par tunnel IPsec Sophos

Cela suppose que les lignes syslog du pare-feu sont découpées en attributs par un [analyseur Key=Value](/docs/telemetry/log-pipelines#keyvalue-parser), sans préfixe cible, de sorte que le nom du tunnel est l'attribut `con_name` :

```text
log_component="IPSec" con_name="HQ-Branch1" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

:::steps
1. Créez un moniteur **Journaux** et choisissez **Un message apparaît**.
2. Réglez **Le message contient** sur `terminated` et la **Fenêtre de temps** sur **Dernières 5 minutes**.
3. Sous **Plus de champs**, ajoutez le filtre d'attribut `log_component` = `IPSec`.
4. Dans **Group by Attributes**, ajoutez `con_name`.
5. Gardez la règle sur **Plus de** `0`, et intitulez l'alerte ou l'incident `IPsec tunnel {{con_name}} terminated`.
:::

Chaque tunnel qui journalise une interruption reçoit désormais sa propre alerte – `IPsec tunnel HQ-Branch1 terminated`, `IPsec tunnel Branch2 terminated` – et chacune se résout de son côté.

### Valeurs de groupe dans les titres et les descriptions

La valeur de chaque attribut de Group By est une [variable de modèle](/docs/monitor/incident-alert-templating) dans le titre, la description et les notes de remédiation de l'alerte ou de l'incident, comme les étiquettes d'une série de métriques : regrouper par `con_name` vous donne `{{con_name}}`. Une clé contenant des points se lit comme un chemin : `sophos.con_name` donne donc `{{sophos.con_name}}`. Quand le titre ne nomme pas déjà le groupe, le groupe y est ajouté (`IPsec tunnel terminated - Con Name: HQ-Branch1`), et `{{seriesResourceSuffix}}` et `{{seriesResourceSummary}}` fonctionnent comme sur les moniteurs de métriques.

### Comment les groupes sont comptés

- Jusqu'à 10 attributs. Chaque combinaison distincte de leurs valeurs forme un groupe.
- Un journal qui ne porte pas un attribut de Group By est compté sous une **valeur vide** pour celui-ci ; les journaux sans l'attribut forment donc leur propre groupe, dont l'alerte ne nomme aucune valeur pour lui. Si toutes les alertes arrivent sans valeur de groupe, vérifiez la clé de l'attribut : un pipeline de journaux avec un préfixe cible enregistre `con_name` sous `sophos.con_name`.
- Les valeurs de groupe de plus de 256 caractères sont tronquées à 256.
- Au plus **100 groupes** sont évalués par vérification : les 100 qui ont le plus de journaux. Quand davantage correspondent, les autres sont ignorés pour cette vérification et un avertissement est journalisé – resserrez les filtres du moniteur pour les couvrir.

### L'évaluation des critères diffère

- **Chaque critère est évalué**, comme sur un moniteur de métriques regroupé, si bien que différents groupes peuvent remplir différents critères en même temps. Un groupe qui remplit deux critères ne reçoit toujours qu'une alerte, celle du premier ; ordonnez donc les critères du plus grave au moins grave.
- **Un groupe n'existe que s'il a journalisé quelque chose dans la fenêtre de temps.** Les critères **Égal à 0** et **Inférieur à** ne se déclenchent donc que pour les groupes qui ont journalisé au moins une fois ; pour alerter quand les journaux cessent complètement d'arriver, utilisez un moniteur sans Group By.
- **La détection d'anomalies** (**Anomalously High**, **Anomalously Low**, **Anomalous**) n'est pas évaluée par groupe – sa référence couvre tout le moniteur –, si bien que ces filtres ne correspondent jamais sur un moniteur regroupé.
- Le statut du moniteur suit le premier critère que remplit un groupe. Quand aucun groupe ne remplit de critère, le moniteur revient à son statut par défaut.

## Dépannage

:::details Le moniteur est hors ligne, mais mon service écrit des journaux
Le décompte valait 0 : les filtres ne correspondent donc à aucun des journaux que le service envoie. Ouvrez la page **Critères** du moniteur (sous **Configuration**) et cliquez sur **Modifier les critères de surveillance** : **Journaux correspondants** montre ce que les filtres sélectionnent en ce moment, et le graphique de **Quand alerter** les compte dans chaque fenêtre. Les causes habituelles sont une gravité choisie d'après le texte affiché par le logger plutôt que d'après son numéro de gravité (voir [Gravité des journaux](#gravité-des-journaux)), un filtre de service ou d'attribut qui ne correspond pas, et une fenêtre de temps plus courte que l'intervalle entre les journaux du service.
:::

:::details Un pic s'est produit, mais rien n'a alerté
Les critères sont vérifiés de haut en bas et la première correspondance décide. Un critère large placé au-dessus de celui que vous attendiez, comme **Log Count** **Supérieur à** `0`, correspond en premier et arrête les autres. Placez le critère le plus grave en haut.
:::

:::details Un critère d'anomalie ne se déclenche jamais
Il est encore en apprentissage : l'heure de la semaine à laquelle il se compare n'a pas encore assez d'historique. Sur un moniteur avec **Group by Attributes**, les conditions d'anomalie ne correspondent jamais – utilisez-y un seuil.
:::

:::details Les alertes de groupe arrivent sans valeur de groupe
Les journaux qui ne portent pas l'attribut de Group By sont comptés sous une valeur vide. Vérifiez le nom exact de la clé dans l'explorateur de journaux : un pipeline de journaux avec un préfixe cible enregistre `con_name` sous `sophos.con_name`.
:::

## Étapes suivantes

:::cards
- [Pipelines de journaux](/docs/telemetry/log-pipelines): Découper les lignes de journal en attributs sur lesquels filtrer et regrouper.
- [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating): Mettre les valeurs de groupe et les décomptes dans les titres et les descriptions.
- [Surveillance des métriques](/docs/monitor/metrics-monitor): Alerter sur une métrique, par hôte ou par conteneur.
- [Surveillance des traces](/docs/monitor/traces-monitor): Alerter de la même façon sur les spans en échec.
:::
