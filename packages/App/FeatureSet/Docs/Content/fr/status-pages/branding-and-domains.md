# Image de marque et domaines personnalisés

Une page de statut est la seule surface OneUptime que vos clients regardent vraiment : elle doit donc vous ressembler et vivre sur votre propre domaine. Ces deux points se configurent depuis la section **Image de marque** du menu latéral d'une page de statut, plus un réglage qui se cache dans les **Paramètres avancés**.

Ce qu'il faut savoir avant de commencer : l'image de marque est répartie sur sept écrans distincts, et la coupure ne tombe pas toujours là où on l'imagine. Le logo et l'image de couverture ne sont pas sur **Image de marque essentielle** — ils sont sur **En-tête**. La favicon, elle, est sur **Image de marque essentielle**. Les couleurs sont sur **Page de vue d'ensemble**. Tout le reste de ce qu'on appelle « thème » passe par du CSS personnalisé.

Cette page parcourt chaque écran à son tour, puis vous fait dérouler toute la séquence CNAME-puis-SSL pour installer la page sur `status.votreentreprise.com`.

## Où vit chaque contrôle d'image de marque

Ouvrez une page de statut : la section **Image de marque** du menu latéral compte sept entrées. Voici la carte, pour que vous cessiez de chercher.

| Écran                          | Ce que vous y réglez                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Image de marque essentielle** | Titre de la page, description de la page, indexation par les moteurs de recherche, favicon.                                 |
| **En-tête**                    | Logo, image de couverture, leurs textes alternatifs, et la barre de liens de l'en-tête.                                      |
| **Pied de page**               | Ligne de copyright et barre de liens du pied de page.                                                                        |
| **Page de vue d'ensemble**     | Description de la vue d'ensemble, couleurs des barres du graphique d'historique, statuts d'indisponibilité, disponibilité globale. |
| **HTML, CSS et JavaScript**    | HTML d'en-tête, HTML de pied de page, CSS personnalisé, JavaScript personnalisé.                                             |
| **Domaines personnalisés**     | Votre propre domaine, la vérification du CNAME et le SSL.                                                                    |
| **Langues**                    | Langue par défaut et langues proposées dans le sélecteur du pied de page.                                                    |

## Image de marque essentielle

**Pages de statut → votre page → Image de marque → Image de marque essentielle** (`{id}/branding`) contient trois cartes.

- **Titre et description** — la carte précise que cela sert aussi au référencement. **Modifier** ouvre **Titre de la page** (texte indicatif `Please enter page title here.`) et **Description de la page**. C'est ce qu'affichent les moteurs de recherche et les aperçus de liens : écrivez-le pour un client, pas pour votre équipe.
- **Search Engine Indexing** — une seule bascule, **Allow Search Engines to Index this Status Page**, décrite dans le produit comme déterminant si Google et Bing peuvent faire figurer la page dans leurs résultats. Elle est activée par défaut. Désactivez-la et la page est servie avec `noindex, nofollow`.
- **Favicon** — **Edit Favicon** ouvre le téléversement de l'image **Favicon**. C'est la petite icône de l'onglet du navigateur.

À utiliser quand : la page est purement interne, ou encore en cours de préparation. Désactivez alors **Allow Search Engines to Index this Status Page** pour éviter qu'une page à moitié finie ne se mette à ressortir sur le nom de votre marque.

## L'écran En-tête

**Pages de statut → votre page → Image de marque → En-tête** (`{id}/header-style`). Malgré son nom dans le menu latéral, c'est ici que vivent vos deux plus gros actifs de marque.

La première carte s'intitule **Logo, couverture et favicon**, avec un bouton **Edit Images** :

- **Logo** — téléversement d'image, texte indicatif `Upload logo`.
- **Logo Alt Text** — texte indicatif `Logo of My Company`. Si vous le laissez vide, c'est le titre de la page de statut qui est utilisé.
- **Couverture** — téléversement d'image, texte indicatif `Upload cover image`. C'est la large bannière derrière l'en-tête.
- **Cover Image Alt Text** — la même idée pour la couverture.

