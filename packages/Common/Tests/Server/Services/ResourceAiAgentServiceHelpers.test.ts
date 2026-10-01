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
  MAX_DATABASE_AI_AGENT_IDENTIFIER_LENGTH,
  MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH,
  RESOURCE_AI_AGENT_RESOURCE_SELECT,
  RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
  ResourceAiAgentResource,
  ResourceAiAgentResourceBinding,
  Service as ResourceAiAgentServiceClass,
  describeResourceInSentence,
  getResourceAiAgentResourceBinding,
} from "../../../Server/Services/ResourceAiAgentService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import { Blue500 } from "../../../Types/BrandColors";
import ColumnLength from "../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  ResourceAiAgentConnectionStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import { FindOperator } from "typeorm";

/*
 * The shared helpers of the resource AI agent's identity:
 *
 *  - an agent key is 256 random bits, and only its sha256 is stored;
 *    matching a presented key against the stored hash is timing-safe and
 *    never matches a reset row (null hash) or garbage;
 *  - ONE online rule: connected AND heard from within the alive window;
 *  - the summary the dashboard sees never carries the key hash, and its
 *    posture is re-validated on the way out;
 *  - the reads other units use (findAgentForResource,
 *    findOnlineAgentForResource, findAgentsForResources, findResource) are
 *    scoped to the project, the resource type and the resource(s), run as
 *    root, and never select the key hash;
 *  - every AiResourceType is bound to its own model's service, its
 *    collector identity lookup and its own feed.
 *
 * Nothing below the service boundary runs: no database.
 */

// Spy handles are held through this rather than a SpiedFunction type.
interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

type AnyObject = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_A: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222221",
);
const RESOURCE_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const NOW: Date = new Date("2026-09-28T10:00:00.000Z");
const WINDOW_MS: number = RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000;

