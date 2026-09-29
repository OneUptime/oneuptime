import { describe, expect, test } from "@jest/globals";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
  RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  RESOURCE_AI_ACCESS_TEST_ROUTE,
  RESOURCE_AI_AGENT_PAGE_TITLE,
  RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS,
  RESOURCE_AI_CHOICE_GAP_CODES,
  RESOURCE_AI_REFUSED_REGISTRATION_WARNING_WINDOW_MS,
  ResourceAccessTestResult,
  describeResourceAiAgentWriteAccess,
  formatResourceToolVersion,
  getResourceAiAccessRequestBody,
  getResourceAiAgentCardCommand,
  getResourceAiAgentCardState,
  getResourceAiAgentGapAction,
  getResourceAiAgentGoneText,
  getResourceAiAgentMetaParts,
  getResourceAiAgentNotInstalledText,
  getResourceAiAgentOfflineReason,
  getResourceAiAgentPageHint,
  getResourceAiAgentPageSubtitle,
  getResourceAiAgentReadyText,
  getResourceAiAgentSignedOffText,
  getResourceAiAgentSilentText,
  getResourceAiAgentStateSentence,
  getResourceAiAgentStatusPill,
  getResourceAiAttentionGaps,
  getResourceAiRefusedRegistrationWarning,
  isResourceUnreachable,
  parseResourceAccessTestResult,
  parseResourceAiAccessStatus,
  shouldShowResourceWriteAccessCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import {
  RESOURCE_AI_AGENT_DESCRIPTORS,
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
} from "../../../Types/AI/ResourceAiAccessApi";
import {
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  getResourceSentenceName,
} from "../../../Types/AI/ResourceAiAccessPermissions";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";

/*
 * The pure half of the resource AI agent page: the descriptors that tell
 * the generic page which resource it is on, and every decision the page
 * makes from the server's ResourceAiAccessStatus — which of its three
 * states the agent card shows, the words for each, the meta line, the
 * gaps it lists and the one action each gap offers.
 */

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";
const AGENT_ID: string = "99999999-0000-4000-8000-000000000009";
const NOW: Date = new Date("2026-09-29T12:00:00.000Z");

const DOCKER: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DockerHost,
);

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function makePosture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "prod-docker-01",
    agentVersion: "14.1.0",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: ["oneuptime-docker-ai-agent"],
    toolVersion: "27.3.1",
    reachable: true,
    details: {},
    ...overrides,
  };
}

function makeAgent(
  overrides: Partial<ResourceAiAgentSummary> = {},
): ResourceAiAgentSummary {
  return {
    agentId: AGENT_ID,
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: minutesBefore(0.5),
    lastRegisteredAt: minutesBefore(60),
    posture: makePosture(),
    ...overrides,
  };
}

function gap(code: ResourceAiAccessGapCode): ResourceAiAccessGap {
  return {
    code,
    title: `Title of ${code}`,
    nextStep: `Next step for ${code}`,
    blocksInvestigation: true,
    blocksRemediation: true,
  };
}

function makeStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "prod-docker-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: makeAgent(),
    gaps: [gap("remediation_disabled")],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

