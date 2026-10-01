import ResourceAiAccessService, {
  LoadedResourceAiAccessTarget,
  MAX_RESOURCES_PER_SUBJECT,
  ResourceAiAccessProjectGates,
  ResourceAiAccessRef,
  ResourceAiAccessRow,
  describeResourceNoun,
  getResourceAiAgentInstallNextStep,
  getResourceAiAgentPage,
  normalizeResourceAllowlist,
} from "../../../Server/Services/ResourceAiAccessService";
import AlertService from "../../../Server/Services/AlertService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostService from "../../../Server/Services/HostService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import MonitorService from "../../../Server/Services/MonitorService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../Server/Utils/Monitor/SeriesResourceLinker";
import logger from "../../../Server/Utils/Logger";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — ResourceAiAccessService, the resource-agnostic
 * sibling of KubernetesClusterAiAccessService:
 *
 * - the status of a resource is computed from CURRENT configuration: its
 *   agent (connected, online, reaching the resource, writes allowed), its
 *   own switches and the project-wide gates, each missing piece a gap with
 *   a next step, and readiness is exactly "enabled and no blocking gap";
 * - the resources an incident or alert offers an investigation are its
 *   linked resources (all eight relations), in ALL_AI_RESOURCE_TYPES order,
 *   capped at 10, with the monitors' step configuration resolved again only
 *   when none is linked; archived resources are left out;
 * - the enqueue chokepoint's target is the resource's ONLINE agent;
 * - a command's outcome is recorded on the resource row without the
 *   model's hooks, best effort.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const DOCKER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const HOST_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const DB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const CEPH_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const AGENT_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const MONITOR_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const READY_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

function row(
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: AiResourceType.DockerHost,
    id: DOCKER_ID,
    projectId: PROJECT_ID,
    name: "web-1",
    identifier: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    isArchived: false,
    ...overrides,
  };
}

function agentRow(
  overrides: Record<string, unknown> = {},
  postureOverrides: Record<string, unknown> = {},
): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceId: DOCKER_ID,
    resourceIdentifier: "web-1",
    agentVersion: "1.2.3",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      ...postureOverrides,
    },
    ...overrides,
  } as unknown as ResourceAiAgent;
}

function codes(status: ResourceAiAccessStatus): Array<ResourceAiAccessGapCode> {
  return status.gaps.map(
    (gap: ResourceAiAccessGap): ResourceAiAccessGapCode => {
      return gap.code;
    },
  );
}

function gap(
  status: ResourceAiAccessStatus,
  code: ResourceAiAccessGapCode,
): ResourceAiAccessGap {
  const found: ResourceAiAccessGap | undefined = status.gaps.find(
    (candidate: ResourceAiAccessGap): boolean => {
      return candidate.code === code;
    },
  );

  if (!found) {
    throw new Error(`no ${code} gap in ${JSON.stringify(codes(status))}`);
  }

  return found;
}

function build(
  resource: ResourceAiAccessRow,
  agent: ResourceAiAgent | null,
  gates: ResourceAiAccessProjectGates = READY_GATES,
): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource,
    agentRow: agent,
    gates,
  });
}

