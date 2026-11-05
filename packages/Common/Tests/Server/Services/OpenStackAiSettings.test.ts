import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
  READ_ONLY_AI_RESOURCE_TYPES,
  isReadOnlyAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * WHAT HOLDS FOR A RESOURCE AI ONLY READS.
 *
 * #5746 ships no command that changes an OpenStack cloud, and each place that could still
 * say fixes are on says they are off: what a person sets, what an agent reports, what a
 * first connection defaults to, and what the server tells the page. #5747 takes the type
 * off READ_ONLY_AI_RESOURCE_TYPES, and these tests are where it finds what that opens.
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

function connectedAgent(): ResourceAiAgent {
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

describe("which kinds AI only reads", () => {
  test("an OpenStack cloud, and nothing else", () => {
    expect(READ_ONLY_AI_RESOURCE_TYPES).toEqual([
      AiResourceType.OpenStackCloud,
    ]);
    expect(isReadOnlyAiResourceType(AiResourceType.OpenStackCloud)).toBe(true);
    expect(isReadOnlyAiResourceType(AiResourceType.ProxmoxCluster)).toBe(false);
  });
});

describe("what a person may set", () => {
  test.each(FIX_MODES)(
    "a fix mode of %s is refused, saying why",
    (mode: ResourceAiRemediationMode) => {
      const data: JSONObject = { aiRemediationMode: mode };

      expect(() => {
        ResourceAiAccessSettings.validateSettings({
          resourceType: AiResourceType.OpenStackCloud,
          data,
        });
      }).toThrow(
        "OneUptime AI only reads this OpenStack cloud: it has no command that changes it, so fixes stay off.",
      );
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

  test("the same mode on a kind with fixes is not refused for that reason", () => {
    expect(() => {
      ResourceAiAccessSettings.validateSettings({
        resourceType: AiResourceType.ProxmoxCluster,
        data: { aiRemediationMode: ResourceAiRemediationMode.Automatic },
      });
    }).not.toThrow();
  });
});

describe("what an agent reports", () => {
  test.each(
    AGENT_AI_FIXES_MODES.filter((fixes: AgentAiFixesMode): boolean => {
      return fixes !== "Disabled";
    }),
  )(
    "an agent whose configuration says %s changes nothing",
    async (fixes: AgentAiFixesMode) => {
      const update: jest.SpiedFunction<typeof OpenStackCloudService.updateOneBy> =
        jest.spyOn(OpenStackCloudService, "updateOneBy").mockResolvedValue(1);

      const applied: ResourceAiAgentSettingsApplied | null =
        await ResourceAiAgentService.applyReportedAiSettings({
          resource: agentResource(ResourceAiRemediationMode.Disabled),
          reported: {
            investigation: true,
            fixes,
            isConfigured: true,
          },
        });

      expect(applied?.remediationMode).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
    },
  );

  test("a mode already on the row is taken back to off", async () => {
    const update: jest.SpiedFunction<typeof OpenStackCloudService.updateOneBy> =
      jest.spyOn(OpenStackCloudService, "updateOneBy").mockResolvedValue(1);

    const applied: ResourceAiAgentSettingsApplied | null =
      await ResourceAiAgentService.applyReportedAiSettings({
        resource: agentResource(ResourceAiRemediationMode.Automatic),
        reported: {
          investigation: true,
          fixes: "Automatic",
          isConfigured: true,
        },
      });

    expect(applied?.remediationMode?.to).toBe(
      ResourceAiRemediationMode.Disabled,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      (update.mock.calls[0]![0] as unknown as { data: JSONObject }).data,
    ).toEqual({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
  });

  test("its investigation setting still counts", async () => {
    const update: jest.SpiedFunction<typeof OpenStackCloudService.updateOneBy> =
      jest.spyOn(OpenStackCloudService, "updateOneBy").mockResolvedValue(1);

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
    const update: jest.SpiedFunction<typeof OpenStackCloudService.updateOneBy> =
      jest.spyOn(OpenStackCloudService, "updateOneBy").mockResolvedValue(1);

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
  function status(row: ResourceAiAccessRow): ResourceAiAccessStatus {
    return ResourceAiAccessService.buildStatus({
      resource: row,
      agentRow: connectedAgent(),
      gates: READY_GATES,
    });
  }

  test.each(FIX_MODES)(
    "a row that somehow says %s still reads off, and is never ready to fix",
    (mode: ResourceAiRemediationMode) => {
      const built: ResourceAiAccessStatus = status(
        cloudRow({ aiRemediationMode: mode }),
      );

      expect(built.aiRemediationMode).toBe(ResourceAiRemediationMode.Disabled);
      expect(built.isRemediationReady).toBe(false);
      expect(built.isInvestigationReady).toBe(true);
    },
  );

  test("it says so as the one gap, which blocks fixes and not investigations", () => {
    const gaps: Array<ResourceAiAccessGap> = status(cloudRow()).gaps;

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      code: "remediation_disabled",
      blocksInvestigation: false,
      blocksRemediation: true,
      title: "OneUptime AI only reads this OpenStack cloud",
    });
  });
});
