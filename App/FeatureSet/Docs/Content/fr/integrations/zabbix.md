# Intégration Zabbix

[Zabbix](https://www.zabbix.com) surveille vos serveurs et votre réseau ; OneUptime gère votre réponse aux incidents, les astreintes et les pages de statut. Connectez les deux et chaque problème Zabbix devient automatiquement un incident OneUptime — ainsi les bonnes personnes sont alertées et votre page de statut reste fiable.

Cette intégration est **entrante** : Zabbix envoie des problèmes à OneUptime. Elle utilise un **type de média webhook** Zabbix d'un côté et un **[Workflow](/docs/workflows/index)** OneUptime de l'autre. Aucun plugin, aucun service supplémentaire.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Comment ça fonctionne

1. Un déclencheur Zabbix passe à **PROBLEM**.
2. Une **action** Zabbix demande au type de média **OneUptime** d'envoyer l'événement.
3. Le script du type de média POSTs une petite charge utile JSON vers l'URL du workflow OneUptime.
4. Le workflow lit la charge utile et crée un incident (et, en option, le résout lorsque Zabbix se rétablit).

## Prérequis

- Un serveur Zabbix que vous administrez (ce guide est écrit pour **Zabbix 6.0 LTS / 7.0 LTS** ; le type de média webhook fonctionne de la même façon sur 5.0+).
- Votre serveur Zabbix doit pouvoir atteindre votre instance OneUptime via HTTPS.
- Un projet OneUptime où vous pouvez créer des workflows.

## Partie 1 — Créer le workflow OneUptime

Faites cela en premier, car vous aurez besoin de l'URL webhook qu'il génère.

1. Ouvrez **Workflows → Create Workflow**. Nommez-le `Zabbix → Incidents` et ouvrez l'onglet **Builder**.
2. Faites glisser un déclencheur **Webhook** sur le canevas. Cliquez dessus et **copiez l'URL unique** qu'il affiche. Gardez-la en sécurité — quiconque la possède peut démarrer le workflow. Renommez le bloc `Zabbix` pour que les variables soient lisibles.
3. Faites glisser un bloc **Conditions** sur le canevas et connectez la sortie du déclencheur à celui-ci. Configurez :
   - **Left value** : `{{Zabbix.Request Body.status}}`
   - **Operator** : `==`
   - **Right value** : `1` _(Zabbix envoie `1` pour un problème, `0` pour une reprise)_
4. Faites glisser un bloc **Create Incident** et connectez-le à la sortie **Yes** du bloc Conditions. Remplissez :
   - **Title** : `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description** : `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity** : choisissez la gravité d'incident OneUptime souhaitée (vous pourrez l'affiner plus tard avec davantage de branches Conditions qui associent les gravités Zabbix).
5. Enregistrez. Laissez **Enabled** _désactivé_ pour l'instant — vous l'activerez après un test.

