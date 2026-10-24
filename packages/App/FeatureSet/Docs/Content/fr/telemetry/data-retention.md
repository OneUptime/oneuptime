# Rétention des données

OneUptime conserve vos journaux, vos traces, vos métriques et vos profils pendant un certain nombre de jours, puis les supprime : 15 jours, sauf si vous changez ce nombre. Cette page explique comment ce nombre est déterminé, comment le changer pour tout le projet, et comment conserver une partie de la télémétrie plus ou moins longtemps que le reste.

:::cards
- [Combien de temps la télémétrie est conservée](#combien-de-temps-la-télémétrie-est-conservée): L'ordre dans lequel OneUptime lit les paramètres.
- [Changer la rétention du projet](#changer-la-rétention-du-projet): Un seul nombre pour toute votre télémétrie.
- [Conserver une partie de la télémétrie plus ou moins longtemps](#conserver-une-partie-de-la-télémétrie-plus-ou-moins-longtemps): Par type, gravité, statut ou service.
- [Ce que coûte la rétention](#ce-que-coûte-la-rétention): La facturation sur OneUptime Cloud, le disque en auto-hébergement.
:::

## Combien de temps la télémétrie est conservée

Chaque journal, span, point de métrique et échantillon de profil reçoit sa rétention à son arrivée. OneUptime calcule combien de jours le conserver, appose la date à laquelle il expire, et le supprime après cette date. Le paramètre le plus précis l'emporte :

```mermaid title="Quel paramètre décide combien de temps un enregistrement est conservé"
flowchart TB
    arrive["Un journal, un span ou<br/>un point de métrique<br/>arrive"] --> resource{"Défini sur son<br/>service ou sa<br/>ressource ?"}
    resource -->|"Non"| byType{"Défini sur le<br/>projet pour<br/>ce type ?"}
    byType -->|"Non"| projectDefault["Défaut du projet :<br/>15 jours, sauf<br/>changement"]
    resource -->|"Oui"| stamped["Daté d'une expiration :<br/>arrivée plus<br/>les jours"]
    byType -->|"Oui"| stamped
    projectDefault --> stamped
    stamped --> deleted["Supprimé après<br/>cette date"]
```

En détail, OneUptime lit ces paramètres dans cet ordre, et le premier qui est défini décide :

| Ordre | Paramètre | Où il se définit |
| --- | --- | --- |
| 1 | Des jours pour une gravité de journal ou un statut de span, pour un service ou une ressource | **Rétention par type de télémétrie**, sur sa page **Paramètres** |
| 2 | Des jours pour un type de télémétrie, pour un service ou une ressource | La même carte |
| 3 | Des jours pour tout ce qui vient d'un service ou d'une ressource | **Conservation des données de télémétrie**, sur la même page |
| 4 | Des jours pour une gravité de journal ou un statut de span, pour le projet | **Rétention par type de télémétrie**, sur **Rétention des données** |
| 5 | Des jours pour un type de télémétrie, pour le projet | La même carte |
| 6 | Des jours pour tout le reste | **Conservation par défaut (jours)**, sur **Rétention des données** |

- **Les paramètres 1 à 5 sont des remplacements de rétention.** Ils font partie de l'[Édition Enterprise](/docs/self-hosted/enterprise), et du plan Scale sur OneUptime Cloud. Sans eux, chaque enregistrement est conservé selon le défaut du projet.
- **Un changement s'applique à la nouvelle télémétrie.** Un enregistrement garde la date qui lui a été apposée : une rétention plus courte ne le supprime pas plus tôt, et une plus longue ne le conserve pas plus longtemps. Les nouveaux enregistrements suivent un changement en cinq minutes environ.
- **Les exceptions suivent ce dans quoi elles ont été trouvées.** Une exception est conservée aussi longtemps que le span ou le journal d'où elle vient. Les Session Replays ont leur propre rétention : voir [Autres données avec leur propre rétention](#autres-données-avec-leur-propre-rétention).

## Avant de commencer

- **Un rôle qui modifie le projet.** Project Owner ou Project Admin changent la rétention du projet. La rétention d'un service ou d'une ressource demande le rôle qui modifie ses autres paramètres.
- **Pour les remplacements, l'Édition Enterprise ou le plan Scale.** Une installation auto-hébergée a besoin d'une licence Enterprise, et un projet OneUptime Cloud du plan Scale ou supérieur. La rétention par défaut du projet existe dans toutes les éditions et tous les plans.

## Changer la rétention du projet

:::steps
### Ouvrir la rétention des données

Allez dans **Paramètres du projet → Télémétrie & APM → Rétention des données**. **Télémétrie & APM** est replié au départ dans le menu latéral : cliquez dessus pour l'ouvrir. La carte **Conservation des données de télémétrie** affiche la **Conservation par défaut (jours)**.

### Fixer le nombre de jours

Cliquez sur **Modifier les paramètres de rétention**, saisissez le nombre de jours, au moins 1, et cliquez sur **Enregistrer les modifications**.
:::

Le nouveau nombre s'applique à chaque enregistrement qui arrive ensuite et qui n'a pas de remplacement à lui.

## Conserver une partie de la télémétrie plus ou moins longtemps

Les remplacements gardent plus longtemps ce dont vous avez besoin et moins longtemps le reste : les journaux d'erreur pendant un trimestre, par exemple, et les journaux de débogage quelques jours.

### Pour tout le projet

Sous le défaut, la carte **Rétention par type de télémétrie** fixe des jours pour chaque type de télémétrie. Cliquez sur **Edit Overrides**, remplissez les champs dont vous avez besoin, et laissez les autres vides :

| Type | Champs |
| --- | --- |
| Journaux | **Logs default (days)**, et un champ pour chaque gravité de journal |
| Traces | **Traces default (days)**, et un champ pour chaque statut de span : Erreur, Ok et Non défini |
| Métriques | **Metrics default (days)** |
| Profils | **Profiles default (days)** |

Un champ laissé vide se rabat sur le paramètre suivant de l'ordre ci-dessus, donc une gravité sans jours à elle conserve ses journaux selon le défaut des journaux.

### Pour un service ou une ressource

Ouvrez la page **Paramètres** du service ou de la ressource. Sa carte **Conservation des données de télémétrie** contient **Conserver les données de télémétrie pendant (jours)**, un seul nombre pour tout ce qu'il envoie, et sa carte **Rétention par type de télémétrie** a les mêmes champs que celle du projet. Laissez un champ vide pour utiliser les paramètres du projet.

Les services, les hôtes, les clusters Kubernetes, les hôtes Docker et Podman, les clusters Docker Swarm, Proxmox et Ceph, les baies de stockage, les vCenter, les bases de données, les fonctions serverless, les ressources cloud, les applications RUM et les flottes IoT ont tous ces cartes. Voir le [Catalogue de services](/docs/telemetry/services#modifier-un-service) pour la page **Paramètres** d'un service.

### Quand le plan ou la licence n'inclut plus les remplacements

- **Sur une installation auto-hébergée**, les remplacements cessent de s'appliquer une fois l'essai Enterprise ou la période de grâce terminés sans licence. La nouvelle télémétrie est conservée selon le défaut du projet, les cartes passent en lecture seule, et rien de ce que vous avez défini n'est supprimé : activez une licence et ils s'appliquent de nouveau. Voir [Édition Enterprise](/docs/self-hosted/enterprise#quand-une-licence-expire-ou-manque).
- **Sur OneUptime Cloud**, un remplacement qu'un essai a laissé défini continue de s'appliquer sous le plan Scale. Sa page l'affiche sous la carte de mise à niveau, avec un bouton **Supprimer le remplacement** qui fonctionne dans tous les plans. Définir à nouveau un remplacement demande le plan Scale.

## Autres données avec leur propre rétention

| Données | Conservées pendant | Où la changer |
| --- | --- | --- |
| Session Replays | 7 jours, sauf changement | La politique de replay de l'application RUM : voir [Gérer les applications](/docs/rum/applications#rétention-de-la-relecture-de-session). |
| Journaux des moniteurs, une ligne par vérification | 1 jour, sauf changement | Sur une installation auto-hébergée, **Rétention des journaux du moniteur (jours)** dans l'Admin Dashboard |
| Métriques des moniteurs, et les métriques que les SLO enregistrent | 30 jours, sauf changement | Sur une installation auto-hébergée, **Rétention des métriques du moniteur (jours)** dans l'Admin Dashboard |

## Ce que coûte la rétention

- **Sur OneUptime Cloud**, la télémétrie est facturée par Go ingéré, et le prix par Go inclut 15 jours de rétention. Une rétention plus longue coûte proportionnellement plus : 30 jours coûtent deux fois plus par Go que 15. Une rétention plus courte coûte proportionnellement moins, mais une rétention de moins de 7 jours est facturée comme 7 jours. **Paramètres du projet → Facturation et factures → Historique d'utilisation** montre, jour par jour, combien chaque service a envoyé et combien de temps c'est conservé.
- **En auto-hébergement**, la télémétrie vit dans ClickHouse, et la rétention multiplie son disque. Voir [Dimensionnement](/docs/installation/sizing#la-rétention-et-son-effet-sur-le-stockage).

La télémétrie dont vous n'avez pas besoin ne coûte rien si elle n'est jamais stockée : les [Filtres de suppression et règles de masquage](/docs/telemetry/drop-filters-and-scrub-rules) la jettent à son arrivée.

## Dépannage

:::details J'ai réduit la rétention, mais les anciennes données sont toujours là
Un enregistrement garde la date d'expiration qui lui a été apposée à son arrivée. Les enregistrements stockés avant le changement sont supprimés à leurs propres dates, et seuls les nouveaux suivent la nouvelle rétention.
:::

:::details Les cartes de remplacement affichent une invitation à la mise à niveau
Les remplacements de rétention demandent l'Édition Enterprise sur une installation auto-hébergée, et le plan Scale sur OneUptime Cloud. D'ici là, tout est conservé selon le défaut du projet.
:::

:::details L'espace disque revient un jour après l'expiration des données
Les enregistrements expirés n'apparaissent plus dans les recherches, les graphiques et les listes dès qu'ils expirent. Sur le disque, les journaux et les métriques sont supprimés au premier minuit qui suit, donc leur espace revient jusqu'à un jour plus tard.
:::

## Étapes suivantes

:::cards
- [Clés d'ingestion](/docs/telemetry/ingestion-keys): Envoyer de la télémétrie dans votre projet.
- [Filtres de suppression et règles de masquage](/docs/telemetry/drop-filters-and-scrub-rules): Ne garder que la télémétrie dont vous avez besoin.
- [Catalogue de services](/docs/telemetry/services): Fixer la rétention propre d'un service.
- [Édition Enterprise](/docs/self-hosted/enterprise): Ce qu'apportent les remplacements de rétention.
:::
