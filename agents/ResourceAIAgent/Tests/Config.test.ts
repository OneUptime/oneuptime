import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DATABASE_ENDPOINT_IDENTITY_SOURCE,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PORT,
  ParsedConfig,
  buildDatabaseEndpointIdentifier,
  describeDefaultIdentity,
  formatDatabaseHost,
  isUuid,
  parseConfig,
  parseInterval,
  parsePort,
  parseSwitch,
  parseTargetList,
  parseTcpPort,
} from "../Config";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../Common/Types/ResourceAiAgent/AiResourceType";
import { RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

const VALID: Record<string, string> = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_SERVICE_TOKEN: "ingestion-key",
  ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
  DOCKER_HOST_NAME: "web-host-1",
};

function parse(env: Record<string, string | undefined>): ParsedConfig {
  return parseConfig({ ...VALID, ...env });
}

const DB_UUID: string = "8D6F1C9E-3A2B-4C5D-9E8F-0A1B2C3D4E5F";

describe("required settings", () => {
  test("a complete environment has no problems or warnings", () => {
    const parsed: ParsedConfig = parse({});

    assert.deepStrictEqual(parsed.problems, []);
    assert.deepStrictEqual(parsed.warnings, []);
    assert.strictEqual(parsed.config.oneuptimeUrl, VALID["ONEUPTIME_URL"]);
    assert.strictEqual(parsed.config.apiKey, "ingestion-key");
    assert.strictEqual(parsed.config.apiKeySource, "ONEUPTIME_SERVICE_TOKEN");
    assert.strictEqual(parsed.config.resourceType, AiResourceType.DockerHost);
    assert.strictEqual(parsed.config.resourceTypeSetting, "docker");
    assert.strictEqual(parsed.config.resourceIdentifier, "web-host-1");
    assert.strictEqual(parsed.config.identitySource, "DOCKER_HOST_NAME");
    assert.strictEqual(parsed.config.resourceId, null);
    assert.deepStrictEqual(parsed.config.identityDetails, {});
  });

  test("an empty environment is three problems, never an exception", () => {
    const parsed: ParsedConfig = parseConfig({});

    assert.strictEqual(parsed.problems.length, 3);
    assert.match(parsed.problems[0]!, /ONEUPTIME_URL is not set/);
    assert.match(
      parsed.problems[1]!,
      /None of ONEUPTIME_API_KEY, ONEUPTIME_TELEMETRY_INGESTION_KEY, ONEUPTIME_SERVICE_TOKEN is set/,
    );
    assert.match(
      parsed.problems[2]!,
      /ONEUPTIME_AI_AGENT_RESOURCE_TYPE is not set.*docker, podman, docker-swarm, proxmox, vmware, ceph, database, host/,
    );
    assert.strictEqual(parsed.config.resourceType, null);
    assert.strictEqual(parsed.config.resourceIdentifier, null);
  });

  test("the API key: the first non-empty of the three variables", () => {
    const all: ParsedConfig = parse({
      ONEUPTIME_API_KEY: " api-key ",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "telemetry-key",
      ONEUPTIME_SERVICE_TOKEN: "service-token",
    });
    assert.strictEqual(all.config.apiKey, "api-key");
    assert.strictEqual(all.config.apiKeySource, "ONEUPTIME_API_KEY");

    const telemetry: ParsedConfig = parse({
      ONEUPTIME_API_KEY: "  ",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "telemetry-key",
      ONEUPTIME_SERVICE_TOKEN: "",
    });
    assert.strictEqual(telemetry.config.apiKey, "telemetry-key");
    assert.strictEqual(
      telemetry.config.apiKeySource,
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    );

    const none: ParsedConfig = parse({ ONEUPTIME_SERVICE_TOKEN: " " });
    assert.strictEqual(none.config.apiKey, "");
    assert.strictEqual(none.config.apiKeySource, null);
    assert.strictEqual(none.problems.length, 1);
  });

  test("the URL loses trailing slashes and surrounding whitespace", () => {
    assert.strictEqual(
      parse({ ONEUPTIME_URL: "  https://oneuptime.example.com///  " }).config
        .oneuptimeUrl,
      "https://oneuptime.example.com",
    );
  });

  test("a URL that is not http(s) is a problem", () => {
    for (const url of [
      "ftp://oneuptime.example.com",
      "oneuptime.example.com",
    ]) {
      const parsed: ParsedConfig = parse({ ONEUPTIME_URL: url });

      assert.strictEqual(parsed.problems.length, 1, url);
      assert.match(parsed.problems[0]!, /is not an http\(s\) URL/);
    }
  });
});