En dessous se trouve une table **Liens d'en-tête** (« Header Links for your status page »). Chaque lien a un **Titre** et un **Lien** (une URL, texte indicatif `https://link.com`), et les lignes se réordonnent par glisser-déposer. Sans aucun lien configuré, la table affiche « Aucun lien d'en-tête de statut pour cette page de statut. »

Bien pour : renvoyer les visiteurs vers votre site marketing, votre documentation ou un portail de support sans les laisser deviner l'URL.

## L'écran Pied de page

**Pages de statut → votre page → Image de marque → Pied de page** (`{id}/footer-style`) a la même forme que l'**En-tête** : une carte et une table.

- **Informations de copyright** — **Edit Copyright** ouvre un champ unique, **Informations de copyright**, avec le texte indicatif `Acme, Inc.`.
- **Liens du pied de page** — le même couple **Titre** et **Lien**, ordonné par glisser-déposer, avec le message vide « Aucun lien de pied de page de statut pour cette page de statut. »

Les liens légaux, de confidentialité et de conditions d'utilisation ont leur place ici. Les liens d'en-tête servent à la navigation ; ceux du pied de page, aux mentions.

## Image de marque de la page de vue d'ensemble

**Pages de statut → votre page → Image de marque → Page de vue d'ensemble** (`{id}/overview-page-branding`) est le seul écran où des couleurs se configurent, et c'est aussi lui qui décide de ce que « en panne » veut dire sur le graphique.

- **Page de vue d'ensemble** — **Edit Branding** ouvre un champ markdown, **Description de la page de vue d'ensemble.**, qui s'affiche au-dessus de la liste des ressources. Servez-vous-en pour une phrase de contexte : ce que couvre cette page, et où aller pour obtenir de l'aide.
- **Rules for Bar Colors of History Chart** — une table de règles ordonnée et réordonnable par glisser-déposer. Chaque règle porte **When uptime % is greater than or equal to** et **Then, use this bar color** ; les colonnes de la table, elles, s'intitulent `When Uptime Percent >=` et `Then, Bar Color is`. L'ordre compte : rangez-les dans l'ordre où vous voulez qu'elles soient évaluées.
- **Statuts de moniteur d'indisponibilité** — **Edit Statuses** ouvre une sélection multiple décrite comme « These monitor statuses are considered as down ». C'est ainsi que vous décidez si, par exemple, un statut dégradé pèse ou non sur la disponibilité de cette page.
- **Couleur de barre par défaut du graphique d'historique** — **Edit Default Bar Color** ouvre le sélecteur **Couleur de barre par défaut**, la couleur utilisée quand aucune règle ne s'applique.
- **Pourcentage de disponibilité global** — **Edit Settings** ouvre la bascule **Afficher le pourcentage de disponibilité global** et une liste **Sélectionner la précision de disponibilité**, réglée sur deux décimales par défaut (`99.99% (Two Decimal)`).

**Le nombre de jours couverts par le graphique ne se règle pas ici.** C'est **Afficher l'historique de disponibilité (en jours)**, dans **Pages de statut → votre page → Avancé → Paramètres avancés** (`{id}/settings`), avec une valeur comprise entre 1 et 90.

## HTML, CSS et JavaScript personnalisés

**Pages de statut → votre page → Image de marque → HTML, CSS et JavaScript** (`{id}/custom-code`) réunit quatre cartes modifiables indépendamment, adossées aux colonnes `headerHTML`, `footerHTML`, `customCSS` et `customJavaScript` de la page de statut :

> Le HTML, le CSS et le JavaScript personnalisés actifs ne sont servis que sur un domaine personnalisé vérifié. Ils sont désactivés sur l'URL par défaut `/status-page/:id`, car celle-ci partage la même origine que l'espace OneUptime authentifié.

- **HTML d'en-tête** — texte indicatif `Insert Custom HTML here.`, injecté dans l'en-tête de la page.
- **HTML du pied de page** — la même chose, pour le pied de page.
- **CSS personnalisé** — texte indicatif `Insert Custom CSS here.`
- **JavaScript personnalisé** — texte indicatif `Insert Custom JavaScript here.`

