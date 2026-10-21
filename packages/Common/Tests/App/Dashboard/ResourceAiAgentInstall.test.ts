import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  COMPOSE_DIRECTORY_COMMENT,
  RESOURCE_AI_AGENT_IMAGE,
  RESOURCE_AI_PROTECTED_TARGETS_ENV,
  RESOURCE_AI_SETTINGS_RESTART_STEP_TITLE,
  RESOURCE_AI_SETTINGS_UPGRADE_STEP_TITLE,
  ResourceAiAgentInstall,
  ResourceAiAgentInstallVariable,
  ResourceAiAgentWriteAccessCommands,
  doesCollectorShipResourceAiAgent,
  getResourceAiAgentComposeSnippet,
  getResourceAiAgentDirectory,
  getResourceAiAgentInstall,
  getResourceAiAgentLogsCommand,
  getResourceAiAgentServiceName,
  getResourceAiAgentSettingsEnv,
  getResourceAiAgentSettingsInstructions,
  getResourceAiAgentStatusCommand,
  getResourceAiAgentUpgradeCommand,
  getResourceAiAgentWriteAccessCommands,
  getResourceAiAgentWriteDisclosure,
  toComposeEnvironmentEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import {
  AgentAiSettingsInstructions,
  AgentAiSettingsStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AgentAiSettingsInstructions";
import {
  AGENT_AI_FIXES_MODES,
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
  AgentAiFixesMode,
  resolveAgentAiSettings,
} from "../../../Types/AI/AgentAiSettings";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The install and write-access instructions a resource's AI agent page
 * shows. Every name in them comes from the shared contract (the image, the
 * resource-type and write variables, each type's alias and identity
 * variables), the snippet is valid YAML an operator can paste, and it names
 * the service exactly as the collector's own docker-compose.yml does when
 * that file ships the agent.
 */

// Variables whose values are credentials, and values compose interpolates.
const SECRET_NAME_REGEX: RegExp = /TOKEN|KEY|PASSWORD|SECRET/;
const INTERPOLATED_REGEX: RegExp = /^\$\{/;

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

// The collector each type's agent runs beside.
const COLLECTOR_DIRECTORIES: Record<AiResourceType, string> = {
  [AiResourceType.DockerHost]: "DockerAgent",
  [AiResourceType.PodmanHost]: "PodmanAgent",
  [AiResourceType.DockerSwarmCluster]: "DockerSwarmAgent",
  [AiResourceType.ProxmoxCluster]: "ProxmoxAgent",
  [AiResourceType.VMwareVCenter]: "VMwareAgent",
  [AiResourceType.CephCluster]: "CephAgent",
  [AiResourceType.DatabaseServer]: "DatabaseAgent",
  [AiResourceType.Host]: "HostAIAgent",
};

interface ComposeService {
  image?: string;
  container_name?: string;
  user?: string;
  volumes?: Array<string>;
  environment?: Array<string> | Record<string, string>;
  privileged?: boolean;
  pid?: string;
}

function parseSnippet(snippet: string): Record<string, ComposeService> {
  const document: { services: Record<string, ComposeService> } = yaml.load(
    snippet,
  ) as { services: Record<string, ComposeService> };
  return document.services;
}

// A service's environment as name -> value, from either compose form.
function environmentOf(service: ComposeService): Record<string, string> {
  if (!service.environment) {
    return {};
  }

  if (!Array.isArray(service.environment)) {
    return service.environment;
  }

  const result: Record<string, string> = {};

  for (const entry of service.environment) {
    const at: number = entry.indexOf("=");
    result[entry.slice(0, at)] = entry.slice(at + 1);
  }

  return result;
}

function snippetService(
  type: AiResourceType,
  identity?: string | null,
): ComposeService {
  const services: Record<string, ComposeService> = parseSnippet(
    getResourceAiAgentComposeSnippet({
      resourceType: type,
      resourceId: RESOURCE_ID,
      identity,
    }),
  );
  const service: ComposeService | undefined =
    services[getResourceAiAgentServiceName(type)];

  if (!service) {
    throw new Error(`The ${type} snippet has no agent service.`);
  }

  return service;
}

// The agent service a collector's docker-compose.yml ships, if it does.
function collectorAgentService(
  type: AiResourceType,
): { name: string; service: ComposeService } | null {
  const file: string = path.join(
    REPO_ROOT,
    "agents",
    COLLECTOR_DIRECTORIES[type],
    "docker-compose.yml",
  );

  if (!fs.existsSync(file)) {
    return null;
  }

  const document: { services?: Record<string, ComposeService> } = yaml.load(
    fs.readFileSync(file, "utf8"),
  ) as { services?: Record<string, ComposeService> };

  for (const [name, service] of Object.entries(document.services || {})) {
    if (
      typeof service.image === "string" &&
      service.image.startsWith(`${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:`)
    ) {
      return { name, service };
    }
  }

  return null;
}

/*
 * The directory the collector's install.sh installs into (its
 * INSTALL_DIR default), or null when it creates none (it starts plain
 * containers instead).
 */
function installerDirectory(type: AiResourceType): string | null {
  const installer: string = fs.readFileSync(
    path.join(REPO_ROOT, "agents", COLLECTOR_DIRECTORIES[type], "install.sh"),
    "utf8",
  );
  const match: RegExpMatchArray | null = installer.match(
    /^INSTALL_DIR="(?:\$\{INSTALL_DIR:-)?([^"}]+)\}?"/m,
  );

  return match ? match[1]! : null;
}