> **Conseil :** Mettre l'`event_id` Zabbix dans la description (ou un label d'incident) vous permet de retrouver cet incident plus tard si vous souhaitez le résoudre automatiquement à la reprise. Voir [Résolution automatique](#résolution-automatique-optionnel).

## Partie 2 — Configurer Zabbix

### Étape 1 : Créer le type de média OneUptime

1. Dans Zabbix, allez dans **Alerts → Media types** (sur les versions plus anciennes : **Administration → Media types**).
2. Cliquez sur **Create media type** et définissez **Type** sur **Webhook**.
3. **Name** : `OneUptime`.
4. Ajoutez ces **Parameters** (cliquez sur _Add_ pour chacun). Ils font correspondre les [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) Zabbix en une charge utile propre :

   | Name             | Value              |
   | ---------------- | ------------------ |
   | `url`            | `{ALERT.SENDTO}`   |
   | `event_id`       | `{EVENT.ID}`       |
   | `event_name`     | `{EVENT.NAME}`     |
   | `event_value`    | `{EVENT.VALUE}`    |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host`           | `{HOST.NAME}`      |
   | `event_date`     | `{EVENT.DATE}`     |
   | `event_time`     | `{EVENT.TIME}`     |

5. Collez ceci dans le champ **Script** :

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. Cliquez sur l'onglet **Message templates** et ajoutez un modèle pour **Problem** et **Problem recovery** (le corps peut être vide — la charge utile est construite dans le script). Cela est requis pour que Zabbix utilise le type de média pour ces types d'événements.
7. Cliquez sur **Add** pour enregistrer le type de média.

### Étape 2 : Créer un utilisateur pour porter le webhook

Zabbix envoie des notifications _à un utilisateur_. Créez-en un dédié pour que l'intégration soit facile à trouver et à désactiver.

1. Allez dans **Users → Users → Create user**. Nommez-le `OneUptime Webhook`, donnez-lui un rôle permettant de recevoir des notifications (par ex. **User role**), et ajoutez-le à un groupe d'utilisateurs.
2. Dans l'onglet **Media**, cliquez sur **Add** :
   - **Type** : `OneUptime`
   - **Send to** : collez l'**URL webhook du workflow** copiée dans la Partie 1.
   - **When active** / severities : laissez les valeurs par défaut (ou restreignez aux gravités qui vous intéressent).
3. Cliquez sur **Add** puis sur **Update**.

### Étape 3 : Envoyer les problèmes à OneUptime avec une action

1. Allez dans **Alerts → Actions → Trigger actions → Create action**.
2. **Name** : `Notify OneUptime`.
3. **Conditions** (optionnel) : restreignez le périmètre — par exemple, _Trigger severity >= Warning_. Laissez vide pour tout envoyer.
4. Dans l'onglet **Operations**, ajoutez une opération qui envoie à **User: OneUptime Webhook** via le type de média **OneUptime**.
5. Pour résoudre les incidents à la reprise plus tard, remplissez également les **Recovery operations** avec le même utilisateur/média.
6. Cliquez sur **Add** pour enregistrer et assurez-vous que l'action est **Enabled**.

## Partie 3 — Tester

1. De retour dans le workflow OneUptime, activez **Enabled**.
2. Dans Zabbix, déclenchez un problème de test — par exemple, abaissez temporairement un seuil de déclencheur, ou utilisez un élément de test qui passe à l'état problème.
3. Ouvrez l'onglet **Logs** de votre workflow. Vous devriez voir une exécution avec la charge utile Zabbix, le bloc Conditions prenant le chemin **Yes**, et l'incident étant créé.
4. Vérifiez **Incidents** dans OneUptime — votre problème Zabbix est maintenant un incident.

Si rien n'arrive, voir [Dépannage](#dépannage).

## Résolution automatique (optionnel)

Le workflow de base ci-dessus _ouvre_ des incidents. Pour également les _fermer_ lorsque Zabbix se rétablit :

1. Assurez-vous que votre action Zabbix a des **Recovery operations** configurées (Étape 3 ci-dessus) pour que les événements de reprise soient également envoyés. À la reprise, `status` arrive avec la valeur `0`.
2. Dans le workflow, ajoutez une deuxième branche **Conditions** : gauche `{{Zabbix.Request Body.status}}`, opérateur `==`, droite `0`.
3. Depuis sa sortie **Yes**, ajoutez un bloc **Find Incident** qui recherche l'incident ouvert créé précédemment — faites correspondre sur l'`event_id` Zabbix que vous avez stocké dans la description ou un label.
4. Connectez cela à un bloc **Update Incident** et faites passer l'incident à votre état _résolu_.

Comme la résolution dépend de la façon dont vous modélisez les états d'incident dans votre projet, conservez le chemin **create** comme noyau fiable et superposez le chemin de résolution une fois que vous avez confirmé que les événements circulent correctement. Voir [Composants → Composants de données OneUptime](/docs/workflows/components#oneuptime-data-components).

## Association des gravités Zabbix (optionnel)

Les gravités Zabbix (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) arrivent sous `{{Zabbix.Request Body.severity}}`. Pour les associer aux gravités d'incident OneUptime, ajoutez des branches **Conditions** avant **Create Incident** — par exemple, routez `Disaster` et `High` vers un incident « Critical » et tout le reste vers « Major ». Créez un bloc **Create Incident** par branche.

## Dépannage

**Le workflow ne s'exécute jamais.**

- Confirmez que l'interrupteur **Enabled** du workflow est activé.
- Depuis le serveur Zabbix, confirmez qu'il peut atteindre l'URL : `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Vous devriez recevoir un accusé de réception rapide.
- Vérifiez **Reports → Action log** dans Zabbix pour les erreurs de livraison.

**Zabbix signale une erreur de script.**

- Ouvrez le type de média et utilisez **Test** pour envoyer un exemple de charge utile. Zabbix affiche la sortie du script ou l'erreur levée.
- Une réponse non 2xx de OneUptime est signalée par le `throw` dans le script — vérifiez que l'URL du workflow est exactement correcte.

**L'incident est créé mais les champs sont vides.**

- Ouvrez l'onglet **Logs** du workflow et inspectez la sortie du déclencheur. Confirmez que les noms de champs sous **Request Body** correspondent à ce que vous référencez (`name`, `host`, `severity`, `status`, `event_id`).
- Un champ manquant se résout en chaîne vide plutôt qu'en erreur — voir [Variables → Pièges](/docs/workflows/variables#gotchas).

**Tout se déclenche deux fois.**

- Vous avez probablement à la fois une opération de problème et une étape d'escalade envoyant au même média. Vérifiez les étapes **Operations** de l'action.

## Notes de sécurité

- Traitez l'URL webhook du workflow comme un mot de passe. Si elle fuite, supprimez le déclencheur et créez-en un nouveau pour faire tourner l'URL.
- Restreignez les conditions de l'action Zabbix pour ne transmettre que les gravités qui justifient un incident.
- Si vous exécutez OneUptime en auto-hébergé derrière un pare-feu, autorisez l'IP de sortie de votre serveur Zabbix à l'atteindre via HTTPS.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — les schémas entrant/sortant.
- [Déclencheur Webhook](/docs/workflows/triggers#webhook) — comment fonctionne l'URL réceptrice.
- [Composants](/docs/workflows/components) — Conditions, Create Incident, et plus encore.
- [Variables](/docs/workflows/variables) — lecture de la charge utile Zabbix dans les blocs suivants.
