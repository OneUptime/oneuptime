# Intégration des e-mails entrants SendGrid

Le **Moniteur d'e-mails entrants** de OneUptime vous permet de créer et de résoudre des alertes basées sur des e-mails envoyés à des adresses e-mail uniques spécifiques au moniteur. Cela est utile pour l'intégration avec des systèmes hérités, des outils d'alerte ou tout service capable d'envoyer des e-mails.

Ce guide explique comment configurer SendGrid Inbound Parse pour transférer les e-mails entrants vers votre instance auto-hébergée OneUptime.

## Prérequis

- Un compte SendGrid (le niveau gratuit fonctionne)
- Un domaine que vous contrôlez avec accès aux paramètres DNS
- Votre instance OneUptime doit être publiquement accessible (pour que SendGrid puisse envoyer des webhooks)

## Fonctionnement

1. Vous créez un **Moniteur d'e-mails entrants** dans OneUptime
2. OneUptime génère une adresse e-mail unique pour ce moniteur (ex. : `monitor-abc123@inbound.votredomaine.com`)
3. Lorsqu'un e-mail est envoyé à cette adresse, SendGrid le reçoit et le transmet à OneUptime via webhook
4. OneUptime évalue l'e-mail en fonction de vos critères configurés pour créer ou résoudre des alertes

## Instructions de configuration

### Étape 1 : Choisir votre domaine d'e-mail entrant

Vous aurez besoin d'un sous-domaine dédié à la réception des e-mails entrants. Nous recommandons d'utiliser un sous-domaine comme :

- `inbound.votredomaine.com`
- `email.votredomaine.com`
- `monitor.votredomaine.com`

Ce sous-domaine sera utilisé exclusivement pour les e-mails du moniteur OneUptime.

### Étape 2 : Configurer l'enregistrement MX DNS

Ajoutez un enregistrement MX à votre configuration DNS pour acheminer les e-mails de votre sous-domaine entrant vers SendGrid.

| Type | Hôte/Nom | Priorité | Valeur          |
| ---- | -------- | -------- | --------------- |
| MX   | inbound  | 10       | mx.sendgrid.net |

**Exemple :** Si votre domaine est `example.com` et que vous utilisez `inbound.example.com` :

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Remarque :** Les modifications DNS peuvent prendre jusqu'à 48 heures pour se propager, mais se terminent généralement en quelques heures.

### Étape 3 : Vérifier le domaine dans SendGrid (optionnel mais recommandé)

Pour une meilleure délivrabilité et éviter que les e-mails soient marqués comme spam :

