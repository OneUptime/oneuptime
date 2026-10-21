import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  AGENT_KINDS,
  AgentKind,
  AgentLatestVersionSource,
  AgentVersionState,
  CEPH_AGENT_VERSION,
  DATABASE_AGENT_VERSION,
  DOCKER_SWARM_AGENT_VERSION,
  HOST_COLLECTOR_VERSION,
  ONEUPTIME_AGENT_PLACEHOLDER_VERSION,
  PROXMOX_AGENT_VERSION,
  STORAGE_ARRAY_AGENT_VERSION,
  VMWARE_AGENT_VERSION,
  getAgentLatestVersion,
  getAgentVersionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  PROXMOX_AGENT_COLLECTOR_CONFIG,
  PROXMOX_AGENT_COLLECTOR_IMAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { CEPH_AGENT_COLLECTOR_CONFIG } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_COLLECTOR_CONFIG,
  VMWARE_AGENT_COMPOSE_FILE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_COLLECTOR_CONFIGS,
  STORAGE_ARRAY_PLATFORM_SETTINGS,
  StorageArrayPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  HOST_COLLECTOR_METHODS,
  HostCollectorMethod,
  getHostCollectorConfig,
  getHostCollectorUpgradeCommand,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  SetupGuideContent,
  SetupGuideStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { AgentVersionStatus } from "../../../Utils/AgentVersionUtil";

/*
 * Which agent reports the version each resource shows, and how OneUptime
 * knows the newest version of it. The "newest" is only right if it is the
 * same kind of number the agent reports, so these tests read the agents' own
 * files: a OneUptime agent must report the OneUptime version it was built
 * from, and a pinned-collector agent must report exactly the pin its files
 * run. Only the customer's own SDKs stay kinds that are never outdated.
 * When an agent's files move on, a test here fails and says what to change.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

function readRepoFile(...parts: Array<string>): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

const SERVER_VERSION: string = "14.0.14";

function stateOf(
  kind: AgentKind,
  agentVersion: unknown,
  serverVersion: unknown = SERVER_VERSION,
): AgentVersionState {
  return getAgentVersionState({ kind, agentVersion, serverVersion });
}

const ALL_KINDS: Array<AgentKind> = Object.values(AgentKind);

const RELEASED_WITH_ONEUPTIME: Array<AgentKind> = [
  AgentKind.KubernetesAgent,
  AgentKind.DockerAgent,
  AgentKind.PodmanAgent,
  AgentKind.Runner,
  AgentKind.ResourceAiAgent,
];

const PINNED_COLLECTOR: Array<AgentKind> = [
  AgentKind.DockerSwarmAgent,
  AgentKind.DatabaseAgent,
  AgentKind.HostCollector,
  AgentKind.ProxmoxAgent,
  AgentKind.CephAgent,
  AgentKind.VMwareAgent,
  AgentKind.StorageArrayAgent,
];

/*
 * The customer's own OpenTelemetry SDKs (and an IoT fleet's own gateway
 * collector): OneUptime neither ships nor pins them.
 */
const NOT_RELEASED_BY_ONEUPTIME: Array<AgentKind> = [
  AgentKind.IoTExporter,
  AgentKind.ServerlessSdk,
  AgentKind.RumSdk,
];

// The value of a `- key: oneuptime.agent.version` stamp in a collector config.
function stampIn(config: string): string | undefined {
  return config.match(
    /- key: oneuptime\.agent\.version\s+value: "([^"]+)"/,
  )?.[1];
}

