import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ResourceAiAgentService, {
  ResourceAiAgentRegistrationResult,
  ResourceAiAgentSettingsApplied,
  Service as ResourceAiAgentServiceClass,
} from "../../../Server/Services/ResourceAiAgentService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import logger from "../../../Server/Utils/Logger";
import { AgentAiSettings } from "../../../Types/AI/AgentAiSettings";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A resource AI agent (Docker, Podman, Swarm, Proxmox, vCenter, Ceph,
 * database server, host) reports what its .env lets OneUptime AI do
 * (ONEUPTIME_AI_INVESTIGATION, ONEUPTIME_AI_FIXES) in its posture's
 * aiSettings, on registration and on every heartbeat, and
 * ResourceAiAgentService writes them to the resource's
 * isAiInvestigationEnabled and aiRemediationMode — so OneUptime never
 * allows more than the agent does. The rules are the Kubernetes agent's:
 *
 *  - a configuration that names the settings decides, even over what an
 *    operator chose on the AI agent page;
 *  - the agent's defaults decide only on a resource nobody configured, in
 *    one statement conditional on it staying unconfigured;
 *  - an agent too old to report settings changes nothing here;
 *  - every change is a root write through the resource's own service that
 *    never marks it configured, is said on its feed, and never fails the
 *    registration or heartbeat that carried it.
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

const CURRENT_KEY: string = "ef".repeat(32);

const CONFIGURED_AUTOMATIC: AgentAiSettings = {
  investigation: true,
  fixes: "Automatic",
  isConfigured: true,
};

const CONFIGURED_READ_ONLY: AgentAiSettings = {
  investigation: false,
  fixes: "Disabled",
  isConfigured: true,
};

const DEFAULTS_ASK_FOR_APPROVAL: AgentAiSettings = {
  investigation: true,
  fixes: "RequireApproval",
  isConfigured: false,
};

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// A Docker host row as the service reads it.
function makeResource(overrides: AnyObject = {}): DockerHost {
  const host: DockerHost = new DockerHost();
  host._id = RESOURCE_ID.toString();
  host.projectId = PROJECT_ID;
  host.name = "web-1";
  host.isAiInvestigationEnabled = false;
  host.aiRemediationMode = ResourceAiRemediationMode.Disabled;
  Object.assign(host, overrides);
  return host;
}

// Each test's own agent id: the heartbeat's checks are remembered per id.
function makeAgent(overrides: AnyObject = {}): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  agent.id = ObjectID.generate();
  agent.projectId = PROJECT_ID;
  agent.resourceType = AiResourceType.DockerHost;
  agent.resourceId = RESOURCE_ID;
  agent.resourceIdentifier = "web-1";
  agent.keyHash = ResourceAiAgentServiceClass.hashKey(CURRENT_KEY);
  agent.connectionStatus = "connected";
  agent.lastAliveAt = msAgo(20 * 1000);
  agent.lastRegisteredAt = msAgo(60 * 60 * 1000);
  agent.agentVersion = "14.1.0";
  agent.posture = postureWith(undefined);
  Object.assign(agent, overrides);
  return agent;
}

function postureWith(
  aiSettings: AgentAiSettings | undefined,
  allowWrites: boolean = false,
): JSONObject {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    ...(aiSettings ? { aiSettings: { ...aiSettings } } : {}),
  } as unknown as JSONObject;
}

interface Harness {
  resourceFindOneBy: SpyCalls;
  resourceUpdateOneBy: SpyCalls;
  feed: SpyCalls;
}

interface HarnessOptions {
  resource?: DockerHost | null;
  existing?: ResourceAiAgent | null;
  updateCount?: number;
  updateError?: Error;
  // The service whose agent-table methods are stubbed (default: the singleton).
  service?: ResourceAiAgentServiceClass;
}

