# Dossiers de sécurité et playbooks (SOAR)

Événements de sécurité transforme en dossiers ce que trouvent vos règles de détection, votre renseignement sur les menaces et vos produits de sécurité connectés : un dossier pour chaque élément qui mérite d'être examiné, dans lequel sont regroupées toutes les détections qui concernent le même utilisateur, le même hôte ou la même adresse. Les analystes traitent les dossiers dans une file d'attente, et les playbooks y répondent, d'eux-mêmes ou en un clic.

:::cards
- [Origine des dossiers](#origine-des-dossiers): Les règles de détection, le renseignement sur les menaces, les produits connectés et les personnes.
- [Traiter un dossier](#traiter-un-dossier): L'assigner, enquêter sur ses entités, le fermer avec un verdict.
- [Playbooks](#playbooks): Des étapes qui s'exécutent sur un dossier, avec une approbation là où elle compte.
- [La vue d'ensemble](#la-vue-densemble): Ce qui demande une intervention maintenant, et la rapidité de traitement des dossiers.
:::

## Fonctionnement

```mermaid title="D'une détection à un dossier fermé"
flowchart TB
    subgraph sources["Détections"]
        direction LR
        rules["Règles de<br/>détection"] ~~~ intel["Renseignement<br/>sur les menaces"] ~~~ products["Produits<br/>connectés"]
    end
    sources --> group{"Un dossier ouvert sur<br/>la même entité ?"}
    group -->|"Oui"| join["La détection<br/>s'y ajoute"]
    group -->|"Non"| open["Un nouveau<br/>dossier s'ouvre"]
    join --> playbooks["Les playbooks<br/>s'exécutent"]
    open --> playbooks
    playbooks --> work["Un analyste<br/>traite le dossier"]
    work --> close["Fermé avec un verdict"]
```

Ouvrez **Produits → Événements de sécurité → Security Cases**. La file d'attente s'ouvre sur les dossiers ouverts ; **Assigned to Me**, **Unassigned**, **Fermé** et **Tous** sont les autres vues.

## Avant de commencer

Les droits sur les dossiers et les playbooks dépendent des trois rôles de sécurité. Project Owner et Project Admin peuvent tout faire.

| Rôle | Ce qu'il peut faire |
| --- | --- |
| Security Admin | Tout, y compris supprimer des dossiers et configurer des playbooks |
| Security Member | Ouvrir, assigner, modifier et fermer des dossiers, écrire des notes, exécuter des playbooks et approuver ou rejeter leurs étapes |
| Security Viewer | Lire les dossiers, les détections, les notes, les playbooks et leurs exécutions |

Chacune de ces actions peut aussi être accordée isolément, de la création d'un dossier à l'approbation des étapes d'un playbook ; voir [Référence des autorisations](/docs/permissions/reference).

## Origine des dossiers

| Source | Ouvre un dossier quand | Pour la désactiver |
| --- | --- | --- |
| Règles de détection | Une règle correspond | **Open a Case on Match**, à l'étape **Security Cases** de la règle |
| Renseignement sur les menaces | Un événement nomme un indicateur connu | **Open a Case on Match**, à l'étape **Security Cases** du flux |
| Produits connectés | Une alerte propre au produit est importée à un niveau égal ou supérieur au seuil de la connexion | **Open Cases From** réglé sur **Jamais**, à l'étape **Polling** de la connexion |
| Personnes | Quelqu'un en ouvre un depuis **Security Cases**, ou avec **Open Case** dans le panneau d'un événement | Impossible |

Chaque source est activée par défaut. Une connexion ouvre des dossiers pour **High and above**, sauf si vous choisissez un autre niveau ; les alertes de niveau inférieur sont tout de même importées comme événements.

### Comment les détections sont regroupées

Une détection porte sur une entité : la valeur selon laquelle sa règle regroupe, comme l'adresse IP d'une règle de force brute, ou l'indicateur que nomme une correspondance de renseignement sur les menaces. Une détection sans entité reste isolée.

- Quand un dossier ouvert porte déjà sur cette entité, la détection s'y ajoute. Les entités et le mappage ATT&CK du dossier s'enrichissent, et sa priorité monte à celle de la détection, sans jamais baisser.
- Quand aucun dossier ouvert ne porte sur elle, un nouveau dossier s'ouvre, nommé d'après la détection, avec la priorité de la détection.
- Une détection qui se déclenche de nouveau incrémente le compteur de sa ligne au lieu d'en ajouter une nouvelle.

La priorité d'un dossier découle de la gravité de la détection :

| Gravité | Priorité |
| --- | --- |
| Critical ou Fatal | Critical |
| High | High |
| Medium, Unknown ou Other | Medium |
| Low | Low |
| Informational | Informational |

## Traiter un dossier

Un dossier passe par quatre statuts. Il peut en sauter un, comme un faux positif fermé directement depuis Nouveau, et il peut être rouvert.

| Statut | Signification |
| --- | --- |
| Nouveau | Personne ne l'a encore examiné |
| Investigation en cours | Quelqu'un cherche à comprendre ce qui s'est passé |
| Confiné | La menace ne peut plus nuire ; le nettoyage reste à faire |
| Fermé | Terminé, avec un verdict sur ce que c'était |

La page du dossier réunit tout ce qu'il faut pour le traiter :

- En haut : **Assign to Me**, **Run Playbook**, **Déclarer un incident** et **Close Case**, les étapes de statut, et la priorité, dans le menu à côté.
- **Détections** : ce qui s'est déclenché pour ouvrir le dossier ou s'y ajouter, combien de fois, et le dernier événement correspondant.
- **Entités** : les utilisateurs, hôtes et adresses sur lesquels porte le dossier, avec leur activité dans l'ensemble de vos événements de sécurité des 7 derniers jours. Chacun s'ouvre dans **Corréler**.
- **MITRE ATT&CK** : les tactiques et techniques auxquelles se rattachent ses détections, chacune liée à sa page sur attack.mitre.org.
- **Playbook Runs** : ce que chaque playbook a fait sur le dossier, étape par étape, et les étapes en attente d'approbation.
- **Notes** et **Chronologie** : ce que l'équipe a écrit, et tout ce qui s'est passé, avec son auteur.

Pour traiter plusieurs dossiers à la fois, sélectionnez-les dans la file d'attente et utilisez **Assign to Me**, **Change Status** ou **Change Priority**.

### Fermer un dossier

**Close Case** demande un verdict et une note de clôture facultative :

| Verdict | Signification |
| --- | --- |
| Vrai positif | Une activité malveillante ou non autorisée a bien eu lieu |
| Positif bénin | L'activité était réelle mais attendue, comme un test d'intrusion ou une tâche d'administration |
| Faux positif | La détection était erronée : la règle ou les données ont mal interprété une activité normale |
| Indéterminé | Les informations ne suffisaient pas pour trancher |

Les verdicts sont comptabilisés sur la vue d'ensemble. Une règle dont les dossiers se ferment sans cesse en faux positif est une règle à ajuster.

### Déclarer un incident

**Déclarer un incident** ouvre un incident OneUptime pour le dossier, avec la gravité de votre choix, et les relie dans les deux sens : la description de l'incident nomme le dossier, et l'en-tête du dossier renvoie vers l'incident. L'astreinte, les pages de statut et le post-mortem prennent ensuite le relais. Il faut un rôle qui puisse à la fois traiter des dossiers et créer des incidents.

## Playbooks

Un playbook est une liste d'étapes qui s'exécutent sur un dossier. Créez-en un sous **Produits → Événements de sécurité → Playbooks**, à partir d'un modèle ou de zéro, et ajoutez ses étapes sur sa page.

### Quand un playbook s'exécute

| Exécutions | Quand |
| --- | --- |
| Dossier ouvert | Une fois, à l'ouverture d'un dossier |
| Détection ajoutée | Chaque fois qu'une nouvelle détection rejoint un dossier ouvert |
| Manuel | Seulement quand quelqu'un l'exécute depuis un dossier |

Tout playbook activé peut aussi être lancé à la main, avec **Run Playbook** sur un dossier. Un playbook qui s'exécute de lui-même peut être restreint :

- **For Cases At Least** : seulement les dossiers de cette priorité ou d'une priorité supérieure.
- **Only For Detections From** : seulement quand la détection à l'origine du dossier vient de cette source.
- **Only For These Detection Rules** : seulement quand elle vient de l'une de ces règles.

Un playbook désactivé ne s'exécute ni de lui-même ni à la main.

### Étapes

| Catégorie | Étape | Ce qu'elle fait |
| --- | --- | --- |
| Dossier | Assign the case | Confie le dossier à une personne, à une équipe, ou aux deux |
| Dossier | Set the priority | Relève ou abaisse la priorité du dossier |
| Dossier | Set the status | Fait passer le dossier à Investigation en cours, Confiné ou Fermé, avec le verdict de votre choix |
| Dossier | Add a note | Écrit une note sur le dossier, comme une liste de vérification pour l'analyste |
| Dossier | Add labels | Applique des étiquettes au dossier |
| Investigation | Check entities against threat intel | Recherche chaque entité dans votre renseignement sur les menaces, et peut relever la priorité en cas de correspondance |
| Investigation | Look up entity activity | Compte les événements de sécurité de chaque entité sur une fenêtre récente, et consigne le résultat sur le dossier |
| Notification | Email people | Envoie par e-mail à des utilisateurs et des équipes un résumé du dossier, avec un lien vers celui-ci |
| Notification | Post to Slack | Publie un résumé du dossier dans un canal Slack |
| Notification | Post to Microsoft Teams | Publie un résumé du dossier dans un canal Microsoft Teams |
| Escalade | Page on-call | Exécute une politique d'astreinte |
| Escalade | Déclarer un incident | Ouvre un incident OneUptime lié au dossier |
| Confinement | Suspend the user in Okta | Suspend dans Okta chaque utilisateur du dossier |
| Confinement | End the user's Okta sessions | Déconnecte d'Okta chaque utilisateur du dossier et révoque ses jetons |
| Confinement | Contain the host in CrowdStrike | Applique le confinement réseau à chaque hôte du dossier avec CrowdStrike Falcon |
| Confinement | Isolate the device in Microsoft Defender | Isole chaque hôte du dossier avec Microsoft Defender for Endpoint |
| Automatisation | Send a webhook | Envoie le dossier en JSON à une URL |
| Automatisation | Run a workflow | Lance un flux de travail OneUptime avec le dossier en entrée |

Un playbook compte au plus 25 étapes. Elles s'exécutent dans l'ordre, chacune une fois la précédente terminée. Chaque étape peut aussi :

- **Needs Approval** : arrêter l'exécution avant l'étape jusqu'à ce que quelqu'un l'approuve sur le dossier. Ce réglage est activé par défaut pour les quatre étapes de confinement, qui agissent en dehors de OneUptime.
- **Only If Threat Intel Matched** : sauter l'étape, sauf si une étape **Check entities against threat intel** antérieure de la même exécution a trouvé un indicateur connu.
- **Carry On If It Fails** : exécuter l'étape suivante même si celle-ci échoue. Sans ce réglage, une étape en échec arrête l'exécution.

### Confinement

Les étapes de confinement agissent via une [connexion d'événements de sécurité](/docs/telemetry/security-events#connecter-un-produit-de-sécurité) au produit, et cette connexion a besoin de plus qu'un accès en lecture :

| Étape | Connexion | Ce qu'il faut |
| --- | --- | --- |
| Suspend the user in Okta, End the user's Okta sessions | Okta System Log | Un jeton d'API autorisé à gérer les utilisateurs |
| Contain the host in CrowdStrike | CrowdStrike Falcon | Un client API avec le scope Hosts en écriture |
| Isolate the device in Microsoft Defender | Microsoft Defender XDR | Une application avec l'autorisation Machine.Isolate |

Une étape de confinement agit sur au plus 10 des utilisateurs ou hôtes du dossier. Elle retrouve chacun dans le produit par son nom, et indique sur le dossier ce qu'elle a fait de chacun : confiné, déjà confiné, introuvable ou refusé.

### Messages

Une note, un e-mail, une publication Slack et une publication Teams peuvent utiliser les valeurs du dossier :

| Espace réservé | Devient |
| --- | --- |
| `{{case.number}}` | Le numéro du dossier, comme CASE-42 |
| `{{case.title}}` | Le titre du dossier |
| `{{case.priority}}` | Critical, High, Medium, Low ou Informational |
| `{{case.status}}` | New, Investigating, Contained ou Closed |
| `{{case.assignee}}` | La personne à qui le dossier est assigné |
| `{{case.url}}` | Un lien vers le dossier dans OneUptime |
| `{{case.entities}}` | Les utilisateurs, hôtes et adresses sur lesquels porte le dossier |
| `{{case.detections}}` | Le nombre de détections que contient le dossier |

Un e-mail ou une publication sans message propre envoie un résumé du dossier.

### Exécutions et approbations

Chaque exécution est listée, étape par étape, sur son dossier et sous **Produits → Événements de sécurité → Playbook Runs** :

| Statut de l'exécution | Signification |
| --- | --- |
| En file d'attente | En attente d'un worker |
| En cours d'exécution | Exécute ses étapes |
| En attente d'approbation | Retenue avant une étape qui demande une approbation |
| Réussi | Chaque étape s'est exécutée ou a été sautée |
| Échec | Une étape a échoué et l'exécution s'est arrêtée |
| Annulé | Quelqu'un l'a annulée, ou a rejeté une étape |

Une étape en attente d'approbation affiche **Approve** et **Reject** sur l'exécution, avec un commentaire facultatif. Approuver poursuit l'exécution à partir de cette étape ; rejeter y met fin. La décision, son auteur et son commentaire sont conservés sur l'étape et dans la chronologie du dossier. **Playbook Runs** s'ouvre sur les exécutions en attente d'approbation, et son entrée de menu indique leur nombre.

Une exécution dont le worker ne donne plus signe de vie, après un redémarrage par exemple, est reprise : une exécution en file d'attente est remise en file au bout de 2 minutes, et une exécution restée muette pendant 30 minutes passe en échec.

## La vue d'ensemble

Le produit s'ouvre sur **Produits → Événements de sécurité → Vue d'ensemble** :

- Les dossiers ouverts qui vous sont assignés, les dossiers ouverts que personne n'a encore pris en charge, et les étapes de playbook en attente d'approbation.
- **Mean Time to Acknowledge**, **Mean Time to Contain** et **Mean Time to Close**, sur les dossiers ouverts au cours des 30 derniers jours : de l'ouverture d'un dossier à sa prise en charge (assignation à une personne, ou sortie du statut Nouveau), à son passage à Confiné, et à sa fermeture. Un dossier encore en attente n'est pas compté dans une moyenne.
- Les dossiers ouverts chaque jour sur 30 jours, par priorité, et les détections levées chaque jour sur 14 jours, par source.
- Les dossiers ouverts par priorité et par statut, les verdicts des 30 derniers jours, les tactiques ATT&CK à l'origine des dossiers, les détections qui se sont le plus déclenchées, et les entités nommées par le plus de constats.

Un projet qui n'a encore ni dossier ni détection affiche, au-dessus de tout cela, les trois étapes pour le configurer.

## Trouver des menaces

- **Entités** classe les utilisateurs, hôtes, adresses et hachages que vos constats nomment le plus, sur le dernier jour, la dernière semaine ou le dernier mois, et recherche n'importe quelle valeur dans 30 jours d'événements.
- **Rule Library** propose des règles de détection prêtes à l'emploi, pour les menaces visant les identités, les terminaux, le cloud, le réseau, le web et Kubernetes. Chacune est une règle Sigma écrite pour les champs vers lesquels chaque source connectée est normalisée. **Ajouter une règle** la crée comme l'une de vos règles de détection, activée et ouvrant des dossiers plutôt que des alertes ; modifiez-la sous **Règles de détection** comme n'importe quelle autre.
- **ATT&CK Coverage** dessine la matrice MITRE ATT&CK en mettant en évidence les techniques que couvrent vos règles activées, et entoure celles qu'une règle de la bibliothèque couvrirait.

## Automatiser

- **Flux de travail** : un dossier ou une note peut lancer un flux de travail quand il est créé, mis à jour ou supprimé. Une étape **Run a workflow** lance un flux de travail dont le déclencheur est un webhook.
- **API** : les dossiers, les notes, les détections, les playbooks et les exécutions ont la même API REST que le reste de OneUptime, sous `/security-case`, `/security-case-note`, `/security-detection`, `/security-playbook` et `/security-playbook-run`. Voir [Référence de l'API](/docs/api-reference/api-reference).
- Agents IA : le serveur MCP dispose d'outils pour les dossiers, les notes, les détections et les playbooks. Voir [Serveur MCP](/docs/ai/mcp-server).

## Dépannage

:::details Une règle correspond, mais aucun dossier ne s'ouvre
Vérifiez **Open a Case on Match** à l'étape **Security Cases** de la règle. Une détection portant sur une entité qui a déjà un dossier ouvert s'ajoute à ce dossier au lieu d'en ouvrir un autre : cherchez-la sous **Détections** dans le dossier ouvert.
:::

:::details Un playbook ne s'est pas exécuté
Vérifiez qu'il est activé, que son réglage **Déclencheur** convient (avec Dossier ouvert, il ne s'exécute qu'une fois, à l'ouverture d'un dossier), et que le dossier remplit ses conditions **For Cases At Least**, **Only For Detections From** et **Only For These Detection Rules**. Un dossier ouvert à la main n'a pas de détection, donc un playbook limité à une source ou à des règles ne s'exécute pas dessus.
:::

:::details Une étape de confinement a échoué
Ouvrez l'exécution sur le dossier : l'étape indique, pour chaque utilisateur ou hôte, si le produit l'a refusé, ne l'a pas trouvé ou n'a pas pu être joint. Vérifiez que l'identifiant de la connexion a le droit d'effectuer la modification, et utilisez **Tester la connexion** dans sa ligne.
:::

## Étapes suivantes

:::cards
- [Événements de sécurité](/docs/telemetry/security-events): Envoyer des événements, écrire des règles de détection et connecter des produits de sécurité.
- [Renseignement sur les menaces](/docs/telemetry/threat-intelligence): Confronter vos événements à des flux STIX/TAXII.
- [Référence des autorisations](/docs/permissions/reference): Les rôles de sécurité, et ce que chacun peut faire.
:::
