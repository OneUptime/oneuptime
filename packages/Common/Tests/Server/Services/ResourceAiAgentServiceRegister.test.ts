import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import CephClusterFeedService from "../../../Server/Services/CephClusterFeedService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../Server/Services/DockerSwarmClusterFeedService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostService from "../../../Server/Services/HostService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterFeedService from "../../../Server/Services/ProxmoxClusterFeedService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ResourceAiAgentService, {
  MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR,
  MAX_RESOURCE_AI_AGENTS_PER_PROJECT,
  MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH,
  RESOURCE_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS,
  RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
  ResourceAiAgentRegistrationRefusedException,
  ResourceAiAgentRegistrationResult,
  Service as ResourceAiAgentServiceClass,
} from "../../../Server/Services/ResourceAiAgentService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { DatabaseEndpoint } from "../../../Types/DatabaseServer/DatabaseEndpoint";
import DatabaseServerDiscoverySource from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  ResourceAiAgentRegistrationRefusalReason,
  ResourceAiRemediationMode,
  isTransientResourceAiAgentRegistrationRefusal,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ResourceAiAgentService.register — how a resource AI agent gets its
 * identity with nothing but the project's telemetry ingestion key, its
 * resource type and the identity its collector reports:
 *
 *  1. an unknown resource type is refused (resource_type_invalid), and an
 *     empty or over-long identity (resource_identifier_invalid);
 *  2. the resource is found or created through its own model's
 *     find-or-create (DockerHost / PodmanHost / Host by host identifier,
 *     the clusters and vCenters by name); a database by its pinned id (in
 *     this project, else resource_not_found) or its endpoint;
 *  3. an existing agent row is re-keyed on proof of continuity, or when it
 *     is reset / signed off / offline; a live one is refused
 *     (previous_instance_online, transient, 20s) and the refusal recorded;
 *  4. a new row is bounded per project (250) and per hour (30);
 *  5. only the key's hash is stored, and the posture is stored with the
 *     resource type and the registered identity forced;
 *  6. a resource nobody configured gets the first-connection defaults
 *     (investigation on; Ask for approval when the agent allows writes),
 *     never aiAccessConfiguredAt;
 *  7. nothing is deleted or unbound, and one feed item on the resource's
 *     own feed marks the first connection.
 *
 * Everything below the service boundary is stubbed: no database.
 */

interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

type AnyObject = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INGESTION_KEY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const CURRENT_KEY: string = "ab".repeat(32);
const ALIVE_WINDOW_MS: number =
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000;

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// How each type's resource is found, and where its feed goes.
interface TypeFixture {
  resourceType: AiResourceType;
  alias: string;
  identity: string;
  service: AnyObject;
  findOrCreateMethod: string;
  findOrCreateIdentityKey: string;
  feedService: AnyObject;
  feedMethod: string;
  feedIdKey: string;
}

const NAMED_TYPES: Array<TypeFixture> = [
  {
    resourceType: AiResourceType.DockerHost,
    alias: "docker",
    identity: "web-1",
    service: DockerHostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: DockerHostFeedService as unknown as AnyObject,
    feedMethod: "createDockerHostFeedItem",
    feedIdKey: "dockerHostId",
  },
  {
    resourceType: AiResourceType.PodmanHost,
    alias: "podman",
    identity: "pod-host-1",
    service: PodmanHostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: PodmanHostFeedService as unknown as AnyObject,
    feedMethod: "createPodmanHostFeedItem",
    feedIdKey: "podmanHostId",
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    alias: "docker-swarm",
    identity: "Prod-Swarm",
    service: DockerSwarmClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: DockerSwarmClusterFeedService as unknown as AnyObject,
    feedMethod: "createDockerSwarmClusterFeedItem",
    feedIdKey: "dockerSwarmClusterId",
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    alias: "proxmox",
    identity: "pve-lab",
    service: ProxmoxClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: ProxmoxClusterFeedService as unknown as AnyObject,
    feedMethod: "createProxmoxClusterFeedItem",
    feedIdKey: "proxmoxClusterId",
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    alias: "vmware",
    identity: "vcenter-eu",
    service: VMwareVCenterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: VMwareVCenterFeedService as unknown as AnyObject,
    feedMethod: "createVMwareVCenterFeedItem",
    feedIdKey: "vmwareVCenterId",
  },
  {
    resourceType: AiResourceType.CephCluster,
    alias: "ceph",
    identity: "ceph-prod",
    service: CephClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: CephClusterFeedService as unknown as AnyObject,
    feedMethod: "createCephClusterFeedItem",
    feedIdKey: "cephClusterId",
  },
  {
    resourceType: AiResourceType.Host,
    alias: "host",
    identity: "node-7",
    service: HostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: HostFeedService as unknown as AnyObject,
    feedMethod: "createHostFeedItem",
    feedIdKey: "hostId",
  },
];

const DOCKER: TypeFixture = NAMED_TYPES[0]!;

// A resource row as findResource reads it.
function makeResourceRow(overrides: AnyObject = {}): AnyObject {
  const row: DockerHost = new DockerHost();
  row._id = RESOURCE_ID.toString();
  row.projectId = PROJECT_ID;
  row.name = "web-1";
  row.isAiInvestigationEnabled = false;
  row.aiRemediationMode = ResourceAiRemediationMode.Disabled;
  Object.assign(row, overrides);
  return row as unknown as AnyObject;
}

// An existing agent row as the registration lookup reads it (with its hash).
function makeAgent(overrides: AnyObject = {}): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.resourceType = AiResourceType.DockerHost;
  agent.resourceId = RESOURCE_ID;
  agent.resourceIdentifier = "web-1";
  agent.keyHash = ResourceAiAgentServiceClass.hashKey(CURRENT_KEY);
  agent.connectionStatus = "connected";
  agent.lastAliveAt = msAgo(20 * 1000);
  agent.lastRegisteredAt = msAgo(60 * 60 * 1000);
  agent.agentVersion = "14.1.0";
  agent.posture = {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
  };
  Object.assign(agent, overrides);
  return agent;
}

interface Harness {
  findOrCreate: SpyCalls;
  resourceFindOneBy: SpyCalls;
  resourceUpdateOneBy: SpyCalls;
  resourceUpdateOneById: SpyCalls;
  resourceDeletes: Array<SpyCalls>;
  feed: SpyCalls;
  agentFindOneBy: SpyCalls;
  agentCountBy: SpyCalls;
  agentCreate: SpyCalls;
  agentUpdateOneById: SpyCalls;
  agentUpdateColumns: SpyCalls;
}

interface HarnessOptions {
  fixture?: TypeFixture;
  resource?: AnyObject | null;
  existing?: ResourceAiAgent | null;
  totalAgents?: number;
  agentsInLastHour?: number;
  resourceUpdateCount?: number;
}

function silenceLogger(): void {
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
}