describe("the resource type", () => {
  test("every alias and enum value selects its type", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const info: (typeof AI_RESOURCE_TYPE_INFO)[AiResourceType] =
        AI_RESOURCE_TYPE_INFO[type];

      for (const setting of [info.agentAlias, type, type.toLowerCase()]) {
        assert.strictEqual(
          parseConfig({ ONEUPTIME_AI_AGENT_RESOURCE_TYPE: setting }).config
            .resourceType,
          type,
          setting,
        );
      }
    }

    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_RESOURCE_TYPE: " Swarm " }).config
        .resourceType,
      AiResourceType.DockerSwarmCluster,
    );
  });

  test("an unknown type is a problem naming the value and the choices", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "kubernetes",
    });

    assert.strictEqual(parsed.config.resourceType, null);
    assert.strictEqual(parsed.config.resourceTypeSetting, "kubernetes");
    assert.strictEqual(parsed.problems.length, 1);
    assert.match(
      parsed.problems[0]!,
      /ONEUPTIME_AI_AGENT_RESOURCE_TYPE="kubernetes" is not a resource type this agent knows/,
    );
    // No identity is read for an unknown type.
    assert.strictEqual(parsed.config.resourceIdentifier, null);
  });
});

describe("the identity", () => {
  const SIMPLE: Array<[string, AiResourceType, string]> = [
    ["docker", AiResourceType.DockerHost, "DOCKER_HOST_NAME"],
    ["podman", AiResourceType.PodmanHost, "PODMAN_HOST_NAME"],
    [
      "docker-swarm",
      AiResourceType.DockerSwarmCluster,
      "DOCKER_SWARM_CLUSTER_NAME",
    ],
    ["proxmox", AiResourceType.ProxmoxCluster, "PROXMOX_CLUSTER_NAME"],
    ["vmware", AiResourceType.VMwareVCenter, "VMWARE_VCENTER_NAME"],
    ["ceph", AiResourceType.CephCluster, "CEPH_CLUSTER_NAME"],
    ["host", AiResourceType.Host, "HOST_NAME"],
  ];

  for (const [alias, type, variable] of SIMPLE) {
    test(`${alias}: read from ${variable}, trimmed, case kept`, () => {
      const parsed: ParsedConfig = parseConfig({
        ...VALID,
        DOCKER_HOST_NAME: "",
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: alias,
        [variable]: "  Prod-Node-7  ",
      });

      assert.deepStrictEqual(parsed.problems, []);
      assert.strictEqual(parsed.config.resourceType, type);
      assert.strictEqual(parsed.config.resourceIdentifier, "Prod-Node-7");
      assert.strictEqual(parsed.config.identitySource, variable);
    });
  }

  test("a missing identity variable is a problem naming it", () => {
    const parsed: ParsedConfig = parse({ DOCKER_HOST_NAME: "" });

    assert.strictEqual(parsed.problems.length, 1);
    assert.match(
      parsed.problems[0]!,
      /DOCKER_HOST_NAME is not set.*ONEUPTIME_AI_AGENT_RESOURCE_NAME/,
    );
    assert.strictEqual(parsed.config.resourceIdentifier, null);
  });

  test("ONEUPTIME_AI_AGENT_RESOURCE_NAME overrides the collector's variable", () => {
    const parsed: ParsedConfig = parse({
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: " other-name ",
    });

    assert.strictEqual(parsed.config.resourceIdentifier, "other-name");
    assert.strictEqual(
      parsed.config.identitySource,
      "ONEUPTIME_AI_AGENT_RESOURCE_NAME",
    );
  });

  test("a Host without HOST_NAME is not a problem: the executor names it at start-up", () => {
    const parsed: ParsedConfig = parse({
      DOCKER_HOST_NAME: "",
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
    });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.config.resourceType, AiResourceType.Host);
    assert.strictEqual(parsed.config.resourceIdentifier, null);
    assert.strictEqual(parsed.config.identitySource, null);
  });

  test("an identity longer than 256 characters is a problem", () => {
    const parsed: ParsedConfig = parse({ DOCKER_HOST_NAME: "h".repeat(257) });

    assert.strictEqual(parsed.problems.length, 1);
    assert.match(parsed.problems[0]!, /257 characters long.*at most 256/);
  });

  test("the collector's default name is a warning, never a problem", () => {
    const parsed: ParsedConfig = parse({ DOCKER_HOST_NAME: "Docker-Host" });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.warnings.length, 1);
    assert.match(
      parsed.warnings[0]!,
      /named "Docker-Host", the collector's default \(DOCKER_HOST_NAME\)/,
    );

    for (const [alias, variable, placeholder] of [
      ["podman", "PODMAN_HOST_NAME", "podman-host"],
      ["docker-swarm", "DOCKER_SWARM_CLUSTER_NAME", "my-swarm"],
      ["proxmox", "PROXMOX_CLUSTER_NAME", "proxmox-cluster"],
      ["vmware", "VMWARE_VCENTER_NAME", "vmware-vcenter"],
      ["ceph", "CEPH_CLUSTER_NAME", "ceph"],
    ] as Array<[string, string, string]>) {
      const warned: ParsedConfig = parse({
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: alias,
        [variable]: placeholder,
      });
      assert.strictEqual(warned.warnings.length, 1, alias);
    }
  });

  test("describeDefaultIdentity is silent for a real name or no name", () => {
    assert.strictEqual(
      describeDefaultIdentity({
        type: AiResourceType.DockerHost,
        identifier: "web-1",
        source: "DOCKER_HOST_NAME",
      }),
      null,
    );
    assert.strictEqual(
      describeDefaultIdentity({
        type: AiResourceType.DockerHost,
        identifier: null,
        source: null,
      }),
      null,
    );
  });
});

