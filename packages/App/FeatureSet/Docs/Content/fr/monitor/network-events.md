# Événements réseau (syslog et traps SNMP)

Les routeurs, pare-feu, commutateurs et points d'accès disent ce qui leur arrive dans leur syslog : un lien est tombé, un tunnel s'est interrompu, un pare-feu a basculé, quelqu'un s'est connecté. Chaque fabricant le formule à sa façon. Pointez leur syslog vers une sonde OneUptime, et les pages **Événements** montrent ce qui s'est passé dans les mêmes mots, quel que soit le fabricant de l'appareil, et vous alertent quand cela se reproduit.

Il y a une page Événements à deux endroits :

- **Réseau** -> **Événements** : tout le réseau, les événements de tous les appareils sur une seule page, et chaque adresse qui envoie du syslog sans être encore un appareil.
- L'onglet **Événements** d'un appareil : ce que cet appareil a signalé.

## Ce que montre la page Événements

- Les événements de la période, du plus récent au plus ancien. Chaque ligne dit ce qui s'est passé, sur quel appareil, à quoi - l'interface, le tunnel, la passerelle - et dans les mots mêmes de l'appareil.
- **Problèmes**, **Rétablissements** et **Informatifs**, chacun avec son nombre sur la période. Cliquez sur l'un d'eux pour ne voir que ceux-là.
- Le sélecteur **Tous les événements** et, sur la page du réseau, le sélecteur **Tous les appareils** restreignent encore la liste. La période et les filtres sont conservés dans l'adresse de la page, si bien qu'un lien ouvre exactement la même vue.
- Cliquez sur un événement pour l'ouvrir : quand il s'est produit, sur quoi il porte, le message tel que l'appareil l'a envoyé, et chaque attribut que OneUptime en a tiré.
- **Créer une alerte** propose les alertes que veulent la plupart des réseaux, et **Créer une alerte pour cet événement** en crée une pour l'événement que vous avez ouvert. Voir [Alertes](#alertes).

Un événement est un journal. Tout ce qui se trouve sur la page Événements peut aussi être recherché, tracé et servir à des alertes depuis **Journaux** : un événement est un journal dont l'attribut `event.domain` vaut `network`, avec ce qui s'est passé dans `event.name`.

## Ce que lit OneUptime

Le syslog aux formats RFC 3164 et RFC 5424 et le Common Event Format (CEF) sont lus quel que soit le produit. En plus de cela, OneUptime sait ce qu'écrivent ces produits :

| Fabricant | Produits | Événements lus | Attributs |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Appareils, Haute disponibilité, VPN, Routage, Matériel, Commutation, Connexions | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Appareils, Haute disponibilité, VPN, WAN, Connexions | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Appareils, Haute disponibilité, VPN, WAN, Matériel, Connexions | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Appareils, Haute disponibilité, Routage, Matériel, Commutation, Connexions | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Routage | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Matériel | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Appareils, Connexions | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Appareils, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Appareils, WAN, Commutation, Connexions, Wi-Fi | `cef.*` |
| Tous | Appareils basés sur Linux (noyau, hostapd, OpenSSH, Dropbear) | Interfaces, Connexions, Wi-Fi | - |

Un message dans l'un de ces formats voit ses propres champs enregistrés comme attributs sous le préfixe de la dernière colonne : `con_name="HQ-Branch1"` sur un pare-feu Sophos devient l'attribut `sophos.con_name`. Un message CEF de tout autre produit voit son en-tête et ses champs d'extension enregistrés sous `cef.*`. Un message que OneUptime ne sait pas situer est tout de même enregistré comme journal, avec son en-tête syslog lu ; vous pouvez nommer vous-même ses événements, voir [Vos propres événements](#vos-propres-événements).

Les traps SNMP standard sont lus comme les mêmes événements : `linkDown` et `linkUp` deviennent **Interface hors service** et **Interface en service**, `coldStart` et `warmStart` deviennent **Appareil redémarré**.

## Les événements

Chaque message que OneUptime reconnaît est enregistré avec l'un de ces noms dans `event.name`, quel que soit le fabricant de l'appareil :