1. Connectez-vous à votre [Tableau de bord SendGrid](https://app.sendgrid.com)
2. Allez dans **Paramètres** > **Authentification de l'expéditeur**
3. Cliquez sur **Authentifier votre domaine**
4. Suivez les instructions pour ajouter les enregistrements DNS requis (enregistrements CNAME pour DKIM)

### Étape 4 : Configurer SendGrid Inbound Parse

1. Connectez-vous à votre [Tableau de bord SendGrid](https://app.sendgrid.com)
2. Accédez à **Paramètres** > **Inbound Parse**
3. Cliquez sur **Ajouter un hôte & URL**
4. Configurez les éléments suivants :

| Champ                                          | Valeur                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| **Domaine récepteur**                          | Votre sous-domaine entrant (ex. : `inbound.votredomaine.com`)              |
| **URL de destination**                         | `https://votre-domaine-oneuptime.com/incoming-email/sendgrid/VOTRE_SECRET` |
| **Vérifier les e-mails entrants pour le spam** | Optionnel — activez si souhaité                                            |
| **Envoyer le message MIME complet brut**       | Laisser décoché (non requis)                                               |
| **Poster le message MIME complet brut**        | Laisser décoché (non requis)                                               |

5. Cliquez sur **Ajouter**

### Étape 5 : Configurer les variables d'environnement OneUptime

#### Docker Compose

Ajoutez ces variables d'environnement à votre fichier `config.env` :

```bash
# Configuration des e-mails entrants
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.votredomaine.com
# INBOUND_EMAIL_WEBHOOK_SECRET=votre-secret-optionnel  # Optionnel : pour une sécurité supplémentaire
```

#### Kubernetes avec Helm

Ajoutez ces éléments à votre fichier `values.yaml` :

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.votredomaine.com"
  # webhookSecret: "votre-secret-optionnel"  # Optionnel
```

**Important :** Redémarrez votre serveur OneUptime après avoir ajouté ces variables d'environnement.

### Étape 6 : Créer un moniteur d'e-mails entrants

1. Connectez-vous à votre tableau de bord OneUptime
2. Accédez à **Moniteurs** > **Créer un moniteur**
3. Sélectionnez **E-mail entrant** comme type de moniteur
4. Configurez votre moniteur :
   - **Nom :** Donnez un nom descriptif à votre moniteur
   - **Description :** Décrivez l'utilité de ce moniteur
5. Configurez les **Critères de création d'alerte** (quand créer une alerte) :
   - Exemple : L'objet de l'e-mail contient « ALERTE » ou « CRITIQUE »
6. Configurez les **Critères de résolution d'alerte** (quand résoudre une alerte) :
   - Exemple : L'objet de l'e-mail contient « RÉSOLU » ou « OK »
7. Cliquez sur **Créer**

Après la création, vous verrez l'adresse e-mail unique pour ce moniteur (ex. : `monitor-abc123def456@inbound.votredomaine.com`).

### Étape 7 : Tester l'intégration

1. Copiez l'adresse e-mail du moniteur depuis le tableau de bord OneUptime
2. Envoyez un e-mail de test à cette adresse avec un objet qui correspond à vos critères d'alerte
3. Vérifiez dans le tableau de bord OneUptime :
   - L'e-mail a été reçu (visible dans le récapitulatif du moniteur)
   - Une alerte a été créée (si les critères correspondaient)

## Référence des variables d'environnement

| Variable                       | Description                                                                                                                                       | Obligatoire | Par défaut |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| `INBOUND_EMAIL_PROVIDER`       | Le fournisseur d'e-mail entrant à utiliser                                                                                                        | Oui         | -          |
| `INBOUND_EMAIL_DOMAIN`         | Le sous-domaine configuré pour les e-mails entrants                                                                                               | Oui         | -          |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Secret pour valider les requêtes de webhook. Lorsqu'il est défini, ajoutez ce secret à l'URL du webhook : `/incoming-email/sendgrid/VOTRE_SECRET` | Non         | -          |

## Critères d'e-mail pris en charge

Lors de la configuration de votre moniteur d'e-mails entrants, vous pouvez créer des critères basés sur :

| Champ                 | Description                         | Filtres disponibles                                                                                     |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Objet de l'e-mail** | La ligne d'objet de l'e-mail        | Contient, Ne contient pas, Égal à, Différent de, Commence par, Se termine par, Est vide, N'est pas vide |
| **De l'e-mail**       | L'adresse e-mail de l'expéditeur    | Contient, Ne contient pas, Égal à, Différent de, Commence par, Se termine par, Est vide, N'est pas vide |
| **Corps de l'e-mail** | Le corps en texte brut de l'e-mail  | Contient, Ne contient pas, Égal à, Différent de, Commence par, Se termine par, Est vide, N'est pas vide |
| **À l'e-mail**        | L'adresse e-mail du destinataire    | Contient, Ne contient pas, Égal à, Différent de, Commence par, Se termine par, Est vide, N'est pas vide |
| **E-mail reçu**       | Délai depuis le dernier e-mail reçu | Reçu en minutes, Non reçu en minutes                                                                    |

## Exemples de cas d'utilisation

### Alertes de systèmes hérités

De nombreux systèmes hérités ne peuvent envoyer que des alertes par e-mail. Créez un moniteur d'e-mails entrants pour :

- Créer des alertes OneUptime lorsque le système hérité envoie des e-mails `[CRITIQUE]`
- Résoudre les alertes lorsque des e-mails `[RÉSOLU]` sont reçus

### Intégration de services tiers

Intégrez-vous avec des services qui envoient des notifications par e-mail :

- Outils de surveillance qui n'ont pas d'intégrations API
- Notifications des fournisseurs cloud
- Outils d'analyse de sécurité

### Signal de vie par e-mail

Utilisez les critères « E-mail reçu » pour vous assurer de recevoir des e-mails périodiques :

- Créer une alerte si aucun e-mail n'est reçu en 60 minutes
- Utile pour surveiller les traitements par lots ou les tâches planifiées qui envoient des e-mails de confirmation

## Dépannage

### Les e-mails ne sont pas reçus

1. **Vérifier la propagation DNS :**

   ```bash
   dig MX inbound.votredomaine.com
   ```

   Doit retourner `mx.sendgrid.net`

2. **Vérifier les paramètres SendGrid Inbound Parse :**

   - Connectez-vous au tableau de bord SendGrid
   - Allez dans Paramètres > Inbound Parse
   - Vérifiez que votre domaine et l'URL du webhook sont corrects

3. **Vérifier les journaux OneUptime :**
   - Recherchez les requêtes de webhook dans les journaux du service ProbeIngest
   - Vérifiez les messages d'erreur éventuels

### Les webhooks échouent

1. **Assurez-vous que OneUptime est publiquement accessible :**

   - L'URL du webhook doit être accessible depuis Internet
   - Testez avec : `curl -X POST https://votre-domaine-oneuptime.com/incoming-email/sendgrid`

2. **Vérifier les règles de pare-feu :**

   - Autorisez le trafic HTTPS entrant depuis les plages IP de SendGrid

3. **Vérifier le certificat SSL :**
   - SendGrid nécessite un certificat SSL valide
   - Les certificats auto-signés peuvent causer des problèmes

### Le moniteur ne crée pas d'alertes

1. **Vérifier la configuration des critères :**

   - Vérifiez que vos critères de création d'alerte correspondent au contenu de l'e-mail
   - Testez d'abord avec des chaînes exactes avant d'utiliser la correspondance de motifs

2. **Vérifier le statut du moniteur :**

   - Assurez-vous que le moniteur n'est pas désactivé
   - Vérifiez que le type de moniteur est « E-mail entrant »

3. **Examiner le récapitulatif du moniteur :**
   - Vérifiez si l'e-mail a été reçu et traité
   - Examinez les journaux d'évaluation pour les détails de correspondance des critères

### Journaux de livraison des webhooks SendGrid

Pour vérifier si SendGrid envoie correctement les webhooks :

1. Malheureusement, SendGrid ne fournit pas de journaux détaillés pour Inbound Parse
2. Consultez les journaux de votre serveur OneUptime pour les requêtes de webhook entrantes
3. Utilisez un outil comme [RequestBin](https://requestbin.com) pour tester temporairement la livraison des webhooks

## Meilleures pratiques de sécurité

1. **Utiliser HTTPS :** Utilisez toujours HTTPS pour votre point d'accès webhook
2. **Secret de webhook :** Configurez `INBOUND_EMAIL_WEBHOOK_SECRET` et incluez-le dans votre URL de webhook (ex. : `/incoming-email/sendgrid/votre-secret`) pour une validation supplémentaire
3. **Vérification du domaine :** Vérifiez votre domaine dans SendGrid pour une meilleure sécurité des e-mails
4. **Restreindre l'accès :** Ne créez des moniteurs que pour des sources d'e-mail de confiance
5. **Surveiller les journaux :** Examinez régulièrement les journaux d'e-mails entrants pour les activités suspectes

## Fournisseurs alternatifs

OneUptime est conçu pour prendre en charge plusieurs fournisseurs d'e-mail entrant. Actuellement pris en charge :

| Fournisseur           | Statut         |
| --------------------- | -------------- |
| SendGrid              | Pris en charge |
| Haraka (Auto-hébergé) | Prévu          |

Si vous avez besoin de la prise en charge d'un autre fournisseur, veuillez nous contacter ou soumettre une demande de fonctionnalité.

## Support

Si vous rencontrez des problèmes avec l'intégration des e-mails entrants SendGrid :

1. Consultez la section de dépannage ci-dessus
2. Examinez les journaux de OneUptime pour les messages d'erreur détaillés
3. Nous contacter à [hello@oneuptime.com](mailto:hello@oneuptime.com)

Nous accueillons favorablement les retours pour améliorer cette intégration !
