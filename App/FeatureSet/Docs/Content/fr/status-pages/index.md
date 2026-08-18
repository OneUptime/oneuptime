# Vue d'ensemble des pages de statut

Une page de statut est le visage public de tout ce que vous surveillez : une seule URL que vos clients peuvent ouvrir au lieu de vous écrire pour savoir si le problème ne vient que d'eux. Elle montre l'état actuel des services que vous choisissez d'exposer, les incidents sur lesquels vous travaillez, les maintenances que vous avez planifiées, et toute annonce que vous voulez épingler en haut.

Quand quelque chose casse à 2 h du matin, la page de statut est la première chose vers laquelle votre file de support renvoie. C'est aussi ce depuis quoi vos abonnés sont notifiés — il vaut donc la peine de la configurer avant d'en avoir besoin, et non pendant la panne.

Les pages de statut se trouvent sous **Pages de statut** dans la navigation de gauche du tableau de bord, dans le groupe **Essentiels**. Tout sur cette page est propre à chaque page de statut : un projet peut en faire tourner autant qu'il le souhaite — une publique pour les clients, une privée pour un public interne, une par région pour un marché donné.

## En un coup d'œil

- **Créée avec deux champs.** Une nouvelle page de statut ne demande que **Nom** et **Description**. Ressources, image de marque et domaines se configurent ensuite.
- **Les ressources sont ce que voient les visiteurs.** Chaque ligne de la page est une **ressource de page de statut** — un moniteur (ou un groupe de moniteurs) avec son propre nom d'affichage, son infobulle et ses options de disponibilité. Les groupes découpent une longue page en sections et peuvent être imbriqués.
- **Une URL d'aperçu dès le premier jour.** Chaque page de statut reçoit un lien d'aperçu pour que vous puissiez la regarder avant qu'un domaine personnalisé n'existe.
- **Les routes destinées aux visiteurs sont conditionnées par les paramètres.** Incidents, annonces, événements planifiés et page d'abonnement n'apparaissent chacun que lorsque leur bascule dans les **Paramètres avancés** est activée.
- **Trois façons de la rendre privée.** Des utilisateurs privés, un mot de passe maître, ou SAML SSO / OIDC — plus une liste blanche d'IP.
- **Les abonnés sont prévenus automatiquement.** Les abonnés par e-mail, SMS, Slack, Microsoft Teams et webhook peuvent tous suivre une page, chaque canal derrière sa propre bascule.

## Termes clés

| Terme                     | Signification                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Page de statut**        | Une page publique (ou privée), avec sa propre image de marque, ses domaines, ses ressources et ses abonnés. Le modèle `StatusPage`.               |
| **Ressource**             | Une ligne que voient les visiteurs — un moniteur ou un groupe de moniteurs exposé sur la page avec un nom d'affichage et des options de disponibilité. |
| **Groupe**                | Une section nommée qui contient des ressources. Les groupes s'imbriquent dans d'autres groupes, et chaque niveau agrège le statut de tout ce qui se trouve en dessous. |
| **Annonce**               | Un message que vous publiez sur une ou plusieurs pages de statut, avec une heure de début et une heure de fin facultative.                        |
| **Abonné**                | Quelqu'un (ou quelque chose) qui suit la page par e-mail, SMS, Slack, Microsoft Teams ou webhook.                                                 |
| **Domaine personnalisé**  | Un domaine à vous — `status.example.com` — pointé vers la page avec un CNAME et un certificat SSL.                                                |
| **Utilisateur privé**     | Un compte pouvant se connecter à une page de statut privée. Distinct des utilisateurs de votre projet OneUptime.                                  |

## Créer une page de statut

1. Ouvrez **Pages de statut → Toutes les pages de statut** et cliquez sur **Créer une page de statut**.
2. Dans la fenêtre **Create New Status Page**, renseignez **Nom** (obligatoire, au moins deux caractères) et, facultativement, **Description**.
3. Cliquez sur **Créer une page de statut**.

C'est tout le formulaire de création. La liste sur laquelle vous revenez affiche **Nom**, **Description**, **Étiquettes** et **Propriétaires**, et peut être filtrée par **ID de la page de statut**, **Nom** et **Description**.

Ouvrez la nouvelle page et vous arrivez sur son écran **Vue d'ensemble**, qui porte deux cartes : **Status Page Preview URL** avec un lien vers la page elle-même, et **Détails de la page de statut** où vous pouvez modifier le nom, la description et les étiquettes que vous venez de définir.

