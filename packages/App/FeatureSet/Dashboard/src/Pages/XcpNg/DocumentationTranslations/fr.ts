import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 ou version ultérieure, connecté aux pools que vous voulez surveiller. Son plugin OpenMetrics nécessite une licence Premium sur une XOA ; Xen Orchestra compilé depuis les sources l'inclut",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui peut joindre Xen Orchestra en HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Un certificat sur Xen Orchestra qui nomme l'adresse à laquelle l'agent se connecte. Le certificat autosigné que Xen Orchestra crée pour lui-même n'en nomme aucune, si bien qu'aucun client TLS actuel ne peut le vérifier — voir **Certificat de Xen Orchestra** sous Avancé",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Dans Xen Orchestra, ouvrez *Settings → Plugins* et trouvez **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Activez-le. Au premier démarrage, il crée un secret et le conserve, et Xen Orchestra le conserve d'un redémarrage à l'autre.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Ouvrez les paramètres du plugin et copiez son **Prometheus secret** — vous le donnez à l'agent à l'étape suivante. Vous pouvez aussi y saisir un secret de votre choix et l'enregistrer.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Le plugin répond sur l'adresse et avec le certificat propres à Xen Orchestra, à `/openmetrics/metrics`, et uniquement à une requête qui porte son secret. Il sert chaque pool auquel Xen Orchestra est connecté, si bien qu'un seul agent les couvre tous.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Le script demande votre URL OneUptime et votre clé d'ingestion, toutes deux affichées à l'étape 1 (choisissez-y une clé pour qu'elles soient remplies ici), puis :",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Adresse de Xen Orchestra** — telle que vous l'ouvrez dans un navigateur, par ex. `https://xo.example.com` ou `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Secret du plugin OpenMetrics** — celui de l'étape précédente. Il ne s'affiche pas pendant la saisie.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Nom de ce Xen Orchestra** — le nom que chacun de ses pools affiche dans ses Paramètres. Appuyez sur Entrée pour utiliser son adresse.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Le script lit ensuite le certificat de Xen Orchestra. Si cette machine lui fait déjà confiance, l'agent fait confiance au même bundle de CA. Sinon, le script affiche l'empreinte SHA-256 du certificat : comparez-la avec celle de la machine de Xen Orchestra et répondez **y** pour faire confiance à ce certificat et à rien d'autre. Il ne désactive jamais la vérification. Il demande ensuite ses métriques au plugin avec le secret et indique quels pools Xen Orchestra rapporte, avant d'installer quoi que ce soit.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Il s'installe dans `/opt/oneuptime-xcp-ng-agent`, écrit un fichier `.env` en `0600` et démarre l'agent avec Docker Compose. Relancer le script réutilise tout ce qui se trouve dans ce `.env` au lieu de redemander : c'est aussi ainsi que vous mettez à niveau.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` liste `oneuptime-xcp-ng-agent`. Dans ses journaux, cherchez `Everything is ready. Begin running and processing data.` L'agent lit Xen Orchestra chaque minute, et chaque pool qu'il rapporte apparaît ensuite dans la section **XCP-ng** sous le nom que Xen Orchestra lui donne, avec ses hôtes, ses VM et son stockage.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Le script d'installation les écrit dans `/opt/oneuptime-xcp-ng-agent/.env`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Oui | La clé d'ingestion de télémétrie, celle choisie à l'étape 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Oui | Le `host` ou le `host:port` de Xen Orchestra, sans schéma |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Non | `https` (par défaut). `http` seulement dans un labo : le secret traverse alors le réseau en clair |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Oui | Le secret du plugin OpenMetrics, envoyé comme jeton Bearer. Chaque `$` qu'il contient s'écrit `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Non | Le nom de ce Xen Orchestra dans OneUptime, affiché dans les Paramètres de chacun de ses pools (par défaut : son adresse) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Non | Le nom avec lequel le certificat de Xen Orchestra est vérifié, quand `XO_ADDRESS` est une adresse que le certificat ne liste pas |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent (par défaut : `oneuptime-xcp-ng-agent`). L'agent d'un second Xen Orchestra sur la même machine a besoin du sien : le script d'installation nomme un nouvel agent d'après son dossier, sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Script d'installation | L'adresse de Xen Orchestra telle que saisie ; le script en déduit `XO_SCHEME` et `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Script d'installation | L'empreinte SHA-256 du certificat propre à Xen Orchestra, quand l'agent fait confiance à ce certificat et à rien d'autre |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Script d'installation | Un bundle de CA qui a émis le certificat de Xen Orchestra, que le script copie dans `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | Non | Un jeton d'un utilisateur Xen Orchestra qui détient une copie du rôle intégré **Read only** et rien d'autre : l'agent IA XCP-ng s'exécute quand il est défini, et lit avec lui |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | Non | Uniquement pour les correctifs : un jeton d'un autre utilisateur, dont le rôle les autorise. Sans lui, l'agent IA ne modifie rien |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | Non | L'UUID XAPI du pool que sert l'agent IA (par défaut : le seul pool que son jeton de lecture peut voir) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Non | Remplace `XCP_NG_POOL_ID` comme pool sous lequel l'agent IA s'enregistre |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | Non | `true` ou `false` : si OneUptime AI peut exécuter les commandes en lecture seule de l'agent IA pendant qu'elle enquête (par défaut : activé) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | Non | `off`, `ask-for-approval`, `automatic` ou `bypass-approval` : comment OneUptime AI peut appliquer un correctif |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | Non | `true` permet à l'agent IA d'appliquer des correctifs, avec le jeton pour les modifications. Toute autre valeur le laisse en lecture seule |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Non | Les `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` ou `schedule/<uuid>` qu'un correctif peut toucher, séparés par des virgules (par défaut : tous) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Non | De même, pour ce que OneUptime AI ne doit jamais modifier : la VM dans laquelle s'exécute l'agent IA, et celle de Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | Non | Le niveau de journalisation de l'agent IA : `debug`, `info` (par défaut), `warn` ou `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | Non | `xcp-ng-ai-agent` démarre l'agent IA ; le script d'installation l'écrit quand le jeton de lecture est défini |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent IA (par défaut : `oneuptime-xcp-ng-ai-agent`). Le script d'installation nomme l'agent IA d'un second Xen Orchestra d'après son collecteur (`oneuptime-xcp-ng-ai-agent-lab` à côté de `oneuptime-xcp-ng-agent-lab`), sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "L'agent vérifie le certificat de Xen Orchestra avec `xo-ca.pem`, à côté de `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "L'agent vérifie le certificat de Xen Orchestra à chaque lecture, avec `xo-ca.pem` et rien d'autre. Ce fichier contient l'une de ces trois choses :",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Le certificat propre à Xen Orchestra**, épinglé par son empreinte SHA-256 (`XO_TLS_FINGERPRINT`) : l'agent fait confiance à ce certificat et à aucun autre.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **La CA qui l'a émis** (`XO_CA_FILE`), pour un certificat émis par une CA à vous.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Le bundle de CA de cette machine**, pour un certificat auquel cette machine fait déjà confiance.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "Dans tous les cas, le certificat doit nommer l'adresse à laquelle l'agent se connecte : l'agent vérifie les noms pour lesquels un certificat est émis, comme le fait tout client TLS actuel, et non son sujet. Le certificat autosigné que Xen Orchestra crée pour lui-même n'en nomme aucun : l'agent ne peut donc pas lui faire confiance, épinglé ou non, et échoue avec `x509: certificate is not valid for any names`. Donnez à Xen Orchestra un certificat qui nomme son adresse — émis par votre CA, ou autosigné avec un nom alternatif du sujet (subject alternative name) —, comme le montre [Le certificat de Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Quand le certificat nomme Xen Orchestra par un autre nom que l'adresse de `XO_ADDRESS`, définissez `XO_TLS_SERVER_NAME` sur ce nom. Quand un certificat épinglé est renouvelé, l'agent cesse de lire Xen Orchestra jusqu'à ce qu'il fasse confiance au nouveau. Relancez le script d'installation : il affiche la nouvelle empreinte et s'arrête, sans rien changer. Vérifiez cette empreinte sur la machine de Xen Orchestra, puis relancez le script une fois de plus avec elle : `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Chaque minute, l'agent lit le plugin, qui lit via XAPI les bases de données round-robin de chaque hôte avec une résolution de 60 secondes. Il garde les séries `xcp_*`, et déplace le pool de chaque série vers le lot qu'il envoie, sous la forme `xcp_ng.pool.id` (l'UUID du pool, qui ne change jamais) et `xcp_ng.pool.name` :",
  "| Category | Series |": "| Catégorie | Séries |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — présente tant que Xen Orchestra est connecté au pool |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Hôtes** | `xcp_host_status` (état d'alimentation et s'il est activé), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` par interface, `xcp_host_disk_*` par référentiel de stockage |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (contention du CPU), `xcp_vm_memory_*`, `xcp_vm_network_*` par interface, `xcp_vm_disk_*` par disque, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Stockage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, sur les pools qui exécutent XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Les domaines de contrôle se présentent comme des VM avec `is_control_domain="true"` ; les pages les masquent sauf si vous les demandez.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra type huit séries de débit comme des compteurs, alors que chacune contient le débit par seconde de XAPI : `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, et les séries de réseau, d'erreurs réseau et de lecture et d'écriture disque des VM. L'agent les transforme en jauges sans toucher à leurs valeurs, si bien que OneUptime les stocke comme les débits qu'elles sont, en octets ou en erreurs par seconde.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime ajoute quatre séries 0/1 pour chaque pool, que lisent les modèles d'alerte : `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` et `xcp_ng.vm.stopped_after_running` (une VM arrêtée ou en pause qui a tourné au cours du dernier jour). Il appose aussi sur chaque point `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` ou `xostor`) et `xcp_ng.id` (l'UUID de cet objet), sur lesquels filtrent les moniteurs et les tableaux de bord.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Non conservées : les propres séries de processus de Xen Orchestra (`xo_*`), qui n'appartiennent à aucun pool, et la puissance d'un hôte lue par IPMI, que le plugin envoie sans son pool. La part estimée de chaque VM en est conservée.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "Un agent lit un Xen Orchestra et chaque pool qu'il gère. Pour un second Xen Orchestra, installez un second agent dans un dossier à lui, avec un nom de conteneur à lui, car deux conteneurs ne peuvent pas porter le même nom :",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Sans `XCP_NG_AGENT_CONTAINER_NAME`, le script nomme le conteneur d'après le dossier. Il enregistre le nom dans le `.env` de cet agent, de sorte qu'il est conservé quand vous relancez le script pour mettre à niveau l'agent, et qu'un agent dont vous avez un jour modifié le `container_name` dans `docker-compose.yml` garde ce nom. Avec Docker Compose, définissez plutôt `XCP_NG_AGENT_CONTAINER_NAME` dans le `.env` de chaque agent.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Ne laissez pas lire deux Xen Orchestra qui gèrent le même pool : le pool est un seul pool dans OneUptime, par son UUID, et serait rapporté deux fois.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient une étiquette de projet sur chaque pool que lit l'agent : `oneuptime.label.<dimension>=<value>` est l'étiquette `<dimension>:<value>`. Ajoutez-les au processeur `resource` dans `otel-collector-config.yaml`, à côté de `oneuptime.agent.version` :",
  "Then restart the collector so it reads the new config:":
    "Redémarrez ensuite le collecteur pour qu'il lise la nouvelle configuration :",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Les pools apparaissent avec les étiquettes `team:platform` et `env:production`. Les étiquettes sont comparées sans tenir compte de la casse : une étiquette `Production` existante est donc réutilisée ; les étiquettes ajoutées dans l'interface OneUptime ne sont jamais supprimées par l'agent. Relancer le script d'installation remplace un `otel-collector-config.yaml` modifié et garde le vôtre à côté sous le nom `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Mise à niveau** — l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté, si bien qu'un simple pull ne fait pas avancer l'agent. Relancez le script d'installation. Il réutilise chaque valeur de votre `.env` existant (rien n'est redemandé), vérifie le certificat de Xen Orchestra de la même façon, télécharge les derniers `docker-compose.yml` et `otel-collector-config.yaml` — un fichier que vous avez modifié est conservé à côté du nouveau sous le nom `<file>.bak.<timestamp>` —, récupère l'image et recrée l'agent avec elle :",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuration indique la version du collecteur qu'elle fige comme **Version de l'agent** de chaque pool. Quand ce OneUptime en fige une plus récente, un signe d'avertissement à côté ouvre ces commandes.",
  "**Uninstall** the agent:": "**Désinstallez** l'agent :",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Désactivez ensuite le plugin OpenMetrics dans Xen Orchestra si rien d'autre ne le lit.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` vérifie toute la chaîne — le conteneur, le certificat de Xen Orchestra avec `xo-ca.pem`, le plugin et son secret, les pools qu'il rapporte — et demande directement à OneUptime s'il accepte votre clé d'ingestion. Cette dernière vérification compte le plus : les points de terminaison OTLP de OneUptime refusent une mauvaise clé avec `401` ou `422`, que le collecteur journalise comme une simple ligne `Exporting failed` par lot, facile à manquer.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Il se termine par un verdict qui nomme la cause la plus probable. Il n'affiche jamais le secret.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime marque un pool comme Déconnecté quand rien n'a été lu pour lui pendant 15 minutes.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Si tous les pools de ce Xen Orchestra sont Déconnectés, vérifiez l'agent (dans `/opt/oneuptime-xcp-ng-agent`) : `docker compose ps` et `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Si un seul l'est, Xen Orchestra a cessé de le rapporter : sous *Settings → Servers* dans Xen Orchestra, le serveur du pool doit être connecté. Les hôtes, les VM et le stockage du pool restent tels que Xen Orchestra les a rapportés en dernier.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Le collecteur journalise `server returned HTTP status 401 Unauthorized`. Copiez de nouveau le secret depuis *Settings → Plugins → openmetrics*, définissez `XO_OPENMETRICS_SECRET` sur celui-ci dans `.env` — entre guillemets simples, chaque `$` écrit `$$` — et appliquez-le avec `docker compose up -d` dans `/opt/oneuptime-xcp-ng-agent`. Avant 6.8, Xen Orchestra créait un nouveau secret à chaque redémarrage.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra répond, mais pas son plugin OpenMetrics. Activez le plugin sous *Settings → Plugins → openmetrics* (une XOA a besoin d\'une licence Premium pour cela), et vérifiez que Xen Orchestra est en version 6.9 ou ultérieure. `/openmetrics/health` répond `{"status":"ok"}` sans secret tant que le plugin tourne.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — le certificat ne nomme aucune adresse, comme le certificat autosigné propre à Xen Orchestra. Donnez à Xen Orchestra un certificat qui nomme son adresse.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — connectez-vous à l'un de ces noms, ou définissez `XO_TLS_SERVER_NAME` sur l'un d'eux.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` ne contient ni ce certificat ni la CA qui l'a émis. Le certificat a été renouvelé, ou le fichier contient le mauvais : réécrivez-le, comme l'explique **Certificat de Xen Orchestra** sous Avancé.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra ne rapporte que les pools auxquels il est connecté, et l'agent ne lit que ce Xen Orchestra. Connectez le serveur du pool sous *Settings → Servers* dans Xen Orchestra ; le pool apparaît dans OneUptime à la lecture suivante. Un pool lu par un autre Xen Orchestra a besoin de son propre agent, à côté de cet autre Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Nom de ce Xen Orchestra** — la commande le nomme déjà **`xo-paris`**, comme les Paramètres de ce pool l'affichent.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "La commande contient déjà votre URL OneUptime et votre clé d'ingestion. Le script demande le reste :",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Téléchargez `docker-compose.yml` et `otel-collector-config.yaml` depuis ce OneUptime dans un nouveau dossier :",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Créez un fichier `.env` à côté d'eux — il contient le secret du plugin, gardez-le donc privé avec `chmod 600 .env` :",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Définissez `XO_ADDRESS` sur le `host` ou le `host:port` de Xen Orchestra, sans `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Mettez le secret du plugin entre guillemets simples. S'il contient un `$`, écrivez chacun `$$` : le collecteur lit la valeur une fois de plus.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` est le nom que les Paramètres de chaque pool donnent à ce Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Donnez ensuite à l'agent le certificat de Xen Orchestra, sous le nom `xo-ca.pem` à côté de `docker-compose.yml` — l'agent vérifie Xen Orchestra avec ce fichier et rien d'autre. Pour faire confiance au certificat propre à Xen Orchestra, lisez-le et comparez son empreinte avec celle de la machine de Xen Orchestra :",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Si une CA à vous l'a émis, copiez plutôt le certificat de cette CA dans `xo-ca.pem` ; si c'est une CA publique, copiez le bundle de CA de cette machine (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Démarrez l'agent :",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agent les lit dans le fichier `.env` à côté de `docker-compose.yml`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Quand le certificat nomme Xen Orchestra par un autre nom que l'adresse de `XO_ADDRESS`, définissez `XO_TLS_SERVER_NAME` sur ce nom. Quand le certificat de `xo-ca.pem` est renouvelé, relisez-le comme à l'étape 3, puis exécutez `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Exécutez-les dans le dossier de l'agent, celui qui contient `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Mise à niveau** — l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté, si bien qu'un simple pull ne fait pas avancer l'agent. Téléchargez de nouveau les deux fichiers ; votre `.env` et `xo-ca.pem` restent, et une modification faite à l'un des fichiers doit être refaite :",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Récupérez ensuite l'image et recréez l'agent, pour que le collecteur lise sa nouvelle configuration :",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Si tous les pools de ce Xen Orchestra sont Déconnectés, vérifiez l'agent (dans le dossier de l'agent) : `docker compose ps` et `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Le collecteur journalise `server returned HTTP status 401 Unauthorized`. Copiez de nouveau le secret depuis *Settings → Plugins → openmetrics*, définissez `XO_OPENMETRICS_SECRET` sur celui-ci dans `.env` — entre guillemets simples, chaque `$` écrit `$$` — et appliquez-le avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml`. Avant 6.8, Xen Orchestra créait un nouveau secret à chaque redémarrage.",
};

export default TRANSLATION;
