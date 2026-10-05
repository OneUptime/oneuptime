import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AGENT_KINDS,
  AgentKind,
  AgentLatestVersionSource,
  AgentVersionState,
  DATABASE_AGENT_VERSION,
  DOCKER_SWARM_AGENT_VERSION,
  ONEUPTIME_AGENT_PLACEHOLDER_VERSION,
  getAgentLatestVersion,
  getAgentVersionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import { AgentVersionStatus } from "../../../Utils/AgentVersionUtil";

/*
 * Which agent reports the version each resource shows, and how OneUptime
 * knows the newest version of it. The "newest" is only right if it is the
 * same kind of number the agent reports, so these tests read the agents' own
 * files: a OneUptime agent must report the OneUptime version it was built
 * from, a pinned-collector agent must report exactly the pin, and an agent
 * whose config reports nothing must stay a kind that is never outdated.
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
];

const NOT_RELEASED_BY_ONEUPTIME: Array<AgentKind> = [
  AgentKind.HostCollector,
  AgentKind.ProxmoxAgent,
  AgentKind.CephAgent,
  AgentKind.VMwareAgent,
  AgentKind.IoTExporter,
  AgentKind.ServerlessSdk,
  AgentKind.RumSdk,
];

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

describe("agents that report no version stay kinds that are never outdated", () => {
  test.each([["CephAgent"], ["ProxmoxAgent"], ["VMwareAgent"]])(
    "agents/%s's config stamps no oneuptime.agent.version (decide its AgentKind source if it starts to)",
    (dir: string) => {
      expect(
        readRepoFile("agents", dir, "otel-collector-config.yaml"),
      ).not.toContain("oneuptime.agent.version");
    },
  );

  test("the host guide's collector config stamps no oneuptime.agent.version", () => {
    expect(
      readRepoFile(
        "packages",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Host",
        "Utils",
        "DocumentationMarkdown.ts",
      ),
    ).not.toContain("oneuptime.agent.version");
  });

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
