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

Avec **Travailler sur les nouveaux problèmes** activé sous **Sécurité des données → IA**, comme pour les nouveaux projets, OneUptime AI travaille de lui-même sur chaque nouveau problème critique ou élevé. Il rédige l'analyse du problème, comme le fait **Expliquer avec l'IA** et à partir de ce qu'elle envoie, et l'ajoute à la **Chronologie** du problème. Pour un problème de télémétrie, il propose les règles de nettoyage qui masquent ses données dans la nouvelle télémétrie. Une proposition attend sur cette page sous **En attente de votre part**, les plus risquées d'abord, avec ce qui va changer, pourquoi, comment ce sera prouvé et comment l'annuler. **Approuver** fait la modification avec vos propres autorisations : une règle de nettoyage demande l'autorisation de créer des règles de nettoyage de journaux, des règles de nettoyage de traces ou des règles de pipeline de métriques. **Ignorer la proposition** dit non, avec une raison ajoutée à la chronologie du problème. Le contrôle propre au problème décide si une modification a fonctionné : le magasin de données est contrôlé à nouveau, et le problème est résolu quand il ne reste plus aucune de ses données.

Par défaut, OneUptime AI demande avant chaque modification, sauf celle qui ne fait que masquer des données, peut être annulée et est prouvée sûre, et il ne supprime jamais de données ni n'alerte personne sans demander. Une modification faite sans demander apparaît sous **Fait par l'IA**, avec **Annuler**. **Pourquoi l'IA n'a pas agi** liste les problèmes qu'il a examinés et laissés tels quels, et pourquoi. Chaque proposition, approbation, refus et annulation figure dans la **Chronologie** du problème et du magasin de données. Avec l'interrupteur désactivé, ou l'IA désactivée pour le projet, la sécurité des données fonctionne comme toujours, et **Expliquer avec l'IA** et **Corriger avec l'IA** fonctionnent toujours quand vous les utilisez.