function msBeforeNow(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function agentRow(overrides: Partial<ResourceAiAgent> = {}): ResourceAiAgent {
  const row: ResourceAiAgent = new ResourceAiAgent();
  row.id = AGENT_ID;
  row.projectId = PROJECT_ID;
  row.resourceType = AiResourceType.DockerHost;
  row.resourceId = RESOURCE_A;
  row.resourceIdentifier = "web-1";
  row.connectionStatus = "connected";
  row.lastAliveAt = msBeforeNow(30 * 1000);
  row.agentVersion = "14.1.0";
  row.lastRegisteredAt = msBeforeNow(60 * 60 * 1000);
  row.posture = {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: ["oneuptime-ai-agent"],
    toolVersion: "27.3.1",
    reachable: true,
  };

  Object.assign(row, overrides);

  return row;
}

/*
 * One row per resource type: the singletons its binding must reach, and
 * how its feed item is spelled.
 */
interface TypeFixture {
  resourceType: AiResourceType;
  service: AnyObject;
  findOrCreateMethod: string | null;
  findOrCreateIdentityKey: string | null;
  feedService: AnyObject;
  feedMethod: string;
  feedIdKey: string;
  feedEventKey: string;
  feedEvent: string;
}

const TYPE_FIXTURES: Array<TypeFixture> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: DockerHostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: DockerHostFeedService as unknown as AnyObject,
    feedMethod: "createDockerHostFeedItem",
    feedIdKey: "dockerHostId",
    feedEventKey: "dockerHostFeedEventType",
    feedEvent: "DockerHostUpdated",
  },
  {
    resourceType: AiResourceType.PodmanHost,
    service: PodmanHostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: PodmanHostFeedService as unknown as AnyObject,
    feedMethod: "createPodmanHostFeedItem",
    feedIdKey: "podmanHostId",
    feedEventKey: "podmanHostFeedEventType",
    feedEvent: "PodmanHostUpdated",
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    service: DockerSwarmClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: DockerSwarmClusterFeedService as unknown as AnyObject,
    feedMethod: "createDockerSwarmClusterFeedItem",
    feedIdKey: "dockerSwarmClusterId",
    feedEventKey: "dockerSwarmClusterFeedEventType",
    feedEvent: "DockerSwarmClusterUpdated",
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    service: ProxmoxClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: ProxmoxClusterFeedService as unknown as AnyObject,
    feedMethod: "createProxmoxClusterFeedItem",
    feedIdKey: "proxmoxClusterId",
    feedEventKey: "proxmoxClusterFeedEventType",
    feedEvent: "ProxmoxClusterUpdated",
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    service: VMwareVCenterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: VMwareVCenterFeedService as unknown as AnyObject,
    feedMethod: "createVMwareVCenterFeedItem",
    feedIdKey: "vmwareVCenterId",
    feedEventKey: "vmwareVCenterFeedEventType",
    feedEvent: "VMwareVCenterUpdated",
  },
  {
    resourceType: AiResourceType.CephCluster,
    service: CephClusterService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByName",
    findOrCreateIdentityKey: "name",
    feedService: CephClusterFeedService as unknown as AnyObject,
    feedMethod: "createCephClusterFeedItem",
    feedIdKey: "cephClusterId",
    feedEventKey: "cephClusterFeedEventType",
    feedEvent: "CephClusterUpdated",
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: DatabaseServerService as unknown as AnyObject,
    findOrCreateMethod: null,
    findOrCreateIdentityKey: null,
    feedService: DatabaseServerFeedService as unknown as AnyObject,
    feedMethod: "createDatabaseServerFeedItem",
    feedIdKey: "databaseServerId",
    feedEventKey: "databaseServerFeedEventType",
    feedEvent: "DatabaseServerUpdated",
  },
  {
    resourceType: AiResourceType.Host,
    service: HostService as unknown as AnyObject,
    findOrCreateMethod: "findOrCreateByHostIdentifier",
    findOrCreateIdentityKey: "hostIdentifier",
    feedService: HostFeedService as unknown as AnyObject,
    feedMethod: "createHostFeedItem",
    feedIdKey: "hostId",
    feedEventKey: "hostFeedEventType",
    feedEvent: "HostUpdated",
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ResourceAiAgentService.hashKey", () => {
  test("is the sha256 hex of the key", () => {
    // FIPS 180-2 test vector.
    expect(ResourceAiAgentServiceClass.hashKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("is deterministic, lowercase hex of 64 characters, and differs per key", () => {
    const key: string = "a-key";

    expect(ResourceAiAgentServiceClass.hashKey(key)).toBe(
      ResourceAiAgentServiceClass.hashKey(key),
    );
    expect(ResourceAiAgentServiceClass.hashKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(ResourceAiAgentServiceClass.hashKey(key)).not.toBe(
      ResourceAiAgentServiceClass.hashKey("b-key"),
    );
  });

  test("the default export's instance form gives the same answer", () => {
    expect(ResourceAiAgentService.hashKey("abc")).toBe(
      ResourceAiAgentServiceClass.hashKey("abc"),
    );
  });
});

describe("ResourceAiAgentService.generateKey", () => {
  test("is 32 random bytes, hex encoded", () => {
    expect(ResourceAiAgentServiceClass.generateKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(ResourceAiAgentService.generateKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("draws from the cryptographic random source", () => {
    const randomBytes: SpyCalls = jest.spyOn(
      crypto,
      "randomBytes",
    ) as unknown as SpyCalls;

    ResourceAiAgentServiceClass.generateKey();

    expect(randomBytes.mock.calls[0]?.[0]).toBe(32);
  });

  test("never repeats", () => {
    const keys: Set<string> = new Set<string>();

    for (let i: number = 0; i < 200; i++) {
      keys.add(ResourceAiAgentServiceClass.generateKey());
    }

    expect(keys.size).toBe(200);
  });
});

describe("ResourceAiAgentService.doesKeyMatchHash", () => {
  const KEY: string = "0f".repeat(32);
  const HASH: string = ResourceAiAgentServiceClass.hashKey(KEY);

  test("matches the key the hash was made from, in either case", () => {
    expect(ResourceAiAgentServiceClass.doesKeyMatchHash(KEY, HASH)).toBe(true);
    expect(ResourceAiAgentService.doesKeyMatchHash(KEY, HASH)).toBe(true);
    expect(
      ResourceAiAgentServiceClass.doesKeyMatchHash(KEY, HASH.toUpperCase()),
    ).toBe(true);
  });

  test("does not match another key, or the hash itself presented as the key", () => {
    expect(
      ResourceAiAgentServiceClass.doesKeyMatchHash("1f".repeat(32), HASH),
    ).toBe(false);
    expect(ResourceAiAgentServiceClass.doesKeyMatchHash(HASH, HASH)).toBe(
      false,
    );
  });

  test("never matches a reset row (no hash)", () => {
    for (const hash of [null, undefined, ""]) {
      expect(ResourceAiAgentServiceClass.doesKeyMatchHash(KEY, hash)).toBe(
        false,
      );
    }
  });

  test("returns false, never throws, for a missing key or a malformed hash", () => {
    for (const key of [undefined, null, "", 42, {}, ["k"]]) {
      expect(ResourceAiAgentServiceClass.doesKeyMatchHash(key, HASH)).toBe(
        false,
      );
    }

    for (const hash of [
      HASH.slice(0, 63),
      `${HASH}0`,
      `${HASH.slice(0, 63)}g`,
      42,
      { hash: HASH },
    ]) {
      expect(() => {
        return ResourceAiAgentServiceClass.doesKeyMatchHash(KEY, hash);
      }).not.toThrow();
      expect(ResourceAiAgentServiceClass.doesKeyMatchHash(KEY, hash)).toBe(
        false,
      );
    }
  });

  test("compares in constant time", () => {
    const timingSafeEqual: SpyCalls = jest.spyOn(
      crypto,
      "timingSafeEqual",
    ) as unknown as SpyCalls;

    ResourceAiAgentServiceClass.doesKeyMatchHash("1f".repeat(32), HASH);

    expect(timingSafeEqual.mock.calls).toHaveLength(1);
  });
});

describe("ResourceAiAgentService.isOnline", () => {
  test("is online when connected and heard from within the alive window", () => {
    expect(
      ResourceAiAgentService.isOnline(
        { connectionStatus: "connected", lastAliveAt: msBeforeNow(1000) },
        NOW,
      ),
    ).toBe(true);
  });

  test("the window is inclusive at exactly five minutes and closed one millisecond later", () => {
    expect(RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES).toBe(5);
    expect(
      ResourceAiAgentService.isOnline(
        { connectionStatus: "connected", lastAliveAt: msBeforeNow(WINDOW_MS) },
        NOW,
      ),
    ).toBe(true);
    expect(
      ResourceAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: msBeforeNow(WINDOW_MS + 1),
        },
        NOW,
      ),
    ).toBe(false);
  });

  test("is offline when disconnected, whatever lastAliveAt says", () => {
    expect(
      ResourceAiAgentService.isOnline(
        { connectionStatus: "disconnected", lastAliveAt: NOW },
        NOW,
      ),
    ).toBe(false);
  });

  test("is offline for an unknown or missing status", () => {
    for (const status of [undefined, null, "", "Connected", "online"]) {
      expect(
        ResourceAiAgentService.isOnline(
          { connectionStatus: status, lastAliveAt: NOW },
          NOW,
        ),
      ).toBe(false);
    }
  });

  test("is offline when it was never heard from, or the timestamp is not a date", () => {
    for (const lastAliveAt of [undefined, null, "", "yesterday"]) {
      expect(
        ResourceAiAgentService.isOnline(
          { connectionStatus: "connected", lastAliveAt },
          NOW,
        ),
      ).toBe(false);
    }
  });

  test("accepts an ISO string as well as a Date", () => {
    expect(
      ResourceAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: msBeforeNow(2000).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("a heartbeat stamped slightly in the future still counts as recent", () => {
    expect(
      ResourceAiAgentService.isOnline(
        {
          connectionStatus: "connected",
          lastAliveAt: new Date(NOW.getTime() + 2000),
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("defaults to the current time", () => {
    expect(
      ResourceAiAgentService.isOnline({
        connectionStatus: "connected",
        lastAliveAt: new Date(),
      }),
    ).toBe(true);
    expect(
      ResourceAiAgentService.isOnline({
        connectionStatus: "connected",
        lastAliveAt: new Date(Date.now() - WINDOW_MS - 60 * 1000),
      }),
    ).toBe(false);
  });
});

describe("ResourceAiAgentService.getAgentSummary", () => {
  test("summarises a connected agent", () => {
    const summary: ResourceAiAgentSummary =
      ResourceAiAgentService.getAgentSummary(agentRow(), NOW);

    expect(summary).toEqual({
      agentId: AGENT_ID.toString(),
      connectionStatus: "connected",
      isOnline: true,
      agentVersion: "14.1.0",
      lastAliveAt: msBeforeNow(30 * 1000).toISOString(),
      lastRegisteredAt: msBeforeNow(60 * 60 * 1000).toISOString(),
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        agentVersion: null,
        allowWrites: false,
        allowWritesSetting: null,
        writeTargets: [],
        protectedTargets: ["oneuptime-ai-agent"],
        toolVersion: "27.3.1",
        reachable: true,
        reachError: null,
        details: {},
      },
      lastRefusedRegistrationAt: null,
      lastRefusedRegistrationReason: null,
    });
  });

  test("never carries the key hash, even when the row was loaded with it", () => {
    const row: ResourceAiAgent = agentRow({ keyHash: "ab".repeat(32) });

    const summary: ResourceAiAgentSummary =
      ResourceAiAgentService.getAgentSummary(row, NOW);

    expect(JSON.stringify(summary)).not.toContain("ab".repeat(32));
    expect(Object.keys(summary)).not.toContain("keyHash");
  });

  test("reports an agent whose heartbeat aged out as connected-but-offline", () => {
    const summary: ResourceAiAgentSummary =
      ResourceAiAgentService.getAgentSummary(
        agentRow({ lastAliveAt: msBeforeNow(WINDOW_MS + 1000) }),
        NOW,
      );

    expect(summary.connectionStatus).toBe("connected");
    expect(summary.isOnline).toBe(false);
  });

  test("normalises any status other than connected to disconnected", () => {
    for (const status of ["disconnected", "", "weird"]) {
      const summary: ResourceAiAgentSummary =
        ResourceAiAgentService.getAgentSummary(
          agentRow({
            connectionStatus: status as ResourceAiAgentConnectionStatus,
          }),
          NOW,
        );

      expect(summary.connectionStatus).toBe("disconnected");
      expect(summary.isOnline).toBe(false);
    }
  });

  test("re-validates the stored posture: a wrong-shaped one is dropped, and writes are never read from a non-boolean", () => {
    expect(
      ResourceAiAgentService.getAgentSummary(
        agentRow({ posture: { allowWrites: true } }),
        NOW,
      ).posture,
    ).toBeNull();

    const posture: ResourceAiAgentPosture | null | undefined =
      ResourceAiAgentService.getAgentSummary(
        agentRow({
          posture: {
            resourceType: AiResourceType.DockerHost,
            resourceIdentifier: "web-1",
            allowWrites: "true",
          },
        }),
        NOW,
      ).posture;

    expect(posture!.allowWrites).toBe(false);
  });

  test("has no posture when none was ever stored", () => {
    const row: ResourceAiAgent = agentRow();
    delete (row as unknown as AnyObject)["posture"];

    expect(ResourceAiAgentService.getAgentSummary(row, NOW).posture).toBeNull();
  });

  test("carries the last refused registration, for the dashboard's warning", () => {
    const summary: ResourceAiAgentSummary =
      ResourceAiAgentService.getAgentSummary(
        agentRow({
          lastRefusedRegistrationAt: msBeforeNow(10 * 1000),
          lastRefusedRegistrationReason: "previous_instance_online",
        }),
        NOW,
      );

    expect(summary.lastRefusedRegistrationAt).toBe(
      msBeforeNow(10 * 1000).toISOString(),
    );
    expect(summary.lastRefusedRegistrationReason).toBe(
      "previous_instance_online",
    );
  });

  test("never-set values are null rather than invented", () => {
    const row: ResourceAiAgent = new ResourceAiAgent();
    row.id = AGENT_ID;

    const summary: ResourceAiAgentSummary =
      ResourceAiAgentService.getAgentSummary(row, NOW);

    expect(summary).toEqual({
      agentId: AGENT_ID.toString(),
      connectionStatus: "disconnected",
      isOnline: false,
      agentVersion: null,
      lastAliveAt: null,
      lastRegisteredAt: null,
      posture: null,
      lastRefusedRegistrationAt: null,
      lastRefusedRegistrationReason: null,
    });
  });
});

describe("RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY", () => {
  test("selects every column of the row except the key hash", () => {
    const model: ResourceAiAgent = new ResourceAiAgent();
    const columns: Array<string> = model
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return !model.isEntityColumn(column);
      });

    const selected: Array<string> = Object.keys(
      RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
    );

    expect(selected).not.toContain("keyHash");

    for (const column of columns) {
      if (
        column === "keyHash" ||
        ["deletedAt", "version", "createdByUserId", "deletedByUserId"].includes(
          column,
        )
      ) {
        continue;
      }

      expect(selected).toContain(column);
    }

    for (const column of ["resourceType", "resourceId", "resourceIdentifier"]) {
      expect(selected).toContain(column);
    }
  });
});

describe("ResourceAiAgentService.findAgentForResource", () => {
  test("reads the resource's agent in its project by type and id, as root, without the key hash", async () => {
    const row: ResourceAiAgent = agentRow();
    const findOneBy: SpyCalls = jest
      .spyOn(ResourceAiAgentService, "findOneBy")
      .mockResolvedValue(row) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.findAgentForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.CephCluster,
        resourceId: RESOURCE_A,
      }),
    ).resolves.toBe(row);

    const call: AnyObject = findOneBy.mock.calls[0]![0] as AnyObject;

    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["query"]["resourceType"]).toBe(AiResourceType.CephCluster);
    expect(call["query"]["resourceId"].toString()).toBe(RESOURCE_A.toString());
    expect(call["select"]).toBe(RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY);
    expect(call["select"]["keyHash"]).toBeUndefined();
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test("is null when the resource has no agent", async () => {
    jest.spyOn(ResourceAiAgentService, "findOneBy").mockResolvedValue(null);

    await expect(
      ResourceAiAgentService.findAgentForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_B,
      }),
    ).resolves.toBeNull();
  });

  test("an unknown resource type reads nothing", async () => {
    const findOneBy: SpyCalls = jest.spyOn(
      ResourceAiAgentService,
      "findOneBy",
    ) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.findAgentForResource({
        projectId: PROJECT_ID,
        resourceType: "KubernetesCluster" as AiResourceType,
        resourceId: RESOURCE_A,
      }),
    ).resolves.toBeNull();
    expect(findOneBy.mock.calls).toHaveLength(0);
  });
});

describe("ResourceAiAgentService.findOnlineAgentForResource", () => {
  test("the agent when it is online", async () => {
    const row: ResourceAiAgent = agentRow();
    jest.spyOn(ResourceAiAgentService, "findOneBy").mockResolvedValue(row);

    await expect(
      ResourceAiAgentService.findOnlineAgentForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_A,
        now: NOW,
      }),
    ).resolves.toBe(row);
  });

  test.each([
    ["signed off", { connectionStatus: "disconnected" }],
    ["gone quiet", { lastAliveAt: msBeforeNow(WINDOW_MS + 1000) }],
    ["never heard from", { lastAliveAt: undefined }],
  ])(
    "null when the agent is %s",
    async (_label: string, overrides: AnyObject) => {
      jest
        .spyOn(ResourceAiAgentService, "findOneBy")
        .mockResolvedValue(agentRow(overrides as Partial<ResourceAiAgent>));

      await expect(
        ResourceAiAgentService.findOnlineAgentForResource({
          projectId: PROJECT_ID,
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_A,
          now: NOW,
        }),
      ).resolves.toBeNull();
    },
  );

  test("null when there is no agent", async () => {
    jest.spyOn(ResourceAiAgentService, "findOneBy").mockResolvedValue(null);

    await expect(
      ResourceAiAgentService.findOnlineAgentForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_A,
      }),
    ).resolves.toBeNull();
  });
});

describe("ResourceAiAgentService.findAgentsForResources", () => {
  test("asks nothing of the database for no resources", async () => {
    const findBy: SpyCalls = jest.spyOn(
      ResourceAiAgentService,
      "findBy",
    ) as unknown as SpyCalls;

    const result: Map<string, ResourceAiAgent> =
      await ResourceAiAgentService.findAgentsForResources({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.Host,
        resourceIds: [],
      });

    expect(result.size).toBe(0);
    expect(findBy.mock.calls).toHaveLength(0);
  });

  test("reads every resource's agent in one root query scoped to the project and type, keyed by resource id", async () => {
    const agentA: ResourceAiAgent = agentRow();
    const agentB: ResourceAiAgent = agentRow({ resourceId: RESOURCE_B });

    const findBy: SpyCalls = jest
      .spyOn(ResourceAiAgentService, "findBy")
      .mockResolvedValue([agentA, agentB]) as unknown as SpyCalls;

    const result: Map<string, ResourceAiAgent> =
      await ResourceAiAgentService.findAgentsForResources({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceIds: [RESOURCE_A, RESOURCE_B, RESOURCE_A],
      });

    expect(findBy.mock.calls).toHaveLength(1);

    const call: AnyObject = findBy.mock.calls[0]![0] as AnyObject;

    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["query"]["resourceType"]).toBe(AiResourceType.DockerHost);

    const filter: FindOperator<unknown> = call["query"][
      "resourceId"
    ] as FindOperator<unknown>;

    expect(filter).toBeInstanceOf(FindOperator);
    expect(Object.values(filter.objectLiteralParameters || {})).toEqual([
      [RESOURCE_A.toString(), RESOURCE_B.toString()],
    ]);
    expect(call["select"]).toBe(RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY);
    expect(call["limit"]).toBe(LIMIT_MAX);
    expect(call["skip"]).toBe(0);
    expect(call["props"]["isRoot"]).toBe(true);

    expect(result.size).toBe(2);
    expect(result.get(RESOURCE_A.toString())).toBe(agentA);
    expect(result.get(RESOURCE_B.toString())).toBe(agentB);
  });

  test("ignores rows of other resources or types, and rows without a resource", async () => {
    const stray: ResourceAiAgent = agentRow({
      resourceId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    });
    const otherType: ResourceAiAgent = agentRow({
      resourceType: AiResourceType.PodmanHost,
    });
    const noResource: ResourceAiAgent = agentRow();
    delete (noResource as unknown as AnyObject)["resourceId"];

    jest
      .spyOn(ResourceAiAgentService, "findBy")
      .mockResolvedValue([stray, otherType, noResource]);

    const result: Map<string, ResourceAiAgent> =
      await ResourceAiAgentService.findAgentsForResources({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceIds: [RESOURCE_A, RESOURCE_B],
      });

    expect(result.size).toBe(0);
  });
});

