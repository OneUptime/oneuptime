# Signaux connectés

Un dossier de sécurité dit quels utilisateurs, hôtes et adresses il concerne. Signaux connectés dit lesquels OneUptime connaît déjà - vos hôtes, hôtes de conteneurs, clusters Kubernetes, équipements réseau, ressources cloud, fonctions serverless, services, les moniteurs qui les vérifient, et membres - et ce qui se passait sur chacun autour du dossier : ses journaux, traces et métriques, les incidents et alertes ouverts sur lui, les moniteurs qui le surveillent et ce qui a changé sur lui. Il cherche aussi ces valeurs dans vos journaux et traces eux-mêmes : l'adresse d'un attaquant dans le journal d'accès d'un serveur web, un e-mail divulgué dans l'erreur d'une application. Dans l'autre sens, la page d'un hôte, d'un cluster, d'une ressource cloud, d'un service, d'un moniteur ou d'un membre dit ce qu'Événements de sécurité a trouvé à son sujet.

:::cards
- [Où le voir](#où-le-voir): La page d'un dossier, l'onglet d'un événement, la page d'une entité, et les pages de ce qu'ils nomment.
- [Comment une valeur est rapprochée](#comment-une-valeur-est-rapprochée): Ce qui compte comme le même enregistrement, et ce qui ne l'est que peut-être.
- [Ce que montre chaque enregistrement](#ce-que-montre-chaque-enregistrement): Ses signaux autour du dossier, et ce qui est ouvert sur lui.
- [Dans vos journaux et traces](#dans-vos-journaux-et-traces): Où une adresse, un domaine ou un e-mail qu'il nomme apparaît dans vos lignes de journal et vos spans.
- [Qui voit quoi](#qui-voit-quoi): Chaque enregistrement est lu avec le rôle du lecteur.
:::

## Comment ça marche

```mermaid title="D'un dossier à ce qu'il nomme"
flowchart TB
    case["Un dossier, un événement<br/>ou une entité"] --> values["Ses utilisateurs, hôtes<br/>et adresses"]
    values -->|"Exacte ou<br/>possible"| records["Vos hôtes, clusters,<br/>services et membres"]
    records --> signals["Leurs journaux,<br/>traces, métriques et<br/>ce qui est ouvert"]
    records --> cards["Une carte Sécurité<br/>sur leurs pages"]
```

OneUptime recherche chaque valeur parmi les enregistrements du projet, dit à quel point chaque correspondance est sûre, et montre ce qui se passait sur chaque enregistrement autour du dossier.

## Avant de commencer

- Des événements de sécurité qui arrivent, et des hôtes, clusters Kubernetes, ressources cloud, services, moniteurs ou membres du projet qu'ils peuvent nommer. Voir [Bien démarrer avec la sécurité](/docs/telemetry/security-getting-started).
- Un rôle qui peut lire les événements de sécurité, et les types d'enregistrements que vous voulez voir.

## Où le voir

- **Signaux connectés**, une page de chaque dossier de sécurité : ouvrez un dossier sous **Produits → Événements de sécurité → Dossiers de sécurité → Dossiers ouverts**, puis **Signaux connectés** après **Entités** dans son menu.
- **Connecté**, un onglet de chaque événement de sécurité : ouvrez un événement sous **Produits → Événements de sécurité → Événements**. Il liste ce que l'événement nomme, dans l'heure qui l'entoure.
- La page d'une entité, sous **Produits → Événements de sécurité → Risque des entités** : là où OneUptime connaît l'utilisateur, l'hôte ou l'adresse, autour de son dernier événement de sécurité.
- Une carte **Sécurité** sur la page de chaque hôte, hôte Docker, hôte Podman, cluster Kubernetes, équipement réseau, ressource cloud, fonction serverless, service, moniteur, membre et élément d'inventaire : les dossiers de sécurité ouverts qui le nomment, combien d'événements de sécurité et de détections l'ont nommé au cours des 7 derniers jours, le plus grave d'entre eux, et son risque. **Ouvrir dans Événements de sécurité** l'y ouvre. La carte d'un moniteur porte sur les hôtes et les adresses qu'il vérifie.
- Une carte **Sécurité** sur la page d'un incident, quand un dossier de sécurité a déclaré l'incident (**Déclaré depuis**) ou que des dossiers ouverts nomment un hôte ou un cluster qu'il touche (**Dossiers ouverts nommant ce qu'il touche**).

## Comment une valeur est rapprochée

Chaque utilisateur, hôte et adresse qu'un dossier ou un événement nomme est recherché parmi les enregistrements du projet :

| Ce que le dossier ou l'événement nomme | Rapproché de | Certitude |
| --- | --- | --- |
| Un nom d'hôte ou de domaine identique au nom que signale un hôte, un hôte de conteneurs, un cluster ou un équipement réseau, ou un nom sur lequel répond une ressource cloud | Cet enregistrement | Exacte |
| Le même nom, donné sans préciser qu'il s'agit d'un hôte | Cet enregistrement | Possible |
| Une forme courte ou complète du nom d'un enregistrement, comme `web-1` et `web-1.acme.internal` | Cet enregistrement | Possible |
| Une adresse IP publique qu'un seul hôte ou équipement réseau détient, ou sur laquelle une seule ressource cloud répond | Cet enregistrement | Exacte |
| Une adresse IP privée, ou une que plusieurs enregistrements détiennent | Chaque enregistrement qui la détient | Possible |
| L'ID propre d'une ressource cloud : un ARN AWS, un ID de ressource Azure ou un nom de ressource Google Cloud | Cette ressource cloud | Exacte |
| Un hôte, une adresse IP publique ou l'hôte d'une URL qu'un moniteur vérifie | Ce moniteur | Exacte |
| Une adresse IP privée qu'un moniteur vérifie | Ce moniteur | Possible |
| L'adresse e-mail d'un membre | Ce membre | Exacte |
| L'enregistrement sous lequel une ligne de journal a été envoyée, pour les événements lus dans vos journaux | Cet hôte, ce cluster, cette ressource cloud, cette fonction serverless ou ce service | Exacte |
| Un simple nom d'utilisateur, une empreinte de fichier ou un processus | Rien : aucun enregistrement n'est indexé par eux | - |

- Une correspondance possible affiche **Correspondance possible** à côté de son nom, et dit pourquoi. Elle n'est jamais comptée sur la page de l'enregistrement, et un incident que le dossier déclare n'y est jamais lié.
- Ce qui a été recherché et n'est pas un enregistrement du projet est listé sous **Aucun enregistrement correspondant**. Une valeur n'y est jamais listée quand un type d'enregistrement qu'elle pourrait être n'a pas pu être lu.
- Au plus 10 enregistrements sont listés pour un dossier, les exacts en premier.

## Ce que montre chaque enregistrement

- Ses signaux, chacun ouvert sur l'enregistrement et la période du dossier : **Journaux**, **Traces** et **Métriques**, les **Exceptions** d'un service, les **Événements Kubernetes** d'un cluster, la **Topologie** de l'enregistrement, et son élément d'**Inventaire** quand l'inventaire en a un.
- Les incidents et alertes ouverts sur lui maintenant, et les moniteurs qui le surveillent, chacun ouvrant sa page. Un moniteur affiche son statut à côté de son nom, et ses **Journaux** montrent ce qu'il a vu à chaque vérification.
- Les plannings d'astreinte d'un membre, avec **D'astreinte maintenant** à côté de ceux pour lesquels il est d'astreinte, et les équipes dont il fait partie.
- Ce qui a changé sur lui pendant la période : les déploiements d'un service, les déploiements progressifs d'un cluster et les corrections d'un hôte.

| Où | Période |
| --- | --- |
| Un dossier | De 30 minutes avant sa première détection à 30 minutes après sa dernière, au plus ses dernières 24 heures |
| Un événement | 30 minutes de part et d'autre |
| La page d'une entité | 30 minutes de part et d'autre de son dernier événement de sécurité |
| La carte **Sécurité** d'un enregistrement | Les 7 derniers jours |

## Dans vos journaux et traces

Sous les enregistrements, Signaux connectés cherche dans vos journaux et traces, sur la même fenêtre, les valeurs qu'il nomme qui ne peuvent signifier qu'une chose : une adresse IP (sauf `127.0.0.1` et les autres que toute machine a), un nom complet d'hôte ou de domaine, un e-mail, une URL, l'ID d'une ressource cloud et une empreinte de fichier. Un nom d'hôte seul, le nom seul d'un utilisateur et un processus ne sont jamais cherchés : une ligne de journal peut les contenir pour n'importe quelle raison. Au plus 10 valeurs sont cherchées.

| Où | Il nomme une valeur quand |
| --- | --- |
| Le message d'une ligne de journal | Il contient la valeur entière, quelle que soit la casse : `10.0.0.1` dans `from 10.0.0.1:52144`, jamais dans `10.0.0.12` ou `110.0.0.1` |
| Un attribut d'une ligne de journal ou d'un span | Sa valeur est exactement la valeur : telle qu'écrite, en minuscules ou en majuscules, ou une adresse IPv6 sous sa forme courte |

- Chaque valeur trouvée indique combien de lignes de journal et de spans la nomment, où elle était - **Dans le message** ou un attribut par sa clé -, chacun ouvrant **Journaux** ou **Traces** sur ces lignes ou spans et la fenêtre, et les enregistrements qui les ont envoyés, les plus nombreux d'abord.
- Un attribut de ressource, comme `resource.host.name`, dit seulement quel enregistrement a envoyé une ligne, et n'est jamais compté.
- Les valeurs cherchées que ni l'un ni l'autre ne nomme sont listées sous **Absent de vos journaux et traces**.
- Elles sont cherchées avec votre propre rôle : les journaux ou traces que votre rôle ne peut pas lire sont signalés, et pas cherchés ; ceux qui n'ont pas pu être cherchés pour le moment le disent, avec **Réessayer**. Une recherche qui dure plus de 15 secondes est arrêtée, et le dit.

## Qui voit quoi

- Signaux connectés et la carte **Sécurité** d'un enregistrement demandent un rôle qui peut lire les événements de sécurité : Security Admin, Security Member, Security Viewer, Project Owner ou Project Admin. Les autres ne voient de données de sécurité sur aucune page. Voir [Rôles](/docs/permissions/reference#rôles).
- La carte **Sécurité** d'un incident demande un rôle qui peut lire les dossiers de sécurité.
- Chaque enregistrement est lu avec votre propre rôle, et ce qu'il porte aussi : un rôle qui ne peut pas lire les plannings d'astreinte ne voit pas ceux d'un membre. Un type d'enregistrement que votre rôle ne peut pas lire est omis, et la page le dit ; un qui n'a pas pu être lu à l'instant le dit aussi, avec **Réessayer**.
- La page d'un enregistrement n'affiche sa carte **Sécurité** que dans un projet qui utilise Événements de sécurité : un qui a reçu un événement de sécurité au cours des 7 derniers jours.

## Incidents qu'un dossier déclare

**Déclarer un incident** sur un dossier, ou l'étape d'un playbook qui en déclare un, lie l'incident aux hôtes, hôtes Docker et Podman, clusters Kubernetes, ressources cloud et services auxquels le dossier est connecté de façon exacte. L'incident apparaît sur leurs pages et les règles de leurs propriétaires s'y appliquent, et son fil nomme le dossier et ce à quoi il a été lié. Une correspondance possible n'est jamais liée, et un moniteur non plus : un incident sur un moniteur peut changer son statut et apparaître sur ses pages de statut.

## OneUptime AI

Le tri d'un dossier par OneUptime AI lit ses signaux connectés : ce qui est ouvert et ce qui a changé sur les hôtes, services, moniteurs et membres que le dossier nomme, les plannings d'astreinte et les équipes d'un membre, et où ses valeurs apparaissent dans vos journaux et traces. L'investigation d'un incident lit le dossier de sécurité qui l'a déclaré et les dossiers ouverts qui nomment ce qu'il touche. Voir [OneUptime AI dans la sécurité](/docs/telemetry/security-ai).

## Dépannage

:::details Un hôte que le dossier nomme n'est pas listé
Vérifiez que le dossier nomme l'hôte comme l'hôte se nomme lui-même, ou nomme une adresse publique que seul cet hôte détient. Un nom court, comme `web-1` pour `web-1.acme.internal`, est listé comme correspondance possible, et un simple nom d'utilisateur, une empreinte de fichier ou un processus n'est pas recherché du tout. Une URL n'est recherchée que parmi les moniteurs qui vérifient son hôte.
:::

:::details Une adresse que nomme le dossier n'est pas dans ses journaux et traces
Seule la fenêtre du dossier est cherchée, et seulement les journaux et traces que votre rôle peut lire. Un message ne nomme une adresse qu'en entier : `10.0.0.12` est une autre adresse, même si la recherche de message de l'explorateur Journaux la trouve aussi. Un attribut ne la nomme que si sa valeur est exactement l'adresse, et un attribut de ressource jamais.
:::

:::details Le bon hôte est listé comme correspondance possible
Une correspondance possible n'est jamais comptée ni liée, pour qu'un nom que partagent deux machines ne vous dise jamais rien sur la mauvaise. Faites nommer l'hôte par vos journaux et vos détections avec le nom qu'il signale.
:::

:::details La page d'un hôte n'a pas de carte Sécurité
La carte est montrée à un rôle qui peut lire les événements de sécurité, dans un projet qui a reçu un événement de sécurité au cours des 7 derniers jours. Un hôte que rien n'a nommé pendant ce temps affiche une ligne qui le dit.
:::

:::details La page d'un moniteur n'a pas de carte Sécurité
La carte est affichée pour un moniteur qui vérifie un hôte, une adresse ou une URL : un moniteur de site web, d'API, de ping, de port, de certificat SSL, DNS ou de domaine. Un heartbeat, un script ou un moniteur de votre télémétrie ne vérifie aucun hôte, il n'en a donc pas.
:::

:::details La page dit que votre rôle ne peut pas voir un type d'enregistrement
Chaque enregistrement est lu avec votre propre rôle. Demandez à un Project Owner ou à un Project Admin un rôle qui peut lire ce type d'enregistrement.
:::

## Étapes suivantes

:::cards
- [Dossiers de sécurité et playbooks](/docs/telemetry/security-cases): Traiter un dossier, et en déclarer un incident.
- [Événements de sécurité (SIEM)](/docs/telemetry/security-events): Les événements derrière un dossier, et les journaux dont ils sont lus.
- [Risque des entités (alertes fondées sur le risque)](/docs/telemetry/security-entity-risk): La page d'une entité, son risque, et là où OneUptime la connaît.
- [OneUptime AI dans la sécurité](/docs/telemetry/security-ai): Comment un tri lit ce qu'un dossier nomme.
:::
