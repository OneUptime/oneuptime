# Moniteur d'e-mails entrants

Le moniteur d'e-mails entrants vous permet de créer et de résoudre des alertes basées sur des e-mails envoyés à des adresses e-mail uniques spécifiques au moniteur. Cela est utile pour l'intégration avec des systèmes hérités, des outils d'alerte tiers, ou tout service capable d'envoyer des notifications par e-mail.

## Fonctionnement

1. Lorsque vous créez un moniteur d'e-mails entrants, OneUptime génère une adresse e-mail unique pour ce moniteur
2. Tout e-mail envoyé à cette adresse est reçu et évalué en fonction de vos critères configurés
3. En fonction des critères, OneUptime peut créer de nouvelles alertes ou résoudre des alertes existantes

C'est un moyen puissant d'intégrer des systèmes d'alerte par e-mail dans le flux de gestion des incidents de OneUptime.

## Création d'un moniteur d'e-mails entrants

1. Accédez à **Moniteurs** dans votre tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **E-mail entrant** comme type de moniteur
4. Configurez les paramètres du moniteur :
   - **Nom :** Un nom descriptif pour votre moniteur
   - **Description :** L'utilité de ce moniteur
5. Configurez vos **Critères de création d'alerte** (conditions qui créent des alertes)
6. Configurez vos **Critères de résolution d'alerte** (conditions qui résolvent les alertes)
7. Cliquez sur **Créer**

Après la création, vous verrez l'adresse e-mail unique pour ce moniteur affichée sur la page de détails du moniteur.

## Format de l'adresse e-mail

Chaque moniteur d'e-mails entrants obtient une adresse e-mail unique au format :

```
monitor-{clé-secrète}@{domaine-entrant}
```

Par exemple : `monitor-abc123def456@inbound.yourdomain.com`

Vous pouvez copier cette adresse depuis la page de détails du moniteur et configurer vos systèmes externes pour y envoyer des e-mails.

## Champs de critères disponibles

Vous pouvez créer des critères basés sur les champs d'e-mail suivants :

| Champ                 | Description                                        |
| --------------------- | -------------------------------------------------- |
| **Objet de l'e-mail** | La ligne d'objet de l'e-mail entrant               |
| **De l'e-mail**       | L'adresse e-mail de l'expéditeur                   |
| **Corps de l'e-mail** | Le contenu en texte brut du corps de l'e-mail      |
| **À l'e-mail**        | L'adresse e-mail du destinataire                   |
| **E-mail reçu**       | Critères basés sur le temps pour les e-mails reçus |

## Types de filtres disponibles

### Filtres de chaîne (Objet, De, Corps, À)

| Filtre              | Description                                      | Exemple                               |
| ------------------- | ------------------------------------------------ | ------------------------------------- |
| **Contient**        | Le champ contient le texte spécifié              | Objet contient « CRITIQUE »           |
| **Ne contient pas** | Le champ ne contient pas le texte spécifié       | Objet ne contient pas « TEST »        |
| **Égal à**          | Le champ correspond exactement au texte spécifié | De égal à « alertes@service.com »     |
| **Différent de**    | Le champ ne correspond pas au texte spécifié     | Objet différent de « OK »             |
| **Commence par**    | Le champ commence par le texte spécifié          | Objet commence par « [ALERTE] »       |
| **Se termine par**  | Le champ se termine par le texte spécifié        | Objet se termine par « - Production » |
| **Est vide**        | Le champ est vide ou blanc                       | Corps est vide                        |
| **N'est pas vide**  | Le champ a du contenu                            | Objet n'est pas vide                  |

### Filtres basés sur le temps (E-mail reçu)

| Filtre                  | Description                                      | Exemple                       |
| ----------------------- | ------------------------------------------------ | ----------------------------- |
| **Reçu en minutes**     | L'e-mail a été reçu dans les X dernières minutes | E-mail reçu en 30 minutes     |
| **Non reçu en minutes** | Aucun e-mail reçu dans les X dernières minutes   | E-mail non reçu en 60 minutes |

## Exemples de configuration

### Exemple 1 : Créer une alerte pour les e-mails critiques

**Critères de création d'alerte :**

- Objet de l'e-mail **Contient** « CRITIQUE »
- OU Objet de l'e-mail **Contient** « ALERTE »
- OU Objet de l'e-mail **Contient** « ERREUR »

**Critères de résolution d'alerte :**

- Objet de l'e-mail **Contient** « RÉSOLU »
- OU Objet de l'e-mail **Contient** « OK »
- OU Objet de l'e-mail **Contient** « RÉTABLI »

### Exemple 2 : Surveiller un expéditeur spécifique

**Critères de création d'alerte :**

- De l'e-mail **Égal à** « surveillance@systeme-legacy.com »
- ET Objet de l'e-mail **Contient** « Échec »

**Critères de résolution d'alerte :**

- De l'e-mail **Égal à** « surveillance@systeme-legacy.com »
- ET Objet de l'e-mail **Contient** « Succès »

### Exemple 3 : Moniteur de signal de vie (Aucun e-mail = Alerte)

