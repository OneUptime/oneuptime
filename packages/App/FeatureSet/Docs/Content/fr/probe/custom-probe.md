# Sondes personnalisées

Une sonde personnalisée est un petit agent que vous exécutez dans votre propre réseau. Elle vérifie les moniteurs auxquels vous l'ajoutez, comme des sites web internes, des API et des serveurs derrière votre pare-feu, et envoie les résultats à OneUptime. Elle n'ouvre que des connexions sortantes, en HTTPS : rien dans votre réseau n'a besoin d'accepter des connexions depuis Internet.

:::cards
- [Fonctionnement](#fonctionnement): Ce que fait la sonde, et comment OneUptime sait qu'elle tourne.
- [Installer une sonde](#installer-une-sonde): La créer dans OneUptime, la lancer avec Docker, Docker Compose ou Kubernetes, et l'ajouter à des moniteurs.
- [Variables d'environnement](#variables-denvironnement): Chaque réglage que la sonde lit, avec sa valeur par défaut.
- [Diagnostiquer une sonde déconnectée](#diagnostiquer-une-sonde-déconnectée): Trouver où s'arrêtent les requêtes de la sonde vers OneUptime.
:::

## Fonctionnement

```mermaid title="Ce que fait une sonde personnalisée"
sequenceDiagram
    participant P as Sonde personnalisée
    participant S as Vos services
    participant O as OneUptime
    P->>O: Je tourne (chaque minute)
    P->>O: Lesquels de mes moniteurs sont dus ?
    O-->>P: Les moniteurs à vérifier
    P->>S: Vérifier chacun d'eux
    P->>O: Envoyer les résultats
    O->>O: Mettre à jour le statut, ouvrir des incidents ou des alertes
```

- **La sonde se connecte vers l'extérieur.** Chaque requête part de la sonde vers `ONEUPTIME_URL` en HTTPS. Rien ne doit joindre la sonde depuis l'extérieur de votre réseau.
- **Elle ne vérifie que ses propres moniteurs.** La sonde demande à OneUptime les moniteurs auxquels elle est ajoutée, vérifie chacun quand il est dû et renvoie le résultat. OneUptime décide d'après les résultats si le statut d'un moniteur change.
- **OneUptime surveille qu'elle tourne.** Chaque requête de la sonde compte comme un signe de vie, et la sonde en envoie au moins une par minute. Après environ trois minutes sans aucune, la sonde affiche **Déconnecté**, et ses propriétaires sont prévenus. Une sonde sans propriétaire prévient les propriétaires du projet.

## Avant de commencer

- **Le plan Growth, sur OneUptime Cloud.** La création d'une sonde l'exige. Une installation auto-hébergée n'a pas de limites de plan.
- **L'autorisation de créer des sondes.** Les propriétaires, administrateurs et membres du projet l'ont, ainsi que toute personne dont le rôle permet de créer des sondes.
- **Une machine dans le réseau à surveiller.** Elle a besoin de Docker, de Docker Compose ou de Kubernetes, d'une route vers les services que la sonde vérifiera, et d'un accès HTTPS sortant vers `ONEUPTIME_URL`.

## Installer une sonde

:::steps
### Créer la sonde

Ouvrez **Moniteurs → Paramètres → Sondes** et cliquez sur **Créer : Sonde**. Donnez-lui un **Nom** et une **Description** : les deux sont obligatoires. **Plus de champs** contient le **Logo de la sonde**, **Activer automatiquement la surveillance sur les nouveaux moniteurs**, qui choisit cette sonde pour chaque nouveau moniteur que vous créez, et les **Étiquettes**.

### Copier son ID et sa clé

La sonde a besoin de son ID et de sa clé pour se connecter. Pour les copier, ouvrez le menu de la sonde dans le tableau **Sondes personnalisées** et choisissez **Afficher l'ID et la clé**. Toute personne qui voit le tableau peut copier l'ID d'une sonde ; sa clé n'est affichée qu'aux propriétaires et administrateurs du projet, qui voient **Afficher l'ID et la clé** là où les autres voient **Afficher l'ID**.

Les propriétaires et administrateurs du projet peuvent aussi cliquer sur la sonde : la carte **Set up your Custom Probe** de sa page affiche la commande Docker avec son ID et sa clé déjà renseignés.

### Lancer la sonde

Lancez-la sur la machine choisie, avec l'ID et la clé de la sonde. Si vous hébergez OneUptime vous-même, réglez `ONEUPTIME_URL` sur l'URL de votre installation au lieu de `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Démarrez-la ensuite avec `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Appliquez-la ensuite avec `kubectl apply -f oneuptime-probe.yaml`.
:::

Le réseau de l'hôte (`--network host`, `network_mode: host`) permet à la sonde d'utiliser le propre réseau de l'hôte, IPv6 compris. Lisez [Surveiller des destinations IPv6](#surveiller-des-destinations-ipv6) avant de la lancer sans le réseau de l'hôte.

### Vérifier qu'elle se connecte

En une minute ou deux, le **Statut** de la sonde dans le tableau **Sondes personnalisées** indique **Connecté**. S'il indique toujours **Déconnecté**, le journal de la sonde dit pourquoi : voir [Diagnostiquer une sonde déconnectée](#diagnostiquer-une-sonde-déconnectée).

### Faire vérifier un moniteur par la sonde

Une sonde ne vérifie que les moniteurs auxquels elle est ajoutée. Un nouveau moniteur choisit ses sondes à l'étape **Sondes et intervalle** de **Créer un moniteur**. Pour un moniteur existant, ouvrez-le et allez dans **Configuration → Sondes et intervalle**. La page compte trois cartes :

- **Intervalle de surveillance** : la fréquence à laquelle chacune des sondes du moniteur le vérifie. Choisissez un intervalle et il est enregistré aussitôt. Les moniteurs synthétiques, Custom Code et de certificat SSL sont proposés toutes les 5 minutes ou plus ; un moniteur déjà sur un intervalle plus court, ou sur une planification définie par l'API, la conserve et l'affiche dans la liste.
- **Sondes** : cliquez sur **Ajouter une sonde** et choisissez votre sonde personnalisée. Pour qu'une sonde arrête de vérifier ce moniteur, désactivez-la avec **Modifier** dans le menu de la ligne, ou supprimez la ligne.
- **Accord des sondes** : combien de sondes du moniteur doivent voir le même résultat avant que son statut change, saisi dans la phrase « Changer le statut de ce moniteur quand ... sondes sont d'accord ». Laissez la case vide pour toutes. Seules les sondes activées et connectées participent, donc un nombre plus grand signifie aussi toutes. Le nombre est enregistré quand vous quittez la case ou appuyez sur **Enter**.

Les moniteurs que les sondes ne vérifient pas (Manuel, Requête entrante, E-mail entrant, Serveur, Équipement réseau et les moniteurs de télémétrie) n'ont pas de page Sondes et intervalle.
:::

> [!TIP]
> Une sonde qui doit vérifier des adresses privées, comme `http://10.0.0.5/health`, a besoin de `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Les sondes refusent les adresses privées tant que vous ne les autorisez pas : voir [Accès au réseau privé](/docs/self-hosted/private-network-access).

## Passer par un proxy

Si la sonde doit passer par un proxy pour joindre OneUptime ou les sites qu'elle vérifie, donnez-lui l'adresse du proxy :

| Variable | Ce qu'elle fait |
| --- | --- |
| `HTTPS_PROXY_URL` | Le proxy des adresses HTTPS, dont OneUptime lui-même et la plupart des sites. |
| `HTTP_PROXY_URL` | Le proxy des adresses en HTTP simple. |
| `NO_PROXY` | Les hôtes que la sonde joint directement, séparés par des virgules. |

Écrivez l'adresse d'un proxy sous la forme `http://proxy.example.com:8080`, ou `http://username:password@proxy.example.com:8080` lorsqu'il demande un nom d'utilisateur et un mot de passe. La plupart des proxys servent les deux sortes d'adresses : réglez donc les deux variables sur la même URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

Ce qui passe par le proxy :

- **Les propres requêtes de la sonde vers OneUptime.**
- **Les vérifications HTTP des moniteurs** : les moniteurs Website, API, External Status Page, Custom Code, de certificat SSL, synthétiques et de domaine. Les moniteurs de certificat SSL et synthétiques utilisent `HTTPS_PROXY_URL`, ou `HTTP_PROXY_URL` quand seule celle-ci est définie.
- **Pas les autres vérifications.** Ping, Port, DNS, SNMP et les autres vérifications qui ne sont pas en HTTP se connectent directement.

Une entrée de `NO_PROXY` est un nom d'hôte (`api.internal`), un domaine précédé d'un point ou de `*.` pour tous les noms en dessous (`.internal.example.com`), l'un ou l'autre avec un `:port`, ou `*` pour tout. Les plages d'adresses IP ne sont pas lues : listez chaque adresse. Les noms en minuscules `http_proxy`, `https_proxy` et `no_proxy`, ainsi que `HTTP_PROXY` et `HTTPS_PROXY`, fonctionnent aussi.

## Surveiller des destinations IPv6

Une sonde ne peut surveiller une destination IPv6 que si son propre réseau a l'IPv6 :

- **Docker avec `--network host`, ou Compose avec `network_mode: host`** (les configurations ci-dessus) : la sonde partage le réseau de l'hôte, elle a donc l'IPv6 exactement quand l'hôte l'a.
- **Un réseau bridge Docker** (ce que vous obtenez sans le réseau de l'hôte) : pas d'IPv6, sauf si l'IPv6 est activé pour ce réseau (voir plus bas).
- **Kubernetes** : les pods n'ont l'IPv6 que sur un cluster double pile ou uniquement IPv6.

Pour vérifier, envoyez un ping à une adresse IPv6 publique depuis l'intérieur de la sonde :

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` signifie que la sonde peut joindre des destinations IPv6. Si la sonde n'a pas d'IPv6 utilisable, `ping` échoue aussitôt et l'erreur dit pourquoi :

| Erreur | Ce qu'elle signifie |
| --- | --- |
| `Network is unreachable` | Le réseau de la sonde n'a pas de route IPv6 : un réseau bridge Docker sans IPv6, un cluster Kubernetes uniquement IPv4, ou un hôte sans connectivité IPv6. |
| `Cannot assign requested address` | L'IPv6 est désactivé dans l'espace de noms réseau de la sonde. Vérifiez `net.ipv6.conf.all.disable_ipv6` et `net.ipv6.conf.lo.disable_ipv6` : `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` dans la sonde affiche `1` quand il est désactivé. Avec le réseau de l'hôte, ce sont les réglages de l'hôte. |
| `Address family not supported by protocol` | Le noyau a été démarré avec `ipv6.disable=1`, la machine n'a donc pas d'IPv6 du tout. Retirez-le de la ligne de commande du noyau et redémarrez, ou exécutez la sonde sur une autre machine. |

Dans chacun de ces cas, rien n'a été envoyé à la destination : la sonde ne peut donc pas savoir si elle fonctionne. La vérification échoue quand même, mais la raison de l'échec d'un moniteur Ping désigne la sonde au lieu de dire que la destination n'a pas répondu :

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Le chemin réseau enregistré avec l'échec indique `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Réparez le réseau de la sonde, ou déplacez le moniteur vers une sonde qui a l'IPv6.

### L'IPv6 sans le réseau de l'hôte

Si vous ne pouvez pas utiliser le réseau de l'hôte, rattachez la sonde à un réseau Docker où l'IPv6 est activé. L'hôte lui-même doit toujours avoir l'IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 et les versions suivantes choisissent un sous-réseau IPv6 pour le réseau et masquent l'IPv6 sortant de la sonde derrière l'adresse de l'hôte. Les versions plus anciennes ont besoin d'un sous-réseau IPv6 explicite (par exemple `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) et de `"ip6tables": true` avec `"experimental": true` dans `/etc/docker/daemon.json`. Avec Docker Compose, retirez `network_mode: host` et définissez `enable_ipv6: true` sur le réseau de la sonde.

## Recherches de noms NetBIOS dans les scans de découverte

Un [scan de découverte réseau](/docs/monitor/network-device-monitor) avec **Rechercher les noms Windows (NetBIOS)** activé envoie depuis la sonde des requêtes de nom NetBIOS (NBSTAT) à chaque hôte qui n'a pas de nom système SNMP. Pour les scans qui l'utilisent, autorisez ce trafic :

- **Les hôtes interrogés :** les hôtes découverts qui n'ont ni nom système SNMP ni nom DNS inverse (PTR), et seulement à des adresses privées (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) ou de NAT de niveau opérateur (`100.64.0.0/10`). Les adresses publiques ne sont jamais interrogées, et un hôte dont la recherche DNS inverse depuis la sonde a renvoyé un nom ne reçoit jamais de requête. Un hôte dont la recherche a échoué, a expiré ou a été sautée faute de temps dans le budget de recherche peut encore être interrogé, même s'il a un enregistrement PTR.
- **Sortant :** de l'UDP depuis un port source éphémère (aléatoire, élevé) de la sonde vers le port UDP 137 de ces hôtes. Les réglages de proxy ci-dessus ne s'y appliquent pas.
- **Entrant :** les réponses, depuis le port UDP 137 de chaque hôte vers ce port éphémère. Un pare-feu à états les autorise automatiquement. Sans elles, les hôtes restent nommés par leur adresse IP.

La recherche n'a besoin d'aucune capacité de conteneur supplémentaire et fonctionne depuis le réseau des pods Kubernetes. Elle interroge au plus 2 000 hôtes par scan (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` porte ce chiffre à 4 000), envoie une requête de plus à chaque hôte sans réponse, cadence les requêtes à environ 100 par seconde et s'arrête à une limite de temps dimensionnée sur ce travail - environ 54 secondes pour une recherche complète de 2 000 hôtes, et jamais plus de deux minutes. Les sondes globales n'envoient jamais de requêtes NetBIOS, quoi que dise le scan : lancez donc les scans qui ont besoin des noms NetBIOS depuis une sonde personnalisée. L'option est activée pour les nouveaux scans. Des requêtes NBSTAT vers de nombreux hôtes peuvent déclencher des règles de détection d'intrusion : désactivez-la sur les scans des réseaux où cela compte, ou prévenez d'abord votre équipe sécurité.

## Variables d'environnement

La sonde lit ses réglages dans son environnement au démarrage : modifiez-en un, puis redémarrez la sonde. Un nombre que la sonde ne sait pas lire, ou qui sort de la plage qu'une variable accepte, est ignoré et la valeur par défaut s'applique ; les limites de capture de paquets sont ramenées dans leur plage à la place.

### Obligatoires

| Variable | Ce que c'est |
| --- | --- |
| `PROBE_KEY` | La clé de la sonde, obtenue avec **Afficher l'ID et la clé**. Sans elle, la sonde s'arrête au démarrage. |
| `PROBE_ID` | L'ID de la sonde, obtenu avec **Afficher l'ID et la clé**. Sans lui, la sonde s'arrête au démarrage. |
| `ONEUPTIME_URL` | Où se trouve OneUptime : `https://oneuptime.com`, ou l'URL de votre propre installation. Sans elle, la sonde s'arrête au démarrage. |

### Vérification des moniteurs

| Variable | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Combien de lots de moniteurs la sonde vérifie à la fois. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Combien de moniteurs compte un lot. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Nouvelles tentatives après la première tentative d'une vérification échouée, utilisées quand une étape ne fixe pas son propre nombre, soit jusqu'à 4 tentatives. `0` désactive les nouvelles tentatives. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Délai pour vérifier un moniteur, après lequel la vérification est abandonnée et retentée au cycle suivant. La valeur par défaut augmente quand le délai des scripts synthétiques est relevé, pour qu'un script ne soit jamais interrompu. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Délai des scripts des moniteurs synthétiques, en millisecondes. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Réglez sur `true` pour exécuter Chromium, dans les moniteurs synthétiques, dans son propre bac à sable. Ne l'activez que si le conteneur de la sonde tourne avec un profil seccomp qui autorise le bac à sable, comme celui de Playwright : sans lui, Chromium ne peut pas démarrer. Tant qu'elle est désactivée, la sonde écrit un avertissement dans son journal au démarrage. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Délai des scripts des moniteurs Custom Code, en millisecondes. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Réglez sur `true` pour permettre aux moniteurs Website, API, External Status Page et Custom Code de cette sonde de joindre des adresses privées. Voir [Accès au réseau privé](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Nombre d'appareils réseau que la sonde interroge à la fois. Augmentez-le pour une sonde qui interroge de nombreux appareils. |

Les limites dans lesquelles tourne un moniteur synthétique (combien tournent à la fois, leur mémoire et leur disque) figurent sur la page [Surveillance synthétique](/docs/monitor/synthetic-monitor).

### Dialogue avec OneUptime

| Variable | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | aucun | Les réglages du proxy : voir [Passer par un proxy](#passer-par-un-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Délai de chaque requête que la sonde envoie à OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Journaliser un avertissement pour les requêtes vers OneUptime plus lentes que cela. |

### Découverte réseau

| Variable | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutes) | Délai d'un balayage de découverte réseau, après lequel il est abandonné et le scan signalé en échec. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | À quelle fréquence un balayage de découverte en cours envoie les hôtes trouvés jusque-là, pour qu'un long scan montre sa progression et que ses équipements puissent être importés avant la fin. Minimum `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Nombre fixe d'adresses qu'un balayage de découverte sonde à la fois. Laissez-la vide (ou à `0`) pour la dimensionner d'après la cible du scan, ce que vous voulez sauf si le conteneur de la sonde est inhabituellement petit ou inhabituellement grand. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Limite de temps, en millisecondes, pour rechercher les noms DNS inverses (PTR) des hôtes trouvés par un balayage. Voir ci-dessous. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Combien d'hôtes la recherche NetBIOS d'un scan peut interroger. Voir ci-dessous. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Nombre maximal de scans de découverte indépendants exécutés en même temps sur cette sonde, de 1 à 16. Voir ci-dessous. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` : laissez-la vide (ou à `0`) pour dimensionner la limite d'après le nombre d'hôtes : 60 secondes jusqu'à environ 860 hôtes, puis davantage, jusqu'à 10 minutes au plus. Vous pouvez la régler de 1000 à 1200000. Les hôtes que les recherches n'atteignent pas à temps n'obtiennent pas de nom DNS inverse (ils sont listés par adresse IP sauf si SNMP ou NetBIOS les nomme), et le message de statut du scan dit combien ont été manqués. Une recherche qui expire ou échoue est retentée une fois tant que la limite le permet, en interrogeant tour à tour chacun des serveurs de noms de la sonde. Augmentez-la pour un grand réseau derrière un serveur DNS lent.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` : pour les scans avec les noms NetBIOS activés, la recherche interroge chaque hôte sans nom système SNMP, ceux sans nom DNS inverse en premier. Laissez-la vide (ou à `0`) pour garder le plafond intégré de 2 000 ; vous pouvez la régler de 1 à 4000. Les hôtes au-delà du plafond ne sont pas interrogés, et le message de statut du scan dit combien. L'augmenter allonge aussi la recherche (sa limite de temps en dépend : environ 104 secondes pour 4 000 hôtes) et met davantage de datagrammes NBSTAT sur le réseau, ce que surveillent les règles de détection d'intrusion.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` : la sonde cherche un autre scan en attente chaque minute tant qu'elle a de la capacité, pour qu'un long scan ne bloque pas tous les autres. Quand toutes les places sont prises, les scans supplémentaires restent en attente jusqu'à ce qu'une place se libère. Chaque scan a sa propre concurrence d'hôtes, donc la consommation de ressources croît avec les deux réglages ; abaissez l'une ou l'autre limite pour les petits conteneurs. Réglez-la sur 1 pour exécuter les scans l'un après l'autre.

Mettez à jour le serveur OneUptime avant de mettre à jour les sondes personnalisées pour utiliser la découverte en parallèle. Le serveur doit pouvoir exclure les scans que la sonde exécute encore, afin que modifier un scan en cours mette sa nouvelle configuration en file d'attente sans risque. Si vous connectez une sonde mise à jour à un serveur plus ancien, réglez `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` jusqu'à la mise à jour du serveur.

### Capture de paquets

| Variable | Défaut | Ce qu'elle fait |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | désactivée | Réglez sur `true` pour permettre aux personnes qui en ont l'autorisation de lancer des captures de paquets sur cette sonde depuis le tableau de bord. Les captures ont aussi besoin du réseau de l'hôte et de la capacité `NET_RAW`. Voir [Capture de paquets](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | La plus longue capture de paquets que cette sonde exécute, de 5 à 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Le plus gros fichier de capture que cette sonde produit, de 1 à 25. |

### Ce sur quoi la sonde écoute

Une sonde n'ouvre que des connexions sortantes, sauf si vous activez un écouteur, ou gardez un écouteur activé par défaut :

| Écouteur | Réglage | Défaut | En savoir plus |
| --- | --- | --- | --- |
| Requêtes entrantes et heartbeats | `PROBE_INGRESS_PORT` | Désactivé | [Ingress de requêtes entrantes](/docs/probe/incoming-request-ingress) |
| Traps SNMP | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Activé, UDP 162 | [Surveillance des équipements réseau](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Désactivé, UDP 5140 | [Guides par constructeur réseau](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX et sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Activé, UDP 2055, 4739 et 6343 | [Trafic réseau](/docs/monitor/network-traffic) |
| Contrôles de santé | `PORT` | Activé, TCP 3874 | `/status/live` et `/status/ready` |

Dans un conteneur, un port n'est joignable depuis d'autres machines qu'avec le réseau de l'hôte ou si vous le publiez.

Le récepteur syslog transmet au plus `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` messages par minute, `600` par défaut, rejette le reste et note dans son journal combien il en a rejeté.

`PROBE_NAME` et `PROBE_DESCRIPTION` ne sont lus que par les sondes qui s'enregistrent elles-mêmes avec `REGISTER_PROBE_KEY`, comme les sondes qu'une installation auto-hébergée exécute pour tous les projets. Une sonde personnalisée prend son nom et sa description dans le tableau de bord.

## Dépannage

### Diagnostiquer une sonde déconnectée

Une sonde est signalée `Disconnected` quand ses requêtes vers OneUptime cessent d'aboutir. Le journal de la sonde dit où chaque requête échouée s'est bloquée : vous avez rarement à deviner.

:::steps
#### Lire le bloc d'environnement affiché au démarrage

Chaque sonde affiche au démarrage un bloc JSON avec l'URL OneUptime qu'elle utilise, son délai de requête, ses réglages de proxy, les résolveurs DNS dont elle a hérité, la version de Node et du système, et l'indication que la vérification TLS a été désactivée ou non. Joignez ce bloc à chaque signalement de problème.

#### Trouver le rapport d'échec

Chaque requête échouée vers OneUptime journalise un bloc contenant `stalledAt` et `whatThisMeans`. `stalledAt` est la phase que la requête n'a jamais franchie :

| `stalledAt` | Ce que cela signifie |
| --- | --- |
| `SocketAssignment` | Rien n'a quitté la machine. Le pool de sockets était saturé, ou un proxy configuré n'a jamais établi son tunnel CONNECT. |
| `TcpConnect` | La machine a envoyé SYN et n'a rien reçu en retour – un pare-feu ou un équipement de sécurité supprime des paquets, ou l'hôte est injoignable. |
| `TlsHandshake` | TCP s'est connecté, TLS n'a jamais abouti. Le plus souvent un équipement intermédiaire qui inspecte le TLS. |
| `RequestSend` | Connecté, mais la requête n'a jamais été entièrement écrite – l'autre extrémité a cessé de lire. |
| `WaitingForServerResponse` | La requête a été livrée et le serveur n'a rien renvoyé. **Le réseau de la sonde va bien** – vérifiez le serveur OneUptime, son répartiteur de charge et son proxy inverse. |
| `ResponseBody` | Le serveur a commencé à répondre et s'est arrêté en cours de route. |
| `Unknown` | La sonde n'a pas pu savoir où la requête s'est arrêtée. Lisez ensuite l'autotest de connectivité, plus bas. |

Le même bloc indique aussi `deadlineOverrunInMs`. Si un délai de 45000ms a pris bien plus que 45000ms en temps réel, c'est le processus de la sonde lui-même qui était bloqué – vérifiez `probeProcess.eventLoopMaxDriftInMs` dans le bloc avant d'examiner le réseau.

#### Lire l'autotest de connectivité

Après trois échecs consécutifs, la sonde teste le même serveur couche par couche – DNS, puis TCP, puis TLS, puis un véritable aller-retour HTTP – et journalise chaque étape avec sa durée. La première étape qui échoue est votre réponse. Quand un proxy est configuré, la sonde teste le saut vers le proxy, car c'est le seul qu'elle fait réellement. Le test s'exécute au plus une fois toutes les cinq minutes.

#### Repérer les requêtes lentes avant qu'elles échouent

Les requêtes qui aboutissent mais durent plus que `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` sont journalisées avec leur durée. Une sonde qui commence à journaliser des requêtes de 20 secondes est en passe de dépasser le délai de 45 secondes.
:::

Côté serveur OneUptime, une requête de sonde à laquelle il est répondu lentement – ou que la sonde a abandonnée avant qu'une réponse soit envoyée – est aussi journalisée, avec l'id de la sonde. Ces deux journaux ensemble indiquent de quel côté de la connexion se trouve le problème.

### Autres problèmes

:::details La sonde s'arrête juste après avoir démarré
Son journal nomme ce qui manque : `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` ou `PROBE_ID or REGISTER_PROBE_KEY should be set`. Si les trois sont définies mais que l'ID et la clé ne correspondent à aucune sonde, la sonde essaie 10 fois, à 30 secondes d'intervalle, puis s'arrête avec `Unable to register probe after 10 attempts`. Copiez de nouveau l'ID et la clé avec **Afficher l'ID et la clé**.
:::

:::details La sonde fonctionnait jusqu'à ce que quelqu'un réinitialise sa clé
**Réinitialiser la clé de la sonde**, sur la page de la sonde, crée une nouvelle clé et l'ancienne cesse aussitôt de fonctionner. Copiez la nouvelle clé avec **Afficher l'ID et la clé**, définissez-la comme `PROBE_KEY` et redémarrez la sonde.
:::

:::details Un moniteur dit qu'il ne peut pas joindre une adresse privée
Les sondes refusent les adresses privées tant que vous ne les autorisez pas. Définissez `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` sur la sonde et redémarrez-la : voir [Accès au réseau privé](/docs/self-hosted/private-network-access).
:::

Si le problème persiste, ouvrez une issue sur [GitHub](https://github.com/oneuptime/oneuptime) ou [contactez le support](https://oneuptime.com/support).

## Prochaines étapes

:::cards
- [Créer un moniteur](/docs/monitor/create-monitor): Choisir ce qui est vérifié, et par quelles sondes.
- [Ingress de requêtes entrantes](/docs/probe/incoming-request-ingress): Laisser les services sans accès à Internet envoyer leurs heartbeats par la sonde.
- [Capture de paquets](/docs/probe/packet-capture): Capturer depuis le tableau de bord le trafic que voit la sonde.
- [Accès au réseau privé](/docs/self-hosted/private-network-access): Laisser une sonde vérifier des adresses privées.
:::