describe("the descriptors", () => {
  const MODELS: Record<AiResourceType, unknown> = {
    [AiResourceType.DockerHost]: DockerHost,
    [AiResourceType.PodmanHost]: PodmanHost,
    [AiResourceType.DockerSwarmCluster]: DockerSwarmCluster,
    [AiResourceType.ProxmoxCluster]: ProxmoxCluster,
    [AiResourceType.VMwareVCenter]: VMwareVCenter,
    [AiResourceType.CephCluster]: CephCluster,
    [AiResourceType.DatabaseServer]: DatabaseServer,
    [AiResourceType.Host]: Host,
  };

  const PAGES: Record<AiResourceType, [PageMap, PageMap]> = {
    [AiResourceType.DockerHost]: [
      PageMap.DOCKER_HOST_VIEW_AI_AGENT,
      PageMap.DOCKER_HOST_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.PodmanHost]: [
      PageMap.PODMAN_HOST_VIEW_AI_AGENT,
      PageMap.PODMAN_HOST_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.DockerSwarmCluster]: [
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.ProxmoxCluster]: [
      PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
      PageMap.PROXMOX_CLUSTER_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.VMwareVCenter]: [
      PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
      PageMap.VMWARE_VCENTER_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.CephCluster]: [
      PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
      PageMap.CEPH_CLUSTER_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.DatabaseServer]: [
      PageMap.DATABASE_SERVER_VIEW_AI_AGENT,
      PageMap.DATABASE_SERVER_VIEW_AI_INSIGHTS,
    ],
    [AiResourceType.Host]: [
      PageMap.HOST_VIEW_AI_AGENT,
      PageMap.HOST_VIEW_AI_INSIGHTS,
    ],
  };

  test("there is exactly one per resource type, and nothing else", () => {
    expect(Object.keys(RESOURCE_AI_AGENT_DESCRIPTORS).sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: its own type, model and AI pages",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(descriptor.resourceType).toBe(type);
      expect(descriptor.modelType).toBe(MODELS[type]);
      expect(descriptor.agentPage).toBe(PAGES[type][0]);
      expect(descriptor.insightsPage).toBe(PAGES[type][1]);
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the names come from the shared contract",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(descriptor.agentName).toBe(
        AI_RESOURCE_TYPE_INFO[type].agentDisplayName,
      );
      // The server's sentence names, so the page and its refusals agree.
      expect(descriptor.noun).toBe(getResourceSentenceName(type));
      expect(descriptor.allowlistPlaceholder).toBe(
        RESOURCE_AI_ALLOWLIST_EXAMPLES[type],
      );
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the allowlist example is an entry the type's policy accepts",
    (type: AiResourceType) => {
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: type,
          pattern: getResourceAiAgentDescriptor(type).allowlistPlaceholder,
        }),
      ).toBeNull();
    },
  );

  test("the commands tables keep apart: one preferences key per type", () => {
    const keys: Array<string> = ALL_AI_RESOURCE_TYPES.map(
      (type: AiResourceType): string => {
        return getResourceAiAgentDescriptor(type).commandsTableId;
      },
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("kubernetes-cluster-ai-kubectl-jobs");
  });

  test("the identity column is the one the collector's identity lands in", () => {
    expect(
      ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): unknown => {
        return [type, getResourceAiAgentDescriptor(type).identityColumn];
      }),
    ).toEqual([
      [AiResourceType.DockerHost, "hostIdentifier"],
      [AiResourceType.PodmanHost, "hostIdentifier"],
      [AiResourceType.DockerSwarmCluster, "name"],
      [AiResourceType.ProxmoxCluster, "name"],
      [AiResourceType.VMwareVCenter, "name"],
      [AiResourceType.CephCluster, "name"],
      // Pinned by id: database server names are not unique.
      [AiResourceType.DatabaseServer, null],
      [AiResourceType.Host, "hostIdentifier"],
    ]);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: every sentence of copy is filled in",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      for (const value of [
        descriptor.agentCardDescription,
        descriptor.investigateTitle,
        descriptor.readExamples,
        descriptor.readOnlyCommandsPhrase,
        descriptor.commandsCardTitle,
        descriptor.writeExamples,
        descriptor.riskierExamples,
      ]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(descriptor.riskierExamples).toMatch(/^riskier changes such as /);
    },
  );
});