function setUp(options: HarnessOptions = {}): Harness {
  const fixture: TypeFixture = options.fixture || DOCKER;
  const resource: AnyObject | null =
    options.resource === undefined ? makeResourceRow() : options.resource;

  silenceLogger();

  const found: AnyObject = { _id: RESOURCE_ID.toString() };
  Object.defineProperty(found, "id", { value: RESOURCE_ID });

  return {
    findOrCreate: jest
      .spyOn(fixture.service, fixture.findOrCreateMethod)
      .mockResolvedValue(found as never) as unknown as SpyCalls,
    resourceFindOneBy: jest
      .spyOn(fixture.service, "findOneBy")
      .mockResolvedValue(resource as never) as unknown as SpyCalls,
    resourceUpdateOneBy: jest
      .spyOn(fixture.service, "updateOneBy")
      .mockResolvedValue(
        (options.resourceUpdateCount ?? 1) as never,
      ) as unknown as SpyCalls,
    resourceUpdateOneById: jest
      .spyOn(fixture.service, "updateOneById")
      .mockResolvedValue(1 as never) as unknown as SpyCalls,
    resourceDeletes: (
      ["deleteBy", "deleteOneBy", "deleteOneById", "hardDeleteBy"] as const
    ).map((method: string) => {
      return jest
        .spyOn(fixture.service, method)
        .mockResolvedValue(0 as never) as unknown as SpyCalls;
    }),
    feed: jest
      .spyOn(fixture.feedService, fixture.feedMethod)
      .mockResolvedValue(undefined as never) as unknown as SpyCalls,
    agentFindOneBy: jest
      .spyOn(ResourceAiAgentService, "findOneBy")
      .mockResolvedValue(
        options.existing === undefined ? null : options.existing,
      ) as unknown as SpyCalls,
    agentCountBy: jest
      .spyOn(ResourceAiAgentService, "countBy")
      .mockImplementation(async (countBy: { query: AnyObject }) => {
        return new PositiveNumber(
          countBy.query["createdAt"] !== undefined
            ? options.agentsInLastHour || 0
            : options.totalAgents || 0,
        );
      }) as unknown as SpyCalls,
    agentCreate: jest
      .spyOn(ResourceAiAgentService, "create")
      .mockImplementation(async (createBy: { data: ResourceAiAgent }) => {
        const created: ResourceAiAgent = createBy.data;
        created.id = AGENT_ID;
        return created;
      }) as unknown as SpyCalls,
    agentUpdateOneById: jest
      .spyOn(ResourceAiAgentService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as SpyCalls,
    agentUpdateColumns: jest
      .spyOn(ResourceAiAgentService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined) as unknown as SpyCalls,
  };
}

const DOCKER_POSTURE: JSONObject = {
  resourceType: AiResourceType.DockerHost,
  resourceIdentifier: "web-1",
  agentVersion: "14.1.0",
  allowWrites: false,
  allowWritesSetting: "false",
  writeTargets: [],
  protectedTargets: ["oneuptime-ai-agent"],
  toolVersion: "27.3.1",
  reachable: true,
  details: { dockerHost: "unix:///var/run/docker.sock" },
  reportedAt: "2026-09-28T10:00:00.000Z",
};

function register(
  overrides: Partial<{
    resourceType: unknown;
    resourceIdentifier: unknown;
    resourceId: unknown;
    agentVersion: string;
    previousAgentKey: string;
    posture: unknown;
    ingestionKeyId: ObjectID;
  }> = {},
): Promise<ResourceAiAgentRegistrationResult> {
  return ResourceAiAgentService.register({
    projectId: PROJECT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    agentVersion: "14.1.0",
    posture: DOCKER_POSTURE,
    ingestionKeyId: INGESTION_KEY_ID,
    ...overrides,
  });
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<ResourceAiAgentRegistrationRefusedException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ResourceAiAgentRegistrationRefusedException) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the registration to be refused");
}

function createdRow(harness: Harness): ResourceAiAgent {
  expect(harness.agentCreate.mock.calls).toHaveLength(1);
  return (harness.agentCreate.mock.calls[0]![0] as { data: ResourceAiAgent })
    .data;
}

function reKeyWrite(harness: Harness): {
  id: ObjectID;
  data: AnyObject;
  props: AnyObject;
} {
  expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  return harness.agentUpdateOneById.mock.calls[0]![0] as {
    id: ObjectID;
    data: AnyObject;
    props: AnyObject;
  };
}

