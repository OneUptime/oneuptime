import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker installé sur l'hôte à surveiller",
  "Network access from the host to your OneUptime instance":
    "Un accès réseau de l'hôte vers votre instance OneUptime",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Enregistrez ceci sous `config.yaml` dans le répertoire d'où vous lancerez `docker run` : l'étape 3 le monte dans le conteneur.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` et le montage `/hostfs` permettent aux scrapers `hostmetrics` et `process` de lire les informations de CPU, de mémoire, de disque et de chaque processus dans le noyau de l'hôte plutôt que dans celui du conteneur. Sans eux, vous ne verriez que les métriques du conteneur du collecteur lui-même.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Ouvrez la liste **Hôtes** dans OneUptime : votre hôte apparaît automatiquement dès l'arrivée du premier lot de métriques (en général en moins de 30 secondes). Il n'y est pas ? Vérifiez le collecteur :",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Les investigations IA sont activées par défaut** pour chaque hôte : une fois l'agent IA d'hôte lancé dessus, OneUptime AI y enquête sur les incidents et les alertes avec des commandes en lecture seule comme `systemctl status`, `df -h`, `free -m` et `ps aux`, et ne modifie rien tant que vous n'autorisez pas les correctifs. C'est un conteneur Linux avec son propre installateur, à n'ajouter donc que sur les hôtes Linux ; il lui faut Docker (le moteur système, pas Docker rootless) avec le plugin Compose :",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "La première ligne télécharge le script sous le nom `install.sh`, pour que vous puissiez le lire avant de l'exécuter. Il demande votre URL OneUptime, la clé d'ingestion et le nom de l'hôte : laissez le nom vide pour utiliser le nom d'hôte, celui que remonte ce collecteur. Une fois connecté, il apparaît comme connecté sur la page **IA → Agent IA** de l'hôte et en bas de sa **Vue d'ensemble**. Ce qu'il peut exécuter et comment fonctionnent les correctifs : [Agents IA d'infrastructure](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuration renseigne déjà les adresses IP, les adresses MAC, l'architecture, l'identifiant de machine, la description et la version du système d'exploitation dans l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. Le numéro de série, le fabricant, le modèle et la version du firmware (BIOS / UEFI) sont différents : **aucun détecteur de ressource ne peut les fournir.** Elles proviennent du firmware de la machine, via DMI. Lisez-les une fois lors du provisionnement et inscrivez-les sur la ressource : ajoutez ce processeur à la `config.yaml` que vous avez montée dans le conteneur et nommez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Recréez ensuite le conteneur pour qu'il lise le fichier modifié : supprimez-le et relancez la commande `docker run` de l'étape 3 :",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Ces valeurs sont propres à la machine : elles sont donc écrites une fois par l'outil qui la provisionne. Sous Linux, lisez-les en root (`bios_version` est lisible par tous) :",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "En quelques minutes, les valeurs apparaissent dans l'élément de la machine sous **Inventaire**, dans **Détails**. Elles sont inscrites, pas détectées : relancez donc ceci après un changement de carte mère ou une mise à jour du firmware.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` et `host.bios.version` sont acceptés comme graphies alternatives et enregistrés sous les clés `device.*` ci-dessus (et `device.serial_number` sous `host.serial_number`), pour qu'une configuration écrite d'une façon ou de l'autre aboutisse au même endroit.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Ne définissez pas `device.manufacturer` sur la ressource d'une application mobile et sur celle d'un hôte depuis la même configuration.** Sur une ressource sans `host.name` ni `host.id`, `device.manufacturer` marque toujours le lot comme du Real User Monitoring mobile.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient une étiquette de projet associée à l'hôte (et au service de télémétrie émis par ce collecteur). Modèle : `oneuptime.label.<dimension>=<value>` devient une étiquette nommée `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Ajoutez un processeur `resource` à la `config.yaml` que vous avez montée dans le conteneur et référencez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "L'hôte apparaît avec les étiquettes `team:payments`, `env:production` et `region:us-east-1`. Les étiquettes sont comparées sans tenir compte de la casse : une étiquette `Production` existante créée à la main est donc réutilisée plutôt que dupliquée. Le collecteur ne supprime jamais les étiquettes ajoutées à la main dans l'interface de OneUptime.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Les hôtes sont découverts automatiquement à partir de l'attribut de ressource OTel `host.name`, que définit le processeur `resourcedetection`. OneUptime enregistre l'hôte dès qu'un lot portant `host.name` porte aussi l'un des éléments suivants :",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- des métriques du récepteur `hostmetrics` (CPU, mémoire, disque, système de fichiers, réseau, charge, processus), OU",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- des métriques du scraper `process` (CPU/mémoire/threads par processus), OU",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- un attribut de ressource `os.type` ou `container.runtime`, sur des métriques, des journaux ou des traces",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…et commence à remplir les onglets Vue d'ensemble, Métriques, Processus et Journaux. `host.id` ou `host.arch` seuls n'enregistrent pas d'hôte, et la télémétrie qui porte une identité Kubernetes (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) est classée sous son cluster Kubernetes.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Vous êtes sur OpenStack ?** Utilisez `detectors: [nova, system, env]`, pour que `host.id` soit l'UUID de l'instance et que OneUptime relie cet hôte à son instance, et mettez `host.name` à `enabled: false` sous `nova: resource_attributes:` pour que son nom reste celui que remonte `system`.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Les mêmes attributs de ressource forment l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` et `os.version` viennent tous du processeur `resourcedetection` ; le numéro de série, le fabricant, le modèle et la version du firmware n'ont pas de détecteur et sont inscrits à part (voir **Enregistrer le numéro de série, le fabricant, le modèle et la version du firmware**).",
  "Once the host is reporting:": "Une fois que l'hôte remonte des données :",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- L'onglet **Métriques** affiche les séries temporelles `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- L'onglet **Processus** liste les processus triés par CPU dès que le scraper `process` est activé.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- L'onglet **Journaux** affiche en continu tous les journaux dont les attributs de ressource incluent `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "La configuration indique la version du collecteur pour laquelle elle est écrite (`oneuptime.agent.version`) comme **Version de l'agent** de l'hôte. Quand ce OneUptime épingle une version plus récente, un signe d'avertissement à côté ouvre ces étapes.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Enregistrez de nouveau la configuration de l'étape 2, avec la même clé d'ingestion : elle indique la nouvelle version. Reportez-y toute modification que vous aviez faite à la vôtre.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Dans le dossier qui la contient, installez la nouvelle version et redémarrez le collecteur :",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Lisez les journaux du collecteur à la recherche d'erreurs d'export : `docker logs -f otel-collector`. Un HTTP `401` signifie que la clé manque, est erronée ou a expiré ; `422`, qu'elle a été désactivée (ou que c'est une clé de navigateur, qui ne peut pas envoyer de télémétrie d'hôte). Choisissez une clé valide à l'étape 1 et mettez à jour `x-oneuptime-token` dans la `config.yaml` que vous avez montée dans le conteneur.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Vérifiez que l'hôte joint OneUptime : `curl -v <YOUR_ONEUPTIME_URL>/otlp` depuis la même machine.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Gardez `resourcedetection` dans le pipeline de métriques : c'est lui qui définit `host.name`, ce à quoi OneUptime reconnaît l'hôte.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Le collecteur lit la vue du noyau de son propre conteneur. Lancez-le avec `--network host`, `--pid host`, le montage `/:/hostfs` et les variables `HOST_*` exactement comme le montre l'étape 3 : sans eux, les scrapers `hostmetrics` et `process` ne voient que le conteneur du collecteur lui-même.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Un hôte Debian ou Ubuntu (amd64 ou arm64) avec `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Enregistrez ceci sous `config.yaml` dans votre répertoire courant : l'étape 3 l'installe.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Remarque sur les installations natives :** contrairement à Docker, l'installation par paquet lit `/proc` et `/sys` directement, sans variables d'environnement `HOST_PROC` ni montage `/hostfs`. L'unité systemd livrée avec le paquet s'exécute sous l'utilisateur non privilégié `otelcol-contrib` ; si vous voulez que le scraper `process` voie les processus des autres utilisateurs, accordez-lui `CAP_SYS_PTRACE` ou exécutez-le en root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` intègre le récepteur `systemd` depuis la **v0.142.0** ; utilisez la **v0.143.0 ou une version plus récente**, où sa métrique de CPU a pris son nom actuel et où il a cessé d'interroger les unités qui ne sont pas des services. Activez-le en l'ajoutant à `/etc/otelcol-contrib/config.yaml` et au pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "Then restart the service:": "Redémarrez ensuite le service :",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Le récepteur est **réservé à Linux** et en **alpha**. Il lit l'état des unités sur le D-Bus système avec les mêmes appels en lecture seule que `systemctl list-units`, que systemd autorise sans privilèges, de sorte que le service du paquet, qui s'exécute sous l'utilisateur `otelcol-contrib`, n'a besoin d'aucun droit supplémentaire. Un collecteur conteneurisé ne peut pas joindre le bus de l'hôte : utilisez donc une installation native. Dès que les métriques arrivent, l'onglet **Unités systemd** de l'hôte se remplit de chaque unité collectée et de son état actuel (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Chaque unité coûte huit points de données par collecte pour l'ensemble d'états, plus deux si vous laissez la métrique de CPU activée : sur un hôte qui compte des centaines d'unités, restreignez donc `units:` ou augmentez `collection_interval` plutôt que de tout collecter.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Les investigations IA sont activées par défaut** pour chaque hôte : une fois l'agent IA d'hôte lancé dessus, OneUptime AI y enquête sur les incidents et les alertes avec des commandes en lecture seule comme `systemctl status`, `df -h`, `free -m` et `ps aux`, et ne modifie rien tant que vous n'autorisez pas les correctifs. C'est un conteneur Linux avec son propre installateur ; il lui faut Docker (le moteur système, pas Docker rootless) avec le plugin Compose :",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuration renseigne déjà les adresses IP, les adresses MAC, l'architecture, l'identifiant de machine, la description et la version du système d'exploitation dans l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. Le numéro de série, le fabricant, le modèle et la version du firmware (BIOS / UEFI) sont différents : **aucun détecteur de ressource ne peut les fournir.** Elles proviennent du firmware de la machine, via DMI, et le collecteur du paquet s'exécute sans privilèges : il ne peut donc pas les lire lui-même. Lisez-les une fois lors du provisionnement et inscrivez-les sur la ressource : ajoutez ce processeur à `/etc/otelcol-contrib/config.yaml` et nommez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Ajoutez un processeur `resource` à `/etc/otelcol-contrib/config.yaml` et référencez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- L'onglet **Unités systemd** liste l'état des unités dès que le récepteur `systemd` est activé (voir **Activer l'onglet Unités systemd**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Lisez les journaux du collecteur à la recherche d'erreurs d'export : `sudo journalctl -u otelcol-contrib -f`. Un HTTP `401` signifie que la clé manque, est erronée ou a expiré ; `422`, qu'elle a été désactivée (ou que c'est une clé de navigateur, qui ne peut pas envoyer de télémétrie d'hôte). Choisissez une clé valide à l'étape 1 et mettez à jour `x-oneuptime-token` dans `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Gardez `resourcedetection` dans le même pipeline de métriques que le récepteur `systemd` : le récepteur n'associe que `systemd.unit.name` à chaque unité, donc sans `host.name` les échantillons ne sont jamais rattachés à l'hôte.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Utilisez `otelcol-contrib` v0.143.0 ou plus récent : les builds plus anciens s'arrêtent au démarrage avec `'receivers' unknown type: \"systemd\"`, ou nomment autrement la métrique de CPU (voir **Activer l'onglet Unités systemd**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Vérifiez que le collecteur joint le D-Bus système : `/run/dbus/system_bus_socket` doit exister, et `systemctl list-units` lancé sous l'utilisateur du collecteur est le test le plus rapide. Root n'est pas nécessaire.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Un hôte RHEL, CentOS, Fedora ou Amazon Linux (x86_64 ou aarch64) avec `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Un hôte Linux (x86_64 ou aarch64) qui utilise systemd, avec `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Déposez une unité systemd dans `/etc/systemd/system/otelcol-contrib.service` :",
  "Then enable and start it:": "Activez-la et démarrez-la ensuite :",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Utilisez cette méthode quand les paquets ne sont pas disponibles : serveurs verrouillés, ou images de base de conteneurs que vous voulez instrumenter de l'extérieur. Aucune variable d'environnement `HOST_PROC` ni montage `/hostfs` n'est nécessaire : le collecteur lit l'état du noyau directement, et `User=root` permet au scraper `process` de voir les processus des autres utilisateurs (accorder `CAP_SYS_PTRACE` fonctionne aussi).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Le récepteur est **réservé à Linux** et en **alpha**. Il lit l'état des unités sur le D-Bus système avec les mêmes appels en lecture seule que `systemctl list-units`, que systemd autorise sans privilèges, il n'a donc besoin d'aucun droit supplémentaire. Un collecteur conteneurisé ne peut pas joindre le bus de l'hôte : utilisez donc une installation native. Dès que les métriques arrivent, l'onglet **Unités systemd** de l'hôte se remplit de chaque unité collectée et de son état actuel (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuration renseigne déjà les adresses IP, les adresses MAC, l'architecture, l'identifiant de machine, la description et la version du système d'exploitation dans l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. Le numéro de série, le fabricant, le modèle et la version du firmware (BIOS / UEFI) sont différents : **aucun détecteur de ressource ne peut les fournir.** Elles proviennent du firmware de la machine, via DMI. Lisez-les une fois lors du provisionnement et inscrivez-les sur la ressource : ajoutez ce processeur à `/opt/otelcol-contrib/config.yaml` et nommez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Un Mac (Apple Silicon ou Intel) et un compte administrateur pour `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Créez `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` :",
  "Load it:": "Chargez-le :",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installez la version contrib, comme ci-dessus.** La version core `otelcol` n'a pas de processeur `resourcedetection` et refuse donc de démarrer avec cette configuration.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configuration renseigne déjà les adresses IP, les adresses MAC, l'architecture, l'identifiant de machine, la description et la version du système d'exploitation dans l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. Le numéro de série, le fabricant, le modèle et la version du firmware (BIOS / UEFI) sont différents : **aucun détecteur de ressource ne peut les fournir.** Elles proviennent du firmware de la machine. Lisez-les une fois lors du provisionnement et inscrivez-les sur la ressource : ajoutez ce processeur à `/etc/otelcol-contrib/config.yaml` et nommez-le dans le pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "Then restart the collector:": "Redémarrez ensuite le collecteur :",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Ces valeurs sont propres à la machine : elles sont donc écrites une fois par l'outil qui la provisionne. Sur un Mac, lisez-les ainsi (le fabricant est `Apple Inc.`) :",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` est l'*identifiant* du modèle (`MacBookPro18,3`), pas son nom commercial. Mettez-le quand même dans `device.model.name` : `device.model.identifier` marque un lot comme une application mobile.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ ou Windows Server 2019+ (pour le `tar.exe` intégré)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Une invite PowerShell avec élévation (Exécuter en tant qu'administrateur)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Enregistrez ceci sous `config.yaml` dans le dossier d'où vous lancerez les commandes PowerShell : l'étape 3 le copie à sa place.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Sous Windows, installez le collecteur amont **`otelcol-contrib`** : depuis la **v0.155.0**, il intègre le récepteur `windows_service` qui alimente l'onglet **Services** de l'hôte. Exécutez depuis une invite PowerShell avec élévation :",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Remarque :** le service s'exécute en tant que `LocalSystem` pour pouvoir lire chaque service Windows. Sous Windows, le scraper `load` ne fait qu'émuler une charge moyenne à partir du compteur *Processor Queue Length* (il part de 0) ; s'il ne peut pas lire ce compteur, c'est journalisé et ignoré, et le reste de la configuration `hostmetrics` fonctionne sans changement. La [documentation du collecteur OpenTelemetry pour hôte](/docs/telemetry/host-otel-collector) couvre aussi l'installateur `.msi` signé.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Les journaux sont écrits dans le journal d'événements Application de Windows ; consultez-les dans **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Depuis la **v0.155.0**, `otelcol-contrib` inclut le récepteur `windows_service` : activez-le en l'ajoutant à `C:\\Program Files\\otelcol-contrib\\config.yaml` et au pipeline de métriques. Fusionnez-le dans les sections que votre configuration contient déjà : n'ajoutez pas une deuxième clé `processors:` ou `service:`.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Le récepteur est **réservé à Windows** et en **alpha**. Dès que les métriques arrivent, l'onglet **Services** de l'hôte se remplit automatiquement de l'état d'exécution et du type de démarrage de chaque service.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "La configuration renseigne déjà les adresses IP, les adresses MAC, l'architecture, l'identifiant de machine, la description et la version du système d'exploitation dans l'élément de la machine sous **Inventaire**, celui que lit un export CMDB. Le numéro de série, le fabricant, le modèle et la version du firmware (BIOS / UEFI) sont différents : **aucun détecteur de ressource ne peut les fournir.** Elles proviennent du firmware de la machine, via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Exécutez ceci depuis une invite PowerShell avec élévation sur la machine : il interroge WMI et affiche le YAML exact de *cette* machine :",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Il affiche une entrée de processeur, déjà indentée. Ajoutez-la dans le bloc `processors:` que votre `config.yaml` contient déjà, à côté de `resourcedetection:`, `resource:` et `batch:`, pas comme une deuxième clé `processors:`, puis nommez-la dans le pipeline de métriques :",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Utilisez `Get-CimInstance`, pas l'obsolète `Get-WmiObject`, absent de PowerShell 7 et des versions suivantes. Les valeurs sont émises entre guillemets simples, chaque guillemet intégré doublé, pour qu'un numéro de série ou un modèle contenant de la ponctuation reste du YAML valide. Un champ que le firmware laisse vide s'affiche comme `''` ; retirez cet attribut plutôt que d'en envoyer un vide.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "En quelques minutes, l'élément de la machine sous **Inventaire** affiche dans **Détails** `host.serial_number`, `device.manufacturer`, `device.model.name` et `device.firmware.version`, à côté des adresses IP et MAC et de l'identifiant de machine que le détecteur fournit déjà. Relancez ceci après un changement de carte mère ou une mise à jour du BIOS : les valeurs sont inscrites, pas détectées, elles ne se mettent donc pas à jour d'elles-mêmes.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- L'onglet **Services** liste l'état de chaque service dès que le récepteur `windows_service` est activé (voir **Activer l'onglet Services Windows**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Lisez les journaux du collecteur à la recherche d'erreurs d'export : **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). Un HTTP `401` signifie que la clé manque, est erronée ou a expiré ; `422`, qu'elle a été désactivée (ou que c'est une clé de navigateur, qui ne peut pas envoyer de télémétrie d'hôte). Choisissez une clé valide à l'étape 1 et mettez à jour `x-oneuptime-token` dans `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Lancez le collecteur au premier plan pour voir la véritable erreur plutôt que le générique `Error 1064` :",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    "2. `Error 2: The system cannot find the file specified` signifie que le service pointe vers un fichier qui n'existe pas : comparez `BINARY_PATH_NAME` de `sc.exe qc \"otelcol-contrib\"` avec le contenu de `C:\\Program Files\\otelcol-contrib`. L'archive doit être celle en `otelcol-contrib_`, qui décompresse `otelcol-contrib.exe`.",
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) consigne l'erreur de démarrage que le gestionnaire de services a avalée.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Si vous définissez `include_services` mais voyez toujours tous les services, le collecteur n'a pas pris en compte la modification : redémarrez le service (`Restart-Service otelcol-contrib`) et laissez quelques minutes à l'onglet Services pour rafraîchir sa fenêtre glissante.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Les nœuds Kubernetes sont surveillés par l'**agent Kubernetes de OneUptime** plutôt que par un collecteur d'hôte : chaque nœud apparaît sous **Kubernetes** → votre cluster → **Nœuds**, à côté de ses pods et de ses workloads, et non dans la liste **Hôtes**. Les étapes ci-dessous installent l'agent sur un cluster standard ; le guide d'installation de la section **Kubernetes** donne les étapes pour Amazon EKS, Google GKE, Azure AKS, GKE Autopilot et EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Un cluster Kubernetes en v1.23 ou ultérieure",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` et `helm` (v3) installés sur votre machine",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Mauvais cluster ? Changez-en avec `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Remplacez `my-cluster` par un nom pour ce cluster, par exemple `prod-us-east-1`. C'est sous ce nom que le cluster apparaît dans OneUptime : gardez-le donc stable, car un nouveau nom enregistre un nouveau cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` active les **enquêtes IA**, comme le fait le chart par défaut : OneUptime AI enquête sur les incidents et les alertes de ce cluster avec kubectl en lecture seule, via l'agent IA Kubernetes.",
  "You should see:": "Vous devriez voir :",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Le collecteur et l'agent IA Kubernetes, plus un pod `-logs` et un pod `-ebpf` sur chaque nœud. Une fois qu'ils sont `Running`, le cluster apparaît automatiquement dans la section **Kubernetes**, généralement en une ou deux minutes.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agent IA Kubernetes (activé par défaut, en lecture seule).** Le pod `kubernetes-agent-ai-agent` permet à OneUptime AI d'enquêter sur les incidents et les alertes de ce cluster avec kubectl en lecture seule (`get`, `describe`, `logs`, `events`, `top`), avec la même clé d'API, et il ne peut rien modifier tant que vous ne lui donnez pas d'accès en écriture. Ouvrez le cluster et allez dans **IA → Agent** pour le voir. Vous n'en voulez pas ? Installez avec `--set aiAgent.enabled=false` au lieu de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Les règles d'espaces de noms décident de ce que l'agent collecte dans chaque espace de noms. Pour ne collecter les journaux de pods et les données eBPF que de `default`, `production` et `staging` :",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Pour tout garder mais couper les journaux des espaces de noms bruyants, excluez-les uniquement de `podLogs` :",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Portées :** `podLogs` (stdout/stderr des conteneurs), `ebpfDiscovery` (traces et métriques eBPF), `metrics` (métriques des espaces de noms) et `traces` (tous les spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Les **motifs** portent sur le nom complet de l'espace de noms et acceptent `*`, comme dans `team-*`. Une règle `exclude` l'emporte toujours sur une règle `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Définir les règles remplace la règle par défaut**, qui exclut `kube-system` de `podLogs` et `ebpfDiscovery`. Gardez-la dans votre liste, comme dans le second exemple, si vous la voulez toujours.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Les métriques de nœud et de cluster n'ont pas d'espace de noms : elles sont donc toujours conservées.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` nécessite Helm 3.10 ou ultérieur.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**N'envoyer que les lignes importantes.** Écartez les lignes de journal des pods sous une gravité donnée avant qu'elles ne quittent le cluster :",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepte `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` et `FATAL` : `WARN` garde les avertissements, les erreurs et les lignes fatales. La gravité est lue dans la ligne de journal elle-même (`[ERROR]`, `level=warn`, `"level":"info"`). Les événements Kubernetes ne sont jamais écartés par ce réglage.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Couper les journaux de pods.** Les métriques ne sont pas touchées : le collecteur de nœuds continue de tourner pour les métriques kubelet et cAdvisor, il cesse seulement de lire les journaux de pods :",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Changer la façon dont les journaux sont lus.** Le preset choisit pour vous ; un `logs.mode` explicite l'emporte toujours :",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset` : lit `/var/log/pods` sur chaque nœud via hostPath (surcoût le plus faible ; nécessite hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api` : un Deployment suit les journaux de pods via l'API Kubernetes (fonctionne sur tout cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled` : aucun journal de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Cela lit le serveur d'API, là où il répond à l'intérieur du cluster. etcd, le planificateur et le gestionnaire de contrôleurs répondent sur les nœuds du plan de contrôle, que le pod de l'agent ne peut pas deviner : il les lit donc dès que vous indiquez l'adresse de chaque nœud :",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Le planificateur et le gestionnaire de contrôleurs** servent du HTTPS et acceptent le jeton de l'agent, mais kubeadm les lie à `127.0.0.1` : donnez-leur une `--bind-address` que le pod de l'agent peut joindre.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** sert ses métriques en HTTP simple sur les `--listen-metrics-urls` de kubeadm (port 2381, lié à `127.0.0.1` tant que vous n'ajoutez pas l'adresse du nœud), comme ci-dessus. Ou interrogez son port client HTTPS, 2379, avec le certificat client qu'il demande : placez `ca.crt`, `tls.crt` et `tls.key` dans un Secret de `oneuptime-agent` et indiquez-le dans `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Uniquement pour les clusters autogérés : les services managés (EKS, GKE, AKS) n'exposent pas les métriques de leur plan de contrôle.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "La surveillance des coûts est activée par défaut : l'agent embarque le moteur open source OpenCost (plus le petit Prometheus dont il a besoin), chiffre vos nœuds et vos volumes d'après les prix catalogue publics de votre fournisseur cloud, sans identifiants, et envoie ce que coûte chaque espace de noms et chaque charge de travail. Les premières données apparaissent sur la vue d'ensemble du cluster et sur sa page Coûts après la première heure complète.",
  "On an agent installed before it was on by default, upgrade it:":
    "Sur un agent installé avant qu'elle ne soit activée par défaut, mettez-le à niveau :",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Pour la désactiver :** ajoutez `--set cost.enabled=false` à la même mise à niveau.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Vous utilisez déjà Kubecost ou OpenCost ?** L'agent le détecte et le lit à la place du moteur embarqué, et la vue d'ensemble du cluster l'indique : ajoutez `--set cost.engine.url=auto` pour ne plus en embarquer un second.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Sur site ou bare metal ?** Définissez une grille tarifaire avec `--set cost.opencost.customPricing.enabled=true` (USD par heure de ressource, voir le `values.yaml` du chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guide complet : [Observabilité des coûts Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "L'agent exécute [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) sur chaque nœud. Il capture le trafic HTTP/HTTPS, gRPC et SQL/Redis des services Go, .NET, Java, Node.js, Python, Ruby et Rust, sans SDK ni sidecar, et envoie les traces, les métriques de requêtes (RED) et les données du graphe de services via le collecteur.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Exigences :** noyau Linux **5.8+** avec BTF (par défaut sur Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Les pods eBPF s'exécutent en mode **privilégié**, nécessaire pour charger des programmes eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Désactivez-le** si vos nœuds ont un noyau plus ancien, si les pods privilégiés ne sont pas autorisés, ou si vos services envoient déjà des traces avec des SDK OpenTelemetry et que vous ne voulez pas de doublons :",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Choisir les signaux.** Chaque famille s'active ou se désactive avec `--set ebpf.features.<name>=false` (ou `=true`) :",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Par défaut | Ce qu'elle ajoute |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | activée | Débit de requêtes HTTP/gRPC, erreurs et latence par service |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | activée | Nombre d'appels et durée des spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | activée | Arêtes appelant → appelé ; alimente la carte des services |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | activée | Compteurs de flux TCP/UDP de pod à pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | désactivée | Métriques réseau entre zones (double leur cardinalité) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | activée | RTT TCP et compteurs de connexions échouées et de retransmissions par nœud |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagation des traces entre services** (relier en une seule trace une requête qui va du pod A → pod B, y compris sur un autre nœud) est **activée par défaut**. Elle fonctionne en réécrivant le trafic déjà en cours (en élargissant les requêtes HTTP en clair dans le noyau et en ajoutant une option TCP au TLS et au TCP brut), et une erreur dans ce décompte d'octets désynchronise le flux : le symptôme signalé est un transfert via un proxy L7 comme nginx qui se bloque dès qu'une réponse dépasse ~64KB. Si vous le constatez, ou si un service mesh fait échouer des pods, désactivez-la avec `--set ebpf.contextPropagation=false` ; un SDK OpenTelemetry propage `traceparent` dans l'espace utilisateur sans rien de tout cela.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Chaque `oneuptime.labels.<key>=<value>` devient le label `<key>:<value>` sur le cluster, ainsi que sur les services et les hôtes qu'il signale. Les labels sont comparés sans tenir compte de la casse : un label `Production` existant est donc réutilisé ; les labels ajoutés dans l'interface de OneUptime ne sont jamais supprimés par l'agent.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Mettez à niveau** vers le dernier chart. `--reset-then-reuse-values` (Helm 3.14+) garde les valeurs que vous avez définies (preset, nom du cluster, filtres) et prend tout le reste dans le nouveau chart ; ajoutez par-dessus les nouveaux indicateurs `--set` :",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Avec Helm 3.13 et antérieur, mettez plutôt à niveau avec les valeurs que vous avez définies :",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "N'utilisez pas `--reuse-values` : il garde aussi les valeurs par défaut du chart d'origine, si bien que les valeurs par défaut d'un chart plus récent (dont son image eBPF) ne s'appliquent jamais.",
  "**Uninstall** the agent and its namespace:":
    "**Désinstallez** l'agent et son espace de noms :",
  "| Category | Data |": "| Catégorie | Données |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métriques des nœuds** | Utilisation du CPU, de la mémoire, du système de fichiers et du réseau |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métriques des pods et des conteneurs** | CPU, mémoire, E/S réseau et redémarrages |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métriques du cluster** | État des nœuds, ressources allouables, nombre de pods et de charges de travail |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Événements Kubernetes** | Avertissements, erreurs et événements de planification |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Journaux de pods** | stdout/stderr de chaque conteneur, lus sur chaque nœud |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Traces applicatives** *(eBPF)* | Spans HTTP, gRPC et SQL/Redis de chaque pod, sans SDK ni modification du code |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métriques de requêtes et graphe de services** *(eBPF)* | Débit de requêtes, erreurs et latence par service, et arêtes appelant → appelé pour la carte des services |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flux réseau** *(eBPF)* | Compteurs d'octets et de paquets TCP/UDP de pod à pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Coûts des charges de travail** *(activés par défaut)* | Dépenses par espace de noms, charge de travail et pod, avec la capacité inutilisée et l'efficacité, également sous forme de métriques sur lesquelles déclencher des alertes |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Votre cluster bloque les volumes `hostPath` ou les pods privilégiés. C'est normal sur **GKE Autopilot** et **EKS Fargate** : choisissez cette plateforme en haut de ce guide et suivez ses étapes. Sur **OpenShift**, l'installation réussit au contraire, mais les pods de nœud de l'agent ne démarrent jamais : choisissez **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Sur tout autre cluster doté d'une politique Pod Security restrictive, supprimez la release qui a échoué :",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Relancez ensuite la commande d'installation en ajoutant `--set preset=gke-autopilot`. Ce preset lit les journaux de pods via l'API Kubernetes au lieu de hostPath, applique un contexte de sécurité renforcé et laisse de côté les pods privilégiés d'eBPF et de profilage.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Vérifiez que les pods de l'agent tournent : `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Consultez les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de la commande d'installation sont correctes.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Assurez-vous que le cluster peut joindre votre instance OneUptime par le réseau.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Vérifiez le pod de l'agent IA : `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Consultez ses journaux : `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Aucun pod ? Mettez à niveau le chart (voir **Mettre à niveau ou désinstaller l'agent** sous Avancé) et ajoutez `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Vérifiez que le nom du cluster correspond : ce guide installe **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Vérifiez les permissions RBAC de l'agent : `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Cherchez des erreurs d'export dans les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Noyau trop ancien ou sans BTF.** eBPF nécessite Linux 5.8+ avec BTF ; vérifiez avec `uname -r` sur un nœud. Si vous ne pouvez pas mettre à niveau, désactivez eBPF avec `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods privilégiés bloqués.** Certains clusters verrouillés les refusent. Désactivez eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` indisponibles sur l'hôte.** Désactivez seulement la famille des statistiques TCP : `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Vérifiez que les pods eBPF sont en bonne santé : `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Activez la sortie de débogage d'OBI pour confirmer qu'il voit du trafic : `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, puis lisez `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Si des spans apparaissent là mais pas dans OneUptime, cherchez des erreurs d'export dans les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