| Événement | `event.name` | Type | Porte sur |
| --- | --- | --- | --- |
| Interface hors service | `interface.down` | Problème | `network.interface.name` |
| Interface en service | `interface.up` | Rétablissement | `network.interface.name` |
| Port désactivé par le commutateur | `interface.error_disabled` | Problème | `network.interface.name` |
| Appareil redémarré | `device.reboot` | Problème | - |
| Configuration modifiée | `device.config_change` | Informatifs | `user.name` |
| Appareil hors ligne | `device.offline` | Problème | - |
| Appareil en ligne | `device.online` | Rétablissement | - |
| Basculement | `ha.failover` | Problème | `ha.role` |
| État de haute disponibilité modifié | `ha.state_change` | Informatifs | `ha.role` |
| Pair de haute disponibilité hors service | `ha.peer_down` | Problème | `ha.peer` |
| Pair de haute disponibilité en service | `ha.peer_up` | Rétablissement | `ha.peer` |
| Tunnel VPN hors service | `vpn.tunnel_down` | Problème | `vpn.tunnel.name` |
| Tunnel VPN en service | `vpn.tunnel_up` | Rétablissement | `vpn.tunnel.name` |
| Voisin de routage hors service | `routing.neighbor_down` | Problème | `network.peer.address` |
| Voisin de routage en service | `routing.neighbor_up` | Rétablissement | `network.peer.address` |
| Passerelle hors service | `gateway.down` | Problème | `network.gateway.name` |
| Passerelle en service | `gateway.up` | Rétablissement | `network.gateway.name` |
| Basculement WAN | `wan.failover` | Problème | `network.gateway.name` |
| Lien SD-WAN en dessous de son SLA | `sdwan.sla_not_met` | Problème | `network.gateway.name` |
| Lien SD-WAN de nouveau conforme à son SLA | `sdwan.sla_met` | Rétablissement | `network.gateway.name` |
| Ventilateur en panne | `hardware.fan_failed` | Problème | `hw.name` |
| Ventilateur de nouveau fonctionnel | `hardware.fan_ok` | Rétablissement | `hw.name` |
| Alimentation en panne | `hardware.power_supply_failed` | Problème | `hw.name` |
| Alimentation de nouveau fonctionnelle | `hardware.power_supply_ok` | Rétablissement | `hw.name` |
| Température trop élevée | `hardware.temperature_high` | Problème | - |
| Boucle détectée | `loop.detected` | Problème | `network.interface.name` |
| Changement de topologie Spanning Tree | `stp.topology_change` | Informatifs | - |
| Défaut PoE | `poe.fault` | Problème | `network.interface.name` |
| Échec de connexion | `auth.login_failed` | Problème | `user.name` |
| Connexion réussie | `auth.login_success` | Informatifs | `user.name` |
| Client Wi-Fi connecté | `wireless.client_connected` | Informatifs | `client.mac` |
| Client Wi-Fi déconnecté | `wireless.client_disconnected` | Informatifs | `client.mac` |

La dernière colonne est l'attribut qui dit sur quoi porte l'événement. Tous les produits ne signalent pas tous les événements : un commutateur n'a pas de tunnels VPN, et le syslog d'un produit n'en dit pas plus qu'il n'en dit.

Chaque événement porte aussi :

| Attribut | Ce qu'il contient |
| --- | --- |
| `event.domain` | `network`, sur chaque événement réseau |
| `event.kind` | `problem`, `recovery` ou `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` ou `wireless`, sur les événements ci-dessus |
| `event.device` | Quel appareil : son nom dans OneUptime, sinon le nom qu'il se donne, sinon son adresse |
| `event.message` | Ce que l'appareil a dit, dans ses propres mots |
| `syslog.vendor`, `syslog.parser` | Le format dans lequel le message a été lu |

## Comment les événements arrivent ici

Chaque sonde écoute le syslog sur le port 5140, en UDP et en TCP. En TCP, un message est une ligne, ou il est précédé de sa longueur, comme le décrit la RFC 6587. La sonde transmet à OneUptime ce qu'elle entend toutes les quelques secondes, et OneUptime associe chaque message à un appareil par l'adresse dont il provient :

1. un appareil que la sonde interroge et dont le nom d'hôte est cette adresse (ou se résout vers elle), ou qui la liste sous **Autres adresses** sur sa page **Paramètres** ;
2. sur votre propre sonde (personnalisée), tout appareil du projet ayant cette adresse, ou ayant le nom d'hôte que porte le message lorsqu'un seul appareil porte ce nom ;
3. sinon, sur votre propre sonde, le message est conservé pour la page Événements du réseau, sous **Envoie du syslog, pas encore un appareil**, jusqu'à ce que vous disiez à quel appareil il appartient. Une sonde globale le rejette.

Une ligne provenant d'une adresse inconnue, sans priorité syslog et qui n'est pas un événement, est tenue pour du bruit et rejetée.