function setUp(options: HarnessOptions = {}): Harness {
  const service: ResourceAiAgentServiceClass =
    options.service || ResourceAiAgentService;
  const resource: DockerHost | null =
    options.resource === undefined ? makeResource() : options.resource;

  const found: AnyObject = { _id: RESOURCE_ID.toString() };
  Object.defineProperty(found, "id", { value: RESOURCE_ID });

  jest
    .spyOn(DockerHostService, "findOrCreateByHostIdentifier")
    .mockResolvedValue(found as never);

  const resourceFindOneBy: SpyCalls = jest
    .spyOn(DockerHostService, "findOneBy")
    .mockResolvedValue(resource) as unknown as SpyCalls;

  const resourceUpdateOneBy: SpyCalls = (options.updateError
    ? jest
        .spyOn(DockerHostService, "updateOneBy")
        .mockRejectedValue(options.updateError)
    : jest
        .spyOn(DockerHostService, "updateOneBy")
        .mockResolvedValue(options.updateCount ?? 1)) as unknown as SpyCalls;

  const feed: SpyCalls = jest
    .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
    .mockResolvedValue(undefined) as unknown as SpyCalls;

  jest
    .spyOn(service, "findOneBy")
    .mockResolvedValue(
      options.existing === undefined ? null : options.existing,
    );
  jest.spyOn(service, "countBy").mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(service, "deleteBy").mockResolvedValue(0);
  jest
    .spyOn(service, "create")
    .mockImplementation(async (createBy: { data: ResourceAiAgent }) => {
      const created: ResourceAiAgent = createBy.data;
      created.id = ObjectID.generate();
      return created;
    });
  jest.spyOn(service, "updateOneById").mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  jest.spyOn(service, "deleteOneBy").mockResolvedValue(1);

  return { resourceFindOneBy, resourceUpdateOneBy, feed };
}

function register(
  aiSettings: unknown,
  overrides: Partial<{ allowWrites: boolean; previousAgentKey: string }> = {},
): Promise<ResourceAiAgentRegistrationResult> {
  return ResourceAiAgentService.register({
    projectId: PROJECT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    agentVersion: "14.2.0",
    ...(overrides.previousAgentKey
      ? { previousAgentKey: overrides.previousAgentKey }
      : {}),
    posture: {
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
      allowWrites: overrides.allowWrites === true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      ...(aiSettings === undefined ? {} : { aiSettings }),
    },
  });
}

interface ResourceWrite {
  query: AnyObject;
  data: AnyObject;
  props: AnyObject;
}

function resourceWrites(harness: Harness): Array<ResourceWrite> {
  return harness.resourceUpdateOneBy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ResourceWrite;
  });
}

function feedTexts(harness: Harness): Array<string> {
  return harness.feed.mock.calls.map((call: Array<unknown>) => {
    const item: AnyObject = call[0] as AnyObject;
    return `${String(item["feedInfoInMarkdown"])}\n${String(
      item["moreInformationInMarkdown"] || "",
    )}`;
  });
}

function loggedErrors(): string {
  return JSON.stringify(
    (logger.error as unknown as SpyCalls).mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    ),
  );
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

describe("register: the agent's configuration decides what AI may do", () => {
  test("writes the configured investigation and fixes to the resource, as root, through its own service", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    const writes: Array<ResourceWrite> = resourceWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
    });
    expect(writes[0]!.query["_id"]).toBe(RESOURCE_ID.toString());
    expect(writes[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(writes[0]!.query).not.toHaveProperty("aiAccessConfiguredAt");
    expect(writes[0]!.props["isRoot"]).toBe(true);
  });

  test("replaces what an operator chose on the AI agent page", async () => {
    const harness: Harness = setUp({
      resource: makeResource({
        aiAccessConfiguredAt: msAgo(24 * 60 * 60 * 1000),
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    });

    await register(CONFIGURED_READ_ONLY);

    expect(resourceWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
    });
  });

  test("never marks the resource configured", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    for (const write of resourceWrites(harness)) {
      expect(write.data).not.toHaveProperty("aiAccessConfiguredAt");
    }
  });

  test("the first-connection defaults never run after the agent decided", async () => {
    const harness: Harness = setUp({
      resource: makeResource({ isAiInvestigationEnabled: false }),
    });

    await register(CONFIGURED_READ_ONLY, { allowWrites: true });

    expect(resourceWrites(harness)).toHaveLength(0);
  });

  test("the first connection's feed item says what the configuration set, and the variables that change it", async () => {
    const harness: Harness = setUp();

    await register(CONFIGURED_AUTOMATIC);

    const texts: Array<string> = feedTexts(harness);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      "What AI may do here follows the agent's configuration: investigation on, fixes Automatic.",
    );
    expect(texts[0]).toContain("ONEUPTIME_AI_INVESTIGATION");
    expect(texts[0]).toContain("ONEUPTIME_AI_FIXES");
  });

  test("a re-registration that changes the settings says what moved, once", async () => {
    const harness: Harness = setUp({ existing: makeAgent() });

    await register(CONFIGURED_AUTOMATIC, { previousAgentKey: CURRENT_KEY });

    const texts: Array<string> = feedTexts(harness);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      "configuration changed what AI may do on this Docker host: investigation off → on; fixes Off → Automatic.",
    );
  });

  test("a report it cannot read fails closed", async () => {
    const harness: Harness = setUp({
      resource: makeResource({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
      }),
    });

    await register(["investigation"]);

    expect(resourceWrites(harness)[0]!.data).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
    });
  });
});

