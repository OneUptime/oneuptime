# Configuration et sécurité des flux de travail

Ce qu'il faut savoir avant de confier un vrai trafic à un flux de travail : comment l'activer en toute sécurité, qui peut faire quoi, comment les secrets et les URL restent privés, ce que les étapes d'un flux de travail peuvent modifier, et les limites dans lesquelles s'inscrit chaque exécution.

:::cards
- [Mise en production](#activer-ou-désactiver-un-flux-de-travail): Testez avec Exécuter le flux de travail tant qu'il est désactivé, puis activez-le.
- [Autorisations](#autorisations): Les rôles de flux de travail, et les autorisations individuelles qui les composent.
- [Ce que les étapes peuvent faire](#ce-que-les-étapes-dun-flux-de-travail-peuvent-faire): Les étapes agissent en tant qu'Administrateur du projet, dans le projet du flux de travail.
- [Limites](#limites-du-forfait): Exécutions par forfait, durée d'une exécution et appels entre flux de travail.
:::

## Activer ou désactiver un flux de travail

Chaque flux de travail a un interrupteur **Activé** en haut de son **Constructeur**, et sur sa page **Vue d'ensemble**. Quand il est désactivé, son déclencheur est en pause — les appels de webhook, les e-mails entrants, les heures planifiées, les événements OneUptime et les étapes **Exécuter un autre flux de travail** d'autres flux de travail ne le lancent pas. **Exécuter le flux de travail** et **Run just this step**, si : une exécution que vous lancez vous-même pendant que le flux de travail est désactivé est une **Exécution de test**. Les nouveaux flux de travail démarrent désactivés.

Servez-vous de cet interrupteur comme du feu vert « prêt à partir » :

:::steps
1. Construisez le flux de travail.
2. Cliquez sur **Exécuter le flux de travail** dans le **Constructeur** avec des valeurs réalistes, pendant que le flux de travail est encore désactivé. L'exécution est une **Exécution de test** : chaque bloc s'exécute pour de vrai, alors dirigez-le d'abord vers un canal de test ou un enregistrement de test.
3. Ouvrez l'exécution et vérifiez que chaque bloc est allé là où vous l'attendiez. Voir [Exécutions](/docs/workflows/runs-and-logs).
4. Basculez **Activé** quand il est prêt : à partir de là, son déclencheur se produit sur de vrais événements.
:::

Désactiver un flux de travail empêche son déclencheur de lancer de nouvelles exécutions. Une exécution déjà en cours se termine, mais une exécution lancée par son déclencheur qui attend sur un bloc **Pause** est annulée à son réveil. Les exécutions de test continuent. Pour en activer ou en désactiver plusieurs à la fois, sélectionnez-les dans la liste **Flux de travail** et choisissez **Activer** ou **Désactiver** sous **Actions groupées**.

## Archiver un flux de travail

Archivez un flux de travail dont vous n'avez plus besoin mais que vous voulez conserver. Un flux de travail archivé :

- **Ne s'exécute jamais**, quel que soit le déclencheur. Les exécutions manuelles et **Run just this step**, les appels de webhook, les planifications, les événements OneUptime, les e-mails entrants et les étapes **Exécuter un autre flux de travail** des autres flux de travail sont tous refusés. Un appel de webhook vers un flux de travail archivé reçoit une erreur qui indique que le flux de travail est archivé.
- **Arrête les exécutions en attente.** Une exécution endormie dans une étape **Pause** est annulée à son réveil, et une exécution mise en file mais pas encore démarrée se termine par "Workflow was archived before this run started, so it did not run."
- **Quitte la liste des flux de travail.** Vous le trouvez sous **Flux de travail → Avancé → Archivé**.
- **Garde tout.** Ses étapes, ses variables, ses propriétaires, ses étiquettes et son historique d'exécutions restent tels quels.

Pour archiver un flux de travail, ouvrez-le, allez dans **Paramètres** et cliquez sur **Archiver**. Pour en archiver plusieurs, sélectionnez-les dans la liste **Flux de travail** et choisissez **Archiver**.

Pour faire revenir un flux de travail, ouvrez **Flux de travail → Avancé → Archivé**, sélectionnez-le et choisissez **Désarchiver**, ou ouvrez-le et cliquez sur **Désarchiver** dans la bannière en haut de ses pages.

L'archivage et l'interrupteur **Activé** sont indépendants. L'archivage ne touche pas à l'interrupteur : un flux de travail qui était activé s'exécute de nouveau dès qu'il est désarchivé, et un flux de travail qui était désactivé le reste. La page **Archivé** indique lequel est dans quel cas dans sa colonne **Une fois désarchivé**.

Un flux de travail exporté n'emporte jamais son état archivé : une copie importée n'est donc jamais archivée.

## Propriétaires et étiquettes

| Quoi                         | Où                                                         | Ce que cela fait                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Propriétaires**            | La page **Propriétaires** du flux de travail                      | Les utilisateurs et les équipes responsables du flux de travail. Un rôle limité à ce que possède son équipe atteint les flux de travail que cette équipe possède.     |
| **Étiquettes**               | La page **Vue d'ensemble** du flux de travail                     | Des étiquettes pour regrouper les flux de travail, par équipe, intégration ou environnement. Filtrez la liste **Flux de travail** par étiquette, et limitez un rôle à certaines étiquettes. |
| **Règles d'étiquettes**      | **Flux de travail → Paramètres → Règles d'étiquettes**      | Étiqueter automatiquement les nouveaux flux de travail, selon des motifs dans leur nom ou leur description.                                                  |
| **Règles de propriétaire**   | **Flux de travail → Paramètres → Règles de propriétaire**   | Attribuer automatiquement des propriétaires aux nouveaux flux de travail.                                                                                    |

Voir [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules) pour savoir comment les règles s'appliquent.

## Secrets

Marquez une variable comme **secret** si elle contient quelque chose de sensible : sa valeur est alors effacée des journaux d'exécution et des traces des étapes. Aucune valeur de variable ne peut être relue une fois enregistrée, secrète ou non, ni dans le tableau de bord ni via l'API, et une variable devenue secrète le reste.

Utilisez des variables secrètes pour :

- Les clés d'API de services externes.
- Les jetons d'authentification.
- Les clés de signature de webhook.
- Tout ce que vous ne voudriez pas montrer à quelqu'un qui n'a qu'un accès en lecture.

Ne collez pas un secret directement dans un bloc — des valeurs comme `Authorization: Bearer eyJh...` finissent visibles dans le flux de travail et dans les journaux. Utilisez plutôt `{{global.variables.MY_SECRET}}`.

Si le secret est un jeton d'accès OAuth qui expire, faites de la variable une [variable OAuth 2.0](/docs/workflows/variables#variables-oauth-20-des-jetons-qui-se-renouvellent-seuls). OneUptime récupère alors le jeton auprès de votre fournisseur d'identité et le renouvelle chaque fois qu'un flux de travail s'apprête à en utiliser un expiré. Les variables OAuth 2.0 sont toujours secrètes, et leurs identifiants sont chiffrés dans la base de données.

## Exporter et importer des flux de travail

Vous pouvez déplacer un flux de travail entre projets, ou entre une installation auto-hébergée et OneUptime Cloud, sous forme de fichier JSON.

:::tabs
@tab Exporter
Ouvrez le flux de travail, allez dans **Paramètres** et cliquez sur **Exporter : Flux de travail**. Pour mettre plusieurs flux de travail dans un même fichier, sélectionnez-les dans la liste **Flux de travail** et choisissez **Exporter en JSON**.
@tab Importer
Dans la liste **Flux de travail**, cliquez sur **Importer du JSON** et choisissez un fichier exporté depuis n'importe quel projet OneUptime. Un flux de travail dont le projet a déjà le nom est importé avec "(Imported)" après son nom.
:::

Le fichier contient le nom du flux de travail, sa description, son état d'activation et son graphe. Il ne contient volontairement pas :

- **La clé secrète du webhook.** Une nouvelle clé est générée à la création du flux de travail : un flux de travail importé a donc une autre URL de webhook — copiez-la depuis le déclencheur Webhook du nouveau flux de travail. Tout ce qui appelait l'original doit être redirigé.
- **L'adresse e-mail entrante.** Un flux de travail importé avec un déclencheur E-mail entrant reçoit sa propre adresse — copiez-la depuis le déclencheur du nouveau flux de travail. Tout ce qui écrivait à l'original doit recevoir la nouvelle adresse.
- **Les variables globales.** Un bloc qui lit `{{global.variables.MY_SECRET}}` garde cette référence, mais la valeur n'est pas dans le fichier. Créez les variables dans le projet de destination avant d'exécuter le flux de travail importé.
- **Les propriétaires et les étiquettes.** Les règles d'étiquettes et de propriétaires de votre projet s'appliquent au flux de travail importé, comme si vous l'aviez créé à la main.

Un flux de travail importé est toujours créé **désactivé**, même s'il était activé à l'endroit d'où il a été exporté — son graphe peut pointer vers des moniteurs, des politiques d'astreinte ou d'autres flux de travail qui n'existent pas dans le projet de destination. Relisez-le, testez-le avec **Exécuter le flux de travail**, puis activez-le. Dupliquer un flux de travail se comporte de la même façon : une copie ne se met donc jamais à se déclencher à côté de l'original avant que vous l'ayez modifiée.

Comme le graphe voyage tel quel, tout ce qui est saisi directement dans un bloc voyage avec lui. C'est la raison pratique de garder les identifiants dans des variables secrètes : exporter un flux de travail qui contient un jeton en dur remet ce jeton à quiconque reçoit le fichier.

## Sécurité des webhooks

Les déclencheurs webhook vous donnent une URL unique. Quiconque connaît l'URL peut l'appeler. Pour vous protéger des appels accidentels ou indésirables :

- Traitez l'URL comme un mot de passe. Ne la partagez pas publiquement et ne la committez pas dans un dépôt public. Le déclencheur Webhook masque la clé secrète de l'URL tant que vous ne cliquez pas sur **Afficher**, et **Copier l'URL** copie l'URL sans l'afficher.
- Si l'URL fuite, cliquez sur le déclencheur Webhook dans le **Constructeur** puis sur **Réinitialiser l'URL**. Le flux de travail reçoit une nouvelle URL et l'ancienne cesse de fonctionner immédiatement.
- Si le déclencheur indique que son URL se termine par l'ID du flux de travail, réinitialisez-la. Les flux de travail créés avant que les URL de webhook aient leur propre clé secrète utilisent à la place l'ID du flux de travail, et toute personne qui peut ouvrir le flux de travail peut le voir.
- Pour les flux de travail sensibles, demandez au système appelant d'envoyer un jeton partagé dans un en-tête (comme `X-Webhook-Token`) et vérifiez-le avec un bloc **Si / Sinon** avant de faire quoi que ce soit d'important. Enregistrez le jeton attendu comme variable secrète.
- Pour les flux de travail très sensibles, préférez un déclencheur d'événement OneUptime et une étape d'import manuelle à un webhook public.

Seules les personnes qui peuvent modifier le flux de travail — **Propriétaire du projet**, **Administrateur du projet**, **Administrateur des flux de travail** ou **Edit Workflow** — peuvent voir ou réinitialiser son URL de webhook. Quiconque a l'URL peut démarrer le flux de travail depuis n'importe où, sans se connecter : tous les autres voient donc une note qui dit à qui s'adresser. Cela inclut un **Membre des flux de travail**, qui exécute le flux de travail à la main depuis le **Constructeur**.

## Sécurité des e-mails entrants

Le déclencheur E-mail entrant donne au flux de travail sa propre adresse, et quiconque connaît l'adresse peut lui écrire. La partie avant le `@` est la clé secrète du flux de travail : traitez donc l'adresse comme un mot de passe :

- Ne la publiez pas et ne la mettez pas dans un dépôt public. Le déclencheur masque la clé tant que vous ne cliquez pas sur **Afficher**, et **Copier l'adresse** copie l'adresse sans l'afficher.
- Si l'adresse fuite, cliquez sur le déclencheur E-mail entrant dans le **Constructeur** puis sur **Réinitialiser l'adresse**. Le flux de travail reçoit une nouvelle adresse, et les e-mails envoyés à l'ancienne sont ignorés à partir de ce moment.
- N'importe qui peut mettre n'importe quel expéditeur sur un e-mail : **De** ne prouve donc pas qui l'a envoyé. Avant qu'un flux de travail fasse quoi que ce soit d'important, vérifiez une information que seul le véritable expéditeur connaît — un jeton dans l'objet ou dans un en-tête — avec un bloc **Si / Sinon**. Enregistrez le jeton attendu comme variable secrète.
- La clé est masquée dans tout ce que reçoit l'exécution — **À**, **Cc**, les en-têtes et les corps — car le journal de l'exécution est visible par toute personne qui peut lire les exécutions du flux de travail.

Seules les personnes qui peuvent modifier le flux de travail — **Propriétaire du projet**, **Administrateur du projet**, **Administrateur des flux de travail** ou **Edit Workflow** — peuvent voir ou réinitialiser son adresse. Tous les autres voient une note qui dit à qui s'adresser.

## Accès réseau sortant

Les blocs API et les autres blocs HTTP font leurs requêtes depuis OneUptime, et le bloc IRC se connecte depuis OneUptime au port du serveur IRC. Si vous êtes auto-hébergé, assurez-vous que votre installation peut atteindre les services que vous appelez. Si vous utilisez OneUptime Cloud, nos plages d'adresses IP sortantes sont listées dans [Adresses IP](/docs/configuration/ip-addresses) pour que vous puissiez les autoriser de l'autre côté.

Les adresses qu'un bloc peut atteindre dépendent du bloc :

| Blocs                                                      | Bouclage, lien local, métadonnées cloud                                      | Adresses de réseau privé                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Les blocs **API** et **Mattermost**, et les requêtes de **Exécuter du JavaScript personnalisé** | Refusées, sauf si l'hôte exact est nommé dans `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Refusées, sauf si un administrateur auto-hébergé les autorise avec `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ou `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Envoyer un e-mail**, **IRC** et les URL de jeton OAuth 2.0      | Refusées                                                                     | Refusées sur OneUptime Cloud. Autorisées sur une installation auto-hébergée, sauf si `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` vaut `true`     |
| Slack, Microsoft Teams, Discord et Telegram                | Refusées                                                                     | Refusées : chacun n'envoie qu'aux adresses de son propre service                                                                          |

Voir [Accès au réseau privé](/docs/self-hosted/private-network-access) pour savoir comment un administrateur auto-hébergé les ouvre.

## Composants IA

**Générer du texte avec l'IA** envoie une requête à un LLM : le fournisseur LLM par défaut du projet, ou le fournisseur global de l'installation quand le projet n'en a pas. Configurez les fournisseurs sous **Paramètres du projet → IA → Fournisseurs LLM**, et ne mettez jamais la clé d'API d'un fournisseur ni un point de terminaison de votre choix dans un flux de travail.

Ce que reçoit le fournisseur, et ce que le modèle peut en faire :

- **Uniquement ce que vous mettez dans le bloc.** OneUptime envoie une consigne de sécurité fixe, puis les **Instructions système**, le **Prompt** et le **Contexte** du bloc, avec leurs références remplies. **Contexte** vient en dernier, après un marqueur, et la consigne de sécurité indique au modèle que tout ce qui suit le marqueur est une donnée non fiable, même un texte qui ressemble à des instructions.
- **Rien d'autre.** Les données du déclencheur, l'historique du flux de travail, les sorties des autres blocs, les enregistrements du projet, la télémétrie et les secrets ne sont jamais joints. Ils ne quittent OneUptime que si vous y faites référence dans l'un de ces trois paramètres.
- **Du texte, et aucun outil.** Le modèle ne peut pas interroger OneUptime, faire de requêtes HTTP ni modifier de données. Les paramètres supplémentaires d'un fournisseur ne laissent passer qu'une liste autorisée de champs de réglage de la génération : ils ne peuvent pas remplacer les messages, ajouter des outils, une recherche web ou d'autres sources de données, demander autre chose que du texte ou plusieurs réponses, activer le streaming, faire conserver la requête par le fournisseur, ni relever la limite de sortie du bloc. Les champs que OneUptime ne connaît pas sont écartés.
- **Le modèle est le choix de votre administrateur.** Si la génération doit rester hors ligne, choisissez un modèle qui ne va rien chercher de lui-même du côté du fournisseur.

Ce qui est journalisé :

- Le journal de l'exécution masque les **Instructions système**, le **Prompt**, le **Contexte** et la **Réponse** du bloc. Les blocs suivants peuvent quand même les utiliser pendant l'exécution, et un bloc dans lequel vous en insérez un le journalise selon ses propres règles : en insérer un revient à choisir de l'afficher.
- Le fournisseur, le modèle, le nombre de jetons, le **ID du journal LLM** et un message d'erreur sans risque restent visibles, pour l'exploitation et la facturation. L'erreur brute d'un fournisseur est tenue à l'écart de tous les journaux, car un fournisseur peut y répéter la requête.
- Chaque appel est listé sous **Paramètres du projet → IA → Journaux IA** avec son fournisseur, son modèle, son statut, ses jetons, son coût et sa facturation, sans le prompt, la réponse ni l'erreur brute.

Ce dont le bloc a besoin, et ce qu'il coûte :

- **Activer l'IA** doit être activé, sous **Paramètres du projet → IA → Fonctionnalités IA**. Sur OneUptime Cloud, le projet a aussi besoin du forfait Growth ou supérieur et d'un abonnement payé. Les installations auto-hébergées sans facturation n'ont pas de restriction de forfait.
- Les appels via un fournisseur global payant utilisent les crédits IA du projet.
- Chaque appel compte dans les [limites quotidiennes d'IA propres au projet](/docs/ai/ai-sre#les-limites-quotidiennes-propres-au-projet), quand un Propriétaire du projet les fixe. Une fois une limite atteinte, le bloc prend **Erreur** sans contacter le modèle, jusqu'à minuit UTC.

| Limite                                                       | Valeur                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Instructions système**, **Prompt** et **Contexte** ensemble  | 50 000 caractères                                                         |
| **Température**                                              | De `0` à `1`                                                              |
| **Nombre maximal de jetons en sortie**                                    | De `1` à `4096`, `1024` par défaut                                        |
| Une requête                                                  | Une seule tentative, 60 secondes au plus                                  |
| Appels simultanés                                            | 3 par projet. Les suivants prennent **Erreur**, et une exécution ultérieure peut réessayer. |

Les échecs de validation, de configuration, d'accès, de limite, de crédits, de simultanéité, de fournisseur et de délai prennent tous le chemin **Erreur**, avec la raison dans **Erreur**. Reliez ce chemin avant la mise en production du flux de travail.

> [!WARNING]
> Chaque valeur à laquelle vous faites référence est une donnée que vous envoyez au fournisseur. Ne mettez pas de variable secrète dans le prompt ni dans le contexte, sauf si le fournisseur est autorisé à la recevoir. Un fournisseur local auto-hébergé comme Ollama garde les requêtes au sein de votre propre infrastructure ; un fournisseur hébergé les reçoit selon ses propres conditions de traitement des données.

## Autorisations

Les flux de travail respectent le contrôle d'accès basé sur les rôles de votre projet. Les trois rôles de flux de travail :

- **Administrateur des flux de travail** — construit les flux de travail : les crée, les modifie, les exécute et les supprime, et gère les variables qu'ils utilisent.
- **Membre des flux de travail** — les utilise : ouvre les flux de travail et leurs exécutions, et exécute un flux de travail à la main avec **Exécuter le flux de travail**. Un membre ne peut pas créer, modifier ni supprimer un flux de travail, ni exécuter l'une de ses étapes seule. Le **Constructeur** leur montre un flux de travail tel qu'il est, marqué **Lecture seule** : une étape s'ouvre pour être lue, et rien de ce qu'ils y font n'est enregistré.
- **Lecteur des flux de travail** — lit les flux de travail et leurs exécutions.

**Propriétaire du projet** et **Administrateur du projet** peuvent faire tout ce que peut faire un Administrateur des flux de travail. **Membre du projet** peut créer et supprimer des flux de travail, mais pas les modifier ni les exécuter.

Les autorisations individuelles, pour une équipe ou une clé d'API qui a besoin d'une seule chose :

- **Create / Read / Edit / Delete Workflow** — les autorisations de base sur le flux de travail lui-même. Modifier un flux de travail, y compris l'activer, le désactiver ou l'archiver, demande **Edit Workflow** ; **Delete Workflow** ne fait que supprimer.
- **Edit Workflow** — c'est aussi ce qu'il faut pour exécuter une seule étape avec **Run just this step**, et pour voir ou réinitialiser l'URL de webhook et l'adresse e-mail entrante d'un flux de travail. Exécuter un flux de travail entier à la main demande **Edit Workflow**, **Administrateur des flux de travail** ou **Membre des flux de travail**.
- **Read Workflow Log** — nécessaire pour voir les exécutions.
- **Create / Read / Edit / Delete Workflow Variables** — gérer les variables globales et de flux de travail.

Une exécution à la main n'atteint que les flux de travail que vous pouvez ouvrir : un rôle limité à certaines étiquettes, ou aux flux de travail que possède votre équipe, n'exécute que ceux-là. Une personne qui ne peut pas exécuter un flux de travail voit **Exécuter le flux de travail** grisé, avec la raison dans son info-bulle.

Un flux de travail qui s'exécute en tant que **Propriétaire du projet** ou en tant que rôle personnalisé n'est modifié et exécuté à la main que par des personnes qui ont elles-mêmes ces autorisations ; les autres ne peuvent que le consulter dans le **Constructeur**. Voir [Run As](#run-as).

Donnez **Administrateur des flux de travail** aux personnes qui construisent l'automatisation, et **Membre des flux de travail** à celles qui ne font que la lancer. Réservez l'accès en modification aux variables aux personnes qui gèrent les secrets de votre projet. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index) pour savoir comment les rôles sont attribués.

## Ce que les étapes d'un flux de travail peuvent faire

Les étapes qui lisent et modifient des enregistrements OneUptime — les composants Find, Create, Update et Delete, et les déclencheurs On Create, On Update, On Create or Update et On Delete — agissent en tant que **Administrateur du projet** du projet du flux de travail. Quelle que soit la personne qui a construit le flux de travail, une étape est soumise aux mêmes vérifications qu'un Administrateur du projet dans le tableau de bord et l'API :

- **Uniquement le projet du flux de travail.** Une étape lit et écrit les enregistrements du projet auquel appartient le flux de travail et d'aucun autre, et un Update ne déplace jamais un enregistrement vers un autre projet.
- **Uniquement ce qu'un Project Admin peut faire.** Une étape ne peut pas faire ce que seuls **Propriétaire du projet** et les autorisations de facturation ou de suppression du projet permettent, et elle ne peut pas lire qui a créé une sonde ou un agent IA, ce que seuls les Propriétaires du projet voient.
- **Pas qui a accès.** Avec les autorisations par défaut, une étape ne crée, ne modifie ni ne supprime d'équipes, de membres d'équipe, d'autorisations d'équipe ou de rôles personnalisés, même si un Administrateur du projet le peut. Celui qui construit un flux de travail décide de ce que font ses étapes, et ce peut être un **Membre du projet** : une étape qui le pourrait donnerait donc à celui qui l'a construite un accès qu'on ne lui a pas donné, comme **Administrateur du projet**. L'étape est refusée, et le journal de l'exécution nomme l'autorisation que demande la modification et indique de choisir **Run As** dans les **Paramètres** du flux de travail : un flux de travail qui s'exécute en tant que **Propriétaire du projet**, ou en tant que rôle personnalisé qui a cette autorisation, peut faire la modification (voir [Run As](#run-as)). Aucune étape d'un flux de travail ne modifie les clés d'API, l'authentification unique ou les paramètres SCIM, quelle que soit l'identité sous laquelle il s'exécute. Les déclencheurs et les étapes Find sur ces enregistrements fonctionnent toujours.
- **Pas la lecture des paramètres qui contiennent des identifiants.** Un Administrateur du projet peut lire les serveurs SMTP, les fournisseurs d'appels et de SMS, les identifiants SNMP, les connexions d'appel vidéo et les clés d'API, mais ce droit n'est jamais prêté à une étape, quelle que soit la personne qui a construit ou enregistré le flux de travail. Une étape ne peut désigner aucun de ces paramètres, comme le serveur SMTP par lequel une page de statut envoie ses e-mails ou la clé d'API à laquelle une autorisation est accordée. L'étape est refusée, et son journal d'exécution indique qu'une personne qui peut les lire (l'autorisation de lecture de ce type de paramètre, ou un Propriétaire du projet ou un Administrateur du projet) doit faire la modification. Une étape qui garde le paramètre qu'un enregistrement désigne déjà, ou qui le vide, n'est pas refusée.
- **Pas les incidents, alertes et épisodes privés.** Un Administrateur du projet voit tous les incidents, alertes et épisodes privés, mais cela n'est jamais prêté à une étape, quelle que soit la personne qui a construit ou enregistré le flux de travail. Une étape ne trouve aucun enregistrement privé, n'en modifie aucun et ne leur ajoute rien, et un flux de travail ne démarre ni sur l'un d'eux ni sur ce qui lui appartient, qu'un événement d'un enregistrement ou **Exécuter le flux de travail** le lance. Qui construit un flux de travail décide où va ce que lisent ses étapes — un webhook, un e-mail, une discussion, le journal d'exécution —, et ce peut être un **Membre du projet** qui ne peut pas voir un enregistrement privé. Voir [Incidents, alertes et épisodes privés](/docs/permissions/index#incidents-alertes-et-épisodes-privés).
- **Uniquement ce que votre forfait inclut.** Sur OneUptime Cloud, une étape qui crée ou modifie quelque chose que votre forfait n'inclut pas est refusée avec le forfait nécessaire, comme dans le tableau de bord. Les installations auto-hébergées sans facturation n'ont pas de limites de forfait.
- **Rien de ce que OneUptime garde pour lui.** Ceci est refusé à tout le monde, flux de travail compris :
  - modifier ou supprimer une entrée de fil d'activité (fils des incidents, des alertes, des épisodes, des moniteurs, des politiques d'astreinte et des maintenances planifiées) ;
  - écrire un journal de notification (journaux des SMS, des appels, des e-mails, de WhatsApp, de Telegram, des notifications push, des webhooks et des messages d'espace de travail) ;
  - les valeurs que OneUptime définit au fil des événements : si le CNAME d'un domaine personnalisé est vérifié, les interrupteurs de protection d'une équipe (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), quel rôle d'incident est le rôle principal et s'il peut être supprimé, si un propriétaire ou un membre a été notifié, les heures et le nombre de rappels, qui est d'astreinte maintenant et ensuite sur un planning, la progression d'une exécution d'astreinte, le taux de consommation et le budget d'erreur actuels d'un SLO, un moniteur mis en pause par un incident ou un événement de maintenance, le jeton de réinitialisation du mot de passe et la dernière connexion d'un utilisateur privé d'une page de statut, les informations qu'un service déclare sur lui-même (version, environnement d'exécution, cloud), et la dernière exécution d'une règle de détection ou d'un flux de menaces ;
  - déclarer un incident à partir d'un modèle en envoyant `createdIncidentTemplateId` à **Créer : Incident (un seul)** — choisissez plutôt le modèle sous le paramètre **Modèle d'incident** de l'étape : l'étape déclare alors l'incident à partir de lui, en tant qu'Administrateur du projet, et enregistre le modèle ;
  - changer l'enregistrement auquel appartient un enregistrement après sa création, comme le moniteur auquel se rapporte une ligne de propriétaire ou l'incident sur lequel figure une note.
- **Au nom de personne.** Un enregistrement créé par un flux de travail n'a pas de créateur, et le journal d'audit nomme le flux de travail, sous son nom du moment, comme auteur de la modification.

Quand une vérification refuse une étape, l'étape prend sa sortie **Erreur** sans faire la modification refusée, et le journal de l'exécution nomme l'étape et la raison en termes simples, par exemple *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Lisez-le dans les [Exécutions](/docs/workflows/runs-and-logs) du flux de travail. Une étape Create Many crée ses enregistrements un par un et s'arrête au premier refusé : les enregistrements créés avant celui-là sont conservés.

Les étapes qui dialoguent avec d'autres systèmes — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code et Generate Text with AI — ne lisent ni ne modifient d'enregistrements OneUptime : rien de tout cela ne les concerne.

### Run As

Par défaut, un flux de travail s'exécute avec les autorisations ci-dessus, et la plupart des flux de travail n'ont jamais besoin de plus. Quand l'un d'eux en a besoin — par exemple un flux de travail qui donne un rôle personnalisé à chaque nouvelle équipe —, ouvrez ses **Paramètres**, puis **Plus de paramètres**, et choisissez **Change Run As** :

- Par défaut : les autorisations ci-dessus.
- Propriétaire du projet : ce qu'un **Propriétaire du projet** peut faire dans ce projet, y compris changer qui fait partie d'une équipe et ce qu'une équipe peut faire. Seul un Propriétaire du projet peut le choisir.
- Un rôle personnalisé : exactement ce que permet l'un des rôles personnalisés du projet. Seule une personne qui pourrait donner ce rôle à une équipe peut le choisir.

Quelle que soit l'identité sous laquelle il s'exécute, une étape ne lit jamais les paramètres qui contiennent des identifiants, ne voit jamais les incidents, alertes ou épisodes privés et ne modifie jamais les clés d'API, l'authentification unique ou les paramètres SCIM. Quand elle donne une autorisation ou un rôle à une équipe, elle ne peut donner que ce qu'elle a elle-même, et s'il lui manque quelque chose, le journal de l'exécution nomme l'autorisation.

Un flux de travail qui s'exécute avec plus que les autorisations par défaut s'exécute avec les autorisations de la personne qui les lui a données : celle qui a choisi en dernier son **Run As**, ou enregistré ses étapes ou ses variables. Pour que personne n'obtienne par lui plus que ce qu'il a lui-même :

- Seules les personnes qui ont ces autorisations peuvent le modifier, lui ou ses variables, l'archiver ou le supprimer, l'exécuter à la main, lui ou l'une de ses étapes, ou voir son URL de webhook et son adresse e-mail entrante. Quiconque peut le modifier peut toujours le désactiver. Lorsqu'il passe à plus que les autorisations par défaut, ou que change l'identité sous laquelle il s'exécute, il reçoit une nouvelle URL de webhook et une nouvelle adresse e-mail entrante, si bien que les copies des anciennes ne le démarrent plus.
- Seule une personne peut les donner, jamais une clé d'API.
- Chaque exécution vérifie d'abord que la personne qui les a données les a toujours. Sinon, l'exécution s'arrête avant sa première étape, et son journal dit pourquoi et qui peut les redonner.
- Il ne lit pas les variables globales du projet, que peut modifier quiconque peut modifier les variables de flux de travail.
- L'étape **Exécuter un autre flux de travail** d'un autre flux de travail ne peut le démarrer que si ce flux de travail s'exécute avec les mêmes autorisations ou plus.

Chaque exécution enregistre en tant que quoi elle s'est exécutée et avec les autorisations de qui, ce que montrent la fenêtre de l'exécution et un journal téléchargé, et le [journal d'audit](/docs/configuration/audit-logs) enregistre qui a changé le **Run As** d'un flux de travail.

## Limites du forfait

Sur OneUptime Cloud, les flux de travail demandent le forfait Growth ou supérieur, et chaque forfait autorise un certain nombre d'exécutions sur 30 jours :

| Forfait    | Exécutions sur les 30 derniers jours |
| ---------- | ------------------------------------ |
| Growth     | 500                                  |
| Scale      | 2 000                                |
| Enterprise | Pas de limite pratique               |

La fenêtre est glissante : chaque exécution enregistrée par le projet, à la main ou depuis un déclencheur, compte pendant 30 jours. Sur les forfaits Growth et Scale, la page **Flux de travail** affiche une carte **Exécutions du flux de travail** avec le nombre d'exécutions utilisées par le projet. Une fois la limite atteinte, les nouvelles exécutions sont enregistrées avec le statut **Exécution au-delà du forfait actuel** et ne s'exécutent pas, et il en va de même tant que l'abonnement est impayé. Les installations auto-hébergées sans facturation n'ont pas de limite. Sur un forfait qui n'exécute aucun flux de travail, le **Constructeur** et la page **Flux de travail** le disent, avec un lien pour passer à un forfait supérieur.

## Combien de temps peut durer une exécution

| Limite                                                       | Par défaut         | Paramètre auto-hébergé          |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Une exécution, depuis son démarrage ou son réveil après un **Pause** | 2 minutes | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un bloc **Exécuter du JavaScript personnalisé**                            | 5 secondes         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un bloc **Pause**                                            | 30 jours au plus   | —                               |

Le moteur d'exécution vérifie l'échéance avant et après chaque bloc, et marque une exécution en retard **Délai dépassé** dès que la main lui revient. Il ne peut pas interrompre un bloc en cours de route : les blocs qui attendent le réseau ont donc leurs propres délais : une requête Generate Text with AI abandonne au bout de 60 secondes au plus, et une demande de jeton OAuth 2.0 au bout de 20. Une attente sur un bloc **Pause** ne compte pas dans la durée d'une exécution : l'exécution est mise de côté et reçoit 2 nouvelles minutes à son réveil.

## Limite d'appels entre flux de travail

Le composant **Exécuter un autre flux de travail** permet à un flux de travail d'en démarrer un autre. Pour éviter les boucles où le flux de travail A démarre B, qui redémarre A, une chaîne de flux de travail qui se démarrent les uns les autres est refusée quand elle reviendrait vers un flux de travail qui en fait déjà partie, ou dépasserait 10 flux de travail de profondeur. Le bloc **Exécuter un autre flux de travail** prend alors sa sortie **Erreur**, et l'erreur montre la chaîne.

Si vous avez réellement besoin d'une longue chaîne (comme une tâche qui traite un élément par exécution), il est en général plus simple de boucler dans un seul flux de travail avec **Exécuter du JavaScript personnalisé**.

## Quand un flux de travail n'est pas le bon outil

Quelques cas où il vaut mieux choisir autre chose :

- **Calculs lourds ou gros volumes de données** — les flux de travail sont conçus pour un travail de liaison léger, pas pour le calcul intensif. Exécutez les traitements lourds dans votre propre infrastructure et laissez un flux de travail les lancer.
- **Calcul actif de longue durée** — une exécution dispose de 2 minutes par défaut. Pour un délai passif comme « faire A, attendre deux heures, faire B », utilisez le composant **Pause** ; il met l'exécution de côté et la reprend plus tard sans occuper de worker.
- **Réponse aux incidents étape par étape avec des personnes dans la boucle** — c'est le rôle des [Runbooks](/docs/runbooks/index). Les flux de travail servent à l'automatisation sans surveillance.

## Étapes suivantes

:::cards
- [Présentation des flux de travail](/docs/workflows/index): La vue d'ensemble, et un premier flux de travail de bout en bout.
- [Composants](/docs/workflows/components): Ce dont chaque bloc a besoin, ce qu'il renvoie et ce qu'il peut atteindre.
- [Runbooks](/docs/runbooks/index): Quand des personnes doivent prendre les décisions en cours de route.
:::
