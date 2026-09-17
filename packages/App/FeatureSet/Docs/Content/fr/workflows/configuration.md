# Configuration et sécurité

Cette page couvre les réglages et les limites de sécurité qu'il vaut mieux connaître avant de brancher un workflow sur du trafic réel.

## Activer ou désactiver un workflow

Chaque workflow possède un interrupteur **Activé** dans **Paramètres**. Quand il est sur non, le workflow ne s'exécute pas — appels de webhook, horaires planifiés et événements OneUptime sont tous ignorés. Les nouveaux workflows démarrent désactivés.

Servez-vous de cet interrupteur comme d'un feu vert :

1. Construisez le workflow.
2. Cliquez sur **Exécuter le flux de travail** dans le **Constructeur**, avec des valeurs réalistes.
3. Lisez les **Journaux** — assurez-vous que chaque bloc est parti là où vous l'attendiez.
4. Basculez **Activé** sur oui.

Désactiver un workflow n'interrompt pas les exécutions déjà en cours ; cela empêche seulement les nouvelles de démarrer.

## Propriétaires et étiquettes

- **Propriétaires** — les utilisateurs et les équipes inscrits comme propriétaires ont accès au workflow et peuvent choisir d'être prévenus lorsqu'il échoue. Réglez-les sous **Paramètres → Propriétaires**.
- **Étiquettes** — des marqueurs pour regrouper les workflows. La liste des workflows se filtre par étiquette, ce qui rend un projet chargé bien plus facile à parcourir. Pratique quand vos workflows sont organisés par équipe, par intégration ou par environnement.
- **Règles d'étiquettes** — sous **Flux de travail → Paramètres → Règles d'étiquettes**, appliquez automatiquement des étiquettes aux nouveaux workflows selon des motifs de nom ou de description.
- **Règles de propriétaire** — sous **Flux de travail → Paramètres → Règles de propriétaire**, attribuez automatiquement des propriétaires aux nouveaux workflows.

## Secrets

Marquez une variable globale comme **secret** si elle contient quelque chose de sensible. La valeur est masquée dans les lectures ordinaires de l'API et de l'interface une fois enregistrée, et la journalisation du workflow efface la valeur résolue avant que le journal d'exécution ne soit conservé.

Utilisez des variables secrètes pour :

- Les clés d'API des services extérieurs.
- Les jetons d'authentification.
- Les clés de signature de webhook.
- Tout ce que vous ne voudriez pas montrer à quelqu'un qui n'a qu'un accès en lecture.

Ne collez pas un secret directement dans un bloc — une valeur comme `Authorization: Bearer eyJh...` finit visible dans le workflow et dans les journaux. Utilisez plutôt `{{global.variables.MY_SECRET}}`.

## Exporter et importer des workflows

Vous pouvez déplacer un workflow d'un projet à un autre, ou entre une installation auto-hébergée et OneUptime Cloud, sous forme de fichier JSON.

- **Exporter** — ouvrez le workflow et utilisez **Export Workflow** sous **Paramètres**. Depuis la liste des workflows, vous pouvez aussi en sélectionner plusieurs et les exporter dans un seul fichier.
- **Importer** — sur la liste **Flux de travail**, cliquez sur **Import JSON** et choisissez un fichier exporté depuis n'importe quel projet OneUptime.

Le fichier contient le nom du workflow, sa description, son état d'activation et son graphe. Il ne contient délibérément pas :

- **La clé secrète du webhook.** Une nouvelle est engendrée à la création du workflow : un workflow importé a donc une URL de webhook différente. Tout ce qui appelait l'original doit être repointé.
- **Les variables globales.** Un bloc qui lit `{{global.variables.MY_SECRET}}` conserve cette référence, mais la valeur n'est pas dans le fichier. Créez les variables dans le projet de destination avant d'exécuter le workflow importé.
- **Les propriétaires et les étiquettes.** Les règles d'étiquettes et de propriétaire de votre propre projet s'appliquent au workflow importé, exactement comme si vous l'aviez créé à la main.

Un workflow importé est toujours créé **désactivé**, même s'il était activé là d'où il vient — son graphe peut pointer vers des moniteurs, des politiques d'astreinte ou d'autres workflows qui n'existent pas dans le projet de destination. Relisez-le, activez-le, testez-le avec **Exécuter le flux de travail**, et alors seulement laissez-le en marche. Dupliquer un workflow se comporte de la même façon : une copie ne se met donc jamais à se déclencher aux côtés de l'original avant que vous ne l'ayez retouchée.

Parce que le graphe voyage tel quel, tout ce qui a été tapé directement dans un bloc voyage avec lui. C'est la raison très concrète de garder vos identifiants dans des variables secrètes : exporter un workflow contenant un jeton en dur remet ce jeton à quiconque reçoit le fichier.

