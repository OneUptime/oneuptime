# Fournisseurs d'e-mail

Envoyez les e-mails de OneUptime par l'API HTTPS d'un fournisseur d'e-mail plutôt que par un serveur SMTP : Amazon SES, SendGrid, Mailgun, Postmark ou Resend. Un projet en choisit un pour une configuration SMTP, et une installation auto-hébergée peut envoyer tous ses propres e-mails par l'un d'eux. L'API est jointe en HTTPS sur le port 443 : les e-mails partent donc même depuis les réseaux qui bloquent les ports SMTP, et la clé de chaque fournisseur est stockée chiffrée.

:::cards
- [Amazon SES](#amazon-ses): Une clé d'accès IAM et la région où votre expéditeur est vérifié.
- [SendGrid](#sendgrid): Une clé API avec l'accès Mail Send.
- [Mailgun](#mailgun): Une clé API, le domaine d'envoi et sa région.
- [Postmark](#postmark): Le jeton d'API du serveur.
- [Resend](#resend): Une clé API avec l'accès à l'envoi.
- [Dépannage](#dépannage): Ce que signifie le refus de chaque fournisseur.
:::

## Choisir un fournisseur

:::tabs
@tab Projet
Dans **Paramètres du projet > Notifications > Paramètres de notification**, ouvrez **Plus de paramètres** et cliquez sur **Créer : Configuration SMTP** dans la carte **Configurations SMTP personnalisées**. À l'étape **Fournisseur**, saisissez un **Nom** et choisissez le fournisseur. L'étape suivante demande les paramètres de ce fournisseur, et l'étape **Expéditeur**, l'**E-mail de l'expéditeur** et le **Nom de l'expéditeur**. Une fois la configuration enregistrée, **Envoyer un e-mail de test** sur sa ligne vérifie qu'elle fonctionne.
@tab Instance auto-hébergée
Dans l'Admin Dashboard, ouvrez **Paramètres**, puis **Notifications > E-mails**. Dans la carte **Paramètres du serveur de messagerie**, cliquez sur **Modifier le serveur** et choisissez le fournisseur comme **Type de serveur de messagerie**. La carte du fournisseur apparaît en dessous, par exemple **Paramètres Amazon SES** : cliquez sur son bouton de modification, par exemple **Modifier Amazon SES**, et renseignez les paramètres du fournisseur et l'étape **Expéditeur**. Tant qu'il lui manque quelque chose, la carte indique ce qui manque, et chaque e-mail est refusé avec le paramètre à renseigner.
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

### Remplir l'étape Amazon SES

Saisissez l'**ID de clé d'accès** et la **Clé d'accès secrète**, ainsi que la **Région** dans laquelle votre identité est vérifiée, par exemple `us-east-1`.
:::

## SendGrid

Dans SendGrid, ouvrez **Settings > API Keys**, créez une clé avec l'accès **Mail Send**, et vérifiez l'adresse depuis laquelle vous envoyez (Single Sender Verification) ou son domaine (Domain Authentication). Saisissez la clé comme **Clé API** à l'étape **SendGrid**.

## Mailgun

Dans Mailgun, ajoutez et vérifiez votre domaine d'envoi, par exemple `mg.example.com`, puis créez une clé d'envoi pour ce domaine, ou utilisez la clé API de votre compte. À l'étape **Mailgun**, saisissez la **Clé API** et le **Domaine**, et choisissez la **Région** dans laquelle le domaine a été créé : `EU` pour un domaine de la région UE de Mailgun, `US` pour les autres. L'**E-mail de l'expéditeur** doit être une adresse de ce domaine. Un domaine sandbox n'envoie qu'à ses destinataires autorisés.

## Postmark

Dans Postmark, ouvrez le serveur qui envoie, puis son onglet **API Tokens**, et copiez le jeton d'API du serveur : un jeton de compte n'envoie pas. Saisissez-le comme **Jeton d'API du serveur** à l'étape **Postmark**. L'**E-mail de l'expéditeur** doit être une signature d'expéditeur confirmée, ou une adresse d'un domaine vérifié. Tant que Postmark n'a pas approuvé votre compte, il n'envoie qu'aux adresses de votre propre domaine.

## Resend

Dans Resend, ajoutez et vérifiez votre domaine sous **Domains**, puis créez sous **API Keys** une clé API avec l'accès à l'envoi. Saisissez-la comme **Clé API** à l'étape **Resend**, avec un **E-mail de l'expéditeur** de votre domaine vérifié. Le domaine de test de Resend n'envoie qu'à votre propre adresse.

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
