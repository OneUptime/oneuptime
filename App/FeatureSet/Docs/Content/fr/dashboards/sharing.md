# Partage et tableaux de bord publics

La plupart des tableaux de bord sont privés à votre projet — seuls les membres connectés du projet peuvent les voir. Mais OneUptime vous permet aussi de publier un tableau de bord sur une URL publique, de le protéger optionnellement par un mot de passe, de le restreindre par IP et de l'héberger sur un domaine personnalisé. Cette page couvre les quatre.

## Tableaux de bord privés (par défaut)

Par défaut, un tableau de bord n'est accessible qu'aux utilisateurs connectés qui sont membres du projet. L'URL ressemble à `https://oneuptime.com/dashboards/<id>/view`. L'accès direct nécessite une authentification et la permission de lecture appropriée sur le tableau de bord.

Au sein du projet, la propriété et les étiquettes contrôlent qui voit quoi — voir [Configuration et permissions](/docs/dashboards/configuration).

## Tableaux de bord publics

Sous **Tableau de bord → Settings**, activez **Public Dashboard**. Le tableau de bord a maintenant une seconde URL qui ne nécessite pas de connexion. Partagez-la avec des fournisseurs, partenaires, clients, ou collez-la dans un README public.

Un tableau de bord public :

- Se rend en mode **View** uniquement. Les visiteurs publics ne peuvent pas éditer, changer la plage temporelle (sauf via URL) ni voir la palette de widgets.
- Inclut les variables que vous avez définies — les visiteurs peuvent choisir dans les listes déroulantes comme les utilisateurs internes.
- Porte le **branding** que vous configurez sous Settings : titre de page, description de page, fichier de logo, favicon. Ce sont ces éléments qui apparaissent dans l'onglet du navigateur et dans les aperçus sociaux.

Traitez l'activation de **Public Dashboard** comme la publication d'une page web. Chaque widget sur le tableau de bord est maintenant lisible par le monde entier. Auditez ce qui est sur le canevas avant de basculer l'interrupteur.

## Mot de passe maître

Pour fermer un tableau de bord public avec un mot de passe au lieu de le rendre totalement ouvert :

1. Activez **Public Dashboard**.
2. Activez **Master Password**.
3. Définissez le mot de passe.

Les visiteurs reçoivent une invite de mot de passe avant que le tableau de bord ne se rende. Le mot de passe est haché au repos ; seul le hash est stocké.

Utilisez un mot de passe maître quand :

- Vous voulez partager avec un partenaire ou un client mais ne voulez pas que l'URL soit valide si elle fuit.
- Le tableau de bord est « semi-public » — assez ouvert pour ne pas vouloir de comptes OneUptime pour chaque visualiseur, mais pas assez ouvert pour le mettre sur l'Internet ouvert.

Pour un cloisonnement à plus forte valeur (comptes par visualiseur, piste d'audit de qui a vu quoi), gardez le tableau de bord privé et invitez les visualiseurs au projet en tant que membres en lecture seule.

## Liste blanche d'IP

Sur le plan **Scale**, vous pouvez restreindre un tableau de bord public à une liste d'IP source ou de plages CIDR. Configurez la liste sous **Tableau de bord → Settings → IP Whitelist**.

Utilisez une liste blanche d'IP quand :

- Le tableau de bord ne doit être accessible que depuis votre bureau ou VPN.
- Un portail fournisseur ne doit être accessible que depuis leurs IP sortantes publiées.
- Vous voulez une défense en profondeur en plus d'un mot de passe maître.

Les requêtes depuis toute autre IP reçoivent un 403.

## Domaines personnalisés

Par défaut, un tableau de bord public est servi sur `oneuptime.com`. Pour l'héberger sur votre propre sous-domaine (par exemple, `dashboard.acme.com`) :

1. Ajoutez un enregistrement CNAME sur votre DNS pointant le sous-domaine vers la cible publiée par OneUptime.
2. Sous **Tableau de bord → Settings → Custom Domains**, ajoutez le domaine.
3. Vérifiez l'enregistrement DNS (OneUptime le vérifie pour vous).
4. Une fois vérifié, le tableau de bord est accessible à la fois sur l'URL OneUptime et sur votre domaine personnalisé.

Les domaines personnalisés sont utiles pour :

- Tableaux de bord orientés client à votre marque.
- Tableaux de bord co-brandés avec partenaires.
- SEO sur une page de santé publique.

Vous pouvez attacher plusieurs domaines personnalisés à un seul tableau de bord si vous servez le même contenu à plusieurs audiences.

## Branding pour les tableaux de bord publics

Sous **Tableau de bord → Settings**, configurez :

- **Titre de page** — la balise `<title>` et le titre que voient les visiteurs.
- **Description de page** — la méta-description utilisée par les moteurs de recherche et les aperçus sociaux.
- **Fichier de logo** — téléchargez un PNG/SVG ; affiché dans l'en-tête du tableau de bord.
- **Favicon** — téléchargé ; affiché dans l'onglet du navigateur.

Le branding ne s'applique qu'au rendu en mode public. Les visualiseurs internes voient toujours le branding OneUptime.

## Intégration

Vous pouvez intégrer un tableau de bord public dans une `<iframe>` sur votre propre site :

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Si vous intégrez un tableau de bord protégé par un mot de passe maître, le visiteur voit toujours l'invite de mot de passe à l'intérieur de l'iframe.

## URL partageables avec état de variable

L'URL du tableau de bord encode les sélections de variables actuelles et la plage temporelle comme paramètres de requête. Ajustez les listes déroulantes, copiez l'URL et collez-la dans un chat — le destinataire voit le tableau de bord avec exactement la même vue, y compris la plage temporelle que vous regardiez.

C'est le moyen le plus rapide de pointer un coéquipier vers « le tableau de bord au moment où l'incident a commencé » — épinglez la plage temporelle, copiez, collez.

## Où lire ensuite

- [Configuration et permissions](/docs/dashboards/configuration) — contrôle d'accès en mode privé.
- [Variables et filtres](/docs/dashboards/variables) — variables avec lesquelles les visiteurs publics peuvent interagir.
- [Créer un tableau de bord](/docs/dashboards/authoring) — ce qui va sur le canevas en premier lieu.
