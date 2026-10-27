# Calendrier de maintenance

Le calendrier de maintenance montre votre maintenance planifiée par date : sur une page à part dans le tableau de bord, dans les applications de calendrier de votre équipe grâce à un lien secret, et dans les calendriers des personnes qui suivent vos pages de statut. Sur sa page, des calendriers extérieurs au projet, comme les jours fériés ou un gel des changements, peuvent s'afficher à côté de vos événements. Cette page explique la page du calendrier, les calendriers externes, le lien de calendrier de l'équipe, le calendrier d'une page de statut et ce que contient chaque événement de calendrier.

:::cards
- [La page du calendrier](#la-page-du-calendrier): Chaque événement sur un mois, une semaine ou un jour, dans la couleur de son état.
- [Calendriers externes](#calendriers-externes): Jours fériés, gels des changements ou maintenance d'une autre équipe, à côté de vos événements.
- [Le lien de calendrier de l'équipe](#le-lien-de-calendrier-de-léquipe): Chaque événement du projet dans Google Agenda, Outlook ou Apple Calendrier.
- [Le calendrier d'une page de statut](#le-calendrier-dune-page-de-statut): Ce qu'une page de statut montre, dans les calendriers de ses visiteurs.
- [Ce que contient un événement de calendrier](#ce-que-contient-un-événement-de-calendrier): Le titre, la plage horaire, l'état et un lien de retour.
:::

```mermaid title="Une liste d'événements, trois calendriers"
flowchart TB
    events["Événements de<br/>maintenance planifiée"] --> view["La vue calendrier<br/>du tableau de bord"]
    events --> team["Le lien de l'équipe<br/>chaque événement"]
    events --> page["Le lien d'une<br/>page de statut<br/>ce que la page montre"]
    team --> apps["Applications<br/>de calendrier"]
    page --> apps
```

## La page du calendrier

Ouvrez **Maintenance planifiée → Calendrier de maintenance**, dans la section **Calendrier** du menu latéral. **Tous les événements** montre les mêmes événements sous forme de liste.

- Le calendrier s'ouvre sur le mois en cours, avec aujourd'hui mis en évidence. **Mois**, **Semaine** et **Jour** changent ce qu'il montre ; naviguez avec les flèches et revenez avec **Aujourd'hui**. Les heures sont dans votre propre fuseau horaire.
- Chaque événement est un bloc de la couleur de son état, et les couleurs des états sont nommées sous le calendrier. Cliquez sur un événement pour l'ouvrir.
- Les filtres au-dessus du calendrier fonctionnent comme sur la liste : choisissez un état, une étiquette ou un propriétaire pour ne voir que ces événements.
- Un jour encore à venir affiche un **+** quand vous pointez sa semaine. Il ouvre **Créer un événement de maintenance planifiée** avec **Commence le** à ce jour, à l'heure que le formulaire choisirait aujourd'hui. Vous ne le voyez que si vous pouvez créer des événements.
- Une vue montre jusqu'à 500 événements. Un mois plus chargé le signale : affinez-le avec les filtres, ou regardez une semaine.

**Tous les événements** basculait autrefois entre une liste et un calendrier. Si votre navigateur l'a laissé en dernier sur le calendrier, **Tous les événements** ouvre une fois le **Calendrier de maintenance**, puis reste la liste.

## Calendriers externes

La page du calendrier peut aussi afficher les événements de calendriers extérieurs au projet : les jours fériés, un gel des changements que votre entreprise tient dans un autre calendrier, ou la maintenance d'une autre équipe. OneUptime lit chacun depuis son lien iCalendar (`.ics`) et dessine ses événements à côté des vôtres, plus clairs et dans la couleur propre au calendrier. Ils sont en lecture seule : ils ne deviennent jamais des événements de maintenance, personne n'est notifié à leur sujet, et ils n'apparaissent jamais dans les liens de calendrier du projet.

:::steps
### Ajouter le calendrier

Choisissez **Ajouter un calendrier externe** dans le menu **⋯** du calendrier, ou ouvrez **Maintenance planifiée → Paramètres du calendrier**, dans la section **Paramètres** du menu latéral, et cliquez sur **Ajouter un calendrier externe**. Renseignez **Nom** et collez son lien dans **Lien du calendrier**. **Plus de champs** contient sa **Couleur** et **Actualiser**, la fréquence de lecture : **Toutes les heures** sauf si vous en choisissez une autre.

### Vérifier qu'il a été lu

OneUptime lit un nouveau calendrier aussitôt. Son **Statut** indique **Fonctionne** une fois qu'il est lu, et **Dernière lecture** indique quand, et combien d'événements il a conservés. Une lecture qui a échoué indique **Ne fonctionne pas**, avec la raison et ce qu'il faut faire.

### L'afficher ou le masquer

Chaque calendrier externe a un interrupteur à son nom sous le calendrier. En masquer un ne le masque que pour vous ; votre navigateur retient ce choix pour le projet.
:::

Copiez le lien depuis les paramètres de partage du calendrier lui-même : dans Google Agenda, son adresse secrète au format iCal ; dans Outlook, le lien ICS d'un calendrier publié ; dans toute autre application, son lien `.ics` ou `webcal://`. Le lien peut être privé : OneUptime le stocke chiffré, ne l'affiche plus jamais, et **Changer le lien** le remplace.

| Action | Ce qui se passe |
| --- | --- |
| **Lire maintenant** | Lit le calendrier maintenant plutôt qu'à sa prochaine lecture. |
| **Changer le lien** | Remplace son lien. Les événements de l'ancien lien sont oubliés, et le nouveau est lu aussitôt. |
| **Désactiver** | Arrête de le lire et masque ses événements pour tout le monde, jusqu'à **Activer**. |

Chaque calendrier conserve ses événements de 90 jours en arrière à un an en avant, jusqu'à 2 000, les plus proches d'aujourd'hui d'abord. Un calendrier de plus de 5 Mo n'est pas lu. Les événements récurrents, leurs exceptions et leurs fuseaux horaires sont lus tels que l'application de calendrier les a écrits, et un événement d'une journée entière reste à sa date dans chaque fuseau horaire. Un projet peut avoir jusqu'à 20 calendriers externes, et une vue du calendrier dessine jusqu'à 500 de leurs événements.

Les rôles qui créent, modifient et suppriment les événements de maintenance planifiée ajoutent, modifient et retirent les calendriers externes, et toute personne qui peut lire les événements les voit sur le calendrier. OneUptime ne lit jamais une adresse de son propre serveur ni une adresse de métadonnées cloud, et OneUptime Cloud refuse les adresses d'un réseau privé. Un serveur auto-hébergé peut lire un calendrier de votre propre réseau, sauf si `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` vaut `true`.

## Le lien de calendrier de l'équipe

**S'abonner au calendrier**, sous le calendrier, ouvre le lien de calendrier du projet : un lien iCalendar (`.ics`) secret qui place chaque événement de maintenance planifiée du projet dans Google Agenda, Outlook, Apple Calendrier ou toute application qui s'abonne à un calendrier par URL.

:::steps
### Publier le lien

Cliquez sur **Publier le lien**. Un projet a un seul lien, pour toute l'équipe, il suffit donc de le faire une fois.

### L'ajouter à votre application de calendrier

**Google Agenda** ouvre Google Agenda, qui demande s'il faut ajouter le calendrier. **Apple Calendrier / Outlook** ouvre le lien dans l'application de calendrier de votre ordinateur ou de votre téléphone. **Copier le lien** le copie pour toute autre application.

### Vérifier qu'il fonctionne

Le panneau **Statut** indique quand une application de calendrier a lu le lien pour la dernière fois, et laquelle. Un nouveau lien indique **En attente de la première synchronisation** jusqu'à ce qu'une application le lise.
:::

Le lien ressemble à ceci :

```text
https://<your host>/api/scheduled-maintenance-calendar/project/<token>/maintenance.ics
```

> [!WARNING]
> Toute personne qui a le lien voit chaque événement de maintenance planifiée du projet, sans se connecter. Traitez-le comme un mot de passe, et régénérez-le s'il est partagé par erreur.

### Qui peut voir le lien

Le lien montre chaque événement du projet, la boîte de dialogue ne le montre donc qu'aux personnes qui peuvent lire chaque événement. Une personne dont le rôle la limite à certains événements, par étiquette ou aux événements dont elle est propriétaire, en apprend plutôt la raison.

| Action | Qui peut le faire |
| --- | --- |
| Copier le lien | Toute personne qui peut lire chaque événement de maintenance planifiée du projet |
| **Publier le lien** | Toute personne qui peut aussi créer des événements de maintenance planifiée |
| **Régénérer le lien**, **Désactiver le lien** | Toute personne qui peut aussi modifier des événements de maintenance planifiée |

### Gérer le lien

**Régénérer le lien** et **Désactiver le lien** se trouvent dans le menu **⋯** en haut de la boîte de dialogue.

| Action | Ce qui se passe |
| --- | --- |
| **Régénérer le lien** | Crée un nouveau lien. Pendant 30 jours, l'ancien sert un calendrier vide, pour que les applications qui le détiennent vident leur copie ; ensuite, il est introuvable. Abonnez-vous de nouveau avec le nouveau lien. |
| **Désactiver le lien** | Conserve le lien, mais il sert un calendrier vide jusqu'à **Activer le lien**. |

Le calendrier contient chaque événement de 90 jours en arrière à un an en avant, jusqu'à 1 000 événements.

## Le calendrier d'une page de statut

Les personnes qui suivent une page de statut peuvent placer sa maintenance planifiée dans leur propre calendrier. Sur la page des événements planifiés de la page de statut, **S'abonner au calendrier** propose Google Agenda, l'application de calendrier de leur appareil ou le lien à copier. Le lien est l'adresse de la page suivie de `/maintenance.ics`, par exemple `https://status.example.com/maintenance.ics`.

- **Ce qu'il contient.** Exactement ce que la page montre : les événements de la période d'historique de la page, chaque événement à venir et chaque événement en cours, tant que **Visible sur la page de statut** est activé, et à partir de son **Publier le** si vous en avez choisi un. Ce que chaque événement touche est nommé comme la page nomme ses ressources, jamais par les noms propres de vos moniteurs.
- **Une page privée.** Une application de calendrier ne peut pas se connecter : une page privée ne propose donc pas **S'abonner au calendrier**, et son lien sert un calendrier vide qui indique que la page est privée.
- **Un seul événement.** **Ajouter au calendrier** sur la page d'un événement ajoute cet événement seul : Google Agenda s'ouvre avec l'événement rempli, ou il se télécharge sous forme de fichier que l'application de calendrier de l'appareil ouvre. Cela fonctionne aussi sur une page privée, pour un visiteur connecté, et n'est plus proposé une fois l'événement terminé.

## Ce que contient un événement de calendrier

Chaque calendrier, celui de l'équipe comme celui d'une page de statut, écrit un événement de la même façon.

| Partie | Ce qu'elle contient |
| --- | --- |
| Titre | Le titre de l'événement |
| Début et fin | Sa plage prévue, en UTC ; l'application de calendrier l'affiche dans votre propre fuseau horaire |
| Description | Sa description en texte brut, son état, ce qu'il touche et un lien vers l'événement ; le lien de l'équipe nomme aussi ses pages de statut |
| État | Annulé quand l'événement a été annulé : terminé sans jamais avoir été en cours |
| Libre ou occupé | Libre, pour qu'une fenêtre de maintenance ne bloque jamais votre disponibilité |
| Catégories | Ses étiquettes ; le calendrier d'une page de statut ne les montre que si la page montre les étiquettes |

Un événement modifié dans OneUptime est mis à jour sur place dans chaque calendrier qui le contient, et un événement supprimé, ou retiré d'une page de statut, quitte le calendrier à sa prochaine actualisation.

## Fréquence d'actualisation des calendriers

Les applications de calendrier lisent un lien abonné selon leur propre rythme. Google Agenda le fait toutes les quelques heures, parfois une seule fois par jour ; Apple Calendrier et Outlook en général toutes les heures. OneUptime garde un calendrier au plus cinq minutes, l'attente que vous voyez est donc celle de l'application de calendrier. Les étapes pour chaque application se trouvent sur [Flux de calendrier](/docs/on-call/calendar-feeds#sabonner-dans-votre-application-de-calendrier), qui fonctionnent de la même façon pour les gardes d'astreinte.

## Dépannage

:::details L'application de calendrier n'affiche plus les nouveaux événements
Le lien a été régénéré ou désactivé : ouvrez **S'abonner au calendrier** pour voir son statut. Un lien régénéré demande de s'abonner de nouveau avec le nouveau lien ; un lien désactivé revient avec **Activer le lien**.
:::

:::details Google Agenda ne parvient pas à ajouter le lien
Google Agenda lit le lien depuis les serveurs de Google, le serveur OneUptime doit donc être joignable depuis Internet. Pour un serveur auto-hébergé, voir [Flux de calendrier](/docs/on-call/calendar-feeds#dépannage).
:::

:::details Un événement manque dans le calendrier d'une page de statut
Le calendrier de la page contient ce que la page montre. Vérifiez que l'événement nomme la page, que **Visible sur la page de statut** est activé dans ses **Paramètres**, que son **Publier le**, s'il en a un, est passé, et qu'il a commencé dans la période d'historique de la page.
:::

:::details Un calendrier externe indique Ne fonctionne pas
La raison figure sous **Ne fonctionne pas** dans son **Statut** : aucun calendrier à ce lien, un lien qui demande une connexion ou qui n'est plus partagé, une erreur de son serveur, un calendrier de plus de 5 Mo, ou un calendrier qui répète des événements trop souvent pour être traité. Corrigez le lien avec **Changer le lien**, ou utilisez **Lire maintenant** une fois le calendrier de retour. D'ici là, le calendrier affiche les événements de sa dernière lecture réussie.
:::

## Prochaines étapes

:::cards
- [Créer des événements de maintenance](/docs/scheduled-maintenance/creating-events): Le formulaire, champ par champ, et ce qui se passe ensuite.
- [Abonnés et annonces](/docs/status-pages/subscribers#événements-de-maintenance-planifiée): Ce que les abonnés d'une page de statut apprennent de la maintenance.
- [Flux de calendrier](/docs/on-call/calendar-feeds): Le même genre de lien, pour les gardes d'astreinte.
:::