describe("the per-type resource bindings", () => {
  test("every resource type has one, bound to its own type", () => {
    expect(
      TYPE_FIXTURES.map((f: TypeFixture) => {
        return f.resourceType;
      }),
    ).toEqual([...ALL_AI_RESOURCE_TYPES]);

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const binding: ResourceAiAgentResourceBinding =
        getResourceAiAgentResourceBinding(type);

      expect(binding.resourceType).toBe(type);
      expect(
        ResourceAiAgentServiceClass.getResourceBinding(type).resourceType,
      ).toBe(type);
    }
  });

  test.each(TYPE_FIXTURES)(
    "$resourceType reads through its own model's service",
    (fixture: TypeFixture) => {
      expect(
        getResourceAiAgentResourceBinding(fixture.resourceType).getService(),
      ).toBe(fixture.service);
    },
  );

  test.each(
    TYPE_FIXTURES.filter((f: TypeFixture) => {
      return f.findOrCreateMethod !== null;
    }),
  )(
    "$resourceType finds or creates its row by the collector's identity ($findOrCreateMethod)",
    async (fixture: TypeFixture) => {
      const found: AnyObject = { _id: RESOURCE_A.toString() };
      const spy: SpyCalls = jest
        .spyOn(fixture.service, fixture.findOrCreateMethod!)
        .mockResolvedValue(found as never) as unknown as SpyCalls;

      const binding: ResourceAiAgentResourceBinding =
        getResourceAiAgentResourceBinding(fixture.resourceType);

      await expect(
        binding.findOrCreateByIdentity!({
          projectId: PROJECT_ID,
          identifier: "Prod-1",
        }),
      ).resolves.toBe(found);

      expect(spy.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        [fixture.findOrCreateIdentityKey!]: "Prod-1",
      });
    },
  );

  test("a database server is never found by name: it has no identity lookup", () => {
    expect(
      getResourceAiAgentResourceBinding(AiResourceType.DatabaseServer)
        .findOrCreateByIdentity,
    ).toBeNull();
  });

  test.each(TYPE_FIXTURES)(
    "$resourceType posts to its own feed as an update ($feedEvent)",
    async (fixture: TypeFixture) => {
      const spy: SpyCalls = jest
        .spyOn(fixture.feedService, fixture.feedMethod)
        .mockResolvedValue(undefined as never) as unknown as SpyCalls;

      await getResourceAiAgentResourceBinding(
        fixture.resourceType,
      ).writeFeedItem({
        resourceId: RESOURCE_A,
        projectId: PROJECT_ID,
        feedInfoInMarkdown: "hello",
        moreInformationInMarkdown: "more",
        displayColor: Blue500,
        userId: USER_ID,
      });

      expect(spy.mock.calls).toHaveLength(1);
      expect(spy.mock.calls[0]![0]).toEqual({
        [fixture.feedIdKey]: RESOURCE_A,
        projectId: PROJECT_ID,
        [fixture.feedEventKey]: fixture.feedEvent,
        feedInfoInMarkdown: "hello",
        moreInformationInMarkdown: "more",
        displayColor: Blue500,
        userId: USER_ID,
      });
    },
  );
});

