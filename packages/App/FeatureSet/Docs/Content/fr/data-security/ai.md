# OneUptime AI dans Sécurité des données

OneUptime AI travaille sur ce que Sécurité des données a trouvé sans voir vos données. Il reçoit des noms, des formes, des décomptes et de la configuration, jamais une valeur de vos données, un échantillon masqué, un enregistrement ou une chaîne de connexion. Chaque fonctionnalité s'exécute sur le modèle propre à votre projet, y compris un modèle auto-hébergé, et chaque page, contrôle, analyse et intégration de Sécurité des données fonctionne avec l'IA désactivée.

:::cards
- [De lui-même](#de-lui-même): Ce qu'il fait de chaque nouveau problème, ce qui vous attend, et les règles IA.
- [Ce que voit OneUptime AI](#ce-que-voit-oneuptime-ai): Ce que chaque fonctionnalité envoie, et ce qu'elle n'envoie jamais.
- [Voyez par vous-même](#voyez-par-vous-même): L'entrée exacte qu'enverrait l'un de vos problèmes.
- [Votre propre modèle](#votre-propre-modèle): Chaque fonctionnalité sur le fournisseur de votre projet, Ollama, vLLM ou tout endpoint compatible OpenAI.
- [Comment c'est mesuré](#comment-cest-mesuré): Chaque fonctionnalité sur des cas fixes, avant chaque version.
:::

## De lui-même

Avec **Travailler sur les nouveaux problèmes** activé sous **Sécurité des données → IA**, comme pour les nouveaux projets, OneUptime AI travaille de lui-même sur chaque nouveau problème critique ou élevé. Il rédige l'analyse de chacun de ces problèmes, et de chacun de ceux qui se rouvrent, comme le fait **Analyser le problème** et à partir de ce que cela envoie, avant que quiconque ne l'ouvre, et ne la rédige à nouveau que si ce sur quoi elle repose a changé. Pour un problème de télémétrie, il masque de lui-même un secret dans la nouvelle télémétrie, là où la règle est prouvée sur les enregistrements où le secret a été vu et où rien ne lit ce qu'elle masque, et propose les règles de nettoyage pour le reste (voir [Confiné de lui-même](/docs/data-security/telemetry#confiné-de-lui-même)). Une proposition attend sur cette page sous **En attente de votre part**, les plus risquées d'abord, avec ce qui va changer, pourquoi, comment ce sera prouvé et comment l'annuler. **Approuver** fait la modification avec vos propres autorisations : une règle de nettoyage demande l'autorisation de créer des règles de nettoyage de journaux, des règles de nettoyage de traces ou des règles de pipeline de métriques. **Ignorer la proposition** dit non, avec une raison ajoutée à la chronologie du problème. Le contrôle propre au problème décide si une modification a fonctionné : le magasin de données est contrôlé à nouveau, et le problème est résolu quand il ne reste plus aucune de ses données.

OneUptime AI propose aussi des propriétaires pour les magasins de données qui n'en ont pas, à partir de ce qui les désigne déjà : les balises cloud du magasin, les services qui l'utilisent et leurs propriétaires, les propriétaires du code du fichier qui le déclare, qui l'a modifié d'après le journal des modifications du cloud et qui l'a ajouté à OneUptime. Il ne nomme que les équipes et les personnes de votre projet, dit à quel point il est sûr, et dit où les preuves ne concordent pas. La proposition pour un magasin sensible accompagne son problème **Ce magasin de données sensible n'a pas de propriétaire**, et les autres nouveaux magasins reçoivent la leur une fois par jour et quand une connexion cloud est lue pour la première fois. Quand les propriétaires de trois magasins ou plus reposent sur la même étiquette ou le même début de nom, il propose aussi la règle de propriétaire qui garde un propriétaire au prochain magasin semblable, et dit à combien de magasins la règle correspondrait. Ces propositions attendent sous **Propriétaires à examiner**, sur cette page et sur **Magasins de données** : **Approuver** ajoute les propriétaires avec vos propres autorisations, et ils sont prévenus comme tout propriétaire ; **Modifier et approuver** choisit d'abord d'autres propriétaires ; **Annuler** retire exactement les propriétaires ajoutés, et la règle avec eux. Ajouter un propriétaire change qui est prévenu, donc cela attend toujours votre accord, quoi que dise une règle IA.

Par défaut, OneUptime AI demande avant chaque modification, sauf celle qui ne fait que masquer des données, peut être annulée et est prouvée sûre, et il ne supprime jamais de données ni n'alerte personne sans demander. Une modification faite sans demander apparaît sous **Fait par l'IA**, avec **Annuler**. **Pourquoi l'IA n'a pas agi** liste les problèmes qu'il a examinés et laissés tels quels, et pourquoi. Chaque proposition, approbation, refus et annulation figure dans la **Chronologie** du problème et du magasin de données. Avec l'interrupteur désactivé, la Sécurité des données fonctionne comme toujours, et **Analyser le problème** et **Corriger avec l'IA** fonctionnent encore quand vous les utilisez ; avec l'IA désactivée pour le projet, aucun des deux.

Sur la page d'un problème, la carte **OneUptime AI** au-dessus de **Comment corriger** montre l'analyse et ce qui a été proposé pour ce problème, avec les mêmes boutons. La **Vue d'ensemble** de la sécurité des données indique combien de fuites OneUptime AI a confinées cette semaine et combien de propositions vous attendent. Ce qu'il est ressorti de ses modifications est compté semaine par semaine dans **Notes pour l'IA de OneUptime** : voir [Comment OneUptime AI s'en sort](/docs/ai/ai-sre#comment-oneuptime-ai-sen-sort).

### Règles IA

Sous **Règles IA** dans **Sécurité des données → IA**, une règle dit sur quels problèmes OneUptime AI travaille - selon leur contrôle ou groupe de contrôles, leur gravité, et la sensibilité, le type, le fournisseur, l'environnement, les étiquettes, les catégories de données et le service du magasin de données - et, pour chaque type de travail, **Analyser**, **Confinement**, **Correction** et **Juger**, s'il est **Désactivé**, **Suggérer** (il propose et vous attend) ou **Automatiquement**. Quand plusieurs règles correspondent à un problème, un type de travail s'exécute si l'une d'elles l'active, et **Suggérer** l'emporte sur **Automatiquement**. Chaque proposition indique la règle qui l'a décidée. **Confinement** sur **Automatiquement** permet aussi à une règle de nettoyage prouvée pour des données personnelles de s'exécuter d'elle-même, pas seulement à celle d'un secret ; une règle qui n'est pas prouvée sûre vous attend toujours, quoi que dise une règle IA. Sans règle, les valeurs par défaut du projet s'appliquent : analyser les problèmes critiques et élevés, et suggérer tout le reste.

Les règles IA appartiennent à tout le projet, comme celles des incidents et des alertes : les Propriétaires du projet et les Administrateurs du projet les modifient, ainsi que toute personne ayant reçu les permissions des règles IA. Les rôles de sécurité voient ce qu'OneUptime AI a proposé et fait, mais pas les règles.

## Ce que voit OneUptime AI

Aucune fonctionnalité n'envoie jamais à un modèle :

- une valeur de vos données ;
- un échantillon masqué, comme `j***@e******.com` : une adresse e-mail masquée porte encore un domaine, et une carte masquée ses quatre derniers chiffres ;
- un enregistrement de votre télémétrie : une ligne de journal, un span ou une session ;
- une chaîne de connexion, une clé ou tout autre secret.

Sécurité des données lit vos données elle-même, dans ses analyses, et n'en conserve rien. Ce qu'elle envoie à OneUptime AI est construit à un seul endroit, à partir d'une liste de ce qui peut être envoyé, et un test échoue dès qu'une fonctionnalité envoie autre chose à un modèle.

| Fonctionnalité | Ce qu'elle envoie | S'exécute seule |
| --- | --- | --- |
| **Analyse à la demande** | Le titre, la gravité et la preuve du problème, pourquoi son contrôle compte et les étapes qui le corrigent ; le nom, le type, la région, les tags et la configuration du magasin, sa sensibilité, les noms de ses types de données et environ combien d'enregistrements il contient ; qui peut atteindre le magasin : l'identité, le niveau et le mode d'octroi de chaque autorisation, et approximativement quand elle a servi pour la dernière fois, et les services vus en train de l'utiliser ; les copies de ses données dans d'autres magasins, ses dossiers de sécurité, l'action de réponse qui corrige le problème, et le dépôt et les fichiers qui le déclarent ; le nombre de propriétaires du magasin, jamais qui ils sont ; pour un problème de télémétrie, l'endroit où chaque type de données a été trouvé : l'attribut, le corps de log ou le prompt où il se trouve | Non : une personne le demande, sur la page d'un problème, ou avec Expliquer avec l'IA via l'API ou le serveur MCP |
| **Analyse des nouveaux problèmes** | Le titre, la gravité et la preuve du problème, pourquoi son contrôle compte et les étapes qui le corrigent ; le nom, le type, la région, les tags et la configuration du magasin, sa sensibilité, les noms de ses types de données et environ combien d'enregistrements il contient ; qui peut atteindre le magasin : l'identité, le niveau et le mode d'octroi de chaque autorisation, et approximativement quand elle a servi pour la dernière fois, et les services vus en train de l'utiliser ; les copies de ses données dans d'autres magasins, ses dossiers de sécurité, l'action de réponse qui corrige le problème, et le dépôt et les fichiers qui le déclarent ; le nombre de propriétaires du magasin, jamais qui ils sont ; pour un problème de télémétrie, l'endroit où chaque type de données a été trouvé : l'attribut, le corps de log ou le prompt où il se trouve | Oui : un problème nouveau ou rouvert de gravité Critique ou Élevée la déclenche, tant que **Travailler sur les nouveaux problèmes** est activé |
| **Corriger avec l'IA** | Le problème tel que son contrôle l'a vu, le nom, le type, la région et l'ID cloud du magasin, et pour un problème de télémétrie l'endroit où ses données ont été trouvées, sous forme de demande à l'agent de code, qui lit ensuite le code du dépôt pour faire la modification | Non : une personne le demande, dans un dépôt qu'elle peut modifier dans **Code** |
| **Suggestions pour les champs qu'aucun détecteur n'a identifiés** | Le type de magasin de données et les types de données que l'IA peut nommer ; le nom de chaque champ, les noms des champs voisins et les formes de ses valeurs, chaque lettre comme `a` ou `A` et chaque chiffre comme `9` ; combien de valeurs ont été lues, et leur longueur | Oui : l'analyse du contenu d'un magasin de données les lance |
| **Demander à l'IA** | Les magasins de données, problèmes et accès que la personne peut lire dans Sécurité des données ; ce qui a été trouvé et où, chaque type de données selon son emplacement, avec des décomptes et la confiance | Non : une personne pose une question |
| **Propriétaires des magasins de données** | Le nom du magasin de données, son type, son fournisseur, son environnement et sa sensibilité, et les noms de ses types de données ; ce qui désigne un propriétaire : ses balises cloud, les services qui l'utilisent, les propriétaires du code du fichier qui le déclare et les modifications qui y ont été faites ; les équipes que les preuves nomment, par leur nom, et les personnes qu'elles nomment, seulement comme candidats numérotés, jamais par leur nom ou leur adresse e-mail | Oui : un magasin sans propriétaire le lance, une fois par jour pour les nouveaux magasins et quand une connexion cloud est lue pour la première fois, tant que **Travailler sur les nouveaux problèmes** est activé |
| **Noms des problèmes d'une même cause** | Ce que partagent les magasins de données du groupe : le module, la stack ou la balise qui les a créés, l'identité qui les a créés, ou leur modèle de nom ; le contrôle qu'ils échouent, le nombre de problèmes du groupe, le type de magasin de données et le code qui les déclare. Jamais le nom de l'un des magasins du groupe | Oui : un groupe de problèmes qu'une même erreur a causés le lance, quand il se forme ou que ce que partagent ses magasins change, tant que **Travailler sur les nouveaux problèmes** est activé |
| **Corriger la cause** | Le contrôle que les problèmes du groupe échouent, ce que partagent leurs magasins de données, et le module ou les fichiers qui les déclarent, sous forme de demande à l'agent de code ; chaque magasin de données que la pull request corrige : son nom, son type, sa région et son ID cloud, ainsi que son problème ; l'agent de code lit ensuite le propre code du dépôt pour faire le changement | Non : une personne le demande, depuis un groupe dans **Problèmes** ou en approuvant la proposition d'OneUptime AI, dans un dépôt qu'elle peut modifier dans **Code** ; ou l'étape **Fix the code with AI** d'un playbook de sécurité. Une règle dont la **Correction** est sur **Automatiquement** l'ouvre d'elle-même |
| **Règles de nettoyage pour ce que « Nettoyer » ne peut pas couvrir** | Le type de données de chaque détection, sa catégorie et s'il est trouvé d'après ses valeurs ou d'après le nom d'un champ ; l'endroit où il se trouve, l'attribut ou le corps de log, et les noms des attributs voisins ; les formes de ses valeurs, comme `AA-9999` pour la valeur `AB-1234`, et combien de valeurs ont été lues | Oui : un problème de télémétrie qu'OneUptime AI confine la lance, pour les données qu'aucune règle « Nettoyer » ne peut masquer, tant que **Travailler sur les nouveaux problèmes** est activé |
| **Données sensibles dans les pull requests** | Ce que les règles ont trouvé dans le diff de la pull request : le fichier et la ligne, le nom écrit, le type de données qu'il désigne et le contrôle qu'il ferait échouer ; le diff de ces fichiers et le titre de la pull request, sans ce qui ressemble à un secret, une adresse e-mail ou une adresse IP ; jamais ce que contient la production : où votre télémétrie a contenu les données, le nom d'un magasin ou ce que contient un magasin, ni un échantillon de ce qui a été trouvé, même masqué | Oui : la [revue de production](/docs/ai/ai-agent#revue-de-production-des-pull-requests) d'une pull request la lance, quand ses règles trouvent des données sensibles dans le changement |

**Expliquer avec l'IA** et **Demander à l'IA** lisent aussi d'abord le [contexte IA](/docs/ai/ai-context) de votre équipe, quand elle en a un : les notes que votre équipe a écrites pour OneUptime AI sur vos systèmes. **Analyse des nouveaux problèmes** le lit aussi.

### Le texte écrit par vos systèmes est une donnée

Le nom d'un magasin de données, son ID dans son cloud, ses étiquettes, les preuves qu'un cloud a renvoyées et la clé d'un attribut viennent de vos clouds et de votre code : quiconque peut nommer un bucket ou étiqueter une ressource écrit donc ce que lit OneUptime AI. OneUptime AI reçoit chaque instruction dans un message à part, et ce texte dans un second message, comme données :

- chaque texte est limité à une longueur et mis sur une seule ligne, et ce qui ressemble à un secret, à une adresse e-mail ou à une adresse IP en est retiré ;
- un texte qui se lit comme des instructions à une IA, par exemple « ignore previous instructions », est signalé, et OneUptime AI a pour consigne de ne jamais le suivre ;
- une réponse structurée, comme celle des suggestions de champs, est lue strictement : l'objet demandé, ou aucune réponse.

### Ce qui est conservé

La ligne de chaque appel dans **Paramètres du projet → IA → Journaux IA** dit quelle fonctionnalité a appelé quel modèle, ses jetons et son coût. Elle ne conserve jamais ce qui a été envoyé ou répondu : les Membres du projet et les Lecteurs lisent les Journaux IA, et les données de Sécurité des données sont réservées à leurs propriétaires et aux rôles de sécurité. La télémétrie propre de OneUptime n'enregistre jamais non plus ce qu'Expliquer avec l'IA ou les suggestions de champs ont envoyé, même là où l'opérateur du serveur enregistre ce qu'envoient les autres appels d'IA. L'analyse elle-même est conservée sur son problème, pour quiconque peut lire le problème, et une ligne qui repose sur quelque chose qu'un lecteur ne peut pas lire lui est masquée.

Quand un appel échoue, Expliquer avec l'IA et les suggestions de champs ne gardent pas un mot de l'erreur du fournisseur, qui peut citer ce qui a été envoyé. L'agent de code derrière Corriger avec l'IA et Corriger la cause, ainsi que le chat de Demander à l'IA, gardent encore l'erreur du fournisseur d'un appel échoué dans sa ligne.

Les propositions de propriétaires gardent la même chose qu'Expliquer avec l'IA : les lignes de leurs appels nomment la fonctionnalité, le modèle, les jetons et le coût, jamais ce qui a été envoyé ou répondu, et aucun mot de l'erreur d'un appel échoué. Il en va de même pour les règles de nettoyage qu'écrit OneUptime AI, et chaque règle qu'il a écrite est exécutée sur les enregistrements où les données ont été vues avant d'être proposée ou créée. Les lectures des données sensibles d'une pull request conservent la même chose, et leurs points sont conservés sur sa revue de production, dans Code et dans son commentaire.

## Voyez par vous-même

**Sécurité des données → Paramètres → OneUptime AI** montre tout cela pour votre projet :

- **Ce que voit OneUptime AI** : chaque fonctionnalité, ce qu'elle envoie et n'envoie jamais, ce qui la lance, le modèle sur lequel elle s'exécute et ce qui en est conservé. Le modèle est nommé à quiconque peut lire les fournisseurs LLM du projet.
- **Afficher un exemple** : l'entrée exacte qu'**Expliquer avec l'IA** enverrait pour votre problème ouvert le plus risqué, telle qu'elle l'enverrait, avec ce que **Corriger avec l'IA** demanderait. Le contexte IA de votre projet, qui vient en premier, est montré par sa longueur. Il ne montre qu'un problème que vous pouvez lire.

**Paramètres du projet → IA → Fournisseurs LLM** y renvoie, pour qui choisit le modèle.

## Votre propre modèle

Chaque fonctionnalité IA de Sécurité des données s'exécute sur le modèle choisi par votre projet :

- **Expliquer avec l'IA** et les suggestions de champs s'exécutent sur le fournisseur qu'une règle IA choisit pour le travail, sinon sur le fournisseur LLM par défaut de votre projet, sinon sur celui du serveur.
- L'agent de code de **Corriger avec l'IA** s'exécute sur le fournisseur qu'une règle IA choisit, sinon sur l'un des fournisseurs de votre projet, sinon sur celui du serveur.
- **Demander à l'IA** s'exécute sur le fournisseur choisi dans le chat, sinon sur celui par défaut de votre projet.
- La lecture des données sensibles d'une pull request s'exécute sur le fournisseur que le dépôt choisit pour ses revues de production, sinon sur le fournisseur LLM par défaut de votre projet, sinon sur celui du serveur.

Un modèle auto-hébergé les exécute toutes : Ollama, vLLM ou tout endpoint compatible OpenAI que vous ajoutez sous **Paramètres du projet → IA → Fournisseurs LLM**. Sur un serveur isolé du réseau, le vLLM fourni avec le chart Helm est le fournisseur propre du serveur, et rien ne quitte donc le serveur.

### Avec l'IA désactivée

Avec **Activer l'IA** désactivé dans **Paramètres du projet → IA → Fonctionnalités IA**, OneUptime AI n'envoie rien, et Sécurité des données continue de fonctionner comme avant : chaque page, contrôle, analyse et intégration. Aucun bouton d'IA n'apparaît sur un problème, et aucun champ n'est soumis à l'IA après une analyse.

## Comment c'est mesuré

Chaque fonctionnalité IA de Sécurité des données est mesurée sur un ensemble fixe de cas inventés, construits comme la fonctionnalité construit son entrée et notés sur ce que dit une bonne réponse : une explication qui nomme la correction et ne répète rien de ce que le nom d'un magasin de données lui demandait de dire, le bon type de données pour chaque champ, une correction qui change ce dont le contrôle a besoin et rien d'autre, et une réponse tirée de ce que Demander à l'IA a lu. Les cas s'exécutent contre un modèle épinglé chaque nuit, à chaque modification d'un prompt IA de Sécurité des données et avant chaque version, qui exige que chaque fonctionnalité atteigne son seuil.

Les propositions de propriétaires sont notées sur le fait de nommer le propriétaire que désignent les preuves, de ne choisir personne quand elles ne désignent personne, et de ne pas être sûres là où les preuves ne concordent pas. Les règles de nettoyage sont exécutées sur des valeurs inventées de chaque emplacement, que le modèle ne voit jamais, et notées sur le fait de masquer chaque valeur qui contient les données et aucune des autres, et de n'écrire aucune règle pour un emplacement pour lequel aucune règle ne convient. Les lectures de pull requests sont notées sur le fait de garder chaque point qui est une fuite, d'écarter ce qui n'en est pas une, et d'écrire une correction qui dit quoi changer.

Pour mesurer votre propre modèle sur les mêmes cas, lancez l'évaluation depuis une copie de travail de OneUptime, avec la clé de votre modèle, s'il en a besoin, dans `AI_EVAL_LLM_API_KEY` :

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

Dans votre projet, **Verdicts confirmés** dans **Paramètres du projet → IA → Résultats IA** compte combien de fois ce que les personnes ont décidé d'un problème analysé par OneUptime AI a suivi son verdict : corrigé ou accepté quand il disait **Réel**, accepté ou marqué public par conception quand il disait **Probablement voulu**, et marqué comme n'étant pas un problème quand il disait **Probablement une fausse détection**.

## Prochaines étapes

:::cards
- [Intégrations de Sécurité des données](/docs/data-security/integrations): Ce que font Expliquer avec l'IA et Corriger avec l'IA sur un problème.
- [Fournisseurs LLM](/docs/ai/llm-provider): Ajoutez votre propre modèle, y compris un modèle auto-hébergé.
- [Types de données sensibles](/docs/data-security/data-types): Comment les champs qu'aucun détecteur n'a pu classer sont suggérés.
- [Contrôles et problèmes de Sécurité des données](/docs/data-security/checks-and-issues): Ce que signifie chaque problème, et comment le corriger.
:::
