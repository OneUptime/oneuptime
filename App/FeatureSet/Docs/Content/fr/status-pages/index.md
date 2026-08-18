# Vue d'ensemble des pages de statut

Une page de statut est le visage public de tout ce que vous surveillez : une seule URL que vos clients peuvent ouvrir au lieu de vous écrire pour savoir si le problème vient de chez eux. Elle montre l'état courant des services que vous choisissez d'exposer, les incidents sur lesquels vous travaillez, la maintenance que vous avez planifiée, et toute annonce que vous voulez épingler en haut.

Quand quelque chose casse à 2 h du matin, la page de statut est la première chose que votre support met en lien. C'est aussi depuis elle que vos abonnés sont prévenus — d'où l'intérêt de la préparer avant d'en avoir besoin, pas pendant la panne.

Les pages de statut vivent sous **Pages de statut** dans la navigation de gauche du tableau de bord, dans le groupe **essentials**. Tout ce qui suit se règle page par page : un projet peut en faire tourner autant qu'il veut — une publique pour les clients, une privée pour un public interne, une par région pour un marché précis.

## En un coup d'œil

- **Créée avec deux champs.** Une nouvelle page de statut ne demande que **Nom** et **Description**. Ressources, image de marque et domaines se configurent ensuite.
- **Les ressources sont ce que voient les visiteurs.** Chaque ligne de la page est une **Page de statut Ressource** — un moniteur (ou un groupe de moniteurs) avec son propre nom d'affichage, son infobulle et ses options de disponibilité. Les groupes découpent une page trop longue en sections et peuvent être imbriqués.
- **Une URL de prévisualisation dès le premier jour.** Chaque page de statut reçoit un lien d'aperçu pour que vous puissiez la regarder avant même qu'un domaine personnalisé existe.
- **Les routes visibles par les visiteurs dépendent des paramètres.** Incidents, annonces, événements planifiés et page d'abonnement n'apparaissent chacun que lorsque leur bascule est activée dans les **Paramètres avancés**.
- **Trois façons de la rendre privée.** Des utilisateurs privés, un mot de passe maître, ou SAML SSO / OIDC — plus une liste blanche d'IP.
- **Les abonnés sont prévenus automatiquement.** Des abonnés e-mail, SMS, Slack, Microsoft Teams et webhook peuvent tous suivre une page, chaque canal derrière sa propre bascule.

## Termes clés

| Terme                             | Ce que cela désigne                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Page de statut**                | Une page publique (ou privée), avec sa propre image de marque, ses domaines, ses ressources et ses abonnés. Le modèle `StatusPage`.        |
| **Ressource**                     | Une ligne vue par les visiteurs — un moniteur ou un groupe de moniteurs exposé sur la page avec un nom d'affichage et des options de disponibilité. |
| **Groupe**                        | Une section nommée qui contient des ressources. Les groupes s'imbriquent les uns dans les autres, et chaque niveau agrège l'état de tout ce qui se trouve en dessous. |
| **Annonce**                       | Un message que vous publiez sur une ou plusieurs pages de statut, avec une date de début et une date de fin facultative.                   |
| **Abonné**                        | Quelqu'un (ou quelque chose) qui suit la page par e-mail, SMS, Slack, Microsoft Teams ou webhook.                                          |
| **Domaine personnalisé**          | Un domaine à vous — `status.example.com` — pointé vers la page par un CNAME et un certificat SSL.                                          |
| **Utilisateur privé**             | Un compte qui peut se connecter à une page de statut privée. Distinct des utilisateurs de votre projet OneUptime.                          |

## Créer une page de statut

1. Ouvrez **Pages de statut → Toutes les pages de statut** et cliquez sur **Créer une page de statut**.
2. Dans la fenêtre **Create New Status Page**, renseignez **Nom** (obligatoire, au moins deux caractères) et, si vous le souhaitez, **Description**.
3. Cliquez sur **Créer une page de statut**.

C'est tout le formulaire de création. La liste sur laquelle vous retombez affiche **Nom**, **Description**, **Étiquettes** et **Propriétaires**, et se filtre par **ID de la page de statut**, **Nom** et **Description**.

Ouvrez la nouvelle page et vous atterrissez sur son écran **Vue d'ensemble**, qui porte deux cartes : **Status Page Preview URL**, avec un lien vers la page elle-même, et **Détails de la page de statut**, où vous pouvez modifier le nom, la description et les étiquettes que vous venez de définir.

