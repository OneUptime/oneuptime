import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
  getResourceAiAgentInstallNextStep,
} from "../../../Server/Services/ResourceAiAccessService";
import { getResourceAiAgentResourceBinding } from "../../../Server/Services/ResourceAiAgentService";
import XcpNgPoolService from "../../../Server/Services/XcpNgPoolService";
import ResourceAiAccessSettings from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  doFixesNeedASecondOptIn,
  isReadOnlyAiResourceType,
  parseAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * OneUptime AI on an XCP-ng pool (#10998), as the server sees it: the pool
 * is a resource like a Proxmox cluster - read-only until a person allows
 * fixes, then each fix approved the way the pool's mode says - reached
 * through its XCP-ng AI agent, which reads Xen Orchestra with a read-only
 * token and changes the pool only with a second one. What the agent itself
 * refuses is tested with the agent (agents/ResourceAIAgent/Tests).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const POOL_UUID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const VM_UUID: string = "613f541c-4bed-fc77-7ca8-2db6b68f079c";

const READY_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

function poolRow(
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: AiResourceType.XcpNgPool,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "Production",
    identifier: POOL_UUID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    isArchived: false,
    ...overrides,
  };
}

function connectedAgent(posture: JSONObject = {}): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.XcpNgPool,
    resourceId: RESOURCE_ID,
    resourceIdentifier: POOL_UUID,
    agentVersion: "1.2.3",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: AiResourceType.XcpNgPool,
      resourceIdentifier: POOL_UUID,
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      details: { writeTokenConfigured: true, writeCredentialWorks: true },
      ...posture,
    },
  } as unknown as ResourceAiAgent;
}

function status(
  row: ResourceAiAccessRow,
  agentRow: ResourceAiAgent | null,
): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource: row,
    agentRow,
    gates: READY_GATES,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what kind of resource an XCP-ng pool is", () => {
  test("it has fixes, which follow Proxmox's and VMware's rules: no second opt-in of the page's own", () => {
    expect(isReadOnlyAiResourceType(AiResourceType.XcpNgPool)).toBe(false);
    expect(doFixesNeedASecondOptIn(AiResourceType.XcpNgPool)).toBe(
      doFixesNeedASecondOptIn(AiResourceType.ProxmoxCluster),
    );
    expect(doFixesNeedASecondOptIn(AiResourceType.XcpNgPool)).toBe(false);
  });

  test("its agent is the XCP-ng AI agent, running xo-cli, found by the pool's UUID", () => {
    const info: (typeof AI_RESOURCE_TYPE_INFO)[AiResourceType.XcpNgPool] =
      AI_RESOURCE_TYPE_INFO[AiResourceType.XcpNgPool];

    expect(info.agentDisplayName).toBe("XCP-ng AI agent");
    expect(info.programs).toEqual(["xo-cli"]);
    expect(info.identityEnvVars).toEqual(["XCP_NG_POOL_ID"]);
    expect(parseAiResourceType("xcp-ng")).toBe(AiResourceType.XcpNgPool);
    expect(parseAiResourceType("xcpng")).toBe(AiResourceType.XcpNgPool);
    expect(parseAiResourceType("xen-orchestra")).toBe(AiResourceType.XcpNgPool);
  });

  test("an agent registering is bound to the pool service and found by poolIdentifier", async () => {
    const found: JSONObject = { _id: RESOURCE_ID.toString() };
    const findOrCreate: jest.SpiedFunction<
      typeof XcpNgPoolService.findOrCreateByIdentifier
    > = jest
      .spyOn(XcpNgPoolService, "findOrCreateByIdentifier")
      .mockResolvedValue(found as never);

    const binding: ReturnType<typeof getResourceAiAgentResourceBinding> =
      getResourceAiAgentResourceBinding(AiResourceType.XcpNgPool);

    expect(binding.getService()).toBe(XcpNgPoolService);
    await expect(
      binding.findOrCreateByIdentity!({
        projectId: PROJECT_ID,
        identifier: POOL_UUID,
      }),
    ).resolves.toBe(found);
    expect(findOrCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      poolIdentifier: POOL_UUID,
    });
  });
});

