# Personnalisation et domaines personnalisés

Une page de statut est la seule surface de OneUptime que vos clients regardent vraiment : elle devrait donc vous ressembler et vivre sur votre propre domaine. Ces deux points se configurent depuis la section **Image de marque** du menu latéral d'une page de statut, plus un réglage caché dans les **Paramètres avancés**.

Ce qu'il faut savoir avant de commencer : l'image de marque est répartie sur sept écrans distincts, et la répartition n'est pas toujours là où vous l'imagineriez. Le logo et l'image de couverture ne sont pas sur **Image de marque essentielle** — ils sont sur **En-tête**. Le favicon est sur **Image de marque essentielle**. Les couleurs sont sur **Page de vue d'ensemble**. Tout le reste de ce que vous pourriez appeler « thème » passe par du CSS personnalisé.

Cette page parcourt chaque écran l'un après l'autre, puis vous guide dans la séquence complète CNAME-puis-SSL pour placer la page sur `status.yourcompany.com`.

## Où se trouve chaque contrôle d'image de marque

Ouvrez une page de statut, et la section **Image de marque** du menu latéral comporte sept éléments. Voici la carte, pour que vous cessiez de chercher.

| Page                           | Ce que vous y réglez                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Image de marque essentielle** | Titre de la page, description de la page, indexation par les moteurs de recherche, favicon.                             |
| **En-tête**                    | Logo, image de couverture, leurs textes alternatifs, et la barre de liens de l'en-tête.                                   |
| **Pied de page**               | Ligne de copyright et barre de liens du pied de page.                                                                    |
| **Page de vue d'ensemble**     | Description de la vue d'ensemble, couleurs des barres du graphique d'historique, statuts d'indisponibilité, pourcentage de disponibilité global. |
| **HTML, CSS et JavaScript**    | HTML d'en-tête, HTML du pied de page, CSS personnalisé, JavaScript personnalisé.                                          |
| **Domaines personnalisés**     | Votre propre domaine, la vérification du CNAME et le SSL.                                                                |
| **Langues**                    | Langue par défaut et langues proposées dans le sélecteur du pied de page.                                                |

## Image de marque essentielle

**Pages de statut → votre page → Image de marque → Image de marque essentielle** (`{id}/branding`) contient trois cartes.

- **Titre et description** — la carte précise que cela sert aussi au référencement. **Modifier** ouvre **Titre de la page** (texte indicatif `Please enter page title here.`) et **Description de la page**. C'est ce qu'affichent les moteurs de recherche et les aperçus de liens : écrivez-le pour un client, pas pour votre équipe.
- **Search Engine Indexing** — une simple bascule, **Allow Search Engines to Index this Status Page**, décrite dans le produit comme déterminant si Google et Bing peuvent lister la page dans leurs résultats. Elle est activée par défaut. Désactivez-la et la page est servie avec `noindex, nofollow`.
- **Favicon** — **Edit Favicon** ouvre le téléversement d'image **Favicon**. C'est la petite icône dans l'onglet du navigateur.

Utilisez-le quand : la page est réservée à un usage interne ou encore en cours de configuration. Désactivez **Allow Search Engines to Index this Status Page** pour qu'une page à moitié terminée ne commence pas à se positionner sur le nom de votre marque.

## L'écran En-tête

**Pages de statut → votre page → Image de marque → En-tête** (`{id}/header-style`). Malgré le nom dans le menu latéral, c'est ici que vivent vos deux plus gros actifs de marque.

La première carte s'intitule **Logo, couverture et favicon**, avec un bouton **Edit Images** :

- **Logo** — téléversement d'image, texte indicatif `Upload logo`.
- **Logo Alt Text** — texte indicatif `Logo of My Company`. Si vous le laissez vide, le titre de la page de statut est utilisé à la place.
- **Couverture** — téléversement d'image, texte indicatif `Upload cover image`. C'est la large bannière derrière l'en-tête.
- **Cover Image Alt Text** — la même idée pour la couverture.