describe("every agent kind is classified", () => {
  test("each kind has a definition with a name", () => {
    for (const kind of ALL_KINDS) {
      expect(AGENT_KINDS[kind]).toBeDefined();
      expect(AGENT_KINDS[kind].name.length).toBeGreaterThan(0);
    }
  });

  test("the three lists below cover every kind exactly once", () => {
    const listed: Array<AgentKind> = [
      ...RELEASED_WITH_ONEUPTIME,
      ...PINNED_COLLECTOR,
      ...NOT_RELEASED_BY_ONEUPTIME,
    ];
    expect([...listed].sort()).toEqual([...ALL_KINDS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  test.each(RELEASED_WITH_ONEUPTIME)(
    "%s is released with OneUptime",
    (kind: AgentKind) => {
      expect(AGENT_KINDS[kind].latestVersionSource).toBe(
        AgentLatestVersionSource.OneUptimeRelease,
      );
    },
  );

  test.each(PINNED_COLLECTOR)(
    "%s reports the collector it pins",
    (kind: AgentKind) => {
      expect(AGENT_KINDS[kind].latestVersionSource).toBe(
        AgentLatestVersionSource.PinnedCollector,
      );
      expect(AGENT_KINDS[kind].pinnedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );

  test.each(NOT_RELEASED_BY_ONEUPTIME)(
    "%s is never outdated",
    (kind: AgentKind) => {
      expect(AGENT_KINDS[kind].latestVersionSource).toBe(
        AgentLatestVersionSource.None,
      );
      expect(getAgentLatestVersion(kind, SERVER_VERSION)).toBeNull();
      for (const version of ["0.0.1", "1.0.0", "14.0.10", "99.0.0"]) {
        expect(stateOf(kind, version).status).toBe(AgentVersionStatus.Unknown);
      }
    },
  );

  test("only the Runner is called a Runner", () => {
    for (const kind of ALL_KINDS) {
      expect(Boolean(AGENT_KINDS[kind].isRunner)).toBe(
        kind === AgentKind.Runner,
      );
    }
  });
});

describe("agents released with OneUptime compare with the server's version", () => {
  test("the screenshot: a cluster on 14.0.10 while OneUptime runs 14.0.14", () => {
    expect(stateOf(AgentKind.KubernetesAgent, "14.0.10")).toEqual({
      status: AgentVersionStatus.Outdated,
      latestVersion: "14.0.14",
    });
  });

  test.each(RELEASED_WITH_ONEUPTIME)(
    "%s: older is outdated, level or newer is not",
    (kind: AgentKind) => {
      expect(stateOf(kind, "14.0.9").status).toBe(AgentVersionStatus.Outdated);
      expect(stateOf(kind, "14.0.14").status).toBe(AgentVersionStatus.UpToDate);
      expect(stateOf(kind, "14.0.15").status).toBe(AgentVersionStatus.UpToDate);
    },
  );

  test("the newest version is the server's, in canonical form", () => {
    expect(getAgentLatestVersion(AgentKind.DockerAgent, "v14.0.14")).toBe(
      "14.0.14",
    );
    expect(
      getAgentLatestVersion(AgentKind.DockerAgent, "14.0.14+build.7"),
    ).toBe("14.0.14");
  });

  test.each(RELEASED_WITH_ONEUPTIME)(
    "%s: a server that does not know its version shows nothing",
    (kind: AgentKind) => {
      for (const serverVersion of ["", undefined, null, "unknown"]) {
        expect(
          getAgentVersionState({
            kind,
            agentVersion: "14.0.10",
            serverVersion,
          }),
        ).toEqual({
          status: AgentVersionStatus.Unknown,
          latestVersion: null,
        });
      }
    },
  );

  test("the newest version is given only when the agent is outdated", () => {
    expect(stateOf(AgentKind.DockerAgent, "14.0.14").latestVersion).toBeNull();
    expect(stateOf(AgentKind.DockerAgent, "garbage").latestVersion).toBeNull();
    expect(stateOf(AgentKind.DockerAgent, "14.0.1").latestVersion).toBe(
      "14.0.14",
    );
  });
});

describe("a placeholder version means 'not reported'", () => {
  test("the Kubernetes agent and the Runner treat 1.0.0 as not reported", () => {
    expect(ONEUPTIME_AGENT_PLACEHOLDER_VERSION).toBe("1.0.0");
    expect(stateOf(AgentKind.KubernetesAgent, "1.0.0").status).toBe(
      AgentVersionStatus.Unknown,
    );
    expect(stateOf(AgentKind.Runner, "1.0.0").status).toBe(
      AgentVersionStatus.Unknown,
    );
  });

  test("the chart's Chart.yaml appVersion is the placeholder, and the release replaces it with VERSION", () => {
    const chart: string = readRepoFile(
      "HelmChart",
      "Public",
      "kubernetes-agent",
      "Chart.yaml",
    );
    expect(chart).toMatch(
      new RegExp(`^appVersion: "${ONEUPTIME_AGENT_PLACEHOLDER_VERSION}"$`, "m"),
    );

    // The agent stamps the chart's appVersion as its version.
    const configMap: string = readRepoFile(
      "HelmChart",
      "Public",
      "kubernetes-agent",
      "templates",
      "configmap-deployment.yaml",
    );
    expect(configMap).toMatch(
      /- key: oneuptime\.agent\.version\s+value: \{\{ \.Chart\.AppVersion \| quote \}\}/,
    );

    // The release packages the chart with the OneUptime version as appVersion.
    const release: string = readRepoFile(".github", "workflows", "release.yml");
    expect(release).toMatch(
      /helm package [^\n]*kubernetes-agent --version \$\{\{needs\.read-version\.outputs\.major_minor\}\} --app-version \$\{\{needs\.read-version\.outputs\.major_minor\}\}/,
    );
  });

  test("the Runner falls back to the placeholder without APP_VERSION, and a new Runner row starts on it", () => {
    expect(readRepoFile("packages", "Runner", "Config.ts")).toContain(
      `export const RUNNER_VERSION: string = process.env["APP_VERSION"] || "${ONEUPTIME_AGENT_PLACEHOLDER_VERSION}";`,
    );
    expect(
      readRepoFile(
        "packages",
        "Common",
        "Server",
        "Services",
        "RunnerService.ts",
      ),
    ).toContain(
      `createBy.data.agentVersion = new Version("${ONEUPTIME_AGENT_PLACEHOLDER_VERSION}");`,
    );
  });

  test("other OneUptime agents keep 1.0.0 as an ordinary old version", () => {
    expect(stateOf(AgentKind.DockerAgent, "1.0.0").status).toBe(
      AgentVersionStatus.Outdated,
    );
  });
});

describe("the Docker and Podman agents report the OneUptime version their image was built from", () => {
  test.each([["DockerAgent"], ["PodmanAgent"]])(
    "agents/%s stamps APP_VERSION, which the image build sets",
    (dir: string) => {
      expect(readRepoFile("agents", dir, "otel-collector-config.yaml")).toMatch(
        /- key: oneuptime\.agent\.version\s+value: "\$\{env:APP_VERSION\}"/,
      );
      const dockerfile: string = readRepoFile("agents", dir, "Dockerfile.tpl");
      expect(dockerfile).toContain("ARG APP_VERSION");
      expect(dockerfile).toContain("ENV APP_VERSION=${APP_VERSION}");
    },
  );
});

/*
 * The resource AI agent (oneuptime/resource-ai-agent, every resource's AI
 * agent page) reports the APP_VERSION its image is built with, and nothing
 * without one — so it has no placeholder to read as "not reported".
 */
describe("the resource AI agent reports the OneUptime version its image was built from", () => {
  test("its image sets APP_VERSION, and the agent reports it", () => {
    const dockerfile: string = readRepoFile(
      "agents",
      "ResourceAIAgent",
      "Dockerfile.tpl",
    );
    expect(dockerfile).toContain("ARG APP_VERSION");
    expect(dockerfile).toContain("ENV APP_VERSION=${APP_VERSION}");
    expect(readRepoFile("agents", "ResourceAIAgent", "Config.ts")).toContain(
      'readTrimmed(env, "APP_VERSION")',
    );
  });

  test("an older one is outdated, and has no placeholder version", () => {
    expect(stateOf(AgentKind.ResourceAiAgent, "14.0.10")).toEqual({
      status: AgentVersionStatus.Outdated,
      latestVersion: SERVER_VERSION,
    });
    expect(
      AGENT_KINDS[AgentKind.ResourceAiAgent].placeholderVersions,
    ).toBeUndefined();
  });
});

describe("pinned-collector agents report exactly the pin this release ships", () => {
  test("the Docker Swarm agent reports its compose file's collector pin", () => {
    const compose: string = readRepoFile(
      "agents",
      "DockerSwarmAgent",
      "docker-compose.yml",
    );
    expect(compose).toContain(
      `image: otel/opentelemetry-collector-contrib:${DOCKER_SWARM_AGENT_VERSION}`,
    );
    expect(compose).toContain(
      `- APP_VERSION=\${APP_VERSION:-${DOCKER_SWARM_AGENT_VERSION}}`,
    );
    expect(
      readRepoFile("agents", "DockerSwarmAgent", "otel-collector-config.yaml"),
    ).toMatch(
      /- key: oneuptime\.agent\.version\s+value: "\$\{env:APP_VERSION\}"/,
    );
    expect(AGENT_KINDS[AgentKind.DockerSwarmAgent].pinnedVersion).toBe(
      DOCKER_SWARM_AGENT_VERSION,
    );
  });

  test("the Database agent reports its compose file's collector pin, stamped in every engine's config", () => {
    expect(
      readRepoFile("agents", "DatabaseAgent", "docker-compose.yml"),
    ).toContain(
      `image: otel/opentelemetry-collector-contrib:${DATABASE_AGENT_VERSION}`,
    );

    const configDir: string = path.join(
      REPO_ROOT,
      "agents",
      "DatabaseAgent",
      "configs",
    );
    const configs: Array<string> = fs
      .readdirSync(configDir)
      .filter((name: string): boolean => {
        return name.endsWith(".yaml");
      });
    expect(configs.length).toBeGreaterThan(0);

    for (const name of configs) {
      const config: string = fs.readFileSync(
        path.join(configDir, name),
        "utf8",
      );
      expect({
        name,
        stamp: config.match(
          /- key: oneuptime\.agent\.version\s+value: "([^"]+)"/,
        )?.[1],
      }).toEqual({ name, stamp: DATABASE_AGENT_VERSION });
    }

    expect(AGENT_KINDS[AgentKind.DatabaseAgent].pinnedVersion).toBe(
      DATABASE_AGENT_VERSION,
    );
  });

  test("the Dashboard's embedded copy of the Database agent ships the same pin", () => {
    expect(DATABASE_AGENT_COLLECTOR_IMAGE).toBe(
      `otel/opentelemetry-collector-contrib:${DATABASE_AGENT_VERSION}`,
    );
    for (const engine of DATABASE_AGENT_ENGINES) {
      expect({
        engine,
        stamp: DATABASE_AGENT_CONFIGS[engine as DatabaseAgentEngine].match(
          /- key: oneuptime\.agent\.version\s+value: "([^"]+)"/,
        )?.[1],
      }).toEqual({ engine, stamp: DATABASE_AGENT_VERSION });
    }
  });

  test.each(PINNED_COLLECTOR)(
    "%s compares with the pin, whatever version the server runs",
    (kind: AgentKind) => {
      const pin: string = AGENT_KINDS[kind].pinnedVersion as string;
      for (const serverVersion of [SERVER_VERSION, "", "15.0.0"]) {
        expect(stateOf(kind, "0.154.0", serverVersion)).toEqual({
          status: AgentVersionStatus.Outdated,
          latestVersion: pin,
        });
        expect(stateOf(kind, pin, serverVersion).status).toBe(
          AgentVersionStatus.UpToDate,
        );
      }
    },
  );

  test("a OneUptime version reported by another collector is never called older than the pin", () => {
    expect(stateOf(AgentKind.DatabaseAgent, "14.0.10").status).toBe(
      AgentVersionStatus.UpToDate,
    );
  });
});

// A collector config an agent ships: otel-collector-config.yaml and kin.
const COLLECTOR_CONFIG_FILE: RegExp = /^otel-collector-config.*\.yaml$/;

/*
 * The Storage Array agent ships one collector config per kind of array and
 * runs the one .env names: every one of them reports the version, so the
 * Dashboard's embedded copies are listed by the file each one is.
 */
const STORAGE_ARRAY_EMBEDDED_CONFIGS: Record<string, string> = {};
for (const platform of Object.keys(
  STORAGE_ARRAY_PLATFORM_SETTINGS,
) as Array<StorageArrayPlatform>) {
  STORAGE_ARRAY_EMBEDDED_CONFIGS[
    STORAGE_ARRAY_PLATFORM_SETTINGS[platform].collectorConfigFile
  ] = STORAGE_ARRAY_COLLECTOR_CONFIGS[platform];
}

/*
 * The Proxmox, Ceph, VMware and Storage Array agents are the stock collector
 * plus a config: the compose file pins the collector, and the config reports
 * that pin as oneuptime.agent.version. Both files, the Dashboard's embedded
 * copy of the config and the kind's pin must agree, or the sign compares the
 * wrong number.
 */
describe("the Proxmox, Ceph, VMware and Storage Array agents report the collector their compose file pins", () => {
  // The agent's folder, its kind, its pin, and its configs by file name.
  const AGENTS: Array<[string, AgentKind, string, Record<string, string>]> = [
    [
      "ProxmoxAgent",
      AgentKind.ProxmoxAgent,
      PROXMOX_AGENT_VERSION,
      { "otel-collector-config.yaml": PROXMOX_AGENT_COLLECTOR_CONFIG },
    ],
    [
      "CephAgent",
      AgentKind.CephAgent,
      CEPH_AGENT_VERSION,
      { "otel-collector-config.yaml": CEPH_AGENT_COLLECTOR_CONFIG },
    ],
    [
      "VMwareAgent",
      AgentKind.VMwareAgent,
      VMWARE_AGENT_VERSION,
      { "otel-collector-config.yaml": VMWARE_AGENT_COLLECTOR_CONFIG },
    ],
    [
      "StorageArrayAgent",
      AgentKind.StorageArrayAgent,
      STORAGE_ARRAY_AGENT_VERSION,
      STORAGE_ARRAY_EMBEDDED_CONFIGS,
    ],
  ];

  test.each(AGENTS)(
    "every collector config in agents/%s is one the Dashboard embeds",
    (
      dir: string,
      _kind: AgentKind,
      _pin: string,
      configs: Record<string, string>,
    ) => {
      const shipped: Array<string> = fs
        .readdirSync(path.join(REPO_ROOT, "agents", dir))
        .filter((name: string): boolean => {
          return COLLECTOR_CONFIG_FILE.test(name);
        });
      expect(shipped.sort()).toEqual(Object.keys(configs).sort());
    },
  );

  test.each(AGENTS)(
    "agents/%s runs the pinned collector, never :latest",
    (dir: string, _kind: AgentKind, pin: string) => {
      const compose: Record<string, unknown> = yaml.load(
        readRepoFile("agents", dir, "docker-compose.yml"),
      ) as Record<string, unknown>;
      const images: Array<string> = Object.values(
        compose["services"] as Record<string, { image?: string }>,
      )
        .map((service: { image?: string }): string => {
          return service.image || "";
        })
        .filter((image: string): boolean => {
          return image.startsWith("otel/opentelemetry-collector-contrib");
        });
      expect(images).toEqual([`otel/opentelemetry-collector-contrib:${pin}`]);
    },
  );

  test.each(AGENTS)(
    "agents/%s's config stamps exactly that pin as oneuptime.agent.version",
    (
      dir: string,
      kind: AgentKind,
      pin: string,
      configs: Record<string, string>,
    ) => {
      for (const file of Object.keys(configs)) {
        const config: string = readRepoFile("agents", dir, file);
        expect({ file, stamp: stampIn(config) }).toEqual({ file, stamp: pin });
        // An upsert in the resource processor every pipeline runs.
        const parsed: {
          processors: {
            resource: {
              attributes: Array<{
                key: string;
                value?: string;
                action: string;
              }>;
            };
          };
          service: {
            pipelines: Record<string, { processors: Array<string> }>;
          };
        } = yaml.load(config) as {
          processors: {
            resource: {
              attributes: Array<{
                key: string;
                value?: string;
                action: string;
              }>;
            };
          };
          service: {
            pipelines: Record<string, { processors: Array<string> }>;
          };
        };
        expect(
          parsed.processors.resource.attributes.filter(
            (attribute: { key: string }): boolean => {
              return attribute.key === "oneuptime.agent.version";
            },
          ),
        ).toEqual([
          { key: "oneuptime.agent.version", value: pin, action: "upsert" },
        ]);
        for (const pipeline of Object.values(parsed.service.pipelines)) {
          expect(pipeline.processors).toContain("resource");
        }
      }
      expect(AGENT_KINDS[kind].pinnedVersion).toBe(pin);
      expect(AGENT_KINDS[kind].latestVersionSource).toBe(
        AgentLatestVersionSource.PinnedCollector,
      );
    },
  );

  test.each(AGENTS)(
    "the Dashboard's copy of agents/%s's config is the shipped file, stamp included",
    (
      dir: string,
      _kind: AgentKind,
      pin: string,
      configs: Record<string, string>,
    ) => {
      for (const [file, embedded] of Object.entries(configs)) {
        expect(embedded).toBe(readRepoFile("agents", dir, file));
        expect(stampIn(embedded)).toBe(pin);
      }
    },
  );

  test("the VMware guide's copy of the compose file runs the same pin", () => {
    expect(VMWARE_AGENT_COMPOSE_FILE).toBe(
      readRepoFile("agents", "VMwareAgent", "docker-compose.yml"),
    );
    expect(VMWARE_AGENT_COMPOSE_FILE).toContain(
      `image: otel/opentelemetry-collector-contrib:${VMWARE_AGENT_VERSION}`,
    );
  });

  test("the Proxmox journald wrapper image is built on the same pin", () => {
    expect(PROXMOX_AGENT_COLLECTOR_IMAGE).toBe(
      `otel/opentelemetry-collector-contrib:${PROXMOX_AGENT_VERSION}`,
    );
    expect(readRepoFile("agents", "ProxmoxAgent", "README.md")).toContain(
      `FROM ${PROXMOX_AGENT_COLLECTOR_IMAGE} AS otelcol`,
    );
  });
});

/*
 * The host guide is the host agent's only definition: every install method
 * installs the release it pins, and the one config every method saves
 * stamps that release.
 */
describe("the host guide installs the release it pins, and its config reports it", () => {
  const URL: string = "https://oneuptime.example.com";
  const KEY: string = "tik_host_key";

  test("the config stamps HOST_COLLECTOR_VERSION in a resource processor the metrics pipeline runs", () => {
    const config: string = getHostCollectorConfig({
      oneuptimeUrl: URL,
      apiKey: KEY,
    });
    expect(stampIn(config)).toBe(HOST_COLLECTOR_VERSION);
    const parsed: {
      service: { pipelines: { metrics: { processors: Array<string> } } };
    } = yaml.load(config) as {
      service: { pipelines: { metrics: { processors: Array<string> } } };
    };
    expect(parsed.service.pipelines.metrics.processors).toContain("resource");
    expect(AGENT_KINDS[AgentKind.HostCollector].pinnedVersion).toBe(
      HOST_COLLECTOR_VERSION,
    );
  });

  test.each(
    HOST_COLLECTOR_METHODS.map((method: string) => {
      return [method];
    }),
  )(
    "%s installs and upgrades to exactly that release, and nothing resolves 'latest'",
    (method: string) => {
      const guide: SetupGuideContent = getHostSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        method: method as HostCollectorMethod,
      });
      const install: string = guide.steps
        .map((step: SetupGuideStep): string => {
          return step.markdown || "";
        })
        .join("\n");
      const upgrade: string = getHostCollectorUpgradeCommand(
        method as HostCollectorMethod,
      );

      for (const text of [install, upgrade]) {
        expect(text).not.toMatch(/releases\/latest|contrib:latest/);
        if (method === "docker") {
          expect(text).toContain(
            `otel/opentelemetry-collector-contrib:${HOST_COLLECTOR_VERSION}`,
          );
        } else if (method === "windows") {
          expect(text).toContain(`$version = "${HOST_COLLECTOR_VERSION}"`);
        } else {
          expect(text).toContain(`VERSION=${HOST_COLLECTOR_VERSION} `);
        }
      }
    },
  );
});