describe("ResourceAiAccessService.buildStatus", () => {
  it("is ready for both with an online, reaching, writable agent and everything on", () => {
    const status: ResourceAiAccessStatus = build(row(), agentRow());

    expect(status.gaps).toEqual([]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(true);
    expect(status.resourceType).toBe(AiResourceType.DockerHost);
    expect(status.resourceId).toBe(DOCKER_ID.toString());
    expect(status.resourceName).toBe("web-1");
    expect(status.agent?.agentId).toBe(AGENT_ID.toString());
    expect(status.agent?.isOnline).toBe(true);
    expect(status.agent?.posture?.allowWrites).toBe(true);
  });

  it("never exposes the agent's key hash", () => {
    const status: ResourceAiAccessStatus = build(
      row(),
      agentRow({ keyHash: "a".repeat(64) }),
    );

    expect(JSON.stringify(status)).not.toContain("a".repeat(64));
  });

  it("blocks both when no agent ever connected, and says what to install for THIS resource", () => {
    const status: ResourceAiAccessStatus = build(row(), null);
    const notConnected: ResourceAiAccessGap = gap(
      status,
      "ai_agent_not_connected",
    );

    expect(status.agent).toBeNull();
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
    expect(notConnected.title).toBe("No Docker AI agent is connected");
    expect(notConnected.blocksInvestigation).toBe(true);
    expect(notConnected.blocksRemediation).toBe(true);
    expect(notConnected.nextStep).toContain("oneuptime/resource-ai-agent");
    expect(notConnected.nextStep).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker",
    );
    expect(notConnected.nextStep).toContain("DOCKER_HOST_NAME=web-1");
    expect(notConnected.nextStep).toContain(
      "the Docker host's AI agent page (AI → AI agent)",
    );
    // No agent, so no "read-only agent" gap on top.
    expect(codes(status)).not.toContain("remediation_write_access_missing");
  });

  it("names a database server's install by its id", () => {
    const status: ResourceAiAccessStatus = build(
      row({
        resourceType: AiResourceType.DatabaseServer,
        id: DB_ID,
        name: "orders",
        identifier: "postgresql|db:5432",
      }),
      null,
    );

    expect(gap(status, "ai_agent_not_connected").nextStep).toContain(
      `DATABASE_SERVER_ID=${DB_ID.toString()}`,
    );
    expect(gap(status, "ai_agent_not_connected").nextStep).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=database",
    );
  });

  it("blocks both when the agent is offline", () => {
    const status: ResourceAiAccessStatus = build(
      row(),
      agentRow({
        lastAliveAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          -30,
        ),
      }),
    );

    expect(status.agent?.isOnline).toBe(false);
    expect(gap(status, "ai_agent_offline").title).toBe(
      "The Docker AI agent is offline",
    );
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("says when an offline agent signed off", () => {
    const status: ResourceAiAccessStatus = build(
      row(),
      agentRow({ connectionStatus: "disconnected" }),
    );

    expect(gap(status, "ai_agent_offline").nextStep).toContain(
      "and then signed off",
    );
  });

  it("blocks both when the agent cannot reach its resource, with its error and the hint", () => {
    const status: ResourceAiAccessStatus = build(
      row(),
      agentRow({}, { reachable: false, reachError: "socket not found" }),
    );
    const unreachable: ResourceAiAccessGap = gap(
      status,
      "ai_agent_unreachable_resource",
    );

    expect(unreachable.title).toBe(
      "The Docker AI agent cannot reach this Docker host",
    );
    expect(unreachable.nextStep).toContain("socket not found");
    expect(unreachable.nextStep).toContain("/var/run/docker.sock");
    expect(status.isInvestigationReady).toBe(false);
  });

  it.each<[string, ResourceAiAgent]>([
    ["no posture", agentRow({ posture: null })],
    ["an unreadable posture", agentRow({ posture: "nope" })],
    ["another type's posture", agentRow({}, { resourceType: "Host" })],
  ])(
    "does not trust an agent with %s",
    (_label: string, agent: ResourceAiAgent) => {
      const status: ResourceAiAccessStatus = build(row(), agent);

      expect(codes(status)).toContain("ai_agent_unreachable_resource");
      expect(status.isInvestigationReady).toBe(false);
    },
  );

  it("blocks only investigation when investigation is off", () => {
    const status: ResourceAiAccessStatus = build(
      row({ isAiInvestigationEnabled: false }),
      agentRow(),
    );
    const disabled: ResourceAiAccessGap = gap(status, "investigation_disabled");

    expect(disabled.blocksInvestigation).toBe(true);
    expect(disabled.blocksRemediation).toBe(false);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(true);
  });

  it("blocks only remediation when fixes are off, and never asks for writes then", () => {
    const status: ResourceAiAccessStatus = build(
      row({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
      agentRow({}, { allowWrites: false }),
    );

    expect(codes(status)).toEqual(["remediation_disabled"]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("blocks remediation on a read-only agent, naming the setting", () => {
    const status: ResourceAiAccessStatus = build(
      row({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
      agentRow({}, { allowWrites: false }),
    );
    const readOnly: ResourceAiAccessGap = gap(
      status,
      "remediation_write_access_missing",
    );

    expect(readOnly.nextStep).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
    expect(readOnly.nextStep).toContain("ONEUPTIME_AI_WRITE_TARGETS");
    expect(readOnly.blocksInvestigation).toBe(false);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it.each<
    [
      string,
      Partial<ResourceAiAccessProjectGates>,
      ResourceAiAccessGapCode,
      boolean,
    ]
  >([
    ["AI off", { isAiEnabled: false }, "ai_disabled_for_project", true],
    ["no provider", { hasLlmProvider: false }, "llm_provider_missing", true],
    [
      "no credits",
      { aiBalanceBlocker: "out of credits" },
      "ai_balance_insufficient",
      true,
    ],
  ])(
    "folds in the project gate: %s",
    (
      _label: string,
      gates: Partial<ResourceAiAccessProjectGates>,
      code: ResourceAiAccessGapCode,
      blocksInvestigation: boolean,
    ) => {
      const status: ResourceAiAccessStatus = build(row(), agentRow(), {
        ...READY_GATES,
        ...gates,
      });

      expect(gap(status, code).blocksInvestigation).toBe(blocksInvestigation);
      expect(gap(status, code).blocksRemediation).toBe(true);
      expect(status.isInvestigationReady).toBe(!blocksInvestigation);
      expect(status.isRemediationReady).toBe(false);
    },
  );

  /*
   * Enable AI is the project's only AI switch. The "Enable auto-remediation"
   * switch it replaced had a gap of its own
   * (auto_remediation_disabled_for_project), retired with it: with AI on a
   * resource's fixes need no other project switch, and with AI off the one
   * project gap is ai_disabled_for_project, blocking both.
   */
  it("needs no project switch but Enable AI, and never the retired auto-remediation gap", () => {
    const ready: ResourceAiAccessStatus = build(
      row({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval }),
      agentRow(),
    );

    expect(ready.gaps).toEqual([]);
    expect(ready.isRemediationReady).toBe(true);

    const off: ResourceAiAccessStatus = build(
      row({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval }),
      agentRow(),
      { ...READY_GATES, isAiEnabled: false },
    );

    expect(codes(off)).toEqual(["ai_disabled_for_project"]);
    expect(gap(off, "ai_disabled_for_project").nextStep).toBe(
      "Enable AI under Project Settings → AI Features.",
    );
    expect(codes(off)).not.toContain("auto_remediation_disabled_for_project");
    expect(off.isInvestigationReady).toBe(false);
    expect(off.isRemediationReady).toBe(false);
  });

  it("carries the resource's settings and bookkeeping", () => {
    const verifiedAt: Date = new Date("2026-09-01T10:00:00.000Z");
    const status: ResourceAiAccessStatus = build(
      row({
        aiCommandAllowlist: ["docker stop *"],
        aiAccessLastVerifiedAt: verifiedAt,
        aiAccessLastError: "boom",
      }),
      agentRow(),
    );

    expect(status.aiCommandAllowlist).toEqual(["docker stop *"]);
    expect(status.aiAccessLastVerifiedAt).toBe(
      OneUptimeDate.toString(verifiedAt),
    );
    expect(status.aiAccessLastError).toBe("boom");
    expect(status.aiAccessConfiguredAt).toBeNull();
  });
});

describe("ResourceAiAccessService helpers", () => {
  it("names the resource the way sentences read", () => {
    expect(describeResourceNoun(AiResourceType.Host)).toBe("host");
    expect(describeResourceNoun(AiResourceType.DatabaseServer)).toBe(
      "database server",
    );
    expect(describeResourceNoun(AiResourceType.VMwareVCenter)).toBe(
      "VMware vCenter",
    );
    expect(getResourceAiAgentPage(AiResourceType.Host)).toBe(
      "the host's AI agent page (AI → AI agent)",
    );
  });

  it("writes an install step for every type", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const step: string = getResourceAiAgentInstallNextStep({
        resourceType: type,
      });

      expect(step).toContain("oneuptime/resource-ai-agent");
      expect(step).toContain("ONEUPTIME_AI_AGENT_RESOURCE_TYPE=");
    }
  });

  it("normalizes a stored allowlist and drops what it cannot read", () => {
    expect(normalizeResourceAllowlist([" docker stop web ", "", 3])).toEqual([
      "docker stop web",
    ]);
    expect(normalizeResourceAllowlist('["a b c"]')).toEqual(["a b c"]);
    expect(normalizeResourceAllowlist("docker stop web")).toEqual([
      "docker stop web",
    ]);
    expect(normalizeResourceAllowlist({ a: 1 })).toEqual([]);
    expect(normalizeResourceAllowlist(null)).toEqual([]);
  });
});

describe("ResourceAiAccessService.getStatusesForResources", () => {
  let dockerFind: jest.SpyInstance;
  let hostFind: jest.SpyInstance;
  let agentsFind: jest.SpyInstance;
  let gatesRead: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    dockerFind = jest.spyOn(DockerHostService, "findBy").mockResolvedValue([
      {
        _id: DOCKER_ID.toString(),
        projectId: PROJECT_ID,
        name: "web-1",
        hostIdentifier: "web-1",
        isAiInvestigationEnabled: true,
        aiRemediationMode: "Automatic",
        aiCommandAllowlist: '["docker stop *"]',
      },
    ] as never);
    hostFind = jest.spyOn(HostService, "findBy").mockResolvedValue([
      {
        _id: HOST_ID.toString(),
        projectId: PROJECT_ID,
        name: "",
        hostIdentifier: "db-host",
        isAiInvestigationEnabled: false,
      },
    ] as never);
    agentsFind = jest
      .spyOn(ResourceAiAgentService, "findAgentsForResources")
      .mockImplementation(
        async (data: {
          resourceType: AiResourceType;
        }): Promise<Map<string, ResourceAiAgent>> => {
          return data.resourceType === AiResourceType.DockerHost
            ? new Map<string, ResourceAiAgent>([
                [DOCKER_ID.toString(), agentRow()],
              ])
            : new Map<string, ResourceAiAgent>();
        },
      );
    gatesRead = jest
      .spyOn(KubernetesClusterAiAccessService, "getProjectGates")
      .mockResolvedValue(READY_GATES);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers in the order asked, one row query and one agent query per type", async () => {
    const statuses: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForResources({
        projectId: PROJECT_ID,
        resources: [
          { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString(),
          },
        ],
      });

    expect(
      statuses.map((status: ResourceAiAccessStatus): string => {
        return status.resourceId;
      }),
    ).toEqual([HOST_ID.toString(), DOCKER_ID.toString()]);
    expect(dockerFind).toHaveBeenCalledTimes(1);
    expect(hostFind).toHaveBeenCalledTimes(1);
    expect(agentsFind).toHaveBeenCalledTimes(2);
    expect(gatesRead).toHaveBeenCalledTimes(1);

    const host: ResourceAiAccessStatus = statuses[0]!;
    const docker: ResourceAiAccessStatus = statuses[1]!;

    // A row without a name is named by its identity.
    expect(host.resourceName).toBe("db-host");
    expect(host.agent).toBeNull();
    expect(host.isInvestigationReady).toBe(false);
    expect(docker.isInvestigationReady).toBe(true);
    expect(docker.aiRemediationMode).toBe(ResourceAiRemediationMode.Automatic);
    expect(docker.aiCommandAllowlist).toEqual(["docker stop *"]);
  });

  it("reads every row in the caller's project, as root", async () => {
    await ResourceAiAccessService.getStatusesForResources({
      projectId: PROJECT_ID,
      resources: [
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: DOCKER_ID.toString(),
        },
      ],
    });

    const call: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
      select: Record<string, unknown>;
    } = dockerFind.mock.calls[0]![0];

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.query["isArchived"]).toBeUndefined();
    expect(call.props["isRoot"]).toBe(true);
    expect(call.select["isAiInvestigationEnabled"]).toBe(true);
    expect(call.select["aiRemediationMode"]).toBe(true);
    expect(call.select["aiCommandAllowlist"]).toBe(true);
    expect(call.select["hostIdentifier"]).toBe(true);
  });

  it("uses the gates it is handed instead of reading them", async () => {
    await ResourceAiAccessService.getStatusesForResources({
      projectId: PROJECT_ID,
      resources: [
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: DOCKER_ID.toString(),
        },
      ],
      gates: { ...READY_GATES, isAiEnabled: false },
    });

    expect(gatesRead).not.toHaveBeenCalled();
  });

  it("drops duplicates, unknown types, bad ids and resources that are not the project's", async () => {
    // The project has no such Ceph cluster.
    const cephFind: jest.SpyInstance = jest
      .spyOn(CephClusterService, "findBy")
      .mockResolvedValue([] as never);

    const statuses: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForResources({
        projectId: PROJECT_ID,
        resources: [
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString(),
          },
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString().toUpperCase(),
          },
          {
            resourceType: "Kubernetes" as never,
            resourceId: CEPH_ID.toString(),
          },
          { resourceType: AiResourceType.Host, resourceId: "not-a-uuid" },
          {
            resourceType: AiResourceType.CephCluster,
            resourceId: CEPH_ID.toString(),
          },
        ],
      });

    expect(statuses).toHaveLength(1);
    expect(hostFind).not.toHaveBeenCalled();
    expect(cephFind).toHaveBeenCalledTimes(1);
    // One docker id asked for twice (any case) is one row read.
    expect((dockerFind.mock.calls[0]![0] as { limit: number }).limit).toBe(1);
  });

  it("returns nothing, reading no gates, when no resource exists", async () => {
    dockerFind.mockResolvedValue([] as never);

    const statuses: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForResources({
        projectId: PROJECT_ID,
        resources: [
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString(),
          },
        ],
      });

    expect(statuses).toEqual([]);
    expect(gatesRead).not.toHaveBeenCalled();
    expect(agentsFind).not.toHaveBeenCalled();
  });

  it("reads every resource as agentless when the agent read fails — never more reachable", async () => {
    agentsFind.mockRejectedValue(new Error("agent table unavailable"));

    const statuses: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForResources({
        projectId: PROJECT_ID,
        resources: [
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString(),
          },
        ],
      });

    expect(statuses[0]!.agent).toBeNull();
    expect(statuses[0]!.isInvestigationReady).toBe(false);
  });

  it("leaves archived resources out when asked to", async () => {
    dockerFind.mockResolvedValue([
      {
        _id: DOCKER_ID.toString(),
        projectId: PROJECT_ID,
        name: "web-1",
        isArchived: true,
      },
    ] as never);

    const statuses: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForResources({
        projectId: PROJECT_ID,
        resources: [
          {
            resourceType: AiResourceType.DockerHost,
            resourceId: DOCKER_ID.toString(),
          },
        ],
        excludeArchived: true,
      });

    expect(statuses).toEqual([]);
    expect(
      (dockerFind.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query["isArchived"],
    ).toBe(false);
  });

  it("getStatusForResource answers for one resource, or null", async () => {
    const status: ResourceAiAccessStatus | null =
      await ResourceAiAccessService.getStatusForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: DOCKER_ID,
      });

    expect(status?.resourceName).toBe("web-1");

    dockerFind.mockResolvedValue([] as never);

    expect(
      await ResourceAiAccessService.getStatusForResource({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: DOCKER_ID,
      }),
    ).toBeNull();
  });
});