## Combien de temps peut durer une exécution

Chaque tentative d'exécution a une échéance en temps réel. Le runner la vérifie avant et après chaque composant, et marque **Timeout** une exécution en retard dès que la main lui revient. Les composants qui font du réseau ou exécutent du script ont besoin de leurs propres délais, car le runner ne peut pas interrompre de force le code arbitraire d'un composant.

Le composant IA déduit le délai de sa requête au fournisseur du temps de workflow restant, et le plafonne à 60 secondes en gardant une petite marge pour la journalisation et le nettoyage.

## Limite d'appels entre workflows

Le composant **Execute Workflow** permet à un workflow d'en appeler un autre. Pour éviter les boucles accidentelles où A appelle B qui rappelle A, la profondeur de la chaîne est plafonnée. Une exécution qui dépasse la limite se termine sur une erreur explicite.

Si vous avez réellement besoin d'une longue chaîne (par exemple un traitement d'un élément par exécution), il est en général plus simple de boucler à l'intérieur d'un seul workflow avec **Custom Code**.

## Sécurité des webhooks

Les déclencheurs webhook vous donnent une URL unique. Quiconque connaît cette URL peut l'appeler. Pour vous prémunir des appelants accidentels ou indésirables :

- Traitez l'URL comme un mot de passe. Ne la partagez pas publiquement, ne la committez pas dans un dépôt public.
- Pour les workflows sensibles, demandez au système appelant d'envoyer un jeton partagé en en-tête (du genre `X-Webhook-Token`) et vérifiez-le avec un bloc **Conditions** avant de faire quoi que ce soit d'important. Enregistrez le jeton attendu comme variable secrète.
- Pour les workflows très sensibles, préférez un déclencheur d'événement OneUptime et une étape d'import manuelle à un webhook public.

## Accès réseau sortant

Les blocs API et les autres blocs HTTP émettent leurs requêtes depuis OneUptime. Si vous êtes auto-hébergé, assurez-vous que votre installation peut atteindre les services que vous appelez. Si vous utilisez OneUptime Cloud, nos plages d'IP sortantes sont listées dans [Adresses IP](/docs/configuration/ip-addresses) pour que vous puissiez les autoriser de l'autre côté.

## Composants IA

**Generate Text with AI** envoie une requête unique à travers la passerelle LLM configurée dans OneUptime. Il utilise le fournisseur LLM par défaut du projet, ou le fournisseur global de l'installation quand le projet n'en a pas. Configurez les fournisseurs sous **Paramètres du projet → IA → Fournisseurs LLM** ; ne mettez jamais une clé d'API de fournisseur ni un point de terminaison de modèle arbitraire dans le workflow lui-même.

Le composant IA a une frontière de sortie explicite :

- OneUptime envoie au fournisseur configuré une consigne de sécurité fixe propre au composant, plus les **System Instructions**, le **Prompt** et le **Context** sérialisé une fois résolus. Le contexte est ajouté après un marqueur explicite, à la fin du message utilisateur ; la consigne fixe précise que tout ce qui suit ce marqueur reste une donnée non fiable, même quand cela contient des balises ou des instructions.
- Il n'attache pas automatiquement la charge utile du déclencheur, l'historique du workflow, les sorties des autres composants, les enregistrements du projet, la télémétrie ni les secrets. Une donnée ne sort que si vous la référencez dans l'un de ces trois champs.
- Il n'envoie aucune définition d'outil ni champ de capacité natif du fournisseur. Le modèle ne peut pas interroger OneUptime, émettre des requêtes HTTP ni modifier les données du projet par ce composant. Le fournisseur et le modèle configurés restent une frontière de confiance administrateur : les installations qui exigent une génération strictement hors ligne doivent donc choisir un modèle dépourvu de récupération intrinsèque gérée par le fournisseur.
- Les paramètres supplémentaires du fournisseur sont restreints à une liste blanche de réglages de génération. Ils ne peuvent pas remplacer les messages du workflow, ajouter des outils ou des sources de données et de recherche web natives du fournisseur, activer des modalités autres que le texte, demander plusieurs réponses, activer le streaming, faire conserver la requête via des options de stockage du fournisseur, ni relever le plafond de jetons de sortie de ce composant. Les futurs champs de capacité inconnus sont écartés par défaut.
- Les System Instructions, le Prompt, le Context et la Response générée sont caviardés des entrées d'arguments et de valeurs de retour de ce composant IA dans le journal d'exécution automatique du workflow. Ils restent disponibles pour les composants suivants pendant l'exécution. Si vous en insérez un dans un autre composant, c'est la politique de journalisation de ce composant qui s'applique et elle peut enregistrer la valeur résolue ; considérez cette réutilisation comme une divulgation délibérée. Le nom du fournisseur et du modèle, le décompte de jetons, le LLM Log ID et les messages d'erreur sûrs restent visibles, pour l'exploitation et la facturation. Les corps d'erreur bruts du fournisseur sont exclus des journaux de workflow, des journaux LLM, des journaux applicatifs et des traces, parce qu'un fournisseur peut renvoyer en écho le contenu de la requête.

