# Budgets d'ingestion

Un budget d'ingestion plafonne la quantité de télémétrie qu'un projet envoie en une journée, pour qu'un service bavard ou une boucle de journaux incontrôlée ne puisse pas remplir votre stockage. L'administrateur de l'instance fixe un budget quotidien pour chaque signal, pour tous les projets ou pour un seul, et quiconque peut modifier une clé d'ingestion peut donner à la clé son propre budget, plus petit. Chaque budget peut aussi avoir une limite de débit par seconde.

:::cards
- [Comment fonctionnent les budgets](#comment-fonctionnent-les-budgets): Trois niveaux, comptés à l'arrivée de la télémétrie.
- [Définir les budgets par défaut de tous les projets](#définir-les-budgets-par-défaut-de-tous-les-projets): Dans les paramètres de l'Admin Dashboard.
- [Donner à une clé d'ingestion son propre budget](#donner-à-une-clé-dingestion-son-propre-budget): Une part du budget du projet.
- [Alerter sur un budget](#alerter-sur-un-budget): Avant qu'il soit épuisé, et quand il l'est.
:::

## Comment fonctionnent les budgets

La télémétrie est comptée à son arrivée : sur le budget de son projet pour son signal, et sur celui de sa clé d'ingestion quand la clé en a un. Dès qu'un budget quotidien est épuisé, ce signal est refusé jusqu'à la réinitialisation du budget.

```mermaid title="Ce que OneUptime vérifie avant de stocker de la télémétrie"
flowchart TB
    request["La télémétrie arrive<br/>avec une clé<br/>d'ingestion"] --> budget{"Budget du jour<br/>épuisé ?"}
    budget -->|"Oui"| refused["Refusée avec 403<br/>jusqu'à la<br/>réinitialisation"]
    budget -->|"Non"| rate{"Plus rapide que la<br/>limite de débit ?"}
    rate -->|"Oui"| throttled["Refusée avec 429 :<br/>l'émetteur réessaie"]
    rate -->|"Non"| counted["Comptée, puis<br/>stockée"]
```

- **Trois niveaux.** La valeur par défaut de l'instance s'applique à chaque projet. L'administrateur de l'instance peut donner à un projet son propre budget à la place, ou aucune limite du tout. Le budget d'une clé ne fait que subdiviser celui de son projet : il peut être plus petit, jamais plus grand.
- **Cinq signaux.** Les journaux, les traces, les métriques, les profils et les événements de sécurité ont chacun leur propre budget. Les relectures de session ont leurs propres limites : voir [Relecture de session](/docs/telemetry/session-replay).
- **Les octets sont comptés décompressés.** Une requête compte la taille de son corps une fois décompressé, donc la compresser ne change pas ce qu'elle compte. Un GB vaut 1024³ octets, et un MB 1024² octets.
- **Ce qui arrive est compté, pas ce qui est stocké.** La télémétrie qu'un [filtre de suppression](/docs/telemetry/drop-filters-and-scrub-rules) retire ensuite compte quand même, donc un budget peut indiquer plus que la page [Utilisation de la télémétrie](/docs/telemetry/usage), qui compte ce qui a été stocké.
- **La dernière requête est stockée en entier.** Une requête qui arrive alors qu'un budget a encore de la place est stockée en totalité, donc un budget épuisé peut indiquer un peu plus de 100 %.
- **Rien n'est limité tant qu'aucun budget n'est défini.** Chaque installation démarre sans budget, et un projet qui n'en a pas n'est pas compté du tout.
- **Les changements atteignent chaque serveur en une minute.**
- **La télémétrie est acceptée quand elle ne peut pas être comptée.** Les budgets sont comptés dans Valkey. Tant que Valkey est injoignable, OneUptime stocke la télémétrie sans la compter plutôt que de la refuser, et les pages des budgets le signalent.

## Avant de commencer

- **Pour les budgets de l'instance et d'un projet, l'Admin Dashboard.** Sur une installation auto-hébergée, seul l'administrateur de l'instance les définit. Les propriétaires et les administrateurs d'un projet voient ses budgets, mais ne peuvent pas les modifier.
- **Pour le budget propre d'une clé, un rôle qui modifie les clés d'ingestion.** Project Owner ou Project Admin, ou un rôle personnalisé avec la permission Edit Ingestion Key.
- **Pour voir les budgets, un rôle qui voit l'utilisation du projet.** Les rôles qui voient la page [Utilisation de la télémétrie](/docs/telemetry/usage) y voient les budgets du projet.

## Définir les budgets par défaut de tous les projets

:::steps
### Ouvrir les budgets d'ingestion

Dans l'Admin Dashboard, allez dans **Paramètres → Télémétrie → Budgets d'ingestion**. **Télémétrie** est replié au départ dans le menu latéral : cliquez dessus pour l'ouvrir.

### Définir les budgets quotidiens

Sur la carte **Budgets quotidiens par défaut**, cliquez sur **Modifier les budgets quotidiens par défaut**, saisissez un nombre de GB pour chaque signal à limiter, par exemple **Journaux (GB par jour)**, et cliquez sur **Enregistrer les modifications**. Laissez un signal vide pour n'avoir aucune limite.

### Définir les limites de débit, si vous en avez besoin

Sur la carte **Limites de débit par défaut**, cliquez sur **Modifier les limites de débit par défaut** et saisissez un nombre de MB par seconde pour un signal, par exemple **Journaux (MB par seconde)**. Une limite de débit empêche une rafale d'épuiser le budget d'une journée en quelques minutes.
:::

La carte **Avertissement et réinitialisation** contient le seuil d'avertissement et l'heure à laquelle la journée de budget est réinitialisée : voir [L'avertissement et la réinitialisation](#lavertissement-et-la-réinitialisation).

## Définir les budgets d'un projet

:::steps
### Ouvrir le projet

Dans l'Admin Dashboard, allez dans **Projets**, cliquez sur le projet, puis sur **Budgets d'ingestion** dans son menu latéral. La page s'ouvre sur ce que le projet a utilisé de ses budgets aujourd'hui.

### Définir ses budgets quotidiens

Sur la carte **Budgets quotidiens de ce projet**, cliquez sur **Modifier les budgets quotidiens**. Saisissez un nombre de GB à la place de la valeur par défaut de l'instance pour un signal, ou 0 pour n'avoir aucune limite. Laissez un signal vide pour garder la valeur par défaut de l'instance.

### Définir ses limites de débit

Sur la carte **Limites de débit de ce projet**, cliquez sur **Modifier les limites de débit** et définissez-les de la même façon : un nombre de MB par seconde, 0 pour aucune limite, ou vide pour la valeur par défaut de l'instance.
:::

Les membres du projet voient ces budgets sur leur page [Utilisation de la télémétrie](/docs/telemetry/usage), en lecture seule.

## Donner à une clé d'ingestion son propre budget

Le budget d'une clé est une part de celui de son projet : un émetteur qui inonde sa propre clé s'arrête au budget de la clé, tandis que les autres clés du projet continuent d'envoyer.

:::steps
### Ouvrir la clé

Allez dans **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** et cliquez sur la clé. **Télémétrie & APM** est replié au départ dans le menu latéral : cliquez dessus pour l'ouvrir.

### Définir ses budgets

Sur la carte **Budgets d'ingestion**, cliquez sur **Modifier les budgets d'ingestion**. Saisissez un nombre de GB par jour pour chaque signal à limiter à l'étape **Budgets quotidiens**, et un nombre de MB par seconde à l'étape **Limites de débit**. Laissez un signal vide pour que la clé n'ait pas de budget propre.

### Enregistrer les budgets

Cliquez sur **Enregistrer les modifications**. Le budget d'une clé ne peut pas dépasser celui de son projet : OneUptime le refuse et indique le maximum possible.
:::

- **Les deux budgets comptent.** La télémétrie envoyée avec la clé est comptée sur le budget de la clé et sur celui du projet, et celui qui est épuisé en premier la refuse.
- **Un budget de projet abaissé s'impose aussi à la clé.** Quand le budget du projet est abaissé sous celui d'une clé, la clé est limitée à celui du projet.

## Ce que voient les émetteurs

| Quand | Sur HTTP | Sur OTLP/gRPC | Ce que fait l'émetteur |
| --- | --- | --- | --- |
| Un budget quotidien est épuisé | `403` | `RESOURCE_EXHAUSTED` | Abandonne le lot : réessayer ne sert à rien avant la réinitialisation |
| Une limite de débit est dépassée | `429` avec `Retry-After` | `RESOURCE_EXHAUSTED` avec un délai avant nouvel essai | Renvoie le lot après le délai |

Chaque refus dit pourquoi. Sur OTLP/HTTP, son corps est un `google.rpc.Status`, en protobuf ou en JSON selon la façon dont la requête a été envoyée, donc le journal de l'émetteur affiche une raison comme :

```text
This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.
```

- **Les autres émetteurs HTTP reçoivent du JSON.** Fluent Bit, Fluentd, Syslog et les autres points de terminaison HTTP reçoivent `error`, `message` et `resetsAt`, ainsi que `retryAfterSeconds` en cas de limite de débit.
- **MQTT et les flux cloud ne peuvent pas être prévenus.** La télémétrie qui arrive par MQTT ou depuis le flux d'un fournisseur cloud est abandonnée dès que son budget est épuisé. Aucune limite de débit ne s'y applique : elle ne pourrait pas être renvoyée.
- **Les refus sont comptés.** Ce qu'un budget épuisé refuse ou abandonne est compté comme abandonné, et chaque requête qu'une limite de débit refuse, comme limitée : voir [Voir l'utilisation et les abandons du jour](#voir-lutilisation-et-les-abandons-du-jour).

## L'avertissement et la réinitialisation

- **L'avertissement.** Quand un budget quotidien dépasse le seuil d'avertissement, 80 % sauf si l'administrateur de l'instance le change, les propriétaires du projet reçoivent un e-mail, et les explorateurs affichent une bannière au-dessus des données de ce signal. Ils reçoivent un e-mail de plus quand le budget est épuisé. Chaque budget envoie chaque e-mail au plus une fois par jour.
- **La réinitialisation.** Chaque journée de budget recommence à 00:00 UTC, sauf si l'administrateur de l'instance le change. La carte **Avertissement et réinitialisation** définit **Seuil d'avertissement (%)**, de 1 à 99, **Heure de réinitialisation**, au format HH:MM, et **Fuseau horaire de réinitialisation** : cliquez sur **Modifier l'avertissement et la réinitialisation**.
- **Heure d'été.** La réinitialisation suit l'horloge du fuseau horaire, donc la journée de budget où l'on change d'heure dure une heure de moins ou de plus. Une heure de réinitialisation que le changement d'heure saute a lieu d'autant après le saut.
- **Une réinitialisation modifiée commence une nouvelle journée.** Changer l'heure de réinitialisation ou le fuseau horaire commence aussitôt une nouvelle journée de budget, où rien n'est encore compté.

## Voir l'utilisation et les abandons du jour

Allez dans **Paramètres du projet → Télémétrie & APM → Utilisation**. Tant qu'un budget ou une limite de débit est défini pour le projet, la page s'ouvre sur la carte **Budgets d'ingestion**, et les clés qui ont leur propre budget sont sur la carte **Budgets des clés d'ingestion** :

| Colonne | Ce qu'elle montre |
| --- | --- |
| **Signal** | Le signal auquel la ligne correspond. |
| **Utilisé aujourd'hui** | Ce qui a été compté depuis le début de la journée de budget, et sa part du budget. |
| **Budget quotidien** | Le budget en vigueur, et où il a été défini : **Valeur par défaut de l'instance**, **Défini pour ce projet** ou **Propre à cette clé**. |
| **Limite de débit** | La limite de débit en vigueur. |
| **Abandonné** | Ce qui a été refusé ou abandonné parce que le budget était épuisé. |
| **Limité** | Combien de requêtes la limite de débit a refusées. |
| **Statut** | **Dans le budget**, **Seuil d'avertissement dépassé** ou **Épuisé**, **Aucun budget quotidien** pour un signal qui n'a qu'une limite de débit, et **Inconnu** tant que les décomptes ne peuvent pas être lus. |

- **Sur la page d'une clé**, la carte **Utilisation du budget aujourd'hui** montre ce que la clé a utilisé de ses propres budgets.
- **Dans les explorateurs**, une bannière au-dessus des données des journaux, des traces, des métriques, des profils et des événements de sécurité indique quand le budget de ce signal a dépassé son seuil d'avertissement ou est épuisé, avec **Voir les budgets** pour ouvrir la page Utilisation.
- **Dans l'Admin Dashboard**, la page **Budgets d'ingestion** d'un projet montre les mêmes chiffres.

## Alerter sur un budget

Toutes les 5 minutes, OneUptime écrit les chiffres du jour de chaque budget sous forme de métriques du projet, et un [moniteur de métriques](/docs/monitor/metrics-monitor) déclenche des alertes dessus comme sur toute autre métrique :

| Métrique | Unité | Ce qu'elle contient |
| --- | --- | --- |
| `oneuptime.telemetry.budget.used.bytes` | `By` | Les octets comptés sur le budget quotidien depuis le début de la journée de budget. |
| `oneuptime.telemetry.budget.used.percent` | `%` | La même chose, en pourcentage du budget quotidien. À partir de 100, le signal est refusé jusqu'à la réinitialisation. |
| `oneuptime.telemetry.budget.dropped.bytes` | `By` | Les octets refusés ou abandonnés depuis le début de la journée de budget parce que le budget était épuisé. |
| `oneuptime.telemetry.budget.throttled.requests` | `{request}` | Les requêtes que la limite de débit a refusées depuis le début de la journée de budget. |

Chaque point porte ces attributs :

| Attribut | Valeur |
| --- | --- |
| `projectId` | L'ID du projet. |
| `signal` | `logs`, `traces`, `metrics`, `profiles` ou `security-events`. |
| `scope` | `project`, ou `ingestion-key` pour le budget propre d'une clé. |
| `ingestionKeyId` | L'ID de la clé, pour le budget propre d'une clé. |
| `ingestionKeyName` | Le nom de la clé au moment où le point a été écrit, pour le budget propre d'une clé. |

Pour être prévenu à 90 % du budget de journaux du projet, créez un moniteur de métriques sur `oneuptime.telemetry.budget.used.percent`, filtré sur `signal` `logs` et `scope` `project`, qui alerte quand le maximum dépasse 90 :

- **Agrégez avec le maximum.** Chaque chiffre ne fait que croître au cours d'une journée de budget.
- **Utilisez une fenêtre de 15 minutes ou plus.** Un point est écrit toutes les 5 minutes, et une fenêtre sans aucun point résout l'alerte.
- **Attendez-vous à des trous, pas à des zéros.** Rien n'est écrit pour un chiffre qui vaut 0, ni tant que les décomptes ne peuvent pas être lus.
- **Elles ne coûtent rien.** Ces métriques ne sont comptées sur aucun budget ni comme utilisation de la télémétrie, et sont conservées aussi longtemps que les métriques de moniteur : 30 jours, sauf si l'administrateur de l'instance le change. Les noms de métriques qui commencent par `oneuptime.telemetry.budget.` leur sont réservés : les métriques que vos applications envoient sous un tel nom sont abandonnées.

## Dépannage

:::details Un collector journalise des 403 pour ses exports
Le budget quotidien du projet ou de la clé pour ce signal est épuisé, et le collector abandonne ce qu'il ne peut pas envoyer jusqu'à la réinitialisation du budget. Consultez **Utilisé aujourd'hui** sur la page Utilisation. Demandez à l'administrateur de l'instance d'augmenter le budget du projet, ou envoyez moins : un filtre de suppression n'aide pas ici, car il retire la télémétrie après qu'elle a été comptée.
:::

:::details Un collector journalise des 429 et réessaie
Il envoie plus vite qu'une limite de débit ne le permet. Il réessaie après le délai `Retry-After`, donc rien n'est perdu sauf si sa file d'attente se remplit. Augmentez la limite de débit, ou répartissez les envois plus régulièrement.
:::

:::details « Utilisé aujourd'hui » dépasse ce que montre la page Utilisation de la télémétrie
Un budget compte la télémétrie à son arrivée, décompressée, y compris ce que les filtres de suppression retirent ensuite. La page Utilisation compte ce qui a été stocké, le lendemain.
:::

:::details Les budgets indiquent que les décomptes du jour n'ont pas pu être lus
OneUptime ne peut pas joindre Valkey, où les budgets sont comptés. Tant qu'il ne le peut pas, la télémétrie est stockée sans être comptée, et aucun budget n'est appliqué.
:::

## Étapes suivantes

:::cards
- [Utilisation de la télémétrie](/docs/telemetry/usage): Voir ce qu'envoie chaque projet et chaque service.
- [Filtres de suppression et règles de masquage](/docs/telemetry/drop-filters-and-scrub-rules): Ne plus stocker la télémétrie dont vous n'avez pas besoin.
- [Clés d'ingestion](/docs/telemetry/ingestion-keys): Une clé pour chaque émetteur, pour que chacun puisse avoir un budget.
- [Surveillance des métriques](/docs/monitor/metrics-monitor): Alerter sur les métriques des budgets.
:::
