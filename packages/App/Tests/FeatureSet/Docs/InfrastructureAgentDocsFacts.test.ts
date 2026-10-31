import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import {
  DOCKER_DEFAULT_API_VERSION,
  DOCKER_DEFAULT_HOST_NAME,
  DOCKER_EXAMPLE_HOST_NAME,
  getDockerAiAgentRunCommand,
  getDockerComposeFile,
  getDockerRunCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import {
  PODMAN_DEFAULT_API_VERSION,
  PODMAN_DEFAULT_HOST_NAME,
  PODMAN_EXAMPLE_HOST_NAME,
  PODMAN_SOCKET_PATH,
  getPodmanAiAgentRunCommand,
  getPodmanComposeFile,
  getPodmanRunCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import {
  PROXMOX_AGENT_INSTALL_DIR,
  PROXMOX_NATIVE_PUSH_PATH,
  PROXMOX_TOKEN_ID,
  ProxmoxPushTarget,
  getProxmoxPushTarget,
} from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  IOT_METRIC_CONVENTIONS,
  IoTMetricConvention,
} from "../../../FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KubernetesPlatform,
  getKubernetesSetupGuide,
} from "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { HOST_COLLECTOR_VERSION } from "../../../FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import { HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import {
  MIN_OTELCOL_CONTRIB_VERSION,
  SYSTEMD_ACTIVE_STATES,
} from "../../../FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";
import {
  MQTT_MAX_METRICS_PER_PUBLISH,
  MQTT_MAX_PAYLOAD_BYTES,
  MQTT_TOPIC_PREFIX,
  MqttPublishParseResult,
  parseMqttPublish,
} from "../../../FeatureSet/Telemetry/Utils/MqttTelemetryMapper";
import {
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
} from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import { IOT_SNAPSHOT_METRIC_NAMES } from "Common/Server/Utils/Telemetry/IoTSnapshotScan";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import ColumnLength from "Common/Types/Database/ColumnLength";
import {
  INSTALL_SCRIPTS,
  InstallScriptEntry,
  getInstallFileUrl,
} from "Common/Types/InstallScripts/InstallScripts";
import {
  CPU_HEADROOM_RATIO,
  MEMORY_HEADROOM_RATIO,
  MIN_OBSERVED_HOURS,
  RightSizingRecommendation,
  SIGNIFICANCE_RATIO,
  buildRightSizingRecommendation,
} from "Common/Types/Kubernetes/KubernetesRightSizing";
import { CEPH_AGENT_INSTALL_DIR } from "../../../FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_AGENT_INSTALL_DIR,
  DOCKER_SWARM_DEFAULT_API_VERSION,
  DOCKER_SWARM_DEFAULT_CLUSTER_NAME,
  DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS,
  DOCKER_SWARM_NODE_NAME_COMMAND,
  getDockerSwarmAgentDownloadCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { STORAGE_ARRAY_AGENT_INSTALL_DIR } from "../../../FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { VMWARE_AGENT_INSTALL_DIR } from "../../../FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  CephMetricDefinition,
  getAllCephMetrics,
} from "Common/Types/Monitor/CephMetricCatalog";
import { CEPH_SNAPSHOT_METRIC_NAMES } from "Common/Server/Utils/Telemetry/ProxmoxCephSnapshotScan";
import { DEFAULT_MESSAGE_QUEUE_MIN_SPANS } from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  CloudProvider,
  FAAS_CLOUD_PLATFORM_VALUES,
} from "Common/Types/Cloud/CloudPlatform";
import {
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
} from "Common/Types/AI/AgentAiSettings";
import {
  CLOUD_AI_AGENT_FIXES_MODES,
  CloudAiAgentEnvironmentVariable,
  getCloudAiAgentEnvironment,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the seven English infrastructure agent pages (host collector,
 * Kubernetes agent and cost, Docker, IoT, Podman and Proxmox) say, held to
 * what ships: the setup guides' commands, the agents' images, compose files
 * and collector configs, the kubernetes-agent chart, the MQTT endpoint, the
 * Proxmox native-push liveness rules and the right-sizing math. Changing one
 * of those fails this until the English page follows;
 * InfrastructureAgentDocsTranslations then holds the 16 translations to the
 * English pages.
 *
 * The Kubernetes AI agent, the agents' version sign, the alert templates and
 * the eBPF span metric names have suites of their own
 * (KubernetesAiAccessDocs, AgentVersionSignDocs, InfrastructureMonitorDocsFacts,
 * KubernetesAgentSpanMetricsDocs), so they are not repeated here.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

// The docs show OneUptime Cloud's address; a self-hosted reader puts theirs.
const DOCS_ONEUPTIME_URL: string = "https://oneuptime.com";
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);

const HOST_PAGE: string = "telemetry/host-otel-collector";
const KUBERNETES_PAGE: string = "telemetry/kubernetes-agent";
const COST_PAGE: string = "telemetry/kubernetes-cost";
const DOCKER_PAGE: string = "telemetry/docker-host";
const IOT_PAGE: string = "telemetry/iot-devices";
const PODMAN_PAGE: string = "telemetry/podman-host";
const PROXMOX_PAGE: string = "telemetry/proxmox";

// A helm install or upgrade of the chart, and the release it names.
const HELM_COMMAND: RegExp =
  /^helm (?:install|upgrade(?: --install)?) (\S+) oneuptime\/kubernetes-agent/;

// A row of the IoT page's metric conventions table: a metric, then its meaning.
const IOT_METRIC_ROW: RegExp = /^\| `iot_[a-z_]+` \| [A-Z]/;

// A row of the host page's inventory table: what you want, then an attribute.
const ATTRIBUTE_ROW: RegExp = /^\| [^|]+ \| `/;

// The placeholders the pages' commands carry where a reader puts theirs.
const URL_PLACEHOLDER: string = "YOUR_ONEUPTIME_URL";
const INGESTION_KEY_PLACEHOLDER: string = "YOUR_TELEMETRY_INGESTION_TOKEN";

/*
 * js-yaml from Common/node_modules, as KubernetesAgentDocsFacts loads it:
 * Common declares js-yaml 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlNode = Record<string, unknown>;

function repoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function chartFile(relative: string): string {
  return fs.readFileSync(path.join(CHART_DIR, relative), "utf8");
}

function yamlOf(text: string): YamlNode {
  return jsYaml.load(text) as YamlNode;
}

// A value of a parsed YAML document by its dotted path.
function at(document: unknown, dotted: string): unknown {
  return dotted.split(".").reduce((current: unknown, key: string): unknown => {
    return (current as YamlNode | undefined)?.[key];
  }, document);
}

const chartValues: YamlNode = yamlOf(chartFile("values.yaml"));

function english(page: string): string {
  return readPage("en", page);
}

function fencesOf(page: string): Array<DocsFence> {
  return scanMarkdown(english(page)).fences;
}

function codesOf(page: string): Array<string> {
  return fencesOf(page).map((fence: DocsFence): string => {
    return fence.code.trim();
  });
}

// The one line of the page that holds every needle.
function lineWith(page: string, ...needles: Array<string>): string {
  const lines: Array<string> = english(page)
    .split("\n")
    .filter((line: string): boolean => {
      return needles.every((needle: string): boolean => {
        return line.includes(needle);
      });
    });
  expect(lines).toHaveLength(1);
  return lines[0] as string;
}

// The cells of the table row whose first cell is `first`.
function rowOf(page: string, first: string): Array<string> {
  const rows: Array<Array<string>> = english(page)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(`| ${first} |`);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split(" | ")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
  expect(rows).toHaveLength(1);
  return rows[0] as Array<string>;
}

// Every backticked span of a text, without its backticks.
function codeSpansOf(text: string): Array<string> {
  return Array.from(text.matchAll(/`([^`]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every string a setup guide holds, however deep.
function textsOf(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(textsOf);
  }
  if (value && typeof value === "object") {
    return Object.values(value as YamlNode).flatMap(textsOf);
  }
  return [];
}

// "${NAME:-default}" in a compose file, the same wherever NAME is set.
function composeDefault(compose: string, name: string): string {
  const defaults: Array<string> = Array.from(
    compose.matchAll(new RegExp(`\\$\\{${name}:-([^}]*)\\}`, "g")),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
  expect(defaults.length).toBeGreaterThan(0);
  expect(new Set(defaults).size).toBe(1);
  return defaults[0] as string;
}

describe("the Docker agent page, against the setup guide and the agent", () => {
  const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
    oneuptimeUrl: URL_PLACEHOLDER,
    apiKey: INGESTION_KEY_PLACEHOLDER,
    hostName: DOCKER_EXAMPLE_HOST_NAME,
  };

  it("starts the agent and the AI agent with the commands the setup guide prints", () => {
    expect(codesOf(DOCKER_PAGE)).toContain(getDockerRunCommand(values));
    expect(codesOf(DOCKER_PAGE)).toContain(getDockerAiAgentRunCommand(values));
  });

  it("hands out the setup guide's docker-compose.yml", () => {
    expect(codesOf(DOCKER_PAGE)).toContain(getDockerComposeFile(values).trim());
  });

  it("states the host name and API version defaults the image sets", () => {
    const dockerfile: Array<string> = repoFile(
      "agents/DockerAgent/Dockerfile.tpl",
    ).split("\n");
    expect(dockerfile).toContain(
      `ENV DOCKER_HOST_NAME=${DOCKER_DEFAULT_HOST_NAME}`,
    );
    // Empty: the agent negotiates the version with the daemon.
    expect(DOCKER_DEFAULT_API_VERSION).toBe("");
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${DOCKER_DEFAULT_API_VERSION}`,
    );
    expect(rowOf(DOCKER_PAGE, "`DOCKER_HOST_NAME`")[2]).toContain(
      `Defaults to \`${DOCKER_DEFAULT_HOST_NAME}\``,
    );
    expect(rowOf(DOCKER_PAGE, "`DOCKER_API_VERSION`")[2]).toContain(
      "Empty by default: the agent negotiates it with the daemon",
    );
  });

  /*
   * The image is the upstream collector with the config copied in, and has
   * no shell: the inventory poller that sat beside the config never ran, so
   * the page promised an inventory every 5 minutes that never arrived.
   */
  it("reads stats every 30 seconds, and promises no inventory the agent never sends", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/DockerAgent/otel-collector-config.yaml"),
    );
    expect(at(config, "receivers.docker_stats.collection_interval")).toBe(
      "30s",
    );
    expect(at(config, "receivers.filelog/inventory")).toBeUndefined();
    lineWith(DOCKER_PAGE, "stats every 30 seconds");
    expect(english(DOCKER_PAGE)).not.toMatch(/inventory|every 5 minutes/i);
  });

  it("tails the files the json-file driver writes, and only those", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/DockerAgent/otel-collector-config.yaml"),
    );
    const include: Array<string> = at(
      config,
      "receivers.filelog.include",
    ) as Array<string>;
    expect(include).toEqual(["/var/lib/docker/containers/*/*-json.log"]);
    lineWith(DOCKER_PAGE, `\`${include[0]}\``, "`json-file`");
  });
});