describe("the database identity", () => {
  function database(env: Record<string, string>): ParsedConfig {
    return parseConfig({
      ...VALID,
      DOCKER_HOST_NAME: "",
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
      ...env,
    });
  }

  test("DATABASE_SERVER_ID wins, lowercased, and is sent as the resource id", () => {
    const parsed: ParsedConfig = database({
      DATABASE_SERVER_ID: ` ${DB_UUID} `,
      DATABASE_SYSTEM: "PostgreSQL",
      DATABASE_SERVER_ADDRESS: "orders-db.internal",
      DATABASE_SERVER_PORT: "5432",
    });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(parsed.config.resourceIdentifier, DB_UUID.toLowerCase());
    assert.strictEqual(parsed.config.resourceId, DB_UUID.toLowerCase());
    assert.strictEqual(parsed.config.identitySource, "DATABASE_SERVER_ID");
    // The endpoint facts still reach the posture.
    assert.deepStrictEqual(parsed.config.identityDetails, {
      databaseSystem: "postgresql",
      serverAddress: "orders-db.internal",
      serverPort: 5432,
    });
  });

  test("without an id: <system>|<address>:<port>, like DatabaseServer.databaseIdentifier", () => {
    const parsed: ParsedConfig = database({
      DATABASE_SYSTEM: " PostgreSQL ",
      DATABASE_SERVER_ADDRESS: " Orders-DB.Internal. ",
      DATABASE_SERVER_PORT: "5432",
    });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(
      parsed.config.resourceIdentifier,
      "postgresql|orders-db.internal:5432",
    );
    assert.strictEqual(parsed.config.resourceId, null);
    assert.strictEqual(
      parsed.config.identitySource,
      DATABASE_ENDPOINT_IDENTITY_SOURCE,
    );
  });

  test("no port: the identity leaves it out (the server fills the engine's default)", () => {
    assert.strictEqual(
      database({
        DATABASE_SYSTEM: "redis",
        DATABASE_SERVER_ADDRESS: "cache.internal",
      }).config.resourceIdentifier,
      "redis|cache.internal",
    );
  });

  test("an invalid port is a warning and is left out", () => {
    const parsed: ParsedConfig = database({
      DATABASE_SYSTEM: "mysql",
      DATABASE_SERVER_ADDRESS: "db.internal",
      DATABASE_SERVER_PORT: "70000",
    });

    assert.strictEqual(parsed.config.resourceIdentifier, "mysql|db.internal");
    assert.strictEqual(parsed.warnings.length, 1);
    assert.match(
      parsed.warnings[0]!,
      /DATABASE_SERVER_PORT="70000" is not a port/,
    );
  });

  test("IPv6 addresses are bracketed", () => {
    assert.strictEqual(
      database({
        DATABASE_SYSTEM: "postgresql",
        DATABASE_SERVER_ADDRESS: "[FD00::5]",
        DATABASE_SERVER_PORT: "5432",
      }).config.resourceIdentifier,
      "postgresql|[fd00::5]:5432",
    );
  });

  /*
   * The collector stamps DATABASE_SERVER_ADDRESS as server.address and the
   * server splits a port written in it off the host (DATABASE_SERVER_PORT
   * winning): the agent's identity must name that same endpoint, never
   * "[db.example.com:5433]" (read as an IPv6 address, which it is not).
   */
  test("a port written in the address is split off the host, like the collector's server.address", () => {
    const cases: Array<{
      address: string;
      port?: string;
      identity: string;
      details: Record<string, string | number>;
    }> = [
      {
        address: "db.example.com:5433",
        identity: "postgresql|db.example.com:5433",
        details: { serverAddress: "db.example.com", serverPort: 5433 },
      },
      {
        address: "db.example.com:5433",
        port: "5433",
        identity: "postgresql|db.example.com:5433",
        details: { serverAddress: "db.example.com", serverPort: 5433 },
      },
      // The explicit port wins, as the collector's server.port does.
      {
        address: "DB.Example.com.:5433",
        port: "6000",
        identity: "postgresql|db.example.com:6000",
        details: { serverAddress: "db.example.com", serverPort: 6000 },
      },
      {
        address: "[2001:DB8::1]:5433",
        identity: "postgresql|[2001:db8::1]:5433",
        details: { serverAddress: "[2001:db8::1]", serverPort: 5433 },
      },
      {
        address: "10.1.2.3:5433",
        identity: "postgresql|10.1.2.3:5433",
        details: { serverAddress: "10.1.2.3", serverPort: 5433 },
      },
      // SQL Server's "host,port".
      {
        address: "sql.example.com,1433",
        identity: "postgresql|sql.example.com:1433",
        details: { serverAddress: "sql.example.com", serverPort: 1433 },
      },
      // A bare IPv6 address has no port to split off.
      {
        address: "2001:db8::1",
        port: "5432",
        identity: "postgresql|[2001:db8::1]:5432",
        details: { serverAddress: "[2001:db8::1]", serverPort: 5432 },
      },
      // A port out of range in the address is dropped, as the server drops it.
      {
        address: "db.example.com:99999",
        identity: "postgresql|db.example.com",
        details: { serverAddress: "db.example.com" },
      },
    ];

    for (const entry of cases) {
      const parsed: ParsedConfig = database({
        DATABASE_SYSTEM: "postgresql",
        DATABASE_SERVER_ADDRESS: entry.address,
        ...(entry.port !== undefined
          ? { DATABASE_SERVER_PORT: entry.port }
          : {}),
      });

      assert.deepStrictEqual(parsed.problems, [], entry.address);
      assert.strictEqual(
        parsed.config.resourceIdentifier,
        entry.identity,
        entry.address,
      );
      assert.deepStrictEqual(
        parsed.config.identityDetails,
        { databaseSystem: "postgresql", ...entry.details },
        entry.address,
      );
    }
  });

  test("a DATABASE_SERVER_ID that is not a UUID is ignored with a warning, like the collector does", () => {
    const parsed: ParsedConfig = database({
      DATABASE_SERVER_ID: "orders",
      DATABASE_SYSTEM: "postgresql",
      DATABASE_SERVER_ADDRESS: "orders-db.internal",
    });

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(
      parsed.config.resourceIdentifier,
      "postgresql|orders-db.internal",
    );
    assert.strictEqual(parsed.config.resourceId, null);
    assert.match(
      parsed.warnings[0]!,
      /DATABASE_SERVER_ID="orders" is not a database id/,
    );
  });

  test("no id, system or address: a problem for each missing value", () => {
    const parsed: ParsedConfig = database({});

    assert.strictEqual(parsed.problems.length, 2);
    assert.match(parsed.problems[0]!, /DATABASE_SYSTEM is not set/);
    assert.match(parsed.problems[1]!, /DATABASE_SERVER_ADDRESS is not set/);
    assert.strictEqual(parsed.config.resourceIdentifier, null);
  });

  test("the generic override also works for databases, and a UUID override pins the id", () => {
    const named: ParsedConfig = database({
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: "postgresql|orders-db:5432",
    });
    assert.deepStrictEqual(named.problems, []);
    assert.strictEqual(
      named.config.resourceIdentifier,
      "postgresql|orders-db:5432",
    );
    assert.strictEqual(named.config.resourceId, null);

    const pinned: ParsedConfig = database({
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: DB_UUID,
    });
    assert.strictEqual(pinned.config.resourceId, DB_UUID.toLowerCase());
  });

  test("the helpers", () => {
    assert.strictEqual(
      formatDatabaseHost(" DB.Example.COM. "),
      "db.example.com",
    );
    assert.strictEqual(formatDatabaseHost("::1"), "[::1]");
    assert.strictEqual(
      buildDatabaseEndpointIdentifier({
        system: "MongoDB",
        address: "mongo.internal",
        port: 27017,
      }),
      "mongodb|mongo.internal:27017",
    );
    assert.strictEqual(isUuid(DB_UUID), true);
    assert.strictEqual(isUuid("not-a-uuid"), false);
    assert.strictEqual(parseTcpPort("5432"), 5432);
    assert.strictEqual(parseTcpPort("0"), null);
    assert.strictEqual(parseTcpPort("65536"), null);
    assert.strictEqual(parseTcpPort("54a"), null);
    assert.strictEqual(parseTcpPort(undefined), null);
  });
});

