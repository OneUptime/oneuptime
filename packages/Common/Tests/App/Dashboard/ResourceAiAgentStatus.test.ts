import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
  RESOURCE_AI_ACCESS_LOGS_ROUTE,
  RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  RESOURCE_AI_ACCESS_TEST_ROUTE,
  RESOURCE_AI_AGENT_PAGE_TITLE,
  RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS,
  RESOURCE_AI_CHOICE_GAP_CODES,
  RESOURCE_AI_REFUSED_REGISTRATION_WARNING_WINDOW_MS,
  RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT,
  RESOURCE_AI_SETTINGS_SET_BY_TEXT,
  ResourceAccessTestResult,
  ResourceAiAgentMeta,
  ResourceAiAttention,
  ResourceAiAttentionStep,
  describeResourceAiAgentWriteAccess,
  formatResourceToolVersion,
  getResourceAiAccessRequestBody,
  getResourceAiAgentCardCommand,
  getResourceAiAgentCardState,
  getResourceAiAgentGapAction,
  getResourceAiAgentGoneText,
  getResourceAiAgentMeta,
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
  getResourceAiAttention,
  getResourceAiAttentionGaps,
  getResourceAiAttentionStepText,
  getResourceAiAttentionTitle,
  getResourceAiRefusedRegistrationWarning,
  getResourceAiSettingsChoice,
  getResourceAiSettingsSource,
  isResourceAiSettingsSetByAgent,
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
  RESOURCE_AI_ACCESS_LOGS_PATH,
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

/*
 * Where the resource's investigation and fixes are set (status.
 * aiSettingsSource): while its AI agent sets them, the page shows them
 * read-only, and the "investigation off" step points where the agent runs.
 */
