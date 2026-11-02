# Google Workspace

Importez les journaux d'audit de [Google Workspace](https://workspace.google.com) dans les événements de sécurité de OneUptime : les connexions et ce que Google y a repéré, les modifications des administrateurs, les applications ayant reçu un accès aux données, l'authentification unique, les paramètres de sécurité propres aux comptes et, si vous le souhaitez, les fichiers partagés hors de l'organisation ou téléchargés dans Google Drive. Vous les y recherchez à côté de vos logs, traces et métriques, vous les corrélez avec toutes les autres sources, et vous prévenez l'astreinte pour celles qui comptent. OneUptime les lit avec un compte de service qui agit en tant que l'un de vos administrateurs, et ne modifie rien dans Google Workspace.

:::cards
- [Configurer la connexion](#configurer-la-connexion): Un compte de service, la délégation au niveau du domaine et le formulaire de la connexion.
- [Ce qui est importé](#ce-qui-est-importé): Quelles activités, et comment chacune devient un événement de sécurité.
- [Fonctionnement des interrogations](#fonctionnement-des-interrogations): La fenêtre que lit chaque interrogation, et pourquoi elle chevauche la précédente de 2 heures.
- [Dépannage](#dépannage): Ce que signifie chaque erreur, et ce qu'il faut changer.
:::

## Fonctionnement

```mermaid title="D'une activité Google Workspace à un événement de sécurité"
flowchart TB
    gws["Google Workspace<br/>enregistre une<br/>activité"] --> poll["OneUptime interroge<br/>à l'intervalle de<br/>la connexion"]
    poll --> token["Son compte de service<br/>agit en tant que<br/>votre administrateur"]
    token --> list["Il liste les activités<br/>de chaque journal<br/>depuis la dernière fois"]
    list --> event["Chacun est stocké<br/>comme événement OCSF<br/>de son type"]
```

Chaque minute, OneUptime interroge chaque connexion activée dont l'intervalle d'interrogation est écoulé. Une interrogation se connecte en tant que votre compte de service au nom de l'administrateur que vous indiquez, et liste les activités de chaque journal d'audit depuis la dernière interrogation ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)) : administration, connexions, jetons OAuth, SAML, sécurité des comptes et, quand l'option **Activité Drive** est activée, Drive. Chaque événement d'une activité est stocké comme un événement [OCSF](https://schema.ocsf.io/) : une connexion comme un événement Authentication, un rôle d'administrateur attribué comme un événement User Access Management, une connexion signalée par Google comme un Detection Finding.

## Avant de commencer

- Dans OneUptime, le rôle Project Owner, Project Admin ou Security Admin. Les rôles Security Member et Security Viewer voient les connexions et l'historique de leurs exécutions, mais ne peuvent pas les modifier.
- Un super administrateur Google Workspace, pour autoriser la délégation au niveau du domaine, et un administrateur en tant que lequel le compte de service agit, avec le privilège Reports. Un super administrateur l'a.
- Un projet Google Cloud dans lequel vous pouvez créer un compte de service et activer l'Admin SDK API.
- Pour l'activité Drive, une édition dotée du journal d'audit de Drive, comme Business Standard, Business Plus, Enterprise ou Education.
- Du HTTPS sortant depuis l'application et les workers OneUptime vers `oauth2.googleapis.com` et `admin.googleapis.com`.

## Configurer la connexion

La connexion s'authentifie avec la clé d'un compte de service et la [délégation au niveau du domaine](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), avec un seul champ d'application en lecture seule : `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Créer un compte de service et une clé

1. Dans la [console Google Cloud](https://console.cloud.google.com), choisissez un projet, ouvrez **APIs & Services → Library**, trouvez **Admin SDK API**, et sélectionnez **Enable**.
2. Ouvrez **IAM & Admin → Service accounts → Create service account**, nommez-le `oneuptime-security-events`, et sélectionnez **Done**. Il n'a besoin d'aucun rôle dans le projet.
3. Ouvrez le compte de service et copiez son **Unique ID**, l'ID client que nomme la délégation. Dans l'onglet **Keys**, sélectionnez **Add key → Create new key → JSON**, et gardez le fichier : c'est la clé.

### Autoriser la délégation au niveau du domaine

1. Dans la [console d'administration Google](https://admin.google.com), en tant que super administrateur, ouvrez **Security → Access and data control → API controls → Manage domain-wide delegation**, et sélectionnez **Add new**.
2. Saisissez l'**Unique ID** du compte de service comme **Client ID**, et `https://www.googleapis.com/auth/admin.reports.audit.readonly` comme **OAuth scope**. Sélectionnez **Authorize**. Google peut mettre quelques minutes à l'appliquer.
3. Pour que les playbooks puissent suspendre, réactiver et déconnecter des utilisateurs (voir [Confinement](/docs/telemetry/security-cases#confinement)), ajoutez `https://www.googleapis.com/auth/admin.directory.user` et `https://www.googleapis.com/auth/admin.directory.user.security` aux champs d'application du même client, séparés par des virgules. L'administrateur en tant que lequel la connexion agit doit alors gérer ces utilisateurs.

### Ajouter la connexion dans OneUptime

Ouvrez **Produits → Événements de sécurité → Connexions** (`/dashboard/{projectId}/security-events/connections`), cliquez sur **Ajouter une connexion**, choisissez **Google Workspace** sous **Identité**, et cliquez sur **Suivant**. Saisissez l'**Administrator email**, cliquez sur **Suivant**, et collez le contenu du fichier de clé dans **JSON du compte de service**. À l'étape **Interrogation**, activez **Activité Drive** pour lire aussi Drive.

### La tester avant d'enregistrer

Cliquez sur **Tester ces paramètres** sous **Tester avant d'enregistrer**. Le test se connecte et lit les journaux de connexion et d'administration avec les valeurs du formulaire, et n'enregistre rien, une délégation manquante apparaît donc avant que la connexion existe. Cliquez ensuite sur **Suivant**, donnez à la connexion un **Nom**, et créez-la.
:::

| Réglage | Ce qu'il faut saisir |
| --- | --- |
| **Administrator email** | L'adresse de l'administrateur en tant que lequel le compte de service agit, comme `admin@example.com`. Il doit avoir le privilège Reports. |
| **Activité Drive** | Facultatif, désactivé par défaut. Activé, chaque interrogation lit aussi les partages et téléchargements de Drive. |
| **JSON du compte de service** | Le fichier de clé entier, qui contient `client_email` et `private_key`. Il est chiffré, jamais renvoyé par l'API et plus jamais affiché. Remplacez-le avec **Mettre à jour les identifiants** sur la connexion. |

L'étape **Interrogation** contient aussi une **Description** facultative, le **Intervalle d'interrogation (minutes)**, un nombre entier de `1` à `1440` qui vaut `5` au départ, et **Activé**, qui est activé au départ.

## Ce qui est importé

Chaque événement a le fournisseur `Google` et le produit `Google Workspace`. Une activité qui contient plusieurs événements devient un événement de sécurité pour chacun, et chaque événement garde les champs de l'activité et les siens, sous la forme `event.name`, `event.type` et `parameters.<name>`, pour qu'une règle les lise sous les noms de Google.

| Journal | Événements | Classe OCSF | Gravité |
| --- | --- | --- | --- |
| Connexions (`login`) | `login_success`, `login_failure` avec sa raison, `login_challenge`. Une déconnexion est lue mais pas importée. | Authentication (`3002`) | Informational ; Low pour un échec ; Medium quand Google la marque `is_suspicious` |
| Détections de Google (`login`) | `suspicious_login` et ses variantes, `gov_attack_warning`, `account_disabled_hijacked` et les autres comptes que Google a désactivés | Detection Finding (`2004`) | Medium ; High pour une attaque soutenue par un État, un compte piraté ou un mot de passe divulgué |
| Administration (`admin`) | Privilèges et rôles d'administrateur accordés ou retirés, délégation au niveau du domaine, utilisateurs créés, supprimés ou suspendus, validation en deux étapes désactivée, membres de groupes, paramètres | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium pour un pouvoir accordé ; Low pour un utilisateur supprimé ou une validation en deux étapes désactivée |
| Jetons OAuth (`token`) | Une application qui a reçu l'accès aux données de quelqu'un, avec ses champs d'application, ou à qui cet accès a été retiré | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Une authentification unique dans une application | Authentication (`3002`) | Low pour un échec |
| Sécurité des comptes (`user_accounts`) | Modifications de la validation en deux étapes, du mot de passe et de la récupération | Account Change (`3001`) | Low quand elle affaiblit le compte |
| Drive (`drive`), avec l'option activée | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low pour un fichier partagé hors du domaine de son propriétaire ou ouvert par un lien |

Les règles de la bibliothèque pour Google Workspace les lisent tels qu'ils sont importés ici, comme celles d'une connexion signalée par Google, de privilèges d'administrateur accordés et d'un fichier rendu public dans Drive.

## Fonctionnement des interrogations

- **Les activités sont lues selon le moment où elles ont eu lieu.** La Reports API n'a pas d'autre horodatage pour les lister, et Google indique que ses journaux arrivent avec quelques minutes à quelques heures de retard.
- **La première interrogation remonte 24 heures en arrière**, si bien qu'une nouvelle connexion montre tout de suite ses activités récentes.
- **Chaque interrogation suivante commence 120 minutes avant le curseur enregistré**, si bien qu'une activité que Google rend lisible jusqu'à 2 heures en retard est lue à l'interrogation suivante, et les doublons sont écartés par l'ID de chaque événement dans le projet. Une activité qui arrive plus tard n'est pas lue par l'interrogation : importez sa plage de temps depuis **Diagnostics**.
- **Une interrogation lit au plus 24 heures au-delà du curseur.** Une connexion dont le curseur a pris du retard le rattrape en une suite de fenêtres de 24 heures.
- **Drive est lu un événement à la fois**, puisque Drive enregistre chaque fichier que quiconque ouvre. Quand Google refuse le journal de Drive, l'exécution avertit, et les autres journaux sont toujours importés.
- **Une exécution en échec ne change rien.** Après une erreur réseau, ou un statut d'erreur de Google, le curseur et la longueur de fenêtre restent tels quels, et l'interrogation suivante relit la même fenêtre. La seule exception est une requête qui a expiré : le curseur reste, mais la fenêtre suivante est deux fois plus courte, car une fenêtre trop lourde pour recevoir une réponse à temps expirerait à chaque essai.

### Quand une fenêtre contient plus qu'une interrogation ne peut lire

Chaque journal a son propre budget, en pages de 1 000 activités : 10 pour les connexions, 5 chacun pour l'administration, les jetons OAuth et SAML, 3 pour la sécurité des comptes, et 4 pour chaque événement de Drive. Une interrogation s'arrête au bout de 4 minutes. Quand un budget arrête un journal avant la fin de sa fenêtre, l'exécution est **Partiel**, et son avertissement nomme le journal et le budget. Google liste les activités les plus récentes en premier, OneUptime raccourcit donc la fenêtre au lieu de déplacer le curseur au-delà d'activités qu'il n'a jamais atteintes :

1. **Réduire.** L'interrogation suivante lit une fenêtre deux fois plus courte, depuis le même point de départ, et continue de la diviser par deux jusqu'à ce qu'une fenêtre soit lue entièrement, jusqu'à une minute. L'avertissement de l'exécution le dit : `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Les activités déjà importées depuis la fenêtre plus longue sont sautées comme doublons.
2. **Revenir à la taille normale.** Une fois une fenêtre lue entièrement, le curseur passe à sa fin, et la fenêtre suivante est de nouveau deux fois plus longue, jusqu'à 24 heures.
3. **Passer au-delà d'une seule minute.** Si même une minute contient plus qu'une interrogation ne peut lire, l'interrogation passe au-delà, pour que les activités plus récentes continuent d'arriver. L'exécution reste **Partiel**, et **Dernière erreur** indique `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importez cette minute avec **Importer cette plage de temps** pour récupérer ce qu'une exécution peut lire.

Changer le **Intervalle d'interrogation (minutes)** n'y change rien : il décide à quelle fréquence une interrogation commence, pas où commence sa fenêtre.

### Exécuter, prévisualiser et importer à la demande

Cliquez sur **Diagnostics** sur une connexion pour voir ses exécutions récentes et travailler avec elle à la main. Quiconque peut modifier la connexion peut les lancer ; quiconque peut la voir peut lire l'historique.

- **Exécuter maintenant** lance tout de suite une interrogation, avec le curseur habituel, même quand la connexion n'est pas **Activé**.
- **Preview audit events** lit une plage de temps de 7 jours au plus et n'importe rien.
- **Importer cette plage de temps** importe une plage de 7 jours au plus, après votre confirmation, sans déplacer le curseur. Les activités déjà importées sont sautées. Google conserve 6 mois de journaux d'audit.
- **Copier les diagnostics** sur une exécution copie son rapport pour le support. Il ne contient jamais d'identifiants.

## Tester la connexion

**Tester la connexion** sur la ligne d'une connexion, et **Tester ces paramètres** dans le formulaire, s'exécutent dans le processus de l'API, pas dans un worker d'arrière-plan, pour qu'un test réponde même quand les workers sont le problème. Il effectue ces vérifications, dans l'ordre :

| Vérification | Ce qu'elle vérifie |
| --- | --- |
| **Configuration** | L'adresse de l'administrateur et la clé sont bien formées. Rien n'est contacté quand cela échoue. |
| **Authenticate with Google** | Google laisse le compte de service agir en tant que l'administrateur : la délégation au niveau du domaine est en place. |
| **Read the audit logs** | Les journaux de connexion et d'administration des dernières 24 heures peuvent être lus. |
| **Read Drive activity** | Seulement avec l'option activée : le journal de Drive peut être lu. |
| **Activities available to import** | Combien d'activités de connexion et d'administration contiennent les dernières 24 heures, 1 000 au plus pour chacune, `1000+` veut donc dire davantage. Aucune est un avertissement. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Le côté de OneUptime lui-même : un processus prend les tâches de la file Worker, la tâche d'interrogation s'exécute chaque minute, et le stockage des événements de sécurité répond. |
| **Scheduled polling** | Pour une connexion enregistrée : l'interrogation est activée, aucune exécution n'est bloquée en attente d'un worker, et les interrogations s'exécutent à l'heure. |

Chaque requête d'un test a un délai de 20 secondes. Un test n'importe jamais rien et ne déplace jamais le curseur, et chaque vérification en échec dit ce qu'il faut changer.

## Dépannage

La **Dernière erreur** de la connexion conserve le message d'erreur complet, identifiants masqués. Quand une connexion a une erreur, sélectionnez **Voir l'erreur** dans sa colonne **Actions** pour la lire, et **Copier l'erreur** dans la boîte de dialogue pour la copier. Chaque message commence par `Google Workspace`, nomme ensuite la requête en échec, et cite la raison donnée par Google.

:::details Dernière erreur indique `token request failed`
- `unauthorized_client` : le compte de service n'a pas de délégation au niveau du domaine pour le champ d'application. Ajoutez son **Unique ID** avec `https://www.googleapis.com/auth/admin.reports.audit.readonly` sous **Manage domain-wide delegation**.
- `invalid_grant` avec `Invalid email or User ID` : l'**Administrator email** n'est pas un utilisateur de ce Google Workspace.
- `invalid_grant` avec `Invalid JWT Signature` : la clé a été supprimée ou désactivée. Créez une nouvelle clé, et enregistrez-la avec **Mettre à jour les identifiants**.
:::

:::details Dernière erreur indique `activities request failed (HTTP 403)`
- Raison `SERVICE_DISABLED` ou `accessNotConfigured` : l'Admin SDK API est désactivée dans le projet du compte de service. Activez-la, et testez de nouveau dans quelques minutes.
- Raison `forbidden` : l'administrateur n'a pas le privilège Reports. Attribuez-le sous **Account → Admin roles** dans la console d'administration Google, ou indiquez un super administrateur.
:::

:::details L'activité Drive n'est pas lue
Le journal de Drive demande une édition qui en dispose, et un administrateur avec le privilège Reports. Chaque exécution avertit `Drive activity was not read`, et les autres journaux sont toujours importés. Désactivez **Activité Drive** quand votre édition n'a pas de journal Drive.
:::

:::details Dernière erreur indique `did not complete`
La requête n'a pas reçu de réponse : un délai dépassé, un nom qui ne se résout pas, ou une adresse refusée. Vérifiez que l'application et les workers OneUptime peuvent joindre `oauth2.googleapis.com` et `admin.googleapis.com`, à travers tout proxy que vous utilisez.
:::

:::details Le test réussit, mais Dernière interrogation vaut Never
La tâche d'interrogation ne s'est jamais exécutée. Lisez les vérifications **Background workers** et **Poll scheduler**. Sur une installation auto-hébergée, la cause habituelle est `DISABLE_QUEUE_WORKERS=true` sur l'application, sans déploiement de workers séparé qui prenne les tâches : réglez-le sur `false`, ou lancez le déploiement des workers (Helm : `worker.enabled: true`, qui vaut `false` par défaut).
:::

## Étapes suivantes

:::cards
- [Événements de sécurité](/docs/telemetry/security-events): Rechercher, corréler et alerter sur ce que vous importez.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importer les connexions et les modifications d'annuaire de Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Faire entrer aussi les détections de Google SecOps.
- [Présentation des intégrations](/docs/integrations/index): Les autres outils que vous pouvez connecter.
:::