describe("the agent's service", () => {
  test("is named after the agent alias, the collectors' convention", () => {
    expect(
      ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
        return getResourceAiAgentServiceName(type);
      }),
    ).toEqual([
      "oneuptime-docker-ai-agent",
      "oneuptime-podman-ai-agent",
      "oneuptime-docker-swarm-ai-agent",
      "oneuptime-proxmox-ai-agent",
      "oneuptime-vmware-ai-agent",
      "oneuptime-ceph-ai-agent",
      "oneuptime-database-ai-agent",
      "oneuptime-host-ai-agent",
    ]);
  });

  test("runs the released resource AI agent image", () => {
    expect(RESOURCE_AI_AGENT_IMAGE).toBe(
      `${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:release`,
    );
  });
});

describe("the compose snippet", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: valid YAML with the image, read-only root and the contract's variables",
    (type: AiResourceType) => {
      const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
      const service: ComposeService = snippetService(type);
      const environment: Record<string, string> = environmentOf(service);

      expect(service.image).toBe(RESOURCE_AI_AGENT_IMAGE);
      expect((service as Record<string, unknown>)["read_only"]).toBe(true);
      expect((service as Record<string, unknown>)["tmpfs"]).toEqual(["/tmp"]);
      expect(environment[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV]).toBe(
        info.agentAlias,
      );
      expect(environment["ONEUPTIME_URL"]).toBe("${ONEUPTIME_URL}");
      // Read-only unless the .env says otherwise.
      expect(environment[RESOURCE_AI_ALLOW_WRITES_ENV]).toBe(
        `\${${RESOURCE_AI_ALLOW_WRITES_ENV}:-false}`,
      );
      expect(environment[RESOURCE_AI_WRITE_TARGETS_ENV]).toBe(
        `\${${RESOURCE_AI_WRITE_TARGETS_ENV}:-}`,
      );
      // What the operator protects in .env reaches the agent.
      expect(environment[RESOURCE_AI_PROTECTED_TARGETS_ENV]).toBe(
        "${ONEUPTIME_AI_PROTECTED_TARGETS:-}",
      );
      // One key the collector already has.
      expect(
        ["ONEUPTIME_SERVICE_TOKEN", "ONEUPTIME_TELEMETRY_INGESTION_KEY"].filter(
          (key: string): boolean => {
            return key in environment;
          },
        ),
      ).toHaveLength(1);
      // Never a credential value typed into the page.
      for (const [name, value] of Object.entries(environment)) {
        if (SECRET_NAME_REGEX.test(name)) {
          expect(value).toMatch(/^\$\{[A-Z_]+(:-)?\}$/);
        }
      }
    },
  );

  test.each(
    ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
      return type !== AiResourceType.DatabaseServer;
    }),
  )(
    "%s: without the identity, falls back to the collector's own default",
    (type: AiResourceType) => {
      const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
      const variable: string = info.identityEnvVars[0]!;

      expect(environmentOf(snippetService(type))[variable]).toBe(
        `\${${variable}:-${info.defaultIdentityPlaceholders[0] || ""}}`,
      );
    },
  );

  test.each(
    ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
      return type !== AiResourceType.DatabaseServer;
    }),
  )(
    "%s: with the identity known, pins the agent to exactly this resource",
    (type: AiResourceType) => {
      const variable: string = AI_RESOURCE_TYPE_INFO[type].identityEnvVars[0]!;

      expect(
        environmentOf(snippetService(type, "prod-east-01"))[variable],
      ).toBe("prod-east-01");
    },
  );

  test("a database server is pinned by its id, never its name", () => {
    const environment: Record<string, string> = environmentOf(
      snippetService(AiResourceType.DatabaseServer, "ignored"),
    );

    expect(environment["DATABASE_SERVER_ID"]).toBe(RESOURCE_ID);
    expect(environment["DATABASE_SYSTEM"]).toBe("${DATABASE_SYSTEM}");
    // One agent per database, several per machine: no fixed container name.
    expect(
      snippetService(AiResourceType.DatabaseServer).container_name,
    ).toBeUndefined();
  });

  test("a snippet pinned to this resource does not let the .env's resource name move the agent", () => {
    expect(
      environmentOf(
        snippetService(AiResourceType.DockerHost, "prod-docker-01"),
      ),
    ).not.toHaveProperty(RESOURCE_AI_AGENT_RESOURCE_NAME_ENV);
    expect(
      environmentOf(snippetService(AiResourceType.DatabaseServer)),
    ).not.toHaveProperty(RESOURCE_AI_AGENT_RESOURCE_NAME_ENV);
    // Unpinned, it is passed like the collector's own service passes it.
    expect(
      environmentOf(snippetService(AiResourceType.DockerHost))[
        RESOURCE_AI_AGENT_RESOURCE_NAME_ENV
      ],
    ).toBe("${ONEUPTIME_AI_AGENT_RESOURCE_NAME:-}");
  });

  test("an identity with odd characters survives YAML and compose interpolation", () => {
    expect(toComposeEnvironmentEntry("HOST_NAME", "web-01")).toBe(
      "HOST_NAME=web-01",
    );
    expect(toComposeEnvironmentEntry("HOST_NAME", "my host: #1 $HOME")).toBe(
      '"HOST_NAME=my host: #1 $$HOME"',
    );

    const environment: Record<string, string> = environmentOf(
      snippetService(AiResourceType.Host, "my host: #1 $HOME"),
    );
    // YAML gives compose the $$-escaped text, which compose reads as one $.
    expect(environment["HOST_NAME"]).toBe("my host: #1 $$HOME");
  });

  test("the socket kinds mount their socket and run as root; the API kinds do not", () => {
    expect(snippetService(AiResourceType.DockerHost).volumes).toEqual([
      "/var/run/docker.sock:/var/run/docker.sock:ro",
    ]);
    expect(snippetService(AiResourceType.PodmanHost).volumes).toEqual([
      "/run/podman/podman.sock:/run/podman/podman.sock:ro",
    ]);
    expect(snippetService(AiResourceType.DockerSwarmCluster).volumes).toEqual([
      "/var/run/docker.sock:/var/run/docker.sock:ro",
    ]);
    for (const type of [
      AiResourceType.DockerHost,
      AiResourceType.PodmanHost,
      AiResourceType.DockerSwarmCluster,
      AiResourceType.Host,
    ]) {
      expect(snippetService(type).user).toBe("0:0");
    }
    for (const type of [
      AiResourceType.ProxmoxCluster,
      AiResourceType.VMwareVCenter,
      AiResourceType.CephCluster,
      AiResourceType.DatabaseServer,
    ]) {
      expect(snippetService(type).user).toBe("1000:1000");
      expect(snippetService(type).privileged).toBeUndefined();
    }
  });

  test("a host agent runs privileged in the host's pid namespace, as a file of its own", () => {
    const snippet: string = getResourceAiAgentComposeSnippet({
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
    });
    const service: ComposeService = snippetService(AiResourceType.Host);

    expect(service.privileged).toBe(true);
    expect(service.pid).toBe("host");
    expect(snippet).not.toContain("stay as they are");
  });

  test("a Ceph agent mounts ./ceph read-only for its own conf and keyring", () => {
    expect(snippetService(AiResourceType.CephCluster).volumes).toEqual([
      "./ceph:/etc/ceph:ro",
    ]);
    expect(
      environmentOf(snippetService(AiResourceType.CephCluster))[
        "CEPH_CLIENT_ID"
      ],
    ).toBe("${CEPH_CLIENT_ID:-oneuptime-ai}");
  });

  test("a host agent shares the host's network, like a native collector", () => {
    expect(
      (snippetService(AiResourceType.Host) as Record<string, unknown>)[
        "network_mode"
      ],
    ).toBe("host");
  });

  test("the API kinds read their connection from the collector's .env", () => {
    expect(
      Object.keys(environmentOf(snippetService(AiResourceType.ProxmoxCluster))),
    ).toEqual(
      expect.arrayContaining([
        "PVE_HOST",
        "PVE_VERIFY_SSL",
        "PVE_API_TOKEN_ID",
        "PVE_API_TOKEN_SECRET",
      ]),
    );
    expect(
      Object.keys(environmentOf(snippetService(AiResourceType.VMwareVCenter))),
    ).toEqual(
      expect.arrayContaining([
        "VCENTER_ENDPOINT",
        "VCENTER_USERNAME",
        "VCENTER_PASSWORD",
      ]),
    );
    expect(
      Object.keys(environmentOf(snippetService(AiResourceType.DatabaseServer))),
    ).toEqual(
      expect.arrayContaining([
        "DATABASE_SYSTEM",
        "DATABASE_ENDPOINT",
        "DATABASE_USERNAME",
        "DATABASE_PASSWORD",
      ]),
    );
  });

  test("the agent's own credentials in .env reach it, so fixes do not fall back to the collector's read-only ones", () => {
    expect(
      environmentOf(snippetService(AiResourceType.ProxmoxCluster)),
    ).toEqual(
      expect.objectContaining({
        ONEUPTIME_AI_PVE_API_TOKEN_ID: "${ONEUPTIME_AI_PVE_API_TOKEN_ID:-}",
        ONEUPTIME_AI_PVE_API_TOKEN_SECRET:
          "${ONEUPTIME_AI_PVE_API_TOKEN_SECRET:-}",
        PVE_PORT: "${PVE_PORT:-}",
        PVE_CA_FILE: "${PVE_CA_FILE:-}",
      }),
    );
    expect(environmentOf(snippetService(AiResourceType.VMwareVCenter))).toEqual(
      expect.objectContaining({
        ONEUPTIME_AI_VCENTER_USERNAME: "${ONEUPTIME_AI_VCENTER_USERNAME:-}",
        ONEUPTIME_AI_VCENTER_PASSWORD: "${ONEUPTIME_AI_VCENTER_PASSWORD:-}",
        VCENTER_CA_FILE: "${VCENTER_CA_FILE:-}",
        GOVC_DATACENTER: "${GOVC_DATACENTER:-}",
      }),
    );
    expect(
      environmentOf(snippetService(AiResourceType.DatabaseServer)),
    ).toEqual(
      expect.objectContaining({
        ONEUPTIME_AI_DATABASE_USERNAME: "${ONEUPTIME_AI_DATABASE_USERNAME:-}",
        ONEUPTIME_AI_DATABASE_PASSWORD: "${ONEUPTIME_AI_DATABASE_PASSWORD:-}",
        ONEUPTIME_AI_DATABASE_NAME: "${ONEUPTIME_AI_DATABASE_NAME:-}",
      }),
    );
  });

  test("a database agent connects the way the collector does: TLS as .env says, never silently without it", () => {
    expect(
      environmentOf(snippetService(AiResourceType.DatabaseServer)),
    ).toEqual(
      expect.objectContaining({
        DATABASE_TLS_INSECURE: "${DATABASE_TLS_INSECURE:-true}",
        DATABASE_TLS_INSECURE_SKIP_VERIFY:
          "${DATABASE_TLS_INSECURE_SKIP_VERIFY:-false}",
        DATABASE_ENDPOINT_HOST: "${DATABASE_ENDPOINT_HOST:-}",
        DATABASE_ENDPOINT_PORT: "${DATABASE_ENDPOINT_PORT:-}",
        ONEUPTIME_AI_DATABASE_CA_FILE: "${ONEUPTIME_AI_DATABASE_CA_FILE:-}",
      }),
    );
  });
});