describe("settings the agent sets", () => {
  test.each([
    ["agent_configuration", "agent_configuration", true],
    ["agent_defaults", "agent_defaults", true],
    ["oneuptime", "oneuptime", false],
    [undefined, "oneuptime", false],
    ["something new", "oneuptime", false],
  ])(
    "status.aiSettingsSource %j reads as %s",
    (value: unknown, source: string, isSetByAgent: boolean) => {
      const status: ResourceAiAccessStatus = makeStatus({
        aiSettingsSource: value as ResourceAiAccessStatus["aiSettingsSource"],
      });

      expect(getResourceAiSettingsSource(status)).toBe(source);
      expect(isResourceAiSettingsSetByAgent(status)).toBe(isSetByAgent);
    },
  );

  test("parsing a status keeps where its settings are set", () => {
    const parsed: ResourceAiAccessStatus | null = parseResourceAiAccessStatus({
      ...makeStatus(),
      aiSettingsSource: "agent_configuration",
    });

    expect(parsed && getResourceAiSettingsSource(parsed)).toBe(
      "agent_configuration",
    );
  });

  test("what is in effect, as a choice", () => {
    expect(
      getResourceAiSettingsChoice(
        makeStatus({
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      ),
    ).toEqual({ investigation: false, fixes: "BypassApproval" });
    // A mode this build does not know reads as Off.
    expect(
      getResourceAiSettingsChoice(
        makeStatus({
          aiRemediationMode: "Everything" as ResourceAiRemediationMode,
        }),
      ).fixes,
    ).toBe("Disabled");
  });

  test("the line above the rows names the agent and its variables", () => {
    for (const text of [
      RESOURCE_AI_SETTINGS_SET_BY_TEXT.agent_configuration,
      RESOURCE_AI_SETTINGS_SET_BY_TEXT.agent_defaults,
      RESOURCE_AI_SETTINGS_SET_BY_TEXT.oneuptime,
    ]) {
      expect(text).toContain("{{agent}}");
      expect(text).toContain("ONEUPTIME_AI_INVESTIGATION");
      expect(text).toContain("ONEUPTIME_AI_FIXES");
    }
  });

  test("investigation off, set by the agent: the step points where it runs and offers the lines", () => {
    const investigationOff: ResourceAiAccessGap = gap("investigation_disabled");
    const status: ResourceAiAccessStatus = makeStatus({
      aiSettingsSource: "agent_configuration",
      isAiInvestigationEnabled: false,
      gaps: [investigationOff],
    });

    expect(getResourceAiAgentGapAction(investigationOff, status)).toBe(
      "set_investigation_in_agent",
    );
    expect(
      getResourceAiAttentionStepText(investigationOff, status, DOCKER),
    ).toBe(`Turn on AI investigation where the ${DOCKER.agentName} runs.`);
    expect(RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT).toContain("{{agent}}");
  });

  test("negative control: chosen here, the Turn on button stays", () => {
    const investigationOff: ResourceAiAccessGap = gap("investigation_disabled");
    const status: ResourceAiAccessStatus = makeStatus({
      aiSettingsSource: "oneuptime",
      isAiInvestigationEnabled: false,
      gaps: [investigationOff],
    });

    expect(getResourceAiAgentGapAction(investigationOff, status)).toBe(
      "turn_on_investigation",
    );
    expect(
      getResourceAiAttentionStepText(investigationOff, status, DOCKER),
    ).toBe("Turn on AI investigation.");
  });
});

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

  const PAGES: Record<AiResourceType, [PageMap, PageMap, PageMap]> = {
    [AiResourceType.DockerHost]: [
      PageMap.DOCKER_HOST_VIEW_AI_AGENT,
      PageMap.DOCKER_HOST_VIEW_AI_INSIGHTS,
      PageMap.DOCKER_HOST_VIEW_AI_LOGS,
    ],
    [AiResourceType.PodmanHost]: [
      PageMap.PODMAN_HOST_VIEW_AI_AGENT,
      PageMap.PODMAN_HOST_VIEW_AI_INSIGHTS,
      PageMap.PODMAN_HOST_VIEW_AI_LOGS,
    ],
    [AiResourceType.DockerSwarmCluster]: [
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_INSIGHTS,
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_LOGS,
    ],
    [AiResourceType.ProxmoxCluster]: [
      PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
      PageMap.PROXMOX_CLUSTER_VIEW_AI_INSIGHTS,
      PageMap.PROXMOX_CLUSTER_VIEW_AI_LOGS,
    ],
    [AiResourceType.VMwareVCenter]: [
      PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
      PageMap.VMWARE_VCENTER_VIEW_AI_INSIGHTS,
      PageMap.VMWARE_VCENTER_VIEW_AI_LOGS,
    ],
    [AiResourceType.CephCluster]: [
      PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
      PageMap.CEPH_CLUSTER_VIEW_AI_INSIGHTS,
      PageMap.CEPH_CLUSTER_VIEW_AI_LOGS,
    ],
    [AiResourceType.DatabaseServer]: [
      PageMap.DATABASE_SERVER_VIEW_AI_AGENT,
      PageMap.DATABASE_SERVER_VIEW_AI_INSIGHTS,
      PageMap.DATABASE_SERVER_VIEW_AI_LOGS,
    ],
    [AiResourceType.Host]: [
      PageMap.HOST_VIEW_AI_AGENT,
      PageMap.HOST_VIEW_AI_INSIGHTS,
      PageMap.HOST_VIEW_AI_LOGS,
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
      expect(descriptor.logsPage).toBe(PAGES[type][2]);
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
        descriptor.riskierChanges,
      ]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(descriptor.riskierExamples).toMatch(/^riskier changes such as /);
      // The Automatic card's words for the same changes.
      expect(descriptor.riskierExamples).toBe(
        `riskier changes such as ${descriptor.riskierChanges}`,
      );
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
    expect(RESOURCE_AI_ACCESS_LOGS_ROUTE).toBe(RESOURCE_AI_ACCESS_LOGS_PATH);
    expect([
      RESOURCE_AI_ACCESS_STATUS_ROUTE,
      RESOURCE_AI_ACCESS_TEST_ROUTE,
      RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE,
      RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
      RESOURCE_AI_ACCESS_LOGS_ROUTE,
    ]).toEqual([
      "/resource-ai-access/status",
      "/resource-ai-access/test",
      "/resource-ai-access/reset-agent",
      "/resource-ai-access/insights",
      "/resource-ai-access/logs",
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
  /*
   * The agent's version is drawn by the page with AgentVersion (an outdated
   * agent gets its sign and upgrade dialog), so the words leave it out and
   * say where it goes: after "last seen".
   */
  test("last seen, then the agent's version (drawn by the page), the resource's version and what it may change", () => {
    const parts: Array<string> = getResourceAiAgentMetaParts(
      makeStatus(),
      DOCKER,
    );

    expect(parts[0]).toMatch(/^last seen /);
    expect(parts.slice(1)).toEqual(["Docker 27.3.1", "Read-only"]);

    const meta: ResourceAiAgentMeta = getResourceAiAgentMeta(
      makeStatus(),
      DOCKER,
    );
    expect(meta.lastSeen).toMatch(/^last seen /);
    expect(meta.showsAgentVersion).toBe(true);
    expect(meta.rest).toEqual(["Docker 27.3.1", "Read-only"]);
  });

  test("no agent, no version to show", () => {
    expect(getResourceAiAgentMeta(makeStatus({ agent: null }), DOCKER)).toEqual(
      { lastSeen: null, showsAgentVersion: false, rest: [] },
    );
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

  test("an agent that reported only its posture still says what it may change", () => {
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
    ).toEqual(["Read-only"]);
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
    /*
     * Retired: "Enable auto-remediation" was folded into Enable AI, but an
     * older server may still send it mid-rollout.
     */
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

/*
 * "Needs attention" as ONE item: a headline that says what OneUptime AI
 * cannot do on the resource, then one short step per gap in this page's
 * words, each with the action its gap offers.
 */

const DATABASE: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DatabaseServer,
);

// A gap with the flags the server really gives it (see the table below).
function flaggedGap(
  code: ResourceAiAccessGapCode,
  flags: { investigation: boolean; fixes: boolean },
): ResourceAiAccessGap {
  return {
    code,
    title: `Title of ${code}`,
    nextStep: `Next step for ${code}`,
    blocksInvestigation: flags.investigation,
    blocksRemediation: flags.fixes,
  };
}

// What each gap blocks, as ResourceAiAccessService.buildStatus sets it.
const SERVER_FLAGS: Record<
  ResourceAiAccessGapCode,
  { investigation: boolean; fixes: boolean }
> = {
  ai_agent_not_connected: { investigation: true, fixes: true },
  ai_agent_offline: { investigation: true, fixes: true },
  ai_agent_unreachable_resource: { investigation: true, fixes: true },
  investigation_disabled: { investigation: true, fixes: false },
  remediation_disabled: { investigation: false, fixes: true },
  remediation_write_access_missing: { investigation: false, fixes: true },
  ai_disabled_for_project: { investigation: true, fixes: true },
  // Retired (Enable AI covers it): only an older server sends it, like this.
  auto_remediation_disabled_for_project: { investigation: false, fixes: true },
  llm_provider_missing: { investigation: true, fixes: true },
  ai_balance_insufficient: { investigation: true, fixes: true },
};

function serverGap(code: ResourceAiAccessGapCode): ResourceAiAccessGap {
  return flaggedGap(code, SERVER_FLAGS[code]);
}

function stepTexts(attention: ResourceAiAttention | null): Array<string> {
  return (attention?.steps || []).map(
    (step: ResourceAiAttentionStep): string => {
      return step.text;
    },
  );
}

describe("Needs attention, as one item", () => {
  test("nothing to show without gaps, or with only the fixes-off choice", () => {
    expect(getResourceAiAttention(makeStatus({ gaps: [] }), DOCKER)).toBeNull();
    expect(
      getResourceAiAttention(
        makeStatus({ gaps: [serverGap("remediation_disabled")] }),
        DOCKER,
      ),
    ).toBeNull();
  });

  test("the database server in the screenshot: one headline, two short steps", () => {
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      makeStatus({
        resourceType: AiResourceType.DatabaseServer,
        agent: null,
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [
          serverGap("ai_agent_not_connected"),
          serverGap("investigation_disabled"),
          serverGap("remediation_disabled"),
        ],
      }),
      DATABASE,
    );

    expect(attention).toEqual({
      title: "OneUptime AI can't investigate this database server",
      steps: [
        {
          gap: serverGap("ai_agent_not_connected"),
          text: "Install the Database AI agent with the instructions above.",
          action: null,
        },
        {
          gap: serverGap("investigation_disabled"),
          text: "Turn on AI investigation.",
          action: "turn_on_investigation",
        },
      ],
    });
  });

  test("keeps the server's order and gives each step its gap's action", () => {
    const gaps: Array<ResourceAiAccessGap> = [
      serverGap("ai_agent_unreachable_resource"),
      serverGap("investigation_disabled"),
      serverGap("remediation_write_access_missing"),
      serverGap("ai_disabled_for_project"),
      serverGap("llm_provider_missing"),
      serverGap("ai_balance_insufficient"),
      serverGap("auto_remediation_disabled_for_project"),
    ];
    const status: ResourceAiAccessStatus = makeStatus({
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      agent: makeAgent({ posture: makePosture({ reachable: false }) }),
      isInvestigationReady: false,
      gaps,
    });
    const attention: ResourceAiAttention = getResourceAiAttention(
      status,
      DOCKER,
    )!;

    expect(
      attention.steps.map((step: ResourceAiAttentionStep): string => {
        return step.gap.code;
      }),
    ).toEqual(
      gaps.map((item: ResourceAiAccessGap): string => {
        return item.code;
      }),
    );
    expect(
      attention.steps.map((step: ResourceAiAttentionStep): string | null => {
        return step.action;
      }),
    ).toEqual([
      "test_connection",
      "turn_on_investigation",
      null,
      "open_ai_features",
      "open_llm_providers",
      "open_ai_credits",
      "open_ai_features",
    ]);
    for (const step of attention.steps) {
      expect(step.action).toBe(getResourceAiAgentGapAction(step.gap, status));
      expect(step.text).toBe(
        getResourceAiAttentionStepText(step.gap, status, DOCKER),
      );
    }
  });

  test("one gap is one step", () => {
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [serverGap("investigation_disabled")],
      }),
      DOCKER,
    );

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this Docker host",
    );
    expect(stepTexts(attention)).toEqual(["Turn on AI investigation."]);
  });
});

describe("Needs attention's headline", () => {
  test("investigation blocked, fixes off: only investigation is named", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          agent: null,
          gaps: [
            serverGap("ai_agent_not_connected"),
            serverGap("remediation_disabled"),
          ],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't investigate this Docker host");
  });

  test.each([
    ResourceAiRemediationMode.RequireApproval,
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ])(
    "investigation and fixes blocked with fixes on (%s): both are named",
    (mode: ResourceAiRemediationMode) => {
      expect(
        getResourceAiAttentionTitle(
          makeStatus({
            agent: null,
            aiRemediationMode: mode,
            gaps: [serverGap("ai_agent_not_connected")],
          }),
          DOCKER,
        ),
      ).toBe(
        "OneUptime AI can't investigate this Docker host or run fixes on it",
      );
    },
  );

  test("investigation off while fixes are on and working: only investigation", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          gaps: [serverGap("investigation_disabled")],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't investigate this Docker host");
  });

  test("a read-only agent while fixes are on: only fixes are named", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          gaps: [serverGap("remediation_write_access_missing")],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't run fixes on this Docker host");
  });

  test("a gap that blocks only fixes still says fixes when they are off", () => {
    // An older server's retired gap is the one that arrives beside fixes-off.
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          gaps: [
            serverGap("remediation_disabled"),
            serverGap("auto_remediation_disabled_for_project"),
          ],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't run fixes on this Docker host");
  });

  test("the fixes-off choice never counts toward the headline", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          gaps: [
            // Not what the server sends together, but the choice must not count.
            serverGap("remediation_disabled"),
            serverGap("investigation_disabled"),
          ],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't investigate this Docker host");
  });

  test("an unknown fixes mode reads as off", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          agent: null,
          aiRemediationMode: "Sometimes" as ResourceAiRemediationMode,
          gaps: [serverGap("ai_agent_not_connected")],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't investigate this Docker host");
  });

  test("a gap that blocks neither falls back to a plain sentence", () => {
    expect(
      getResourceAiAttentionTitle(
        makeStatus({
          gaps: [
            flaggedGap("ai_agent_offline", {
              investigation: false,
              fixes: false,
            }),
          ],
        }),
        DOCKER,
      ),
    ).toBe("OneUptime AI can't do all of its job on this Docker host");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "names the resource: %s",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(
        getResourceAiAttentionTitle(
          makeStatus({
            resourceType: type,
            agent: null,
            gaps: [serverGap("ai_agent_not_connected")],
          }),
          descriptor,
        ),
      ).toBe(`OneUptime AI can't investigate this ${descriptor.noun}`);
    },
  );
});