describe("register: the agent's defaults", () => {
  test("decide on a resource nobody configured, conditional on it staying unconfigured", async () => {
    const harness: Harness = setUp();

    await register(DEFAULTS_ASK_FOR_APPROVAL, { allowWrites: true });

    const writes: Array<ResourceWrite> = resourceWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    expect(writes[0]!.query).toHaveProperty("aiAccessConfiguredAt");
    expect(feedTexts(harness)[0]).toContain("follows the agent's defaults");
  });

  test("never replace what an operator chose", async () => {
    const harness: Harness = setUp({
      resource: makeResource({ aiAccessConfiguredAt: msAgo(60 * 1000) }),
    });

    await register(DEFAULTS_ASK_FOR_APPROVAL, { allowWrites: true });

    expect(resourceWrites(harness)).toHaveLength(0);
  });

  test("a conditional write that lands nowhere claims nothing", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      updateCount: 0,
    });

    await register(DEFAULTS_ASK_FOR_APPROVAL, {
      allowWrites: true,
      previousAgentKey: CURRENT_KEY,
    });

    expect(feedTexts(harness)).toHaveLength(0);
  });
});

describe("register: an agent too old to report settings", () => {
  test("gets the first-connection defaults, as before", async () => {
    const harness: Harness = setUp();

    await register(undefined, { allowWrites: true });

    const writes: Array<ResourceWrite> = resourceWrites(harness);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    expect(feedTexts(harness)[0]).not.toContain("follows the agent's");
  });
});

describe("register: when applying the settings fails", () => {
  test("the registration still succeeds and hands out its key, and nothing is claimed", async () => {
    const harness: Harness = setUp({
      existing: makeAgent(),
      updateError: new Error("database is down"),
    });

    const result: ResourceAiAgentRegistrationResult = await register(
      CONFIGURED_AUTOMATIC,
      { previousAgentKey: CURRENT_KEY },
    );

    expect(result.agentKey).toMatch(/^[0-9a-f]{64}$/);
    expect(feedTexts(harness)).toHaveLength(0);
    expect(loggedErrors()).toContain("could not apply the agent's AI settings");
  });
});

