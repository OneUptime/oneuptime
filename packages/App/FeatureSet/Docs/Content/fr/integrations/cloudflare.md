# Cloudflare

Importez dans les événements de sécurité de OneUptime ce que le pare-feu de [Cloudflare](https://www.cloudflare.com) a fait en périphérie : les requêtes que ses règles WAF gérées et personnalisées, la limitation de débit, les IP Access Rules, la gestion des bots et la protection DDoS HTTP ont bloquées, soumises à un challenge ou journalisées. Chacune se place à côté des requêtes de votre propre application, si bien qu'un dossier dit ce que Cloudflare a arrêté et ce qui a quand même atteint votre application. OneUptime les lit avec un jeton d'API qui ne peut que lire, et ne change rien dans Cloudflare.

:::cards
- [Configurer la connexion](#configurer-la-connexion): Un jeton d'API avec deux autorisations de lecture, et le formulaire de la connexion.
- [Ce qui est importé](#ce-qui-est-importé): Quels événements, et comment chacun devient un événement de sécurité.
- [Fonctionnement des interrogations](#fonctionnement-des-interrogations): La fenêtre que lit chaque interrogation, et pourquoi elle chevauche de 10 minutes.
- [Dépannage](#dépannage): Ce que signifie chaque erreur, et ce qu'il faut changer.
:::

## Fonctionnement

```mermaid title="D'une requête traitée par Cloudflare à un événement de sécurité"
flowchart TB
    edge["Le pare-feu de<br/>Cloudflare traite<br/>une requête"] --> poll["OneUptime interroge<br/>à l'intervalle de<br/>la connexion"]
    poll --> zones["Il lit les<br/>événements de pare-feu<br/>de chaque zone depuis<br/>la dernière fois"]
    zones --> event["Chacun est stocké<br/>comme événement<br/>HTTP Activity"]
```

Chaque minute, OneUptime interroge chaque connexion activée dont l'intervalle d'interrogation est écoulé. Une interrogation liste les zones du compte, lit dans le nœud settings de la GraphQL Analytics API ce que l'offre de chaque zone permet, et lit les événements de pare-feu de chaque zone depuis la dernière interrogation dans le jeu de données `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), les plus anciens d'abord. Chaque événement est stocké comme événement [OCSF](https://schema.ocsf.io/) HTTP Activity.

## Avant de commencer

- Dans OneUptime, le rôle Propriétaire du projet, Administrateur du projet ou Administrateur de la sécurité. Les rôles Membre de la sécurité et Lecteur de la sécurité voient les connexions et l'historique de leurs exécutions, mais ne peuvent pas les modifier.
- Un utilisateur Cloudflare qui peut créer des jetons d'API pour les zones du compte.
- Des zones dont le trafic passe par Cloudflare : leurs enregistrements DNS sont proxifiés.
- Le HTTPS sortant de l'application et des workers OneUptime vers `api.cloudflare.com`.

## Configurer la connexion

La connexion lit avec un [jeton d'API](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), jamais avec une Global API Key : un jeton est limité au compte et à ses zones, et vous pouvez le révoquer seul. Il lui faut deux [autorisations](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), toutes deux en lecture seule :

| Autorisation | Ce que OneUptime lit avec elle |
| --- | --- |
| `Zone > Zone > Read` | Les zones, avec leurs comptes et leurs offres. |
| `Zone > Analytics > Read` | Les événements de pare-feu de chaque zone, par la GraphQL Analytics API. |

:::steps
### Créer un jeton d'API

1. Dans le tableau de bord de Cloudflare, ouvrez **My Profile → API Tokens**, sélectionnez **Create Token**, puis choisissez **Create Custom Token**.
2. Nommez-le `oneuptime-security-events`. Sous **Permissions**, ajoutez `Zone > Zone > Read` et `Zone > Analytics > Read`.
3. Sous **Zone Resources**, incluez toutes les zones du compte, ou les zones à importer.
4. Sélectionnez **Continue to summary**, puis **Create Token**, et copiez le jeton. Cloudflare ne l'affiche qu'une fois.

### Ajouter la connexion dans OneUptime

Ouvrez **Produits → Événements de sécurité → Connexions** (`/dashboard/{projectId}/security-events/connections`), cliquez sur **Ajouter une connexion**, choisissez **Cloudflare** sous **Sécurité du cloud**, puis cliquez sur **Suivant**. Collez le jeton dans **Jeton d'API**. OneUptime liste alors les comptes et les zones que le jeton peut lire : choisissez le **Compte**, et dans **Zones** laissez **Toutes les zones**, ou choisissez les zones à importer.

### La tester avant d'enregistrer

Cliquez sur **Tester ces paramètres** sous **Tester avant d'enregistrer**. Le test vérifie chaque autorisation avec les valeurs du formulaire, nomme celle qui manque et n'enregistre rien. Cliquez ensuite sur **Suivant**, donnez un **Nom** à la connexion, puis créez-la.
:::

| Réglage | Ce qu'il faut saisir |
| --- | --- |
| **Compte** | Le compte Cloudflare à lire, choisi parmi les comptes que lit votre jeton d'API. Un jeton qui ne lit qu'un compte le choisit pour vous. |
| **Zones** | Facultatif. Vide, il lit toutes les zones actives du compte, y compris celles ajoutées plus tard. Une connexion lit au plus 50 zones. |
| **Jeton d'API** | Le jeton seul, sans `Bearer`. Il est chiffré, jamais renvoyé par l'API et jamais affiché à nouveau. Remplacez-le avec **Mettre à jour les identifiants** sur la connexion. |

L'étape **Interrogation** comporte aussi une **Description** facultative, l'**Intervalle d'interrogation (minutes)**, un nombre entier de `1` à `1440` qui commence à `5`, et **Activé**, qui commence activé. Les événements de Cloudflare sont des requêtes, pas des alertes, donc le formulaire ne demande pas **Ouvrir des dossiers à partir de** : les dossiers viennent des règles de détection qui les lisent.

### L'accès en écriture est un choix à part

Cette connexion ne change jamais rien dans Cloudflare. Y bloquer des adresses est un accord à part, qui demande des autorisations d'écriture : `Account > Account Filter Lists > Edit` pour les listes, `Zone > Zone WAF > Edit` sur chaque zone où bloquer, et `Account > Account Firewall Access Rules > Edit` pour les offres sans assez de listes. Ajoutez-les au jeton seulement quand vous activez le blocage.

## Ce qui est importé

Chaque événement a le fournisseur `Cloudflare` et le produit `Cloudflare WAF`, et c'est un événement HTTP Activity (`4002`).

| Champ de Cloudflare | Dans l'événement de sécurité |
| --- | --- |
| `clientIP` | L'IP principale, et `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | L'hôte cible, la ressource cible (le chemin et la requête), et `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | L'activité, `http.request.method` et `user_agent.original` |
| `action` | Le statut, et `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | L'ID de la règle, le nom de la règle, et `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` et `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Ce que Cloudflare a fait | Statut | `oneuptime.edge.action` | Résultat de la requête | Gravité |
| --- | --- | --- | --- | --- |
| Bloquée, connexion fermée, ou challenge échoué | Blocked, ou Dropped pour une connexion fermée | `blocked` | Rejected | Low |
| Répondu par un challenge géré, JS ou interactif | Challenge | `challenged` | Rejected | Low |
| Un challenge réussi, ou un visiteur qui en avait déjà réussi un | Allowed | `passed-challenge` | Aucun | Informational |
| Journalisée et laissée passer | Logged | `logged` | Le code d'état de l'origine | Medium ; High quand l'origine a échoué ; Low quand elle a refusé la requête |
| Laissée passer par une de vos règles skip ou allow | Allowed | `let-through` | Le code d'état de l'origine | Comme pour une requête journalisée |

Une requête qu'une de vos propres règles skip ou allow a laissé passer n'est importée que si elle porte une attaque (injection SQL, traversée de répertoires ou recherche Log4Shell), ou si le WAF attack score de Cloudflare la classe comme telle. Le reste est du trafic que vous autorisez exprès, comme vos moniteurs : chaque exécution le compte et le laisse de côté.

Cloudflare échantillonne les événements d'une zone chargée. Chaque événement garde son intervalle d'échantillonnage, le nombre de requêtes semblables qu'il représente, et chaque nombre que OneUptime en tire dit *environ*.

Les événements apparaissent dans Événements, dans Campagnes (les requêtes d'attaque par adresse), dans le risque des entités et dans les règles de détection. Un dossier sur une adresse montre, sous **En périphérie** dans son impact, ce que Cloudflare a fait des requêtes de l'adresse à côté de ce qui a atteint votre application. Les règles Cloudflare de la bibliothèque les lisent telles qu'elles sont importées ici : de nombreuses correspondances de règles gérées depuis une adresse, une adresse qui a réussi un challenge puis envoyé des attaques, et une attaque que Cloudflare a laissé passer et qui a atteint votre application.

## Limites des offres

Chaque offre a les événements de pare-feu par l'API. **What each zone's plan gives**, dans **Tester la connexion**, lit chez Cloudflare les limites propres à chaque zone.

| Offre | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Événements de pare-feu conservés | 31 jours | 31 jours | 31 jours | 31 jours |
| Requête la plus longue | 30 jours | 30 jours | 30 jours | 31 jours |

Logpush de Cloudflare peut aussi envoyer les événements de pare-feu, sur chaque offre depuis le 30 septembre 2026, facturé à l'usage. Cette connexion interroge à la place, si bien qu'il ne lui faut rien de plus que les deux autorisations de lecture.

## Fonctionnement des interrogations

- **Les événements sont lus selon le moment où ils ont eu lieu en périphérie.** Les données d'analyse de Cloudflare sont interrogeables une minute ou deux après la requête.
- **La première interrogation remonte 24 heures en arrière**, si bien qu'une nouvelle connexion montre tout de suite ses événements récents.
- **Chaque interrogation suivante commence 10 minutes avant le curseur enregistré**, si bien qu'un événement que Cloudflare rend lisible en retard est lu à l'interrogation suivante, et les doublons sont écartés par le Ray ID de chaque événement dans le projet.
- **Une interrogation lit au plus 24 heures au-delà du curseur.** Une connexion dont le curseur a pris du retard le rattrape en une suite de fenêtres de 24 heures.
- **Les zones sont lues à tour de rôle**, une page de 2 000 événements au plus chacune, si bien qu'une zone chargée ne peut pas épuiser une interrogation avant qu'une zone calme soit lue.
- **Les limites de débit de Cloudflare sont respectées.** Cloudflare autorise 1 200 requêtes REST et 300 requêtes GraphQL en cinq minutes. Un `429` qui demande d'attendre 30 secondes ou moins est attendu puis redemandé ; un plus long arrête l'interrogation, et la suivante reprend.
- **Une zone que le jeton ne peut pas lire ne bloque rien.** Les autres zones sont importées, l'exécution est **Partiel**, et son avertissement nomme la zone. Donnez-y au jeton `Zone > Analytics > Read`, puis utilisez **Importer cette plage de temps** pour récupérer la fenêtre.
- **Une exécution échouée ne change rien.** Après une erreur réseau, ou un statut d'erreur de Cloudflare, le curseur et la longueur de la fenêtre restent tels qu'ils étaient, et l'interrogation suivante relit la même fenêtre. La seule exception est une requête qui a expiré : le curseur reste, mais la fenêtre suivante est moitié moins longue, car une fenêtre trop lourde pour répondre à temps expirerait à chaque essai.

### Quand une fenêtre contient plus qu'une interrogation ne peut lire

Une interrogation envoie au plus 120 requêtes, lit au plus 20 000 événements et s'arrête après 4 minutes. Les événements sont lus les plus anciens d'abord, donc quand un budget arrête une interrogation, l'exécution est **Partiel** et l'interrogation suivante reprend à l'événement le plus ancien jusqu'auquel les zones non terminées ont été lues. Quand toutes les zones n'ont pas pu être lues une fois, OneUptime raccourcit plutôt la fenêtre :

1. **Réduire.** L'interrogation suivante lit une fenêtre moitié moins longue, à partir du même point de départ, et la divise encore par deux jusqu'à ce qu'une fenêtre soit lue entièrement, jusqu'à une minute. L'avertissement de l'exécution le dit : `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Les événements déjà importés de la fenêtre plus longue sont ignorés comme doublons.
2. **Revenir à la taille normale.** Une fois une fenêtre lue entièrement, le curseur passe à sa fin, et la fenêtre suivante est de nouveau deux fois plus longue, jusqu'à 24 heures.
3. **Passer au-delà d'une seule minute.** Si même une minute contient plus qu'une interrogation ne peut lire, l'interrogation passe au-delà, pour que les événements plus récents continuent d'arriver. L'exécution reste **Partiel**, et **Dernière erreur** indique `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importez cette minute avec **Importer cette plage de temps** pour récupérer ce qu'une exécution peut lire.

Changer le **Intervalle d'interrogation (minutes)** n'y change rien : il décide à quelle fréquence une interrogation commence, pas où commence sa fenêtre.

### Exécuter, prévisualiser et importer à la demande

Cliquez sur **Diagnostics** sur une connexion pour voir ses exécutions récentes et travailler avec elle à la main. Quiconque peut modifier la connexion peut les lancer ; quiconque peut la voir peut lire l'historique.

- **Exécuter maintenant** lance tout de suite une interrogation, avec le curseur habituel, même quand la connexion n'est pas **Activé**.
- **Aperçu des événements du pare-feu** lit une plage de temps de 7 jours au plus et n'importe rien.
- **Importer cette plage de temps** importe une plage de 7 jours au plus, après votre confirmation, sans déplacer le curseur. Les événements déjà importés sont ignorés. Cloudflare conserve 31 jours d'événements de pare-feu.
- **Copier les diagnostics** sur une exécution copie son rapport pour le support. Il ne contient jamais d'identifiants.

## Tester la connexion

**Tester la connexion** sur la ligne d'une connexion, et **Tester ces paramètres** dans le formulaire, s'exécutent dans le processus de l'API, pas dans un worker d'arrière-plan, pour qu'un test réponde même quand les workers sont le problème. Il effectue ces vérifications, dans l'ordre :

| Vérification | Ce qu'elle vérifie |
| --- | --- |
| **Configuration** | Le jeton, le compte et les zones sont bien formés. Rien n'est contacté si cela échoue. |
| **Verify the API token** | Cloudflare accepte le jeton, celui d'un utilisateur ou un jeton propre au compte, et il est actif. Un jeton qui expire dans les 14 jours est un avertissement. |
| **List the zones** | Le jeton a `Zone > Zone > Read` : il liste les zones du compte, et chaque zone choisie. |
| **Read firewall events** | Le jeton a `Zone > Analytics > Read` sur chaque zone. Un échec nomme les zones où elle manque. |
| **What each zone's plan gives** | Combien de temps l'offre de chaque zone conserve les événements de pare-feu, et quelle durée peut couvrir une requête. Une zone dont l'offre n'en a pas est un avertissement. |
| **Firewall events available to import** | Environ combien d'événements contiennent les dernières 24 heures et les 7 derniers jours. Aucun est un avertissement. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Le côté de OneUptime lui-même : un processus prend les tâches de la file Worker, la tâche d'interrogation s'exécute chaque minute, et le stockage des événements de sécurité répond. |
| **Interrogation planifiée** | Pour une connexion enregistrée : l'interrogation est activée, aucune exécution n'est bloquée en attente d'un worker, et les interrogations s'exécutent à l'heure. |

Chaque requête d'un test a un délai de 20 secondes. Un test n'importe jamais rien et ne déplace jamais le curseur, et chaque vérification en échec dit ce qu'il faut changer.

## Dépannage

La **Dernière erreur** de la connexion garde le message d'erreur complet, avec les identifiants masqués. Quand une connexion a une erreur, sélectionnez **Voir l'erreur** dans sa colonne **Actions** pour la lire, et **Copier l'erreur** dans la boîte de dialogue pour la copier. Chaque message nomme la requête qui a échoué, et cite la raison donnée par Cloudflare.

:::details La dernière erreur indique `Invalid API Token (1000)`
Cloudflare ne connaît pas le jeton : il a été supprimé, renouvelé ou jamais collé en entier. Une Global API Key est refusée avant d'être envoyée. Créez un jeton comme ci-dessus, et enregistrez-le avec **Mettre à jour les identifiants**.
:::

:::details La dernière erreur indique `Unauthorized to access requested resource (9109)`
Le jeton ne peut pas lister les zones. Donnez-lui `Zone > Zone > Read`, avec les zones à importer sous **Zone Resources**.
:::

:::details La dernière erreur indique `cannot read the analytics of`
Il manque au jeton `Zone > Analytics > Read` sur les zones que le message nomme. Ajoutez-la là, puis utilisez **Importer cette plage de temps** pour récupérer ce qui n'a pas été importé.
:::

:::details La dernière erreur indique `rate limit`
Autre chose qui utilise le même utilisateur Cloudflare a épuisé son quota. L'interrogation reprend d'elle-même une fois les cinq minutes passées ; donnez à OneUptime un jeton d'un utilisateur à lui pour séparer le quota.
:::

:::details Dernière erreur indique `did not complete`
La requête n'a reçu aucune réponse : un délai dépassé, un nom qui ne se résout pas, ou une adresse refusée. Vérifiez que l'application et les workers OneUptime peuvent joindre `api.cloudflare.com`, à travers tout proxy que vous utilisez.
:::

:::details Un dossier montre les actions de Cloudflare, mais aucune requête de l'adresse dans votre application
Derrière Cloudflare, votre application voit les adresses de Cloudflare, sauf si elle lit celle du visiteur dans l'en-tête `CF-Connecting-IP`. Écrivez cette adresse dans vos journaux et vos traces comme `client.address`, pour que OneUptime puisse rapprocher les requêtes de votre application de l'adresse que Cloudflare a traitée.
:::

:::details Le test réussit, mais Dernière interrogation vaut Never
La tâche d'interrogation ne s'est jamais exécutée. Lisez les vérifications **Background workers** et **Poll scheduler**. Sur une installation auto-hébergée, la cause habituelle est `DISABLE_QUEUE_WORKERS=true` sur l'application, sans déploiement de workers séparé qui prenne les tâches : réglez-le sur `false`, ou lancez le déploiement des workers (Helm : `worker.enabled: true`, qui vaut `false` par défaut).
:::

## Étapes suivantes

:::cards
- [Événements de sécurité](/docs/telemetry/security-events): Rechercher, corréler et alerter sur ce que vous importez.
- [Dossiers de sécurité](/docs/telemetry/security-cases): Voyez ce que Cloudflare a fait à côté de ce qui a atteint votre application.
- [Présentation des intégrations](/docs/integrations/index): Les autres outils que vous pouvez connecter.
:::
