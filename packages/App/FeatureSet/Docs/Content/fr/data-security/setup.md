# Configurer la Sécurité des données

Sécurité des données ne lit que ce que vous lui permettez. Chaque connexion cloud est lue à l'un de trois niveaux, une base de données que vous exploitez est lue avec une chaîne de connexion que vous lui donnez, et la télémétrie ne demande rien. Cette page indique ce que chaque choix permet à OneUptime de lire, les autorisations exactes qu'il accorde, et ce que OneUptime conserve de ce qu'il lit.

:::cards
- [Choisir un niveau](#choisir-un-niveau-pour-chaque-connexion): Désactivé, Configuration uniquement, ou Configuration et échantillons de contenu.
- [Ce qu'accorde chaque niveau](#ce-quaccorde-chaque-niveau): Les actions AWS, et les rôles Azure et Google Cloud.
- [Analyser une base de données que vous exploitez](#analyser-une-base-de-données-que-vous-exploitez): Une chaîne de connexion en lecture seule, ou une sonde dans votre réseau.
- [Ce que conserve OneUptime](#ce-que-conserve-oneuptime): Des comptages, des emplacements et des échantillons masqués, jamais une valeur.
- [Laisser Sécurité des données fermer une exposition](#laisser-sécurité-des-données-fermer-une-exposition): La seule écriture qu'une connexion peut recevoir, désactivée jusqu'à ce que vous l'activiez.
:::

## Choisir un niveau pour chaque connexion

| Niveau | Dans le formulaire | Ce que lit OneUptime |
| --- | --- | --- |
| Désactivé | **Désactivé** | Ni la configuration ni le contenu d'aucun magasin de données. Sécurité des données liste tout de même les magasins de données que connaît votre inventaire cloud, avec ce que l'inventaire en dit : si une base de données RDS est chiffrée, publique, protégée contre la suppression et sauvegardée, et si une table DynamoDB peut être restaurée à un instant donné. |
| Configuration | **Configuration uniquement** | La configuration de chaque magasin de données : qui peut y accéder, et comment il est chiffré, sauvegardé, versionné, journalisé, répliqué et étiqueté. Jamais de données, et jamais de secret. |
| Contenu | **Configuration et échantillons de contenu** | Cela, plus des échantillons de ce que contiennent les buckets S3, les comptes de stockage Azure, les buckets Cloud Storage et les jeux de données BigQuery. |

Chaque connexion démarre à **Désactivé**. [Connecter un compte cloud](/docs/telemetry/cloud-accounts#sécurité-des-données) montre mot pour mot la commande qu'exécute chaque niveau sur chaque cloud. Pour changer le niveau d'une connexion :

:::steps
### Ouvrir la connexion

Allez dans **Cloud → Connecter**. Choisissez **Modifier** sur la connexion, ou connectez un nouveau compte.

### Choisir le niveau

Sous **Plus de champs**, réglez **Sécurité des données** sur le niveau voulu.

### Exécuter à nouveau la commande

La commande qu'affiche le formulaire change selon le niveau. Exécutez-la dans le shell de votre cloud, comme lors de la connexion : elle accorde ce dont le nouveau niveau a besoin, et rien de plus. Sélectionnez ensuite **Enregistrer les modifications**, ou **Connecter** pour une nouvelle connexion.
:::

Les lectures au nouveau niveau démarrent dans l'heure, et **Contrôler maintenant** ou **Analyser maintenant** sur un magasin de données en lance une aussitôt. OneUptime ne lit que ce qu'indique le niveau de la connexion, quoi que le rôle permette encore : baissez le niveau, et les lectures s'arrêtent aussitôt. Pour retirer aussi l'accès, exécutez la nouvelle commande : sur AWS, elle remplace la stratégie par celle du niveau inférieur. **Désactivé** n'ajoute rien, donc il laisse en place ce qu'une commande précédente a accordé. Retirez-le vous-même : sur AWS avec `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, et sur Azure et Google Cloud en retirant les rôles qu'a ajoutés le niveau de contenu.

## Ce qu'accorde chaque niveau

### Amazon Web Services

Le niveau de configuration place une deuxième stratégie en ligne, `OneUptimeDataSecurity`, sur le rôle, à côté de celle en lecture seule. Elle contient exactement les actions de lecture qu'appelle le lecteur de sécurité des données. Chacune lit un paramètre ; aucune ne lit de données ni n'écrit quoi que ce soit :

| Ce à quoi OneUptime les utilise | Actions |
| --- | --- |
| Lister les buckets, et lire qui peut accéder à chacun et comment il est chiffré, versionné, journalisé, copié et étiqueté | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Lire comment les bases de données sont accessibles, chiffrées et sauvegardées, et avec qui leurs instantanés manuels sont partagés | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Lire la configuration des domaines de recherche, des caches et des systèmes de fichiers | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Distinguer les propres clés d'AWS (alias/aws/...) des clés que vous gérez | `kms:ListAliases` |

Le niveau de contenu ajoute trois actions à la même stratégie, chacune sur ses propres ressources :

| Action | Autorisée sur | À quoi elle sert |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Lister les noms des objets d'un bucket |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Lire les premiers octets d'un objet échantillonné |
| `kms:Decrypt` | `*`, uniquement quand `kms:ViaService` vaut `s3.*.amazonaws.com` | Lire un objet chiffré avec une clé KMS, via S3 uniquement : jamais un déchiffrement direct de quoi que ce soit d'autre que protège la clé |

Avec une **Clé d'accès** au lieu d'un rôle, la stratégie va sur un groupe, `OneUptimeDataSecurity`, auquel est ajouté l'utilisateur de la clé : IAM limite les stratégies en ligne propres à un utilisateur à 2 048 caractères au total, et la stratégie en lecture seule en prend la plupart. Une connexion qui lit toute une AWS Organization place la même stratégie dans le rôle de chaque compte.

:::details La stratégie complète au niveau de contenu
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

Le niveau de configuration n'ajoute rien : le rôle **Monitoring Reader** de la connexion lit déjà la configuration de chaque ressource via Azure Resource Manager. Le niveau de contenu ajoute le rôle intégré **Storage Blob Data Reader**, sur la même étendue que la connexion : l'abonnement, ou le groupe d'administration racine du locataire.

### Google Cloud

Le niveau de configuration n'ajoute rien : le rôle **Cloud Asset Viewer** de la connexion lit déjà la configuration et la stratégie IAM de chaque ressource. Le niveau de contenu ajoute deux rôles, `roles/storage.objectViewer` et `roles/bigquery.dataViewer`, sur le projet ou l'organisation, et active l'API BigQuery, `bigquery.googleapis.com`.

## Laisser Sécurité des données fermer une exposition

Une connexion ne fait que lire, jusqu'à ce que vous en décidiez autrement. **Réponse de sécurité des données**, sous **Plus de champs** à côté de **Sécurité des données**, permet aussi à Sécurité des données de bloquer l'accès public d'un magasin de données et de cesser de partager ses instantanés : depuis le problème du magasin de données, avec **Corriger d'ici** (voir [Contrôles et problèmes de Sécurité des données](/docs/data-security/checks-and-issues#corriger-dici)), et depuis les playbooks d'Opérations de sécurité. Il est **Désactivé** jusqu'à ce que vous choisissiez **Bloquer l'accès public et le partage**, et la commande qu'affiche alors le formulaire accorde une seule écriture restreinte, à part :

| Cloud | Ce qu'ajoute la commande | Ce qu'elle permet |
| --- | --- | --- |
| AWS | Une troisième stratégie en ligne, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` et `rds:ModifyDBClusterSnapshotAttribute` : le Block Public Access d'un bucket, et avec qui un instantané manuel est partagé |
| Azure | Un rôle personnalisé, `OneUptime Data Security Response`, sur l'étendue de la connexion | `Microsoft.Storage/storageAccounts/read` et `Microsoft.Storage/storageAccounts/write` : les paramètres d'un compte de stockage, comme l'accès anonyme aux blobs, jamais ses clés |
| Google Cloud | Un rôle personnalisé, `oneuptimeDataSecurityResponse` | `storage.buckets.get` et `storage.buckets.update` : les paramètres d'un bucket, comme la prévention de l'accès public |

Rien de ce qu'il accorde ne lit de données, ne supprime quoi que ce soit ni ne change qui peut se connecter. Remettez-le sur **Désactivé** et Sécurité des données cesse aussitôt de l'utiliser. Pour retirer aussi l'accès sur AWS, supprimez la stratégie avec `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Pourquoi les échantillons de contenu sont facultatifs

Le niveau de configuration trouve ce qui est exposé : un bucket public, une base de données ouverte sur Internet, un chiffrement, des sauvegardes ou des journaux d'accès manquants. Il ne peut pas savoir ce que contient un magasin de données, donc un magasin de données où rien n'a été trouvé compte comme Public, la sensibilité la plus basse, et ses problèmes sont aussi graves qu'ils le seraient pour des données publiques. Un bucket public d'images de site web n'a rien d'urgent ; un bucket public de numéros de carte, si.

Les échantillons de contenu font la différence. Ils fixent la sensibilité de chaque magasin de données d'après ce qu'il contient, donc le même problème est Critique sur des numéros de carte et Faible sur des images. Ils trouvent aussi ce que seul le contenu montre : des secrets, des codes de sécurité de carte, des mots de passe conservés tels qu'ils ont été saisis, et des copies de données de production dans un magasin de données de test.

La plupart des équipes procèdent donc dans cet ordre : le niveau de configuration partout, puis les échantillons de contenu là où vous devez savoir ce que contient un magasin de données. L'analyse du contenu peut aussi être désactivée pour un seul magasin de données, avec **Analyser le contenu** dans les **Paramètres** du magasin de données, ou pour tout le projet.

## Ce que lit une analyse de contenu

Une analyse lit un peu d'un magasin de données, dans les limites du projet, et s'arrête au bout de 8 minutes, quoi qu'il reste. La suivante reprend à partir de là : elle ignore un objet qui n'a pas changé depuis sa lecture, sauf si celle-ci remonte à 7 jours ou plus.

- **Les buckets et les conteneurs** sont échantillonnés par sorte, pas par nombre. Les noms des objets sont d'abord listés, au plus dix fois autant que l'analyse peut en lire et jamais plus de 200 000. Chaque nom devient son motif, les dates, UUID, longues suites hexadécimales et nombres étant remplacés par `*`, donc `exports/2026-10-27/users-0001.csv` devient `exports/*/users-*.csv`. Les objets les plus récents de chaque motif sont lus, un de chaque avant un deuxième de n'importe lequel, et au plus 5 d'un même motif. Chaque objet est lu depuis son début : au plus **Octets par objet** de celui-ci, et **Octets par analyse** au total. Une analyse échantillonne au plus 10 conteneurs d'un compte de stockage Azure.
- **Les fichiers sont lus selon ce qu'ils sont.** CSV et TSV par colonne, JSON et JSON Lines par chemin, `.env`, `.ini`, `.properties`, TOML et YAML par clé, XML et HTML par leur texte, les fichiers Word, Excel et PowerPoint par leur texte et leurs cellules, et tout le reste comme du texte libre. Un fichier gzip est d'abord décompressé. Les images, Parquet, Avro, PDF et autres formats binaires ne sont pas lus, et l'analyse le signale.
- **Les jeux de données et les bases de données** sont lus table par table : au plus **Tables par analyse** tables, et **Lignes par table** lignes de chacune.

Chaque analyse garde une trace de ce qu'elle a lu, par nom : les objets, tables ou services, jamais leur contenu. Ce qu'elle n'a pas pu lire - une requête que le cloud a refusée, le délai, le budget d'octets - devient un avertissement sur l'analyse, et l'analyse est marquée **Partiellement réussi**.

## Analyser une base de données que vous exploitez

Sécurité des données échantillonne les bases de données PostgreSQL et MySQL, de l'une de deux façons. Une base de données que surveille le produit Bases de données, ou avec laquelle vos services communiquent sur la carte des services, est déjà un magasin de données. Une base de données qu'aucune analyse ne trouve, ajoutez-la vous-même comme magasin de données.

- **Depuis les workers de OneUptime.** Dans les **Paramètres** du magasin de données, réglez **Chaîne de connexion** sur une chaîne qui ne peut que lire, comme `postgresql://reader:password@db.internal:5432/app`. Elle est chiffrée au repos et jamais renvoyée par l'API. Donnez-lui un utilisateur de base de données qui peut lire et rien d'autre.
- **Depuis une sonde dans votre réseau.** Choisissez la sonde sous **Analyser depuis la sonde**, et saisissez dans **Variable de connexion de la sonde** le nom de la variable d'environnement de cette sonde qui contient la chaîne de connexion. La sonde lit la base de données depuis votre réseau et ne renvoie que ce qu'elle a trouvé : la chaîne de connexion n'atteint jamais OneUptime. Voir [Sondes personnalisées](/docs/probe/custom-probe) pour exécuter une sonde.

## Ce que conserve OneUptime

Pour chaque type de données trouvé à chaque emplacement - une colonne, un champ, un motif d'objet, un attribut de télémétrie - une détection conserve :

- combien de valeurs échantillonnées le contenaient, sur combien, et combien d'entre elles étaient des valeurs de test bien connues ;
- combien de valeurs différentes correspondaient, estimé à partir de hachages qui restent dans la mémoire du scanner et sont abandonnés avec l'analyse ;
- la confiance, et si le nom de l'emplacement désignait le type de données ;
- au plus trois échantillons masqués, masqués dans le scanner avant que quoi que ce soit n'en sorte.

Elle ne conserve jamais une valeur brute. Chaque sorte de valeur est masquée de façon qu'une personne puisse la reconnaître, jamais l'utiliser :

| Valeur | Échantillon masqué |
| --- | --- |
| Une adresse e-mail | `j***@e******.com` : la première lettre du nom et du domaine, et le libellé de premier niveau |
| Un numéro de carte | `**** **** **** 4242` : les quatre derniers chiffres, comme PCI DSS permet d'afficher une carte |
| Un secret | Ses quatre premiers et quatre derniers caractères quand il est long, ses deux premiers quand il est court, et seulement l'en-tête d'une clé privée |
| Une URL ou une chaîne de connexion | Tout sauf le mot de passe |
| Une adresse IP | Sa première partie, le réseau, le reste étant masqué |
| Une valeur trouvée par son nom | Son premier caractère, puis `****` |
| Un marquage de document | Le marquage tel qu'il est écrit, comme « Confidentiel » : il dit ce qu'est le document |
| Tout le reste | Ses deux à quatre derniers caractères, séparateurs conservés, comme `***-**-6789` |

Désactivez **Conserver les échantillons masqués** dans les paramètres du projet pour ne conserver que des comptages : dès la prochaine analyse de chaque magasin de données, les détections qu'elle écrit ne conservent aucun échantillon.

Les copies de données entre magasins de données sont trouvées par empreintes, pas par valeurs : 128 nombres de 16 bits pour chaque type de données, hachés avec une clé propre au projet (voir [Comment les empreintes restent privées](/docs/data-security/flows-access-residency#comment-les-empreintes-restent-privées)).

Une détection compte pour son magasin de données pendant 30 jours après la dernière analyse qui l'a vue, car un échantillon peut manquer ce qui s'y trouve encore. Une détection non vue depuis 90 jours est supprimée. Un magasin de données conserve au plus 2 000 détections.

## Paramètres

Les paramètres de Sécurité des données forment un seul ensemble par projet, dans la section **Paramètres** du menu de Sécurité des données. Ils commencent avec ces valeurs par défaut :

| Paramètre | Par défaut | Ce qu'il fait |
| --- | --- | --- |
| **Contrôler la configuration** | Activé | Exécute les contrôles sur chaque magasin de données. Désactivé, aucun problème ne s'ouvre, ne change ni ne se ferme. |
| **Analyser le contenu** | Activé | Échantillonne le contenu des magasins de données là où l'autorisation de contenu a été accordée. |
| **Analyser la télémétrie** | Activé | Échantillonne les journaux, traces, exceptions, relectures et conversations IA du projet. |
| **Conserver les échantillons masqués** | Activé | Conserve jusqu'à trois échantillons masqués avec chaque détection. Désactivé, ne conserve que des comptages. |
| **Ouvrir des dossiers de sécurité** | Activé | Ouvre un dossier de sécurité, regroupé par magasin de données, quand un problème Critique s'ouvre. |
| **Déclencher des alertes** | Désactivé | Déclenche une alerte, qui prévient la personne d'astreinte, quand un problème Critique s'ouvre. |
| **Gravité de l'alerte** | Vide | La gravité de ces alertes. Vide correspond à la plus élevée du projet. |
| **Déclarer des incidents** | Désactivé | Déclare un incident, que votre processus de gestion des incidents prend en charge, quand un problème Critique s'ouvre. |
| **Gravité de l'incident** | Vide | La gravité de ces incidents. Vide correspond à la plus élevée du projet. |
| **Notifier les propriétaires** | Activé | Envoie un e-mail aux propriétaires d'un magasin de données quand un problème s'y ouvre. |
| **Objets par analyse** | 2 000 | Le nombre maximal d'objets que lit une analyse d'un bucket, de 10 à 50 000. |
| **Octets par objet** | 65 536 (64 Ko) | Le nombre maximal d'octets lus dans un objet, de 1 024 à 4 194 304. |
| **Octets par analyse** | 52 428 800 (50 Mo) | Le nombre maximal d'octets que lit au total une analyse de contenu, de 65 536 à 1 073 741 824. |
| **Lignes par table** | 1 000 | Le nombre maximal de lignes lues dans une table, de 10 à 100 000. |
| **Tables par analyse** | 200 | Le nombre maximal de tables que lit une analyse, de 1 à 5 000. |
| **Taille de l'échantillon de télémétrie** | 500 | Combien d'enregistrements récents de chaque service et de chaque signal lit une analyse de la télémétrie, de 10 à 10 000. |
| **Analyser toutes les (heures)** | 24 | La fréquence à laquelle le contenu d'un magasin de données est de nouveau échantillonné, de 1 à 720. |
| **Jamais sensible** | Vide | Des valeurs qui ne sont jamais des détections, comme votre propre adresse de support. |
| **Types de données désactivés** | Vide | Les types de données intégrés que les analyses du projet ne recherchent pas : les interrupteurs sous **Types de données intégrés**. |

## Dépannage

:::details Un magasin de données indique que son contenu n'a pas été analysé
L'analyse indique pourquoi : « L'analyse du contenu nécessite l'autorisation de contenu de la connexion, ou une chaîne de connexion pour une base de données. » Réglez la connexion du magasin de données sur **Configuration et échantillons de contenu** et exécutez à nouveau sa commande, ou donnez une chaîne de connexion à la base de données. Vérifiez aussi que **Analyser le contenu** est activé pour le magasin de données et dans les paramètres du projet.
:::

:::details Un contrôle indique qu'il ne peut pas trancher
Un fait que le lecteur n'a pas pu lire - une autorisation que le rôle n'a pas, une API qui n'est pas activée - est inconnu, jamais deviné. Son contrôle signale qu'il ne peut pas trancher, et un problème qu'il a ouvert reste ouvert : personne ne peut conclure qu'un problème est corrigé parce que OneUptime n'a pas pu regarder. Les avertissements de la lecture de la configuration indiquent ce qu'elle n'a pas pu lire. Exécutez à nouveau la commande de la connexion pour accorder ce qui manque.
:::

:::details Aucun bucket S3 ni jeu de données BigQuery n'apparaît
Ils viennent de la lecture de la configuration, pas de l'inventaire cloud. Réglez la connexion sur **Configuration uniquement** ou au-dessus, et exécutez à nouveau sa commande.
:::

:::details Une analyse est marquée Partiellement réussi
Elle a atteint une limite avant de tout lire : les 8 minutes, **Octets par analyse** ou **Objets par analyse**, ou une requête que le cloud a refusée. Ses avertissements indiquent laquelle. L'analyse suivante reprend, en ignorant ce qui n'a pas changé, ou relevez la limite.
:::

## Prochaines étapes

:::cards
- [Types de données sensibles](/docs/data-security/data-types): Ce que le scanner recherche dans ce qu'il lit.
- [Contrôles et problèmes de Sécurité des données](/docs/data-security/checks-and-issues): Ce que l'on contrôle dans la lecture de la configuration.
- [Données sensibles dans la télémétrie](/docs/data-security/telemetry): Vos journaux, traces et conversations IA, qui ne demandent aucune configuration.
- [Connecter un compte cloud](/docs/telemetry/cloud-accounts): Connectez d'abord AWS, Azure ou Google Cloud.
:::
