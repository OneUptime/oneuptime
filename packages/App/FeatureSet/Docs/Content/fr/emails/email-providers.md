# Fournisseurs d'e-mail

Envoyez les e-mails de OneUptime par l'API HTTPS d'un fournisseur d'e-mail plutôt que par un serveur SMTP : Amazon SES, SendGrid, Mailgun, Postmark ou Resend. Un projet en choisit un pour une configuration SMTP, et une installation auto-hébergée peut envoyer tous ses propres e-mails par l'un d'eux. L'API est jointe en HTTPS sur le port 443 : les e-mails partent donc même depuis les réseaux qui bloquent les ports SMTP, et la clé de chaque fournisseur est stockée chiffrée.

:::cards
- [Amazon SES](#amazon-ses): Une clé d'accès IAM, ou le rôle IAM propre au serveur, et la région où votre expéditeur est vérifié.
- [SendGrid](#sendgrid): Une clé API avec l'accès Mail Send.
- [Mailgun](#mailgun): Une clé API, le domaine d'envoi et sa région.
- [Postmark](#postmark): Le jeton d'API du serveur.
- [Resend](#resend): Une clé API avec l'accès à l'envoi.
- [Variables d'environnement](#définir-le-mail-du-serveur-par-des-variables-denvironnement): Définir l'e-mail d'un serveur auto-hébergé depuis les values Helm ou `config.env`.
- [Dépannage](#dépannage): Ce que signifie le refus de chaque fournisseur.
:::

## Choisir un fournisseur

:::tabs
@tab Projet
Dans **Paramètres du projet > Notifications > Canaux de notification**, ouvrez **Plus de paramètres** et cliquez sur **Créer : Configuration SMTP** dans la carte **Configurations SMTP personnalisées**. À l'étape **Fournisseur**, saisissez un **Nom** et choisissez le fournisseur. L'étape suivante demande les paramètres de ce fournisseur, et l'étape **Expéditeur**, l'**E-mail de l'expéditeur** et le **Nom de l'expéditeur**. Une fois la configuration enregistrée, **Envoyer un e-mail de test** sur sa ligne vérifie qu'elle fonctionne.
@tab Instance auto-hébergée
Dans l'Admin Dashboard, ouvrez **Paramètres**, puis **Notifications > E-mails**. Dans la carte **Paramètres du serveur de messagerie**, cliquez sur **Modifier le serveur** et choisissez le fournisseur comme **Type de serveur de messagerie**. La carte du fournisseur apparaît en dessous, par exemple **Paramètres Amazon SES** : cliquez sur son bouton de modification, par exemple **Modifier Amazon SES**, et renseignez les paramètres du fournisseur et l'étape **Expéditeur**. Tant qu'il lui manque quelque chose, la carte indique ce qui manque, et chaque e-mail est refusé avec le paramètre à renseigner. Un serveur déployé depuis du code peut plutôt les définir par des variables d'environnement : voir [Définir l'e-mail du serveur par des variables d'environnement](#définir-le-mail-du-serveur-par-des-variables-denvironnement).
:::

| Fournisseur | Ce qu'il demande | Où OneUptime envoie |
| --- | --- | --- |
| Amazon SES | ID de clé d'accès, Clé d'accès secrète, Région | `https://email.<region>.amazonaws.com` (API SES v2) |
| SendGrid | Clé API | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | Clé API, Domaine, Région | `https://api.mailgun.net` ou `https://api.eu.mailgun.net` |
| Postmark | Jeton d'API du serveur | `https://api.postmarkapp.com/email` |
| Resend | Clé API | `https://api.resend.com/emails` |

Chaque e-mail part avec sa partie texte, et ses images (le logo de OneUptime, des captures d'écran) en pièces jointes intégrées. Quand un fournisseur limite votre cadence d'envoi, ou échoue de son côté, OneUptime réessaie après le délai que le fournisseur demande ; tout autre refus est conservé dans les journaux de notification, avec la réponse du fournisseur.

## Amazon SES

:::steps
### Vérifier l'expéditeur

Dans la [console Amazon SES](https://console.aws.amazon.com/ses/), dans la région depuis laquelle vous enverrez, vérifiez sous **Identities** l'adresse depuis laquelle vous envoyez, ou son domaine. Tant que votre compte est dans la sandbox SES, vérifiez aussi chaque destinataire, ou demandez un accès en production.

### Créer une clé d'accès

Créez pour OneUptime un utilisateur IAM avec une politique qui autorise `ses:SendEmail` sur votre identité, puis créez une clé d'accès pour cet utilisateur :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

Une installation auto-hébergée sur AWS peut se passer de la clé et [se connecter avec le rôle IAM du serveur](#se-connecter-avec-le-rôle-iam-du-serveur) à la place, avec la même politique.

### Remplir l'étape Amazon SES

Saisissez l'**ID de clé d'accès** et la **Clé d'accès secrète**, ainsi que la **Région** dans laquelle votre identité est vérifiée, par exemple `us-east-1`.
:::

### Se connecter avec le rôle IAM du serveur

Une installation auto-hébergée sur AWS peut envoyer ses propres e-mails en tant que rôle IAM qu'AWS donne au serveur, sans qu'aucune clé d'accès ne soit stockée dans OneUptime : les identifiants qu'AWS fournit expirent en quelques heures, et OneUptime en obtient de nouveaux avant qu'ils n'expirent. Cela ne concerne que les e-mails propres au serveur. La configuration Amazon SES d'un projet se connecte toujours avec une clé d'accès, car le rôle du serveur est l'identité AWS propre au serveur, pas celle d'un projet.

Donnez au rôle la politique ci-dessus, puis exécutez OneUptime avec ce rôle :

:::tabs
@tab Amazon EKS
Avec les rôles IAM pour les comptes de service, créez le rôle avec une politique d'approbation pour le fournisseur OIDC de votre cluster, et faites créer par le chart Helm un compte de service portant l'ARN du rôle. Les pods app et worker de OneUptime s'exécutent sous ce compte :

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Avec EKS Pod Identity, créez plutôt une association Pod Identity entre le rôle et ce compte de service, et omettez l'annotation.
@tab Amazon ECS
Définissez le rôle comme **Task role** de la définition de tâche de OneUptime.
@tab Amazon EC2
Attachez le rôle à l'instance comme profil d'instance. Avec OneUptime dans Docker sur l'instance, portez la limite de sauts des métadonnées d'instance à 2, pour que les conteneurs puissent les atteindre :

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Ensuite, dans l'Admin Dashboard, cliquez sur **Modifier Amazon SES**, choisissez **Rôle IAM de ce serveur** comme **Type d'authentification** et saisissez la **Région**. L'enregistrement supprime toute clé d'accès stockée auparavant.

OneUptime cherche les identifiants du serveur là où les SDK AWS les cherchent, dans cet ordre : `AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY` dans son environnement, un jeton d'identité web (`AWS_ROLE_ARN` et `AWS_WEB_IDENTITY_TOKEN_FILE`), le point de terminaison des identifiants de conteneur d'Amazon ECS et d'EKS Pod Identity, puis le service de métadonnées d'instance d'EC2 (IMDSv2).

## SendGrid

Dans SendGrid, ouvrez **Settings > API Keys**, créez une clé avec l'accès **Mail Send**, et vérifiez l'adresse depuis laquelle vous envoyez (Single Sender Verification) ou son domaine (Domain Authentication). Saisissez la clé comme **Clé API** à l'étape **SendGrid**.

## Mailgun

Dans Mailgun, ajoutez et vérifiez votre domaine d'envoi, par exemple `mg.example.com`, puis créez une clé d'envoi pour ce domaine, ou utilisez la clé API de votre compte. À l'étape **Mailgun**, saisissez la **Clé API** et le **Domaine**, et choisissez la **Région** dans laquelle le domaine a été créé : `EU` pour un domaine de la région UE de Mailgun, `US` pour les autres. L'**E-mail de l'expéditeur** doit être une adresse de ce domaine. Un domaine sandbox n'envoie qu'à ses destinataires autorisés.

## Postmark

Dans Postmark, ouvrez le serveur qui envoie, puis son onglet **API Tokens**, et copiez le jeton d'API du serveur : un jeton de compte n'envoie pas. Saisissez-le comme **Jeton d'API du serveur** à l'étape **Postmark**. L'**E-mail de l'expéditeur** doit être une signature d'expéditeur confirmée, ou une adresse d'un domaine vérifié. Tant que Postmark n'a pas approuvé votre compte, il n'envoie qu'aux adresses de votre propre domaine.

## Resend

Dans Resend, ajoutez et vérifiez votre domaine sous **Domains**, puis créez sous **API Keys** une clé API avec l'accès à l'envoi. Saisissez-la comme **Clé API** à l'étape **Resend**, avec un **E-mail de l'expéditeur** de votre domaine vérifié. Le domaine de test de Resend n'envoie qu'à votre propre adresse.

## Définir l'e-mail du serveur par des variables d'environnement

Un serveur auto-hébergé déployé depuis du code peut démarrer en envoyant déjà ses e-mails, sans rien configurer à la main : définissez ses paramètres d'e-mail par des variables d'environnement, depuis Terraform ou ce qui déploie OneUptime. Dès que `GLOBAL_EMAIL_SERVER_TYPE` est définie, le serveur envoie ses propres e-mails comme le décrivent les variables. Les paramètres enregistrés dans l'Admin Dashboard sous **Paramètres**, puis **Notifications > E-mails**, ne sont pas utilisés, et cette page affiche ceux-ci en lecture seule, chaque champ avec la variable qui le définit. Laissez `GLOBAL_EMAIL_SERVER_TYPE` vide pour configurer plutôt l'e-mail dans l'Admin Dashboard. Les configurations SMTP des projets ne changent pas.

| Variable | Valeur Helm | Ce qu'elle contient |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` ou `resend`. C'est elle qui fait lire les autres variables à OneUptime |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | L'adresse d'où part chaque e-mail |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Le nom sous lequel part chaque e-mail. Obligatoire pour `custom-smtp` et `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (aussi quand elle est vide), ou `microsoft-graph` pour envoyer par Microsoft Graph avec l'application OAuth |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | Le serveur de messagerie, par exemple `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Son port, par exemple `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` pour n'envoyer que par une connexion chiffrée avec un certificat valide, ou `false` (aussi quand elle est vide) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (aussi quand elle est vide), `oauth` ou `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | La boîte aux lettres sous laquelle se connecter, aussi pour `oauth`. Laissez-la vide avec le mot de passe pour envoyer sans se connecter |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`, ou un Secret nommé dans `email.existingSecret.name` | Son mot de passe |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (aussi quand elle est vide) ou `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | L'ID client de l'application OAuth |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`, ou un Secret nommé dans `email.existingSecret.name` | Son secret client ; pour `jwt-bearer`, sa clé privée au format PEM |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Son URL de jeton |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Son scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`, ou un Secret nommé dans `email.existingSecret.name` | La clé API de SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (aussi quand elle est vide), ou `server-iam-role` pour se connecter avec le rôle IAM du serveur |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | L'ID de la clé d'accès |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`, ou un Secret nommé dans `email.existingSecret.name` | Sa clé d'accès secrète |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | La région où votre expéditeur est vérifié, par exemple `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`, ou un Secret nommé dans `email.existingSecret.name` | La clé API de Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Le domaine d'envoi, par exemple `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (aussi quand elle est vide) ou `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`, ou un Secret nommé dans `email.existingSecret.name` | Le jeton d'API du serveur Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`, ou un Secret nommé dans `email.existingSecret.name` | La clé API de Resend |

Seules les variables que lit le type de serveur sont utilisées : les `GLOBAL_EMAIL_SMTP_` pour `custom-smtp`, et celles d'un fournisseur pour ce fournisseur. Le journal du serveur et l'Admin Dashboard nomment toute autre variable définie, comme inutilisée.

Avec Helm, définissez-les sous `email` dans vos values. Pour que le mot de passe ou la clé ne figure pas dans les values que Helm enregistre à chaque release, placez-le dans un Secret à vous et nommez ce Secret dans `email.existingSecret.name`. Le chart le lit sous la clé nommée dans `email.existingSecret.key`, sinon sous la clé qui porte son nom : `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` ou `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

Le chart refuse d'autres valeurs `email` sans `email.serverType`, des paramètres sans le mot de passe ou la clé qu'ils lisent, un mot de passe ou une clé donné à la fois dans les values et dans un Secret, et un Secret dont les paramètres ne lisent rien. Avec Terraform, définissez les mêmes valeurs sur un `helm_release`, le mot de passe ou la clé comme valeur sensible.

Avec Docker Compose, définissez les paramètres `GLOBAL_EMAIL_` dans `config.env`, puis lancez `npm run start` pour recréer les conteneurs.

OneUptime lit les variables au démarrage. Si l'une d'elles est erronée, par exemple un port qui n'est pas un nombre ou un mot de passe manquant, le serveur n'envoie aucun e-mail tant que ce n'est pas corrigé ; le journal du serveur, les paramètres d'e-mail de l'Admin Dashboard et la liste de contrôle de `/admin/setup` nomment la variable. Les mots de passe et les clés ne sont jamais affichés. Pour changer les paramètres, modifiez les variables et redémarrez OneUptime : l'Admin Dashboard ne les modifie pas.

## Dépannage

Un e-mail de test qui ne part pas indique pourquoi. Pour tout autre e-mail, ouvrez l'onglet **E-mail** de **Paramètres du projet > Notifications > Journaux de notification** et sélectionnez **Voir le message de statut** sur sa ligne.

:::details "Amazon SES needs a verified identity in …"
L'**E-mail de l'expéditeur**, ou son domaine, n'est pas vérifié dans la région définie dans la configuration, ou le compte est dans la sandbox SES et le destinataire n'est pas vérifié. Vérifiez-le dans cette région, ou demandez un accès en production.
:::

:::details "Amazon SES does not recognize the access key" ou "did not accept the request's signature"
Vérifiez l'**ID de clé d'accès**, que la clé est active dans IAM, et que la **Clé d'accès secrète** est bien celle créée avec elle. Une signature est aussi refusée quand l'horloge du serveur n'est pas à l'heure.
:::

:::details "The access key may not send with Amazon SES"
La politique de l'utilisateur IAM n'autorise pas `ses:SendEmail` sur votre identité. Ajoutez la politique ci-dessus.
:::

:::details "This server has no AWS credentials"
Le serveur se connecte avec son rôle IAM, mais AWS ne lui donne aucun identifiant. Exécutez-le avec le rôle, comme le montre [Se connecter avec le rôle IAM du serveur](#se-connecter-avec-le-rôle-iam-du-serveur), puis redémarrez les pods ou les tâches de OneUptime : un pod reçoit les paramètres de son rôle à son démarrage. Dans Docker sur Amazon EC2, le message indique aussi quand la limite de sauts des métadonnées d'instance est trop basse.
:::

:::details "This server's IAM role may not send with Amazon SES" ou "did not let this server assume the role"
La politique du rôle n'autorise pas `ses:SendEmail` sur votre identité : ajoutez la politique ci-dessus. Ou, sur Amazon EKS, la politique d'approbation du rôle n'autorise pas `sts:AssumeRoleWithWebIdentity` pour le fournisseur OIDC de votre cluster et le compte de service de OneUptime.
:::

:::details "Mailgun has no domain … in its US region"
Le domaine n'est pas dans la région vers laquelle la configuration envoie. Vérifiez le **Domaine**, et réglez la **Région** sur `EU` si le domaine y a été créé.
:::

:::details "is not a confirmed sender signature in Postmark" ou "is not a verified domain in Resend"
Confirmez l'**E-mail de l'expéditeur** comme expéditeur, ou vérifiez son domaine, dans le tableau de bord du fournisseur.
:::

:::details "did not accept the API key" ou "did not accept the server API token"
Vérifiez la clé de la configuration : celle de SendGrid a besoin de l'accès Mail Send, la clé d'envoi de Mailgun ne fonctionne que pour son propre domaine, Postmark a besoin du jeton du serveur, et celle de Resend a besoin de l'accès à l'envoi.
:::

## Étapes suivantes

:::cards
- [SMTP](/docs/emails/smtp): Envoyer plutôt par votre propre serveur de messagerie ou par Microsoft 365.
- [Abonnés et annonces](/docs/status-pages/subscribers): Envoyer les e-mails aux abonnés d'une page de statut par une configuration SMTP du projet.
:::
