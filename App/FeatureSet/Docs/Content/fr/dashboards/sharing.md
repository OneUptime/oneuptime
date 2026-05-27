# Partage et tableaux de bord publics

Par défaut, les tableaux de bord sont privés à votre projet — seuls les membres connectés à l'équipe peuvent les voir. Mais OneUptime vous permet aussi de partager un tableau de bord publiquement, de le protéger par un mot de passe, de le restreindre à certaines IP et de l'héberger sur votre propre domaine. Cette page couvre les quatre.

## Tableaux de bord privés (par défaut)

Un tableau de bord n'est accessible qu'aux membres connectés de votre projet. L'URL ressemble à `https://oneuptime.com/dashboards/<id>/view` et nécessite une connexion.

À l'intérieur du projet, les propriétaires et les étiquettes contrôlent qui voit quoi — voir [Configuration et permissions](/docs/dashboards/configuration).

## Tableaux de bord publics

Sous **Dashboard → Settings**, activez **Public Dashboard**. Le tableau de bord dispose désormais d'une seconde URL qui ne nécessite pas de connexion. Partagez-la avec des fournisseurs, des partenaires, des clients, ou collez-la dans un README public.

Un tableau de bord public :

- S'ouvre toujours en mode **View**. Les visiteurs publics ne peuvent ni le modifier ni voir la palette des widgets.
- Inclut les variables que vous avez ajoutées. Les visiteurs choisissent dans les mêmes listes déroulantes que votre équipe.
- Utilise l'**identité visuelle** définie dans Settings — titre de page, description, logo, favicon.

Considérez l'activation d'un tableau de bord public comme la publication d'une page web. Chaque widget devient lisible par tous. Examinez ce qui se trouve sur le canevas avant de basculer l'interrupteur.

## Mot de passe maître

Pour mettre un mot de passe sur un tableau de bord public :

1. Activez **Public Dashboard**.
2. Activez **Master Password**.
3. Définissez le mot de passe.

Les visiteurs voient une invite de mot de passe avant que le tableau de bord n'apparaisse. Le mot de passe est stocké sous forme de hachage — nous ne voyons jamais le mot de passe réel.

Utilisez un mot de passe maître quand :

- Vous voulez partager avec un partenaire ou un client mais ne voulez pas que l'URL soit utile si elle fuite.
- Le tableau de bord est « semi-public » — assez ouvert pour ne pas vouloir inviter chaque visiteur en tant que membre de l'équipe, mais pas assez ouvert pour le poser sur l'Internet ouvert.

Pour un contrôle plus strict (comptes séparés par visiteur, journal d'audit de qui a vu quoi), gardez le tableau de bord privé et invitez les visiteurs comme membres en lecture seule.

## Liste d'IP autorisées

Sur le plan **Scale**, vous pouvez restreindre un tableau de bord public à une liste d'adresses IP ou de plages. Configurez-la sous **Dashboard → Settings → IP Whitelist**.

À utiliser quand :

- Le tableau de bord ne doit être accessible que depuis votre bureau ou votre VPN.
- Un portail fournisseur ne doit être accessible que depuis leurs IP connues.
- Vous voulez une protection supplémentaire en plus d'un mot de passe maître.

Les requêtes provenant d'une autre IP sont rejetées.

## Domaines personnalisés

Par défaut, un tableau de bord public est servi sur `oneuptime.com`. Pour l'héberger sur votre propre sous-domaine comme `dashboard.acme.com` :

1. Ajoutez un enregistrement CNAME sur votre DNS pointant le sous-domaine vers la cible OneUptime.
2. Sous **Dashboard → Settings → Custom Domains**, ajoutez le domaine.
3. Vérifiez-le. OneUptime contrôle l'enregistrement DNS pour vous.
4. Une fois vérifié, le tableau de bord est accessible à la fois sur votre domaine personnalisé et sur l'URL d'origine.

Les domaines personnalisés sont utiles pour :

- Des tableaux de bord clients sous votre propre marque.
- Des tableaux de bord co-marqués avec un partenaire.
- Des pages de santé publiques avec leur propre URL.

Vous pouvez attacher plus d'un domaine personnalisé à un même tableau de bord si vous servez le même contenu à plusieurs audiences.

## Identité visuelle

Sous **Dashboard → Settings**, vous pouvez configurer :

- **Titre de page** — ce qui s'affiche dans l'onglet du navigateur et en haut de la page.
- **Description de page** — la description utilisée par les moteurs de recherche et les aperçus sur les réseaux sociaux.
- **Logo** — chargez un PNG ou un SVG à afficher dans l'en-tête.
- **Favicon** — la petite icône dans l'onglet du navigateur.

L'identité visuelle ne s'applique que lorsque le tableau de bord est consulté publiquement. Les visiteurs internes voient toujours l'identité visuelle de OneUptime.

## Intégration

Vous pouvez intégrer un tableau de bord public dans votre propre site à l'aide d'une iframe :

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Si le tableau de bord est protégé par un mot de passe maître, les visiteurs verront l'invite de mot de passe à l'intérieur de l'iframe.

## URL partageables

L'URL du tableau de bord inclut les sélections de variables et la plage temporelle actuelles en tant que paramètres de requête. Ajustez les listes déroulantes, copiez l'URL, collez-la dans une discussion — la personne qui ouvre le lien voit le tableau de bord avec exactement la même vue.

C'est la manière la plus rapide d'orienter un coéquipier vers « le tableau de bord au moment où l'incident a commencé ». Fixez la plage temporelle, copiez, collez.

## Pour aller plus loin

- [Configuration et permissions](/docs/dashboards/configuration) — contrôle d'accès en mode privé.
- [Variables et filtres](/docs/dashboards/variables) — variables avec lesquelles les visiteurs peuvent interagir.
- [Création d'un tableau de bord](/docs/dashboards/authoring) — ce qui se trouve sur le canevas.