describe("the snippet matches what the collectors ship", () => {
  test("the collectors the page says ship the agent do ship it", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      if (doesCollectorShipResourceAiAgent(type)) {
        expect(collectorAgentService(type)).not.toBeNull();
      }
    }
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the page says the collector ships the agent exactly when its compose file does",
    (type: AiResourceType) => {
      // Otherwise the page asks for a second copy of a service the file has.
      expect(doesCollectorShipResourceAiAgent(type)).toBe(
        collectorAgentService(type) !== null,
      );
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the snippet passes every variable the shipped service passes, with its value",
    (type: AiResourceType) => {
      const shipped: { name: string; service: ComposeService } | null =
        collectorAgentService(type);

      if (!shipped) {
        return;
      }

      const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
      const ours: Record<string, string> = environmentOf(snippetService(type));
      const theirs: Record<string, string> = environmentOf(shipped.service);

      for (const [name, value] of Object.entries(theirs)) {
        if (
          name === RESOURCE_AI_AGENT_RESOURCE_NAME_ENV &&
          type === AiResourceType.DatabaseServer
        ) {
          // Pinned by its id: the .env must not move it (see below).
          continue;
        }
        /*
         * Compose passes a container only what its service lists: a
         * variable missing here is a .env setting the agent never sees.
         */
        expect(ours).toHaveProperty(name);
        if (name === "DATABASE_SERVER_ID") {
          // The page pins its own id.
          continue;
        }
        if (name === info.identityEnvVars[0]) {
          // Without the identity known, the collector's own default.
          continue;
        }
        expect(`${name}=${ours[name]}`).toBe(`${name}=${value}`);
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: a shipped agent service has the snippet's name, type, identity and variables",
    (type: AiResourceType) => {
      const shipped: { name: string; service: ComposeService } | null =
        collectorAgentService(type);

      if (!shipped) {
        // Nothing shipped yet: the page's own snippet is the install.
        expect(doesCollectorShipResourceAiAgent(type)).toBe(false);
        return;
      }

      const ours: ComposeService = snippetService(type);
      const theirs: Record<string, string> = environmentOf(shipped.service);

      expect(shipped.name).toBe(getResourceAiAgentServiceName(type));
      expect(theirs[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV]).toBe(
        AI_RESOURCE_TYPE_INFO[type].agentAlias,
      );
      expect(shipped.service.user).toBe(ours.user);

      for (const [name, value] of Object.entries(environmentOf(ours))) {
        if (name === "DATABASE_SERVER_ID") {
          // The page pins its own id; a collector has none to pin.
          continue;
        }
        expect(theirs).toHaveProperty(name);
        if (
          INTERPOLATED_REGEX.test(value) &&
          name !== RESOURCE_AI_WRITE_TARGETS_ENV
        ) {
          expect(theirs[name]).toBe(value);
        }
      }

      for (const volume of ours.volumes || []) {
        expect(shipped.service.volumes || []).toContain(volume);
      }
    },
  );
});

describe("the install instructions", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: where, what, how to start it, and every variable it reads",
    (type: AiResourceType) => {
      const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
      const install: ResourceAiAgentInstall = getResourceAiAgentInstall({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      const names: Array<string> = install.variables.map(
        (variable: ResourceAiAgentInstallVariable): string => {
          return variable.name;
        },
      );

      const directory: string | null = getResourceAiAgentDirectory(type);

      expect(install.whereText).toContain(
        directory || "your docker-compose.yml",
      );
      expect(install.composeSnippet).toBe(
        getResourceAiAgentComposeSnippet({
          resourceType: type,
          resourceId: RESOURCE_ID,
        }),
      );
      expect(install.startCommand).toBe(
        `${directory ? `cd ${directory}` : COMPOSE_DIRECTORY_COMMENT}\n${
          type === AiResourceType.PodmanHost ? "podman" : "docker"
        } compose up -d ${getResourceAiAgentServiceName(type)}`,
      );

      expect(names[0]).toBe(RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV);
      expect(install.variables[0]!.value).toBe(info.agentAlias);
      expect(names).toContain("ONEUPTIME_URL");
      expect(names).toContain(RESOURCE_AI_ALLOW_WRITES_ENV);
      expect(names).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);
      expect(names).toContain(RESOURCE_AI_PROTECTED_TARGETS_ENV);
      expect(new Set(names).size).toBe(names.length);
      // The identity variable the agent registers with.
      expect(names).toContain(
        type === AiResourceType.DatabaseServer
          ? "DATABASE_SERVER_ID"
          : info.identityEnvVars[0],
      );
      // Every variable of the snippet is explained.
      for (const name of Object.keys(environmentOf(snippetService(type)))) {
        expect(names).toContain(name);
      }
      for (const variable of install.variables) {
        expect(variable.description.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("says the collector's compose already ships it where it does", () => {
    // Usually installed with install.sh: that comes first.
    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID,
      }).whereText,
    ).toBe(
      "Installed the Docker agent with install.sh? Run it again: it now starts this agent too, as the container oneuptime-docker-ai-agent. With Compose, the Docker agent's docker-compose.yml ships this service; for an older Compose install, add it to your docker-compose.yml — it takes every variable below from the same .env.",
    );
    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.ProxmoxCluster,
        resourceId: RESOURCE_ID,
      }).whereText,
    ).toBe(
      "The Proxmox agent's docker-compose.yml ships this service; new installs run it already. For an older install, add it to the docker-compose.yml in /opt/oneuptime-proxmox-agent — it takes every variable below from the same .env.",
    );
    // Its compose file ships the service: never "add" a second copy.
    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.DatabaseServer,
        resourceId: RESOURCE_ID,
      }).whereText,
    ).toBe(
      "The database agent's docker-compose.yml ships this service; new installs run it already. For an older install, add it to the docker-compose.yml in /opt/oneuptime-database-agent — it takes every variable below from the same .env.",
    );
    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID,
      }).whereText,
    ).toBe(
      "Save this as docker-compose.yml in /opt/oneuptime-host-ai-agent on the host, next to a .env file.",
    );
  });

  test("the identity row shows the name this resource reports when it is known", () => {
    const known: ResourceAiAgentInstallVariable = getResourceAiAgentInstall({
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      identity: "prod-docker-01",
    }).variables[1]!;

    expect(known).toEqual({
      name: "DOCKER_HOST_NAME",
      value: "prod-docker-01",
      description:
        "The name this Docker host reports. The agent must register with exactly this name, or it serves a different Docker host.",
    });

    const unknown: ResourceAiAgentInstallVariable = getResourceAiAgentInstall({
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
    }).variables[1]!;

    expect(unknown.name).toBe("HOST_NAME");
    expect(unknown.value).toBe("from .env");

    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.DatabaseServer,
        resourceId: RESOURCE_ID,
      }).variables[1],
    ).toEqual(
      expect.objectContaining({
        name: "DATABASE_SERVER_ID",
        value: RESOURCE_ID,
      }),
    );
  });

  test("the protected targets row says what the agent protects on its own", () => {
    const proxmox: ResourceAiAgentInstallVariable | undefined =
      getResourceAiAgentInstall({
        resourceType: AiResourceType.ProxmoxCluster,
        resourceId: RESOURCE_ID,
      }).variables.find((variable: ResourceAiAgentInstallVariable) => {
        return variable.name === RESOURCE_AI_PROTECTED_TARGETS_ENV;
      });

    expect(proxmox?.value).toBe("(empty)");
    expect(proxmox?.description).toContain("VMID of the guest it runs in");
  });

  test("a literal the service sets is shown as it is, not as from .env", () => {
    expect(
      getResourceAiAgentInstall({
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID,
      }).variables.find((variable: ResourceAiAgentInstallVariable) => {
        return variable.name === "TINI_SUBREAPER";
      })?.value,
    ).toBe("1");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: every command and sentence names only a directory the collector's installer creates",
    (type: AiResourceType) => {
      const expected: string | null = installerDirectory(type);
      const install: ResourceAiAgentInstall = getResourceAiAgentInstall({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      const write: ResourceAiAgentWriteAccessCommands =
        getResourceAiAgentWriteAccessCommands(type);
      const texts: Array<string> = [
        install.whereText,
        install.startCommand,
        ...install.prerequisites,
        getResourceAiAgentLogsCommand(type),
        getResourceAiAgentStatusCommand(type),
        write.envIntro,
        write.restartCommand,
        write.installerNote || "",
      ];

      expect(getResourceAiAgentDirectory(type)).toBe(expected);

      for (const text of texts) {
        for (const match of text.matchAll(/(?:^|\s)cd (\S+)/g)) {
          expect(match[1]).toBe(expected);
        }
        for (const match of text.matchAll(/\/opt\/[\w.-]+/g)) {
          expect(match[0]).toBe(expected);
        }
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the prerequisites are there, for the types that have any",
    (type: AiResourceType) => {
      const install: ResourceAiAgentInstall = getResourceAiAgentInstall({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      expect(install.prerequisites.length).toBeGreaterThan(0);
      for (const prerequisite of install.prerequisites) {
        expect(prerequisite.trim().length).toBeGreaterThan(0);
      }
    },
  );
});

describe("the logs and status commands", () => {
  test("name the agent's container, in the collector's runtime", () => {
    expect(getResourceAiAgentLogsCommand(AiResourceType.DockerHost)).toBe(
      "docker logs --tail 100 oneuptime-docker-ai-agent",
    );
    expect(getResourceAiAgentLogsCommand(AiResourceType.PodmanHost)).toBe(
      "podman logs --tail 100 oneuptime-podman-ai-agent",
    );
    expect(getResourceAiAgentLogsCommand(AiResourceType.ProxmoxCluster)).toBe(
      "docker logs --tail 100 oneuptime-proxmox-ai-agent",
    );
    // No container name: the compose service, from its directory.
    expect(getResourceAiAgentLogsCommand(AiResourceType.DatabaseServer)).toBe(
      "cd /opt/oneuptime-database-agent\ndocker compose logs --tail=100 oneuptime-database-ai-agent",
    );
  });

  test("the status command reads the agent's own health server", () => {
    expect(getResourceAiAgentStatusCommand(AiResourceType.CephCluster)).toBe(
      `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:${RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT}/status`,
    );
    expect(getResourceAiAgentStatusCommand(AiResourceType.DatabaseServer)).toBe(
      `cd /opt/oneuptime-database-agent\ndocker compose exec oneuptime-database-ai-agent wget -qO- http://127.0.0.1:${RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT}/status`,
    );
  });
});

describe("the write switch", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the exact variable, recommended with targets where the type names any",
    (type: AiResourceType) => {
      const commands: ResourceAiAgentWriteAccessCommands =
        getResourceAiAgentWriteAccessCommands(type);

      expect(commands.allTargetsEnv).toBe(
        `${RESOURCE_AI_ALLOW_WRITES_ENV}=true`,
      );
      expect(commands.restartCommand).toContain(
        `compose up -d ${getResourceAiAgentServiceName(type)}`,
      );

      if (type === AiResourceType.DatabaseServer) {
        // A session id is not a target anyone can scope in advance.
        expect(commands.scopedEnv).toBeNull();
        expect(commands.scopedNote).toBeNull();
      } else {
        expect(commands.scopedEnv).toMatch(
          new RegExp(
            `^${RESOURCE_AI_ALLOW_WRITES_ENV}=true\\n${RESOURCE_AI_WRITE_TARGETS_ENV}=\\S+$`,
          ),
        );
        expect(commands.scopedNote).toContain("refused by the agent itself");
      }
    },
  );

  test("says how to do it with install.sh where that is how the collector is installed", () => {
    const docker: ResourceAiAgentWriteAccessCommands =
      getResourceAiAgentWriteAccessCommands(AiResourceType.DockerHost);

    expect(docker.installerNote).toBe(
      "Installed the Docker agent with install.sh? Run it again with ONEUPTIME_AI_ALLOW_WRITES=true (and ONEUPTIME_AI_WRITE_TARGETS) set in its environment: it starts the agent again with them. Started the agent with docker run? Remove it (docker rm -f oneuptime-docker-ai-agent) and start it again with -e ONEUPTIME_AI_ALLOW_WRITES=true.",
    );
    // Compose second, from wherever its docker-compose.yml is.
    expect(docker.envIntro).toBe(
      "With Compose instead? Recommended: allow only the targets AI may fix. Set these in the .env next to your docker-compose.yml:",
    );
    expect(docker.restartCommand).toBe(
      `${COMPOSE_DIRECTORY_COMMENT}\ndocker compose up -d oneuptime-docker-ai-agent`,
    );

    const podman: ResourceAiAgentWriteAccessCommands =
      getResourceAiAgentWriteAccessCommands(AiResourceType.PodmanHost);

    expect(podman.installerNote).toContain("Podman agent with install.sh");
    expect(podman.installerNote).toContain(
      "podman rm -f oneuptime-podman-ai-agent",
    );
    expect(podman.restartCommand).toBe(
      `${COMPOSE_DIRECTORY_COMMENT}\npodman compose up -d oneuptime-podman-ai-agent`,
    );

    const ceph: ResourceAiAgentWriteAccessCommands =
      getResourceAiAgentWriteAccessCommands(AiResourceType.CephCluster);

    expect(ceph.installerNote).toBeNull();
    expect(ceph.envIntro).toBe(
      "Recommended: allow only the targets AI may fix. Set these in the .env next to its docker-compose.yml:",
    );
    expect(
      getResourceAiAgentWriteAccessCommands(AiResourceType.DatabaseServer)
        .envIntro,
    ).toBe("Set this in the .env next to its docker-compose.yml:");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the disclosure says what writes allow and what OneUptime never does",
    (type: AiResourceType) => {
      const disclosure: string = getResourceAiAgentWriteDisclosure(type);

      expect(disclosure).toMatch(/^Write access lets the agent /);
      expect(disclosure).toContain("OneUptime still holds the line");
    },
  );
});

/*
 * What OneUptime AI may do is the agent's own setting: the snippet passes
 * both variables from the .env (the collectors' compose files do too, both
 * ways — see "the snippet matches what the collectors ship"), the
 * variables table names them, and the "Change what AI may do" dialog shows
 * the .env lines for each option, then the restart.
 */
type AgentAiSettingsNote = AgentAiSettingsInstructions["notes"][number];

describe("what AI may do, set where the agent runs", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the snippet passes both settings from the .env, empty by default",
    (type: AiResourceType) => {
      const environment: Record<string, string> = environmentOf(
        snippetService(type),
      );

      expect(environment[AI_INVESTIGATION_ENV]).toBe(
        `\${${AI_INVESTIGATION_ENV}:-}`,
      );
      expect(environment[AI_FIXES_ENV]).toBe(`\${${AI_FIXES_ENV}:-}`);
    },
  );

  test("the variables table names both, and what they take", () => {
    const install: ResourceAiAgentInstall = getResourceAiAgentInstall({
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
    const variable: (name: string) => ResourceAiAgentInstallVariable = (
      name: string,
    ): ResourceAiAgentInstallVariable => {
      const found: ResourceAiAgentInstallVariable | undefined =
        install.variables.find((candidate: ResourceAiAgentInstallVariable) => {
          return candidate.name === name;
        });
      expect(found).toBeDefined();
      return found!;
    };

    expect(variable(AI_INVESTIGATION_ENV).description).toContain(
      "true or false",
    );
    for (const mode of AGENT_AI_FIXES_MODES) {
      expect(variable(AI_FIXES_ENV).description).toContain(
        AGENT_AI_FIXES_SETTING_VALUES[mode],
      );
    }
    // Both sit right before the write switch they work with.
    const names: Array<string> = install.variables.map(
      (candidate: ResourceAiAgentInstallVariable) => {
        return candidate.name;
      },
    );
    expect(names.indexOf(AI_FIXES_ENV)).toBe(
      names.indexOf(RESOURCE_AI_ALLOW_WRITES_ENV) - 1,
    );
    expect(names.indexOf(AI_INVESTIGATION_ENV)).toBe(
      names.indexOf(AI_FIXES_ENV) - 1,
    );
  });

  test.each(
    AGENT_AI_FIXES_MODES.flatMap((fixes: AgentAiFixesMode) => {
      return [
        [true, fixes],
        [false, fixes],
      ] as Array<[boolean, AgentAiFixesMode]>;
    }),
  )(
    "investigation %s, fixes %s: the .env lines the agent reads back as exactly that",
    (investigation: boolean, fixes: AgentAiFixesMode) => {
      const env: string = getResourceAiAgentSettingsEnv({
        investigation,
        fixes,
      });
      const lines: Record<string, string> = {};
      for (const line of env.split("\n")) {
        const at: number = line.indexOf("=");
        lines[line.slice(0, at)] = line.slice(at + 1);
      }

      // The agent's own reading of these lines.
      const resolved: ReturnType<typeof resolveAgentAiSettings> =
        resolveAgentAiSettings({
          investigationSetting: lines[AI_INVESTIGATION_ENV],
          fixesSetting: lines[AI_FIXES_ENV],
          allowWrites: lines[RESOURCE_AI_ALLOW_WRITES_ENV] === "true",
          allowWritesName: RESOURCE_AI_ALLOW_WRITES_ENV,
        });

      expect(resolved.settings).toEqual({
        investigation,
        fixes,
        isConfigured: true,
      });
      // Writes exactly when fixes are on, and no warning either way.
      expect(resolved.allowWrites).toBe(fixes !== "Disabled");
      expect(resolved.warnings).toEqual([]);
    },
  );

  test("a Docker host: how to do it with install.sh first, then the .env and the restart", () => {
    const instructions: AgentAiSettingsInstructions =
      getResourceAiAgentSettingsInstructions({
        resourceType: AiResourceType.DockerHost,
        choice: { investigation: true, fixes: "Automatic" },
        doesAgentReportSettings: true,
      });

    expect(instructions.intro?.[0]?.text).toContain(
      "Docker agent with install.sh",
    );
    expect(instructions.intro?.[0]?.text).toContain(
      "docker rm -f oneuptime-docker-ai-agent",
    );
    expect(
      instructions.steps.map((step: AgentAiSettingsStep) => {
        return step.ways[0]?.code;
      }),
    ).toEqual([
      getResourceAiAgentSettingsEnv({
        investigation: true,
        fixes: "Automatic",
      }),
      getResourceAiAgentInstall({
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID,
      }).startCommand,
    ]);
    // Fixes on: which containers they may change, and what writes amount to.
    expect(
      instructions.notes.map((note: AgentAiSettingsNote) => {
        return note.dataTestId;
      }),
    ).toEqual([
      "agent-ai-settings-write-targets-note",
      "agent-ai-settings-write-disclosure",
    ]);
    expect(instructions.notes[0]!.text).toContain(
      RESOURCE_AI_WRITE_TARGETS_ENV,
    );
    // An agent that reads these settings already: a plain restart.
    expect(instructions.steps[1]!.title).toBe(
      RESOURCE_AI_SETTINGS_RESTART_STEP_TITLE,
    );
    expect(instructions.intro?.[0]?.text).not.toContain("Pull");
  });

  test("a collector with an install directory: the .env there, and no install.sh note", () => {
    const instructions: AgentAiSettingsInstructions =
      getResourceAiAgentSettingsInstructions({
        resourceType: AiResourceType.ProxmoxCluster,
        choice: { investigation: false, fixes: "Disabled" },
        doesAgentReportSettings: true,
      });

    expect(instructions.intro).toEqual([]);
    expect(instructions.steps[0]!.description).toContain(
      "/opt/oneuptime-proxmox-agent",
    );
    expect(instructions.steps[1]!.ways[0]!.code).toBe(
      "cd /opt/oneuptime-proxmox-agent\ndocker compose up -d oneuptime-proxmox-ai-agent",
    );
    // Fixes off: nothing about write access.
    expect(instructions.notes).toEqual([]);
  });

  test("a database server has no write targets to name, only the disclosure", () => {
    const instructions: AgentAiSettingsInstructions =
      getResourceAiAgentSettingsInstructions({
        resourceType: AiResourceType.DatabaseServer,
        choice: { investigation: true, fixes: "RequireApproval" },
        doesAgentReportSettings: true,
      });

    expect(
      instructions.notes.map((note: AgentAiSettingsNote) => {
        return note.dataTestId;
      }),
    ).toContain("agent-ai-settings-write-disclosure");
  });

  /*
   * An agent older than these settings reports none and would ignore the
   * .env lines: its restart pulls the newer image first — the AI agent
   * version's own upgrade command — and the plain-container note says to
   * pull it too (install.sh pulls it anyway).
   */
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s, an agent older than the settings: the restart pulls the newer image",
    (type: AiResourceType) => {
      const instructions: AgentAiSettingsInstructions =
        getResourceAiAgentSettingsInstructions({
          resourceType: type,
          choice: { investigation: true, fixes: "RequireApproval" },
          doesAgentReportSettings: false,
        });
      const service: string = getResourceAiAgentServiceName(type);

      // The same .env lines first.
      expect(instructions.steps[0]!.ways[0]!.code).toBe(
        getResourceAiAgentSettingsEnv({
          investigation: true,
          fixes: "RequireApproval",
        }),
      );
      expect(instructions.steps[1]!.title).toBe(
        RESOURCE_AI_SETTINGS_UPGRADE_STEP_TITLE,
      );
      expect(instructions.steps[1]!.description).toContain(
        "older than these settings",
      );
      const restart: string = instructions.steps[1]!.ways[0]!.code!;
      expect(restart).toBe(getResourceAiAgentUpgradeCommand(type));
      // Pull, then recreate: in that order, for this service only.
      expect(restart.indexOf(`compose pull ${service}`)).toBeGreaterThan(-1);
      expect(restart.indexOf(`compose up -d ${service}`)).toBeGreaterThan(
        restart.indexOf(`compose pull ${service}`),
      );
    },
  );

  test("a Docker host with an older agent: the plain-container note pulls the image too", () => {
    const note: string | undefined = getResourceAiAgentSettingsInstructions({
      resourceType: AiResourceType.DockerHost,
      choice: { investigation: true, fixes: "Disabled" },
      doesAgentReportSettings: false,
    }).intro?.[0]?.text;

    expect(note).toContain("it pulls the newer agent");
    expect(note).toContain(`Pull ${RESOURCE_AI_AGENT_IMAGE}`);
    expect(note).toContain("docker rm -f oneuptime-docker-ai-agent");
  });

  test("a Proxmox cluster with an older agent: pull and recreate in its install directory", () => {
    expect(
      getResourceAiAgentSettingsInstructions({
        resourceType: AiResourceType.ProxmoxCluster,
        choice: { investigation: true, fixes: "Disabled" },
        doesAgentReportSettings: false,
      }).steps[1]!.ways[0]!.code,
    ).toBe(
      "cd /opt/oneuptime-proxmox-agent\ndocker compose pull oneuptime-proxmox-ai-agent\ndocker compose up -d oneuptime-proxmox-ai-agent",
    );
  });
});
