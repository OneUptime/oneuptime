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
  CPU_HEADROOM_RATIO,
  MEMORY_HEADROOM_RATIO,
  MIN_OBSERVED_HOURS,
  RightSizingRecommendation,
  SIGNIFICANCE_RATIO,
  buildRightSizingRecommendation,
} from "Common/Types/Kubernetes/KubernetesRightSizing";
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
    const dockerfile: string = repoFile("agents/DockerAgent/Dockerfile.tpl");
    expect(dockerfile).toContain(
      `ENV DOCKER_HOST_NAME=${DOCKER_DEFAULT_HOST_NAME}`,
    );
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${DOCKER_DEFAULT_API_VERSION}`,
    );
    expect(rowOf(DOCKER_PAGE, "`DOCKER_HOST_NAME`")[2]).toContain(
      `Defaults to \`${DOCKER_DEFAULT_HOST_NAME}\``,
    );
    expect(rowOf(DOCKER_PAGE, "`DOCKER_API_VERSION`")[2]).toContain(
      `Defaults to \`${DOCKER_DEFAULT_API_VERSION}\``,
    );
  });

  it("reads stats every 30 seconds and lists the inventory every 5 minutes, as the agent does", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/DockerAgent/otel-collector-config.yaml"),
    );
    expect(at(config, "receivers.docker_stats.collection_interval")).toBe(
      "30s",
    );
    expect(repoFile("agents/DockerAgent/inventory-snapshot.sh")).toContain(
      'INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"',
    );
    lineWith(DOCKER_PAGE, "stats every 30 seconds", "every 5 minutes");
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
    const dockerfile: string = repoFile("agents/PodmanAgent/Dockerfile.tpl");
    expect(dockerfile).toContain(
      `ENV PODMAN_HOST_NAME=${PODMAN_DEFAULT_HOST_NAME}`,
    );
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${PODMAN_DEFAULT_API_VERSION}`,
    );
    expect(rowOf(PODMAN_PAGE, "`PODMAN_HOST_NAME`")[2]).toContain(
      `Defaults to \`${PODMAN_DEFAULT_HOST_NAME}\``,
    );
    expect(rowOf(PODMAN_PAGE, "`DOCKER_API_VERSION`")[2]).toContain(
      `Defaults to \`${PODMAN_DEFAULT_API_VERSION}\``,
    );
  });

  it("reads the socket the page names, every 30 seconds, and the inventory every 5 minutes", () => {
    const config: YamlNode = yamlOf(
      repoFile("agents/PodmanAgent/otel-collector-config.yaml"),
    );
    expect(at(config, "receivers.docker_stats.endpoint")).toBe(
      `unix://${PODMAN_SOCKET_PATH}`,
    );
    expect(at(config, "receivers.docker_stats.collection_interval")).toBe(
      "30s",
    );
    expect(repoFile("agents/PodmanAgent/inventory-snapshot.sh")).toContain(
      'INTERVAL="${PODMAN_INVENTORY_INTERVAL_SECONDS:-300}"',
    );
    lineWith(PODMAN_PAGE, "stats every 30 seconds", "every 5 minutes");
    lineWith(PODMAN_PAGE, `Podman's API socket at \`${PODMAN_SOCKET_PATH}\``);
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

  it("scrapes every 30 seconds with the cluster and node collectors on", () => {
    const scrape: YamlNode = (
      at(
        yamlOf(config),
        "receivers.prometheus.config.scrape_configs",
      ) as Array<YamlNode>
    )[0] as YamlNode;
    expect(scrape["scrape_interval"]).toBe("30s");
    expect(at(scrape, "params.cluster")).toEqual(["1"]);
    expect(at(scrape, "params.node")).toEqual(["1"]);
    lineWith(
      PROXMOX_PAGE,
      "scrapes the exporter every 30 seconds with both its cluster and node collectors on",
    );
    lineWith(PROXMOX_PAGE, "`cluster=1`", '`cluster: ["1"]`');
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
    expect(at(chartValues, "ebpf.contextPropagation")).toBe(false);
    lineWith(KUBERNETES_PAGE, "`traceparent`", "is off by default");
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
