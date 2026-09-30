import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  getAiResourceTypeInfo,
  isAiResourceType,
  isDefaultIdentityPlaceholder,
  parseAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the closed list of infrastructure resources a
 * resource AI agent serves, and what each one's agent runs.
 *
 * The enum values are stored (ResourceAiAgent.resourceType, RunnerJob and
 * suggestion rows, job payloads), so they are pinned member by member. The
 * order of ALL_AI_RESOURCE_TYPES is the remediation priority order. The info
 * table is what every other unit reads: display names, the agent alias an
 * operator sets, the programs a command may start with, the "Test
 * connection" commands, the collector identity variables and their default
 * placeholders.
 */

describe("AiResourceType enum", () => {
  test("has exactly the eight resource types, each value equal to its name", () => {
    expect(Object.values(AiResourceType)).toEqual([
      "DockerHost",
      "PodmanHost",
      "DockerSwarmCluster",
      "ProxmoxCluster",
      "VMwareVCenter",
      "CephCluster",
      "DatabaseServer",
      "Host",
    ]);

    for (const [name, value] of Object.entries(AiResourceType)) {
      expect(value).toBe(name);
    }
  });

  test("ALL_AI_RESOURCE_TYPES lists every member once, in declaration (priority) order", () => {
    expect(ALL_AI_RESOURCE_TYPES).toEqual([
      AiResourceType.DockerHost,
      AiResourceType.PodmanHost,
      AiResourceType.DockerSwarmCluster,
      AiResourceType.ProxmoxCluster,
      AiResourceType.VMwareVCenter,
      AiResourceType.CephCluster,
      AiResourceType.DatabaseServer,
      AiResourceType.Host,
    ]);
    expect(new Set(ALL_AI_RESOURCE_TYPES).size).toBe(
      ALL_AI_RESOURCE_TYPES.length,
    );
  });

  test("Kubernetes is not a resource type — clusters keep their own agent", () => {
    expect(ALL_AI_RESOURCE_TYPES as ReadonlyArray<string>).not.toContain(
      "KubernetesCluster",
    );
    expect(parseAiResourceType("kubernetes")).toBeNull();
    expect(parseAiResourceType("KubernetesCluster")).toBeNull();
    expect(parseAiResourceType("k8s")).toBeNull();
  });
});

describe("isAiResourceType", () => {
  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("%s is a resource type", (type: AiResourceType) => {
    expect(isAiResourceType(type)).toBe(true);
  });

  test.each([
    ["dockerhost"],
    ["DOCKERHOST"],
    [" DockerHost"],
    ["DockerHost "],
    ["docker"],
    [""],
    [null],
    [undefined],
    [42],
    [{}],
    [["DockerHost"]],
  ])("%p is not exactly a stored value", (value: unknown) => {
    // A stored row must hold the enum value itself; aliases are for config.
    expect(isAiResourceType(value)).toBe(false);
  });
});

describe("parseAiResourceType", () => {
  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("reads the enum value %s in any case", (type: AiResourceType) => {
    expect(parseAiResourceType(type)).toBe(type);
    expect(parseAiResourceType(type.toLowerCase())).toBe(type);
    expect(parseAiResourceType(type.toUpperCase())).toBe(type);
    expect(parseAiResourceType(`  ${type}\t`)).toBe(type);
  });

  test.each([
    ["docker", AiResourceType.DockerHost],
    ["podman", AiResourceType.PodmanHost],
    ["docker-swarm", AiResourceType.DockerSwarmCluster],
    ["swarm", AiResourceType.DockerSwarmCluster],
    ["docker_swarm", AiResourceType.DockerSwarmCluster],
    ["proxmox", AiResourceType.ProxmoxCluster],
    ["vmware", AiResourceType.VMwareVCenter],
    ["vcenter", AiResourceType.VMwareVCenter],
    ["ceph", AiResourceType.CephCluster],
    ["database", AiResourceType.DatabaseServer],
    ["db", AiResourceType.DatabaseServer],
    ["host", AiResourceType.Host],
    ["DOCKER", AiResourceType.DockerHost],
    [" Docker-Swarm ", AiResourceType.DockerSwarmCluster],
    ["VCenter", AiResourceType.VMwareVCenter],
  ])(
    "reads the agent alias %p as %s",
    (alias: string, expected: AiResourceType) => {
      expect(parseAiResourceType(alias)).toBe(expected);
    },
  );

  test("every agentAlias in the info table parses back to its own type", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(parseAiResourceType(AI_RESOURCE_TYPE_INFO[type].agentAlias)).toBe(
        type,
      );
    }
  });

  test.each([
    [""],
    ["   "],
    ["dockers"],
    ["docker host"],
    ["docker-host"],
    ["podman-host"],
    ["mysql"],
    ["postgres"],
    ["server"],
    ["vm"],
    ["__proto__"],
    ["constructor"],
    ["toString"],
    [null],
    [undefined],
    [1],
    [true],
    [{}],
    [["docker"]],
  ])("refuses %p rather than guessing", (value: unknown) => {
    expect(parseAiResourceType(value)).toBeNull();
  });
});

