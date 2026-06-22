# Présentation des tableaux de bord

Les tableaux de bord transforment les données que OneUptime collecte déjà — métriques, journaux, traces, incidents, monitors, ressources Kubernetes, hôtes — en une page unique sur laquelle on peut jeter un coup d'œil pour comprendre ce qui se passe.

Placez un graphique de latence des requêtes à côté d'une liste d'incidents ouverts, à côté d'une jauge de CPU, à côté d'un paragraphe de contexte. Enregistrez. Partagez le lien.

## À quoi servent les tableaux de bord

- **Une page « tout va bien ? »** — pour l'astreinte, un stand-up d'équipe ou un écran TV mural.
- **Repérer les liens entre événements** — un pic de CPU au même moment qu'une augmentation de latence et qu'un incident ouvert est bien plus visible sur une seule page que dans trois onglets différents.
- **Investiguer** — quand vous déboguez, un tableau de bord construit à la volée vaut mieux qu'enchaîner dix requêtes une à une.
- **Partager à l'extérieur** — une page de performance destinée aux clients, une page d'état pour un partenaire, un tableau de bord public pour un projet open source.

## Ce que vous pouvez mettre sur un tableau de bord

- **Graphiques** pour les tendances dans le temps — latence, erreurs, débit.
- **Tuiles à valeur unique et jauges** — taux d'erreur actuel, CPU, incidents ouverts.
- **Tableaux** pour des décompositions — top 10 des hôtes les plus bruyants, nombre d'erreurs par service.
- **Blocs de texte** pour les titres, le contexte et les liens vers des runbooks.
- **Listes en direct** des incidents, alertes, monitors, journaux, traces, ressources Kubernetes, ressources Docker et hôtes.

Voir [Widgets](/docs/dashboards/widgets) pour la liste complète et ce que chacun affiche.

## Termes clés

| Terme                | Signification                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Tableau de bord**  | La page entière — un nom, une grille de widgets, des contrôles de plage temporelle et une liste de variables.                 |
| **Widget**           | Une tuile sur la page — un graphique, un nombre, une liste, un paragraphe.                                                    |
| **Variable**         | Une liste déroulante en haut de la page qui filtre tous les widgets à la fois (cluster, service, client, environnement).      |
| **Plage temporelle** | La fenêtre de temps utilisée par chaque graphique et chaque nombre. Définissez-la une fois en haut de la page.                |
| **Actualisation**    | À quelle fréquence les widgets relancent leur requête. Désactivée, toutes les quelques secondes, toutes les quelques minutes. |
| **Mode**             | Soit **Edit** (déplacer les widgets), soit **View** (lecture seule, tel que les visiteurs le voient).                         |

## Où trouver les tableaux de bord

Ouvrez **Dashboards** dans la navigation de gauche.

| Page                     | Ce que vous y faites                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Dashboards**           | Votre liste de tableaux de bord. Créez-en un nouveau, recherchez ou filtrez par étiquette.    |
| **Dashboard → View**     | Le canevas. Basculez entre **Edit** et **View** dans l'en-tête.                               |
| **Dashboard → Overview** | Description, propriétaires et étiquettes.                                                     |
| **Dashboard → Settings** | Partage public, mot de passe, liste d'IP autorisées, domaine personnalisé, identité visuelle. |
| **Dashboard → Owners**   | Utilisateurs et équipes ayant un accès explicite.                                             |
| **Dashboard → Delete**   | Supprimer le tableau de bord.                                                                 |

## Construire un tableau de bord

1. **Créez** — choisissez un nom. Le canevas s'ouvre vide.
2. **Ajoutez des widgets** — choisissez un type de widget, configurez ses données, faites-le glisser à l'endroit voulu.
3. **(Optionnel) Ajoutez des variables** — par exemple, une liste déroulante `service` afin que le même tableau de bord fonctionne pour chaque service.
4. **Définissez la plage temporelle** — les valeurs par défaut conviennent ; ajustez plus tard.
5. **(Optionnel) Partagez publiquement** — basculez l'interrupteur dans Settings, ajoutez un mot de passe ou une liste d'IP autorisées si nécessaire.
6. **(Optionnel) Domaine personnalisé** — hébergez le tableau de bord sur `status.your-domain.com`.

## Un exemple rapide

Objectif : une page d'astreinte pour le service checkout avec latence, taux d'erreur, incidents ouverts et un flux de journaux en direct.

1. Créez un tableau de bord intitulé « Checkout on-call ».
2. Ajoutez une variable `service`. Mettez-la par défaut à `checkout`.
3. Ajoutez un widget **Chart** avec la latence P95, filtré par la variable `service`.
4. À côté, ajoutez un widget **Value** pour le taux d'erreur, avec un avertissement à 1 % et un seuil critique à 5 %.
5. En dessous, ajoutez un widget **Incident List** pour les incidents étiquetés `checkout`.
6. En dessous, un widget **Log Stream** affichant les journaux du même service.
7. Enregistrez. Passez la liste déroulante à `payments` — le même tableau de bord affiche désormais le service payments.

## Comment les tableaux de bord s'intègrent au reste de OneUptime

- Les **monitors et la télémétrie** sont les sources de données. Chaque métrique, journal et trace que vous collectez peut être interrogé par un widget.
- Les **incidents et alertes** apparaissent dans les widgets **Incident List** et **Alert List**. Les tableaux de bord sont en lecture seule pour ces données — créez-les et mettez-les à jour ailleurs.
- Les **status pages** sont la communication tournée vers le client (« est-ce que le système fonctionne ? »). Les tableaux de bord servent à examiner en détail le comportement du système. Les deux sont complémentaires, ils ne se remplacent pas.
- Les **workflows** sont la façon dont OneUptime agit. Les tableaux de bord sont la façon dont vous lisez ce qui se passe.

## Pour aller plus loin

- [Création d'un tableau de bord](/docs/dashboards/authoring) — utiliser le canevas, éditer les widgets.
- [Widgets](/docs/dashboards/widgets) — la liste complète des widgets.
- [Variables et filtres](/docs/dashboards/variables) — rendre un tableau de bord utile pour plusieurs services ou clients.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — URL publiques, mots de passe, liste d'IP autorisées, domaines personnalisés.
- [Configuration et permissions](/docs/dashboards/configuration) — propriétaires, étiquettes, contrôle d'accès.