describe("the routes and request body", () => {
  test("are the server's own paths", () => {
    expect(RESOURCE_AI_ACCESS_STATUS_ROUTE).toBe(
      RESOURCE_AI_ACCESS_STATUS_PATH,
    );
    expect(RESOURCE_AI_ACCESS_TEST_ROUTE).toBe(RESOURCE_AI_ACCESS_TEST_PATH);
    expect(RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE).toBe(
      RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
    );
    expect(RESOURCE_AI_ACCESS_INSIGHTS_ROUTE).toBe(
      RESOURCE_AI_ACCESS_INSIGHTS_PATH,
    );
    expect([
      RESOURCE_AI_ACCESS_STATUS_ROUTE,
      RESOURCE_AI_ACCESS_TEST_ROUTE,
      RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
      RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
    ]).toEqual([
      "/resource-ai-access/status",
      "/resource-ai-access/test",
      "/resource-ai-access/reset-agent",
      "/resource-ai-access/insights",
    ]);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the body names the type and the resource, nothing else",
    (type: AiResourceType) => {
      expect(
        getResourceAiAccessRequestBody(
          getResourceAiAgentDescriptor(type),
          RESOURCE_ID,
        ),
      ).toEqual({ resourceType: type, resourceId: RESOURCE_ID });
    },
  );

  test("the page polls as often as the agent heartbeats", () => {
    expect(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS).toBe(30_000);
    expect(RESOURCE_AI_REFUSED_REGISTRATION_WARNING_WINDOW_MS).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(RESOURCE_AI_AGENT_PAGE_TITLE).toBe("AI agent");
  });
});

describe("parseResourceAiAccessStatus", () => {
  test("reads the status the route returns", () => {
    const status: ResourceAiAccessStatus = makeStatus();
    expect(
      parseResourceAiAccessStatus(JSON.parse(JSON.stringify(status))),
    ).toEqual(status);
  });

  test.each([
    ["null", null],
    ["a string", "status"],
    ["an array", [makeStatus()]],
    ["a status without a resource id", { ...makeStatus(), resourceId: 7 }],
    ["a status without gaps", { ...makeStatus(), gaps: "none" }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseResourceAiAccessStatus(value)).toBeNull();
  });

  test("reads what it cannot trust the safe way", () => {
    const parsed: ResourceAiAccessStatus | null = parseResourceAiAccessStatus({
      resourceId: RESOURCE_ID,
      gaps: [gap("ai_agent_not_connected"), "not a gap", { title: "no code" }],
      aiRemediationMode: "SomethingNewer",
      aiCommandAllowlist: ["docker stop web", 3, null],
      isAiInvestigationEnabled: "yes",
      isInvestigationReady: 1,
      agent: "an agent",
    });

    expect(parsed).not.toBeNull();
    // An unknown mode never widens what AI may do.
    expect(parsed!.aiRemediationMode).toBe(ResourceAiRemediationMode.Disabled);
    expect(parsed!.aiCommandAllowlist).toEqual(["docker stop web"]);
    expect(parsed!.isAiInvestigationEnabled).toBe(false);
    expect(parsed!.isInvestigationReady).toBe(false);
    expect(parsed!.isRemediationReady).toBe(false);
    expect(parsed!.agent).toBeNull();
    expect(
      parsed!.gaps.map((item: ResourceAiAccessGap): string => {
        return item.code;
      }),
    ).toEqual(["ai_agent_not_connected"]);
  });
});

describe("the agent card's state", () => {
  test("connected, offline or not installed — nothing else", () => {
    expect(getResourceAiAgentCardState(makeStatus())).toBe("connected");
    expect(
      getResourceAiAgentCardState(
        makeStatus({ agent: makeAgent({ isOnline: false }) }),
      ),
    ).toBe("offline");
    expect(getResourceAiAgentCardState(makeStatus({ agent: null }))).toBe(
      "not_installed",
    );
  });

  test("the pill says it in one word, coloured by what it means", () => {
    expect(getResourceAiAgentStatusPill(makeStatus())).toEqual({
      text: "Connected",
      tone: "success",
    });
    expect(
      getResourceAiAgentStatusPill(
        makeStatus({ agent: makeAgent({ isOnline: false }) }),
      ),
    ).toEqual({ text: "Offline", tone: "danger" });
    expect(getResourceAiAgentStatusPill(makeStatus({ agent: null }))).toEqual({
      text: "Not installed",
      tone: "neutral",
    });
  });

  test("an online agent that cannot reach the resource is still connected, but unreachable", () => {
    const status: ResourceAiAccessStatus = makeStatus({
      agent: makeAgent({
        posture: makePosture({
          reachable: false,
          reachError: "Cannot connect to the Docker daemon",
        }),
      }),
    });

    expect(getResourceAiAgentCardState(status)).toBe("connected");
    expect(isResourceUnreachable(status)).toBe(true);
    expect(isResourceUnreachable(makeStatus())).toBe(false);
    // An offline agent's last probe says nothing about now.
    expect(
      isResourceUnreachable(
        makeStatus({
          agent: makeAgent({
            isOnline: false,
            posture: makePosture({ reachable: false }),
          }),
        }),
      ),
    ).toBe(false);
  });
});

describe("why an offline agent is offline", () => {
  test("never signed off: it went silent", () => {
    expect(
      getResourceAiAgentOfflineReason(
        makeStatus({
          agent: makeAgent({ isOnline: false, lastAliveAt: minutesBefore(12) }),
        }),
        NOW,
      ),
    ).toBe("silent");
  });

  test("signed off inside the alive window: it is coming back", () => {
    expect(
      getResourceAiAgentOfflineReason(
        makeStatus({
          agent: makeAgent({
            isOnline: false,
            connectionStatus: "disconnected",
            lastAliveAt: minutesBefore(1),
          }),
        }),
        NOW,
      ),
    ).toBe("signed_off");
  });

  test("signed off exactly at the window's edge still reads as coming back", () => {
    expect(
      getResourceAiAgentOfflineReason(
        makeStatus({
          agent: makeAgent({
            isOnline: false,
            connectionStatus: "disconnected",
            lastAliveAt: minutesBefore(
              RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
            ),
          }),
        }),
        NOW,
      ),
    ).toBe("signed_off");
  });

  test("signed off long ago, or never heard from: gone", () => {
    for (const lastAliveAt of [minutesBefore(45), null, "not a date"]) {
      expect(
        getResourceAiAgentOfflineReason(
          makeStatus({
            agent: makeAgent({
              isOnline: false,
              connectionStatus: "disconnected",
              lastAliveAt,
            }),
          }),
          NOW,
        ),
      ).toBe("gone");
    }
  });
});

describe("the card's sentence", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: names the agent and the resource in every state",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(
        getResourceAiAgentStateSentence(makeStatus(), descriptor, NOW),
      ).toBe(
        `The ${descriptor.agentName} is running next to this ${descriptor.noun}.`,
      );
      expect(
        getResourceAiAgentStateSentence(
          makeStatus({ agent: null }),
          descriptor,
          NOW,
        ),
      ).toBe(getResourceAiAgentNotInstalledText(descriptor));
      expect(getResourceAiAgentNotInstalledText(descriptor)).toContain(
        descriptor.agentName,
      );
      expect(getResourceAiAgentNotInstalledText(descriptor)).toContain(
        "read-only by default",
      );
    },
  );

  test("offline, each way, ending where the logs command takes over", () => {
    expect(
      getResourceAiAgentStateSentence(
        makeStatus({
          agent: makeAgent({ isOnline: false, lastAliveAt: minutesBefore(12) }),
        }),
        DOCKER,
        NOW,
      ),
    ).toBe(getResourceAiAgentSilentText(DOCKER));
    expect(getResourceAiAgentSilentText(DOCKER)).toBe(
      "The Docker AI agent has not checked in for over 5 minutes. Check its logs:",
    );

    expect(
      getResourceAiAgentStateSentence(
        makeStatus({
          agent: makeAgent({
            isOnline: false,
            connectionStatus: "disconnected",
            lastAliveAt: minutesBefore(1),
          }),
        }),
        DOCKER,
        NOW,
      ),
    ).toBe(getResourceAiAgentSignedOffText(DOCKER));
    expect(getResourceAiAgentSignedOffText(DOCKER)).toBe(
      "The Docker AI agent signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its logs:",
    );

    expect(
      getResourceAiAgentStateSentence(
        makeStatus({
          agent: makeAgent({
            isOnline: false,
            connectionStatus: "disconnected",
            lastAliveAt: minutesBefore(45),
          }),
        }),
        DOCKER,
        NOW,
      ),
    ).toBe(getResourceAiAgentGoneText(DOCKER));
    expect(getResourceAiAgentGoneText(DOCKER)).toBe(
      "The Docker AI agent disconnected and has not come back. Check its logs:",
    );
  });

  test("online but unable to reach the resource: says so, with the agent's reason", () => {
    expect(
      getResourceAiAgentStateSentence(
        makeStatus({
          agent: makeAgent({
            posture: makePosture({
              reachable: false,
              reachError: "Cannot connect to the Docker daemon",
            }),
          }),
        }),
        DOCKER,
        NOW,
      ),
    ).toBe(
      "The Docker AI agent is running, but it could not reach this Docker host at its last check: Cannot connect to the Docker daemon Check its logs:",
    );
    expect(
      getResourceAiAgentStateSentence(
        makeStatus({
          agent: makeAgent({ posture: makePosture({ reachable: false }) }),
        }),
        DOCKER,
        NOW,
      ),
    ).toBe(
      "The Docker AI agent is running, but it could not reach this Docker host at its last check. Check its logs:",
    );
  });

  test("the heading, ready line and hint say which resource", () => {
    const host: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
      AiResourceType.Host,
    );
    expect(getResourceAiAgentPageSubtitle(host)).toBe(
      "Whether OneUptime AI can reach this host, and what it may do there.",
    );
    expect(getResourceAiAgentReadyText(DOCKER)).toBe(
      "Ready — AI will inspect this Docker host with read-only docker commands when it investigates an incident or alert here.",
    );
  });
});

