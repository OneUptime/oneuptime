# Guide de l'auto-hébergement

Suivez cette page de haut en bas pour passer d'un serveur vide à votre propre OneUptime, qui tourne en HTTPS, vous a envoyé un e-mail de test et peut vous alerter. Chaque étape se termine par la façon de savoir qu'elle a fonctionné, et renvoie aux pages plus longues pour le détail.

:::cards
- [Installer OneUptime](#installer-oneuptime): Docker Compose sur un serveur, ou le chart Helm sur Kubernetes.
- [Terminer la configuration du serveur](#terminer-la-configuration-du-serveur): L'e-mail, puis les SMS et les appels, chacun avec un test.
- [Vérifier votre installation](#vérifier-votre-installation): Une commande qui nomme ce qui ne va pas.
- [Démarrage rapide](/docs/introduction/quickstart): Votre premier moniteur, votre première politique d'astreinte et votre première page de statut.
:::

## Ce qu'il vous faut

- **Un serveur.** Pour Docker Compose, un serveur Linux avec 8 Go de mémoire, 4 cœurs et 20 Go de disque pour essayer OneUptime, ou 16 Go, 8 cœurs et 400 Go pour une équipe : voir [Dimensionnement et planification de la capacité](/docs/installation/sizing). Pour le chart Helm, un cluster Kubernetes.
- **Un nom de domaine** avec lequel on ouvrira OneUptime, comme `oneuptime.example.com`, avec un enregistrement DNS `A` qui pointe vers le serveur. Vous pouvez commencer avec l'adresse IP du serveur, mais un certificat de Let's Encrypt demande un nom de domaine.
- **Les ports 80 et 443** joignables depuis Internet, pour HTTPS.
- **Un moyen d'envoyer des e-mails** : un serveur de messagerie, comme celui de votre entreprise, Microsoft 365 ou Google Workspace, ou un compte chez Amazon SES, SendGrid, Mailgun, Postmark ou Resend.
- **Un compte Twilio**, pour être alerté par SMS et par appel téléphonique. L'e-mail et les notifications push n'en ont pas besoin.

**Cela a fonctionné quand** `dig +short oneuptime.example.com` affiche l'adresse IP du serveur.

## Installer OneUptime

:::tabs
@tab Docker Compose
Sur un nouveau serveur Ubuntu, Debian ou basé sur RHEL, une seule commande installe Docker, Git et Node.js là où ils manquent, clone OneUptime dans un dossier `oneuptime`, demande l'adresse qu'on utilisera et le démarre :

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Pour faire la même chose à la main, avec Docker, Git et Node.js installés :

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Ouvrez `config.env` et réglez `HOST`, son premier paramètre, sur votre nom de domaine ou votre adresse IP, sans `http://`. C'est le seul paramètre que vous devez changer : l'e-mail, les SMS et les appels se configurent dans l'Admin Dashboard, et tout ce qui se trouve sous `ADVANCED` fonctionne tel quel. Démarrez ensuite OneUptime :

```bash
npm start
```

**Cela a fonctionné quand** `npm start` se termine par **OneUptime is up!** et l'adresse à ouvrir. Le premier démarrage prend plusieurs minutes, pendant que Docker télécharge les images. Si `npm start` s'arrête avant, il dit quoi changer. [Docker Compose](/docs/installation/docker-compose) donne tous les détails.
@tab Kubernetes
Créez un `values.yaml` avec votre nom de domaine ou votre adresse IP, sans `http://` :

```yaml title="values.yaml"
host: oneuptime.example.com
```

Le chart garde ses données sur la classe de stockage par défaut de votre cluster. Si `kubectl get storageclass` n'en marque aucune `(default)`, ajoutez `global.storageClass` avec le nom de l'une d'elles. Installez ensuite le chart :

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Cela a fonctionné quand** `kubectl get pods` montre chaque pod `Running` et que l'adresse affichée par `helm install` ouvre OneUptime. Le [guide d'installation du chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) donne tous les détails.
:::

## Activer HTTPS

Une fois que votre nom de domaine pointe vers le serveur, laissez OneUptime obtenir un certificat gratuit de Let's Encrypt. Il renouvelle lui-même le certificat.

:::tabs
@tab Docker Compose
Réglez ces valeurs dans `config.env`, puis relancez `npm start` :

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Vous avez déjà un reverse proxy, comme Caddy, Nginx ou un répartiteur de charge ? Gardez `PROVISION_SSL=false`, réglez `HTTP_PROTOCOL=https` et `TRUSTED_PROXY_HOPS=2`, et lisez [Utiliser votre propre reverse proxy](/docs/installation/docker-compose#utiliser-votre-propre-reverse-proxy).
@tab Kubernetes
Réglez ces valeurs dans `values.yaml`, puis appliquez-les :

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Pour terminer TLS sur votre propre contrôleur d'ingress à la place, laissez `ssl.provision` désactivé et réglez seulement `httpProtocol: https`.
:::

**Cela a fonctionné quand** `https://oneuptime.example.com` s'ouvre sans avertissement de certificat. Le premier certificat arrive en général en quelques minutes. Vous essayez OneUptime sur `localhost` ? Sautez cette étape : un certificat demande un nom de domaine.

## Créer le compte administrateur

Ouvrez votre adresse, comme `https://oneuptime.example.com`, et inscrivez-vous. Le premier compte d'un nouveau serveur en devient l'administrateur principal, qui peut ouvrir l'Admin Dashboard à `/admin`.

**Cela a fonctionné quand** `/admin` ouvre l'Admin Dashboard. Tant que l'e-mail, HTTPS ou le choix sur les inscriptions restent ouverts, il s'ouvre sur **Terminez la configuration de ce serveur**.

## Terminer la configuration du serveur

La page **Configuration du serveur** de l'Admin Dashboard, à `/admin/setup`, liste ce dont un nouveau serveur a besoin, le plus important d'abord. L'e-mail, HTTPS et qui peut s'inscrire sont obligatoires. Les SMS et les appels, une sonde globale, les sauvegardes et les vérifications de mise à jour sont recommandés. Chaque élément a un bouton qui ouvre l'endroit où il se règle, et `npm start` se termine en affichant l'adresse de cette page.

:::steps
### Configurer l'e-mail

Cliquez sur **Configurer l'e-mail**. Il ouvre **Paramètres > Notifications > E-mails**, où vous saisissez votre serveur de messagerie (la plupart utilisent le port `587`) ou votre fournisseur d'e-mail, et l'adresse d'où partent les e-mails. Enregistrez, puis cliquez sur **Envoyer un e-mail de test** et envoyez-en un à vous-même.

**Cela a fonctionné quand** l'e-mail arrive et que la liste marque l'e-mail comme fait. Si le test échoue, il montre ce que le serveur de messagerie a répondu : voir [SMTP](/docs/emails/smtp#dépannage).

### Choisir qui peut s'inscrire

Quiconque peut ouvrir votre adresse peut s'inscrire. Une fois que votre équipe a ses comptes, désactivez **Autoriser les inscriptions** sous **Paramètres > Authentification** : les personnes que vous invitez à un projet peuvent quand même le rejoindre. Pour laisser les inscriptions ouvertes, cliquez sur **Laisser les inscriptions ouvertes**.

**Cela a fonctionné quand** la liste marque les inscriptions comme faites.

### Configurer les SMS et les appels, ou n'utiliser que l'e-mail et le push

Pour être alerté par SMS et par appel téléphonique, cliquez sur **Configurer les SMS et les appels** et ajoutez votre compte Twilio sous **Paramètres > Notifications > Appel et SMS** : [Intégration Twilio](/docs/self-hosted/twilio-integration) montre où trouver chaque valeur. Cliquez ensuite sur **Envoyer un SMS de test** et **Passer un appel de test**. Pour les envoyer plutôt par une passerelle à vous, voir [Passerelle SMS et appels](/docs/self-hosted/sms-and-call-gateway). Si l'e-mail et les notifications push suffisent, cliquez sur **N'utiliser que l'e-mail et les notifications push**.

**Cela a fonctionné quand** le SMS arrive et que votre téléphone sonne, ou que la liste montre votre choix.
:::

L'élément HTTPS est fait dès que [Activer HTTPS](#activer-https) fonctionne, et chaque élément recommandé dit quoi faire.

## Vérifier votre installation

:::tabs
@tab Docker Compose
Dans le dossier `oneuptime`, lancez le doctor :

```bash
npm run doctor
```

Il vérifie chaque conteneur, `config.env`, que `HOST` atteint ce serveur, le certificat et l'espace disque libre, et demande à OneUptime ce qu'il voit de lui-même, comme l'e-mail et les sondes. Chaque problème vient avec sa solution : voir [Vérifier votre installation](/docs/installation/docker-compose#vérifier-votre-installation).
@tab Kubernetes
Lancez le script de diagnostic du chart contre votre cluster, comme le montre le [guide de dépannage du chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it). Il ne fait que lire, et se termine par un résumé de ce qu'il a trouvé, le plus grave d'abord.
:::

**Cela a fonctionné quand** le doctor se termine par **Everything looks right.** et sort avec `0`. Il sort avec `1` quand quelque chose est à corriger, et avec `2` quand il n'a pas pu faire ses vérifications. Sur Kubernetes, le résumé n'a aucun constat `CRITICAL`.

## Surveiller quelque chose et être alerté

Votre serveur peut maintenant envoyer des e-mails et alerter des personnes. Le [Démarrage rapide](/docs/introduction/quickstart) continue dans le produit : un moniteur pour votre site, une politique d'astreinte qui vous alerte quand il tombe, et une page de statut, en une quinzaine de minutes. Sa dernière partie déclare un incident de test, pour que vous voyiez l'alerte arriver.

## Dépannage

:::details npm start s'arrête et dit que HOST n'est pas encore une adresse
`HOST` dans `config.env` contient encore un espace réservé, comme `<your-address>`. Réglez-le sur votre nom de domaine ou votre adresse IP, sans `http://`, et relancez `npm start`.
:::

:::details L'e-mail de test échoue
Le message sous le bouton est ce que le serveur de messagerie a répondu. Vérifiez le nom d'hôte, le port, le nom d'utilisateur et le mot de passe, et que le serveur de messagerie vous laisse envoyer depuis l'adresse d'où partent les e-mails. Voir [SMTP](/docs/emails/smtp#dépannage).
:::

:::details Le navigateur avertit au sujet du certificat
Let's Encrypt a besoin des ports 80 et 443 joignables depuis Internet, et de votre nom de domaine pointant vers ce serveur. Attendez quelques minutes, puis lancez `npm run doctor` : il vérifie le certificat et dit ce qui ne va pas.
:::

## Prochaines étapes

:::cards
- [Démarrage rapide](/docs/introduction/quickstart): Un moniteur, une politique d'astreinte et une page de statut en quinze minutes.
- [Docker Compose](/docs/installation/docker-compose): Votre propre proxy, les sauvegardes, les mises à jour et la liste de contrôle pour la production.
- [Mise à niveau](/docs/installation/upgrading): Passer à une nouvelle version, une version majeure à la fois.
- [Architecture](/docs/self-hosted/architecture): Comment les parties d'OneUptime s'assemblent.
:::
