<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Logo OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Observabilité agentique — une seule plateforme open source pour la disponibilité, les incidents, l'astreinte, les pages de statut, les logs, les traces, les métriques et l'APM.</h3>

  <p><b>Quand les choses tournent mal, soyez le premier à le savoir — et le plus rapide à corriger.</b></p>

  <p>OneUptime remplace toute une étagère d'outils SaaS par une seule plateforme que vous pouvez héberger vous-même gratuitement. Elle détecte la panne, alerte la bonne personne, met à jour votre page de statut, trouve la cause racine et ouvre même la PR de correction.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Site web</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Docs</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Démarrage rapide</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Tarifs</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Contribuer</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Essayez OneUptime Cloud — offre gratuite à vie, sans carte bancaire →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Centre de commande OneUptime pendant un incident en direct" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Remplacez toute votre stack d'observabilité

OneUptime réunit la surveillance, les alertes, la réponse aux incidents et l'observabilité dans une seule application open source — pour que vous cessiez de payer (et d'assembler) une douzaine d'outils distincts.

| Au lieu de… | Utilisez OneUptime pour… |
|---|---|
| Pingdom / UptimeRobot | **Surveillance de la disponibilité** — vérifications de site web, API, ping, port, SSL, DNS et synthétiques depuis le monde entier |
| StatusPage.io | **Pages de statut** — pages de statut publiques et privées personnalisées avec abonnés |
| PagerDuty / Opsgenie | **Astreinte et alertes** — plannings, politiques d'escalade, SMS / appel / push / Slack |
| Incident.io | **Gestion des incidents** — déclarer, trier, communiquer et faire le post-mortem |
| Datadog / New Relic | **APM et métriques** — traces, tableaux de bord et performance des services |
| Loggly | **Gestion des logs** — collecter, rechercher et alerter sur les logs |
| Sentry | **Suivi des erreurs** — exceptions avec traces d'appels complètes et contexte |

Le tout est **100 % open source (Apache 2.0)** et gratuit à héberger soi-même.

---

<details>
<summary><b>🌙 Un incident, géré de bout en bout</b></summary>

<br/>

Il est 2 h 47 du matin. Le paiement commence à expirer. Voici ce que fait OneUptime avant que la plupart des outils n'aient même déclenché la première alerte — et ce que montrent réellement les captures d'écran ci-dessous.

### 1 · Détecter — *savoir en quelques secondes*

Des sondes réparties dans plusieurs régions détectent la latence du paiement qui dépasse largement votre seuil de 5 s et ouvrent un incident automatiquement — avant que vos clients n'appuient sur « actualiser ».