describe("the command under the sentence", () => {
  test("install when nothing registered, logs when offline or unreachable, none otherwise", () => {
    expect(getResourceAiAgentCardCommand(makeStatus({ agent: null }))).toBe(
      "install",
    );
    expect(
      getResourceAiAgentCardCommand(
        makeStatus({ agent: makeAgent({ isOnline: false }) }),
      ),
    ).toBe("logs");
    expect(
      getResourceAiAgentCardCommand(
        makeStatus({
          agent: makeAgent({ posture: makePosture({ reachable: false }) }),
        }),
      ),
    ).toBe("logs");
    expect(getResourceAiAgentCardCommand(makeStatus())).toBeNull();
  });
});

describe("the meta line", () => {
  test("last seen, the agent's version, the resource's version and what it may change", () => {
    const parts: Array<string> = getResourceAiAgentMetaParts(
      makeStatus(),
      DOCKER,
    );

    expect(parts[0]).toMatch(/^last seen /);
    expect(parts.slice(1)).toEqual([
      "agent v14.1.0",
      "Docker 27.3.1",
      "Read-only",
    ]);
  });

  test("is empty before an agent registered", () => {
    expect(
      getResourceAiAgentMetaParts(makeStatus({ agent: null }), DOCKER),
    ).toEqual([]);
  });

  test("leaves out what the agent did not report", () => {
    expect(
      getResourceAiAgentMetaParts(
        makeStatus({
          agent: makeAgent({
            lastAliveAt: null,
            agentVersion: null,
            posture: null,
          }),
        }),
        DOCKER,
      ),
    ).toEqual([]);
  });

  test("falls back to the posture's agent version", () => {
    expect(
      getResourceAiAgentMetaParts(
        makeStatus({
          agent: makeAgent({
            lastAliveAt: null,
            agentVersion: null,
            posture: makePosture({
              agentVersion: "v14.2.0",
              toolVersion: null,
            }),
          }),
        }),
        DOCKER,
      ),
    ).toEqual(["agent v14.2.0", "Read-only"]);
  });

  test("what the agent may change, from its posture", () => {
    expect(describeResourceAiAgentWriteAccess(null)).toBeNull();
    expect(describeResourceAiAgentWriteAccess(makePosture())).toBe("Read-only");
    expect(
      describeResourceAiAgentWriteAccess(makePosture({ allowWrites: true })),
    ).toBe("Can change any target");
    expect(
      describeResourceAiAgentWriteAccess(
        makePosture({ allowWrites: true, writeTargets: ["web-*", "api", " "] }),
      ),
    ).toBe("Can change: web-*, api");
  });

  test.each([
    [AiResourceType.DockerHost, "27.3.1", {}, "Docker 27.3.1"],
    [AiResourceType.PodmanHost, "5.2.0", {}, "Podman 5.2.0"],
    [AiResourceType.ProxmoxCluster, "8.2.4", {}, "Proxmox VE 8.2.4"],
    [AiResourceType.VMwareVCenter, "8.0.3", {}, "vCenter 8.0.3"],
    [AiResourceType.CephCluster, "19.2.0", {}, "Ceph 19.2.0"],
    // Already named: not "Ceph ceph version 19.2.0".
    [
      AiResourceType.CephCluster,
      "ceph version 19.2.0",
      {},
      "ceph version 19.2.0",
    ],
    [
      AiResourceType.DatabaseServer,
      "16.4",
      { databaseSystem: "postgresql" },
      "postgresql 16.4",
    ],
    [AiResourceType.DatabaseServer, "16.4", {}, "16.4"],
    [AiResourceType.Host, "6.8.0-45-generic", {}, "6.8.0-45-generic"],
  ])(
    "%s reports %s as it should read",
    (
      type: AiResourceType,
      version: string,
      details: Record<string, string>,
      expected: string,
    ) => {
      expect(
        formatResourceToolVersion(
          getResourceAiAgentDescriptor(type),
          makePosture({ resourceType: type, toolVersion: version, details }),
        ),
      ).toBe(expected);
    },
  );

  test("no version, no part", () => {
    expect(formatResourceToolVersion(DOCKER, null)).toBeNull();
    expect(
      formatResourceToolVersion(DOCKER, makePosture({ toolVersion: "  " })),
    ).toBeNull();
  });
});