describe("AI_RESOURCE_TYPE_INFO", () => {
  test("has one entry per type, each naming its own type", () => {
    expect(Object.keys(AI_RESOURCE_TYPE_INFO).sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(AI_RESOURCE_TYPE_INFO[type].type).toBe(type);
      expect(getAiResourceTypeInfo(type)).toBe(AI_RESOURCE_TYPE_INFO[type]);
    }
  });

  test("pins the display names, agent names and aliases", () => {
    const rows: Array<[string, string, string]> = ALL_AI_RESOURCE_TYPES.map(
      (type: AiResourceType): [string, string, string] => {
        const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
        return [info.displayName, info.agentDisplayName, info.agentAlias];
      },
    );

    expect(rows).toEqual([
      ["Docker host", "Docker AI agent", "docker"],
      ["Podman host", "Podman AI agent", "podman"],
      ["Docker Swarm cluster", "Docker Swarm AI agent", "docker-swarm"],
      ["Proxmox cluster", "Proxmox AI agent", "proxmox"],
      ["VMware vCenter", "VMware AI agent", "vmware"],
      ["Ceph cluster", "Ceph AI agent", "ceph"],
      ["Database server", "Database AI agent", "database"],
      ["Host", "Host AI agent", "host"],
    ]);
  });

  test("aliases and agent names are unique", () => {
    const aliases: Array<string> = ALL_AI_RESOURCE_TYPES.map(
      (type: AiResourceType): string => {
        return AI_RESOURCE_TYPE_INFO[type].agentAlias;
      },
    );
    const agentNames: Array<string> = ALL_AI_RESOURCE_TYPES.map(
      (type: AiResourceType): string => {
        return AI_RESOURCE_TYPE_INFO[type].agentDisplayName;
      },
    );

    expect(new Set(aliases).size).toBe(aliases.length);
    expect(new Set(agentNames).size).toBe(agentNames.length);
  });

  test("pins the programs each type's commands may start with", () => {
    expect(AI_RESOURCE_TYPE_INFO[AiResourceType.DockerHost].programs).toEqual([
      "docker",
    ]);
    expect(AI_RESOURCE_TYPE_INFO[AiResourceType.PodmanHost].programs).toEqual([
      "docker",
    ]);
    expect(
      AI_RESOURCE_TYPE_INFO[AiResourceType.DockerSwarmCluster].programs,
    ).toEqual(["docker"]);
    expect(
      AI_RESOURCE_TYPE_INFO[AiResourceType.ProxmoxCluster].programs,
    ).toEqual(["pvesh"]);
    expect(
      AI_RESOURCE_TYPE_INFO[AiResourceType.VMwareVCenter].programs,
    ).toEqual(["govc"]);
    expect(AI_RESOURCE_TYPE_INFO[AiResourceType.CephCluster].programs).toEqual([
      "ceph",
    ]);
    expect(
      AI_RESOURCE_TYPE_INFO[AiResourceType.DatabaseServer].programs,
    ).toEqual(["db"]);
    expect(AI_RESOURCE_TYPE_INFO[AiResourceType.Host].programs).toEqual([
      "systemctl",
      "journalctl",
      "df",
      "free",
      "uptime",
      "ps",
      "ss",
      "ip",
      "dmesg",
      "lsblk",
      "cat",
      "top",
      "uname",
      "hostnamectl",
      "timedatectl",
      "kill",
    ]);
  });

  test("no type lets a command start with a shell, an interpreter or a privilege switch", () => {
    const forbidden: Array<string> = [
      "sh",
      "bash",
      "zsh",
      "env",
      "sudo",
      "su",
      "doas",
      "nsenter",
      "python",
      "python3",
      "node",
      "perl",
      "kubectl",
      "rm",
      "dd",
      "curl",
      "wget",
      "psql",
      "mysql",
      "redis-cli",
    ];

    for (const type of ALL_AI_RESOURCE_TYPES) {
      for (const program of forbidden) {
        expect(AI_RESOURCE_TYPE_INFO[type].programs).not.toContain(program);
      }
    }
  });

  test("program names are bare words (no paths, no spaces, lowercase)", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const programs: ReadonlyArray<string> =
        AI_RESOURCE_TYPE_INFO[type].programs;

      expect(programs.length).toBeGreaterThan(0);
      expect(new Set(programs).size).toBe(programs.length);

      for (const program of programs) {
        expect(program).toMatch(/^[a-z][a-z0-9.-]*$/);
      }
    }
  });

  test("pins the Test connection commands", () => {
    const testCommands: Record<string, ReadonlyArray<string>> = {};

    for (const type of ALL_AI_RESOURCE_TYPES) {
      testCommands[type] = AI_RESOURCE_TYPE_INFO[type].testCommands;
    }

    expect(testCommands).toEqual({
      DockerHost: ["docker version", "docker info"],
      PodmanHost: ["docker version", "docker info"],
      DockerSwarmCluster: ["docker version", "docker node ls"],
      ProxmoxCluster: ["pvesh get /version", "pvesh get /cluster/status"],
      VMwareVCenter: ["govc about"],
      CephCluster: ["ceph health", "ceph versions"],
      DatabaseServer: ["db ping", "db version"],
      Host: ["uptime", "systemctl list-units --failed --no-pager"],
    });
  });

  test("every Test connection command starts with one of its type's programs", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];

      expect(info.testCommands.length).toBeGreaterThan(0);

      for (const command of info.testCommands) {
        const program: string = command.split(" ")[0] || "";
        expect(info.programs).toContain(program);
      }
    }
  });

  test("pins the collector identity variables", () => {
    const identity: Record<string, ReadonlyArray<string>> = {};

    for (const type of ALL_AI_RESOURCE_TYPES) {
      identity[type] = AI_RESOURCE_TYPE_INFO[type].identityEnvVars;
    }

    expect(identity).toEqual({
      DockerHost: ["DOCKER_HOST_NAME"],
      PodmanHost: ["PODMAN_HOST_NAME"],
      DockerSwarmCluster: ["DOCKER_SWARM_CLUSTER_NAME"],
      ProxmoxCluster: ["PROXMOX_CLUSTER_NAME"],
      VMwareVCenter: ["VMWARE_VCENTER_NAME"],
      CephCluster: ["CEPH_CLUSTER_NAME"],
      DatabaseServer: [
        "DATABASE_SERVER_ID",
        "DATABASE_SYSTEM",
        "DATABASE_SERVER_ADDRESS",
        "DATABASE_SERVER_PORT",
      ],
      Host: ["HOST_NAME"],
    });
  });

  test("pins the collector default identities the agent warns about", () => {
    const placeholders: Record<string, ReadonlyArray<string>> = {};

    for (const type of ALL_AI_RESOURCE_TYPES) {
      placeholders[type] =
        AI_RESOURCE_TYPE_INFO[type].defaultIdentityPlaceholders;
    }

    expect(placeholders).toEqual({
      DockerHost: ["docker-host"],
      PodmanHost: ["podman-host"],
      DockerSwarmCluster: ["docker-swarm", "my-swarm"],
      ProxmoxCluster: ["proxmox-cluster"],
      VMwareVCenter: ["vmware-vcenter"],
      CephCluster: ["ceph"],
      DatabaseServer: [],
      Host: [],
    });
  });
});

