# Renseignement sur les menaces (STIX/TAXII)

Un flux de renseignement apporte dans OneUptime des adresses IP, des domaines, des URL, des adresses e-mail et des hachages de fichiers malveillants connus, et vous prévient quand vos [événements de sécurité](/docs/telemetry/security-events) en mentionnent un. Un flux lit une source : une liste d'indicateurs à une adresse https, comme les listes gratuites que OneUptime ajoute en un clic, une collection TAXII 2.1 d'indicateurs STIX 2.1 issue de votre propre serveur MISP, OpenCTI ou OpenTAXII ou d'un fournisseur, ou les indicateurs que Google SecOps a trouvés dans vos événements.

:::cards
- [Ajouter une liste gratuite](#ajouter-une-liste-gratuite): Feodo Tracker, Emerging Threats et les nœuds de sortie Tor, en un clic.
- [S'abonner à un flux](#sabonner-à-un-flux): L'adresse d'une liste, une collection TAXII ou une connexion Google SecOps.
- [Ce qui est ingéré](#ce-qui-est-ingéré): Les motifs d'indicateurs que conserve OneUptime, et pour combien de temps.
- [Comment les correspondances sont trouvées](#comment-les-correspondances-sont-trouvées): Marquées à l'arrivée des événements et confrontées chaque minute.
- [Niveaux de menace](#niveaux-de-menace): Comment la confiance d'un indicateur devient une gravité.
:::

## Fonctionnement

```mermaid title="D'un flux à une alerte"
flowchart TB
    taxii["Une liste, une<br/>collection TAXII<br/>ou Google SecOps"] -->|"Interrogée à<br/>l'intervalle du flux"| indicators["Indicateurs : IP,<br/>domaines, URL,<br/>e-mails, hachages"]
    events["Nouveaux événements<br/>de sécurité"] --> tag["Marqués à l'arrivée<br/>par des attributs<br/>threat.*"]
    indicators --> tag
    indicators --> match["Confrontés chaque<br/>minute aux<br/>événements récents"]
    match --> act["Un dossier, une alerte,<br/>un incident optionnel<br/>et un constat"]
```

## Avant de commencer

- Pour une liste, une adresse `https` qui télécharge un fichier texte avec un indicateur par ligne.
- Pour un flux TAXII, un serveur TAXII 2.1 qui publie des objets STIX 2.1 de type `indicator`, et l'ID de la collection à interroger. Un flux TAXII se connecte de façon anonyme, avec un jeton bearer ou avec l'authentification HTTP basique.
- Pour un flux Google SecOps, une [connexion Google SecOps](/docs/integrations/google-secops#configurer-le-connecteur-géré) dont le compte de service peut rechercher les correspondances d'indicateurs : le rôle `roles/chronicle.viewer` le peut.
- Les serveurs qui exigent un certificat client TLS (TLS mutuel), comme CISA AIS, ne sont pas pris en charge. Le serveur ATT&CK public de MITRE publie des techniques et des groupes plutôt que des indicateurs, donc un flux qui pointe vers lui reste vide.
- Un rôle qui peut créer des flux : Project Owner, Project Admin, Security Admin ou Security Member. Security Viewer peut lire les flux et les indicateurs. Voir [Rôles](/docs/permissions/reference#rôles).

## Ajouter une liste gratuite

La carte **Listes gratuites** de **Renseignement sur les menaces** ajoute une liste de blocage gratuite en un clic : cliquez sur **Ajouter la liste** sur une liste, et OneUptime crée un flux qui la télécharge selon le calendrier de la liste. Une liste que le projet lit déjà indique **Ajouté**.

| Liste | Publiée par | Lue | Confiance | Une correspondance ouvre |
| --- | --- | --- | --- | --- |
| Serveurs C2 de botnets de Feodo Tracker | abuse.ch | Toutes les heures | 90, Critical | Un dossier et une alerte |
| Hôtes compromis d'Emerging Threats | Proofpoint Emerging Threats | Tous les jours | 70, High | Un dossier et une alerte |
| Nœuds de sortie Tor | The Tor Project | Toutes les heures | 30, Low | Un dossier |

La tuile d'une liste renvoie à ses conditions : Feodo Tracker est libre pour tout usage (CC0), et la liste Emerging Threats est sous licence BSD. Un flux ajouté depuis une liste se modifie et se supprime comme les autres.

## S'abonner à un flux

:::steps
### Ouvrir Threat Intel

Ouvrez **Produits → Événements de sécurité → Détections → Renseignement sur les menaces**.

### Créer le flux

Cliquez sur **Créer : Flux de renseignements sur les menaces** et choisissez sa **Source** : **Liste d'indicateurs**, **Collection TAXII** ou **Google SecOps**. L'étape suivante ne demande que cette source : l'**URL de la liste** pour une liste, le **Serveur TAXII** et la **Connexion** pour une collection, ou la **Connexion Google SecOps**. **En cas de correspondance** vient en dernier. Les champs figurent dans le tableau ci-dessous.

### Vérifier la première interrogation

En une minute ou deux, la ligne du flux affiche **Dernière interrogation**, et **Résumé de la dernière interrogation** indique ce que l'interrogation a récupéré. Les indicateurs apparaissent dans le tableau **Indicateurs**, sous les flux.
:::

| Champ | Ce qu'il faut saisir |
| --- | --- |
| **Source** | D'où viennent les indicateurs. Elle est fixée à la création du flux : un flux d'une autre source est un nouveau flux. |
| **URL de la liste** | Pour une liste : l'adresse `https` d'un fichier texte avec une adresse IP, un domaine, une URL ou un hachage de fichier par ligne. |
| **Confiance** | Pour une liste : le degré de certitude de la liste, de 1 à 100. Chaque indicateur de la liste le reçoit, et il fixe le [niveau de menace](#niveaux-de-menace) ; vide, c'est Medium. |
| **Connexion Google SecOps** | Pour Google SecOps : la connexion dont la clé lit les indicateurs que Google SecOps a trouvés. **Connecter Google SecOps** ouvre **Connexions** quand il n'y en a aucune. |
| **URL racine de l'API TAXII** | La racine de l'API TAXII 2.1 du serveur, par exemple `https://taxii.example.com/api1/`. Les collections sont adressées en dessous. |
| **ID de la collection** | La collection qui publie les indicateurs. |
| **Intervalle d'interrogation (minutes)** | La fréquence de lecture de la source : de 1 à 1440 minutes, 60 par défaut. Une liste est lue au plus toutes les 15 minutes. |
| **Confiance minimale** | Pour une collection TAXII ou Google SecOps : les indicateurs de confiance inférieure sont ignorés, de 0 à 100, et 0 garde tout. Les indicateurs sans confiance passent toujours. |
| **Connexion** | La façon dont OneUptime se connecte : **Sans connexion** pour une collection publique, **Jeton bearer** pour un jeton fourni par l'opérateur du serveur, ou **Nom d'utilisateur et mot de passe** pour l'authentification HTTP basique. |
| **Jeton d'API**, **Nom d'utilisateur Basic Auth** et **Mot de passe Basic Auth** | Demandés seulement pour la connexion choisie. |
| **Ouvrir un dossier en cas de correspondance** | Activé par défaut : chaque événement qui nomme un indicateur ouvre un [dossier](/docs/telemetry/security-cases) sur cet indicateur, ou rejoint le dossier ouvert qui porte déjà sur lui. |
| **Alertes et incidents** | **Créer une alerte** par défaut : chaque indicateur correspondant ouvre une alerte. |
| **Gravité de l'alerte** | La gravité de chaque alerte ouverte par ce flux. Laissez-la vide pour prendre le niveau de menace de chaque indicateur. |
| **Déclarer un incident** ou **Les deux** | Sous **Alertes et incidents**. Les incidents déclenchent l'escalade d'astreinte, les SLA et les pages de statut, et pour les correspondances d'indicateurs les alertes suffisent en général. |
| **Gravité de l'incident** | Comme **Gravité de l'alerte**, pour les incidents. |
| **Écrire un Detection Finding en cas de correspondance** | Activé par défaut : chaque correspondance écrit un constat dans le flux d'événements. |

Les jetons et les mots de passe d'un flux TAXII sont chiffrés et ne sont plus jamais affichés après l'enregistrement. Pour les changer, choisissez **Mettre à jour les identifiants** dans la ligne du flux, puis **Jeton bearer**, **Nom d'utilisateur et mot de passe** ou **Sans connexion**, qui efface ce qui est enregistré : votre choix remplace la connexion du flux, donc enregistrer un jeton efface un mot de passe enregistré, et inversement.

### Comment un flux est interrogé

Chaque interrogation demande les objets ajoutés depuis la précédente, via le curseur TAXII `added_after`, et lit jusqu'à 10 pages de 500 objets. Une grande collection se synchronise donc en plusieurs interrogations : **Résumé de la dernière interrogation** indique quand il reste des pages. Pour terminer plus vite une grosse première synchronisation, baissez le **Intervalle d'interrogation (minutes)**, jusqu'à 1, le temps qu'elle rattrape son retard.

Les interrogations se présentent avec l'user agent `OneUptime/<version> (+https://oneuptime.com)`. Si le pare-feu du fournisseur répond `403`, demandez-lui de l'autoriser : beaucoup de pare-feux bloquent les requêtes qui ressemblent à un script anonyme.

Un flux désactivé n'est ni interrogé ni confronté. Les indicateurs qu'il possède déjà continuent de marquer les nouveaux événements jusqu'à leur expiration.

### Comment une liste est lue

- Chaque interrogation télécharge toute la liste et la lit ligne par ligne : la première valeur d'une ligne, jusqu'à une espace, une tabulation, une virgule ou un point-virgule. Les lignes qui commencent par `#`, `;` ou `//` sont des commentaires, un port après une adresse ou un domaine est retiré, et une plage d'adresses comme `198.51.100.0/24` est ignorée.
- Une valeur reste un indicateur actif pendant 2 jours après l'interrogation qui l'a lue en dernier, et une valeur que la liste retire cesse de correspondre à l'interrogation suivante. Une liste qui n'a pas changé est réécrite une fois par jour.
- Une liste contient au plus 50 000 indicateurs. **Résumé de la dernière interrogation** indique combien ont été lus, combien de lignes ont été ignorées et combien ont été laissés de côté.
- L'adresse doit utiliser `https` et suit les mêmes règles sortantes qu'une connexion : sur OneUptime Cloud, une adresse privée est refusée.

### Comment Google SecOps est lu

- Chaque interrogation lit les correspondances d'indicateurs que Google SecOps a enregistrées depuis l'interrogation précédente, avec les attributs de Mandiant : le domaine, l'adresse ou le hachage de fichier en cause, sa confiance, sa catégorie, et les campagnes et acteurs auxquels il est lié. La première interrogation lit les 7 derniers jours.
- Un indicateur reste actif pendant 30 jours après que Google SecOps l'a vu pour la dernière fois, ou jusqu'à ce que sa source le déclare inactif, et celui qu'un analyste a mis en sourdine dans Google SecOps cesse aussi de correspondre ici.
- Une correspondance que Google SecOps marque comme une intrusion active est Critical, et une correspondance de haute priorité est au moins High.

## Ce qui est ingéré

D'une collection TAXII, OneUptime conserve les objets STIX de type `indicator` dont le motif est une simple égalité sur l'un de ces types. Une liste et Google SecOps donnent les mêmes types :

| Type | Exemple de motif |
| --- | --- |
| Adresse IPv4 (`ipv4-addr`) | `[ipv4-addr:value = '198.51.100.7']` |
| Adresse IPv6 (`ipv6-addr`) | `[ipv6-addr:value = '2001:db8::7']` |
| Nom de domaine (`domain-name`) | `[domain-name:value = 'evil.example']` |
| URL (`url`) | `[url:value = 'http://evil.example/payload']` |
| Adresse e-mail (`email-addr`) | `[email-addr:value = 'billing@evil.example']` |
| Hachage de fichier, SHA-256 (`file-hash-sha256`) | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| Hachage de fichier, SHA-1 (`file-hash-sha1`) | `[file:hashes.'SHA-1' = 'da39…0709']` |
| Hachage de fichier, MD5 (`file-hash-md5`) | `[file:hashes.MD5 = 'd41d…427e']` |

Les comparaisons reliées par `OR`, dans un même `[...]` ou entre plusieurs, conviennent, et chaque valeur devient un indicateur à part :

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

Tout autre motif, avec `AND`, `FOLLOWEDBY`, `NOT`, `LIKE`, `MATCHES`, un qualificatif temporel comme `WITHIN` ou un autre type d'objet, est entièrement ignoré et compté comme non pris en charge dans **Résumé de la dernière interrogation**. Ne traduire qu'une partie d'un motif `AND` correspondrait à bien plus que ce que voulait l'auteur du flux.

### Combien de temps un indicateur reste actif

- Un indicateur correspond de son `valid_from` à son `valid_until`. Sans `valid_until`, il reste actif 365 jours à partir de `valid_from`, et l'interroger de nouveau ne prolonge pas ce délai.
- Un indicateur révoqué, ou mis à jour avec un `valid_until` dans le passé, cesse de correspondre dès que la mise à jour est interrogée. De même pour une valeur que le fournisseur retire d'un motif mis à jour.
- Les valeurs sont stockées en minuscules et confrontées sans tenir compte de la casse.

Le tableau **Indicateurs** liste les indicateurs tels qu'ils sont stockés, avec un **Statut** **Actif**, **Expiré** ou **Révoqué**. Un indicateur interrogé de nouveau peut apparaître deux fois pendant un moment, et une ligne expirée ou révoquée reste listée jusqu'à ce que le nettoyage du stockage la retire, jusqu'à environ un mois après son expiration. La confrontation vérifie toujours la validité et la révocation, donc une telle ligne ne correspond jamais.

## Comment les correspondances sont trouvées

### Marqués à l'arrivée

Chaque événement de sécurité entrant, depuis l'API d'ingestion ou une connexion, est confronté à vos indicateurs actifs avant d'être stocké. Quand l'un de ses observables (les IP, hôtes, domaines, hachages et utilisateurs extraits de l'événement) égale la valeur d'un indicateur, l'événement reçoit ces attributs :

| Attribut | Valeur |
| --- | --- |
| `threat.matched` | Toujours `"true"` sur un événement marqué |
| `threat.indicator_id` | L'ID de l'indicateur STIX, ou `list` ou `google-secops` pour ces sources |
| `threat.indicator_type` | Le type de l'indicateur, par exemple `ipv4-addr` ou `file-hash-sha256` |
| `threat.indicator_value` | La valeur correspondante, en minuscules |
| `threat.feed` / `threat.feed_id` | Le flux d'où vient l'indicateur |
| `threat.confidence` | La confiance STIX de l'indicateur |
| `threat.match_count` | Combien d'observables de l'événement ont correspondu à un indicateur |

Quand plusieurs indicateurs correspondent à un événement, celui à la plus forte confiance remplit ces valeurs. Ce sont des attributs ordinaires, donc vous pouvez les rechercher dans **Événements**, filtrer avec eux les moniteurs d'événements de sécurité et les utiliser dans des règles de détection :

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

Le marquage ne connaît que les indicateurs qui existent à l'arrivée d'un événement : les événements ne sont jamais marqués de nouveau plus tard.

### Confrontés chaque minute

Chaque minute, les indicateurs actifs de chaque flux activé sont confrontés aux événements dont l'heure d'événement tombe depuis la vérification précédente du flux. Cela rattrape le renseignement arrivé après le marquage d'un événement.

- La première vérification couvre les 15 dernières minutes. Après une panne, la vérification suivante rattrape au plus les 24 dernières heures.
- Chaque fenêtre est vérifiée une fois. Le renseignement qui arrive après la vérification de sa fenêtre ne s'applique qu'aux événements ultérieurs.
- Un événement arrivé en retard, avec une heure antérieure à la vérification précédente, est encore marqué à l'arrivée, mais n'est pas confronté.
- Chaque vérification enregistre chaque valeur d'indicateur correspondante comme un Detection Finding, jusqu'à 10 000 par flux. Des alertes, des incidents et des dossiers s'ouvrent pour les 100 valeurs vues dans le plus d'événements ; les autres partagent un dossier sur le flux, et l'**Erreur de la dernière correspondance** du flux indique combien ont correspondu.

### Ce que fait une correspondance

- Une alerte, intitulée `[Threat Intel] <feed name> — <indicator value>`, une par flux et par valeur tant qu'elle reste ouverte. Une fois résolue, la correspondance suivante en ouvre une nouvelle. Les alertes ne sont pas résolues automatiquement.
- Un incident, uniquement avec **Déclarer un incident** ou **Les deux** sous **Alertes et incidents**, dédupliqué de la même façon.
- Un constat de renseignement, avec **Écrire un Detection Finding en cas de correspondance** : un événement `Detection Finding` (classe OCSF 2004) du produit `OneUptime Threat Intel`, avec le niveau de menace de l'indicateur comme gravité, et ces attributs :

| Attribut | Valeur |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | Le flux |
| `oneuptime.threat.indicator_id` | L'ID de l'indicateur STIX, ou `list` ou `google-secops` pour ces sources |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | Ce qui a correspondu |
| `oneuptime.threat.confidence` | La confiance de l'indicateur |
| `oneuptime.threat.match_count` | Combien d'événements se trouvent derrière ce constat |

Les constats ne sont jamais confrontés eux-mêmes, donc une correspondance ne peut pas en déclencher une autre.

## Niveaux de menace

Les indicateurs n'ont pas de niveau Sigma : leur `confidence` STIX fixe plutôt un niveau de menace.

| Confiance de l'indicateur | Niveau de menace |
| --- | --- |
| De 90 à 100 | Critical |
| De 70 à 89 | High |
| De 40 à 69 | Medium |
| De 1 à 39 | Low |
| Non évalué (0 ou absent) | Medium |

Un indicateur non évalué compte comme Medium : quelqu'un a tout de même choisi de le mettre dans un flux. Le niveau de menace est la gravité du constat, et choisit la gravité de l'alerte parmi les gravités de votre projet, dans cet ordre :

1. La **Gravité de l'alerte** (ou **Gravité de l'incident**) du flux, si elle est réglée : elle s'applique à chaque correspondance du flux.
2. Votre gravité nommée d'après le niveau de menace, comme High, quelle que soit la casse.
3. Par rang : Critical et High prennent votre gravité la plus élevée, Medium et Low la plus basse.

Le niveau de menace appartient à chaque indicateur, pas au flux, donc un même flux peut ouvrir une alerte Critical et une alerte Low dans la même minute. **Confiance minimale** filtre sur le même nombre : un minimum de 70 ne garde que les indicateurs High et Critical, plus les non évalués, qui passent toujours.

## Surveiller les correspondances d'un flux

L'action **Créer un moniteur** dans la ligne d'un flux ouvre un nouveau moniteur d'événements de sécurité qui compte les constats du flux : classe d'événements `Detection Finding`, filtrée sur l'ID du flux dans `oneuptime.threat.feed_id` (jamais sur son nom, qu'un renommage changerait), sur la dernière heure. Utilisez-le pour une soudaine vague de correspondances, ou pour un flux d'ordinaire actif qui se tait.

## Conservation et facturation

Les indicateurs sont de la configuration, pas de la télémétrie, et ne sont pas facturés comme données ingérées. Les constats écrits par une correspondance sont des événements de sécurité ordinaires, facturés et conservés comme les autres : voir [Événements de sécurité](/docs/telemetry/security-events#conservation-et-facturation).

## Dépannage

:::details Dernière erreur est renseignée après une interrogation
`401` ou `403` : les identifiants sont faux ou absents ; remplacez-les avec **Mettre à jour les identifiants**. Un `403` peut aussi venir du pare-feu du fournisseur qui bloque l'user agent. `404` : vérifiez la **URL racine de l'API TAXII**, qui se termine généralement par un chemin comme `/api1/`, et l'**ID de la collection**. L'erreur disparaît à la prochaine interrogation réussie.
:::

:::details Le flux est interrogé, mais aucun indicateur n'apparaît
Lisez **Résumé de la dernière interrogation**. Aucun objet récupéré : la collection est vide ou ne publie pas d'indicateurs. Motifs non pris en charge : le fournisseur utilise des fonctions de motif que cette page indique comme ignorées. Sous la confiance minimale : baissez la **Confiance minimale**. Déjà inactifs : le fournisseur a envoyé des indicateurs déjà révoqués ou expirés.
:::

:::details Des indicateurs existent, mais rien ne correspond
La confrontation compare la valeur d'un indicateur aux observables d'un événement, pas à chaque champ : ouvrez dans **Événements** un événement qui aurait dû correspondre et vérifiez que ses observables contiennent la valeur. Seuls les indicateurs au statut **Actif** correspondent. Si le **Statut** du flux indique **Échec de la comparaison**, **Voir l'erreur** dans sa ligne en donne la raison.
:::

:::details La Dernière erreur d'un flux de liste dit que l'adresse a répondu par une page web
L'**URL de la liste** ouvre une page, comme une page de connexion ou d'erreur, et non la liste : ouvrez-la dans un navigateur et copiez l'adresse du fichier lui-même. Une liste dont le texte ne contient aucune adresse IP, aucun domaine, aucune URL ni aucun hachage de fichier est refusée de la même façon, et les indicateurs du flux restent tels qu'ils étaient.
:::

:::details La Dernière erreur d'un flux Google SecOps indique HTTP 403
Le compte de service de la connexion ne peut pas rechercher les correspondances d'indicateurs : accordez-lui `roles/chronicle.viewer`. Si la connexion a été supprimée, le flux le signale : modifiez-le et choisissez une autre **Connexion Google SecOps**.
:::

:::details Une correspondance n'a pas ouvert d'alerte
**Alertes et incidents** est réglé sur **Déclarer un incident** ou **Aucun des deux**, ou une alerte pour le même flux et la même valeur est encore ouverte, et les correspondances suivantes s'y ajoutent. Un projet a besoin d'au moins une gravité d'alerte pour qu'un flux ouvre des alertes.
:::

## Étapes suivantes

:::cards
- [Événements de sécurité](/docs/telemetry/security-events): Envoyer des événements, les rechercher et écrire des règles de détection.
- [Google SecOps](/docs/integrations/google-secops): Faire entrer les détections et les événements de Chronicle.
- [Référence des autorisations](/docs/permissions/reference): Les rôles de sécurité, et ce que chacun peut faire.
:::