![Détecter — la surveillance mondiale détecte la dégradation de l'API de paiement](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Répondre — *la bonne personne, alertée*

L'ingénieur d'astreinte de la politique Payments est appelé, reçoit un SMS et une notification push, avec escalade automatique vers le renfort jusqu'à ce que quelqu'un accuse réception.

![Répondre — l'incident est routé vers l'astreinte et pris en charge](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Communiquer — *les clients tenus informés*

Votre page de statut se met à jour toute seule et chaque abonné est notifié par e-mail et SMS — personne n'a à rédiger la mise à jour à la main.

![Communiquer — la page de statut publique se met à jour et notifie les abonnés](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnostiquer — *cause racine, trouvée*

Traces, logs et métriques sont corrélés jusqu'au span exact : un `SELECT … FOR UPDATE` lent sur `orders`, bloqué par un index manquant.

![Diagnostiquer — la cascade de traces localise le span lent de la base de données](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Corriger automatiquement — *le correctif, rédigé pour vous*

L'agent IA ouvre une pull request avec le correctif, liée à l'incident, avec des tests au vert — vous relisez et fusionnez. Comme un SRE qui ne dort jamais.

![Corriger automatiquement — l'agent IA ouvre une pull request avec le correctif](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Démarrage rapide

### ☁️ OneUptime Cloud — la solution facile

Aucune configuration, toujours à jour, et cela finance le projet open source.

**→ [Inscrivez-vous gratuitement sur oneuptime.com](https://oneuptime.com)**

### 🐳 Auto-hébergement avec Docker Compose

Tout ce dont vous avez besoin sur un seul serveur (Debian / Ubuntu / RHEL, Docker + Docker Compose). Idéal pour les homelabs et les petites équipes — un Raspberry Pi fonctionne même.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime tourne désormais sur **http://localhost** — ouvrez-le et créez votre premier compte.

📖 Guide complet : [Installation avec Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionnement et prérequis](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes avec Helm — pour la production

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Instructions d'installation complètes et valeurs sur [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Vous mettez à niveau une installation existante ?** Consultez le [guide de mise à niveau](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Tout est inclus

| | Fonctionnalité | Ce qu'elle fait |
|---|---|---|
| 📊 | **Surveillance de la disponibilité** | Moniteurs de site web, API, IP, port, SSL, DNS et synthétiques depuis plusieurs régions du monde. |
| 📋 | **Pages de statut** | De superbes pages de statut personnalisées, historique des incidents, maintenance planifiée et notifications aux abonnés. |
| 🚨 | **Gestion des incidents** | Flux d'incident de bout en bout : déclarer, assigner, communiquer, résoudre et mener les post-mortems. |
| 📞 | **Astreinte et alertes** | Plannings d'astreinte et politiques d'escalade avec alertes par SMS, appel téléphonique, push, e-mail et Slack. |
| 📝 | **Gestion des logs** | Ingérer, stocker, rechercher et alerter sur les logs via OpenTelemetry. |
| 🔍 | **APM et traces** | Traces distribuées, spans et tableaux de bord de performance pour repérer les chemins lents et les goulets d'étranglement. |
| 📈 | **Métriques et tableaux de bord** | Tableaux de bord personnalisés sur votre télémétrie — créez les vues dont votre équipe a besoin. |
| 🐛 | **Suivi des erreurs** | Capturez les exceptions avec des traces d'appels complètes, le contexte et le suivi des versions. |
| ⚡ | **Workflows** | Automatisez et intégrez avec Slack, Jira, GitHub, Microsoft Teams et plus de 5 000 applications. |
| 🤖 | **Copilote IA** | Un agent toujours actif qui détecte les anomalies dans les logs, les traces et les métriques, repère les causes racines et ouvre des PR avec des correctifs. |

### ⚡ Automatisez les tâches répétitives

Configurez escalades, tickets et notifications sur un canevas visuel sans code — ou insérez du code personnalisé. L'incident ci-dessus a alerté l'astreinte, ouvert un ticket Jira et publié sur Slack sans que personne ne lève le petit doigt.

![Workflows — un canevas d'automatisation sans code pour l'escalade des incidents](/Home/Static/img/readme/workflows.png?raw=true)

### 🖥️ Surveillance de l'infrastructure

Déployez des agents **basés sur OpenTelemetry** en copier-coller pour surveiller tout ce sur quoi tournent vos services — avec des modèles d'alerte prêts à l'emploi inclus :

- **Serveurs et VM** — CPU, mémoire, disque, réseau, processus et logs depuis Linux, macOS et Windows. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — un seul `helm install` livre les métriques nœud/pod/conteneur/cluster, les événements, les logs, ainsi que les traces eBPF et les cartes de services. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — un seul agent découvre automatiquement chaque conteneur et livre métriques et logs. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — la même découverte automatique par un seul agent via le socket compatible Docker de Podman. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nœuds, VM, conteneurs, stockage, état HA, couverture de sauvegarde et santé de la réplication. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — santé du cluster, prévisions de capacité et visibilité OSD/pool/PG/moniteur. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Idéal pour** | Auto-hébergeurs et petites équipes | Équipes réglementées nécessitant un support premium |
| **Coût** | Gratuit et open source | [Contacter le service commercial](mailto:sales@oneuptime.com) |
| **Fonctionnalités** | Ensemble complet de fonctionnalités | Ensemble complet de fonctionnalités + images renforcées, support prioritaire, fonctionnalités sur mesure et résidence des données |

---

## 💡 Pourquoi OneUptime ?

Notre mission est simple : **réduire les temps d'arrêt et aider davantage de produits à réussir.** Au lieu de bricoler ensemble sept fournisseurs, vous obtenez une seule plateforme qui vous aide à comprendre *pourquoi* les choses cassent, à répondre rapidement aux incidents et à réduire la corvée opérationnelle — entièrement open source, pour que vous soyez propriétaire de vos données et de votre stack.

---

<a name="contributing"></a>

## 🤝 Contribuer

Nous accueillons les contributions de toutes tailles. Commencez ici :

- 🐛 **[Issues ouvertes](https://github.com/OneUptime/oneuptime/issues)** — prenez-en une en charge, ou [ouvrez-en une nouvelle](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Aidez à écrire des tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** pour la base de code
- 🧑‍💻 **[Guide de développement local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** pour vous lancer
- 📖 Lisez les **[directives de contribution](/CONTRIBUTING.md)**
- 💬 Discutez avec nous sur le **[Slack des développeurs](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** ou le **[Slack de la communauté](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Soutenir le projet

Si OneUptime vous est utile :

- ⭐ **Ajoutez une étoile à ce dépôt** — cela aide vraiment les autres à nous trouver
- 💵 **[Parrainez-nous](https://github.com/sponsors/OneUptime)** — chaque dollar livre de nouvelles fonctionnalités
- 🛍️ **[Prenez des goodies](https://shop.oneuptime.com)** — tous les bénéfices financent le développement open source

---

## 📄 Licence

OneUptime est distribué sous la [licence Apache 2.0](/LICENSE).

<div align="center">
  <sub>Réalisé avec ❤️ par l'équipe <a href="https://oneuptime.com">OneUptime</a> et les <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributeurs</a>.</sub>
</div>