Sur la page d'un problème, la carte **OneUptime AI** au-dessus de **Comment corriger** montre l'analyse et ce qui a été proposé pour ce problème, avec les mêmes boutons. La **Vue d'ensemble** de la sécurité des données indique combien de fuites OneUptime AI a confinées cette semaine et combien de propositions vous attendent. Ce qu'il est ressorti de ses modifications est compté semaine par semaine dans **Notes pour l'IA de OneUptime** : voir [Comment OneUptime AI s'en sort](/docs/ai/ai-sre#comment-oneuptime-ai-sen-sort).

### Règles IA

Sous **Règles IA** dans **Sécurité des données → IA**, une règle dit sur quels problèmes OneUptime AI travaille - selon leur contrôle ou groupe de contrôles, leur gravité, et la sensibilité, le type, le fournisseur, l'environnement, les étiquettes, les catégories de données et le service du magasin de données - et, pour chaque type de travail, **Analyser**, **Confinement**, **Correction** et **Juger**, s'il est **Désactivé**, **Suggérer** (il propose et vous attend) ou **Sans demander**. Quand plusieurs règles correspondent à un problème, un type de travail s'exécute si l'une d'elles l'active, et **Suggérer** l'emporte sur **Sans demander**. Chaque proposition indique la règle qui l'a décidée. Sans règle, les valeurs par défaut du projet s'appliquent : analyser les problèmes critiques et élevés, et suggérer tout le reste.

Les règles IA appartiennent à tout le projet, comme celles des incidents et des alertes : les propriétaires et administrateurs du projet les modifient, ainsi que toute personne ayant reçu les permissions des règles IA. Les rôles de sécurité voient ce qu'OneUptime AI a proposé et fait, mais pas les règles.

## Ce que voit OneUptime AI

Aucune fonctionnalité n'envoie jamais à un modèle :

- une valeur de vos données ;
- un échantillon masqué, comme `j***@e******.com` : une adresse e-mail masquée porte encore un domaine, et une carte masquée ses quatre derniers chiffres ;
- un enregistrement de votre télémétrie : une ligne de journal, un span ou une session ;
- une chaîne de connexion, une clé ou tout autre secret.

Sécurité des données lit vos données elle-même, dans ses analyses, et n'en conserve rien. Ce qu'elle envoie à OneUptime AI est construit à un seul endroit, à partir d'une liste de ce qui peut être envoyé, et un test échoue dès qu'une fonctionnalité envoie autre chose à un modèle.

| Fonctionnalité | Ce qu'elle envoie | S'exécute seule |
| --- | --- | --- |
| **Expliquer avec l'IA** | Le titre, la gravité et les preuves du problème, pourquoi son contrôle compte et la correction pour le cloud du magasin de données ; le nom du magasin de données, son type, sa région et son ID dans son cloud, sa sensibilité et les noms de ses types de données ; pour un problème dans la télémétrie, l'endroit où chaque type de données a été trouvé : l'attribut, le corps du journal ou le prompt qui le contient | Non : une personne la demande, sur la page d'un problème |
| **Analyse des nouveaux problèmes** | Le titre, la gravité et les preuves du problème, pourquoi son contrôle compte et la correction pour le cloud du magasin de données ; le nom du magasin de données, son type, sa région et son ID dans son cloud, sa sensibilité et les noms de ses types de données ; pour un problème dans la télémétrie, l'endroit où chaque type de données a été trouvé : l'attribut, le corps du journal ou le prompt qui le contient | Oui : un nouveau problème critique ou élevé la lance, tant que **Travailler sur les nouveaux problèmes** est activé |
| **Corriger avec l'IA** | Ce qu'envoie Expliquer avec l'IA, sous forme de demande à l'agent de code, qui lit ensuite le code du dépôt lui-même pour effectuer la modification | Non : une personne la demande, dans un dépôt qu'elle peut modifier sous **Code** |
| **Suggestions pour les champs qu'aucun détecteur n'a identifiés** | Le type de magasin de données et les types de données que l'IA peut nommer ; le nom de chaque champ, les noms des champs voisins et les formes de ses valeurs, chaque lettre comme `a` ou `A` et chaque chiffre comme `9` ; combien de valeurs ont été lues, et leur longueur | Oui : l'analyse du contenu d'un magasin de données les lance |
| **Demander à l'IA** | Les magasins de données, problèmes et accès que la personne peut lire dans Sécurité des données ; ce qui a été trouvé et où, chaque type de données selon son emplacement, avec des décomptes et la confiance | Non : une personne pose une question |

**Expliquer avec l'IA** et **Demander à l'IA** lisent aussi d'abord le [contexte IA](/docs/ai/ai-context) de votre équipe, quand elle en a un : les notes que votre équipe a écrites pour OneUptime AI sur vos systèmes. **Analyse des nouveaux problèmes** le lit aussi.

### Le texte écrit par vos systèmes est une donnée

Le nom d'un magasin de données, son ID dans son cloud, ses étiquettes, les preuves qu'un cloud a renvoyées et la clé d'un attribut viennent de vos clouds et de votre code : quiconque peut nommer un bucket ou étiqueter une ressource écrit donc ce que lit OneUptime AI. OneUptime AI reçoit chaque instruction dans un message à part, et ce texte dans un second message, comme données :

- chaque texte est limité à une longueur et mis sur une seule ligne, et ce qui ressemble à un secret, à une adresse e-mail ou à une adresse IP en est retiré ;
- un texte qui se lit comme des instructions à une IA, par exemple « ignore previous instructions », est signalé, et OneUptime AI a pour consigne de ne jamais le suivre ;
- une réponse structurée, comme celle des suggestions de champs, est lue strictement : l'objet demandé, ou aucune réponse.

### Ce qui est conservé

La ligne de chaque appel dans **Paramètres du projet → IA → Journaux IA** dit quelle fonctionnalité a appelé quel modèle, ses jetons et son coût. Elle ne conserve jamais ce qui a été envoyé ou répondu : les Membres du projet et les Lecteurs lisent les Journaux IA, et les données de Sécurité des données sont réservées à leurs propriétaires et aux rôles de sécurité. La télémétrie propre de OneUptime n'enregistre jamais non plus ce qu'Expliquer avec l'IA ou les suggestions de champs ont envoyé, même là où l'opérateur du serveur enregistre ce qu'envoient les autres appels d'IA.

Quand un appel échoue, Expliquer avec l'IA et les suggestions de champs ne gardent pas un mot de l'erreur du fournisseur, qui peut citer ce qui a été envoyé. L'agent de code derrière Corriger avec l'IA et le chat de Demander à l'IA gardent encore l'erreur du fournisseur d'un appel échoué dans sa ligne.

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

Un modèle auto-hébergé les exécute toutes : Ollama, vLLM ou tout endpoint compatible OpenAI que vous ajoutez sous **Paramètres du projet → IA → Fournisseurs LLM**. Sur un serveur isolé du réseau, le vLLM fourni avec le chart Helm est le fournisseur propre du serveur, et rien ne quitte donc le serveur.

### Avec l'IA désactivée

Avec **Activer l'IA** désactivé dans **Paramètres du projet → IA → Fonctionnalités IA**, OneUptime AI n'envoie rien, et Sécurité des données continue de fonctionner comme avant : chaque page, contrôle, analyse et intégration. Aucun bouton d'IA n'apparaît sur un problème, et aucun champ n'est soumis à l'IA après une analyse.

## Comment c'est mesuré

Chaque fonctionnalité IA de Sécurité des données est mesurée sur un ensemble fixe de cas inventés, construits comme la fonctionnalité construit son entrée et notés sur ce que dit une bonne réponse : une explication qui nomme la correction et ne répète rien de ce que le nom d'un magasin de données lui demandait de dire, le bon type de données pour chaque champ, une correction qui change ce dont le contrôle a besoin et rien d'autre, et une réponse tirée de ce que Demander à l'IA a lu. Les cas s'exécutent contre un modèle épinglé chaque nuit, à chaque modification d'un prompt IA de Sécurité des données et avant chaque version, qui exige que chaque fonctionnalité atteigne son seuil.

Pour mesurer votre propre modèle sur les mêmes cas, lancez l'évaluation depuis une copie de travail de OneUptime, avec la clé de votre modèle, s'il en a besoin, dans `AI_EVAL_LLM_API_KEY` :

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Prochaines étapes

:::cards
- [Intégrations de Sécurité des données](/docs/data-security/integrations): Ce que font Expliquer avec l'IA et Corriger avec l'IA sur un problème.
- [Fournisseurs LLM](/docs/ai/llm-provider): Ajoutez votre propre modèle, y compris un modèle auto-hébergé.
- [Types de données sensibles](/docs/data-security/data-types): Comment les champs qu'aucun détecteur n'a pu classer sont suggérés.
- [Contrôles et problèmes de Sécurité des données](/docs/data-security/checks-and-issues): Ce que signifie chaque problème, et comment le corriger.
:::
