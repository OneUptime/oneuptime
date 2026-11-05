# Très grands clouds OpenStack

Ce que coûte un cloud de n'importe quelle taille avant que vous n'installiez quoi que ce soit : à quel point la supervision pèse sur son plan de contrôle, la quantité de données qu'elle envoie, et ce que OneUptime fait différemment à mesure qu'un cloud grandit. Presque aucun cloud n'a besoin de tout cela : les valeurs par défaut de l'[agent OpenStack](/docs/telemetry/openstack) et d'une [sonde](/docs/telemetry/openstack-agentless) tiennent jusqu'à des milliers d'instances sans rien configurer.

:::cards
- [La charge sur votre plan de contrôle](#la-charge-sur-votre-plan-de-contrôle): Des requêtes par minute et par service, à chaque taille.
- [Les données envoyées](#les-données-envoyées): Des séries et des gigaoctets par jour, à partir des effectifs de votre cloud.
- [Mode synthèse](#mode-synthèse): Ce que conserve un cloud au-delà de 5 000 instances, et ce à quoi il renonce.
- [Partager un cloud entre plusieurs collecteurs](#partager-un-cloud-entre-plusieurs-collecteurs): Un agent par région ou par service.
- [Le chemin par la base de données](#le-chemin-par-la-base-de-données): Lire les plus grands clouds depuis leurs bases de données.
- [À quoi la plus grande taille a été soumise](#à-quoi-la-plus-grande-taille-a-été-soumise): Une heure à 200 000 instances, avec ses budgets et ce qui a été mesuré.
:::

## La charge sur votre plan de contrôle

### Avec une sonde

Une sonde reste dans une charge déterminée, quelle que soit la taille du cloud. Elle interroge chaque service une requête à la fois, Placement quatre, lit les instances selon ce qui a changé entre deux lectures complètes, et, au-delà d'un nombre déterminé, lit par roulement ce qui demande un appel par élément (les usages d'un hyperviseur, les agents d'un routeur, les quotas d'un projet). Chaque collecte envoie tout tel que lu la dernière fois, de sorte qu'aucune série n'a de trou : seule la fraîcheur de ces parties varie.

Requêtes par minute avec les valeurs par défaut, une fois la collecte stabilisée, sur un cloud avec OVN :

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hyperviseurs, 100 instances, 20 projets | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hyperviseurs, 20 000 instances, 1 000 projets | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5 000 hyperviseurs, 200 000 instances, 10 000 projets | 1,3 | 12,7 | 1 003 | 43,5 | 62,5 | 0,5 |

Ces chiffres sont comptés, pas estimés : un test exécute le vrai collecteur contre une API simulée de chaque taille, sur une horloge qu'il fait avancer lui-même, et confronte exactement ce qu'il a demandé à ces nombres, service par service, partout où quelque chose de différent arrive à échéance. Un nombre de requêtes ne dépend pas de la machine sur laquelle il a été compté.

Ce que contient chaque taille en plus de ses hyperviseurs, instances et projets est supposé, et un vrai cloud diffère : un volume pour une instance sur deux, un instantané et une sauvegarde pour un volume sur dix, un réseau, un sous-réseau, un routeur et un groupe de sécurité par projet, une IP flottante pour une instance sur dix, 40 gabarits, deux agents Neutron par hyperviseur, et une image pour dix projets, entre 10 et 1 000. Une liste coûte une requête par millier de lignes : ce que contient réellement votre cloud ne les fait donc que peu varier. Ce qui les fait le plus varier :

| Ce qui change | Ce que cela coûte |
| --- | --- |
| La première collecte après le démarrage d'une sonde | Un appel pour les inventaires de chaque hyperviseur et un pour ses usages, quel que soit leur nombre |
| ML2/OVS plutôt qu'OVN | Un appel par routeur pour savoir quels agents L3 le détiennent, 2 000 au plus par collecte |
| Des instances qui changent | Un appel à Nova par instance modifiée, pour lire ce qui lui est arrivé, 25 au plus par collecte |
| [Limites de projet](/docs/telemetry/openstack-agentless#ce-que-cela-coûte-à-votre-cloud) activées | Quatre appels par projet, 250 projets au plus par collecte : un cloud de 10 000 met donc 80 minutes à faire le tour |
| Collecter moins souvent | **Collecter toutes les** sur la page **Paramètres** du cloud. Deux fois plus long, c'est moitié moins d'appels |
| Plus de régions | Tout sauf Keystone, de nouveau, par région |

Une collecte dispose de neuf dixièmes de son intervalle, et de dix minutes au plus, et chaque service est lu une requête à la fois. La rapidité avec laquelle les API d'un grand cloud répondent détermine donc la fréquence à laquelle il peut être collecté : à 200 000 instances et avec les deux minutes par défaut, Nova doit répondre à chaque page de sa lecture complète en environ une demi-seconde, et Cinder à ses listes en environ 0,8 seconde. Un service qui ne peut pas finir apparaît en panne jusqu'à ce qu'il y parvienne, et la carte indique **La collecte a pris trop de temps**. Augmentez **Collecter toutes les**, ce qui réduit aussi la charge, ou utilisez le [chemin par la base de données](#le-chemin-par-la-base-de-données).

### Avec l'agent

L'exportateur de l'agent se connecte et lit chaque liste en entier à chaque scrape, et il demande à Placement trois choses par hyperviseur, un appel à la fois. Requêtes par minute avec les valeurs par défaut :

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hyperviseurs, 100 instances, 20 projets | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hyperviseurs, 20 000 instances, 1 000 projets | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5 000 hyperviseurs, 200 000 instances, 10 000 projets | 3,4 | 106 | 7 501 | 43,5 | 57 | 0,4 |

Ces chiffres sont comptés à partir du code source de l'exportateur, et l'exportateur n'a pas été exécuté à ces tailles. Un scrape dispose de 110 secondes : un Placement qui répond en 20 ms manque donc de temps vers 1 800 hyperviseurs, et Nova, à une seconde par page, vers 110 000 instances. Au-delà, un scrape de ces services échoue, même demandé avec douceur. Au-delà de ces tailles, utilisez le [chemin par la base de données](#le-chemin-par-la-base-de-données), ou une sonde.

### Quand une API ralentit

Une sonde surveille le temps de réponse habituel de chaque service, et lorsqu'une réponse prend trois fois ce temps et au moins une seconde, ou cinq secondes quelle que soit la norme, elle attend aussi longtemps que cette réponse a pris avant d'interroger de nouveau ce service. Plusieurs lectures qui attendent en même temps passent à tour de rôle, de sorte qu'une pause ne se termine pas en rafale. Un service qui continue de répondre `429` ou `503` est laissé tranquille pendant une minute, puis deux, puis quatre, jusqu'à une demi-heure. Rien d'autre n'est retenu : chaque service est interrogé séparément.

La carte **Collecte des données** du cloud l'indique tant que cela dure, service par service : la lenteur de sa réponse la plus lente, et la durée pendant laquelle la sonde s'est retenue. L'exportateur de l'agent ne peut pas faire cela. Un scrape s'exécute en entier, à son intervalle : augmentez `scrape_interval` et `scrape_timeout` pour ce job afin de ménager un service.

## Les données envoyées

Les séries d'un cloud découlent de ses effectifs. Le calculateur de la page **Documentation** d'un cloud dans OneUptime le détermine à partir de trois nombres. Pour le calculer vous-même, pour une région :

| Séries | Combien |
| --- | --- |
| Compute | 10 par hyperviseur, plus les gabarits et les services de contrôle, plus 7 |
| Placement | 15 par hyperviseur, plus 4. Une sonde ajoute environ 2 par gabarit, pour [combien de chaque tiennent](/docs/telemetry/openstack#capacité) |
| Neutron | Agents, réseaux, routeurs et IP flottantes, 3 par sous-réseau, plus 11. Une de plus par routeur sur ML2/OVS |
| Cinder | Services, instantanés et sauvegardes, 2 par pool de stockage, plus 26 |
| Instances et volumes, sauf si le mode synthèse est activé | 4 par instance, 2 par volume |
| Décomptes du mode synthèse, lorsqu'il est activé | Un par statut et un par projet : environ 6 plus les projets |
| Keystone, Glance | Projets, domaines et 9, et 2 par image plus 5. Une sonde en ajoute 3 pour chacun de Heat et Magnum, que le cloud les exécute ou non |

Les lignes de chaque scrape sont ce qui vous est facturé : les cinq premières lignes arrivent toutes les 2 minutes, 720 fois par jour, et la dernière toutes les 5 minutes, 288 fois. Le prix est celui de votre facture, [par Go selon la durée de conservation](/docs/telemetry/openstack#ce-que-cela-coûte). La facture lit la taille réelle de chaque ligne, et ce calcul se fait à 1 024 octets par ligne, ce à quoi la facturation de OneUptime se rabat lorsqu'elle n'a pas de taille pour une ligne. Une ligne avec beaucoup de labels, comme celle d'une instance, coûte davantage, et une sans label coûte moins.

| Cloud | Séries | Go par jour, toutes les séries | Go par jour, en mode synthèse | Un mois conservé 15 jours, en mode synthèse |
| --- | --- | --- | --- | --- |
| 10 hyperviseurs, 100 instances, 20 projets | 1 084 | 0,7 | Pas en mode synthèse | 2,12 $ |
| 500 hyperviseurs, 20 000 instances, 1 000 projets | 123 856 | 84,5 | 16,6 | 49,71 $ |
| 5 000 hyperviseurs, 200 000 instances, 10 000 projets | 1,237,192 | 844,5 | 164,9 | 494,73 $ |

Ces chiffres valent pour l'agent, avec une instance sur mille dans un état qui conserve ses séries. Une sonde au-delà de la taille de synthèse envoie ce qui n'a pas changé une fois par cycle plutôt qu'à chaque collecte, ce qui représente environ 13,2 Go par jour à la deuxième taille et 116 Go à la troisième.

L'utilisation réelle par instance, depuis libvirt ou Ceilometer, vient s'ajouter à tout cela : voir [ce que cela coûte](/docs/telemetry/openstack#ce-que-cela-coûte).

## Mode synthèse

Au-delà de 5 000 instances, un cloud conserve des décomptes et des lignes, plutôt qu'une série par instance. À cette taille, ces séries représentent l'essentiel de la facture, à environ 17 Go par jour contre 4 Go pour tout le reste, et elles disent ce que disent déjà les lignes et les décomptes.

**Ce qu'il conserve :**

- Une ligne pour chaque partie, sur chaque page et chaque liste, tenue à jour. Les changements de statut y parviennent comme d'habitude.
- Toutes les séries des hyperviseurs, workers, réseaux, routeurs, IP flottantes, pools d'adresses et pools de stockage.
- `openstack_nova_instances_by_status` et `openstack_nova_instances_by_project`, dans chaque région.
- Les séries de toute instance ou de tout volume dans un état surveillé par une alerte : en `ERROR`, ou bloqué en `BUILD`, `RESIZE`, `attaching` et similaires. Ainsi chaque [modèle d'alerte](/docs/monitor/openstack-monitor#modèles-dalerte-prédéfinis) continue de fonctionner, et de se rétablir tout seul.

**Ce à quoi il renonce :**

- L'historique du statut de chaque instance et volume stabilisé, ainsi qu'un graphique ou un moniteur sur ces séries. `openstack_nova_server_status`, `openstack_cinder_volume_gb` et `openstack_cinder_volume_status` s'arrêtent pour une partie dès qu'elle est stabilisée. Un moniteur qui a besoin d'une seule instance devrait choisir son projet, ci-dessous.
- `openstack_placement_resource_provider_allocations` et `openstack_nova_server_local_gb`, à qui qu'elles appartiennent. Une sonde cesse complètement de demander les allocations à Placement.

**Pour conserver malgré tout les séries d'une instance**, ouvrez les **Paramètres** du cloud, puis **Utilisation réelle par instance**. **Uniquement les projets et agrégats que je choisis** conserve chaque instance et chaque volume de ces projets, quelle que soit la taille du cloud. **Chaque instance** désactive le mode synthèse pour tout le cloud. Une sonde le refuse au-delà d'environ 480 MiB de métriques par collecte, plutôt que de le garder en mémoire : utilisez l'agent pour un tel cloud.

**Avec une sonde**, il y a une différence de plus. Au-delà de la taille de synthèse, elle lit tout à chaque fois, et n'envoie que ce qui a changé, ce que quelqu'un a choisi, ce qu'une alerte surveille et une part du reste. Chaque partie revient une fois par cycle, dimensionné pour que l'envoi d'une collecte reste autour de 24 MiB au-delà des séries qui partent à chaque fois : 6 minutes à 20 000 instances, 44 à 200 000. La carte **Collecte des données** indique la durée du cycle. Deux conséquences en découlent :

- **Les listes d'un nouveau cloud se remplissent pendant son premier cycle.** La première collecte sait ce que contient le cloud, et la carte l'indique aussitôt, mais ses lignes arrivent une part à la fois. Il en va de même pour une sonde qui a redémarré, bien que les lignes qu'elle a laissées restent sur les pages entre-temps. La carte indique quand elles seront toutes arrivées.
- **Une partie disparue reste listée un peu plus longtemps.** Elle part au bout de 15 minutes sans que rien ne la signale, plus le cycle, plus deux lectures. Donc 15 minutes et quelques sur la plupart des clouds, et un peu plus d'une heure à 200 000 instances. Une partie toujours présente n'est jamais retirée. Une lecture en échec ne retire rien, quelle que soit sa durée.

## Partager un cloud entre plusieurs collecteurs

Un agent lit un cloud quel que soit son nombre de régions, et c'est par là qu'il faut commencer. Lorsqu'un seul est trop pour la machine qui l'exécute ou pour le temps d'un scrape, donnez une part à chaque agent. Chacun envoie au même cloud OneUptime sous le même `OPENSTACK_CLOUD_NAME`. Deux règles évitent qu'un graphique et une facture comptent double :

- **Chaque couple région-service appartient à un seul agent.** Une ligne est la même ligne quel que soit le nombre d'agents qui la signalent, mais les séries de chaque agent sont stockées et facturées.
- **Keystone appartient à un seul agent.** Il est unique pour tout le cloud, quelle que soit la région qui l'interroge.

**Un agent par région** est ce que veulent la plupart des clouds. Ne listez que les entrées de cette région dans `clouds.yaml` et `OPENSTACK_EXPORTER_CLOUDS`. Seul le premier agent conserve Keystone :

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Un agent par service** est destiné aux plus grands clouds, où les listes d'un service sont ce qu'un scrape ne peut pas terminer. `OPENSTACK_AGENT_SERVICES` conserve les jobs qu'il nomme, et laisse le reste à un autre agent :

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Définissez `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` sur un agent qui détient une grande part : il garde un scrape en mémoire avant de l'envoyer, et la valeur par défaut est de 512 MiB. Une ligne est garantie par son propre service dans sa propre région : un agent qui s'arrête n'emporte donc rien de ce que lit un autre agent. Nommez ce sur quoi repose un cloud, les `OPENSTACK_RABBITMQ_TARGETS` et [les autres du même genre](/docs/telemetry/openstack#variables-denvironnement), sur un seul agent. Si cet agent s'arrête alors que les autres continuent, ces machines quittent les pages après 15 minutes, et reviennent quand il revient.

**Avec des sondes**, un cloud a une seule sonde. Donnez une sonde propre à une région en la connectant comme un cloud à part, avec cette seule région choisie : rien n'est compté deux fois, car chacune ne lit que sa propre région, et chacune lit Keystone pour elle-même. Chacune est alors un cloud à part dans OneUptime, avec ses propres pages et ses propres alertes.

## Le chemin par la base de données

Au-delà de **1 500 hyperviseurs ou 100 000 instances**, l'agent peut lire les bases de données d'un cloud plutôt que ses API, avec [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). À cette taille, un scrape des API manque de temps, et des lectures qui ne peuvent pas se terminer sont de la charge pour rien. Une lecture de base de données ne coûte rien aux API. Elle n'est proposée qu'au-delà de cette taille, car en dessous les API répondent assez bien et ce chemin fait renoncer à certaines choses.

**Ce qu'il exige de vous :**

- Un compte en lecture seule sur la base de données de chaque service : Nova, Nova API, Placement, Neutron, Cinder, Glance et Keystone. Une base de données omise est un service qu'il laisse tranquille.
- Une route de la machine de l'agent vers ces bases de données, qui sur la plupart des clouds sont tenues bien à l'écart de tout le reste. C'est une chose de plus qui peut lire les enregistrements de chaque projet.
- Un exportateur par région, et par cellule Nova. Il lit ce vers quoi vous le pointez, et une deuxième cellule exige un deuxième exportateur.
- Ses schémas qui suivent votre version. Il lit directement les tables de chaque service : une mise à niveau d'OpenStack peut donc changer ce qu'il peut lire avant qu'une nouvelle version de l'exportateur ne paraisse.

**Pour l'activer**, dans `.env` :

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**Ce qu'il couvre.** Les mêmes séries sous les mêmes noms : chaque page, moniteur et modèle d'alerte les lit donc de la même façon. Un test les confronte à celles de l'exportateur d'API, nom par nom et label par label.

**Ce qu'il ne couvre pas :**

| Quoi | Pourquoi, et ce qui se passe à la place |
| --- | --- |
| Si chaque worker Nova est vivant | Son `openstack_nova_agent_state` vaut 1 pour tout service activé : un `nova-compute` arrêté apparaîtrait donc actif. L'agent abandonne cette série et la lit depuis l'API de Nova, ce qui représente une petite liste |
| Le degré de remplissage de chaque pool de stockage | Chaque backend le signale au planificateur de Cinder, et ce n'est pas dans la base de données. L'agent le lit depuis l'API de Cinder, ce qui représente une liste de plus |
| Le MTU d'un réseau | Apparaît comme inconnu |
| `openstack_placement_resource_provider_allocations`, la génération d'un fournisseur | Rien ne les lit |
| Quotas et limites par projet | Il peut les lire, et à 10 000 projets cela fait 790 000 points de données par scrape : l'agent les omet donc. Supprimez cette règle dans `otel-collector-config.yaml` pour les conserver |
| Si une API répond | `openstack_<service>_up` indique si sa base de données répond. Une API arrêtée avec une base saine apparaît comme active : surveillez donc les API elles-mêmes avec un [moniteur de site web](/docs/monitor/website-monitor) |

**Dans quelle mesure c'est démontré.** Les séries ont été lues dans le code source de l'exportateur et ses propres tests, au tag que l'agent épingle, et chacune correspond à ce que lit OneUptime. Il n'a pas été exécuté ici contre une vraie base de données.

## À quoi la plus grande taille a été soumise

Le vrai collecteur a lu une API simulée de 5 000 hyperviseurs, 200 000 instances et 10 000 projets toutes les deux minutes pendant 60 minutes, sur une vraie horloge. Ce qu'il a envoyé est passé par le vrai pliage et les vraies écritures dans un vrai Postgres, avec les lectures de la Vue d'ensemble et le balayage des lignes périmées s'exécutant à côté toutes les 30 secondes, et 200 instances qui changent à chaque collecte. Chaque budget ci-dessous est vérifié par une assertion, et une exécution qui en manque un échoue.

| Quoi | Budget | Mesuré |
| --- | --- | --- |
| Requêtes par minute, telles que demandées à chaque service | Exactement ce que dit le calendrier du collecteur, service par service | Exact. Keystone 1,3, Nova 25,1, Placement 1 166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Collectes ignorées parce que la précédente tournait encore | Aucune | 0 sur 30 |
| Latence d'ingestion, du début d'une collecte à l'écriture de sa dernière ligne | Moins de 2 minutes | 37 s en médiane, 112 s au pire |
| L'ouverture d'une Vue d'ensemble, toutes les lectures qu'elle fait en même temps | Moins de 6 secondes | 0,6 s en médiane, 4,1 s au pire, et 5 008 octets de ce qui demande de l'attention |
| La plus longue attente d'un écrivain sur un verrou de la table d'inventaire | Moins de 5 secondes | 0,0 s, sur 2 739 observations à la seconde |
| Parties supprimées alors qu'elles étaient encore là | Aucune | 0 |

Et ce que cela a demandé, sans budget : 73 MiB de métriques par collecte avant compression, en 2 envois au plus, 14 s de CPU de ce processus par collecte pour lire, envoyer et écrire ensemble, et au plus 998 MiB de tas JavaScript. Une sonde qui collecte un cloud de cette taille a besoin de cette mémoire en plus de son autre travail.

Cela a tourné sur un Mac à 10 cœurs, partagé avec d'autres tâches à une charge moyenne d'environ 33, avec PostgreSQL 14 sur la même machine : les temps sont donc ce qu'une machine occupée a réussi, plutôt que ce qu'un serveur ferait. La mesure date du 2026-11-05. Les requêtes d'une heure incluent sa première collecte, qui demande à Placement les inventaires de chaque hyperviseur : elles se lisent donc un peu au-dessus de [celles du tableau](#avec-une-sonde) d'une collecte stabilisée, et les 200 instances qui changent à chaque collecte sont le reste des lectures de Nova à cet endroit.

La marge n'est pas large sur une machine aussi occupée. Une heure antérieure, à une charge moyenne d'environ 42 qui a atteint 95, est allée jusqu'à ce que la dernière ligne d'une collecte arrive à 124 secondes, de sorte que la collecte suivante a été ignorée, et tous les autres budgets ont tenu.

**Ce que cela laisse de côté.** La simulation répond aussitôt : cela ne dit donc rien de la rapidité de vos API, ce dont traite [ce que permet le temps d'une collecte](#avec-une-sonde). Cela laisse de côté le serveur HTTP et la file entre une sonde et l'ingestion, ainsi que ClickHouse : la lecture des séries par un graphique ou un moniteur n'y figure donc pas, seulement les écritures et lectures de l'inventaire. Les lignes ont la forme de celles d'un vrai DevStack et les effectifs sont inventés. Aucun cloud de cette taille n'a été testé avec lui.

## Ce que lisent les pages

Les pages d'un grand cloud se lisent aussi vite que celles d'un petit, car aucune ne lit tout le cloud.

| Page | Ce qu'elle lit |
| --- | --- |
| **Vue d'ensemble** | Des décomptes calculés sur le serveur, et les lignes qui peuvent demander quelqu'un. Au-delà de 1 000 hôtes ou workers, les autres sont seulement comptés : ce qu'elle charge reste donc sous un mégaoctet, quelle que soit la taille du cloud |
| **Services** | Pareil : une carte par service, ce qui demande quelqu'un en premier, et combien d'autres vont bien. Une recherche interroge le serveur, elle trouve donc n'importe quel hôte |
| Listes | Une page à la fois, chacune à partir de la dernière ligne de la page précédente. Un saut vers une page lointaine passe par un décalage, ce qui sur la dernière page de 200 000 lignes prend des secondes plutôt qu'une milliseconde |
| **Topologie** | Au-delà de 5 000 parties, la structure, ce qui a échoué et ce que cela entraîne. Elle indique ce qu'elle a laissé de côté |
| **Écritures d'inventaire** | 500 lignes au plus par instruction, et 5 000 pour une suppression, chacune dans sa propre transaction, de sorte qu'aucun écrivain n'attende longtemps un autre. Une ligne sur laquelle rien n'a changé n'est pas réécrite pendant 5 minutes au plus, ce qui réduit le journal d'écriture anticipée de plus de vingt fois |

## Utilisation et dépenses

La [page Spend](/docs/telemetry/openstack#dépenses) d'un cloud lit les lignes de l'inventaire plutôt que les séries d'une instance : elle fonctionne donc de la même façon en mode synthèse, et son coût croît avec les projets plutôt qu'avec les instances. Elle lit une ligne du cloud et une page de projets. [Sa propre section](/docs/telemetry/openstack#à-chaque-taille) donne les chiffres à chaque taille.

## Étapes suivantes

:::cards
- [Agent OpenStack](/docs/telemetry/openstack): Installez l'agent.
- [OpenStack sans agent](/docs/telemetry/openstack-agentless): Collectez un cloud avec une sonde.
- [Moniteur OpenStack](/docs/monitor/openstack-monitor): Alertez sur ce qui arrive.
:::