En dessous se trouve un tableau **Liens d'en-tête** (« Header Links for your status page »). Chaque lien a un **Titre** et un **Lien** (une URL, texte indicatif `https://link.com`), et les lignes se réordonnent par glisser-déposer. Sans lien configuré, le tableau indique « Aucun lien d'en-tête de statut pour cette page de statut. »

Bien pour : renvoyer les visiteurs vers votre site marketing, votre documentation ou un portail de support sans leur faire deviner l'URL.

## L'écran Pied de page

**Pages de statut → votre page → Image de marque → Pied de page** (`{id}/footer-style`) a la même forme que **En-tête**, une carte et un tableau.

- **Informations de copyright** — **Edit Copyright** ouvre un champ unique, **Informations de copyright**, avec le texte indicatif `Acme, Inc.`.
- **Liens du pied de page** — la même paire **Titre** plus **Lien**, ordonnée par glisser-déposer, message vide « Aucun lien de pied de page de statut pour cette page de statut. »

Les liens légaux, de confidentialité et de conditions d'utilisation ont leur place ici. Les liens d'en-tête servent à la navigation ; ceux du pied de page servent aux mentions légales.

## Image de marque de la page de vue d'ensemble

**Pages de statut → votre page → Image de marque → Page de vue d'ensemble** (`{id}/overview-page-branding`) est le seul écran où les couleurs sont configurables, et il décide aussi de ce que « en panne » signifie sur le graphique.

- **Page de vue d'ensemble** — **Edit Branding** ouvre un champ markdown, **Description de la page de vue d'ensemble.**, qui s'affiche au-dessus de la liste des ressources. Servez-vous-en pour une phrase de contexte : ce que couvre cette page, et où aller pour obtenir de l'aide.
- **Rules for Bar Colors of History Chart** — un tableau de règles ordonné et réordonnable par glisser-déposer. Chaque règle comporte **Lorsque le % de disponibilité est supérieur ou égal à** et **Ensuite, utilisez cette couleur de barre** ; les colonnes du tableau indiquent `When Uptime Percent >=` et `Then, Bar Color is`. L'ordre compte : disposez-les dans l'ordre où vous voulez qu'elles soient évaluées.
- **Statuts de moniteur d'indisponibilité** — **Edit Statuses** ouvre une sélection multiple décrite comme « ces statuts de moniteur sont considérés comme en panne ». C'est ainsi que vous décidez si, par exemple, un statut dégradé compte contre la disponibilité sur cette page.
- **Couleur de barre par défaut du graphique d'historique** — **Edit Default Bar Color** ouvre le sélecteur **Couleur de barre par défaut**, la couleur utilisée quand aucune règle ne correspond.
- **Pourcentage de disponibilité global** — **Edit Settings** ouvre la bascule **Afficher le pourcentage de disponibilité global** et une liste **Sélectionner la précision de disponibilité**, qui vaut deux décimales par défaut (`99.99% (Two Decimal)`).

**Le nombre de jours couverts par le graphique ne se règle pas ici.** C'est **Afficher l'historique de disponibilité (en jours)** dans **Pages de statut → votre page → Avancé → Paramètres avancés** (`{id}/settings`), valide de 1 à 90.

## HTML, CSS et JavaScript personnalisés

**Pages de statut → votre page → Image de marque → HTML, CSS et JavaScript** (`{id}/custom-code`) comporte quatre cartes modifiables indépendamment, adossées aux colonnes `headerHTML`, `footerHTML`, `customCSS` et `customJavaScript` de la page de statut :

- **HTML d'en-tête** — texte indicatif `Insert Custom HTML here.`, injecté dans l'en-tête de la page.
- **HTML du pied de page** — la même chose, pour le pied de page.
- **CSS personnalisé** — texte indicatif `Insert Custom CSS here.`
- **JavaScript personnalisé** — texte indicatif `Insert Custom JavaScript here.`