Un contrôleur parle pour les appareils qu'il gère : une console UniFi rend compte de ses points d'accès et de ses commutateurs. Lorsqu'un message d'un appareil nomme un autre appareil par son adresse MAC, son numéro de série, son adresse ou le nom que lui donne son contrôleur, l'événement va à cet appareil, et le journal conserve le nom du contrôleur qui l'a transmis dans `syslog.relay.name`.

Un journal est enregistré à l'heure où la sonde l'a reçu. Un message qui a été retenu - son propre horodatage est au format RFC 5424, qui indique son fuseau horaire, et date de plus de 5 minutes - garde l'heure de l'appareil, jusqu'à 7 jours en arrière. Tout autre horodatage qui s'écarte de plus de 5 minutes de l'horloge de la sonde n'est pas cru : le journal est enregistré à l'heure où il a été reçu, et l'heure de l'appareil est conservée dans `syslog.deviceTime`.

Le syslog que vous envoyez à [l'endpoint syslog](/docs/telemetry/syslog) en HTTPS est lu par les mêmes analyseurs. Là, un message devient un événement réseau lorsqu'il est dans le format propre d'un fabricant réseau, ou lorsqu'il nomme l'un de vos appareils réseau par son adresse MAC, son numéro de série, son adresse ou son nom d'hôte ; les lignes `sshd` d'un serveur restent de simples journaux.

## Mise en place

1. **Utilisez une sonde sur le réseau de l'appareil.** Le syslog est envoyé par vos appareils, il leur faut donc une [sonde personnalisée](/docs/probe/custom-probe) qu'ils peuvent atteindre. Une sonde globale sur l'internet public ne le recevra pas.
2. **Laissez le syslog atteindre la sonde.** Autorisez le port 5140, en UDP ou en TCP, depuis les appareils vers la sonde. Une sonde dans Docker démarrée avec le réseau de l'hôte (`--network host`), comme le montre la page de la sonde personnalisée, le reçoit telle quelle ; sans le réseau de l'hôte, publiez le port avec `-p 5140:5140/udp -p 5140:5140/tcp`. Pour un appareil qui ne peut envoyer que vers le port 514, publiez-le avec `-p 514:5140/udp`, ou définissez `PROBE_SYSLOG_RECEIVER_PORT=514` sur une sonde utilisant le réseau de l'hôte.
3. **Définissez la sonde comme serveur syslog de l'appareil.** Les commandes pour les appareils courants sont ci-dessous. La page **Événements** montre les mêmes étapes jusqu'à l'arrivée du premier message, puis devient d'elle-même la liste.
4. **Vérifiez l'adresse de l'appareil.** Les messages sont associés par l'adresse depuis laquelle l'appareil envoie. S'il envoie depuis une loopback ou une interface de gestion qui n'est pas son nom d'hôte, ajoutez cette adresse à l'appareil sous **Autres adresses**.

Le récepteur syslog est activé par défaut. Ses réglages sont des variables d'environnement de la sonde :

| Variable | Ce qu'elle fait | Par défaut |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Mettez `false` pour désactiver le récepteur syslog | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | Le port, pour UDP et TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Messages transmis par minute, tous appareils confondus | `600` |

Au-delà de la limite, la sonde transmet encore les messages qu'elle lit comme des événements réseau, jusqu'à autant de nouveau, pour qu'un flot de lignes de routine n'évince pas celle qui dit qu'un lien est tombé. Une sonde plus ancienne que cette fonctionnalité n'écoute que si elle est démarrée avec `PROBE_SYSLOG_RECEIVER_ENABLED=true`, et uniquement en UDP : mettez-la à jour.

### Cisco IOS, IOS XE et NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

La deuxième ligne envoie les messages d'information et tout ce qui est plus grave : les changements de lien, les redémarrages et les connexions en font partie. Sur NX-OS, la ligne est `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Dans l'administration web du pare-feu, ouvrez **System services** > **Log settings** et, sous **Syslog servers**, choisissez **Add**.
2. Saisissez l'adresse IP de la sonde et le port `5140`, et réglez le niveau de gravité sur **Information**. Les deux formats de journaux proposés par le pare-feu sont lus.
3. De retour dans **Log settings**, cochez le nouveau serveur pour les journaux à envoyer : au moins les événements système, et **SD-WAN** pour les changements de SLA. Les journaux de trafic du pare-feu sont nombreux, laissez-les donc de côté sauf si vous en avez besoin.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate envoie ce que ses paramètres de journalisation sélectionnent. Les journaux d'événements contiennent les tunnels, les liens et les basculements ; les journaux de trafic sont nombreux, laissez-les donc de côté sauf si vous en avez besoin.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Remplacez `VR-Default` par le routeur virtuel par lequel la sonde est joignable.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

Sur AOS-CX, ajoutez `vrf mgmt` à la ligne lorsque la sonde est joignable par le port de gestion. Sur AOS-Switch, la ligne est `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

La première ligne pointe l'action distante intégrée du routeur vers la sonde ; les autres choisissent ce qu'il envoie. Laissez le format de journal distant tel quel.

### Ubiquiti UniFi

1. Dans UniFi Network, ouvrez **Integration** > **System Logging / SIEM** et sélectionnez **SIEM Server** comme destination.
2. Saisissez l'adresse IP de la sonde et le port `5140`, puis choisissez les catégories de journaux à exporter.

La console rend compte des points d'accès et des commutateurs qu'elle gère. Les événements arrivent sur la page de chaque appareil lorsque l'appareil est dans OneUptime avec son adresse MAC, et sur celle de la console sinon.

### Cambium Networks

1. Dans cnMaestro ou dans l'interface web du point d'accès, ouvrez les paramètres système et trouvez les serveurs syslog.
2. Saisissez l'adresse IP de la sonde comme serveur syslog, avec le port `5140` là où le formulaire demande un port, et réglez la gravité syslog sur **Info**.

Là où il n'y a pas de port à régler, le point d'accès envoie vers le port 514 : publiez-y le port de la sonde, comme le montre l'étape 2 de [Mise en place](#mise-en-place).

### Autres appareils

Ajoutez un serveur syslog distant sur l'appareil : l'adresse IP de la sonde, port 5140, en UDP ou en TCP, en envoyant les messages d'information et tout ce qui est plus grave. Les messages d'un appareil dont OneUptime ne connaît pas le format sont tout de même enregistrés, et vous pouvez nommer vous-même ses événements.

## Alertes

**Créer une alerte**, sur une page Événements, liste les alertes que veulent la plupart des réseaux. Chacune ouvre **Créer un moniteur** déjà rempli, où vous pouvez tout modifier avant d'enregistrer :

| Alerte | Vous prévient quand | Une alerte par | Se ferme quand |
| --- | --- | --- | --- |
| Un tunnel VPN tombe | `vpn.tunnel_down` | appareil et tunnel | `vpn.tunnel_up` pour ce tunnel |
| Un pare-feu ou un commutateur bascule | `ha.failover` | appareil | 5 minutes passent sans un autre |
| Un lien WAN tombe | `gateway.down` | appareil et passerelle | `gateway.up` pour cette passerelle |
| Un voisin de routage tombe | `routing.neighbor_down` | appareil et voisin | `routing.neighbor_up` pour ce voisin |
| Un appareil redémarre | `device.reboot` | appareil | 5 minutes passent sans un autre |
| Le matériel tombe en panne | un ventilateur, une alimentation ou la température | appareil et composant | le même composant est signalé de nouveau fonctionnel |
| Une interface tombe | `interface.down` | appareil et interface | `interface.up` pour cette interface |
| Quelqu'un échoue sans cesse à se connecter | plus de 10 `auth.login_failed` en 5 minutes | appareil | 5 minutes passent avec 10 ou moins |

Chacune est un [moniteur de journaux](/docs/monitor/logs-monitor) qui compte l'événement sur les 5 dernières minutes, avec **Group by Attributes** réglé pour que chaque tunnel, passerelle ou interface ait sa propre alerte, et avec **Résolu par attributs** réglé sur l'événement qui dit que le problème est terminé. Une telle alerte reste ouverte jusqu'à ce que cet événement arrive pour le même appareil et le même tunnel, aussi longtemps que cela prenne ; voir [Résolu par un journal](/docs/monitor/logs-monitor#résolu-par-un-journal). OneUptime ne lit aucun événement disant qu'une température est revenue à la normale : une alerte de température reste donc ouverte jusqu'à ce que vous la résolviez.

Depuis l'onglet **Événements** d'un appareil, les moniteurs ne surveillent que cet appareil. Pour tout autre événement, ouvrez-en un sur la page Événements et cliquez sur **Créer une alerte pour cet événement**. Pour envoyer une alerte quelque part, ou pour prévenir quelqu'un d'astreinte, ajoutez au moniteur une politique d'astreinte ou un workflow, comme pour tout autre moniteur.

## Adresses qui ne sont pas encore des appareils

Du syslog peut arriver avant que l'appareil qui l'envoie ne soit ajouté à OneUptime. Sur votre propre sonde, il est conservé, ses événements sont sur la page Événements du réseau avec le nom que l'appareil se donne, et son adresse est listée sous **Envoie du syslog, pas encore un appareil** :

- **Ajouter comme appareil** ouvre **Ajouter l'équipement** avec l'adresse et la sonde déjà renseignées. Les messages déjà arrivés restent sur la page du réseau ; les nouveaux vont à l'appareil.
- **C'est l'un de mes appareils** ajoute l'adresse à un appareil sous **Autres adresses** : utilisez-le lorsqu'un appareil déjà ajouté envoie depuis une autre adresse, comme une loopback. Ses messages vont à cet appareil à partir de la minute suivante.

Plusieurs appareils derrière une même adresse NAT partagent cette adresse : leurs messages vont donc au seul appareil qui la porte, sauf si un message nomme son propre appareil.

## Vos propres événements

Un appareil dont OneUptime ne connaît pas le format, ou un événement qu'il ne lit pas, demande un [pipeline de journaux](/docs/telemetry/log-pipelines) :

1. Créez un pipeline dont le filtre correspond aux journaux de l'appareil, comme `attributes.networkDevice.name = 'rack-ups'`.
2. Ajoutez un **Parseur Grok** ou un **Key=Value Parser** pour extraire du message les champs dont vous avez besoin.
3. Ajoutez un **Processeur de catégories** avec **Attribut cible** `event.name`, et une règle par événement. Nommez chacune comme les événements ci-dessus, en minuscules avec des points ou des tirets bas : `ups.on_battery`.

Un journal d'un appareil réseau qui porte un tel nom devient un événement réseau : il est sur les pages Événements, et **Créer une alerte pour cet événement** fonctionne dessus. Pour dire sur quoi il porte, ajoutez un **Remappeur d'attributs** qui copie votre champ vers l'un des attributs du tableau des événements, comme `hw.name`. Tant que votre pipeline ne met pas `event.kind` à `problem` ou `recovery`, l'événement est listé sous **Informatifs**. Une règle portant le nom d'un événement intégré, comme `interface.down`, produit l'événement intégré, avec son type et ses alertes.

Un pipeline appartient à son projet. Pour en utiliser un dans un autre projet, créez-le là-bas avec les mêmes processeurs.

## Ce qui n'est pas inclus

- **Syslog sur TLS** (RFC 5425). La sonde accepte l'UDP et le TCP en clair ; gardez le chemin entre les appareils et la sonde sur un réseau de confiance.
- **Partage d'analyseurs entre projets.** Un pipeline ne peut pas encore être exporté puis importé.
- **Événements issus de traps SNMP autres que les quatre standard.** Les traps propres à un fabricant sont enregistrés comme journaux, et l'on crée des alertes dessus avec le critère **SNMP Trap Received (Trap OID)** du [moniteur d'appareil réseau](/docs/monitor/network-device-monitor).
- **Commutateurs Cambium cnMatrix, contrôleurs de mobilité Aruba et FortiGate en mode CEF.** Leurs messages sont enregistrés et consultables ; aucun événement n'en est encore tiré.
- **Un suivi en direct.** La page Événements montre ce qui était arrivé à son ouverture ; utilisez son bouton d'actualisation, ou le suivi en direct de **Journaux**.

## Dépannage

Si une page Événements affiche encore ses étapes de mise en place :

- **La sonde reçoit-elle quelque chose ?** La page Événements du réseau liste sous **Envoie du syslog, pas encore un appareil** chaque adresse qui a envoyé du syslog sur la période. Si l'appareil s'y trouve, il envoie depuis une adresse qui n'est pas son nom d'hôte : ajoutez-lui cette adresse sous **Autres adresses**.
- **Pare-feu et Docker.** Autorisez le port 5140 de l'appareil vers la sonde, et publiez le port si la sonde tourne dans Docker. Beaucoup d'appareils envoient vers le port 514 si on ne leur dit pas autre chose.
- **Le journal de la sonde.** Au démarrage, la sonde note dans son journal le port sur lequel elle écoute, ou qu'elle n'a pas pu l'ouvrir. Lorsqu'elle rejette des messages au-delà de `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, elle note combien, une fois par minute.
- **Une sonde globale.** Un appareil interrogé par une sonde globale ne peut pas lui envoyer de syslog depuis un réseau privé. Exécutez une sonde personnalisée sur le réseau de l'appareil et choisissez-la dans les paramètres de l'appareil.
- **Des messages arrivent, mais aucun événement.** La page le dit, et chaque message est dans l'onglet **Journaux** de l'appareil. Vérifiez que l'appareil envoie les messages d'information, pas seulement les erreurs, et que le produit est l'un de ceux de [Ce que lit OneUptime](#ce-que-lit-oneuptime) ; sinon, nommez ses événements dans un pipeline de journaux.
