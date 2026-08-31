# Flux de calendrier (astreintes dans Google Agenda, Outlook et Calendrier Apple)

Les flux de calendrier placent vos astreintes dans le calendrier que vous consultez déjà. OneUptime publie un lien iCalendar (`.ics`) secret pour chaque personne, chaque planning et chaque projet ; Google Agenda, Outlook, Calendrier Apple, Thunderbird et toute autre application capable de s'abonner à un calendrier par URL interrogent ce lien et affichent un événement par astreinte. Rien n'est installé, aucun compte n'est connecté : le lien est toute l'intégration.

> **Note:** Un calendrier abonné sert à la **planification**. Les applications de calendrier relisent les flux à leur propre rythme — Google Agenda seulement toutes les 8 à 24 heures — donc un échange fait une heure avant une astreinte vous parvient par les rappels, les avis de réaffectation et les notifications de pager de OneUptime, pas par le calendrier.

## Ce que vous obtenez

- Un événement par astreinte, intitulé `On-call · <Schedule>` (avec ` · <Policy>` ajouté lorsque le planning est rattaché à exactement une politique d'escalade) dans votre flux personnel et `<Name> · On-call · <Schedule>` dans un flux partagé. La description indique qui est d'astreinte, le planning et son fuseau horaire, la couche, l'astreinte dans le fuseau du planning, en UTC et dans le vôtre, les politiques d'escalade qui vous appellent via ce planning, et un lien vers le planning dans le tableau de bord.
- Les remplacements sont respectés. Quand quelqu'un vous remplace, l'événement passe à cette personne (`(covering for <Name>)` est ajouté) et reste le même événement dans votre application, il est donc mis à jour sur place au lieu d'être dupliqué. Un remplacement partiel scinde l'astreinte en événements contigus.
- Deux jours d'historique et 90 jours à venir par défaut. Vous pouvez élargir jusqu'à 60 jours en arrière et 180 jours en avant ; un flux qui dépasserait 5 000 événements est raccourci et le signale dans la description du calendrier.
- Les événements sont marqués libres (`TRANSP:TRANSPARENT`), un flux abonné ne bloque donc jamais votre disponibilité, et rien n'est marqué privé, si bien qu'un calendrier d'équipe partagé montre les titres à tous ceux qui peuvent le voir.
- Les heures sont envoyées en UTC et converties par votre application ; la description précise l'heure locale dans le fuseau du planning et dans le vôtre. Réglez votre fuseau sous **Paramètres utilisateur** > **Profil** et celui du planning dans son onglet **Paramètres**. Un planning sans fuseau est calculé dans le fuseau du serveur, comme pour les appels, et l'événement l'indique.

Les affectations permanentes — un utilisateur ou une équipe nommés directement dans une règle de politique d'escalade — n'ont ni début ni fin et n'apparaissent dans aucun flux. Sur OneUptime Cloud, les flux suivent le même forfait que les plannings d'astreinte (Growth) ; un projet en dessous de ce forfait reçoit un calendrier vide plutôt qu'une erreur.

## Trois types de lien

| Lien                 | Qui le crée                                                                                     | Contenu                                                                                                       | Où                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Flux personnel**   | Chaque utilisateur, un par projet                                                               | Vos astreintes sur tous les plannings du projet, plus celles où vous remplacez quelqu'un (optionnel)          | **Paramètres utilisateur** > **Flux de calendrier**    |
| **Flux de planning** | Quiconque peut modifier le planning ; quiconque peut le lire peut copier le lien                | Les astreintes de tous sur un planning, avec des événements de trous de couverture en option                  | La page du planning, carte **S'abonner à ce planning** |
| **Flux de projet**   | Quiconque peut modifier les plannings d'astreinte ; quiconque peut les lire peut copier le lien | Les astreintes de tous sur tous les plannings du projet, avec des événements de trous de couverture en option | **Astreinte** > **Flux de calendrier**                 |

Les liens ressemblent à ceci :

```
https://<votre hôte>/api/on-call-calendar/user/<token>/shifts.ics
https://<votre hôte>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<votre hôte>/api/on-call-calendar/project/<token>/project.ics
```

Le jeton de 43 caractères dans le chemin est le seul identifiant — il n'y a ni connexion, ni cookie, ni clé API. Traitez chacun de ces liens comme un mot de passe.

## Votre flux personnel

1. Ouvrez **Paramètres utilisateur** > **Flux de calendrier** dans le projet dont vous voulez les astreintes. Les flux personnels sont par projet : un second projet donne un second lien et un second calendrier.
2. Cliquez sur **Générer le lien de calendrier**. La carte **S'abonner à vos astreintes** affiche alors le lien `https://` et trois boutons :
   - **Google Agenda** ouvre Google Agenda avec le lien prérempli.
   - **Apple / autres applications** ouvre la forme `webcals://` du lien, que macOS, iOS et la plupart des applications de bureau transmettent directement à leur boîte de dialogue d'abonnement.
   - **Copier le lien webcal** copie ce même lien `webcal(s)://` — celui dont Outlook classique pour Windows a besoin.
3. Abonnez-vous dans votre application de calendrier en suivant les étapes par application ci-dessous.

Paramètres sur la même carte :

- **Inclure les astreintes que j'assure pour d'autres** (activé par défaut) ajoute les astreintes qu'un remplacement vous donne sur des plannings dont vous n'êtes pas membre.
- **Jours d'astreintes passées** (2 par défaut, 60 au plus) et **Jours à venir** (90 par défaut, entre 7 et 180).

La ligne d'état indique quand le lien a été relu pour la dernière fois, par quelle application, combien de fois, et les quatre derniers caractères du jeton pour distinguer les liens. Si rien n'a relu le lien après deux jours, la page demande si le serveur est joignable depuis Internet (voir Dépannage).

La page liste aussi vos **Astreintes à venir** (les 30 prochains jours), chacune avec un lien **Trouver un remplaçant** qui ouvre les remplacements d'utilisateur préremplis pour cette astreinte, et la carte **Me rappeler avant les astreintes** décrite plus bas.

Actions :

- **Régénérer le lien** crée un nouveau jeton. Toute application abonnée à l'ancien lien cesse d'être mise à jour : pendant 30 jours l'ancien lien sert un calendrier vide pour que ces applications effacent leur copie, ensuite il renvoie 404. Réabonnez-vous avec le nouveau lien.
- **Désactiver** garde le lien mais sert un calendrier vide jusqu'à ce que vous le réactiviez.
- **Supprimer** retire le lien. Les applications qui l'interrogent encore reçoivent 404 et continuent d'afficher ce qu'elles ont chargé en dernier — désactivez d'abord si vous voulez qu'elles se vident.

Le même lien personnel, filtré sur un planning avec `?schedule=<id>`, est proposé sous **Seulement mes astreintes sur ce planning** sur chaque page de planning, et la bannière d'astreinte ainsi que la page **Mes politiques d'astreinte** comportent un lien **Ajouter vos astreintes à votre calendrier** vers la page ci-dessus.

Dans l'application mobile : **Astreinte** > **Ajouter mes astreintes à mon calendrier** (aussi sous **Paramètres** > **Flux de calendrier**), avec un lien par projet. Sur iPhone, **Ouvrir dans Calendrier** ouvre la feuille d'abonnement native. Sur Android, il n'existe aucun moyen de s'abonner à une URL sur le téléphone ; l'écran propose donc **Partager le lien** et **Copier le lien https** et vous invite à ajouter le lien sur un ordinateur, après quoi il se synchronise vers le téléphone. La liste **Vos astreintes** de l'application vient des mêmes données et offre la même action **Trouver un remplaçant**.

## S'abonner dans votre application de calendrier

Utilisez le lien `https://` sauf si l'application demande `webcal` ; la section sur les schémas ci-dessous explique la différence.

### Google Agenda (web)

1. Dans Google Agenda sur le web, à côté de **Autres agendas**, cliquez sur **+** > **À partir de l'URL**.
2. Collez le lien `https://` et cliquez sur **Ajouter l'agenda**. Le bouton **Google Agenda** dans OneUptime fait la même chose avec le lien prérempli.

Google relit le flux **depuis les serveurs de Google**, environ toutes les 8 à 24 heures, parfois plus. Il n'y a pas de bouton d'actualisation pour les agendas abonnés, et Google ignore les indications d'actualisation du flux. Le nom et le fuseau horaire de l'agenda sont lus **uniquement au premier abonnement** : renommer un planning ensuite ne renomme pas l'agenda dans Google — supprimez-le et rajoutez-le si le nom compte. Google ignore les rappels contenus dans les fichiers de calendrier ; définissez des notifications par défaut sur cet agenda dans les paramètres Google, ou mieux, utilisez les rappels de OneUptime. Si Google signale qu'il n'a pas pu récupérer l'URL, vérifiez que vous avez collé la forme `https://` et non `webcal://`, et ajoutez `?nocache=1` pour le faire réessayer (OneUptime ignore les paramètres de requête inconnus, le flux lui-même ne change pas). L'application Google Agenda sur Android et iOS ne peut pas s'abonner par URL ; ajoutez le lien sur un ordinateur et il apparaît sur le téléphone.

### Outlook sur le web et Outlook.com

1. Ouvrez **Calendrier** > **Ajouter un calendrier** > **S'abonner à partir du web**.
2. Collez le lien `https://`, donnez un nom au calendrier et cliquez sur **Importer**.

Outlook relit **depuis les serveurs de Microsoft** : environ toutes les 3 heures pour Outlook.com et toutes les 4 à 6 heures pour les comptes professionnels ou scolaires, parfois plus d'une journée. L'intervalle est fixe, sans actualisation manuelle. Abonnez-vous ici plutôt que dans l'application de bureau si vous voulez le calendrier aussi sur votre téléphone et dans Outlook sur le web — les abonnements créés dans Outlook classique pour Windows restent sur ce PC. Le nouvel Outlook pour Windows et Outlook pour Mac utilisent la même boîte de dialogue **Ajouter un calendrier** > **S'abonner à partir du web**.

### Outlook classique pour Windows

1. Dans OneUptime, cliquez sur **Copier le lien webcal**.
2. Dans Outlook, ouvrez **Fichier** > **Paramètres du compte** > **Paramètres du compte** > **Calendriers Internet** > **Nouveau**, collez le lien `webcals://` et cliquez sur **Ajouter**. Ouvrir un lien `webcal` dans un navigateur fonctionne aussi sur un PC où Outlook est installé ; sans Outlook, Windows n'a pas de gestionnaire `webcal`.

N'ouvrez **pas** le lien `https://…/shifts.ics` lui-même dans Outlook classique : il importe un instantané unique qui n'est jamais mis à jour. Seuls `webcal://` et `webcals://` créent un abonnement.

Le flux est actualisé à chaque **Envoyer/Recevoir** (F9, ou l'intervalle des groupes d'envoi/réception). Les paramètres de l'abonnement comportent une case **Limite de mise à jour** : cochée, Outlook n'actualise pas plus vite que l'intervalle suggéré par l'éditeur. OneUptime suggère une heure (`X-PUBLISHED-TTL:PT1H`), le flux est donc actualisé environ toutes les heures. Les flux sans cette indication ne s'actualisent jamais tant que la case est cochée ; ceux de OneUptime la portent, vous pouvez donc laisser la case cochée. Outlook classique relit le flux **depuis votre PC** et vérifie le certificat du serveur.

### Calendrier Apple sur macOS

1. Cliquez sur **Apple / autres applications** dans OneUptime, ou dans Calendrier choisissez **Fichier** > **Nouvel abonnement à un calendrier** et collez le lien.
2. Dans la feuille d'abonnement, réglez **Actualisation automatique** — toutes les 5 minutes, 15 minutes, heures, jours ou semaines (toutes les heures par défaut) — et choisissez **iCloud** sous **Emplacement** pour que le calendrier apparaisse aussi sur votre iPhone et iPad et continue de s'actualiser à ce rythme.

macOS relit le flux **depuis votre Mac**, ce qui fonctionne pour une installation sur un réseau privé tant que le Mac peut l'atteindre. Un certificat auto-signé ou émis par une autorité interne doit d'abord être approuvé dans le trousseau macOS. **Supprimer les alertes** est coché par défaut dans cette feuille ; cela n'a aucune incidence ici car le flux ne contient pas d'alarmes.

### iPhone et iPad

Les abonnements créés sur l'appareil lui-même s'actualisent selon **Réglages** > **Calendrier** > **Comptes** > **Nouvelles données** — **Automatiquement** par défaut, ce qui relit surtout en charge et en Wi-Fi. Pour une actualisation fiable, abonnez-vous sur un Mac avec **iCloud** comme emplacement, ou réglez **Nouvelles données** sur un intervalle fixe. Pour vous abonner sur l'appareil, touchez **Ouvrir dans Calendrier** dans l'application mobile OneUptime, ou allez dans **Réglages** > **Calendrier** > **Comptes** > **Ajouter un compte** > **Autre** > **Ajouter un cal. avec abonnement** et collez le lien.

### Thunderbird

Choisissez **Fichier** > **Nouveau** > **Agenda** > **Sur le réseau** > **iCalendar (ICS)**, collez le lien `https://` et choisissez un intervalle d'actualisation dans les propriétés de l'agenda : 1, 5, 15, 30 ou 60 minutes. Thunderbird relit **depuis votre ordinateur** et doit faire confiance au certificat du serveur.

### Fastmail, Proton et autres services

Fastmail actualise environ toutes les heures et **désactive un abonnement après cinq récupérations échouées consécutives** ; si cela arrive, rajoutez-le une fois le serveur rétabli. Proton Calendar actualise toutes les 4 à 16 heures et refuse les flux très volumineux — réduisez **Jours à venir** s'il se plaint. Confluence Team Calendars accepte le flux de planning ; sa limite de 28 caractères sur les noms de calendrier est respectée.

### Android

Ni l'application Google Agenda ni Samsung Calendar ne peuvent s'abonner à une URL. Ajoutez le lien `https://` à Google Agenda sur un ordinateur (**Autres agendas** > **+** > **À partir de l'URL**) ; l'agenda se synchronise ensuite vers le téléphone avec le reste du compte Google. L'application mobile OneUptime sur Android propose **Partager le lien** et **Copier le lien https** exactement pour cela.

## Fréquence d'actualisation des calendriers

| Application de calendrier          | Actualisation typique                                                                | Relit depuis          | Remarques                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------- |
| Google Agenda (À partir de l'URL)  | 8–24 heures, parfois plus                                                            | Serveurs de Google    | Pas d'actualisation manuelle ; ignore les indications ; nom et fuseau lus au premier abonnement seulement |
| Outlook.com                        | Environ 3 heures                                                                     | Serveurs de Microsoft | Fixe ; peut dépasser 24 heures                                                                            |
| Outlook sur le web (pro, scolaire) | Environ 4–6 heures                                                                   | Serveurs de Microsoft | Fixe ; aucun contrôle utilisateur                                                                         |
| Outlook classique pour Windows     | À chaque Envoyer/Recevoir ; environ toutes les heures avec **Limite de mise à jour** | Votre PC              | Nécessite un lien `webcal` ; ne se synchronise ni vers le téléphone ni vers le web                        |
| Calendrier Apple (macOS)           | De 5 minutes à hebdomadaire, toutes les heures par défaut                            | Votre Mac             | Stockez dans iCloud pour atteindre iPhone et iPad                                                         |
| Calendrier Apple (iOS seul)        | Selon **Nouvelles données**, limité par la batterie                                  | Votre téléphone       | Abonnez-vous sur un Mac pour plus de fiabilité                                                            |
| Thunderbird                        | 1–60 minutes                                                                         | Votre ordinateur      |                                                                                                           |
| Fastmail                           | Environ toutes les heures                                                            | Serveurs de Fastmail  | Désactivé après cinq récupérations échouées                                                               |
| Proton Calendar                    | 4–16 heures                                                                          | Serveurs de Proton    | Refuse les flux volumineux                                                                                |

OneUptime lui-même sert des données fraîches : une modification d'une couche, d'une rotation, d'un remplacement ou d'un rattachement de politique invalide le flux immédiatement, et les réponses sont mises en cache au plus cinq minutes. L'attente que vous constatez est celle de l'application de calendrier, pas du serveur. OneUptime suggère une actualisation horaire via `REFRESH-INTERVAL` et `X-PUBLISHED-TTL` ; seul Outlook classique en tient compte, et uniquement avec **Limite de mise à jour** activée — Calendrier Apple, Thunderbird et les autres s'actualisent à l'intervalle que vous définissez par calendrier.

## https, webcal et webcals

Les trois pointent vers le même flux. `webcal://` et `webcals://` sont le lien `http://` et `https://` avec le schéma renommé, pour que le système ouvre une application de calendrier au lieu d'un navigateur ; `webcals` est la variante chiffrée, celle que OneUptime propose quand `HTTP_PROTOCOL` vaut `https`.

- Google Agenda, Outlook sur le web, Thunderbird et Fastmail veulent la forme `https://`.
- Calendrier Apple et Outlook classique pour Windows s'abonnent à partir d'un lien `webcal(s)://` ; dans Outlook classique, la forme `https://` est un import unique.
- `webcal://` sans le `s` n'est pas chiffré et envoie le jeton en clair à chaque récupération. Si votre installation tourne encore en `http` simple, le tableau de bord affiche un avertissement à côté du lien ; passez en `https` avant de partager largement des liens.

## Rappels et avis de réaffectation

Les applications de calendrier ne délivrent pas les alarmes des flux abonnés — Google les supprime, Apple les retire par défaut, Outlook les aplatit — OneUptime envoie donc les siens.

Sous **Paramètres utilisateur** > **Flux de calendrier**, la carte **Me rappeler avant les astreintes** vous laisse choisir des délais : **1 semaine**, **1 jour**, **1 heure**, **15 min** ou une valeur personnalisée entre 15 minutes et 14 jours, plusieurs à la fois. Chaque rappel est envoyé une fois par astreinte via les moyens de livraison choisis pour **Avant le début de mon astreinte** sous **Paramètres utilisateur** > **Paramètres de notification** (onglet Astreinte ; e-mail et push sont activés par défaut). Le message nomme le planning, les politiques via lesquelles il appelle et l'heure de début dans votre fuseau.

- Une astreinte qui tombe dans l'un de vos délais à cause d'un remplacement tardif — quelqu'un vous confie une astreinte 20 minutes avant son début — reçoit immédiatement un rappel de rattrapage unique.
- Si une astreinte pour laquelle vous avez été rappelé est confiée à quelqu'un d'autre, vous recevez **Mon astreinte à venir est réaffectée**, un type d'événement distinct que l'on peut couper séparément.
- Les rappels ne sont jamais envoyés après le début d'une astreinte, ni pour des plannings rattachés à aucune politique d'escalade, car ceux-ci ne peuvent appeler personne.
- Sur WhatsApp, un rappel arrive via le modèle d'astreinte préapprouvé de Meta : il nomme le planning et la politique d'escalade et pointe vers le planning, mais ne porte pas l'heure de début, et WhatsApp ne le diffuse qu'en anglais. Les avis de réattribution n'ont pas de modèle WhatsApp approuvé et vous parviennent donc par vos autres canaux.

## Liens partagés pour un planning ou un projet

Un lien partagé appartient au **projet**, pas à celui qui l'a copié, et il montre les noms des personnes, jamais leurs adresses e-mail.

**Flux de planning.** Sur la page d'un planning, la carte **S'abonner à ce planning** a deux moitiés : **Seulement mes astreintes sur ce planning** (votre lien personnel avec un filtre de planning) et **Astreintes de tous sur ce planning (lien d'équipe partagé)**. Quiconque a la permission **Modifier** sur les plannings peut **Publier le lien partagé**, le **Régénérer** ou le **Désactiver** ; quiconque peut lire le planning peut le copier. La carte indique quand le lien a été renouvelé pour la dernière fois.

**Flux de projet.** **Astreinte** > **Flux de calendrier** contient la carte **Astreintes de tous dans ce projet (lien partagé)** — un lien partagé couvrant tous les plannings du projet — avec les mêmes actions de publication, régénération et désactivation, et un lien vers votre page de flux personnel.

Paramètres sur les deux :

- **Afficher les trous de couverture** (désactivé par défaut) ajoute un événement `No coverage · <Schedule>` partout où une couche est _censée_ couvrir mais où personne n'est d'astreinte : une couche vide, une couche dont la date de début est dans le futur, des couches mal alignées, ou tout trou dans un planning 24×7. Les heures creuses d'un planning en heures ouvrées ne sont jamais signalées. **Trou minimal à afficher (minutes)** (60 par défaut) masque les trous plus courts ; au plus 100 événements de trou sont émis, les plus anciens d'abord.
- **Régénérer quand quelqu'un quitte le projet** (désactivé par défaut) régénère automatiquement le lien quand quelqu'un quitte sa dernière équipe du projet, pour que le calendrier d'un ancien collègue cesse d'être mis à jour. Tous les autres doivent ensuite se réabonner, d'où l'activation volontaire.
- **Jours d'astreintes passées** et **Jours à venir**, comme sur le flux personnel.

Placez le lien de planning dans un calendrier d'équipe partagé — Google, Outlook ou Confluence — et un seul abonnement sert toute l'équipe. Renouvelez-le quand quelqu'un qui l'avait s'en va, ou activez le renouvellement automatique ci-dessus.

Quand une personne quitte sa dernière équipe d'un projet, OneUptime la retire aussi des couches de planning et des règles d'escalade de ce projet, supprime les remplacements en cours et à venir du projet qui la mentionnent (comme personne remplacée ou comme remplaçante), désactive son flux personnel pour le projet et supprime ses rappels.

## Les événements en détail

- Chaque astreinte a une identité stable formée du planning et de l'heure de début, si bien que la même astreinte est le même événement dans votre flux personnel, dans le flux de planning et après régénération d'un lien. Les applications le mettent à jour sur place ; une modification incrémente son numéro de séquence.
- Un remplacement qui échange toute l'astreinte conserve l'événement et change la personne ; un remplacement partiel produit trois événements contigus, par exemple A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Quand un planning est rattaché à deux politiques d'escalade ou plus et qu'un remplacement ne s'applique qu'à l'une d'elles, les personnes appelées diffèrent selon la politique. Le flux le montre au lieu de le cacher : l'astreinte garde son événement pour la personne appelée par les autres politiques, avec une note nommant la politique qui appelle quelqu'un d'autre, et le remplaçant reçoit un événement supplémentaire intitulé `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Les astreintes passées portent dans leur description la ligne « Past shifts reflect the current rotation, not who was actually paged ».
- Un planning rattaché à aucune politique d'escalade est tout de même affiché, avec une note indiquant qu'il n'appellera personne.

## Planification, pas audit

Le flux montre la rotation **telle qu'elle est configurée maintenant**, y compris pour les jours passés : un remplacement saisi après coup réécrit l'historique dans le calendrier. Pour les heures réellement passées d'astreinte, les revues d'équité et la rémunération, utilisez **Astreinte** > **Rapports** > **Temps d'astreinte par utilisateur**, qui est écrit à partir de ce que le pager a réellement fait.

## Sécurité

- Le jeton du lien est le seul identifiant. Quiconque possède le lien voit les astreintes — noms, plannings, politiques — jusqu'à sa régénération. Ne collez pas de liens dans des salons de discussion ou des tickets ; quand une équipe a besoin d'un calendrier, partagez le lien de planning ou de projet plutôt que votre lien personnel.
- Les liens sont par projet. Un lien personnel divulgué expose les astreintes d'un projet, pas celles de tous les projets auxquels vous appartenez.
- **Régénérer** place l'ancien jeton dans une période de grâce de 30 jours (calendrier vide, puis 404). **Désactiver** sert un calendrier vide. Un lien inconnu ou expiré renvoie un simple 404 sans indice. Les calendriers vides font vider leur copie aux applications abonnées ; un 404 la leur fait garder, c'est pourquoi désactiver et régénérer servent des calendriers vides.
- Les jetons sont stockés hachés ; la copie affichée sur la page des paramètres est chiffrée avec `ENCRYPTION_SECRET`. Donnez à cette variable un vrai secret sur une installation auto-hébergée — le serveur avertit au démarrage quand elle est absente ou vaut encore l'un des espaces réservés livrés dans ce dépôt (`secret`, ou le `please-change-this-to-random-value` que définit `config.example.env`). Si vous la changez ensuite, la page propose **Régénérer le lien** car la copie stockée ne peut plus être lue ; le flux continue de fonctionner jusqu'à ce que vous le fassiez.
- Les réponses des flux sont marquées `Cache-Control: private`, exclues des moteurs de recherche (`X-Robots-Tag: noindex`) et limitées en débit par lien et par adresse cliente.
- Le Nginx de OneUptime tient les requêtes de flux à l'écart de ses journaux :

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      error_log /dev/null crit;
      proxy_max_temp_file_size 0;
      ...
  }
  ```

  ainsi un jeton n'atterrit jamais dans un fichier journal à côté d'une adresse cliente ; l'application ne le journalise pas non plus. `access_log off` supprime la ligne par requête, `error_log` supprime les lignes que Nginx écrit lorsqu'un appel à l'application échoue — sans elle, chaque client qui interroge le flux pendant un redémarrage voit son jeton consigné — et `proxy_max_temp_file_size 0` évite qu'un flux volumineux passe par un fichier temporaire. **Tout proxy, WAF ou CDN que vous placez devant OneUptime journalise toujours l'URI complète, dans son journal d'accès comme dans son journal d'erreurs**, sauf configuration contraire — vérifiez cela avant de déployer les flux.

## Configuration auto-hébergée

Rien n'est à activer : les flux fonctionnent sur toute installation. Quatre variables d'environnement les contrôlent, définies dans `config.env` pour Docker Compose ou sous `onCallCalendarFeed` dans les valeurs Helm (voir la [référence de configuration](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) du chart) :

| Variable                                                | Valeur Helm                                      | Défaut  | Effet                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false` | Coupe-circuit. Toute URL de flux répond `503` avec `Retry-After: 3600` ; les applications abonnées gardent leur copie et réessaient plus tard. Rien n'est supprimé. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`    | Durée de la fenêtre de limitation.                                                                                                                                  |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`    | Récupérations qu'un lien peut faire depuis une adresse cliente par fenêtre.                                                                                         |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`  | Récupérations qu'une adresse cliente peut faire tous liens confondus par fenêtre — le plafond pour tout un bureau derrière une seule adresse.                       |

Également pertinent :

- **`HOST` et `HTTP_PROTOCOL`** construisent les liens. Si `HOST` est vide ou `localhost`, ou si `HTTP_PROTOCOL` vaut `http`, la page du flux affiche un avertissement et les liens ne fonctionneront pas de l'extérieur.
- **`TRUSTED_PROXY_HOPS`** décide quelle adresse la limite par adresse compte. La valeur par défaut `1` convient aux dispositions Docker Compose et Helm standard ; ajoutez un pour chaque proxy à vous — CDN, WAF ou répartiteur de charge — qui ajoute à `X-Forwarded-For`, sinon chaque client de calendrier ressemble à la même adresse et tous partagent un seul budget. Voir [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) dans la documentation du chart.
- **Redis** porte les caches et le limiteur de débit. Les deux se dégradent proprement : sans Redis, les flux sont toujours rendus, seulement plus lentement, et le limiteur laisse passer les requêtes.
- En mode séparé du chart Helm (`worker.enabled: true`), les flux sont rendus sur l'étage API ; dimensionnez cet étage pour une rafale de clients de calendrier interrogeant à l'heure pile.
- L'exemption du journal d'accès Nginx montrée plus haut fait partie du `Nginx/default.conf.template` livré ; conservez-la si vous personnalisez le modèle.

## Dépannage

**Rien n'a relu le lien, ou « Impossible de récupérer l'URL ».** Google Agenda, Outlook sur le web, Fastmail et Proton relisent **depuis leurs propres serveurs**, l'hôte OneUptime doit donc être joignable depuis l'Internet public avec un certificat auquel ils font confiance. Une installation sur un réseau privé, derrière un VPN ou avec une autorité de certification interne leur est inaccessible quoi que vous colliez. Calendrier Apple, Thunderbird et Outlook classique relisent depuis l'appareil et fonctionnent partout où l'appareil peut ouvrir le tableau de bord — après avoir approuvé le certificat sur cet appareil s'il est auto-signé. La ligne d'état de la page du flux vous dit si quelque chose a déjà relu le lien ; `curl -I` sur le lien depuis l'extérieur de votre réseau est la vérification la plus rapide. Autoriser OneUptime à _atteindre_ des réseaux privés — [Accès aux réseaux privés](/docs/self-hosted/private-network-access) — est un autre sujet et n'aide pas ici.

**Le calendrier est périmé.** Lisez d'abord le tableau d'actualisation : pour Google, le délai est normal. Pour forcer Google à relire, supprimez et rajoutez l'agenda ou ajoutez `?nocache=1` au lien (les paramètres inconnus sont ignorés, le flux est identique mais Google le traite comme nouveau). Dans Outlook classique, appuyez sur F9 et vérifiez le réglage **Limite de mise à jour**. Dans Calendrier Apple, utilisez **Présentation** > **Actualiser les calendriers**. Si un changement du jour même compte, fiez-vous aux rappels et avis de réaffectation de OneUptime plutôt qu'au calendrier.

**Le calendrier est vide.** Un calendrier vide est voulu. Cela signifie que le lien est désactivé, qu'il s'agit d'un ancien lien dans sa période de grâce de 30 jours après régénération, que le projet est en dessous du forfait incluant les plannings d'astreinte, ou que vous n'êtes plus sur aucun planning de ce projet. Ouvrez le lien dans un navigateur : la description du calendrier (`X-WR-CALDESC`) indique la raison.

**404.** Le lien est inconnu, a été supprimé, ou sa période de grâce est terminée. Générez-en un nouveau et réabonnez-vous.

**503.** Soit `DISABLE_ON_CALL_CALENDAR_FEED` est défini, soit le serveur est occupé : quelques flux au plus sont rendus en même temps, et un planning très long à calculer est interrompu. Quand une copie précédente du flux existe, le serveur la sert à la place avec un en-tête `Warning: 110` ; un 503 signifie donc qu'il n'y avait rien sur quoi se rabattre. Les clients gardent leur dernière copie et réessaient après l'intervalle `Retry-After`. Fastmail désactive un abonnement après cinq échecs consécutifs ; rajoutez-le une fois le serveur rétabli. La métrique `oncall_calendar_render_duration_ms` montre aux opérateurs quels flux sont lents.

**429 ou « trop de requêtes ».** Beaucoup de clients derrière une même adresse — un NAT de bureau, une passerelle VPN — partagent le budget par adresse. Augmentez `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` et vérifiez `TRUSTED_PROXY_HOPS` : trop bas, chaque client est attribué à votre propre proxy et tous partagent un seul budget.

**Erreurs de certificat dans Calendrier Apple, Thunderbird ou Outlook.** Ces applications valident TLS sur l'appareil. Importez votre autorité interne dans le magasin de confiance de l'appareil — trousseau macOS, magasin de certificats Windows, gestionnaire de certificats de Thunderbird — ou utilisez un certificat de confiance publique. Les relecteurs côté serveur comme Google et Microsoft ne peuvent pas être amenés à faire confiance à une autorité privée.

**Les heures sont fausses.** Toutes les heures du fichier sont en UTC ; l'application de calendrier convertit dans son propre fuseau. Si les astreintes semblent décalées d'un intervalle fixe, vérifiez le fuseau du planning (onglet **Paramètres**) et le vôtre (**Paramètres utilisateur** > **Profil**). Un planning sans fuseau est calculé dans le fuseau du serveur et l'événement l'indique.

**Le flux indique qu'il a été raccourci.** Plus de 5 000 événements tombaient dans la fenêtre. Réduisez **Jours à venir**, ou abonnez-vous à **Seulement mes astreintes sur ce planning** plutôt qu'à tout un projet.

**Google affiche un ancien nom d'agenda.** Google lit le nom uniquement au premier abonnement ; supprimez et rajoutez l'agenda.

**La page des paramètres dit que le lien doit être régénéré.** `ENCRYPTION_SECRET` a changé depuis la création du lien, le serveur ne peut donc plus l'afficher. L'abonnement existant continue de fonctionner ; régénérer vous donne un lien à nouveau copiable et retire l'ancien après 30 jours.

**Une astreinte manque dans mon flux.** Seules les astreintes de planning apparaissent ; les affectations directes d'utilisateur ou d'équipe dans une règle de politique sont permanentes et n'ont pas d'événements. Une astreinte reprise par quelqu'un d'autre via un remplacement quitte votre flux car elle est désormais dans le sien. Activez **Inclure les astreintes que j'assure pour d'autres** pour voir les astreintes obtenues par remplacement sur des plannings dont vous n'êtes pas membre.
