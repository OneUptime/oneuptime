# Configuration et sécurité

Cette page couvre les paramètres et les limites de sécurité qu'il convient de connaître avant de pointer un workflow vers du trafic réel.

## Activer ou désactiver un workflow

Chaque workflow possède un interrupteur **Activé** dans **Paramètres**. Lorsqu'il est désactivé, le workflow ne s'exécute pas — les appels webhook, les horaires planifiés et les événements OneUptime sont tous ignorés. Les nouveaux workflows démarrent désactivés.

Utilisez cet interrupteur comme votre porte « prêt à partir » :

1. Construisez le workflow.
2. Cliquez sur **Run Workflow** sur le **Builder** avec des valeurs réalistes.
3. Vérifiez les **Logs** — assurez-vous que chaque bloc a pris le chemin attendu.
4. Basculez **Activé** sur oui.

Désactiver un workflow n'arrête pas les exécutions déjà en cours ; cela empêche simplement de nouvelles exécutions de démarrer.

## Propriétaires et étiquettes

- **Owners** — les utilisateurs et équipes listés comme propriétaires obtiennent l'accès au workflow et peuvent choisir de recevoir des notifications lorsqu'il échoue. Définissez-les sous **Settings → Owners**.
- **Labels** — des étiquettes pour regrouper les workflows. La liste des workflows vous permet de filtrer par étiquette, ce qui facilite grandement la navigation dans un projet chargé. Pratique lorsque vous avez des workflows organisés par équipe, par intégration ou par environnement.
- **Label rules** — sous **Workflows → Settings → Label Rules**, appliquez automatiquement des étiquettes aux nouveaux workflows selon des motifs dans le nom ou la description.
- **Owner rules** — sous **Workflows → Settings → Owner Rules**, attribuez automatiquement des propriétaires aux nouveaux workflows.

## Secrets

Marquez une variable globale comme **secret** si elle contient quelque chose de sensible. La valeur est masquée lors des lectures normales via l'API et l'interface après son enregistrement, et la journalisation du workflow supprime la valeur résolue avant que le journal d'exécution ne soit persisté.

Utilisez des variables secrètes pour :

- Les clés d'API des services externes.
- Les jetons d'authentification.
- Les clés de signature de webhook.
- Tout ce que vous ne voudriez pas qu'une personne avec un accès en lecture seule puisse voir.

Ne collez pas un secret directement dans un bloc — des valeurs comme `Authorization: Bearer eyJh...` finissent visibles dans le workflow et dans les journaux. Utilisez plutôt `{{global.variables.MY_SECRET}}`.

## Exporter et importer des workflows

Vous pouvez déplacer un workflow entre projets, ou entre une installation auto-hébergée et OneUptime Cloud, sous forme de fichier JSON.

- **Export** — ouvrez le workflow et utilisez **Export Workflow** sous **Settings**. Depuis la liste des workflows, vous pouvez aussi en sélectionner plusieurs et les exporter dans un seul fichier.
- **Import** — sur la liste **Workflows**, cliquez sur **Import JSON** et choisissez un fichier exporté depuis n'importe quel projet OneUptime.

Le fichier contient le nom du workflow, sa description, son état d'activation et son graphe. Il ne contient volontairement pas :

- **La clé secrète du webhook.** Une nouvelle est générée à la création du workflow, donc un workflow importé a une URL de webhook différente. Tout ce qui appelle l'original doit être repointé.
- **Les variables globales.** Un bloc qui lit `{{global.variables.MY_SECRET}}` conserve cette référence, mais la valeur ne se trouve pas dans le fichier. Créez les variables dans le projet de destination avant d'exécuter le workflow importé.
- **Les propriétaires et les étiquettes.** Les règles d'étiquettes et de propriétaires de votre propre projet s'appliquent au workflow importé, exactement comme si vous l'aviez créé à la main.

Un workflow importé est toujours créé **désactivé**, même s'il était activé là d'où il a été exporté — son graphe peut pointer vers des moniteurs, des politiques d'astreinte ou d'autres workflows qui n'existent pas dans le projet de destination. Passez-le en revue, activez-le, testez-le avec **Run Workflow**, puis laissez-le activé. Dupliquer un workflow se comporte de la même façon, de sorte qu'une copie ne se met jamais à se déclencher en même temps que l'original avant que vous ne l'ayez modifiée.

Comme le graphe voyage tel quel, tout ce qui est saisi directement dans un bloc voyage avec lui. C'est la raison pratique de garder les identifiants dans des variables secrètes : exporter un workflow avec un jeton codé en dur remet ce jeton à quiconque reçoit le fichier.

## Durée maximale d'une exécution

