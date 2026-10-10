# Configuration et sécurité des workflows

Ce qu'il faut savoir avant de confier un vrai trafic à un workflow : comment l'activer en toute sécurité, qui peut faire quoi, comment les secrets et les URL restent privés, ce que les étapes d'un workflow peuvent modifier, et les limites dans lesquelles s'inscrit chaque exécution.

:::cards
- [Mise en production](#activer-ou-désactiver-un-workflow): Testez avec Exécuter le flux de travail, puis laissez le workflow activé.
- [Autorisations](#autorisations): Les rôles de workflow, et les autorisations individuelles qui les composent.
- [Ce que les étapes peuvent faire](#ce-que-les-étapes-dun-workflow-peuvent-faire): Les étapes agissent en tant que Project Admin du projet du workflow.
- [Limites](#limites-du-forfait): Exécutions par forfait, durée d'une exécution et appels entre workflows.
:::

## Activer ou désactiver un workflow

Chaque workflow a un interrupteur **Activé** en haut de son **Constructeur**, et sur sa page **Vue d'ensemble**. Quand il est désactivé, le workflow ne s'exécute pas — les appels de webhook, les e-mails entrants, les heures planifiées et les événements OneUptime sont tous ignorés, tout comme **Exécuter le flux de travail** et **Run just this step**. Les nouveaux workflows démarrent désactivés.

Servez-vous de cet interrupteur comme du feu vert « prêt à partir » :

:::steps
1. Construisez le workflow.
2. Cliquez sur **Exécuter le flux de travail** dans le **Constructeur** avec des valeurs réalistes. Un workflow désactivé ne peut pas s'exécuter, même à la main : le Constructeur vous demande donc d'abord de l'activer ; cliquez sur **Activer et exécuter**.
3. Ouvrez l'exécution et vérifiez que chaque bloc est allé là où vous l'attendiez. Voir [Exécutions](/docs/workflows/runs-and-logs).
4. Laissez **Activé** s'il est prêt. Sinon, désactivez-le jusqu'à ce qu'il le soit : tant qu'il est activé, son déclencheur se produit sur de vrais événements.
:::

Désactiver un workflow empêche de nouvelles exécutions de démarrer. Une exécution déjà en cours se termine, mais une exécution qui attend sur un bloc **Sleep** est annulée à son réveil.

## Archiver un workflow

Archivez un workflow dont vous n'avez plus besoin mais que vous voulez conserver. Un workflow archivé :

- **Ne s'exécute jamais**, quel que soit le déclencheur. Les exécutions manuelles et **Run just this step**, les appels de webhook, les planifications, les événements OneUptime, les e-mails entrants et les étapes **Execute Workflow** des autres workflows sont tous refusés. Un appel de webhook vers un workflow archivé reçoit une erreur qui indique que le workflow est archivé.
- **Arrête les exécutions en attente.** Une exécution endormie dans une étape **Sleep** est annulée à son réveil, et une exécution mise en file mais pas encore démarrée se termine par "Workflow was archived before this run started, so it did not run."
- **Quitte la liste des workflows.** Vous le trouvez sous **Flux de travail → Avancé → Archivé**.
- **Garde tout.** Ses étapes, ses variables, ses propriétaires, ses étiquettes et son historique d'exécutions restent tels quels.

Pour archiver un workflow, ouvrez-le, allez dans **Paramètres** et cliquez sur **Archiver**. Pour en archiver plusieurs, sélectionnez-les dans la liste **Flux de travail** et choisissez **Archiver**.

Pour faire revenir un workflow, ouvrez **Flux de travail → Avancé → Archivé**, sélectionnez-le et choisissez **Désarchiver**, ou ouvrez-le et cliquez sur **Désarchiver** dans la bannière en haut de ses pages.

L'archivage et l'interrupteur **Activé** sont indépendants. L'archivage ne touche pas à l'interrupteur : un workflow qui était activé s'exécute de nouveau dès qu'il est désarchivé, et un workflow qui était désactivé le reste. La page **Archivé** indique lequel est dans quel cas dans sa colonne **When Unarchived**.

Un workflow exporté n'emporte jamais son état archivé : une copie importée n'est donc jamais archivée.

## Propriétaires et étiquettes

| Quoi                         | Où                                                         | Ce que cela fait                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Propriétaires**            | La page **Propriétaires** du workflow                      | Les utilisateurs et les équipes responsables du workflow. Un rôle limité à ce que possède son équipe atteint les workflows que cette équipe possède.     |
| **Étiquettes**               | La page **Vue d'ensemble** du workflow                     | Des étiquettes pour regrouper les workflows, par équipe, intégration ou environnement. Filtrez la liste **Flux de travail** par étiquette, et limitez un rôle à certaines étiquettes. |
| **Règles d'étiquettes**      | **Flux de travail → Paramètres → Règles d'étiquettes**      | Étiqueter automatiquement les nouveaux workflows, selon des motifs dans leur nom ou leur description.                                                  |
| **Règles de propriétaire**   | **Flux de travail → Paramètres → Règles de propriétaire**   | Attribuer automatiquement des propriétaires aux nouveaux workflows.                                                                                    |

Voir [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules) pour savoir comment les règles s'appliquent.

## Secrets

Marquez une variable comme **secret** si elle contient quelque chose de sensible : sa valeur est alors effacée des journaux d'exécution et des traces des étapes. Aucune valeur de variable ne peut être relue une fois enregistrée, secrète ou non, ni dans le tableau de bord ni via l'API, et une variable devenue secrète le reste.

Utilisez des variables secrètes pour :

- Les clés d'API de services externes.
- Les jetons d'authentification.
- Les clés de signature de webhook.
- Tout ce que vous ne voudriez pas montrer à quelqu'un qui n'a qu'un accès en lecture.

Ne collez pas un secret directement dans un bloc — des valeurs comme `Authorization: Bearer eyJh...` finissent visibles dans le workflow et dans les journaux. Utilisez plutôt `{{global.variables.MY_SECRET}}`.

Si le secret est un jeton d'accès OAuth qui expire, faites de la variable une [variable OAuth 2.0](/docs/workflows/variables#variables-oauth-20-des-jetons-qui-se-renouvellent-seuls). OneUptime récupère alors le jeton auprès de votre fournisseur d'identité et le renouvelle chaque fois qu'un workflow s'apprête à en utiliser un expiré. Les variables OAuth 2.0 sont toujours secrètes, et leurs identifiants sont chiffrés dans la base de données.

## Exporter et importer des workflows

Vous pouvez déplacer un workflow entre projets, ou entre une installation auto-hébergée et OneUptime Cloud, sous forme de fichier JSON.

:::tabs
@tab Exporter
Ouvrez le workflow, allez dans **Paramètres** et cliquez sur **Exporter : Flux de travail**. Pour mettre plusieurs workflows dans un même fichier, sélectionnez-les dans la liste **Flux de travail** et choisissez **Exporter en JSON**.
@tab Importer
Dans la liste **Flux de travail**, cliquez sur **Importer du JSON** et choisissez un fichier exporté depuis n'importe quel projet OneUptime. Un workflow dont le projet a déjà le nom est importé avec "(Imported)" après son nom.
:::

Le fichier contient le nom du workflow, sa description, son état d'activation et son graphe. Il ne contient volontairement pas :

- **La clé secrète du webhook.** Une nouvelle clé est générée à la création du workflow : un workflow importé a donc une autre URL de webhook — copiez-la depuis le déclencheur Webhook du nouveau workflow. Tout ce qui appelait l'original doit être redirigé.
- **L'adresse e-mail entrante.** Un workflow importé avec un déclencheur Incoming Email reçoit sa propre adresse — copiez-la depuis le déclencheur du nouveau workflow. Tout ce qui écrivait à l'original doit recevoir la nouvelle adresse.
- **Les variables globales.** Un bloc qui lit `{{global.variables.MY_SECRET}}` garde cette référence, mais la valeur n'est pas dans le fichier. Créez les variables dans le projet de destination avant d'exécuter le workflow importé.
- **Les propriétaires et les étiquettes.** Les règles d'étiquettes et de propriétaires de votre projet s'appliquent au workflow importé, comme si vous l'aviez créé à la main.

Un workflow importé est toujours créé **désactivé**, même s'il était activé à l'endroit d'où il a été exporté — son graphe peut pointer vers des moniteurs, des politiques d'astreinte ou d'autres workflows qui n'existent pas dans le projet de destination. Relisez-le, activez-le, testez-le avec **Exécuter le flux de travail**, puis laissez-le activé. Dupliquer un workflow se comporte de la même façon : une copie ne se met donc jamais à se déclencher à côté de l'original avant que vous l'ayez modifiée.

Comme le graphe voyage tel quel, tout ce qui est saisi directement dans un bloc voyage avec lui. C'est la raison pratique de garder les identifiants dans des variables secrètes : exporter un workflow qui contient un jeton en dur remet ce jeton à quiconque reçoit le fichier.

## Sécurité des webhooks

Les déclencheurs webhook vous donnent une URL unique. Quiconque connaît l'URL peut l'appeler. Pour vous protéger des appels accidentels ou indésirables :

- Traitez l'URL comme un mot de passe. Ne la partagez pas publiquement et ne la committez pas dans un dépôt public. Le déclencheur Webhook masque la clé secrète de l'URL tant que vous ne cliquez pas sur **Afficher**, et **Copier l'URL** copie l'URL sans l'afficher.
- Si l'URL fuite, cliquez sur le déclencheur Webhook dans le **Constructeur** puis sur **Réinitialiser l'URL**. Le workflow reçoit une nouvelle URL et l'ancienne cesse de fonctionner immédiatement.
- Si le déclencheur indique que son URL se termine par l'ID du workflow, réinitialisez-la. Les workflows créés avant que les URL de webhook aient leur propre clé secrète utilisent à la place l'ID du workflow, et toute personne qui peut ouvrir le workflow peut le voir.
- Pour les workflows sensibles, demandez au système appelant d'envoyer un jeton partagé dans un en-tête (comme `X-Webhook-Token`) et vérifiez-le avec un bloc **If / Else** avant de faire quoi que ce soit d'important. Enregistrez le jeton attendu comme variable secrète.
- Pour les workflows très sensibles, préférez un déclencheur d'événement OneUptime et une étape d'import manuelle à un webhook public.

Seules les personnes qui peuvent modifier le workflow — **Project Owner**, **Project Admin**, **Workflow Admin** ou **Edit Workflow** — peuvent voir ou réinitialiser son URL de webhook. Quiconque a l'URL peut démarrer le workflow depuis n'importe où, sans se connecter : tous les autres voient donc une note qui dit à qui s'adresser. Cela inclut un **Workflow Member**, qui exécute le workflow à la main depuis le **Constructeur**.

## Sécurité des e-mails entrants

Le déclencheur Incoming Email donne au workflow sa propre adresse, et quiconque connaît l'adresse peut lui écrire. La partie avant le `@` est la clé secrète du workflow : traitez donc l'adresse comme un mot de passe :

- Ne la publiez pas et ne la mettez pas dans un dépôt public. Le déclencheur masque la clé tant que vous ne cliquez pas sur **Afficher**, et **Copier l'adresse** copie l'adresse sans l'afficher.
- Si l'adresse fuite, cliquez sur le déclencheur Incoming Email dans le **Constructeur** puis sur **Réinitialiser l'adresse**. Le workflow reçoit une nouvelle adresse, et les e-mails envoyés à l'ancienne sont ignorés à partir de ce moment.
- N'importe qui peut mettre n'importe quel expéditeur sur un e-mail : **From** ne prouve donc pas qui l'a envoyé. Avant qu'un workflow fasse quoi que ce soit d'important, vérifiez une information que seul le véritable expéditeur connaît — un jeton dans l'objet ou dans un en-tête — avec un bloc **If / Else**. Enregistrez le jeton attendu comme variable secrète.
- La clé est masquée dans tout ce que reçoit l'exécution — **To**, **CC**, les en-têtes et les corps — car le journal de l'exécution est visible par toute personne qui peut lire les exécutions du workflow.

Seules les personnes qui peuvent modifier le workflow — **Project Owner**, **Project Admin**, **Workflow Admin** ou **Edit Workflow** — peuvent voir ou réinitialiser son adresse. Tous les autres voient une note qui dit à qui s'adresser.

## Accès réseau sortant

Les blocs API et les autres blocs HTTP font leurs requêtes depuis OneUptime, et le bloc IRC se connecte depuis OneUptime au port du serveur IRC. Si vous êtes auto-hébergé, assurez-vous que votre installation peut atteindre les services que vous appelez. Si vous utilisez OneUptime Cloud, nos plages d'adresses IP sortantes sont listées dans [Adresses IP](/docs/configuration/ip-addresses) pour que vous puissiez les autoriser de l'autre côté.

Les adresses qu'un bloc peut atteindre dépendent du bloc :

| Blocs                                                      | Bouclage, lien local, métadonnées cloud                                      | Adresses de réseau privé                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Les blocs **API** et les requêtes de **Run Custom JavaScript** | Refusées, sauf si l'hôte exact est nommé dans `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Refusées, sauf si un administrateur auto-hébergé les autorise avec `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ou `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** et les URL de jeton OAuth 2.0      | Refusées                                                                     | Refusées sur OneUptime Cloud. Autorisées sur une installation auto-hébergée, sauf si `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` vaut `true`     |
| Slack, Microsoft Teams, Discord et Telegram                | Refusées                                                                     | Refusées : chacun n'envoie qu'aux adresses de son propre service                                                                          |

Voir [Accès au réseau privé](/docs/self-hosted/private-network-access) pour savoir comment un administrateur auto-hébergé les ouvre.

## Composants IA

**Generate Text with AI** envoie une requête à un LLM : le fournisseur LLM par défaut du projet, ou le fournisseur global de l'installation quand le projet n'en a pas. Configurez les fournisseurs sous **Paramètres du projet → IA → Fournisseurs LLM**, et ne mettez jamais la clé d'API d'un fournisseur ni un point de terminaison de votre choix dans un workflow.

Ce que reçoit le fournisseur, et ce que le modèle peut en faire :

- **Uniquement ce que vous mettez dans le bloc.** OneUptime envoie une consigne de sécurité fixe, puis les **System Instructions**, le **Prompt** et le **Context** du bloc, avec leurs références remplies. **Context** vient en dernier, après un marqueur, et la consigne de sécurité indique au modèle que tout ce qui suit le marqueur est une donnée non fiable, même un texte qui ressemble à des instructions.
- **Rien d'autre.** Les données du déclencheur, l'historique du workflow, les sorties des autres blocs, les enregistrements du projet, la télémétrie et les secrets ne sont jamais joints. Ils ne quittent OneUptime que si vous y faites référence dans l'un de ces trois paramètres.
- **Du texte, et aucun outil.** Le modèle ne peut pas interroger OneUptime, faire de requêtes HTTP ni modifier de données. Les paramètres supplémentaires d'un fournisseur ne laissent passer qu'une liste autorisée de champs de réglage de la génération : ils ne peuvent pas remplacer les messages, ajouter des outils, une recherche web ou d'autres sources de données, demander autre chose que du texte ou plusieurs réponses, activer le streaming, faire conserver la requête par le fournisseur, ni relever la limite de sortie du bloc. Les champs que OneUptime ne connaît pas sont écartés.
- **Le modèle est le choix de votre administrateur.** Si la génération doit rester hors ligne, choisissez un modèle qui ne va rien chercher de lui-même du côté du fournisseur.

Ce qui est journalisé :

- Le journal de l'exécution masque les **System Instructions**, le **Prompt**, le **Context** et la **Response** du bloc. Les blocs suivants peuvent quand même les utiliser pendant l'exécution, et un bloc dans lequel vous en insérez un le journalise selon ses propres règles : en insérer un revient à choisir de l'afficher.
- Le fournisseur, le modèle, le nombre de jetons, le **LLM Log ID** et un message d'erreur sans risque restent visibles, pour l'exploitation et la facturation. L'erreur brute d'un fournisseur est tenue à l'écart de tous les journaux, car un fournisseur peut y répéter la requête.
- Chaque appel est listé sous **Paramètres du projet → IA → Journaux IA** avec son fournisseur, son modèle, son statut, ses jetons, son coût et sa facturation, sans le prompt, la réponse ni l'erreur brute.

Ce dont le bloc a besoin, et ce qu'il coûte :

- **Activer l'IA** doit être activé, sous **Paramètres du projet → IA → Fonctionnalités IA**. Sur OneUptime Cloud, le projet a aussi besoin du forfait Growth ou supérieur et d'un abonnement payé. Les installations auto-hébergées sans facturation n'ont pas de restriction de forfait.
- Les appels via un fournisseur global payant utilisent les crédits IA du projet.
- Chaque appel compte dans les [limites quotidiennes d'IA propres au projet](/docs/ai/ai-sre#the-projects-own-daily-limits), quand un propriétaire du projet les fixe. Une fois une limite atteinte, le bloc prend **Error** sans contacter le modèle, jusqu'à minuit UTC.

| Limite                                                       | Valeur                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **System Instructions**, **Prompt** et **Context** ensemble  | 50 000 caractères                                                         |
| **Temperature**                                              | De `0` à `1`                                                              |
| **Maximum Output Tokens**                                    | De `1` à `4096`, `1024` par défaut                                        |
| Une requête                                                  | Une seule tentative, 60 secondes au plus                                  |
| Appels simultanés                                            | 3 par projet. Les suivants prennent **Error**, et une exécution ultérieure peut réessayer. |

Les échecs de validation, de configuration, d'accès, de limite, de crédits, de simultanéité, de fournisseur et de délai prennent tous le chemin **Error**, avec la raison dans **Error**. Reliez ce chemin avant la mise en production du workflow.

> [!WARNING]
> Chaque valeur à laquelle vous faites référence est une donnée que vous envoyez au fournisseur. Ne mettez pas de variable secrète dans le prompt ni dans le contexte, sauf si le fournisseur est autorisé à la recevoir. Un fournisseur local auto-hébergé comme Ollama garde les requêtes au sein de votre propre infrastructure ; un fournisseur hébergé les reçoit selon ses propres conditions de traitement des données.

## Autorisations

Les workflows respectent le contrôle d'accès basé sur les rôles de votre projet. Les trois rôles de workflow :

- **Workflow Admin** — construit les workflows : les crée, les modifie, les exécute et les supprime, et gère les variables qu'ils utilisent.
- **Workflow Member** — les utilise : ouvre les workflows et leurs exécutions, et exécute un workflow à la main avec **Exécuter le flux de travail**. Un membre ne peut pas créer, modifier ni supprimer un workflow, ni exécuter l'une de ses étapes seule.
- **Workflow Viewer** — lit les workflows et leurs exécutions.

**Project Owner** et **Project Admin** peuvent faire tout ce que peut faire un Workflow Admin. **Project Member** peut créer et supprimer des workflows, mais pas les modifier ni les exécuter.

Les autorisations individuelles, pour une équipe ou une clé d'API qui a besoin d'une seule chose :

- **Create / Read / Edit / Delete Workflow** — les autorisations de base sur le workflow lui-même. Modifier un workflow, y compris l'activer, le désactiver ou l'archiver, demande **Edit Workflow** ; **Delete Workflow** ne fait que supprimer.
- **Edit Workflow** — c'est aussi ce qu'il faut pour exécuter une seule étape avec **Run just this step**, et pour voir ou réinitialiser l'URL de webhook et l'adresse e-mail entrante d'un workflow. Exécuter un workflow entier à la main demande **Edit Workflow**, **Workflow Admin** ou **Workflow Member**.
- **Read Workflow Log** — nécessaire pour voir les exécutions.
- **Create / Read / Edit / Delete Workflow Variables** — gérer les variables globales et de workflow.

Une exécution à la main n'atteint que les workflows que vous pouvez ouvrir : un rôle limité à certaines étiquettes, ou aux workflows que possède votre équipe, n'exécute que ceux-là. Une personne qui ne peut pas exécuter un workflow voit **Exécuter le flux de travail** grisé, avec la raison dans son info-bulle.

Donnez **Workflow Admin** aux personnes qui construisent l'automatisation, et **Workflow Member** à celles qui ne font que la lancer. Réservez l'accès en modification aux variables aux personnes qui gèrent les secrets de votre projet. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index) pour savoir comment les rôles sont attribués.

## Ce que les étapes d'un workflow peuvent faire

Les étapes qui lisent et modifient des enregistrements OneUptime — les composants Find, Create, Update et Delete, et les déclencheurs On Create, On Update et On Delete — agissent en tant que **Project Admin** du projet du workflow. Quelle que soit la personne qui a construit le workflow, une étape est soumise aux mêmes vérifications qu'un Project Admin dans le tableau de bord et l'API :

- **Uniquement le projet du workflow.** Une étape lit et écrit les enregistrements du projet auquel appartient le workflow et d'aucun autre, et un Update ne déplace jamais un enregistrement vers un autre projet.
- **Uniquement ce qu'un Project Admin peut faire.** Une étape ne peut accorder que les autorisations d'équipe et de clé d'API qu'un Project Admin détient lui-même : elle ne peut donc pas donner **Project Owner**, ni les autorisations de facturation ou de suppression du projet, et elle ne peut pas ajouter quelqu'un à une équipe dont les autorisations dépassent celles d'un Project Admin, comme l'équipe des propriétaires. Une étape ne peut pas lire qui a créé une sonde ou un agent IA, ce que seuls les propriétaires du projet voient.
- **Pas la lecture des identifiants de runbook.** Un Project Admin peut lire les identifiants de runbook, mais ce droit n'est pas prêté à une étape. Quand une modification demande cette lecture — laisser OneUptime AI exécuter ses commandes sans demander, activer **Exécute les commandes de remédiation IA** pour un Runner, attribuer un identifiant SSH à un Runner qui exécute les commandes de OneUptime AI, ou nommer un identifiant de runbook, par exemple dans les étapes d'un runbook —, on interroge à la place les droits de la personne qui a enregistré en dernier les étapes du workflow, et l'étape est refusée si cette personne ne peut pas lire les identifiants de runbook (**Read Runbook Credential**, ou un Project Owner ou un Project Admin). OneUptime enregistre cette personne quand quelqu'un crée le workflow et chaque fois que quelqu'un enregistre ses étapes ; renommer le workflow, changer ses étiquettes, l'activer ou le désactiver conserve la personne qui a enregistré ses étapes en dernier. Un enregistrement de ses étapes avec une clé d'API n'enregistre personne : les étapes du workflow ne peuvent donc pas faire ces modifications tant qu'une personne ne les a pas enregistrées.
- **Uniquement ce que votre forfait inclut.** Sur OneUptime Cloud, une étape qui crée ou modifie quelque chose que votre forfait n'inclut pas est refusée avec le forfait nécessaire, comme dans le tableau de bord. Les installations auto-hébergées sans facturation n'ont pas de limites de forfait.
- **Rien de ce que OneUptime garde pour lui.** Ceci est refusé à tout le monde, workflows compris :
  - modifier ou supprimer une entrée de fil d'activité (fils des incidents, des alertes, des épisodes, des moniteurs, des politiques d'astreinte et des maintenances planifiées) ;
  - écrire un journal de notification (journaux des SMS, des appels, des e-mails, de WhatsApp, de Telegram, des notifications push, des webhooks et des messages d'espace de travail) ;
  - les valeurs que OneUptime définit au fil des événements : si le CNAME d'un domaine personnalisé est vérifié, les interrupteurs de protection d'une équipe (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), quel rôle d'incident est le rôle principal et s'il peut être supprimé, si un propriétaire ou un membre a été notifié, les heures et le nombre de rappels, qui est d'astreinte maintenant et ensuite sur un planning, la progression d'une exécution d'astreinte, le taux de consommation et le budget d'erreur actuels d'un SLO, un moniteur mis en pause par un incident ou une maintenance, le jeton de réinitialisation du mot de passe et la dernière connexion d'un utilisateur privé d'une page de statut, les informations qu'un service déclare sur lui-même (version, environnement d'exécution, cloud), et la dernière exécution d'une règle de détection ou d'un flux de menaces ;
  - déclarer un incident à partir d'un modèle en envoyant `createdIncidentTemplateId` à **Create One Incident** — choisissez plutôt le modèle sous le paramètre **Incident Template** de l'étape : l'étape déclare alors l'incident à partir de lui, en tant que Project Admin, et enregistre le modèle ;
  - changer l'enregistrement auquel appartient un enregistrement après sa création, comme le moniteur auquel se rapporte une ligne de propriétaire ou l'incident sur lequel figure une note.
- **Au nom de personne.** Un enregistrement créé par un workflow n'a pas de créateur, et le journal d'audit nomme le workflow, sous son nom du moment, comme auteur de la modification.

Quand une vérification refuse une étape, l'étape prend sa sortie **Error** sans faire la modification refusée, et le journal de l'exécution nomme l'étape et la raison en termes simples, par exemple *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Lisez-le dans les [Exécutions](/docs/workflows/runs-and-logs) du workflow. Une étape Create Many crée ses enregistrements un par un et s'arrête au premier refusé : les enregistrements créés avant celui-là sont conservés.

Les étapes qui dialoguent avec d'autres systèmes — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code et Generate Text with AI — ne lisent ni ne modifient d'enregistrements OneUptime : rien de tout cela ne les concerne.

## Limites du forfait

Sur OneUptime Cloud, les workflows demandent le forfait Growth ou supérieur, et chaque forfait autorise un certain nombre d'exécutions sur 30 jours :

| Forfait    | Exécutions sur les 30 derniers jours |
| ---------- | ------------------------------------ |
| Growth     | 500                                  |
| Scale      | 2 000                                |
| Enterprise | Pas de limite pratique               |

La fenêtre est glissante : chaque exécution enregistrée par le projet, à la main ou depuis un déclencheur, compte pendant 30 jours. Sur les forfaits Growth et Scale, la page **Flux de travail** affiche une carte **Exécutions du flux de travail** avec le nombre d'exécutions utilisées par le projet. Une fois la limite atteinte, les nouvelles exécutions sont enregistrées avec le statut **Execution Exceeded Current Plan** et ne s'exécutent pas, et il en va de même tant que l'abonnement est impayé. Les installations auto-hébergées sans facturation n'ont pas de limite.

## Combien de temps peut durer une exécution

| Limite                                                       | Par défaut         | Paramètre auto-hébergé          |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Une exécution, depuis son démarrage ou son réveil après un **Sleep** | 2 minutes | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un bloc **Run Custom JavaScript**                            | 5 secondes         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un bloc **Sleep**                                            | 30 jours au plus   | —                               |

Le moteur d'exécution vérifie l'échéance avant et après chaque bloc, et marque une exécution en retard **Timeout** dès que la main lui revient. Il ne peut pas interrompre un bloc en cours de route : les blocs qui attendent le réseau ont donc leurs propres délais : une requête Generate Text with AI abandonne au bout de 60 secondes au plus, et une demande de jeton OAuth 2.0 au bout de 20. Une attente sur un bloc **Sleep** ne compte pas dans la durée d'une exécution : l'exécution est mise de côté et reçoit 2 nouvelles minutes à son réveil.

## Limite d'appels entre workflows

Le composant **Execute Workflow** permet à un workflow d'en démarrer un autre. Pour éviter les boucles où le workflow A démarre B, qui redémarre A, une chaîne de workflows qui se démarrent les uns les autres est refusée quand elle reviendrait vers un workflow qui en fait déjà partie, ou dépasserait 10 workflows de profondeur. Le bloc **Execute Workflow** prend alors sa sortie **Error**, et l'erreur montre la chaîne.

Si vous avez réellement besoin d'une longue chaîne (comme une tâche qui traite un élément par exécution), il est en général plus simple de boucler dans un seul workflow avec **Run Custom JavaScript**.

## Quand un workflow n'est pas le bon outil

Quelques cas où il vaut mieux choisir autre chose :

- **Calculs lourds ou gros volumes de données** — les workflows sont conçus pour un travail de liaison léger, pas pour le calcul intensif. Exécutez les traitements lourds dans votre propre infrastructure et laissez un workflow les lancer.
- **Calcul actif de longue durée** — une exécution dispose de 2 minutes par défaut. Pour un délai passif comme « faire A, attendre deux heures, faire B », utilisez le composant **Sleep** ; il met l'exécution de côté et la reprend plus tard sans occuper de worker.
- **Réponse aux incidents étape par étape avec des personnes dans la boucle** — c'est le rôle des [Runbooks](/docs/runbooks/index). Les workflows servent à l'automatisation sans surveillance.

## Étapes suivantes

:::cards
- [Présentation des workflows](/docs/workflows/index): La vue d'ensemble, et un premier workflow de bout en bout.
- [Composants](/docs/workflows/components): Ce dont chaque bloc a besoin, ce qu'il renvoie et ce qu'il peut atteindre.
- [Runbooks](/docs/runbooks/index): Quand des personnes doivent prendre les décisions en cours de route.
:::
