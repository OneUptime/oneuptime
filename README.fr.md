<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Logo OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Une seule plateforme open source pour la disponibilité, les incidents, les astreintes, les pages de statut, les logs, les traces, les métriques et l'APM.</h3>

  <p>Supervision, StatusPage, Astreintes, Incidents, Logs et APM — remplacez toute une étagère d'outils SaaS par une seule plateforme que vous pouvez héberger gratuitement.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Site web</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Documentation</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Démarrage rapide</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Tarifs</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Contribuer</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Essayez OneUptime Cloud — offre gratuite à vie, sans carte bancaire →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Tableau de bord OneUptime" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Remplacez toute votre stack d'observabilité

OneUptime réunit la supervision, les alertes, la réponse aux incidents et l'observabilité dans une seule application open source — pour que vous cessiez de payer (et d'assembler) une douzaine d'outils distincts.

| Au lieu de… | Utilisez OneUptime pour… |
|---|---|
| Pingdom / UptimeRobot | **Supervision de la disponibilité** — contrôles de sites web, d'API, ping, port, SSL, DNS et tests synthétiques depuis le monde entier |
| StatusPage.io | **Pages de statut** — pages de statut publiques et privées personnalisées avec abonnés |
| PagerDuty / Opsgenie | **Astreintes et alertes** — plannings, politiques d'escalade, SMS / appel / push / Slack |
| Incident.io | **Gestion des incidents** — déclarer, trier, communiquer et faire le post-mortem |
| Datadog / New Relic | **APM et métriques** — traces, tableaux de bord et performances des services |
| Loggly | **Gestion des logs** — collecter, rechercher et alerter sur les logs |
| Sentry | **Suivi des erreurs** — exceptions avec traces de pile et contexte complets |

Le tout est **100 % open source (Apache 2.0)** et gratuit à héberger soi-même.

---

<a name="quick-start"></a>

## ⚡ Démarrage rapide

### ☁️ OneUptime Cloud — la solution simple

Aucune configuration, toujours à jour, et cela finance le projet open source.