describe("applyReportedAiSettings: every resource type writes through its own service", () => {
  const SERVICES: Array<[AiResourceType, AnyObject]> = [
    [AiResourceType.DockerHost, DockerHostService as unknown as AnyObject],
    [AiResourceType.PodmanHost, PodmanHostService as unknown as AnyObject],
    [
      AiResourceType.DockerSwarmCluster,
      DockerSwarmClusterService as unknown as AnyObject,
    ],
    [
      AiResourceType.ProxmoxCluster,
      ProxmoxClusterService as unknown as AnyObject,
    ],
    [
      AiResourceType.VMwareVCenter,
      VMwareVCenterService as unknown as AnyObject,
    ],
    [AiResourceType.CephCluster, CephClusterService as unknown as AnyObject],
    [
      AiResourceType.DatabaseServer,
      DatabaseServerService as unknown as AnyObject,
    ],
    [AiResourceType.Host, HostService as unknown as AnyObject],
  ];

  test.each(SERVICES)(
    "%s",
    async (resourceType: AiResourceType, service: AnyObject) => {
      const update: SpyCalls = jest
        .spyOn(service, "updateOneBy")
        .mockResolvedValue(1 as never) as unknown as SpyCalls;

      const applied: ResourceAiAgentSettingsApplied | null =
        await ResourceAiAgentService.applyReportedAiSettings({
          resource: {
            resourceType,
            id: RESOURCE_ID,
            projectId: PROJECT_ID,
            name: "prod",
            isAiInvestigationEnabled: true,
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
            aiAccessConfiguredAt: null,
          },
          reported: CONFIGURED_AUTOMATIC,
        });

      expect(applied).toEqual({
        source: "agent_configuration",
        remediationMode: {
          from: ResourceAiRemediationMode.Disabled,
          to: ResourceAiRemediationMode.Automatic,
        },
      });
      expect(update.mock.calls).toHaveLength(1);
      const write: ResourceWrite = update.mock.calls[0]![0] as ResourceWrite;
      expect(write.data).toEqual({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
      });
      expect(write.props["isRoot"]).toBe(true);
    },
  );

  test("nothing reported: null, and nothing written", async () => {
    const update: SpyCalls = jest
      .spyOn(DockerHostService, "updateOneBy")
      .mockResolvedValue(1) as unknown as SpyCalls;

    await expect(
      ResourceAiAgentService.applyReportedAiSettings({
        resource: {
          resourceType: AiResourceType.DockerHost,
          id: RESOURCE_ID,
          projectId: PROJECT_ID,
          name: "web-1",
        },
        reported: undefined,
      }),
    ).resolves.toBeNull();

    expect(update.mock.calls).toHaveLength(0);
  });
});

describe("heartbeat: keeping the resource in step with the agent", () => {
  // A fresh service per test: the resource check is remembered per process.
  let service: ResourceAiAgentServiceClass;

  beforeEach(() => {
    service = new ResourceAiAgentServiceClass();
  });

  test("a report that differs from the stored one is applied at once, with a feed item", async () => {
    const harness: Harness = setUp({
      service,
      resource: makeResource({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
      }),
    });
    const now: Date = new Date();

    // The first heartbeat of the process checks the resource; let it.
    await service.heartbeat({
      agent: makeAgent({ posture: postureWith(CONFIGURED_AUTOMATIC) }),
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
      now,
    });
    expect(resourceWrites(harness)).toHaveLength(1);

    await service.heartbeat({
      agent: makeAgent({ posture: postureWith(CONFIGURED_AUTOMATIC) }),
      posture: { aiSettings: CONFIGURED_READ_ONLY },
      now: new Date(now.getTime() + 30 * 1000),
    });

    expect(resourceWrites(harness)).toHaveLength(2);
    expect(feedTexts(harness).join("\n")).toContain("investigation on → off");
  });

  test("an unchanged report between resource checks reads nothing", async () => {
    const harness: Harness = setUp({
      service,
      resource: makeResource({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
      }),
    });
    const agent: ResourceAiAgent = makeAgent({
      posture: postureWith(CONFIGURED_AUTOMATIC),
    });
    const now: Date = new Date();

    await service.heartbeat({
      agent,
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
      now,
    });
    const readsAfterFirst: number = harness.resourceFindOneBy.mock.calls.length;

    await service.heartbeat({
      agent,
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
      now: new Date(now.getTime() + 30 * 1000),
    });

    expect(harness.resourceFindOneBy.mock.calls.length).toBe(readsAfterFirst);
    expect(resourceWrites(harness)).toHaveLength(0);
  });

  test("the periodic resource check puts back a setting something else moved", async () => {
    const harness: Harness = setUp({
      service,
      resource: makeResource({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    });

    await service.heartbeat({
      agent: makeAgent({ posture: postureWith(CONFIGURED_AUTOMATIC) }),
      posture: { aiSettings: CONFIGURED_AUTOMATIC },
      now: new Date(),
    });

    expect(resourceWrites(harness)[0]!.data).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
    });
  });

  test("write access appearing never sets fixes to Ask for approval while the agent decides", async () => {
    const harness: Harness = setUp({
      service,
      resource: makeResource({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
      }),
    });
    const settings: AgentAiSettings = {
      investigation: true,
      fixes: "Disabled",
      isConfigured: true,
    };

    await service.heartbeat({
      agent: makeAgent({ posture: postureWith(settings) }),
      posture: { allowWrites: true, aiSettings: settings },
    });

    expect(resourceWrites(harness)).toHaveLength(0);
  });

  test("a failure writing the settings never fails the heartbeat, and nothing is claimed", async () => {
    const harness: Harness = setUp({
      service,
      updateError: new Error("database is down"),
    });

    await expect(
      service.heartbeat({
        agent: makeAgent(),
        posture: { aiSettings: CONFIGURED_AUTOMATIC },
      }),
    ).resolves.toBeUndefined();

    expect(feedTexts(harness)).toHaveLength(0);
  });
});