**Critères de création d'alerte :**

- E-mail reçu **Non reçu en minutes** avec la valeur `60`

Cela crée une alerte si aucun e-mail n'est reçu pendant 60 minutes — utile pour surveiller les tâches planifiées ou les traitements par lots qui doivent envoyer des e-mails de confirmation.

**Critères de résolution d'alerte :**

- E-mail reçu **Reçu en minutes** avec la valeur `5`

Cela résout l'alerte lorsqu'un e-mail est reçu.

## Cas d'utilisation

### Intégration de systèmes hérités

De nombreux anciens systèmes ne prennent en charge que les alertes par e-mail. Utilisez le moniteur d'e-mails entrants pour :

- Convertir les alertes par e-mail en incidents OneUptime
- Résoudre automatiquement les incidents lorsque des e-mails de récupération arrivent
- Centraliser les alertes de plusieurs systèmes hérités

### Surveillance de services tiers

Intégrez-vous avec des services qui envoient des notifications par e-mail :

- Alertes des fournisseurs cloud (AWS, GCP, Azure)
- Outils d'analyse de sécurité
- Notifications de fin de sauvegarde
- Avertissements d'expiration de certificat SSL

### Surveillance des tâches planifiées

Surveillez les traitements par lots et les tâches planifiées :

- Créez des alertes si les e-mails de confirmation ne sont pas reçus à temps
- Suivez les échecs de tâches via les e-mails de notification d'erreurs
- Surveillez les complétions de pipelines de données

### Agrégation d'alertes multi-fournisseurs

Consolidez les alertes de plusieurs outils de surveillance :

- Recevez des alertes de Nagios, Zabbix ou d'autres outils par e-mail
- Unifiez la gestion des incidents dans OneUptime
- Maintenez une source unique de vérité pour toutes les alertes

## Variables de modèle

Lors de la configuration des modèles d'incidents, vous pouvez utiliser ces variables provenant des e-mails entrants :

| Variable              | Description                        |
| --------------------- | ---------------------------------- |
| `{{emailSubject}}`    | L'objet de l'e-mail reçu           |
| `{{emailFrom}}`       | L'adresse e-mail de l'expéditeur   |
| `{{emailTo}}`         | L'adresse e-mail du destinataire   |
| `{{emailBody}}`       | Le corps en texte brut de l'e-mail |
| `{{emailReceivedAt}}` | Quand l'e-mail a été reçu          |

## Vue récapitulative du moniteur

Le récapitulatif du moniteur affiche :

- **Dernier e-mail reçu le :** Quand le dernier e-mail a été reçu
- **De :** L'expéditeur du dernier e-mail
- **Objet :** La ligne d'objet du dernier e-mail
- **En-têtes de l'e-mail :** En-têtes complets du dernier e-mail (extensibles)
- **Corps de l'e-mail :** Contenu du dernier e-mail (extensible)

## Configuration auto-hébergée

Si vous auto-hébergez OneUptime, vous devez configurer un fournisseur d'e-mail entrant. Actuellement pris en charge :

- **SendGrid Inbound Parse** — Voir [Intégration des e-mails entrants SendGrid](/docs/self-hosted/sendgrid-inbound-email) pour les instructions de configuration

## Points à considérer

- **Sécurité de l'adresse e-mail :** L'adresse e-mail du moniteur contient une clé secrète. Traitez-la comme un mot de passe et ne la partagez pas publiquement.
- **Taille des e-mails :** Les e-mails très volumineux (avec des pièces jointes importantes) peuvent être tronqués ou rejetés par le fournisseur d'e-mail.
- **Temps de traitement :** Les e-mails sont traités de manière asynchrone. Il peut y avoir un délai de quelques secondes entre l'envoi d'un e-mail et la création d'une alerte.
- **Insensibilité à la casse :** Toutes les comparaisons de chaînes (Contient, Égal à, etc.) sont insensibles à la casse.
- **Texte brut :** Les critères de corps d'e-mail utilisent la version texte brut de l'e-mail. Le formatage HTML est supprimé.

## Dépannage

### Les e-mails ne sont pas reçus

1. Vérifiez que l'adresse e-mail est correcte (vérifiez les fautes de frappe)
2. Vérifiez si l'e-mail est bloqué par des filtres anti-spam
3. Vérifiez que votre fournisseur d'e-mail entrant est correctement configuré
4. Consultez les journaux de OneUptime pour tout message d'erreur

### Les alertes ne sont pas créées

1. Vérifiez que vos critères correspondent au contenu de l'e-mail
2. Vérifiez que le moniteur n'est pas désactivé
3. Examinez les journaux d'évaluation dans les détails du moniteur
4. Testez avec des correspondances de chaînes exactes avant d'utiliser la correspondance de motifs

### Les alertes ne sont pas résolues

1. Vérifiez que vos critères de résolution correspondent à l'e-mail de récupération
2. Assurez-vous qu'il y a une alerte active à résoudre
3. Vérifiez que l'e-mail de résolution est envoyé à la même adresse de moniteur