describe("the refused-registration warning", () => {
  test("names the identity variables of the resource type", () => {
    const warning: string | null = getResourceAiRefusedRegistrationWarning(
      makeAgent({
        lastRefusedRegistrationAt: minutesBefore(10),
        lastRefusedRegistrationReason: "previous_instance_online",
      }),
      DOCKER,
      NOW,
    );

    expect(warning).toContain(
      "Another agent tried to register for this Docker host at",
    );
    expect(warning).toContain("the same DOCKER_HOST_NAME");

    expect(
      getResourceAiRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: minutesBefore(10) }),
        getResourceAiAgentDescriptor(AiResourceType.DatabaseServer),
        NOW,
      ),
    ).toContain(
      "DATABASE_SERVER_ID / DATABASE_SYSTEM / DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT",
    );
  });

  test("says nothing without a refusal, for another reason, a bad date or an old one", () => {
    expect(
      getResourceAiRefusedRegistrationWarning(null, DOCKER, NOW),
    ).toBeNull();
    expect(
      getResourceAiRefusedRegistrationWarning(makeAgent(), DOCKER, NOW),
    ).toBeNull();
    expect(
      getResourceAiRefusedRegistrationWarning(
        makeAgent({
          lastRefusedRegistrationAt: minutesBefore(10),
          lastRefusedRegistrationReason: "agent_cap_reached",
        }),
        DOCKER,
        NOW,
      ),
    ).toBeNull();
    expect(
      getResourceAiRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: "yesterday-ish" }),
        DOCKER,
        NOW,
      ),
    ).toBeNull();
    expect(
      getResourceAiRefusedRegistrationWarning(
        makeAgent({ lastRefusedRegistrationAt: minutesBefore(25 * 60) }),
        DOCKER,
        NOW,
      ),
    ).toBeNull();
  });
});