describe("getAiSettingsSourcesForResources", () => {
  const CONFIGURED_ID: ObjectID = new ObjectID(
    "A1111111-1111-4111-8111-111111111111",
  );
  const DEFAULTS_UNCHOSEN_ID: ObjectID = new ObjectID(
    "a2222222-2222-4222-8222-222222222222",
  );
  const DEFAULTS_CHOSEN_ID: ObjectID = new ObjectID(
    "a3333333-3333-4333-8333-333333333333",
  );
  const OLD_AGENT_ID: ObjectID = new ObjectID(
    "a4444444-4444-4444-8444-444444444444",
  );
  const NO_AGENT_ID: ObjectID = new ObjectID(
    "a5555555-5555-4555-8555-555555555555",
  );

  test("each resource's source from one read of the agent rows, keyed by lowercase id", async () => {
    const lookup: SpyCalls = jest
      .spyOn(ResourceAiAgentService, "findAgentsForResources")
      .mockResolvedValue(
        new Map<string, ResourceAiAgent>([
          [
            CONFIGURED_ID.toString().toLowerCase(),
            makeAgent({ posture: postureWith(CONFIGURED_AUTOMATIC) }),
          ],
          [
            DEFAULTS_UNCHOSEN_ID.toString(),
            makeAgent({ posture: postureWith(DEFAULTS_ASK_FOR_APPROVAL) }),
          ],
          [
            DEFAULTS_CHOSEN_ID.toString(),
            makeAgent({ posture: postureWith(DEFAULTS_ASK_FOR_APPROVAL) }),
          ],
          [OLD_AGENT_ID.toString(), makeAgent()],
        ]),
      ) as unknown as SpyCalls;

    const sources: Map<string, string> =
      await ResourceAiAgentService.getAiSettingsSourcesForResources({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resources: [
          { id: CONFIGURED_ID, aiAccessConfiguredAt: msAgo(1000) },
          { id: DEFAULTS_UNCHOSEN_ID, aiAccessConfiguredAt: null },
          { id: DEFAULTS_CHOSEN_ID, aiAccessConfiguredAt: msAgo(1000) },
          { id: OLD_AGENT_ID, aiAccessConfiguredAt: null },
          { id: NO_AGENT_ID, aiAccessConfiguredAt: null },
        ],
      });

    expect(Object.fromEntries(sources)).toEqual({
      [CONFIGURED_ID.toString().toLowerCase()]: "agent_configuration",
      [DEFAULTS_UNCHOSEN_ID.toString()]: "agent_defaults",
      [DEFAULTS_CHOSEN_ID.toString()]: "oneuptime",
      [OLD_AGENT_ID.toString()]: "oneuptime",
      [NO_AGENT_ID.toString()]: "oneuptime",
    });
    expect(lookup.mock.calls).toHaveLength(1);
    const query: AnyObject = lookup.mock.calls[0]![0] as AnyObject;
    expect(query["resourceType"]).toBe(AiResourceType.DockerHost);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });
});
