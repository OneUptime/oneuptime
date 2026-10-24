# Trafic réseau (NetFlow, IPFIX et sFlow)

Les routeurs, pare-feu et commutateurs peuvent décrire le trafic qui les traverse sous forme d'**enregistrements de flux** : qui a parlé à qui, avec quel protocole et quels ports, par quelles interfaces, et combien d'octets. Dirigez cet export vers une sonde OneUptime et les pages **Trafic** montrent où va votre trafic : les adresses, conversations, applications et interfaces les plus actives, sur n'importe quelle plage de temps.

Une page Trafic existe à trois endroits :

- **Réseau** -> **Trafic** : tout le réseau, les flux de chaque appareil sur une seule page, et chaque adresse qui envoie des flux sans être encore un appareil.
- La page **Trafic** d'un site : les appareils de ce site.
- L'onglet **Trafic** d'un appareil : cet appareil seul, avec ses interfaces. Les captures de paquets lancées sur la sonde de l'appareil sont listées sous les flux, pour quand vous avez besoin des paquets eux-mêmes.

Un parc Cisco Meraki peut aussi être lu sans rien exporter : connectez le tableau de bord Meraki, et les pages Trafic montrent les uplinks, les applications et les clients de ses appliances tels que Meraki les rapporte. Voir [Cisco Meraki sans NetFlow](#cisco-meraki-sans-netflow).

## Ce que montre la page Trafic

- Quatre chiffres pour la plage : **Trafic** (octets), le débit **Moyenne** et **Pic**, et **Flux** (combien d'enregistrements de flux les appareils ont envoyés).
- **Trafic au fil du temps**, en bits par seconde. Faites glisser sur le graphique pour zoomer sur une portion ; double-cliquez dessus, ou utilisez **Réinitialiser le zoom**, pour revenir.
- **Principales sources** et **Principales destinations** : les dix adresses qui ont le plus envoyé et le plus reçu.
- **Principales applications** : le trafic par protocole et port de service, nommé d'après le service habituellement sur ce port (HTTPS est le port TCP 443).
- **Principales interfaces** sur la page d'un appareil : ce qui est entré et sorti par chaque interface, avec son nom et son débit issus du parcours SNMP de l'appareil. **Principaux appareils** sur la page d'un site et sur celle du réseau.
- **Principales conversations** : les dix paires d'adresses les plus actives, dessinées en diagramme des émetteurs vers les destinataires, ou en liste.

Cliquez sur une ligne - une adresse, une application, une interface, un appareil, une bande du diagramme - et toute la page se restreint à ce trafic. Une puce au-dessus de la page indique à quoi elle est restreinte ; cliquez sur son x pour l'élargir à nouveau. **Rechercher une adresse IP** restreint la page au trafic vers ou depuis une adresse. La plage de temps et les filtres sont conservés dans l'adresse de la page, donc un lien ouvre exactement la même vue.

## Comment les flux arrivent ici

Chaque sonde exécute un collecteur de flux. Il écoute sur trois ports UDP, et chaque port lit chaque format :

| Port     | Habituellement utilisé pour |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

La sonde décode les enregistrements, remultiplie les comptes échantillonnés par le taux d'échantillonnage, additionne les enregistrements d'une même conversation toutes les quelques secondes et les envoie à OneUptime. Chaque enregistrement est associé à un appareil par l'adresse depuis laquelle son appareil l'envoie - pour sFlow, l'adresse de l'agent dans le datagramme :

1. un appareil que la sonde interroge et dont le nom d'hôte est cette adresse (ou se résout en elle), ou qui la liste sous **Autres adresses** sur sa page **Paramètres** ;
2. sur votre propre sonde (personnalisée), n'importe quel appareil du projet ayant cette adresse comme nom d'hôte ou parmi ses autres adresses ;
3. sinon, sur votre propre sonde, les flux sont conservés pour la page Trafic du réseau, sous **Émetteurs de flux**, jusqu'à ce que vous indiquiez à quel appareil ils appartiennent. Une sonde globale les ignore.

Les flux sont conservés 30 jours, et une page affiche au plus 31 jours.

## Mise en place

1. **Utilisez une sonde sur le réseau de l'appareil.** Les flux sont des datagrammes UDP envoyés par vos appareils : ils ont besoin d'une [sonde personnalisée](/docs/probe/custom-probe) qu'ils peuvent atteindre. Une sonde globale sur l'internet public ne les recevra pas.
2. **Laissez les datagrammes atteindre la sonde.** Autorisez UDP 2055, 4739 et 6343 des appareils vers la sonde. Une sonde dans Docker lancée avec le réseau de l'hôte (`--network host`), comme le montre la page de la sonde personnalisée, les reçoit telle quelle ; sans le réseau de l'hôte, publiez les ports avec `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Activez l'export de flux sur l'appareil** et envoyez-le à l'adresse IP de la sonde. Les commandes pour les appareils courants sont ci-dessous. L'onglet **Trafic** de l'appareil montre les mêmes étapes avec les ports de la sonde jusqu'à l'arrivée du premier flux.
4. **Vérifiez l'adresse de l'appareil.** Les enregistrements sont associés par l'adresse depuis laquelle l'appareil envoie. S'il envoie depuis une loopback ou une interface de gestion qui n'est pas son nom d'hôte, ajoutez cette adresse aux **Autres adresses** de l'appareil.

Le collecteur est activé par défaut. Ses paramètres sont des variables d'environnement de la sonde :

| Variable                            | Ce qu'elle fait                                                     | Défaut  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Mettre à `false` pour désactiver le collecteur de flux              | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | Le port NetFlow ; `0` arrête l'écoute sur ce port                   | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | Le port IPFIX ; `0` arrête l'écoute sur ce port                     | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | Le port sFlow ; `0` arrête l'écoute sur ce port                     | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Datagrammes acceptés par minute, tous appareils et ports confondus  | 6000    |

Ces 6 000 datagrammes par minute sont partagés par tous les appareils qui exportent vers la sonde. Avec des centaines d'appareils, augmentez `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` ou répartissez les appareils sur plusieurs sondes : les datagrammes au-delà de la limite sont rejetés, et le journal de la sonde dit combien (voir [Dépannage](#dépannage)). Un parc Meraki n'a besoin d'aucun export : voir [Cisco Meraki sans NetFlow](#cisco-meraki-sans-netflow).

### Cisco IOS XE (Flexible NetFlow)

Exporte IPFIX vers UDP 4739. Ajoutez la dernière ligne à chaque interface dont vous voulez voir le trafic : mesurer le trafic à son entrée sur chaque interface compte chaque conversation une seule fois.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exporte NetFlow v9 vers UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exporte sFlow vers UDP 6343. sFlow échantillonne un paquet sur N (16384 ici), et les pages Trafic remultiplient les échantillons : les chiffres sont donc des estimations.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX et Z

Les appliances MX et les passerelles de télétravail de la série Z exportent NetFlow v9 depuis le tableau de bord Meraki :

1. Ouvrez **Network-wide** > **General** et trouvez **Reporting**.
2. Réglez **NetFlow traffic reporting** sur **Enabled: send NetFlow traffic statistics**.
3. Saisissez l'adresse IP de la sonde comme **NetFlow collector IP** et `2055` comme **NetFlow collector port**, puis enregistrez.

Un MX ou un Z ne voit que le trafic qui le traverse. Le trafic qu'un commutateur garde au sein d'un VLAN ne l'atteint jamais : il n'est donc pas dans l'export.

Pour lire chaque site sans configurer chaque MX, connectez plutôt le tableau de bord Meraki : voir [Cisco Meraki sans NetFlow](#cisco-meraki-sans-netflow). Son trafic n'a pas de conversations, les deux se complètent donc bien.

### Juniper (J-Flow en ligne)

Exporte IPFIX vers UDP 4739 depuis les routeurs MX ; utilisez le FPC qui porte les interfaces que vous échantillonnez.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exporte NetFlow v9 vers UDP 2055. Sur FortiOS 7.2 et versions ultérieures, le collecteur est une entrée sous `config collectors` dans `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Sous **Device** > **Server Profiles** > **NetFlow**, ajoutez un profil avec l'adresse IP de la sonde et le port `2055`, et réglez l'**Active Timeout** sur 1 minute.
2. Sous **Network** > **Interfaces**, ouvrez chaque interface dont vous voulez voir le trafic et choisissez le profil comme **NetFlow Profile** dans l'onglet **Advanced**.
3. Validez (commit).

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense et hôtes Linux

Sur pfSense, installez le paquet **softflowd** puis, sous **Services** > **softflowd**, choisissez les interfaces, saisissez l'adresse IP de la sonde et le port `2055`, et choisissez NetFlow version 9. Sur un hôte Linux, lancez softflowd sur l'interface dont vous voulez voir le trafic :

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Autres appareils

Envoyez NetFlow v5, NetFlow v9 ou IPFIX à l'adresse IP de la sonde sur UDP 2055 (ou 4739), ou sFlow v5 sur UDP 6343. Réglez le délai actif des flux de l'appareil sur 60 secondes et, pour NetFlow v9 et IPFIX, envoyez ses modèles toutes les 60 secondes. Les [guides des fabricants réseau](/docs/monitor/network-vendor-guides) couvrent Sophos et Extreme Networks.

## Cisco Meraki sans NetFlow

Un parc Meraki a une deuxième entrée, sans rien à configurer sur les appareils et sans sonde sur le chemin : OneUptime lit le trafic de l'organisation depuis l'API du tableau de bord Meraki. Elle convient aux centaines ou milliers de sites, où configurer NetFlow sur chaque MX est le plus difficile.

Dans **Réseau** -> **Trafic**, choisissez **Connecter Meraki** :

1. **Clé API.** Créez-en une dans le tableau de bord Meraki sous **Organization** > **API & Webhooks** > **API keys and access**. La clé d'un administrateur en lecture seule suffit. OneUptime la stocke chiffrée, ne l'affiche plus jamais et ne l'envoie qu'à l'API du tableau de bord Meraki de la région de la clé. Si vous vous connectez à Meraki ailleurs que sur dashboard.meraki.com, choisissez la **Région du tableau de bord** sous **Plus de champs** : le tableau de bord du Canada, de la Chine, de l'Inde ou le tableau de bord FedRAMP des États-Unis.
2. **Organisation.** La clé est testée à l'ouverture de l'étape : les organisations qu'elle peut lire sont listées et, pour celle que vous choisissez, la boîte de dialogue compte les réseaux et les appliances MX et Z qu'une lecture couvrira, avant que rien ne soit enregistré.

La première lecture commence dans la minute et rapporte la dernière journée. Ensuite, les pages Trafic ont un sélecteur **Flux** | **Meraki** dans leur en-tête : une page avec des enregistrements de flux s'ouvre sur eux, comme avant, et une page avec seulement du trafic Meraki s'ouvre sur Meraki.

| Sur la page | Ce que Meraki rapporte | À quelle fréquence c'est lu |
| --- | --- | --- |
| Les quatre chiffres, le graphique, **Principaux réseaux** et **Uplinks** | L'utilisation des uplinks de chaque appliance MX et Z (wan1, wan2, cellular), pour toute l'organisation en un seul appel | Toutes les 5 minutes par défaut, jusqu'à toutes les heures, par fenêtres de cinq minutes |
| **Principales applications** et **Principales destinations** | Les analyses de trafic de chaque réseau | Toutes les deux heures : Meraki les additionne sur deux heures ou plus |
| **Principaux clients** | Les clients de chaque réseau et ce qu'ils ont utilisé | Toutes les deux heures, avec les applications |

Un clic sur un réseau restreint la page à ce réseau et liste ses uplinks. Le trafic d'une appliance appartient à son appareil dans OneUptime lorsqu'un appareil a le numéro de série ou l'adresse MAC de l'appliance : il apparaît alors aussi sur les pages Trafic de cet appareil et de son site. Le trafic d'une appliance qui n'est pas un appareil dans OneUptime apparaît sur la page du réseau.

Meraki accorde à chaque organisation 10 requêtes API par seconde, partagées par toutes les applications qui la lisent. OneUptime en utilise au plus 3, ralentit quand Meraki le lui demande et arrête une lecture après 900 requêtes ou 6 minutes ; la lecture suivante reprend une minute plus tard. Une organisation de 1 200 réseaux voit ses uplinks lus en un appel par fenêtre, et les applications et clients de ses réseaux sur quelques lectures.

Les connexions sont listées au bas de la page Trafic du réseau, sous **Meraki**, chacune avec son état et ce que sa dernière lecture a couvert. **Lire maintenant** en lit une immédiatement, et son menu propose **Modifier** (son nom, la fréquence de lecture des uplinks, une nouvelle clé), **Désactiver** et **Supprimer**. Une lecture qui échoue dit pourquoi, là et au-dessus du trafic : une clé refusée, une clé qui ne peut pas lire l'organisation, Meraki qui demande à OneUptime de ralentir, ou des réseaux dont l'analyse de trafic est désactivée.

L'API du tableau de bord Meraki rapporte des totaux, jamais qui a parlé à qui : le côté Meraki n'a donc pas de conversations. Pour les voir, envoyez aussi NetFlow depuis les appliances MX ([Cisco Meraki MX et Z](#cisco-meraki-mx-et-z)) : la page a alors les deux, à un sélecteur d'écart.

## Les adresses qui ne sont pas encore des appareils

Des flux peuvent arriver avant que l'appareil qui les envoie soit ajouté à OneUptime. Sur votre propre sonde, ils sont conservés, et la page Trafic du réseau liste leur adresse sous **Émetteurs de flux**, marquée **Pas encore un appareil** :

- **Ajouter comme appareil** ouvre l'ajout d'appareil avec l'adresse et la sonde déjà remplies. Les flux déjà arrivés restent sur la page du réseau ; les nouveaux vont à l'appareil.
- **C'est l'un de mes appareils** ajoute l'adresse aux **Autres adresses** d'un appareil : utilisez-le quand un appareil déjà ajouté envoie depuis une autre adresse, comme une loopback. Ses flux vont à cet appareil à partir de la minute suivante.

Plusieurs appareils derrière une même adresse NAT partagent cette adresse : leurs flux vont donc au seul appareil qui l'a.

## Lire les chiffres

- **Échantillonnage.** Un appareil qui échantillonne - sFlow le fait toujours, NetFlow ou IPFIX peuvent le faire - rapporte un paquet sur N. La sonde multiplie les comptes par N : la page affiche donc des estimations, et le dit sous les quatre chiffres. Elles sont précises pour un trafic important et approximatives pour quelques paquets.
- **Compté deux fois.** Le trafic qui traverse deux appareils exportateurs est rapporté par les deux. La page d'un appareil le compte une fois ; la page d'un site ou du réseau le compte une fois par appareil qui l'a rapporté.
- **Applications.** Une application est le protocole et le port de service, nommée d'après le service habituellement sur ce port. Ce n'est pas une inspection approfondie des paquets : HTTPS sur le port 9443 apparaît comme le port TCP 9443. Le port éphémère du client est ignoré : mille connexions de navigateur vers un serveur forment donc une seule application.
- **Pic** est le débit de la tranche la plus active du graphique : une plage plus courte, aux tranches plus courtes, montre donc un pic plus net. **Moyenne** correspond aux octets sur toute la plage.
- **Temps.** Un flux compte dans la tranche où il a commencé. Un long téléchargement est rapporté en plusieurs flux, un pour chaque minute de sa durée : c'est pourquoi le délai actif des appareils devrait être de 60 secondes.

## Ce qui n'est pas inclus

- **Alertes sur les flux.** Il n'existe pas encore de moniteur basé sur les flux. Pour alerter sur un lien chargé, utilisez les alertes d'utilisation d'interface du [moniteur d'équipement réseau](/docs/monitor/network-device-monitor), qui lisent SNMP.
- **Noms d'applications au-delà du port.** Il n'y a pas d'inspection approfondie des paquets, et les noms d'applications Cisco NBAR ne sont pas lus.
- **Les conversations depuis l'API du tableau de bord Meraki.** Elle rapporte des totaux, pas qui a parlé à qui : envoyez aussi NetFlow depuis les appliances MX pour voir les conversations.
- **Détection d'anomalies** sur le trafic.
- **Noms d'interfaces issus des enregistrements de flux.** Les noms et débits des interfaces viennent du parcours SNMP de l'appareil ; un appareil non parcouru affiche des numéros d'interface.

## Dépannage

Si la page Trafic affiche encore ses étapes de mise en place :

- **La sonde reçoit-elle quelque chose ?** La page Trafic du réseau liste sous **Émetteurs de flux** chaque adresse ayant envoyé des flux au cours de la dernière heure. Si l'appareil y figure comme **Pas encore un appareil**, il envoie depuis une adresse qui n'est pas son nom d'hôte : ajoutez cette adresse à ses **Autres adresses**.
- **Pare-feu et Docker.** Autorisez UDP 2055, 4739 et 6343 de l'appareil vers la sonde, et publiez les ports si la sonde tourne dans Docker.
- **Le journal de la sonde.** Une fois par minute, la sonde journalise ce qu'elle n'a pas pu lire : les datagrammes dans un format non pris en charge (NetFlow v1, v6, v7 ou v8, ou sFlow antérieur à la version 5), les datagrammes malformés, les données en attente d'un modèle, et les datagrammes rejetés au-delà de `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Modèles.** NetFlow v9 et IPFIX envoient la structure de leurs enregistrements sous forme de modèles. La sonde garde jusqu'à 10 minutes les données qui arrivent avant leur modèle ; réglez l'appareil pour qu'il envoie ses modèles toutes les 60 secondes afin que la page se remplisse en moins d'une minute.
- **Une sonde globale.** Un appareil interrogé par une sonde globale ne peut pas lui envoyer de flux depuis un réseau privé. Exécutez une sonde personnalisée sur le réseau de l'appareil et choisissez-la dans les paramètres de l'appareil.

Si une connexion Meraki indique qu'elle ne peut pas lire :

- **La clé est refusée.** Copiez-la de nouveau depuis le tableau de bord Meraki et vérifiez la **Région du tableau de bord** : une clé ne lit que le tableau de bord où elle a été créée.
- **La clé ne peut pas lire l'organisation.** Activez l'accès API de l'organisation sous **Organization** > **API & Webhooks**, ou utilisez la clé de l'un de ses administrateurs.
- **Pas d'applications sur certains réseaux.** Leur analyse de trafic est désactivée : activez-la sous **Network-wide** > **General** > **Traffic analysis**.
- **Meraki a demandé à OneUptime de ralentir.** D'autres applications utilisent le budget API de l'organisation. OneUptime lit plus lentement et poursuit.
- **Ce OneUptime ne joint pas l'API.** Autorisez HTTPS (port 443) depuis les serveurs de OneUptime vers `api.meraki.com`, ou l'hôte API de votre région.