describe("ResourceAiAgentService.findResource", () => {
  test.each(TYPE_FIXTURES)(
    "$resourceType: one row of its table, in the project, as root, with the AI columns",
    async (fixture: TypeFixture) => {
      const row: AnyObject = new (fixture.service[
        "modelType"
      ] as new () => AnyObject)();
      row["_id"] = RESOURCE_A.toString();
      row["projectId"] = PROJECT_ID;
      row["name"] = "  prod-1  ";
      row["isAiInvestigationEnabled"] = false;
      row["aiRemediationMode"] = "Disabled";

      const findOneBy: SpyCalls = jest
        .spyOn(fixture.service, "findOneBy")
        .mockResolvedValue(row as never) as unknown as SpyCalls;

      const resource: ResourceAiAgentResource | null =
        await ResourceAiAgentService.findResource({
          projectId: PROJECT_ID,
          resourceType: fixture.resourceType,
          resourceId: RESOURCE_A,
        });

      expect(resource).toEqual({
        resourceType: fixture.resourceType,
        id: RESOURCE_A,
        projectId: PROJECT_ID,
        name: "prod-1",
        isAiInvestigationEnabled: false,
        aiRemediationMode: "Disabled",
        aiAccessConfiguredAt: undefined,
      });

      const call: AnyObject = findOneBy.mock.calls[0]![0] as AnyObject;
      expect(call["query"]).toEqual({
        _id: RESOURCE_A.toString(),
        projectId: PROJECT_ID,
      });
      expect(call["select"]).toBe(RESOURCE_AI_AGENT_RESOURCE_SELECT);
      expect(call["props"]).toEqual({ isRoot: true });
    },
  );

  test("the select reads the identity and exactly the AI settings the defaults need", () => {
    expect(Object.keys(RESOURCE_AI_AGENT_RESOURCE_SELECT).sort()).toEqual(
      [
        "_id",
        "projectId",
        "name",
        "isAiInvestigationEnabled",
        "aiRemediationMode",
        "aiAccessConfiguredAt",
      ].sort(),
    );
  });

  test("null when the row is not there", async () => {
    jest.spyOn(DockerHostService, "findOneBy").mockResolvedValue(null);

    await expect(
      ResourceAiAgentService.findResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_A,
      }),
    ).resolves.toBeNull();
  });

  test("an unknown type reads nothing", async () => {
    await expect(
      ResourceAiAgentService.findResource({
        projectId: PROJECT_ID,
        resourceType: "KubernetesCluster" as AiResourceType,
        resourceId: RESOURCE_A,
      }),
    ).resolves.toBeNull();
  });
});