describe("what a person may set on an XCP-ng pool", () => {
  test.each(Object.values(ResourceAiRemediationMode))(
    "a mode of %s is a choice they can make",
    (mode: ResourceAiRemediationMode) => {
      expect(() => {
        ResourceAiAccessSettings.validateSettings({
          resourceType: AiResourceType.XcpNgPool,
          data: { aiRemediationMode: mode },
        });
      }).not.toThrow();
    },
  );

  test("an allowlist holds the riskier changes of one VM or host, spelled out", () => {
    const entries: Array<string> = [
      `xo-cli rest post vms/${VM_UUID}/actions/clean_reboot`,
      `xo-cli rest post vms/${VM_UUID}/actions/clean_shutdown`,
      `xo-cli rest post vms/${VM_UUID}/actions/snapshot name_label=before-fix`,
      `xo-cli rest post hosts/${VM_UUID}/actions/enable`,
    ];
    const data: JSONObject = { aiCommandAllowlist: [...entries] };

    ResourceAiAccessSettings.validateSettings({
      resourceType: AiResourceType.XcpNgPool,
      data,
    });

    expect(data["aiCommandAllowlist"]).toEqual(entries);
  });

  test.each([
    ["a read", "xo-cli rest get vms"],
    [
      "a change that always asks a person",
      `xo-cli rest post vms/${VM_UUID}/actions/migrate hostId=${VM_UUID}`,
    ],
    [
      "a toolstack restart, which always asks a person",
      `xo-cli rest post hosts/${VM_UUID}/actions/restart_toolstack`,
    ],
    [
      "a change the policy never allows",
      `xo-cli rest post vms/${VM_UUID}/actions/revert_snapshot`,
    ],
    ["a delete", `xo-cli rest delete vms/${VM_UUID}`],
    ["another program", "pvesh create /nodes/pve1/qemu/100/status/shutdown"],
    ["a * inside a path", "xo-cli rest post vms/*/actions/clean_reboot"],
    ["a JSON-RPC call", `xo-cli vm.stop id=${VM_UUID}`],
  ])("an allowlist refuses %s", (_label: string, entry: string) => {
    expect(() => {
      ResourceAiAccessSettings.validateSettings({
        resourceType: AiResourceType.XcpNgPool,
        data: { aiCommandAllowlist: [entry] },
      });
    }).toThrow();
  });
});