describe("ResourceAiAccessService.toRow", () => {
  it("builds a database server's identity from its endpoint", () => {
    const built: ResourceAiAccessRow | null = ResourceAiAccessService.toRow(
      AiResourceType.DatabaseServer,
      {
        _id: DB_ID.toString(),
        projectId: PROJECT_ID,
        name: "",
        dbSystem: "postgresql",
        serverAddress: "db.internal",
        serverPort: 5432,
      },
      { projectId: PROJECT_ID },
    );

    expect(built?.identifier).toBe("postgresql|db.internal:5432");
    expect(built?.name).toBe("postgresql|db.internal:5432");
  });

  it("names a cluster by its name, and falls back to the type", () => {
    expect(
      ResourceAiAccessService.toRow(
        AiResourceType.CephCluster,
        { _id: CEPH_ID.toString(), projectId: PROJECT_ID, name: "ceph-prod" },
        { projectId: PROJECT_ID },
      )?.identifier,
    ).toBe("ceph-prod");
    expect(
      ResourceAiAccessService.toRow(
        AiResourceType.CephCluster,
        { _id: CEPH_ID.toString(), projectId: PROJECT_ID },
        { projectId: PROJECT_ID },
      )?.name,
    ).toBe("Ceph cluster");
  });

  it("reads the switches fail-closed", () => {
    const built: ResourceAiAccessRow | null = ResourceAiAccessService.toRow(
      AiResourceType.Host,
      {
        _id: HOST_ID.toString(),
        projectId: PROJECT_ID,
        isAiInvestigationEnabled: "yes",
        aiRemediationMode: "Everything",
      },
      { projectId: PROJECT_ID },
    );

    expect(built?.isAiInvestigationEnabled).toBe(false);
    expect(built?.aiRemediationMode).toBe(ResourceAiRemediationMode.Disabled);
  });

  it("drops a row without an id or from another project", () => {
    expect(
      ResourceAiAccessService.toRow(
        AiResourceType.Host,
        { projectId: PROJECT_ID },
        { projectId: PROJECT_ID },
      ),
    ).toBeNull();
    expect(
      ResourceAiAccessService.toRow(
        AiResourceType.Host,
        { _id: HOST_ID.toString(), projectId: ObjectID.generate() },
        { projectId: PROJECT_ID },
      ),
    ).toBeNull();
  });
});

