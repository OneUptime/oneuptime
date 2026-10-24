<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime est une plateforme d'observabilité open source. Elle vérifie que vos sites web, vos API et vos serveurs fonctionnent, collecte les journaux, les métriques et les traces que vos applications envoient, alerte la personne d'astreinte quand quelque chose tombe en panne et informe vos clients sur une page de statut. Tout se passe dans un seul produit : l'outil qui remarque un problème est celui qui alerte votre équipe.

Vous pouvez l'utiliser sur [OneUptime Cloud](https://oneuptime.com) ou l'exécuter sur vos propres serveurs.

<p align="center">
  <img alt="OneUptime pendant un incident : sa chronologie, la personne d'astreinte, la page de statut et l'enquête de OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Ce que fait OneUptime

- **[Surveillance](https://oneuptime.com/docs/fr/monitor/create-monitor)** : Vérifier des sites web, des API, des ports, le DNS et des certificats depuis des sondes du monde entier ou depuis votre propre réseau. OneUptime surveille aussi des serveurs, Kubernetes, Docker, VMware, des bases de données et des équipements réseau.
- **[Incidents et astreinte](https://oneuptime.com/docs/fr/incidents/index)** : Traiter chaque incident sur une seule chronologie. Alerter la personne d'astreinte par appel, SMS, e-mail, push, Slack ou Microsoft Teams, et escalader jusqu'à ce que quelqu'un réponde.
- **[Pages de statut](https://oneuptime.com/docs/fr/status-pages/index)** : Tenir vos clients informés sur des pages de statut publiques ou privées, et y annoncer la maintenance planifiée.
- **[Journaux, métriques et traces](https://oneuptime.com/docs/fr/telemetry/open-telemetry)** : Les envoyer avec OpenTelemetry, les rechercher et construire des tableaux de bord. Les exceptions, les profils, le Real User Monitoring et les événements de sécurité se trouvent au même endroit.
- **[Workflows et runbooks](https://oneuptime.com/docs/fr/workflows/index)** : Automatiser le travail répétitif, et connecter Jira, ServiceNow et les autres outils que votre équipe utilise déjà.
- **[OneUptime AI](https://oneuptime.com/docs/fr/ai/ai-sre)** : Enquête sur les nouveaux incidents et les nouvelles alertes, et publie une analyse des causes racines sourcée. Quand vous activez la correction, il peut ouvrir une pull request avec un correctif que votre équipe relira.
- **[API, CLI et Terraform](https://oneuptime.com/docs/fr/api-reference/api-reference)** : Automatiser OneUptime depuis vos scripts et votre CI, et gérer les moniteurs, les pages de statut et l'astreinte en tant que code.

Tout le reste se trouve dans la [documentation](https://oneuptime.com/docs/fr/introduction/getting-started).

## Démarrer

### OneUptime Cloud

[Inscrivez-vous](https://oneuptime.com/accounts/register) et créez un projet. Le forfait gratuit ne demande pas de carte bancaire.

### Auto-héberger avec Docker Compose

Il vous faut un serveur Linux avec au moins 8 Go de mémoire, ainsi que Docker, Docker Compose, Git et Node.js.

Avant l'étape 3, réglez `HOST` dans `config.env` sur le nom de domaine ou l'adresse IP qu'on utilisera pour joindre OneUptime, sans `http://`. Ne gardez `localhost` que pour essayer OneUptime sur votre propre ordinateur.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

`npm start` vérifie le serveur, donne à chaque secret de `config.env` sa propre valeur aléatoire et démarre OneUptime. Quand `npm start` affiche **OneUptime is up!**, ouvrez `http://localhost`, ou l'adresse de votre serveur, et inscrivez-vous. Le premier compte devient l'administrateur de l'instance.

Le [guide Docker Compose](https://oneuptime.com/docs/fr/installation/docker-compose) couvre la taille des serveurs, HTTPS, les sauvegardes et les mises à jour.

### Kubernetes avec Helm

Pour la production à grande échelle, ou la haute disponibilité, installez le chart Helm. Réglez `host` sur le nom de domaine ou l'adresse IP par lesquels on joindra OneUptime :

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

Le [README du chart](/HelmChart/Public/oneuptime/README.md) couvre le stockage, HTTPS, les bases de données et les mises à niveau.

## Community et Enterprise

- **Community Edition** : Gratuite et open source, avec tout ce qui précède, y compris l'authentification unique SAML et OIDC.
- **Enterprise Edition** : Ajoute le provisionnement SCIM, les journaux d'audit, la conformité des équipes et les tableaux de bord de santé de l'instance, avec un support prioritaire. L'usage en production exige une licence : [contacter le service commercial](mailto:sales@oneuptime.com).

La documentation [compare les deux éditions](https://oneuptime.com/docs/fr/self-hosted/enterprise).

## Obtenir de l'aide

- Posez vos questions dans la [communauté OneUptime sur Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Signalez les bugs et demandez des fonctionnalités dans les [issues GitHub](https://github.com/OneUptime/oneuptime/issues).
- Signalez une vulnérabilité en privé, comme l'explique [SECURITY.md](/.github/SECURITY.md).
- Pour tout le reste, écrivez à [support@oneuptime.com](mailto:support@oneuptime.com).

## Contribuer

Corrections de bugs, fonctionnalités, documentation et tests : toutes les contributions sont les bienvenues. Le [guide de développement local](https://oneuptime.com/docs/fr/installation/local-development) montre comment lancer OneUptime depuis les sources, et les [règles de contribution](/.github/CONTRIBUTING.md) expliquent le fonctionnement des pull requests et des licences. Les issues étiquetées [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) sont un bon point de départ.

Si OneUptime vous est utile, donnez une étoile à ce dépôt ou [soutenez le projet](https://github.com/sponsors/OneUptime).

## Licence

OneUptime est open source sous la [licence Apache 2.0](/LICENSE), à l'exception du répertoire [`ee/`](/ee). Ce répertoire contient l'Enterprise Edition et est distribué sous la [OneUptime Enterprise License](/ee/LICENSE). L'image de la Community Edition ne contient aucun code de `ee/`. Le fichier [`LICENSE`](/LICENSE) à la racine du dépôt établit cette répartition.