describe("what the server tells the XCP-ng pool's AI agent page", () => {
  test("no agent yet: install it next to the collector, with this pool's UUID", () => {
    const built: ResourceAiAccessStatus = status(poolRow(), null);

    expect(built.isInvestigationReady).toBe(false);
    expect(
      built.gaps.map((gap: ResourceAiAccessGap): string => {
        return gap.nextStep;
      }),
    ).toContain(
      getResourceAiAgentInstallNextStep({
        resourceType: AiResourceType.XcpNgPool,
        resourceId: RESOURCE_ID.toString(),
        identifier: POOL_UUID,
      }),
    );
    expect(
      getResourceAiAgentInstallNextStep({
        resourceType: AiResourceType.XcpNgPool,
        identifier: POOL_UUID,
      }),
    ).toContain(
      `ONEUPTIME_AI_AGENT_RESOURCE_TYPE=xcp-ng and XCP_NG_POOL_ID=${POOL_UUID}`,
    );
  });

  test("investigation on, fixes off by default: ready to investigate, not to fix", () => {
    const built: ResourceAiAccessStatus = status(
      poolRow(),
      connectedAgent({ allowWrites: false }),
    );

    expect(built.isInvestigationReady).toBe(true);
    expect(built.isRemediationReady).toBe(false);
    expect(built.gaps[0]).toMatchObject({ code: "remediation_disabled" });
  });

  test.each(
    Object.values(ResourceAiRemediationMode).filter(
      (mode: ResourceAiRemediationMode): boolean => {
        return mode !== ResourceAiRemediationMode.Disabled;
      },
    ),
  )(
    "a mode of %s, an agent that may write and a token for changes that works: ready to fix",
    (mode: ResourceAiRemediationMode) => {
      const built: ResourceAiAccessStatus = status(
        poolRow({ aiRemediationMode: mode }),
        connectedAgent(),
      );

      expect(built.isRemediationReady).toBe(true);
      expect(built.gaps).toEqual([]);
    },
  );

  test("the write switch on but no token for changes: the agent's own reason, not the switch", () => {
    const gaps: Array<ResourceAiAccessGap> = status(
      poolRow({ aiRemediationMode: ResourceAiRemediationMode.RequireApproval }),
      connectedAgent({
        allowWrites: false,
        allowWritesSetting: "true",
        writesOffReason:
          "Changes use a Xen Orchestra token of their own, so set ONEUPTIME_AI_XO_WRITE_TOKEN to a token of a user whose role allows the fixes (the XCP-ng Agent's README lists them).",
      }),
    ).gaps;

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      code: "remediation_write_access_missing",
      title: "The XCP-ng AI agent is read-only",
      blocksInvestigation: false,
      blocksRemediation: true,
    });
    expect(gaps[0]?.nextStep).toContain("ONEUPTIME_AI_XO_WRITE_TOKEN");
    expect(gaps[0]?.nextStep).toContain("Then restart the XCP-ng AI agent.");
    expect(gaps[0]?.nextStep).not.toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });

  test("a token for changes Xen Orchestra refuses is said while someone can replace it", () => {
    const built: ResourceAiAccessStatus = status(
      poolRow({ aiRemediationMode: ResourceAiRemediationMode.RequireApproval }),
      connectedAgent({
        details: {
          writeTokenConfigured: true,
          writeCredentialWorks: false,
          writeCredentialProblem:
            "Xen Orchestra at https://xo.lab.example did not accept ONEUPTIME_AI_XO_WRITE_TOKEN, which is wrong or has expired.",
        },
      }),
    );

    expect(built.isInvestigationReady).toBe(true);
    expect(built.isRemediationReady).toBe(false);
    expect(built.gaps).toEqual([
      {
        code: "remediation_write_access_missing",
        title: "The XCP-ng AI agent's token for changes does not work",
        nextStep:
          "Xen Orchestra at https://xo.lab.example did not accept ONEUPTIME_AI_XO_WRITE_TOKEN, which is wrong or has expired.",
        blocksInvestigation: false,
        blocksRemediation: true,
      },
    ]);
  });

  test("a refused token with no reason given still says what to do", () => {
    const gaps: Array<ResourceAiAccessGap> = status(
      poolRow({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
      connectedAgent({ details: { writeCredentialWorks: false } }),
    ).gaps;

    expect(gaps[0]?.nextStep).toBe(
      "Xen Orchestra refused it. Make a new token for changes, as the XCP-ng Agent's README says.",
    );
  });

  test("fixes off: a broken token for changes is nobody's problem yet", () => {
    const built: ResourceAiAccessStatus = status(
      poolRow(),
      connectedAgent({ details: { writeCredentialWorks: false } }),
    );

    expect(
      built.gaps.map((gap: ResourceAiAccessGap): string => {
        return gap.code;
      }),
    ).toEqual(["remediation_disabled"]);
  });

  test("an agent that cannot reach Xen Orchestra says what to check: the address, xo-ca.pem and the read token", () => {
    const gaps: Array<ResourceAiAccessGap> = status(
      poolRow(),
      connectedAgent({
        reachable: false,
        reachError:
          "The TLS handshake with Xen Orchestra at https://xo.lab.example failed: the certificate names no address (it has no subjectAltName).",
      }),
    ).gaps;

    expect(gaps[0]).toMatchObject({
      code: "ai_agent_unreachable_resource",
      title: "The XCP-ng AI agent cannot reach this XCP-ng pool",
      blocksInvestigation: true,
    });
    expect(gaps[0]?.nextStep).toContain("the certificate names no address");
    expect(gaps[0]?.nextStep).toContain("XO_ADDRESS");
    expect(gaps[0]?.nextStep).toContain("xo-ca.pem");
    expect(gaps[0]?.nextStep).toContain("ONEUPTIME_AI_XO_READ_TOKEN");
  });
});