describe("ResourceAiAccessService.getResourcesForSubject", () => {
  let incidentFind: jest.SpyInstance;
  let alertFind: jest.SpyInstance;
  let monitorFind: jest.SpyInstance;
  let resolveMonitor: jest.SpyInstance;
  let loadResources: jest.SpyInstance;
  let linked: Record<string, Array<ObjectID>>;
  let monitors: Array<ObjectID>;
  // Resource ids that read as archived.
  let archived: Set<string>;

  function relationsOf(
    select: Record<string, unknown>,
  ): Record<string, unknown> {
    const subject: Record<string, unknown> = { _id: "x" };

    for (const key of Object.keys(select)) {
      if (key === "monitors") {
        subject["monitors"] = monitors.map((id: ObjectID) => {
          return { id };
        });
      } else if (key === "monitorId") {
        subject["monitorId"] = monitors[0];
      } else if (key !== "_id") {
        subject[key] = (linked[key] || []).map((id: ObjectID) => {
          return { id };
        });
      }
    }

    return subject;
  }

  beforeEach(() => {
    linked = {};
    monitors = [];
    archived = new Set<string>();
    // Every asked-for resource exists; the archived ones only without the filter.
    loadResources = jest
      .spyOn(ResourceAiAccessService, "loadResources")
      .mockImplementation(
        async (data: {
          resources: Array<ResourceAiAccessRef>;
          excludeArchived?: boolean | undefined;
        }): Promise<Array<ResourceAiAccessRow>> => {
          return data.resources
            .filter((ref: ResourceAiAccessRef): boolean => {
              return !(data.excludeArchived && archived.has(ref.resourceId));
            })
            .map((ref: ResourceAiAccessRef): ResourceAiAccessRow => {
              return row({
                resourceType: ref.resourceType,
                id: new ObjectID(ref.resourceId),
              });
            });
        },
      );
    incidentFind = jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation(async (data: unknown): Promise<never> => {
        return relationsOf(
          (data as { select: Record<string, unknown> }).select,
        ) as never;
      });
    alertFind = jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation(async (data: unknown): Promise<never> => {
        return relationsOf(
          (data as { select: Record<string, unknown> }).select,
        ) as never;
      });
    monitorFind = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        { _id: MONITOR_ID.toString(), projectId: PROJECT_ID },
      ] as never);
    resolveMonitor = jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue({
        ...MonitorResourceContextUtil.emptyContext(),
        hostIds: [HOST_ID.toString()],
        kubernetesClusterIds: [ObjectID.generate().toString()],
      } as SeriesResolvedResourceIds);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the incident's linked resources in type priority order", async () => {
    linked = {
      hosts: [HOST_ID],
      databaseServers: [DB_ID],
      dockerHosts: [DOCKER_ID],
      cephClusters: [CEPH_ID],
    };
    monitors = [MONITOR_ID];

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toEqual([
      {
        resourceType: AiResourceType.DockerHost,
        resourceId: DOCKER_ID.toString(),
      },
      {
        resourceType: AiResourceType.CephCluster,
        resourceId: CEPH_ID.toString(),
      },
      {
        resourceType: AiResourceType.DatabaseServer,
        resourceId: DB_ID.toString(),
      },
      { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
    ]);
    // Linked resources win: the monitors are not resolved.
    expect(resolveMonitor).not.toHaveBeenCalled();
    expect(monitorFind).not.toHaveBeenCalled();
  });

  it("reads each relation on its own, in the subject's project, as root", async () => {
    linked = { dockerHosts: [DOCKER_ID] };

    await ResourceAiAccessService.getResourcesForSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    const relations: Array<string> = [];

    for (const call of incidentFind.mock.calls) {
      const data: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = call[0];

      expect(data.query["projectId"]).toBe(PROJECT_ID);
      expect(data.query["_id"]).toBe(INCIDENT_ID.toString());
      expect(data.props["isRoot"]).toBe(true);

      relations.push(
        ...Object.keys(data.select).filter((key: string): boolean => {
          return key !== "_id";
        }),
      );
    }

    expect(relations.sort()).toEqual(
      [
        "cephClusters",
        "databaseServers",
        "dockerHosts",
        "dockerSwarmClusters",
        "hosts",
        "monitors",
        "podmanHosts",
        "proxmoxClusters",
        "vmwareVCenters",
      ].sort(),
    );
    expect(alertFind).not.toHaveBeenCalled();
  });

  it("reads an alert's relations and its monitor", async () => {
    linked = { podmanHosts: [DOCKER_ID] };
    monitors = [MONITOR_ID];

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      });

    expect(refs).toEqual([
      {
        resourceType: AiResourceType.PodmanHost,
        resourceId: DOCKER_ID.toString(),
      },
    ]);
    expect(incidentFind).not.toHaveBeenCalled();
    expect(
      alertFind.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { select: Record<string, unknown> }).select[
            "monitorId"
          ] === true
        );
      }),
    ).toBe(true);
  });

  it("falls back to the monitors' step configuration when nothing is linked", async () => {
    monitors = [MONITOR_ID];

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    // Only resource types an agent serves: the Kubernetes id is not one.
    expect(refs).toEqual([
      { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
    ]);
    const monitorQuery: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = monitorFind.mock.calls[0]![0];
    expect(monitorQuery.query["projectId"]).toBe(PROJECT_ID);
    expect(monitorQuery.select["monitorSteps"]).toBe(true);
    expect(monitorQuery.select["monitorType"]).toBe(true);
    expect(monitorQuery.select["projectId"]).toBe(true);
    expect(resolveMonitor).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for a subject with neither resources nor monitors", async () => {
    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toEqual([]);
    expect(monitorFind).not.toHaveBeenCalled();
  });

  it("returns nothing without a subject", async () => {
    expect(
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
      }),
    ).toEqual([]);
    expect(incidentFind).not.toHaveBeenCalled();
    expect(alertFind).not.toHaveBeenCalled();
  });

  it("caps a subject at 10 resources, keeping the highest-priority types", async () => {
    linked = {
      hosts: Array.from({ length: 6 }, (): ObjectID => {
        return ObjectID.generate();
      }),
      dockerHosts: Array.from({ length: 6 }, (): ObjectID => {
        return ObjectID.generate();
      }),
    };

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(MAX_RESOURCES_PER_SUBJECT).toBe(10);
    expect(refs).toHaveLength(10);
    expect(
      refs.filter((ref: ResourceAiAccessRef): boolean => {
        return ref.resourceType === AiResourceType.DockerHost;
      }),
    ).toHaveLength(6);
  });

  /*
   * Regression: the cap used to be taken before archived resources were
   * dropped, so ten archived Docker hosts (a higher-priority type) hid the
   * incident's one active host and the investigation was offered nothing.
   */
  it("drops archived links before the cap, so an active resource behind ten archived ones is kept", async () => {
    const archivedDockerHosts: Array<ObjectID> = Array.from(
      { length: MAX_RESOURCES_PER_SUBJECT },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );
    archivedDockerHosts.forEach((id: ObjectID): void => {
      archived.add(id.toString());
    });
    linked = { dockerHosts: archivedDockerHosts, hosts: [HOST_ID] };
    monitors = [MONITOR_ID];

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toEqual([
      { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
    ]);
    for (const call of loadResources.mock.calls) {
      const data: { projectId: ObjectID; excludeArchived?: boolean } = call[0];
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.excludeArchived).toBe(true);
    }
    // A linked resource was active: the monitors are not resolved.
    expect(resolveMonitor).not.toHaveBeenCalled();
  });

  it("falls back to the monitors' step configuration when every linked resource is archived", async () => {
    archived.add(DOCKER_ID.toString());
    linked = { dockerHosts: [DOCKER_ID] };
    monitors = [MONITOR_ID];

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toEqual([
      { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
    ]);
    expect(resolveMonitor).toHaveBeenCalledTimes(1);
  });

  it("leaves out an archived resource the monitors' step configuration names", async () => {
    archived.add(HOST_ID.toString());
    monitors = [MONITOR_ID];

    expect(
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual([]);
  });

  it("reads a long list of archived links in batches, not one read per link", async () => {
    const archivedHosts: Array<ObjectID> = Array.from(
      { length: 60 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );
    archivedHosts.forEach((id: ObjectID): void => {
      archived.add(id.toString());
    });
    linked = { hosts: [...archivedHosts, HOST_ID] };

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toEqual([
      { resourceType: AiResourceType.Host, resourceId: HOST_ID.toString() },
    ]);
    expect(loadResources).toHaveBeenCalledTimes(2);
  });

  it("stops reading once the cap is reached", async () => {
    linked = {
      hosts: Array.from({ length: 120 }, (): ObjectID => {
        return ObjectID.generate();
      }),
    };

    const refs: Array<ResourceAiAccessRef> =
      await ResourceAiAccessService.getResourcesForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(refs).toHaveLength(MAX_RESOURCES_PER_SUBJECT);
    expect(loadResources).toHaveBeenCalledTimes(1);
  });

  it("getStatusesForSubject reads statuses of the linked, unarchived resources only", async () => {
    linked = { dockerHosts: [DOCKER_ID] };
    const statusesSpy: jest.SpyInstance = jest
      .spyOn(ResourceAiAccessService, "getStatusesForResources")
      .mockResolvedValue([]);

    await ResourceAiAccessService.getStatusesForSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(statusesSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resources: [
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: DOCKER_ID.toString(),
        },
      ],
      excludeArchived: true,
    });
  });

  it("getStatusesForSubject reads nothing more for a subject without resources", async () => {
    const statusesSpy: jest.SpyInstance = jest.spyOn(
      ResourceAiAccessService,
      "getStatusesForResources",
    );

    expect(
      await ResourceAiAccessService.getStatusesForSubject({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual([]);
    expect(statusesSpy).not.toHaveBeenCalled();
  });
});

describe("ResourceAiAccessService.loadAccessTarget", () => {
  let cephFind: jest.SpyInstance;
  let onlineAgent: jest.SpyInstance;

  beforeEach(() => {
    cephFind = jest
      .spyOn(CephClusterService, "findBy")
      .mockResolvedValue([
        { _id: CEPH_ID.toString(), projectId: PROJECT_ID, name: "ceph-prod" },
      ] as never);
    onlineAgent = jest
      .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
      .mockResolvedValue(
        agentRow({ resourceType: AiResourceType.CephCluster }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the resource and its online agent", async () => {
    const loaded: LoadedResourceAiAccessTarget =
      await ResourceAiAccessService.loadAccessTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.CephCluster,
        resourceId: CEPH_ID,
      });

    expect(loaded.resource?.name).toBe("ceph-prod");
    expect(loaded.agent?.id?.toString()).toBe(AGENT_ID.toString());
    expect(onlineAgent).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.CephCluster,
      resourceId: expect.anything(),
    });
  });

  it("never looks for an agent of a resource the project does not have", async () => {
    cephFind.mockResolvedValue([] as never);

    const loaded: LoadedResourceAiAccessTarget =
      await ResourceAiAccessService.loadAccessTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.CephCluster,
        resourceId: CEPH_ID,
      });

    expect(loaded).toEqual({ resource: null, agent: null });
    expect(onlineAgent).not.toHaveBeenCalled();
  });

  it("returns no agent when none is online", async () => {
    onlineAgent.mockResolvedValue(null);

    const loaded: LoadedResourceAiAccessTarget =
      await ResourceAiAccessService.loadAccessTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.CephCluster,
        resourceId: CEPH_ID,
      });

    expect(loaded.resource).not.toBeNull();
    expect(loaded.agent).toBeNull();
  });

  it("propagates a failed read (the chokepoint fails closed)", async () => {
    cephFind.mockRejectedValue(new Error("db down"));

    await expect(
      ResourceAiAccessService.loadAccessTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.CephCluster,
        resourceId: CEPH_ID,
      }),
    ).rejects.toThrow("db down");
  });

  it("returns nothing for an unknown type", async () => {
    const loaded: LoadedResourceAiAccessTarget =
      await ResourceAiAccessService.loadAccessTarget({
        projectId: PROJECT_ID,
        resourceType: "Kubernetes" as never,
        resourceId: CEPH_ID,
      });

    expect(loaded).toEqual({ resource: null, agent: null });
  });
});

