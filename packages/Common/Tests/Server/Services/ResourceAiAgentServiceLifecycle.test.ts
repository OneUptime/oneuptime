import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import CephClusterFeedService from "../../../Server/Services/CephClusterFeedService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../Server/Services/DockerSwarmClusterFeedService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import ProxmoxClusterFeedService from "../../../Server/Services/ProxmoxClusterFeedService";
import ResourceAiAgentService, {
  RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS,
  RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
  Service as ResourceAiAgentServiceClass,
} from "../../../Server/Services/ResourceAiAgentService";
import UserService from "../../../Server/Services/UserService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import logger from "../../../Server/Utils/Logger";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The resource AI agent after registration:
 *
 *  - authenticate: every later request carries the agent id and key; the
 *    key's sha256 must match the row (timing-safe). Wrong key, reset row
 *    (null hash), unknown id and malformed input are all null, and the row
 *    handed back never carries the hash;
 *  - heartbeat: alive + connected, the posture stored with the resource
 *    type and the registered identity forced; "Ask for approval" once the
 *    agent's write access appears on a resource nobody configured; and, at
 *    most every few minutes, a check that the resource still exists — an
 *    agent whose resource is gone is retired and told to register again;
 *  - markDisconnected: the sign-off, which admits a replacement at once;
 *  - resetAgent: the admin's reset — no key works any more, the row reads
 *    disconnected, and the resource's feed says so;
 *  - deleteAgentsForResources: what a resource's delete path calls.
 *
 * No database: everything below the service boundary is stubbed.
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
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const AGENT_KEY: string = "ab".repeat(32);

function msAgo(ms: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - ms);
}

function makeAgent(overrides: AnyObject = {}): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  agent.id = AGENT_ID;
  agent.projectId = PROJECT_ID;
  agent.resourceType = AiResourceType.DockerHost;
  agent.resourceId = RESOURCE_ID;
  agent.resourceIdentifier = "web-1";
  agent.keyHash = ResourceAiAgentServiceClass.hashKey(AGENT_KEY);
  agent.connectionStatus = "connected";
  agent.lastAliveAt = msAgo(20 * 1000);
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

function makeResource(overrides: AnyObject = {}): DockerHost {
  const host: DockerHost = new DockerHost();
  host._id = RESOURCE_ID.toString();
  host.projectId = PROJECT_ID;
  host.name = "web-1";
  host.isAiInvestigationEnabled = true;
  host.aiRemediationMode = ResourceAiRemediationMode.Disabled;
  Object.assign(host, overrides);
  return host;
}

beforeEach(() => {
  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("authenticate", () => {
  let findOneBy: SpyCalls;

  function stubRow(row: ResourceAiAgent | null): void {
    findOneBy = jest
      .spyOn(ResourceAiAgentService, "findOneBy")
      .mockResolvedValue(row) as unknown as SpyCalls;
  }

  test("the right key returns the row, read by id as root with the hash selected, and hands it back without the hash", async () => {
    stubRow(makeAgent());

    const agent: ResourceAiAgent | null =
      await ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      });

    expect(agent).not.toBeNull();
    expect(agent!.id!.toString()).toBe(AGENT_ID.toString());
    expect(agent!.keyHash).toBeUndefined();
    expect(Object.keys(agent!)).not.toContain("keyHash");

    const read: AnyObject = findOneBy.mock.calls[0]![0] as AnyObject;

    expect(read["query"]).toEqual({ _id: AGENT_ID.toString() });
    expect(read["select"]).toEqual({
      ...RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
      keyHash: true,
    });
    expect(read["props"]["isRoot"]).toBe(true);
  });

  test("accepts the id as an ObjectID too", async () => {
    stubRow(makeAgent());

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID,
        agentKey: AGENT_KEY,
      }),
    ).resolves.not.toBeNull();
  });

  test("a wrong key is null", async () => {
    stubRow(makeAgent());

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: "cd".repeat(32),
      }),
    ).resolves.toBeNull();
  });

  test("the stored hash presented as the key is null", async () => {
    stubRow(makeAgent());

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: ResourceAiAgentServiceClass.hashKey(AGENT_KEY),
      }),
    ).resolves.toBeNull();
  });

  test("a reset row (no hash) is null, even for the key it used to have", async () => {
    stubRow(makeAgent({ keyHash: null }));

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();
  });

  test("an unknown id is null, and costs the same hash comparison as a wrong key", async () => {
    stubRow(null);
    const compare: SpyCalls = jest.spyOn(
      ResourceAiAgentServiceClass,
      "doesKeyMatchHash",
    ) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();

    expect(compare.mock.calls).toHaveLength(1);
    expect(compare.mock.calls[0]![0]).toBe(AGENT_KEY);
    expect(String(compare.mock.calls[0]![1])).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ["an empty id", "", AGENT_KEY],
    ["an id that is not a UUID", "agent-1", AGENT_KEY],
    ["a SQL-ish id", "' OR 1=1 --", AGENT_KEY],
    ["an empty key", AGENT_ID.toString(), ""],
    ["a non-string key", AGENT_ID.toString(), 42],
  ])(
    "%s is null without touching the database",
    async (_label: string, agentId: string, agentKey: unknown) => {
      stubRow(makeAgent());

      await expect(
        ResourceAiAgentService.authenticate({
          agentId,
          agentKey: agentKey as string,
        }),
      ).resolves.toBeNull();

      expect(findOneBy.mock.calls).toHaveLength(0);
    },
  );
});