describe("the Podman agent page, against the setup guide and the agent", () => {
  const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
    oneuptimeUrl: URL_PLACEHOLDER,
    apiKey: INGESTION_KEY_PLACEHOLDER,
    hostName: PODMAN_EXAMPLE_HOST_NAME,
  };

  it("starts the agent and the AI agent with the commands the setup guide prints", () => {
    expect(codesOf(PODMAN_PAGE)).toContain(getPodmanRunCommand(values));
    expect(codesOf(PODMAN_PAGE)).toContain(getPodmanAiAgentRunCommand(values));
  });

  it("hands out the setup guide's docker-compose.yml", () => {
    expect(codesOf(PODMAN_PAGE)).toContain(getPodmanComposeFile(values).trim());
  });

  it("states the host name and API version defaults the image sets", () => {
    const dockerfile: Array<string> = repoFile(
      "agents/PodmanAgent/Dockerfile.tpl",
    ).split("\n");
    expect(dockerfile).toContain(
      `ENV PODMAN_HOST_NAME=${PODMAN_DEFAULT_HOST_NAME}`,
    );
    // Empty: the agent negotiates the version with the socket.
    expect(PODMAN_DEFAULT_API_VERSION).toBe("");
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${PODMAN_DEFAULT_API_VERSION}`,
    );
    expect(rowOf(PODMAN_PAGE, "`PODMAN_HOST_NAME`")[2]).toContain(
      `Defaults to \`${PODMAN_DEFAULT_HOST_NAME}\``,
    );
    expect(rowOf(PODMAN_PAGE, "`DOCKER_API_VERSION`")[2]).toContain(
      "Empty by default: the agent negotiates it with the socket",
    );
  });

  it("reads the socket the page names, every 30 seconds, and promises no inventory the agent never sends", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/PodmanAgent/otel-collector-config.yaml"),
    );
    expect(at(config, "receivers.docker_stats.endpoint")).toBe(
      `unix://${PODMAN_SOCKET_PATH}`,
    );
    expect(at(config, "receivers.docker_stats.collection_interval")).toBe(
      "30s",
    );
    expect(at(config, "receivers.filelog/inventory")).toBeUndefined();
    lineWith(PODMAN_PAGE, "stats every 30 seconds");
    lineWith(PODMAN_PAGE, `Podman's API socket at \`${PODMAN_SOCKET_PATH}\``);
    expect(english(PODMAN_PAGE)).not.toMatch(/inventory|every 5 minutes/i);
  });

  /*
   * Rootless Podman keeps its socket and storage under the user: the page
   * says where, and that install.sh mounts them (ContainerAgentInstallers in
   * Tests/Ops runs it rootless).
   */
  it("tells a rootless reader where their socket and storage are, and that install.sh mounts them", () => {
    const line: string = lineWith(
      PODMAN_PAGE,
      "`/run/user/<uid>/podman/podman.sock`",
    );
    expect(line).toContain("`~/.local/share/containers/storage`");
    expect(line).toContain(`\`${PODMAN_SOCKET_PATH}\``);
    expect(line).toContain("`install.sh`");
    expect(repoFile("agents/PodmanAgent/install.sh")).toContain(
      "systemctl --user enable --now podman.socket",
    );
  });

  it("tails the ctr.log files the k8s-file driver writes, and only those", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/PodmanAgent/otel-collector-config.yaml"),
    );
    const include: Array<string> = at(
      config,
      "receivers.filelog.include",
    ) as Array<string>;
    expect(include).toEqual([
      "/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log",
    ]);
    lineWith(PODMAN_PAGE, `\`${include[0]}\``, "`k8s-file`");
  });
});

