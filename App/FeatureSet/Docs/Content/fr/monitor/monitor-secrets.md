# Secrets de moniteur

Vous pouvez utiliser des secrets pour stocker des informations sensibles que vous souhaitez utiliser dans vos vérifications de surveillance. Les secrets sont chiffrés et stockés de manière sécurisée.

### Ajouter un secret

Pour ajouter un secret, veuillez aller dans le tableau de bord OneUptime -> Paramètres du projet -> Secrets de moniteur -> Créer un secret de moniteur.

![Créer un secret](/docs/static/images/CreateMonitorSecret.png)

Vous pouvez sélectionner quels moniteurs ont accès au secret. Dans ce cas, nous avons ajouté le secret `ApiKey` et sélectionné des moniteurs pour y avoir accès.

**Remarque importante** : Les secrets sont chiffrés et stockés de manière sécurisée. Si vous perdez le secret, vous devrez créer un nouveau secret. Vous ne pouvez pas visualiser ou mettre à jour le secret après son enregistrement.

### Utiliser un secret

Vous pouvez utiliser des secrets dans les types de surveillance suivants :

- API (dans les en-têtes de requête, le corps de la requête et l'URL)
- Site web, IP, Port, Ping, Certificat SSL (dans l'URL)
- Moniteur synthétique, Moniteur de code personnalisé (dans le code)
- Moniteur SNMP (dans la chaîne de communauté, la clé d'authentification SNMPv3 et la clé de confidentialité)

![Utiliser un secret](/docs/static/images/UsingMonitorSecret.png)

Pour utiliser un secret, ajoutez `{{monitorSecrets.NOM_DU_SECRET}}` dans le champ où vous souhaitez utiliser le secret. Par exemple, dans ce cas nous avons ajouté `{{monitorSecrets.ApiKey}}` dans le champ En-tête de requête.

Les secrets sont injectés sur la sonde avant l'exécution des scripts de moniteur synthétique ou de code personnalisé, donc les références telles que `{{monitorSecrets.ApiKey}}` se résolvent vers la valeur déchiffrée dans le script en cours d'exécution.

### Permissions des secrets de moniteur

Vous pouvez sélectionner quels moniteurs ont accès au secret. Vous pouvez également mettre à jour les permissions à tout moment. Ainsi, si vous souhaitez ajouter un nouveau moniteur pour avoir accès au secret, vous pouvez le faire en mettant à jour les permissions.
