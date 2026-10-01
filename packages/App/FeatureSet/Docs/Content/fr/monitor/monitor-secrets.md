# Secrets de moniteur

Vous pouvez utiliser des secrets pour stocker des informations sensibles que vous souhaitez utiliser dans vos vérifications de surveillance. Les secrets sont chiffrés et stockés de manière sécurisée.

### Ajouter un secret

Pour ajouter un secret, veuillez aller dans le tableau de bord OneUptime -> Moniteurs -> Paramètres -> Secrets -> Créer un secret de moniteur.

![Créer un secret](/docs/static/images/CreateMonitorSecret.png)

Donnez un nom et une valeur au secret, puis choisissez à l'étape **Accès** quels moniteurs peuvent l'utiliser. Dans cet exemple, nous avons ajouté un secret `ApiKey`.

**Remarque importante** : Les secrets sont chiffrés et stockés de manière sécurisée. La valeur n'est plus jamais affichée après son enregistrement — ni dans le tableau, ni dans le formulaire d'édition, ni via l'API. Si vous perdez la valeur, vous devrez la récupérer à sa source et la saisir à nouveau. Pour faire tourner un secret, utilisez le bouton **Mettre à jour la valeur secrète** sur sa ligne ; inutile de le supprimer et de le recréer.

### Choisir quels moniteurs peuvent utiliser un secret

Chaque secret a l'une de ces trois options d'accès :

- **Tous les moniteurs** : tous les moniteurs du projet peuvent utiliser le secret, y compris ceux que vous créerez plus tard. Utilisez cette option pour un identifiant partagé par de nombreux moniteurs.
- **Moniteurs spécifiques** : seuls les moniteurs que vous choisissez peuvent utiliser le secret. C'est l'option par défaut, et les secrets créés avant l'apparition de ces options fonctionnent ainsi.
- **Moniteurs avec des étiquettes** : les moniteurs qui portent au moins une des étiquettes choisies peuvent utiliser le secret. Ajouter l'une de ces étiquettes à un moniteur lui donne accès, et retirer l'étiquette lui retire l'accès dès sa prochaine exécution.

Vous pouvez changer d'option à tout moment avec **Modifier** sur la ligne du secret. Seule la liste de l'option choisie est conservée : passer à **Tous les moniteurs** vide les listes de moniteurs et d'étiquettes du secret, et passer de **Moniteurs spécifiques** à **Moniteurs avec des étiquettes** (ou l'inverse) vide la liste que vous quittez.

Un secret n'est jamais accessible aux moniteurs d'un autre projet.

Toute personne pouvant modifier un moniteur qui a accès à un secret peut envoyer ce secret vers n'importe quelle destination à laquelle le moniteur se connecte. Avec **Tous les moniteurs**, il s'agit de toute personne pouvant créer ou modifier des moniteurs dans le projet. Avec **Moniteurs avec des étiquettes**, cela inclut aussi toute personne pouvant ajouter l'une de ces étiquettes à un moniteur.

Dans l'API, l'option d'accès est le champ `monitorAccess` : `All Monitors`, `Specific Monitors` ou `Monitors With Labels`. Les champs `monitors` et `labels` contiennent les listes. Un secret créé sans `monitorAccess` reçoit `Specific Monitors`.

### Utiliser un secret

Vous pouvez utiliser des secrets dans les types de surveillance suivants :

- API (dans les en-têtes de requête, le corps de la requête et l'URL)
- Site web, IP, Port, Ping, Certificat SSL (dans l'URL)
- Moniteur synthétique, Moniteur de code personnalisé (dans le code)
- Moniteur SNMP (dans la chaîne de communauté, la clé d'authentification SNMPv3 et la clé de confidentialité)

![Utiliser un secret](/docs/static/images/UsingMonitorSecret.png)

Pour utiliser un secret, ajoutez `{{monitorSecrets.NOM_DU_SECRET}}` dans le champ où vous souhaitez utiliser le secret. Par exemple, dans ce cas nous avons ajouté `{{monitorSecrets.ApiKey}}` dans le champ En-tête de requête.

Les secrets sont injectés sur la sonde avant l'exécution des scripts de moniteur synthétique ou de code personnalisé, donc les références telles que `{{monitorSecrets.ApiKey}}` se résolvent vers la valeur déchiffrée dans le script en cours d'exécution.

Si un moniteur fait référence à un secret qu'il ne peut pas utiliser, la référence reste telle quelle et n'est pas remplacée par la valeur.

Lorsque vous testez un moniteur avant de l'enregistrer, seuls les secrets accessibles à **Tous les moniteurs** sont renseignés, car un nouveau moniteur ne figure dans aucune liste et n'a pas encore d'étiquettes. Une fois le moniteur enregistré, les tests utilisent tous les secrets auxquels il a accès.