describe("the Proxmox agent page, against the agent", () => {
  const compose: string = repoFile("agents/ProxmoxAgent/docker-compose.yml");
  const config: string = repoFile(
    "agents/ProxmoxAgent/otel-collector-config.yaml",
  );

  it("states the defaults the agent's docker-compose.yml gives", () => {
    expect(rowOf(PROXMOX_PAGE, "`PROXMOX_CLUSTER_NAME`")[2]).toContain(
      `Defaults to \`${composeDefault(compose, "PROXMOX_CLUSTER_NAME")}\``,
    );
    expect(rowOf(PROXMOX_PAGE, "`PVE_EXPORTER_URL`")[2]).toContain(
      `\`${composeDefault(compose, "PVE_EXPORTER_URL")}\``,
    );
    expect(rowOf(PROXMOX_PAGE, "`PVE_VERIFY_SSL`")[2]).toContain(
      `Defaults to \`${composeDefault(compose, "PVE_VERIFY_SSL")}\``,
    );
  });

  it("starts the bundled exporter under the profile COMPOSE_PROFILES names", () => {
    const services: YamlNode = at(yamlOf(compose), "services") as YamlNode;
    const profiled: Array<string> = Object.values(services).flatMap(
      (service: unknown): Array<string> => {
        return ((service as YamlNode)["profiles"] as Array<string>) || [];
      },
    );
    expect(profiled).toEqual(["pve-exporter"]);
    expect(rowOf(PROXMOX_PAGE, "`COMPOSE_PROFILES`")[2]).toContain(
      "`pve-exporter`",
    );
    expect(english(PROXMOX_PAGE)).toContain(
      "`COMPOSE_PROFILES=pve-exporter` also starts the bundled exporter",
    );
  });

  /*
   * pve-exporter's node collectors (start-on-boot, replication, the
   * subscription) read only the node whose API answers the scrape. One
   * scrape of PVE_HOST with cluster=1&node=1 left the guests and jobs of
   * every other node out, so Guest Down and Replication Failing never saw
   * them.
   */
  it("scrapes the cluster collectors once, and the node collectors once per node, every 30 seconds", () => {
    const jobs: Array<YamlNode> = at(
      yamlOf(config),
      "receivers.prometheus.config.scrape_configs",
    ) as Array<YamlNode>;
    expect(
      jobs.map((job: YamlNode): unknown => {
        return job["job_name"];
      }),
    ).toEqual(["oneuptime-proxmox", "oneuptime-proxmox-nodes"]);
    for (const job of jobs) {
      expect(job["scrape_interval"]).toBe("30s");
    }
    expect(at(jobs[0], "params")).toEqual({
      target: ["${env:PVE_HOST}"],
      cluster: ["1"],
      node: ["0"],
    });
    expect(at(jobs[1], "params")).toEqual({ cluster: ["0"], node: ["1"] });
    expect(jobs[1]!["static_configs"]).toEqual([
      { targets: "${env:PVE_NODES}" },
    ]);
    expect(compose).toContain(
      "- PVE_NODES=${PVE_NODES:-[${PVE_HOST:-localhost}]}",
    );

    lineWith(
      PROXMOX_PAGE,
      "scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST`, and its node collectors once for each node in `PVE_NODES`",
    );
    expect(rowOf(PROXMOX_PAGE, "`PVE_NODES`")[2]).toContain(
      "comma-separated in square brackets, such as `[192.168.1.10,192.168.1.11,192.168.1.12]`",
    );
    expect(rowOf(PROXMOX_PAGE, "`PVE_NODES`")[2]).toContain(
      "Defaults to `PVE_HOST` alone",
    );
    expect(english(PROXMOX_PAGE)).toContain(
      "PVE_HOST=192.168.1.10\nPVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]\n",
    );
    lineWith(PROXMOX_PAGE, "`cluster=1`", '`cluster: ["1"]`');
  });

  it("says a virtual IP serves PVE_HOST, never PVE_NODES", () => {
    lineWith(
      PROXMOX_PAGE,
      "point `PVE_HOST` at a virtual IP or round-robin DNS name",
      "`PVE_NODES` is different: it lists every node at its own address, never a virtual IP",
    );
  });

  it("names the eight journald units the shipped config's receiver reads", () => {
    const commented: string = config.slice(
      config.indexOf("# journald:"),
      config.indexOf("processors:"),
    );
    const units: Array<string> = Array.from(
      commented.matchAll(/^\s*#\s+- (\S+)$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    expect(units).toHaveLength(8);
    const line: string = lineWith(
      PROXMOX_PAGE,
      "log to the systemd journal under eight units",
    );
    expect(codeSpansOf(line).slice(0, 8)).toEqual(units);
  });

  it("splits id into the three attributes the table gives", () => {
    const transform: string = config.slice(
      config.indexOf("transform/pve-identity:"),
      config.indexOf("resource:", config.indexOf("transform/pve-identity:")),
    );
    const scopes: Set<string> = new Set(
      Array.from(
        transform.matchAll(/set\(attributes\["pve\.scope"\], "(\w+)"\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    );
    const types: Set<string> = new Set(
      Array.from(
        transform.matchAll(/set\(attributes\["pve\.type"\], "(\w+)"\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    );
    expect(
      codeSpansOf(rowOf(PROXMOX_PAGE, "`pve.scope`")[1] as string).slice(0, 4),
    ).toEqual(Array.from(scopes));
    expect(codeSpansOf(rowOf(PROXMOX_PAGE, "`pve.type`")[1] as string)).toEqual(
      Array.from(types),
    );
    expect(config).toMatch(
      /processors: \[memory_limiter, transform\/pve-identity, resource, batch\]/,
    );
  });

  it("names the read-only token and the install folder the setup guide uses", () => {
    expect(english(PROXMOX_PAGE)).toContain(`\`${PROXMOX_TOKEN_ID}\``);
    expect(english(PROXMOX_PAGE)).toContain(`\`${PROXMOX_AGENT_INSTALL_DIR}\``);
  });

  it("fills the native metric server as the setup guide does", () => {
    const target: ProxmoxPushTarget = getProxmoxPushTarget(
      "https://oneuptime.com",
    );
    expect(rowOf(PROXMOX_PAGE, "Server")[1]).toContain(`\`${target.server}\``);
    expect(rowOf(PROXMOX_PAGE, "Port")[1]).toBe(`\`${target.port}\``);
    expect(rowOf(PROXMOX_PAGE, "Protocol")[1]).toBe(`\`${target.protocol}\``);
    expect(rowOf(PROXMOX_PAGE, "Path")[1]).toBe(`\`${target.path}\``);
    expect(target.path).toBe(PROXMOX_NATIVE_PUSH_PATH);
    expect(rowOf(PROXMOX_PAGE, "Headers")[1]).toBe(
      `\`{"x-oneuptime-token": "${INGESTION_KEY_PLACEHOLDER}"}\``,
    );
  });

  describe("when a node stops reporting", () => {
    it("shows it Offline after the silence the liveness rules allow", () => {
      expect(PROXMOX_NODE_SILENCE_MS).toBe(2 * 60_000);
      lineWith(
        PROXMOX_PAGE,
        "About 2 minutes after its last report",
        "**Offline**",
      );
    });

    it("pages for it over the templates' window", () => {
      expect(PROXMOX_MONITOR_WINDOW_MS).toBe(5 * 60_000);
      lineWith(
        PROXMOX_PAGE,
        "After about 5 minutes, **Node Offline** fires",
        "a full 5-minute window of reports",
      );
    });

    it("stops reporting it after the retention a self-hosted server can change", () => {
      expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(7 * 24);
      lineWith(
        PROXMOX_PAGE,
        "A node silent for more than 7 days is no longer reported",
        "`PVE_SILENT_NODE_RETENTION_HOURS`",
      );
    });

    it("drops its guests and storage at the inventory's stale cutoff", () => {
      expect(ProxmoxResourceService.getStaleThresholdMinutes()).toBe(15);
      lineWith(
        PROXMOX_PAGE,
        "drop off their pages about 15 minutes after its last report",
      );
    });
  });
});

describe("the IoT devices page, against the ingest", () => {
  it("lists the iot_* metrics the setup guide lists and the inventory reads, in order", () => {
    const names: Array<string> = english(IOT_PAGE)
      .split("\n")
      .filter((line: string): boolean => {
        return IOT_METRIC_ROW.test(line);
      })
      .map((line: string): string => {
        return codeSpansOf(line)[0] as string;
      });
    expect(names).toEqual(
      IOT_METRIC_CONVENTIONS.map((convention: IoTMetricConvention): string => {
        return convention.name;
      }),
    );
    expect(new Set(names)).toEqual(new Set(IOT_SNAPSHOT_METRIC_NAMES));
  });

  it("defaults a device's kind to Device, as the inventory does", () => {
    expect(
      repoFile("packages/Common/Server/Utils/Telemetry/IoTSnapshotScan.ts"),
    ).toContain(
      'getStringAttribute(dpAttributes, "iot.device.kind") || "Device"',
    );
    expect(rowOf(IOT_PAGE, "`iot.device.kind`")[3]).toContain(
      "Defaults to `Device`",
    );
  });

  describe("MQTT", () => {
    const now: number = Date.UTC(2026, 0, 1);

    function publish(topic: string, payload: string): MqttPublishParseResult {
      return parseMqttPublish({
        topic: topic,
        payload: Buffer.from(payload, "utf8"),
        nowMs: now,
      });
    }

    it("takes the topics the table gives, under the fixed prefix", () => {
      expect(MQTT_TOPIC_PREFIX).toBe("oneuptime");
      lineWith(
        IOT_PAGE,
        `Publish under the fixed \`${MQTT_TOPIC_PREFIX}/\` prefix`,
      );

      const telemetry: MqttPublishParseResult = publish(
        "oneuptime/building-a-sensors/sensor-001/telemetry",
        '{"metrics":{"iot_temperature_celsius":21.5}}',
      );
      expect(telemetry.payload?.points).toEqual([
        { name: "iot_temperature_celsius", value: 21.5, attributes: {} },
      ]);
      expect(
        rowOf(IOT_PAGE, "`oneuptime/<fleet>/<device>/telemetry`")[1],
      ).toContain('`{"metrics":{"iot_temperature_celsius":21.5}}`');

      for (const body of ["23.4", '{"value":23.4}']) {
        expect(
          publish(
            "oneuptime/building-a-sensors/sensor-001/metrics/iot_temperature_celsius",
            body,
          ).payload?.points[0]?.value,
        ).toBe(23.4);
        expect(
          rowOf(
            IOT_PAGE,
            "`oneuptime/<fleet>/<device>/metrics/<metricName>`",
          )[1],
        ).toContain(`\`${body}\``);
      }
    });

    it("reads every status payload the table names as iot_device_up", () => {
      const statusRow: string = rowOf(
        IOT_PAGE,
        "`oneuptime/<fleet>/<device>/status`",
      )[1] as string;
      const pairs: Array<[string, number]> = [
        ["online", 1],
        ["offline", 0],
        ["1", 1],
        ["0", 0],
        ["true", 1],
        ["false", 0],
        ["up", 1],
        ["down", 0],
      ];
      for (const [body, up] of pairs) {
        expect(statusRow).toContain(`\`${body}\``);
        expect(
          publish("oneuptime/building-a-sensors/sensor-001/status", body)
            .payload?.points,
        ).toEqual([{ name: "iot_device_up", value: up, attributes: {} }]);
      }
    });

    it("refuses a fleet or device segment over 100 characters", () => {
      expect(ColumnLength.ShortText).toBe(100);
      lineWith(IOT_PAGE, "are at most 100 characters long");
      const long: string = "f".repeat(ColumnLength.ShortText);
      expect(
        publish(`oneuptime/${long}/sensor-001/status`, "online").error,
      ).toBeUndefined();
      expect(
        publish(`oneuptime/${long}f/sensor-001/status`, "online").error,
      ).toBeDefined();
    });

    it("drops a publish over 128 KB or with more than 100 metrics", () => {
      expect(MQTT_MAX_PAYLOAD_BYTES).toBe(128 * 1024);
      expect(MQTT_MAX_METRICS_PER_PUBLISH).toBe(100);
      lineWith(
        IOT_PAGE,
        "A publish over 128 KB, or with more than 100 metrics, is dropped",
      );

      const metrics: Record<string, number> = {};
      for (
        let index: number = 0;
        index <= MQTT_MAX_METRICS_PER_PUBLISH;
        index++
      ) {
        metrics[`iot_reading_${index}`] = index;
      }
      expect(
        publish(
          "oneuptime/building-a-sensors/sensor-001/telemetry",
          JSON.stringify({ metrics: metrics }),
        ).error,
      ).toBeDefined();
      expect(
        publish(
          "oneuptime/building-a-sensors/sensor-001/metrics/iot_uptime_seconds",
          " ".repeat(MQTT_MAX_PAYLOAD_BYTES) + "1",
        ).error,
      ).toBeDefined();
    });

    it("refuses bad credentials with CONNACK return code 4", () => {
      expect(
        repoFile("packages/App/FeatureSet/Telemetry/MqttServer.ts"),
      ).toContain("const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;");
      lineWith(
        IOT_PAGE,
        "at CONNECT with return code 4 (bad username or password)",
      );
    });

    it("listens on port 1883 for raw TCP unless MQTT_INGEST_PORT says otherwise", () => {
      expect(repoFile("packages/App/FeatureSet/Telemetry/Config.ts")).toMatch(
        /"MQTT_INGEST_PORT",\s*1883,/,
      );
      expect(rowOf(IOT_PAGE, "MQTT over TCP")[1]).toBe("`<app-host>:1883`");
      lineWith(IOT_PAGE, "(`MQTT_INGEST_PORT`, `1883` by default)");
    });

    it("closes an idle WebSocket after the ingress's 300 seconds", () => {
      const nginx: string = repoFile("packages/Nginx/default.conf.template");
      const start: number = nginx.indexOf("location /mqtt {");
      const block: string = nginx.slice(
        start,
        nginx.indexOf("location ", start + 1),
      );
      expect(block).toContain("proxy_read_timeout 300s;");
      lineWith(IOT_PAGE, "closes a WebSocket that is idle for 300 seconds");
    });
  });
});

describe("the Kubernetes cost page, against the chart and the cost agent", () => {
  it("gives the chart's defaults in its settings block", () => {
    const settings: DocsFence | undefined = fencesOf(COST_PAGE).find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("windowSeconds");
      },
    );
    const block: YamlNode = yamlOf((settings as DocsFence).code);
    const leaves: Array<string> = [
      "cost.agent.windowSeconds",
      "cost.agent.includeIdle",
      "cost.agent.currency",
      "cost.prometheus.retention",
      "cost.prometheus.persistence.enabled",
      "cost.metrics.enabled",
      "cost.metrics.scrapeInterval",
    ];
    for (const leaf of leaves) {
      expect([leaf, at(block, leaf)]).toEqual([leaf, at(chartValues, leaf)]);
    }
    expect(at(chartValues, "cost.prometheus.retention")).toBe("7d");
    lineWith(COST_PAGE, "keeps 7 days of history");
  });

  it("prices on-prem clusters with the rate card's own keys and figures", () => {
    const rateCard: DocsFence | undefined = fencesOf(COST_PAGE).find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("customPricing");
      },
    );
    const pricing: YamlNode = at(
      yamlOf((rateCard as DocsFence).code),
      "cost.opencost.customPricing",
    ) as YamlNode;
    expect(pricing["enabled"]).toBe(true);
    for (const [key, value] of Object.entries(pricing)) {
      if (key !== "enabled") {
        expect([key, value]).toEqual([
          key,
          at(chartValues, `cost.opencost.customPricing.${key}`),
        ]);
      }
    }
  });

  it("names cost metrics the chart's scrape keeps", () => {
    const allowlist: Array<string> = at(
      chartValues,
      "cost.metrics.metricsAllowlist",
    ) as Array<string>;
    for (const metric of ["node_total_hourly_cost", "pv_hourly_cost"]) {
      expect(allowlist).toContain(metric);
      expect(english(COST_PAGE)).toContain(`\`${metric}\``);
    }
  });

  it("finds the Allocation API by the paths the poller tries, in its order", () => {
    const client: string = repoFile(
      "agents/KubernetesCostAgent/CostEngineClient.ts",
    );
    const candidates: string = client.slice(
      client.indexOf("const CANDIDATE_PATHS"),
      client.indexOf("];", client.indexOf("const CANDIDATE_PATHS")),
    );
    expect(
      Array.from(candidates.matchAll(/"([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["/model/allocation", "/allocation/compute", "/allocation"]);
    lineWith(
      COST_PAGE,
      "(`/model/allocation` for Kubecost, `/allocation/compute` or `/allocation` for OpenCost)",
    );
  });

  it("polls one closed hour at a time and reads memory peaks from the cAdvisor job the page names", () => {
    const config: string = repoFile("agents/KubernetesCostAgent/Config.ts");
    expect(config).toMatch(/optional\("WINDOW_SECONDS", "3600"\)/);
    expect(at(chartValues, "cost.agent.windowSeconds")).toBe(3600);
    expect(config).toMatch(
      /"COST_PROMETHEUS_CADVISOR_JOB",\s*"kubernetes-nodes-cadvisor"/,
    );
    expect(chartFile("templates/prometheus-cost.yaml")).toContain(
      "job_name: kubernetes-nodes-cadvisor",
    );
    lineWith(COST_PAGE, "is not named `kubernetes-nodes-cadvisor`");
  });

  describe("right-sizing", () => {
    function recommend(
      cpuP95: number,
      memoryPeak: number,
    ): RightSizingRecommendation {
      return buildRightSizingRecommendation(
        {
          namespace: "shop",
          controllerKind: "Deployment",
          controllerName: "web",
          containerName: "web",
          sampleCount: MIN_OBSERVED_HOURS,
          cpuCoreRequestAverage: 2,
          cpuCoreUsageP95: cpuP95,
          cpuCost: 10,
          ramBytesRequestAverage: 4 * 1024 * 1024 * 1024,
          ramBytesUsagePeak: memoryPeak,
          ramCost: 10,
        },
        MIN_OBSERVED_HOURS,
      );
    }

    it("adds 25% headroom and rounds to 10m of CPU and 16Mi of memory", () => {
      expect(CPU_HEADROOM_RATIO).toBe(0.25);
      expect(MEMORY_HEADROOM_RATIO).toBe(0.25);
      const mebibyte: number = 1024 * 1024;
      const recommendation: RightSizingRecommendation = recommend(
        0.101,
        100 * mebibyte,
      );
      // 0.101 x 1.25 = 0.12625 cores, up to the next 10m.
      expect(
        Math.round((recommendation.cpu.recommended as number) * 1000),
      ).toBe(130);
      // 100Mi x 1.25 = 125Mi, up to the next 16Mi.
      expect((recommendation.memory.recommended as number) / mebibyte).toBe(
        128,
      );
      lineWith(COST_PAGE, "plus 25% headroom", "(10m of CPU, 16Mi of memory)");
    });

    it("leaves a container within 15% of its recommendation out", () => {
      expect(SIGNIFICANCE_RATIO).toBe(0.15);
      lineWith(COST_PAGE, "A container within 15% of its recommendation");
    });

    it("needs 24 hours of cost windows before it sizes anything", () => {
      expect(MIN_OBSERVED_HOURS).toBe(24);
      lineWith(COST_PAGE, "needs at least 24 hours of cost windows");
      expect(
        buildRightSizingRecommendation(
          {
            namespace: "shop",
            controllerKind: "Deployment",
            controllerName: "web",
            containerName: "web",
            sampleCount: MIN_OBSERVED_HOURS,
            cpuCoreRequestAverage: 2,
            cpuCoreUsageP95: 0.1,
            cpuCost: 10,
            ramBytesRequestAverage: 1024,
            ramBytesUsagePeak: 1024,
            ramCost: 10,
          },
          MIN_OBSERVED_HOURS - 1,
        ).cpu.recommended,
      ).toBeNull();
    });
  });
});

describe("the Kubernetes agent page, against the setup guide and the chart", () => {
  it("installs with the setup guide's command for each platform tab", () => {
    const tabs: Array<[KubernetesPlatform, string]> = [
      ["standard", ""],
      ["gke-autopilot", "--set preset=gke-autopilot"],
      ["eks-fargate", "--set preset=eks-fargate"],
    ];
    const installs: Array<string> = codesOf(KUBERNETES_PAGE).filter(
      (code: string): boolean => {
        return (
          code.startsWith("helm install") && code.includes("aiAgent.enabled")
        );
      },
    );
    expect(installs).toHaveLength(tabs.length);
    tabs.forEach(
      (
        [platform, presetFlag]: [KubernetesPlatform, string],
        index: number,
      ): void => {
        const guide: string = textsOf(
          getKubernetesSetupGuide({
            oneuptimeUrl: URL_PLACEHOLDER,
            apiKey: "YOUR_ONEUPTIME_API_KEY",
            platform: platform,
          }),
        ).join("\n");
        expect(guide).toContain(installs[index] as string);
        expect(installs[index]?.includes("--set preset=")).toBe(
          presetFlag !== "",
        );
        if (presetFlag) {
          expect(installs[index]).toContain(presetFlag);
        }
      },
    );
  });

  it("runs every install and upgrade on the release and namespace the dashboard uses", () => {
    for (const page of [KUBERNETES_PAGE, COST_PAGE]) {
      const commands: Array<string> = codesOf(page).filter(
        (code: string): boolean => {
          return HELM_COMMAND.test(code);
        },
      );
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command.match(HELM_COMMAND)?.[1]).toBe(
          KUBERNETES_AGENT_HELM_RELEASE,
        );
        expect(command).toContain(
          `--namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
        );
      }
    }
  });

  it("gives the trace sampling defaults the chart's values.yaml has", () => {
    expect(rowOf(KUBERNETES_PAGE, "`sampling.traces.percentage`")[1]).toContain(
      `Default \`${at(chartValues, "sampling.traces.percentage")}\``,
    );
    expect(rowOf(KUBERNETES_PAGE, "`sampling.traces.hashSeed`")[1]).toContain(
      `Default \`${at(chartValues, "sampling.traces.hashSeed")}\``,
    );
  });

  it("marks each eBPF signal family on or off as values.yaml does", () => {
    for (const family of [
      "httpMetrics",
      "spanMetrics",
      "serviceGraph",
      "networkMetrics",
      "networkInterZoneMetrics",
      "tcpStats",
    ]) {
      expect([family, rowOf(KUBERNETES_PAGE, `\`${family}\``)[1]]).toEqual([
        family,
        at(chartValues, `ebpf.features.${family}`) ? "on" : "off",
      ]);
    }
  });

  it("states the collection defaults values.yaml has", () => {
    const page: string = english(KUBERNETES_PAGE);
    expect(page).toContain(
      `\`collectionInterval\` (default \`${at(chartValues, "collectionInterval")}\`)`,
    );
    expect(page).toContain(
      `\`resourceSpecs.interval\` (default \`${at(chartValues, "resourceSpecs.interval")}\`)`,
    );
    expect(at(chartValues, "filters.metrics.matchType")).toBe("strict");
    expect(rowOf(KUBERNETES_PAGE, "`filters.metrics.matchType`")[1]).toContain(
      "`strict` (the exact name, the default)",
    );
    expect(at(chartValues, "filters.logs.minSeverity")).toBe("");
    lineWith(KUBERNETES_PAGE, 'the default (`""`) keeps everything');
    expect(at(chartValues, "namespaceFilters.rules")).toEqual([
      {
        action: "exclude",
        namespaces: ["kube-system"],
        scopes: ["podLogs", "ebpfDiscovery"],
      },
    ]);
    lineWith(
      KUBERNETES_PAGE,
      "The default rule excludes `kube-system` from `podLogs` and `ebpfDiscovery` only.",
    );
  });

  it("states the eBPF trace defaults values.yaml has", () => {
    const page: string = english(KUBERNETES_PAGE);
    expect(at(chartValues, "ebpf.dropDatabaseServerSpans")).toBe(true);
    expect(page).toContain("(`ebpf.dropDatabaseServerSpans=true`)");
    expect(at(chartValues, "ebpf.dropUnlinkedDatabaseCalls")).toBe(true);
    expect(page).toContain("(`ebpf.dropUnlinkedDatabaseCalls=true`)");
    expect(at(chartValues, "ebpf.dropUnlinkedClientCalls")).toBe(false);
    lineWith(
      KUBERNETES_PAGE,
      "`ebpf.dropUnlinkedClientCalls=true`",
      "It is off by default",
    );
    expect(at(chartValues, "ebpf.contextPropagation")).toBe(true);
    lineWith(KUBERNETES_PAGE, "`traceparent`", "is on by default");
    expect(at(chartValues, "ebpf.excludeOtelInstrumentedServices")).toBe(true);
    expect(page).toContain(
      "(`ebpf.excludeOtelInstrumentedServices=true`, OBI's default)",
    );
    expect(at(chartValues, "ebpf.autoTargetExe")).toBe("*");
    expect(page).toContain('(`ebpf.autoTargetExe: "*"`)');
  });

  it("scrapes CoreDNS where values.yaml points, and only when asked", () => {
    expect(at(chartValues, "coreDns.enabled")).toBe(false);
    expect(at(chartValues, "coreDns.namespace")).toBe("kube-system");
    lineWith(
      KUBERNETES_PAGE,
      `The agent scrapes port \`${at(chartValues, "coreDns.port")}\` of the pods labelled \`k8s-app=${at(chartValues, "coreDns.service")}\` in \`kube-system\``,
    );
  });

  it("leaves the heavy features off, as the opt-in table says", () => {
    for (const option of [
      "profiling.enabled",
      "auditLogs.enabled",
      "controlPlane.enabled",
      "kubeStateMetrics.enabled",
      "ebpf.features.networkInterZoneMetrics",
      "cost.enabled",
    ]) {
      expect([option, at(chartValues, option)]).toEqual([option, false]);
      rowOf(KUBERNETES_PAGE, `\`${option}\``);
    }
    expect(at(chartValues, "kubeletstats.volumeMetrics.enabled")).toBe(true);
    lineWith(
      KUBERNETES_PAGE,
      "(`kubeletstats.volumeMetrics.enabled`, on by default)",
    );
    expect(at(chartValues, "kubeletstats.utilizationMetrics.enabled")).toBe(
      true,
    );
    lineWith(
      KUBERNETES_PAGE,
      "(`kubeletstats.utilizationMetrics.enabled`, on by default)",
    );
  });

  it("gives the AI agent's image and resources as the chart does", () => {
    const template: string = chartFile("templates/ai-agent.yaml");
    expect(at(chartValues, "aiAgent.enabled")).toBe(true);
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.enabled`")[1]).toBe("`true`");

    expect(at(chartValues, "aiAgent.image.repository")).toBe(
      "oneuptime/kubernetes-ai-agent",
    );
    expect(template).toContain(
      '$image.repository | default "oneuptime/kubernetes-ai-agent"',
    );
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.image.repository`")[1]).toBe(
      "`oneuptime/kubernetes-ai-agent`",
    );

    // An empty tag renders as release, pulled Always; a pinned one IfNotPresent.
    expect(at(chartValues, "aiAgent.image.tag")).toBe("");
    expect(template).toContain('$image.tag | default "release"');
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.image.tag`")[1]).toBe("`release`");
    expect(template).toContain('ternary "Always" "IfNotPresent" $movingTag');
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.image.pullPolicy`")[1]).toBe(
      "`Always` for `release`, `IfNotPresent` for a pinned tag",
    );

    expect(at(chartValues, "aiAgent.imagePullSecrets")).toEqual([]);
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.imagePullSecrets`")[1]).toBe(
      "`[]`",
    );

    expect(at(chartValues, "aiAgent.resources")).toEqual({
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    });
    expect(rowOf(KUBERNETES_PAGE, "`aiAgent.resources`")[1]).toBe(
      "`50m` / `64Mi` requests, `500m` / `256Mi` limits",
    );
  });

  it("names each workload and selects its pods by the labels the chart gives them", () => {
    const workloads: Array<[string, string, string]> = [
      ["templates/deployment.yaml", "", "metrics-collector"],
      ["templates/daemonset.yaml", "-logs", "log-collector"],
      ["templates/deployment-logs-api.yaml", "-logs", "log-collector"],
      ["templates/daemonset-ebpf.yaml", "-ebpf", "ebpf-instrument"],
      ["templates/deployment-cost-agent.yaml", "-cost", ""],
    ];
    for (const [template, suffix, component] of workloads) {
      const text: string = chartFile(template);
      expect(text).toContain(
        `name: {{ include "kubernetes-agent.fullname" . }}${suffix}\n`,
      );
      if (component) {
        expect(text).toContain(`component: ${component}`);
      }
    }
    const aiAgent: string = chartFile("templates/ai-agent.yaml");
    expect(aiAgent).toContain("name: {{ $fullname }}-ai-agent\n");
    expect(aiAgent).toContain("component: ai-agent");

    const page: string = english(KUBERNETES_PAGE);
    for (const component of [
      "metrics-collector",
      "log-collector",
      "ebpf-instrument",
    ]) {
      expect(page).toContain(`-l component=${component}`);
    }
    expect(page).toContain("`component=ai-agent`");
    expect(page).toContain(
      `\`kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} deployment/${KUBERNETES_AGENT_HELM_RELEASE}-logs\``,
    );
    expect(page).toContain(`\`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\``);
    expect(english(COST_PAGE)).toContain(
      `\`kubectl logs -n ${KUBERNETES_AGENT_HELM_NAMESPACE} deploy/${KUBERNETES_AGENT_HELM_RELEASE}-cost\``,
    );
    expect(chartFile("templates/opencost.yaml")).toContain(
      'name: {{ include "kubernetes-agent.fullname" . }}-opencost\n',
    );
    expect(english(COST_PAGE)).toContain(
      `deploy/${KUBERNETES_AGENT_HELM_RELEASE}-opencost`,
    );
  });

  it("names the release-contains rule the chart's fullname follows", () => {
    expect(chartFile("templates/_helpers.tpl")).toContain(
      "{{- if contains $name .Release.Name }}",
    );
    lineWith(
      COST_PAGE,
      "`<release>-kubernetes-agent-cost` when the release name does not contain `kubernetes-agent`",
    );
  });

  it("asks the log tailer for /healthz on the port it serves", () => {
    expect(chartFile("templates/deployment-logs-api.yaml")).toContain(
      "containerPort: 13133",
    );
    lineWith(KUBERNETES_PAGE, "Check its `/healthz`", "port `13133`");
  });
});

describe("the host collector page, against the setup guide", () => {
  it("installs the collector release OneUptime pins", () => {
    const pins: Array<string> = fencesOf(HOST_PAGE).flatMap(
      (fence: DocsFence): Array<string> => {
        return Array.from(
          fence.code.matchAll(/^\$?VERSION\s*=\s*"?([\d.]+)"?/gim),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });
      },
    );
    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins)).toEqual(new Set([HOST_COLLECTOR_VERSION]));
    lineWith(
      HOST_PAGE,
      `the commands below install v${HOST_COLLECTOR_VERSION}, the release OneUptime pins`,
    );
  });

  it("names the first release whose systemd receiver is worth running", () => {
    lineWith(
      HOST_PAGE,
      `The \`systemd\` receiver (Linux) works from ${MIN_OTELCOL_CONTRIB_VERSION}`,
    );
    lineWith(
      HOST_PAGE,
      `and ${MIN_OTELCOL_CONTRIB_VERSION} is the first release worth running`,
    );
  });

  it("lists the unit states the receiver's state set has, in its order", () => {
    const line: string = lineWith(
      HOST_PAGE,
      "each unit gets one datapoint per possible state",
    );
    const states: Array<string> = codeSpansOf(line).filter(
      (span: string): boolean => {
        return SYSTEMD_ACTIVE_STATES.includes(span);
      },
    );
    expect(states).toEqual(SYSTEMD_ACTIVE_STATES);
  });

  describe("every config.yaml the page hands out", () => {
    const configs: Array<YamlNode> = fencesOf(HOST_PAGE)
      .filter((fence: DocsFence): boolean => {
        return fence.info === 'yaml title="config.yaml"';
      })
      .map((fence: DocsFence): YamlNode => {
        return yamlOf(fence.code);
      });

    it("is one per operating system, and the lean starting point", () => {
      expect(configs).toHaveLength(4);
    });

    it("turns on the utilization metrics the host's charts and the Host templates read", () => {
      for (const config of configs) {
        const scrapers: YamlNode = at(
          config,
          "receivers.hostmetrics.scrapers",
        ) as YamlNode;
        for (const [scraper, metric] of [
          ["cpu", "system.cpu.utilization"],
          ["cpu", "system.cpu.logical.count"],
          ["memory", "system.memory.utilization"],
          ["filesystem", "system.filesystem.utilization"],
        ] as Array<[string, string]>) {
          expect([
            metric,
            (at(scrapers[scraper], "metrics") as YamlNode)[metric],
          ]).toEqual([metric, { enabled: true }]);
        }
      }
    });

    /*
     * Snap packages, CD and ISO images and macOS's /dev read 100% used for
     * as long as they are mounted, so a config that measures them keeps
     * High Filesystem Usage firing on them for good.
     */
    it("leaves the file systems that are full by design out, as OneUptime's default does", () => {
      for (const config of configs) {
        expect(
          at(
            config,
            "receivers.hostmetrics.scrapers.filesystem.exclude_fs_types",
          ),
        ).toEqual({
          fs_types: [...HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES],
          match_type: "strict",
        });
      }
      lineWith(
        HOST_PAGE,
        "The configs above leave out of the `filesystem` scraper the file systems that are full by design",
        "`exclude_fs_types`",
        "`exclude_mount_points`",
      );
    });

    it("and so does every other hostmetrics receiver it hands out", () => {
      const receivers: Array<YamlNode> = fencesOf(HOST_PAGE)
        .filter((fence: DocsFence): boolean => {
          return fence.lang === "yaml";
        })
        .map((fence: DocsFence): YamlNode => {
          return yamlOf(fence.code);
        })
        .map((document: YamlNode): YamlNode => {
          return at(document, "receivers.hostmetrics.scrapers") as YamlNode;
        })
        .filter((scrapers: YamlNode | undefined): boolean => {
          return Boolean(scrapers) && "filesystem" in scrapers!;
        });

      // The four configs and the narrowed process scraper.
      expect(receivers).toHaveLength(5);
      for (const scrapers of receivers) {
        expect(
          (scrapers["filesystem"] as YamlNode)["exclude_fs_types"],
        ).toEqual({
          fs_types: [...HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES],
          match_type: "strict",
        });
      }
    });

    it("stamps every attribute the inventory table says resourcedetection sets", () => {
      const fromDetection: Array<string> = english(HOST_PAGE)
        .split("\n")
        .filter((line: string): boolean => {
          return (
            ATTRIBUTE_ROW.test(line) && line.includes("| `resourcedetection`")
          );
        })
        .flatMap((line: string): Array<string> => {
          return codeSpansOf(line.split(" | ")[1] as string);
        });
      expect(fromDetection).toEqual(
        expect.arrayContaining([
          "host.ip",
          "host.mac",
          "host.arch",
          "host.id",
          "os.type",
        ]),
      );
      for (const config of configs) {
        const attributes: YamlNode = at(
          config,
          "processors.resourcedetection.system.resource_attributes",
        ) as YamlNode;
        for (const attribute of fromDetection) {
          expect([attribute, attributes[attribute]]).toEqual([
            attribute,
            { enabled: true },
          ]);
        }
      }
    });
  });
});

/*
 * Docs overhaul task 22: the Ceph, Storage Array, Docker Swarm and VMware
 * agent pages, Databases, Queues and Serverless Functions, held to what
 * ships. The agents' compose files, configs and in-app guides, the
 * metric catalogs and the products' own suites (DatabasesDocs, QueuesDocs,
 * ServerlessFunctionsDocs, StorageArrayDocs, VMwareDocs, CephMonitorDocs-
 * Facts) hold most of these pages already; this holds what the rewrite
 * added: when a resource turns Disconnected, the systemd units the pages
 * download, the Ceph series behind every Ceph page, the Docker Swarm
 * defaults and re-run, and where each product sits in the Products menu.
 */

const CEPH_PAGE: string = "telemetry/ceph";
const STORAGE_ARRAYS_PAGE: string = "telemetry/storage-arrays";
const DOCKER_SWARM_PAGE: string = "telemetry/docker-swarm";
const VMWARE_PAGE: string = "telemetry/vmware";
const DATABASES_PAGE: string = "telemetry/databases";
const QUEUES_PAGE: string = "telemetry/queues";
const SERVERLESS_PAGE: string = "telemetry/serverless-functions";

const TASK_22_PAGES: Array<string> = [
  CEPH_PAGE,
  STORAGE_ARRAYS_PAGE,
  DOCKER_SWARM_PAGE,
  VMWARE_PAGE,
  DATABASES_PAGE,
  QUEUES_PAGE,
  SERVERLESS_PAGE,
];

// A bold menu path into the Products menu: "**Products → Infrastructure → Ceph → ...**".
const PRODUCTS_PATH: RegExp = /\*\*Products → ([^*]+)\*\*/g;

// A Products menu item of Utils/NavigationItems: its title key, then its category.
const MENU_ITEM: RegExp =
  /title: t\(\s*"navbar\.items\.(\w+)"[\s\S]*?category: (\w+)Category,/g;

// A Ceph series name, as a page writes it in code.
const CEPH_SERIES: RegExp = /^ceph_[a-z_]+$/;

interface Disconnect {
  page: string;
  noun: string;
  service: string;
  method: string;
  job: string;
}

const DISCONNECTS: Array<Disconnect> = [
  {
    page: CEPH_PAGE,
    noun: "cluster",
    service: "CephClusterService",
    method: "markDisconnectedClusters",
    job: "Ceph",
  },
  {
    page: DOCKER_SWARM_PAGE,
    noun: "cluster",
    service: "DockerSwarmClusterService",
    method: "markDisconnectedClusters",
    job: "DockerSwarm",
  },
  {
    page: VMWARE_PAGE,
    noun: "vCenter",
    service: "VMwareVCenterService",
    method: "markDisconnectedVCenters",
    job: "VMware",
  },
  {
    page: STORAGE_ARRAYS_PAGE,
    noun: "array",
    service: "StorageArrayService",
    method: "markDisconnectedArrays",
    job: "StorageArray",
  },
  {
    page: SERVERLESS_PAGE,
    noun: "function",
    service: "ServerlessFunctionService",
    method: "markDisconnectedFunctions",
    job: "Serverless",
  },
];

describe("when a task 22 page says a resource turns Disconnected", () => {
  it.each(DISCONNECTS)(
    "$page: after the 15 minutes of receiving time $service waits, checked every 5 minutes",
    (entry: Disconnect) => {
      const service: string = repoFile(
        `packages/Common/Server/Services/${entry.service}.ts`,
      );
      const start: number = service.indexOf(`public async ${entry.method}()`);
      expect(start).toBeGreaterThan(-1);
      const method: string = service.slice(start, start + 1500);
      expect(method).toContain("ReceivingCoverage.getSilenceCutoff({");
      expect(method).toContain("silenceInMinutes: 15,");

      const job: string = repoFile(
        `packages/App/FeatureSet/Workers/Jobs/${entry.job}/CleanupStaleResources.ts`,
      );
      expect(job).toContain("schedule: EVERY_FIVE_MINUTE");
      expect(job).toContain(`${entry.service}.${entry.method}()`);

      const article: string = entry.noun.startsWith("a") ? "An" : "A";
      lineWith(
        entry.page,
        `${article} ${entry.noun} turns Disconnected when OneUptime has received nothing from it for 15 minutes; OneUptime checks every 5 minutes, and time it was not receiving data itself does not count.`,
      );
    },
  );
});

interface SystemdUnit {
  page: string;
  agent: string;
  unit: string;
  installDir: string;
  // The sentence that names the folder the unit runs in.
  folderLine: string;
}

const SYSTEMD_UNITS: Array<SystemdUnit> = [
  {
    page: CEPH_PAGE,
    agent: "CephAgent",
    unit: "oneuptime-ceph-agent",
    installDir: CEPH_AGENT_INSTALL_DIR,
    folderLine: "It assumes the agent lives in",
  },
  {
    page: STORAGE_ARRAYS_PAGE,
    agent: "StorageArrayAgent",
    unit: "oneuptime-storage-array-agent",
    installDir: STORAGE_ARRAY_AGENT_INSTALL_DIR,
    folderLine: "It assumes the agent lives in",
  },
  {
    page: DOCKER_SWARM_PAGE,
    agent: "DockerSwarmAgent",
    unit: "oneuptime-docker-swarm-agent",
    installDir: DOCKER_SWARM_AGENT_INSTALL_DIR,
    folderLine: "It assumes the agent lives in",
  },
  {
    page: VMWARE_PAGE,
    agent: "VMwareAgent",
    unit: "oneuptime-vmware-agent",
    installDir: VMWARE_AGENT_INSTALL_DIR,
    folderLine: "Its unit wraps Docker Compose and assumes the agent lives in",
  },
  // Task 21's page, which had the same "sudo cp systemd/..." step.
  {
    page: PROXMOX_PAGE,
    agent: "ProxmoxAgent",
    unit: "oneuptime-proxmox-agent",
    installDir: PROXMOX_AGENT_INSTALL_DIR,
    folderLine: "It assumes the agent lives in",
  },
];

/*
 * Where OneUptime Cloud serves an agent's unit: every OneUptime serves the
 * files of agents/<agent> at /install/<agent> (Common/Types/InstallScripts).
 */
function servedUnitUrl(entry: SystemdUnit): string {
  const served: InstallScriptEntry | undefined = INSTALL_SCRIPTS.find(
    (script: InstallScriptEntry): boolean => {
      return script.sourceDirectory === `agents/${entry.agent}`;
    },
  );
  const file: string = `systemd/${entry.unit}.service`;

  expect({ agent: entry.agent, lists: served?.files.includes(file) }).toEqual({
    agent: entry.agent,
    lists: true,
  });
  return getInstallFileUrl(DOCS_ONEUPTIME_URL, served!.name, file);
}

// The agents' own READMEs, which GitHub shows beside the files.
const AGENT_READMES: Array<string> = fs
  .readdirSync(path.join(REPO_ROOT, "agents"))
  .filter((agent: string): boolean => {
    return fs.existsSync(path.join(REPO_ROOT, "agents", agent, "README.md"));
  })
  .sort();

describe("the systemd units the agent pages install", () => {
  /*
   * The install scripts put only the compose file and configs in the
   * agent's folder, never the agent's systemd/ directory, so a page that
   * said "sudo cp systemd/..." worked only from a checkout of the repo.
   * The pages download the shipped unit instead.
   */
  it.each(SYSTEMD_UNITS)(
    "$page downloads $unit.service, which runs in the folder the install script uses",
    (entry: SystemdUnit) => {
      const unit: string = repoFile(
        `agents/${entry.agent}/systemd/${entry.unit}.service`,
      );
      expect(unit).toContain(`WorkingDirectory=${entry.installDir}`);
      expect(repoFile(`agents/${entry.agent}/install.sh`)).not.toContain(
        "systemd/",
      );

      expect(codesOf(entry.page)).toContain(
        [
          `sudo curl -fsSL ${servedUnitUrl(entry)} -o /etc/systemd/system/${entry.unit}.service`,
          "sudo systemctl daemon-reload",
          `sudo systemctl enable --now ${entry.unit}`,
        ].join("\n"),
      );
      expect(english(entry.page)).not.toContain("sudo cp systemd/");
      lineWith(entry.page, `${entry.folderLine} \`${entry.installDir}\``);
    },
  );

  it.each(SYSTEMD_UNITS)(
    "$agent's README installs $unit.service, if it does, the way $page does",
    (entry: SystemdUnit) => {
      const readme: string = repoFile(`agents/${entry.agent}/README.md`);
      const installsUnit: boolean = readme.includes(
        `/etc/systemd/system/${entry.unit}.service`,
      );

      // Every README but Docker Swarm's has a systemd section.
      expect({ agent: entry.agent, installsUnit }).toEqual({
        agent: entry.agent,
        installsUnit: entry.agent !== "DockerSwarmAgent",
      });

      if (installsUnit) {
        expect(readme).toContain(
          `sudo curl -fsSL ${servedUnitUrl(entry)} -o /etc/systemd/system/${entry.unit}.service`,
        );
      }
    },
  );

  /*
   * A README may copy a unit out of the agent's folder only when its
   * install script downloads systemd/ there (the Database Agent's does).
   */
  it.each(AGENT_READMES)(
    "agents/%s/README.md copies no unit its install script never downloads",
    (agent: string) => {
      const installScript: string = path.join(
        REPO_ROOT,
        "agents",
        agent,
        "install.sh",
      );
      const fetchesSystemd: boolean =
        fs.existsSync(installScript) &&
        fs.readFileSync(installScript, "utf8").includes("/systemd/");

      if (!fetchesSystemd) {
        expect(repoFile(`agents/${agent}/README.md`)).not.toContain(
          "cp systemd/",
        );
      }
    },
  );

  it("knows the agents whose READMEs it reads", () => {
    for (const entry of SYSTEMD_UNITS) {
      expect(AGENT_READMES).toContain(entry.agent);
    }
    expect(AGENT_READMES).toContain("DatabaseAgent");
  });
});

describe("the Ceph agent page, against the catalog and the inventory scan", () => {
  // The labels a Ceph series carries, which the page names beside the series.
  const CEPH_LABELS: Array<string> = ["ceph_daemon", "ceph_version"];

  function collectedSection(): string {
    const page: string = english(CEPH_PAGE);
    return page.slice(
      page.indexOf("## What the agent collects"),
      page.indexOf("### More scrape targets"),
    );
  }

  it("names every series the metric catalog and the inventory scan read, and no other", () => {
    const named: Set<string> = new Set(
      codeSpansOf(collectedSection()).filter((span: string): boolean => {
        return CEPH_SERIES.test(span) && !CEPH_LABELS.includes(span);
      }),
    );
    const product: Set<string> = new Set([
      ...getAllCephMetrics().map((metric: CephMetricDefinition): string => {
        return metric.metricName;
      }),
      ...Array.from(CEPH_SNAPSHOT_METRIC_NAMES),
    ]);

    expect(Array.from(named).sort()).toEqual(Array.from(product).sort());
  });

  it("puts each catalog series in its catalog category's row", () => {
    const rows: Record<string, string> = {
      "Cluster Health": "Cluster health",
      OSD: "OSD",
      Pool: "Pool",
      PG: "Placement groups",
    };
    for (const metric of getAllCephMetrics()) {
      const row: Array<string> = rowOf(
        CEPH_PAGE,
        rows[metric.category] as string,
      );
      expect([
        metric.metricName,
        (row[1] as string).includes(`\`${metric.metricName}\``),
      ]).toEqual([metric.metricName, true]);
    }
  });

  it("names the Daemons page's series and the version label the inventory scan reads", () => {
    const scan: string = repoFile(
      "packages/Common/Server/Utils/Telemetry/ProxmoxCephSnapshotScan.ts",
    );
    const row: string = rowOf(CEPH_PAGE, "Daemons")[1] as string;
    for (const metric of [
      "ceph_mgr_metadata",
      "ceph_mds_metadata",
      "ceph_rgw_metadata",
    ]) {
      expect(CEPH_SNAPSHOT_METRIC_NAMES.has(metric)).toBe(true);
      expect(row).toContain(`\`${metric}\``);
    }
    expect(scan).toContain('getStringAttribute(dpAttributes, "ceph_version")');
    expect(row).toContain("`ceph_version`");
    expect(row).toContain("**Daemons**");
    expect(
      repoFile(
        "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/SideMenu.tsx",
      ),
    ).toContain('title: "Daemons"');
  });

  it("names the Overview card that lists the active health checks", () => {
    expect(
      repoFile(
        "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx",
      ),
    ).toContain('title="Active Health Checks"');
    lineWith(CEPH_PAGE, "`ceph_health_detail`", "**Active Health Checks**");
  });

  it("scrapes every mgr every 30 seconds, keeping Ceph's labels, and defaults the name as the compose file does", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/CephAgent/otel-collector-config.yaml"),
    );
    const scrape: YamlNode = (
      at(
        config,
        "receivers.prometheus.config.scrape_configs",
      ) as Array<YamlNode>
    )[0] as YamlNode;
    expect(scrape["scrape_interval"]).toBe("30s");
    expect(scrape["honor_labels"]).toBe(true);
    lineWith(CEPH_PAGE, "**Every mgr, every 30 seconds.**");
    lineWith(CEPH_PAGE, "**`honor_labels: true`.**");

    const compose: string = repoFile("agents/CephAgent/docker-compose.yml");
    expect(rowOf(CEPH_PAGE, "`CEPH_CLUSTER_NAME`")[2]).toContain(
      `Defaults to \`${composeDefault(compose, "CEPH_CLUSTER_NAME")}\``,
    );
  });
});