/*
 * Every pinned collector runs the version the Ops suite validates the
 * agents' configs against, so the pins here cannot drift from the collector
 * the configs are known to start on.
 */
describe("every pin is the collector the configs are validated against", () => {
  test.each(PINNED_COLLECTOR)("%s", (kind: AgentKind) => {
    const validated: string | undefined = readRepoFile(
      "Tests",
      "Ops",
      "validate-collector-configs.sh",
    ).match(
      /^COLLECTOR_IMAGE="otel\/opentelemetry-collector-contrib:([^"]+)"$/m,
    )?.[1];
    expect(validated).toMatch(/^\d+\.\d+\.\d+$/);
    expect(AGENT_KINDS[kind].pinnedVersion).toBe(validated);
  });
});

/*
 * An agent installed before its files reported a version sends none: its
 * version is unknown - "Not reported", never "outdated" - until it is
 * upgraded to files that report one.
 */
describe("an install from before the pin reports no version, and is never called outdated", () => {
  test.each([
    [AgentKind.HostCollector],
    [AgentKind.ProxmoxAgent],
    [AgentKind.CephAgent],
    [AgentKind.VMwareAgent],
    [AgentKind.StorageArrayAgent],
  ])("%s", (kind: AgentKind) => {
    for (const version of [undefined, null, "", "   "]) {
      expect(stateOf(kind, version)).toEqual({
        status: AgentVersionStatus.Unknown,
        latestVersion: null,
      });
    }
  });

  test("a Proxmox or Ceph agent that ran the collector's :latest stamped nothing then", () => {
    for (const dir of ["ProxmoxAgent", "CephAgent"]) {
      // The previous files are in git history; today's must not run :latest.
      expect(readRepoFile("agents", dir, "docker-compose.yml")).not.toContain(
        "opentelemetry-collector-contrib:latest",
      );
    }
  });
});

describe("the customer's own SDKs stay kinds that are never outdated", () => {
  test("a RUM application's version is the OpenTelemetry SDK's own (telemetry.sdk.version), not a OneUptime release", () => {
    expect(
      readRepoFile(
        "packages",
        "App",
        "FeatureSet",
        "Telemetry",
        "Services",
        "OtelIngestBaseService.ts",
      ),
    ).toMatch(
      /this\.getStringAttribute\(data\.attributes, "telemetry\.sdk\.version"\) \|\|\s+this\.getStringAttribute\(data\.attributes, "oneuptime\.agent\.version"\)/,
    );
    expect(stateOf(AgentKind.RumSdk, "1.30.0").status).toBe(
      AgentVersionStatus.Unknown,
    );
  });
});