describe("the write switch and targets", () => {
  test('only "true" turns a switch on', () => {
    for (const on of ["true", "TRUE", " True ", "tRuE"]) {
      assert.strictEqual(parseSwitch(on), true, on);
    }

    for (const off of [
      undefined,
      null,
      "",
      "false",
      "yes",
      "1",
      "on",
      "enabled",
      "readonly",
      "true-ish",
    ]) {
      assert.strictEqual(parseSwitch(off), false, String(off));
    }
  });

  test("writes are off by default (read-only)", () => {
    const parsed: ParsedConfig = parse({});

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.allowWritesSetting, null);
    assert.deepStrictEqual(parsed.config.writeTargets, []);
    assert.deepStrictEqual(parsed.config.protectedTargets, []);
  });

  test("ONEUPTIME_AI_ALLOW_WRITES=true allows writes", () => {
    const parsed: ParsedConfig = parse({ ONEUPTIME_AI_ALLOW_WRITES: "true" });

    assert.strictEqual(parsed.config.allowWrites, true);
    assert.strictEqual(parsed.config.allowWritesSetting, "true");
    assert.deepStrictEqual(parsed.warnings, []);
  });

  test("an unrecognised switch value refuses and says so once", () => {
    const parsed: ParsedConfig = parse({ ONEUPTIME_AI_ALLOW_WRITES: "yes" });

    assert.strictEqual(parsed.config.allowWrites, false);
    assert.strictEqual(parsed.config.allowWritesSetting, "yes");
    assert.strictEqual(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0]!, /ONEUPTIME_AI_ALLOW_WRITES="yes"/);
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_ALLOW_WRITES: "false" }).warnings,
      [],
    );
  });

  test("write targets: a comma list, trimmed, without blanks or duplicates, case kept", () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_WRITE_TARGETS: " web-*, api ,,web-* ,  Api " })
        .config.writeTargets,
      ["web-*", "api", "Api"],
    );
  });

  test("protected targets are read the same way", () => {
    assert.deepStrictEqual(
      parse({ ONEUPTIME_AI_PROTECTED_TARGETS: "db-*, traefik" }).config
        .protectedTargets,
      ["db-*", "traefik"],
    );
  });

  test("a target list over the bounds keeps the agent read-only, and says so", () => {
    const many: string = Array.from(
      { length: 65 },
      (_: unknown, i: number): string => {
        return `c-${i}`;
      },
    ).join(",");

    for (const variable of [
      "ONEUPTIME_AI_WRITE_TARGETS",
      "ONEUPTIME_AI_PROTECTED_TARGETS",
    ]) {
      const parsed: ParsedConfig = parse({
        ONEUPTIME_AI_ALLOW_WRITES: "true",
        [variable]: many,
      });

      assert.strictEqual(parsed.config.allowWrites, false, variable);
      assert.strictEqual(parsed.warnings.length, 1, variable);
      assert.match(
        parsed.warnings[0]!,
        /has 65 entries; at most 64.*stays read-only/,
      );
    }

    const long: ParsedConfig = parse({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: `ok,${"x".repeat(300)}`,
    });
    assert.strictEqual(long.config.allowWrites, false);
    assert.deepStrictEqual(long.config.writeTargets, ["ok"]);
    assert.match(long.warnings[0]!, /longer than 256 characters/);
  });

  test("parseTargetList reports nothing for an empty or unset list", () => {
    assert.deepStrictEqual(parseTargetList(undefined, "X"), {
      targets: [],
      problem: null,
    });
    assert.deepStrictEqual(parseTargetList(" , ", "X"), {
      targets: [],
      problem: null,
    });
  });
});