describe("the Docker Swarm agent page, against the agent and its setup guide", () => {
  const compose: string = repoFile(
    "agents/DockerSwarmAgent/docker-compose.yml",
  );

  it("downloads the files the setup guide downloads, in its order", () => {
    expect(codesOf(DOCKER_SWARM_PAGE)).toContain(
      getDockerSwarmAgentDownloadCommand(DOCS_ONEUPTIME_URL),
    );
  });

  it("states the defaults the compose file and the setup guide give", () => {
    expect(composeDefault(compose, "DOCKER_SWARM_CLUSTER_NAME")).toBe(
      DOCKER_SWARM_DEFAULT_CLUSTER_NAME,
    );
    expect(
      rowOf(DOCKER_SWARM_PAGE, "`DOCKER_SWARM_CLUSTER_NAME`")[2],
    ).toContain(`Defaults to \`${DOCKER_SWARM_DEFAULT_CLUSTER_NAME}\``);

    expect(composeDefault(compose, "DOCKER_INVENTORY_INTERVAL_SECONDS")).toBe(
      DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS,
    );
    expect(
      rowOf(DOCKER_SWARM_PAGE, "`DOCKER_INVENTORY_INTERVAL_SECONDS`")[2],
    ).toContain(
      `Defaults to \`${DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS}\``,
    );

    // Empty: the collector negotiates the version with the daemon.
    expect(DOCKER_SWARM_DEFAULT_API_VERSION).toBe("");
    expect(composeDefault(compose, "DOCKER_API_VERSION")).toBe(
      DOCKER_SWARM_DEFAULT_API_VERSION,
    );
    expect(rowOf(DOCKER_SWARM_PAGE, "`DOCKER_API_VERSION`")[2]).toContain(
      "Empty by default: they use the daemon's own",
    );
  });

  /*
   * Swarm labels a task with its node's ID only: the node's name comes from
   * DOCKER_SWARM_NODE_NAME, which install.sh writes and a Docker Compose
   * install adds with the setup guide's command.
   */
  it("says where the node's name comes from, as the installer, the compose file and the setup guide do", () => {
    expect(composeDefault(compose, "DOCKER_SWARM_NODE_NAME")).toBe("");
    expect(repoFile("agents/DockerSwarmAgent/install.sh")).toContain(
      "DOCKER_SWARM_NODE_NAME=${DOCKER_SWARM_NODE_NAME}",
    );
    expect(codesOf(DOCKER_SWARM_PAGE)).toContain(
      DOCKER_SWARM_NODE_NAME_COMMAND,
    );
    expect(rowOf(DOCKER_SWARM_PAGE, "`DOCKER_SWARM_NODE_NAME`")[2]).toContain(
      "The install script sets it to the node's hostname",
    );
    lineWith(
      DOCKER_SWARM_PAGE,
      "writes a `.env` file only its owner can read, with the node's hostname as `DOCKER_SWARM_NODE_NAME`",
    );
  });

  /*
   * The receiver stamps container.runtime=docker on a Swarm task's metrics
   * too: the page used to say the agent stamps only the cluster name.
   */
  it("says what each task's metrics carry, as the collector config sends it", () => {
    const config: string = repoFile(
      "agents/DockerSwarmAgent/otel-collector-config.yaml",
    );
    const line: string = lineWith(
      DOCKER_SWARM_PAGE,
      "Each task's metrics carry",
    );
    for (const [label, attribute] of [
      ["com.docker.swarm.service.name", "docker.swarm.service.name"],
      ["com.docker.swarm.node.id", "docker.swarm.node.id"],
    ]) {
      expect(config).toContain(`${label}: ${attribute}`);
      expect(line).toContain(`\`${attribute}\``);
    }
    expect(config).toContain('set(attributes["docker.swarm.node.name"]');
    expect(line).toContain("`docker.swarm.node.name`");
    expect(line).toContain("`container.runtime=docker`");
    expect(english(DOCKER_SWARM_PAGE)).not.toContain(
      "stamps only `docker.swarm.cluster.name`",
    );
  });

  it("names the three containers the compose file runs", () => {
    const services: YamlNode = at(yamlOf(compose), "services") as YamlNode;
    const names: Array<string> = Object.values(services).map(
      (service: unknown): string => {
        return (service as YamlNode)["container_name"] as string;
      },
    );
    expect(names).toEqual([
      "oneuptime-docker-swarm-agent",
      "oneuptime-docker-swarm-inventory",
      "oneuptime-docker-swarm-ai-agent",
    ]);
    lineWith(
      DOCKER_SWARM_PAGE,
      "the collector (`oneuptime-docker-swarm-agent`), the inventory poller (`oneuptime-docker-swarm-inventory`) and the AI agent (`oneuptime-docker-swarm-ai-agent`)",
    );
  });

  it("walks the manager endpoints the inventory script reads, every 5 minutes", () => {
    const script: string = repoFile(
      "agents/DockerSwarmAgent/inventory-snapshot.sh",
    );
    const line: string = lineWith(
      DOCKER_SWARM_PAGE,
      "every 5 minutes walks the swarm manager's API",
    );
    for (const endpoint of [
      "/nodes",
      "/services",
      "/tasks",
      "/networks",
      "/secrets",
      "/configs",
      "/volumes",
    ]) {
      expect(script).toContain(endpoint);
      expect(line).toContain(`\`${endpoint}\``);
    }
    expect(script).toContain("com.docker.stack.namespace");
    expect(DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS).toBe("300");
  });

  it("says a re-run of install.sh writes .env again, keeping only what AI may do and its target lists", () => {
    const install: string = repoFile("agents/DockerSwarmAgent/install.sh");
    for (const kept of [
      "ONEUPTIME_AI_WRITE_TARGETS",
      "ONEUPTIME_AI_PROTECTED_TARGETS",
      "ONEUPTIME_AI_INVESTIGATION",
      "ONEUPTIME_AI_FIXES",
    ]) {
      expect(install).toContain(`${kept}="$(env_file_value ${kept})"`);
    }
    /*
     * Asked again on every run: the URL (Enter takes ONEUPTIME_URL, or
     * OneUptime Cloud), the key and the cluster name.
     */
    expect(install).toContain(
      'ONEUPTIME_URL_DEFAULT="${ONEUPTIME_URL:-https://oneuptime.com}"\nprintf "OneUptime URL [%s]: " "${ONEUPTIME_URL_DEFAULT}"\nread -r ONEUPTIME_URL\n',
    );
    expect(install).not.toContain("env_file_value ONEUPTIME_AI_ALLOW_WRITES");
    expect(install).toContain("--no-ai-agent) INSTALL_AI_AGENT=false ;;");

    lineWith(
      DOCKER_SWARM_PAGE,
      "It keeps only the AI agent's target lists and what AI may do (`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`)",
    );
    lineWith(
      DOCKER_SWARM_PAGE,
      "`ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh`",
    );
  });
});