Ensuite, dans un ordre d'utilité approximatif :

- Ajoutez des ressources pour que la page ait quelque chose dessus — voyez [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups).
- Définissez le titre de la page, le favicon, le logo et la couverture, puis rattachez un domaine personnalisé — voyez [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains).
- Décidez sur quels canaux les gens peuvent s'abonner — voyez [Abonnés et annonces](/docs/status-pages/subscribers).
- Ajustez ce qui apparaît sur la page depuis les **Paramètres avancés**.

## Où se trouve chaque chose

Une fois une page de statut ouverte, son propre menu latéral gauche est regroupé en neuf sections. Utilisez ceci comme carte pour le reste de ce groupe de documentation.

| Section                     | Ce qu'elle contient                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basique**                 | **Vue d'ensemble**, **Annonces**, **Propriétaires**.                                                                                                       |
| **Ressources**              | Un unique écran **Ressources** — les groupes à gauche, les moniteurs du groupe sélectionné à droite.                                                       |
| **Abonnés**                 | **Abonnés e-mail**, **Abonnés SMS**, **Abonnés Slack**, **Abonnés MS Teams**, **Abonnés au webhook**, **Paramètres des abonnés**.                          |
| **Journaux de notification** | **Journaux de notification** — ce qui a été envoyé aux abonnés.                                                                                           |
| **Audit**                   | **Journaux d'audit**.                                                                                                                                      |
| **Image de marque**         | **Image de marque essentielle**, **HTML, CSS et JavaScript**, **Domaines personnalisés**, **En-tête**, **Pied de page**, **Page de vue d'ensemble**, **Langues**. |
| **Sécurité**                | **Utilisateurs privés**, **SSO**, **OIDC**, **SCIM**, **Paramètres d'authentification**.                                                                    |
| **IA**                      | **MCP**.                                                                                                                                                   |
| **Avancé**                  | **Monitor Rules**, **Statut intégré**, **Rapports**, **Champs personnalisés**, **Paramètres avancés**, **Supprimer la page de statut**.                     |

Deux bizarreries de nommage à connaître avant d'aller chercher :

- L'élément **Ressources** ne s'appelle **Ressources** que lorsque le projet a les groupes de moniteurs activés. Sinon il s'intitule **Moniteurs**. C'est le même écran dans les deux cas.
- Il n'y a pas de page Groupes distincte. Groupes et ressources ont été fusionnés, et l'ancienne route `/groups` redirige désormais vers l'écran des ressources.

En dehors d'une page individuelle, la section **Pages de statut** elle-même comporte une section **Plus** avec **Annonces**, et une section **Paramètres** repliée contenant **Modèles d'annonce**, **Modèles d'abonnés**, **Champs personnalisés**, **Règles de propriétaire** et **Règles d'étiquettes** — celles-ci valent pour tout le projet, partagées entre toutes les pages de statut.

## Ce que voient les visiteurs

La page publique est sa propre application, avec un petit ensemble de routes :

