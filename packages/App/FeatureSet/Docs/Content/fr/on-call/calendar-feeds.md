# Flux de calendrier

Les flux de calendrier placent vos permanences d'astreinte dans le calendrier que vous consultez déjà. OneUptime publie un lien iCalendar (`.ics`) secret pour chaque personne, chaque planning et chaque projet ; Google Agenda, Outlook, Calendrier Apple, Thunderbird et toute autre application capable de s'abonner à un calendrier par URL interrogent ce lien et affichent un événement par permanence. Rien n'est installé, aucun compte n'est connecté : le lien est toute l'intégration.

```mermaid title="Les applications de calendrier interrogent un lien secret ; certaines depuis leurs propres serveurs"
flowchart TB
    subgraph links["Liens .ics secrets"]
        direction LR
        personal["Flux personnel"]
        schedule["Flux de planning"]
        project["Flux de projet"]
    end
    shifts["Plannings, rotations<br/>et remplacements"] --> links
    links -->|"lus depuis leurs serveurs"| serverApps["Google Agenda, Outlook sur le web"]
    links -->|"lus depuis votre appareil"| deviceApps["Calendrier Apple, Thunderbird, Outlook classique"]
```

> [!NOTE]
> Un calendrier abonné sert à **planifier**. Les applications de calendrier relisent les flux à leur propre rythme — Google Agenda seulement toutes les 8 à 24 heures — ; un échange fait une heure avant une permanence vous parvient donc par les rappels, les avis de réaffectation et les alertes de OneUptime, pas par le calendrier.

## Ce que vous obtenez

