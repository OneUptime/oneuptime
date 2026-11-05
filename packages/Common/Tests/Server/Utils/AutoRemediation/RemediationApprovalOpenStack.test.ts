import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../../Models/DatabaseModels/Project";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import {
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource from "../../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import UserType from "../../../../Types/UserType";
import { OpenStackChangeReach } from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";

/*
 * A PERSON SAYS YES TO WHAT A REAL CLOUD PROPOSED.
 *
 * The rig's proposals (ai-agent/hibiscus-ovn/fixes: what the agent read of a real disabled
 * nova-compute and a real dead hypervisor), through the real RemediationApproval, up to the
 * executor that starts the jobs. What the approval checks again here is what could have changed
 * since the card went up: whether the cloud still allows it, whose agent it still is, and what
 * that agent's write scope says now. What is stubbed is the database and the executor.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const USER_ID: ObjectID = new ObjectID("cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03");
const ALERT_ID: ObjectID = new ObjectID("cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04");
const CLOUD_ID: ObjectID = new ObjectID("cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05");
const AGENT_ID: string = "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b06";
const RUN_ID: ObjectID = new ObjectID("cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b07");
const HOST: string = "compute-01";

interface Proposal {
  command: string;
  reach: OpenStackChangeReach;
}

function recorded(name: string): Proposal {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../Fixtures/OpenStack/ai-agent/hibiscus-ovn/fixes",
        name,
      ),
      "utf8",
    ),
  ) as Proposal;
}

const ENABLE: Proposal = recorded("enable-proposal.json");
const EVACUATE: Proposal = recorded("evacuate-proposal.json");

function caller(): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      } as UserPermission,
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function statusOf(
  overrides: Partial<ResourceAiAccessStatus> = {},
  posture: Record<string, unknown> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: CLOUD_ID.toString(),
    resourceName: "prod-eu",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.OpenStackCloud,
        resourceIdentifier: "prod-eu",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
        ...posture,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  } as unknown as ResourceAiAccessStatus;
}

function rowFor(
  command: string,
  reach: OpenStackChangeReach | undefined,
  tier: ResourceCommandTier,
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    alertId: ALERT_ID,
    aiRunId: RUN_ID,
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: CLOUD_ID,
    ruleNameSnapshot: 'Workflow "Page and propose"',
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationWindowMinutes: 15,
    commandPlan: AiRemediationCommandPlanUtil.toJSON({
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.ResourceCommand,
          runnerId: AGENT_ID,
          runnerNameSnapshot: "OpenStack AI agent",
          resourceType: AiResourceType.OpenStackCloud,
          resourceId: CLOUD_ID.toString(),
          command,
          timeoutInMs: 60_000,
          rationale: "It stopped reporting.",
          expectedEffect: "What the command says.",
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          resourceCommandTier: tier,
          ...(reach ? { reach } : {}),
        },
      ],
    }),
  };
}

describe("approving a fix a real cloud was asked about", () => {
  let row: Record<string, unknown>;
  let claims: Array<{ set: Record<string, unknown> }>;
  let execute: ReturnType<typeof jest.spyOn>;

  function useStatus(status: ResourceAiAccessStatus | null): void {
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(status);
  }

  async function approve(): Promise<void> {
    await RemediationApproval.approve({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
    });
  }

  async function expectRefused(words: string): Promise<void> {
    await expect(approve()).rejects.toThrow(words);
    expect(claims).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    claims = [];
    row = rowFor(ENABLE.command, ENABLE.reach, ResourceCommandTier.SafeWrite);

    useStatus(statusOf());
    // Whether this person may change this cloud has tests of its own.
    jest
      .spyOn(ResourceAiAccessService, "assertCallerMayChangeResource")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation((async (args: {
        select: Record<string, unknown>;
      }): Promise<AutoRemediationSuggestion> => {
        const picked: Record<string, unknown> = { id: row["id"] };

        for (const key of Object.keys(args.select)) {
          if (key in row) {
            picked[key] = row[key];
          }
        }

        return picked as unknown as AutoRemediationSuggestion;
      }) as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockImplementation((async (transition: {
        set: Record<string, unknown>;
      }): Promise<number> => {
        claims.push(transition);

        return 1;
      }) as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ enableAi: true } as unknown as Project as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    execute = jest
      .spyOn(CommandPlanExecutor, "executeApprovedPlan")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the real re-enable: it's approved, by whom and where, and handed to the executor once", async () => {
    await approve();

    expect(claims).toHaveLength(1);
    expect(claims[0]!.set["status"]).toBe(
      AutoRemediationSuggestionStatus.Approved,
    );
    expect(String(claims[0]!.set["approvedByUserId"])).toBe(USER_ID.toString());
    expect(claims[0]!.set["approvedFrom"]).toBe(
      AutoRemediationApprovalSource.Dashboard,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("the real evacuation: with what the agent read of it, a person can say yes", async () => {
    row = rowFor(
      EVACUATE.command,
      EVACUATE.reach,
      ResourceCommandTier.RiskyWrite,
    );

    await approve();

    expect(claims).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);

    const stored: JSONObject = row["commandPlan"] as JSONObject;

    expect(JSON.stringify(stored)).toContain("ou-evacuate-payments");
    expect(JSON.stringify(stored)).toContain("ou-research");
  });

  test("an evacuation that doesn't say what it touches is never approved blind", async () => {
    row = rowFor(EVACUATE.command, undefined, ResourceCommandTier.RiskyWrite);

    await expectRefused("evacuates instances");
  });

  test("a cloud whose fixes were turned off since the card went up", async () => {
    const gap: ResourceAiAccessGap = {
      code: "remediation_disabled",
      title: "AI fixes are turned off for this OpenStack cloud",
      nextStep: "Turn them on.",
      blocksInvestigation: false,
      blocksRemediation: true,
    };

    useStatus(statusOf({ isRemediationReady: false, gaps: [gap] }));

    await expectRefused("no longer allows AI remediation");
  });

  test("an agent that isn't the one the card named any more", async () => {
    useStatus(
      statusOf({
        agent: {
          ...statusOf().agent,
          agentId: "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b99",
        } as ResourceAiAccessStatus["agent"],
      }),
    );

    await expectRefused("is no longer reached through");
  });

  test("an agent that had its write switch turned off since", async () => {
    useStatus(statusOf({}, { allowWrites: false }));

    await expectRefused("read-only");
  });

  test("a host protected since, whatever the person approving it says", async () => {
    useStatus(statusOf({}, { protectedTargets: [`host:${HOST}`] }));

    await expectRefused("protects");
  });

  test("a cloud that is gone", async () => {
    useStatus(null);

    await expectRefused("no longer exists");
  });

  test("a command the policy denies, however it got into the plan", async () => {
    row = rowFor(
      "openstack server delete 358ee736-ba74-40ba-a354-7ead413c5df6",
      undefined,
      ResourceCommandTier.RiskyWrite,
    );

    await expect(approve()).rejects.toThrow();
    expect(claims).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