describe("Needs attention", () => {
  test("leaves out the fixes-off choice, keeps every problem", () => {
    expect(RESOURCE_AI_CHOICE_GAP_CODES).toEqual(["remediation_disabled"]);
    expect(
      getResourceAiAttentionGaps(
        makeStatus({
          gaps: [
            gap("remediation_disabled"),
            gap("llm_provider_missing"),
            gap("ai_agent_offline"),
          ],
        }),
      ).map((item: ResourceAiAccessGap): string => {
        return item.code;
      }),
    ).toEqual(["llm_provider_missing", "ai_agent_offline"]);
  });

  test.each([
    ["investigation_disabled", "turn_on_investigation"],
    ["ai_disabled_for_project", "open_ai_features"],
    ["auto_remediation_disabled_for_project", "open_ai_features"],
    ["llm_provider_missing", "open_llm_providers"],
    ["ai_balance_insufficient", "open_ai_credits"],
    ["ai_agent_unreachable_resource", "test_connection"],
    // Their next step is a command already on the page.
    ["ai_agent_not_connected", null],
    ["ai_agent_offline", null],
    ["remediation_write_access_missing", null],
    ["remediation_disabled", null],
  ])("%s offers %s", (code: string, action: string | null) => {
    expect(
      getResourceAiAgentGapAction(
        gap(code as ResourceAiAccessGapCode),
        makeStatus(),
      ),
    ).toBe(action);
  });

  test("an unreachable resource offers no test without an agent to run it", () => {
    expect(
      getResourceAiAgentGapAction(
        gap("ai_agent_unreachable_resource"),
        makeStatus({ agent: null }),
      ),
    ).toBeNull();
  });
});