function nothingWrittenToTheAgentTable(harness: Harness): void {
  expect(harness.agentCreate.mock.calls).toHaveLength(0);
  expect(harness.agentUpdateOneById.mock.calls).toHaveLength(0);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("register: a resource's first agent", () => {
  test("creates the row and returns the key, storing only the key's sha256", async () => {
    const harness: Harness = setUp();

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("created");
    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
    expect(result.resourceType).toBe(AiResourceType.DockerHost);
    expect(result.resourceId.toString()).toBe(RESOURCE_ID.toString());
    expect(result.resourceName).toBe("web-1");
    expect(result.agentKey).toMatch(/^[0-9a-f]{64}$/);

    const row: ResourceAiAgent = createdRow(harness);
    expect(row.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(row.resourceType).toBe(AiResourceType.DockerHost);
    expect(row.resourceId!.toString()).toBe(RESOURCE_ID.toString());
    expect(row.resourceIdentifier).toBe("web-1");
    expect(row.keyHash).toBe(
      ResourceAiAgentServiceClass.hashKey(result.agentKey),
    );
    expect(Object.values(row)).not.toContain(result.agentKey);

    expect(
      (harness.agentCreate.mock.calls[0]![0] as { props: AnyObject }).props[
        "isRoot"
      ],
    ).toBe(true);
  });

  test("the new row is connected, alive and registered now, with the agent's version and the ingestion key that minted it", async () => {
    const harness: Harness = setUp();
    const before: number = Date.now();

    await register();

    const row: ResourceAiAgent = createdRow(harness);
    expect(row.connectionStatus).toBe("connected");
    expect(row.lastAliveAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.lastRegisteredAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.agentVersion).toBe("14.1.0");
    expect(row.registeredWithIngestionKeyId!.toString()).toBe(
      INGESTION_KEY_ID.toString(),
    );
  });

  test("a registration without an ingestion key id or version leaves them unset", async () => {
    const harness: Harness = setUp();

    await ResourceAiAgentService.register({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
    });

    const row: ResourceAiAgent = createdRow(harness);
    expect(row.registeredWithIngestionKeyId).toBeUndefined();
    expect(row.agentVersion).toBeUndefined();
  });

  test("every registration mints a different key", async () => {
    setUp();

    const first: ResourceAiAgentRegistrationResult = await register();
    const second: ResourceAiAgentRegistrationResult = await register();

    expect(first.agentKey).not.toBe(second.agentKey);
  });

  test("the resource is named by its row, else by the identity", async () => {
    setUp({ resource: makeResourceRow({ name: "Web server one" }) });
    expect((await register()).resourceName).toBe("Web server one");
    jest.restoreAllMocks();

    setUp({ resource: makeResourceRow({ name: "" }) });
    expect((await register()).resourceName).toBe("web-1");
  });

  test("looks the agent row up by project, type and resource, as root, selecting the key hash", async () => {
    const harness: Harness = setUp();

    await register();

    const lookup: AnyObject = harness.agentFindOneBy.mock
      .calls[0]![0] as AnyObject;

    expect(lookup["query"]["projectId"]).toBe(PROJECT_ID);
    expect(lookup["query"]["resourceType"]).toBe(AiResourceType.DockerHost);
    expect(String(lookup["query"]["resourceId"])).toBe(RESOURCE_ID.toString());
    expect(lookup["select"]).toEqual({
      ...RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
      keyHash: true,
    });
    expect(lookup["props"]["isRoot"]).toBe(true);
  });

  test("the version is trimmed and bounded to its column", async () => {
    const harness: Harness = setUp();

    await register({ agentVersion: `  ${"9".repeat(300)}  ` });

    expect(createdRow(harness).agentVersion).toBe(
      "9".repeat(ColumnLength.ShortText),
    );
  });
});

describe("register: resolving the resource of every named type", () => {
  test.each(NAMED_TYPES)(
    "$resourceType: found or created by $findOrCreateMethod with the trimmed identity, in the registering project, then re-read as root",
    async (fixture: TypeFixture) => {
      const harness: Harness = setUp({ fixture });

      const result: ResourceAiAgentRegistrationResult = await register({
        resourceType: fixture.resourceType,
        resourceIdentifier: `  ${fixture.identity}  `,
        posture: {
          resourceType: "somethingElse",
          resourceIdentifier: "someone-else",
          allowWrites: false,
        },
      });

      expect(harness.findOrCreate.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        [fixture.findOrCreateIdentityKey]: fixture.identity,
      });

      const read: AnyObject = harness.resourceFindOneBy.mock
        .calls[0]![0] as AnyObject;
      expect(read["query"]["_id"]).toBe(RESOURCE_ID.toString());
      expect(read["query"]["projectId"]).toBe(PROJECT_ID);
      expect(read["select"]["aiAccessConfiguredAt"]).toBe(true);
      expect(read["select"]["isAiInvestigationEnabled"]).toBe(true);
      expect(read["select"]["aiRemediationMode"]).toBe(true);
      expect(read["props"]["isRoot"]).toBe(true);

      expect(result.resourceType).toBe(fixture.resourceType);
      expect(result.resourceId.toString()).toBe(RESOURCE_ID.toString());

      const row: ResourceAiAgent = createdRow(harness);
      expect(row.resourceType).toBe(fixture.resourceType);
      expect(row.resourceIdentifier).toBe(fixture.identity);
      expect(row.posture!["resourceType"]).toBe(fixture.resourceType);
      expect(row.posture!["resourceIdentifier"]).toBe(fixture.identity);

      // The first connection is on the resource's own feed.
      expect(harness.feed.mock.calls).toHaveLength(1);
      expect(
        String(
          (harness.feed.mock.calls[0]![0] as AnyObject)[fixture.feedIdKey],
        ),
      ).toBe(RESOURCE_ID.toString());
    },
  );

  test.each(NAMED_TYPES)(
    "$resourceType is also accepted by its agent alias ($alias), in any case",
    async (fixture: TypeFixture) => {
      const harness: Harness = setUp({ fixture });

      const result: ResourceAiAgentRegistrationResult = await register({
        resourceType: ` ${fixture.alias.toUpperCase()} `,
        resourceIdentifier: fixture.identity,
      });

      expect(result.resourceType).toBe(fixture.resourceType);
      expect(harness.findOrCreate.mock.calls).toHaveLength(1);
    },
  );

  test("a resourceId sent for a named type is not trusted: the identity decides", async () => {
    const harness: Harness = setUp();

    await register({ resourceId: "99999999-9999-4999-8999-999999999999" });

    expect(harness.findOrCreate.mock.calls).toHaveLength(1);
    expect(createdRow(harness).resourceId!.toString()).toBe(
      RESOURCE_ID.toString(),
    );
  });

  test("a resource that cannot be read back after find-or-create is an error, and nothing is written", async () => {
    const harness: Harness = setUp({ resource: null });

    await expect(register()).rejects.toThrow("could not be resolved");
    nothingWrittenToTheAgentTable(harness);
  });

  test("a find-or-create failure is not dressed up as a refusal", async () => {
    const harness: Harness = setUp();
    (
      harness.findOrCreate as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(register()).rejects.toThrow("database is down");
    nothingWrittenToTheAgentTable(harness);
  });

  test("registration never deletes or renames the resource", async () => {
    const harness: Harness = setUp();

    await register();

    for (const spy of harness.resourceDeletes) {
      expect(spy.mock.calls).toHaveLength(0);
    }
    expect(harness.resourceUpdateOneById.mock.calls).toHaveLength(0);
  });
});

describe("register: resource_type_invalid", () => {
  test.each([
    ["no type", undefined],
    ["an empty type", "   "],
    ["an unknown type", "KubernetesCluster"],
    ["a number", 7],
    ["an object", { type: "docker" }],
  ])(
    "%s is refused before anything is read or written",
    async (_label: string, resourceType: unknown) => {
      const harness: Harness = setUp();

      const refusal: ResourceAiAgentRegistrationRefusedException =
        await refusalOf(register({ resourceType }));

      expect(refusal.reason).toBe("resource_type_invalid");
      expect(refusal.retryAfterSeconds).toBeUndefined();
      expect(refusal.message).toContain("ONEUPTIME_AI_AGENT_RESOURCE_TYPE");
      expect(refusal.message).toContain("docker, podman, docker-swarm");
      expect(harness.findOrCreate.mock.calls).toHaveLength(0);
      nothingWrittenToTheAgentTable(harness);
    },
  );

  test("is a 403 refusal that needs an operator", async () => {
    setUp();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register({ resourceType: "mainframe" }));

    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect(refusal.message).toContain('"mainframe"');
    expect(isTransientResourceAiAgentRegistrationRefusal(refusal.reason)).toBe(
      false,
    );
  });
});

describe("register: resource_identifier_invalid", () => {
  test.each([
    ["an empty identity", ""],
    ["a blank identity", "   "],
    ["no identity", undefined],
    ["a number", 42],
    ["an object", { name: "web-1" }],
  ])(
    "%s is refused before anything is read or written, naming the variables to set",
    async (_label: string, resourceIdentifier: unknown) => {
      const harness: Harness = setUp();

      const refusal: ResourceAiAgentRegistrationRefusedException =
        await refusalOf(register({ resourceIdentifier }));

      expect(refusal.reason).toBe("resource_identifier_invalid");
      expect(refusal.retryAfterSeconds).toBeUndefined();
      expect(refusal.message).toContain("DOCKER_HOST_NAME");
      expect(refusal.message).toContain("ONEUPTIME_AI_AGENT_RESOURCE_NAME");
      expect(harness.findOrCreate.mock.calls).toHaveLength(0);
      nothingWrittenToTheAgentTable(harness);
    },
  );

  test("an identity longer than the resource's identity column is refused, saying the limit", async () => {
    const harness: Harness = setUp();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(
        register({
          resourceIdentifier: "h".repeat(
            MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH + 1,
          ),
        }),
      );

    expect(refusal.reason).toBe("resource_identifier_invalid");
    expect(refusal.message).toContain(
      String(MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH),
    );
    expect(harness.findOrCreate.mock.calls).toHaveLength(0);
  });

  test("an identity exactly at the limit is accepted", async () => {
    const harness: Harness = setUp();

    await register({
      resourceIdentifier: "h".repeat(MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH),
    });

    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });
});

describe("register: a database server", () => {
  const DB_ID: ObjectID = RESOURCE_ID;

  interface DatabaseHarness extends Harness {
    findByIdInProject: SpyCalls;
    findOrCreateByEndpoint: SpyCalls;
  }

  function dbRow(): DatabaseServer {
    const row: DatabaseServer = new DatabaseServer();
    row._id = DB_ID.toString();
    row.projectId = PROJECT_ID;
    row.name = "PostgreSQL db.prod.example.com:5432";
    row.isAiInvestigationEnabled = false;
    row.aiRemediationMode = ResourceAiRemediationMode.Disabled;
    return row;
  }

  function setUpDatabase(
    options: {
      byId?: DatabaseServer | null;
      byEndpoint?: DatabaseServer | null;
      existing?: ResourceAiAgent | null;
    } = {},
  ): DatabaseHarness {
    silenceLogger();

    return {
      findOrCreate: { mock: { calls: [] } },
      findByIdInProject: jest
        .spyOn(DatabaseServerService, "findByIdInProject")
        .mockResolvedValue(
          options.byId === undefined ? dbRow() : options.byId,
        ) as unknown as SpyCalls,
      findOrCreateByEndpoint: jest
        .spyOn(DatabaseServerService, "findOrCreateByEndpoint")
        .mockResolvedValue(
          options.byEndpoint === undefined ? dbRow() : options.byEndpoint,
        ) as unknown as SpyCalls,
      resourceFindOneBy: jest
        .spyOn(DatabaseServerService, "findOneBy")
        .mockResolvedValue(dbRow()) as unknown as SpyCalls,
      resourceUpdateOneBy: jest
        .spyOn(DatabaseServerService, "updateOneBy")
        .mockResolvedValue(1) as unknown as SpyCalls,
      resourceUpdateOneById: jest
        .spyOn(DatabaseServerService, "updateOneById")
        .mockResolvedValue(undefined as never) as unknown as SpyCalls,
      resourceDeletes: [],
      feed: jest
        .spyOn(DatabaseServerFeedService, "createDatabaseServerFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      agentFindOneBy: jest
        .spyOn(ResourceAiAgentService, "findOneBy")
        .mockResolvedValue(
          options.existing === undefined ? null : options.existing,
        ) as unknown as SpyCalls,
      agentCountBy: jest
        .spyOn(ResourceAiAgentService, "countBy")
        .mockResolvedValue(new PositiveNumber(0)) as unknown as SpyCalls,
      agentCreate: jest
        .spyOn(ResourceAiAgentService, "create")
        .mockImplementation(async (createBy: { data: ResourceAiAgent }) => {
          createBy.data.id = AGENT_ID;
          return createBy.data;
        }) as unknown as SpyCalls,
      agentUpdateOneById: jest
        .spyOn(ResourceAiAgentService, "updateOneById")
        .mockResolvedValue(undefined as never) as unknown as SpyCalls,
      agentUpdateColumns: jest
        .spyOn(ResourceAiAgentService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
    };
  }

  function registerDatabase(
    overrides: Partial<{
      resourceIdentifier: unknown;
      resourceId: unknown;
      posture: unknown;
    }> = {},
  ): Promise<ResourceAiAgentRegistrationResult> {
    return ResourceAiAgentService.register({
      projectId: PROJECT_ID,
      resourceType: "database",
      resourceIdentifier: "postgres|db.prod.example.com:5432",
      posture: {
        allowWrites: false,
        reachable: true,
        details: {
          databaseSystem: "postgres",
          serverAddress: "db.prod.example.com",
          serverPort: 5432,
        },
      },
      ...overrides,
    });
  }

  function endpointCall(harness: DatabaseHarness): AnyObject {
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(1);
    return harness.findOrCreateByEndpoint.mock.calls[0]![0] as AnyObject;
  }

  test("a pinned DATABASE_SERVER_ID that is this project's: that row, and never the endpoint", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    const result: ResourceAiAgentRegistrationResult = await registerDatabase({
      resourceIdentifier: DB_ID.toString(),
      resourceId: DB_ID.toString().toUpperCase(),
    });

    expect(result.resourceType).toBe(AiResourceType.DatabaseServer);
    expect(result.resourceId.toString()).toBe(DB_ID.toString());
    expect(result.resourceName).toBe("PostgreSQL db.prod.example.com:5432");

    expect(harness.findByIdInProject.mock.calls[0]![0]).toBe(PROJECT_ID);
    expect(String(harness.findByIdInProject.mock.calls[0]![1])).toBe(
      DB_ID.toString(),
    );
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);

    // The identity is the agent's own: the pinned id.
    expect(createdRow(harness).resourceIdentifier).toBe(DB_ID.toString());
  });

  test("an identity that is itself a database id pins that row too", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase({ resourceIdentifier: DB_ID.toString() });

    expect(harness.findByIdInProject.mock.calls).toHaveLength(1);
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);
  });

  test("a pinned id that is not this project's is refused (resource_not_found), with no fallback to the endpoint", async () => {
    const harness: DatabaseHarness = setUpDatabase({ byId: null });

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(registerDatabase({ resourceId: DB_ID.toString() }));

    expect(refusal.reason).toBe("resource_not_found");
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(refusal.message).toContain("DATABASE_SERVER_ID");
    expect(refusal.message).toContain(DB_ID.toString());
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);
    nothingWrittenToTheAgentTable(harness);
  });

  test("a pinned id that is not a UUID is refused without a lookup", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(registerDatabase({ resourceId: "orders-db" }));

    expect(refusal.reason).toBe("resource_not_found");
    expect(harness.findByIdInProject.mock.calls).toHaveLength(0);
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);
  });

  test("an endpoint identity: canonicalized like the Database Agent's telemetry (engine as reported, collector source), found or created", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    const result: ResourceAiAgentRegistrationResult = await registerDatabase();

    const call: AnyObject = endpointCall(harness);
    expect(call["projectId"]).toBe(PROJECT_ID);
    expect(call["dbSystem"]).toBe("postgresql");
    expect(call["endpoint"] as DatabaseEndpoint).toEqual({
      host: "db.prod.example.com",
      port: 5432,
    });
    expect(call["discoverySource"]).toBe(
      DatabaseServerDiscoverySource.Collector,
    );
    expect(call["allowCreate"]).toBe(true);
    expect(call["displayName"]).toContain("db.prod.example.com");
    expect(harness.findByIdInProject.mock.calls).toHaveLength(0);

    expect(result.resourceId.toString()).toBe(DB_ID.toString());
    // The agent row keeps the agent's own spelling of its identity.
    expect(createdRow(harness).resourceIdentifier).toBe(
      "postgres|db.prod.example.com:5432",
    );
  });

  test("an endpoint without a port takes the engine's default port", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase({
      resourceIdentifier: "mysql|db.prod.example.com",
      posture: {},
    });

    expect(endpointCall(harness)["endpoint"]).toEqual({
      host: "db.prod.example.com",
      port: 3306,
    });
  });

  test("an IPv6 endpoint in brackets is read with its port", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase({
      resourceIdentifier: "postgresql|[2001:db8::10]:6432",
      posture: {},
    });

    expect(endpointCall(harness)["endpoint"]).toEqual({
      host: "2001:db8::10",
      port: 6432,
    });
  });

  test("an identity that is not an endpoint falls back to the posture's details", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase({ resourceIdentifier: "orders-db" });

    expect(endpointCall(harness)["endpoint"]).toEqual({
      host: "db.prod.example.com",
      port: 5432,
    });
  });

  test("an identity that names neither an id nor an endpoint (and no details) is refused as resource_identifier_invalid", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(
        registerDatabase({ resourceIdentifier: "orders-db", posture: {} }),
      );

    expect(refusal.reason).toBe("resource_identifier_invalid");
    expect(refusal.message).toContain("DATABASE_SYSTEM");
    expect(refusal.message).toContain("DATABASE_SERVER_ID");
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);
    nothingWrittenToTheAgentTable(harness);
  });

  test("a loopback address names no server: resource_not_found, pointing at DATABASE_SERVER_ADDRESS", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(
        registerDatabase({
          resourceIdentifier: "postgresql|localhost:5432",
          posture: {},
        }),
      );

    expect(refusal.reason).toBe("resource_not_found");
    expect(refusal.message).toContain("DATABASE_SERVER_ADDRESS");
    expect(harness.findOrCreateByEndpoint.mock.calls).toHaveLength(0);
  });

  test("a local-scope endpoint may only join an existing row (allowCreate false)", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase({
      resourceIdentifier: "postgresql|orders-db:5432",
      posture: {},
    });

    expect(endpointCall(harness)["allowCreate"]).toBe(false);
  });

  test("an endpoint no row owns and none may be created for is refused (resource_not_found)", async () => {
    const harness: DatabaseHarness = setUpDatabase({ byEndpoint: null });

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(registerDatabase());

    expect(refusal.reason).toBe("resource_not_found");
    expect(refusal.message).toContain("db.prod.example.com:5432");
    expect(refusal.message).toContain("DATABASE_SERVER_ID");
    expect(isTransientResourceAiAgentRegistrationRefusal(refusal.reason)).toBe(
      false,
    );
    nothingWrittenToTheAgentTable(harness);
  });

  test("an endpoint identity up to the posture's limit is accepted; one over it is refused", async () => {
    setUpDatabase();

    const host: string = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(
      60,
    )}.example.com`;
    const identity: string = `postgresql|${host}`.padEnd(
      MAX_POSTURE_STRING_LENGTH,
      "",
    );

    await expect(
      registerDatabase({ resourceIdentifier: identity, posture: {} }),
    ).resolves.toBeDefined();

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(
        registerDatabase({
          resourceIdentifier: `postgresql|${"d".repeat(MAX_POSTURE_STRING_LENGTH)}`,
        }),
      );

    expect(refusal.reason).toBe("resource_identifier_invalid");
    expect(refusal.message).toContain(String(MAX_POSTURE_STRING_LENGTH));
  });

  test("the first connection is on the database's own feed", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase();

    expect(harness.feed.mock.calls).toHaveLength(1);
    const item: AnyObject = harness.feed.mock.calls[0]![0] as AnyObject;
    expect(String(item["databaseServerId"])).toBe(DB_ID.toString());
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "The Database AI agent connected (read-only).",
    );
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "investigate this database server",
    );
  });

  test("the defaults are written to the database server's row", async () => {
    const harness: DatabaseHarness = setUpDatabase();

    await registerDatabase();

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
    expect(
      (harness.resourceUpdateOneBy.mock.calls[0]![0] as AnyObject)["data"],
    ).toEqual({ isAiInvestigationEnabled: true });
  });
});

describe("register: the stored posture", () => {
  test("keeps what the agent reported, validated, and forces the type and the registered identity", async () => {
    const harness: Harness = setUp();

    await register({
      posture: {
        ...DOCKER_POSTURE,
        resourceType: AiResourceType.Host,
        resourceIdentifier: "someone-else",
        allowWrites: true,
        allowWritesSetting: "true",
        writeTargets: ["web-*", "api"],
      },
    });

    expect(createdRow(harness).posture).toEqual({
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
      agentVersion: "14.1.0",
      allowWrites: true,
      allowWritesSetting: "true",
      writeTargets: ["web-*", "api"],
      protectedTargets: ["oneuptime-ai-agent"],
      toolVersion: "27.3.1",
      reachable: true,
      reachError: null,
      details: { dockerHost: "unix:///var/run/docker.sock" },
      reportedAt: "2026-09-28T10:00:00.000Z",
    });
  });

  test("malformed fields are never trusted — writes stay off", async () => {
    const harness: Harness = setUp();

    await register({
      posture: {
        allowWrites: "true",
        writeTargets: ["web", "", 42],
        reachable: "yes",
        toolVersion: { v: 1 },
      },
    });

    const posture: JSONObject = createdRow(harness).posture!;
    expect(posture["allowWrites"]).toBe(false);
    expect(posture["writeTargets"]).toEqual([]);
    expect(posture["reachable"]).toBe(false);
    expect(posture["toolVersion"]).toBeNull();
  });

  test("a malformed protected-targets list forces writes off", async () => {
    const harness: Harness = setUp();

    await register({
      posture: { allowWrites: true, protectedTargets: "oneuptime-ai-agent" },
    });

    expect(createdRow(harness).posture!["allowWrites"]).toBe(false);
  });

  test.each([
    ["no posture", undefined],
    ["a string", "allowWrites=true"],
    ["an array", [{ allowWrites: true }]],
  ])(
    "%s is a read-only agent of this resource",
    async (_label: string, posture: unknown) => {
      const harness: Harness = setUp();

      await register({ posture });

      const stored: JSONObject = createdRow(harness).posture!;
      expect(stored["resourceType"]).toBe(AiResourceType.DockerHost);
      expect(stored["resourceIdentifier"]).toBe("web-1");
      expect(stored["allowWrites"]).toBe(false);
      expect(Object.values(stored)).not.toContain(undefined);
    },
  );

  test("buildStoredPosture never stores undefined keys", () => {
    const posture: JSONObject = ResourceAiAgentService.buildStoredPosture({
      reported: { allowWrites: true, extra: "ignored" },
      resourceType: AiResourceType.CephCluster,
      resourceIdentifier: "ceph-prod",
    }) as unknown as JSONObject;

    expect(posture["resourceType"]).toBe(AiResourceType.CephCluster);
    expect(posture["resourceIdentifier"]).toBe("ceph-prod");
    expect(posture["allowWrites"]).toBe(true);
    expect(posture).not.toHaveProperty("extra");
    expect(posture).not.toHaveProperty("reportedAt");
    expect(Object.values(posture)).not.toContain(undefined);
  });
});

describe("register: re-registering an existing agent", () => {
  test("continuity: the current key re-keys even a live agent", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });

    const result: ResourceAiAgentRegistrationResult = await register({
      previousAgentKey: CURRENT_KEY,
    });

    expect(result.admission).toBe("continuity");
    expect(result.agentId.toString()).toBe(AGENT_ID.toString());
    expect(result.agentKey).not.toBe(CURRENT_KEY);

    const write: { id: ObjectID; data: AnyObject } = reKeyWrite(harness);
    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data["keyHash"]).toBe(
      ResourceAiAgentServiceClass.hashKey(result.agentKey),
    );
    expect(harness.agentCreate.mock.calls).toHaveLength(0);
  });

  test("the re-key writes the new hash, the identity, connected, alive and registered now, the posture and the minting key", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        connectionStatus: "disconnected",
        lastAliveAt: msAgo(ALIVE_WINDOW_MS * 3),
        resourceIdentifier: "WEB-1",
      }),
    });
    const before: number = Date.now();

    await register({ agentVersion: "14.2.0" });

    const write: { data: AnyObject; props: AnyObject } = reKeyWrite(harness);

    expect(write.props["isRoot"]).toBe(true);
    expect(write.data["resourceIdentifier"]).toBe("web-1");
    expect(write.data["connectionStatus"]).toBe("connected");
    expect(
      (write.data["lastAliveAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(
      (write.data["lastRegisteredAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(write.data["agentVersion"]).toBe("14.2.0");
    expect(String(write.data["registeredWithIngestionKeyId"])).toBe(
      INGESTION_KEY_ID.toString(),
    );
    expect((write.data["posture"] as JSONObject)["resourceIdentifier"]).toBe(
      "web-1",
    );
  });

  test("a re-key without an ingestion key id clears the previous one, and keeps the stored version when none is sent", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });

    await ResourceAiAgentService.register({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
    });

    const write: { data: AnyObject } = reKeyWrite(harness);
    expect(write.data["registeredWithIngestionKeyId"]).toBeNull();
    expect(write.data).not.toHaveProperty("agentVersion");
  });

  test("offline: an agent that stopped heartbeating is replaced without its key", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ lastAliveAt: msAgo(ALIVE_WINDOW_MS + 60 * 1000) }),
    });

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("offline");
    expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  });

  test("signed off: an agent that said goodbye is replaced at once", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        connectionStatus: "disconnected",
        lastAliveAt: msAgo(5 * 1000),
      }),
    });

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("signed_off");
    expect(harness.agentUpdateOneById.mock.calls).toHaveLength(1);
  });

  test("reset: a row an admin reset admits the next registration, even if it still reads as connected", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({
        keyHash: null,
        connectionStatus: "connected",
        lastAliveAt: msAgo(5 * 1000),
      }),
    });

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(result.admission).toBe("reset");
    expect(reKeyWrite(harness).data["keyHash"]).toBe(
      ResourceAiAgentServiceClass.hashKey(result.agentKey),
    );
  });

  test("the caps are not consulted for an existing row", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      totalAgents: MAX_RESOURCE_AI_AGENTS_PER_PROJECT,
      agentsInLastHour: MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR,
    });

    await register();

    expect(harness.agentCountBy.mock.calls).toHaveLength(0);
  });

  test("no connected feed item for a re-key that changed no setting", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      resource: makeResourceRow({ isAiInvestigationEnabled: true }),
    });

    await register();

    expect(harness.feed.mock.calls).toHaveLength(0);
  });
});

describe("register: another agent is online (previous_instance_online)", () => {
  test.each([
    ["no key", undefined],
    ["a wrong key", "cd".repeat(32)],
    [
      "the key's hash instead of the key",
      ResourceAiAgentServiceClass.hashKey(CURRENT_KEY),
    ],
  ])(
    "%s: refused, transient, 20 seconds — and the key is not changed",
    async (_label: string, previousAgentKey: string | undefined) => {
      const harness: Harness = setUp({ existing: makeAgent() });

      const refusal: ResourceAiAgentRegistrationRefusedException =
        await refusalOf(register(previousAgentKey ? { previousAgentKey } : {}));

      expect(refusal.reason).toBe("previous_instance_online");
      expect(refusal.retryAfterSeconds).toBe(20);
      expect(RESOURCE_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS).toBe(20);
      expect(
        isTransientResourceAiAgentRegistrationRefusal(refusal.reason),
      ).toBe(true);
      expect(refusal.message).toContain('"web-1"');
      expect(refusal.message).toContain("Docker AI agent");
      nothingWrittenToTheAgentTable(harness);
      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    },
  );

  test("the refusal is recorded on the row: when, and why", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });
    const before: number = Date.now();

    await refusalOf(register());

    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);

    const record: { id: ObjectID; data: AnyObject } = harness.agentUpdateColumns
      .mock.calls[0]![0] as { id: ObjectID; data: AnyObject };

    expect(record.id.toString()).toBe(AGENT_ID.toString());
    expect(record.data["lastRefusedRegistrationReason"]).toBe(
      "previous_instance_online",
    );
    expect(
      (record.data["lastRefusedRegistrationAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(Object.keys(record.data).sort()).toEqual([
      "lastRefusedRegistrationAt",
      "lastRefusedRegistrationReason",
    ]);
  });

  test("a failure to record it never turns the refusal into a server error", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });
    (
      harness.agentUpdateColumns as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
  });

  test("an agent heard from just inside the alive window is still online", async () => {
    setUp({
      existing: makeAgent({ lastAliveAt: msAgo(ALIVE_WINDOW_MS - 10 * 1000) }),
    });

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
  });
});

describe("register: agent_cap_reached", () => {
  test(`a project with ${MAX_RESOURCE_AI_AGENTS_PER_PROJECT} agents gets no new one`, async () => {
    const harness: Harness = setUp({
      totalAgents: MAX_RESOURCE_AI_AGENTS_PER_PROJECT,
    });

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("agent_cap_reached");
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(isTransientResourceAiAgentRegistrationRefusal(refusal.reason)).toBe(
      false,
    );
    expect(refusal.message).toContain(
      String(MAX_RESOURCE_AI_AGENTS_PER_PROJECT),
    );
    nothingWrittenToTheAgentTable(harness);
    expect(harness.feed.mock.calls).toHaveLength(0);
    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
  });

  test(`${MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR} new agents in the last hour is the hourly brake`, async () => {
    const harness: Harness = setUp({
      totalAgents: 40,
      agentsInLastHour: MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR,
    });

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("agent_cap_reached");
    expect(refusal.message).toContain(
      String(MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR),
    );
    nothingWrittenToTheAgentTable(harness);
  });

  test("one under either limit is admitted", async () => {
    const harness: Harness = setUp({
      totalAgents: MAX_RESOURCE_AI_AGENTS_PER_PROJECT - 1,
      agentsInLastHour: MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR - 1,
    });

    await register();

    expect(harness.agentCreate.mock.calls).toHaveLength(1);
  });

  test("both counts are scoped to the project (every resource type together), as root; the brake counts only the last hour's rows", async () => {
    const harness: Harness = setUp();

    await register();

    expect(harness.agentCountBy.mock.calls).toHaveLength(2);

    const [total, lastHour] = harness.agentCountBy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as { query: AnyObject; props: AnyObject };
      },
    ) as [
      { query: AnyObject; props: AnyObject },
      { query: AnyObject; props: AnyObject },
    ];

    expect(total.query).toEqual({ projectId: PROJECT_ID });
    expect(total.props["isRoot"]).toBe(true);
    expect(lastHour.query["projectId"]).toBe(PROJECT_ID);
    expect(lastHour.query["createdAt"]).toBeDefined();
    expect(lastHour.props["isRoot"]).toBe(true);
  });

  test("the caps match the Kubernetes AI agent's", () => {
    expect(MAX_RESOURCE_AI_AGENTS_PER_PROJECT).toBe(250);
    expect(MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR).toBe(30);
  });
});

describe("register: two agents registering a new resource at once", () => {
  test("the one whose create loses is told the other agent is online", async () => {
    const harness: Harness = setUp();
    (
      harness.agentCreate as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("duplicate key value"));
    (
      harness.agentFindOneBy as unknown as {
        mockResolvedValueOnce: (value: unknown) => {
          mockResolvedValueOnce: (value: unknown) => void;
        };
      }
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeAgent());

    const refusal: ResourceAiAgentRegistrationRefusedException =
      await refusalOf(register());

    expect(refusal.reason).toBe("previous_instance_online");
    expect(refusal.retryAfterSeconds).toBe(20);
    expect(harness.feed.mock.calls).toHaveLength(0);

    // The winner is looked up by the same resource.
    const winnerLookup: AnyObject = harness.agentFindOneBy.mock
      .calls[1]![0] as AnyObject;
    expect(winnerLookup["query"]["resourceType"]).toBe(
      AiResourceType.DockerHost,
    );
    expect(String(winnerLookup["query"]["resourceId"])).toBe(
      RESOURCE_ID.toString(),
    );
  });

  test("any other create failure is not dressed up as a refusal", async () => {
    const harness: Harness = setUp();
    (
      harness.agentCreate as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("connection reset"));

    await expect(register()).rejects.toThrow("connection reset");
  });
});

describe("register: first-connection defaults", () => {
  function defaultsWrite(harness: Harness): {
    query: AnyObject;
    data: AnyObject;
    props: AnyObject;
  } {
    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
    return harness.resourceUpdateOneBy.mock.calls[0]![0] as {
      query: AnyObject;
      data: AnyObject;
      props: AnyObject;
    };
  }

  test("a resource nobody configured gets investigation on (the resource models default it off)", async () => {
    const harness: Harness = setUp();

    await register();

    const write: { query: AnyObject; data: AnyObject; props: AnyObject } =
      defaultsWrite(harness);

    expect(write.data).toEqual({ isAiInvestigationEnabled: true });
    expect(write.query["_id"]).toBe(RESOURCE_ID.toString());
    expect(write.query["projectId"]).toBe(PROJECT_ID);
    expect(write.props["isRoot"]).toBe(true);
  });

  test("and, when the agent allows writes, fixes Ask for approval instead of Off", async () => {
    const harness: Harness = setUp();

    await register({
      posture: { ...DOCKER_POSTURE, allowWrites: true },
    });

    expect(defaultsWrite(harness).data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
  });

  test.each(NAMED_TYPES)(
    "$resourceType: the defaults are written to its own row",
    async (fixture: TypeFixture) => {
      const harness: Harness = setUp({ fixture });

      await register({
        resourceType: fixture.resourceType,
        resourceIdentifier: fixture.identity,
        posture: { allowWrites: true },
      });

      expect(defaultsWrite(harness).data).toEqual({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      });
    },
  );

  test("the update only lands while the resource is still unconfigured", async () => {
    const harness: Harness = setUp();

    await register();

    const configuredAt: FindOperator<unknown> = defaultsWrite(harness).query[
      "aiAccessConfiguredAt"
    ] as FindOperator<unknown>;

    // QueryHelper.isNull: a raw `IS NULL` on the column.
    expect(configuredAt).toBeInstanceOf(FindOperator);
    expect(configuredAt.type).toBe("raw");
    expect((configuredAt.getSql as (alias: string) => string)("column")).toBe(
      "(column IS NULL)",
    );
  });

  test("never marks the resource configured", async () => {
    const harness: Harness = setUp();

    await register({ posture: { allowWrites: true } });

    expect(defaultsWrite(harness).data).not.toHaveProperty(
      "aiAccessConfiguredAt",
    );
  });

  test("a read-only agent never turns fixes on", async () => {
    const harness: Harness = setUp();

    await register({ posture: { allowWrites: false } });

    expect(defaultsWrite(harness).data).not.toHaveProperty("aiRemediationMode");
  });

  test.each([
    ResourceAiRemediationMode.RequireApproval,
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ])(
    "a mode already on the resource (%s) is never changed",
    async (mode: ResourceAiRemediationMode) => {
      const harness: Harness = setUp({
        resource: makeResourceRow({
          isAiInvestigationEnabled: true,
          aiRemediationMode: mode,
        }),
      });

      await register({ posture: { allowWrites: true } });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
    },
  );

  test("an unknown stored mode reads as Off", async () => {
    const harness: Harness = setUp({
      resource: makeResourceRow({ aiRemediationMode: "Sometimes" }),
    });

    await register({ posture: { allowWrites: true } });

    expect(defaultsWrite(harness).data["aiRemediationMode"]).toBe(
      ResourceAiRemediationMode.RequireApproval,
    );
  });

  test("nothing is written when nothing needs changing", async () => {
    const harness: Harness = setUp({
      resource: makeResourceRow({ isAiInvestigationEnabled: true }),
    });

    await register();

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
  });

  test("a resource someone configured is left exactly as chosen — investigation off and fixes Off included", async () => {
    const harness: Harness = setUp({
      resource: makeResourceRow({
        aiAccessConfiguredAt: msAgo(60 * 1000),
        isAiInvestigationEnabled: false,
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
      }),
    });

    await register({ posture: { allowWrites: true } });

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
    expect(harness.resourceUpdateOneById.mock.calls).toHaveLength(0);
  });

  test("they apply on a re-key too, with a feed item saying what changed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      resource: makeResourceRow({ isAiInvestigationEnabled: true }),
    });

    await register({
      posture: { allowWrites: true, writeTargets: ["web-*", "api"] },
    });

    expect(defaultsWrite(harness).data).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    expect(harness.feed.mock.calls).toHaveLength(1);

    const item: AnyObject = harness.feed.mock.calls[0]![0] as AnyObject;
    expect(String(item["feedInfoInMarkdown"])).toContain("Ask for approval");
    expect(String(item["feedInfoInMarkdown"])).toContain("to web-*, api");
  });

  test("when an operator configured the resource a moment earlier, the conditional update lands nowhere and nothing is claimed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
      resourceUpdateCount: 0,
    });

    await register();

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("they never apply to a refused registration", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });

    await refusalOf(register({ posture: { allowWrites: true } }));

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
  });
});

/*
 * The key's hash is written before the defaults. If a failed defaults write
 * failed the registration, the agent would never receive the key its row
 * now demands, and — the row reading online — every retry would be refused
 * as previous_instance_online until the alive window lapsed.
 */
describe("register: when applying the defaults fails", () => {
  function failTheDefaults(harness: Harness): void {
    (
      harness.resourceUpdateOneBy as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));
  }

  test("a new agent still gets its key, and the row stores that key's hash", async () => {
    const harness: Harness = setUp();
    failTheDefaults(harness);

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
    expect(result.admission).toBe("created");
    expect(createdRow(harness).keyHash).toBe(
      ResourceAiAgentServiceClass.hashKey(result.agentKey),
    );
  });

  test("a re-key still hands out its key, and the next registration with it proves continuity while the row reads online", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });
    failTheDefaults(harness);

    const result: ResourceAiAgentRegistrationResult = await register();

    const storedHash: unknown = reKeyWrite(harness).data["keyHash"];
    expect(storedHash).toBe(
      ResourceAiAgentServiceClass.hashKey(result.agentKey),
    );

    const rowAfter: ResourceAiAgent = makeAgent({
      keyHash: storedHash,
      connectionStatus: "connected",
      lastAliveAt: new Date(),
    });
    expect(ResourceAiAgentService.isOnline(rowAfter)).toBe(true);
    expect(
      ResourceAiAgentService.getReRegistrationAdmission({
        agent: rowAfter,
        previousAgentKey: result.agentKey,
      }),
    ).toBe("continuity");
  });

  test("the connected feed item says only what is true: investigation stayed off, and fixes were not changed", async () => {
    const harness: Harness = setUp();
    failTheDefaults(harness);

    await register({ posture: { allowWrites: true } });

    expect(harness.feed.mock.calls).toHaveLength(1);
    const text: string = String(
      (harness.feed.mock.calls[0]![0] as AnyObject)["feedInfoInMarkdown"],
    );
    expect(text).toContain("The Docker AI agent connected");
    expect(text).toContain("Investigating through the agent is off");
    expect(text).not.toContain("Ask for approval");
  });

  test("a re-key writes no defaults feed item", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });
    failTheDefaults(harness);

    await register({ posture: { allowWrites: true } });

    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("the failure is logged, naming the resource", async () => {
    const harness: Harness = setUp();
    failTheDefaults(harness);

    await register();

    const logged: string = JSON.stringify(
      (logger.error as unknown as SpyCalls).mock.calls,
    );
    expect(logged).toContain("first-connection defaults");
    expect(logged).toContain(RESOURCE_ID.toString());
    expect(logged).toContain("database is down");
  });

  test("a failure before the key is stored still fails the registration", async () => {
    const harness: Harness = setUp({
      existing: makeAgent({ connectionStatus: "disconnected" }),
    });
    (
      harness.agentUpdateOneById as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(register()).rejects.toThrow("database is down");
    expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
  });
});

describe("register: the resource's feed", () => {
  function feedItem(harness: Harness): AnyObject {
    expect(harness.feed.mock.calls).toHaveLength(1);
    return harness.feed.mock.calls[0]![0] as AnyObject;
  }

  test("one item marks the first connection of a resource's agent", async () => {
    const harness: Harness = setUp();

    await register();

    const item: AnyObject = feedItem(harness);
    expect(String(item["dockerHostId"])).toBe(RESOURCE_ID.toString());
    expect(item["projectId"]).toBe(PROJECT_ID);
    expect(item["dockerHostFeedEventType"]).toBe("DockerHostUpdated");
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "The Docker AI agent connected (read-only).",
    );
    expect(String(item["feedInfoInMarkdown"])).toContain(
      "AI can now use it to investigate this Docker host.",
    );

    const more: string = String(item["moreInformationInMarkdown"]);
    expect(more).toContain(AGENT_ID.toString());
    expect(more).toContain("`web-1`");
    expect(more).toContain("27.3.1");
    expect(more).toContain("**Reachable**: yes");
  });

  test("says where a writing agent may change things", async () => {
    const scoped: Harness = setUp();
    await register({
      posture: { allowWrites: true, writeTargets: ["web-*", "api"] },
    });
    expect(String(feedItem(scoped)["feedInfoInMarkdown"])).toContain(
      "(can make changes to web-*, api)",
    );
    jest.restoreAllMocks();

    const anywhere: Harness = setUp();
    await register({ posture: { allowWrites: true, writeTargets: [] } });
    expect(String(feedItem(anywhere)["feedInfoInMarkdown"])).toContain(
      "(can make changes to anything but its protected targets)",
    );
  });

  test("says fixes were set to Ask for approval, naming the agent's switch, when the defaults did that", async () => {
    const harness: Harness = setUp();

    await register({ posture: { allowWrites: true } });

    const text: string = String(feedItem(harness)["feedInfoInMarkdown"]);
    expect(text).toContain('"Ask for approval"');
    expect(text).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });

  test("reports an unreachable resource with the agent's reason", async () => {
    const harness: Harness = setUp();

    await register({
      posture: {
        reachable: false,
        reachError: "Cannot connect to the Docker daemon",
      },
    });

    expect(String(feedItem(harness)["moreInformationInMarkdown"])).toContain(
      "**Reachable**: no (Cannot connect to the Docker daemon)",
    );
  });

  test("on a resource where an operator turned investigation off, says so rather than promising investigations", async () => {
    const harness: Harness = setUp({
      resource: makeResourceRow({
        aiAccessConfiguredAt: msAgo(60 * 1000),
        isAiInvestigationEnabled: false,
      }),
    });

    await register();

    const text: string = String(feedItem(harness)["feedInfoInMarkdown"]);
    expect(text).toContain("Investigating through the agent is off");
    expect(text).not.toContain("AI can now use it");
  });

  test("never carries the agent key", async () => {
    const harness: Harness = setUp();

    const result: ResourceAiAgentRegistrationResult = await register();

    expect(JSON.stringify(harness.feed.mock.calls)).not.toContain(
      result.agentKey,
    );
  });
});

describe("getReRegistrationAdmission", () => {
  const NOW: Date = new Date("2026-09-28T10:00:00.000Z");
  const HASH: string = ResourceAiAgentServiceClass.hashKey(CURRENT_KEY);

  function admission(
    agent: AnyObject,
    previousAgentKey?: string,
  ): string | null {
    return ResourceAiAgentService.getReRegistrationAdmission({
      agent: agent as never,
      previousAgentKey,
      now: NOW,
    });
  }

  const ONLINE: AnyObject = {
    keyHash: HASH,
    connectionStatus: "connected",
    lastAliveAt: new Date(NOW.getTime() - 30 * 1000),
  };

  test("reset beats everything", () => {
    expect(admission({ ...ONLINE, keyHash: null })).toBe("reset");
    expect(admission({ ...ONLINE, keyHash: "" })).toBe("reset");
    expect(admission({ ...ONLINE, keyHash: undefined })).toBe("reset");
  });

  test("continuity needs the current key itself", () => {
    expect(admission(ONLINE, CURRENT_KEY)).toBe("continuity");
    expect(admission(ONLINE, "cd".repeat(32))).toBeNull();
    expect(admission(ONLINE, HASH)).toBeNull();
    expect(admission(ONLINE, "")).toBeNull();
  });

  test("signed off, then offline, then refused", () => {
    expect(admission({ ...ONLINE, connectionStatus: "disconnected" })).toBe(
      "signed_off",
    );
    expect(
      admission({
        ...ONLINE,
        lastAliveAt: new Date(NOW.getTime() - ALIVE_WINDOW_MS - 1000),
      }),
    ).toBe("offline");
    expect(admission({ ...ONLINE, lastAliveAt: null })).toBe("offline");
    expect(admission(ONLINE)).toBeNull();
  });
});

describe("getFirstConnectionDefaults", () => {
  function defaults(resource: AnyObject, allowWrites: boolean): AnyObject {
    return ResourceAiAgentService.getFirstConnectionDefaults({
      resource: resource as never,
      allowWrites,
    }) as unknown as AnyObject;
  }

  test("configured resources get nothing", () => {
    expect(
      defaults(
        {
          aiAccessConfiguredAt: new Date(),
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        },
        true,
      ),
    ).toEqual({ turnedOnInvestigation: false });
  });

  test("unconfigured: investigation on when it is not, fixes Ask for approval only with writes and only from Off", () => {
    expect(defaults({ isAiInvestigationEnabled: false }, false)).toEqual({
      turnedOnInvestigation: true,
    });
    expect(defaults({}, false)).toEqual({ turnedOnInvestigation: true });
    expect(defaults({ isAiInvestigationEnabled: true }, false)).toEqual({
      turnedOnInvestigation: false,
    });
    expect(
      defaults(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        },
        true,
      ),
    ).toEqual({
      turnedOnInvestigation: false,
      remediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    expect(
      defaults(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        },
        true,
      ),
    ).toEqual({ turnedOnInvestigation: false });
  });

  test("didApplyDefaults is true only when something changes", () => {
    expect(
      ResourceAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: false,
      }),
    ).toBe(false);
    expect(
      ResourceAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: true,
      }),
    ).toBe(true);
    expect(
      ResourceAiAgentServiceClass.didApplyDefaults({
        turnedOnInvestigation: false,
        remediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
    ).toBe(true);
  });
});

describe("wording helpers", () => {
  test("describeWriteAccess", () => {
    expect(
      ResourceAiAgentServiceClass.describeWriteAccess({
        allowWrites: false,
        writeTargets: ["web"],
      }),
    ).toBe("read-only");
    expect(
      ResourceAiAgentServiceClass.describeWriteAccess({
        allowWrites: true,
        writeTargets: ["web"],
      }),
    ).toBe("can make changes to web");
    expect(
      ResourceAiAgentServiceClass.describeWriteAccess({
        allowWrites: true,
        writeTargets: [],
      }),
    ).toBe("can make changes to anything but its protected targets");
  });

  test("normalizeAgentVersion", () => {
    expect(ResourceAiAgentServiceClass.normalizeAgentVersion(" 1.2 ")).toBe(
      "1.2",
    );
    expect(
      ResourceAiAgentServiceClass.normalizeAgentVersion("   "),
    ).toBeUndefined();
    expect(
      ResourceAiAgentServiceClass.normalizeAgentVersion(12),
    ).toBeUndefined();
    expect(
      ResourceAiAgentServiceClass.normalizeAgentVersion("x".repeat(101)),
    ).toHaveLength(ColumnLength.ShortText);
  });
});

describe("ResourceAiAgentRegistrationRefusedException", () => {
  test("is a 403 carrying the reason and, when given, when to retry", () => {
    const reasons: Array<ResourceAiAgentRegistrationRefusalReason> = [
      "resource_type_invalid",
      "resource_identifier_invalid",
      "resource_not_found",
      "previous_instance_online",
      "agent_cap_reached",
    ];

    for (const reason of reasons) {
      const refusal: ResourceAiAgentRegistrationRefusedException =
        new ResourceAiAgentRegistrationRefusedException({
          reason,
          message: "m",
          ...(isTransientResourceAiAgentRegistrationRefusal(reason)
            ? { retryAfterSeconds: 20 }
            : {}),
        });

      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.code).toBe(403);
      expect(refusal.reason).toBe(reason);
      expect(refusal.message).toBe("m");
      expect(refusal.retryAfterSeconds).toBe(
        isTransientResourceAiAgentRegistrationRefusal(reason) ? 20 : undefined,
      );
    }
  });
});