Considérez chaque variable référencée comme une donnée que vous envoyez délibérément au fournisseur. En particulier, n'insérez pas une variable globale secrète dans le prompt ou le contexte, à moins que cette divulgation ne soit nécessaire et que le fournisseur soit habilité à la recevoir. Un fournisseur local auto-hébergé comme Ollama garde la requête à l'intérieur de votre propre infrastructure ; un fournisseur hébergé, lui, reçoit la requête sous ses propres conditions de traitement des données.

Chaque appel est enregistré dans **Paramètres du projet → IA → Journaux IA**, avec le fournisseur, le modèle, le statut, les jetons, le coût et les informations de facturation. Les aperçus de prompt et de réponse, ainsi que le détail brut des erreurs de fournisseur, n'y sont pas conservés. Les appels passant par un fournisseur global payant consomment le solde de crédits IA du projet. L'IA de workflow compte aussi dans le budget quotidien de jetons IA autonomes du projet ; une fois ce budget épuisé, le composant emprunte son chemin **Erreur** sans contacter le modèle. L'IA du projet doit être activée. Sur OneUptime Cloud, l'abonnement doit être à jour et le plan Growth (ou un plan qui inclut les fonctions Growth) est requis ; les installations auto-hébergées dont la facturation est désactivée n'ont pas ce verrou de plan.

Des bornes intégrées maintiennent finis les appels non surveillés : les System Instructions, le Prompt et le Context sérialisé sont limités à 50 000 caractères au total ; la Temperature doit aller de `0` à `1` ; les Maximum Output Tokens doivent aller de `1` à `4096` (`1024` par défaut) ; et la requête au fournisseur n'est tentée qu'une fois, avec un délai maximal de 60 secondes. Pas plus de trois appels IA de workflow s'exécutent simultanément par projet ; les appels supplémentaires empruntent le chemin **Erreur** et peuvent être retentés par une exécution ultérieure. Les échecs de validation, de configuration, d'accès, de budget, de solde, de concurrence, de fournisseur et de délai empruntent tous le chemin **Erreur** et alimentent la sortie **Erreur**. Reliez ce chemin avant d'activer un workflow en production.

## Autorisations

Les workflows respectent le contrôle d'accès par rôle de votre projet. Les autorisations concernées :

- **Create / Read / Edit / Delete Workflow** — les autorisations de base sur le workflow lui-même.
- **Run Workflow** — nécessaire pour exécuter un workflow à la main ou pour en déclencher un par l'API.
- **Read Workflow Log** — nécessaire pour consulter les exécutions.
- **Read / Create / Edit / Delete Workflow Variable** — le contrôle sur la liste des variables globales.

La plupart de vos ingénieurs devraient avoir la création, la modification et la lecture sur les workflows, mais pas sur les variables. Réservez le droit de modifier les variables aux personnes qui gèrent les secrets de votre projet.

## Limites du forfait

OneUptime Cloud plafonne le nombre d'exécutions par mois sur les petits forfaits. Votre limite actuelle s'affiche sous **Paramètres du projet → Facturation**. Une fois atteinte, les nouveaux déclenchements sont refusés jusqu'au cycle de facturation suivant. Les installations auto-hébergées n'ont pas cette limite.

## Quand un workflow n'est pas le bon outil

Quelques cas où il vaut mieux se tourner vers autre chose :

- **Calculs lourds ou gros volumes de données** — les workflows sont pensés pour de la colle légère, pas pour du calcul intensif. Faites tourner le gros du travail dans votre propre infrastructure et laissez un workflow le lancer.
- **Traitement actif de longue durée** — une tentative d'exécution est censée se terminer vite. Pour une attente passive du type « fais A, patiente deux heures, fais B », utilisez le composant **Sleep** : il conserve l'exécution et la reprend plus tard sans occuper de worker.
- **Réponse à incident pas à pas, avec des humains dans la boucle** — c'est à cela que servent les [Runbooks](/docs/runbooks/index). Les workflows, eux, sont faits pour l'automatisation sans surveillance.

## Où lire ensuite

- [Présentation des workflows](/docs/workflows/index) — la vue d'ensemble.
- [Composants de workflow](/docs/workflows/components) — la référence bloc par bloc.
- [Vue d'ensemble des Runbooks](/docs/runbooks/index) — quand utiliser un runbook à la place.
