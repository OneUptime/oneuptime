# Moniteur DNS

La surveillance DNS vous permet de surveiller la santé et l'exactitude de la résolution DNS pour vos domaines. OneUptime interroge périodiquement les enregistrements DNS et valide les réponses en fonction de vos critères configurés.

## Vue d'ensemble

Les moniteurs DNS interrogent les serveurs DNS pour des types d'enregistrements spécifiques et évaluent les résultats. Cela vous permet de :

- Surveiller la disponibilité du service DNS
- Vérifier que les enregistrements DNS retournent des valeurs correctes
- Suivre les temps de réponse de la résolution DNS
- Valider la configuration DNSSEC
- Détecter les problèmes de propagation DNS ou les détournements

## Création d'un moniteur DNS

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **DNS** comme type de moniteur
4. Entrez le nom de domaine et le type d'enregistrement à interroger
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Paramètres de base

| Champ                 | Description                                                                                                        | Obligatoire |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| Nom de domaine        | Le domaine à interroger (ex. : `example.com`)                                                                      | Oui         |
| Type d'enregistrement | Le type d'enregistrement DNS à interroger                                                                          | Oui         |
| Serveur DNS           | Serveur DNS personnalisé à utiliser (ex. : `8.8.8.8`). Laisser vide pour utiliser le serveur par défaut du système | Non         |

### Types d'enregistrements pris en charge

| Type d'enregistrement | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| A                     | Enregistrements d'adresse IPv4                             |
| AAAA                  | Enregistrements d'adresse IPv6                             |
| CNAME                 | Enregistrements de nom canonique (alias)                   |
| MX                    | Enregistrements d'échange de messagerie                    |
| NS                    | Enregistrements de serveur de noms                         |
| TXT                   | Enregistrements texte (SPF, DKIM, etc.)                    |
| SOA                   | Enregistrements de début d'autorité                        |
| PTR                   | Enregistrements pointeurs (DNS inversé)                    |
| SRV                   | Enregistrements de localisation de service                 |
| CAA                   | Enregistrements d'autorisation d'autorité de certification |

### Paramètres avancés

| Champ                | Description                         | Par défaut |
| -------------------- | ----------------------------------- | ---------- |
| Port                 | Numéro de port DNS                  | 53         |
| Délai d'attente (ms) | Durée d'attente d'une réponse       | 5000       |
| Tentatives           | Nombre de tentatives en cas d'échec | 3          |

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre DNS est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification           | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| DNS en ligne                   | Si le serveur DNS répond aux requêtes               |
| Temps de réponse DNS (en ms)   | Temps de réponse aux requêtes en millisecondes      |
| Enregistrement DNS existant    | Si des enregistrements DNS existent pour la requête |
| Valeur de l'enregistrement DNS | La valeur retournée par un enregistrement DNS       |
| DNSSEC valide                  | Si la validation DNSSEC réussit                     |

### Types de filtres

Pour **DNS en ligne**, **Enregistrement DNS existant** et **DNSSEC valide** :

- **Vrai** — La condition est vraie
- **Faux** — La condition est fausse

Pour **Temps de réponse DNS** :

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

Pour **Valeur de l'enregistrement DNS** :

- **Contient** — La valeur de l'enregistrement contient le texte spécifié
- **Ne contient pas** — La valeur de l'enregistrement ne contient pas le texte spécifié
- **Commence par** — La valeur de l'enregistrement commence par le texte spécifié
- **Se termine par** — La valeur de l'enregistrement se termine par le texte spécifié
- **Égal à** — La valeur de l'enregistrement correspond exactement
- **Différent de** — La valeur de l'enregistrement ne correspond pas

### Exemples de critères

#### Vérifier si le DNS résout correctement

- **Vérifier sur** : DNS en ligne
- **Type de filtre** : Vrai

#### Vérifier que l'enregistrement A pointe vers la bonne IP

- **Vérifier sur** : Valeur de l'enregistrement DNS
- **Type de filtre** : Égal à
- **Valeur** : `93.184.216.34`

#### Alerter si la réponse DNS est lente

- **Vérifier sur** : Temps de réponse DNS (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 500

#### Vérifier que DNSSEC est valide

- **Vérifier sur** : DNSSEC valide
- **Type de filtre** : Vrai