describe("the Storage Array agent page, against the agent", () => {
  it("says the collector refuses to start without an array name, which the compose file gives no default", () => {
    const compose: string = repoFile(
      "agents/StorageArrayAgent/docker-compose.yml",
    );
    expect(compose).not.toContain("STORAGE_ARRAY_NAME:-");
    for (const config of [
      "otel-collector-config.yaml",
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
    ]) {
      expect(repoFile(`agents/StorageArrayAgent/${config}`)).toContain(
        'value: "${env:STORAGE_ARRAY_NAME}"',
      );
    }
    expect(rowOf(STORAGE_ARRAYS_PAGE, "`STORAGE_ARRAY_NAME`")[2]).toContain(
      "The collector refuses to start without it.",
    );
  });
});

/*
 * The Required column of the agent pages' variable tables. A variable its
 * compose file gives a default ("${NAME:-default}", or "${NAME-default}")
 * runs without one, and install.sh offers the same default at its prompt,
 * so the page never marks it required: CEPH_CLUSTER_NAME, the Docker Swarm
 * cluster name and the vCenter name all said "Yes" beside "Defaults to".
 */
interface VariableTable {
  page: string;
  compose: string;
}

const VARIABLE_TABLES: ReadonlyArray<VariableTable> = [
  { page: CEPH_PAGE, compose: "agents/CephAgent/docker-compose.yml" },
  {
    page: DOCKER_SWARM_PAGE,
    compose: "agents/DockerSwarmAgent/docker-compose.yml",
  },
  { page: VMWARE_PAGE, compose: "agents/VMwareAgent/docker-compose.yml" },
  {
    page: STORAGE_ARRAYS_PAGE,
    compose: "agents/StorageArrayAgent/docker-compose.yml",
  },
  { page: DATABASES_PAGE, compose: "agents/DatabaseAgent/docker-compose.yml" },
];