- `/` — l'**Aperçu**.
- `/incidents` et `/incidents/:id` — la liste des incidents et un incident donné.
- `/announcements` et `/announcements/:id`.
- `/scheduled-events` et `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — le flux.
- `/login`, `/sso` et `/master-password` — pertinentes uniquement sur une page privée.

La barre de navigation supérieure affiche toujours **Aperçu** ; le reste n'apparaît que lorsque c'est activé. **Incidents**, **Annonces** et **Événements planifiés** nécessitent chacun leur bascule ; **S'abonner** nécessite à la fois **Afficher la page des abonnés** et au moins un canal d'abonnement activé. Une page privée obtient également un élément **Logout**.

### La page de vue d'ensemble

La vue d'ensemble est la page que la plupart des visiteurs voient. De haut en bas, elle affiche :

1. **Les annonces en cours** — les annonces dont l'heure de début est passée et dont l'heure de fin ne l'est pas.
2. **Une bannière de statut global** — une seule ligne résumant si toutes les ressources ou seulement certaines sont affectées.
3. **Un pourcentage de disponibilité global**, si vous l'avez activé. Désactivé par défaut.
4. **Les groupes de ressources**, chacun avec ses ressources, leur statut actuel et leurs barres d'historique de disponibilité.
5. **Incidents actifs**.
6. **Événements de maintenance planifiée**.

Une page toute neuve et vide affiche un état vide vous invitant à ajouter des ressources depuis le tableau de bord — ce qui est votre signal pour filer vers l'écran **Ressources**.

Pour savoir ce qui met un incident sur cette page en premier lieu, et ce qui l'en retire, voyez [États et sévérités des incidents](/docs/incidents/states-and-severities).

## Choisir ce qui apparaît sur la page

La plupart des interrupteurs d'affichage se trouvent au même endroit : **Pages de statut → votre page → Avancé → Paramètres avancés**. Chaque carte a son propre bouton **Edit Settings**.

**Paramètres des incidents** :

- **Afficher les incidents** (`showIncidentsOnStatusPage`) — activé par défaut. Le désactiver retire aussi l'élément de navigation **Incidents**.
- **Afficher l'historique des incidents (en jours)** (`showIncidentHistoryInDays`) — jusqu'où remonte la liste des incidents. Vaut 14 par défaut.
- **Afficher les étiquettes d'incident** (`showIncidentLabelsOnStatusPage`) — désactivé par défaut.

**Paramètres de l'épisode** — les trois mêmes interrupteurs pour les épisodes d'incident : **Afficher les épisodes** (`showEpisodesOnStatusPage`, activé par défaut), **Afficher l'historique des épisodes (en jours)** (14 par défaut), et **Afficher les étiquettes d'épisode** (désactivé par défaut). Les épisodes sont leur propre modèle avec leurs propres points de terminaison, et non une vue des incidents.

**Paramètres de l'annonce** :

- **Afficher les annonces** (`showAnnouncementsOnStatusPage`) — activé par défaut.
- **Afficher l'historique des annonces (en jours)** (`showAnnouncementHistoryInDays`) — vaut 14 par défaut.

**Paramètres des événements planifiés** :

- **Afficher les événements de maintenance planifiée** (`showScheduledMaintenanceEventsOnStatusPage`) — activé par défaut.
- **Afficher l'historique des événements planifiés (en jours)** (`showScheduledEventHistoryInDays`) — vaut 14 par défaut.
- **Afficher les étiquettes d'événement** (`showScheduledEventLabelsOnStatusPage`) — désactivé par défaut.

**Paramètres de l'historique de disponibilité** :

- **Afficher l'historique de disponibilité (en jours)** (`showUptimeHistoryInDays`) — la longueur de la barre de disponibilité à côté de chaque ressource. Vaut 90 par défaut et doit être compris entre 1 et 90. Chaque option **Afficher le % de disponibilité** et **Afficher le graphique de l'historique des états** d'une ressource ou d'un groupe lit ce nombre.

**Paramètres des abonnés** :

- **Afficher la page des abonnés** (`showSubscriberPageOnStatusPage`) — activé par défaut, plus les cinq bascules d'activation par canal. Les mêmes bascules de canal apparaissent aussi sur l'écran dédié **Paramètres des abonnés**, sous la section **Abonnés** ; considérez celui-ci comme l'endroit canonique pour les régler.

**Image de marque « Propulsé par OneUptime »** :

- **Masquer la mention « Propulsé par OneUptime »** — désactivé par défaut, de sorte que le pied de page visiteur indique « Propulsé par OneUptime » jusqu'à ce que vous l'activiez.

**Où sont les couleurs.** Les couleurs de la barre de disponibilité ne sont pas ici — la **Couleur de barre par défaut**, les règles de couleur de barre, les **Statuts de moniteur d'indisponibilité** et **Afficher le pourcentage de disponibilité global** vivent tous dans **Pages de statut → votre page → Image de marque → Page de vue d'ensemble**. Il n'existe nulle part de paramètre de thème ou de couleur de marque ; tout ce qui va au-delà de ces contrôles se fait avec du **CSS personnalisé**.

## Prévisualiser avant la mise en ligne

L'écran **Vue d'ensemble** de chaque page de statut porte une carte **Status Page Preview URL** avec un lien direct vers la page. Utilisez-la pendant que vous ajoutez encore des ressources et avant qu'un domaine personnalisé n'existe.

En coulisses, chaque route publique a un jumeau d'aperçu sous `/status-page/{statusPageId}/...` — un aperçu de la vue d'ensemble, un aperçu de la liste des incidents, un aperçu de la page d'abonnement, et ainsi de suite. Cela signifie qu'une URL ou une capture prise depuis l'aperçu du tableau de bord ne correspondra pas à ce que voit un client une fois un domaine personnalisé rattaché : vérifiez donc deux fois tout lien que vous collez dans un runbook ou un e-mail.

## Restreindre qui peut voir la page

Toutes les pages de statut ne sont pas destinées au public. Tous les contrôles se trouvent sous la section **Sécurité**.

### Utilisateurs privés

Désactivez **Est visible par le public** dans **Pages de statut → votre page → Sécurité → Paramètres d'authentification** (la colonne `isPublicStatusPage`). Les visiteurs atterrissent alors sur `/login` et doivent se connecter.

Ajoutez les personnes autorisées à se connecter dans **Pages de statut → votre page → Sécurité → Utilisateurs privés**. Il existe une action **Ajouter en masse** — collez une liste d'adresses e-mail et chacune reçoit un e-mail d'invitation. Les utilisateurs privés ont leur propre parcours de mot de passe oublié et de réinitialisation, distinct de vos comptes de projet OneUptime.

### Mot de passe maître

Les **Paramètres d'authentification** comportent aussi une carte **Mot de passe maître** avec une bascule **Exiger le mot de passe principal** et le mot de passe lui-même. Les visiteurs arrivent alors sur `/master-password` et déverrouillent la page avec un secret partagé unique.

**Mot de passe maître et utilisateurs privés ne se cumulent pas.** Tant que le mot de passe maître est actif, l'authentification par utilisateur privé est désactivée, et l'écran **Utilisateurs privés** affiche une bannière vous le signalant.

### SSO et OIDC

Pour une page privée liée à votre fournisseur d'identité, **Pages de statut → votre page → Sécurité → SSO** configure SAML (URL de connexion, émetteur, certificat x509, méthodes de signature et de condensé) et **Pages de statut → votre page → Sécurité → OIDC** configure OpenID Connect (URL de découverte, émetteur, identifiant et secret client, portées, noms de revendications). **SCIM** provisionne automatiquement les utilisateurs privés depuis l'IdP. Ces fonctions sont conditionnées par une option de forfait : elles peuvent ne pas être disponibles sur toutes les installations.

Une carte **Paramètres SSO** expose **Forcer le SSO pour la connexion** (`requireSsoForLogin`, désactivé par défaut). Testez votre configuration SSO avant de l'activer — si elle ne fonctionne pas, vous vous verrouillerez hors de la page de statut.

### Liste blanche d'IP

Les **Paramètres d'authentification** portent également une carte **Liste blanche d'IP**, adossée à la colonne `ipWhitelist`, pour les pages qui ne doivent répondre qu'à des réseaux connus.

## Le badge intégrable et le flux RSS

Deux façons de faire apparaître le statut ailleurs que sur la page elle-même.

**Badge de statut intégré.** Activez **Activer le badge de statut intégré** (`enableEmbeddedOverallStatus`, désactivé par défaut) dans la carte **Badge de statut intégré** de **Pages de statut → votre page → Avancé → Statut intégré**. Il fonctionne avec un `embeddedOverallStatusToken` et sert le badge depuis `/badge/:statusPageId`, ce qui vous permet de placer le statut global courant dans votre documentation, le pied de page de votre application ou une page marketing.

**Flux RSS.** Chaque page de statut sert `/rss` — un flux intitulé « {nom de la page de statut} Updates » dont les éléments sont préfixés `Incident: `, `Announcement: ` et `Scheduled Maintenance: `. Pratique pour les personnes qui préfèrent envoyer vos mises à jour dans un lecteur ou un bot de discussion plutôt que de s'abonner par e-mail.

Si vous préférez récupérer les données vous-même, la page de statut est adossée à des points de terminaison publics en lecture pour la vue d'ensemble, les incidents, les événements de maintenance planifiée, les annonces et les épisodes — voyez [API publique](/docs/status-pages/public-api).

## Pour aller plus loin

- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) — mettre des moniteurs sur la page et les organiser en sections.
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains) — logo, favicon, pied de page, code personnalisé, et pointer votre propre domaine vers la page.
- [Abonnés et annonces](/docs/status-pages/subscribers) — les cinq canaux d'abonnement, le double opt-in et la publication d'annonces.
- [API publique](/docs/status-pages/public-api) — lire les données de page de statut par programmation.
- [Vue d'ensemble des incidents](/docs/incidents/index) — les événements qui apparaissent sur la page.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui fait apparaître un incident sur une page de statut et ce qui l'en retire.