Chaque tentative d'exécution a une échéance en temps réel. Le moteur d'exécution la vérifie avant et après chaque composant et marque une exécution en retard comme **Timeout** dès que le contrôle lui revient. Les composants qui effectuent des opérations réseau ou de script ont aussi besoin de leurs propres délais, car le moteur d'exécution ne peut pas interrompre de force du code de composant arbitraire.

Le composant IA dérive le délai de sa requête au fournisseur à partir du temps restant du workflow, avec un plafond de 60 secondes, en laissant une petite marge pour la journalisation et le nettoyage.

## Limite sur l'appel d'autres workflows

Le composant **Execute Workflow** permet à un workflow d'en appeler un autre. Pour éviter les boucles accidentelles où le workflow A appelle B qui appelle à nouveau A, il existe un plafond sur la profondeur de la chaîne. Une exécution qui dépasse la limite se termine par une erreur explicite.

Si vous avez un réel besoin d'une longue chaîne (comme une tâche qui traite un élément par exécution), il est généralement plus simple de boucler à l'intérieur d'un seul workflow à l'aide de **Custom Code**.

## Sécurité des webhooks

Les déclencheurs Webhook vous donnent une URL unique. Quiconque connaît l'URL peut y accéder. Pour vous protéger des appelants accidentels ou indésirables :

- Traitez l'URL comme un mot de passe. Ne la partagez pas publiquement et ne la validez pas dans un dépôt public.
- Pour les workflows sensibles, demandez au système appelant d'envoyer un jeton partagé en en-tête (comme `X-Webhook-Token`) et vérifiez-le avec un bloc **Conditions** avant de faire quoi que ce soit d'important. Enregistrez le jeton attendu comme variable secrète.
- Pour les workflows très sensibles, préférez un déclencheur d'événement OneUptime et une étape d'import manuelle plutôt qu'un webhook public.

## Accès réseau sortant

Les blocs API et autres blocs HTTP effectuent leurs requêtes depuis OneUptime. Si vous êtes auto-hébergé, assurez-vous que votre installation peut atteindre les services que vous appelez. Si vous utilisez OneUptime Cloud, nos plages d'IP sortantes sont listées dans [Adresses IP](/docs/configuration/ip-addresses) afin que vous puissiez les autoriser de l'autre côté.

## Composants IA

**Generate Text with AI** envoie une requête via la passerelle LLM configurée de OneUptime. Il utilise le fournisseur LLM par défaut du projet, ou le fournisseur global de l'installation lorsque le projet n'en a pas. Configurez les fournisseurs sous **Project Settings → AI → LLM Providers** ; ne mettez jamais une clé d'API de fournisseur ou un point de terminaison de modèle arbitraire directement dans le workflow.

Le composant IA a une frontière de sortie de données explicite :

- OneUptime envoie une instruction de sécurité de composant fixe, plus les **System Instructions**, **Prompt** et **Context** sérialisé résolus, au fournisseur configuré. Le Context est ajouté après un marqueur explicite à la fin du message utilisateur ; l'instruction fixe précise que tout ce qui suit ce marqueur reste une donnée non fiable, même si elle contient des balises ou des instructions.
- Il ne joint pas automatiquement la charge utile du déclencheur, l'historique du workflow, les sorties d'autres composants, les enregistrements du projet, la télémétrie ou les secrets. Les données ne sortent que si vous les référencez dans l'une de ces trois entrées.
- Il n'envoie aucune définition d'outil ni aucun champ de capacité natif du fournisseur. Le modèle ne peut pas interroger OneUptime, effectuer des requêtes HTTP ni modifier les données du projet via ce composant. Le fournisseur/modèle configuré reste une frontière de confiance administrateur, donc les installations qui exigent une génération strictement hors ligne doivent choisir un modèle sans récupération intrinsèque gérée par le fournisseur.
- Les paramètres supplémentaires au niveau du fournisseur sont limités à une liste blanche de champs de réglage propres à la génération. Ils ne peuvent pas remplacer les messages du workflow, ajouter des outils ou des sources de recherche web/données natives du fournisseur, activer des modalités non textuelles, demander plusieurs choix, activer le streaming, conserver la requête via des indicateurs de stockage du fournisseur, ou relever le plafond de jetons de sortie de ce composant. Les futurs champs de capacité inconnus sont ignorés par défaut.
- Les valeurs **System Instructions**, **Prompt**, **Context** et **Response** générées sont masquées dans les propres entrées d'arguments et de valeur de retour de ce composant IA dans le journal d'exécution automatique du workflow. Elles restent disponibles pour les composants en aval pendant l'exécution du run. Si vous les insérez dans un autre composant, la politique de journalisation de ce composant s'applique et peut enregistrer la valeur résolue ; traitez cette réutilisation comme une divulgation explicite. Les noms de fournisseur/modèle, les comptes de jetons, l'identifiant du journal LLM et les messages d'erreur sûrs restent visibles pour les opérations et la facturation. Les corps d'erreur bruts du fournisseur sont exclus des journaux de workflow, des journaux LLM, des journaux applicatifs et des traces, car un fournisseur peut renvoyer en écho le contenu de la requête.