// A row of a variable table: the variable, then whether it is required.
const REQUIRED_ROW: RegExp = /^\| `([A-Z][A-Z0-9_]*)` \| ([^|]+) \|/;

// The English header of a variable table with a Required column.
const REQUIRED_TABLE_HEADER: string = "| Variable | Required |";

// How each docs language answers the Required column: yes, then no.
const REQUIRED_ANSWERS: Record<string, [string, string]> = {
  en: ["Yes", "No"],
  de: ["Ja", "Nein"],
  fr: ["Oui", "Non"],
  es: ["Sí", "No"],
  it: ["Sì", "No"],
  pt: ["Sim", "Não"],
  nl: ["Ja", "Nee"],
  da: ["Ja", "Nej"],
  no: ["Ja", "Nei"],
  sv: ["Ja", "Nej"],
  ru: ["Да", "Нет"],
  ja: ["はい", "いいえ"],
  ko: ["예", "아니요"],
  "zh-CN": ["是", "否"],
  "zh-TW": ["是", "否"],
  hi: ["हाँ", "नहीं"],
  fa: ["بله", "خیر"],
};

interface RequiredRow {
  line: number;
  name: string;
  answer: string;
}

// The variable rows of a page, with the line each is on and its answer.
function requiredRows(markdown: string): Array<RequiredRow> {
  const rows: Array<RequiredRow> = [];
  // Whether the line is inside a table headed "| Variable | Required |".
  let inRequiredTable: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (!line.startsWith("|")) {
      inRequiredTable = false;
      return;
    }

    if (line.startsWith(REQUIRED_TABLE_HEADER)) {
      inRequiredTable = true;
      return;
    }

    const answer: RequiredRow | null = requiredAnswerOf(line, index);

    if (inRequiredTable && answer) {
      rows.push(answer);
    }
  });

  return rows;
}