describe("ResourceAiAccessService.recordCommandOutcome", () => {
  let update: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    update = jest
      .spyOn(DatabaseServerService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records a success as verified and clears the last error, without hooks", async () => {
    await ResourceAiAccessService.recordCommandOutcome({
      resourceType: AiResourceType.DatabaseServer,
      resourceId: DB_ID,
      succeeded: true,
    });

    const call: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
    } = update.mock.calls[0]![0];

    expect(call.id).toBe(DB_ID);
    expect(call.data["aiAccessLastVerifiedAt"]).toBeInstanceOf(Date);
    expect(call.data["aiAccessLastError"]).toBeNull();
    expect(call.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  it("records a failure's error, capped, and leaves last verified alone", async () => {
    await ResourceAiAccessService.recordCommandOutcome({
      resourceType: AiResourceType.DatabaseServer,
      resourceId: DB_ID,
      succeeded: false,
      errorMessage: "x".repeat(5000),
    });

    const data: Record<string, unknown> = (
      update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect((data["aiAccessLastError"] as string).length).toBe(2000);
    expect(data["aiAccessLastVerifiedAt"]).toBeUndefined();
  });

  it("writes the right table for each type", async () => {
    const podmanUpdate: jest.SpyInstance = jest
      .spyOn(PodmanHostService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ResourceAiAccessService.recordCommandOutcome({
      resourceType: AiResourceType.PodmanHost,
      resourceId: DOCKER_ID,
      succeeded: false,
    });

    expect(podmanUpdate).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(
      (podmanUpdate.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data["aiAccessLastError"],
    ).toBe("Command failed.");
  });

  it("never throws", async () => {
    update.mockRejectedValue(new Error("write failed"));

    await expect(
      ResourceAiAccessService.recordCommandOutcome({
        resourceType: AiResourceType.DatabaseServer,
        resourceId: DB_ID,
        succeeded: true,
      }),
    ).resolves.toBeUndefined();

    await expect(
      ResourceAiAccessService.recordCommandOutcome({
        resourceType: "Kubernetes" as never,
        resourceId: DB_ID,
        succeeded: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("ResourceAiAccessService.getProjectGates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the project's gates exactly as the cluster service does", async () => {
    const gatesRead: jest.SpyInstance = jest
      .spyOn(KubernetesClusterAiAccessService, "getProjectGates")
      .mockResolvedValue(READY_GATES);

    expect(await ResourceAiAccessService.getProjectGates(PROJECT_ID)).toBe(
      READY_GATES,
    );
    expect(gatesRead).toHaveBeenCalledWith(PROJECT_ID);
  });
});