**Il n'y a pas de sélecteur de thème.** Les pages de statut OneUptime n'ont aucun paramètre de thème ni de couleur de marque : les seuls contrôles de couleur intégrés sont **Couleur de barre par défaut** et les règles de couleur de barre du graphique d'historique, sur l'écran **Page de vue d'ensemble**. Polices, couleurs de fond, couleurs d'accent et ajustements de mise en page passent tous par le **CSS personnalisé** ici. Si vous cherchiez un champ « couleur de marque », voilà la réponse — il n'y en a pas, et cette zone est la porte de sortie.

> Le JavaScript personnalisé s'exécute dans les navigateurs de vos visiteurs, sur une page que les gens chargent précisément quand ils s'inquiètent que quelque chose soit cassé. Gardez-le léger, hébergez-le chez vous quand vous le pouvez, et testez-le avant d'en dépendre.

## Paramètres de langue

**Pages de statut → votre page → Image de marque → Langues** (`{id}/languages`) comporte deux cartes, et toutes deux concernent le sélecteur de langue proposé aux visiteurs dans le pied de page.

- **Langue par défaut** — **Edit Default Language** ouvre une liste déroulante énumérant chaque langue prise en charge par son nom natif et son nom anglais (`Deutsch (German)`). La carte la décrit comme la langue que voient les visiteurs pour la première fois ; les visiteurs peuvent toujours changer depuis le pied de page. Elle vaut l'anglais par défaut.
- **Langues activées** — **Edit Enabled Languages** ouvre une sélection multiple, texte indicatif `All languages`. Laissez-la vide et toutes les langues prises en charge sont proposées. Choisissez-en quelques-unes et le sélecteur du pied de page ne liste que celles-là.

Seize langues sont livrées avec OneUptime : anglais, allemand, français, espagnol, italien, portugais, néerlandais, danois, norvégien, suédois, russe, japonais, coréen, chinois (simplifié), chinois (traditionnel) et hindi.

## Domaines personnalisés

Par défaut, une page de statut est accessible à l'URL d'aperçu affichée sur son écran **Vue d'ensemble**. Pour la placer sur votre propre nom d'hôte, allez dans **Pages de statut → votre page → Image de marque → Domaines personnalisés** (`{id}/domains`).

La carte s'intitule **Domaines personnalisés** et sa description énonce l'exigence directement : ajoutez l'enregistrement CNAME de page de statut de votre installation comme CNAME de ces domaines pour que cela fonctionne. Sans configuration, le tableau indique « Aucun domaine personnalisé trouvé. » Le tableau comporte deux colonnes, **Domaine** et **Statut**, et des filtres pour **Domaine**, **CNAME valide** et **SSL provisionné**.

### Avant de commencer

Deux prérequis, et en négliger un est la raison habituelle pour laquelle cela ne fonctionne pas :

- **Le domaine parent doit déjà être vérifié.** La liste déroulante **Domaine** ne liste que les domaines vérifiés dans les paramètres du projet — le texte d'aide du champ vous renvoie vers **Plus → Paramètres du projet → Domaines personnalisés** pour en ajouter un d'abord.
- **L'installation doit avoir un enregistrement CNAME de page de statut configuré.** Sur les déploiements auto-hébergés, il s'agit de la variable d'environnement `STATUS_PAGE_CNAME_RECORD` dans Docker Compose, ou de `statusPage.cnameRecord` dans le `values.yaml` de Helm. Sans cela, les fenêtres **Ajouter un CNAME** et **Commander un SSL gratuit** affichent un message « Custom Domains not enabled for this OneUptime installation » au lieu des instructions.

### Ajouter le domaine

Cliquez sur **Create Status Page Domain**. La fenêtre (**Create New Status Page Domain**) comporte deux étapes :

**Basique**

- **Sous-domaine** — l'étiquette uniquement, texte indicatif `status (leave blank for root)`. Saisissez juste `status`, pas le nom d'hôte complet. Laissez-le vide ou saisissez `@` pour utiliser le domaine racine/apex.
- **Domaine** — une liste déroulante de domaines vérifiés, texte indicatif `Select domain`.

**Plus**

- **Téléverser un certificat personnalisé** — une bascule, désactivée par défaut. Laissez-la désactivée et OneUptime commande un certificat gratuit pour vous. Activez-la et vous obtenez les champs **Certificat** et **Clé privée du certificat** pour votre propre matériel PEM.