// A variable row's variable and the answer in its second column.
function requiredAnswerOf(line: string, index: number): RequiredRow | null {
  const match: RegExpMatchArray | null = line.match(REQUIRED_ROW);

  return match
    ? {
        line: index,
        name: match[1] as string,
        answer: (match[2] as string).trim(),
      }
    : null;
}

/*
 * A language's answer for the English one: its own yes or no, and a
 * condition (the storage array page's "FlashArray", the Databases page's
 * "PostgreSQL, MySQL, SQL Server, Oracle") as written.
 */
function requiredAnswer(english: string, answers: [string, string]): string {
  if (english === "Yes") {
    return answers[0];
  }

  return english === "No" ? answers[1] : english;
}

/*
 * A condition's names, in order, joined as English joins them: Chinese and
 * Japanese list them with an ideographic comma, Persian with its own comma.
 */
const CONDITION_SEPARATOR: RegExp = /\s*[,\u{060C}\u{3001}]\s*/u;

function conditionNames(answer: string): string {
  return answer.split(CONDITION_SEPARATOR).join(", ");
}

// Whether a compose file defaults the variable, in either of its two forms.
function composeDefaults(compose: string, name: string): boolean {
  return compose.includes(`\${${name}:-`) || compose.includes(`\${${name}-`);
}