describe("the write-access instructions", () => {
  test("only once fixes are on and the agent reports it is read-only", () => {
    expect(shouldShowResourceWriteAccessCommands(makeStatus())).toBe(false);
    expect(
      shouldShowResourceWriteAccessCommands(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
      ),
    ).toBe(true);
    expect(
      shouldShowResourceWriteAccessCommands(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          agent: makeAgent({ posture: makePosture({ allowWrites: true }) }),
        }),
      ),
    ).toBe(false);
    // The install instructions come first.
    expect(
      shouldShowResourceWriteAccessCommands(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          agent: null,
        }),
      ),
    ).toBe(false);
    // An agent that never reported a posture is not known to write.
    expect(
      shouldShowResourceWriteAccessCommands(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          agent: makeAgent({ posture: null }),
        }),
      ),
    ).toBe(true);
  });
});

describe("the AI Insights page's pointer to the agent page", () => {
  test("only when AI cannot run commands on the resource", () => {
    expect(getResourceAiAgentPageHint(null, DOCKER)).toBeNull();
    expect(getResourceAiAgentPageHint(makeStatus(), DOCKER)).toBeNull();
    expect(
      getResourceAiAgentPageHint(
        makeStatus({ isInvestigationReady: false }),
        getResourceAiAgentDescriptor(AiResourceType.CephCluster),
      ),
    ).toBe("OneUptime AI can't run commands on this Ceph cluster right now.");
  });
});

describe("parseResourceAccessTestResult", () => {
  test("reads the test route's answer", () => {
    expect(
      parseResourceAccessTestResult({
        ok: true,
        message: "Both commands worked.",
        results: [
          {
            command: "docker version",
            succeeded: true,
            exitCode: 0,
            output: "Server: 27.3.1",
            errorMessage: null,
          },
          {
            command: "docker info",
            succeeded: false,
            exitCode: null,
            output: "",
            errorMessage: "Refused by the Docker AI agent",
          },
        ],
        status: makeStatus(),
      }),
    ).toEqual({
      ok: true,
      message: "Both commands worked.",
      results: [
        {
          command: "docker version",
          succeeded: true,
          exitCode: 0,
          output: "Server: 27.3.1",
          errorMessage: null,
        },
        {
          command: "docker info",
          succeeded: false,
          exitCode: null,
          output: "",
          errorMessage: "Refused by the Docker AI agent",
        },
      ],
    });
  });

  test("reads anything else as a failed test with nothing to show", () => {
    const empty: ResourceAccessTestResult = {
      ok: false,
      message: "",
      results: [],
    };
    expect(parseResourceAccessTestResult(null)).toEqual(empty);
    expect(parseResourceAccessTestResult({ ok: "yes", results: {} })).toEqual(
      empty,
    );
    expect(
      parseResourceAccessTestResult({
        results: [null, { exitCode: Infinity, succeeded: "true" }],
      }).results,
    ).toEqual([
      {
        command: "",
        succeeded: false,
        exitCode: null,
        output: "",
        errorMessage: null,
      },
      {
        command: "",
        succeeded: false,
        exitCode: null,
        output: "",
        errorMessage: null,
      },
    ]);
  });
});
