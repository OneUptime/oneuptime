import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
} from "../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService, {
  ResourceAiAgentDefaultsApplied,
  ResourceAiAgentSettingsApplied,
} from "../../../Server/Services/ResourceAiAgentService";
import ResourceAiAccessSettings from "../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import {
  AGENT_AI_FIXES_MODES,
  AgentAiFixesMode,
} from "../../../Types/AI/AgentAiSettings";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import AiResourceType, {
  FIXES_NEED_A_SECOND_OPT_IN_AI_RESOURCE_TYPES,
  READ_ONLY_AI_RESOURCE_TYPES,
  doFixesNeedASecondOptIn,
  isReadOnlyAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * OFF UNTIL TWICE OPTED IN.
 *
 * An OpenStack cloud has fixes now, and they stay off until two people's worth of
 * choices say otherwise: the agent's write switch, with its credential for changes, and
 * a mode that is not Off, chosen on the cloud's AI agent page or named in the agent's
 * ONEUPTIME_AI_FIXES. What a first connection or an agent's defaults do on other
 * resources (start on "ask for approval") does not happen here: a production cloud's
 * control plane starts on Off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const FIX_MODES: ReadonlyArray<ResourceAiRemediationMode> = Object.values(
  ResourceAiRemediationMode,
).filter((mode: ResourceAiRemediationMode): boolean => {
  return mode !== ResourceAiRemediationMode.Disabled;
});

const READY_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

function cloudRow(
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "prod-eu",
    identifier: "prod-eu",
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
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: RESOURCE_ID,
    resourceIdentifier: "prod-eu",
    agentVersion: "1.2.3",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: AiResourceType.OpenStackCloud,
      resourceIdentifier: "prod-eu",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      ...posture,
    },
  } as unknown as ResourceAiAgent;
}

function agentResource(mode: ResourceAiRemediationMode): {
  resourceType: AiResourceType;
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: ResourceAiRemediationMode;
  aiAccessConfiguredAt: null;
} {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "prod-eu",
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiAccessConfiguredAt: null,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which kinds have fixes", () => {
  test("no kind is read-only any more", () => {
    expect(READ_ONLY_AI_RESOURCE_TYPES).toEqual([]);
    expect(isReadOnlyAiResourceType(AiResourceType.OpenStackCloud)).toBe(false);
  });

  test("an OpenStack cloud's need a second opt-in, and nothing else's do", () => {
    expect(FIXES_NEED_A_SECOND_OPT_IN_AI_RESOURCE_TYPES).toEqual([
      AiResourceType.OpenStackCloud,
    ]);
    expect(doFixesNeedASecondOptIn(AiResourceType.OpenStackCloud)).toBe(true);
    expect(doFixesNeedASecondOptIn(AiResourceType.ProxmoxCluster)).toBe(false);
    expect(doFixesNeedASecondOptIn("nothing")).toBe(false);
    expect(doFixesNeedASecondOptIn(undefined)).toBe(false);
  });
});

describe("what a person may set", () => {
  test.each(FIX_MODES)(
    "a mode of %s is a choice they can make",
    (mode: ResourceAiRemediationMode) => {
      expect(() => {
        ResourceAiAccessSettings.validateSettings({
          resourceType: AiResourceType.OpenStackCloud,
          data: { aiRemediationMode: mode },
        });
      }).not.toThrow();
    },
  );

  test("off stays allowed, and so does turning investigations off", () => {
    expect(() => {
      ResourceAiAccessSettings.validateSettings({
        resourceType: AiResourceType.OpenStackCloud,
        data: {
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
          isAiInvestigationEnabled: false,
        },
      });
    }).not.toThrow();
  });

  test("an allowlist holds changes, and refuses what could never run", () => {
    const data: JSONObject = {
      aiCommandAllowlist: [
        "openstack server reboot --hard 358ee736-ba74-40ba-a354-7ead413c5df6",
      ],
    };

    ResourceAiAccessSettings.validateSettings({
      resourceType: AiResourceType.OpenStackCloud,
      data,
    });

    expect(data["aiCommandAllowlist"]).toEqual([
      "openstack server reboot --hard 358ee736-ba74-40ba-a354-7ead413c5df6",
    ]);

    for (const entry of [
      "openstack server delete 358ee736-ba74-40ba-a354-7ead413c5df6",
      "openstack user list",
      "openstack server list",
      "openstack server evacuate 358ee736-ba74-40ba-a354-7ead413c5df6",
    ]) {
      expect(() => {
        ResourceAiAccessSettings.validateSettings({
          resourceType: AiResourceType.OpenStackCloud,
          data: { aiCommandAllowlist: [entry] },
        });
      }).toThrow();
    }
  });
});