describe("Needs attention's steps", () => {
  const reachable: ResourceAiAccessStatus = makeStatus();
  const unreachable: ResourceAiAccessStatus = makeStatus({
    agent: makeAgent({
      posture: makePosture({
        reachable: false,
        reachError: "Cannot connect to the Docker daemon",
      }),
    }),
  });

  test.each([
    [
      "ai_agent_not_connected",
      "Install the Docker AI agent with the instructions above.",
    ],
    [
      "ai_agent_offline",
      "Bring the Docker AI agent back online. Its logs say why it is offline (the command is above).",
    ],
    ["investigation_disabled", "Turn on AI investigation."],
    [
      "remediation_write_access_missing",
      "Give the Docker AI agent write access with the steps below.",
    ],
    ["ai_disabled_for_project", "Turn on AI for this project."],
    [
      "llm_provider_missing",
      "Add an AI provider for this project, or use OneUptime AI credits.",
    ],
    [
      "ai_balance_insufficient",
      "Add AI credits to this project, or turn on auto-recharge.",
    ],
    // Retired: Enable AI covers it, so it asks for the same thing.
    ["auto_remediation_disabled_for_project", "Turn on AI for this project."],
  ])("%s: %s", (code: string, text: string) => {
    expect(
      getResourceAiAttentionStepText(
        serverGap(code as ResourceAiAccessGapCode),
        reachable,
        DOCKER,
      ),
    ).toBe(text);
  });

  test("an agent that could not reach the resource: fix it, then test", () => {
    expect(
      getResourceAiAttentionStepText(
        serverGap("ai_agent_unreachable_resource"),
        unreachable,
        DOCKER,
      ),
    ).toBe(
      "Let the Docker AI agent reach this Docker host (its error and the logs command are above), then test the connection.",
    );
  });

  test("an agent that has not said whether it can reach the resource: wait, then test", () => {
    const expected: string =
      "Wait a minute for the Docker AI agent to report that it can reach this Docker host, then test the connection.";

    for (const status of [
      makeStatus({ agent: makeAgent({ posture: null }) }),
      makeStatus({ agent: makeAgent({ posture: undefined }) }),
      reachable,
    ]) {
      expect(
        getResourceAiAttentionStepText(
          serverGap("ai_agent_unreachable_resource"),
          status,
          DOCKER,
        ),
      ).toBe(expected);
    }
  });

  test("a gap this build does not know keeps the server's next step, or its title", () => {
    const unknown: ResourceAiAccessGap = {
      ...serverGap("ai_agent_offline"),
      code: "something_new" as ResourceAiAccessGapCode,
      title: "Something new is wrong",
      nextStep: "Do the new thing.",
    };

    expect(getResourceAiAttentionStepText(unknown, reachable, DOCKER)).toBe(
      "Do the new thing.",
    );
    expect(
      getResourceAiAttentionStepText(
        { ...unknown, nextStep: "" },
        reachable,
        DOCKER,
      ),
    ).toBe("Something new is wrong");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "every step names %s's own agent and noun, and never sends the reader to this page",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const status: ResourceAiAccessStatus = makeStatus({
        resourceType: type,
        agent: makeAgent({
          posture: makePosture({ resourceType: type, reachable: false }),
        }),
      });
      const texts: Record<string, string> = {};

      for (const code of Object.keys(
        SERVER_FLAGS,
      ) as Array<ResourceAiAccessGapCode>) {
        if (code === "remediation_disabled") {
          continue;
        }
        texts[code] = getResourceAiAttentionStepText(
          serverGap(code),
          status,
          descriptor,
        );
      }

      expect(texts["ai_agent_not_connected"]).toBe(
        `Install the ${AI_RESOURCE_TYPE_INFO[type].agentDisplayName} with the instructions above.`,
      );
      expect(texts["ai_agent_unreachable_resource"]).toContain(
        `reach this ${descriptor.noun}`,
      );
      for (const text of Object.values(texts)) {
        expect(text).not.toMatch(/Next step for|Title of/);
        expect(text).not.toContain("AI → AI agent");
        expect(text).not.toContain("AI agent page");
        expect(text).toMatch(/\.$/);
      }
    },
  );
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

describe("the AI Insights and AI Logs pages' pointer to the agent page", () => {
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

/*
 * The agent card's sentence and every "Needs attention" step are looked up
 * in the Dashboard's locale files (src/Locales/README.md), each one whole
 * key with the agent's and the resource's names in {{placeholders}}. The
 * connected and unreachable sentences and most steps used to be template
 * literals and plain strings that read English in every language.
 *
 * A pseudo-locale wraps every en.json entry in ‹ ›, so a sentence that was
 * looked up comes back wrapped, and so does a name translated along with
 * it. These run last: they set up the global i18next instance the functions
 * read.
 */
describe("in the reader's language", () => {
  const ENGLISH: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const LOOKED_UP: RegExp = /^‹[^]*›$/;

  const ALL_GAP_CODES: Array<ResourceAiAccessGapCode> = Object.keys(
    SERVER_FLAGS,
  ) as Array<ResourceAiAccessGapCode>;

  const unreachable: (reachError?: string) => ResourceAiAccessStatus = (
    reachError?: string,
  ): ResourceAiAccessStatus => {
    return makeStatus({
      agent: makeAgent({
        posture: makePosture({ reachable: false, reachError }),
      }),
    });
  };

  // Every state, and each branch a step's wording depends on.
  const STATUSES: Array<ResourceAiAccessStatus> = [
    makeStatus(),
    makeStatus({ aiSettingsSource: "agent_configuration" }),
    unreachable("Cannot connect to the Docker daemon"),
    unreachable(),
    makeStatus({ agent: null }),
    makeStatus({
      agent: makeAgent({ isOnline: false, lastAliveAt: minutesBefore(30) }),
    }),
  ];

  beforeAll(async () => {
    const pseudo: Record<string, string> = {};

    for (const [key, value] of Object.entries(ENGLISH)) {
      if (typeof value === "string") {
        pseudo[key] = `‹${value}›`;
      }
    }

    await i18next.init({
      lng: "xx",
      fallbackLng: "en",
      resources: { xx: { translation: pseudo } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("every state's sentence, for every resource, is looked up whole", () => {
    for (const descriptor of Object.values(RESOURCE_AI_AGENT_DESCRIPTORS)) {
      for (const status of STATUSES) {
        expect({
          resource: descriptor.resourceType,
          state: getResourceAiAgentCardState(status),
          sentence: getResourceAiAgentStateSentence(status, descriptor, NOW),
        }).toEqual({
          resource: descriptor.resourceType,
          state: getResourceAiAgentCardState(status),
          sentence: expect.stringMatching(LOOKED_UP),
        });
      }
    }

    // The agent's and the resource's names are translated with it.
    expect(getResourceAiAgentStateSentence(makeStatus(), DOCKER, NOW)).toBe(
      "‹The ‹Docker AI agent› is running next to this ‹Docker host›.›",
    );
    // The agent's own error goes in as it reported it.
    expect(
      getResourceAiAgentStateSentence(
        unreachable("Cannot connect to the Docker daemon"),
        DOCKER,
        NOW,
      ),
    ).toBe(
      "‹The ‹Docker AI agent› is running, but it could not reach this ‹Docker host› at its last check: Cannot connect to the Docker daemon Check its logs:›",
    );
  });

  test("the pill says a key the Pill looks up", () => {
    for (const status of STATUSES) {
      const text: string = getResourceAiAgentStatusPill(status).text;

      expect(ENGLISH[text]).toBe(text);
    }
  });

  test("the headline and every step: the page's words looked up, or the server's untouched", () => {
    for (const descriptor of Object.values(RESOURCE_AI_AGENT_DESCRIPTORS)) {
      for (const status of STATUSES) {
        for (const code of ALL_GAP_CODES) {
          const text: string = getResourceAiAttentionStepText(
            serverGap(code),
            status,
            descriptor,
          );

          expect({ code, text }).toEqual({
            code,
            text: LOOKED_UP.test(text) ? text : `Next step for ${code}`,
          });
        }

        expect(
          getResourceAiAttentionTitle(
            { ...status, gaps: ALL_GAP_CODES.map(serverGap) },
            descriptor,
          ),
        ).toMatch(LOOKED_UP);
      }
    }

    /*
     * Every step this page words is looked up; only remediation_disabled,
     * a choice rather than a gap, keeps the server's.
     */
    expect(
      ALL_GAP_CODES.filter((code: ResourceAiAccessGapCode): boolean => {
        return !LOOKED_UP.test(
          getResourceAiAttentionStepText(serverGap(code), makeStatus(), DOCKER),
        );
      }),
    ).toEqual(["remediation_disabled"]);

    expect(
      getResourceAiAttentionStepText(
        serverGap("ai_agent_unreachable_resource"),
        unreachable("refused"),
        DATABASE,
      ),
    ).toBe(
      "‹Let the ‹Database AI agent› reach this ‹database server› (its error and the logs command are above), then test the connection.›",
    );
  });
});