describe("ports, versions and intervals", () => {
  test("the health port defaults to 3877 (beside the Kubernetes agent's 3876) and ignores nonsense", () => {
    assert.strictEqual(DEFAULT_PORT, 3877);
    assert.strictEqual(DEFAULT_PORT, RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT);
    assert.strictEqual(parsePort(undefined), 3877);
    assert.strictEqual(parsePort("abc"), 3877);
    assert.strictEqual(parsePort("0"), 3877);
    assert.strictEqual(parsePort("70000"), 3877);
    assert.strictEqual(parsePort("4000"), 4000);
    assert.strictEqual(parse({ PORT: "4001" }).config.port, 4001);
  });

  test("the version is optional", () => {
    assert.strictEqual(parse({}).config.agentVersion, null);
    assert.strictEqual(
      parse({ APP_VERSION: "14.0.9" }).config.agentVersion,
      "14.0.9",
    );
  });

  test("the poll interval defaults to 3s with a 1s floor", () => {
    assert.strictEqual(DEFAULT_POLL_INTERVAL_MS, 3_000);
    assert.strictEqual(parse({}).config.pollIntervalMs, 3_000);
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "500" }).config
        .pollIntervalMs,
      1_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "5000" }).config
        .pollIntervalMs,
      5_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "fast" }).config
        .pollIntervalMs,
      3_000,
    );
  });

  test("the heartbeat interval defaults to 30s with a 5s floor", () => {
    assert.strictEqual(DEFAULT_HEARTBEAT_INTERVAL_MS, 30_000);
    assert.strictEqual(parse({}).config.heartbeatIntervalMs, 30_000);
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS: "1000" }).config
        .heartbeatIntervalMs,
      5_000,
    );
    assert.strictEqual(
      parse({ ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS: "60000" }).config
        .heartbeatIntervalMs,
      60_000,
    );
  });

  test("parseInterval rejects negatives, zero and decimals", () => {
    for (const value of ["-5", "0", "1.5", "1e4", ""]) {
      assert.strictEqual(
        parseInterval({ value, defaultValue: 7, min: 1 }),
        7,
        value,
      );
    }
  });
});