describe("what an agent reports", () => {
  test("its write switch alone turns nothing on: an agent's defaults are not a choice", async () => {
    const update: SpyInstance<typeof OpenStackCloudService.updateOneBy> = jest
      .spyOn(OpenStackCloudService, "updateOneBy")
      .mockResolvedValue(1);

    const applied: ResourceAiAgentSettingsApplied | null =
      await ResourceAiAgentService.applyReportedAiSettings({
        resource: agentResource(ResourceAiRemediationMode.Disabled),
        reported: {
          investigation: true,
          fixes: "RequireApproval",
          isConfigured: false,
        },
      });

    expect(applied?.remediationMode).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  test.each(
    AGENT_AI_FIXES_MODES.filter((fixes: AgentAiFixesMode): boolean => {
      return fixes !== "Disabled";
    }),
  )(
    "a configuration that names %s is the second opt-in",
    async (fixes: AgentAiFixesMode) => {
      const update: SpyInstance<typeof OpenStackCloudService.updateOneBy> = jest
        .spyOn(OpenStackCloudService, "updateOneBy")
        .mockResolvedValue(1);

      const applied: ResourceAiAgentSettingsApplied | null =
        await ResourceAiAgentService.applyReportedAiSettings({
          resource: agentResource(ResourceAiRemediationMode.Disabled),
          reported: { investigation: true, fixes, isConfigured: true },
        });

      expect(applied?.remediationMode?.to).toBe(fixes);
      expect(update).toHaveBeenCalledTimes(1);
    },
  );

  test("a configuration that says off takes a mode on the row back to off", async () => {
    const update: SpyInstance<typeof OpenStackCloudService.updateOneBy> = jest
      .spyOn(OpenStackCloudService, "updateOneBy")
      .mockResolvedValue(1);

    const applied: ResourceAiAgentSettingsApplied | null =
      await ResourceAiAgentService.applyReportedAiSettings({
        resource: agentResource(ResourceAiRemediationMode.Automatic),
        reported: {
          investigation: true,
          fixes: "Disabled",
          isConfigured: true,
        },
      });

    expect(applied?.remediationMode?.to).toBe(
      ResourceAiRemediationMode.Disabled,
    );
    expect(
      (update.mock.calls[0]![0] as unknown as { data: JSONObject }).data,
    ).toEqual({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
  });

  test("its investigation setting still counts", async () => {
    const update: SpyInstance<typeof OpenStackCloudService.updateOneBy> = jest
      .spyOn(OpenStackCloudService, "updateOneBy")
      .mockResolvedValue(1);

    const applied: ResourceAiAgentSettingsApplied | null =
      await ResourceAiAgentService.applyReportedAiSettings({
        resource: agentResource(ResourceAiRemediationMode.Disabled),
        reported: {
          investigation: false,
          fixes: "Disabled",
          isConfigured: true,
        },
      });

    expect(applied?.source).toBe("agent_configuration");
    expect(
      (update.mock.calls[0]![0] as unknown as { data: JSONObject }).data,
    ).toEqual({ isAiInvestigationEnabled: false });
  });
});

describe("a first connection", () => {
  test("turns investigation on, and never fixes, whatever the agent allows", async () => {
    const update: SpyInstance<typeof OpenStackCloudService.updateOneBy> = jest
      .spyOn(OpenStackCloudService, "updateOneBy")
      .mockResolvedValue(1);

    const applied: ResourceAiAgentDefaultsApplied =
      await ResourceAiAgentService.applyFirstConnectionDefaults({
        resource: {
          ...agentResource(ResourceAiRemediationMode.Disabled),
          isAiInvestigationEnabled: false,
        },
        allowWrites: true,
      });

    expect(applied.turnedOnInvestigation).toBe(true);
    expect(applied.remediationMode).toBeUndefined();
    expect(
      (update.mock.calls[0]![0] as unknown as { data: JSONObject }).data[
        "aiRemediationMode"
      ],
    ).toBeUndefined();
  });
});

describe("what the server tells the page", () => {
  function status(
    row: ResourceAiAccessRow,
    posture: JSONObject = {},
  ): ResourceAiAccessStatus {
    return ResourceAiAccessService.buildStatus({
      resource: row,
      agentRow: connectedAgent(posture),
      gates: READY_GATES,
    });
  }

  test.each(FIX_MODES)(
    "a mode of %s, and an agent that may write: ready to fix",
    (mode: ResourceAiRemediationMode) => {
      const built: ResourceAiAccessStatus = status(
        cloudRow({ aiRemediationMode: mode }),
      );

      expect(built.aiRemediationMode).toBe(mode);
      expect(built.isRemediationReady).toBe(true);
      expect(built.isInvestigationReady).toBe(true);
      expect(built.gaps).toEqual([]);
    },
  );

  test("off: not ready, and it says how to turn it on", () => {
    const built: ResourceAiAccessStatus = status(cloudRow());

    expect(built.isRemediationReady).toBe(false);
    expect(built.isInvestigationReady).toBe(true);
    expect(built.gaps).toHaveLength(1);
    expect(built.gaps[0]).toMatchObject({
      code: "remediation_disabled",
      blocksInvestigation: false,
      blocksRemediation: true,
    });
  });

  test("on, with an agent that may not write: not ready, whatever the row says", () => {
    const gaps: Array<ResourceAiAccessGap> = status(
      cloudRow({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
      { allowWrites: false },
    ).gaps;

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      code: "remediation_write_access_missing",
      blocksRemediation: true,
    });
    expect(gaps[0]?.nextStep).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });

  test("the switch is on and something else stops it: it says that, not to turn the switch on", () => {
    const gaps: Array<ResourceAiAccessGap> = status(
      cloudRow({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
      {
        allowWrites: false,
        allowWritesSetting: "true",
        writesOffReason:
          "Changes use a credential of their own: set ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID and its secret.",
      },
    ).gaps;

    expect(gaps[0]?.nextStep).toContain("credential of their own");
    expect(gaps[0]?.nextStep).not.toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });

  test("a credential for changes that does not log in is said while it can be fixed", () => {
    const built: ResourceAiAccessStatus = status(
      cloudRow({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
      {
        details: {
          writeCredentialWorks: false,
          writeCredentialProblem: "Keystone refused the credential.",
        },
      },
    );

    expect(built.isRemediationReady).toBe(false);
    expect(built.isInvestigationReady).toBe(true);
    expect(built.gaps[0]).toMatchObject({
      code: "remediation_write_access_missing",
      nextStep: "Keystone refused the credential.",
    });
  });

  test("one that logs in stands in nobody's way", () => {
    expect(
      status(
        cloudRow({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
        { details: { writeCredentialWorks: true } },
      ).isRemediationReady,
    ).toBe(true);
  });
});