describe("isDefaultIdentityPlaceholder", () => {
  test.each([
    [AiResourceType.DockerHost, "docker-host"],
    [AiResourceType.DockerHost, " Docker-Host "],
    [AiResourceType.PodmanHost, "PODMAN-HOST"],
    [AiResourceType.DockerSwarmCluster, "docker-swarm"],
    [AiResourceType.DockerSwarmCluster, "my-swarm"],
    [AiResourceType.ProxmoxCluster, "proxmox-cluster"],
    [AiResourceType.VMwareVCenter, "vmware-vcenter"],
    [AiResourceType.CephCluster, "ceph"],
  ])(
    "%s identity %p is the collector default",
    (type: AiResourceType, identifier: string) => {
      expect(isDefaultIdentityPlaceholder(type, identifier)).toBe(true);
    },
  );

  test.each([
    [AiResourceType.DockerHost, "prod-web-1"],
    [AiResourceType.DockerHost, "podman-host"],
    [AiResourceType.PodmanHost, "docker-host"],
    [AiResourceType.CephCluster, "ceph-prod"],
    [AiResourceType.DatabaseServer, "database"],
    [AiResourceType.Host, "localhost"],
    [AiResourceType.DockerHost, ""],
  ])(
    "%s identity %p is not a default",
    (type: AiResourceType, identifier: string) => {
      expect(isDefaultIdentityPlaceholder(type, identifier)).toBe(false);
    },
  );

  test("non-strings and unknown types are never a default", () => {
    expect(isDefaultIdentityPlaceholder(AiResourceType.DockerHost, null)).toBe(
      false,
    );
    expect(
      isDefaultIdentityPlaceholder(AiResourceType.DockerHost, undefined),
    ).toBe(false);
    expect(
      isDefaultIdentityPlaceholder("Nope" as AiResourceType, "docker-host"),
    ).toBe(false);
  });
});