describe("identity helpers", () => {
  test("identities of name-keyed resources are bounded by the ShortText columns, databases by the posture", () => {
    expect(MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH).toBe(
      ColumnLength.ShortText,
    );
    expect(MAX_DATABASE_AI_AGENT_IDENTIFIER_LENGTH).toBe(
      MAX_POSTURE_STRING_LENGTH,
    );

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(ResourceAiAgentServiceClass.getMaxIdentifierLength(type)).toBe(
        type === AiResourceType.DatabaseServer
          ? MAX_POSTURE_STRING_LENGTH
          : ColumnLength.ShortText,
      );
    }
  });

  test("describeResourceInSentence keeps product names and lowercases common nouns", () => {
    expect(describeResourceInSentence(AiResourceType.DockerHost)).toBe(
      "Docker host",
    );
    expect(describeResourceInSentence(AiResourceType.VMwareVCenter)).toBe(
      "VMware vCenter",
    );
    expect(describeResourceInSentence(AiResourceType.Host)).toBe("host");
    expect(describeResourceInSentence(AiResourceType.DatabaseServer)).toBe(
      "database server",
    );
  });

  test("parseDatabaseEndpointIdentity reads '<system>|<address>' and nothing else", () => {
    expect(
      ResourceAiAgentServiceClass.parseDatabaseEndpointIdentity(
        "PostgreSQL|db.prod.example.com:5432",
      ),
    ).toEqual({
      system: "postgresql",
      address: "db.prod.example.com:5432",
      port: null,
    });
    expect(
      ResourceAiAgentServiceClass.parseDatabaseEndpointIdentity(
        "postgresql|[2001:db8::1]:5432",
      ),
    ).toEqual({
      system: "postgresql",
      address: "[2001:db8::1]:5432",
      port: null,
    });

    for (const value of [
      "db.prod.example.com",
      "|db.prod",
      "postgresql|",
      "postgresql| ",
      "a|b|c",
      "",
    ]) {
      expect(
        ResourceAiAgentServiceClass.parseDatabaseEndpointIdentity(value),
      ).toBeNull();
    }
  });

  test("readDatabaseEndpointFromPosture reads the agent's details, with a valid port only", () => {
    const posture: ResourceAiAgentPosture = {
      resourceType: AiResourceType.DatabaseServer,
      resourceIdentifier: "x",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      details: {
        databaseSystem: "MySQL",
        serverAddress: "db.prod.example.com",
        serverPort: 3306,
      },
    };

    expect(
      ResourceAiAgentServiceClass.readDatabaseEndpointFromPosture(posture),
    ).toEqual({ system: "mysql", address: "db.prod.example.com", port: 3306 });

    expect(
      ResourceAiAgentServiceClass.readDatabaseEndpointFromPosture({
        ...posture,
        details: { ...posture.details, serverPort: 70000 },
      })!.port,
    ).toBeNull();

    expect(
      ResourceAiAgentServiceClass.readDatabaseEndpointFromPosture({
        ...posture,
        details: { databaseSystem: "mysql" },
      }),
    ).toBeNull();
    expect(
      ResourceAiAgentServiceClass.readDatabaseEndpointFromPosture(null),
    ).toBeNull();
  });

  test("readPinnedDatabaseServerId: the resourceId, else an identity that is an id, else none", () => {
    expect(
      ResourceAiAgentServiceClass.readPinnedDatabaseServerId({
        resourceId: ` ${RESOURCE_A.toString().toUpperCase()} `,
        identifier: "postgresql|db:5432",
      }),
    ).toBe(RESOURCE_A.toString());
    expect(
      ResourceAiAgentServiceClass.readPinnedDatabaseServerId({
        resourceId: undefined,
        identifier: RESOURCE_B.toString().toUpperCase(),
      }),
    ).toBe(RESOURCE_B.toString());
    expect(
      ResourceAiAgentServiceClass.readPinnedDatabaseServerId({
        resourceId: "not-an-id",
        identifier: "postgresql|db:5432",
      }),
    ).toBe("not-an-id");
    expect(
      ResourceAiAgentServiceClass.readPinnedDatabaseServerId({
        resourceId: "",
        identifier: "postgresql|db:5432",
      }),
    ).toBeNull();
    expect(
      ResourceAiAgentServiceClass.readPinnedDatabaseServerId({
        resourceId: 42,
        identifier: "postgresql|db:5432",
      }),
    ).toBeNull();
  });
});