**Il n'y a pas de sélecteur de thème.** Les pages de statut OneUptime n'ont aucun réglage de thème ni de couleur de marque : les seuls contrôles de couleur intégrés, où que ce soit, sont la **Couleur de barre par défaut** et les règles de couleur de barre du graphique d'historique, sur l'écran **Page de vue d'ensemble**. Polices, couleurs de fond, couleurs d'accentuation et retouches de mise en page passent tous par le **CSS personnalisé** d'ici. Si vous cherchiez un champ « couleur de marque », voilà la réponse : il n'y en a pas, et cette zone est l'échappatoire.

> Le JavaScript personnalisé s'exécute dans le navigateur de vos visiteurs, sur une page qu'ils chargent précisément quand ils s'inquiètent d'une panne. Gardez-le léger, hébergez-le chez vous autant que possible, et testez-le avant d'en dépendre.

## Paramètres de langue

**Pages de statut → votre page → Image de marque → Langues** (`{id}/languages`) comporte deux cartes, toutes deux consacrées au sélecteur de langue proposé aux visiteurs dans le pied de page.

- **Langue par défaut** — **Edit Default Language** ouvre une liste déroulante qui présente chaque langue prise en charge par son nom natif et son nom anglais (`Deutsch (German)`). La carte la décrit comme la langue que voient les visiteurs de passage ; ceux-ci peuvent toujours en changer depuis le pied de page. Elle vaut anglais par défaut.
- **Langues activées** — **Edit Enabled Languages** ouvre une sélection multiple, texte indicatif `All languages`. Laissez-la vide et toutes les langues prises en charge sont proposées. Choisissez-en quelques-unes et le sélecteur du pied de page ne liste que celles-là.

Seize langues sont livrées avec OneUptime : anglais, allemand, français, espagnol, italien, portugais, néerlandais, danois, norvégien, suédois, russe, japonais, coréen, chinois (simplifié), chinois (traditionnel) et hindi.

## Domaines personnalisés

Par défaut, une page de statut est accessible via l'URL de prévisualisation affichée sur son écran **Vue d'ensemble**. Pour la placer sur votre propre nom d'hôte, allez dans **Pages de statut → votre page → Image de marque → Domaines personnalisés** (`{id}/domains`).

La carte s'intitule **Domaines personnalisés** et sa description énonce l'exigence sans détour : ajoutez l'enregistrement CNAME de page de statut de votre installation comme CNAME de ces domaines pour que cela fonctionne. Sans rien de configuré, la table affiche « Aucun domaine personnalisé trouvé. » La table a deux colonnes, **Domaine** et **Statut**, et des filtres pour **Domaine**, **CNAME valide** et **SSL provisionné**.

### Avant de commencer

Deux prérequis, et en omettre un est la raison habituelle pour laquelle rien ne marche :

- **Le domaine parent doit déjà être vérifié.** La liste **Domaine** ne présente que les domaines vérifiés depuis les paramètres du projet — le texte d'aide du champ vous renvoie vers **Plus → Paramètres du projet → Domaines personnalisés** pour en ajouter un d'abord.
- **L'installation doit avoir un enregistrement CNAME de page de statut configuré.** Sur les déploiements auto-hébergés, c'est la variable d'environnement `STATUS_PAGE_CNAME_RECORD` dans Docker Compose, ou `statusPage.cnameRecord` dans le `values.yaml` Helm. Sans elle, les fenêtres **Ajouter un CNAME** et **Commander un SSL gratuit** affichent un message « Custom Domains not enabled for this OneUptime installation » à la place des instructions.

### Ajouter le domaine

Cliquez sur **Create Status Page Domain**. La fenêtre (**Create New Status Page Domain**) comporte deux étapes :

**Basique**

- **Sous-domaine** — l'étiquette seule, texte indicatif `status (leave blank for root)`. Saisissez juste `status`, pas le nom d'hôte complet. Laissez vide ou saisissez `@` pour utiliser le domaine racine.
- **Domaine** — une liste déroulante de domaines vérifiés, texte indicatif `Select domain`.

**Plus**

- **Téléverser un certificat personnalisé** — une bascule, désactivée par défaut. Laissez-la désactivée et OneUptime commande un certificat gratuit pour vous. Activez-la et vous obtenez les champs **Certificat** et **Clé privée du certificat** pour votre propre matériel PEM.