describe("heartbeat", () => {
  /*
   * A fresh service per test: the resource check is throttled per agent in
   * the process, and each test starts with no check done.
   */
  let service: ResourceAiAgentServiceClass;

  interface HeartbeatHarness {
    resourceFindOneBy: SpyCalls;
    resourceUpdateOneBy: SpyCalls;
    agentUpdateColumns: SpyCalls;
    agentDeleteOneBy: SpyCalls;
    feed: SpyCalls;
  }

  function setUp(
    options: { resource?: DockerHost | null; updateCount?: number } = {},
  ): HeartbeatHarness {
    service = new ResourceAiAgentServiceClass();

    return {
      resourceFindOneBy: jest
        .spyOn(DockerHostService, "findOneBy")
        .mockResolvedValue(
          options.resource === undefined ? makeResource() : options.resource,
        ) as unknown as SpyCalls,
      resourceUpdateOneBy: jest
        .spyOn(DockerHostService, "updateOneBy")
        .mockResolvedValue(options.updateCount ?? 1) as unknown as SpyCalls,
      agentUpdateColumns: jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      agentDeleteOneBy: jest
        .spyOn(service, "deleteOneBy")
        .mockResolvedValue(1) as unknown as SpyCalls,
      feed: jest
        .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
    };
  }

  function written(harness: HeartbeatHarness): {
    id: ObjectID;
    data: AnyObject;
  } {
    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);
    return harness.agentUpdateColumns.mock.calls[0]![0] as {
      id: ObjectID;
      data: AnyObject;
    };
  }

  // The first heartbeat a process sees for an agent checks its resource.
  async function firstHeartbeat(now: Date = new Date()): Promise<void> {
    await service.heartbeat({ agent: makeAgent(), now });
  }

  test("marks the agent alive and connected in one hook-free write", async () => {
    const harness: HeartbeatHarness = setUp();
    const before: number = Date.now();

    await service.heartbeat({ agent: makeAgent() });

    const write: { id: ObjectID; data: AnyObject } = written(harness);
    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data["connectionStatus"]).toBe("connected");
    expect(
      (write.data["lastAliveAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(harness.agentDeleteOneBy.mock.calls).toHaveLength(0);
  });

  test("the first heartbeat in a process checks that the resource exists: its own row, in its project, as root", async () => {
    const harness: HeartbeatHarness = setUp();

    await firstHeartbeat();

    expect(harness.resourceFindOneBy.mock.calls).toHaveLength(1);
    const read: AnyObject = harness.resourceFindOneBy.mock
      .calls[0]![0] as AnyObject;
    expect(read["query"]).toEqual({
      _id: RESOURCE_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  // Every 30 seconds per resource: the common case must not read anything.
  test.each([
    ["without a posture", undefined],
    ["with an unchanged read-only posture", { allowWrites: false }],
    ["with writes it already had", { allowWrites: true }],
  ])(
    "a normal heartbeat (%s) within the check interval reads no resource row",
    async (_label: string, posture: unknown) => {
      const harness: HeartbeatHarness = setUp();
      const now: Date = new Date();
      await firstHeartbeat(now);

      const agent: ResourceAiAgent = makeAgent();
      if (posture && (posture as JSONObject)["allowWrites"] === true) {
        (agent.posture as JSONObject)["allowWrites"] = true;
      }

      await service.heartbeat({
        agent,
        posture,
        now: new Date(now.getTime() + 30 * 1000),
      });

      expect(harness.resourceFindOneBy.mock.calls).toHaveLength(1);
      expect(harness.agentUpdateColumns.mock.calls).toHaveLength(2);
    },
  );

  test("the resource is checked again once the interval has passed", async () => {
    const harness: HeartbeatHarness = setUp();
    const now: Date = new Date();

    await firstHeartbeat(now);
    await firstHeartbeat(
      new Date(
        now.getTime() + RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS - 1,
      ),
    );
    expect(harness.resourceFindOneBy.mock.calls).toHaveLength(1);

    await firstHeartbeat(
      new Date(now.getTime() + RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS),
    );
    expect(harness.resourceFindOneBy.mock.calls).toHaveLength(2);
  });

  test("the check is per agent", async () => {
    const harness: HeartbeatHarness = setUp();
    const now: Date = new Date();

    await firstHeartbeat(now);
    await service.heartbeat({
      agent: makeAgent({
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
      }),
      now,
    });

    expect(harness.resourceFindOneBy.mock.calls).toHaveLength(2);
  });

  describe("an agent whose resource is gone", () => {
    test("is retired: its row is deleted (by id, in its project, as root), nothing is marked alive, and the heartbeat answers 401 so it registers again", async () => {
      const harness: HeartbeatHarness = setUp({ resource: null });

      const error: unknown = await service
        .heartbeat({ agent: makeAgent(), posture: { allowWrites: true } })
        .catch((e: unknown) => {
          return e;
        });

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect((error as NotAuthenticatedException).message).toContain(
        "Docker host no longer exists",
      );
      expect(harness.agentUpdateColumns.mock.calls).toHaveLength(0);
      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);

      expect(harness.agentDeleteOneBy.mock.calls).toHaveLength(1);
      const deleted: AnyObject = harness.agentDeleteOneBy.mock
        .calls[0]![0] as AnyObject;
      expect(deleted["query"]).toEqual({
        _id: AGENT_ID.toString(),
        projectId: PROJECT_ID,
      });
      expect(deleted["props"]).toEqual({ isRoot: true });
    });

    test("a row naming no resource type is treated the same way", async () => {
      const harness: HeartbeatHarness = setUp();

      await expect(
        service.heartbeat({
          agent: makeAgent({ resourceType: "KubernetesCluster" }),
        }),
      ).rejects.toBeInstanceOf(NotAuthenticatedException);

      expect(harness.resourceFindOneBy.mock.calls).toHaveLength(0);
      expect(harness.agentDeleteOneBy.mock.calls).toHaveLength(1);
    });

    test("a failed delete still answers 401 (the next check tries again)", async () => {
      const harness: HeartbeatHarness = setUp({ resource: null });
      (
        harness.agentDeleteOneBy as unknown as {
          mockRejectedValue: (error: Error) => void;
        }
      ).mockRejectedValue(new Error("database is down"));

      await expect(
        service.heartbeat({ agent: makeAgent() }),
      ).rejects.toBeInstanceOf(NotAuthenticatedException);
      expect(
        JSON.stringify((logger.error as unknown as SpyCalls).mock.calls),
      ).toContain("database is down");
    });
  });

  test("a failing resource check is not a gone resource: the heartbeat is stored and nothing is deleted", async () => {
    const harness: HeartbeatHarness = setUp();
    (
      harness.resourceFindOneBy as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await service.heartbeat({ agent: makeAgent() });

    expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);
    expect(harness.agentDeleteOneBy.mock.calls).toHaveLength(0);
  });

  test("stores the reported posture with the resource type and the registered identity forced", async () => {
    const harness: HeartbeatHarness = setUp();

    await service.heartbeat({
      agent: makeAgent(),
      agentVersion: "14.2.0",
      posture: {
        resourceType: AiResourceType.Host,
        resourceIdentifier: "someone-else",
        allowWrites: false,
        writeTargets: ["web-*"],
        protectedTargets: ["oneuptime-ai-agent"],
        reachable: true,
        toolVersion: "27.3.1",
      },
    });

    const write: { data: AnyObject } = written(harness);
    const posture: JSONObject = write.data["posture"] as JSONObject;
    expect(posture["resourceType"]).toBe(AiResourceType.DockerHost);
    expect(posture["resourceIdentifier"]).toBe("web-1");
    expect(posture["writeTargets"]).toEqual(["web-*"]);
    expect(posture["toolVersion"]).toBe("27.3.1");
    expect(Object.values(posture)).not.toContain(undefined);
    expect(write.data["agentVersion"]).toBe("14.2.0");
  });

  test("a row without its identity column falls back to the stored posture's identity", async () => {
    const harness: HeartbeatHarness = setUp();

    await service.heartbeat({
      agent: makeAgent({ resourceIdentifier: "  " }),
      posture: { allowWrites: false, resourceIdentifier: "evil" },
    });

    expect(
      (written(harness).data["posture"] as JSONObject)["resourceIdentifier"],
    ).toBe("web-1");
  });

  test("with neither, the reported identity is never trusted: the stored posture is kept", async () => {
    const harness: HeartbeatHarness = setUp();

    await service.heartbeat({
      agent: makeAgent({ resourceIdentifier: undefined, posture: undefined }),
      posture: { allowWrites: true, resourceIdentifier: "evil" },
    });

    expect(written(harness).data).not.toHaveProperty("posture");
  });

  test("an empty or missing version is not written, and a missing posture keeps the stored one", async () => {
    const harness: HeartbeatHarness = setUp();

    await service.heartbeat({ agent: makeAgent(), agentVersion: "  " });

    expect(written(harness).data).not.toHaveProperty("agentVersion");
    expect(written(harness).data).not.toHaveProperty("posture");
  });

  test.each([
    ["a string", "allowWrites=true"],
    ["an array", [{ allowWrites: true }]],
  ])(
    "a posture that is %s is not a posture",
    async (_label: string, posture: unknown) => {
      const harness: HeartbeatHarness = setUp();

      await service.heartbeat({ agent: makeAgent(), posture });

      expect(written(harness).data).not.toHaveProperty("posture");
    },
  );

  test("an agent without an id is a programming error", async () => {
    setUp();
    const agent: ResourceAiAgent = makeAgent();
    delete (agent as unknown as AnyObject)["_id"];

    await expect(service.heartbeat({ agent })).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  describe("write access appearing", () => {
    function defaultsData(harness: HeartbeatHarness): AnyObject {
      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
      return (harness.resourceUpdateOneBy.mock.calls[0]![0] as AnyObject)[
        "data"
      ] as AnyObject;
    }

    test("on a resource nobody configured with fixes Off: Ask for approval, and a feed item", async () => {
      const harness: HeartbeatHarness = setUp();

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true, writeTargets: ["web-*"] },
      });

      expect(defaultsData(harness)).toEqual({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      });
      expect(harness.feed.mock.calls).toHaveLength(1);
      const text: string = String(
        (harness.feed.mock.calls[0]![0] as AnyObject)["feedInfoInMarkdown"],
      );
      expect(text).toContain("can now make changes to web-*");
      expect(text).toContain('"Ask for approval"');
    });

    test("never on a resource someone configured", async () => {
      const harness: HeartbeatHarness = setUp({
        resource: makeResource({ aiAccessConfiguredAt: new Date() }),
      });

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    test("only when writes APPEAR: an agent that already had them changes nothing", async () => {
      const harness: HeartbeatHarness = setUp();
      const agent: ResourceAiAgent = makeAgent();
      (agent.posture as JSONObject)["allowWrites"] = true;

      await service.heartbeat({ agent, posture: { allowWrites: true } });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("an agent that stays read-only changes nothing", async () => {
      const harness: HeartbeatHarness = setUp({
        resource: makeResource({ isAiInvestigationEnabled: false }),
      });

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: false },
      });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("a heartbeat without a posture is not writes appearing", async () => {
      const harness: HeartbeatHarness = setUp();

      await service.heartbeat({ agent: makeAgent() });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
    });

    test("a stored posture that was never set counts as read-only before", async () => {
      const harness: HeartbeatHarness = setUp();

      await service.heartbeat({
        agent: makeAgent({ posture: undefined }),
        posture: { allowWrites: true },
      });

      expect(defaultsData(harness)["aiRemediationMode"]).toBe(
        ResourceAiRemediationMode.RequireApproval,
      );
    });

    test("the defaults are conditional on the resource still being unconfigured; a lost race writes no feed item", async () => {
      const harness: HeartbeatHarness = setUp({ updateCount: 0 });

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      const query: AnyObject = (
        harness.resourceUpdateOneBy.mock.calls[0]![0] as AnyObject
      )["query"] as AnyObject;
      expect(query["aiAccessConfiguredAt"]).toBeInstanceOf(FindOperator);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    test("the resource row is read once, even when the periodic check read it too", async () => {
      const harness: HeartbeatHarness = setUp();

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
      });

      expect(harness.resourceFindOneBy.mock.calls).toHaveLength(1);
    });

    test("between checks, the defaults read the resource after the liveness write", async () => {
      const harness: HeartbeatHarness = setUp();
      const now: Date = new Date();
      await firstHeartbeat(now);

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
        now: new Date(now.getTime() + 30 * 1000),
      });

      expect(harness.resourceFindOneBy.mock.calls).toHaveLength(2);
      expect(harness.agentUpdateColumns.mock.calls).toHaveLength(2);
      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(1);
    });

    test("a resource row that vanished between checks changes nothing, and the heartbeat still succeeds", async () => {
      const harness: HeartbeatHarness = setUp();
      const now: Date = new Date();
      await firstHeartbeat(now);
      (
        harness.resourceFindOneBy as unknown as {
          mockResolvedValue: (value: unknown) => void;
        }
      ).mockResolvedValue(null);

      await service.heartbeat({
        agent: makeAgent(),
        posture: { allowWrites: true },
        now: new Date(now.getTime() + 30 * 1000),
      });

      expect(harness.resourceUpdateOneBy.mock.calls).toHaveLength(0);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });

    test("a failure applying the defaults never fails the heartbeat, and no feed item claims a change", async () => {
      const harness: HeartbeatHarness = setUp();
      (
        harness.resourceUpdateOneBy as unknown as {
          mockRejectedValue: (error: Error) => void;
        }
      ).mockRejectedValue(new Error("database is down"));

      await expect(
        service.heartbeat({
          agent: makeAgent(),
          posture: { allowWrites: true },
        }),
      ).resolves.toBeUndefined();

      expect(harness.agentUpdateColumns.mock.calls).toHaveLength(1);
      expect(harness.feed.mock.calls).toHaveLength(0);
    });
  });
});

describe("markDisconnected", () => {
  test("writes only the disconnected status — lastAliveAt stays the truth about the last heartbeat", async () => {
    const update: SpyCalls = jest
      .spyOn(ResourceAiAgentService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined) as unknown as SpyCalls;

    await ResourceAiAgentService.markDisconnected({
      resourceAiAgentId: AGENT_ID,
    });

    expect(update.mock.calls[0]![0]).toEqual({
      id: AGENT_ID,
      data: { connectionStatus: "disconnected" },
    });
  });

  test("requires the agent id", async () => {
    await expect(
      ResourceAiAgentService.markDisconnected({
        resourceAiAgentId: undefined as unknown as ObjectID,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("a signed-off agent is offline and admits the next registration", () => {
    const signedOff: ResourceAiAgent = makeAgent({
      connectionStatus: "disconnected",
      lastAliveAt: msAgo(1000),
    });

    expect(ResourceAiAgentService.isOnline(signedOff)).toBe(false);
    expect(
      ResourceAiAgentService.getReRegistrationAdmission({ agent: signedOff }),
    ).toBe("signed_off");
  });
});

describe("resetAgent", () => {
  const USER_MARKDOWN: string = `[Jane Doe](https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/settings/users/${USER_ID.toString()})`;

  interface ResetHarness {
    find: SpyCalls;
    update: SpyCalls;
    feed: SpyCalls;
    userName: SpyCalls;
  }

  function setUp(row: ResourceAiAgent | null = makeAgent()): ResetHarness {
    return {
      find: jest
        .spyOn(ResourceAiAgentService, "findAgentForResource")
        .mockResolvedValue(row) as unknown as SpyCalls,
      update: jest
        .spyOn(ResourceAiAgentService, "updateOneById")
        .mockResolvedValue(undefined as never) as unknown as SpyCalls,
      feed: jest
        .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
        .mockResolvedValue(undefined) as unknown as SpyCalls,
      userName: jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue(USER_MARKDOWN) as unknown as SpyCalls,
    };
  }

  function reset(userId?: ObjectID): Promise<void> {
    return ResourceAiAgentService.resetAgent({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      ...(userId ? { userId } : {}),
    });
  }

  function feedText(harness: ResetHarness): string {
    expect(harness.feed.mock.calls).toHaveLength(1);
    return String(
      (harness.feed.mock.calls[0]![0] as AnyObject)["feedInfoInMarkdown"],
    );
  }

  test("clears the key hash and marks the agent disconnected, as root", async () => {
    const harness: ResetHarness = setUp();

    await reset(USER_ID);

    expect(harness.find.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });

    const write: { id: ObjectID; data: AnyObject; props: AnyObject } = harness
      .update.mock.calls[0]![0] as {
      id: ObjectID;
      data: AnyObject;
      props: AnyObject;
    };

    expect(write.id.toString()).toBe(AGENT_ID.toString());
    expect(write.data).toEqual({
      keyHash: null,
      connectionStatus: "disconnected",
    });
    expect(write.props["isRoot"]).toBe(true);
  });

  test("writes a feed item on the resource's feed, attributed to the user, that says who reset it and that it comes back on its own", async () => {
    const harness: ResetHarness = setUp();

    await reset(USER_ID);

    const item: AnyObject = harness.feed.mock.calls[0]![0] as AnyObject;
    expect(item["dockerHostId"]).toBe(RESOURCE_ID);
    expect(item["projectId"]).toBe(PROJECT_ID);
    expect(item["userId"]).toBe(USER_ID);
    expect(item["dockerHostFeedEventType"]).toBe("DockerHostUpdated");
    expect(feedText(harness)).toBe(
      `🔄 The Docker AI agent was reset by **${USER_MARKDOWN}**. It reconnects on its own within a few minutes.`,
    );
    expect(String(item["moreInformationInMarkdown"])).toContain(
      AGENT_ID.toString(),
    );
    expect(harness.userName.mock.calls).toEqual([
      [{ userId: USER_ID, projectId: PROJECT_ID }],
    ]);
  });

  test("without a user (a master admin), the feed item names nobody and carries no user", async () => {
    const harness: ResetHarness = setUp();

    await reset();

    expect(harness.userName.mock.calls).toHaveLength(0);
    expect(
      (harness.feed.mock.calls[0]![0] as AnyObject)["userId"],
    ).toBeUndefined();
    expect(feedText(harness)).toBe(
      "🔄 The Docker AI agent was reset. It reconnects on its own within a few minutes.",
    );
  });

  test("a user who cannot be named gets the plain wording, still attributed", async () => {
    const harness: ResetHarness = setUp();
    (
      harness.userName as unknown as {
        mockResolvedValue: (value: string) => void;
      }
    ).mockResolvedValue("");

    await reset(USER_ID);

    expect(feedText(harness)).toBe(
      "🔄 The Docker AI agent was reset. It reconnects on its own within a few minutes.",
    );
    expect((harness.feed.mock.calls[0]![0] as AnyObject)["userId"]).toBe(
      USER_ID,
    );
  });

  test("a failing name lookup never fails the reset", async () => {
    const harness: ResetHarness = setUp();
    (
      harness.userName as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database is down"));

    await expect(reset(USER_ID)).resolves.toBeUndefined();

    expect(harness.update.mock.calls).toHaveLength(1);
    expect(feedText(harness)).toBe(
      "🔄 The Docker AI agent was reset. It reconnects on its own within a few minutes.",
    );
  });

  test("a resource without an agent is a plain error, and nothing is written", async () => {
    const harness: ResetHarness = setUp(null);

    await expect(reset()).rejects.toThrow(
      "This Docker host has no Docker AI agent to reset.",
    );

    expect(harness.update.mock.calls).toHaveLength(0);
    expect(harness.feed.mock.calls).toHaveLength(0);
  });

  test("an unknown resource type is a plain error, and nothing is read", async () => {
    const harness: ResetHarness = setUp();

    await expect(
      ResourceAiAgentService.resetAgent({
        projectId: PROJECT_ID,
        resourceType: "KubernetesCluster" as AiResourceType,
        resourceId: RESOURCE_ID,
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(harness.find.mock.calls).toHaveLength(0);
  });

  test.each([
    [
      AiResourceType.PodmanHost,
      PodmanHostFeedService,
      "createPodmanHostFeedItem",
    ],
    [
      AiResourceType.DockerSwarmCluster,
      DockerSwarmClusterFeedService,
      "createDockerSwarmClusterFeedItem",
    ],
    [
      AiResourceType.ProxmoxCluster,
      ProxmoxClusterFeedService,
      "createProxmoxClusterFeedItem",
    ],
    [
      AiResourceType.VMwareVCenter,
      VMwareVCenterFeedService,
      "createVMwareVCenterFeedItem",
    ],
    [
      AiResourceType.CephCluster,
      CephClusterFeedService,
      "createCephClusterFeedItem",
    ],
    [
      AiResourceType.DatabaseServer,
      DatabaseServerFeedService,
      "createDatabaseServerFeedItem",
    ],
    [AiResourceType.Host, HostFeedService, "createHostFeedItem"],
  ])(
    "a %s's reset is told on its own feed, naming its agent",
    async (
      resourceType: AiResourceType,
      feedService: unknown,
      method: string,
    ) => {
      jest
        .spyOn(ResourceAiAgentService, "findAgentForResource")
        .mockResolvedValue(makeAgent({ resourceType }));
      jest
        .spyOn(ResourceAiAgentService, "updateOneById")
        .mockResolvedValue(undefined as never);
      const feed: SpyCalls = jest
        .spyOn(feedService as AnyObject, method)
        .mockResolvedValue(undefined as never) as unknown as SpyCalls;

      await ResourceAiAgentService.resetAgent({
        projectId: PROJECT_ID,
        resourceType,
        resourceId: RESOURCE_ID,
      });

      expect(feed.mock.calls).toHaveLength(1);
      expect(
        String((feed.mock.calls[0]![0] as AnyObject)["feedInfoInMarkdown"]),
      ).toContain(
        `The ${AI_RESOURCE_TYPE_INFO[resourceType].agentDisplayName} was reset`,
      );
    },
  );

  test("after a reset the old key no longer authenticates, and the next registration is admitted", async () => {
    const reset: ResourceAiAgent = makeAgent({
      keyHash: null,
      connectionStatus: "disconnected",
    });
    jest.spyOn(ResourceAiAgentService, "findOneBy").mockResolvedValue(reset);

    await expect(
      ResourceAiAgentService.authenticate({
        agentId: AGENT_ID.toString(),
        agentKey: AGENT_KEY,
      }),
    ).resolves.toBeNull();

    expect(
      ResourceAiAgentService.getReRegistrationAdmission({
        agent: reset,
        previousAgentKey: AGENT_KEY,
      }),
    ).toBe("reset");
  });
});

describe("deleteAgentsForResources", () => {
  test("removes the agents of the given resources of one type, as root", async () => {
    const deleteBy: SpyCalls = jest
      .spyOn(ResourceAiAgentService, "deleteBy")
      .mockResolvedValue(2) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.deleteAgentsForResources({
        resourceType: AiResourceType.CephCluster,
        resourceIds: [RESOURCE_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(2);

    const call: AnyObject = deleteBy.mock.calls[0]![0] as AnyObject;
    expect(call["query"]["resourceType"]).toBe(AiResourceType.CephCluster);
    expect(call["query"]["projectId"]).toBe(PROJECT_ID);
    expect(call["query"]["resourceId"]).toBeInstanceOf(FindOperator);
    expect(
      Object.values(
        (call["query"]["resourceId"] as FindOperator<unknown>)
          .objectLiteralParameters || {},
      ),
    ).toEqual([[RESOURCE_ID.toString()]]);
    expect(call["limit"]).toBe(LIMIT_MAX);
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("nothing to delete: no resources, or not a resource type", async () => {
    const deleteBy: SpyCalls = jest.spyOn(
      ResourceAiAgentService,
      "deleteBy",
    ) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.deleteAgentsForResources({
        resourceType: AiResourceType.Host,
        resourceIds: [],
      }),
    ).resolves.toBe(0);
    await expect(
      ResourceAiAgentService.deleteAgentsForResources({
        resourceType: "Nope" as AiResourceType,
        resourceIds: [RESOURCE_ID],
      }),
    ).resolves.toBe(0);

    expect(deleteBy.mock.calls).toHaveLength(0);
  });
});
