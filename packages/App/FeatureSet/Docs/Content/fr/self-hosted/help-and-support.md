# Aide et support

Dirigez l'aide que propose OneUptime vers votre propre équipe : l'adresse de support, le chat et la page d'aide que voient les personnes, la destination de **Donner votre avis**, ce que l'authentification unique dit à quelqu'un qui a besoin d'une invitation, et les incitations à obtenir l'app mobile. Chaque élément peut rester sur la valeur de OneUptime, pointer vers une adresse ou un lien à vous, ou être masqué.

:::cards
- [Changer où mène l'aide](#changer-où-mène-laide) : Une seule page dans le Admin Dashboard.
- [Ce que change chaque paramètre](#ce-que-change-chaque-paramètre) : Chaque emplacement, sa valeur par défaut et ses choix.
- [Donner votre avis](#donner-votre-avis) : Où est envoyé ce que les personnes écrivent.
- [Le message de connexion](#le-message-de-connexion) : À qui demander une invitation.
:::

## Changer où mène l'aide

:::steps
### Ouvrir Aide et support
Dans le Admin Dashboard, ouvrez **Paramètres**, puis **Aide et support** dans le menu latéral.

### Modifier un emplacement
Sélectionnez **Modifier** à côté, choisissez **Par défaut**, une adresse ou un lien à vous, ou **Masquer**, puis sélectionnez **Enregistrer**. **Demander une démo** et **Signaler un bug ou demander une fonctionnalité** sont des interrupteurs, enregistrés dès que vous les basculez.

### Vérifier ce que voient les personnes
Le menu d'aide et l'écran de connexion sont prévisualisés à côté de leurs paramètres. Les personnes voient un changement la prochaine fois qu'elles ouvrent une page.
:::

Tant que vous ne modifiez pas un emplacement, il affiche ce que OneUptime a toujours affiché : un serveur qui n'ouvre jamais la page reste donc exactement comme avant.

## Ce que change chaque paramètre

| Paramètre | Où les personnes le voient | Par défaut | Personnalisé |
| --- | --- | --- | --- |
| **E-mail de support** | Aide › **E-mail de support**, **Contacter le support** sur la page introuvable, et l'adresse à laquelle un écran d'erreur demande d'envoyer un pack de support | `support@oneuptime.com` | Une adresse e-mail |
| **Chat** | Aide › **Discuter sur Slack** | La communauté OneUptime sur Slack | Un lien. Un lien Slack ou Microsoft Teams garde son nom ; tout autre lien s'appelle **Discuter avec le support** |
| **Demander une démo** | Aide › **Demander une démo** | Affiché | Masqué uniquement |
| **Donner votre avis** | Aide › **Donner votre avis**, et **Donner votre avis** dans la recherche | Les administrateurs de ce serveur | Une adresse e-mail, ou votre propre page |
| **Aide et support** | **Aide et support** dans le pied de page, et **Contact** sur les pages de connexion | `https://oneuptime.com/support` | Un lien |
| **Signaler un bug ou demander une fonctionnalité** | Le bas du menu des produits, et l'issue GitHub publique proposée après un avis | Affiché | Masqué uniquement |
| **Obtenir l'app mobile** | **Comment me joindre**, la configuration de l'astreinte, les premiers pas d'un nouveau membre sur la page Accueil, et **Applications mobiles** dans **Paramètres du projet** | L'App Store et Google Play | Votre propre page, par exemple le portail d'entreprise de votre gestionnaire d'appareils |
| **Message pour les personnes qui ont besoin d'une invitation** | Les écrans d'authentification unique qui disent « You need to be invited. » et « No project access. » | La phrase de OneUptime | Vos propres mots |

Chaque paramètre, sauf le message, peut aussi être masqué. Un lien commence par `https://`, `http://` ou `mailto:`. Tout autre type de lien, dont `javascript:`, est refusé par la page, puis à nouveau par le serveur.

Le menu d'aide, le pied de page et le menu des produits du Admin Dashboard lui-même gardent les liens de OneUptime : ils s'adressent aux administrateurs de ce serveur, qui obtiennent de l'aide sur le serveur auprès de OneUptime.

### Qui peut lire vos liens

L'adresse de support et le lien **Aide et support** s'affichent aussi sur les pages de connexion : toute personne qui peut ouvrir ces pages peut donc les lire. Un lien de chat et la page de l'app mobile ne sont envoyés qu'aux personnes connectées : un lien de chat est souvent une invitation dans votre espace de travail.

## Donner votre avis

| Choix | Ce qui se passe |
| --- | --- |
| **Par défaut** | Comme toujours : envoyé par e-mail à l'**E-mail de notification admin** défini dans **Paramètres** › **E-mails**, ou conservé pour les administrateurs de ce serveur dans **Retours** s'il n'y en a pas. Sur OneUptime Cloud, il va à l'équipe OneUptime. |
| **Une adresse e-mail** | Envoyé par e-mail à cette adresse via les paramètres e-mail de ce serveur, avec le nom et l'adresse e-mail de la personne, pour que votre équipe puisse répondre. La personne reçoit une copie. |
| **Votre propre page** | **Donner votre avis** l'ouvre dans un nouvel onglet, par exemple le formulaire de votre service d'assistance. Rien n'est envoyé depuis OneUptime. |
| **Masquer « Donner votre avis »** | **Donner votre avis** n'est proposé nulle part. |

Tant que le serveur ne peut pas envoyer d'e-mails, choisir une adresse e-mail masque **Donner votre avis** au lieu d'accepter un message qui ne peut pas atteindre votre équipe, et la page des paramètres l'indique. Configurez l'e-mail dans **Paramètres** › **E-mails**, et **Donner votre avis** revient de lui-même.

Les questions que pose OneUptime, comme la facilité d'une configuration guidée, ne relèvent pas de **Donner votre avis** : leurs réponses restent dans **Retours**, où **Demander comment ça s'est passé** les désactive.

## Le message de connexion

L'authentification unique propre au serveur refuse deux types de personnes : quelqu'un sans compte, tant que le fournisseur n'en crée pas (« You need to be invited. »), et quelqu'un dont le compte n'appartient à aucun projet (« No project access. »). Les deux ont besoin d'une invitation, donc les deux écrans affichent votre message, avec la personne à qui s'adresser et la façon de la joindre :

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Le message est du texte brut de 1000 caractères au plus, et ne peut pas contenir `<` ni `>`.
- Chaque ligne est un paragraphe, et les liens et adresses e-mail qu'elle contient deviennent des liens.
- Le titre de l'écran reste tel quel, et l'app mobile affiche les mêmes mots.

## Les incitations à obtenir l'app mobile

Avec votre propre page, chaque incitation à obtenir l'app mobile pointe vers elle : un seul code QR pour votre page, nommé d'après son adresse, et les étapes indiquent toujours l'adresse de ce serveur à laquelle l'app se connecte. Si le paramètre est masqué, il n'y a plus aucune incitation :

- **Obtenir l'app mobile** disparaît des premiers pas d'un nouveau membre sur la page Accueil, qui se terminent quand même lorsque la personne peut être jointe et qu'un appel de test l'a jointe.
- **Comment me joindre** et la configuration de l'astreinte ne proposent que les navigateurs.
- **Applications mobiles** disparaît de **Paramètres du projet**.

## Étapes suivantes

:::cards
- [SSO global](/docs/identity/global-sso) : L'authentification unique propre au serveur.
- [Durée de session](/docs/self-hosted/session-length) : Combien de temps les personnes restent connectées.
:::