## Vérifier le CNAME

Tant que le domaine n'est pas vérifié, la ligne propose une action **Ajouter un CNAME**. Elle ouvre une fenêtre intitulée **Ajouter un CNAME** qui vous donne exactement ce qu'il faut coller chez votre fournisseur DNS :

- **Type d'enregistrement** — `CNAME`
- **Nom** — le domaine complet que vous venez de créer, par exemple `status.votreentreprise.com`
- **Contenu** — l'enregistrement CNAME de page de statut de votre installation

La fenêtre précise qu'une fois l'enregistrement en place, la vérification automatique peut prendre jusqu'à 24 heures. Vous n'êtes pas obligé d'attendre : le bouton de validation de la fenêtre est **Vérifier le CNAME**, qui contrôle l'enregistrement à la demande.

Créez d'abord l'enregistrement DNS, puis cliquez sur **Vérifier le CNAME**. Cliquer avant que l'enregistrement existe échoue, tout simplement.

## Commander un certificat SSL

Une fois le CNAME vérifié — et seulement si vous n'avez pas téléversé votre propre certificat — une action **Commander un SSL gratuit** apparaît sur la ligne. Sa fenêtre, **Order Free SSL Certificate for this Status Page**, explique que OneUptime utilise LetsEncrypt, que la démarche est sûre et gratuite, et que le provisionnement prend quelques heures après la commande. Le bouton de validation est **Commander un SSL gratuit**.

**Les délais annoncés ne concordent pas d'un écran à l'autre**, alors ne prenez aucun chiffre au pied de la lettre : la fenêtre de commande parle de trois heures, la colonne **Statut** d'une heure, et un certificat personnalisé de trente minutes. Traitez-les tous comme un « repassez plus tard dans la journée », et contactez le support si rien n'a bougé d'ici là.

Une fois provisionné, le renouvellement est automatique. Vous n'avez plus rien de récurrent à faire.

## Lire la colonne Statut du domaine

La colonne **Statut** contient à elle seule toute la machine à états de la configuration. Chaque message vous dit soit quoi faire ensuite, soit que c'est terminé.

| Ce qu'affiche la colonne Statut                       | Ce que cela veut dire                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | Le CNAME n'est pas encore vérifié. Ajoutez l'enregistrement, puis **Vérifier le CNAME**. |
| Action Required: Please order SSL certificate.        | Le CNAME est vérifié mais aucun certificat n'est commandé. Cliquez sur **Commander un SSL gratuit**. |
| No action is required, allow 30 minutes to provision. | Vous avez téléversé un certificat personnalisé et son installation est en cours.         |
| No action is required, this will be provisioned soon. | Le certificat gratuit est commandé et en route. Contactez le support s'il n'arrive jamais. |
| Certificate Provisioned. No action required.          | Terminé. OneUptime renouvelle le certificat automatiquement.                             |

Si une ligne reste bloquée sur « Action Required: Please add your CNAME record. » longtemps après la création de l'entrée DNS, vérifiez que le nom de l'enregistrement est bien le domaine complet et que son contenu correspond exactement à l'enregistrement CNAME de votre installation.

## Propulsé par OneUptime

La mention « Propulsé par OneUptime » n'est pas un réglage de la section image de marque. Elle vit dans **Pages de statut → votre page → Avancé → Paramètres avancés** (`{id}/settings`), dans la carte **Image de marque « Propulsé par OneUptime »**, sous forme d'une bascule unique : **Masquer la mention « Propulsé par OneUptime »**. **Edit Settings** l'ouvre, comme toutes les autres cartes de cet écran.

## Où lire ensuite

- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'est une page de statut et comment les pièces s'assemblent.
- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) — choisir ce que les visiteurs voient réellement sur la page.
- [Abonnés et annonces](/docs/status-pages/subscribers) — abonnés e-mail, SMS, Slack et webhook, plus les annonces.
- [API publique](/docs/status-pages/public-api) — lire les données de la page de statut par programme.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui fait apparaître un incident sur la page et ce qui l'en fait disparaître.