- Un événement par permanence, intitulé `On-call · <Schedule>` (avec ` · <Policy>` ajouté lorsque le planning est rattaché à exactement une politique d'escalade) dans votre flux personnel et `<Name> · On-call · <Schedule>` dans un flux partagé. La description indique qui est d'astreinte, le planning et son fuseau horaire, la couche, la permanence dans le fuseau du planning, en UTC et dans votre fuseau, les politiques d'escalade qui vous alertent via ce planning, et un lien vers le planning dans le tableau de bord.
- Les remplacements sont pris en compte. Quand quelqu'un vous remplace, l'événement passe à cette personne (`(covering for <Name>)` est ajouté) et reste le même événement dans votre application de calendrier : il se met à jour sur place au lieu d'être dupliqué. Un remplacement partiel découpe la permanence en événements contigus.
- Deux jours d'historique et 90 jours à venir par défaut. Vous pouvez étendre cela à 60 jours en arrière et 180 jours en avant ; un flux qui dépasserait 5 000 événements est raccourci et le signale dans la description de son calendrier.
- Les événements sont marqués comme disponibles (`TRANSP:TRANSPARENT`), un flux abonné ne bloque donc jamais votre disponibilité, et rien n'est marqué comme privé : un calendrier d'équipe partagé montre les titres à tous ceux qui peuvent le voir.
- Les heures sont envoyées en UTC et converties par votre application de calendrier ; la description précise l'heure locale dans le fuseau du planning et dans le vôtre. Définissez votre propre fuseau comme **Fuseau horaire** dans votre **Profil** (votre photo en haut à droite du tableau de bord), et celui du planning dans la carte **Schedule timezone** de sa page **Couches**. Un planning sans fuseau horaire est calculé dans le fuseau du serveur, comme pour les alertes, et l'événement le signale.

Les affectations permanentes — un utilisateur ou une équipe nommé directement dans une règle de politique d'escalade — n'ont ni début ni fin et n'apparaissent dans aucun flux. Sur OneUptime Cloud, les flux suivent la même offre que les plannings d'astreinte (Growth) ; un projet en dessous de cette offre reçoit un calendrier vide plutôt qu'une erreur.

## Trois types de liens

| Lien | Qui le crée | Ce qu'il contient | Où |
| --- | --- | --- | --- |
| **Flux personnel** | Chaque utilisateur, un par projet | Vos permanences sur tous les plannings de ce projet, plus celles où vous remplacez quelqu'un (facultatif) | **Paramètres utilisateur** > **Calendrier** > **Flux de calendrier** |
| **Flux de planning** | Quiconque peut modifier le planning ; quiconque peut le lire peut copier le lien | Les permanences de tous sur un planning, avec des événements de trous de couverture en option | La page du planning, carte **S'abonner à ce planning** |
| **Flux de projet** | Quiconque peut modifier les plannings d'astreinte ; quiconque peut les lire peut copier le lien | Les permanences de tous sur tous les plannings du projet, avec des événements de trous de couverture en option | **Astreinte** > **Flux de calendrier** |

Les liens ressemblent à ceci :

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Le jeton de 43 caractères dans le chemin est le seul identifiant — il n'y a ni connexion, ni cookie, ni clé d'API. Traitez chacun de ces liens comme un mot de passe.

## Votre flux personnel

Les flux personnels sont propres à chaque projet : un deuxième projet donne un deuxième lien et un deuxième calendrier.

:::steps
### Ouvrir votre flux de calendrier

Ouvrez **Paramètres utilisateur** > **Calendrier** > **Flux de calendrier** dans le projet dont vous voulez les permanences. **Calendrier** est une section du menu latéral qui commence repliée.

### Générer le lien

Cliquez sur **Générer le lien du calendrier**. La carte **S'abonner à vos permanences d'astreinte** propose alors un seul parcours d'abonnement :

- **Ajouter à votre agenda** : **Google Agenda** ouvre Google Agenda, qui demande s'il faut ajouter le calendrier. **Apple Calendrier / Outlook** ouvre la forme `webcal://` du lien dans l'application avec laquelle votre ordinateur ou votre téléphone s'abonne : Calendrier Apple sur Mac, iPhone ou iPad, Outlook sous Windows.
- **Ou copiez le lien** : **Copier le lien** copie le lien `https://` pour toute autre application capable de s'abonner à un calendrier par URL. Le lien reste masqué sur la page jusqu'à ce que vous cliquiez pour l'afficher.

### S'abonner au lien

Suivez les étapes de votre application dans « S'abonner dans votre application de calendrier » ci-dessous. Vos permanences apparaissent comme des événements la prochaine fois que l'application relit le lien : voir « Fréquence d'actualisation des calendriers ».
:::

### Paramètres du flux de calendrier

Cliquez sur **Modifier les paramètres** sur la carte **Paramètres du flux de calendrier** pour changer ce que contient le lien :

| Paramètre | Ce qu'il fait |
| --- | --- |
| **Inclure les permanences que j'assure pour d'autres** | Activé par défaut. Ajoute les permanences qu'un remplacement vous donne sur des plannings dont vous n'êtes pas membre par ailleurs. |
| **Jours de permanences passées** | Jusqu'où le calendrier remonte (2 par défaut, 60 au plus). |
| **Jours à venir** | Jusqu'où le calendrier s'étend (90 par défaut, entre 7 et 180). |

La ligne d'état indique quand le lien a été lu pour la dernière fois, par quelle application de calendrier, combien de fois, et les quatre derniers caractères du jeton pour distinguer les liens. Si rien n'a lu le lien au bout de deux jours, la page demande si le serveur est joignable depuis Internet (voir Dépannage).

### Gérer le lien

| Action | Ce qui se passe |
| --- | --- |
| **Régénérer le lien** | Crée un nouveau jeton. Toute application abonnée à l'ancien lien cesse d'être mise à jour : pendant 30 jours, l'ancien lien sert un calendrier vide pour que ces applications vident leur copie, puis il répond 404. Réabonnez-vous avec le nouveau lien. |
| **Désactiver** | Conserve le lien mais sert un calendrier vide jusqu'à ce que vous le réactiviez. |
| **Supprimer** | Supprime le lien. Les applications qui l'interrogent encore reçoivent 404 et continuent d'afficher ce qu'elles ont lu en dernier — désactivez d'abord si vous voulez qu'elles se vident. |

### Permanences à venir et remplacement

La page liste aussi vos **Upcoming shifts** (les 30 prochains jours), ainsi que la carte **Me rappeler avant les permanences** décrite plus bas. Chacune de vos propres permanences a un lien **Trouver un remplaçant** : il ouvre les remplacements d'utilisateurs dans le projet de la permanence avec un nouveau remplacement prérempli pour cette permanence, vous comme **Qui est absent ?** et les heures de la permanence comme **Commence** et **Se termine** (à partir de maintenant si la permanence a commencé) ; il ne reste plus qu'à choisir **Qui remplace ?**. Le remplacement envoie toutes vos alertes de ces heures à la personne qui vous remplace, depuis chaque politique d'astreinte ; une permanence qui n'existe qu'à l'intérieur d'une politique se remplace plutôt sur la page des remplacements d'utilisateurs de cette politique. Une permanence où vous remplacez déjà quelqu'un n'a pas de **Trouver un remplaçant** : les remplacements ne s'enchaînent pas, un remplacement du remplacement ne changerait donc rien.

Le même lien personnel, filtré sur un planning avec `?schedule=<id>`, est proposé comme **Uniquement mes permanences sur ce planning** sur la page de chaque planning, et la bannière d'astreinte ainsi que la page **Mes politiques d'astreinte** portent un lien **Ajouter vos permanences à votre calendrier** vers la page ci-dessus.

### Dans l'application mobile

Dans l'application mobile : **On-Call** > **Add shifts to my calendar** (aussi sous **Settings** > **Calendar feed**), avec un lien par projet. Sur iPhone, **Open in Calendar** ouvre la feuille d'abonnement native. Sur Android, il n'existe aucun moyen de s'abonner à une URL sur le téléphone ; l'écran propose donc **Share link** et **Copy https link** et vous invite à ajouter le lien sur un ordinateur, après quoi il se synchronise vers le téléphone. La liste **Your shifts** de l'application vient des mêmes données et offre la même action **Get cover**.

## S'abonner dans votre application de calendrier

Utilisez **Google Agenda** ou **Apple Calendrier / Outlook** dans OneUptime lorsque votre application a un bouton ; toute autre application prend le lien `https://` que donne **Copier le lien**. « Liens https et webcal » ci-dessous explique les deux formes.

:::tabs
@tab Google Agenda
1. Cliquez sur **Google Agenda** dans OneUptime. Google Agenda s'ouvre et demande s'il faut ajouter le calendrier ; cliquez sur **Ajouter**.
2. Ou, dans Google Agenda sur le web, à côté de **Autres agendas**, cliquez sur **+** > **À partir de l'URL**, collez le lien (**Copier le lien** dans OneUptime) et cliquez sur **Ajouter un agenda**.

Le bouton **Google Agenda** ouvre la page d'ajout par URL de Google, `https://calendar.google.com/calendar/r?cid=` suivi de la forme `webcal://` du lien, encodée en pourcentage. Cette page n'accepte que la forme `webcal://` : avec la forme `https://`, Google répond « Unable to add calendar. Check the URL. ». **À partir de l'URL** accepte les deux formes.

Google relit le flux **depuis les serveurs de Google** : le serveur OneUptime doit donc être joignable depuis Internet — OneUptime Cloud l'est toujours ; pour une installation auto-hébergée, voir Dépannage. La première lecture a généralement lieu quelques minutes après l'abonnement ; ensuite, Google actualise environ toutes les 8 à 24 heures, parfois moins souvent. Il n'y a pas de bouton d'actualisation pour les agendas abonnés, et Google ignore les indications d'actualisation du flux. La ligne d'état de la page du flux affiche **Dernière récupération … par Google Calendar** dès que Google a lu le lien.

Le nom et le fuseau horaire du calendrier ne sont lus **qu'au premier abonnement** : renommer un planning plus tard ne renomme pas le calendrier dans Google — supprimez-le et rajoutez-le si le nom compte. Google ignore les rappels contenus dans les fichiers de calendrier ; définissez donc des notifications par défaut sur cet agenda dans les réglages de Google, ou mieux, utilisez les rappels de OneUptime. Google se souvient d'une adresse qu'il n'a pas pu lire : après avoir corrigé ce qui l'en empêchait, ajoutez de nouveau le lien suivi de `?nocache=1` (OneUptime ignore les paramètres de requête inconnus, le flux reste identique) ou régénérez le lien. L'application Google Agenda sur Android et iOS ne peut pas s'abonner à une URL ; ajoutez le lien sur un ordinateur et il apparaît sur le téléphone.
@tab Outlook sur le web
1. Ouvrez **Calendrier** > **Ajouter un calendrier** > **S'abonner à partir du web**.
2. Collez le lien `https://` (**Copier le lien** dans OneUptime), donnez un nom au calendrier et cliquez sur **Importer**.

Cela fonctionne de la même façon dans Outlook.com, Outlook sur le web pour les comptes professionnels et scolaires, le nouvel Outlook pour Windows et Outlook pour Mac. Outlook relit **depuis les serveurs de Microsoft** : environ toutes les 3 heures pour Outlook.com et toutes les 4 à 6 heures pour les comptes professionnels ou scolaires, parfois plus d'une journée. L'intervalle est fixe, sans actualisation manuelle.

Abonnez-vous ici plutôt que dans l'application de bureau si vous voulez le calendrier aussi sur votre téléphone et dans Outlook sur le web — les abonnements créés dans Outlook classique pour Windows restent sur ce PC.
@tab Outlook classique pour Windows
1. Sur un PC où Outlook est installé, cliquez sur **Apple Calendrier / Outlook** dans OneUptime. Windows transmet le lien `webcal://` à Outlook, qui demande s'il faut ajouter le calendrier Internet. Sans Outlook, Windows n'a pas de gestionnaire `webcal`.
2. Ou, dans Outlook, ouvrez **Fichier** > **Paramètres du compte** > **Paramètres du compte** > **Calendriers Internet** > **Nouveau**, collez le lien (**Copier le lien** dans OneUptime) et cliquez sur **Ajouter**.

N'ouvrez **pas** le lien `https://…/shifts.ics` lui-même dans Outlook classique : il importe un instantané unique qui ne se met jamais à jour. Ouvrir le lien `webcal://`, ou ajouter l'adresse sous **Calendriers Internet**, crée un abonnement.

Le flux est actualisé à chaque **Envoyer/Recevoir** (F9, ou l'intervalle des groupes d'envoi/réception). Les paramètres de l'abonnement comportent une case **Limite de mise à jour** : cochée, Outlook n'actualise pas plus vite que l'intervalle suggéré par l'éditeur. OneUptime suggère une heure (`X-PUBLISHED-TTL:PT1H`), le flux est donc actualisé environ toutes les heures. Les flux sans cette indication ne s'actualisent jamais tant que la case est cochée ; ceux de OneUptime la portent, vous pouvez donc laisser la case cochée. Outlook classique relit le flux **depuis votre PC** et vérifie le certificat du serveur.
@tab Calendrier Apple (macOS)
1. Cliquez sur **Apple Calendrier / Outlook** dans OneUptime, ou dans Calendrier choisissez **Fichier** > **Nouvel abonnement à un calendrier** et collez le lien.
2. Dans la feuille d'abonnement, réglez **Actualisation automatique** — toutes les 5 minutes, 15 minutes, heures, jours ou semaines (toutes les heures par défaut) — et choisissez **iCloud** sous **Emplacement** pour que le calendrier apparaisse aussi sur votre iPhone et iPad et continue de s'actualiser à ce rythme.

macOS relit le flux **depuis votre Mac**, ce qui fonctionne pour une installation sur un réseau privé tant que le Mac peut l'atteindre. Un certificat auto-signé ou émis par une autorité interne doit d'abord être approuvé dans le trousseau macOS. **Supprimer les alertes** est coché par défaut dans cette feuille ; cela n'a aucune incidence ici car le flux ne contient pas d'alarmes.
@tab iPhone et iPad
Pour vous abonner sur l'appareil, touchez **Open in Calendar** dans l'application mobile OneUptime, ou allez dans **Réglages** > **Calendrier** > **Comptes** > **Ajouter un compte** > **Autre** > **Ajouter un cal. avec abonnement** et collez le lien.

Les abonnements créés sur l'appareil lui-même s'actualisent selon **Réglages** > **Calendrier** > **Comptes** > **Nouvelles données** — **Automatiquement** par défaut, ce qui relit surtout en charge et en Wi-Fi. Pour une actualisation fiable, abonnez-vous sur un Mac avec **iCloud** comme emplacement, ou réglez **Nouvelles données** sur un intervalle fixe.
@tab Thunderbird
Choisissez **Fichier** > **Nouveau** > **Agenda** > **Sur le réseau** > **iCalendar (ICS)**, collez le lien `https://` et choisissez un intervalle d'actualisation dans les propriétés de l'agenda : 1, 5, 15, 30 ou 60 minutes. Thunderbird relit **depuis votre ordinateur** et doit faire confiance au certificat du serveur.
@tab Android
Ni l'application Google Agenda ni Samsung Calendar ne peuvent s'abonner à une URL. Ajoutez le lien `https://` à Google Agenda sur un ordinateur (**Autres agendas** > **+** > **À partir de l'URL**) ; l'agenda se synchronise ensuite vers le téléphone avec le reste du compte Google. L'application mobile OneUptime sur Android propose **Share link** et **Copy https link** exactement pour cela.
@tab Autres services
Fastmail actualise environ toutes les heures et **désactive un abonnement après cinq échecs de lecture consécutifs** ; si cela arrive, rajoutez-le une fois le serveur rétabli. Proton Calendar actualise toutes les 4 à 16 heures et refuse les très gros flux — réduisez **Jours à venir** s'il proteste. Confluence Team Calendars accepte le flux de planning ; sa limite de 28 caractères pour les noms de calendrier est respectée.
:::

## Fréquence d'actualisation des calendriers

| Application de calendrier | Actualisation typique | Relit depuis | Remarques |
| --- | --- | --- | --- |
| Google Agenda (À partir de l'URL) | 8–24 heures, parfois plus | Les serveurs de Google | Pas d'actualisation manuelle ; ignore les indications ; nom et fuseau lus au premier abonnement seulement |
| Outlook.com | Environ 3 heures | Les serveurs de Microsoft | Fixe ; peut dépasser 24 heures |
| Outlook sur le web (pro, scolaire) | Environ 4–6 heures | Les serveurs de Microsoft | Fixe ; non réglable |
| Outlook classique pour Windows | À chaque Envoyer/Recevoir ; environ toutes les heures avec **Limite de mise à jour** | Votre PC | Abonnement via le lien `webcal` ; ne se synchronise ni vers le téléphone ni vers le web |
| Calendrier Apple (macOS) | De 5 minutes à hebdomadaire, toutes les heures par défaut | Votre Mac | Enregistrez dans iCloud pour atteindre l'iPhone et l'iPad |
| Calendrier Apple (iOS seul) | Selon **Nouvelles données**, limité par la batterie | Votre téléphone | Abonnez-vous sur un Mac pour plus de fiabilité |
| Thunderbird | 1–60 minutes | Votre ordinateur | |
| Fastmail | Environ toutes les heures | Les serveurs de Fastmail | Désactivé après cinq échecs de lecture |
| Proton Calendar | 4–16 heures | Les serveurs de Proton | Refuse les gros flux |

OneUptime lui-même sert des données fraîches : une modification d'une couche, d'une rotation, d'un remplacement ou d'un rattachement de politique invalide le flux immédiatement, et les réponses sont mises en cache au plus cinq minutes. L'attente que vous constatez est celle de l'application de calendrier, pas du serveur. OneUptime suggère une actualisation horaire via `REFRESH-INTERVAL` et `X-PUBLISHED-TTL` ; seul Outlook classique en tient compte, et uniquement avec **Limite de mise à jour** activée — Calendrier Apple, Thunderbird et les autres s'actualisent à l'intervalle que vous définissez par calendrier.

## Liens https et webcal

Les deux pointent vers le même flux. `webcal://` est le lien dont le schéma est renommé, pour que le système d'exploitation ouvre une application de calendrier plutôt qu'un navigateur ; l'application relit ensuite le flux en `https://` lorsque le serveur sert du https, comme le font Calendrier Apple et Google Agenda.

- **Copier le lien** donne la forme `https://`. **À partir de l'URL** de Google Agenda, Outlook sur le web, Thunderbird et Fastmail l'acceptent.
- **Apple Calendrier / Outlook** ouvre la forme `webcal://` : Calendrier Apple et Outlook classique pour Windows s'y abonnent. Dans Outlook classique, ouvrir la forme `https://` à la place est une importation unique.
- **Google Agenda** place la forme `webcal://` dans le lien d'ajout par URL de Google, la seule forme qu'accepte cette page.
- OneUptime ne fournit plus `webcals://` : iOS ne l'ouvre pas (« l'adresse n'est pas valide »), et Google ne l'accepte pas non plus. Un calendrier auquel vous êtes déjà abonné avec un lien `webcals://` continue de fonctionner.
- Si votre installation fonctionne encore en `http` simple, le flux est lu en clair, jeton compris, et le tableau de bord affiche un avertissement à côté du lien ; passez en `https` avant de partager largement des liens.

Les URL de flux ne redirigent jamais. Elles répondent `200` quel que soit le schéma qui atteint OneUptime, car l'application ne peut pas savoir quel schéma l'application de calendrier a utilisé lorsque TLS se termine en amont — sur OneUptime Cloud, ou derrière votre propre répartiteur de charge ou CDN —, et une redirection y renverrait vers la même URL. Redirigez le `http` simple vers `https` sur le proxy qui termine TLS, le seul maillon qui le sait.

## Rappels et avis de réaffectation

Les applications de calendrier ne délivrent pas les alarmes des flux abonnés — Google les supprime, Apple les retire par défaut, Outlook les aplatit — ; OneUptime envoie donc les siennes.

:::steps
1. Ouvrez **Paramètres utilisateur** > **Calendrier** > **Flux de calendrier**.
2. Sur la carte **Me rappeler avant les permanences**, choisissez des délais : **1 semaine**, **1 jour**, **1 heure**, **15 min** ou, avec **Personnalisé**, une valeur personnalisée entre 15 minutes et 14 jours. Vous pouvez en choisir plusieurs à la fois.
3. Choisissez comment les rappels vous parviennent sous **Avant le début de ma permanence d'astreinte** dans **Paramètres utilisateur** > **Paramètres de notification** (onglet Astreinte). L'e-mail et le push sont activés par défaut.
:::

Chaque rappel est envoyé une fois par permanence. Le message nomme le planning, les politiques via lesquelles il alerte et l'heure de début dans votre fuseau horaire.

- Une permanence qui tombe dans l'un de vos délais à cause d'un remplacement tardif — quelqu'un vous confie une permanence 20 minutes avant son début — reçoit immédiatement un seul rappel de rattrapage.
- Si une permanence pour laquelle vous avez été rappelé est confiée à quelqu'un d'autre, vous recevez **Ma prochaine permanence d'astreinte est réattribuée**, un type d'événement distinct pour pouvoir le désactiver séparément.
- Les rappels ne sont jamais envoyés après le début d'une permanence, ni pour des plannings rattachés à aucune politique d'escalade, puisque ceux-ci ne peuvent alerter personne.
- Sur WhatsApp, un rappel arrive via le modèle d'astreinte préapprouvé par Meta, qui nomme le planning et la politique d'escalade et renvoie vers le planning mais ne contient pas l'heure de début, et que WhatsApp ne diffuse qu'en anglais. Les avis de réaffectation n'ont pas de modèle WhatsApp approuvé : ils vous parviennent donc par vos autres canaux.

## Liens partagés pour un planning ou un projet

Un lien partagé appartient au **projet**, pas à la personne qui l'a copié, et il affiche les noms des personnes, jamais leurs adresses e-mail. Placez le lien du planning dans un calendrier d'équipe partagé — Google, Outlook ou Confluence — et un seul abonnement sert toute l'équipe.

### Flux de planning

Sur la page d'un planning, la carte **S'abonner à ce planning** a deux moitiés : **Uniquement mes permanences sur ce planning** (votre lien personnel avec un filtre de planning) et **Permanences de tous sur ce planning (lien d'équipe partagé)**. Quiconque a la permission **Modifier** sur les plannings peut **Publier le lien partagé**, le renouveler avec **Régénérer le lien** ou le **Désactiver** ; quiconque peut lire le planning peut le copier. La carte indique quand le lien a été renouvelé pour la dernière fois.

### Flux de projet

**Astreinte** > **Flux de calendrier** contient la carte **Permanences de tous dans ce projet (lien partagé)** — un seul lien partagé couvrant tous les plannings du projet — avec les mêmes actions de publication, de régénération et de désactivation, et un lien vers votre page de flux personnel.

### Paramètres des liens partagés

Cliquez sur **Modifier les paramètres** sur la carte **Paramètres du lien partagé** :

| Paramètre | Ce qu'il fait |
| --- | --- |
| **Afficher les trous de couverture** | Désactivé par défaut. Ajoute un événement `No coverage · <Schedule>` partout où une couche est _censée_ couvrir mais où personne n'est d'astreinte : une couche vide, une couche dont la date de début est dans le futur, des couches qui ne se raccordent pas, ou tout trou dans un planning 24×7. Les heures hors service d'un planning aux heures de bureau ne sont jamais signalées, et 100 événements de trou au plus sont émis, les plus anciens d'abord. |
| **Trou minimal à afficher (minutes)** | 60 par défaut. Masque les trous plus courts. |
| **Régénérer quand quelqu'un quitte le projet** | Désactivé par défaut. Régénère automatiquement le lien quand quelqu'un quitte sa dernière équipe dans le projet, pour que le calendrier d'un ancien collègue cesse de se mettre à jour. Tous les autres doivent alors se réabonner, c'est pourquoi c'est à activer soi-même. |
| **Jours de permanences passées**, **Jours à venir** | Comme pour le flux personnel. |

Renouvelez un lien partagé quand quelqu'un qui l'avait s'en va, ou activez la rotation automatique ci-dessus.

Quand une personne quitte sa dernière équipe dans un projet, OneUptime la retire aussi des couches de planning et des règles d'escalade de ce projet, supprime les remplacements en cours et futurs du projet qui la nomment (en tant que personne remplacée ou que remplaçant), désactive son flux personnel pour le projet et y supprime ses rappels. Un lien personnel n'affiche des permanences que tant que son propriétaire est membre du projet : c'est vérifié à chaque lecture du lien, si bien qu'une personne partie reçoit un calendrier vide, et la liste des permanences à venir dans l'application mobile ne couvre que les projets dont elle est encore membre.

## Les événements en détail

- Chaque permanence a une identité stable formée du planning et de son début, de sorte que la même permanence est le même événement dans votre flux personnel, dans le flux de planning et après la régénération d'un lien. Les applications de calendrier la mettent à jour sur place ; une modification incrémente le numéro de séquence de l'événement.
- Un remplacement qui échange toute la permanence conserve l'événement et change la personne ; un remplacement d'une partie de la permanence produit trois événements contigus, par exemple A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Lorsqu'un planning est rattaché à deux politiques d'escalade ou plus et qu'un remplacement ne s'applique qu'à l'une d'elles, les personnes alertées diffèrent selon la politique. Le flux le montre au lieu de le masquer : la permanence garde son événement pour la personne alertée par les autres politiques, avec une note nommant la politique qui alerte quelqu'un d'autre, et le remplaçant reçoit un événement supplémentaire intitulé `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Les permanences passées portent dans leur description la ligne « Past shifts reflect the current rotation, not who was actually paged ».
- Un planning rattaché à aucune politique d'escalade est tout de même affiché, avec une note indiquant qu'il n'alertera personne.

## Planifier, pas auditer

Le flux montre la rotation **telle qu'elle est configurée aujourd'hui**, y compris pour les jours passés : un remplacement saisi après coup réécrit l'historique dans le calendrier. Pour les heures réellement passées d'astreinte, les revues d'équité et la rémunération, utilisez **Astreinte** > **Rapports** > **Temps d'astreinte de l'utilisateur**, qui est établi à partir de ce que les alertes ont réellement fait.

## Sécurité

- Le jeton du lien est le seul identifiant. Quiconque possède le lien voit les permanences — noms, plannings, politiques — jusqu'à sa régénération. Ne collez pas de liens dans des salons de discussion ou des tickets ; lorsqu'une équipe a besoin d'un calendrier, partagez le lien du planning ou du projet plutôt que votre lien personnel.
- Les liens sont propres à chaque projet. Un lien personnel divulgué expose les permanences d'un seul projet, pas de tous les projets dont vous êtes membre.
- Régénérer un lien place l'ancien jeton dans une période de grâce de 30 jours (calendrier vide, puis 404). **Désactiver** sert un calendrier vide. Un lien inconnu ou expiré répond par un simple 404 sans indication. Les calendriers vides poussent les applications abonnées à vider leur copie ; un 404 les fait la conserver, c'est pourquoi désactiver et régénérer servent des calendriers vides.
- Les jetons sont stockés hachés ; la copie affichée sur la page des paramètres est chiffrée avec `ENCRYPTION_SECRET`. Définissez cette variable avec un vrai secret sur une installation auto-hébergée — le serveur avertit au démarrage lorsqu'elle n'est pas définie ou vaut encore l'une des valeurs d'exemple que fournit ce dépôt (`secret`, ou le `please-change-this-to-random-value` que définit `config.example.env`). Si vous la changez ensuite, la page propose **Régénérer le lien** car la copie stockée ne peut plus être lue ; le flux continue de fonctionner jusqu'à ce que vous le fassiez.
- Les réponses des flux sont marquées `Cache-Control: private`, exclues des moteurs de recherche (`X-Robots-Tag: noindex`) et limitées en débit par lien et par adresse cliente.

Le Nginx de OneUptime tient les requêtes de flux hors de ses journaux :

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Un jeton n'atterrit donc jamais dans un fichier journal à côté d'une adresse cliente ; l'application ne le journalise pas non plus. `access_log off` supprime la ligne par requête, `error_log` supprime les lignes que Nginx écrit lorsqu'un appel à l'application échoue — sans cela, le jeton de chaque client qui interroge pendant un redémarrage est enregistré — et `proxy_max_temp_file_size 0` évite qu'un gros flux passe par un fichier temporaire.

> [!WARNING]
> **Tout proxy, WAF ou CDN que vous placez devant OneUptime journalise toujours l'URI complète, dans son journal d'accès comme dans son journal d'erreurs,** sauf si vous le configurez autrement — vérifiez-le avant de déployer les flux.

## Configuration auto-hébergée

Rien n'est à activer : les flux fonctionnent sur toute installation. Quatre variables d'environnement les contrôlent, définies dans `config.env` pour Docker Compose ou sous `onCallCalendarFeed` dans les valeurs Helm (voir la [référence de configuration](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) du chart) :

| Variable | Valeur Helm | Par défaut | Effet |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Interrupteur d'arrêt. Chaque URL de flux répond `503` avec `Retry-After: 3600` ; les applications abonnées gardent leur copie et réessaient plus tard. Rien n'est supprimé. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Durée de la fenêtre de limitation. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Lectures qu'un lien peut faire depuis une adresse cliente par fenêtre. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Lectures qu'une adresse cliente peut faire sur tous les liens par fenêtre — le plafond pour tout un bureau derrière une seule adresse. |

À noter aussi :

- **`HOST` et `HTTP_PROTOCOL`** construisent les liens. Si `HOST` est vide ou vaut `localhost`, ou si `HTTP_PROTOCOL` vaut `http`, la page du flux affiche un avertissement et les liens ne fonctionneront pas depuis l'extérieur. Si `HOST` est une adresse privée — `10.x`, `172.16–31.x`, `192.168.x`, un nom sans point comme un nom de conteneur, ou un nom sous `.internal`, `.local`, `.lan` et similaires —, la page indique que Google Agenda et Outlook sur le web ne peuvent pas atteindre le lien ; les applications sur un ordinateur du même réseau le peuvent toujours.
- **`TRUSTED_PROXY_HOPS`** détermine quelle adresse compte pour la limite par adresse. La valeur par défaut `1` convient aux déploiements Docker Compose et Helm standard ; ajoutez-en un pour chaque proxy à vous — CDN, WAF ou répartiteur de charge — qui ajoute à `X-Forwarded-For`, sinon chaque client de calendrier semble venir de la même adresse et tous partagent un seul budget. Voir [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) dans la documentation du chart.
- **Redis** porte les caches et la limitation de débit. Les deux se dégradent proprement : sans Redis, les flux sont toujours générés, simplement plus lentement, et la limitation laisse passer les requêtes.
- En mode séparé du chart Helm (`worker.enabled: true`), les flux sont générés sur le niveau API ; dimensionnez ce niveau pour un afflux de clients de calendrier qui interrogent au début de chaque heure.
- L'exemption du journal d'accès Nginx montrée plus haut fait partie du `packages/Nginx/default.conf.template` livré ; conservez-la si vous personnalisez le modèle.

## Dépannage

:::details Google Agenda indique "Unable to add calendar. Check the URL."
Les anciennes versions de OneUptime plaçaient la forme `https://` du lien dans le bouton **Google Agenda**, alors que la page d'ajout par URL de Google n'accepte que la forme `webcal://`. Rechargez la page du flux et cliquez à nouveau sur **Google Agenda**, ou ajoutez le lien sous **Autres agendas** > **+** > **À partir de l'URL**.
:::

:::details Google Agenda affiche l'agenda mais aucune permanence
Vérifiez d'abord la ligne d'état de la page du flux. **Dernière récupération … par Google Calendar** signifie que Google a lu le lien : ouvrez le lien dans un navigateur et regardez ce qu'il sert — un calendrier vide indique sa raison dans `X-WR-CALDESC` (voir « Le calendrier est vide » ci-dessous).

**Pas encore récupéré** signifie que Google n'a pas pu le lire : depuis une machine hors de votre réseau, `curl -sI <link>` doit répondre immédiatement `200` avec `Content-Type: text/calendar`. Une redirection, une page de connexion, un pare-feu ou une vérification anti-robots devant OneUptime bloque le lecteur de Google ; une boucle de redirection des anciennes versions de OneUptime le faisait aussi, sur les installations avec `PROVISION_SSL=true` dont TLS se termine devant Nginx. Une fois qu'il répond `200`, ajoutez de nouveau le lien suivi de `?nocache=1` pour que Google le relise.
:::

:::details Rien n'a lu le lien, ou « Impossible de récupérer l'URL »
Google Agenda, Outlook sur le web, Fastmail et Proton lisent **depuis leurs propres serveurs** : l'hôte OneUptime doit donc être joignable depuis l'Internet public avec un certificat qu'ils reconnaissent. Une installation sur un réseau privé, derrière un VPN ou avec une autorité de certification interne leur est inaccessible, quoi que vous colliez.

Calendrier Apple, Thunderbird et Outlook classique lisent depuis l'appareil : ils fonctionnent partout où l'appareil peut ouvrir le tableau de bord — après avoir approuvé le certificat sur cet appareil s'il est auto-signé. La ligne d'état de la page du flux vous dit si quelque chose a déjà lu le lien ; `curl -I` sur le lien depuis l'extérieur de votre réseau est la vérification la plus rapide :

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Permettre à OneUptime d'_atteindre_ des réseaux privés — [Accès aux réseaux privés](/docs/self-hosted/private-network-access) — est une autre question et n'aide pas ici.
:::

:::details Le calendrier n'est pas à jour
Lisez d'abord le tableau d'actualisation : pour Google, le délai est normal. Pour forcer Google à relire, supprimez et rajoutez l'agenda ou ajoutez `?nocache=1` au lien (les paramètres inconnus sont ignorés, le flux est identique mais Google le traite comme nouveau). Dans Outlook classique, appuyez sur F9 et vérifiez le réglage **Limite de mise à jour**. Dans Calendrier Apple, utilisez **Présentation** > **Actualiser les calendriers**. Si un changement du jour même compte, fiez-vous aux rappels et avis de réaffectation de OneUptime plutôt qu'au calendrier.
:::

:::details Le calendrier est vide
Un calendrier vide est voulu. Il signifie que le lien est désactivé, qu'il s'agit d'un ancien lien dans sa période de grâce de 30 jours après une régénération, que le projet est en dessous de l'offre qui inclut les plannings d'astreinte, ou que vous ne figurez plus sur aucun planning de ce projet. Ouvrez le lien dans un navigateur : la description du calendrier (`X-WR-CALDESC`) en donne la raison. Si vous avez quitté le projet, le lien reste vide : il n'affiche des permanences que tant que vous êtes membre.
:::

:::details Le lien répond 404
Le lien est inconnu, a été supprimé, ou sa période de grâce est terminée. Générez-en un nouveau et réabonnez-vous.
:::

:::details Le lien répond 503
Soit `DISABLE_ON_CALL_CALENDAR_FEED` est défini, soit le serveur est occupé : seuls quelques flux sont générés à la fois, et un planning dont le calcul prend très longtemps est interrompu. Lorsqu'une copie précédente du flux existe, le serveur la sert à la place, avec un en-tête `Warning: 110` ; un 503 signifie donc qu'il n'y avait rien sur quoi se replier. Les clients gardent leur dernière copie et réessaient après l'intervalle `Retry-After`. Fastmail désactive un abonnement après cinq échecs consécutifs ; rajoutez-le une fois le serveur rétabli. La métrique `oncall_calendar_render_duration_ms` montre aux opérateurs quels flux sont lents.
:::

:::details 429 ou « trop de requêtes »
De nombreux clients derrière une même adresse — un NAT de bureau, une passerelle VPN — partagent le budget par adresse. Augmentez `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` et vérifiez `TRUSTED_PROXY_HOPS` : s'il est trop bas, chaque client est attribué à votre propre proxy et ils partagent tous un seul budget.
:::

:::details Erreurs de certificat dans Calendrier Apple, Thunderbird ou Outlook
Ces applications valident TLS sur l'appareil. Importez votre autorité de certification interne dans le magasin de confiance de l'appareil — le trousseau macOS, le magasin de certificats Windows, le gestionnaire de certificats de Thunderbird — ou utilisez un certificat publiquement reconnu. Les lecteurs côté serveur comme Google et Microsoft ne peuvent pas être amenés à faire confiance à une autorité privée.
:::

:::details Les heures sont fausses
Toutes les heures du fichier sont en UTC ; l'application de calendrier les convertit dans son propre fuseau. Si les permanences semblent décalées d'un écart fixe, vérifiez le fuseau du planning (**Schedule timezone** sur sa page **Couches**) et le vôtre (**Fuseau horaire** dans votre **Profil**). Un planning sans fuseau horaire est calculé dans le fuseau du serveur, et l'événement le signale.
:::

:::details Le flux indique qu'il a été raccourci
Plus de 5 000 événements tombaient dans la fenêtre. Réduisez **Jours à venir**, ou abonnez-vous à **Uniquement mes permanences sur ce planning** plutôt qu'à tout un projet.
:::

:::details Google affiche un ancien nom de calendrier
Google ne lit le nom qu'au premier abonnement ; supprimez l'agenda et rajoutez-le.
:::

:::details La page des paramètres indique que le lien doit être régénéré
`ENCRYPTION_SECRET` a changé depuis la création du lien, le serveur ne peut donc plus l'afficher. L'abonnement existant continue de fonctionner ; régénérer vous donne un lien que vous pouvez de nouveau copier et retire l'ancien au bout de 30 jours.
:::

:::details Une permanence manque dans mon flux
Seules les permanences des plannings apparaissent ; les affectations directes d'un utilisateur ou d'une équipe dans une règle de politique sont permanentes et n'ont pas d'événement. Une permanence reprise par quelqu'un d'autre via un remplacement quitte votre flux parce qu'elle est maintenant dans le sien. Activez **Inclure les permanences que j'assure pour d'autres** pour voir les permanences obtenues par des remplacements sur des plannings dont vous n'êtes pas membre.
:::

## Étapes suivantes

:::cards
- [Plannings d'astreinte](/docs/on-call/schedules): Configurer les rotations que montrent vos flux.
- [Chronologie des astreintes](/docs/on-call/schedule-timeline): Voir tous les plannings côte à côte dans le tableau de bord.
- [Règles d'escalade](/docs/on-call/escalation-rules): Rattacher des plannings à des politiques pour que leurs permanences alertent des personnes.
:::