Ensuite, à peu près par ordre d'utilité :

- Ajoutez des ressources pour que la page ait quelque chose à montrer — voyez [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups).
- Réglez le titre de la page, la favicon, le logo et la couverture, puis rattachez un domaine personnalisé — voyez [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains).
- Décidez sur quels canaux les gens peuvent s'abonner — voyez [Abonnés et annonces](/docs/status-pages/subscribers).
- Ajustez ce qui apparaît sur la page depuis les **Paramètres avancés**.

## Où se trouve chaque chose

Une fois une page de statut ouverte, son propre menu latéral se répartit en neuf sections. Servez-vous-en comme carte pour le reste de ce groupe de documentation.

| Section                     | Ce qu'elle contient                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basique**                 | **Vue d'ensemble**, **Annonces**, **Propriétaires**.                                                                                           |
| **Ressources**              | Un unique écran **Ressources** — les groupes à gauche, les moniteurs du groupe sélectionné à droite.                                           |
| **Abonnés**                 | **Abonnés e-mail**, **Abonnés SMS**, **Abonnés Slack**, **Abonnés MS Teams**, **Abonnés au webhook**, **Paramètres des abonnés**.               |
| **Journaux de notification** | **Journaux de notification** — ce qui a été envoyé aux abonnés.                                                                               |
| **Audit**                   | **Journaux d'audit**.                                                                                                                          |
| **Image de marque**         | **Image de marque essentielle**, **HTML, CSS et JavaScript**, **Domaines personnalisés**, **En-tête**, **Pied de page**, **Page de vue d'ensemble**, **Langues**. |
| **Sécurité**                | **Utilisateurs privés**, **SSO**, **OIDC**, **SCIM**, **Paramètres d'authentification**.                                                        |
| **IA**                      | **MCP**.                                                                                                                                       |
| **Avancé**                  | **Monitor Rules**, **Statut intégré**, **Rapports**, **Champs personnalisés**, **Paramètres avancés**, **Supprimer la page de statut**.         |

Deux bizarreries de nommage à connaître avant de partir en quête :

- L'entrée **Ressources** ne s'appelle **Ressources** que si le projet a les groupes de moniteurs activés. Sinon elle s'appelle **Moniteurs**. C'est le même écran dans les deux cas.
- Il n'y a pas de page Groupes distincte. Groupes et ressources ont été fusionnés, et l'ancienne route `/groups` redirige désormais vers l'écran des ressources.

En dehors d'une page individuelle, la section **Pages de statut** elle-même possède une section **Plus** contenant **Annonces**, ainsi qu'une section **Paramètres** repliée qui regroupe **Modèles d'annonce**, **Modèles d'abonnés**, **Champs personnalisés**, **Règles de propriétaire** et **Règles d'étiquettes** — celles-ci valent pour tout le projet et sont partagées par toutes les pages de statut.

## Ce que voient les visiteurs

La page publique est sa propre application, avec un petit jeu de routes :