## Vérifier le CNAME

Tant que le domaine n'est pas vérifié, la ligne affiche une action **Ajouter un CNAME**. Elle ouvre une fenêtre intitulée **Ajouter un CNAME** qui vous donne exactement ce qu'il faut coller dans votre fournisseur DNS :

- **Type d'enregistrement** — `CNAME`
- **Nom** — le domaine complet que vous venez de créer, par exemple `status.yourcompany.com`
- **Contenu** — l'enregistrement CNAME de page de statut de votre installation

La fenêtre précise qu'une fois l'enregistrement en place, la vérification automatique peut prendre jusqu'à 24 heures. Vous n'avez pas à attendre : le bouton de soumission de la fenêtre est **Vérifier le CNAME**, qui contrôle l'enregistrement à la demande.

Créez d'abord l'enregistrement DNS, puis cliquez sur **Vérifier le CNAME**. Cliquer avant que l'enregistrement n'existe échoue tout simplement.

## Commander un certificat SSL

Une fois le CNAME vérifié — et seulement si vous n'avez pas téléversé votre propre certificat — une action **Commander un SSL gratuit** apparaît sur la ligne. Sa fenêtre, **Order Free SSL Certificate for this Status Page**, explique que OneUptime utilise LetsEncrypt, que le processus est sûr et gratuit, et que le provisionnement prend quelques heures après la commande. Le bouton de soumission est **Commander un SSL gratuit**.

**Les délais annoncés diffèrent d'un écran à l'autre** : ne surinterprétez donc aucun chiffre en particulier. La fenêtre de commande dit trois heures, la colonne **Statut** dit une heure, et un certificat personnalisé dit trente minutes. Traitez-les tous comme « revenez plus tard dans la journée », et contactez le support si rien ne s'est produit d'ici là.

Une fois provisionné, le renouvellement est automatique. Il n'y a rien de récurrent à faire de votre côté.

## Lire la colonne Statut du domaine

La colonne **Statut** est toute la machine à états de la configuration en une seule cellule. Chaque message vous dit soit quoi faire ensuite, soit que vous avez terminé.

| Ce qu'indique la colonne Statut                       | Signification                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | Le CNAME n'est pas encore vérifié. Ajoutez l'enregistrement, puis **Vérifier le CNAME**. |
| Action Required: Please order SSL certificate.        | Le CNAME est vérifié mais aucun certificat n'est commandé. Cliquez sur **Commander un SSL gratuit**. |
| No action is required, allow 30 minutes to provision. | Vous avez téléversé un certificat personnalisé et il est en cours d'installation.       |
| No action is required, this will be provisioned soon. | Le certificat gratuit est commandé et en route. Contactez le support s'il n'arrive jamais. |
| Certificate Provisioned. No action required.          | Terminé. OneUptime renouvelle le certificat automatiquement.                            |

Si une ligne reste sur « Action Required: Please add your CNAME record. » longtemps après que vous avez créé l'entrée DNS, vérifiez que le nom de l'enregistrement est bien le domaine complet et que son contenu correspond exactement à l'enregistrement CNAME de votre installation.

## Propulsé par OneUptime

La ligne « Propulsé par OneUptime » n'est pas un réglage de la section image de marque. Elle vit dans **Pages de statut → votre page → Avancé → Paramètres avancés** (`{id}/settings`), dans la carte **Image de marque « Propulsé par OneUptime »**, sous forme d'une simple bascule : **Masquer la mention « Propulsé par OneUptime »**. **Edit Settings** l'ouvre, comme pour toutes les autres cartes de cette page.

## Pour aller plus loin

- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'est une page de statut et comment les pièces s'assemblent.
- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) — choisir ce que les visiteurs voient réellement sur la page.
- [Abonnés et annonces](/docs/status-pages/subscribers) — abonnés e-mail, SMS, Slack et webhook, plus les annonces.
- [API publique](/docs/status-pages/public-api) — lire les données de page de statut par programmation.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui fait apparaître et disparaître un incident de la page.