describe("the agent pages' Required columns, against the compose files", () => {
  it.each(VARIABLE_TABLES)(
    "$page marks required only what $compose gives no default",
    (table: VariableTable) => {
      const compose: string = repoFile(table.compose);
      const rows: Array<RequiredRow> = requiredRows(english(table.page));

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect({
          variable: row.name,
          required: row.answer === "Yes",
        }).toEqual({
          variable: row.name,
          required: row.answer === "Yes" && !composeDefaults(compose, row.name),
        });
      }
    },
  );

  it("reads a default in either compose form, and no other variable's", () => {
    const compose: string = [
      "      - CEPH_CLUSTER_NAME=${CEPH_CLUSTER_NAME:-ceph}",
      "      - DOCKER_API_VERSION=${DOCKER_API_VERSION-1.44}",
      "      - CEPH_MGR_ENDPOINTS=${CEPH_MGR_ENDPOINTS}",
    ].join("\n");

    expect(composeDefaults(compose, "CEPH_CLUSTER_NAME")).toBe(true);
    expect(composeDefaults(compose, "DOCKER_API_VERSION")).toBe(true);
    expect(composeDefaults(compose, "CEPH_MGR_ENDPOINTS")).toBe(false);
    expect(composeDefaults(compose, "CEPH_CLUSTER")).toBe(false);
  });

  it("answers a translation's Required cell in its words, and a condition as written", () => {
    expect(requiredAnswer("Yes", ["Ja", "Nein"])).toBe("Ja");
    expect(requiredAnswer("No", ["Ja", "Nein"])).toBe("Nein");
    expect(requiredAnswer("FlashArray", ["Ja", "Nein"])).toBe("FlashArray");
    expect(conditionNames("PostgreSQL\u{3001}MySQL\u{3001}SQL Server")).toBe(
      "PostgreSQL, MySQL, SQL Server",
    );
    expect(conditionNames("PostgreSQL\u{060C} MySQL")).toBe(
      "PostgreSQL, MySQL",
    );
    expect(conditionNames("Ja")).toBe("Ja");
    expect(
      requiredRows(
        [
          "| Variable | Required | Description |",
          "| --- | --- | --- |",
          "| `CEPH_CLUSTER_NAME` | No | The cluster's name. |",
          "",
          "| Variable | Default | What it does |",
          "| --- | --- | --- |",
          "| `ONEUPTIME_AI_FIXES` | empty | How AI may apply a fix. |",
        ].join("\n"),
      ),
    ).toEqual([{ line: 2, name: "CEPH_CLUSTER_NAME", answer: "No" }]);
    expect(requiredRows("| Variable | Required | Description |")).toEqual([]);
  });

  it("answers the column in every docs language", () => {
    expect(Object.keys(REQUIRED_ANSWERS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s",
    (language: string) => {
      it.each(VARIABLE_TABLES)(
        "$page answers Yes and No where English does",
        (table: VariableTable) => {
          const answers: [string, string] = REQUIRED_ANSWERS[language] as [
            string,
            string,
          ];
          const translated: Array<string> = readPage(
            language,
            table.page,
          ).split("\n");

          for (const row of requiredRows(english(table.page))) {
            expect({
              variable: row.name,
              line: translated[row.line]?.startsWith(`| \`${row.name}\` |`),
              answer: conditionNames(
                requiredAnswerOf(translated[row.line] || "", row.line)
                  ?.answer || "",
              ),
            }).toEqual({
              variable: row.name,
              line: true,
              answer: requiredAnswer(row.answer, answers),
            });
          }
        },
      );
    },
  );
});

describe("the Products menu paths of the task 22 pages", () => {
  const navigation: string = repoFile(
    "packages/App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
  );
  const locale: YamlNode = JSON.parse(
    repoFile("packages/App/FeatureSet/Dashboard/src/Locales/en.json"),
  ) as YamlNode;
  const items: Record<string, string> = at(locale, "navbar.items") as Record<
    string,
    string
  >;
  const categories: Record<string, string> = at(
    locale,
    "navbar.categories",
  ) as Record<string, string>;

  // The Products menu's category of each product, by the product's English title.
  const categoryOf: Record<string, string> = {};
  for (const match of Array.from(navigation.matchAll(MENU_ITEM))) {
    categoryOf[items[match[1] as string] as string] = categories[
      match[2] as string
    ] as string;
  }

  it.each(TASK_22_PAGES)(
    "%s opens each product under the category the Products menu files it in",
    (page: string) => {
      const paths: Array<Array<string>> = Array.from(
        english(page).matchAll(PRODUCTS_PATH),
      ).map((match: RegExpMatchArray): Array<string> => {
        return (match[1] as string).split(" → ");
      });

      expect(paths.length).toBeGreaterThan(0);

      for (const [category, product] of paths) {
        expect({ product, category }).toEqual({
          product,
          category: categoryOf[product as string],
        });
      }
    },
  );

  it("knows the products these pages name, and their side menus' first pages", () => {
    expect(categoryOf["Databases"]).toBe("Resources");
    expect(categoryOf["Queues"]).toBe("Resources");
    for (const product of [
      "Ceph",
      "Storage Arrays",
      "Docker Swarm",
      "VMware",
      "Serverless",
    ]) {
      expect({ product, category: categoryOf[product] }).toEqual({
        product,
        category: "Infrastructure",
      });
    }
    const sideMenus: Array<[string, string]> = [
      ["Ceph", "All Clusters"],
      ["StorageArray", "All Storage Arrays"],
      ["DockerSwarm", "All Clusters"],
      ["VMware", "All vCenters"],
      ["Serverless", "All Functions"],
    ];
    for (const [folder, title] of sideMenus) {
      expect(
        repoFile(
          `packages/App/FeatureSet/Dashboard/src/Pages/${folder}/SideMenu.tsx`,
        ),
      ).toContain(`title: "${title}"`);
    }
  });
});

describe("the Databases and Queues pages, against the lists and discovery they describe", () => {
  it("names the Databases list's column of where a database came from", () => {
    expect(
      repoFile(
        "packages/App/FeatureSet/Dashboard/src/Pages/Database/Databases.tsx",
      ),
    ).toContain('title: "Discovered from"');
    lineWith(DATABASES_PAGE, "(the **Discovered from** column)");
  });

  it("gets a queue started in the numbers discovery runs on", () => {
    const job: string = repoFile(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
    );
    expect(job).toContain('const EVERY_TEN_MINUTES: string = "*/10 * * * *";');
    expect(job).toContain("export const WINDOW_MINUTES: number = 15;");
    expect(DEFAULT_MESSAGE_QUEUE_MIN_SPANS).toBe(3);
    lineWith(
      QUEUES_PAGE,
      "Discovery runs every 10 minutes: a queue appears once at least 3 of its spans arrived within 15 minutes, or a broker metric named it.",
    );
  });
});

describe("the Serverless Functions page, against ingest", () => {
  it("lists the FaaS platforms ingest names a function by", () => {
    // The identification table's row (the Azure table has one of its own).
    const row: string = lineWith(
      SERVERLESS_PAGE,
      "| `cloud.platform` | with `service.name`, when there is no `faas.name` |",
    ).split(" | ")[2] as string;
    expect(codeSpansOf(row).sort()).toEqual(
      Array.from(FAAS_CLOUD_PLATFORM_VALUES).sort(),
    );
  });

  it("names the runtime attributes ingest records for the overview", () => {
    const ingest: string = repoFile(
      "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    );
    expect(ingest).toContain('"process.runtime.name"');
    expect(ingest).toContain('"process.runtime.version"');
    rowOf(
      SERVERLESS_PAGE,
      "`process.runtime.name` / `process.runtime.version`",
    );
  });

  it("checks the key at the validate route the in-app guide checks too", () => {
    expect(codesOf(SERVERLESS_PAGE)).toContain(
      'curl -i https://oneuptime.com/otlp/v1/validate \\\n  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"',
    );
    expect(
      repoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessSetupGuide.ts",
      ),
    ).toContain("/otlp/v1/validate");
  });

  it("sends readers to Run Now for functions that already exist, which can run a serverless rule", () => {
    lineWith(
      SERVERLESS_PAGE,
      "**Run Now**",
      "/docs/configuration/run-rules-now",
    );
    expect(english("configuration/run-rules-now")).toContain(
      "serverless functions",
    );
  });
});

/*
 * How fixes run is set where the agent runs (ONEUPTIME_AI_FIXES in its
 * .env), and the AI agent page only shows it (Infrastructure AI Agents,
 * "What AI may do, set by the agent"). The Ceph and VMware pages say so;
 * the two agents' READMEs sent readers to the page to choose a mode.
 */
interface FixModeSource {
  page: string;
  readme: string;
}

const FIX_MODE_SOURCES: ReadonlyArray<FixModeSource> = [
  { page: CEPH_PAGE, readme: "agents/CephAgent/README.md" },
  { page: VMWARE_PAGE, readme: "agents/VMwareAgent/README.md" },
];

describe("where the Ceph and VMware agents' fix mode is set", () => {
  it.each(FIX_MODE_SOURCES)(
    "$readme sets it in .env, as $page does, and the AI agent page only shows it",
    (source: FixModeSource) => {
      const readme: string = repoFile(source.readme);
      const start: number = readme.indexOf("### Allowing fixes");

      expect(start).toBeGreaterThan(-1);

      const fixes: string = readme.slice(start, readme.indexOf("\n## ", start));

      expect(fixes).toContain(`\`${AI_FIXES_ENV}\``);
      expect(fixes).toContain(
        "**AI → AI agent** page shows the mode, read-only",
      );
      expect(readme).not.toContain("choose how fixes are applied");
      lineWith(
        source.page,
        `\`${AI_FIXES_ENV}\` in the same \`.env\` says how fixes run`,
        "the AI agent page shows it read-only",
      );
    },
  );

  it("names the fix modes the agent reads, as the Infrastructure AI Agents page does", () => {
    const modes: Array<string> = Object.values(AGENT_AI_FIXES_SETTING_VALUES);
    const table: string = lineWith(
      "ai/infrastructure-ai-agents",
      `| \`${AI_FIXES_ENV}\``,
    );

    expect(modes.sort()).toEqual(
      ["off", "ask-for-approval", "automatic", "bypass-approval"].sort(),
    );

    for (const mode of modes) {
      expect(table).toContain(`\`${mode}\``);
    }

    for (const source of FIX_MODE_SOURCES) {
      const readme: string = repoFile(source.readme);

      for (const mode of modes) {
        expect({
          readme: source.readme,
          mode,
          named: readme.includes(`\`${mode}\``),
        }).toEqual({
          readme: source.readme,
          mode,
          named: true,
        });
      }
    }
  });

  /*
   * A Cloud AI agent has no .env: its setup command writes the same
   * variable, from the answer to "How far may AI go?", in one of the values
   * the page's table names, with the write switch on.
   */
  it("has a Cloud AI agent's setup command write the same fix modes, as the Infrastructure AI Agents page says", () => {
    const modes: Array<string> = Object.values(AGENT_AI_FIXES_SETTING_VALUES);
    const written: Array<string> = CLOUD_AI_AGENT_FIXES_MODES.map(
      (fixesMode: (typeof CLOUD_AI_AGENT_FIXES_MODES)[number]): string => {
        const variable: CloudAiAgentEnvironmentVariable | undefined =
          getCloudAiAgentEnvironment({
            provider: CloudProvider.AWS,
            oneuptimeUrl: "https://oneuptime.com",
            ingestionKey: "ingestion-key",
            cloudAccountId: "11111111-1111-1111-1111-111111111111",
            accountId: "123456789012",
            fixesMode,
          }).find((candidate: CloudAiAgentEnvironmentVariable): boolean => {
            return candidate.name === AI_FIXES_ENV;
          });

        return variable?.value || "";
      },
    );

    expect(written).toEqual([
      "ask-for-approval",
      "automatic",
      "bypass-approval",
    ]);

    for (const mode of written) {
      expect(modes).toContain(mode);
    }

    lineWith(
      "ai/infrastructure-ai-agents",
      `\`${AI_FIXES_ENV}\` from your answer`,
      "`ONEUPTIME_AI_ALLOW_WRITES=true`",
    );
  });
});

describe("the Ceph monitor's silence note, in every language", () => {
  const LINK: string = "](/docs/monitor/when-oneuptime-is-not-receiving)";

  it.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s: says time OneUptime was not receiving is never no data, as the other monitors do",
    (language: string) => {
      const lines: Array<string> = readPage(
        language,
        "monitor/ceph-monitor",
      ).split("\n");
      const callout: number = lines.findIndex((line: string): boolean => {
        return line.startsWith("> [!IMPORTANT]");
      });
      expect(callout).toBeGreaterThan(-1);
      expect(lines[callout + 1]).toContain(LINK);
      if (language === "en") {
        expect(lines[callout + 1]).toContain(
          "Time OneUptime itself was not receiving is never no data: a check whose window holds it waits instead",
        );
      }
    },
  );
});
