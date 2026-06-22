# Moniteur de domaine

La surveillance des domaines vous permet de surveiller le statut d'enregistrement et l'expiration de vos noms de domaine. OneUptime effectue périodiquement des recherches WHOIS pour suivre la santé de vos domaines et vous alerter avant leur expiration.

## Vue d'ensemble

Les moniteurs de domaine interrogent les données WHOIS de vos domaines pour suivre les détails d'enregistrement. Cela vous permet de :

- Surveiller les dates d'expiration des domaines
- Détecter les domaines expirés ou sur le point d'expirer
- Suivre les informations du registraire de domaine
- Vérifier la configuration des serveurs de noms
- Surveiller les codes de statut des domaines

## Création d'un moniteur de domaine

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Domaine** comme type de moniteur
4. Entrez le nom de domaine que vous souhaitez surveiller
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Paramètres de base

| Champ          | Description                                   | Obligatoire |
| -------------- | --------------------------------------------- | ----------- |
| Nom de domaine | Le domaine à surveiller (ex. : `example.com`) | Oui         |

### Paramètres avancés

| Champ                | Description                         | Par défaut |
| -------------------- | ----------------------------------- | ---------- |
| Délai d'attente (ms) | Durée d'attente d'une réponse WHOIS | 10000      |
| Tentatives           | Nombre de tentatives en cas d'échec | 3          |

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre domaine est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification           | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| Expiration du domaine en jours | Nombre de jours avant l'expiration de l'enregistrement du domaine |
| Registraire du domaine         | Nom du registraire du domaine                                     |
| Serveur de noms du domaine     | Noms d'hôte des serveurs de noms pour le domaine                  |
| Code de statut du domaine      | Codes de statut WHOIS du domaine                                  |
| Domaine expiré                 | Si le domaine a expiré                                            |

### Types de filtres

Pour **Domaine expiré** :

- **Vrai** — Le domaine a expiré
- **Faux** — Le domaine n'a pas expiré

Pour **Expiration du domaine en jours** :

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

Pour **Registraire du domaine**, **Serveur de noms du domaine** et **Code de statut du domaine** :

- **Contient** — La valeur contient le texte spécifié
- **Ne contient pas** — La valeur ne contient pas le texte spécifié
- **Commence par** — La valeur commence par le texte spécifié
- **Se termine par** — La valeur se termine par le texte spécifié
- **Égal à** — La valeur correspond exactement
- **Différent de** — La valeur ne correspond pas

### Exemples de critères

#### Alerter si le domaine expire dans 30 jours

- **Vérifier sur** : Expiration du domaine en jours
- **Type de filtre** : Inférieur à
- **Valeur** : 30

#### Marquer comme hors ligne si le domaine est expiré

- **Vérifier sur** : Domaine expiré
- **Type de filtre** : Vrai

#### Vérifier que les serveurs de noms sont corrects

- **Vérifier sur** : Serveur de noms du domaine
- **Type de filtre** : Contient
- **Valeur** : `ns1.example.com`

## Meilleures pratiques

1. **Configurer des avertissements précoces** — Configurez des alertes de dégradation à 60 jours et des alertes hors ligne à 14 jours avant l'expiration
2. **Surveiller tous les domaines critiques** — Incluez les domaines principaux, les sous-domaines enregistrés séparément et tout domaine utilisé pour les e-mails ou les API
3. **Suivre les changements de registraire** — Surveillez le champ du registraire pour détecter les transferts de domaine non autorisés