Traitez chaque variable référencée comme une donnée que vous envoyez intentionnellement au fournisseur. En particulier, n'insérez pas une variable globale secrète dans le prompt ou le context sauf si cette divulgation est nécessaire et que le fournisseur est approuvé pour la recevoir. Un fournisseur local auto-hébergé comme Ollama peut garder la requête à l'intérieur de votre propre infrastructure ; un fournisseur hébergé reçoit la requête selon les conditions de traitement des données de ce fournisseur.

Chaque appel est enregistré dans **Project Settings → AI → AI Logs**, avec le fournisseur, le modèle, le statut, les jetons, le coût et les informations de facturation. Les aperçus de prompt et de réponse ainsi que les détails d'erreur bruts du fournisseur ne sont pas stockés dans le journal IA. Les appels via un fournisseur global payant consomment le solde de crédit IA du projet. L'IA du workflow compte aussi dans le budget quotidien de jetons IA autonomes du projet ; quand le budget est épuisé, le composant prend sa branche **Error** sans contacter le modèle. L'IA du projet doit être activée. Sur OneUptime Cloud, l'abonnement doit être payant et le plan Growth (ou un plan incluant les fonctionnalités Growth) est requis ; les installations auto-hébergées avec la facturation désactivée n'ont pas cette restriction de plan.

Des limites intégrées gardent les appels sans surveillance finis : **System Instructions**, **Prompt** et **Context** sérialisé sont plafonnés à 50 000 caractères combinés ; **Temperature** doit être compris entre `0` et `1` ; **Maximum Output Tokens** doit être compris entre `1` et `4096` (par défaut `1024`) ; et la requête au fournisseur n'est tentée qu'une seule fois et expire après 60 secondes maximum. Au maximum trois appels IA de workflow s'exécutent simultanément par projet ; les appels supplémentaires prennent la branche **Error** et peuvent être retentés par une exécution de workflow ultérieure. Les échecs de validation, de configuration, d'accès, de budget, de solde, de concurrence, de fournisseur et de délai prennent tous la branche **Error** et remplissent la sortie **Error**. Connectez cette branche avant d'activer un workflow en production.

## Permissions

Les workflows respectent le contrôle d'accès basé sur les rôles de votre projet. Les permissions concernées :

- **Create / Read / Edit / Delete Workflow** — les permissions de base sur le workflow lui-même.
- **Run Workflow** — nécessaire pour exécuter un workflow à la main ou en déclencher un via l'API.
- **Read Workflow Log** — nécessaire pour consulter les exécutions.
- **Read / Create / Edit / Delete Workflow Variable** — le contrôle sur la liste des variables globales.

La plupart des ingénieurs devraient avoir les droits de création/modification/lecture sur les workflows, mais pas sur les variables. Réservez l'accès en modification des variables aux personnes qui gèrent les secrets de votre projet.

## Limites de plan

OneUptime Cloud plafonne le nombre d'exécutions par mois sur les plans les plus petits. Votre limite actuelle est affichée sous **Project Settings → Billing**. Une fois atteinte, les nouveaux déclenchements sont rejetés jusqu'au prochain cycle de facturation. Les installations auto-hébergées n'ont pas cette limite.

## Quand les workflows ne sont pas le bon outil

Quelques cas où vous devriez vous tourner vers autre chose :

- **Calcul lourd ou grands jeux de données** — les workflows sont conçus pour du travail de liaison léger, pas pour du calcul intensif. Exécutez le travail lourd sur votre propre infrastructure et laissez un workflow le déclencher.
- **Calcul actif de longue durée** — une seule tentative d'exécution est censée se terminer rapidement. Pour un délai passif comme « fais A, attends deux heures, fais B », utilisez le composant **Sleep** ; il persiste l'exécution et la reprend plus tard sans occuper un worker.
- **Réponse aux incidents étape par étape avec des humains dans la boucle** — c'est à cela que servent les [Runbooks](/docs/runbooks/index). Les workflows sont faits pour l'automatisation sans surveillance.

## Où lire ensuite

- [Présentation des workflows](/docs/workflows/index) — la vue d'ensemble.
- [Composants de workflow](/docs/workflows/components) — référence bloc par bloc.
- [Runbooks](/docs/runbooks/index) — quand utiliser un runbook à la place.
