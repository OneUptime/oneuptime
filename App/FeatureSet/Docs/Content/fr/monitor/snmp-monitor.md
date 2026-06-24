# Moniteur SNMP

La surveillance SNMP (Simple Network Management Protocol) vous permet de surveiller les périphériques réseau tels que les commutateurs, les routeurs, les pare-feux et autres infrastructures réseau en interrogeant les OID (identificateurs d'objets) SNMP.

## Vue d'ensemble

Les moniteurs SNMP interrogent les périphériques réseau pour des informations de gestion spécifiques à l'aide d'OID. Cela vous permet de :

- Surveiller la disponibilité et la santé des périphériques
- Suivre les statistiques des interfaces (trafic, erreurs, statut)
- Surveiller les métriques système (CPU, mémoire, temps de fonctionnement)
- Vérifier des OID personnalisés spécifiques aux fournisseurs
- Définir des alertes basées sur les valeurs des OID

## Création d'un moniteur SNMP

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **SNMP** comme type de moniteur
4. Configurez les paramètres SNMP comme décrit ci-dessous

## Options de configuration

### Paramètres de base

| Champ         | Description                                        | Obligatoire |
| ------------- | -------------------------------------------------- | ----------- |
| Version SNMP  | Version du protocole : v1, v2c ou v3               | Oui         |
| Nom d'hôte/IP | Le nom d'hôte ou l'adresse IP du périphérique SNMP | Oui         |
| Port          | Port SNMP (par défaut : 161)                       | Oui         |

### Authentification

#### SNMP v1/v2c

Pour SNMP v1 et v2c, vous n'avez besoin que de fournir une chaîne de communauté :

| Champ                | Description                                     | Obligatoire |
| -------------------- | ----------------------------------------------- | ----------- |
| Chaîne de communauté | La chaîne de communauté SNMP (ex. : « public ») | Oui         |

#### SNMP v3

SNMPv3 offre une sécurité renforcée avec authentification et chiffrement :

| Champ                        | Description                                 | Obligatoire               |
| ---------------------------- | ------------------------------------------- | ------------------------- |
| Niveau de sécurité           | noAuthNoPriv, authNoPriv ou authPriv        | Oui                       |
| Nom d'utilisateur            | Nom d'utilisateur SNMPv3                    | Oui                       |
| Protocole d'authentification | MD5, SHA, SHA256 ou SHA512                  | Si authNoPriv ou authPriv |
| Clé d'authentification       | Mot de passe d'authentification             | Si authNoPriv ou authPriv |
| Protocole de confidentialité | DES, AES ou AES256                          | Si authPriv               |
| Clé de confidentialité       | Mot de passe de confidentialité/chiffrement | Si authPriv               |

### OID à surveiller

Ajoutez les OID que vous souhaitez interroger depuis le périphérique. Pour chaque OID, vous pouvez spécifier :

| Champ       | Description                                  | Obligatoire |
| ----------- | -------------------------------------------- | ----------- |
| OID         | L'OID numérique (ex. : 1.3.6.1.2.1.1.1.0)    | Oui         |
| Nom         | Un nom convivial pour l'OID (ex. : sysDescr) | Non         |
| Description | Une description de ce que représente cet OID | Non         |

### Modèles OID courants

OneUptime fournit des modèles pour les OID couramment surveillés :

#### MIB système

| OID               | Nom         | Description                                   |
| ----------------- | ----------- | --------------------------------------------- |
| 1.3.6.1.2.1.1.1.0 | sysDescr    | Description du système                        |
| 1.3.6.1.2.1.1.3.0 | sysUpTime   | Temps de fonctionnement du système (en ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName     | Nom du système                                |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Emplacement du système                        |
| 1.3.6.1.2.1.1.4.0 | sysContact  | Contact du système                            |

#### MIB d'interface

| OID                    | Nom          | Description                                                |
| ---------------------- | ------------ | ---------------------------------------------------------- |
| 1.3.6.1.2.1.2.1.0      | ifNumber     | Nombre d'interfaces réseau                                 |
| 1.3.6.1.2.1.2.2.1.8.X  | ifOperStatus | Statut opérationnel de l'interface (X = index d'interface) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets   | Octets entrants (X = index d'interface)                    |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets  | Octets sortants (X = index d'interface)                    |

#### MIB de ressources hôte

| OID                      | Nom               | Description                              |
| ------------------------ | ----------------- | ---------------------------------------- |
| 1.3.6.1.2.1.25.1.1.0     | hrSystemUptime    | Temps de fonctionnement du système hôte  |
| 1.3.6.1.2.1.25.1.5.0     | hrSystemNumUsers  | Nombre d'utilisateurs                    |
| 1.3.6.1.2.1.25.1.6.0     | hrSystemProcesses | Nombre de processus en cours d'exécution |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad   | Charge CPU (X = index du processeur)     |

### Paramètres avancés

| Champ           | Description                         | Par défaut |
| --------------- | ----------------------------------- | ---------- |
| Délai d'attente | Durée d'attente d'une réponse (ms)  | 5000       |
| Tentatives      | Nombre de tentatives en cas d'échec | 3          |

## Critères de surveillance

Vous pouvez configurer des critères pour vérifier les réponses SNMP et déclencher des alertes ou des incidents.

### Types de vérifications disponibles

| Type de vérification       | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| Périphérique SNMP en ligne | Vérifier si le périphérique répond aux requêtes SNMP        |
| Temps de réponse SNMP      | Vérifier le temps de réponse de la requête en millisecondes |
| Valeur OID SNMP            | Vérifier la valeur retournée par un OID spécifique          |
| OID SNMP existant          | Vérifier si un OID retourne une valeur (non nulle)          |

### Exemples de critères

#### Vérifier si le périphérique est en ligne

- **Vérifier sur** : Périphérique SNMP en ligne
- **Type de filtre** : Vrai

#### Alerter si le temps de réponse dépasse le seuil

- **Vérifier sur** : Temps de réponse SNMP (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 1000

#### Vérifier le statut de l'interface

- **Vérifier sur** : Valeur OID SNMP
- **OID** : 1.3.6.1.2.1.2.2.1.8.1
- **Type de filtre** : Égal à
- **Valeur** : 1 (1 = actif, 2 = inactif)

#### Vérifier le seuil de charge CPU

- **Vérifier sur** : Valeur OID SNMP
- **OID** : 1.3.6.1.2.1.25.3.3.1.2.1
- **Type de filtre** : Supérieur à
- **Valeur** : 80

## Utilisation des secrets de moniteur

Pour des raisons de sécurité, vous pouvez stocker des informations sensibles comme les chaînes de communauté et les identifiants SNMPv3 sous forme de secrets.

### Ajouter un secret

1. Allez dans **Paramètres du projet** -> **Secrets de moniteur** -> **Créer un secret de moniteur**
2. Ajoutez votre secret (ex. : chaîne de communauté ou mot de passe SNMPv3)
3. Sélectionnez les moniteurs SNMP qui doivent avoir accès à ce secret

### Utiliser des secrets dans la configuration SNMP

Utilisez la syntaxe `{{monitorSecrets.NOM_DU_SECRET}}` dans tout champ sensible :

- **Chaîne de communauté** : `{{monitorSecrets.SnmpCommunity}}`
- **Clé d'authentification SNMPv3** : `{{monitorSecrets.SnmpAuthKey}}`
- **Clé de confidentialité SNMPv3** : `{{monitorSecrets.SnmpPrivKey}}`

## Variables de modèle pour les alertes

Lors de la création de modèles d'incidents ou d'alertes, vous pouvez utiliser les variables suivantes :

| Variable               | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `{{isOnline}}`         | Si le périphérique est en ligne (true/false)               |
| `{{responseTimeInMs}}` | Temps de réponse de la requête en millisecondes            |
| `{{failureCause}}`     | Message d'erreur si la requête a échoué                    |
| `{{oidResponses}}`     | Tableau d'objets de réponse OID                            |
| `{{OID_NAME}}`         | Valeur d'un OID spécifique par nom (ex. : `{{sysUpTime}}`) |

## Dépannage

### Problèmes courants

#### Périphérique ne répondant pas

- Vérifiez que l'IP/nom d'hôte du périphérique est correct
- Vérifiez que SNMP est activé sur le périphérique
- Vérifiez que les règles de pare-feu autorisent le port UDP 161
- Confirmez que la chaîne de communauté est correcte

#### Échecs d'authentification (v3)

- Vérifiez le nom d'utilisateur, le protocole d'authentification et la clé d'authentification
- Assurez-vous que le niveau de sécurité correspond à la configuration du périphérique
- Vérifiez que le protocole de confidentialité et la clé sont corrects pour le niveau authPriv

#### OID introuvable

- Vérifiez que l'OID est pris en charge par votre périphérique
- Vérifiez si l'OID nécessite le chargement d'un MIB spécifique
- Essayez d'interroger l'OID directement avec les outils snmpget/snmpwalk

### Test de la connectivité SNMP

Avant de configurer la surveillance, vous pouvez tester la connectivité SNMP avec des outils en ligne de commande :

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Meilleures pratiques

1. **Utiliser SNMPv3 si possible** — Il fournit une authentification et un chiffrement pour une meilleure sécurité
2. **Stocker les identifiants comme secrets** — Ne jamais coder en dur les chaînes de communauté ou les mots de passe
3. **Surveiller uniquement les OID essentiels** — N'interrogez que ce dont vous avez besoin pour réduire la surcharge réseau
4. **Définir des délais d'attente appropriés** — Les périphériques réseau peuvent avoir des temps de réponse variables
5. **Utiliser des noms OID descriptifs** — Facilite la compréhension des messages d'alerte
6. **Tester avant de déployer** — Vérifiez la connectivité SNMP avant de créer des moniteurs