**→ [Inscrivez-vous gratuitement sur oneuptime.com](https://oneuptime.com)**

### 🐳 Auto-hébergement avec Docker Compose

Tout ce dont vous avez besoin sur un seul serveur (Debian / Ubuntu / RHEL, Docker + Docker Compose). Idéal pour les homelabs et les petites équipes — un Raspberry Pi suffit même.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime tourne maintenant sur **http://localhost** — ouvrez-le et créez votre premier compte.

📖 Guide complet : [Installation avec Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionnement et prérequis](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes avec Helm — pour la production

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Instructions d'installation complètes et valeurs sur [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Vous mettez à jour une installation existante ?** Consultez le [guide de mise à niveau](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Fonctionnalités

| | Fonctionnalité | Ce que ça fait |
|---|---|---|
| 📊 | **Supervision de la disponibilité** | Moniteurs de sites web, d'API, d'IP, de port, SSL, DNS et synthétiques depuis plusieurs régions mondiales. |
| 📋 | **Pages de statut** | De superbes pages de statut personnalisées, l'historique des incidents, la maintenance planifiée et les notifications aux abonnés. |
| 🚨 | **Gestion des incidents** | Un flux d'incident de bout en bout : déclarer, assigner, communiquer, résoudre et mener des post-mortems. |
| 📞 | **Astreintes et alertes** | Plannings d'astreinte et politiques d'escalade avec alertes par SMS, appel téléphonique, push, e-mail et Slack. |
| 📝 | **Gestion des logs** | Ingérez, stockez, recherchez et alertez sur les logs via OpenTelemetry. |
| 🔍 | **APM et traces** | Traces distribuées, spans et tableaux de bord de performance pour repérer les chemins lents et les goulets d'étranglement. |
| 📈 | **Métriques et tableaux de bord** | Tableaux de bord personnalisés sur votre télémétrie — construisez les vues dont votre équipe a besoin. |
| 🐛 | **Suivi des erreurs** | Capturez les exceptions avec des traces de pile complètes, du contexte et le suivi des versions. |
| ⚡ | **Workflows** | Automatisez et intégrez avec Slack, Jira, GitHub, Microsoft Teams et plus de 5 000 applications. |
| 🤖 | **Copilote IA** | Un agent toujours actif qui détecte les anomalies dans les logs, traces et métriques, identifie les causes racines et ouvre des PR avec des correctifs. |

### 🖥️ Supervision de l'infrastructure

Déployez des agents copier-coller **basés sur OpenTelemetry** pour surveiller tout ce sur quoi vos services s'exécutent — avec des modèles d'alerte prêts à l'emploi inclus :

- **Serveurs et VM** — CPU, mémoire, disque, réseau, processus et logs sous Linux, macOS et Windows. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — un seul `helm install` fournit les métriques nœud/pod/conteneur/cluster, les événements, les logs, ainsi que les traces eBPF et les cartes de services. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — un seul agent détecte automatiquement chaque conteneur et expédie métriques et logs. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — la même auto-découverte par agent unique via le socket compatible Docker de Podman. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nœuds, VM, conteneurs, stockage, état HA, couverture des sauvegardes et santé de la réplication. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — santé du cluster, prévisions de capacité et visibilité sur les OSD/pools/PG/moniteurs. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Voir les captures d'écran</b></summary>
<br/>

**Supervision de la disponibilité**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Pages de statut**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Gestion des incidents**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Astreintes et alertes**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Gestion des logs**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Supervision des performances applicatives**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Workflows**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Idéal pour** | Auto-hébergeurs et petites équipes | Équipes réglementées nécessitant un support premium |
| **Coût** | Gratuit et open source | [Contacter le service commercial](mailto:sales@oneuptime.com) |
| **Fonctionnalités** | Ensemble complet de fonctionnalités | Ensemble complet de fonctionnalités + images renforcées, support prioritaire, fonctionnalités sur mesure et résidence des données |

---

## 💡 Pourquoi OneUptime ?

Notre mission est simple : **réduire les temps d'arrêt et aider davantage de produits à réussir.** Au lieu de bricoler ensemble sept fournisseurs, vous obtenez une seule plateforme qui vous aide à comprendre *pourquoi* les choses cassent, à répondre rapidement aux incidents et à réduire la charge opérationnelle — entièrement open source, pour que vous soyez propriétaire de vos données et de votre stack.

---

<a name="contributing"></a>

## 🤝 Contribuer

Nous accueillons les contributions de toutes tailles. Commencez ici :

- 🐛 **[Issues ouvertes](https://github.com/OneUptime/oneuptime/issues)** — prenez-en une, ou [ouvrez-en une nouvelle](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Aidez à écrire des tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** pour la base de code
- 🧑‍💻 **[Guide de développement local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** pour tout configurer
- 📖 Lisez les **[consignes de contribution](CONTRIBUTING.md)**
- 💬 Discutez avec nous sur le **[Slack développeurs](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** ou le **[Slack communauté](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Soutenir le projet

Si OneUptime vous est utile :

- ⭐ **Mettez une étoile à ce dépôt** — cela aide vraiment les autres à nous trouver
- 💵 **[Devenez sponsor](https://github.com/sponsors/OneUptime)** — chaque dollar fait avancer de nouvelles fonctionnalités
- 🛍️ **[Procurez-vous des goodies](https://shop.oneuptime.com)** — tous les bénéfices financent le développement open source

---

## 📄 Licence

OneUptime est distribué sous la [licence Apache 2.0](LICENSE).

<div align="center">
  <sub>Fait avec ❤️ par l'équipe <a href="https://oneuptime.com">OneUptime</a> et les <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributeurs</a>.</sub>
</div>