- `/` — l'**Aperçu**.
- `/incidents` et `/incidents/:id` — la liste des incidents et un incident précis.
- `/announcements` et `/announcements/:id`.
- `/scheduled-events` et `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — le flux.
- `/login`, `/sso` et `/master-password` — pertinents uniquement sur une page privée.

La barre de navigation du haut affiche toujours **Aperçu** ; le reste n'apparaît qu'une fois activé. **Incidents**, **Annonces** et **Événements planifiés** ont chacun besoin de leur bascule ; **S'abonner** exige à la fois **Afficher la page des abonnés** et au moins un canal d'abonnement activé. Une page privée gagne en plus une entrée **Se déconnecter**.

### La page de vue d'ensemble

L'aperçu est la page que la plupart des visiteurs verront. De haut en bas, elle affiche :

1. **Les annonces en cours** — celles dont l'heure de début est passée et dont l'heure de fin ne l'est pas.
2. **Une bannière d'état global** — une seule ligne résumant si toutes les ressources ou seulement certaines sont touchées.
3. **Un pourcentage de disponibilité global**, si vous l'avez activé. Désactivé par défaut.
4. **Les groupes de ressources**, chacun avec ses ressources, leur état courant et leurs barres d'historique de disponibilité.
5. **Incidents actifs**.
6. **Événements de maintenance planifiée**.

Une page toute neuve et encore vide affiche un état vide vous invitant à ajouter des ressources depuis le tableau de bord — le signal qu'il est temps de filer vers l'écran **Ressources**.

Pour comprendre ce qui fait apparaître un incident sur cette page, et ce qui l'en retire, voyez [États et sévérités des incidents](/docs/incidents/states-and-severities).

## Choisir ce qui s'affiche sur la page

L'essentiel des interrupteurs d'affichage tient en un seul endroit : **Pages de statut → votre page → Avancé → Paramètres avancés**. Chaque carte a son propre bouton **Edit Settings**.

**Paramètres des incidents** :

- **Afficher les incidents** (`showIncidentsOnStatusPage`) — activé par défaut. Le désactiver retire aussi l'entrée de navigation **Incidents**.
- **Afficher l'historique des incidents (en jours)** (`showIncidentHistoryInDays`) — jusqu'où remonte la liste des incidents. 14 par défaut.
- **Afficher les étiquettes d'incident** (`showIncidentLabelsOnStatusPage`) — désactivé par défaut.

**Paramètres de l'épisode** — les trois mêmes interrupteurs pour les épisodes d'incident : **Afficher les épisodes** (`showEpisodesOnStatusPage`, activé par défaut), **Afficher l'historique des épisodes (en jours)** (14 par défaut) et **Afficher les étiquettes d'épisode** (désactivé par défaut). Les épisodes sont un modèle à part entière, avec leurs propres points de terminaison ; ce n'est pas une vue sur les incidents.

**Paramètres de l'annonce** :

- **Afficher les annonces** (`showAnnouncementsOnStatusPage`) — activé par défaut.
- **Afficher l'historique des annonces (en jours)** (`showAnnouncementHistoryInDays`) — 14 par défaut.

**Paramètres des événements planifiés** :

- **Afficher les événements de maintenance planifiée** (`showScheduledMaintenanceEventsOnStatusPage`) — activé par défaut.
- **Afficher l'historique des événements planifiés (en jours)** (`showScheduledEventHistoryInDays`) — 14 par défaut.
- **Afficher les étiquettes d'événement** (`showScheduledEventLabelsOnStatusPage`) — désactivé par défaut.

**Paramètres de l'historique de disponibilité** :

- **Afficher l'historique de disponibilité (en jours)** (`showUptimeHistoryInDays`) — la longueur de la barre de disponibilité affichée à côté de chaque ressource. 90 par défaut, et doit rester entre 1 et 90. Chaque option **Afficher le % de disponibilité** et **Afficher le graphique de l'historique des états** d'une ressource ou d'un groupe lit ce nombre.

**Paramètres des abonnés** :

- **Afficher la page des abonnés** (`showSubscriberPageOnStatusPage`) — activé par défaut, plus les cinq bascules d'activation par canal. Ces mêmes bascules de canal apparaissent aussi sur l'écran dédié **Paramètres des abonnés**, sous la section **Abonnés** ; considérez celui-là comme l'endroit canonique où les régler.

**Image de marque « Propulsé par OneUptime »** :

- **Masquer la mention « Propulsé par OneUptime »** — désactivé par défaut, si bien que le pied de page visiteur affiche « Propulsé par OneUptime » tant que vous ne l'activez pas.

**Où sont les couleurs.** Les couleurs de la barre de disponibilité ne sont pas ici — la **Couleur de barre par défaut**, les règles de couleur de barre, les **Statuts de moniteur d'indisponibilité** et **Afficher le pourcentage de disponibilité global** vivent tous dans **Pages de statut → votre page → Image de marque → Page de vue d'ensemble**. Il n'existe nulle part de réglage de thème ou de couleur de marque ; tout ce qui dépasse ces contrôles passe par du **CSS personnalisé**.

## Prévisualiser avant la mise en ligne

L'écran **Vue d'ensemble** de chaque page de statut porte une carte **Status Page Preview URL** avec un lien direct vers la page. Servez-vous-en pendant que vous ajoutez encore des ressources et avant qu'un domaine personnalisé existe.

En coulisses, chaque route publique a son jumeau de prévisualisation sous `/status-page/{statusPageId}/...` — un aperçu de la vue d'ensemble, un aperçu de la liste des incidents, un aperçu de la page d'abonnement, et ainsi de suite. Autrement dit, une URL ou une capture prise depuis l'aperçu du tableau de bord ne correspondra pas à ce que voit un client une fois le domaine personnalisé rattaché : revérifiez tout lien que vous collez dans un runbook ou dans un e-mail.

## Restreindre qui peut voir la page

Toutes les pages de statut ne sont pas destinées au public. Les contrôles se trouvent dans la section **Sécurité**.

### Utilisateurs privés

Désactivez **Est visible par le public** dans **Pages de statut → votre page → Sécurité → Paramètres d'authentification** (la colonne `isPublicStatusPage`). Les visiteurs atterrissent alors sur `/login` et doivent se connecter.

Ajoutez les personnes autorisées à se connecter dans **Pages de statut → votre page → Sécurité → Utilisateurs privés**. Une action **Ajouter en masse** est disponible : collez une liste d'adresses e-mail et chacune reçoit un e-mail d'invitation. Les utilisateurs privés ont leurs propres parcours de mot de passe oublié et de réinitialisation, distincts de vos comptes de projet OneUptime.

### Mot de passe maître

Les **Paramètres d'authentification** portent aussi une carte **Mot de passe maître**, avec une bascule **Exiger le mot de passe principal** et le mot de passe lui-même. Les visiteurs tombent alors sur `/master-password` et déverrouillent la page avec un unique secret partagé.

**Mot de passe maître et utilisateurs privés ne se cumulent pas.** Tant que le mot de passe maître est actif, l'authentification par utilisateur privé est désactivée, et l'écran **Utilisateurs privés** affiche une bannière qui vous le rappelle.

### SSO et OIDC

Pour une page privée adossée à votre fournisseur d'identité, **Pages de statut → votre page → Sécurité → SSO** configure SAML (URL de connexion, émetteur, certificat x509, méthodes de signature et de condensat) et **Pages de statut → votre page → Sécurité → OIDC** configure OpenID Connect (URL de découverte, émetteur, ID et secret client, portées, noms de revendications). **SCIM** provisionne automatiquement les utilisateurs privés depuis l'IdP. Ces fonctions dépendent d'une option de forfait ; elles ne sont donc pas disponibles sur toutes les installations.

Une carte **Paramètres SSO** expose **Forcer le SSO pour la connexion** (`requireSsoForLogin`, désactivé par défaut). Testez votre configuration SSO avant de l'activer — si elle ne fonctionne pas, vous vous verrouillerez vous-même hors de la page de statut.

### Liste blanche d'IP

Les **Paramètres d'authentification** portent également une carte **Liste blanche d'IP**, adossée à la colonne `ipWhitelist`, pour les pages qui ne doivent répondre qu'à des réseaux connus.

## Le badge intégrable et le flux RSS

Deux façons de faire apparaître le statut ailleurs que sur la page elle-même.

**Badge de statut intégré.** Activez **Activer le badge de statut intégré** (`enableEmbeddedOverallStatus`, désactivé par défaut) dans la carte **Badge de statut intégré** de **Pages de statut → votre page → Avancé → Statut intégré**. Il fonctionne de pair avec un `embeddedOverallStatusToken` et sert le badge depuis `/badge/:statusPageId`, ce qui vous permet de glisser l'état global courant dans votre documentation, dans le pied de page de votre application ou sur une page marketing.

**Flux RSS.** Chaque page de statut sert `/rss` — un flux intitulé « Mises à jour de {nom de la page de statut} » dont les éléments sont préfixés `Incident: `, `Announcement: ` et `Scheduled Maintenance: `. Pratique pour ceux qui préfèrent envoyer vos mises à jour dans un lecteur ou un bot de discussion plutôt que de s'abonner par e-mail.

Si vous préférez récupérer les données vous-même, la page de statut s'appuie sur des points de terminaison publics en lecture pour la vue d'ensemble, les incidents, les événements de maintenance planifiée, les annonces et les épisodes — voyez [API publique](/docs/status-pages/public-api).

## Où lire ensuite

- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) — mettre des moniteurs sur la page et les organiser en sections.
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains) — logo, favicon, pied de page, code personnalisé, et pointer votre propre domaine vers la page.
- [Abonnés et annonces](/docs/status-pages/subscribers) — les cinq canaux d'abonnement, le double opt-in et la publication d'annonces.
- [API publique](/docs/status-pages/public-api) — lire les données de la page de statut par programme.
- [Vue d'ensemble des incidents](/docs/incidents/index) — les événements qui apparaissent sur la page.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui fait apparaître un incident sur une page de statut, et ce qui l'en retire.
